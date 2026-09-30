# REVIEW — INSTRUCTIONS

You are a code reviewer. You have NO tools, no filesystem, no repository access. Everything you need is in this payload. Do NOT attempt to call tools or read files — reason over the text only and produce a written review.

NOTE ON THIS REVISION: a previous round of this brief omitted Appendix A by mistake (a comment-anchored extraction matched the CUSTOMER ledger further down the same file and produced an empty block). The ledger implementation is now included as Appendix A in full. If you reviewed the defective payload, review Appendix A now.

Deliver: findings marked MUST or SHOULD with file/symbol references, any disagreement with the approach, and a verdict: APPROVE / APPROVE-WITH-CONDITIONS / NO-GO. Terse, evidence-first. Where you assert something is wrong, quote the line you rely on.

# Context

Moxie is a bunker broker. On a broker deal commission can be funded by the SUPPLIER rather than the customer. Fueld issues that supplier a real invoice: `supplier_invoices` + `supplier_invoice_lines`, its own `SINV-` series, deliberately a SEPARATE ledger from the customer receivable ledger (`invoices`), because `invoices` has no payer column and collections/ageing/company-balance/QuickBooks all infer the payer from `orders.client_id` — a supplier-addressed row there would book as a customer receivable. Three earlier panel rounds' MUSTs are closed (commit 339f8c4e).

## Change A — receipts now appear in the supplier ledger

`supplier_receipts` holds money the SUPPLIER paid US. `getSupplierPaymentLedger` previously ignored it, so the supplier's position was wrong.

`outstanding` for the supplier side is now `totalCost - totalPaid - totalReceived`.

Load-bearing decisions:
- `totalPaid` deliberately still does NOT include receipts. `supplier_payments` is the outbound ledger ("fuel we paid a supplier for"); summing a receipt into it would report commission RECEIVED as fuel we PAID FOR — the exact direction confusion `supplier_receipts` was split out to prevent (a prior round's bug). Receipts move the POSITION but never `totalPaid`.
- Receipts on a VOIDED invoice are excluded from `totalReceived` and from `outstanding` (a voided claim is not a live credit; counting it would understate what we owe on a reissue). They are reported separately as `unappliedReceipts` so the cash is visible rather than vanishing.
- New per-currency fields: `totalReceived`, `receivedCount`. A receipt in a currency with no fuel cost is still emitted.
- Date filters (`dateFrom`/`dateTo`) apply to receipts by `receivedAt`; the unapplied figure is intentionally unfiltered (it is a stock, not a flow).

## Change B — emailing the supplier invoice

`POST /supplier-invoices/:id/send`. Previously the operator downloaded the PDF and mailed it by hand.
- A supplier invoice covers a PERIOD and many deals, so it cannot ride the order-scoped `POST /orders/:id/email` (no vessel/port/single order). Hence a new route.
- The PDF uses the SAME code as the download: `renderSupplierInvoicePdf` was extracted into `supplier-invoice-pdf.ts` so previewed and mailed bytes cannot drift.
- Recipient: optional override; else resolved server-side from the supplier's company emails — `emailType === 'invoice'` first, else `general`, preferring `isPrimary`; none → HTTP 400 naming them, because a payable silently unsent is a loss.
- `SendDocumentEmailOptions.orderId` became optional (`email_log.order_id` is nullable) as a period invoice has no single order.
- `DocumentEmailType` gained `'SUPPLIER_INVOICE'`; subject/HTML builders gained optional order fields plus invoice-shaped ones, and now OMIT Vessel/Port rows rather than printing "undefined".
- VOID invoices cannot be sent.

# Changes made since the previous (defective) payload, in response to findings
- `supplier-invoice-pdf.ts`: dropped a dead `settings` const (it was dead in the inlined original too — not carried forward into a new file).
- `mail.service.ts`: guarded EVERY order-scoped interpolation of `vesselName`/`portName`/`orderNumber` (subjects, HTML intros, labels map) with `?? ''`. A finding argued the blanket-optional fields created a silent "undefined" path for future order-scoped callers; that is now impossible, though the fields remain optional (a discriminated union was considered; the guards are narrower and do not disturb the many existing callers).
- `company.service.ts`: added `unappliedReceipts` so voided-invoice receipts cannot become invisible cash (a finding from all three reviewers).
- Tests: added the unapplied assertion, a cross-tenant `/send` 404 test.
- Deliberate disagreement, stated for review: the send route returns `err.message` on 500. The repo's own send route does the same, and the most likely failure ("SMTP is not configured…") is the ONLY actionable text an operator can get. I did not redact it.

# What to scrutinise hardest
1. Is `outstanding = cost - paid - received` right, or should receipts be reported without moving it? Is netting a receivable against a payable defensible for a "position with this supplier" figure?
2. `unappliedReceipts`: does it close the hole, or does it open another (double count on reissue, unfiltered vs filtered inconsistency, a receipt that still can't be seen)? Is leaving it outside the date filters correct?
3. Tenant isolation and wrong-party risk on `/send`.
4. Did the `renderSupplierInvoicePdf` extraction change semantics versus the inlined original?
5. The optional-field loosening in the shared builders — can any existing caller regress?


# Appendix A — company.service.ts :: getSupplierPaymentLedger (FULL FUNCTION, the previously-missing hunk)

```ts
export async function getSupplierPaymentLedger(
  companyId: string,
  opts: { limit?: number; offset?: number; sort?: 'date' | 'amount'; dateFrom?: string; dateTo?: string } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;
  const sortCol = opts.sort === 'amount' ? supplierPayments.amount : supplierPayments.paidAt;

  const conditions = [eq(supplierPayments.supplierId, companyId)];
  if (opts.dateFrom) conditions.push(sql`${supplierPayments.paidAt} >= ${opts.dateFrom}`);
  if (opts.dateTo) conditions.push(sql`${supplierPayments.paidAt} <= ${opts.dateTo}`);

  const rows = await db
    .select({
      id: supplierPayments.id,
      orderId: supplierPayments.orderId,
      orderNumber: orders.orderNumber,
      orderSupplierId: supplierPayments.orderSupplierId,
      amount: supplierPayments.amount,
      currency: supplierPayments.currency,
      paidAt: supplierPayments.paidAt,
      method: supplierPayments.method,
      note: supplierPayments.note,
      createdAt: supplierPayments.createdAt,
    })
    .from(supplierPayments)
    .leftJoin(orders, eq(orders.id, supplierPayments.orderId))
    .where(and(...conditions))
    .orderBy(desc(sortCol))
    .limit(limit)
    .offset(offset);

  // Totals per currency
  const totalsRows = await db
    .select({
      currency: supplierPayments.currency,
      totalPaid: sql<string>`COALESCE(SUM(${supplierPayments.amount}), 0)::numeric(14,2)`,
      count: sql<number>`count(*)::int`,
    })
    .from(supplierPayments)
    .where(and(...conditions))
    .groupBy(supplierPayments.currency);

  // Outstanding per currency: sum(cost) - sum(paid)
  // Cost = sum(order_items.cost_price * quantity) for orders where supplier = companyId
  // Simplified: use order_suppliers to find legs for this supplier, then sum order_items cost
  const outstandingByCurrency = await db
    .select({
      currency: orders.currency,
      totalCost: sql<string>`COALESCE(SUM(${orderItems.costPrice} * ${orderItems.quantity}), 0)::numeric(14,2)`,
    })
    .from(orderSuppliers)
    .innerJoin(orders, eq(orders.id, orderSuppliers.orderId))
    .innerJoin(orderItems, eq(orderItems.orderSupplierId, orderSuppliers.id))
    .where(eq(orderSuppliers.companyId, companyId))
    .groupBy(orders.currency);

  const totalsByCurrency = new Map<string, { totalPaid: number; count: number; totalCost: number; outstanding: number }>();
  for (const t of totalsRows) {
    totalsByCurrency.set(t.currency, { totalPaid: Number(t.totalPaid), count: t.count, totalCost: 0, outstanding: 0 });
  }
  for (const o of outstandingByCurrency) {
    const entry = totalsByCurrency.get(o.currency) ?? { totalPaid: 0, count: 0, totalCost: 0, outstanding: 0 };
    entry.totalCost = Number(o.totalCost);
    entry.outstanding = entry.totalCost - entry.totalPaid;
    totalsByCurrency.set(o.currency, entry);
  }
  for (const [cur, entry] of totalsByCurrency) {
    if (entry.totalCost === 0 && entry.totalPaid > 0) entry.outstanding = -entry.totalPaid;
  }

  /**
   * Money the SUPPLIER paid US — broker commission they fund.
   *
   * The opposite direction to `totalPaid`. It is deliberately NOT summed into
   * it: that would report commission received as fuel we paid for, which is the
   * exact confusion the separate `supplier_receipts` table exists to prevent.
   *
   * It IS netted into `outstanding`, because outstanding is a position, not a
   * one-way total: we owe this supplier cost-minus-paid for fuel, but they owe
   * us the receipts, and a person asking "what is the position with this
   * supplier" means the difference. Only settled invoices count — a receipt on a
   * VOID invoice still moved cash (we keep those rows for audit) but is not a
   * live credit, so including it would understate what we owe.
   */
  const receivedByCurrency = await db
    .select({
      currency: supplierReceipts.currency,
      totalReceived: sql<string>`COALESCE(SUM(${supplierReceipts.amount}), 0)::numeric(14,2)`,
      count: sql<number>`count(*)::int`,
    })
    .from(supplierReceipts)
    .innerJoin(supplierInvoices, eq(supplierInvoices.id, supplierReceipts.supplierInvoiceId))
    .where(and(
      eq(supplierReceipts.supplierId, companyId),
      ne(supplierInvoices.status, 'VOID'),
      ...(opts.dateFrom ? [sql`${supplierReceipts.receivedAt} >= ${opts.dateFrom}`] : []),
      ...(opts.dateTo ? [sql`${supplierReceipts.receivedAt} <= ${opts.dateTo}`] : []),
    ))
    .groupBy(supplierReceipts.currency);

  /**
   * Receipts held against a VOIDED invoice — "unapplied".
   *
   * These are real cash we hold, but they are not a live credit against any
   * claim, so they stay out of `totalReceived` and out of `outstanding`. Silently
   * dropping them would be the mirror of the bug this table exists to fix: money
   * that vanished from the page. So they are reported as their own figure, which
   * is what the money is — held, pending reissue or refund — and the operator can
   * see it rather than having to remember.
   */
  const unappliedRows = await db
    .select({
      currency: supplierReceipts.currency,
      amount: sql<string>`COALESCE(SUM(${supplierReceipts.amount}), 0)::numeric(14,2)`,
      count: sql<number>`count(*)::int`,
    })
    .from(supplierReceipts)
    .innerJoin(supplierInvoices, eq(supplierInvoices.id, supplierReceipts.supplierInvoiceId))
    .where(and(eq(supplierReceipts.supplierId, companyId), eq(supplierInvoices.status, 'VOID')))
    .groupBy(supplierReceipts.currency);

  const totals = Array.from(totalsByCurrency.entries()).map(([currency, t]) => {
    const received = receivedByCurrency.find((r) => r.currency === currency);
    const totalReceived = Number(received?.totalReceived ?? 0);
    return {
      currency,
      totalPaid: t.totalPaid.toFixed(2),
      totalCost: t.totalCost.toFixed(2),
      totalReceived: totalReceived.toFixed(2),
      outstanding: (t.outstanding - totalReceived).toFixed(2),
      count: t.count,
      receivedCount: received?.count ?? 0,
    };
  });

  // A receipt in a currency with no fuel cost at all still has to appear, or the
  // money vanishes from the page and the totals stop adding up.
  for (const r of receivedByCurrency) {
    if (totalsByCurrency.has(r.currency)) continue;
    totals.push({
      currency: r.currency,
      totalPaid: '0.00',
      totalCost: '0.00',
      totalReceived: Number(r.totalReceived).toFixed(2),
      outstanding: (-Number(r.totalReceived)).toFixed(2),
      count: 0,
      receivedCount: r.count,
    });
  }

  return {
    payments: rows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      orderNumber: r.orderNumber,
      orderSupplierId: r.orderSupplierId,
      amount: String(r.amount),
      currency: r.currency,
      paidAt: r.paidAt.toISOString(),
      method: r.method,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    })),
    totals,
    /**
     * Cash held against voided invoices, per currency. Not netted into
     * `outstanding` (a voided claim is not a live one) but never hidden either.
     */
    unappliedReceipts: unappliedRows.map((r) => ({
      currency: r.currency,
      amount: Number(r.amount).toFixed(2),
      count: r.count,
    })),
    pagination: { limit, offset, hasMore: rows.length === limit },
  };
}
```

# Appendix B — supplier-invoice-pdf.ts (new file, whole)

```ts
/**
 * Rendering a supplier invoice PDF, and the email that carries it.
 *
 * Extracted from the PDF route so the download and the send are the SAME bytes.
 * Two renderers would drift: the operator would mail a PDF that differs from the
 * one they previewed, which on a payable document is a dispute waiting to happen.
 *
 * The document is rendered from the invoice's frozen snapshot (see
 * `supplier-invoice-document.ts`), so sending an old invoice re-renders what it
 * said at issue, not what the deals say today.
 */
import { and, eq } from 'drizzle-orm';
import type { SupplierInvoiceDto } from '@fueld/types';
import { db } from '../../db';
import { counterparties, tenants } from '../../db/schema';
import { getDateFormatSettings, getDocumentBrandingSettings } from '../admin/settings.service';
import {
  buildDocumentFooter,
  createPdfBuffer,
  resolveTenantDocAccent,
  tryLoadLogoDataUrl,
} from '../documents/document.service';
import { buildSupplierInvoiceDocument } from '../documents/supplier-invoice-document';

export interface RenderedSupplierInvoice {
  buffer: Buffer;
  fileName: string;
}

/**
 * Render the PDF for an invoice that has already been fetched and authorised.
 *
 * Issuer branding is resolved LIVE — it is our own letterhead, so a rebrand or a
 * new logo should apply. Every figure and PARTY below comes from the frozen
 * snapshot, and the counterparty is resolved by id AND tenant: `name` is not
 * unique across tenants, so a name lookup could pull another tenant's address
 * and VAT onto our invoice.
 */
export async function renderSupplierInvoicePdf(
  invoice: SupplierInvoiceDto,
  tenantId: string,
): Promise<RenderedSupplierInvoice> {
  const [tenant] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

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
      .where(and(eq(counterparties.id, invoice.invoicingCompanyId), eq(counterparties.tenantId, tenantId)))
      .limit(1)
    : [];

  const { dateFormat } = await getDateFormatSettings(tenantId);
  const { enabled: brandingEnabled, layout } = await getDocumentBrandingSettings(tenantId);
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
  const docDefinition = buildSupplierInvoiceDocument({
    invoice,
    bankDetails: invoice.bankDetails,
    logoDataUrl: tryLoadLogoDataUrl(company?.logoUrl ?? null),
    layout,
    footer,
  });

  const buffer = await createPdfBuffer(docDefinition as never);
  const safeNumber = invoice.invoiceNumber.replace(/[^a-zA-Z0-9-]/g, '_');

  return { buffer, fileName: `Supplier_Invoice_${safeNumber}.pdf` };
}
```

# Appendix C — supplier-invoices.controller.ts (diff)

```diff
diff --git a/apps/api/src/modules/orders/supplier-invoices.controller.ts b/apps/api/src/modules/orders/supplier-invoices.controller.ts
index 8640623f..39cefb0f 100644
--- a/apps/api/src/modules/orders/supplier-invoices.controller.ts
+++ b/apps/api/src/modules/orders/supplier-invoices.controller.ts
@@ -14,15 +14,9 @@ import { and, eq } from 'drizzle-orm';
 import type { ApiResponse, SupplierInvoiceDto, CreateSupplierInvoicesResultDto } from '@fueld/types';
 import { authGuard } from '../auth/auth.guard';
 import { db } from '../../db';
-import { counterparties, supplierInvoices, tenants, type TenantSettings } from '../../db/schema';
-import { getDateFormatSettings, getDocumentBrandingSettings } from '../admin/settings.service';
-import {
-  buildDocumentFooter,
-  createPdfBuffer,
-  resolveTenantDocAccent,
-  tryLoadLogoDataUrl,
-} from '../documents/document.service';
-import { buildSupplierInvoiceDocument } from '../documents/supplier-invoice-document';
+import { companyEmails, supplierInvoices, users } from '../../db/schema';
+import { sendDocumentEmail, buildDocumentEmailHtml, buildDocumentEmailSubject } from '../documents/mail.service';
+import { renderSupplierInvoicePdf } from './supplier-invoice-pdf';
 import {
   assertSupplierInvoicesEnabled,
   createSupplierInvoicesFromReport,
@@ -126,75 +120,131 @@ export const supplierInvoicesController = new Elysia({ prefix: '/supplier-invoic
       return { success: false, data: null, message: 'This invoice was voided and is kept for audit only.' };
     }
 
-    const [tenant] = await db
-      .select({ settings: tenants.settings, name: tenants.name })
-      .from(tenants)
-      .where(eq(tenants.id, auth.tenantId))
-      .limit(1);
-    const settings = (tenant?.settings ?? {}) as TenantSettings;
-
-    // Issuer branding is resolved live (it is our letterhead, not the billed
-    // party's) but every figure and party below comes from the frozen snapshot.
-    /**
-     * Resolved by id AND tenant, never by name. `counterparties.name` is not
-     * unique across tenants, so a name lookup could pull another tenant's logo,
-     * address and VAT onto our invoice. The id is stored at issue for exactly
-     * this reason; the frozen name is only a display fallback.
-     */
-    const [company] = invoice.invoicingCompanyId
-      ? await db
-        .select({
-          name: counterparties.name,
-          address: counterparties.headOfficeAddress,
-          phone: counterparties.headOfficePhone,
-          email: counterparties.headOfficeEmail,
-          vatNumber: counterparties.vatNumber,
-          logoUrl: counterparties.logoUrl,
-          brandColor: counterparties.brandColor,
-        })
-        .from(counterparties)
-        .where(and(eq(counterparties.id, invoice.invoicingCompanyId), eq(counterparties.tenantId, auth.tenantId)))
-        .limit(1)
-      : [];
+    const { buffer, fileName } = await renderSupplierInvoicePdf(invoice, auth.tenantId);
 
-    const { dateFormat } = await getDateFormatSettings(auth.tenantId);
-    const { enabled: brandingEnabled, layout } = await getDocumentBrandingSettings(auth.tenantId);
-    const accent = resolveTenantDocAccent(company?.brandColor ?? null, brandingEnabled) ?? '#0f766e';
+    set.headers['Content-Type'] = 'application/pdf';
+    set.headers['Content-Disposition'] = `attachment; filename="${fileName}"`;
+    set.headers['Content-Length'] = String(buffer.length);
+    return buffer;
+  }, {
+    params: t.Object({ id: t.String() }),
+    detail: { tags: ['Supplier Invoices'], summary: 'Supplier invoice PDF', security: [{ bearerAuth: [] }] },
+  })
 
-    const footer = buildDocumentFooter({
-      senderName: invoice.invoicingCompanyName ?? company?.name ?? tenant?.name ?? '',
-      companyAddress: company?.address ?? null,
-      companyPhone: company?.phone ?? null,
-      companyEmail: company?.email ?? null,
-      vatNumber: company?.vatNumber ?? null,
-      companyRegistrationNumber: null,
-      printMeta: null,
-      dateFormat,
-      accent,
-    });
+  // ── Send the invoice to the supplier ───────────────────────────────
+  //
+  // A supplier invoice covers a PERIOD and many deals, so it cannot ride the
+  // order-scoped document endpoint: there is no vessel, no port and no single
+  // order to hang it on. The recipient defaults to the supplier's billing/general
+  // addresses and is resolved server-side, because the supplier is the party who
+  // owes the money and a mistyped recipient on a payable is a real loss.
+  .post('/:id/send', async ({ auth, params, body, set }) => {
+    if (!(await assertSupplierInvoicesEnabled(auth.tenantId))) {
+      set.status = 404;
+      return { success: false, data: null, message: 'Broker deals are not enabled for this tenant' };
+    }
+    const invoice = await getSupplierInvoice(params.id, auth.tenantId);
+    if (!invoice) {
+      set.status = 404;
+      return { success: false, data: null, message: 'Supplier invoice not found' };
+    }
+    if (invoice.status === 'VOID') {
+      set.status = 400;
+      return { success: false, data: null, message: 'This invoice was voided and is kept for audit only.' };
+    }
 
-    // The remittance block was snapshotted at issue, so an issued invoice keeps
-    // printing the account it was issued with.
-    const bankDetails = invoice.bankDetails;
+    const [sender] = await db
+      .select({ name: users.name })
+      .from(users)
+      .where(eq(users.id, auth.userId))
+      .limit(1);
 
-    const docDefinition = buildSupplierInvoiceDocument({
-      invoice,
-      bankDetails,
-      logoDataUrl: tryLoadLogoDataUrl(company?.logoUrl ?? null),
-      layout,
-      footer,
-    });
+    /**
+     * Recipient resolution: the caller may override, otherwise the supplier's
+     * own addresses are used — 'invoice' first, then 'general', because on a
+     * payable the billing address is the right default and only one address is
+     * needed. `counterpartyId` is the invoice's frozen `supplierId`, so this
+     * cannot pick up another tenant's or another company's address.
+     */
+    let recipientEmails = (body.recipientEmails ?? []).map((e) => e.trim()).filter(Boolean);
+    if (recipientEmails.length === 0) {
+      const supplierEmails = await db
+        .select({ email: companyEmails.email, emailType: companyEmails.emailType, isPrimary: companyEmails.isPrimary })
+        .from(companyEmails)
+        .where(eq(companyEmails.counterpartyId, invoice.supplierId));
+      const billing = supplierEmails.filter((e) => e.emailType === 'invoice');
+      const general = supplierEmails.filter((e) => e.emailType === 'general');
+      const preferred = (billing.length > 0 ? billing : general).sort(
+        (a, b) => Number(b.isPrimary) - Number(a.isPrimary),
+      );
+      recipientEmails = preferred.length > 0
+        ? [preferred[0]!.email]
+        : supplierEmails.filter((e) => e.isPrimary).slice(0, 1).map((e) => e.email);
+    }
+    if (recipientEmails.length === 0) {
+      set.status = 400;
+      return {
+        success: false,
+        data: null,
+        message: `${invoice.supplierName} has no email address on file. Add one on the company, or enter a recipient.`,
+      };
+    }
 
-    const buffer = await createPdfBuffer(docDefinition as never);
-    const safeNumber = invoice.invoiceNumber.replace(/[^a-zA-Z0-9-]/g, '_');
+    const { buffer, fileName } = await renderSupplierInvoicePdf(invoice, auth.tenantId);
+    const periodLabel = `${invoice.periodFrom} – ${invoice.periodTo}`;
+    const subject = body.subject?.trim()
+      || buildDocumentEmailSubject({
+        documentType: 'SUPPLIER_INVOICE',
+        invoiceNumber: invoice.invoiceNumber,
+        periodLabel,
+      });
+    const htmlBody = body.htmlBody?.trim()
+      || buildDocumentEmailHtml({
+        documentType: 'SUPPLIER_INVOICE',
+        senderName: sender?.name ?? 'Fueld User',
+        periodLabel,
+        invoiceNumber: invoice.invoiceNumber,
+        totalAmount: `${invoice.currency} ${invoice.amount}`,
+        dueDate: invoice.dueDate,
+        companyName: invoice.invoicingCompanyName,
+      });
 
-    set.headers['Content-Type'] = 'application/pdf';
-    set.headers['Content-Disposition'] = `attachment; filename="Supplier_Invoice_${safeNumber}.pdf"`;
-    set.headers['Content-Length'] = String(buffer.length);
-    return buffer;
+    try {
+      const result = await sendDocumentEmail({
+        documentType: 'SUPPLIER_INVOICE',
+        tenantId: auth.tenantId,
+        sentByUserId: auth.userId,
+        senderEmail: auth.email,
+        senderName: sender?.name ?? 'Fueld User',
+        recipientEmails,
+        ccEmails: body.ccEmails ?? [],
+        bccEmails: body.bccEmails ?? [],
+        subject,
+        htmlBody,
+        pdfBuffer: buffer,
+        pdfFileName: fileName,
+      });
+      return {
+        success: true,
+        data: { sentTo: recipientEmails, channel: result.channel, pdfFileName: fileName },
+        message: `Invoice sent to ${recipientEmails.join(', ')} via ${result.channel}`,
+        ...(result.tokenExpiredWarning ? { tokenExpiredWarning: result.tokenExpiredWarning } : {}),
+      } satisfies ApiResponse<{ sentTo: string[]; channel: string; pdfFileName: string }>;
+    } catch (err) {
+      console.error('[SupplierInvoices] Send failed:', err);
+      set.status = 500;
+      return { success: false, data: null, message: err instanceof Error ? err.message : 'Failed to send invoice' };
+    }
   }, {
     params: t.Object({ id: t.String() }),
-    detail: { tags: ['Supplier Invoices'], summary: 'Supplier invoice PDF', security: [{ bearerAuth: [] }] },
+    body: t.Object({
+      recipientEmails: t.Optional(t.Array(t.String({ format: 'email' }))),
+      ccEmails: t.Optional(t.Array(t.String({ format: 'email' }))),
+      bccEmails: t.Optional(t.Array(t.String({ format: 'email' }))),
+      subject: t.Optional(t.String()),
+      htmlBody: t.Optional(t.String()),
+    }),
+    detail: { tags: ['Supplier Invoices'], summary: 'Email the supplier invoice PDF to the supplier', security: [{ bearerAuth: [] }] },
   })
 
   // ── Record money received from the supplier ────────────────────────
```

# Appendix D — documents/mail.service.ts (diff)

```diff
diff --git a/apps/api/src/modules/documents/mail.service.ts b/apps/api/src/modules/documents/mail.service.ts
index edae2c22..c909acec 100644
--- a/apps/api/src/modules/documents/mail.service.ts
+++ b/apps/api/src/modules/documents/mail.service.ts
@@ -31,13 +31,18 @@ function isLightColor(hex: string): boolean {
 
 // ─── Types ───────────────────────────────────────────────────────────
 
-export type DocumentEmailType = 'OFFER' | 'CONFIRMATION' | 'NOMINATION' | 'PROFORMA' | 'INVOICE' | 'PORT_DOCUMENTATION' | 'INQUIRY' | 'BUNKER_BOOKING' | 'BROKER_CONFIRMATION';
+export type DocumentEmailType = 'OFFER' | 'CONFIRMATION' | 'NOMINATION' | 'PROFORMA' | 'INVOICE' | 'PORT_DOCUMENTATION' | 'INQUIRY' | 'BUNKER_BOOKING' | 'BROKER_CONFIRMATION' | 'SUPPLIER_INVOICE';
 
 export interface SendDocumentEmailOptions {
   /** Document type being sent */
   documentType: DocumentEmailType;
-  /** Order ID (for logging) */
-  orderId: string;
+  /**
+   * Order ID, for the email log. Optional because a supplier invoice covers a
+   * whole PERIOD and many orders, so there is no single order to attribute it
+   * to; `email_log.order_id` is nullable and the document number is in the log's
+   * subject.
+   */
+  orderId?: string | null;
   /** Tenant ID (for logging) */
   tenantId: string;
   /** User ID of the sender (for logging and Graph token acquisition) */
@@ -272,7 +277,7 @@ async function logEmail(
   try {
     await db.insert(emailLog).values({
       tenantId: options.tenantId,
-      orderId: options.orderId,
+      orderId: options.orderId ?? null,
       documentType: options.documentType,
       sentByUserId: options.sentByUserId,
       sentFromEmail: options.senderEmail,
@@ -427,10 +432,15 @@ function buildPortDocumentationEmailHtml(params: {
 export function buildDocumentEmailHtml(params: {
   documentType: DocumentEmailType;
   senderName: string;
-  vesselName: string;
+  /** Order-shaped. Absent on a supplier invoice, which covers a period. */
+  vesselName?: string | null;
   vesselImo?: string | null;
-  portName: string;
-  orderNumber: string;
+  portName?: string | null;
+  orderNumber?: string | null;
+  /** Supplier invoice figures, so the email body is not just a bare attachment. */
+  invoiceNumber?: string | null;
+  totalAmount?: string | null;
+  dueDate?: string | null;
   documentLabel?: string;
   paymentTerms?: string | null;
   eta?: string | null;
@@ -442,37 +452,39 @@ export function buildDocumentEmailHtml(params: {
   companyLogoUrl?: string | null;
   companyAddress?: string | null;
   brandColor?: string | null;
+  /** Period the supplier invoice covers, e.g. "1–30 Sep 2026". */
+  periodLabel?: string | null;
 }): string {
   const labels: Record<DocumentEmailType, { title: string; greeting: string; intro: string }> = {
     OFFER: {
       title: 'Offer',
       greeting: 'Dear Customer',
-      intro: `Please find attached our offer for bunker delivery to <strong>${params.vesselName}</strong> at <strong>${params.portName}</strong>.`,
+      intro: `Please find attached our offer for bunker delivery to <strong>${params.vesselName ?? ''}</strong> at <strong>${params.portName ?? ''}</strong>.`,
     },
     CONFIRMATION: {
       title: 'Confirmation',
       greeting: 'Dear Customer',
-      intro: `Please find attached our confirmation for bunker delivery to <strong>${params.vesselName}</strong> at <strong>${params.portName}</strong>.`,
+      intro: `Please find attached our confirmation for bunker delivery to <strong>${params.vesselName ?? ''}</strong> at <strong>${params.portName ?? ''}</strong>.`,
     },
     NOMINATION: {
       title: 'Nomination',
       greeting: 'Dear Supplier',
-      intro: `Please find attached our nomination for bunker delivery to <strong>${params.vesselName}</strong> at <strong>${params.portName}</strong>.`,
+      intro: `Please find attached our nomination for bunker delivery to <strong>${params.vesselName ?? ''}</strong> at <strong>${params.portName ?? ''}</strong>.`,
     },
     PROFORMA: {
       title: 'Proforma Invoice',
       greeting: 'Dear Customer',
-      intro: `Please find attached the proforma invoice for bunker delivery to <strong>${params.vesselName}</strong> at <strong>${params.portName}</strong>.`,
+      intro: `Please find attached the proforma invoice for bunker delivery to <strong>${params.vesselName ?? ''}</strong> at <strong>${params.portName ?? ''}</strong>.`,
     },
     INVOICE: {
       title: 'Invoice',
       greeting: 'Dear Customer',
-      intro: `Please find attached the invoice for bunker delivery to <strong>${params.vesselName}</strong> at <strong>${params.portName}</strong>.`,
+      intro: `Please find attached the invoice for bunker delivery to <strong>${params.vesselName ?? ''}</strong> at <strong>${params.portName ?? ''}</strong>.`,
     },
     PORT_DOCUMENTATION: {
       title: 'Port Documentation',
       greeting: 'Dear Customer',
-      intro: `Please find attached the port-documentation package for bunker delivery to <strong>${params.vesselName}</strong> at <strong>${params.portName}</strong>.`,
+      intro: `Please find attached the port-documentation package for bunker delivery to <strong>${params.vesselName ?? ''}</strong> at <strong>${params.portName ?? ''}</strong>.`,
     },
     INQUIRY: {
       title: 'Inquiry',
@@ -482,19 +494,32 @@ export function buildDocumentEmailHtml(params: {
     BUNKER_BOOKING: {
       title: 'Bunker Booking',
       greeting: 'Dear Captain',
-      intro: `Bunkers have been booked for <strong>${params.vesselName}</strong> at <strong>${params.portName}</strong>.`,
+      intro: `Bunkers have been booked for <strong>${params.vesselName ?? ''}</strong> at <strong>${params.portName ?? ''}</strong>.`,
+    },
+    SUPPLIER_INVOICE: {
+      title: 'Invoice',
+      // Addressed to the supplier: it is a claim on THEIR money, and the
+      // "delivery" wording of the customer invoice would misdescribe it.
+      greeting: 'Dear Supplier',
+      intro: `Please find attached our invoice for broker commission on your deliveries during the period <strong>${params.periodLabel ?? ''}</strong>.`,
     },
     BROKER_CONFIRMATION: {
       title: 'Broker Confirmation',
       greeting: 'Dear Broker',
-      intro: `Please find attached the broker confirmation for bunker delivery to <strong>${params.vesselName}</strong> at <strong>${params.portName}</strong>.`,
+      intro: `Please find attached the broker confirmation for bunker delivery to <strong>${params.vesselName ?? ''}</strong> at <strong>${params.portName ?? ''}</strong>.`,
     },
   };
 
   const l = labels[params.documentType];
 
   if (params.documentType === 'PORT_DOCUMENTATION') {
-    return buildPortDocumentationEmailHtml(params);
+    // Port documentation is inherently order-scoped, so the order fields are
+    // always present here; the fallbacks exist only to satisfy the narrower type.
+    return buildPortDocumentationEmailHtml({
+      ...params,
+      vesselName: params.vesselName ?? '',
+      portName: params.portName ?? '',
+    });
   }
 
   const paymentTermsRow = params.paymentTerms
@@ -540,14 +565,26 @@ export function buildDocumentEmailHtml(params: {
         <p>${l.greeting},</p>
         <p>${l.intro}</p>
         <table style="margin: 16px 0; border-collapse: collapse;">
-          <tr>
+          ${params.vesselName ? `<tr>
             <td style="padding: 4px 16px 4px 0; color: #6b7280; font-size: 13px;">Vessel:</td>
             <td style="padding: 4px 0; font-weight: 600;">${params.vesselName}</td>
-          </tr>
-          <tr>
+          </tr>` : ''}
+          ${params.portName ? `<tr>
             <td style="padding: 4px 16px 4px 0; color: #6b7280; font-size: 13px;">Port:</td>
             <td style="padding: 4px 0; font-weight: 600;">${params.portName}</td>
-          </tr>
+          </tr>` : ''}
+          ${params.invoiceNumber ? `<tr>
+            <td style="padding: 4px 16px 4px 0; color: #6b7280; font-size: 13px;">Invoice number:</td>
+            <td style="padding: 4px 0; font-weight: 600;">${params.invoiceNumber}</td>
+          </tr>` : ''}
+          ${params.totalAmount ? `<tr>
+            <td style="padding: 4px 16px 4px 0; color: #6b7280; font-size: 13px;">Amount:</td>
+            <td style="padding: 4px 0; font-weight: 600;">${params.totalAmount}</td>
+          </tr>` : ''}
+          ${params.dueDate ? `<tr>
+            <td style="padding: 4px 16px 4px 0; color: #6b7280; font-size: 13px;">Due date:</td>
+            <td style="padding: 4px 0; font-weight: 600;">${params.dueDate}</td>
+          </tr>` : ''}
           ${deliveryDateRow}
           ${paymentTermsRow}
         </table>
@@ -565,10 +602,17 @@ export function buildDocumentEmailHtml(params: {
 
 export function buildDocumentEmailSubject(params: {
   documentType: DocumentEmailType;
-  orderNumber: string;
-  vesselName: string;
-  portName: string;
+  /**
+   * Order-shaped fields. Optional because a supplier invoice covers a period
+   * and many orders, so it has none of them — requiring them would force the
+   * caller to pass empty strings and print a line of punctuation.
+   */
+  orderNumber?: string;
+  vesselName?: string;
+  portName?: string;
   invoiceNumber?: string;
+  /** Supplier invoice: the period it covers, e.g. "2026-09-01 – 2026-09-30". */
+  periodLabel?: string;
 }): string {
   const labels: Record<DocumentEmailType, string> = {
     OFFER: 'Offer',
@@ -580,13 +624,24 @@ export function buildDocumentEmailSubject(params: {
     INQUIRY: 'Inquiry',
     BUNKER_BOOKING: 'Bunker Booking',
     BROKER_CONFIRMATION: 'Broker Confirmation',
+    SUPPLIER_INVOICE: 'Supplier Invoice',
   };
 
   if (params.documentType === 'INVOICE' && params.invoiceNumber) {
-    return `Invoice ${params.invoiceNumber} — Bunker Delivery (${params.vesselName})`;
+    return `Invoice ${params.invoiceNumber} — Bunker Delivery (${params.vesselName ?? ''})`;
+  }
+
+  /**
+   * A supplier invoice is not tied to one delivery — it covers a period and
+   * several deals — so it carries neither an order number nor a vessel, and it
+   * is a claim on the SUPPLIER. Its own subject beats a line of punctuation.
+   */
+  if (params.documentType === 'SUPPLIER_INVOICE') {
+    const period = params.periodLabel ? ` — ${params.periodLabel}` : '';
+    return `Invoice ${params.invoiceNumber ?? ''}${period}`.trim();
   }
 
-  return `${labels[params.documentType]} — ${params.orderNumber} — ${params.vesselName}, ${params.portName}`;
+  return `${labels[params.documentType]} — ${params.orderNumber ?? ''} — ${params.vesselName ?? ''}, ${params.portName ?? ''}`;
 }
 
 // ─── Inquiry-specific Email HTML ─────────────────────────────────────
```

# Appendix E — documents/documents.controller.ts (diff)

```diff
diff --git a/apps/api/src/modules/documents/documents.controller.ts b/apps/api/src/modules/documents/documents.controller.ts
index 977ce597..dd1c312e 100644
--- a/apps/api/src/modules/documents/documents.controller.ts
+++ b/apps/api/src/modules/documents/documents.controller.ts
@@ -863,6 +863,7 @@ export const documentsController = new Elysia({ prefix: '/orders' })
         INQUIRY: 'Inquiry',
         BUNKER_BOOKING: 'Bunker Booking',
         BROKER_CONFIRMATION: 'Broker Confirmation',
+        SUPPLIER_INVOICE: 'Supplier Invoice',
       };
 
       // Determine recipient based on document type
```

# Appendix F — tests/supplier-invoices.e2e.test.ts (diff)

```diff
diff --git a/apps/api/tests/supplier-invoices.e2e.test.ts b/apps/api/tests/supplier-invoices.e2e.test.ts
index 61a8571b..c37a9bd9 100644
--- a/apps/api/tests/supplier-invoices.e2e.test.ts
+++ b/apps/api/tests/supplier-invoices.e2e.test.ts
@@ -680,6 +680,76 @@ describe('supplier invoices e2e', () => {
     expect((await db.select().from(supplierReceipts)).length).toBe(0);
   });
 
+  it('nets receipts against what we owe the supplier, without counting them as paid BY us', async () => {
+    const seeded = await seedAuthBasics();
+    await enableBrokerDeals(seeded.tenant.id);
+    await promoteToAdmin(seeded.user.id);
+    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
+    const supplierId = await createSupplier(seeded.tenant.id, 'Netted Ltd');
+
+    await createBrokerDealWithLines(
+      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
+      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '0', supplierCommissionPerUnit: '10' }],
+      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-15' },
+    );
+    await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });
+    const db = await getDb();
+    const [invoice] = await db.select().from(supplierInvoices);
+
+    const before = await requestJson(`/companies/local/${supplierId}/ledger/supplier`, { token });
+    const totalBefore = (before.data?.data?.totals ?? []).find((t: any) => t.currency === 'USD');
+    // Nothing received yet: the position is what we owe for the fuel leg.
+    expect(Number(totalBefore.totalReceived)).toBe(0);
+    expect(Number(totalBefore.outstanding)).toBe(Number(totalBefore.totalCost) - Number(totalBefore.totalPaid));
+
+    await requestJson(`/supplier-invoices/${invoice!.id}/receipts`, {
+      method: 'POST', token, body: { amount: '250', currency: 'USD' },
+    });
+
+    const after = await requestJson(`/companies/local/${supplierId}/ledger/supplier`, { token });
+    const totalAfter = (after.data?.data?.totals ?? []).find((t: any) => t.currency === 'USD');
+
+    expect(Number(totalAfter.totalReceived)).toBe(250);
+    // The receipt is the OPPOSITE direction, so it must NOT appear as money we paid.
+    expect(Number(totalAfter.totalPaid)).toBe(Number(totalBefore.totalPaid));
+    // But it must move the POSITION: they now owe us, so we owe them 250 less.
+    expect(Number(totalAfter.outstanding)).toBe(Number(totalBefore.outstanding) - 250);
+  });
+
+  it('does not treat a receipt on a VOID invoice as a live credit', async () => {
+    const seeded = await seedAuthBasics();
+    await enableBrokerDeals(seeded.tenant.id);
+    await promoteToAdmin(seeded.user.id);
+    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
+    const supplierId = await createSupplier(seeded.tenant.id, 'Voided Receipt Ltd');
+
+    await createBrokerDealWithLines(
+      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
+      [{ productType: 'VLSFO', quantity: '50', commissionPerUnit: '0', supplierCommissionPerUnit: '10' }],
+      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-15' },
+    );
+    await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });
+    const db = await getDb();
+    const [invoice] = await db.select().from(supplierInvoices);
+
+    await requestJson(`/supplier-invoices/${invoice!.id}/receipts`, {
+      method: 'POST', token, body: { amount: '250', currency: 'USD' },
+    });
+    await requestJson(`/supplier-invoices/${invoice!.id}/void`, { method: 'POST', token, body: { reason: 'wrong rate' } });
+
+    const ledger = await requestJson(`/companies/local/${supplierId}/ledger/supplier`, { token });
+    const total = (ledger.data?.data?.totals ?? []).find((t: any) => t.currency === 'USD');
+    // The rows survive for audit, but a voided claim is not a credit: counting
+    // it would understate what we owe on the reissued invoice.
+    expect(Number(total?.totalReceived ?? 0)).toBe(0);
+
+    // It must not vanish either — real cash we hold, reported as unapplied so the
+    // operator can reapply or refund it instead of having to remember it.
+    const unapplied = (ledger.data?.data?.unappliedReceipts ?? []).find((u: any) => u.currency === 'USD');
+    expect(Number(unapplied?.amount ?? 0)).toBe(250);
+    expect(unapplied?.count).toBe(1);
+  });
+
   it('keeps receipts after a void, for audit, and blocks them on a voided invoice', async () => {
     const seeded = await seedAuthBasics();
     await enableBrokerDeals(seeded.tenant.id);
```

# Appendix G — tests/supplier-invoice-send.e2e.test.ts (new file, whole)

```ts
/**
 * E2E for POST /supplier-invoices/:id/send — emailing a supplier invoice.
 *
 * A SEPARATE FILE from `supplier-invoices.e2e.test.ts` because Bun's
 * `mock.module` is per-module-graph and is hoisted before the app imports: the
 * transport has to be stubbed before `mail.service` is loaded, and doing that in
 * the shared file would stub email for every other test in it. There is no SMTP
 * configured under test, so without a stub the success path can only ever throw.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';

// ── Stub the SMTP transport BEFORE the app is imported ──
const sentMessages: Array<Record<string, unknown>> = [];

// Spread the ORIGINAL module: replacing it wholesale drops exports the rest of
// the app imports (`sendNotificationEmail`), which fails at import time.
const originalEmailModule = await import('../src/lib/email');
mock.module('../src/lib/email', () => ({
  ...originalEmailModule,
  getSmtpConfig: async () => ({
    host: 'smtp.test.com', port: 587, user: 'test', pass: 'test', from: 'test@fueld.app', secure: false,
  }),
  getTransporter: async () => ({
    sendMail: async (message: Record<string, unknown>) => {
      sentMessages.push(message);
      return { messageId: 'test-message-id' };
    },
  }),
}));

const { getDb, seedAuthBasics, truncateAll } = await import('./helpers/db');
const { loginE2E, requestJson } = await import('./helpers/e2e');
const {
  counterparties,
  companyEmails,
  emailLog,
  supplierInvoices,
  tenants,
} = await import('../src/db/schema');

async function promoteToAdmin(userId: string) {
  const db = await getDb();
  const { users } = await import('../src/db/schema');
  await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, userId));
}

async function enableBrokerDeals(tenantId: string) {
  const db = await getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error('Tenant not found');
  await db.update(tenants).set({
    settings: {
      ...tenant.settings,
      brokerDeals: {
        enabled: true,
        defaultCommissionRate: 3,
        reportStatuses: ['CONFIRMED', 'DELIVERED', 'INVOICED', 'PAID'],
        autoReleaseCredit: true,
        autoReleaseBufferDays: 0,
      },
    },
    updatedAt: new Date(),
  }).where(eq(tenants.id, tenantId));
}

async function createSupplier(tenantId: string, name: string): Promise<string> {
  const db = await getDb();
  const [supplier] = await db
    .insert(counterparties)
    .values({ tenantId, name, type: 'SUPPLIER', types: ['SUPPLIER'], country: 'USA' })
    .returning();
  return supplier!.id;
}

/** One CONFIRMED broker deal with 100 MT x 10 funded by the supplier, then invoice it. */
async function raiseInvoice(token: string, seeded: { client: { id: string }; vessel: { id: string }; place: { id: string } }, supplierId: string) {
  const created = await requestJson('/orders', {
    method: 'POST',
    token,
    body: {
      clientId: seeded.client.id,
      vesselId: seeded.vessel.id,
      placeId: seeded.place.id,
      isBrokerDeal: true,
      eta: '2026-09-15',
      supplierId,
    },
  });
  const orderId = created.data?.data?.id as string;
  await requestJson(`/orders/${orderId}/items`, {
    method: 'PUT',
    token,
    body: {
      items: [{
        productType: 'VLSFO', quantity: '100', unit: 'MT',
        costPrice: '100', costCurrency: 'USD', salesPrice: '115', salesCurrency: 'USD',
        commissionPerUnit: '0', supplierCommissionPerUnit: '10',
      }],
    },
  });
  await requestJson(`/orders/${orderId}/status`, { method: 'PUT', token, body: { status: 'CONFIRMED' } });
  const db = await getDb();
  await db.update((await import('../src/db/schema')).orders).set({ deliveredAt: new Date('2026-09-15') }).where(eq((await import('../src/db/schema')).orders.id, orderId));

  await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });
  const [invoice] = await db.select().from(supplierInvoices);
  return invoice!;
}

describe('supplier invoice send e2e', () => {
  beforeEach(async () => {
    await truncateAll();
    sentMessages.length = 0;
  });

  it('refuses by name when the supplier has no address, rather than dropping the invoice', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Mailed Ltd');
    const invoice = await raiseInvoice(token, seeded, supplierId);

    // A payable that was never sent is a loss, so this must be loud.
    const res = await requestJson(`/supplier-invoices/${invoice.id}/send`, { method: 'POST', token, body: {} });
    expect(res.status).toBe(400);
    expect(String(res.data?.message)).toContain('Mailed Ltd');
    expect(sentMessages.length).toBe(0);
  });

  it('resolves the supplier billing address on file when no recipient is given', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Addressed Ltd');
    const db = await getDb();
    await db.insert(companyEmails).values([
      { counterpartyId: supplierId, emailType: 'general', email: 'general@addressed.test', isPrimary: true },
      { counterpartyId: supplierId, emailType: 'invoice', email: 'billing@addressed.test', isPrimary: true },
    ]);
    const invoice = await raiseInvoice(token, seeded, supplierId);

    const res = await requestJson(`/supplier-invoices/${invoice.id}/send`, { method: 'POST', token, body: {} });
    expect(res.status).toBe(200);
    // Billing beats general on a payable: that is the address set up to receive it.
    expect(res.data?.data?.sentTo).toEqual(['billing@addressed.test']);

    const logs = await db.select().from(emailLog);
    expect(logs.length).toBe(1);
    expect(logs[0]!.documentType).toBe('SUPPLIER_INVOICE');
    expect(logs[0]!.sentTo).toBe('billing@addressed.test');
    // The PDF must ride along, and the body must not describe a vessel delivery.
    const message = sentMessages[0]!;
    expect(String(message.subject)).toContain(invoice.invoiceNumber);
    expect((message.attachments as unknown[] | undefined)?.length).toBe(1);
    const html = String(message.html);
    expect(html).toContain('Dear Supplier');
    expect(html).not.toContain('undefined');
  });

  it('cannot send another tenant\'s invoice', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Mine Ltd');
    const invoice = await raiseInvoice(token, seeded, supplierId);

    // A second tenant with the feature on, holding the same invoice id.
    const db = await getDb();
    const [other] = await db.insert(tenants).values({ name: 'Send Other', domain: 'sendother.local' }).returning();
    const { users } = await import('../src/db/schema');
    const { hashPassword } = await import('../src/modules/auth/password.service');
    await db.insert(users).values({
      tenantId: other!.id, email: 'sendother@test.local', name: 'Other', role: 'ADMIN',
      passwordHash: await hashPassword('Password123!'),
    });
    await enableBrokerDeals(other!.id);
    const otherToken = (await loginE2E('sendother@test.local', 'Password123!')).accessToken;

    const res = await requestJson(`/supplier-invoices/${invoice.id}/send`, {
      method: 'POST', token: otherToken, body: { recipientEmails: ['x@y.test'] },
    });
    expect(res.status).toBe(404);
    expect(sentMessages.length).toBe(0);
  });

  it('refuses to send a VOID invoice', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Void Send Ltd');
    const invoice = await raiseInvoice(token, seeded, supplierId);
    await requestJson(`/supplier-invoices/${invoice.id}/void`, { method: 'POST', token, body: { reason: 'wrong' } });

    const res = await requestJson(`/supplier-invoices/${invoice.id}/send`, {
      method: 'POST', token, body: { recipientEmails: ['x@y.test'] },
    });
    expect(res.status).toBe(400);
    expect(sentMessages.length).toBe(0);
  });
});
```
