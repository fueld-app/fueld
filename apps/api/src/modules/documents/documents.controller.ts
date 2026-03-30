import { Elysia, t } from 'elysia';
import { eq, and, desc, inArray, isNull } from 'drizzle-orm';
import { authGuard } from '../auth/auth.guard';
import { generateNominationPdfBuffer, generateOrderInvoicePdfBuffer, generateOfferPdfBuffer, generateProformaInvoicePdfBuffer, tryLoadLogoDataUrl, formatCustomerPaymentTerms } from './document.service';
import { sendDocumentEmail, buildDocumentEmailHtml, buildDocumentEmailSubject, buildInquiryEmailHtml, type DocumentEmailType } from './mail.service';
import { resolveOrderId, getOrderById } from '../orders/orders.service';
import { getPortSuppliers } from '../lloyds/lli.service';
import { logActivity } from '../activity/activity.service';
import { sendWhatsAppGroupMessage, sendWhatsAppMessage } from '../whatsapp/whatsapp.service';
import { db } from '../../db';
import { users, counterparties, invoices as invoicesTable, companyContacts, companyEmails, supplierInquiries, supplierInquiryItemQuotes, portSuppliers, emailLog, tenants, orders, orderAttachments, orderSuppliers } from '../../db/schema';
import { getEmailTemplate, getApplicableEmailRules, renderTemplate, type TemplateVariables } from '../admin/email-settings.service';
import { getInquirySettings } from '../admin/settings.service';
import { applyStaleSupplierInquiryStatuses, createSupplierQuoteToken, getSupplierQuoteExpiryDate, getSupplierQuoteFormUrl, getSupplierInquiryOrderContext, saveSupplierInquiryResponse } from './supplier-inquiry.service';
import { createSupplierNominationLink, getSupplierNominationFormUrl, getSupplierNominationSummary } from './supplier-nomination.service';

// ═══════════════════════════════════════════════════════════════════════
//  Documents Controller
// ═══════════════════════════════════════════════════════════════════════

function buildInquiryTemplateVariables(params: {
  vesselName: string;
  portName: string;
  orderNumber: string;
  senderName: string;
  companyName: string;
  supplierName?: string | null;
  contactName?: string | null;
  quoteFormUrl?: string | null;
}): TemplateVariables {
  const preferredName = params.contactName?.trim() || params.supplierName?.trim() || 'there';
  const quoteFormUrl = params.quoteFormUrl == null ? '${quoteFormUrl}' : params.quoteFormUrl.trim();
  return {
    vesselName: params.vesselName,
    portName: params.portName,
    orderNumber: params.orderNumber,
    documentLabel: 'Inquiry',
    senderName: params.senderName,
    companyName: params.companyName,
    paymentTerms: '',
    customerNote: '',
    supplierNote: '',
    invoiceNumber: '',
    supplierName: params.supplierName?.trim() || '${supplierName}',
    contactName: params.contactName?.trim() || '${contactName}',
    name: preferredName,
    quoteFormUrl,
  };
}

function buildNominationResponseLinkCardHtml(responseUrl: string): string {
  return `
    <div style="margin-top: 24px; border: 1px solid #dbeafe; border-radius: 12px; background: #f8fbff; padding: 18px;">
      <p style="margin: 0 0 12px; line-height: 1.6; color: #1f2937;">Please confirm delivery completion, submit the exact delivery time, and upload the BDRs here:</p>
      <a href="${responseUrl}" style="display: inline-block; border-radius: 999px; background: #1e3a5f; color: #ffffff; font-weight: 700; text-decoration: none; padding: 10px 16px;">Confirm delivery and upload BDRs</a>
      <p style="margin: 10px 0 0; font-size: 12px; line-height: 1.5; color: #6b7280;">If the button does not open, copy this URL into your browser: ${responseUrl}</p>
    </div>
  `;
}

function injectNominationResponseLink(htmlBody: string, responseUrl: string): string {
  const replaced = htmlBody.replace(/\{\{nominationResponseUrl\}\}|\$\{nominationResponseUrl\}/g, responseUrl);
  if (replaced.includes(responseUrl)) {
    return replaced;
  }
  return `${replaced}${buildNominationResponseLinkCardHtml(responseUrl)}`;
}

function resolveNominationOrderSupplier(
  order: Awaited<ReturnType<typeof getOrderById>>,
  orderSupplierId?: string | null,
) {
  const supplierLegs = order?.orderSuppliers ?? [];
  if (supplierLegs.length > 0) {
    if (orderSupplierId) {
      const selected = supplierLegs.find((supplier) => supplier.id === orderSupplierId) ?? null;
      if (!selected) {
        return { supplier: null, message: 'Selected supplier does not belong to this order' };
      }
      return { supplier: selected, message: null };
    }

    if (supplierLegs.length > 1) {
      return { supplier: null, message: 'Select which supplier you want to nominate first' };
    }

    return { supplier: supplierLegs[0]!, message: null };
  }

  if (!order?.supplierId) {
    return { supplier: null, message: 'Select a supplier first' };
  }

  return {
    supplier: {
      id: null,
      companyId: order.supplierId,
      contactId: order.supplierContactId ?? null,
      paymentTermType: order.supplierPaymentTermType ?? null,
      creditDays: order.supplierCreditDays ?? null,
      note: order.supplierNote ?? null,
      company: order.supplier ?? null,
      contact: order.supplierContact ?? null,
    },
    message: null,
  };
}

function countNominationItemsForSupplier(
  order: Awaited<ReturnType<typeof getOrderById>>,
  orderSupplier?: { id: string | null; isPrimary?: boolean | null } | null,
): number {
  const items = order?.items ?? [];
  const supplierCount = order?.orderSuppliers?.length ?? 0;
  if (!orderSupplier?.id || supplierCount <= 1) {
    return items.length;
  }
  return items.filter((item) => {
    if (item.orderSupplierId === orderSupplier.id) return true;
    return orderSupplier.isPrimary === true && !item.orderSupplierId;
  }).length;
}

async function loadSelectedOrderAttachments(orderId: string, attachmentIds: string[]) {
  if (attachmentIds.length === 0) return [];

  const rows = await db
    .select()
    .from(orderAttachments)
    .where(and(
      eq(orderAttachments.orderId, orderId),
      inArray(orderAttachments.id, attachmentIds),
    ));

  if (rows.length !== attachmentIds.length) {
    throw new Error('One or more selected attachments were not found on this order');
  }

  if (rows.some((row) => String(row.type ?? '').toUpperCase() !== 'BDR')) {
    throw new Error('Only BDR attachments can be added to invoice emails');
  }

  return Promise.all(rows.map(async (row) => {
    const normalizedPath = row.filePath.startsWith('/') ? row.filePath : `/${row.filePath}`;
    const file = Bun.file(`${process.cwd()}${normalizedPath}`);
    if (!(await file.exists())) {
      throw new Error(`Attachment file is missing: ${row.fileName}`);
    }

    return {
      filename: row.fileName,
      content: Buffer.from(await file.arrayBuffer()),
      contentType: row.mimeType,
    };
  }));
}

function calculateInquiryResponseHours(sentAt: Date | null, respondedAt: Date | null): number | null {
  if (!sentAt || !respondedAt) return null;
  const diffMs = respondedAt.getTime() - sentAt.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  return Number((diffMs / 3_600_000).toFixed(2));
}

function getDefaultInquiryResponseDeadline(hours = 48): string {
  return new Date(Date.now() + (hours * 3_600_000)).toISOString();
}

function formatDeadlineHumanDuration(deadlineIso: string): string {
  const hours = Math.round((new Date(deadlineIso).getTime() - Date.now()) / 3_600_000);
  if (hours < 1) return '1 hour';
  if (hours < 24) return `${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day' : `${days} days`;
}

function formatInquiryQuantity(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return trimmed;
  return trimmed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function buildInquiryWhatsAppText(params: {
  supplierName: string;
  contactName?: string | null;
  senderName: string;
  companyName?: string | null;
  vesselName: string;
  vesselImo?: string | null;
  portName: string;
  etaFormatted?: string | null;
  etdFormatted?: string | null;
  responseDeadlineFormatted?: string | null;
  personalNote?: string | null;
  quoteFormUrl?: string | null;
  items: Array<{ quantity: string; quantityMin?: string | null; unit: string; productType: string; description?: string | null }>;
}): string {
  const preferredName = params.contactName?.trim() || params.supplierName.trim() || 'there';
  const vesselLabel = params.vesselImo
    ? `${params.vesselName} (IMO: ${params.vesselImo})`
    : params.vesselName;
  const deliveryLabel = params.etaFormatted && params.etdFormatted
    ? `${params.etaFormatted} to ${params.etdFormatted}`
    : params.etaFormatted || params.etdFormatted || null;
  const companyName = params.companyName?.trim() || 'FUELD';
  const itemLines = params.items.map((item) => {
    const max = formatInquiryQuantity(item.quantity);
    const min = formatInquiryQuantity(item.quantityMin);
    const qtyLabel = min && min !== max ? `${min} - ${max}` : max;
    return `- ${qtyLabel} ${item.unit} ${item.productType}${item.description ? ` - ${item.description}` : ''}`;
  });

  return [
    `Good day ${preferredName},`,
    '',
    params.personalNote?.trim() || null,
    params.personalNote?.trim() ? '' : null,
    'Please offer for the following:',
    `*Vessel:* ${vesselLabel}`,
    `*Place:* ${params.portName}`,
    deliveryLabel ? `*Delivery:* ${deliveryLabel}` : null,
    params.responseDeadlineFormatted ? `*Reply within:* ${params.responseDeadlineFormatted}` : null,
    `*Account:* ${companyName}`,
    '',
    '*Requested items:*',
    ...itemLines,
    params.quoteFormUrl?.trim() ? '' : null,
    params.quoteFormUrl?.trim() ? `Submit quote here: ${params.quoteFormUrl.trim()}` : null,
    '',
    `Best regards,`,
    params.senderName,
  ].filter((line): line is string => line !== null && line !== undefined).join('\n');
}

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
    async ({ params, query, set }) => {
      const orderId = await resolveOrderId(params.id);
      if (!orderId) { set.status = 404; return { success: false, message: 'Order not found' }; }
      const order = await getOrderById(orderId);
      const nominationSupplier = resolveNominationOrderSupplier(order, query.orderSupplierId ?? null);
      if (nominationSupplier.message) {
        set.status = 400;
        return { success: false, message: nominationSupplier.message };
      }
      if (!order?.items?.length) {
        set.status = 400;
        return { success: false, message: 'Add at least one line item before generating documents' };
      }
      if (!nominationSupplier.supplier) {
        set.status = 400;
        return { success: false, message: 'Select a supplier before generating Nomination PDF' };
      }
      if (countNominationItemsForSupplier(order, nominationSupplier.supplier) === 0) {
        set.status = 400;
        return { success: false, message: 'Assign at least one line item to the selected supplier before generating Nomination PDF' };
      }
      if (!order?.invoicingCompanyId) {
        set.status = 400;
        return { success: false, message: 'Select an invoicing company before generating Nomination PDF' };
      }

      let result;
      try {
        result = await generateNominationPdfBuffer(orderId, { orderSupplierId: nominationSupplier.supplier.id ?? null });
      } catch (error: any) {
        set.status = 400;
        return { success: false, message: error?.message ?? 'Failed to generate Nomination PDF' };
      }

      const { buffer, fileName, revision } = result;

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
      query: t.Object({ orderSupplierId: t.Optional(t.String()) }),
      detail: {
        tags: ['Documents'],
        summary: 'Generate nomination PDF for an order',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  .get(
    '/:id/nomination-response',
    async ({ params, query, set }) => {
      const orderId = await resolveOrderId(params.id);
      if (!orderId) {
        set.status = 404;
        return { success: false, data: null, message: 'Order not found' };
      }

      const summary = await getSupplierNominationSummary(orderId, query.orderSupplierId ?? null);
      return { success: true, data: summary };
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({ orderSupplierId: t.Optional(t.String()) }),
      detail: {
        tags: ['Documents'],
        summary: 'Get latest supplier nomination response for an order',
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
      let nominationResponseUrl: string | null = null;
      let nominationSupplierId: string | null = null;

      if (docType === 'NOMINATION') {
        const nominationSupplier = resolveNominationOrderSupplier(order, body.orderSupplierId ?? null);
        if (nominationSupplier.message || !nominationSupplier.supplier) {
          set.status = 400;
          return { success: false, message: nominationSupplier.message ?? 'Select a supplier first' };
        }
        if (countNominationItemsForSupplier(order, nominationSupplier.supplier) === 0) {
          set.status = 400;
          return { success: false, message: 'Assign at least one line item to the selected supplier before sending Nomination' };
        }

        nominationSupplierId = nominationSupplier.supplier.id ?? null;
        const { rawToken } = await createSupplierNominationLink({
          orderId,
          orderSupplierId: nominationSupplierId,
          supplierId: nominationSupplier.supplier.companyId,
          contactId: nominationSupplier.supplier.contactId ?? null,
          email: body.recipientEmail,
          subject: body.subject,
          sentByUserId: auth.userId,
        });
        nominationResponseUrl = getSupplierNominationFormUrl(rawToken);
      }

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
          if (!order.invoicingCompanyId) { set.status = 400; return { success: false, message: 'Select an invoicing company first' }; }
          const result = await generateNominationPdfBuffer(orderId, {
            orderSupplierId: nominationSupplierId,
            responseUrl: nominationResponseUrl,
          });
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

      const attachmentIds = [...new Set((body.attachmentIds ?? []).filter(Boolean))];
      if (attachmentIds.length > 0 && docType !== 'INVOICE') {
        set.status = 400;
        return { success: false, message: 'Additional attachments are only supported for invoice emails' };
      }

      let attachments: Array<{ filename: string; content: Buffer; contentType?: string }> = [];
      if (attachmentIds.length > 0) {
        try {
          attachments = await loadSelectedOrderAttachments(orderId, attachmentIds);
        } catch (error: any) {
          set.status = 400;
          return { success: false, message: error?.message ?? 'Failed to load selected attachments' };
        }
      }

      const htmlBody = docType === 'NOMINATION' && nominationResponseUrl
        ? injectNominationResponseLink(body.htmlBody, nominationResponseUrl)
        : body.htmlBody;

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
        htmlBody,
        pdfBuffer,
        pdfFileName,
        attachments,
      });

      // Log to activity timeline
      logActivity({
        userId: auth.userId,
        tenantId: auth.tenantId,
        action: 'EMAIL_SENT',
        entityType: 'order',
        entityId: orderId,
        metadata: {
          documentType: docType,
          recipientEmail: body.recipientEmail,
          channel,
          subject: body.subject,
        },
      }).catch(() => {});

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
        orderSupplierId: t.Optional(t.String({ description: 'Supplier leg to target for nomination emails' })),
        attachmentIds: t.Optional(t.Array(t.String(), { description: 'Order attachment ids to include with the email' })),
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
      const companyAddress = order.invoicingCompany?.headOfficeAddress ?? null;

      const docLabels: Record<DocumentEmailType, string> = {
        OFFER: 'Offer',
        CONFIRMATION: 'Confirmation',
        NOMINATION: 'Nomination',
        PROFORMA: 'Proforma Invoice',
        INVOICE: 'Invoice',
        INQUIRY: 'Inquiry',
      };

      // Determine recipient based on document type
      let recipientEmail = '';
      let recipientName = '';
      if (docType === 'NOMINATION') {
        const nominationSupplier = resolveNominationOrderSupplier(order, body.orderSupplierId ?? null);
        if (nominationSupplier.message || !nominationSupplier.supplier) {
          set.status = 400;
          return { success: false, message: nominationSupplier.message ?? 'Select a supplier first' };
        }

        recipientEmail = nominationSupplier.supplier.contact?.email ?? '';
        recipientName = nominationSupplier.supplier.contact?.name ?? nominationSupplier.supplier.company?.name ?? '';
      } else if (order.brokerGetsAll && order.brokerContact) {
        // Broker gets all customer-facing comms
        recipientEmail = order.brokerContact.email ?? '';
        recipientName = order.brokerContact.name ?? order.broker?.name ?? '';
      } else {
        recipientEmail = order.customerContact?.email ?? '';
        recipientName = order.customerContact?.name ?? order.client?.name ?? '';
      }

      // Build default CC list: sender's own email (so they get a copy)
      const ccEmails = [auth.email];
      const bccEmails: string[] = [];

      // If broker gets all, optionally CC the original customer contact (admin setting)
      if (docType !== 'NOMINATION' && order.brokerGetsAll && order.brokerContact) {
        const tenantRow = await db.query.tenants.findFirst({
          where: eq(tenants.id, auth.tenantId),
          columns: { settings: true },
        });
        const tenantSettings = (tenantRow?.settings ?? {}) as import('../../db/schema').TenantSettings;
        if (tenantSettings.brokerCcCustomer && order.customerContact?.email) {
          if (!ccEmails.includes(order.customerContact.email)) {
            ccEmails.push(order.customerContact.email);
          }
        }
      }

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

      // Payment terms — use supplier terms for nominations, customer terms otherwise
      const paymentTerms = docType === 'NOMINATION'
        ? (() => {
            const nominationSupplier = resolveNominationOrderSupplier(order, body.orderSupplierId ?? null);
            if (!nominationSupplier.supplier) {
              return formatCustomerPaymentTerms(order.supplierPaymentTermType, order.supplierCreditDays);
            }
            return formatCustomerPaymentTerms(
              nominationSupplier.supplier.paymentTermType ?? null,
              nominationSupplier.supplier.creditDays ?? null,
            );
          })()
        : formatCustomerPaymentTerms(order.customerPaymentTermType, order.customerCreditDays);

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
        supplierName: '',
        contactName: '',
        name: '',
        quoteFormUrl: '',
        nominationResponseUrl: docType === 'NOMINATION' ? '${nominationResponseUrl}' : '',
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
            companyAddress,
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
          companyAddress,
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
        orderSupplierId: t.Optional(t.String()),
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

      // Fuzzy sequential-character match (like VS Code's fuzzy finder).
      // "jon" matches "Johnathan" because j→o→(skip h)→n all appear in order.
      function fuzzyMatch(query: string, text: string): boolean {
        const t = text.toLowerCase();
        let qi = 0;
        for (let ti = 0; ti < t.length && qi < query.length; ti++) {
          if (t[ti] === query[qi]) qi++;
        }
        return qi === query.length;
      }

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
          .where(and(inArray(companyContacts.counterpartyId, [...companyIds]), isNull(companyContacts.deletedAt))),
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
          if (!q || fuzzyMatch(q, label) || fuzzyMatch(q, c.email)) {
            results.push({ email: c.email, name: label, source: 'contact' });
          }
        }
      }

      for (const e of emails) {
        const label = e.label || e.emailType || 'Email';
        if (!q || fuzzyMatch(q, label) || fuzzyMatch(q, e.email)) {
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
  )

  // ══════════════════════════════════════════════════════════════════════
  //  SUPPLIER INQUIRY — send RFQ emails to multiple port suppliers
  // ══════════════════════════════════════════════════════════════════════

  // ── GET /orders/:id/inquiry/suppliers ──────────────────────────────
  // Returns port suppliers for the order's place + their inquiry status
  .get(
    '/:id/inquiry/suppliers',
    async ({ params, set }) => {
      const orderId = await resolveOrderId(params.id);
      if (!orderId) { set.status = 404; return { success: false, message: 'Order not found' }; }

      const order = await getOrderById(orderId);
      if (!order) { set.status = 404; return { success: false, message: 'Order not found' }; }

      await applyStaleSupplierInquiryStatuses({ orderId });

      // Fetch port suppliers for this place
      const suppliers = await getPortSuppliers(order.placeId);

      // Fetch existing supplier inquiries for this order
      const existingInquiries = await db
        .select()
        .from(supplierInquiries)
        .where(eq(supplierInquiries.orderId, orderId));

      const inquiryMap = new Map(existingInquiries.map(i => [i.supplierId, i]));

      // For each supplier, try to find their 'inquiry' type email, falling back to primary or first email
      const supplierCompanyIds = [...new Set(suppliers.map(s => s.companyId))];
      let supplierEmails: Array<{ counterpartyId: string; email: string; emailType: string; isPrimary: boolean }> = [];
      let supplierContacts: Array<{ counterpartyId: string; id: string; name: string; role: string | null; email: string | null; phone: string | null }> = [];
      if (supplierCompanyIds.length > 0) {
        [supplierEmails, supplierContacts] = await Promise.all([
          db
            .select({
              counterpartyId: companyEmails.counterpartyId,
              email: companyEmails.email,
              emailType: companyEmails.emailType,
              isPrimary: companyEmails.isPrimary,
            })
            .from(companyEmails)
            .where(inArray(companyEmails.counterpartyId, supplierCompanyIds)),
          db
            .select({
              counterpartyId: companyContacts.counterpartyId,
              id: companyContacts.id,
              name: companyContacts.name,
              role: companyContacts.role,
              email: companyContacts.email,
              phone: companyContacts.phone,
            })
            .from(companyContacts)
            .where(and(inArray(companyContacts.counterpartyId, supplierCompanyIds), isNull(companyContacts.deletedAt))),
        ]);
      }

      const historicalDeliveredOrders = supplierCompanyIds.length > 0
        ? await db
            .select({
              supplierId: orderSuppliers.companyId,
              placeId: orders.placeId,
              deliveredAt: orderSuppliers.deliveredAt,
              orderDeliveredAt: orders.deliveredAt,
              updatedAt: orders.updatedAt,
            })
            .from(orderSuppliers)
            .innerJoin(orders, eq(orderSuppliers.orderId, orders.id))
            .where(
              and(
                inArray(orderSuppliers.companyId, supplierCompanyIds),
                inArray(orders.status, ['DELIVERED', 'INVOICED', 'PAID']),
              ),
            )
        : [];

      const historicalInquiryOutcomes = supplierCompanyIds.length > 0
        ? await db
            .select({
              supplierId: supplierInquiries.supplierId,
              status: supplierInquiries.status,
              sentAt: supplierInquiries.sentAt,
              respondedAt: supplierInquiries.respondedAt,
              canDeliver: supplierInquiries.canDeliver,
            })
            .from(supplierInquiries)
            .where(inArray(supplierInquiries.supplierId, supplierCompanyIds))
        : [];

      const performanceBySupplier = new Map<string, {
        deliveredCountOverall: number;
        deliveredCountAtPlace: number;
        lastDeliveredAtOverall: string | null;
        lastDeliveredAtPlace: string | null;
        sentCount: number;
        quotedCount: number;
        declinedCount: number;
        noReplyCount: number;
        respondedCount: number;
        deliverableCount: number;
        nonDeliverableCount: number;
        averageResponseHours: number | null;
        totalResponseHours: number;
      }>();

      for (const supplierId of supplierCompanyIds) {
        performanceBySupplier.set(supplierId, {
          deliveredCountOverall: 0,
          deliveredCountAtPlace: 0,
          lastDeliveredAtOverall: null,
          lastDeliveredAtPlace: null,
          sentCount: 0,
          quotedCount: 0,
          declinedCount: 0,
          noReplyCount: 0,
          respondedCount: 0,
          deliverableCount: 0,
          nonDeliverableCount: 0,
          averageResponseHours: null,
          totalResponseHours: 0,
        });
      }

      for (const historicalOrder of historicalDeliveredOrders) {
        if (!historicalOrder.supplierId) continue;
        const stats = performanceBySupplier.get(historicalOrder.supplierId);
        if (!stats) continue;

        const deliveredIso = (
          historicalOrder.deliveredAt
          ?? historicalOrder.orderDeliveredAt
          ?? historicalOrder.updatedAt
        )?.toISOString() ?? null;
        stats.deliveredCountOverall += 1;
        if (deliveredIso && (!stats.lastDeliveredAtOverall || deliveredIso > stats.lastDeliveredAtOverall)) {
          stats.lastDeliveredAtOverall = deliveredIso;
        }

        if (historicalOrder.placeId === order.placeId) {
          stats.deliveredCountAtPlace += 1;
          if (deliveredIso && (!stats.lastDeliveredAtPlace || deliveredIso > stats.lastDeliveredAtPlace)) {
            stats.lastDeliveredAtPlace = deliveredIso;
          }
        }
      }

      for (const inquiry of historicalInquiryOutcomes) {
        const stats = performanceBySupplier.get(inquiry.supplierId);
        if (!stats) continue;
        stats.sentCount += 1;
        if (inquiry.status === 'QUOTED') stats.quotedCount += 1;
        else if (inquiry.status === 'DECLINED') stats.declinedCount += 1;
        else if (inquiry.status === 'NO_REPLY') stats.noReplyCount += 1;
        if (inquiry.respondedAt) {
          stats.respondedCount += 1;
          const responseHours = calculateInquiryResponseHours(inquiry.sentAt, inquiry.respondedAt);
          if (responseHours !== null) {
            stats.totalResponseHours += responseHours;
            stats.averageResponseHours = Number((stats.totalResponseHours / stats.respondedCount).toFixed(2));
          }
        }
        if (inquiry.canDeliver === true) stats.deliverableCount += 1;
        else if (inquiry.canDeliver === false) stats.nonDeliverableCount += 1;
      }

      // Group emails by company
      const emailsByCompany = new Map<string, typeof supplierEmails>();
      for (const e of supplierEmails) {
        const list = emailsByCompany.get(e.counterpartyId) ?? [];
        list.push(e);
        emailsByCompany.set(e.counterpartyId, list);
      }

      const contactsByCompany = new Map<string, typeof supplierContacts>();
      for (const contact of supplierContacts) {
        const list = contactsByCompany.get(contact.counterpartyId) ?? [];
        list.push(contact);
        contactsByCompany.set(contact.counterpartyId, list);
      }

      const groupedSuppliers = new Map<string, {
        portSupplierId: string;
        supplierId: string;
        supplierName: string;
        contactId: string | null;
        contactName: string | null;
        products: Set<string>;
        note: string | null;
        inquiryStatus: string | null;
        inquirySentAt: string | null;
      }>();

      for (const supplier of suppliers) {
        const inquiry = inquiryMap.get(supplier.companyId);
        const existing = groupedSuppliers.get(supplier.companyId);
        if (existing) {
          for (const product of supplier.products ?? []) {
            existing.products.add(product);
          }
          if (!existing.contactId && supplier.contactId) existing.contactId = supplier.contactId;
          if (!existing.contactName && supplier.contactName) existing.contactName = supplier.contactName;
          if (!existing.note && supplier.note) existing.note = supplier.note;
          if (!existing.inquiryStatus && inquiry?.status) existing.inquiryStatus = inquiry.status;
          if (!existing.inquirySentAt && inquiry?.sentAt) existing.inquirySentAt = inquiry.sentAt.toISOString();
          continue;
        }

        groupedSuppliers.set(supplier.companyId, {
          portSupplierId: supplier.id,
          supplierId: supplier.companyId,
          supplierName: supplier.companyName,
          contactId: supplier.contactId,
          contactName: supplier.contactName,
          products: new Set(supplier.products ?? []),
          note: supplier.note,
          inquiryStatus: inquiry?.status ?? null,
          inquirySentAt: inquiry?.sentAt?.toISOString() ?? null,
        });
      }

      const data = [...groupedSuppliers.values()].map((supplier) => {
        const emails = emailsByCompany.get(supplier.supplierId) ?? [];
        const contacts = contactsByCompany.get(supplier.supplierId) ?? [];
        const preferredContact = (supplier.contactId ? contacts.find((contact) => contact.id === supplier.contactId) : null)
          ?? contacts.find((contact) => !!contact.email)
          ?? contacts[0]
          ?? null;
        const preferredPhoneContact = (supplier.contactId ? contacts.find((contact) => contact.id === supplier.contactId && !!contact.phone) : null)
          ?? contacts.find((contact) => !!contact.phone)
          ?? null;
        const inquiryEmail = emails.find(e => e.emailType === 'inquiry')
          ?? emails.find(e => e.isPrimary)
          ?? emails[0]
          ?? null;
        const preferredEmail = inquiryEmail?.email ?? preferredContact?.email ?? null;

        return {
          portSupplierId: supplier.portSupplierId,
          supplierId: supplier.supplierId,
          supplierName: supplier.supplierName,
          contactId: preferredContact?.id ?? supplier.contactId,
          contactName: preferredContact?.name ?? supplier.contactName,
          phone: preferredPhoneContact?.phone ?? null,
          waContactId: preferredPhoneContact?.id ?? null,
          waContactName: preferredPhoneContact?.name ?? null,
          products: [...supplier.products],
          note: supplier.note,
          email: preferredEmail,
          inquiryStatus: supplier.inquiryStatus,
          inquirySentAt: supplier.inquirySentAt,
          performance: performanceBySupplier.get(supplier.supplierId) ?? {
            deliveredCountOverall: 0,
            deliveredCountAtPlace: 0,
            lastDeliveredAtOverall: null,
            lastDeliveredAtPlace: null,
            sentCount: 0,
            quotedCount: 0,
            declinedCount: 0,
            noReplyCount: 0,
            respondedCount: 0,
            deliverableCount: 0,
            nonDeliverableCount: 0,
            averageResponseHours: null,
            totalResponseHours: 0,
          },
          companyEmails: emails.map((email) => ({
            email: email.email,
            emailType: email.emailType,
            isPrimary: email.isPrimary,
          })),
          contacts: contacts.map((contact) => ({
            id: contact.id,
            name: contact.name,
            role: contact.role,
            email: contact.email,
            phone: contact.phone,
          })),
        };
      });

      return { success: true, data };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Documents'],
        summary: 'List port suppliers for this order with inquiry status',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── POST /orders/:id/inquiry/defaults ─────────────────────────────
  // Returns pre-filled subject + body for the inquiry email
  .post(
    '/:id/inquiry/defaults',
    async ({ params, auth, set }) => {
      const orderId = await resolveOrderId(params.id);
      if (!orderId) { set.status = 404; return { success: false, message: 'Order not found' }; }

      const order = await getOrderById(orderId);
      if (!order) { set.status = 404; return { success: false, message: 'Order not found' }; }

      const [sender] = await db.select({ name: users.name }).from(users).where(eq(users.id, auth.userId)).limit(1);
      const senderName = sender?.name ?? 'Fueld User';

      const vesselName = order.vessel?.name ?? 'Vessel';
      const vesselImo = order.vessel?.imo ?? null;
      const portName = order.place?.name ?? 'Port';
      const orderNumber = order.orderNumber ?? orderId.slice(0, 8).toUpperCase();
      const companyName = order.invoicingCompany?.name ?? null;
      const companyLogoUrl = tryLoadLogoDataUrl(order.invoicingCompany?.logoUrl ?? null);
      const brandColor = order.invoicingCompany?.brandColor ?? null;
      const inquirySettings = await getInquirySettings();

      // Fetch supplier terms from the invoicing (own) company
      let supplierTerms: string | null = null;
      if (order.invoicingCompanyId) {
        const [ownCo] = await db
          .select({ supplierTerms: counterparties.supplierTerms })
          .from(counterparties)
          .where(eq(counterparties.id, order.invoicingCompanyId))
          .limit(1);
        supplierTerms = ownCo?.supplierTerms ?? null;
      }

      const formatDate = (iso: string | null) => {
        if (!iso) return null;
        const d = new Date(iso);
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      };

      // Try admin template first
      const templateVars = buildInquiryTemplateVariables({
        vesselName,
        portName,
        orderNumber,
        senderName,
        companyName: companyName ?? '',
        supplierName: '${supplierName}',
        contactName: '${contactName}',
        quoteFormUrl: inquirySettings.supplierResponseUrlEnabled ? '${quoteFormUrl}' : '',
      });

      let subject: string;
      let htmlBody: string;

      try {
        const template = await getEmailTemplate(auth.tenantId, 'INQUIRY');
        if (template?.subjectTemplate) {
          subject = renderTemplate(template.subjectTemplate, templateVars);
        } else {
          subject = `Inquiry ${portName} – ${vesselName}`;
        }
        if (template?.bodyTemplate) {
          htmlBody = renderTemplate(template.bodyTemplate, templateVars);
        } else {
          htmlBody = buildInquiryEmailHtml({
            senderName,
            vesselName,
            vesselImo,
            portName,
            etaFormatted: formatDate(order.eta),
            etdFormatted: formatDate(order.etd),
            companyName,
            companyLogoUrl,
            brandColor,
            supplierTerms,
            includeSupplierQuoteLink: inquirySettings.supplierResponseUrlEnabled,
            responseDeadlineFormatted: formatDeadlineHumanDuration(getDefaultInquiryResponseDeadline(inquirySettings.defaultResponseDeadlineHours)),
            items: order.items.map((i: any) => ({
              quantity: i.quantity,
              quantityMin: i.quantityMin,
              unit: i.unit,
              productType: i.productType,
              description: i.description,
            })),
          });
        }
      } catch {
        subject = `Inquiry ${portName} – ${vesselName}`;
        htmlBody = buildInquiryEmailHtml({
          senderName,
          vesselName,
          vesselImo,
          portName,
          etaFormatted: formatDate(order.eta),
          etdFormatted: formatDate(order.etd),
          companyName,
          companyLogoUrl,
          brandColor,
          supplierTerms,
          includeSupplierQuoteLink: inquirySettings.supplierResponseUrlEnabled,
          responseDeadlineFormatted: formatDeadlineHumanDuration(getDefaultInquiryResponseDeadline(inquirySettings.defaultResponseDeadlineHours)),
          items: order.items.map((i: any) => ({
            quantity: i.quantity,
            quantityMin: i.quantityMin,
            unit: i.unit,
            productType: i.productType,
            description: i.description,
          })),
        });
      }

      return {
        success: true,
        data: {
          subject,
          htmlBody,
          senderName,
          senderEmail: auth.email,
          supplierTerms,
          responseDeadlineAt: getDefaultInquiryResponseDeadline(inquirySettings.defaultResponseDeadlineHours),
        },
      };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Documents'],
        summary: 'Get pre-filled defaults for supplier inquiry email',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── POST /orders/:id/inquiry/send ─────────────────────────────────
  // Send inquiry emails to selected suppliers (one email each)
  .post(
    '/:id/inquiry/send',
    async ({ params, body, auth, set }) => {
      const orderId = await resolveOrderId(params.id);
      if (!orderId) { set.status = 404; return { success: false, message: 'Order not found' }; }

      const order = await getOrderById(orderId);
      if (!order) { set.status = 404; return { success: false, message: 'Order not found' }; }

      if (!order.items?.length) {
        set.status = 400;
        return { success: false, message: 'Add at least one line item before sending inquiries' };
      }

      const [sender] = await db.select({ name: users.name }).from(users).where(eq(users.id, auth.userId)).limit(1);
      const senderName = sender?.name ?? 'Fueld User';
      const senderEmail = auth.email;
      const inquirySettings = await getInquirySettings();

      // Check if this is the first inquiry batch for this order (for WhatsApp notification)
      const existingInquiries = await db
        .select({ id: supplierInquiries.id, supplierId: supplierInquiries.supplierId })
        .from(supplierInquiries)
        .where(eq(supplierInquiries.orderId, orderId));
      const isFirstInquiry = existingInquiries.length === 0;
      const existingInquiryBySupplierId = new Map(existingInquiries.map((inquiry) => [inquiry.supplierId, inquiry]));

      // Apply CC/BCC rules for INQUIRY type
      const ccEmails: string[] = [];
      const bccEmails: string[] = [];
      try {
        const rules = await getApplicableEmailRules(auth.tenantId, order.invoicingCompanyId ?? null, 'INQUIRY');
        for (const rule of rules) {
          if (rule.ruleType === 'CC') ccEmails.push(rule.email);
          else if (rule.ruleType === 'BCC') bccEmails.push(rule.email);
        }
      } catch (err) {
        console.error('[Documents] Failed to load inquiry email rules:', err);
      }

      const normalizedRecipientEmails = [...new Map(
        (body.recipientEmails ?? [])
          .map((email) => email.trim().toLowerCase())
          .filter((email) => email.length > 0)
          .map((email) => [email.toLowerCase(), email] as const),
      ).values()];

      const supplierTargets = body.suppliers.map((supplier) => ({
        type: 'supplier' as const,
        supplierId: supplier.supplierId,
        supplierName: supplier.supplierName,
        email: supplier.email,
        contactId: supplier.contactId,
        contactName: supplier.contactName,
        ccEmail: supplier.ccEmail,
        personalNote: supplier.personalNote?.trim() || undefined,
        resultId: supplier.supplierId,
        label: supplier.supplierName,
      }));

      const seenEmails = new Set(supplierTargets.map((supplier) => supplier.email.toLowerCase()));
      const recipientTargets = normalizedRecipientEmails
        .filter((email) => {
          if (seenEmails.has(email)) return false;
          seenEmails.add(email);
          return true;
        })
        .map((email) => ({
          type: 'recipient' as const,
          email,
          resultId: `recipient:${email}`,
          label: email,
        }));

      const inquiryTargets = [...supplierTargets, ...recipientTargets];

      const results: Array<{ recipientId: string; recipientName: string; email: string; success: boolean; error?: string }> = [];

      for (const target of inquiryTargets) {
        try {
          const quoteToken = target.type === 'supplier' && inquirySettings.supplierResponseUrlEnabled ? createSupplierQuoteToken() : null;
          const quoteTokenExpiresAt = quoteToken ? getSupplierQuoteExpiryDate() : null;
          const templateVars = buildInquiryTemplateVariables({
            vesselName: order.vessel?.name ?? 'Vessel',
            portName: order.place?.name ?? 'Port',
            orderNumber: order.orderNumber ?? orderId.slice(0, 8).toUpperCase(),
            senderName,
            companyName: order.invoicingCompany?.name ?? 'Fueld',
            supplierName: target.type === 'supplier' ? target.supplierName : '',
            contactName: target.type === 'supplier' ? (target.contactName ?? null) : null,
            quoteFormUrl: quoteToken ? getSupplierQuoteFormUrl(quoteToken.rawToken) : '',
          });
          const renderedSubject = renderTemplate(body.subject, templateVars);
          let renderedHtmlBody = renderTemplate(body.htmlBody, templateVars);

          // Prepend personal note if provided
          if (target.type === 'supplier' && target.personalNote) {
            const escapedNote = target.personalNote
              .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/\n/g, '<br/>');
            renderedHtmlBody = `<p style="color:#374151;font-style:italic;margin-bottom:16px;">${escapedNote}</p>${renderedHtmlBody}`;
          }

          // Merge CC company email with global CC list for this target
          const targetCcEmails = [...ccEmails];
          if (target.type === 'supplier' && target.ccEmail) {
            const ccLower = target.ccEmail.toLowerCase();
            if (!targetCcEmails.some((e) => e.toLowerCase() === ccLower) && ccLower !== target.email.toLowerCase()) {
              targetCcEmails.push(target.ccEmail);
            }
          }

          await sendDocumentEmail({
            documentType: 'INQUIRY',
            orderId,
            tenantId: auth.tenantId,
            sentByUserId: auth.userId,
            senderEmail,
            senderName,
            recipientEmail: target.email,
            ccEmails: targetCcEmails,
            bccEmails,
            subject: renderedSubject,
            htmlBody: renderedHtmlBody,
            // No PDF attachment for inquiry
          });

          if (target.type === 'supplier') {
            const existingInquiry = existingInquiryBySupplierId.get(target.supplierId);
            if (existingInquiry) {
              await db.delete(supplierInquiryItemQuotes).where(eq(supplierInquiryItemQuotes.supplierInquiryId, existingInquiry.id));
              await db
                .update(supplierInquiries)
                .set({
                  email: target.email,
                  contactId: target.contactId ?? null,
                  subject: renderedSubject,
                  status: 'SENT',
                  quoteTokenHash: quoteToken?.tokenHash ?? null,
                  quoteTokenExpiresAt: quoteTokenExpiresAt,
                  responseDeadlineAt: body.responseDeadlineAt ? new Date(body.responseDeadlineAt) : null,
                  reminderSentAt: null,
                  reminderCount: 0,
                  respondedAt: null,
                  quotedAt: null,
                  canDeliver: null,
                  declineReason: null,
                  quoteValidUntil: null,
                  deliveryWindow: null,
                  supplierPaymentTerms: null,
                  supplierComment: null,
                  sentByUserId: auth.userId,
                  sentAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(supplierInquiries.id, existingInquiry.id));
            } else {
              const [createdInquiry] = await db.insert(supplierInquiries).values({
                orderId,
                supplierId: target.supplierId,
                contactId: target.contactId ?? null,
                email: target.email,
                subject: renderedSubject,
                status: 'SENT',
                quoteTokenHash: quoteToken?.tokenHash ?? null,
                quoteTokenExpiresAt: quoteTokenExpiresAt,
                responseDeadlineAt: body.responseDeadlineAt ? new Date(body.responseDeadlineAt) : null,
                reminderSentAt: null,
                reminderCount: 0,
                sentByUserId: auth.userId,
              }).returning({ id: supplierInquiries.id, supplierId: supplierInquiries.supplierId });
              if (createdInquiry) {
                existingInquiryBySupplierId.set(createdInquiry.supplierId, createdInquiry);
              }
            }
          }

          results.push({ recipientId: target.resultId, recipientName: target.label, email: target.email, success: true });
        } catch (err: any) {
          console.error(`[Documents] Failed to send inquiry to ${target.email}:`, err);
          results.push({ recipientId: target.resultId, recipientName: target.label, email: target.email, success: false, error: err.message });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const successfulSuppliers = supplierTargets.filter((supplier) =>
        results.some((result) => result.success && result.recipientId === supplier.resultId),
      );
      const successfulRecipients = inquiryTargets.filter((target) =>
        results.some((result) => result.success && result.recipientId === target.resultId),
      );

      // Log to activity timeline
      if (successCount > 0) {
        logActivity({
          userId: auth.userId,
          tenantId: auth.tenantId,
          action: 'EMAIL_SENT',
          entityType: 'order',
          entityId: orderId,
          metadata: {
            documentType: 'INQUIRY',
            recipients: successfulRecipients.map((recipient) => recipient.label).join(', '),
            count: successCount,
            subject: body.subject,
          },
        }).catch(() => {});
      }

      // Send WhatsApp group notification on first inquiry (configurable)
      if (isFirstInquiry && successfulSuppliers.length > 0) {
        try {
          const [tenant] = await db
            .select({ settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, auth.tenantId))
            .limit(1);
          const settings = tenant?.settings as any;
          const groupJid = settings?.whatsappDefaultGroupJid;
          const waEnabled = settings?.whatsappEnabled !== false;
          const firstInquiryGroupNotificationEnabled = settings?.whatsappFirstInquiryGroupNotificationEnabled !== false;

          if (waEnabled && firstInquiryGroupNotificationEnabled && groupJid) {
            const vesselName = order.vessel?.name ?? 'Unknown Vessel';
            const vesselImo = order.vessel?.imo ? ` (IMO: ${order.vessel.imo})` : '';
            const portName = order.place?.name ?? 'Unknown Port';
            const supplierList = successfulSuppliers.map(s => s.supplierName).join(', ');
            const fmtQty = (v: string | null | undefined) => v ? parseFloat(v).toString() : '';
            const productLines = order.items.map((i: any) => {
              const min = i.quantityMin ? fmtQty(i.quantityMin) : '';
              const max = fmtQty(i.quantity);
              const qty = min && min !== max ? `${min} - ${max}` : max;
              return `  • ${qty} ${i.unit} ${i.productType}${i.description ? ' – ' + i.description : ''}`;
            }).join('\n');

            const waText = [
              `📋 *Inquiry Sent*`,
              ``,
              `*Vessel:* ${vesselName}${vesselImo}`,
              `*Port:* ${portName}`,
              order.eta ? `*ETA:* ${new Date(order.eta).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}` : null,
              order.etd ? `*ETD:* ${new Date(order.etd).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}` : null,
              ``,
              `*Products:*`,
              productLines,
              ``,
              `*Suppliers (${successfulSuppliers.length}):* ${supplierList}`,
              `*Sent by:* ${senderName}`,
            ].filter(Boolean).join('\n');

            sendWhatsAppGroupMessage(auth.userId, groupJid, waText).catch((err) => {
              console.error('[Documents] Failed to send WhatsApp group notification:', err);
            });
          }
        } catch (err) {
          console.error('[Documents] Failed to check WhatsApp group settings:', err);
        }
      }

      return {
        success: true,
        message: `Sent inquiry to ${successCount}/${results.length} recipients`,
        data: results,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        suppliers: t.Array(t.Object({
          supplierId: t.String(),
          supplierName: t.String(),
          email: t.String({ format: 'email' }),
          contactId: t.Optional(t.String()),
          contactName: t.Optional(t.String()),
          ccEmail: t.Optional(t.String({ format: 'email' })),
          personalNote: t.Optional(t.String()),
        })),
        recipientEmails: t.Optional(t.Array(t.String({ format: 'email' }))),
        subject: t.String(),
        htmlBody: t.String(),
        responseDeadlineAt: t.Optional(t.Nullable(t.String())),
      }),
      detail: {
        tags: ['Documents'],
        summary: 'Send inquiry emails to selected suppliers',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  .post(
    '/:id/inquiry/send-whatsapp',
    async ({ params, body, auth, set }) => {
      const orderId = await resolveOrderId(params.id);
      if (!orderId) { set.status = 404; return { success: false, message: 'Order not found' }; }

      const order = await getOrderById(orderId);
      if (!order) { set.status = 404; return { success: false, message: 'Order not found' }; }
      if (!order.items?.length) {
        set.status = 400;
        return { success: false, message: 'Add at least one line item before sending inquiries' };
      }

      const [sender] = await db.select({ name: users.name }).from(users).where(eq(users.id, auth.userId)).limit(1);
      const senderName = sender?.name ?? 'Fueld User';
      const inquirySettings = await getInquirySettings();

      const existingInquiries = await db
        .select({ id: supplierInquiries.id, supplierId: supplierInquiries.supplierId })
        .from(supplierInquiries)
        .where(eq(supplierInquiries.orderId, orderId));
      const existingInquiryBySupplierId = new Map(existingInquiries.map((inquiry) => [inquiry.supplierId, inquiry]));

      const formatDate = (iso: string | null) => {
        if (!iso) return null;
        const date = new Date(iso);
        return Number.isNaN(date.getTime())
          ? null
          : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      };

      const responseDeadlineAt = body.responseDeadlineAt ?? getDefaultInquiryResponseDeadline(inquirySettings.defaultResponseDeadlineHours);
      const responseDeadlineFormatted = formatDeadlineHumanDuration(responseDeadlineAt);
      const results: Array<{ recipientId: string; recipientName: string; phone: string; success: boolean; error?: string }> = [];

      for (const target of body.recipients) {
        try {
          const quoteToken = inquirySettings.supplierResponseUrlEnabled ? createSupplierQuoteToken() : null;
          const quoteTokenExpiresAt = quoteToken ? getSupplierQuoteExpiryDate() : null;
          const quoteFormUrl = quoteToken ? getSupplierQuoteFormUrl(quoteToken.rawToken) : null;
          const message = buildInquiryWhatsAppText({
            supplierName: target.supplierName,
            contactName: target.contactName ?? null,
            senderName,
            companyName: order.invoicingCompany?.name ?? 'Fueld',
            vesselName: order.vessel?.name ?? 'Vessel',
            vesselImo: order.vessel?.imo ?? null,
            portName: order.place?.name ?? 'Port',
            etaFormatted: formatDate(order.eta),
            etdFormatted: formatDate(order.etd),
            responseDeadlineFormatted,
            personalNote: target.personalNote ?? null,
            quoteFormUrl,
            items: order.items.map((item: any) => ({
              quantity: item.quantity,
              quantityMin: item.quantityMin,
              unit: item.unit,
              productType: item.productType,
              description: item.description,
            })),
          });

          const waResult = await sendWhatsAppMessage(auth.userId, target.phone, message);
          if (!waResult.success) {
            throw new Error(waResult.message || 'Failed to send WhatsApp inquiry');
          }

          const existingInquiry = existingInquiryBySupplierId.get(target.supplierId);
          if (existingInquiry) {
            await db.delete(supplierInquiryItemQuotes).where(eq(supplierInquiryItemQuotes.supplierInquiryId, existingInquiry.id));
            await db
              .update(supplierInquiries)
              .set({
                email: target.phone,
                contactId: target.contactId ?? null,
                subject: body.subject?.trim() || `RFQ ${order.place?.name ?? 'Port'} - ${order.vessel?.name ?? 'Vessel'}`,
                status: 'SENT',
                quoteTokenHash: quoteToken?.tokenHash ?? null,
                quoteTokenExpiresAt,
                responseDeadlineAt: responseDeadlineAt ? new Date(responseDeadlineAt) : null,
                reminderSentAt: null,
                reminderCount: 0,
                respondedAt: null,
                quotedAt: null,
                canDeliver: null,
                declineReason: null,
                quoteValidUntil: null,
                deliveryWindow: null,
                supplierPaymentTerms: null,
                supplierComment: null,
                sentByUserId: auth.userId,
                sentAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(supplierInquiries.id, existingInquiry.id));
          } else {
            const [createdInquiry] = await db.insert(supplierInquiries).values({
              orderId,
              supplierId: target.supplierId,
              contactId: target.contactId ?? null,
              email: target.phone,
              subject: body.subject?.trim() || `RFQ ${order.place?.name ?? 'Port'} - ${order.vessel?.name ?? 'Vessel'}`,
              status: 'SENT',
              quoteTokenHash: quoteToken?.tokenHash ?? null,
              quoteTokenExpiresAt,
              responseDeadlineAt: responseDeadlineAt ? new Date(responseDeadlineAt) : null,
              reminderSentAt: null,
              reminderCount: 0,
              sentByUserId: auth.userId,
            }).returning({ id: supplierInquiries.id, supplierId: supplierInquiries.supplierId });
            if (createdInquiry) {
              existingInquiryBySupplierId.set(createdInquiry.supplierId, createdInquiry);
            }
          }

          results.push({
            recipientId: target.supplierId,
            recipientName: target.contactName?.trim() || target.supplierName,
            phone: target.phone,
            success: true,
          });
        } catch (err: any) {
          console.error(`[Documents] Failed to send inquiry via WhatsApp to ${target.phone}:`, err);
          results.push({
            recipientId: target.supplierId,
            recipientName: target.contactName?.trim() || target.supplierName,
            phone: target.phone,
            success: false,
            error: err?.message ?? 'Failed to send WhatsApp inquiry',
          });
        }
      }

      return {
        success: true,
        message: `Sent inquiry via WhatsApp to ${results.filter((result) => result.success).length}/${results.length} recipients`,
        data: results,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        recipients: t.Array(t.Object({
          supplierId: t.String(),
          supplierName: t.String(),
          phone: t.String(),
          contactId: t.Optional(t.String()),
          contactName: t.Optional(t.String()),
          personalNote: t.Optional(t.String()),
        })),
        subject: t.Optional(t.String()),
        responseDeadlineAt: t.Optional(t.Nullable(t.String())),
      }),
      detail: {
        tags: ['Documents'],
        summary: 'Send supplier inquiries via WhatsApp',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── GET /orders/:id/inquiry/sent ──────────────────────────────────
  // List previously sent supplier inquiries for this order
  .get(
    '/:id/inquiry/sent',
    async ({ params, set }) => {
      const orderId = await resolveOrderId(params.id);
      if (!orderId) { set.status = 404; return { success: false, message: 'Order not found' }; }

      await applyStaleSupplierInquiryStatuses({ orderId });

      const rows = await db
        .select({
          id: supplierInquiries.id,
          supplierId: supplierInquiries.supplierId,
          supplierName: counterparties.name,
          contactId: supplierInquiries.contactId,
          contactName: companyContacts.name,
          email: supplierInquiries.email,
          subject: supplierInquiries.subject,
          status: supplierInquiries.status,
          sentAt: supplierInquiries.sentAt,
          responseDeadlineAt: supplierInquiries.responseDeadlineAt,
          reminderSentAt: supplierInquiries.reminderSentAt,
          reminderCount: supplierInquiries.reminderCount,
          respondedAt: supplierInquiries.respondedAt,
          quotedAt: supplierInquiries.quotedAt,
          canDeliver: supplierInquiries.canDeliver,
          declineReason: supplierInquiries.declineReason,
          quoteValidUntil: supplierInquiries.quoteValidUntil,
          deliveryWindow: supplierInquiries.deliveryWindow,
          supplierPaymentTerms: supplierInquiries.supplierPaymentTerms,
          supplierComment: supplierInquiries.supplierComment,
          sentByUserId: supplierInquiries.sentByUserId,
        })
        .from(supplierInquiries)
        .innerJoin(counterparties, eq(supplierInquiries.supplierId, counterparties.id))
        .leftJoin(companyContacts, eq(supplierInquiries.contactId, companyContacts.id))
        .where(eq(supplierInquiries.orderId, orderId))
        .orderBy(supplierInquiries.sentAt);

      const orderContext = await getSupplierInquiryOrderContext(orderId);
      if (!orderContext) {
        set.status = 404;
        return { success: false, message: 'Order not found' };
      }

      const quoteCounts = rows.length > 0
        ? await db
            .select({
              supplierInquiryId: supplierInquiryItemQuotes.supplierInquiryId,
              orderItemId: supplierInquiryItemQuotes.orderItemId,
              price: supplierInquiryItemQuotes.price,
              currency: supplierInquiryItemQuotes.currency,
              note: supplierInquiryItemQuotes.note,
            })
            .from(supplierInquiryItemQuotes)
            .where(inArray(supplierInquiryItemQuotes.supplierInquiryId, rows.map((row) => row.id)))
        : [];
      const quoteCountByInquiryId = new Map<string, number>();
      const quoteItemsByInquiryId = new Map<string, Array<{ orderItemId: string; price: string | null; currency: string; note: string | null }>>();
      for (const quote of quoteCounts) {
        if (quote.price !== null) {
          quoteCountByInquiryId.set(quote.supplierInquiryId, (quoteCountByInquiryId.get(quote.supplierInquiryId) ?? 0) + 1);
        }
        const items = quoteItemsByInquiryId.get(quote.supplierInquiryId) ?? [];
        items.push({ orderItemId: quote.orderItemId, price: quote.price, currency: quote.currency, note: quote.note ?? null });
        quoteItemsByInquiryId.set(quote.supplierInquiryId, items);
      }

      return {
        success: true,
        data: rows.map(r => ({
          ...r,
          sentAt: r.sentAt?.toISOString() ?? null,
          responseDeadlineAt: r.responseDeadlineAt?.toISOString() ?? null,
          reminderSentAt: r.reminderSentAt?.toISOString() ?? null,
          respondedAt: r.respondedAt?.toISOString() ?? null,
          quotedAt: r.quotedAt?.toISOString() ?? null,
          quoteValidUntil: r.quoteValidUntil?.toISOString() ?? null,
          responseHours: calculateInquiryResponseHours(r.sentAt, r.respondedAt),
          quoteLineCount: quoteCountByInquiryId.get(r.id) ?? 0,
          items: orderContext.items.map((item) => ({
            ...item,
            price: quoteItemsByInquiryId.get(r.id)?.find((quote) => quote.orderItemId === item.orderItemId)?.price ?? null,
            currency: quoteItemsByInquiryId.get(r.id)?.find((quote) => quote.orderItemId === item.orderItemId)?.currency ?? item.currency,
            note: quoteItemsByInquiryId.get(r.id)?.find((quote) => quote.orderItemId === item.orderItemId)?.note ?? null,
          })),
        })),
      };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Documents'],
        summary: 'List sent supplier inquiries for this order',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  .patch(
    '/:id/inquiry/sent/:inquiryId',
    async ({ params, body, set }) => {
      const orderId = await resolveOrderId(params.id);
      if (!orderId) { set.status = 404; return { success: false, message: 'Order not found' }; }

      const [inquiry] = await db
        .select()
        .from(supplierInquiries)
        .where(and(eq(supplierInquiries.id, params.inquiryId), eq(supplierInquiries.orderId, orderId)))
        .limit(1);
      if (!inquiry) {
        set.status = 404;
        return { success: false, message: 'Supplier inquiry not found' };
      }

      const result = await saveSupplierInquiryResponse({
        inquiry,
        status: body.status,
        respondedAt: body.respondedAt ?? null,
        declineReason: body.declineReason ?? null,
        quoteValidUntil: body.quoteValidUntil ?? null,
        deliveryWindow: body.deliveryWindow ?? null,
        supplierPaymentTerms: body.supplierPaymentTerms ?? null,
        supplierComment: body.supplierComment ?? null,
        items: body.items ?? [],
      });
      if (!result.success) {
        set.status = 400;
        return { success: false, message: result.message };
      }

      return { success: true, data: { updated: true } };
    },
    {
      params: t.Object({ id: t.String(), inquiryId: t.String() }),
      body: t.Object({
        status: t.Union([
          t.Literal('SENT'),
          t.Literal('QUOTED'),
          t.Literal('DECLINED'),
          t.Literal('NO_REPLY'),
        ]),
        respondedAt: t.Optional(t.Nullable(t.String())),
        declineReason: t.Optional(t.Nullable(t.String())),
        quoteValidUntil: t.Optional(t.Nullable(t.String())),
        deliveryWindow: t.Optional(t.Nullable(t.String())),
        supplierPaymentTerms: t.Optional(t.Nullable(t.String())),
        supplierComment: t.Optional(t.Nullable(t.String())),
        items: t.Array(t.Object({
          orderItemId: t.String(),
          price: t.Optional(t.Nullable(t.String())),
          note: t.Optional(t.Nullable(t.String())),
        })),
      }),
      detail: {
        tags: ['Documents'],
        summary: 'Update supplier inquiry response from order detail',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── GET /orders/:id/email-log ─────────────────────────────────────
  // Full email history for this order (all document types)
  .get(
    '/:id/email-log',
    async ({ params, set }) => {
      const orderId = await resolveOrderId(params.id);
      if (!orderId) { set.status = 404; return { success: false, message: 'Order not found' }; }

      const rows = await db
        .select({
          id: emailLog.id,
          documentType: emailLog.documentType,
          sentFromEmail: emailLog.sentFromEmail,
          sentTo: emailLog.sentTo,
          ccEmails: emailLog.ccEmails,
          subject: emailLog.subject,
          pdfFileName: emailLog.pdfFileName,
          channel: emailLog.channel,
          status: emailLog.status,
          errorMessage: emailLog.errorMessage,
          sentByUserId: emailLog.sentByUserId,
          sentByName: users.name,
          createdAt: emailLog.createdAt,
        })
        .from(emailLog)
        .leftJoin(users, eq(emailLog.sentByUserId, users.id))
        .where(eq(emailLog.orderId, orderId))
        .orderBy(desc(emailLog.createdAt));

      return {
        success: true,
        data: rows.map(r => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Documents'],
        summary: 'Get all email log entries for this order',
        security: [{ bearerAuth: [] }],
      },
    },
  );
