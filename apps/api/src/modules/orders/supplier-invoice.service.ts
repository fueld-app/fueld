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
   * The caller's transaction. REQUIRED, with no default: this used to default to
   * the pool handle, which silently reintroduced the very bug it was added for
   * (a sequence increment that survived a rollback) for any caller that forgot
   * the argument. Making it mandatory turns that into a compile error.
   */
  executor: Pick<typeof db, 'insert' | 'select'>,
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

/**
 * Read one invoice.
 *
 * `tenantId` is REQUIRED and filtered here rather than checked by the caller
 * afterwards: this function refreshes `amount_received`, which is a WRITE, and a
 * caller-side check that runs after the read let any authenticated user cause a
 * write to another tenant's row by naming its id (the response was 404ed, but
 * the write had already happened). Ownership is now established before anything
 * is touched.
 */
export async function getSupplierInvoice(id: string, tenantId: string): Promise<SupplierInvoiceDto | null> {
  const [owned] = await db
    .select({ id: supplierInvoices.id })
    .from(supplierInvoices)
    .where(and(eq(supplierInvoices.id, id), eq(supplierInvoices.tenantId, tenantId)))
    .limit(1);
  if (!owned) return null;

  // Refresh the received figure from the payments that actually exist before
  // reading it. `amount_received` is a cache, and a payment written by any path
  // that does not go through the ledger helper (support SQL, a future bulk tool)
  // would otherwise leave a stale outstanding figure with no way to self-heal.
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
    // Ordered explicitly: `inArray` has no inherent order, and the response order
    // follows this map. Without it the list is arbitrary rather than newest-first.
    db.select().from(supplierInvoices)
      .where(inArray(supplierInvoices.id, ids))
      .orderBy(desc(supplierInvoices.createdAt)),
    db.select().from(supplierInvoiceLines)
      .where(inArray(supplierInvoiceLines.supplierInvoiceId, ids))
      .orderBy(asc(supplierInvoiceLines.sortOrder), asc(supplierInvoiceLines.createdAt)),
    db.select({
      id: supplierPayments.id,
      supplierInvoiceId: supplierPayments.supplierInvoiceId,
      amount: supplierPayments.amount,
      currency: supplierPayments.currency,
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
    // ONLY receipts in the invoice's own currency count. The detail path applies
    // the same filter in `recomputeSupplierInvoiceReceived`; without it here the
    // list and the detail could report different outstanding figures for the
    // same invoice, which is worse than either alone.
    const received = payments
      .filter((p) => (p.currency ?? '').toUpperCase() === (row.currency ?? '').toUpperCase())
      .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
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

      /**
       * The issuer is resolved WITH the tenant predicate, on the write path as
       * well as the read path. A `preferredInvoicingCompanyId` pointing at
       * another tenant's company would otherwise freeze that tenant's name and
       * bank details onto an issued document — and because the snapshot is
       * frozen, the mistake would be permanent.
       */
      const requestedCompanyId = issuer?.companyId ?? fallbackCompany?.id ?? null;
      const [company] = requestedCompanyId
        ? await tx
          .select({ id: counterparties.id, name: counterparties.name })
          .from(counterparties)
          .where(and(eq(counterparties.id, requestedCompanyId), eq(counterparties.tenantId, tenantId)))
          .limit(1)
        : [];
      // Falls back to the tenant's own company when the preferred one is not ours.
      const resolvedCompany = company ?? fallbackCompany ?? null;
      const invoicingCompanyId = resolvedCompany?.id ?? null;

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

      // Snapshot the remittance block as structured values: an issued invoice
      // must keep printing the account it was issued with, and each field must
      // stay labelled rather than being inferred from a position in a string.
      const bankDetails: SupplierInvoiceBankDetails | null = bank
        ? {
          beneficiary: resolvedCompany?.name ?? tenant?.name ?? null,
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
      // Coerced before the check: `Number.isFinite('45')` is false, so a numeric
      // string in the settings blob would silently fall back to 30.
      const configuredTerms = Number(settings.supplierInvoiceTermsDays);
      const termsDays = Number.isFinite(configuredTerms) && configuredTerms >= 0 ? configuredTerms : 30;
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
          invoicingCompanyName: resolvedCompany?.name ?? null,
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
export async function voidSupplierInvoice(id: string, tenantId: string, reason?: string | null): Promise<SupplierInvoiceDto | null> {
  const [tenant] = await db
    .select({ tenantId: supplierInvoices.tenantId })
    .from(supplierInvoices)
    .where(and(eq(supplierInvoices.id, id), eq(supplierInvoices.tenantId, tenantId)))
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

  return getSupplierInvoice(id, tenantId);
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
