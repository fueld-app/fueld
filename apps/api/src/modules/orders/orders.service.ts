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
  orderAttachments,
  counterparties,
  vessels,
  places,
  users,
  orderNumberSequences,
  tenants,
  customerPayments,
  invoices,
} from '../../db/schema';
import type { TenantSettings } from '../../db/schema';
import { logActivity } from '../activity/activity.service';
import { getFxRate } from '../prices/price.service';

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
  customerPaymentTermType?: string | null;
  customerCreditDays?: number | null;
  customerNote?: string | null;
  supplierId?: string | null;
  supplierPaymentTermType?: string | null;
  supplierCreditDays?: number | null;
  supplierNote?: string | null;
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
  customerPaymentTermType?: string | null;
  customerCreditDays?: number | null;
  customerNote?: string | null;
  supplierId?: string | null;
  supplierPaymentTermType?: string | null;
  supplierCreditDays?: number | null;
  supplierNote?: string | null;
  lossReason?: string | null;
}

interface SaveItemInput {
  id?: string;
  productType: string;
  quantity: string;
  quantityMin?: string | null;
  quantityMax?: string | null;
  unit?: string;
  costPrice?: string | null;
  costCurrency?: string | null;
  salesPrice?: string | null;
  salesCurrency?: string | null;
  paymentTerms?: string | null;
  customerNote?: string | null;
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
    customerPaymentTermType: row.customerPaymentTermType ?? null,
    customerCreditDays: row.customerCreditDays ?? null,
    customerNote: row.customerNote ?? null,
    supplierId: row.supplierId ?? null,
    supplierPaymentTermType: row.supplierPaymentTermType ?? null,
    supplierCreditDays: row.supplierCreditDays ?? null,
    supplierNote: row.supplierNote ?? null,
    client,
    vessel,
    place,
    salesRep,
    invoicingCompany,
    items: items.map((i) => ({
      id: i.id,
      orderId: i.orderId,
      productType: i.productType,
      quantity: i.quantity,
      quantityMin: i.quantityMin,
      quantityMax: i.quantityMax,
      unit: i.unit,
      costPrice: i.costPrice,
      costCurrency: i.costCurrency,
      salesPrice: i.salesPrice,
      salesCurrency: i.salesCurrency,
      profit: i.profit,
      paymentTerms: i.paymentTerms,
      customerNote: i.customerNote,
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
      customerPaymentTermType: input.customerPaymentTermType ?? null,
      customerCreditDays: input.customerCreditDays ?? null,
      customerNote: input.customerNote ?? null,
      supplierId: input.supplierId ?? null,
      supplierPaymentTermType: input.supplierPaymentTermType ?? null,
      supplierCreditDays: input.supplierCreditDays ?? null,
      supplierNote: input.supplierNote ?? null,
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
  if (input.customerPaymentTermType !== undefined) {
    setData.customerPaymentTermType = input.customerPaymentTermType;
  }
  if (input.customerCreditDays !== undefined) {
    setData.customerCreditDays = input.customerCreditDays;
  }
  if (input.customerNote !== undefined) setData.customerNote = input.customerNote;
  if (input.supplierId !== undefined) setData.supplierId = input.supplierId;
  if (input.supplierPaymentTermType !== undefined) {
    setData.supplierPaymentTermType = input.supplierPaymentTermType;
  }
  if (input.supplierCreditDays !== undefined) {
    setData.supplierCreditDays = input.supplierCreditDays;
  }
  if (input.supplierNote !== undefined) setData.supplierNote = input.supplierNote;
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

  // Look up order currency for defaults
  const [orderRow] = await db
    .select({ currency: orders.currency })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  const orderCurrency = orderRow?.currency ?? 'USD';

  // Insert new items with profit calculation (base currency)
  const values = items.map((item) => {
    const cost = parseFloat(item.costPrice ?? '0') || 0;
    const sale = parseFloat(item.salesPrice ?? '0') || 0;
    const qty = parseFloat(item.quantity) || 0;

    const costCurrency = (item.costCurrency ?? orderCurrency).toUpperCase();
    const salesCurrency = (item.salesCurrency ?? orderCurrency).toUpperCase();
    const costRate = getFxRate(costCurrency);
    const salesRate = getFxRate(salesCurrency);
    const profit = (sale * salesRate - cost * costRate) * qty;

    return {
      orderId,
      productType: item.productType as any,
      quantity: item.quantity,
      quantityMin: item.quantityMin ?? null,
      quantityMax: item.quantityMax ?? null,
      unit: item.unit ?? 'MT',
      costPrice: item.costPrice ?? null,
      costCurrency,
      salesPrice: item.salesPrice ?? null,
      salesCurrency,
      profit: profit.toFixed(4),
      paymentTerms: item.paymentTerms as any ?? null,
      customerNote: item.customerNote ?? null,
    };
  });

  const inserted = await db.insert(orderItems).values(values).returning();
  return inserted;
}

// ─── Order Attachments ─────────────────────────────────────────────

export async function listOrderAttachments(orderId: string) {
  const rows = await db
    .select()
    .from(orderAttachments)
    .where(eq(orderAttachments.orderId, orderId));

  return rows.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    type: row.type,
    fileName: row.fileName,
    filePath: row.filePath,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function createOrderAttachment(input: {
  orderId: string;
  type: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  fileSize: number;
  uploadedBy?: string | null;
}) {
  const [created] = await db
    .insert(orderAttachments)
    .values({
      orderId: input.orderId,
      type: input.type as any,
      fileName: input.fileName,
      filePath: input.filePath,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      uploadedBy: input.uploadedBy ?? null,
    })
    .returning();

  return created ?? null;
}

// ─── Customer Payments (ledger) ───────────────────────────────────

function mapPaymentRow(row: typeof customerPayments.$inferSelect) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    orderId: row.orderId,
    invoiceId: row.invoiceId,
    amount: String(row.amount),
    currency: row.currency,
    receivedAt: row.receivedAt.toISOString(),
    method: row.method ?? null,
    note: row.note ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listOrderPayments(orderId: string) {
  const rows = await db
    .select()
    .from(customerPayments)
    .where(eq(customerPayments.orderId, orderId))
    .orderBy(desc(customerPayments.receivedAt));

  return rows.map(mapPaymentRow);
}

async function updateInvoiceAmountPaid(orderId: string): Promise<void> {
  const [{ total }] = await db
    .select({ total: sql<number>`COALESCE(SUM(${customerPayments.amount}), 0)::float` })
    .from(customerPayments)
    .where(eq(customerPayments.orderId, orderId));

  await db
    .update(invoices)
    .set({ amountPaid: total.toFixed(2), updatedAt: new Date() })
    .where(eq(invoices.orderId, orderId));
}

export async function createOrderPayment(orderId: string, input: {
  amount: string;
  currency: string;
  receivedAt?: string | null;
  method?: string | null;
  note?: string | null;
  createdBy?: string | null;
}) {
  const [orderRow] = await db
    .select({ tenantId: orders.tenantId, clientId: orders.clientId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!orderRow) return null;

  const [invoice] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.orderId, orderId))
    .orderBy(desc(invoices.createdAt))
    .limit(1);

  const [created] = await db
    .insert(customerPayments)
    .values({
      tenantId: orderRow.tenantId,
      customerId: orderRow.clientId,
      orderId,
      invoiceId: invoice?.id ?? null,
      amount: input.amount,
      currency: input.currency || 'USD',
      receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
      method: input.method ?? null,
      note: input.note ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();

  if (invoice?.id) {
    await updateInvoiceAmountPaid(orderId);
  }

  return created ? mapPaymentRow(created) : null;
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
