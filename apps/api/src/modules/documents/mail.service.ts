// ═══════════════════════════════════════════════════════════════════════
//  Mail Service — Unified Document Email Sender
// ═══════════════════════════════════════════════════════════════════════
//
// Sends document emails (offer, nomination, proforma, invoice) with
// PDF attachments. Supports two channels:
//   1. Microsoft Graph `/me/sendMail` — sends from user's own mailbox
//   2. SMTP fallback — uses configured SMTP relay
//
// All sent emails are logged in the `email_log` table for audit.
// ═══════════════════════════════════════════════════════════════════════

import { db } from '../../db';
import { emailLog } from '../../db/schema';
import { getSmtpConfig, getTransporter } from '../../lib/email';
import { acquireGraphTokenForUser } from '../auth/microsoft-oauth.service';

// ─── Helpers ─────────────────────────────────────────────────────────

/** Returns true if a hex color is "light" (should use dark text). */
function isLightColor(hex: string): boolean {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  // Relative luminance threshold (W3C)
  return (r * 299 + g * 587 + b * 114) / 1000 > 186;
}

// ─── Types ───────────────────────────────────────────────────────────

export type DocumentEmailType = 'OFFER' | 'CONFIRMATION' | 'NOMINATION' | 'PROFORMA' | 'INVOICE' | 'INQUIRY';

export interface SendDocumentEmailOptions {
  /** Document type being sent */
  documentType: DocumentEmailType;
  /** Order ID (for logging) */
  orderId: string;
  /** Tenant ID (for logging) */
  tenantId: string;
  /** User ID of the sender (for logging and Graph token acquisition) */
  sentByUserId: string;
  /** Sender's email address */
  senderEmail: string;
  /** Sender's display name */
  senderName: string;
  /** Primary recipient email */
  recipientEmail: string;
  /** CC email addresses */
  ccEmails: string[];
  /** BCC email addresses */
  bccEmails: string[];
  /** Email subject line */
  subject: string;
  /** HTML email body */
  htmlBody: string;
  /** PDF attachment (optional — inquiry emails don't have attachments) */
  pdfBuffer?: Buffer;
  /** PDF file name */
  pdfFileName?: string;
}

// ─── Microsoft Graph API ─────────────────────────────────────────────

interface GraphMailPayload {
  message: {
    subject: string;
    body: { contentType: string; content: string };
    toRecipients: Array<{ emailAddress: { address: string } }>;
    ccRecipients?: Array<{ emailAddress: { address: string } }>;
    bccRecipients?: Array<{ emailAddress: { address: string } }>;
    attachments?: Array<{
      '@odata.type': string;
      name: string;
      contentType: string;
      contentBytes: string;
    }>;
  };
  saveToSentItems: boolean;
}

async function sendViaGraph(options: SendDocumentEmailOptions, accessToken: string): Promise<void> {

  const payload: GraphMailPayload = {
    message: {
      subject: options.subject,
      body: {
        contentType: 'HTML',
        content: options.htmlBody,
      },
      toRecipients: [
        { emailAddress: { address: options.recipientEmail } },
      ],
      ...(options.pdfBuffer && options.pdfFileName ? {
        attachments: [
          {
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: options.pdfFileName,
            contentType: 'application/pdf',
            contentBytes: options.pdfBuffer.toString('base64'),
          },
        ],
      } : {}),
    },
    saveToSentItems: true,
  };

  if (options.ccEmails.length > 0) {
    payload.message.ccRecipients = options.ccEmails.map((email) => ({
      emailAddress: { address: email },
    }));
  }

  if (options.bccEmails.length > 0) {
    payload.message.bccRecipients = options.bccEmails.map((email) => ({
      emailAddress: { address: email },
    }));
  }

  const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    console.error(`[MailService] Graph API returned ${res.status}:`, errorBody);
    throw new Error(`Failed to send email via Graph API: ${res.status}`);
  }
}

// ─── SMTP Fallback ───────────────────────────────────────────────────

async function sendViaSmtp(options: SendDocumentEmailOptions): Promise<void> {
  const smtpCfg = await getSmtpConfig();
  if (!smtpCfg) {
    throw new Error('SMTP is not configured. Set up SMTP in Admin → Settings → Integrations, or provide an O365 token.');
  }

  const transporter = await getTransporter();
  if (!transporter) {
    throw new Error('Failed to create SMTP transport');
  }

  const fromAddress = `"${options.senderName}" <${smtpCfg.from}>`;

  await transporter.sendMail({
    from: fromAddress,
    replyTo: `"${options.senderName}" <${options.senderEmail}>`,
    to: options.recipientEmail,
    cc: options.ccEmails.length > 0 ? options.ccEmails.join(', ') : undefined,
    bcc: options.bccEmails.length > 0 ? options.bccEmails.join(', ') : undefined,
    subject: options.subject,
    html: options.htmlBody,
    ...(options.pdfBuffer && options.pdfFileName ? {
      attachments: [
        {
          filename: options.pdfFileName,
          content: options.pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    } : {}),
  });
}

// ─── Unified Send + Log ─────────────────────────────────────────────

/**
 * Send a document email via the best available channel.
 * Tries Microsoft Graph first (using the user's stored refresh token),
 * then falls back to SMTP.
 * Logs the result to the email_log table.
 */
export async function sendDocumentEmail(options: SendDocumentEmailOptions): Promise<{ channel: 'GRAPH' | 'SMTP' }> {
  let channel: 'GRAPH' | 'SMTP' = 'SMTP';
  let error: string | null = null;

  try {
    // Try to acquire a Graph token from the user's stored Microsoft refresh token
    const graphToken = await acquireGraphTokenForUser(options.sentByUserId);
    if (graphToken) {
      channel = 'GRAPH';
      await sendViaGraph(options, graphToken);
    } else {
      channel = 'SMTP';
      await sendViaSmtp(options);
    }
  } catch (err: any) {
    error = err?.message ?? String(err);
    // Log the failure, then re-throw
    await logEmail(options, channel, 'FAILED', error);
    throw err;
  }

  await logEmail(options, channel, 'SENT', null);
  return { channel };
}

async function logEmail(
  options: SendDocumentEmailOptions,
  channel: 'GRAPH' | 'SMTP',
  status: 'SENT' | 'FAILED',
  errorMessage: string | null,
): Promise<void> {
  try {
    await db.insert(emailLog).values({
      tenantId: options.tenantId,
      orderId: options.orderId,
      documentType: options.documentType,
      sentByUserId: options.sentByUserId,
      sentFromEmail: options.senderEmail,
      sentTo: options.recipientEmail,
      ccEmails: options.ccEmails.length > 0 ? options.ccEmails.join(', ') : null,
      bccEmails: options.bccEmails.length > 0 ? options.bccEmails.join(', ') : null,
      subject: options.subject,
      pdfFileName: options.pdfFileName ?? null,
      channel,
      status,
      errorMessage,
    });
  } catch (logErr) {
    console.error('[MailService] Failed to log email:', logErr);
  }
}

// ─── Email HTML Templates ────────────────────────────────────────────

export type InquiryEmailType = 'INQUIRY';

export function buildDocumentEmailHtml(params: {
  documentType: DocumentEmailType;
  senderName: string;
  vesselName: string;
  portName: string;
  orderNumber: string;
  documentLabel?: string;
  paymentTerms?: string | null;
  customerNote?: string | null;
  itemNotes?: Array<{ label: string; note: string }>;
  companyName?: string | null;
  companyLogoUrl?: string | null;
  brandColor?: string | null;
}): string {
  const labels: Record<DocumentEmailType, { title: string; greeting: string; intro: string }> = {
    OFFER: {
      title: 'Offer',
      greeting: 'Dear Customer',
      intro: `Please find attached our offer for bunker delivery to <strong>${params.vesselName}</strong> at <strong>${params.portName}</strong>.`,
    },
    CONFIRMATION: {
      title: 'Confirmation',
      greeting: 'Dear Customer',
      intro: `Please find attached our confirmation for bunker delivery to <strong>${params.vesselName}</strong> at <strong>${params.portName}</strong>.`,
    },
    NOMINATION: {
      title: 'Nomination',
      greeting: 'Dear Supplier',
      intro: `Please find attached our nomination for bunker delivery to <strong>${params.vesselName}</strong> at <strong>${params.portName}</strong>.`,
    },
    PROFORMA: {
      title: 'Proforma Invoice',
      greeting: 'Dear Customer',
      intro: `Please find attached the proforma invoice for bunker delivery to <strong>${params.vesselName}</strong> at <strong>${params.portName}</strong>.`,
    },
    INVOICE: {
      title: 'Invoice',
      greeting: 'Dear Customer',
      intro: `Please find attached the invoice for bunker delivery to <strong>${params.vesselName}</strong> at <strong>${params.portName}</strong>.`,
    },
    INQUIRY: {
      title: 'Inquiry',
      greeting: 'Good day',
      intro: `Please offer for the following:`,
    },
  };

  const l = labels[params.documentType];

  const paymentTermsRow = params.paymentTerms
    ? `<tr><td style="padding: 4px 16px 4px 0; color: #6b7280; font-size: 13px;">Payment terms:</td><td style="padding: 4px 0; font-weight: 600;">${params.paymentTerms}</td></tr>`
    : '';

  const customerNote = params.customerNote?.trim()
    ? `<p style="margin-top: 12px; white-space: pre-line;">${params.customerNote}</p>`
    : '';

  const itemNotes = params.itemNotes?.length
    ? `<ul style="margin: 8px 0 0 18px; padding: 0; color: #374151;">${params.itemNotes
        .map((n) => `<li>${n.label}: ${n.note}</li>`)
        .join('')}</ul>`
    : '';

  const companyName = params.companyName?.trim() || 'FUELD';
  const headerBg = params.brandColor?.trim() || '#ffffff';
  const isLightBg = isLightColor(headerBg);
  const headerTextColor = isLightBg ? '#111827' : '#ffffff';
  // Always show a colored accent bar at the top; use brand color unless it's white/unset
  const accentColor = (headerBg.toLowerCase() === '#ffffff' || headerBg.toLowerCase() === '#fff') ? '#1e3a5f' : headerBg;
  const logoHtml = params.companyLogoUrl
    ? `<img src="${params.companyLogoUrl}" alt="${companyName}" style="max-height: 40px; max-width: 180px; margin-bottom: 4px;" />`
    : `<h1 style="color: ${headerTextColor}; margin: 0; font-size: 24px;">${companyName}</h1>`;

  return `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px;">
      <div style="height: 4px; background: ${accentColor}; border-radius: 8px 8px 0 0;"></div>
      <div style="background: ${headerBg}; padding: 24px 32px;">
        ${logoHtml}
      </div>
      <div style="background: #ffffff; padding: 32px; border-top: 1px solid #e5e7eb;">
        <p>${l.greeting},</p>
        <p>${l.intro}</p>
        <table style="margin: 16px 0; border-collapse: collapse;">
          <tr>
            <td style="padding: 4px 16px 4px 0; color: #6b7280; font-size: 13px;">Vessel:</td>
            <td style="padding: 4px 0; font-weight: 600;">${params.vesselName}</td>
          </tr>
          <tr>
            <td style="padding: 4px 16px 4px 0; color: #6b7280; font-size: 13px;">Port:</td>
            <td style="padding: 4px 0; font-weight: 600;">${params.portName}</td>
          </tr>
          ${paymentTermsRow}
        </table>
        ${customerNote}
        ${itemNotes}
        <p>If you have any questions, please don't hesitate to reach out.</p>
        <p style="margin-top: 24px;">Best regards,<br/><strong>${params.senderName}</strong></p>
      </div>
      <div style="text-align: center; padding: 16px; color: #9ca3af; font-size: 11px;">
        Sent by ${companyName}
      </div>
    </div>
  `;
}

export function buildDocumentEmailSubject(params: {
  documentType: DocumentEmailType;
  orderNumber: string;
  vesselName: string;
  portName: string;
  invoiceNumber?: string;
}): string {
  const labels: Record<DocumentEmailType, string> = {
    OFFER: 'Offer',
    CONFIRMATION: 'Confirmation',
    NOMINATION: 'Nomination',
    PROFORMA: 'Proforma Invoice',
    INVOICE: 'Invoice',
    INQUIRY: 'Inquiry',
  };

  if (params.documentType === 'INVOICE' && params.invoiceNumber) {
    return `Invoice ${params.invoiceNumber} — Bunker Delivery (${params.vesselName})`;
  }

  return `${labels[params.documentType]} — ${params.orderNumber} — ${params.vesselName}, ${params.portName}`;
}

// ─── Inquiry-specific Email HTML ─────────────────────────────────────

export function buildInquiryEmailHtml(params: {
  senderName: string;
  vesselName: string;
  vesselImo?: string | null;
  portName: string;
  etaFormatted?: string | null;
  etdFormatted?: string | null;
  companyName?: string | null;
  companyLogoUrl?: string | null;
  brandColor?: string | null;
  supplierTerms?: string | null;
  items: Array<{ quantity: string; unit: string; productType: string; description?: string | null }>;
}): string {
  const companyName = params.companyName?.trim() || 'FUELD';
  const headerBg = params.brandColor?.trim() || '#ffffff';
  const isLightBg = isLightColor(headerBg);
  const headerTextColor = isLightBg ? '#111827' : '#ffffff';
  const accentColor = (headerBg.toLowerCase() === '#ffffff' || headerBg.toLowerCase() === '#fff') ? '#1e3a5f' : headerBg;
  const logoHtml = params.companyLogoUrl
    ? `<img src="${params.companyLogoUrl}" alt="${companyName}" style="max-height: 40px; max-width: 180px; margin-bottom: 4px;" />`
    : `<h1 style="color: ${headerTextColor}; margin: 0; font-size: 24px;">${companyName}</h1>`;

  const vesselLabel = params.vesselImo
    ? `${params.vesselName} (IMO: ${params.vesselImo})`
    : params.vesselName;

  const deliveryLabel = params.etaFormatted && params.etdFormatted
    ? `${params.etaFormatted} to ${params.etdFormatted}`
    : params.etaFormatted || params.etdFormatted || '';

  const itemsHtml = params.items
    .map((i) => {
      const desc = i.description ? ` ${i.description}` : '';
      return `<li>${i.quantity} ${i.unit} ${i.productType}${desc}</li>`;
    })
    .join('');

  const termsHtml = params.supplierTerms?.trim()
    ? `<p style="margin-top: 16px; font-size: 13px; color: #6b7280;">${params.supplierTerms}</p>`
    : '';

  return `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px;">
      <div style="height: 4px; background: ${accentColor}; border-radius: 8px 8px 0 0;"></div>
      <div style="background: ${headerBg}; padding: 24px 32px;">
        ${logoHtml}
      </div>
      <div style="background: #ffffff; padding: 32px; border-top: 1px solid #e5e7eb;">
        <p>Good day,</p>
        <p>Please offer for the following:</p>
        <table style="margin: 16px 0; border-collapse: collapse;">
          <tr>
            <td style="padding: 4px 16px 4px 0; color: #6b7280; font-size: 13px;">Vessel:</td>
            <td style="padding: 4px 0; font-weight: 600;">${vesselLabel}</td>
          </tr>
          <tr>
            <td style="padding: 4px 16px 4px 0; color: #6b7280; font-size: 13px;">Place:</td>
            <td style="padding: 4px 0; font-weight: 600;">${params.portName}</td>
          </tr>
          ${deliveryLabel ? `<tr>
            <td style="padding: 4px 16px 4px 0; color: #6b7280; font-size: 13px;">Delivery:</td>
            <td style="padding: 4px 0; font-weight: 600;">${deliveryLabel}</td>
          </tr>` : ''}
          <tr>
            <td style="padding: 4px 16px 4px 0; color: #6b7280; font-size: 13px;">Account:</td>
            <td style="padding: 4px 0; font-weight: 600;">${companyName}</td>
          </tr>
        </table>
        ${itemsHtml ? `<ul style="margin: 8px 0 0 18px; padding: 0; color: #374151;">${itemsHtml}</ul>` : ''}
        ${termsHtml}
        <p>If you have any questions, please don't hesitate to reach out.</p>
        <p style="margin-top: 24px;">Best regards,<br/><strong>${params.senderName}</strong></p>
      </div>
      <div style="text-align: center; padding: 16px; color: #9ca3af; font-size: 11px;">
        Sent by ${companyName}
      </div>
    </div>
  `;
}
