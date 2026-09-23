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
import { and, asc, eq, sql } from 'drizzle-orm';
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

  // An issued tranche is a live receivable; rewriting the schedule underneath it
  // would silently restate what the customer already holds.
  const issued = await db
    .select({ seq: invoices.trancheSeq, number: invoices.invoiceNumber })
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), sql`${invoices.status} <> 'VOID'`));
  if (issued.some((row) => row.seq != null)) {
    throw new InvalidScheduleError(
      'This order already has issued invoices per tranche — void them before changing the schedule',
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


  return rows.map((row) => {
    const percent = parseFloat(row.percent) || 0;
    const amount = (orderTotal * percent) / 100;
    return {
      id: row.id,
      orderId: row.orderId,
      seq: row.seq,
      label: row.label ?? null,
      percent: row.percent,
      dueBasis: row.dueBasis as DueBasis,
      creditDays: row.creditDays ?? null,
      fixedDueDate: row.fixedDueDate ?? null,
      amount: amount.toFixed(2),
      dueDate: computeTrancheDueDate(row.dueBasis as DueBasis, row.creditDays, row.fixedDueDate, order),
    };
  });
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
