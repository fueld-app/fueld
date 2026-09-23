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
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '../../db';
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
export async function computeInvoiceAmount(orderId: string): Promise<string> {
  const items = await db
    .select({
      id: orderItems.id,
      productType: orderItems.productType,
      hideOnDocuments: orderItems.hideOnDocuments,
      salesPrice: orderItems.salesPrice,
      salesCurrency: orderItems.salesCurrency,
      deliveredQuantity: orderItems.deliveredQuantity,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.sortOrder), asc(orderItems.createdAt));

  const billable = customerFacingItems(items);
  // `invoices` carries a single scalar amount with no currency column, so a
  // mixed-currency order cannot be expressed as one number. Refuse rather than
  // freeze a meaningless blended total that later gets compared against
  // single-currency payments.
  const currencies = new Set(
    billable.map((item) => (item.salesCurrency ?? '').toUpperCase()).filter(Boolean),
  );
  if (currencies.size > 1) {
    throw new MixedCurrencyInvoiceError([...currencies].sort());
  }

  // Sum the billable rows in the database as numeric: quantities are
  // numeric(14,6) and prices numeric(14,7), and routing those through float64
  // (or doing it in JS) can drift a cent on a large order. The same reasoning
  // already applies to recomputeInvoiceAmountPaid.
  const conditions = [eq(orderItems.orderId, orderId)];
  if (billable.length !== items.length) {
    // Some rows are excluded (hidden / credit-note placeholders), so the sum has
    // to run over exactly the billable ids rather than the whole order.
    conditions.push(inArray(orderItems.id, billable.map((item) => item.id)));
  }

  const [row] = await db
    .select({
      total: sql<string>`COALESCE(SUM(coalesce(${orderItems.deliveredQuantity}, ${orderItems.quantity})::numeric * coalesce(${orderItems.salesPrice}, 0)::numeric), 0)::numeric(14,2)::text`,
    })
    .from(orderItems)
    .where(and(...conditions));

  return row?.total ?? '0.00';
}

/** Callers must surface this to the user; it is a data problem, not an outage. */
export class MixedCurrencyInvoiceError extends Error {
  constructor(public readonly currencies: string[]) {
    super(`Cannot invoice an order with mixed line currencies (${currencies.join(', ')})`);
    this.name = 'MixedCurrencyInvoiceError';
  }
}

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
  options: { reissue?: boolean; dueDate?: string } = {},
): Promise<{ voided: typeof invoices.$inferSelect; replacement: typeof invoices.$inferSelect | null }> {
  const [current] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), ne(invoices.status, 'VOID')))
    .orderBy(asc(invoices.createdAt))
    .limit(1);

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

  const [voided] = await db
    .update(invoices)
    .set({ status: 'VOID', updatedAt: new Date() })
    .where(eq(invoices.id, current.id))
    .returning();

  if (options.reissue === false) {
    // Park the order's payments (invoiceId -> NULL) rather than leaving them
    // stamped on the voided row. The next issuance claims unallocated payments,
    // so money already received is re-attached instead of being stranded on a
    // void invoice and chased again by collections.
    await db
      .update(customerPayments)
      .set({ invoiceId: null })
      .where(and(eq(customerPayments.orderId, orderId), eq(customerPayments.invoiceId, current.id)));
    return { voided: voided!, replacement: null };
  }

  // The per-order index is partial on `status <> 'VOID'`, so voiding frees the
  // slot while the voided row stays on file for audit.
  const [order] = await db
    .select({
      tenantId: orders.tenantId,
      customerPaymentTermType: orders.customerPaymentTermType,
      customerCreditDays: orders.customerCreditDays,
      eta: orders.eta,
      deliveredAt: orders.deliveredAt,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) throw new Error(`Order ${orderId} not found`);

  const [replacement] = await db
    .insert(invoices)
    .values({
      orderId,
      invoiceNumber: await allocateInvoiceNumber(order.tenantId),
      status: 'SENT',
      // Keep the date the customer was already told to pay unless the caller is
      // explicitly correcting it. Recomputing from the order's current terms
      // would silently move a communicated deadline (the drift that freezing
      // the due date at issuance exists to prevent).
      dueDate: options.dueDate ?? current.dueDate,
      amount: await computeInvoiceAmount(orderId),
      amountPaid: '0',
    })
    .returning();

  if (!replacement) throw new Error(`Failed to reissue invoice for order ${orderId}`);

  // Move ALL of the order's money onto the replacement: the rows stamped on the
  // voided invoice, plus anything recorded while no live invoice existed (a
  // payment taken in the void→reissue window lands with invoiceId null).
  await db
    .update(customerPayments)
    .set({ invoiceId: replacement.id })
    .where(and(
      eq(customerPayments.orderId, orderId),
      or(eq(customerPayments.invoiceId, current.id), isNull(customerPayments.invoiceId)),
    ));
  await recomputeInvoiceAmountPaid(replacement.id);

  const [settled] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, replacement.id))
    .limit(1);

  return { voided: voided!, replacement: settled ?? replacement };
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
 * Due date for the whole-order invoice.
 *
 * CREDIT → delivery anchor + credit days (the trader's "delivery date + credit
 * days"); COD/PREPAY → payment is due on the anchor itself, not 30 days later
 * (the old PDF fallback silently granted COD orders a credit term).
 */
export function computeInvoiceDueDate(
  anchor: Date | string | null,
  paymentTermType: string | null,
  creditDays: number | null,
  issuedAt = new Date(),
): string {
  const parsedAnchor = anchor == null ? null : new Date(String(anchor));
  const anchorDay = parsedAnchor && !Number.isNaN(parsedAnchor.getTime())
    ? new Date(Date.UTC(parsedAnchor.getUTCFullYear(), parsedAnchor.getUTCMonth(), parsedAnchor.getUTCDate()))
    : null;
  const base = anchorDay ?? new Date(Date.UTC(issuedAt.getUTCFullYear(), issuedAt.getUTCMonth(), issuedAt.getUTCDate()));

  if (paymentTermType === 'COD' || paymentTermType === 'PREPAY') {
    return base.toISOString().split('T')[0]!;
  }

  const days = paymentTermType === 'CREDIT' ? (creditDays ?? 30) : 30;
  return new Date(base.getTime() + days * 86_400_000).toISOString().split('T')[0]!;
}

/**
 * Create the order's invoice row if absent, and return it.
 *
 * Called from the final-invoice issuance paths. Idempotent: a second call
 * returns the existing row untouched, so regenerating the PDF neither burns an
 * invoice number nor moves the due date.
 *
 * Concurrency: the early return alone cannot stop two simultaneous issuances
 * (two tabs, a double-click, a retried request). The `invoices_one_per_order`
 * unique index is the real guarantee — the loser of the race inserts nothing
 * and re-reads the winner's row. That costs one burned sequence number, which
 * is the correct trade: invoice numbers must never be reused.
 */
export async function ensureOrderInvoice(orderId: string): Promise<typeof invoices.$inferSelect> {
  // The LIVE invoice, not merely the first one: a voided invoice stays on file
  // for audit and must never be handed out as the order's current invoice, or a
  // regenerate after a void/reissue would print the voided document.
  const [existing] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), ne(invoices.status, 'VOID')))
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  if (existing) return existing;

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

  const dueDate = computeInvoiceDueDate(
    order.deliveredAt ?? order.eta,
    order.customerPaymentTermType,
    order.customerCreditDays,
  );
  const amount = await computeInvoiceAmount(orderId);

  // `onConflictDoNothing()` cannot say WHICH unique constraint it swallowed, and
  // there are two: the per-order index (another issuer won — nothing to do but
  // return their row) and the global invoice_number (the counter and the table
  // disagree — retry with a fresh number rather than failing). Retry a bounded
  // number of times; a persistent collision is a genuine error, not a flake.
  let created: typeof invoices.$inferSelect | undefined;
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    [created] = await db
      .insert(invoices)
      .values({
        orderId,
        invoiceNumber: await allocateInvoiceNumber(order.tenantId),
        status: 'SENT',
        dueDate,
        amount,
        amountPaid: '0',
      })
      .onConflictDoNothing()
      .returning();
    if (created) break;

    // No row for this order ⇒ the conflict was the invoice number, not the
    // per-order index, so a fresh number is the right response.
    const [existingForOrder] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.orderId, orderId), ne(invoices.status, 'VOID')))
      .orderBy(desc(invoices.createdAt))
      .limit(1);
    if (existingForOrder) return existingForOrder;
  }

  if (created) {
    // Claim payments recorded before this invoice existed (a trader can take
    // payment on delivery before issuing the PDF). Without this they stay
    // unallocated forever and collections chases money already received.
    await db
      .update(customerPayments)
      .set({ invoiceId: created.id })
      .where(and(eq(customerPayments.orderId, orderId), isNull(customerPayments.invoiceId)));
    await recomputeInvoiceAmountPaid(created.id);

    const [settled] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, created.id))
      .limit(1);
    return settled ?? created;
  }

  // Exhausted the retries: the counter keeps colliding with existing rows.
  // Surface what actually happened instead of a misleading race message.
  const [raced] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), ne(invoices.status, 'VOID')))
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  if (raced) return raced;
  throw new Error(
    `Could not allocate a unique invoice number for order ${orderId} after 5 attempts`,
  );
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
 * Recompute one invoice's `amountPaid` from the payments stamped on that
 * invoice. Scoped by invoice id: a payment settles ONE invoice, so the
 * order-wide sum must never be written onto every row of the order.
 */
export async function recomputeInvoiceAmountPaid(invoiceId: string): Promise<void> {
  // Sum as numeric: routing numeric(14,2) through float64 and back can drift a
  // cent on a long payment history.
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(amount), 0)::numeric(14,2)::text` })
    .from(sql`customer_payments`)
    .where(sql`invoice_id = ${invoiceId}`);

  const amountPaid = (parseFloat(row?.total ?? '0') || 0).toFixed(2);
  const [invoice] = await db
    .select({ status: invoices.status, amount: invoices.amount })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);

  await db
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
    .where(and(eq(invoices.orderId, orderId), ne(invoices.status, 'VOID')))
    .orderBy(asc(invoices.createdAt));

  if (!candidates.length) return null;

  return candidates.find((row) => !isInvoiceSettled(row.amount, row.amountPaid))
    ?? candidates[candidates.length - 1]!;
}
