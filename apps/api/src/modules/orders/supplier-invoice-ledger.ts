/**
 * Supplier-invoice ledger primitives: status derivation, settlement recompute,
 * and linking a receipt to an invoice.
 *
 * Why this is its own module rather than part of `supplier-invoice.service.ts`:
 * `orders.service` (which records supplier payments) needs to link a receipt to
 * an invoice, and the issuing service needs the whole supplier commission
 * report, which needs `orders.service`. Putting the link in the issuing service
 * therefore created the cycle
 *
 *     orders.service -> supplier-invoice.service -> reports.service -> orders.service
 *
 * which fails at RUNTIME as an undefined import, not at typecheck. This module
 * depends on nothing but the database, so both sides can use it and the graph
 * stays acyclic:
 *
 *     supplier-invoice-ledger <- orders.service
 *                             <- supplier-invoice.service <- reports.service
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db';
import { supplierInvoices, supplierPayments } from '../../db/schema';

/** Half a cent — amounts are stated in whole cents. */
const SETTLEMENT_EPSILON = 0.005;

/**
 * Status as a reader should see it, derived from the amounts and the clock.
 *
 * Amounts are the truth; the stored `status` is a cache that only moves when a
 * payment is recorded through the app, so a row adjusted out-of-band carries a
 * stale value while its amounts are already right.
 */
export function deriveSupplierInvoiceStatus(
  invoice: { status: string; amount: string; amountReceived: string },
  daysOverdue: number,
): 'DRAFT' | 'SENT' | 'OVERDUE' | 'PARTIALLY_PAID' | 'PAID' | 'VOID' {
  if (invoice.status === 'VOID' || invoice.status === 'DRAFT') return invoice.status as 'VOID' | 'DRAFT';

  const received = parseFloat(String(invoice.amountReceived ?? 0)) || 0;
  const amount = parseFloat(String(invoice.amount ?? 0)) || 0;

  if (amount > 0 && received + SETTLEMENT_EPSILON >= amount) return 'PAID';
  // A zero-value invoice is settled by definition — nothing to collect.
  if (amount <= 0 && received <= 0) return 'PAID';
  // Overdue outranks partially paid: this is the flag that says "chase it".
  if (daysOverdue > 0) return 'OVERDUE';
  return received > 0 ? 'PARTIALLY_PAID' : 'SENT';
}

/**
 * Recompute `amount_received` from the receipts actually recorded, then rewrite
 * the stored status cache. Idempotent, so it is safe on any read or write path.
 */
export async function recomputeSupplierInvoiceReceived(invoiceId: string): Promise<void> {
  const [invoice] = await db
    .select({ id: supplierInvoices.id, status: supplierInvoices.status, amount: supplierInvoices.amount })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, invoiceId))
    .limit(1);
  if (!invoice) return;

  const [invoiceCurrency] = await db
    .select({ currency: supplierInvoices.currency })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, invoiceId))
    .limit(1);

  /**
   * Only receipts in the invoice's own currency count.
   *
   * `supplier_payments` carries its own currency and nothing converts between
   * them, so summing a EUR receipt into a USD invoice would add 1:1 and could
   * silently mark it PAID. The report already refuses to mix currencies for the
   * same reason; this is the settlement-side equivalent.
   */
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${supplierPayments.amount}), 0)::numeric(14,2)::text` })
    .from(supplierPayments)
    .where(
      and(
        eq(supplierPayments.supplierInvoiceId, invoiceId),
        eq(supplierPayments.currency, invoiceCurrency?.currency ?? ''),
      ),
    );

  const received = row?.total ?? '0.00';
  const nextStatus = deriveSupplierInvoiceStatus(
    { status: invoice.status, amount: invoice.amount ?? '0', amountReceived: received },
    0,
  );

  await db
    .update(supplierInvoices)
    .set({
      amountReceived: received,
      // OVERDUE is a display state, never stored.
      status: nextStatus === 'OVERDUE' ? 'SENT' : nextStatus,
      updatedAt: new Date(),
    })
    .where(eq(supplierInvoices.id, invoiceId));
}

/**
 * Link a receipt from a supplier to a supplier invoice (or clear the link), then
 * recompute both the old and the new invoice. Kept in one place so the link and
 * the received amount can never drift apart.
 */
export async function applySupplierPaymentToInvoice(
  paymentId: string,
  invoiceId: string | null,
): Promise<void> {
  const [payment] = await db
    .select({ id: supplierPayments.id, previousInvoiceId: supplierPayments.supplierInvoiceId })
    .from(supplierPayments)
    .where(eq(supplierPayments.id, paymentId))
    .limit(1);
  if (!payment) return;

  if (invoiceId) {
    // Refuse a mismatch here rather than letting it be silently ignored by the
    // sum below: the operator must learn now, not discover a shortfall later.
    const [mismatch] = await db
      .select({ paymentCurrency: supplierPayments.currency, invoiceCurrency: supplierInvoices.currency })
      .from(supplierPayments)
      .innerJoin(supplierInvoices, eq(supplierInvoices.id, invoiceId))
      .where(eq(supplierPayments.id, paymentId))
      .limit(1);
    if (
      mismatch
      && (mismatch.paymentCurrency ?? '').toUpperCase() !== (mismatch.invoiceCurrency ?? '').toUpperCase()
    ) {
      throw new Error(
        `Payment is in ${mismatch.paymentCurrency} but the invoice is in ${mismatch.invoiceCurrency}; they cannot be settled against each other.`,
      );
    }
  }

  await db
    .update(supplierPayments)
    .set({ supplierInvoiceId: invoiceId, updatedAt: new Date() })
    .where(eq(supplierPayments.id, paymentId));

  const affected = new Set<string>();
  if (payment.previousInvoiceId) affected.add(payment.previousInvoiceId);
  if (invoiceId) affected.add(invoiceId);
  for (const id of affected) await recomputeSupplierInvoiceReceived(id);
}
