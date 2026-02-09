// ═══════════════════════════════════════════════════════════════════════
//  Orders Service — CRUD for orders (inquiries + confirmed orders)
//
//  An "inquiry" is simply an order with status INQUIRY or OFFER.
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, desc, sql, ilike, inArray, or } from 'drizzle-orm';
import { db } from '../../db';
import {
  orders,
  orderItems,
  counterparties,
  vessels,
  places,
  users,
  orderNumberSequences,
  tenants,
} from '../../db/schema';
import type { TenantSettings } from '../../db/schema';
import { logActivity } from '../activity/activity.service';

// ─── Types ──────────────────────────────────────────────────────────

interface ListOrdersQuery {
  search?: string;
  statuses?: string[];     // filter by status(es), e.g. ['INQUIRY','OFFER'] for inquiries
  salesRepId?: string;
  page?: number;
  limit?: number;
}

interface CreateOrderInput {
  tenantId: string;
  clientId: string;
  vesselId: string;
  placeId: string;
  salesRepId?: string | null;
  invoicingCompanyId?: string | null;
  currency?: string;
  eta?: string | null;
  etd?: string | null;
}

interface UpdateOrderInput {
  clientId?: string;
  vesselId?: string;
  placeId?: string;
  salesRepId?: string | null;
  invoicingCompanyId?: string | null;
  currency?: string;
  status?: string;
  eta?: string | null;
  etd?: string | null;
  lossReason?: string | null;
}

interface SaveItemInput {
  id?: string;
  productType: string;
  quantity: string;
  quantityMin?: string | null;
  quantityMax?: string | null;
  unit?: string;
  supplierId?: string | null;
  costPrice?: string | null;
  salesPrice?: string | null;
  paymentTerms?: string | null;
}
// ─── Generate next order number ───────────────────────────────────────

async function generateOrderNumber(tenantId: string): Promise<string> {
  // Atomically increment the sequence counter
  const [seq] = await db
    .insert(orderNumberSequences)
    .values({ tenantId, lastSeq: 1 })
    .onConflictDoUpdate({
      target: orderNumberSequences.tenantId,
      set: {
        lastSeq: sql`${orderNumberSequences.lastSeq} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ lastSeq: orderNumberSequences.lastSeq });

  const seqNum = seq.lastSeq;

  // Fetch tenant settings for template customisation
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  });
  const settings = (tenant?.settings ?? {}) as TenantSettings;
  const prefix = settings.orderNumberPrefix ?? '';
  const template = settings.orderNumberTemplate ?? '{YYYY}{MM}{DD}-{SEQ:6}';

  // Use UTC/GMT date
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');

  // Replace template tokens
  let result = template
    .replace('{PREFIX}', prefix)
    .replace('{YYYY}', yyyy)
    .replace('{MM}', mm)
    .replace('{DD}', dd);

  // Replace {SEQ:N} with zero-padded sequence
  result = result.replace(/\{SEQ:(\d+)\}/g, (_match, digits) => {
    return String(seqNum).padStart(parseInt(digits, 10), '0');
  });

  // Fallback: replace {SEQ} without padding spec → pad to 6
  result = result.replace('{SEQ}', String(seqNum).padStart(6, '0'));

  return result;
}
// ─── List Orders (paginated, filterable) ────────────────────────────

export async function listOrders(query?: ListOrdersQuery) {
  const conditions = [];

  if (query?.statuses?.length) {
    conditions.push(inArray(orders.status, query.statuses as any));
  }

  if (query?.salesRepId) {
    conditions.push(eq(orders.salesRepId, query.salesRepId));
  }

  if (query?.search) {
    // Search by client name, vessel name, port name, or order number
    const searchTerm = `%${query.search}%`;
    conditions.push(
      sql`(
        ${orders.orderNumber} ILIKE ${searchTerm}
        OR EXISTS (SELECT 1 FROM counterparties c WHERE c.id = ${orders.clientId} AND c.name ILIKE ${searchTerm})
        OR EXISTS (SELECT 1 FROM vessels v WHERE v.id = ${orders.vesselId} AND v.name ILIKE ${searchTerm})
        OR EXISTS (SELECT 1 FROM places p WHERE p.id = ${orders.placeId} AND p.name ILIKE ${searchTerm})
      )`,
    );
  }

  const where = conditions.length
    ? conditions.length === 1
      ? conditions[0]
      : and(...conditions)
    : undefined;

  const limit = query?.limit ?? 25;
  const page = query?.page ?? 1;
  const offset = (page - 1) * limit;

  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        clientName: counterparties.name,
        vesselName: vessels.name,
        placeName: places.name,
        salesRepName: users.name,
        eta: orders.eta,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
      })
      .from(orders)
      .innerJoin(counterparties, eq(orders.clientId, counterparties.id))
      .innerJoin(vessels, eq(orders.vesselId, vessels.id))
      .innerJoin(places, eq(orders.placeId, places.id))
      .leftJoin(users, eq(orders.salesRepId, users.id))
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(orders).where(where),
  ]);

  // For each row, compute total value & profit from order items
  const orderIds = rows.map((r) => r.id);
  let itemAggs: Record<string, { totalValue: number; totalProfit: number }> = {};

  if (orderIds.length > 0) {
    const aggs = await db
      .select({
        orderId: orderItems.orderId,
        totalValue: sql<number>`COALESCE(SUM((${orderItems.salesPrice}::numeric) * (${orderItems.quantity}::numeric)), 0)::float`,
        totalProfit: sql<number>`COALESCE(SUM(${orderItems.profit}::numeric), 0)::float`,
      })
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds))
      .groupBy(orderItems.orderId);

    for (const a of aggs) {
      itemAggs[a.orderId] = { totalValue: a.totalValue, totalProfit: a.totalProfit };
    }
  }

  const items = rows.map((r) => ({
    id: r.id,
    orderNumber: r.orderNumber,
    status: r.status,
    clientName: r.clientName,
    vesselName: r.vesselName,
    placeName: r.placeName,
    salesRepName: r.salesRepName,
    eta: r.eta?.toISOString() ?? null,
    totalValue: itemAggs[r.id]?.totalValue ?? 0,
    totalProfit: itemAggs[r.id]?.totalProfit ?? 0,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return { items, total: countResult[0]?.count ?? 0 };
}

// ─── Resolve order ID (UUID or order number → UUID) ────────────────

export async function resolveOrderId(idOrNumber: string): Promise<string | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrNumber);
  if (isUuid) return idOrNumber;

  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.orderNumber, idOrNumber))
    .limit(1);
  return row?.id ?? null;
}

// ─── Get Order By ID or Order Number (with all relations + items) ──────

export async function getOrderById(idOrNumber: string) {
  // Try UUID first, otherwise look up by order number
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrNumber);
  const condition = isUuid
    ? eq(orders.id, idOrNumber)
    : eq(orders.orderNumber, idOrNumber);

  const [row] = await db
    .select()
    .from(orders)
    .where(condition)
    .limit(1);

  if (!row) return null;

  // Fetch relations in parallel
  const [client, vessel, place, salesRep, invoicingCompany, items] =
    await Promise.all([
      db
        .select()
        .from(counterparties)
        .where(eq(counterparties.id, row.clientId))
        .limit(1)
        .then((r) => r[0] ?? null),
      db
        .select()
        .from(vessels)
        .where(eq(vessels.id, row.vesselId))
        .limit(1)
        .then((r) => r[0] ?? null),
      db
        .select()
        .from(places)
        .where(eq(places.id, row.placeId))
        .limit(1)
        .then((r) => r[0] ?? null),
      row.salesRepId
        ? db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(eq(users.id, row.salesRepId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
      row.invoicingCompanyId
        ? db
            .select()
            .from(counterparties)
            .where(eq(counterparties.id, row.invoicingCompanyId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
      db.select().from(orderItems).where(eq(orderItems.orderId, row.id)),
    ]);

  return {
    ...row,
    orderNumber: row.orderNumber,
    eta: row.eta?.toISOString() ?? null,
    etd: row.etd?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    client,
    vessel,
    place,
    salesRep,
    invoicingCompany,
    items: items.map((i) => ({
      id: i.id,
      orderId: i.orderId,
      supplierId: i.supplierId,
      productType: i.productType,
      quantity: i.quantity,
      quantityMin: i.quantityMin,
      quantityMax: i.quantityMax,
      unit: i.unit,
      costPrice: i.costPrice,
      salesPrice: i.salesPrice,
      profit: i.profit,
      paymentTerms: i.paymentTerms,
    })),
  };
}

// ─── Create Order ───────────────────────────────────────────────────

export async function createOrder(input: CreateOrderInput) {
  // Generate the external order number
  const orderNumber = await generateOrderNumber(input.tenantId);

  const [created] = await db
    .insert(orders)
    .values({
      tenantId: input.tenantId,
      orderNumber,
      clientId: input.clientId,
      vesselId: input.vesselId,
      placeId: input.placeId,
      salesRepId: input.salesRepId ?? null,
      invoicingCompanyId: input.invoicingCompanyId ?? null,
      currency: input.currency ?? 'USD',
      eta: input.eta ? new Date(input.eta) : null,
      etd: input.etd ? new Date(input.etd) : null,
    })
    .returning();

  return created;
}

// ─── Update Order ───────────────────────────────────────────────────

export async function updateOrder(id: string, input: UpdateOrderInput) {
  const setData: Record<string, unknown> = { updatedAt: new Date() };

  if (input.clientId !== undefined) setData.clientId = input.clientId;
  if (input.vesselId !== undefined) setData.vesselId = input.vesselId;
  if (input.placeId !== undefined) setData.placeId = input.placeId;
  if (input.salesRepId !== undefined) setData.salesRepId = input.salesRepId;
  if (input.invoicingCompanyId !== undefined) setData.invoicingCompanyId = input.invoicingCompanyId;
  if (input.currency !== undefined) setData.currency = input.currency;
  if (input.status !== undefined) setData.status = input.status;
  if (input.eta !== undefined) setData.eta = input.eta ? new Date(input.eta) : null;
  if (input.etd !== undefined) setData.etd = input.etd ? new Date(input.etd) : null;
  if (input.lossReason !== undefined) setData.lossReason = input.lossReason;

  // Auto-set closedAt when status moves to CANCELLED or PAID
  if (input.status === 'CANCELLED' || input.status === 'PAID') {
    setData.closedAt = new Date();
  }

  const [updated] = await db
    .update(orders)
    .set(setData)
    .where(eq(orders.id, id))
    .returning();

  return updated ?? null;
}

// ─── Delete Order ───────────────────────────────────────────────────

export async function deleteOrder(id: string) {
  // orderItems are cascade-deleted (ON DELETE CASCADE)
  const [deleted] = await db
    .delete(orders)
    .where(eq(orders.id, id))
    .returning({ id: orders.id });

  return deleted ?? null;
}

// ─── Save Order Items (upsert strategy) ─────────────────────────────
// Replaces all items for an order: delete existing, insert new batch.

export async function saveOrderItems(orderId: string, items: SaveItemInput[]) {
  // Delete existing items
  await db.delete(orderItems).where(eq(orderItems.orderId, orderId));

  if (items.length === 0) return [];

  // Insert new items with profit calculation
  const values = items.map((item) => {
    const cost = parseFloat(item.costPrice ?? '0') || 0;
    const sale = parseFloat(item.salesPrice ?? '0') || 0;
    const qty = parseFloat(item.quantity) || 0;
    const profit = (sale - cost) * qty;

    return {
      orderId,
      productType: item.productType as any,
      quantity: item.quantity,
      quantityMin: item.quantityMin ?? null,
      quantityMax: item.quantityMax ?? null,
      unit: item.unit ?? 'MT',
      supplierId: item.supplierId ?? null,
      costPrice: item.costPrice ?? null,
      salesPrice: item.salesPrice ?? null,
      profit: profit.toFixed(4),
      paymentTerms: item.paymentTerms as any ?? null,
    };
  });

  const inserted = await db.insert(orderItems).values(values).returning();
  return inserted;
}

// ─── Update Order Status ────────────────────────────────────────────

export async function updateOrderStatus(
  id: string,
  newStatus: string,
  userId?: string,
  lossReason?: string,
) {
  const setData: Record<string, unknown> = {
    status: newStatus,
    updatedAt: new Date(),
  };

  if (lossReason !== undefined) setData.lossReason = lossReason;

  if (newStatus === 'CANCELLED' || newStatus === 'PAID') {
    setData.closedAt = new Date();
  }

  const [updated] = await db
    .update(orders)
    .set(setData)
    .where(eq(orders.id, id))
    .returning();

  if (updated && userId) {
    await logActivity({
      userId,
      action: 'STATUS_CHANGE',
      entityType: 'order',
      entityId: id,
      metadata: { newStatus, lossReason },
    });
  }

  return updated ?? null;
}

// ─── Get Activity for an Order ──────────────────────────────────────

export async function getOrderActivity(orderId: string) {
  const { activityLogs, users: usersTable } = await import('../../db/schema');
  const { desc, eq, and } = await import('drizzle-orm');

  const logs = await db
    .select({
      id: activityLogs.id,
      userId: activityLogs.userId,
      userName: usersTable.name,
      action: activityLogs.action,
      entityType: activityLogs.entityType,
      entityId: activityLogs.entityId,
      entityName: activityLogs.entityName,
      metadata: activityLogs.metadata,
      createdAt: activityLogs.createdAt,
    })
    .from(activityLogs)
    .leftJoin(usersTable, eq(activityLogs.userId, usersTable.id))
    .where(
      and(
        eq(activityLogs.entityType, 'order'),
        eq(activityLogs.entityId, orderId),
      ),
    )
    .orderBy(desc(activityLogs.createdAt))
    .limit(50);

  return logs.map((l) => ({
    id: l.id,
    userId: l.userId,
    userName: l.userName,
    action: l.action,
    entityType: l.entityType,
    entityId: l.entityId,
    entityName: l.entityName,
    metadata: l.metadata,
    createdAt: l.createdAt.toISOString(),
  }));
}
