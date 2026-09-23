/**
 * Payment schedule (split payment terms).
 *
 * Real deals are often paid in tranches — "50% CIA and 50% at 21 dd" — which is
 * two receivables with two due dates, and the customer expects two invoices.
 * A schedule row describes one tranche; issuance turns each row into its own
 * `invoices` row.
 *
 * Rules the panel settled, enforced here:
 *   - `percent` is the source of truth, never a fixed amount, so editing the
 *     order's lines rescales the schedule deterministically. The tranche's
 *     amount is only ever computed at issuance and then frozen on its invoice.
 *   - The rows of an order MUST sum to exactly 100. A schedule that sums to
 *     anything else would leave part of the deal unbilled or billed twice.
 *   - No schedule at all is valid and means the Phase 0 behaviour: one implicit
 *     100% tranche on the order's own customer terms. The feature is additive.
 *
 * `ON_ISSUE` (a deposit / CIA) is due the day it is issued. `FROM_DELIVERY`
 * anchors on `deliveredAt ?? eta` plus `creditDays` — the trader's "delivery
 * date + credit days". `FIXED_DATE` is an exact day the trader pinned.
 */
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import { invoices, orderPaymentSchedule, orders } from '../../db/schema';
import { computeInvoiceAmount, computeInvoiceDueDate, splitAmountByPercent } from './invoice-amounts';

export type DueBasis = 'ON_ISSUE' | 'FROM_DELIVERY' | 'FIXED_DATE';

export interface ScheduleTrancheInput {
  label?: string | null;
  percent: number;
  dueBasis: DueBasis;
  creditDays?: number | null;
  fixedDueDate?: string | null;
}

export interface ScheduleTranche {
  id: string;
  orderId: string;
  seq: number;
  label: string | null;
  percent: string;
  dueBasis: DueBasis;
  creditDays: number | null;
  fixedDueDate: string | null;
  /** Amount this tranche will bill, given the order's current total. */
  amount: string;
  /** Computed due date, or null when it cannot be known yet. */
  dueDate: string | null;
}

/** A schedule is invalid; callers surface this to the trader. */
export class InvalidScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidScheduleError';
  }
}

const PERCENT_TOLERANCE = 0.001;

/** Validate a proposed schedule. Throws InvalidScheduleError with a reason. */
export function assertValidSchedule(input: ScheduleTrancheInput[]): void {
  if (input.length === 0) {
    throw new InvalidScheduleError('A payment schedule needs at least one tranche');
  }
  if (input.length > 12) {
    throw new InvalidScheduleError('A payment schedule supports at most 12 tranches');
  }

  let total = 0;
  for (const [index, tranche] of input.entries()) {
    const position = `Tranche ${index + 1}`;
    if (!Number.isFinite(tranche.percent) || tranche.percent <= 0) {
      throw new InvalidScheduleError(`${position}: percentage must be greater than 0`);
    }
    if (tranche.percent > 100) {
      throw new InvalidScheduleError(`${position}: percentage cannot exceed 100`);
    }
    total += tranche.percent;

    if (tranche.dueBasis === 'FIXED_DATE') {
      if (!tranche.fixedDueDate || !/^\d{4}-\d{2}-\d{2}$/.test(tranche.fixedDueDate.trim())) {
        throw new InvalidScheduleError(`${position}: a fixed-date tranche needs a due date (YYYY-MM-DD)`);
      }
    }
    if (tranche.dueBasis === 'FROM_DELIVERY') {
      const days = tranche.creditDays ?? 0;
      if (!Number.isFinite(days) || days < 0) {
        throw new InvalidScheduleError(`${position}: credit days cannot be negative`);
      }
    }
  }

  // The whole deal must be billed exactly once: under 100 leaves an unbilled
  // remainder, over 100 bills the customer twice for the same goods.
  if (Math.abs(total - 100) > PERCENT_TOLERANCE) {
    throw new InvalidScheduleError(
      `Payment schedule must total 100% (currently ${total.toFixed(2)}%)`,
    );
  }
}

/** Replace an order's schedule atomically. An empty list clears it. */
export async function setOrderPaymentSchedule(
  orderId: string,
  tranches: ScheduleTrancheInput[],
): Promise<ScheduleTranche[]> {
  if (tranches.length > 0) assertValidSchedule(tranches);

  // A live invoice is a receivable the customer holds, and rewriting the
  // schedule underneath it would silently restate that document. Any live
  // invoice blocks an edit, not just ones already split into tranches: setting a
  // schedule on an order that ALREADY has its single whole-deal invoice would
  // never issue those tranches (issuance early-returns on the existing row), so
  // the preview would promise tranches the money never follows. DRAFT rows are
  // not receivables, so they must not block an edit.
  const issued = await db
    .select({ number: invoices.invoiceNumber })
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), notInArray(invoices.status, ['VOID', 'DRAFT'])));
  if (issued.length > 0) {
    throw new InvalidScheduleError(
      'This order already has an issued invoice — void it before changing the schedule',
    );
  }

  await db.transaction(async (tx) => {
    await tx.delete(orderPaymentSchedule).where(eq(orderPaymentSchedule.orderId, orderId));
    if (tranches.length === 0) return;

    await tx.insert(orderPaymentSchedule).values(
      tranches.map((tranche, index) => ({
        orderId,
        seq: index + 1,
        label: tranche.label?.trim() || null,
        percent: tranche.percent.toFixed(3),
        dueBasis: tranche.dueBasis,
        creditDays: tranche.dueBasis === 'FROM_DELIVERY' ? (tranche.creditDays ?? 0) : null,
        fixedDueDate: tranche.dueBasis === 'FIXED_DATE' ? tranche.fixedDueDate!.trim() : null,
      })),
    );
  });

  return listOrderPaymentSchedule(orderId);
}

/**
 * The order's schedule with each tranche's amount and computed due date.
 * Returns an empty array when the order has no schedule (Phase 0 behaviour).
 */
export async function listOrderPaymentSchedule(orderId: string): Promise<ScheduleTranche[]> {
  const rows = await db
    .select()
    .from(orderPaymentSchedule)
    .where(eq(orderPaymentSchedule.orderId, orderId))
    .orderBy(asc(orderPaymentSchedule.seq));

  if (rows.length === 0) return [];

  const [order] = await db
    .select({
      eta: orders.eta,
      deliveredAt: orders.deliveredAt,
      customerPaymentTermType: orders.customerPaymentTermType,
      customerCreditDays: orders.customerCreditDays,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  // The order total the tranches divide. Read from the same rows issuance bills.
  const orderTotal = parseFloat(await computeInvoiceAmount(orderId)) || 0;


  // Once the schedule is issued, each tranche has a real invoice. Expose it so
  // the UI can name the tranche it wants to download or email -- the API renders
  // a specific invoice by id, and without this the caller cannot know the id.
  const issued = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      trancheSeq: invoices.trancheSeq,
      status: invoices.status,
      dueDate: invoices.dueDate,
      amount: invoices.amount,
    })
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), notInArray(invoices.status, ['VOID', 'DRAFT'])));
  const issuedBySeq = new Map(issued.filter((row) => row.trancheSeq != null).map((row) => [row.trancheSeq!, row]));

  // Preview the SAME amounts issuance will bill, including the last-tranche
  // rounding absorption -- otherwise a preview shows 33.33/33.33/33.33 for a
  // schedule that issues as 33.33/33.33/33.34.
  const percents = rows.map((row) => parseFloat(row.percent) || 0);
  return rows.map((row, index) => {
    const amount = splitAmountByPercent(orderTotal, percents, index);
    const invoice = issuedBySeq.get(row.seq);
    return {
      id: row.id,
      orderId: row.orderId,
      seq: row.seq,
      label: row.label ?? null,
      percent: row.percent,
      dueBasis: row.dueBasis as DueBasis,
      creditDays: row.creditDays ?? null,
      fixedDueDate: row.fixedDueDate ?? null,
      amount,
      dueDate: computeTrancheDueDate(row.dueBasis as DueBasis, row.creditDays, row.fixedDueDate, order),
      // Null until the tranche has been issued.
      invoiceId: invoice?.id ?? null,
      invoiceNumber: invoice?.invoiceNumber ?? null,
      invoiceStatus: invoice?.status ?? null,
      // Prefer the FROZEN amount/date once issued: the document the customer
      // holds is the truth, not a recomputation from current terms.
      issuedAmount: invoice?.amount ?? null,
      issuedDueDate: invoice?.dueDate ?? null,
    };
  });
}

/**
 * Every order's schedule, in one query, as financing terms.
 *
 * Financing is computed for lists of orders at a time (dashboard, reports,
 * order cards), so this returns a map rather than a lookup per order — an N+1
 * here would run once per order on every list render.
 *
 * `dueDays` is the days from the SAME anchor the single-term calculation uses
 * (delivery, falling back to ETA) until the tranche falls due, so a schedule is
 * directly comparable with the customer credit days it replaces.
 */
export async function getFinancingTranchesByOrder(
  orderIds: string[],
): Promise<Map<string, Array<{ percent: number | null; dueDays: number | null }>>> {
  const result = new Map<string, Array<{ percent: number | null; dueDays: number | null }>>();
  if (orderIds.length === 0) return result;

  const [scheduleRows, orderRows] = await Promise.all([
    db
      .select()
      .from(orderPaymentSchedule)
      .where(inArray(orderPaymentSchedule.orderId, orderIds))
      .orderBy(asc(orderPaymentSchedule.seq)),
    db
      .select({ id: orders.id, eta: orders.eta, deliveredAt: orders.deliveredAt })
      .from(orders)
      .where(inArray(orders.id, orderIds)),
  ]);
  if (scheduleRows.length === 0) return result;

  const anchors = new Map(orderRows.map((row) => [row.id, row.deliveredAt ?? row.eta ?? null]));

  for (const row of scheduleRows) {
    const anchor = asUtcDay(anchors.get(row.orderId) ?? null);
    let dueDays: number | null = null;
    if (row.dueBasis === 'ON_ISSUE') {
      dueDays = 0;
    } else if (row.dueBasis === 'FIXED_DATE' && row.fixedDueDate) {
      const due = asUtcDay(row.fixedDueDate);
      dueDays = anchor && due ? Math.round((due.getTime() - anchor.getTime()) / 86_400_000) : null;
    } else if (row.dueBasis === 'FROM_DELIVERY') {
      dueDays = Math.max(0, Math.round(row.creditDays ?? 0));
    }

    // percent is numeric(6,3) NOT NULL, so a parse failure is not reachable from
    // Postgres today; keep it null rather than 0 so a bad value cannot silently
    // drop a tranche from the denominator and inflate the surviving shares.
    const percent = parseFloat(String(row.percent));
    const list = result.get(row.orderId) ?? [];
    list.push({ percent: Number.isFinite(percent) ? percent : null, dueDays });
    result.set(row.orderId, list);
  }

  return result;
}

function asUtcDay(value: Date | string | null): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Due date a tranche will carry at issuance, or null when not yet knowable. */
export function computeTrancheDueDate(
  basis: DueBasis,
  creditDays: number | null,
  fixedDueDate: string | null,
  order: {
    eta: Date | null;
    deliveredAt: Date | null;
    customerPaymentTermType: string | null;
    customerCreditDays: number | null;
  } | null,
): string | null {
  const issuedAt = new Date();

  if (basis === 'FIXED_DATE') return fixedDueDate ?? null;

  if (basis === 'ON_ISSUE') {
    // A deposit is payable when the invoice is issued, whatever the delivery
    // terms say — that is what makes it a deposit.
    return computeInvoiceDueDate(null, 'PREPAY', null, issuedAt);
  }

  // FROM_DELIVERY: the delivery anchor plus this tranche's own credit days.
  const anchor = order?.deliveredAt ?? order?.eta ?? null;
  const days = creditDays ?? 0;
  if (anchor) return computeInvoiceDueDate(anchor, 'CREDIT', days, issuedAt);
  // Not dispatched yet: fall back to issue-date + days so the trader still sees
  // a provisional date, matching how the Phase 0 due date behaved.
  return computeInvoiceDueDate(null, 'CREDIT', days, issuedAt);
}
