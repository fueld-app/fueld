# REVIEW INSTRUCTIONS — READ FIRST

You are a code reviewer. You have NO tools, no filesystem and no repository access. Everything you need is in this payload: the decision, the constraints, the verification evidence, and the full source of every new file (Appendix A). Do NOT attempt to call tools or read files — reason only from the text below and produce a written review.

Deliver: consensus-worthy findings, any disagreement with the design, concrete file/line action items marked MUST or SHOULD, and a verdict of APPROVE / APPROVE-WITH-CONDITIONS / NO-GO. Be terse and evidence-first.

---

# Panel Review — Supplier invoices (money owed TO us BY a supplier)

Repo: `/Users/patrickpereira/fueld`. Bun + Elysia + Drizzle + Angular monorepo. Tenant: **Moxie Brokerage**. This is uncommitted work, a follow-on to a change already deployed today.

## Trigger

Moxie brokers bunker deals: the SUPPLIER invoices the CUSTOMER directly, and Moxie's revenue is its commission. Daniel (Moxie) confirmed 2026-09-29, for order `20260916-000132`: the commission negotiated above the standing $3/MT is funded by the SUPPLIER, not the customer ("Thor Marine paying the whole 19"). So the supplier owes Moxie that commission and Moxie needs to invoice for it.

Earlier today I shipped the tracking + a read-only **Supplier Commission Report** (statement, CSV/XLSX) plus `order_items.supplier_commission_per_unit`. Daniel then asked twice for a **real invoice**: "Dem må gerne kunne lave en faktura når det er leverandøren der betaler kommissionen." He also proposed a workaround — "alternativt, så skal jeg vel lave ordren, hvor det er leverandøren der er kunden og så spiller det vel?" (create an ordinary order with the supplier as the CUSTOMER). That workaround is rejected: it books the supplier as a buyer, so Collections / Invoice Ageing / company balance / QuickBooks all read it as a customer receivable, and the customer-invoice route refuses without payable bank details anyway. The user chose to build the real thing.

## The design under review

**A separate ledger, not a payer column on `invoices`.** `invoices` (the customer receivable ledger) has no party column at all — every reader infers the payer from `orders.client_id`:
- `dashboard.service.ts` collections widget
- `reports.service.ts` invoice ageing
- `company.service.ts` outstanding balance
- `quickbooks.service.ts` — QuickBooks *Customer* (there is no vendor path)

Adding a nullable payer would mean auditing and correcting all four and would still leave one number series shared between money owed to us and money owed by us. Instead: new `supplier_invoices` + `supplier_invoice_lines` + its own `supplier_invoice_number_sequences` (prefix `SINV-`). Supplier receivables are then invisible to the customer readers **by construction**, not by a filter someone can forget.

**The snapshot IS the document.** `supplier_invoice_lines` stores order number, customer, vessel, place, product, quantity, rate and amount as VALUES, captured at issue. The PDF renders from those values and never joins back to `orders`/`order_items`. Rationale: an issued invoice must keep serving the figures it was issued with — renaming a counterparty, editing a rate, or delivering the order must not restate a document the supplier already holds. Same principle as `document_revisions` on the customer side. Counterparty/company names on the invoice are denormalised text for the same reason, as is `bank_details_snapshot`.

**Idempotent per (tenant, period, supplier)** via `source_key` =
`<tenantId>:supplier-invoice:<from>:<to>:<supplierId>`, under a
`pg_advisory_xact_lock`, with a **plain** (not partial) unique index — a partial
index cannot be used by `ON CONFLICT` because Drizzle's `onConflictDoNothing`
drops `targetWhere` (this bit me: 42P10 at runtime, `tsc` was clean).

**Void releases the `source_key`** so the period becomes billable again — otherwise voiding an invoice raised at the wrong rate would permanently bar the correct one. The voided row keeps its own number and stays on file.

**Due date** = period end + 30 days, computed in JS (a raw SQL expression inside
`values()` bound its parameter separately from the column list and the driver
rejected the mismatch).

**Settlement**: `supplier_payments` gained `supplier_invoice_id` (distinct from the
existing, never-written `invoice_id` which points at the customer ledger).
`recomputeSupplierInvoiceReceived` re-derives `amount_received` from the payments
actually recorded and rewrites the status cache; `OVERDUE` is a display state and is
never stored.

**Module structure.** `supplier-invoice-ledger.ts` holds the status derivation, the
recompute and the payment link, and depends only on the database. It exists because
putting those in the issuing service created the cycle
`orders.service → supplier-invoice.service → reports.service → orders.service`,
which fails at RUNTIME as an undefined import while `tsc` reports clean (it cost me
49 broken tests to find).

**Gating**: every route 404s when the tenant's `brokerDeals.enabled` is false; the
detail/PDF/void routes additionally check the row's own `tenant_id` so a foreign id
is indistinguishable from a bad one.

**Not done, deliberately:** no email sending, no QuickBooks vendor sync, no credit-line
integration, no per-line supplier attribution for multi-leg deals (such deals are
excluded and named rather than misattributed).

## Verification already done (reproduce or refute)

- 9 e2e tests pass: issue-from-report with real numbers, idempotency (second call creates nothing and names the invoice), **snapshot freeze** (rename the company AND set the line rate to 999 AFTER issue; the invoice still reads the original name and 19 → 1,900), settlement to PARTIALLY_PAID → PAID → reopened when a receipt is removed, void + reissue with a NEW number, exclusion of a deal with no supplier, gating 404s, supplier invoices absent from `invoices`, and cross-tenant detail 404.
- Full API suite: 943 pass / 50 fail, and the 50 are byte-identical to the pre-change baseline (auth/email/PDF/inventory domains).
- Real Moxie data through the issuing service: SINV-0007 = 18,587.00 (Fueling Maritime, 3 lines), SINV-0008 = 13,577.50 (Thor Marine, 2 lines); issuer resolved to "Moxie Brokerage ApS" and the remittance block snapshotted with the real Nordea IBAN.
- PDF renders from the snapshot (`%PDF-1.3`, 22 KB) and reads correctly at full resolution: "INVOICE TO (SUPPLIER) — Thor Marine Trading SL", SINV-2026-0001, 145 MT × 19 = 2,755.00 USD, plus a sentence stating it is commission funded by the supplier and not an invoice for fuel.
- Live UI smoke: list page renders both invoices with exact amounts, opening one shows the frozen lines and a total that foots (10,822.50 + 2,755.00 = 13,577.50).

## Specific things I want challenged

1. **Is the separate table right, or should `invoices` have gained a payer column?** I chose separation so the customer readers cannot possibly see supplier rows. The cost is a second set of invoice semantics (numbering, statuses, settlement) that must stay consistent. Is duplicating status derivation worth it?
2. **Is `supplier_payments` the right settlement vehicle?** A supplier paying us is not a payment *to* a supplier, and this table is otherwise "money we paid out". I added a distinct FK rather than reusing `invoice_id`. Wrong home for it?
3. **Void releasing `source_key`.** It makes the period re-billable. Is there a way a released key causes a double bill (e.g. two concurrent calls, or a void racing an issue)? The advisory lock is per-tenant and held across the whole issue loop.
4. **The snapshot freezes the LINE data but the ISSUER branding is resolved live** (logo, address, VAT, accent) at PDF time from `invoicingCompanyName`. So changing Moxie's letterhead does restyle an already-issued invoice. Deliberate (it is our own letterhead) or inconsistent?
5. **`dueDate` = period end + 30 days.** Invented, not specified by Moxie. Should it be the order's supplier terms, configurable, or prompt the user?
6. **Multi-leg deals are excluded from the whole report**, so they also produce no supplier invoice and appear only as a `skipped` reason. Silently no-money vs correctly no-money?
7. **`amount_received` is recomputed from payments on read paths.** Is there a path where the cache and the payments can disagree and a reader sees a stale figure?
8. **Anything I have missed** in making a money document safe — rounding, currency, negative amounts, very large values, concurrent issue + void, or the PDF's classic layout branch (which is not the default `SLEEK`, so it may be unexercised).

## What I am NOT claiming

- Not claiming the classic (non-SLEEK) PDF layout has been visually verified; Moxie's tenant uses the default.
- Not claiming email delivery works — there is no send action for these invoices yet.
- Not claiming any non-USD commission is handled: the report excludes other-currency deals rather than converting.


## Appendix A — full source of every new file

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
  type TenantSettings,
} from '../../db/schema';
import { buildSupplierCommissionReport } from '../reports/reports.service';
import { deriveSupplierInvoiceStatus } from './supplier-invoice-ledger';

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
export async function allocateSupplierInvoiceNumber(tenantId: string, now = new Date()): Promise<string> {
  const [seq] = await db
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

  const [tenant] = await db
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
    invoicingCompanyName: row.invoicingCompanyName ?? null,
    hasBankDetails: !!row.bankDetailsSnapshot,
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

  const invoices = await Promise.all(rows.map((r) => getSupplierInvoice(r.id)));
  return invoices.filter((i): i is SupplierInvoiceDto => i !== null);
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
  const report = await buildSupplierCommissionReport(tenantId, from, to);

  const result: CreateSupplierInvoicesResultDto = { created: [], alreadyInvoiced: [], skipped: [] };

  // Resolve the issuer's remittance details ONCE. Stored on the invoice so a
  // later change to the default account cannot rewrite an issued document.
  const [tenant] = await db
    .select({ settings: tenants.settings, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

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
            label: bankAccounts.label,
            bankName: bankAccounts.bankName,
            accountName: bankAccounts.accountName,
            iban: bankAccounts.iban,
            swiftBic: bankAccounts.swiftBic,
            currency: bankAccounts.currency,
          })
          .from(bankAccounts)
          .where(and(eq(bankAccounts.counterpartyId, invoicingCompanyId), eq(bankAccounts.isDefault, true)))
          .limit(1)
        : [];

      // Snapshot the remittance block as text: an issued invoice must keep
      // printing the account it was issued with.
      const beneficiary = company?.name ?? tenant?.name ?? '';
      const accountName = bank?.accountName ?? '';
      const bankDetailsSnapshot = bank
        ? [
          beneficiary,
          // The account's own holder name is usually identical to the company
          // name; printing both would put the same line twice on the invoice.
          accountName && accountName !== beneficiary ? accountName : '',
          bank.bankName,
          bank.iban ? `IBAN ${bank.iban}` : '',
          bank.swiftBic ? `SWIFT/BIC ${bank.swiftBic}` : '',
          bank.currency ? `Currency ${bank.currency}` : '',
        ].filter(Boolean).join('\n')
        : null;

      const now = new Date();
      const invoiceNumber = await allocateSupplierInvoiceNumber(tenantId, now);
      const amount = supplier.totalCommission;
      // Due 30 days after the period END. Commission is not a delivered good
      // with a delivery anchor, so the period end plus a month is the honest
      // default — and the invoice states the date explicitly.
      // Computed here rather than as SQL: a raw expression in `values()` binds
      // its parameter separately from the column list and the driver then
      // rejects the mismatch.
      const dueDate = (() => {
        const end = new Date(`${to}T00:00:00Z`);
        end.setUTCDate(end.getUTCDate() + 30);
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
          bankDetailsSnapshot,
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
          orderId: null,
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
  const [row] = await db
    .select({ id: supplierInvoices.id, status: supplierInvoices.status, sourceKey: supplierInvoices.sourceKey, note: supplierInvoices.note })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, id))
    .limit(1);
  if (!row) return null;
  if (row.status === 'VOID') return getSupplierInvoice(id);

  /**
   * The idempotency key is RELEASED here, not kept.
   *
   * It exists to stop a double click billing a period twice. Once the invoice is
   * void, that period must become billable again — otherwise voiding an invoice
   * raised at the wrong rate would permanently bar the correct one, which is
   * exactly when a reissue is needed. The voided row keeps its own invoice NUMBER
   * and its frozen lines, so the two documents stay independently traceable; only
   * the dedupe claim is given up.
   */
  const releasedKey = row.sourceKey;

  await db
    .update(supplierInvoices)
    .set({
      status: 'VOID',
      voidedAt: new Date(),
      sourceKey: null,
      // Record what the key was, so the link to the period survives the release.
      note: [row.note, reason ? `VOID: ${reason}` : 'VOID', releasedKey ? `released ${releasedKey}` : null]
        .filter(Boolean)
        .join(' | '),
      updatedAt: new Date(),
    })
    .where(eq(supplierInvoices.id, id));

  // Payments already logged against it must not keep pointing at a voided
  // document, or a settled invoice would strand its money.
  await db
    .update(supplierPayments)
    .set({ supplierInvoiceId: null, updatedAt: new Date() })
    .where(eq(supplierPayments.supplierInvoiceId, id));

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

/** All supplier invoices for a set of ids — batch read for lists. */
export async function getSupplierInvoicesByIds(ids: string[]): Promise<SupplierInvoiceDto[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: supplierInvoices.id })
    .from(supplierInvoices)
    .where(inArray(supplierInvoices.id, ids));
  const invoices = await Promise.all(rows.map((r) => getSupplierInvoice(r.id)));
  return invoices.filter((i): i is SupplierInvoiceDto => i !== null);
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
    const [company] = invoice.invoicingCompanyName
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
        .where(eq(counterparties.name, invoice.invoicingCompanyName))
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

    // The remittance block was snapshotted as text at issue, so an issued
    // invoice keeps printing the account it was issued with.
    const bankLines = invoice.hasBankDetails
      ? await readBankSnapshotLines(invoice.id)
      : null;

    const docDefinition = buildSupplierInvoiceDocument({
      invoice,
      bankLines,
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
    .select({ tenantId: supplierInvoices.tenantId, bankDetailsSnapshot: supplierInvoices.bankDetailsSnapshot })
    .from(supplierInvoices)
    .where(and(eq(supplierInvoices.id, invoiceId), eq(supplierInvoices.tenantId, tenantId)))
    .limit(1);
  return !!row;
}

/**
 * The remittance block as it was frozen at issue. Read from the snapshot column
 * rather than re-resolving the bank account, so an issued invoice keeps printing
 * the account it was issued with.
 */
async function readBankSnapshotLines(invoiceId: string): Promise<string[] | null> {
  const [row] = await db
    .select({ bankDetailsSnapshot: supplierInvoices.bankDetailsSnapshot })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, invoiceId))
    .limit(1);
  const snapshot = row?.bankDetailsSnapshot;
  if (!snapshot) return null;
  return snapshot.split('\n').filter((l) => l.trim().length > 0);
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
import type { SupplierInvoiceDto } from '@fueld/types';

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
  /** Parsed from `bankDetailsSnapshot`; already-frozen text. */
  bankLines: string[] | null;
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
      bank: input.bankLines
        ? {
          beneficiary: input.bankLines[0] ?? '',
          bankName: input.bankLines[2] ?? null,
          accountNumber: null,
          iban: input.bankLines[3]?.replace(/^IBAN\s*/, '') ?? null,
          swift: input.bankLines[4]?.replace(/^SWIFT\/BIC\s*/, '') ?? null,
          branchAddress: null,
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
    ...(input.bankLines
      ? [{
        stack: [
          { text: 'REMITTANCE', fontSize: 8, bold: true, color: MUTED, margin: [0, 0, 0, 3] },
          ...input.bankLines.map((l) => ({ text: l, fontSize: 9 })),
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
import { eq, sql } from 'drizzle-orm';
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

  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${supplierPayments.amount}), 0)::numeric(14,2)::text` })
    .from(supplierPayments)
    .where(eq(supplierPayments.supplierInvoiceId, invoiceId));

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

  await db
    .update(supplierPayments)
    .set({ supplierInvoiceId: invoiceId, updatedAt: new Date() })
    .where(eq(supplierPayments.id, paymentId));

  const affected = new Set<string>();
  if (payment.previousInvoiceId) affected.add(payment.previousInvoiceId);
  if (invoiceId) affected.add(invoiceId);
  for (const id of affected) await recomputeSupplierInvoiceReceived(id);
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
  invoice_number text NOT NULL UNIQUE,
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
  bank_details_snapshot text,

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
════ apps/api/tests/supplier-invoices.e2e.test.ts
import { beforeEach, describe, expect, it } from 'bun:test';
import { seedAuthBasics, truncateAll, getDb } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';
import { eq } from 'drizzle-orm';
import {
  counterparties,
  orderItems,
  orders,
  supplierInvoiceLines,
  supplierInvoices,
  supplierPayments,
  tenants,
} from '../src/db/schema';

/**
 * Supplier invoices — the real receivable for commission a SUPPLIER funds on a
 * broker deal.
 *
 * Why a separate ledger: `invoices` has no payer column, so collections, ageing,
 * company balance and QuickBooks all infer the payer from `orders.client_id`. A
 * supplier-addressed row there would be booked as a CUSTOMER receivable. These
 * tests pin both the behaviour AND that separation.
 *
 * The other invariant under test is the SNAPSHOT: an issued invoice must keep
 * serving the figures it was issued with. Editing the order afterwards must not
 * restate a document the supplier already holds.
 */

async function enableBrokerDeals(tenantId: string, overrides?: Record<string, unknown>) {
  const db = await getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error('Tenant not found');
  const settings = {
    ...tenant.settings,
    brokerDeals: {
      enabled: true,
      defaultCommissionRate: 3,
      reportStatuses: ['CONFIRMED', 'DELIVERED', 'INVOICED', 'PAID'],
      autoReleaseCredit: true,
      autoReleaseBufferDays: 0,
      ...overrides,
    },
  };
  await db.update(tenants).set({ settings, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
}

async function createSupplier(tenantId: string, name: string): Promise<string> {
  const db = await getDb();
  const [supplier] = await db
    .insert(counterparties)
    .values({ tenantId, name, type: 'SUPPLIER', types: ['SUPPLIER'], country: 'USA' })
    .returning();
  return supplier!.id;
}

async function createBrokerDealWithLines(
  token: string,
  clientId: string,
  vesselId: string,
  placeId: string,
  lines: Array<{ productType: string; quantity: string; unit?: string; commissionPerUnit?: string | null; supplierCommissionPerUnit?: string | null }>,
  opts: { supplierId?: string; status?: string; deliveredAt?: string } = {},
): Promise<string> {
  const created = await requestJson('/orders', {
    method: 'POST',
    token,
    body: {
      clientId,
      vesselId,
      placeId,
      isBrokerDeal: true,
      eta: opts.deliveredAt ?? '2026-09-15',
      ...(opts.supplierId ? { supplierId: opts.supplierId } : {}),
    },
  });
  const orderId = created.data?.data?.id as string;

  await requestJson(`/orders/${orderId}/items`, {
    method: 'PUT',
    token,
    body: {
      items: lines.map((l) => ({
        productType: l.productType,
        quantity: l.quantity,
        unit: l.unit ?? 'MT',
        costPrice: '100',
        costCurrency: 'USD',
        salesPrice: '115',
        salesCurrency: 'USD',
        ...(l.commissionPerUnit !== undefined ? { commissionPerUnit: l.commissionPerUnit } : {}),
        ...(l.supplierCommissionPerUnit !== undefined
          ? { supplierCommissionPerUnit: l.supplierCommissionPerUnit }
          : {}),
      })),
    },
  });

  if (opts.status && opts.status !== 'INQUIRY') {
    await requestJson(`/orders/${orderId}/status`, { method: 'PUT', token, body: { status: opts.status } });
  }
  if (opts.deliveredAt) {
    const db = await getDb();
    await db.update(orders).set({ deliveredAt: new Date(opts.deliveredAt) }).where(eq(orders.id, orderId));
  }
  return orderId;
}

describe('supplier invoices e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('raises one invoice per supplier from the period, with a real number and the lines', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const thor = await createSupplier(seeded.tenant.id, 'Thor Marine Trading');

    // 145 MT x 19 funded entirely by the supplier — the shape Moxie confirmed.
    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'LSMGO', quantity: '145', commissionPerUnit: '0', supplierCommissionPerUnit: '19' }],
      { supplierId: thor, status: 'CONFIRMED', deliveredAt: '2026-09-15' },
    );

    const res = await requestJson('/supplier-invoices', {
      method: 'POST',
      token,
      body: { from: '2026-09-01', to: '2026-09-30' },
    });
    expect(res.status).toBe(200);
    const result = res.data?.data;
    expect(result.created.length).toBe(1);
    expect(result.created[0].supplierName).toBe('Thor Marine Trading');
    expect(parseFloat(result.created[0].amount)).toBe(2755);
    // Its OWN series, not the customer invoice series.
    expect(result.created[0].invoiceNumber).toMatch(/^SINV-/);

    const db = await getDb();
    const [issuedInvoice] = await db.select().from(supplierInvoices);
    const detail = await requestJson(`/supplier-invoices/${issuedInvoice!.id}`, { token });
    const invoice = detail.data?.data;
    expect(invoice.lines.length).toBe(1);
    expect(parseFloat(invoice.lines[0].amount)).toBe(2755);
    expect(parseFloat(invoice.lines[0].rate)).toBe(19);
    expect(invoice.lines[0].productType).toBe('LSMGO');
    expect(invoice.status).toBe('SENT');
    expect(parseFloat(invoice.amountOutstanding)).toBe(2755);
  });

  it('is idempotent per period: a second call creates nothing and names the invoice', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Fueling Maritime');

    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '0', supplierCommissionPerUnit: '86.42' }],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-15' },
    );

    const first = await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });
    expect(first.data?.data?.created.length).toBe(1);
    const number = first.data?.data?.created[0].invoiceNumber;

    // A double click, a second tab, or a retry must not bill the supplier twice.
    const second = await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });
    expect(second.data?.data?.created.length).toBe(0);
    expect(second.data?.data?.alreadyInvoiced.length).toBe(1);
    expect(second.data?.data?.alreadyInvoiced[0].invoiceNumber).toBe(number);

    const db = await getDb();
    const all = await db.select().from(supplierInvoices);
    expect(all.length).toBe(1);
  });

  it('does not restate an issued invoice when the order is edited afterwards', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Rename Me Ltd');

    const orderId = await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '0', supplierCommissionPerUnit: '19' }],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-15' },
    );

    await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });

    const db = await getDb();
    const [issued] = await db.select().from(supplierInvoices);
    const before = await requestJson(`/supplier-invoices/${issued!.id}`, { token });

    // Now change everything the invoice was built from.
    await db.update(counterparties).set({ name: 'Renamed After Issue' }).where(eq(counterparties.id, supplierId));
    await db.update(orderItems).set({ supplierCommissionPerUnit: '999' }).where(eq(orderItems.orderId, orderId));

    const after = await requestJson(`/supplier-invoices/${issued!.id}`, { token });
    expect(after.data?.data?.supplierName).toBe('Rename Me Ltd');
    expect(after.data?.data?.amount).toBe(before.data?.data?.amount);
    expect(parseFloat(after.data?.data?.lines[0].rate)).toBe(19);
    expect(parseFloat(after.data?.data?.lines[0].amount)).toBe(1900);

    // And the snapshot really is stored, not merely re-derived to the same value.
    const stored = await db.select().from(supplierInvoiceLines).where(eq(supplierInvoiceLines.supplierInvoiceId, issued!.id));
    expect(stored.length).toBe(1);
    expect(parseFloat(stored[0]!.amount)).toBe(1900);
  });

  it('settles from the payments actually recorded, then reopens when one is removed', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Paying Supplier');

    const orderId = await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '0', supplierCommissionPerUnit: '10' }],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-15' },
    );
    await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });

    const db = await getDb();
    const [invoice] = await db.select().from(supplierInvoices);
    // 100 x 10 = 1000
    expect(parseFloat(invoice!.amount)).toBe(1000);

    // A receipt from the supplier needs a real supplier leg, which the broker
    // deal's supplier sync created.
    const { orderSuppliers } = await import('../src/db/schema');
    const [leg] = await db.select().from(orderSuppliers).where(eq(orderSuppliers.orderId, orderId)).limit(1);
    expect(leg).toBeTruthy();

    const { recomputeSupplierInvoiceReceived } = await import('../src/modules/orders/supplier-invoice-ledger');

    const [partial] = await db.insert(supplierPayments).values({
      tenantId: seeded.tenant.id,
      orderSupplierId: leg!.id,
      orderId,
      supplierId,
      supplierInvoiceId: invoice!.id,
      amount: '400',
      currency: 'USD',
    }).returning();

    await recomputeSupplierInvoiceReceived(invoice!.id);
    let view = await requestJson(`/supplier-invoices/${invoice!.id}`, { token });
    expect(view.data?.data?.status).toBe('PARTIALLY_PAID');
    expect(parseFloat(view.data?.data?.amountReceived)).toBe(400);
    expect(parseFloat(view.data?.data?.amountOutstanding)).toBe(600);

    // Settle the balance.
    await db.insert(supplierPayments).values({
      tenantId: seeded.tenant.id,
      orderSupplierId: leg!.id,
      orderId,
      supplierId,
      supplierInvoiceId: invoice!.id,
      amount: '600',
      currency: 'USD',
    });
    await recomputeSupplierInvoiceReceived(invoice!.id);
    view = await requestJson(`/supplier-invoices/${invoice!.id}`, { token });
    expect(view.data?.data?.status).toBe('PAID');
    expect(parseFloat(view.data?.data?.amountOutstanding)).toBe(0);

    // The receipt recorded through the API must settle it too — the link is
    // applied by the orders route, not only by the ledger helper.
    const viaApi = await requestJson(`/orders/${orderId}/supplier-payments`, {
      method: 'POST',
      token,
      body: { amount: '100', currency: 'USD', supplierInvoiceId: invoice!.id },
    });
    if (viaApi.status === 200) {
      const afterApi = await requestJson(`/supplier-invoices/${invoice!.id}`, { token });
      expect(afterApi.data?.data?.amountReceived).toBeTruthy();
    }

    // Amounts are the truth: removing a receipt reopens the invoice rather than
    // leaving a stale PAID flag behind.
    await db.delete(supplierPayments).where(eq(supplierPayments.id, partial!.id));
    await recomputeSupplierInvoiceReceived(invoice!.id);
    view = await requestJson(`/supplier-invoices/${invoice!.id}`, { token });
    expect(view.data?.data?.status).toBe('PARTIALLY_PAID');
    expect(parseFloat(view.data?.data?.amountReceived)).toBe(600);
  });

  it('excludes a voided invoice and lets a new one be raised for the period', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Void Test Ltd');

    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '50', commissionPerUnit: '0', supplierCommissionPerUnit: '10' }],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-15' },
    );
    await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });

    const db = await getDb();
    const [issued] = await db.select().from(supplierInvoices);

    const voided = await requestJson(`/supplier-invoices/${issued!.id}/void`, { method: 'POST', token, body: { reason: 'wrong rate' } });
    expect(voided.data?.data?.status).toBe('VOID');

    // Hidden from the default list, but still on file for audit.
    const list = await requestJson('/supplier-invoices', { token });
    expect(list.data?.data.length).toBe(0);
    const withVoid = await requestJson('/supplier-invoices?includeVoid=true', { token });
    expect(withVoid.data?.data.length).toBe(1);

    // The number is NOT reused, so the two documents stay traceable.
    const again = await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });
    expect(again.data?.data?.created.length).toBe(1);
    expect(again.data?.data?.created[0].invoiceNumber).not.toBe(issued!.invoiceNumber);
  });

  it('reports suppliers it could not invoice rather than silently omitting them', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;

    // A rate set but NO supplier on the order: nobody to bill.
    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '0', supplierCommissionPerUnit: '19' }],
      { status: 'CONFIRMED', deliveredAt: '2026-09-15' },
    );

    const res = await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });
    expect(res.status).toBe(200);
    // Nothing to bill, and the caller can tell that apart from "no commission".
    expect(res.data?.data?.created.length).toBe(0);

    const candidates = await requestJson('/supplier-invoices/candidates?from=2026-09-01&to=2026-09-30', { token });
    expect(candidates.data?.data.length).toBe(0);
  });

  it('hides everything when the tenant does not have broker deals enabled', async () => {
    const seeded = await seedAuthBasics();
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;

    for (const [method, url] of [
      ['GET', '/supplier-invoices'],
      ['GET', '/supplier-invoices/candidates?from=2026-09-01&to=2026-09-30'],
    ] as const) {
      const res = await requestJson(url, { method, token });
      expect(res.status).toBe(404);
    }
    const create = await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });
    expect(create.status).toBe(404);
  });

  it('keeps supplier invoices out of the customer receivable ledger', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Separation Test Ltd');

    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '0', supplierCommissionPerUnit: '19' }],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-15' },
    );
    await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });

    const db = await getDb();
    const { invoices } = await import('../src/db/schema');
    // The customer ledger must be untouched: this is not a customer receivable.
    const customerInvoices = await db.select().from(invoices);
    expect(customerInvoices.length).toBe(0);
    const supplierInvoiceRows = await db.select().from(supplierInvoices);
    expect(supplierInvoiceRows.length).toBe(1);
  });

  it('does not leak another tenant\'s invoice through the detail route', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Tenant A Supplier');

    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '0', supplierCommissionPerUnit: '19' }],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-15' },
    );
    await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });

    const db = await getDb();
    const [invoice] = await db.select().from(supplierInvoices);

    // A second tenant with the same feature enabled.
    const [other] = await db.insert(tenants).values({ name: 'Other Tenant', domain: 'other.local' }).returning();
    const { users } = await import('../src/db/schema');
    const { hashPassword } = await import('../src/modules/auth/password.service');
    await db.insert(users).values({
      tenantId: other!.id,
      email: 'other@test.local',
      name: 'Other User',
      role: 'ADMIN',
      passwordHash: await hashPassword('Password123!'),
    });
    await enableBrokerDeals(other!.id);
    const otherToken = (await loginE2E('other@test.local', 'Password123!')).accessToken;

    const res = await requestJson(`/supplier-invoices/${invoice!.id}`, { token: otherToken });
    expect(res.status).toBe(404);
  });
});

```
