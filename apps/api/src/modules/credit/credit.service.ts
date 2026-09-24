// ═══════════════════════════════════════════════════════════════════════
//  Credit Service — CRUD for supplier & customer credit lines
//  Both sides (counterparties and own companies) are many-to-many.
//  Used amount is calculated from open orders automatically.
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, sql, inArray, asc, desc, isNull, ne } from 'drizzle-orm';
import { db } from '../../db';
import {
  creditLines,
  counterparties,
  orders,
  orderSuppliers,
  orderItems,
  creditLineCompanies,
  creditLineCounterparties,
  customerPayments,
  tenants,
} from '../../db/schema';
import type { CreditLineDto, CreditLineType } from '@fueld/types';

// Active statuses that count towards "used" credit.
// Supplier side includes PAID: a PAID order (customer paid) does NOT auto-free
// supplier credit — supplier credit is only released when the leg is settled
// (order_suppliers.paid_at IS NOT NULL), filtered in calcUsedAmountForSupplier.
const SUPPLIER_ACTIVE_STATUSES = ['CONFIRMED', 'DELIVERED', 'INVOICED', 'PAID'] as const;
const CUSTOMER_ACTIVE_STATUSES = ['INQUIRY', 'OFFER', 'CONFIRMED', 'DELIVERED', 'INVOICED'] as const;

// ═══════════════════════════════════════════════════════════════════════
//  CALCULATE USED AMOUNT (supports multiple counterparty IDs)
//
//  Supplier credit → sum of costPrice × quantity for order items where
//                     supplierId IN counterpartyIds AND status is active
//  Customer credit → sum of salesPrice × quantity for order items where
//                     order.clientId IN counterpartyIds AND status is active
// ═══════════════════════════════════════════════════════════════════════

async function calcUsedAmountForSupplier(
  counterpartyIds: string[],
  isBrokerCreditLine: boolean = false,
  bufferDays: number = 0,
  autoReleaseCredit: boolean = true,
  currency?: string,
  excludeOrderId?: string,
): Promise<string> {
  if (!counterpartyIds.length) return '0';
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${orderItems.costPrice}::numeric * ${orderItems.quantity}::numeric), 0)::text`,
    })
    .from(orderItems)
    .innerJoin(orderSuppliers, eq(orderItems.orderSupplierId, orderSuppliers.id))
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(
      and(
        inArray(orderSuppliers.companyId, counterpartyIds),
        eq(orderSuppliers.paymentTermType, 'CREDIT'),
        inArray(orders.status, [...SUPPLIER_ACTIVE_STATUSES]),
        // Separate broker deal exposure from regular trade exposure:
        // broker credit lines only count broker deals, regular credit lines
        // only count non-broker deals — so Moxie's own trades don't inflate
        // Ocean7's credit usage and vice versa.
        isBrokerCreditLine
          ? eq(orders.isBrokerDeal, true)
          : eq(orders.isBrokerDeal, false),
        // Credit lines are currency-scoped facilities: only count exposure in
        // the line's own currency (costPrice is stored in the order's currency,
        // so a raw cross-currency sum would corrupt availableAmount).
        ...(currency ? [eq(orders.currency, currency)] : []),
        // When validating a specific deal's own conversion, exclude that deal
        // from its own usage — its exposure is what `required` already carries.
        // Without this, converting a priced deal needs 2× its value in credit.
        ...(excludeOrderId ? [ne(orderItems.orderId, excludeOrderId)] : []),
        // Credit is still "in use" when:
        // 1. Not manually marked paid (paidAt IS NULL), AND
        // 2. For broker deals (when autoReleaseCredit is enabled):
        //    not past the credit period from delivery
        //    (deliveredAt + supplierCreditDays + bufferDays < now means still in use)
        // For non-broker deals: only paidAt matters (same as before)
        // For broker deals when autoReleaseCredit is false: only paidAt releases credit
        sql`(
          ${orderSuppliers.paidAt} IS NOT NULL
          OR (
            ${orders.isBrokerDeal} = true
            AND ${autoReleaseCredit ? sql`TRUE` : sql`FALSE`}
            AND ${orders.deliveredAt} IS NOT NULL
            AND ${orders.deliveredAt} + make_interval(days => COALESCE(${orderSuppliers.creditDays}, 30) + ${bufferDays}) < now()
          )
        ) = false`,
      ),
    );
  return row?.total ?? '0';
}

async function calcUsedAmountForCustomer(counterpartyIds: string[], currency?: string, excludeOrderId?: string): Promise<string> {
  if (!counterpartyIds.length) return '0';
  // Net exposure: committed value per order minus payments actually received
  // on that order (parity with the supplier side, which nets paidAt).
  // Without netting, recorded customer payments never released credit until
  // someone manually marked the order PAID.
  //
  // Panel fix: order values are aggregated to one row per order FIRST and
  // payments are subtracted at the order level. Subtracting the per-order
  // payment total from EACH item row over-nets multi-item orders (fail-open:
  // inflates available credit).
  const paymentsTotals = db
    .select({
      orderId: customerPayments.orderId,
      currency: customerPayments.currency,
      paid: sql<string>`sum(${customerPayments.amount}::numeric)`.as('paid'),
    })
    .from(customerPayments)
    .groupBy(customerPayments.orderId, customerPayments.currency)
    .as('cp_totals');
  const orderValues = db
    .select({
      orderId: orderItems.orderId,
      value: sql<string>`sum(${orderItems.salesPrice}::numeric * ${orderItems.quantity}::numeric)`.as('value'),
    })
    .from(orderItems)
    .groupBy(orderItems.orderId)
    .as('oi_totals');
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(greatest(${orderValues.value} - coalesce(${paymentsTotals.paid}, 0), 0)), 0)::text`,
    })
    .from(orderValues)
    .innerJoin(orders, eq(orders.id, orderValues.orderId))
    .leftJoin(
      paymentsTotals,
      and(eq(paymentsTotals.orderId, orders.id), eq(paymentsTotals.currency, orders.currency)),
    )
    .where(
      and(
        inArray(orders.clientId, counterpartyIds),
        eq(orders.customerPaymentTermType, 'CREDIT'),
        inArray(orders.status, [...CUSTOMER_ACTIVE_STATUSES]),
        // Exclude the deal being validated from its own usage — its exposure
        // is what `required` already carries (otherwise conversion needs 2×).
        ...(excludeOrderId ? [ne(orders.id, excludeOrderId)] : []),
        // Currency-scoped: only count exposure in the line's own currency.
        ...(currency ? [eq(orders.currency, currency)] : []),
      ),
    );
  return row?.total ?? '0';
}

// ═══════════════════════════════════════════════════════════════════════
//  CALCULATE PERFORMANCE (avg days to pay — customer only)
//  Averages across all counterparty companies on the credit line.
// ═══════════════════════════════════════════════════════════════════════

async function calcPerformanceDays(counterpartyIds: string[]): Promise<number | null> {
  if (!counterpartyIds.length) return null;
  const [row] = await db
    .select({
      avgDays: sql<number | null>`
        round(avg(extract(epoch from (${orders.closedAt} - ${orders.createdAt})) / 86400))::int
      `,
    })
    .from(orders)
    .where(
      and(
        inArray(orders.clientId, counterpartyIds),
        eq(orders.status, 'PAID'),
      ),
    );
  return row?.avgDays ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  FETCH SIDES OF A CREDIT LINE
// ═══════════════════════════════════════════════════════════════════════

async function fetchCreditLineSides(creditLineId: string) {
  const [cpRows, ownRows] = await Promise.all([
    db
      .select({ id: counterparties.id, name: counterparties.name })
      .from(creditLineCounterparties)
      .innerJoin(counterparties, eq(creditLineCounterparties.counterpartyId, counterparties.id))
      .where(eq(creditLineCounterparties.creditLineId, creditLineId)),
    db
      .select({ id: counterparties.id, name: counterparties.name })
      .from(creditLineCompanies)
      .innerJoin(counterparties, eq(creditLineCompanies.counterpartyId, counterparties.id))
      .where(eq(creditLineCompanies.creditLineId, creditLineId)),
  ]);
  return {
    counterpartyIds: cpRows.map((r) => r.id),
    counterpartyNames: cpRows.map((r) => r.name),
    ownCompanyIds: ownRows.map((r) => r.id),
    ownCompanyNames: ownRows.map((r) => r.name),
  };
}

/**
 * Sides for MANY credit lines in two queries instead of two-per-line.
 *
 * enrichCreditLine was called once per row, so the computed-sort path (which must
 * enrich every matching line to sort on a derived column) issued 2 queries per
 * line just for the sides — plus one for the tenant and one per usage/performance
 * calculation. Measured at 271 lines that was ~2.6s per request, i.e. seconds of
 * latency on every click of Used / Available / Name. Batching the sides is the
 * largest single win and keeps the existing per-row path for single-line reads.
 */
async function fetchCreditLineSidesBatch(creditLineIds: string[]): Promise<Map<string, {
  counterpartyIds: string[];
  counterpartyNames: string[];
  ownCompanyIds: string[];
  ownCompanyNames: string[];
}>> {
  const out = new Map<string, {
    counterpartyIds: string[];
    counterpartyNames: string[];
    ownCompanyIds: string[];
    ownCompanyNames: string[];
  }>();
  if (!creditLineIds.length) return out;
  const blank = () => ({ counterpartyIds: [] as string[], counterpartyNames: [] as string[], ownCompanyIds: [] as string[], ownCompanyNames: [] as string[] });
  for (const id of creditLineIds) out.set(id, blank());

  const [cpRows, ownRows] = await Promise.all([
    db
      .select({ lineId: creditLineCounterparties.creditLineId, id: counterparties.id, name: counterparties.name })
      .from(creditLineCounterparties)
      .innerJoin(counterparties, eq(creditLineCounterparties.counterpartyId, counterparties.id))
      .where(inArray(creditLineCounterparties.creditLineId, creditLineIds)),
    db
      .select({ lineId: creditLineCompanies.creditLineId, id: counterparties.id, name: counterparties.name })
      .from(creditLineCompanies)
      .innerJoin(counterparties, eq(creditLineCompanies.counterpartyId, counterparties.id))
      .where(inArray(creditLineCompanies.creditLineId, creditLineIds)),
  ]);

  for (const r of cpRows) {
    const entry = out.get(r.lineId);
    if (entry) { entry.counterpartyIds.push(r.id); entry.counterpartyNames.push(r.name); }
  }
  for (const r of ownRows) {
    const entry = out.get(r.lineId);
    if (entry) { entry.ownCompanyIds.push(r.id); entry.ownCompanyNames.push(r.name); }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
//  ENRICH A RAW CREDIT LINE ROW → CreditLineDto
// ═══════════════════════════════════════════════════════════════════════

interface RawCreditLine {
  id: string;
  tenantId: string;
  type: string;
  creditAmount: string;
  currency: string;
  expires: string | null;
  periodDays: number;
  fromDelivery: boolean;
  qualified: boolean;
  notes: string | null;
  isBrokerCreditLine: boolean;
  createdAt: Date;
  updatedAt: Date;
}

async function enrichCreditLine(
  row: RawCreditLine,
  excludeOrderId?: string,
  prefetched?: {
    sides?: { counterpartyIds: string[]; counterpartyNames: string[]; ownCompanyIds: string[]; ownCompanyNames: string[] };
    brokerSettings?: { bufferDays: number; autoReleaseCredit: boolean };
  },
): Promise<CreditLineDto> {
  const sides = prefetched?.sides ?? await fetchCreditLineSides(row.id);

  // Load tenant broker deal settings for auto-release config
  let bufferDays = 0;
  let autoReleaseCredit = true;
  if (prefetched?.brokerSettings) {
    bufferDays = prefetched.brokerSettings.bufferDays;
    autoReleaseCredit = prefetched.brokerSettings.autoReleaseCredit;
  } else {
    const [tenant] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, row.tenantId)).limit(1);
    const bd = (tenant?.settings as any)?.brokerDeals;
    if (bd) {
      bufferDays = bd.autoReleaseBufferDays ?? 0;
      autoReleaseCredit = bd.autoReleaseCredit ?? true;
    }
  }

  const usedAmount =
    row.type === 'SUPPLIER'
      ? await calcUsedAmountForSupplier(sides.counterpartyIds, row.isBrokerCreditLine, bufferDays, autoReleaseCredit, row.currency, excludeOrderId)
      : await calcUsedAmountForCustomer(sides.counterpartyIds, row.currency, excludeOrderId);

  const creditNum = parseFloat(row.creditAmount) || 0;
  const usedNum = parseFloat(usedAmount) || 0;
  const available = Math.max(creditNum - usedNum, 0);

  const performanceDays =
    row.type === 'CUSTOMER' ? await calcPerformanceDays(sides.counterpartyIds) : null;

  return {
    id: row.id,
    tenantId: row.tenantId,
    type: row.type as CreditLineType,
    counterpartyIds: sides.counterpartyIds,
    counterpartyNames: sides.counterpartyNames,
    ownCompanyIds: sides.ownCompanyIds,
    ownCompanyNames: sides.ownCompanyNames,
    creditAmount: row.creditAmount,
    currency: row.currency,
    usedAmount: usedNum.toFixed(2),
    availableAmount: available.toFixed(2),
    expires: row.expires,
    periodDays: row.periodDays,
    fromDelivery: row.fromDelivery,
    qualified: row.qualified,
    performanceDays,
    notes: row.notes,
    isBrokerCreditLine: row.isBrokerCreditLine,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  LIST CREDIT LINES (paginated, filtered by type)
// ═══════════════════════════════════════════════════════════════════════

export async function listCreditLines(query: {
  /** REQUIRED — tenant scoping is mandatory (panel finding, 2026-09-20). */
  tenantId: string;
  type?: CreditLineType;
  counterpartyId?: string;
  excludeOrderId?: string;
  /** Free-text filter over the linked counterparty names. */
  search?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}) {
  const conditions = [eq(creditLines.tenantId, query.tenantId)];
  if (query?.type) conditions.push(eq(creditLines.type, query.type));
  if (query?.counterpartyId) {
    conditions.push(eq(creditLineCounterparties.counterpartyId, query.counterpartyId));
  }
  // Name search is expressed as an EXISTS subquery (below) precisely so it does
  // NOT need the join: joining the link table would emit one row per linked
  // counterparty, duplicating a line that covers several clients into the page.
  const needsCounterpartyJoin = !!query?.counterpartyId;
  if (query?.search?.trim()) {
    // Match ANY linked counterparty name (a line can cover several clients).
    conditions.push(sql`EXISTS (
      SELECT 1 FROM ${creditLineCounterparties} clc
      JOIN ${counterparties} cp ON cp.id = clc.counterparty_id
      WHERE clc.credit_line_id = ${creditLines.id}
        AND cp.name ILIKE ${'%' + query.search.trim() + '%'}
    )`);
  }

  const where = conditions.length === 1 ? conditions[0] : and(...conditions);

  /**
   * Clamped. The computed-sort path must enrich EVERY matching row to sort on a
   * derived column, so an unclamped limit let an authenticated caller ask for an
   * arbitrarily large page and pay the full O(rows) enrichment cost — a one-request
   * N+1. 100 is comfortably above the 25/50 the UI uses and bounds the work.
   */
  const limit = Math.min(Math.max(query?.limit ?? 25, 1), 100);
  const page = query?.page ?? 1;
  const offset = (page - 1) * limit;

  // Columns that exist on the row and can be ordered in SQL.
  const sortMap: Record<string, any> = {
    updatedAt: creditLines.updatedAt,
    expires: creditLines.expires,
    periodDays: creditLines.periodDays,
    creditAmount: creditLines.creditAmount,
    currency: creditLines.currency,
    createdAt: creditLines.createdAt,
    isBrokerCreditLine: creditLines.isBrokerCreditLine,
    fromDelivery: creditLines.fromDelivery,
    qualified: creditLines.qualified,
  };
  /**
   * Columns that cannot be ordered by a plain SQL ORDER BY.
   *
   * `used`/`available` are derived in JS by enrichCreditLine from the
   * counterparties' open orders (available = creditAmount - used, floored at 0),
   * and the name/performance columns are aggregates or separate queries. Ordering
   * the raw rows by creditAmount while the UI labels the column "Available" would
   * sort by a different number than the one displayed; ordering by updatedAt for a
   * name click would silently ignore the user's intent entirely. So these are
   * sorted after enrichment, over the whole filtered set rather than the page —
   * sorting only the page would order the page, not the list.
   *
   * That is O(all matching lines) enrichment calls. Acceptable at the real scale
   * (≤271 lines even on the largest tenant) and the honest way to sort a derived
   * column. Anything larger should push these into SQL, not fake them here.
   */
  const computedSortKeys: Record<string, keyof CreditLineDto | ((l: CreditLineDto) => number | string)> = {
    used: 'usedAmount',
    available: 'availableAmount',
    performanceDays: (l) => l.performanceDays ?? -1,
    counterpartyNames: (l) => l.counterpartyNames.join(', ').toLowerCase(),
    ownCompanyNames: (l) => l.ownCompanyNames.join(', ').toLowerCase(),
  };
  const requestedSort = query?.sortBy ?? '';
  const computedSort = requestedSort in computedSortKeys ? requestedSort : null;
  const sortCol = sortMap[computedSort ? '' : requestedSort] ?? creditLines.updatedAt;
  const defaultDir = query?.sortBy ? 'asc' : 'desc';
  const sortDir = query?.sortDir ?? defaultDir;
  const sortFn = sortDir === 'desc' ? desc : asc;

  const listQueryBase = db
    .select({
      id: creditLines.id,
      tenantId: creditLines.tenantId,
      type: creditLines.type,
      creditAmount: creditLines.creditAmount,
      currency: creditLines.currency,
      expires: creditLines.expires,
      periodDays: creditLines.periodDays,
      fromDelivery: creditLines.fromDelivery,
      qualified: creditLines.qualified,
      notes: creditLines.notes,
      isBrokerCreditLine: creditLines.isBrokerCreditLine,
      createdAt: creditLines.createdAt,
      updatedAt: creditLines.updatedAt,
    })
    .from(creditLines);

  const countQueryBase = db
    .select({ count: sql<number>`count(distinct ${creditLines.id})::int` })
    .from(creditLines);

  const listQuery = needsCounterpartyJoin
    ? listQueryBase.innerJoin(
      creditLineCounterparties,
      eq(creditLineCounterparties.creditLineId, creditLines.id),
    )
    : listQueryBase;

  const countQuery = needsCounterpartyJoin
    ? countQueryBase.innerJoin(
      creditLineCounterparties,
      eq(creditLineCounterparties.creditLineId, creditLines.id),
    )
    : countQueryBase;

  /**
   * `credit_line_counterparties` has no PK or UNIQUE on
   * (credit_line_id, counterparty_id), so the join can in principle emit the
   * same credit line more than once. `total` already counts DISTINCT ids, so a
   * duplicated row would make the page disagree with the total and, once sliced,
   * push real rows past the offset. GROUP BY the line's id removes the
   * possibility at the query rather than trusting the data to stay clean.
   */
  const listQueryDeduped = needsCounterpartyJoin
    ? listQuery.groupBy(creditLines.id)
    : listQuery;

  if (computedSort) {
    const [allRows, countResult] = await Promise.all([
      // (updatedAt, id) — updatedAt alone is NOT unique (rows are created in the
      // same millisecond by bulk inserts), and a non-unique pre-order lets
      // consecutive pages repeat or skip rows once the derived sort slices.
      listQueryDeduped.where(where).orderBy(sortFn(creditLines.updatedAt), asc(creditLines.id)),
      countQuery.where(where),
    ]);
    const total = countResult[0]?.count ?? 0;
    // Enrich everything, order by the derived column, then slice the page.
    // Sides and the tenant's broker settings are fetched once for the whole set
    // rather than per line — see fetchCreditLineSidesBatch.
    const [sidesById, brokerSettings] = await Promise.all([
      fetchCreditLineSidesBatch(allRows.map((r) => r.id)),
      (async () => {
        const [tenant] = await db
          .select({ settings: tenants.settings })
          .from(tenants)
          .where(eq(tenants.id, query.tenantId))
          .limit(1);
        const bd = (tenant?.settings as any)?.brokerDeals;
        return {
          bufferDays: bd?.autoReleaseBufferDays ?? 0,
          autoReleaseCredit: bd?.autoReleaseCredit ?? true,
        };
      })(),
    ]);
    const enriched = await Promise.all(
      allRows.map((r) => enrichCreditLine(r, query?.excludeOrderId, {
        sides: sidesById.get(r.id),
        brokerSettings,
      })),
    );
    const accessor = computedSortKeys[computedSort]!;
    const valueOf = (line: CreditLineDto): number | string =>
      typeof accessor === 'function' ? accessor(line) : (line[accessor] as number | string);
    const dir = sortDir === 'desc' ? -1 : 1;
    enriched.sort((a, b) => {
      const x = valueOf(a);
      const y = valueOf(b);
      if (typeof x === 'string' || typeof y === 'string') {
        return dir * String(x).localeCompare(String(y));
      }
      return dir * ((parseFloat(String(x)) || 0) - (parseFloat(String(y)) || 0));
    });
    return { items: enriched.slice(offset, offset + limit), total };
  }

  const [rows, countResult] = await Promise.all([
    listQueryDeduped
      .where(where)
      .limit(limit)
      .offset(offset)
      // id as a final tiebreak for the same reason: a non-unique sort column
      // makes page boundaries ambiguous.
      .orderBy(sortFn(sortCol), asc(creditLines.id)),
    countQuery.where(where),
  ]);

  const items = await Promise.all(rows.map((r) => enrichCreditLine(r, query?.excludeOrderId)));

  return { items, total: countResult[0]?.count ?? 0 };
}

// ═════════════════════════════════════════════════════════════════
//  SERVER-SIDE CREDIT ENFORCEMENT
//  The deal UI filters lines by currency, broker flag and expiry, but
//  it deliberately does NOT mirror the sufficiency check below (it
//  cannot see the persisted exposure `required` is computed from), so
//  this function remains the only authority on whether a line is
//  actually sufficient. The API must not rely on the UI at all:
//  direct API calls, scripts, or races could otherwise commit credit
//  that doesn't exist.
// ═════════════════════════════════════════════════════════════════

export interface CreditAvailability {
  ok: boolean;
  /** Summed availability of matching lines, in the requested currency. */
  available: number;
  required: number;
  currency: string;
  /** Human-readable explanation when ok === false. */
  reason: string | null;
}

/**
 * Sums the available amount of active, non-expired credit lines for a
 * counterparty in a given currency (broker lines only for broker deals,
 * regular lines only for regular deals — same split as usage tracking).
 */
export async function checkCreditAvailability(opts: {
  type: 'SUPPLIER' | 'CUSTOMER';
  counterpartyId: string;
  currency: string;
  isBrokerDeal: boolean;
  tenantId: string;
  required: number;
  /**
   * The order being validated. Its own exposure is excluded from usage so it
   * is not double-counted (it is already carried by `required`). Without this,
   * converting a priced deal requires 2× its value in available credit.
   */
  excludeOrderId?: string;
  label: string; // e.g. 'Supplier credit' — used in the rejection message
}): Promise<CreditAvailability> {
  const { items } = await listCreditLines({
    tenantId: opts.tenantId,
    type: opts.type,
    counterpartyId: opts.counterpartyId,
    excludeOrderId: opts.excludeOrderId,
    limit: 100,
  });
  const today = new Date().toISOString().slice(0, 10);
  const matching = items.filter(
    (line) =>
      line.currency === opts.currency &&
      line.isBrokerCreditLine === opts.isBrokerDeal &&
      (!line.expires || line.expires >= today),
  );
  const available = matching.reduce(
    (sum, line) => sum + (parseFloat(line.availableAmount) || 0),
    0,
  );
  // Zero-cost commitments (no priced items yet) still require that a line
  // EXISTS in the deal currency — otherwise any CREDIT term passes.
  const ok = matching.length > 0 && available + 1e-9 >= opts.required;
  const sideLabel = opts.type === 'SUPPLIER' ? 'Supplier' : 'Customer';
  const brokerNote = opts.isBrokerDeal ? ' for a broker deal' : '';
  const reason = ok
    ? null
    : matching.length === 0
      ? `${sideLabel} credit line on file in ${opts.currency}${brokerNote} is required — none found. Request a ${opts.currency} credit line or choose another payment term.`
      : `Insufficient ${sideLabel.toLowerCase()} credit: ${available.toFixed(2)} ${opts.currency} available, ${opts.required.toFixed(2)} ${opts.currency} required. Request a credit increase or choose another payment term.`;
  return { ok, available, required: opts.required, currency: opts.currency, reason };
}

// ═══════════════════════════════════════════════════════════════════════
//  GET SINGLE CREDIT LINE
// ═══════════════════════════════════════════════════════════════════════

export async function getCreditLineById(id: string): Promise<CreditLineDto | null> {
  const [row] = await db
    .select({
      id: creditLines.id,
      tenantId: creditLines.tenantId,
      type: creditLines.type,
      creditAmount: creditLines.creditAmount,
      currency: creditLines.currency,
      expires: creditLines.expires,
      periodDays: creditLines.periodDays,
      fromDelivery: creditLines.fromDelivery,
      qualified: creditLines.qualified,
      notes: creditLines.notes,
      isBrokerCreditLine: creditLines.isBrokerCreditLine,
      createdAt: creditLines.createdAt,
      updatedAt: creditLines.updatedAt,
    })
    .from(creditLines)
    .where(eq(creditLines.id, id))
    .limit(1);

  if (!row) return null;
  return enrichCreditLine(row);
}

// ═══════════════════════════════════════════════════════════════════════
//  CREATE CREDIT LINE
// ═══════════════════════════════════════════════════════════════════════

export async function createCreditLine(data: {
  counterpartyIds: string[];
  type: CreditLineType;
  creditAmount: string;
  currency: string;
  expires?: string;
  periodDays: number;
  fromDelivery?: boolean;
  qualified?: boolean;
  notes?: string;
  ownCompanyIds?: string[];
  isBrokerCreditLine?: boolean;
}) {
  const tenantRow = await db.query.tenants.findFirst();
  if (!tenantRow) throw new Error('No tenant found');

  const [created] = await db
    .insert(creditLines)
    .values({
      tenantId: tenantRow.id,
      type: data.type,
      creditAmount: data.creditAmount,
      currency: data.currency,
      expires: data.expires ?? null,
      periodDays: data.periodDays,
      fromDelivery: data.fromDelivery ?? false,
      qualified: data.qualified ?? false,
      notes: data.notes ?? null,
      isBrokerCreditLine: data.isBrokerCreditLine ?? false,
    })
    .returning();

  // Link counterparties (suppliers or customers)
  if (data.counterpartyIds.length > 0) {
    await db.insert(creditLineCounterparties).values(
      data.counterpartyIds.map((cid) => ({
        creditLineId: created.id,
        counterpartyId: cid,
      })),
    );
  }

  // Link own companies
  if (data.ownCompanyIds?.length) {
    await db.insert(creditLineCompanies).values(
      data.ownCompanyIds.map((cid) => ({
        creditLineId: created.id,
        counterpartyId: cid,
      })),
    );
  }

  return getCreditLineById(created.id);
}

// ═══════════════════════════════════════════════════════════════════════
//  UPDATE CREDIT LINE
// ═══════════════════════════════════════════════════════════════════════

export async function updateCreditLine(
  id: string,
  data: {
    creditAmount?: string;
    currency?: string;
    expires?: string | null;
    periodDays?: number;
    fromDelivery?: boolean;
    qualified?: boolean;
    notes?: string | null;
    counterpartyIds?: string[];
    ownCompanyIds?: string[];
    isBrokerCreditLine?: boolean;
  },
) {
  const setFields: Record<string, unknown> = { updatedAt: new Date() };
  if (data.creditAmount !== undefined) setFields['creditAmount'] = data.creditAmount;
  if (data.currency !== undefined) setFields['currency'] = data.currency;
  if (data.expires !== undefined) setFields['expires'] = data.expires;
  if (data.periodDays !== undefined) setFields['periodDays'] = data.periodDays;
  if (data.fromDelivery !== undefined) setFields['fromDelivery'] = data.fromDelivery;
  if (data.qualified !== undefined) setFields['qualified'] = data.qualified;
  if (data.isBrokerCreditLine !== undefined) setFields['isBrokerCreditLine'] = data.isBrokerCreditLine;
  if (data.notes !== undefined) setFields['notes'] = data.notes;

  const [updated] = await db
    .update(creditLines)
    .set(setFields)
    .where(eq(creditLines.id, id))
    .returning();

  if (!updated) return null;

  // Update counterparties
  if (data.counterpartyIds !== undefined) {
    await db.delete(creditLineCounterparties).where(eq(creditLineCounterparties.creditLineId, id));
    if (data.counterpartyIds.length > 0) {
      await db.insert(creditLineCounterparties).values(
        data.counterpartyIds.map((cid) => ({
          creditLineId: id,
          counterpartyId: cid,
        })),
      );
    }
  }

  // Update own companies
  if (data.ownCompanyIds !== undefined) {
    await db.delete(creditLineCompanies).where(eq(creditLineCompanies.creditLineId, id));
    if (data.ownCompanyIds.length > 0) {
      await db.insert(creditLineCompanies).values(
        data.ownCompanyIds.map((cid) => ({
          creditLineId: id,
          counterpartyId: cid,
        })),
      );
    }
  }

  return getCreditLineById(updated.id);
}

// ═══════════════════════════════════════════════════════════════════════
//  DELETE CREDIT LINE
// ═══════════════════════════════════════════════════════════════════════

export async function deleteCreditLine(id: string) {
  const [deleted] = await db
    .delete(creditLines)
    .where(eq(creditLines.id, id))
    .returning({ id: creditLines.id, tenantId: creditLines.tenantId });
  return deleted ?? null;
}
