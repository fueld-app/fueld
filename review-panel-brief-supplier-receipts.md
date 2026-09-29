# REVIEW INSTRUCTIONS — READ FIRST

You are a code reviewer. You have NO tools, no filesystem and no repository access. Everything you need is in this payload: the two gaps, the two fixes, the constraints, and the full source of the changed code (Appendix A). Do NOT attempt to call tools or read files — reason only from the text below and produce a written review.

Deliver: findings marked MUST or SHOULD with file/symbol references, any disagreement with the approach, and a verdict of APPROVE / APPROVE-WITH-CONDITIONS / NO-GO. Terse and evidence-first.

---

# Review — closing the two remaining supplier-invoice gaps

Feature context: Moxie (bunker broker) invoices a SUPPLIER for commission the supplier funded on a broker deal. `supplier_invoices` + `supplier_invoice_lines` + its own `SINV-` number series; deliberately a separate ledger from the customer receivable ledger (`invoices`) because that one has no payer column and collections/ageing/company-balance/QuickBooks all infer the payer from `orders.client_id`.

Two rounds of panel review already happened and their MUSTs are closed. This round covers **only two changes**, both of which came out of the earlier reviews.

## Gap 1 — receipts were parked in the outbound payment ledger

The settlement link was `supplier_payments.supplier_invoice_id`. `supplier_payments` is the OUTBOUND ledger ("money we paid a supplier for fuel") and three readers sum it unconditionally:

- `orders.service.ts :: listSupplierPayments` — the leg's payment list
- `orders.service.ts :: updateOrderSupplierAmountPaid` — the leg's `amount_paid` / `paid_at`
- `company.service.ts :: getSupplierPaymentLedger` — the supplier's outstanding balance

A receipt from a supplier is parked on a supplier *leg*, so money coming IN was counted as money paid OUT: a leg could be marked paid for fuel on the strength of commission the supplier sent us. The interim fix filtered all three readers on `supplier_invoice_id IS NULL` — one forgotten filter away from a wrong number.

**Fix:** receipts get their own table `supplier_receipts`, and `supplier_payments.supplier_invoice_id` is DROPPED. `supplier_payments` is outbound-only again and the three filters are gone. Direction is a property of the table, not of a WHERE clause. Safe as a straight swap because **no receipts exist yet** (`supplier_payments` where `supplier_invoice_id IS NOT NULL` = 0 rows), so nothing needed migrating.

Receipt lifecycle: `createSupplierReceipt` validates the currency BEFORE inserting (a mismatch must not leave a persisted row plus an error, which invites a retrying operator to double it); `deleteSupplierReceipt` re-derives; void DELETES the invoice's receipts (the FK is NOT NULL — a receipt exists only to settle a specific invoice, so there is no unlinked state, and a voided invoice is not a claim).

## Gap 2 — the operator could not see what issuing would do

Deals that produce NO invoice (more than one supplier leg; a deal priced outside the report currency) were reported only in the POST result AFTER the fact. `/candidates` returned a bare list of suppliers, so a missing invoice read exactly like "nothing was owed".

**Fix:** `GET /supplier-invoices/candidates` now returns `{ period, currency, suppliers[{supplierId, supplierName, totalCommission, lineCount, alreadyInvoiced}], willSkip[{reason, orderNumbers[]}] }`. The report page loads it with the report and renders "If you invoice this period: N suppliers would be billed — M already invoiced" plus an amber block listing every order that will produce no invoice and why.

## Specific things I want challenged

1. **Is dropping the column the right call versus keeping it and filtering?** The swap is only clean because no receipts exist. Is there anything a reader loses by `supplier_payments` no longer being able to point at an invoice?
2. **Void deletes receipts.** Is that right, or should a receipt outlive its invoice for audit? `supplier_receipts.supplier_invoice_id` is NOT NULL with `ON DELETE CASCADE`, so a receipt cannot exist unattached. Does that make a voided-then-reissued invoice lose money-received history that someone will want?
3. **`createSupplierReceipt` validates currency before inserting but resolves the invoice in a separate query.** Two concurrent receipts, or a void racing a receipt, are not serialized by any lock (the create path's advisory lock covers ISSUING, not receipts). Is that a real problem?
4. **The candidates response is computed by calling `buildSupplierCommissionReport` again** (the report page calls both endpoints). Two full report builds per page load, and they can disagree if the data changes between them. Acceptable, or should `candidates` take the report's figures?
5. **`willSkip` groups by reason with an array of order numbers.** A deal with more than one supplier leg is excluded from the ENTIRE report, so it also contributes nothing to the customer-side totals. Is surfacing it only as a skip list enough, or does that silently understate a customer's commission too?
6. **Anything in the new code that reintroduces the class of bug just fixed** — a direction ambiguity, a place where a receipt could be counted as a payment, or a read that writes.
7. **Anything I have missed** for a money ledger: rounding, negative or zero amounts, a receipt greater than the outstanding balance, or a receipt recorded against a VOID invoice.

## What I am NOT claiming

- No email sending; no QuickBooks vendor sync; no FX conversion of non-USD commission.
- The classic (non-SLEEK) PDF layout is still not visually verified (Moxie uses the default).
- No production data has been through the receipts flow yet — production has zero invoices.


## Appendix A — full source of the changed code

```
════ apps/api/drizzle/0136_supplier_receipts.sql
-- Supplier receipts: money coming IN from a supplier, as its own ledger.
--
-- ── Why this replaces the link on `supplier_payments` ──────────────────────
-- 0135 attached receipts to `supplier_payments` via `supplier_invoice_id`. That
-- table is the OUTBOUND ledger — "money we paid a supplier for fuel" — and
-- three readers sum it unconditionally:
--
--   orders.service.ts     listSupplierPayments
--   orders.service.ts     updateOrderSupplierAmountPaid  (leg paid_at / amount_paid)
--   company.service.ts    getSupplierPaymentLedger       (supplier outstanding)
--
-- A receipt from a supplier is parked on a supplier *leg*, so money coming IN
-- was counted as money we paid OUT: a leg could be marked paid for fuel on the
-- strength of commission the supplier sent us, and a supplier's outstanding
-- balance would be understated. 0135 worked around that by filtering every
-- reader on `supplier_invoice_id IS NULL` — one forgotten filter away from a
-- wrong number, in the same way a payer column on `invoices` would have been.
--
-- Direction belongs in the table, not in a WHERE clause. Receipts get their own
-- ledger and `supplier_payments` goes back to being purely outbound.
--
-- Safe to do as a straight swap: no receipts exist yet (`supplier_payments`
-- where `supplier_invoice_id` is not null = 0 rows), so there is nothing to
-- migrate and no link to preserve.

CREATE TABLE supplier_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- The invoice this receipt settles. NOT NULL: a receipt exists only to settle
  -- a supplier invoice, unlike the outbound ledger where the leg is the anchor.
  supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES counterparties(id),
  -- The supplier leg the invoice's commission arose on, when there is one. Kept
  -- for context and reporting; the receipt does NOT contribute to that leg's
  -- paid amount, which is what went wrong when this lived on supplier_payments.
  order_supplier_id uuid REFERENCES order_suppliers(id) ON DELETE SET NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,

  amount numeric(14, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  received_at timestamp with time zone NOT NULL DEFAULT now(),
  method text,
  note text,
  created_by uuid REFERENCES users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX supplier_receipts_invoice_idx
  ON supplier_receipts (supplier_invoice_id);

CREATE INDEX supplier_receipts_tenant_supplier_idx
  ON supplier_receipts (tenant_id, supplier_id);

-- `supplier_payments` is the OUTBOUND ledger again.
ALTER TABLE supplier_payments
  DROP COLUMN IF EXISTS supplier_invoice_id;
════ apps/api/src/modules/orders/supplier-invoice-ledger.ts
/**
 * Supplier-invoice ledger primitives: status derivation, settlement recompute,
 * and recording a receipt.
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
 */
import { and, eq, sql } from 'drizzle-orm';
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

/**
 * Refuse a receipt in a currency the invoice is not in.
 *
 * Exposed so callers validate BEFORE inserting the receipt. Throwing after the
 * insert would leave a persisted receipt plus an error, and the operator's retry
 * would double it.
 *
 * Compares case-insensitively and is the single definition of "same currency"
 * for this feature — the settlement sum uses the same `upper()` comparison, so
 * the guard and the sum cannot disagree.
 */
export async function assertReceiptCurrencyMatchesInvoice(
  currency: string,
  invoiceId: string,
): Promise<void> {
  const [invoice] = await db
    .select({ currency: supplierInvoices.currency })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, invoiceId))
    .limit(1);
  if (!invoice) throw new Error('Supplier invoice not found');
  if ((currency ?? '').trim().toUpperCase() !== (invoice.currency ?? '').trim().toUpperCase()) {
    throw new Error(
      `Receipt is in ${currency} but the invoice is in ${invoice.currency}; they cannot be settled against each other.`,
    );
  }
}

/**
 * Recompute `amount_received` from the receipts actually recorded, then rewrite
 * the stored status cache. Idempotent.
 */
export async function recomputeSupplierInvoiceReceived(invoiceId: string): Promise<void> {
  const [invoice] = await db
    .select({
      id: supplierInvoices.id,
      status: supplierInvoices.status,
      amount: supplierInvoices.amount,
      amountReceived: supplierInvoices.amountReceived,
      currency: supplierInvoices.currency,
    })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, invoiceId))
    .limit(1);
  if (!invoice) return;

  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${supplierReceipts.amount}), 0)::numeric(14,2)::text` })
    .from(supplierReceipts)
    .where(
      and(
        eq(supplierReceipts.supplierInvoiceId, invoiceId),
        // Case-insensitive, matching `assertReceiptCurrencyMatchesInvoice`. An
        // exact match here would let a lowercase-currency receipt pass the guard
        // and then be silently dropped from the sum — the silent failure the
        // guard exists to prevent.
        sql`upper(${supplierReceipts.currency}) = upper(${invoice.currency ?? ''})`,
      ),
    );

  const received = row?.total ?? '0.00';
  const nextStatus = deriveSupplierInvoiceStatus(
    { status: invoice.status, amount: invoice.amount ?? '0', amountReceived: received },
    0,
  );
  const storedStatus = nextStatus === 'OVERDUE' ? 'SENT' : nextStatus;

  /**
   * Written only when something actually changed. This runs on every read (it is
   * how the figure self-heals), so an unconditional UPDATE would take a row lock
   * and bump `updated_at` on every GET — including the PDF route — and make
   * reads no longer read-only.
   */
  const current = parseFloat(invoice.amountReceived ?? '0') || 0;
  const stored = parseFloat(received) || 0;
  if (Math.abs(current - stored) < SETTLEMENT_EPSILON && invoice.status === storedStatus) return;

  await db
    .update(supplierInvoices)
    .set({ amountReceived: received, status: storedStatus, updatedAt: new Date() })
    .where(eq(supplierInvoices.id, invoiceId));
}

/**
 * Record money received from a supplier against an invoice.
 *
 * The currency is validated BEFORE anything is written, so a mismatch cannot
 * leave a persisted receipt with no effect.
 */
export async function createSupplierReceipt(input: {
  invoiceId: string;
  amount: string;
  currency: string;
  receivedAt?: string | null;
  method?: string | null;
  note?: string | null;
  createdBy?: string | null;
}): Promise<typeof supplierReceipts.$inferSelect | null> {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Receipt amount must be greater than zero');
  }

  const [invoice] = await db
    .select({
      id: supplierInvoices.id,
      tenantId: supplierInvoices.tenantId,
      supplierId: supplierInvoices.supplierId,
      status: supplierInvoices.status,
      currency: supplierInvoices.currency,
    })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, input.invoiceId))
    .limit(1);
  if (!invoice) return null;
  if (invoice.status === 'VOID') throw new Error('This invoice was voided and cannot be settled');

  await assertReceiptCurrencyMatchesInvoice(input.currency, input.invoiceId);

  const [created] = await db
    .insert(supplierReceipts)
    .values({
      tenantId: invoice.tenantId,
      supplierInvoiceId: invoice.id,
      supplierId: invoice.supplierId,
      amount: amount.toFixed(2),
      currency: input.currency,
      receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
      method: input.method ?? null,
      note: input.note ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();

  await recomputeSupplierInvoiceReceived(invoice.id);
  return created ?? null;
}

/** Remove a receipt and re-derive the invoice's settled figures. */
export async function deleteSupplierReceipt(receiptId: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: supplierReceipts.id, supplierInvoiceId: supplierReceipts.supplierInvoiceId })
    .from(supplierReceipts)
    .where(eq(supplierReceipts.id, receiptId))
    .limit(1);
  if (!existing) return false;

  await db.delete(supplierReceipts).where(eq(supplierReceipts.id, receiptId));
  await recomputeSupplierInvoiceReceived(existing.supplierInvoiceId);
  return true;
}
════ apps/api/src/modules/orders/supplier-invoice.service.ts  (candidates fn + receipt reads)
647:export async function listSuppliersWithSupplierCommission(
648-  tenantId: string,
649-  from: string,
650-  to: string,
651-): Promise<SupplierInvoiceCandidatesDto> {
652-  const report = await buildSupplierCommissionReport(tenantId, from, to);
653-  const existing = await db
654-    .select({ supplierId: supplierInvoices.supplierId, invoiceNumber: supplierInvoices.invoiceNumber })
655-    .from(supplierInvoices)
656-    .where(
657-      and(
658-        eq(supplierInvoices.tenantId, tenantId),
659-        eq(supplierInvoices.periodFrom, from),
660-        eq(supplierInvoices.periodTo, to),
661-        notInArray(supplierInvoices.status, ['VOID']),
662-      ),
663-    );
664-  const bySupplier = new Map(existing.map((e) => [e.supplierId, e.invoiceNumber]));
665-
666-  /**
667-   * The exclusions the issuing call reports only AFTER the fact. Surfacing them
668-   * here is the point: without it, a deal that will produce no invoice is
669-   * invisible until someone reads the result, and a missing invoice then reads
670-   * exactly like "nothing was owed".
671-   */
672-  const willSkip: SupplierInvoiceCandidatesDto['willSkip'] = [];
673-  if (report.attributedToMultipleSuppliers.length > 0) {
674-    willSkip.push({
675-      reason: 'more than one supplier leg, so the commission cannot be attributed to one supplier',
676-      orderNumbers: report.attributedToMultipleSuppliers,
677-    });
678-  }
679-  if (report.excludedOtherCurrency.length > 0) {
680-    willSkip.push({
681-      reason: `not in ${report.currency} (this report does not convert)`,
682-      orderNumbers: report.excludedOtherCurrency,
683-    });
684-  }
685-
686-  return {
687-    period: { from, to },
688-    currency: report.currency,
689-    suppliers: report.bySupplier.map((s) => ({
690-      supplierId: s.supplierId,
691-      supplierName: s.supplierName,
692-      totalCommission: s.totalCommission,
693-      lineCount: s.lineCount,
694-      alreadyInvoiced: bySupplier.get(s.supplierId) ?? null,
695-    })),

```
