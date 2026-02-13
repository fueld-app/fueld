import { eq, and, lt, sql, inArray, ne, isNotNull, gte, lte } from 'drizzle-orm';
import { db } from '../../db';
import {
  invoices,
  orders,
  orderItems,
  users,
  counterparties,
  vessels,
  places,
} from '../../db/schema';

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
  const baseConditions = [
    eq(orders.tenantId, tenantId),
    isNotNull(orders.salesRepId),
    inArray(orders.salesRepId, visibleTraderIds),
  ];
  if (fromDate) baseConditions.push(gte(orders.createdAt, fromDate));
  if (toDate) baseConditions.push(lte(orders.createdAt, toDate));

  const stats = await db
    .select({
      traderId: orders.salesRepId,
      traderName: users.name,
      traderEmail: users.email,
      orderCount: sql<number>`count(distinct ${orders.id})`.as('order_count'),
      totalVolume: sql<string>`coalesce(sum(${orderItems.quantity}::numeric), 0)`.as('total_volume'),
      totalRevenue: sql<string>`coalesce(sum(${orderItems.salesPrice}::numeric * ${orderItems.quantity}::numeric), 0)`.as('total_revenue'),
      totalCost: sql<string>`coalesce(sum(${orderItems.costPrice}::numeric * ${orderItems.quantity}::numeric), 0)`.as('total_cost'),
      totalProfit: sql<string>`coalesce(sum(${orderItems.profit}::numeric), 0)`.as('total_profit'),
    })
    .from(orders)
    .innerJoin(users, eq(orders.salesRepId, users.id))
    .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(and(...baseConditions))
    .groupBy(orders.salesRepId, users.name, users.email);

  return stats.map((s) => ({
    traderId: s.traderId!,
    traderName: s.traderName,
    traderEmail: s.traderEmail,
    orderCount: Number(s.orderCount),
    totalVolume: String(s.totalVolume),
    totalRevenue: String(s.totalRevenue),
    totalCost: String(s.totalCost),
    totalProfit: String(s.totalProfit),
  }));
}

// ─── Pipeline Summary ────────────────────────────────────────────────

export interface PipelineSummary {
  status: string;
  count: number;
  totalValue: string;
}

/**
 * Returns count + total value grouped by order status.
 */
export async function getPipelineSummary(tenantId: string): Promise<PipelineSummary[]> {
  const results = await db
    .select({
      status: orders.status,
      count: sql<number>`count(*)`.as('count'),
      totalValue: sql<string>`coalesce(sum(
        (select sum(oi.sales_price::numeric * oi.quantity::numeric) from order_items oi where oi.order_id = ${orders.id})
      ), 0)`.as('total_value'),
    })
    .from(orders)
    .where(eq(orders.tenantId, tenantId))
    .groupBy(orders.status);

  return results.map((r) => ({
    status: r.status,
    count: Number(r.count),
    totalValue: String(r.totalValue),
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
