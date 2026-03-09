// ═══════════════════════════════════════════════════════════════════════
//  Orders Service — CRUD for orders (inquiries + confirmed orders)
//
//  An "inquiry" is simply an order with status INQUIRY or OFFER.
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, desc, asc, sql, ilike, inArray, or } from 'drizzle-orm';
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
  companyContacts,
} from '../../db/schema';
import type { TenantSettings } from '../../db/schema';
import { logActivity } from '../activity/activity.service';
import {
  calculateGrossProfitBase,
  calculateOrderEconomics,
  getFinancingRateAnnual,
} from './order-financing';
import { getFxRate } from '../prices/price.service';

// ─── Types ──────────────────────────────────────────────────────────

interface ListOrdersQuery {
  search?: string;
  statuses?: string[];     // filter by status(es), e.g. ['INQUIRY','OFFER'] for inquiries
  salesRepId?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
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
  bankAccountId?: string | null;
  currency?: string;
  eta?: string | null;
  etd?: string | null;
  customerPaymentTermType?: 'CREDIT' | 'COD' | 'PREPAY' | null;
  customerCreditDays?: number | null;
  customerNote?: string | null;
  customerContactId?: string | null;
  supplierId?: string | null;
  supplierPaymentTermType?: 'CREDIT' | 'COD' | 'PREPAY' | null;
  supplierCreditDays?: number | null;
  supplierNote?: string | null;
  supplierContactId?: string | null;
  termsAndConditions?: string | null;
}

interface UpdateOrderInput {
  clientId?: string;
  vesselId?: string;
  placeId?: string;
  salesRepId?: string | null;
  invoicingCompanyId?: string | null;
  bankAccountId?: string | null;
  currency?: string;
  status?: string;
  eta?: string | null;
  etd?: string | null;
  deliveredAt?: string | null;
  customerPaymentTermType?: 'CREDIT' | 'COD' | 'PREPAY' | null;
  customerCreditDays?: number | null;
  customerNote?: string | null;
  customerContactId?: string | null;
  supplierId?: string | null;
  supplierPaymentTermType?: 'CREDIT' | 'COD' | 'PREPAY' | null;
  supplierCreditDays?: number | null;
  supplierNote?: string | null;
  supplierContactId?: string | null;
  termsAndConditions?: string | null;
  lossReason?: string | null;
}

interface SaveItemInput {
  id?: string;
  productType: string;
  quantity: string;
  quantityMin?: string | null;
  quantityMax?: string | null;
  unit?: string;
  salesUnit?: string;
  description?: string | null;
  costPrice?: string | null;
  costCurrency?: string | null;
  salesPrice?: string | null;
  salesCurrency?: string | null;
  paymentTerms?: string | null;
  customerNote?: string | null;
  deliveredQuantity?: string | null;
}

async function getTenantFinancingRateByIds(tenantIds: string[]): Promise<Map<string, number>> {
  if (!tenantIds.length) return new Map();

  const rows = await db
    .select({ id: tenants.id, settings: tenants.settings })
    .from(tenants)
    .where(inArray(tenants.id, tenantIds));

  return new Map(
    rows.map((row) => [row.id, getFinancingRateAnnual((row.settings ?? {}) as TenantSettings)]),
  );
}

function isMissingCompanyRegistrationNumberColumnError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('company_registration_number');
}

const counterpartyLegacySelect = {
  id: counterparties.id,
  tenantId: counterparties.tenantId,
  name: counterparties.name,
  type: counterparties.type,
  types: counterparties.types,
  creditLimit: counterparties.creditLimit,
  creditUsed: counterparties.creditUsed,
  country: counterparties.country,
  isOwnCompany: counterparties.isOwnCompany,
  seasearcherId: counterparties.seasearcherId,
  companyImo: counterparties.companyImo,
  countryIso: counterparties.countryIso,
  yearFormed: counterparties.yearFormed,
  companyRoles: counterparties.companyRoles,
  fleetSize: counterparties.fleetSize,
  headOfficeAddress: counterparties.headOfficeAddress,
  headOfficePhone: counterparties.headOfficePhone,
  headOfficeEmail: counterparties.headOfficeEmail,
  website: counterparties.website,
  isSanctioned: counterparties.isSanctioned,
  lastSynced: counterparties.lastSynced,
  manualOverrides: counterparties.manualOverrides,
  responsibleUserId: counterparties.responsibleUserId,
  logoUrl: counterparties.logoUrl,
  brandColor: counterparties.brandColor,
  vatNumber: counterparties.vatNumber,
  fraudPreventionText: counterparties.fraudPreventionText,
  customerTerms: counterparties.customerTerms,
  supplierTerms: counterparties.supplierTerms,
  latePaymentInterest: counterparties.latePaymentInterest,
  createdAt: counterparties.createdAt,
  updatedAt: counterparties.updatedAt,
};

async function getCounterpartyById(counterpartyId: string | null | undefined) {
  if (!counterpartyId) return null;

  try {
    const [row] = await db
      .select()
      .from(counterparties)
      .where(eq(counterparties.id, counterpartyId))
      .limit(1);
    return row ?? null;
  } catch (err) {
    if (!isMissingCompanyRegistrationNumberColumnError(err)) throw err;

    const [legacyRow] = await db
      .select(counterpartyLegacySelect)
      .from(counterparties)
      .where(eq(counterparties.id, counterpartyId))
      .limit(1);

    return legacyRow ? { ...legacyRow, companyRegistrationNumber: null } : null;
  }
}

function normalizeOrderNumberTemplate(template: string): string {
  const trimmed = template.trim();
  if (!trimmed) return '{YYYY}{MM}{DD}-{SEQ:6}';

  const hasSeqToken = /\{SEQ(?::\d+)?\}/.test(trimmed);
  if (hasSeqToken) return trimmed;

  return `${trimmed}-{SEQ:6}`;
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
  const template = normalizeOrderNumberTemplate(
    settings.orderNumberTemplate ?? '{YYYY}{MM}{DD}-{SEQ:6}',
  );

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

  // Sortable columns
  const sortMap: Record<string, any> = {
    orderNumber: orders.orderNumber,
    client: counterparties.name,
    vessel: vessels.name,
    port: places.name,
    status: orders.status,
    responsible: users.name,
    eta: orders.eta,
    createdAt: orders.createdAt,
  };
  const sortCol = sortMap[query?.sortBy ?? ''] ?? orders.createdAt;
  const defaultDir = query?.sortBy ? 'asc' : 'desc';
  const sortFn = (query?.sortDir ?? defaultDir) === 'desc' ? desc : asc;

  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: orders.id,
        tenantId: orders.tenantId,
        orderNumber: orders.orderNumber,
        status: orders.status,
        clientName: counterparties.name,
        vesselName: vessels.name,
        placeName: places.name,
        salesRepName: users.name,
        customerPaymentTermType: orders.customerPaymentTermType,
        customerCreditDays: orders.customerCreditDays,
        supplierPaymentTermType: orders.supplierPaymentTermType,
        supplierCreditDays: orders.supplierCreditDays,
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
      .orderBy(sortFn(sortCol))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(orders).where(where),
  ]);

  // For each row, compute total value & profit from order items
  const orderIds = rows.map((r) => r.id);
  let itemAggs: Record<string, {
    totalValue: number;
    totalProfit: number;
    totalFinancingCost: number;
    totalNetProfit: number;
    netMarginPct: number | null;
    displayCurrency: string;
  }> = {};

  if (orderIds.length > 0) {
    const [itemRows, financingRateByTenant] = await Promise.all([
      db
        .select({
          orderId: orderItems.orderId,
          quantity: orderItems.quantity,
          costPrice: orderItems.costPrice,
          costCurrency: orderItems.costCurrency,
          salesPrice: orderItems.salesPrice,
          salesCurrency: orderItems.salesCurrency,
        })
        .from(orderItems)
        .where(inArray(orderItems.orderId, orderIds)),
      getTenantFinancingRateByIds(Array.from(new Set(rows.map((row) => row.tenantId)))),
    ]);

    const itemsByOrder = new Map<string, typeof itemRows>();
    for (const item of itemRows) {
      const current = itemsByOrder.get(item.orderId) ?? [];
      current.push(item);
      itemsByOrder.set(item.orderId, current);
    }

    for (const row of rows) {
      const orderItemList = itemsByOrder.get(row.id) ?? [];
      const economics = calculateOrderEconomics(
        {
          customerPaymentTermType: row.customerPaymentTermType,
          customerCreditDays: row.customerCreditDays,
          supplierPaymentTermType: row.supplierPaymentTermType,
          supplierCreditDays: row.supplierCreditDays,
        },
        orderItemList,
        financingRateByTenant.get(row.tenantId) ?? getFinancingRateAnnual(),
      );

      // Determine display currency: uniform across all items → that currency, else USD
      let displayCurrency = 'USD';
      if (orderItemList.length > 0) {
        const first = (orderItemList[0]!.costCurrency ?? 'USD').toUpperCase();
        const allSame = orderItemList.every(
          (item) =>
            (item.costCurrency ?? 'USD').toUpperCase() === first &&
            (item.salesCurrency ?? 'USD').toUpperCase() === first,
        );
        if (allSame) displayCurrency = first;
      }

      // When display currency is not USD, convert totals from USD to that currency
      let fxDiv = 1;
      if (displayCurrency !== 'USD') {
        const rate = getFxRate(displayCurrency);
        if (rate > 0) fxDiv = rate;
      }

      itemAggs[row.id] = {
        totalValue: economics.totalRevenueBase / fxDiv,
        totalProfit: economics.totalGrossProfit / fxDiv,
        totalFinancingCost: economics.totalFinancingCost / fxDiv,
        totalNetProfit: economics.totalNetProfit / fxDiv,
        netMarginPct: economics.netMarginPct,
        displayCurrency,
      };
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
    totalFinancingCost: itemAggs[r.id]?.totalFinancingCost ?? 0,
    totalNetProfit: itemAggs[r.id]?.totalNetProfit ?? 0,
    netMarginPct: itemAggs[r.id]?.netMarginPct ?? null,
    displayCurrency: itemAggs[r.id]?.displayCurrency ?? 'USD',
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
  const [client, vessel, place, salesRep, invoicingCompany, items, customerContact, supplierContact, tenant] =
    await Promise.all([
      getCounterpartyById(row.clientId),
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
        ? getCounterpartyById(row.invoicingCompanyId)
        : Promise.resolve(null),
      db.select().from(orderItems).where(eq(orderItems.orderId, row.id)),
      row.customerContactId
        ? db
            .select()
            .from(companyContacts)
            .where(eq(companyContacts.id, row.customerContactId))
            .limit(1)
            .then((r) => r[0] ? { ...r[0], createdAt: r[0].createdAt.toISOString(), updatedAt: r[0].updatedAt.toISOString() } : null)
        : Promise.resolve(null),
      row.supplierContactId
        ? db
            .select()
            .from(companyContacts)
            .where(eq(companyContacts.id, row.supplierContactId))
            .limit(1)
            .then((r) => r[0] ? { ...r[0], createdAt: r[0].createdAt.toISOString(), updatedAt: r[0].updatedAt.toISOString() } : null)
        : Promise.resolve(null),
      db.query.tenants.findFirst({
        where: eq(tenants.id, row.tenantId),
        columns: { settings: true },
      }),
    ]);

  const financingRateAnnual = getFinancingRateAnnual((tenant?.settings ?? {}) as TenantSettings);
  const orderEconomics = calculateOrderEconomics(
    {
      customerPaymentTermType: row.customerPaymentTermType,
      customerCreditDays: row.customerCreditDays,
      supplierPaymentTermType: row.supplierPaymentTermType,
      supplierCreditDays: row.supplierCreditDays,
    },
    items,
    financingRateAnnual,
  );

  return {
    ...row,
    orderNumber: row.orderNumber,
    eta: row.eta?.toISOString() ?? null,
    etd: row.etd?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    customerPaymentTermType: row.customerPaymentTermType ?? null,
    customerCreditDays: row.customerCreditDays ?? null,
    customerNote: row.customerNote ?? null,
    customerContactId: row.customerContactId ?? null,
    supplierId: row.supplierId ?? null,
    supplierPaymentTermType: row.supplierPaymentTermType ?? null,
    supplierCreditDays: row.supplierCreditDays ?? null,
    supplierNote: row.supplierNote ?? null,
    supplierContactId: row.supplierContactId ?? null,
    termsAndConditions: row.termsAndConditions ?? null,
    financingRateAnnual,
    financingDayCountConvention: orderEconomics.dayCountConvention,
    financingDays: orderEconomics.financingDays,
    totalFinancingCost: orderEconomics.totalFinancingCost.toFixed(4),
    financingCostPerMt: orderEconomics.financingCostPerMt != null ? orderEconomics.financingCostPerMt.toFixed(4) : null,
    totalNetProfit: orderEconomics.totalNetProfit.toFixed(4),
    netMarginPct: orderEconomics.netMarginPct != null ? orderEconomics.netMarginPct.toFixed(4) : null,
    client,
    vessel,
    place,
    salesRep,
    invoicingCompany,
    customerContact,
    supplierContact,
    items: items.map((i, index) => ({
      id: i.id,
      orderId: i.orderId,
      productType: i.productType,
      quantity: i.quantity,
      quantityMin: i.quantityMin,
      quantityMax: i.quantityMax,
      unit: i.unit,
      salesUnit: i.salesUnit ?? i.unit,
      description: i.description ?? null,
      costPrice: i.costPrice,
      costCurrency: i.costCurrency,
      salesPrice: i.salesPrice,
      salesCurrency: i.salesCurrency,
      profit: i.profit,
      financingCost: orderEconomics.lineEconomics[index] ? orderEconomics.lineEconomics[index]!.financingCost.toFixed(4) : null,
      netProfit: orderEconomics.lineEconomics[index] ? orderEconomics.lineEconomics[index]!.netProfit.toFixed(4) : null,
      paymentTerms: i.paymentTerms,
      customerNote: i.customerNote,
      deliveredQuantity: i.deliveredQuantity,
    })),
  };
}

// ─── Create Order ───────────────────────────────────────────────────

export async function createOrder(input: CreateOrderInput) {
  // Generate the external order number
  const orderNumber = await generateOrderNumber(input.tenantId);

  const values: typeof orders.$inferInsert = {
    tenantId: input.tenantId,
    orderNumber,
    clientId: input.clientId,
    vesselId: input.vesselId,
    placeId: input.placeId,
    salesRepId: input.salesRepId ?? null,
    invoicingCompanyId: input.invoicingCompanyId ?? null,
    bankAccountId: input.bankAccountId ?? null,
    currency: input.currency ?? 'USD',
    eta: input.eta ? new Date(input.eta) : null,
    etd: input.etd ? new Date(input.etd) : null,
    customerPaymentTermType: input.customerPaymentTermType ?? null,
    customerCreditDays: input.customerCreditDays ?? null,
    customerNote: input.customerNote ?? null,
    customerContactId: input.customerContactId ?? null,
    supplierId: input.supplierId ?? null,
    supplierPaymentTermType: input.supplierPaymentTermType ?? null,
    supplierCreditDays: input.supplierCreditDays ?? null,
    supplierNote: input.supplierNote ?? null,
    supplierContactId: input.supplierContactId ?? null,
    termsAndConditions: input.termsAndConditions ?? null,
  };

  const [created] = await db
    .insert(orders)
    .values(values)
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
  if (input.bankAccountId !== undefined) setData.bankAccountId = input.bankAccountId;
  if (input.currency !== undefined) setData.currency = input.currency;
  if (input.status !== undefined) setData.status = input.status;
  if (input.eta !== undefined) setData.eta = input.eta ? new Date(input.eta) : null;
  if (input.etd !== undefined) setData.etd = input.etd ? new Date(input.etd) : null;
  if (input.deliveredAt !== undefined) setData.deliveredAt = input.deliveredAt ? new Date(input.deliveredAt) : null;
  if (input.customerPaymentTermType !== undefined) {
    setData.customerPaymentTermType = input.customerPaymentTermType;
  }
  if (input.customerCreditDays !== undefined) {
    setData.customerCreditDays = input.customerCreditDays;
  }
  if (input.customerNote !== undefined) setData.customerNote = input.customerNote;
  if (input.customerContactId !== undefined) setData.customerContactId = input.customerContactId;
  if (input.supplierId !== undefined) setData.supplierId = input.supplierId;
  if (input.supplierPaymentTermType !== undefined) {
    setData.supplierPaymentTermType = input.supplierPaymentTermType;
  }
  if (input.supplierCreditDays !== undefined) {
    setData.supplierCreditDays = input.supplierCreditDays;
  }
  if (input.supplierNote !== undefined) setData.supplierNote = input.supplierNote;
  if (input.supplierContactId !== undefined) setData.supplierContactId = input.supplierContactId;
  if (input.termsAndConditions !== undefined) setData.termsAndConditions = input.termsAndConditions;
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
    const costCurrency = (item.costCurrency ?? orderCurrency).toUpperCase();
    const salesCurrency = (item.salesCurrency ?? orderCurrency).toUpperCase();
    const profit = calculateGrossProfitBase({
      quantity: item.quantity,
      costPrice: item.costPrice,
      costCurrency,
      salesPrice: item.salesPrice,
      salesCurrency,
    });

    return {
      orderId,
      productType: item.productType as any,
      quantity: item.quantity,
      quantityMin: item.quantityMin ?? null,
      quantityMax: item.quantityMax ?? null,
      unit: item.unit ?? 'MT',
      salesUnit: item.salesUnit ?? item.unit ?? 'MT',
      description: item.description ?? null,
      costPrice: item.costPrice ?? null,
      costCurrency,
      salesPrice: item.salesPrice ?? null,
      salesCurrency,
      profit: profit.toFixed(4),
      paymentTerms: item.paymentTerms as any ?? null,
      customerNote: item.customerNote ?? null,
      deliveredQuantity: item.deliveredQuantity ?? null,
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
