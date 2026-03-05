import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { authGuard } from '../auth/auth.guard';
import { generateNominationPdfBuffer, generateOrderInvoicePdfBuffer, generateOfferPdfBuffer, generateProformaInvoicePdfBuffer, tryLoadLogoDataUrl } from './document.service';
import { sendDocumentEmail, buildDocumentEmailHtml, buildDocumentEmailSubject, type DocumentEmailType } from './mail.service';
import { resolveOrderId, getOrderById } from '../orders/orders.service';
import { db } from '../../db';
import { users, counterparties, invoices as invoicesTable, companyContacts, companyEmails } from '../../db/schema';
import { inArray } from 'drizzle-orm';
import { getEmailTemplate, getApplicableEmailRules, renderTemplate, type TemplateVariables } from '../admin/email-settings.service';

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
        case 'OFFER':
        case 'CONFIRMATION': {
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
        bccEmails: body.bccEmails ?? [],
        subject: body.subject,
        htmlBody: body.htmlBody,
        pdfBuffer,
        pdfFileName,
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
          t.Literal('CONFIRMATION'),
          t.Literal('NOMINATION'),
          t.Literal('PROFORMA'),
          t.Literal('INVOICE'),
        ], { description: 'Type of document to send' }),
        recipientEmail: t.String({ format: 'email', description: 'Primary recipient email address' }),
        ccEmails: t.Optional(t.Array(t.String({ format: 'email' }), { description: 'CC email addresses' })),
        bccEmails: t.Optional(t.Array(t.String({ format: 'email' }), { description: 'BCC email addresses' })),
        subject: t.String({ description: 'Email subject line' }),
        htmlBody: t.String({ description: 'HTML email body' }),
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
      const companyName = order.invoicingCompany?.name ?? null;
      const companyLogoUrl = tryLoadLogoDataUrl(order.invoicingCompany?.logoUrl ?? null);
      const brandColor = order.invoicingCompany?.brandColor ?? null;

      const docLabels: Record<DocumentEmailType, string> = {
        OFFER: 'Offer',
        CONFIRMATION: 'Confirmation',
        NOMINATION: 'Nomination',
        PROFORMA: 'Proforma Invoice',
        INVOICE: 'Invoice',
      };

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
      const bccEmails: string[] = [];

      // ── Apply email rules (default CC/BCC from admin config) ──
      const defaultCcEmails: Array<{ email: string; label: string | null }> = [];
      const defaultBccEmails: Array<{ email: string; label: string | null }> = [];
      try {
        const rules = await getApplicableEmailRules(auth.tenantId, order.invoicingCompanyId ?? null, docType);
        for (const rule of rules) {
          if (rule.ruleType === 'CC') {
            // Avoid duplicating the sender's own email
            if (!ccEmails.includes(rule.email)) {
              ccEmails.push(rule.email);
            }
            defaultCcEmails.push({ email: rule.email, label: rule.label });
          } else if (rule.ruleType === 'BCC') {
            bccEmails.push(rule.email);
            defaultBccEmails.push({ email: rule.email, label: rule.label });
          }
        }
      } catch (err) {
        console.error('[Documents] Failed to load email rules:', err);
      }

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

      // ── Build subject and body — use admin template if available ──
      const templateVars: TemplateVariables = {
        vesselName,
        portName,
        orderNumber,
        documentLabel: docLabels[docType],
        senderName,
        companyName: companyName ?? '',
        paymentTerms: paymentTerms ?? '',
        customerNote: order.customerNote ?? '',
        supplierNote: order.supplierNote ?? '',
        invoiceNumber: invoiceNumber ?? '',
      };

      let subject: string;
      let htmlBody: string;

      try {
        const template = await getEmailTemplate(auth.tenantId, docType);
        if (template && template.subjectTemplate) {
          subject = renderTemplate(template.subjectTemplate, templateVars);
        } else {
          subject = buildDocumentEmailSubject({ documentType: docType, orderNumber, vesselName, portName, invoiceNumber });
        }
        if (template && template.bodyTemplate) {
          htmlBody = renderTemplate(template.bodyTemplate, templateVars);
        } else {
          htmlBody = buildDocumentEmailHtml({
            documentType: docType,
            senderName,
            vesselName,
            portName,
            orderNumber,
            paymentTerms,
            customerNote: docType === 'NOMINATION' ? order.supplierNote ?? null : order.customerNote ?? null,
            companyName,
            companyLogoUrl,
            brandColor,
            itemNotes: order.items
              ?.filter((item: any) => item.customerNote)
              .map((item: any) => ({
                label: item.productType,
                note: String(item.customerNote),
              })) ?? [],
          });
        }
      } catch {
        subject = buildDocumentEmailSubject({ documentType: docType, orderNumber, vesselName, portName, invoiceNumber });
        htmlBody = buildDocumentEmailHtml({
          documentType: docType,
          senderName,
          vesselName,
          portName,
          orderNumber,
          paymentTerms,
          customerNote: docType === 'NOMINATION' ? order.supplierNote ?? null : order.customerNote ?? null,
          companyName,
          companyLogoUrl,
          brandColor,
          itemNotes: order.items
            ?.filter((item: any) => item.customerNote)
            .map((item: any) => ({
              label: item.productType,
              note: String(item.customerNote),
            })) ?? [],
        });
      }

      return {
        success: true,
        data: {
          recipientEmail,
          recipientName,
          ccEmails,
          bccEmails,
          defaultCcEmails,
          defaultBccEmails,
          subject,
          htmlBody,
          senderName,
          senderEmail: auth.email,
        },
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        documentType: t.Union([
          t.Literal('OFFER'),
          t.Literal('CONFIRMATION'),
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
  )

  // ── GET /orders/:id/contacts/search ────────────────────────────────
  // Search contacts + emails for the order's customer/supplier (for typeahead)
  .get(
    '/:id/contacts/search',
    async ({ params, query, auth, set }) => {
      const orderId = await resolveOrderId(params.id);
      if (!orderId) { set.status = 404; return { success: false, data: [], message: 'Order not found' }; }

      const order = await getOrderById(orderId);
      if (!order) { set.status = 404; return { success: false, data: [], message: 'Order not found' }; }

      const q = (query.q ?? '').toLowerCase().trim();

      // Gather all counterparty IDs related to this order
      const companyIds = new Set<string>();
      if (order.clientId) companyIds.add(order.clientId);
      if (order.supplierId) companyIds.add(order.supplierId);

      if (companyIds.size === 0) {
        return { success: true, data: [] };
      }

      // Fetch contacts and emails from those companies

      const [contacts, emails] = await Promise.all([
        db
          .select({
            id: companyContacts.id,
            name: companyContacts.name,
            email: companyContacts.email,
            role: companyContacts.role,
            counterpartyId: companyContacts.counterpartyId,
          })
          .from(companyContacts)
          .where(inArray(companyContacts.counterpartyId, [...companyIds])),
        db
          .select({
            id: companyEmails.id,
            email: companyEmails.email,
            label: companyEmails.label,
            emailType: companyEmails.emailType,
            counterpartyId: companyEmails.counterpartyId,
          })
          .from(companyEmails)
          .where(inArray(companyEmails.counterpartyId, [...companyIds])),
      ]);

      // Merge into a flat list of {email, name/label, source}
      const results: Array<{ email: string; name: string; source: 'contact' | 'company_email' }> = [];

      for (const c of contacts) {
        if (c.email) {
          const label = c.name + (c.role ? ` (${c.role})` : '');
          if (!q || label.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)) {
            results.push({ email: c.email, name: label, source: 'contact' });
          }
        }
      }

      for (const e of emails) {
        const label = e.label || e.emailType || 'Email';
        if (!q || label.toLowerCase().includes(q) || e.email.toLowerCase().includes(q)) {
          results.push({ email: e.email, name: label, source: 'company_email' });
        }
      }

      // Deduplicate by email
      const seen = new Set<string>();
      const deduped = results.filter((r) => {
        const key = r.email.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return { success: true, data: deduped.slice(0, 20) };
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({ q: t.Optional(t.String()) }),
      detail: {
        tags: ['Documents'],
        summary: 'Search contacts for email typeahead',
        security: [{ bearerAuth: [] }],
      },
    },
  );
