import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import { generateOrderInvoicePdfBuffer } from './document.service';
import { sendInvoiceEmail } from './mail.service';

// ═══════════════════════════════════════════════════════════════════════
//  Documents Controller
// ═══════════════════════════════════════════════════════════════════════

export const documentsController = new Elysia({ prefix: '/orders' })
  // ── Require authentication for all routes ──
  .use(authGuard)

  // ── GET /orders/:id/invoice/pdf ────────────────────────────────────
  .get(
    '/:id/invoice/pdf',
    async ({ params, set }) => {
      const { buffer, fileName } = await generateOrderInvoicePdfBuffer(params.id);

      set.headers['Content-Type'] = 'application/pdf';
      set.headers['Content-Disposition'] = `attachment; filename="${fileName}"`;
      set.headers['Content-Length'] = String(buffer.length);

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
      // Generate the PDF
      const { buffer, invoiceNumber, fileName } = await generateOrderInvoicePdfBuffer(params.id);

      // We need the user's O365 token to send via Graph.
      // The token is expected to be passed in the request body.
      await sendInvoiceEmail({
        accessToken: body.accessToken,
        recipientEmail: body.recipientEmail,
        invoiceNumber,
        pdfBuffer: buffer,
        pdfFileName: fileName,
        vesselName: body.vesselName ?? 'Vessel',
        portName: body.portName ?? 'Port',
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
