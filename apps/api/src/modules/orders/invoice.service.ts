/**
 * Invoice service — materializes `invoices` rows for confirmed customer invoices.
 *
 * Background: before this module existed, NO production code path ever inserted
 * into `invoices` (only the seed script and test fixtures did). Live consequences:
 * the invoice PDF always carried a `PREVIEW-<orderId[0:8]>` number, the
 * collections widget and the Invoice Aging report were permanently empty (they
 * read `invoices`), QuickBooks sync threw "No invoice found for this order",
 * and the payment recompute was an UPDATE over zero rows.
 *
 * Contract:
 *   - ONE invoice row per order for now (Phase 0). The schema already tolerates
 *     many rows per order, so split/tranche terms (Phase 1) extend this without
 *     another migration.
 *   - Rows are created at ISSUANCE, never at confirmation: an unissued invoice
 *     is not a receivable and must not appear in aging. Issuance happens exactly
 *     where the document is produced — the invoice-PDF route and the send-email
 *     route. The compose/pre-fill route is READ-ONLY: merely opening the modal
 *     must not create a receivable, whose amount would be frozen from whatever
 *     the lines happened to be at that moment. On the first send the real number
 *     is folded into the composed subject/body, so the email and its attachment
 *     still agree.
 *   - `dueDate`, `amount` and `invoiceNumber` are written once and are then the
 *     invoice's own facts. The PDF no longer recomputes them per render, which
 *     is what let a due date drift when ETA changed.
 *   - `amount` is derived from the same customer-facing line items the PDF
 *     prints (hidden / supplier-credit-placeholder lines excluded), so the
 *     figure the customer sees and the figure aging uses cannot diverge.
 *
 * Tenancy: `invoices` has no tenant_id (tenancy is implied through order_id).
 * `invoice_number` is globally UNIQUE, but each tenant runs its own Postgres,
 * so uniqueness is effectively per-tenant. Keep every query scoped via the order.
 */
import { and, asc, desc, eq, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { computeInvoiceDueDate, splitAmountByPercent } from './invoice-amounts';
import { listOrderPaymentSchedule } from './payment-schedule.service';
import { db, type Database } from '../../db';

/**
 * Either the pool or a transaction handle. Writes that must be atomic take this
 * so the same helper works inside and outside `db.transaction`.
 */
type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];
export { computeInvoiceDueDate, computeInvoiceAmount, MixedCurrencyInvoiceError } from './invoice-amounts';
import { computeInvoiceAmount } from './invoice-amounts';
import { customerPayments, invoices, invoiceNumberSequences, orderItems, orders, tenants, type TenantSettings } from '../../db/schema';
import { customerFacingItems } from '../documents/customer-facing-items';

export const DEFAULT_INVOICE_NUMBER_TEMPLATE = '{PREFIX}{YYYY}-{SEQ:4}';
/**
 * Money comparison tolerance, in the invoice's own currency. Shared by every
 * settled/balance check so "paid" means the same thing to the stored status,
 * the payment target and the readers — they previously disagreed by one unit
 * of this epsilon at the boundary.
 */
export const SETTLEMENT_EPSILON = 0.005;

/** Whether an invoice's recorded payments cover its amount. */
export function isInvoiceSettled(amount: string | null, amountPaid: string | null): boolean {
  const total = parseFloat(String(amount ?? 0)) || 0;
  const paid = parseFloat(String(amountPaid ?? 0)) || 0;
  return total > 0 && paid >= total - SETTLEMENT_EPSILON;
}
export const DEFAULT_INVOICE_NUMBER_PREFIX = 'INV-';

/** Same token contract as order numbers ({PREFIX}/{YYYY}/{MM}/{DD}/{SEQ:n}). */
export function normalizeInvoiceNumberTemplate(template: string): string {
  const trimmed = template.trim();
  if (!trimmed) return DEFAULT_INVOICE_NUMBER_TEMPLATE;
  if (/\{SEQ(?::\d+)?\}/.test(trimmed)) return trimmed;
  return `${trimmed}{SEQ:4}`;
}

export function renderInvoiceNumber(template: string, prefix: string, seq: number, now = new Date()): string {
  let result = normalizeInvoiceNumberTemplate(template)
    .replace('{PREFIX}', prefix)
    .replace('{YYYY}', now.getUTCFullYear().toString())
    .replace('{MM}', String(now.getUTCMonth() + 1).padStart(2, '0'))
    .replace('{DD}', String(now.getUTCDate()).padStart(2, '0'));

  result = result.replace(/\{SEQ:(\d+)\}/g, (_match, digits: string) =>
    String(seq).padStart(parseInt(digits, 10), '0'));
  return result.replace('{SEQ}', String(seq).padStart(4, '0'));
}

/**
 * Allocate the next invoice number for a tenant.
 *
 * Atomic upsert on the per-tenant counter (same pattern as generateOrderNumber),
 * so two concurrent issuances cannot receive the same sequence. A number is
 * consumed even when the caller later fails — invoice numbers must never be
 * reused, so a gap is the correct outcome rather than a bug to fix.
 */
export async function allocateInvoiceNumber(tenantId: string, now = new Date()): Promise<string> {
  const [seq] = await db
    .insert(invoiceNumberSequences)
    .values({ tenantId, lastSeq: 1 })
    .onConflictDoUpdate({
      target: invoiceNumberSequences.tenantId,
      set: {
        lastSeq: sql`${invoiceNumberSequences.lastSeq} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ lastSeq: invoiceNumberSequences.lastSeq });

  const [tenant] = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const settings = (tenant?.settings ?? {}) as TenantSettings;

  return renderInvoiceNumber(
    settings.invoiceNumberTemplate ?? DEFAULT_INVOICE_NUMBER_TEMPLATE,
    settings.invoiceNumberPrefix ?? DEFAULT_INVOICE_NUMBER_PREFIX,
    seq?.lastSeq ?? 1,
    now,
  );
}

/**
 * The figure that will print as "Total amount due" on the customer invoice:
 * customer-facing line items only, delivered quantity where known, in order
 * currency, as a fixed-2 string for numeric(14,2).
 */
/**
 * Void an issued invoice and, when asked, issue a replacement.
 *
 * An issued invoice never re-renders (see generateOrderInvoicePdfBuffer), so a
 * correction is a void plus a reissue — the standard accounting correction, and
 * the reason `VOID` is a terminal status readers exclude.
 *
 * The replacement keeps the original's due date by default: that date has
 * already been communicated to the customer, and recomputing it from the
 * order's current terms would silently move a payment deadline the trader did
 * not ask to change. Pass `dueDate` to override it when the deadline itself is
 * what is being corrected.
 *
 * The number is NOT reused: the replacement gets a fresh one, which is what
 * makes the two documents independently traceable. Payments already stamped on
 * the voided invoice are re-pointed at the replacement so a settled invoice does
 * not strand its money.
 */
export async function voidOrderInvoice(
  orderId: string,
  options: { reissue?: boolean; dueDate?: string; invoiceId?: string } = {},
): Promise<{ voided: typeof invoices.$inferSelect; replacement: typeof invoices.$inferSelect | null }> {
  // With split payment terms an order has one invoice PER TRANCHE, so a caller
  // that means "the invoice" must say which. Without an id this acts on the
  // order's ONLY live invoice and refuses when there is more than one, rather
  // than silently voiding the first tranche and re-billing it the whole deal.
  const live = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), notInArray(invoices.status, ['VOID', 'DRAFT'])))
    .orderBy(asc(invoices.trancheSeq), asc(invoices.createdAt));

  const current = options.invoiceId
    ? live.find((row) => row.id === options.invoiceId)
    : live[0];

  if (options.invoiceId && !current) {
    throw new InvoiceNotFoundError(orderId);
  }

  // Distinguish "never issued" from "already voided, nothing live to void" so
  // the caller can tell the trader which it is.
  if (!current) {
    const [voidedRow] = await db
      .select({ invoiceNumber: invoices.invoiceNumber })
      .from(invoices)
      .where(and(eq(invoices.orderId, orderId), eq(invoices.status, 'VOID')))
      .orderBy(desc(invoices.createdAt))
      .limit(1);
    if (voidedRow) throw new InvoiceAlreadyVoidError(voidedRow.invoiceNumber);
    throw new InvoiceNotFoundError(orderId);
  }

  if (!options.invoiceId && live.length > 1) {
    throw new AmbiguousInvoiceError(orderId, live.length);
  }

  // Resolve and validate everything the reissue needs BEFORE mutating anything:
  // `computeInvoiceAmount` can refuse (mixed-currency lines) and that must not
  // leave a voided invoice with nothing to replace it.
  let reissueContext: { tenantId: string; dueDate: string; amount: string } | null = null;
  if (options.reissue !== false) {
    const [order] = await db
      .select({ tenantId: orders.tenantId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order) throw new Error(`Order ${orderId} not found`);
    // A tranche replacement must keep billing ITS SHARE, not become a second
    // full-value invoice for the whole deal.
    const amount = current.trancheSeq == null
      ? await computeInvoiceAmount(orderId)
      : current.amount ?? '0.00';
    reissueContext = {
      tenantId: order.tenantId,
      dueDate: options.dueDate ?? current.dueDate,
      amount,
    };
  }

  // ONE transaction for the whole correction. Voiding, reissuing and moving the
  // money are a single business act: a failure part-way through used to leave a
  // voided invoice with no replacement and its payments stranded, recoverable
  // only out of band. Now it either all lands or nothing does.
  return db.transaction(async (tx) => {
    const [voided] = await tx
      .update(invoices)
      .set({ status: 'VOID', updatedAt: new Date() })
      .where(eq(invoices.id, current.id))
      .returning();

    // Park the payments as part of the same unit: if the reissue below fails,
    // the rollback restores them onto the still-live original.
    await parkInvoicePayments(tx, orderId, current.id);

    if (options.reissue === false) {
      return { voided: voided!, replacement: null };
    }

    // The per-order index is partial on `status <> 'VOID'`, so voiding freed the
    // slot while the voided row stays on file for audit.
    const context = reissueContext!;
    const replacement = await insertInvoiceWithRetry({
      executor: tx,
      orderId,
      tenantId: context.tenantId,
      dueDate: context.dueDate,
      amount: context.amount,
      // Carry the tranche identity through the correction, or the replacement
      // would take the unscheduled slot and coexist with its own voided tranche.
      tranche: current.trancheSeq == null
        ? null
        : {
            scheduleId: current.scheduleId,
            seq: current.trancheSeq,
            label: current.trancheLabel,
            percent: current.tranchePercent ?? '0',
          },
    });
    if (!replacement) {
      // Lost the per-order slot to a concurrent issuer; re-read theirs.
      const [concurrent] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.orderId, orderId), notInArray(invoices.status, ['VOID', 'DRAFT'])))
        .orderBy(desc(invoices.createdAt))
        .limit(1);
      if (!concurrent) throw new InvoiceNumberAllocationError(orderId);
      await claimUnallocatedPayments(tx, orderId, concurrent.id);
      await recomputeInvoiceAmountPaid(concurrent.id, tx);
      return { voided: voided!, replacement: concurrent };
    }

    await claimUnallocatedPayments(tx, orderId, replacement.id);
    await recomputeInvoiceAmountPaid(replacement.id, tx);

    const [settled] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, replacement.id))
      .limit(1);

    return { voided: voided!, replacement: settled ?? replacement };
  });
}

/**
 * Park an invoice's payments (`invoiceId -> NULL`) so the next issuance, which
 * claims unallocated payments, re-attaches them. Used whenever an invoice stops
 * being the order's live one and no replacement exists yet.
 */
async function parkInvoicePayments(
  executor: Executor,
  orderId: string,
  invoiceId: string,
): Promise<void> {
  await executor
    .update(customerPayments)
    .set({ invoiceId: null })
    .where(and(eq(customerPayments.orderId, orderId), eq(customerPayments.invoiceId, invoiceId)));
}

/**
 * Attach the order's unallocated payments across its live invoices.
 *
 * With tranches there is no single target, so money recorded before issuance is
 * applied oldest-tranche-first until it runs out — which is what a deposit
 * payment is normally for. Each affected invoice is recomputed afterwards.
 */
async function allocateUnallocatedPayments(orderId: string, executor: Executor = db): Promise<void> {
  const [unallocated, targets] = await Promise.all([
    executor.select({ id: customerPayments.id, amount: customerPayments.amount })
      .from(customerPayments)
      .where(and(eq(customerPayments.orderId, orderId), isNull(customerPayments.invoiceId)))
      .orderBy(asc(customerPayments.receivedAt)),
    executor.select({ id: invoices.id, amount: invoices.amount, amountPaid: invoices.amountPaid })
      .from(invoices)
      .where(and(eq(invoices.orderId, orderId), notInArray(invoices.status, ['VOID', 'DRAFT'])))
      .orderBy(asc(invoices.trancheSeq), asc(invoices.createdAt)),
  ]);

  if (unallocated.length === 0 || targets.length === 0) return;

  // What each target still needs, so money already covering a tranche is not
  // double-counted when a second payment arrives.
  const outstanding = targets.map((target) =>
    Math.max(0, (parseFloat(String(target.amount ?? 0)) || 0) - (parseFloat(String(target.amountPaid ?? 0)) || 0)));

  for (const payment of unallocated) {
    let remaining = parseFloat(String(payment.amount ?? 0)) || 0;
    // A payment row carries ONE invoiceId, so money that straddles tranches is
    // written as one row per tranche it covers. Parking the whole amount on the
    // first tranche would leave the balance invoice reading 0 paid while
    // collections chases money already banked.
    const parts: Array<{ invoiceId: string; amount: number }> = [];
    for (let index = 0; index < targets.length && remaining > 0.004; index++) {
      if (outstanding[index]! <= 0) continue;
      const applied = Math.min(remaining, outstanding[index]!);
      outstanding[index] = outstanding[index]! - applied;
      remaining -= applied;
      parts.push({ invoiceId: targets[index]!.id, amount: applied });
    }

    if (parts.length === 0) {
      // Nothing outstanding anywhere (an overpayment): park it on the oldest
      // invoice so the money stays visible instead of vanishing.
      await executor.update(customerPayments).set({ invoiceId: targets[0]!.id }).where(eq(customerPayments.id, payment.id));
      await recomputeInvoiceAmountPaid(targets[0]!.id, executor);
      continue;
    }

    // Split off the overflow as sibling rows sharing the first row's identity,
    // so the sum of the order's payment rows is preserved exactly.
    const [keeper, ...rest] = parts;
    await executor.update(customerPayments)
      .set({ invoiceId: keeper!.invoiceId, amount: keeper!.amount.toFixed(2) })
      .where(eq(customerPayments.id, payment.id));
    if (rest.length > 0) {
      const [source] = await executor
        .select()
        .from(customerPayments)
        .where(eq(customerPayments.id, payment.id))
        .limit(1);
      if (source) {
        const remainder = remaining > 0.004 ? remaining : 0;
        // Every part points at the row the trader recorded, so the receipt keeps
        // its identity: one bank credit, not N phantom receipts. ON DELETE
        // CASCADE on that link means deleting the receipt removes its parts.
        await executor.insert(customerPayments).values(rest.map((part) => ({
          tenantId: source.tenantId,
          customerId: source.customerId,
          orderId: source.orderId,
          invoiceId: part.invoiceId,
          amount: part.amount.toFixed(2),
          currency: source.currency,
          receivedAt: source.receivedAt,
          method: source.method,
          note: source.note,
          createdBy: source.createdBy,
          splitParentId: payment.id,
        })));
        if (remainder > 0) {
          await executor.insert(customerPayments).values({
            tenantId: source.tenantId,
            customerId: source.customerId,
            orderId: source.orderId,
            invoiceId: keeper!.invoiceId,
            amount: remainder.toFixed(2),
            currency: source.currency,
            receivedAt: source.receivedAt,
            method: source.method,
            note: source.note,
            createdBy: source.createdBy,
            splitParentId: payment.id,
          });
        }
      }
    }
    for (const part of parts) await recomputeInvoiceAmountPaid(part.invoiceId, executor);
  }
}

/** Attach the order's unallocated payments to the invoice that is now live. */
async function claimUnallocatedPayments(
  executor: Executor,
  orderId: string,
  invoiceId: string,
): Promise<number> {
  const claimed = await executor
    .update(customerPayments)
    .set({ invoiceId })
    .where(and(eq(customerPayments.orderId, orderId), isNull(customerPayments.invoiceId)))
    .returning({ id: customerPayments.id });
  return claimed.length;
}

/**
 * Insert a new invoice row, retrying when the global `invoice_number` collides.
 *
 * `onConflictDoNothing()` cannot say WHICH unique constraint it swallowed, and
 * there are two: the per-order index means another issuer already produced this
 * order's invoice (return null, the caller re-reads theirs), while the global
 * `invoice_number` means the counter and the table disagree (retry with a fresh
 * number). Shared by issuance and reissue so the two cannot drift apart.
 */
async function insertInvoiceWithRetry(params: {
  executor?: Executor;
  orderId: string;
  tenantId: string;
  dueDate: string;
  amount: string;
  tranche?: {
    /** Null when the tranche's schedule row was cleared after issuance. */
    scheduleId: string | null;
    seq: number;
    label: string | null;
    percent: string;
  } | null;
}): Promise<typeof invoices.$inferSelect | null> {
  const dbc = params.executor ?? db;
  const trancheSeq = params.tranche?.seq ?? null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const [created] = await dbc
      .insert(invoices)
      .values({
        orderId: params.orderId,
        invoiceNumber: await allocateInvoiceNumber(params.tenantId),
        status: 'SENT',
        dueDate: params.dueDate,
        amount: params.amount,
        amountPaid: '0',
        scheduleId: params.tranche?.scheduleId ?? null,
        trancheSeq,
        trancheLabel: params.tranche?.label ?? null,
        tranchePercent: params.tranche?.percent ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (created) return created;

    // The conflict is either this slot (another issuer won it — return null and
    // let the caller re-read theirs) or the global invoice_number (the counter
    // and the table disagree — retry with a fresh number).
    const [liveForSlot] = await dbc
      .select()
      .from(invoices)
      .where(and(
        eq(invoices.orderId, params.orderId),
        trancheSeq == null
          ? isNull(invoices.trancheSeq)
          : eq(invoices.trancheSeq, trancheSeq),
        notInArray(invoices.status, ['VOID', 'DRAFT']),
      ))
      .limit(1);
    if (liveForSlot) return null;
  }

  throw new InvoiceNumberAllocationError(params.orderId);
}

/**
 * The order's lines no longer add up to the amount frozen on its invoice.
 *
 * Rendering would produce a document whose visible lines do not sum to its own
 * total, so the correction path (void + reissue) is required instead. Refusing
 * is the honest outcome: a legal artifact must reconcile with itself.
 */
export class InvoiceLinesChangedError extends Error {
  constructor(orderId: string, frozenTotal: string, linesTotal: string) {
    super(
      `The order's line items no longer match its issued invoice (invoice ${frozenTotal}, lines ${linesTotal}). Void and reissue the invoice to correct it.`,
    );
    this.name = 'InvoiceLinesChangedError';
    void orderId;
  }
}

/** The counter kept colliding with existing rows; a genuine error, not a flake. */
export class InvoiceNumberAllocationError extends Error {
  constructor(orderId: string) {
    super(`Could not allocate a unique invoice number for order ${orderId} after 5 attempts`);
    this.name = 'InvoiceNumberAllocationError';
  }
}

/**
 * The order has several live invoices (split payment terms) and the caller did
 * not say which one to act on. Voiding an arbitrary tranche would be wrong, so
 * the caller must disambiguate by invoice id.
 */
export class AmbiguousInvoiceError extends Error {
  constructor(orderId: string, liveCount: number) {
    super(`Order ${orderId} has ${liveCount} live invoices (one per tranche) — specify which invoice to void`);
    this.name = 'AmbiguousInvoiceError';
    void orderId;
  }
}

/**
 * A scheduled order has no invoiceable value yet (unpriced line items), so its
 * tranches would each bill zero. Callers surface this to the trader.
 */
export class UnpricedScheduleError extends Error {
  constructor(orderId: string) {
    super(`Price the line items before issuing this order's invoice schedule (order ${orderId})`);
    this.name = 'UnpricedScheduleError';
    void orderId;
  }
}

/** Thrown when an order has no invoice to act on. */
export class InvoiceNotFoundError extends Error {
  constructor(orderId: string) {
    super(`No invoice exists for order ${orderId}`);
    this.name = 'InvoiceNotFoundError';
  }
}

/** Thrown when the invoice is already void. */
export class InvoiceAlreadyVoidError extends Error {
  constructor(invoiceNumber: string) {
    super(`Invoice ${invoiceNumber} is already void`);
    this.name = 'InvoiceAlreadyVoidError';
  }
}

/**
 * Create the order's invoice row if absent, and return it.
 *
 * Called from the final-invoice issuance paths. Idempotent: a second call
 * returns the existing row untouched, so regenerating the PDF neither burns an
 * invoice number nor moves the due date.
 *
 * Concurrency: the early return alone cannot stop two simultaneous issuances
 * (two tabs, a double-click, a retried request). The `invoices_one_live_per_tranche`
 * unique index is the real guarantee — the loser of the race inserts nothing
 * and re-reads the winner's row. That costs one burned sequence number, which
 * is the correct trade: invoice numbers must never be reused.
 */
export async function ensureOrderInvoice(orderId: string): Promise<typeof invoices.$inferSelect> {
  // The LIVE invoice, not merely the first one: a voided invoice stays on file
  // for audit and must never be handed out as the order's current invoice, or a
  // regenerate after a void/reissue would print the voided document.
  const [probe] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), notInArray(invoices.status, ['VOID', 'DRAFT'])))
    .limit(1);
  if (probe) {
    // Issuance is transactional, so a live invoice means the whole schedule was
    // written. Still re-claim and recompute: both are idempotent, and a crash
    // between issuance and settlement is only recoverable here.
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.orderId, orderId), notInArray(invoices.status, ['VOID', 'DRAFT'])))
        .orderBy(asc(invoices.trancheSeq), asc(invoices.createdAt))
        .limit(1);
      if (!existing) throw new InvoiceNumberAllocationError(orderId);
      await allocateUnallocatedPayments(orderId, tx);
      const [settled] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, existing.id))
        .limit(1);
      return settled ?? existing;
    });
  }

  const [order] = await db
    .select({
      id: orders.id,
      tenantId: orders.tenantId,
      orderKind: orders.orderKind,
      customerPaymentTermType: orders.customerPaymentTermType,
      customerCreditDays: orders.customerCreditDays,
      eta: orders.eta,
      deliveredAt: orders.deliveredAt,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) throw new Error(`Order ${orderId} not found`);
  // Internal transfers settle through the transfer record between our own
  // companies — they are not customer receivables.
  if (order.orderKind === 'INTERNAL_TRANSFER') {
    throw new InternalTransferHasNoInvoiceError(orderId);
  }

  // Split payment terms: issue one invoice per scheduled tranche. An order with
  // no schedule falls through to the single-invoice behaviour below — the whole
  // deal on the order's own customer terms.
  const tranches = await listOrderPaymentSchedule(orderId);
  if (tranches.length > 0) {
    const orderTotal = parseFloat(await computeInvoiceAmount(orderId)) || 0;
    // A schedule divides the deal's value; with no priced lines there is nothing
    // to divide, and issuing would burn one invoice number per tranche on
    // zero-value documents that are not receivables.
    if (orderTotal <= 0) {
      throw new UnpricedScheduleError(orderId);
    }
    const percents = tranches.map((tranche) => parseFloat(tranche.percent) || 0);
    // ONE transaction for the whole schedule. Issuing tranches one by one meant a
    // failure between them left a half-billed order that the idempotent path
    // could never complete -- the customer would never receive the balance.
    return await db.transaction(async (tx) => {
      for (const [index, tranche] of tranches.entries()) {
        await insertInvoiceWithRetry({
          executor: tx,
          orderId,
          tenantId: order.tenantId,
          dueDate: tranche.dueDate ?? computeInvoiceDueDate(
            order.deliveredAt ?? order.eta,
            order.customerPaymentTermType,
            order.customerCreditDays,
          ),
          // The last tranche absorbs rounding so the parts sum to the total.
          amount: splitAmountByPercent(orderTotal, percents, index),
          tranche: {
            scheduleId: tranche.id,
            seq: tranche.seq,
            label: tranche.label,
            percent: tranche.percent,
          },
        });
      }

      // Settle once across every tranche: money taken before issuance is
      // unattached and may cover any of them.
      await allocateUnallocatedPayments(orderId, tx);
      const [first] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.orderId, orderId), notInArray(invoices.status, ['VOID', 'DRAFT'])))
        .orderBy(asc(invoices.trancheSeq), asc(invoices.createdAt))
        .limit(1);
      if (!first) throw new InvoiceNumberAllocationError(orderId);
      return first;
    });
  }

  const dueDate = computeInvoiceDueDate(
    order.deliveredAt ?? order.eta,
    order.customerPaymentTermType,
    order.customerCreditDays,
  );
  const amount = await computeInvoiceAmount(orderId);

  const created = await insertInvoiceWithRetry({ orderId, tenantId: order.tenantId, dueDate, amount });
  if (created) {
    // Claim payments recorded before this invoice existed (a trader can take
    // payment on delivery before issuing the PDF). Without this they stay
    // unallocated forever and collections chases money already received.
    await claimUnallocatedPayments(db, orderId, created.id);
    await recomputeInvoiceAmountPaid(created.id);

    const [settled] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, created.id))
      .limit(1);
    return settled ?? created;
  }

  // Another issuer won the per-order slot; theirs is this order's invoice.
  const [raced] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), notInArray(invoices.status, ['VOID', 'DRAFT'])))
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  if (!raced) throw new InvoiceNumberAllocationError(orderId);
  return raced;
}

/**
 * Marks the one issuance refusal that callers are expected to handle rather
 * than treat as an outage. Callers must catch THIS type specifically — a bare
 * catch would swallow a transient database failure and email a document that
 * was never recorded as a receivable.
 */
export class InternalTransferHasNoInvoiceError extends Error {
  constructor(orderId: string) {
    super('Internal transfer orders do not issue customer invoices');
    this.name = 'InternalTransferHasNoInvoiceError';
    void orderId;
  }
}

/**
 * The order's live invoices, in tranche order. Unscheduled orders have exactly
 * one; split payment terms have one per tranche. Every reader that means "the
 * order's invoice" must go through this so they agree on ordering and on which
 * documents exist.
 */
export async function listLiveOrderInvoices(
  orderId: string,
  executor: Executor = db,
): Promise<Array<typeof invoices.$inferSelect>> {
  return executor
    .select()
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), notInArray(invoices.status, ['VOID', 'DRAFT'])))
    .orderBy(asc(invoices.trancheSeq), asc(invoices.createdAt));
}

/**
 * Recompute one invoice's `amountPaid` from the payments stamped on that
 * invoice. Scoped by invoice id: a payment settles ONE invoice, so the
 * order-wide sum must never be written onto every row of the order.
 */
export async function recomputeInvoiceAmountPaid(invoiceId: string, executor?: Executor): Promise<void> {
  const dbc = executor ?? db;
  // Sum as numeric: routing numeric(14,2) through float64 and back can drift a
  // cent on a long payment history.
  const [row] = await dbc
    .select({ total: sql<string>`COALESCE(SUM(amount), 0)::numeric(14,2)::text` })
    .from(sql`customer_payments`)
    .where(sql`invoice_id = ${invoiceId}`);

  const amountPaid = (parseFloat(row?.total ?? '0') || 0).toFixed(2);
  const [invoice] = await dbc
    .select({ status: invoices.status, amount: invoices.amount })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);

  await dbc
    .update(invoices)
    .set({
      amountPaid,
      ...(invoice ? { status: deriveInvoiceStatus(invoice.status, invoice.amount, amountPaid) as never } : {}),
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId));
}

/**
 * Derive the stored status from the amounts the invoice actually carries.
 *
 * `status` is written at issuance ('SENT') and this is its only other writer.
 * OVERDUE is deliberately never stored: it is a function of today's date, and a
 * stored flag goes stale the moment the clock moves — readers derive it from
 * dueDate instead (see deriveInvoiceDisplayStatus).
 */
export function deriveInvoiceStatus(
  current: string,
  amount: string | null,
  amountPaid: string | null,
): 'DRAFT' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'VOID' {
  if (current === 'VOID' || current === 'DRAFT') return current;

  const paid = parseFloat(String(amountPaid ?? 0)) || 0;

  if (isInvoiceSettled(amount, amountPaid)) return 'PAID';
  if (paid > 0) return 'PARTIALLY_PAID';
  return 'SENT';
}

/**
 * Status as a reader should see it, for a given snapshot of the clock.
 *
 * The single shared derivation for every invoice reader (collections widget,
 * Invoice Aging report). It must NOT branch on the stored `status` for payment
 * state: that column only moves when a payment is recorded through the app, so
 * a row backfilled or adjusted out-of-band (imported history, a direct UPDATE,
 * the seed) carries a stale value while its amounts are already right. Amounts
 * are the truth; the stored flag is a cache.
 */
export function deriveInvoiceDisplayStatus(
  invoice: { status: string; amount: string | null; amountPaid: string | null },
  daysOverdue: number,
): 'DRAFT' | 'SENT' | 'OVERDUE' | 'PARTIALLY_PAID' | 'PAID' | 'VOID' {
  const paid = parseFloat(String(invoice.amountPaid ?? 0)) || 0;

  // VOID wins over everything: a voided invoice is not a receivable, and its
  // amounts are whatever they were when it was voided. DRAFT is not yet issued.
  if (invoice.status === 'VOID' || invoice.status === 'DRAFT') return invoice.status;

  if (isInvoiceSettled(invoice.amount, invoice.amountPaid)) return 'PAID';
  // Overdue outranks partially paid: the caller's `daysOverdue` is what tells
  // the collections view this one needs chasing today.
  if (daysOverdue > 0) return 'OVERDUE';
  return paid > 0 ? 'PARTIALLY_PAID' : 'SENT';
}

/**
 * Which invoice a payment attaches to.
 *
 * One invoice per order today, so this is simply that invoice. Phase 1 may issue
 * several tranches; when it does, the oldest invoice still carrying a balance is
 * the natural default and this is the single place to change.
 */
export async function resolvePaymentInvoiceTarget(
  orderId: string,
): Promise<typeof invoices.$inferSelect | null> {
  const candidates = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), notInArray(invoices.status, ['VOID', 'DRAFT'])))
    // Tranche order, not creation order: the deposit is tranche 1 regardless of
    // which row happened to be inserted first.
    .orderBy(asc(invoices.trancheSeq), asc(invoices.createdAt));

  if (!candidates.length) return null;

  return candidates.find((row) => !isInvoiceSettled(row.amount, row.amountPaid))
    ?? candidates[candidates.length - 1]!;
}
