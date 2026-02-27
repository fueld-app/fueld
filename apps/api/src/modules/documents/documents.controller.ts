import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import { generateNominationPdfBuffer, generateOrderInvoicePdfBuffer, generateOfferPdfBuffer, generateProformaInvoicePdfBuffer } from './document.service';
import { sendInvoiceEmail } from './mail.service';
import { resolveOrderId, getOrderById } from '../orders/orders.service';

// ═══════════════════════════════════════════════════════════════════════
//  Documents Controller
// ═══════════════════════════════════════════════════════════════════════

export const documentsController = new Elysia({ prefix: '/orders' })
  // ── Require authentication for all routes ──
  .use(authGuard)

  // ── GET /orders/:id/offer/pdf ──────────────────────────────────────
  .get(
    '/:id/offer/pdf',
    async ({ params, set }) => {
      const orderId = await resolveOrderId(params.id);
      if (!orderId) { set.status = 404; return { success: false, message: 'Order not found' }; }
      const order = await getOrderById(orderId);
      if (!order?.items?.length) {
        set.status = 400;
        return { success: false, message: 'Add at least one line item before generating documents' };
      }
      if (!order?.invoicingCompanyId) {
        set.status = 400;
        return { success: false, message: 'Select an invoicing company before generating Offer/Confirmation PDF' };
      }
      const { buffer, fileName, revision } = await generateOfferPdfBuffer(orderId);

      set.headers['Content-Type'] = 'application/pdf';
      set.headers['Content-Disposition'] = `attachment; filename="${fileName}"`;
      set.headers['Content-Length'] = String(buffer.length);
      set.headers['X-Document-Revision'] = String(revision.revisionNumber);
      set.headers['X-Document-Reference'] = revision.verificationRef;
      set.headers['X-Document-Fingerprint'] = revision.fingerprintShort;
      set.headers['X-Document-Verify-Token'] = revision.verifyToken;

      return buffer;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Documents'],
        summary: 'Generate offer PDF for an order/inquiry',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── GET /orders/:id/nomination/pdf ────────────────────────────────
  .get(
    '/:id/nomination/pdf',
    async ({ params, set }) => {
      const orderId = await resolveOrderId(params.id);
      if (!orderId) { set.status = 404; return { success: false, message: 'Order not found' }; }
      const order = await getOrderById(orderId);
      if (!order?.items?.length) {
        set.status = 400;
        return { success: false, message: 'Add at least one line item before generating documents' };
      }
      if (!order?.supplierId) {
        set.status = 400;
        return { success: false, message: 'Select a supplier before generating Nomination PDF' };
      }
      if (!order?.invoicingCompanyId) {
        set.status = 400;
        return { success: false, message: 'Select an invoicing company before generating Nomination PDF' };
      }
      const { buffer, fileName, revision } = await generateNominationPdfBuffer(orderId);

      set.headers['Content-Type'] = 'application/pdf';
      set.headers['Content-Disposition'] = `attachment; filename="${fileName}"`;
      set.headers['Content-Length'] = String(buffer.length);
      set.headers['X-Document-Revision'] = String(revision.revisionNumber);
      set.headers['X-Document-Reference'] = revision.verificationRef;
      set.headers['X-Document-Fingerprint'] = revision.fingerprintShort;
      set.headers['X-Document-Verify-Token'] = revision.verifyToken;

      return buffer;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Documents'],
        summary: 'Generate nomination PDF for an order',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── GET /orders/:id/proforma/pdf ───────────────────────────────────
  .get(
    '/:id/proforma/pdf',
    async ({ params, set }) => {
      const orderId = await resolveOrderId(params.id);
      if (!orderId) { set.status = 404; return { success: false, message: 'Order not found' }; }
      const order = await getOrderById(orderId);
      if (!order?.items?.length) {
        set.status = 400;
        return { success: false, message: 'Add at least one line item before generating documents' };
      }
      if (!order?.bankAccountId) {
        set.status = 400;
        return { success: false, message: 'Select a bank account before generating Proforma Invoice' };
      }
      const { buffer, fileName, revision } = await generateProformaInvoicePdfBuffer(orderId);

      set.headers['Content-Type'] = 'application/pdf';
      set.headers['Content-Disposition'] = `attachment; filename="${fileName}"`;
      set.headers['Content-Length'] = String(buffer.length);
      set.headers['X-Document-Revision'] = String(revision.revisionNumber);
      set.headers['X-Document-Reference'] = revision.verificationRef;
      set.headers['X-Document-Fingerprint'] = revision.fingerprintShort;
      set.headers['X-Document-Verify-Token'] = revision.verifyToken;

      return buffer;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Documents'],
        summary: 'Generate proforma invoice PDF for an order/inquiry',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── GET /orders/:id/invoice/pdf ────────────────────────────────────
  .get(
    '/:id/invoice/pdf',
    async ({ params, set }) => {
      const orderId = await resolveOrderId(params.id);
      if (!orderId) { set.status = 404; return { success: false, message: 'Order not found' }; }
      const order = await getOrderById(orderId);
      if (!order?.items?.length) {
        set.status = 400;
        return { success: false, message: 'Add at least one line item before generating documents' };
      }
      if (!order?.bankAccountId) {
        set.status = 400;
        return { success: false, message: 'Select a bank account before generating Invoice/Proforma' };
      }
      const { buffer, fileName, revision } = await generateOrderInvoicePdfBuffer(orderId);

      set.headers['Content-Type'] = 'application/pdf';
      set.headers['Content-Disposition'] = `attachment; filename="${fileName}"`;
      set.headers['Content-Length'] = String(buffer.length);
      set.headers['X-Document-Revision'] = String(revision.revisionNumber);
      set.headers['X-Document-Reference'] = revision.verificationRef;
      set.headers['X-Document-Fingerprint'] = revision.fingerprintShort;
      set.headers['X-Document-Verify-Token'] = revision.verifyToken;

      return buffer;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Documents'],
        summary: 'Generate invoice PDF for an order',
        description: 'Fetches order, client, items and generates a professional invoice PDF.',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── POST /orders/:id/invoice/send ──────────────────────────────────
  .post(
    '/:id/invoice/send',
    async ({ params, body, store }) => {
      const orderId = await resolveOrderId(params.id);
      if (!orderId) return { success: false, message: 'Order not found' };
      // Generate the PDF
      const { buffer, invoiceNumber, fileName } = await generateOrderInvoicePdfBuffer(orderId);

      const order = await getOrderById(orderId);
      const vesselName = order?.vessel?.name ?? body.vesselName ?? 'Vessel';
      const portName = order?.place?.name ?? body.portName ?? 'Port';
      const paymentTerms = order?.customerPaymentTermType
        ? order.customerPaymentTermType === 'CREDIT'
          ? `Credit ${order.customerCreditDays ?? 0} days`
          : order.customerPaymentTermType === 'COD'
            ? 'Cash on Delivery'
            : order.customerPaymentTermType === 'PREPAY'
              ? 'Cash in advance'
              : order.customerPaymentTermType
        : null;
      const customerNote = order?.customerNote ?? null;
      const itemNotes = order?.items
        ?.filter((item) => item.customerNote)
        .map((item) => ({
          label: item.productType,
          note: String(item.customerNote),
        })) ?? [];

      // We need the user's O365 token to send via Graph.
      // The token is expected to be passed in the request body.
      await sendInvoiceEmail({
        accessToken: body.accessToken,
        recipientEmail: body.recipientEmail,
        invoiceNumber,
        pdfBuffer: buffer,
        pdfFileName: fileName,
        vesselName,
        portName,
        paymentTerms,
        customerNote,
        itemNotes,
      });

      return { success: true, message: `Invoice ${invoiceNumber} sent to ${body.recipientEmail}` };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        accessToken: t.String({ description: 'O365 access token for sending via Graph API' }),
        recipientEmail: t.String({ format: 'email', description: 'Recipient email address' }),
        vesselName: t.Optional(t.String()),
        portName: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Documents'],
        summary: 'Generate and send invoice via email',
        description: 'Generates a PDF, then sends it as an email attachment via Microsoft Graph.',
        security: [{ bearerAuth: [] }],
      },
    },
  );
