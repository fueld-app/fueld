import { Elysia, t } from 'elysia';
import { generateOfferPdfBuffer, generateProformaInvoicePdfBuffer } from './document.service';
import { resolveOrderId } from '../orders/orders.service';

// ═══════════════════════════════════════════════════════════════════════
//  Verify Controller  —  Public (no auth) PDF verification endpoints
//  Served inline so bank details can be verified via QR code scan.
// ═══════════════════════════════════════════════════════════════════════

export const verifyController = new Elysia({ prefix: '/verify' })

  // ── GET /verify/:orderId/offer ─────────────────────────────────────
  .get(
    '/:orderId/offer',
    async ({ params, set }) => {
      const orderId = await resolveOrderId(params.orderId);
      if (!orderId) {
        set.status = 404;
        return { success: false, message: 'Document not found' };
      }

      const { buffer, fileName } = await generateOfferPdfBuffer(orderId);

      set.headers['Content-Type'] = 'application/pdf';
      set.headers['Content-Disposition'] = `inline; filename="${fileName}"`;
      set.headers['Content-Length'] = String(buffer.length);

      return buffer;
    },
    {
      params: t.Object({ orderId: t.String() }),
      detail: {
        tags: ['Verify'],
        summary: 'Verify an offer document (public)',
        description: 'Returns the offer PDF inline for verification via QR code scan. No authentication required.',
      },
    },
  )

  // ── GET /verify/:orderId/proforma-invoice ──────────────────────────
  .get(
    '/:orderId/proforma-invoice',
    async ({ params, set }) => {
      const orderId = await resolveOrderId(params.orderId);
      if (!orderId) {
        set.status = 404;
        return { success: false, message: 'Document not found' };
      }

      const { buffer, fileName } = await generateProformaInvoicePdfBuffer(orderId);

      set.headers['Content-Type'] = 'application/pdf';
      set.headers['Content-Disposition'] = `inline; filename="${fileName}"`;
      set.headers['Content-Length'] = String(buffer.length);

      return buffer;
    },
    {
      params: t.Object({ orderId: t.String() }),
      detail: {
        tags: ['Verify'],
        summary: 'Verify a proforma invoice document (public)',
        description: 'Returns the proforma invoice PDF inline for verification via QR code scan. No authentication required.',
      },
    },
  );
