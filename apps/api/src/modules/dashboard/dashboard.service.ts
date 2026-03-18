import { eq, and, lt, sql, inArray, ne, notInArray, isNotNull, gte, lte, or, asc } from 'drizzle-orm';
import { db } from '../../db';
import {
  invoices,
  orders,
  orderItems,
  users,
  counterparties,
  vessels,
  places,
  tenants,
  entityComments,
} from '../../db/schema';
import type { TenantSettings } from '../../db/schema';
import { calculateOrderEconomics, calculateRevenueBase, getFinancingRateAnnual } from '../orders/order-financing';

// ═══════════════════════════════════════════════════════════════════════
//  Dashboard Service — Smart Aggregations
// ═══════════════════════════════════════════════════════════════════════

// ─── Collections (overdue invoices) ──────────────────────────────────

export interface OverdueInvoice {
  invoiceId: string;
  invoiceNumber: string;
  orderId: string;
  clientName: string;
  vesselName: string;
  amount: string | null;
  amountPaid: string | null;
  dueDate: string;
  daysOverdue: number;
  status: string;
}

/**
 * Returns all invoices that are past their due date and not fully paid.
 * Ordered by most overdue first.
 */
export async function getCollections(
  tenantId: string,
  from?: string,
  to?: string,
): Promise<OverdueInvoice[]> {
  const today = new Date().toISOString().split('T')[0]!;
  const conditions = [
    eq(orders.tenantId, tenantId),
    lt(invoices.dueDate, today),
    ne(invoices.status, 'PAID'),
    ne(invoices.status, 'VOID'),
  ];
  if (from) conditions.push(gte(invoices.dueDate, from));
  if (to) conditions.push(lte(invoices.dueDate, to));

  const results = await db
    .select({
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      orderId: invoices.orderId,
      clientName: counterparties.name,
      vesselName: vessels.name,
      amount: invoices.amount,
      amountPaid: invoices.amountPaid,
      dueDate: invoices.dueDate,
      status: invoices.status,
    })
    .from(invoices)
    .innerJoin(orders, eq(invoices.orderId, orders.id))
    .innerJoin(counterparties, eq(orders.clientId, counterparties.id))
    .innerJoin(vessels, eq(orders.vesselId, vessels.id))
    .where(and(...conditions))
    .orderBy(invoices.dueDate);

  return results.map((r) => {
    const dueDateMs = new Date(r.dueDate).getTime();
    const todayMs = new Date(today).getTime();
    const daysOverdue = Math.max(0, Math.floor((todayMs - dueDateMs) / 86_400_000));

    return {
      invoiceId: r.invoiceId,
      invoiceNumber: r.invoiceNumber,
      orderId: r.orderId,
      clientName: r.clientName,
      vesselName: r.vesselName,
      amount: r.amount,
      amountPaid: r.amountPaid,
      dueDate: r.dueDate,
      daysOverdue,
      status: r.status,
    };
  });
}

// ─── Team Stats (Profit & Volume by Trader) ──────────────────────────

export interface TraderStat {
  traderId: string;
  traderName: string;
  traderEmail: string;
  orderCount: number;
  totalVolume: string;
  totalRevenue: string;
  totalCost: string;
  totalProfit: string;
  totalFinancingCost: string;
  totalNetProfit: string;
}

/**
 * Returns profit / volume grouped by trader (sales rep) for a tenant.
 *
 * **Vacation Logic:** If the requesting user has a `delegate_id`,
 * we include the delegated user's stats alongside their own.
 */
export async function getTeamStats(
  tenantId: string,
  requestingUserId: string,
  from?: string,
  to?: string,
): Promise<TraderStat[]> {
  // 1. Find which trader IDs the requesting user can see
  const visibleTraderIds = await resolveVisibleTraderIds(tenantId, requestingUserId);

  if (visibleTraderIds.length === 0) {
    return [];
  }

  // 2. Aggregate order items grouped by sales rep
  const fromDate = from ? new Date(`${from}T00:00:00`) : null;
  const toDate = to ? new Date(`${to}T23:59:59`) : null;
  const revenueExcludedStatuses: (typeof orders.status.enumValues)[number][] = ['INQUIRY', 'CANCELLED'];
  const baseConditions = [
    eq(orders.tenantId, tenantId),
    isNotNull(orders.salesRepId),
    inArray(orders.salesRepId, visibleTraderIds),
    notInArray(orders.status, revenueExcludedStatuses),
  ];
  if (fromDate) baseConditions.push(gte(orders.createdAt, fromDate));
  if (toDate) baseConditions.push(lte(orders.createdAt, toDate));

  const orderRows = await db
    .select({
      orderId: orders.id,
      traderId: orders.salesRepId,
      traderName: users.name,
      traderEmail: users.email,
      customerPaymentTermType: orders.customerPaymentTermType,
      customerCreditDays: orders.customerCreditDays,
      supplierPaymentTermType: orders.supplierPaymentTermType,
      supplierCreditDays: orders.supplierCreditDays,
    })
    .from(orders)
    .innerJoin(users, eq(orders.salesRepId, users.id))
    .where(and(...baseConditions));

  if (orderRows.length === 0) {
    return [];
  }

  const [itemRows, tenant] = await Promise.all([
    db
      .select({
        orderId: orderItems.orderId,
        quantity: orderItems.quantity,
        costPrice: orderItems.costPrice,
        costCurrency: orderItems.costCurrency,
        costConversionFactor: orderItems.costConversionFactor,
        salesPrice: orderItems.salesPrice,
        salesCurrency: orderItems.salesCurrency,
        unitConversionFactor: orderItems.unitConversionFactor,
      })
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderRows.map((row) => row.orderId))),
    db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { settings: true },
    }),
  ]);

  const financingRateAnnual = getFinancingRateAnnual((tenant?.settings ?? {}) as TenantSettings);
  const itemsByOrder = new Map<string, typeof itemRows>();
  for (const item of itemRows) {
    const current = itemsByOrder.get(item.orderId) ?? [];
    current.push(item);
    itemsByOrder.set(item.orderId, current);
  }

  const stats = new Map<string, {
    traderId: string;
    traderName: string;
    traderEmail: string;
    orderCount: number;
    totalVolume: number;
    totalRevenue: number;
    totalCost: number;
    totalProfit: number;
    totalFinancingCost: number;
    totalNetProfit: number;
  }>();

  for (const row of orderRows) {
    const economics = calculateOrderEconomics(
      {
        customerPaymentTermType: row.customerPaymentTermType,
        customerCreditDays: row.customerCreditDays,
        supplierPaymentTermType: row.supplierPaymentTermType,
        supplierCreditDays: row.supplierCreditDays,
      },
      itemsByOrder.get(row.orderId) ?? [],
      financingRateAnnual,
    );

    const current = stats.get(row.traderId!) ?? {
      traderId: row.traderId!,
      traderName: row.traderName,
      traderEmail: row.traderEmail,
      orderCount: 0,
      totalVolume: 0,
      totalRevenue: 0,
      totalCost: 0,
      totalProfit: 0,
      totalFinancingCost: 0,
      totalNetProfit: 0,
    };

    current.orderCount += 1;
    current.totalVolume += economics.totalQuantity;
    current.totalRevenue += economics.totalRevenueBase;
    current.totalCost += economics.totalCostBase;
    current.totalProfit += economics.totalGrossProfit;
    current.totalFinancingCost += economics.totalFinancingCost;
    current.totalNetProfit += economics.totalNetProfit;
    stats.set(current.traderId, current);
  }

  return Array.from(stats.values()).map((s) => ({
    traderId: s.traderId,
    traderName: s.traderName,
    traderEmail: s.traderEmail,
    orderCount: s.orderCount,
    totalVolume: s.totalVolume.toFixed(3),
    totalRevenue: s.totalRevenue.toFixed(2),
    totalCost: s.totalCost.toFixed(2),
    totalProfit: s.totalProfit.toFixed(2),
    totalFinancingCost: s.totalFinancingCost.toFixed(2),
    totalNetProfit: s.totalNetProfit.toFixed(2),
  }));
}

// ─── Pipeline Summary ────────────────────────────────────────────────

export interface PipelineSummary {
  status: string;
  count: number;
  totalValue: string;
}

/**
 * Returns count + total revenue (USD-normalized) grouped by order status.
 *
 * Uses the same `calculateRevenueBase()` logic as the KPI cards so that
 * pipeline values include FX conversion and unit conversion factors.
 */
export async function getPipelineSummary(
  tenantId: string,
  from?: string,
  to?: string,
  userId?: string,
): Promise<PipelineSummary[]> {
  const conditions = [eq(orders.tenantId, tenantId)];
  if (from) conditions.push(gte(orders.createdAt, new Date(`${from}T00:00:00`)));
  if (to) conditions.push(lte(orders.createdAt, new Date(`${to}T23:59:59`)));
  if (userId) conditions.push(eq(orders.salesRepId, userId));

  const orderRows = await db
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(and(...conditions));

  if (orderRows.length === 0) return [];

  const itemRows = await db
    .select({
      orderId: orderItems.orderId,
      quantity: orderItems.quantity,
      salesPrice: orderItems.salesPrice,
      salesCurrency: orderItems.salesCurrency,
      unitConversionFactor: orderItems.unitConversionFactor,
    })
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderRows.map((r) => r.id)));

  const itemsByOrder = new Map<string, typeof itemRows>();
  for (const item of itemRows) {
    const arr = itemsByOrder.get(item.orderId) ?? [];
    arr.push(item);
    itemsByOrder.set(item.orderId, arr);
  }

  const stats = new Map<string, { count: number; totalValue: number }>();
  for (const row of orderRows) {
    const entry = stats.get(row.status) ?? { count: 0, totalValue: 0 };
    entry.count += 1;
    for (const item of itemsByOrder.get(row.id) ?? []) {
      entry.totalValue += calculateRevenueBase(item);
    }
    stats.set(row.status, entry);
  }

  return Array.from(stats.entries()).map(([status, s]) => ({
    status,
    count: s.count,
    totalValue: s.totalValue.toFixed(2),
  }));
}

// ─── Loss Analysis (cancel‑reason breakdown) ─────────────────────────

export interface LossReason {
  reason: string;
  count: number;
  percentage: number;
}

/**
 * Aggregates cancelled orders by their loss reason.
 */
export async function getLossAnalysis(
  tenantId: string,
  from?: string,
  to?: string,
  userId?: string,
): Promise<{ reasons: LossReason[]; totalCancelled: number }> {
  const conditions = [
    eq(orders.tenantId, tenantId),
    eq(orders.status, 'CANCELLED'),
    isNotNull(orders.lossReason),
  ];
  if (from) conditions.push(gte(orders.createdAt, new Date(`${from}T00:00:00`)));
  if (to) conditions.push(lte(orders.createdAt, new Date(`${to}T23:59:59`)));
  if (userId) conditions.push(eq(orders.salesRepId, userId));

  const results = await db
    .select({
      reason: orders.lossReason,
      count: sql<number>`count(*)`.as('count'),
    })
    .from(orders)
    .where(and(...conditions))
    .groupBy(orders.lossReason)
    .orderBy(sql`count(*) desc`);

  const totalCancelled = results.reduce((sum, r) => sum + Number(r.count), 0);

  return {
    reasons: results.map((r) => ({
      reason: r.reason!,
      count: Number(r.count),
      percentage: totalCancelled > 0 ? Number(r.count) / totalCancelled : 0,
    })),
    totalCancelled,
  };
}

// ─── Conversion Metrics ──────────────────────────────────────────────

export interface ConversionMetrics {
  totalInquiries: number;
  totalWon: number;
  totalLost: number;
  winRate: number;
  avgDaysToClose: number | null;
}

/**
 * Calculates win rate and average time-to-close for Orders created in the period.
 *
 * "Won" = reached CONFIRMED, DELIVERED, INVOICED, or PAID.
 * "Lost" = CANCELLED.
 */
export async function getConversionMetrics(
  tenantId: string,
  from?: string,
  to?: string,
  userId?: string,
): Promise<ConversionMetrics> {
  const conditions = [eq(orders.tenantId, tenantId)];
  if (from) conditions.push(gte(orders.createdAt, new Date(`${from}T00:00:00`)));
  if (to) conditions.push(lte(orders.createdAt, new Date(`${to}T23:59:59`)));
  if (userId) conditions.push(eq(orders.salesRepId, userId));

  const wonStatuses = ['CONFIRMED', 'DELIVERED', 'INVOICED', 'PAID'];

  const rows = await db
    .select({
      status: orders.status,
      createdAt: orders.createdAt,
      closedAt: orders.closedAt,
    })
    .from(orders)
    .where(and(...conditions));

  let totalInquiries = rows.length;
  let totalWon = 0;
  let totalLost = 0;
  let closeDaysSum = 0;
  let closeDaysCount = 0;

  for (const row of rows) {
    if (wonStatuses.includes(row.status)) {
      totalWon++;
      if (row.closedAt && row.createdAt) {
        const days = (new Date(row.closedAt).getTime() - new Date(row.createdAt).getTime()) / 86_400_000;
        closeDaysSum += days;
        closeDaysCount++;
      }
    } else if (row.status === 'CANCELLED') {
      totalLost++;
    }
  }

  const decided = totalWon + totalLost;
  return {
    totalInquiries,
    totalWon,
    totalLost,
    winRate: decided > 0 ? totalWon / decided : 0,
    avgDaysToClose: closeDaysCount > 0 ? Math.round((closeDaysSum / closeDaysCount) * 10) / 10 : null,
  };
}

// ─── Follow-Ups (due/overdue comment follow-ups) ─────────────────────

export interface FollowUpItem {
  id: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  content: string;
  followUpDate: string;
  userName: string;
  userId: string;
  createdAt: string;
}

/**
 * Returns all incomplete follow-ups that are due today or overdue,
 * optionally filtered by user. Resolves entity names for display.
 */
export async function getFollowUps(
  tenantId: string,
  userId?: string,
): Promise<FollowUpItem[]> {
  const today = new Date().toISOString().split('T')[0]!;

  const conditions = [
    isNotNull(entityComments.followUpDate),
    lte(entityComments.followUpDate, today),
    eq(entityComments.followUpCompleted, false),
  ];
  if (userId) conditions.push(eq(entityComments.userId, userId));

  const rows = await db
    .select()
    .from(entityComments)
    .where(and(...conditions))
    .orderBy(asc(entityComments.followUpDate));

  if (rows.length === 0) return [];

  // Resolve entity names in batch
  const entityIds = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = entityIds.get(r.entityType) ?? new Set();
    set.add(r.entityId);
    entityIds.set(r.entityType, set);
  }

  const nameMap = new Map<string, string>();

  // Resolve company names
  const companyIds = entityIds.get('company');
  if (companyIds?.size) {
    const companies = await db
      .select({ id: counterparties.id, name: counterparties.name })
      .from(counterparties)
      .where(and(eq(counterparties.tenantId, tenantId), inArray(counterparties.id, [...companyIds])));
    for (const c of companies) nameMap.set(`company:${c.id}`, c.name);
  }

  // Resolve order names
  const orderIds = entityIds.get('order');
  if (orderIds?.size) {
    const orderRows = await db
      .select({ id: orders.id, orderNumber: orders.orderNumber })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, [...orderIds])));
    for (const o of orderRows) nameMap.set(`order:${o.id}`, o.orderNumber ?? o.id);
  }

  // Resolve vessel names
  const vesselIds = entityIds.get('vessel');
  if (vesselIds?.size) {
    const vesselRows = await db
      .select({ id: vessels.id, name: vessels.name })
      .from(vessels)
      .where(inArray(vessels.id, [...vesselIds]));
    for (const v of vesselRows) nameMap.set(`vessel:${v.id}`, v.name);
  }

  // Resolve place names
  const placeIds = entityIds.get('place');
  if (placeIds?.size) {
    const placeRows = await db
      .select({ id: places.id, name: places.name })
      .from(places)
      .where(inArray(places.id, [...placeIds]));
    for (const p of placeRows) nameMap.set(`place:${p.id}`, p.name);
  }

  return rows.map((r) => ({
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    entityName: nameMap.get(`${r.entityType}:${r.entityId}`) ?? null,
    content: r.content,
    followUpDate: r.followUpDate!,
    userName: r.userName,
    userId: r.userId,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ─── Vacation / Delegation Helper ────────────────────────────────────

/**
 * Resolve which trader IDs a user is allowed to see:
 * - Always includes themselves
 * - If any on-leave user has delegated to them, include those users too
 * - Admins see all traders in the tenant
 */
async function resolveVisibleTraderIds(
  tenantId: string,
  requestingUserId: string,
): Promise<string[]> {
  // Get the requesting user
  const requestingUser = await db.query.users.findFirst({
    where: eq(users.id, requestingUserId),
  });

  if (!requestingUser) return [];

  // Admins see everyone
  if (requestingUser.role === 'ADMIN') {
    const allTraders = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          inArray(users.role, ['TRADER', 'ADMIN', 'CREDITMANAGER']),
        ),
      );
    return allTraders.map((u) => u.id);
  }

  const ids = new Set<string>([requestingUserId]);

  // Find users who are on leave AND have delegated to the requesting user
  const delegators = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.tenantId, tenantId),
        eq(users.delegateId, requestingUserId),
        eq(users.isOnLeave, true),
      ),
    );

  for (const d of delegators) {
    ids.add(d.id);
  }

  return Array.from(ids);
}
