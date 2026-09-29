/**
 * Supplier-invoice ledger primitives: status derivation, settlement recompute,
 * recording and removing a receipt.
 *
 * Why this is its own module rather than part of `supplier-invoice.service.ts`:
 * `orders.service` and the supplier-invoice routes both need these, and the
 * issuing service needs the whole supplier commission report, which needs
 * `orders.service`. Putting them in the issuing service created the cycle
 *
 *     orders.service -> supplier-invoice.service -> reports.service -> orders.service
 *
 * which fails at RUNTIME as an undefined import, not at typecheck. This module
 * depends on nothing but the database, so the graph stays acyclic.
 *
 * ── Direction ──────────────────────────────────────────────────────────────
 * Receipts live in `supplier_receipts`, NOT in `supplier_payments`. That table
 * is the outbound ledger and every reader sums it as "money we paid a supplier",
 * so a receipt parked there counted as money paid out. Direction is a property
 * of the table, not of a filter someone has to remember.
 *
 * ── Tenancy ────────────────────────────────────────────────────────────────
 * Every function here takes `tenantId` and ANDs it into its own WHERE, even
 * though the routes already check ownership. These are money WRITES; they must
 * not be correct only because every caller remembered to check first.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { db as Db } from '../../db';
import { db } from '../../db';
import { supplierInvoices, supplierReceipts } from '../../db/schema';

/** Half a cent — amounts are stated in whole cents. */
const SETTLEMENT_EPSILON = 0.005;

/**
 * Status as a reader should see it, derived from the amounts and the clock.
 *
 * Amounts are the truth; the stored `status` is a cache that only moves when a
 * receipt is recorded through the app, so a row adjusted out-of-band carries a
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

/** How a receipt is refused, so the route can answer 400 rather than 500. */
export class SupplierReceiptError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'SupplierReceiptError';
  }
}

/** Whole cents only, and no silent rounding of a longer amount. */
function toCents(amount: string): number {
  const raw = String(amount ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    throw new SupplierReceiptError('Receipt amount must be a positive number with at most 2 decimals');
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new SupplierReceiptError('Receipt amount must be greater than zero');
  }
  return Math.round(value * 100);
}

type Executor = Pick<typeof Db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

/**
 * Recompute `amount_received` from the receipts actually recorded, then rewrite
 * the stored status cache.
 *
 * The stored status NEVER carries OVERDUE — that is a display state derived from
 * the due date on every read — so a partial receipt correctly turns an overdue
 * invoice into PARTIALLY_PAID while the reader still shows OVERDUE until the
 * clock moves past the due date. `deriveSupplierInvoiceStatus` encodes that, and
 * the read paths pass the real `daysOverdue`.
 */
export async function recomputeSupplierInvoiceReceived(
  invoiceId: string,
  tenantId: string,
  executor: Executor = db,
): Promise<void> {
  const [invoice] = await executor
    .select({
      id: supplierInvoices.id,
      status: supplierInvoices.status,
      amount: supplierInvoices.amount,
      amountReceived: supplierInvoices.amountReceived,
      currency: supplierInvoices.currency,
    })
    .from(supplierInvoices)
    .where(and(eq(supplierInvoices.id, invoiceId), eq(supplierInvoices.tenantId, tenantId)))
    .limit(1);
  if (!invoice) return;

  const [row] = await executor
    .select({ total: sql<string>`COALESCE(SUM(${supplierReceipts.amount}), 0)::numeric(14,2)::text` })
    .from(supplierReceipts)
    .where(
      and(
        eq(supplierReceipts.supplierInvoiceId, invoiceId),
        // Case-insensitive, matching the guard in `createSupplierReceipt`. An
        // exact match here would let a lowercase-currency receipt pass the guard
        // and then be silently dropped from the sum — the silent failure the
        // guard exists to prevent.
        sql`upper(${supplierReceipts.currency}) = upper(${invoice.currency ?? ''})`,
      ),
    );

  const received = row?.total ?? '0.00';
  const storedStatus = deriveSupplierInvoiceStatus(
    { status: invoice.status, amount: invoice.amount ?? '0', amountReceived: received },
    0,
  );

  /**
   * Written only when something actually changed. This runs on every read (it is
   * how the figure self-heals), so an unconditional UPDATE would take a row lock
   * and bump `updated_at` on every GET — including the PDF route.
   */
  const current = parseFloat(invoice.amountReceived ?? '0') || 0;
  const stored = parseFloat(received) || 0;
  if (Math.abs(current - stored) < SETTLEMENT_EPSILON && invoice.status === storedStatus) return;

  await executor
    .update(supplierInvoices)
    .set({ amountReceived: received, status: storedStatus, updatedAt: new Date() })
    .where(and(eq(supplierInvoices.id, invoiceId), eq(supplierInvoices.tenantId, tenantId)));
}

/**
 * Record money received from a supplier against an invoice.
 *
 * Everything happens in ONE transaction, on the invoice row, with `FOR UPDATE`:
 *
 *  - the invoice is read and LOCKED, so a concurrent void or a second receipt
 *    serializes behind this one rather than interleaving (validate-then-insert
 *    across separate statements could otherwise land a receipt on an invoice that
 *    was voided in between, permanently, since nothing re-checks it);
 *  - a receipt exceeding what is still outstanding is REFUSED rather than
 *    silently absorbing the over-collection into `amount_received`;
 *  - a zero-value invoice cannot be receipted at all;
 *  - the currency is validated against the locked row, so the check and the write
 *    cannot disagree.
 */
export async function createSupplierReceipt(input: {
  invoiceId: string;
  tenantId: string;
  amount: string;
  currency: string;
  receivedAt?: string | null;
  method?: string | null;
  note?: string | null;
  createdBy?: string | null;
}): Promise<typeof supplierReceipts.$inferSelect | null> {
  const amountCents = toCents(input.amount);

  if (input.receivedAt) {
    const parsed = new Date(input.receivedAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new SupplierReceiptError('Received date is not a valid date');
    }
  }

  return db.transaction(async (tx) => {
    const [invoice] = await tx
      .select({
        id: supplierInvoices.id,
        supplierId: supplierInvoices.supplierId,
        status: supplierInvoices.status,
        currency: supplierInvoices.currency,
        amount: supplierInvoices.amount,
        amountReceived: supplierInvoices.amountReceived,
      })
      .from(supplierInvoices)
      .where(and(eq(supplierInvoices.id, input.invoiceId), eq(supplierInvoices.tenantId, input.tenantId)))
      // Locks the row for the rest of the transaction.
      .for('update')
      .limit(1);
    if (!invoice) return null;

    if (invoice.status === 'VOID') {
      throw new SupplierReceiptError('This invoice was voided and cannot be settled');
    }

    if ((input.currency ?? '').trim().toUpperCase() !== (invoice.currency ?? '').trim().toUpperCase()) {
      throw new SupplierReceiptError(
        `Receipt is in ${input.currency} but the invoice is in ${invoice.currency}; they cannot be settled against each other.`,
      );
    }

    // Receipts are summed from the table inside the same locked transaction, so
    // the outstanding figure cannot be stale relative to the row being written.
    const [existing] = await tx
      .select({ total: sql<string>`COALESCE(SUM(${supplierReceipts.amount}), 0)::numeric(14,2)::text` })
      .from(supplierReceipts)
      .where(
        and(
          eq(supplierReceipts.supplierInvoiceId, invoice.id),
          sql`upper(${supplierReceipts.currency}) = upper(${invoice.currency ?? ''})`,
        ),
      );

    const invoiceCents = Math.round((parseFloat(invoice.amount ?? '0') || 0) * 100);
    const alreadyCents = Math.round((parseFloat(existing?.total ?? '0') || 0) * 100);
    const outstandingCents = invoiceCents - alreadyCents;

    if (invoiceCents <= 0) {
      throw new SupplierReceiptError('This invoice has no value to settle');
    }
    if (amountCents > outstandingCents) {
      throw new SupplierReceiptError(
        `Receipt exceeds the ${(outstandingCents / 100).toFixed(2)} ${invoice.currency} still outstanding on this invoice`,
      );
    }

    const [created] = await tx
      .insert(supplierReceipts)
      .values({
        tenantId: input.tenantId,
        supplierInvoiceId: invoice.id,
        supplierId: invoice.supplierId,
        amount: (amountCents / 100).toFixed(2),
        // Normalised on write so display and comparison agree.
        currency: (invoice.currency ?? 'USD').toUpperCase(),
        receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
        method: input.method ?? null,
        note: input.note ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();

    await recomputeSupplierInvoiceReceived(invoice.id, input.tenantId, tx);
    return created ?? null;
  });
}

/** Remove a receipt and re-derive the invoice's settled figures. */
export async function deleteSupplierReceipt(
  receiptId: string,
  tenantId: string,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: supplierReceipts.id, supplierInvoiceId: supplierReceipts.supplierInvoiceId })
      .from(supplierReceipts)
      .where(and(eq(supplierReceipts.id, receiptId), eq(supplierReceipts.tenantId, tenantId)))
      .limit(1);
    if (!existing) return null;

    await tx
      .delete(supplierReceipts)
      .where(and(eq(supplierReceipts.id, receiptId), eq(supplierReceipts.tenantId, tenantId)));

    if (existing.supplierInvoiceId) {
      await recomputeSupplierInvoiceReceived(existing.supplierInvoiceId, tenantId, tx);
    }
    return existing.supplierInvoiceId;
  });
}

/**
 * Receipts recorded against an invoice, newest first.
 * Batched by the caller where it matters; exposed for single-invoice reads.
 */
export async function listSupplierReceipts(
  invoiceId: string,
  executor: Executor = db,
): Promise<Array<typeof supplierReceipts.$inferSelect>> {
  return executor
    .select()
    .from(supplierReceipts)
    .where(eq(supplierReceipts.supplierInvoiceId, invoiceId))
    .orderBy(supplierReceipts.receivedAt);
}
