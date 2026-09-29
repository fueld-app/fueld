# REVIEW INSTRUCTIONS — READ FIRST

You are a code reviewer. You have NO tools, no filesystem and no repository access. Everything you need is in this payload: what round 1 found, what was changed in response, and the FULL current source of the changed code (Appendix A). Do NOT attempt to call tools or read files — reason only from the text below and produce a written review.

This is **round 2: a verification round**. Your job is NOT to re-review from scratch. It is:
1. **Verify each fix** is correct and complete — does it actually remove the defect, or only move it?
2. **Hunt for bugs INTRODUCED by the fixes** — this is the highest-value thing you can do. A fix that breaks something else is worse than the original defect.
3. **Confirm or refute** the claims in the "still open" list.
4. A verdict: APPROVE / APPROVE-WITH-CONDITIONS / NO-GO.

Terse, evidence-first, file/line-referenced. Mark each item MUST or SHOULD.

---

# Context

Feature: Moxie (bunker broker) invoicing a SUPPLIER for commission the supplier funded on a broker deal. A separate ledger from the customer receivable ledger (deliberately — see Appendix A header comments). Already deployed to production at commit `bb842a3a` *after* round 1's fixes landed.

## Round 1 findings and what was changed

Round 1 was three models (kimi-k3, glm-5.3, deepseek-v4-pro), all APPROVE-WITH-CONDITIONS. Their MUSTs and my fixes:

| # | Round-1 finding | Fix applied |
|---|---|---|
| **M1** | `invoice_number` was globally `UNIQUE` while the sequence/template are per-tenant → two tenants both mint `SINV-2026-0001`, second insert fails | Dropped the global unique; added `UNIQUE (tenant_id, invoice_number)` index `supplier_invoices_tenant_number_unique`; column comment updated |
| **M2** | `allocateSupplierInvoiceNumber` ran *before* the insert and on `db` (not `tx`) → every idempotent retry burned a number, and a rollback left a permanent gap | Now: inside the advisory lock, `SELECT` by `source_key` FIRST and `continue` if present (no allocation at all); allocation moved onto the transaction via a new `executor` parameter so it rolls back with the insert |
| **M3** | `bankDetailsSnapshot` was a newline-joined string that the PDF re-split **by index** (`bankLines[3]` = IBAN, `[4]` = SWIFT) → a null bank name shifted every field and printed the IBAN under the SWIFT label | Column replaced with `bank_details jsonb` typed `SupplierInvoiceBankDetails`; the PDF now reads named fields and a new `remittanceLines()` helper labels each one explicitly |
| **M4** | `recomputeSupplierInvoiceReceived` summed `supplierPayments.amount` with **no currency filter** → a EUR receipt inflated a USD invoice and could mark it PAID | The sum now filters `currency = invoice.currency`; `applySupplierPaymentToInvoice` additionally **throws** on a mismatch so the operator finds out immediately |
| **M5** | The route summary said "admin only" while nothing checked the role | `auth.role !== 'ADMIN'` → 403 on both `POST /` and `POST /:id/void` |

Their SHOULDs and my fixes:

| # | Round-1 finding | Fix applied |
|---|---|---|
| S1 | Issuer resolved by `counterparties.name` **unscoped by tenant** → another tenant's same-named company could supply its logo/address/VAT | Resolves by the stored `invoicing_company_id` **AND** `tenantId`; `invoicingCompanyId` added to the DTO |
| S3 | `GET /:id` and `GET /:id/pdf` did not call `assertSupplierInvoicesEnabled`, contradicting the "every route 404s" claim | Both now gate on the flag |
| S4 | `supplier_invoice_lines.order_id` was always inserted as `null` despite a "kept for traceability" comment | `orderId` added to `SupplierCommissionReportOrderDto` and threaded through so the real order id is stored |
| S7 | `amount_received` served from a cache that only the ledger helper refreshed → any out-of-band payment edit left a stale figure | `getSupplierInvoice` now calls `recomputeSupplierInvoiceReceived` **before** reading, so the read self-heals |
| S9 | List route was N+1 (three queries per row) | Rewritten: two batched `inArray` reads plus a header read, with lines/payments grouped in maps; the now-redundant `getSupplierInvoicesByIds` was deleted |
| — | Void did not take the advisory lock, so a void could race an in-flight issue | Void now runs its whole body inside `db.transaction` holding the same per-tenant `pg_advisory_xact_lock`. **An earlier attempt took the lock in a separate transaction that closed before the work — that was worse than not locking at all; verify the current version actually holds it.** |
| — | Due date invented (period end + 30) | Now tenant-configurable via `TenantSettings.supplierInvoiceTermsDays` (default 30) |
| — | No validation that `from <= to` | Throws on a reversed range |
| — | Settlement e2e wrapped its API assertion in `if (status === 200)`, masking a missing route | Asserted unconditionally; the route path was also wrong (`/supplier-payments` vs the real `/:id/suppliers/:supplierRecordId/payments`) and is now correct |

## Claims I want you to attack

1. **Does the M2 fix actually close the hole?** The pre-check runs inside the lock, but is there any path where a number is still burned, or where two callers could both pass the pre-check? Note the report is built *outside* the lock.
2. **Is the current void lock real?** Trace it: `db.transaction(async (tx) => { await tx.execute(pg_advisory_xact_lock(...)); ...all the work... })`. Confirm the lock is held across the work and released only at commit, and that a concurrent issue therefore serializes behind it.
3. **Did the batched list rewrite change any observable figure?** It computes `amountReceived` from the payments it just loaded rather than from the stored column that `getSupplierInvoice` reads. Can the list and the detail now disagree, and is that a regression or a fix?
4. **M4's throw** — `applySupplierPaymentToInvoice` now throws on a currency mismatch. It is called from `createSupplierPayment` *after* the payment row is already inserted. Is a throw there correct, or does it leave a half-applied state?
5. **Is the `bank_details` JSON change safe for the classic PDF layout** as well as the sleek one, and does `remittanceLines()` handle every null combination without producing a misleading line?
6. **Anything the fixes broke.** In particular: the `allocateSupplierInvoiceNumber` signature now takes an `executor` typed `Pick<typeof db, 'insert' | 'select'>` — is that structurally satisfied by a Drizzle transaction handle, and could it silently fall back to the non-transactional `db`?
7. **Still-open items, confirm or refute:** (a) `supplier_payments` is "money we paid out" and is now also the receipts table — directionally ambiguous; (b) multi-supplier-leg deals produce no invoice and appear only as a `skipped` reason; (c) there is still no concurrency e2e (two parallel POSTs) proving the advisory lock; (d) the customer-side `createCommissionOrdersFromReport` still writes a note reading "N deliveries" while counting lines.

## What is NOT claimed

- No email sending for these invoices; no QuickBooks vendor sync.
- No conversion of non-USD commission (the report excludes other-currency deals instead).
- The classic (non-SLEEK) PDF layout has not been visually verified — Moxie uses the default.
- Production deployment is complete; the migration applied cleanly on a fresh database (136 migrations).


## Appendix A — FULL CURRENT source of the changed files (post-fix)

```
════ apps/api/src/modules/orders/supplier-invoice.service.ts
/**
 * Supplier invoices — money owed TO us BY a supplier.
 *
 * Raised from the supplier commission report: on a broker deal the supplier
 * invoices the customer directly and Moxie's revenue is its commission. When
 * the negotiated rate is above the standing $3/MT it is funded by the SUPPLIER
 * (confirmed by Moxie 2026-09-29), so the supplier owes Moxie that commission
 * and Moxie bills for it here.
 *
 * Deliberately a separate ledger from `invoices` rather than a payer column on
 * it: `invoices` is the customer receivable ledger and every reader (collections
 * widget, invoice ageing, company balance, QuickBooks customer sync) infers the
 * payer from `orders.client_id`. A supplier-addressed row there would be
 * reported as a customer receivable. Keeping the two ledgers apart makes that
 * impossible rather than merely filtered.
 *
 * Two invariants this module owns:
 *
 *  1. **Idempotent per (tenant, period, supplier).** `source_key` plus a partial
 *     unique index, under an advisory lock — the same construction
 *     `createCommissionOrdersFromReport` uses, for the same reason: a double
 *     click, two tabs, or a retry after a timeout must not bill a supplier
 *     twice, and the failure has to be a clean "already invoiced" answer rather
 *     than a raw constraint error.
 *
 *  2. **The snapshot IS the document.** Lines are written as values at issue and
 *     the PDF renders from those values, never by joining back to the orders.
 *     Renaming a counterparty, editing a rate, or delivering the order must not
 *     restate an invoice the supplier already holds. This mirrors
 *     `document_revisions` on the customer side.
 */
import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type {
  CreateSupplierInvoicesResultDto,
  SupplierInvoiceDto,
  SupplierInvoiceLineDto,
} from '@fueld/types';
import { db } from '../../db';
import {
  bankAccounts,
  counterparties,
  orders,
  supplierInvoiceLines,
  supplierInvoiceNumberSequences,
  supplierInvoices,
  supplierPayments,
  tenants,
  type SupplierInvoiceBankDetails,
  type TenantSettings,
} from '../../db/schema';
import { buildSupplierCommissionReport } from '../reports/reports.service';
import { deriveSupplierInvoiceStatus, recomputeSupplierInvoiceReceived } from './supplier-invoice-ledger';

/** Numbering defaults, mirroring the customer invoice series. */
const DEFAULT_SUPPLIER_INVOICE_TEMPLATE = 'SINV-{YYYY}-{SEQ:4}';

function renderSupplierInvoiceNumber(template: string, seq: number, now: Date): string {
  return template
    .replace(/\{YYYY\}/g, String(now.getUTCFullYear()))
    .replace(/\{YY\}/g, String(now.getUTCFullYear()).slice(-2))
    .replace(/\{SEQ:(\d+)\}/g, (_m, width: string) => String(seq).padStart(Number(width), '0'))
    .replace(/\{SEQ\}/g, String(seq));
}

/**
 * Allocate the next number from the SUPPLIER series. Its own counter, so a gap
 * or a duplicate in the customer series cannot look like a problem in this one.
 */
export async function allocateSupplierInvoiceNumber(
  tenantId: string,
  now = new Date(),
  /**
   * Pass the caller's transaction when one is open, so a failure after
   * allocation rolls the sequence back with the insert rather than leaving a
   * permanent gap in an issued invoice series.
   */
  executor: Pick<typeof db, 'insert' | 'select'> = db,
): Promise<string> {
  const [seq] = await executor
    .insert(supplierInvoiceNumberSequences)
    .values({ tenantId, lastSeq: 1 })
    .onConflictDoUpdate({
      target: supplierInvoiceNumberSequences.tenantId,
      set: {
        lastSeq: sql`${supplierInvoiceNumberSequences.lastSeq} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ lastSeq: supplierInvoiceNumberSequences.lastSeq });

  const [tenant] = await executor
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const settings = (tenant?.settings ?? {}) as TenantSettings;

  return renderSupplierInvoiceNumber(
    settings.supplierInvoiceNumberTemplate ?? DEFAULT_SUPPLIER_INVOICE_TEMPLATE,
    seq?.lastSeq ?? 1,
    now,
  );
}

function daysOverdue(dueDate: string, now = new Date()): number {
  const due = new Date(`${dueDate}T23:59:59.999Z`);
  if (Number.isNaN(due.getTime())) return 0;
  const diff = now.getTime() - due.getTime();
  return diff > 0 ? Math.floor(diff / 86_400_000) : 0;
}

function toLineDto(row: typeof supplierInvoiceLines.$inferSelect): SupplierInvoiceLineDto {
  return {
    id: row.id,
    orderId: row.orderId ?? null,
    orderNumber: row.orderNumber ?? null,
    customerName: row.customerName ?? null,
    vesselName: row.vesselName ?? null,
    placeName: row.placeName ?? null,
    productType: row.productType ?? null,
    quantity: row.quantity ?? null,
    unit: row.unit ?? null,
    rate: row.rate ?? null,
    amount: row.amount,
  };
}

export async function getSupplierInvoice(id: string): Promise<SupplierInvoiceDto | null> {
  // Refresh the received figure from the payments that actually exist before
  // reading it. `amount_received` is a cache, and a payment written by any path
  // that does not go through the ledger helper (support SQL, a future bulk tool)
  // would otherwise leave a stale outstanding figure with no way to self-heal.
  // One aggregate is cheap next to the lines + payments reads below.
  await recomputeSupplierInvoiceReceived(id);

  const [row] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, id)).limit(1);
  if (!row) return null;

  const [lines, payments] = await Promise.all([
    db.select().from(supplierInvoiceLines)
      .where(eq(supplierInvoiceLines.supplierInvoiceId, id))
      .orderBy(asc(supplierInvoiceLines.sortOrder), asc(supplierInvoiceLines.createdAt)),
    db.select({
      id: supplierPayments.id,
      amount: supplierPayments.amount,
      paidAt: supplierPayments.paidAt,
      method: supplierPayments.method,
      note: supplierPayments.note,
    })
      .from(supplierPayments)
      .where(eq(supplierPayments.supplierInvoiceId, id))
      .orderBy(desc(supplierPayments.paidAt)),
  ]);

  const amount = parseFloat(row.amount ?? '0') || 0;
  const received = parseFloat(row.amountReceived ?? '0') || 0;

  return {
    id: row.id,
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    invoiceNumber: row.invoiceNumber,
    status: deriveSupplierInvoiceStatus(
      { status: row.status, amount: row.amount ?? '0', amountReceived: row.amountReceived ?? '0' },
      daysOverdue(row.dueDate),
    ),
    rawStatus: row.status,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    currency: row.currency,
    amount: amount.toFixed(2),
    amountReceived: received.toFixed(2),
    amountOutstanding: Math.max(0, amount - received).toFixed(2),
    dueDate: row.dueDate,
    invoicingCompanyId: row.invoicingCompanyId ?? null,
    invoicingCompanyName: row.invoicingCompanyName ?? null,
    hasBankDetails: !!row.bankDetails,
    bankDetails: row.bankDetails ?? null,
    note: row.note ?? null,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    lines: lines.map(toLineDto),
    payments: payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      paidAt: p.paidAt.toISOString(),
      method: p.method ?? null,
      note: p.note ?? null,
    })),
  };
}

export async function listSupplierInvoices(
  tenantId: string,
  filters: { supplierId?: string | null; includeVoid?: boolean } = {},
): Promise<SupplierInvoiceDto[]> {
  const rows = await db
    .select({ id: supplierInvoices.id })
    .from(supplierInvoices)
    .where(
      and(
        eq(supplierInvoices.tenantId, tenantId),
        ...(filters.supplierId ? [eq(supplierInvoices.supplierId, filters.supplierId)] : []),
        ...(filters.includeVoid ? [] : [notInArray(supplierInvoices.status, ['VOID'])]),
      ),
    )
    .orderBy(desc(supplierInvoices.createdAt));

  if (rows.length === 0) return [];

  // Two batched reads rather than one round trip per row. `getSupplierInvoice`
  // is right for a single invoice but would issue three queries per row here.
  const ids = rows.map((r) => r.id);
  const [headers, allLines, allPayments] = await Promise.all([
    db.select().from(supplierInvoices).where(inArray(supplierInvoices.id, ids)),
    db.select().from(supplierInvoiceLines)
      .where(inArray(supplierInvoiceLines.supplierInvoiceId, ids))
      .orderBy(asc(supplierInvoiceLines.sortOrder), asc(supplierInvoiceLines.createdAt)),
    db.select({
      id: supplierPayments.id,
      supplierInvoiceId: supplierPayments.supplierInvoiceId,
      amount: supplierPayments.amount,
      paidAt: supplierPayments.paidAt,
      method: supplierPayments.method,
      note: supplierPayments.note,
    })
      .from(supplierPayments)
      .where(inArray(supplierPayments.supplierInvoiceId, ids))
      .orderBy(desc(supplierPayments.paidAt)),
  ]);

  const linesByInvoice = new Map<string, typeof allLines>();
  for (const line of allLines) {
    const list = linesByInvoice.get(line.supplierInvoiceId) ?? [];
    list.push(line);
    linesByInvoice.set(line.supplierInvoiceId, list);
  }
  const paymentsByInvoice = new Map<string, typeof allPayments>();
  for (const p of allPayments) {
    if (!p.supplierInvoiceId) continue;
    const list = paymentsByInvoice.get(p.supplierInvoiceId) ?? [];
    list.push(p);
    paymentsByInvoice.set(p.supplierInvoiceId, list);
  }

  // `amount_received` is derived from the payments already in hand, so the list
  // shows the same figure a detail read would without a query per row.
  return headers.map((row) => {
    const lines = linesByInvoice.get(row.id) ?? [];
    const payments = paymentsByInvoice.get(row.id) ?? [];
    const received = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    const amount = parseFloat(row.amount ?? '0') || 0;
    return {
      id: row.id,
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      invoiceNumber: row.invoiceNumber,
      status: deriveSupplierInvoiceStatus(
        { status: row.status, amount: row.amount ?? '0', amountReceived: received.toFixed(2) },
        daysOverdue(row.dueDate),
      ),
      rawStatus: row.status,
      periodFrom: row.periodFrom,
      periodTo: row.periodTo,
      currency: row.currency,
      amount: amount.toFixed(2),
      amountReceived: received.toFixed(2),
      amountOutstanding: Math.max(0, amount - received).toFixed(2),
      dueDate: row.dueDate,
      invoicingCompanyId: row.invoicingCompanyId ?? null,
      invoicingCompanyName: row.invoicingCompanyName ?? null,
      hasBankDetails: !!row.bankDetails,
      bankDetails: row.bankDetails ?? null,
      note: row.note ?? null,
      issuedAt: row.issuedAt?.toISOString() ?? null,
      voidedAt: row.voidedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      lines: lines.map(toLineDto),
      payments: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        paidAt: p.paidAt.toISOString(),
        method: p.method ?? null,
        note: p.note ?? null,
      })),
    };
  });
}

/**
 * Raise one invoice per supplier from a period's supplier commission report.
 *
 * IDEMPOTENT per (tenant, period, supplier). A second call creates nothing and
 * reports which suppliers were already invoiced, with the number that did it.
 *
 * Suppliers that produced the whole statement as ambiguous (multi-leg) or
 * other-currency are skipped with a reason rather than silently omitted: a
 * missing invoice must never read as "nothing was owed".
 */
export async function createSupplierInvoicesFromReport(
  tenantId: string,
  from: string,
  to: string,
  createdBy?: string | null,
): Promise<CreateSupplierInvoicesResultDto> {
  // Report is built OUTSIDE the lock: holding an advisory lock across the whole
  // report query would serialize unrelated admin requests for no benefit.
  // A reversed range would silently produce an empty report and therefore bill
  // nothing, which reads exactly like "nothing was owed".
  if (from > to) {
    throw new Error(`Invalid period: ${from} is after ${to}`);
  }

  const report = await buildSupplierCommissionReport(tenantId, from, to);

  const result: CreateSupplierInvoicesResultDto = { created: [], alreadyInvoiced: [], skipped: [] };

  // Resolve the issuer's remittance details ONCE. Stored on the invoice so a
  // later change to the default account cannot rewrite an issued document.
  const [tenant] = await db
    .select({ settings: tenants.settings, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const settings = (tenant?.settings ?? {}) as TenantSettings;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`supplier-invoices:${tenantId}`}))`);

    for (const supplier of report.bySupplier) {
      if (parseFloat(supplier.totalCommission) <= 0) {
        result.skipped.push({
          supplierId: supplier.supplierId,
          supplierName: supplier.supplierName,
          reason: 'no commission in the period',
        });
        continue;
      }

      const sourceKey = `${tenantId}:supplier-invoice:${from}:${to}:${supplier.supplierId}`;

      // Checked BEFORE allocating a number. Allocating first burned a number on
      // every idempotent retry (a double click, a second tab) and left a gap in
      // an issued invoice series, which is an audit problem for a Danish tenant.
      const [already] = await tx
        .select({ invoiceNumber: supplierInvoices.invoiceNumber })
        .from(supplierInvoices)
        .where(eq(supplierInvoices.sourceKey, sourceKey))
        .limit(1);
      if (already) {
        result.alreadyInvoiced.push({
          supplierId: supplier.supplierId,
          supplierName: supplier.supplierName,
          invoiceNumber: already.invoiceNumber,
        });
        continue;
      }

      // Resolve who issues it and where to remit, preferring the supplier's own
      // preferred invoicing company (a supplier-specific billing entity), then
      // the tenant's default company + its default account.
      const [issuer] = await tx
        .select({
          companyId: counterparties.preferredInvoicingCompanyId,
        })
        .from(counterparties)
        .where(eq(counterparties.id, supplier.supplierId))
        .limit(1);

      const [fallbackCompany] = await tx
        .select({ id: counterparties.id, name: counterparties.name })
        .from(counterparties)
        .where(and(eq(counterparties.tenantId, tenantId), eq(counterparties.isOwnCompany, true)))
        .limit(1);

      const invoicingCompanyId = issuer?.companyId ?? fallbackCompany?.id ?? null;
      const [company] = invoicingCompanyId
        ? await tx
          .select({ name: counterparties.name })
          .from(counterparties)
          .where(eq(counterparties.id, invoicingCompanyId))
          .limit(1)
        : [];

      const [bank] = invoicingCompanyId
        ? await tx
          .select({
            id: bankAccounts.id,
            bankName: bankAccounts.bankName,
            accountName: bankAccounts.accountName,
            iban: bankAccounts.iban,
            swiftBic: bankAccounts.swiftBic,
            currency: bankAccounts.currency,
            branchAddress: bankAccounts.branchAddress,
          })
          .from(bankAccounts)
          .where(and(eq(bankAccounts.counterpartyId, invoicingCompanyId), eq(bankAccounts.isDefault, true)))
          .limit(1)
        : [];

      // Snapshot the remittance block as text: an issued invoice must keep
      // printing the account it was issued with.
      const bankDetails: SupplierInvoiceBankDetails | null = bank
        ? {
          beneficiary: company?.name ?? tenant?.name ?? null,
          // Usually identical to the beneficiary; kept separately so the
          // document can decide whether to print it twice.
          accountName: bank.accountName ?? null,
          bankName: bank.bankName ?? null,
          iban: bank.iban ?? null,
          swift: bank.swiftBic ?? null,
          currency: bank.currency ?? null,
          branchAddress: bank.branchAddress ?? null,
        }
        : null;

      const now = new Date();
      // Allocated on `tx`, so a failure after this point rolls the sequence back
      // with the insert instead of leaving a permanent gap.
      const invoiceNumber = await allocateSupplierInvoiceNumber(tenantId, now, tx);
      const amount = supplier.totalCommission;
      // Commission is not a delivered good, so there is no delivery date to
      // count credit from; the period end is the anchor. The number of days is
      // tenant-configurable because suppliers' terms differ.
      // Computed here rather than as SQL: a raw expression in `values()` binds
      // its parameter separately from the column list and the driver rejects the
      // mismatch.
      const termsDays = Number.isFinite(settings.supplierInvoiceTermsDays)
        ? Number(settings.supplierInvoiceTermsDays)
        : 30;
      const dueDate = (() => {
        const end = new Date(`${to}T00:00:00Z`);
        end.setUTCDate(end.getUTCDate() + termsDays);
        return end.toISOString().slice(0, 10);
      })();

      const [inserted] = await tx
        .insert(supplierInvoices)
        .values({
          tenantId,
          supplierId: supplier.supplierId,
          supplierName: supplier.supplierName,
          invoiceNumber,
          status: 'SENT',
          periodFrom: from,
          periodTo: to,
          currency: report.currency,
          amount,
          amountReceived: '0',
          dueDate,
          invoicingCompanyId,
          invoicingCompanyName: company?.name ?? null,
          bankAccountId: bank?.id ?? null,
          bankDetails,
          note: `Brokerage commission for ${supplier.lineCount} line(s), ${from} to ${to}`,
          issuedAt: now,
          sourceKey,
          createdBy: createdBy ?? null,
        })
        .onConflictDoNothing({ target: supplierInvoices.sourceKey })
        .returning();

      if (!inserted) {
        const [existing] = await tx
          .select({ invoiceNumber: supplierInvoices.invoiceNumber })
          .from(supplierInvoices)
          .where(eq(supplierInvoices.sourceKey, sourceKey))
          .limit(1);
        result.alreadyInvoiced.push({
          supplierId: supplier.supplierId,
          supplierName: supplier.supplierName,
          invoiceNumber: existing?.invoiceNumber ?? null,
        });
        continue;
      }

      await tx.insert(supplierInvoiceLines).values(
        supplier.orders.map((line, index) => ({
          supplierInvoiceId: inserted.id,
          // Traceability only; never rendered, and `ON DELETE SET NULL` keeps a
          // pruned order from touching a billed line.
          orderId: line.orderId ?? null,
          orderNumber: line.orderNumber,
          customerName: line.customerName,
          vesselName: line.vesselName,
          placeName: line.placeName,
          productType: line.productType,
          quantity: line.quantity,
          unit: line.unit,
          rate: line.commissionPerMt,
          amount: line.commissionAmount,
          sortOrder: index,
        })),
      );

      result.created.push({
        supplierId: supplier.supplierId,
        supplierName: supplier.supplierName,
        invoiceNumber: inserted.invoiceNumber,
        amount,
      });
    }
  });

  // Ambiguity and currency exclusions are reported against the period, since the
  // report refuses to attribute those lines to any supplier at all.
  for (const orderNumber of report.attributedToMultipleSuppliers) {
    result.skipped.push({
      supplierId: '',
      supplierName: '—',
      reason: `order ${orderNumber} has more than one supplier leg`,
    });
  }
  for (const orderNumber of report.excludedOtherCurrency) {
    result.skipped.push({
      supplierId: '',
      supplierName: '—',
      reason: `order ${orderNumber} is not in ${report.currency}`,
    });
  }

  return result;
}

/**
 * Void an issued supplier invoice. Issued invoices never re-render, so a
 * correction is a void plus a reissue — same rule as the customer side. The
 * number is NOT reused, so the two documents stay independently traceable.
 */
export async function voidSupplierInvoice(id: string, reason?: string | null): Promise<SupplierInvoiceDto | null> {
  const [tenant] = await db
    .select({ tenantId: supplierInvoices.tenantId })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, id))
    .limit(1);
  if (!tenant) return null;

  /**
   * The whole void runs inside the per-tenant advisory lock that the issuing
   * path also takes.
   *
   * Without it, releasing the idempotency key can race an in-flight issue: the
   * issuer reads "no invoice for this key", the void commits, and the operator
   * gets a create that either conflicts or silently duplicates the period.
   * Holding one lock across both operations makes the ordering deterministic.
   * Taking the lock in a separate transaction (as an earlier version did) would
   * release it before any of the work happened, which is worse than not taking
   * it at all.
   */
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`supplier-invoices:${tenant.tenantId}`}))`);

    const [row] = await tx
      .select({
        id: supplierInvoices.id,
        status: supplierInvoices.status,
        sourceKey: supplierInvoices.sourceKey,
        note: supplierInvoices.note,
      })
      .from(supplierInvoices)
      .where(eq(supplierInvoices.id, id))
      .limit(1);
    if (!row || row.status === 'VOID') return;

    /**
     * The idempotency key is RELEASED, not kept.
     *
     * It exists to stop a double click billing a period twice. Once the invoice
     * is void, that period must become billable again — otherwise voiding an
     * invoice raised at the wrong rate would permanently bar the correct one,
     * which is exactly when a reissue is needed. The voided row keeps its own
     * invoice NUMBER and its frozen lines, so the two documents stay traceable;
     * only the dedupe claim is given up.
     */
    await tx
      .update(supplierInvoices)
      .set({
        status: 'VOID',
        voidedAt: new Date(),
        sourceKey: null,
        // Record what the key was, so the link to the period survives the release.
        note: [row.note, reason ? `VOID: ${reason}` : 'VOID', row.sourceKey ? `released ${row.sourceKey}` : null]
          .filter(Boolean)
          .join(' | '),
        updatedAt: new Date(),
      })
      .where(eq(supplierInvoices.id, id));

    // Payments already logged against it must not keep pointing at a voided
    // document, or a settled invoice would strand its money.
    await tx
      .update(supplierPayments)
      .set({ supplierInvoiceId: null, updatedAt: new Date() })
      .where(eq(supplierPayments.supplierInvoiceId, id));
  });

  return getSupplierInvoice(id);
}

/** Suppliers on the tenant that owe commission in a period, for the UI picker. */
export async function listSuppliersWithSupplierCommission(
  tenantId: string,
  from: string,
  to: string,
): Promise<Array<{ supplierId: string; supplierName: string; totalCommission: string; alreadyInvoiced: string | null }>> {
  const report = await buildSupplierCommissionReport(tenantId, from, to);
  const existing = await db
    .select({ supplierId: supplierInvoices.supplierId, invoiceNumber: supplierInvoices.invoiceNumber })
    .from(supplierInvoices)
    .where(
      and(
        eq(supplierInvoices.tenantId, tenantId),
        eq(supplierInvoices.periodFrom, from),
        eq(supplierInvoices.periodTo, to),
        notInArray(supplierInvoices.status, ['VOID']),
      ),
    );
  const bySupplier = new Map(existing.map((e) => [e.supplierId, e.invoiceNumber]));

  return report.bySupplier.map((s) => ({
    supplierId: s.supplierId,
    supplierName: s.supplierName,
    totalCommission: s.totalCommission,
    alreadyInvoiced: bySupplier.get(s.supplierId) ?? null,
  }));
}

/** Guard used by the routes; exported so the gate has one definition. */
export async function assertSupplierInvoicesEnabled(tenantId: string): Promise<boolean> {
  const [tenant] = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return tenant?.settings?.brokerDeals?.enabled === true;
}
════ apps/api/src/modules/orders/supplier-invoice-ledger.ts
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
════ apps/api/src/modules/orders/supplier-invoices.controller.ts
/**
 * Supplier invoice routes — money owed TO us BY a supplier.
 *
 * Mounted under `/supplier-invoices`. Every route is gated on the tenant's
 * broker-deals flag: the nav link is hidden without it, but the API is the
 * authority, and an authenticated user of any tenant must not be able to raise
 * or read a supplier receivable.
 *
 * The PDF route renders from the invoice's frozen snapshot, not from the orders.
 * See `supplier-invoice-document.ts` for why that matters.
 */
import { Elysia, t } from 'elysia';
import { and, eq } from 'drizzle-orm';
import type { ApiResponse, SupplierInvoiceDto, CreateSupplierInvoicesResultDto } from '@fueld/types';
import { authGuard } from '../auth/auth.guard';
import { db } from '../../db';
import { counterparties, supplierInvoices, tenants, type TenantSettings } from '../../db/schema';
import { getDateFormatSettings, getDocumentBrandingSettings } from '../admin/settings.service';
import {
  buildDocumentFooter,
  createPdfBuffer,
  resolveTenantDocAccent,
  tryLoadLogoDataUrl,
} from '../documents/document.service';
import { buildSupplierInvoiceDocument } from '../documents/supplier-invoice-document';
import {
  assertSupplierInvoicesEnabled,
  createSupplierInvoicesFromReport,
  getSupplierInvoice,
  listSupplierInvoices,
  listSuppliersWithSupplierCommission,
  voidSupplierInvoice,
} from './supplier-invoice.service';

const DateOnly = t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });

export const supplierInvoicesController = new Elysia({ prefix: '/supplier-invoices' })
  .use(authGuard)

  // ── Who owes commission in a period, and has it been invoiced? ─────
  .get('/candidates', async ({ auth, query, set }) => {
    if (!(await assertSupplierInvoicesEnabled(auth.tenantId))) {
      set.status = 404;
      return { success: false, data: null, message: 'Broker deals are not enabled for this tenant' } satisfies ApiResponse<null>;
    }
    const data = await listSuppliersWithSupplierCommission(auth.tenantId, query.from, query.to);
    return { success: true, data } satisfies ApiResponse<typeof data>;
  }, {
    query: t.Object({ from: DateOnly, to: DateOnly }),
    detail: { tags: ['Supplier Invoices'], summary: 'Suppliers owing commission in a period', security: [{ bearerAuth: [] }] },
  })

  // ── Raise one invoice per supplier for the period ──────────────────
  .post('/', async ({ auth, body, set }) => {
    if (!(await assertSupplierInvoicesEnabled(auth.tenantId))) {
      set.status = 404;
      return { success: false, data: null, message: 'Broker deals are not enabled for this tenant' } satisfies ApiResponse<null>;
    }
    // Raising a receivable is an admin action, enforced here — the summary said
    // "admin only" while nothing checked the role.
    if (auth.role !== 'ADMIN') {
      set.status = 403;
      return { success: false, data: null, message: 'Admin access required' } satisfies ApiResponse<null>;
    }
    // Idempotent per (tenant, period, supplier): a repeat click creates nothing
    // and reports which suppliers were already invoiced.
    const data = await createSupplierInvoicesFromReport(auth.tenantId, body.from, body.to, auth.sub);
    return { success: true, data } satisfies ApiResponse<CreateSupplierInvoicesResultDto>;
  }, {
    body: t.Object({ from: DateOnly, to: DateOnly }),
    detail: { tags: ['Supplier Invoices'], summary: 'Create supplier invoices from a period (admin only)', security: [{ bearerAuth: [] }] },
  })

  // ── List ───────────────────────────────────────────────────────────
  .get('/', async ({ auth, query, set }) => {
    if (!(await assertSupplierInvoicesEnabled(auth.tenantId))) {
      set.status = 404;
      return { success: false, data: null, message: 'Broker deals are not enabled for this tenant' } satisfies ApiResponse<null>;
    }
    const data = await listSupplierInvoices(auth.tenantId, {
      supplierId: query.supplierId ?? null,
      includeVoid: query.includeVoid === 'true',
    });
    return { success: true, data } satisfies ApiResponse<SupplierInvoiceDto[]>;
  }, {
    query: t.Object({
      supplierId: t.Optional(t.String()),
      includeVoid: t.Optional(t.String()),
    }),
    detail: { tags: ['Supplier Invoices'], summary: 'List supplier invoices', security: [{ bearerAuth: [] }] },
  })

  // ── Detail ─────────────────────────────────────────────────────────
  .get('/:id', async ({ auth, params, set }) => {
    if (!(await assertSupplierInvoicesEnabled(auth.tenantId))) {
      set.status = 404;
      return { success: false, data: null, message: 'Broker deals are not enabled for this tenant' } satisfies ApiResponse<null>;
    }
    const invoice = await getSupplierInvoice(params.id);
    // Tenancy is enforced by comparing the invoice's tenant through its supplier
    // company's tenant; a missing or foreign invoice is a 404 either way, so an
    // id from another tenant is not distinguishable from a bad one.
    if (!invoice || !(await invoiceBelongsToTenant(invoice.id, auth.tenantId))) {
      set.status = 404;
      return { success: false, data: null, message: 'Supplier invoice not found' } satisfies ApiResponse<null>;
    }
    return { success: true, data: invoice } satisfies ApiResponse<SupplierInvoiceDto>;
  }, {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Supplier Invoices'], summary: 'Get a supplier invoice', security: [{ bearerAuth: [] }] },
  })

  // ── PDF ────────────────────────────────────────────────────────────
  .get('/:id/pdf', async ({ auth, params, set }) => {
    if (!(await assertSupplierInvoicesEnabled(auth.tenantId))) {
      set.status = 404;
      return { success: false, data: null, message: 'Broker deals are not enabled for this tenant' };
    }
    const invoice = await getSupplierInvoice(params.id);
    if (!invoice || !(await invoiceBelongsToTenant(invoice.id, auth.tenantId))) {
      set.status = 404;
      return { success: false, data: null, message: 'Supplier invoice not found' };
    }
    if (invoice.status === 'VOID') {
      set.status = 400;
      return { success: false, data: null, message: 'This invoice was voided and is kept for audit only.' };
    }

    const [tenant] = await db
      .select({ settings: tenants.settings, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, auth.tenantId))
      .limit(1);
    const settings = (tenant?.settings ?? {}) as TenantSettings;

    // Issuer branding is resolved live (it is our letterhead, not the billed
    // party's) but every figure and party below comes from the frozen snapshot.
    /**
     * Resolved by id AND tenant, never by name. `counterparties.name` is not
     * unique across tenants, so a name lookup could pull another tenant's logo,
     * address and VAT onto our invoice. The id is stored at issue for exactly
     * this reason; the frozen name is only a display fallback.
     */
    const [company] = invoice.invoicingCompanyId
      ? await db
        .select({
          name: counterparties.name,
          address: counterparties.headOfficeAddress,
          phone: counterparties.headOfficePhone,
          email: counterparties.headOfficeEmail,
          vatNumber: counterparties.vatNumber,
          logoUrl: counterparties.logoUrl,
          brandColor: counterparties.brandColor,
        })
        .from(counterparties)
        .where(and(eq(counterparties.id, invoice.invoicingCompanyId), eq(counterparties.tenantId, auth.tenantId)))
        .limit(1)
      : [];

    const { dateFormat } = await getDateFormatSettings(auth.tenantId);
    const { enabled: brandingEnabled, layout } = await getDocumentBrandingSettings(auth.tenantId);
    const accent = resolveTenantDocAccent(company?.brandColor ?? null, brandingEnabled) ?? '#0f766e';

    const footer = buildDocumentFooter({
      senderName: invoice.invoicingCompanyName ?? company?.name ?? tenant?.name ?? '',
      companyAddress: company?.address ?? null,
      companyPhone: company?.phone ?? null,
      companyEmail: company?.email ?? null,
      vatNumber: company?.vatNumber ?? null,
      companyRegistrationNumber: null,
      printMeta: null,
      dateFormat,
      accent,
    });

    // The remittance block was snapshotted at issue, so an issued invoice keeps
    // printing the account it was issued with.
    const bankDetails = invoice.bankDetails;

    const docDefinition = buildSupplierInvoiceDocument({
      invoice,
      bankDetails,
      logoDataUrl: tryLoadLogoDataUrl(company?.logoUrl ?? null),
      layout,
      footer,
    });

    const buffer = await createPdfBuffer(docDefinition as never);
    const safeNumber = invoice.invoiceNumber.replace(/[^a-zA-Z0-9-]/g, '_');

    set.headers['Content-Type'] = 'application/pdf';
    set.headers['Content-Disposition'] = `attachment; filename="Supplier_Invoice_${safeNumber}.pdf"`;
    set.headers['Content-Length'] = String(buffer.length);
    return buffer;
  }, {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Supplier Invoices'], summary: 'Supplier invoice PDF', security: [{ bearerAuth: [] }] },
  })

  // ── Void ───────────────────────────────────────────────────────────
  .post('/:id/void', async ({ auth, params, body, set }) => {
    if (!(await assertSupplierInvoicesEnabled(auth.tenantId))) {
      set.status = 404;
      return { success: false, data: null, message: 'Broker deals are not enabled for this tenant' } satisfies ApiResponse<null>;
    }
    // Voiding a money document is an admin action.
    if (auth.role !== 'ADMIN') {
      set.status = 403;
      return { success: false, data: null, message: 'Admin access required' } satisfies ApiResponse<null>;
    }
    if (!(await invoiceBelongsToTenant(params.id, auth.tenantId))) {
      set.status = 404;
      return { success: false, data: null, message: 'Supplier invoice not found' } satisfies ApiResponse<null>;
    }
    const invoice = await voidSupplierInvoice(params.id, body?.reason ?? null);
    return { success: true, data: invoice } satisfies ApiResponse<SupplierInvoiceDto | null>;
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Optional(t.Object({ reason: t.Optional(t.Nullable(t.String())) })),
    detail: { tags: ['Supplier Invoices'], summary: 'Void a supplier invoice', security: [{ bearerAuth: [] }] },
  });

/**
 * Tenancy check. `supplier_invoices.tenant_id` is the authority: the caller must
 * own the row before anything is returned. A foreign id and a bad id both 404,
 * so an id from another tenant is not even distinguishable.
 */
async function invoiceBelongsToTenant(invoiceId: string, tenantId: string): Promise<boolean> {
  const [row] = await db
    .select({ tenantId: supplierInvoices.tenantId })
    .from(supplierInvoices)
    .where(and(eq(supplierInvoices.id, invoiceId), eq(supplierInvoices.tenantId, tenantId)))
    .limit(1);
  return !!row;
}
════ apps/api/src/modules/documents/supplier-invoice-document.ts
/**
 * Supplier invoice PDF — a document addressed to a SUPPLIER, asking them to pay
 * commission they funded on a broker deal.
 *
 * ── It renders from the snapshot, never from the orders ────────────────────
 * Every value on the page comes from `supplier_invoices` / `supplier_invoice_lines`,
 * which were frozen at issue. It deliberately does NOT load the order, the
 * counterparty or the bank account: an issued invoice must keep serving the
 * figures and the remittance details it was issued with, so renaming a company,
 * editing a rate, delivering the order or changing the default bank account
 * cannot restate a document the supplier already holds.
 *
 * That is also why this builder takes a DTO rather than an order id — there is
 * no id it could accidentally re-read live data through.
 *
 * Layout: `buildSleekDocument` for the modern layout, mirroring the customer
 * invoice; the classic branch is the same structure without the sleek styling.
 */
import { buildSleekDocument, type SleekDocumentInput } from './document-layouts/sleek';
import type { SupplierInvoiceBankDetailsDto, SupplierInvoiceDto } from '@fueld/types';

const ACCENT = '#0f766e';
const INK = '#111827';
const MUTED = '#6b7280';

function formatAmount(value: string, currency: string): string {
  const n = parseFloat(value) || 0;
  const formatted = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${formatted} ${currency}`;
}

function formatQty(value: string | null): string {
  if (value == null) return '';
  const n = parseFloat(value) || 0;
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function formatDateOnly(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Everything the document needs, as plain values. Assembled from the frozen
 * snapshot so the function has no way to reach live data.
 */
export interface SupplierInvoiceDocumentInput {
  invoice: SupplierInvoiceDto;
  /**
   * Frozen at issue. Structured, so each field is labelled rather than inferred
   * from its position in a blob — a missing bank name used to shift every
   * subsequent field and print the IBAN under the "SWIFT" label.
   */
  bankDetails: SupplierInvoiceBankDetailsDto | null;
  logoDataUrl: string | null;
  /** Tenant document layout setting. */
  layout: 'CLASSIC' | 'SLEEK';
  /** Footer closure, built by the caller from tenant settings. */
  footer: (currentPage: number, pageCount: number) => unknown;
}

function buildLines(invoice: SupplierInvoiceDto) {
  return invoice.lines.map((line) => ({
    description: [line.productType ?? '', line.vesselName ? `— ${line.vesselName}` : '']
      .filter(Boolean)
      .join(' '),
    quantity: formatQty(line.quantity),
    unit: line.unit ?? '',
    rate: line.rate ? `${parseFloat(line.rate).toLocaleString('en-US', { maximumFractionDigits: 4 })}` : '',
    amount: formatAmount(line.amount, invoice.currency),
    orderNumber: line.orderNumber ?? '',
    customerName: line.customerName ?? '',
  }));
}

/**
 * The document body. Deliberately explicit about who pays whom: a supplier
 * reading this must understand it is being billed for commission, not being
 * paid for fuel.
 */
export function buildSupplierInvoiceDocument(input: SupplierInvoiceDocumentInput) {
  const { invoice } = input;
  const lines = buildLines(invoice);

  const meta = [
    { label: 'Invoice no.', value: invoice.invoiceNumber },
    { label: 'Issued', value: formatDateOnly(invoice.issuedAt?.slice(0, 10) ?? null) ?? '—' },
    { label: 'Due', value: formatDateOnly(invoice.dueDate) ?? '—' },
    { label: 'Period', value: `${formatDateOnly(invoice.periodFrom) ?? invoice.periodFrom} – ${formatDateOnly(invoice.periodTo) ?? invoice.periodTo}` },
  ];

  const noteLines = [
    'Brokerage commission on bunker deliveries brokered by us. This is a charge for the commission agreed',
    'per line below, which is funded by you as the supplier — it is not an invoice for fuel.',
    ...(invoice.note ? ['', invoice.note] : []),
  ];

  if (input.layout === 'SLEEK') {
    const sleekInput: SleekDocumentInput = {
      brandName: invoice.invoicingCompanyName ?? '',
      logoDataUrl: input.logoDataUrl,
      title: 'Supplier Invoice',
      meta,
      issuer: {
        name: invoice.invoicingCompanyName ?? '',
        address: null,
        taxId: null,
        phone: null,
        email: null,
      },
      party: {
        name: invoice.supplierName,
        address: null,
        attention: null,
        taxId: null,
      },
      voyage: [],
      lines: lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        // The rate IS the price here: commission per unit.
        unitPrice: l.rate ? `${l.rate} ${invoice.currency}/${l.unit || 'MT'}` : '',
        amount: l.amount,
      })),
      headers: ['Product', 'Quantity', 'Unit', 'Rate', 'Amount'],
      totals: {
        subtotal: formatAmount(invoice.amount, invoice.currency),
        taxable: formatAmount(invoice.amount, invoice.currency),
        taxLabel: '',
        taxAmount: '',
        total: formatAmount(invoice.amount, invoice.currency),
        totalShortLabel: 'Total due',
        totalLabel: null,
      },
      dueLine: `The amount is due on ${formatDateOnly(invoice.dueDate) ?? invoice.dueDate}.`,
      trancheNote: null,
      bank: input.bankDetails
        ? {
          beneficiary: input.bankDetails.beneficiary ?? '',
          bankName: input.bankDetails.bankName,
          accountNumber: null,
          iban: input.bankDetails.iban,
          swift: input.bankDetails.swift,
          branchAddress: input.bankDetails.branchAddress,
        }
        : null,
      notes: noteLines,
      accent: ACCENT,
      verifyUrl: null,
      verifyLink: null,
      fraudPreventionText: null,
      accountName: null,
      closing: null,
      // `buildDocumentFooter` returns pdfmake Content; the layout only calls it.
      footer: input.footer as SleekDocumentInput['footer'],
    };
    return buildSleekDocument(sleekInput);
  }

  // ── Classic layout ────────────────────────────────────────────────
  const body: unknown[] = [
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: 'INVOICE TO (SUPPLIER)', fontSize: 8, color: MUTED, bold: true, margin: [0, 0, 0, 3] },
            { text: invoice.supplierName, fontSize: 11, bold: true, color: INK },
          ],
        },
        {
          width: 'auto',
          stack: meta.map((m) => ({
            text: [{ text: `${m.label}:  `, color: MUTED }, { text: m.value, bold: true }],
            fontSize: 9,
            alignment: 'right' as const,
            margin: [0, 0, 0, 2],
          })),
        },
      ],
      margin: [0, 0, 0, 14],
    },
    {
      table: {
        headerRows: 1,
        widths: ['auto', 'auto', '*', 'auto', 'auto', 'auto'],
        body: [
          ['Order', 'Customer', 'Product', 'Qty', 'Rate', 'Amount'].map((t) => ({
            text: t, fontSize: 8, bold: true, color: MUTED, border: [false, false, false, true],
          })),
          ...lines.map((l) => [
            { text: l.orderNumber, fontSize: 8 },
            { text: l.customerName, fontSize: 8 },
            { text: l.description, fontSize: 9 },
            { text: `${l.quantity} ${l.unit}`, fontSize: 9, alignment: 'right' as const },
            { text: l.rate, fontSize: 9, alignment: 'right' as const },
            { text: l.amount, fontSize: 9, alignment: 'right' as const },
          ]),
          [
            { text: '', border: [false, false, false, false] },
            { text: '', border: [false, false, false, false] },
            { text: '', border: [false, false, false, false] },
            { text: '', border: [false, false, false, false] },
            { text: 'TOTAL', fontSize: 9, bold: true, alignment: 'right' as const, border: [false, true, false, false] },
            { text: formatAmount(invoice.amount, invoice.currency), fontSize: 10, bold: true, alignment: 'right' as const, border: [false, true, false, false] },
          ],
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 0, 0, 12],
    },
    {
      text: noteLines.join('\n'),
      fontSize: 8,
      color: MUTED,
      margin: [0, 0, 0, 12],
    },
    ...(input.bankDetails
      ? [{
        stack: [
          { text: 'REMITTANCE', fontSize: 8, bold: true, color: MUTED, margin: [0, 0, 0, 3] },
          ...remittanceLines(input.bankDetails).map((l) => ({ text: l, fontSize: 9 })),
        ],
      }]
      : []),
  ];

  return {
    pageSize: 'A4' as const,
    pageMargins: [40, 50, 40, 60] as [number, number, number, number],
    content: body,
    footer: input.footer,
    defaultStyle: { fontSize: 9, color: INK },
  };
}

/**
 * Label each remittance field explicitly. The previous implementation joined
 * the values with newlines and re-split them by position in the PDF, so an
 * absent bank name or SWIFT code shifted every later value onto the wrong label.
 */
function remittanceLines(bank: SupplierInvoiceBankDetailsDto): string[] {
  const beneficiary = bank.beneficiary?.trim() ?? '';
  const accountName = bank.accountName?.trim() ?? '';
  return [
    beneficiary,
    // Usually identical to the beneficiary; print once when it is.
    accountName && accountName !== beneficiary ? accountName : '',
    bank.bankName?.trim() ?? '',
    bank.iban?.trim() ? `IBAN ${bank.iban.trim()}` : '',
    bank.swift?.trim() ? `SWIFT/BIC ${bank.swift.trim()}` : '',
    bank.currency?.trim() ? `Currency ${bank.currency.trim()}` : '',
    bank.branchAddress?.trim() ?? '',
  ].filter((l) => l.length > 0);
}
════ apps/api/drizzle/0135_supplier_invoices.sql
-- Supplier invoices: Moxie invoicing a SUPPLIER for commission the supplier funds.
--
-- ── Why a separate table, not a payer on `invoices` ────────────────────────
-- `invoices` is the customer receivable ledger: it is keyed only by `order_id`
-- and has NO party column, so every reader infers the payer from
-- `orders.client_id`:
--
--   dashboard.service.ts   collections widget
--   reports.service.ts     invoice ageing
--   company.service.ts     outstanding balance
--   quickbooks.service.ts  QuickBooks *Customer* (there is no vendor path)
--
-- Adding a nullable payer to `invoices` would mean auditing and correcting all
-- four, and would still leave one number series shared between money owed to us
-- and money owed by us. Instead the supplier side is its own table with its own
-- series: supplier receivables are invisible to the customer readers by
-- construction, not by a filter someone can forget. That is the whole point of
-- the split — a customer statement and a supplier statement must never be able
-- to contaminate each other.
--
-- ── What the invoice is ────────────────────────────────────────────────────
-- On a broker deal the supplier invoices the customer directly and Moxie's
-- revenue is its commission. Daniel (Moxie) confirmed 2026-09-29 that when the
-- negotiated rate is above the standing $3/MT it is funded by the SUPPLIER
-- ("Thor Marine paying the whole 19"). The supplier therefore owes Moxie that
-- commission, and Moxie needs to bill for it.
--
-- ── The snapshot is the document ───────────────────────────────────────────
-- `supplier_invoice_lines` stores the order, customer, vessel, place, product,
-- quantity, rate and amount as VALUES, captured once at issue. It deliberately
-- does NOT join back to `orders`/`order_items` to render. An issued invoice is a
-- frozen artifact: renaming a counterparty, editing a rate, or delivering the
-- order must not silently restate a document the supplier already holds. This
-- mirrors the `document_revisions` principle on the customer side, and it is why
-- the party names are denormalised text rather than foreign keys.

CREATE TYPE supplier_invoice_status AS ENUM (
  'DRAFT',
  'SENT',
  'OVERDUE',
  'PARTIALLY_PAID',
  'PAID',
  'VOID'
);

CREATE TABLE supplier_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- The party being billed. Kept as a real FK for querying; the NAME that
  -- prints on the document is snapshotted on the lines' parent below.
  supplier_id uuid NOT NULL REFERENCES counterparties(id),
  supplier_name text NOT NULL,
  -- Tenant-scoped, NOT globally unique. Numbers are allocated from a per-tenant
  -- sequence with a per-tenant template, so two tenants on the default template
  -- would both mint `SINV-2026-0001` and the second insert would fail on a global
  -- constraint. The uniqueness that matters is "unique within the books that
  -- issued it".
  invoice_number text NOT NULL,
  status supplier_invoice_status NOT NULL DEFAULT 'DRAFT',

  -- The commission period this statement covers.
  period_from date NOT NULL,
  period_to date NOT NULL,

  currency text NOT NULL,
  -- Total billed, and how much of it has come back. Both frozen/derived in
  -- cents so the document foots.
  amount numeric(14, 2) NOT NULL DEFAULT 0,
  amount_received numeric(14, 2) NOT NULL DEFAULT 0,
  due_date date NOT NULL,

  -- Who is issuing (Moxie) and where to remit. Resolved at issue and stored, so
  -- changing the default bank account later does not rewrite an issued invoice.
  invoicing_company_id uuid REFERENCES counterparties(id),
  invoicing_company_name text,
  bank_account_id uuid REFERENCES bank_accounts(id),
  -- Structured, NOT a delimited string. The PDF resolved remittance fields by
  -- position in a newline-joined blob, so a missing bank name or SWIFT code
  -- shifted every field and printed the wrong one against the wrong label.
  bank_details jsonb,

  note text,
  issued_at timestamp with time zone,
  voided_at timestamp with time zone,

  -- Idempotency key: `<tenant>:supplier-invoice:<from>:<to>:<supplierId>`.
  -- The partial unique index below is what makes "bill this period" safe to
  -- repeat — the same guarantee `orders.source_key` gives commission orders.
  source_key text,

  created_by uuid REFERENCES users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- A PLAIN unique index, not a partial one (`WHERE source_key IS NOT NULL`).
-- `ON CONFLICT` can only infer a partial index when the statement repeats the
-- predicate, and Drizzle's `onConflictDoNothing` drops `targetWhere`, emitting
-- `on conflict ("source_key")` — which fails against a partial index with
-- "no unique or exclusion constraint matching the ON CONFLICT specification"
-- (42P10). Postgres treats NULLs as distinct in a unique index anyway, so every
-- human-created invoice (source_key NULL) is unconstrained regardless and the
-- partial predicate buys nothing. Same reasoning as 0132_order_source_key.
CREATE UNIQUE INDEX supplier_invoices_source_key_unique
  ON supplier_invoices (source_key);

-- Replaces the global UNIQUE on invoice_number: see the column comment.
CREATE UNIQUE INDEX supplier_invoices_tenant_number_unique
  ON supplier_invoices (tenant_id, invoice_number);

CREATE INDEX supplier_invoices_tenant_supplier_idx
  ON supplier_invoices (tenant_id, supplier_id);

-- One row per commissioned line, captured at issue. All descriptive fields are
-- TEXT on purpose (see the header note).
CREATE TABLE supplier_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  -- Kept for traceability only; ON DELETE SET NULL so pruning an old order can
  -- never delete or alter a billed line.
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  order_number text,
  customer_name text,
  vessel_name text,
  place_name text,
  product_type text,
  quantity numeric(14, 6),
  unit text,
  rate numeric(14, 7),
  amount numeric(14, 2) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX supplier_invoice_lines_invoice_idx
  ON supplier_invoice_lines (supplier_invoice_id);

-- Its own number series. Sharing `invoice_number_sequences` would interleave the
-- customer and supplier series, so a gap or a duplicate in one would look like a
-- problem in the other.
CREATE TABLE supplier_invoice_number_sequences (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE PRIMARY KEY,
  last_seq integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Money received FROM a supplier settles a supplier invoice. The existing
-- `supplier_payments.invoice_id` points at `invoices` (the customer ledger) and
-- is never written today; that column is left alone and this is the link that
-- actually means "this receipt settles this supplier invoice".
ALTER TABLE supplier_payments
  ADD COLUMN supplier_invoice_id uuid REFERENCES supplier_invoices(id) ON DELETE SET NULL;

CREATE INDEX supplier_payments_supplier_invoice_idx
  ON supplier_payments (supplier_invoice_id);

```
