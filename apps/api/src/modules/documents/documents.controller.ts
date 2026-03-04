import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { authGuard } from '../auth/auth.guard';
import { generateNominationPdfBuffer, generateOrderInvoicePdfBuffer, generateOfferPdfBuffer, generateProformaInvoicePdfBuffer } from './document.service';
import { sendDocumentEmail, buildDocumentEmailHtml, buildDocumentEmailSubject, type DocumentEmailType } from './mail.service';
import { resolveOrderId, getOrderById } from '../orders/orders.service';
import { db } from '../../db';
import { users, counterparties, invoices as invoicesTable } from '../../db/schema';

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

  // ── POST /orders/:id/send-email ──────────────────────────────────────
  .post(
    '/:id/send-email',
    async ({ params, body, auth, set }) => {
      const orderId = await resolveOrderId(params.id);
      if (!orderId) { set.status = 404; return { success: false, message: 'Order not found' }; }

      const order = await getOrderById(orderId);
      if (!order) { set.status = 404; return { success: false, message: 'Order not found' }; }
      if (!order.items?.length) {
        set.status = 400;
        return { success: false, message: 'Add at least one line item before sending' };
      }

      // Fetch the sender's full name from the users table
      const [sender] = await db.select({ name: users.name }).from(users).where(eq(users.id, auth.userId)).limit(1);
      const senderName = sender?.name ?? 'Fueld User';
      const senderEmail = auth.email;

      // Generate the right PDF based on document type
      const docType = body.documentType as DocumentEmailType;
      let pdfBuffer: Buffer;
      let pdfFileName: string;

      switch (docType) {
        case 'OFFER': {
          if (!order.invoicingCompanyId) { set.status = 400; return { success: false, message: 'Select an invoicing company first' }; }
          const result = await generateOfferPdfBuffer(orderId);
          pdfBuffer = result.buffer;
          pdfFileName = result.fileName;
          break;
        }
        case 'NOMINATION': {
          if (!order.supplierId) { set.status = 400; return { success: false, message: 'Select a supplier first' }; }
          if (!order.invoicingCompanyId) { set.status = 400; return { success: false, message: 'Select an invoicing company first' }; }
          const result = await generateNominationPdfBuffer(orderId);
          pdfBuffer = result.buffer;
          pdfFileName = result.fileName;
          break;
        }
        case 'PROFORMA': {
          if (!order.bankAccountId) { set.status = 400; return { success: false, message: 'Select a bank account first' }; }
          const result = await generateProformaInvoicePdfBuffer(orderId);
          pdfBuffer = result.buffer;
          pdfFileName = result.fileName;
          break;
        }
        case 'INVOICE': {
          if (!order.bankAccountId) { set.status = 400; return { success: false, message: 'Select a bank account first' }; }
          const result = await generateOrderInvoicePdfBuffer(orderId);
          pdfBuffer = result.buffer;
          pdfFileName = result.fileName;
          break;
        }
        default:
          set.status = 400;
          return { success: false, message: `Unknown document type: ${body.documentType}` };
      }

      // Send the email
      const { channel } = await sendDocumentEmail({
        documentType: docType,
        orderId,
        tenantId: auth.tenantId,
        sentByUserId: auth.userId,
        senderEmail,
        senderName,
        recipientEmail: body.recipientEmail,
        ccEmails: body.ccEmails ?? [],
        subject: body.subject,
        htmlBody: body.htmlBody,
        pdfBuffer,
        pdfFileName,
        accessToken: body.accessToken,
      });

      return {
        success: true,
        message: `${docType} sent to ${body.recipientEmail} via ${channel}`,
        channel,
        pdfFileName,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        documentType: t.Union([
          t.Literal('OFFER'),
          t.Literal('NOMINATION'),
          t.Literal('PROFORMA'),
          t.Literal('INVOICE'),
        ], { description: 'Type of document to send' }),
        recipientEmail: t.String({ format: 'email', description: 'Primary recipient email address' }),
        ccEmails: t.Optional(t.Array(t.String({ format: 'email' }), { description: 'CC email addresses' })),
        subject: t.String({ description: 'Email subject line' }),
        htmlBody: t.String({ description: 'HTML email body' }),
        accessToken: t.Optional(t.String({ description: 'O365 access token for Graph API (falls back to SMTP if omitted)' })),
      }),
      detail: {
        tags: ['Documents'],
        summary: 'Generate and send a document email (offer, nomination, proforma, or invoice)',
        description: 'Generates the appropriate PDF, attaches it to an email, and sends it via Microsoft Graph (if O365 token provided) or SMTP fallback.',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── POST /orders/:id/email-defaults ────────────────────────────────
  // Returns pre-filled email defaults for a given document type + order
  .post(
    '/:id/email-defaults',
    async ({ params, body, auth, set }) => {
      const orderId = await resolveOrderId(params.id);
      if (!orderId) { set.status = 404; return { success: false, message: 'Order not found' }; }

      const order = await getOrderById(orderId);
      if (!order) { set.status = 404; return { success: false, message: 'Order not found' }; }

      const [sender] = await db.select({ name: users.name }).from(users).where(eq(users.id, auth.userId)).limit(1);
      const senderName = sender?.name ?? 'Fueld User';

      const docType = body.documentType as DocumentEmailType;
      const vesselName = order.vessel?.name ?? 'Vessel';
      const portName = order.place?.name ?? 'Port';
      const orderNumber = order.orderNumber ?? orderId.slice(0, 8).toUpperCase();

      // Determine recipient based on document type
      let recipientEmail = '';
      let recipientName = '';
      if (docType === 'NOMINATION') {
        recipientEmail = order.supplierContact?.email ?? '';
        recipientName = order.supplierContact?.name ?? '';
        // Try to get supplier name if we have supplierId
        if (!recipientName && order.supplierId) {
          const [supplier] = await db.select({ name: counterparties.name }).from(counterparties).where(eq(counterparties.id, order.supplierId)).limit(1);
          recipientName = supplier?.name ?? '';
        }
      } else {
        recipientEmail = order.customerContact?.email ?? '';
        recipientName = order.customerContact?.name ?? order.client?.name ?? '';
      }

      // Build default CC list: sender's own email (so they get a copy)
      const ccEmails = [auth.email];

      // Payment terms
      const paymentTerms = order.customerPaymentTermType
        ? order.customerPaymentTermType === 'CREDIT'
          ? `Credit ${order.customerCreditDays ?? 0} days`
          : order.customerPaymentTermType === 'COD'
            ? 'Cash on Delivery'
            : order.customerPaymentTermType === 'PREPAY'
              ? 'Cash in advance'
              : order.customerPaymentTermType
        : null;

      // Invoice number (for invoice type) — fetch from invoices table
      let invoiceNumber: string | undefined;
      if (docType === 'INVOICE') {
        const [inv] = await db.select({ invoiceNumber: invoicesTable.invoiceNumber }).from(invoicesTable).where(eq(invoicesTable.orderId, orderId)).limit(1);
        invoiceNumber = inv?.invoiceNumber ?? undefined;
      }

      const subject = buildDocumentEmailSubject({ documentType: docType, orderNumber, vesselName, portName, invoiceNumber });
      const htmlBody = buildDocumentEmailHtml({
        documentType: docType,
        senderName,
        vesselName,
        portName,
        orderNumber,
        paymentTerms,
        customerNote: docType === 'NOMINATION' ? order.supplierNote ?? null : order.customerNote ?? null,
        itemNotes: order.items
          ?.filter((item: any) => item.customerNote)
          .map((item: any) => ({
            label: item.productType,
            note: String(item.customerNote),
          })) ?? [],
      });

      return {
        success: true,
        recipientEmail,
        recipientName,
        ccEmails,
        subject,
        htmlBody,
        senderName,
        senderEmail: auth.email,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        documentType: t.Union([
          t.Literal('OFFER'),
          t.Literal('NOMINATION'),
          t.Literal('PROFORMA'),
          t.Literal('INVOICE'),
        ]),
      }),
      detail: {
        tags: ['Documents'],
        summary: 'Get pre-filled email defaults for a document type',
        security: [{ bearerAuth: [] }],
      },
    },
  );
