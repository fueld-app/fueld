// ═══════════════════════════════════════════════════════════════════════
//  Mail Service — Microsoft Graph API Emailer
// ═══════════════════════════════════════════════════════════════════════
//
// Sends emails using the logged-in user's O365 token via the
// Microsoft Graph API. Falls back to a service-level token if
// the user doesn't have one.
// ═══════════════════════════════════════════════════════════════════════

interface SendMailOptions {
  /** The O365 access token of the sending user. */
  accessToken: string;
  /** Recipient email address. */
  to: string;
  /** Email subject. */
  subject: string;
  /** HTML body content. */
  htmlBody: string;
  /** Optional file attachment (e.g. an invoice PDF). */
  attachment?: {
    fileName: string;
    contentBytes: string; // base64
    contentType: string;
  };
}

interface GraphMailPayload {
  message: {
    subject: string;
    body: { contentType: string; content: string };
    toRecipients: Array<{ emailAddress: { address: string } }>;
    attachments?: Array<{
      '@odata.type': string;
      name: string;
      contentType: string;
      contentBytes: string;
    }>;
  };
  saveToSentItems: boolean;
}

/**
 * Send an email via Microsoft Graph `/me/sendMail`.
 * The email is sent from the authenticated user's own mailbox.
 */
export async function sendGraphMail(options: SendMailOptions): Promise<void> {
  const payload: GraphMailPayload = {
    message: {
      subject: options.subject,
      body: {
        contentType: 'HTML',
        content: options.htmlBody,
      },
      toRecipients: [
        { emailAddress: { address: options.to } },
      ],
    },
    saveToSentItems: true,
  };

  if (options.attachment) {
    payload.message.attachments = [
      {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: options.attachment.fileName,
        contentType: options.attachment.contentType,
        contentBytes: options.attachment.contentBytes,
      },
    ];
  }

  const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
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

/**
 * Send an invoice email with an attached PDF.
 *
 * @param accessToken  The sender's O365 access token
 * @param recipientEmail  Where to send the invoice
 * @param invoiceNumber  For the subject line
 * @param pdfBuffer  The generated PDF buffer
 * @param pdfFileName  e.g. "Fueld_Invoice_12345.pdf"
 * @param vesselName  For the email body
 * @param portName  For the email body
 */
export async function sendInvoiceEmail(params: {
  accessToken: string;
  recipientEmail: string;
  invoiceNumber: string;
  pdfBuffer: Buffer;
  pdfFileName: string;
  vesselName: string;
  portName: string;
}): Promise<void> {
  const htmlBody = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1a56db; padding: 24px 32px; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px;">FUELD</h1>
        <p style="color: #bfdbfe; margin: 4px 0 0 0; font-size: 12px;">Bunker Trading Solutions</p>
      </div>
      <div style="background: #ffffff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p>Dear Customer,</p>
        <p>Please find attached invoice <strong>${params.invoiceNumber}</strong> for bunker delivery to:</p>
        <table style="margin: 16px 0; border-collapse: collapse;">
          <tr>
            <td style="padding: 4px 16px 4px 0; color: #6b7280; font-size: 13px;">Vessel:</td>
            <td style="padding: 4px 0; font-weight: 600;">${params.vesselName}</td>
          </tr>
          <tr>
            <td style="padding: 4px 16px 4px 0; color: #6b7280; font-size: 13px;">Port:</td>
            <td style="padding: 4px 0; font-weight: 600;">${params.portName}</td>
          </tr>
        </table>
        <p>If you have any questions regarding this invoice, please don't hesitate to reach out.</p>
        <p style="margin-top: 24px;">Best regards,<br/><strong>Fueld Trading</strong></p>
      </div>
      <div style="text-align: center; padding: 16px; color: #9ca3af; font-size: 11px;">
        This email was sent via Fueld — Bunker Trading SaaS
      </div>
    </div>
  `;

  await sendGraphMail({
    accessToken: params.accessToken,
    to: params.recipientEmail,
    subject: `Invoice ${params.invoiceNumber} — Bunker Delivery (${params.vesselName})`,
    htmlBody,
    attachment: {
      fileName: params.pdfFileName,
      contentBytes: params.pdfBuffer.toString('base64'),
      contentType: 'application/pdf',
    },
  });
}
