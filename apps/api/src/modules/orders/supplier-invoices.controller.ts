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
import { companyEmails, supplierInvoices, users } from '../../db/schema';
import { sendDocumentEmail, buildDocumentEmailHtml, buildDocumentEmailSubject } from '../documents/mail.service';
import { renderSupplierInvoicePdf } from './supplier-invoice-pdf';
import {
  assertSupplierInvoicesEnabled,
  createSupplierInvoicesFromReport,
  getSupplierInvoice,
  listSupplierInvoices,
  listSuppliersWithSupplierCommission,
  markSupplierInvoiceSent,
  selectSupplierRecipients,
  voidSupplierInvoice,
} from './supplier-invoice.service';
import { SupplierReceiptError, createSupplierReceipt, deleteSupplierReceipt } from './supplier-invoice-ledger';

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
    // Ownership is established INSIDE the read, before it refreshes anything —
    // see getSupplierInvoice. A foreign id 404s without touching the row.
    const invoice = await getSupplierInvoice(params.id, auth.tenantId);
    if (!invoice) {
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
    const invoice = await getSupplierInvoice(params.id, auth.tenantId);
    if (!invoice) {
      set.status = 404;
      return { success: false, data: null, message: 'Supplier invoice not found' };
    }
    if (invoice.status === 'VOID') {
      set.status = 400;
      return { success: false, data: null, message: 'This invoice was voided and is kept for audit only.' };
    }

    const { buffer, fileName } = await renderSupplierInvoicePdf(invoice, auth.tenantId);

    set.headers['Content-Type'] = 'application/pdf';
    set.headers['Content-Disposition'] = `attachment; filename="${fileName}"`;
    set.headers['Content-Length'] = String(buffer.length);
    return buffer;
  }, {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Supplier Invoices'], summary: 'Supplier invoice PDF', security: [{ bearerAuth: [] }] },
  })

  // ── Send the invoice to the supplier ───────────────────────────────
  //
  // A supplier invoice covers a PERIOD and many deals, so it cannot ride the
  // order-scoped document endpoint: there is no vessel, no port and no single
  // order to hang it on. The recipient defaults to the supplier's billing/general
  // addresses and is resolved server-side, because the supplier is the party who
  // owes the money and a mistyped recipient on a payable is a real loss.
  .post('/:id/send', async ({ auth, params, body, set }) => {
    if (!(await assertSupplierInvoicesEnabled(auth.tenantId))) {
      set.status = 404;
      return { success: false, data: null, message: 'Broker deals are not enabled for this tenant' };
    }
    const invoice = await getSupplierInvoice(params.id, auth.tenantId);
    if (!invoice) {
      set.status = 404;
      return { success: false, data: null, message: 'Supplier invoice not found' };
    }
    if (invoice.status === 'VOID') {
      set.status = 400;
      return { success: false, data: null, message: 'This invoice was voided and is kept for audit only.' };
    }

    const [sender] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);

    /**
     * Recipient resolution: the caller may override, otherwise the supplier's
     * own addresses are used — 'invoice' first, then 'general', because on a
     * payable the billing address is the right default and only one address is
     * needed. `counterpartyId` is the invoice's frozen `supplierId`, so this
     * cannot pick up another tenant's or another company's address.
     */
    // Resolution rule lives in the service as a pure function: billing address
    // first, then general, deterministic when several share a rank.
    const supplierEmails = await db
      .select({ email: companyEmails.email, emailType: companyEmails.emailType, isPrimary: companyEmails.isPrimary })
      .from(companyEmails)
      .where(eq(companyEmails.counterpartyId, invoice.supplierId));

    const recipientEmails = selectSupplierRecipients(supplierEmails, body.recipientEmails ?? []);
    if (recipientEmails.length === 0) {
      set.status = 400;
      return {
        success: false,
        data: null,
        message: `${invoice.supplierName} has no email address on file. Add one on the company, or enter a recipient.`,
      };
    }

    const periodLabel = `${invoice.periodFrom} – ${invoice.periodTo}`;
    const subject = body.subject?.trim()
      || buildDocumentEmailSubject({
        documentType: 'SUPPLIER_INVOICE',
        invoiceNumber: invoice.invoiceNumber,
        periodLabel,
      });
    const htmlBody = body.htmlBody?.trim()
      || buildDocumentEmailHtml({
        documentType: 'SUPPLIER_INVOICE',
        senderName: sender?.name ?? 'Fueld User',
        periodLabel,
        invoiceNumber: invoice.invoiceNumber,
        totalAmount: `${invoice.currency} ${invoice.amount}`,
        dueDate: invoice.dueDate,
        companyName: invoice.invoicingCompanyName,
      });

    try {
      // Rendered INSIDE the handler so a render failure returns the same JSON
      // error shape as a send failure instead of a bare 500.
      const { buffer, fileName } = await renderSupplierInvoicePdf(invoice, auth.tenantId);
      const result = await sendDocumentEmail({
        documentType: 'SUPPLIER_INVOICE',
        tenantId: auth.tenantId,
        sentByUserId: auth.userId,
        senderEmail: auth.email,
        senderName: sender?.name ?? 'Fueld User',
        recipientEmails,
        ccEmails: body.ccEmails ?? [],
        bccEmails: body.bccEmails ?? [],
        subject,
        htmlBody,
        pdfBuffer: buffer,
        pdfFileName: fileName,
      });
      // Summarised on the invoice so the page can answer "has this been sent?",
      // the question the route exists to make answerable. Best-effort: the email
      // has already gone, so a failure here must not report the send as failed.
      try {
        await markSupplierInvoiceSent(invoice.id, auth.tenantId, recipientEmails);
      } catch (err) {
        console.error('[SupplierInvoices] Failed to record the send on the invoice:', err);
      }
      return {
        success: true,
        data: { sentTo: recipientEmails, channel: result.channel, pdfFileName: fileName },
        message: `Invoice sent to ${recipientEmails.join(', ')} via ${result.channel}`,
        ...(result.tokenExpiredWarning ? { tokenExpiredWarning: result.tokenExpiredWarning } : {}),
      } satisfies ApiResponse<{ sentTo: string[]; channel: string; pdfFileName: string }>;
    } catch (err) {
      console.error('[SupplierInvoices] Send failed:', err);
      set.status = 500;
      return { success: false, data: null, message: err instanceof Error ? err.message : 'Failed to send invoice' };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      recipientEmails: t.Optional(t.Array(t.String({ format: 'email' }))),
      ccEmails: t.Optional(t.Array(t.String({ format: 'email' }))),
      bccEmails: t.Optional(t.Array(t.String({ format: 'email' }))),
      subject: t.Optional(t.String()),
      htmlBody: t.Optional(t.String()),
    }),
    detail: { tags: ['Supplier Invoices'], summary: 'Email the supplier invoice PDF to the supplier', security: [{ bearerAuth: [] }] },
  })

  // ── Record money received from the supplier ────────────────────────
  .post('/:id/receipts', async ({ auth, params, body, set }) => {
    if (!(await assertSupplierInvoicesEnabled(auth.tenantId))) {
      set.status = 404;
      return { success: false, data: null, message: 'Broker deals are not enabled for this tenant' } satisfies ApiResponse<null>;
    }
    if (auth.role !== 'ADMIN') {
      set.status = 403;
      return { success: false, data: null, message: 'Admin access required' } satisfies ApiResponse<null>;
    }
    // Ownership first: a foreign id must not reach the write below.
    const owned = await getSupplierInvoice(params.id, auth.tenantId);
    if (!owned) {
      set.status = 404;
      return { success: false, data: null, message: 'Supplier invoice not found' } satisfies ApiResponse<null>;
    }
    try {
      await createSupplierReceipt({
        invoiceId: params.id,
        tenantId: auth.tenantId,
        amount: body.amount,
        currency: body.currency,
        receivedAt: body.receivedAt ?? null,
        method: body.method ?? null,
        note: body.note ?? null,
        createdBy: auth.sub,
      });
    } catch (err) {
      // A currency mismatch, an overpayment, a bad amount or a voided invoice is
      // a user-fixable state, and the message says which.
      set.status = err instanceof SupplierReceiptError ? err.status : 500;
      return { success: false, data: null, message: err instanceof Error ? err.message : 'Could not record the receipt' } satisfies ApiResponse<null>;
    }
    const invoice = await getSupplierInvoice(params.id, auth.tenantId);
    return { success: true, data: invoice } satisfies ApiResponse<SupplierInvoiceDto | null>;
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      amount: t.String({ pattern: '^\\d+(\\.\\d{1,2})?$' }),
      currency: t.String({ minLength: 3, maxLength: 3 }),
      receivedAt: t.Optional(t.Nullable(t.String({ format: 'date-time' }))),
      method: t.Optional(t.Nullable(t.String())),
      note: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ['Supplier Invoices'], summary: 'Record money received from the supplier against an invoice', security: [{ bearerAuth: [] }] },
  })

  // ── Delete a receipt (recorded in error) ───────────────────────────
  .delete('/:id/receipts/:receiptId', async ({ auth, params, set }) => {
    if (!(await assertSupplierInvoicesEnabled(auth.tenantId))) {
      set.status = 404;
      return { success: false, data: null, message: 'Broker deals are not enabled for this tenant' } satisfies ApiResponse<null>;
    }
    if (auth.role !== 'ADMIN') {
      set.status = 403;
      return { success: false, data: null, message: 'Admin access required' } satisfies ApiResponse<null>;
    }
    const owned = await getSupplierInvoice(params.id, auth.tenantId);
    if (!owned) {
      set.status = 404;
      return { success: false, data: null, message: 'Supplier invoice not found' } satisfies ApiResponse<null>;
    }
    const removed = await deleteSupplierReceipt(params.receiptId, auth.tenantId);
    if (!removed) {
      set.status = 404;
      return { success: false, data: null, message: 'Receipt not found' } satisfies ApiResponse<null>;
    }
    const invoice = await getSupplierInvoice(params.id, auth.tenantId);
    return { success: true, data: invoice } satisfies ApiResponse<SupplierInvoiceDto | null>;
  }, {
    params: t.Object({ id: t.String(), receiptId: t.String() }),
    detail: { tags: ['Supplier Invoices'], summary: 'Delete a supplier receipt', security: [{ bearerAuth: [] }] },
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
    const invoice = await voidSupplierInvoice(params.id, auth.tenantId, body?.reason ?? null);
    if (!invoice) {
      set.status = 404;
      return { success: false, data: null, message: 'Supplier invoice not found' } satisfies ApiResponse<null>;
    }
    return { success: true, data: invoice } satisfies ApiResponse<SupplierInvoiceDto | null>;
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Optional(t.Object({ reason: t.Optional(t.Nullable(t.String())) })),
    detail: { tags: ['Supplier Invoices'], summary: 'Void a supplier invoice', security: [{ bearerAuth: [] }] },
  });
