// ═══════════════════════════════════════════════════════════════════════
//  Documents Invoice Controller — Proforma & Invoice PDF generation
//
//  Routes for generating financial document PDFs.
// ═══════════════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import { generateOrderInvoicePdfBuffer, generateProformaInvoicePdfBuffer } from './document.service';
import { resolveOrderId, getOrderById } from '../orders/orders.service';
import { getTransferDocumentBlockReason } from './documents.helpers';

export const documentsInvoiceController = new Elysia({ prefix: '/orders' })
  .use(authGuard)

  // ── GET /orders/:id/proforma/pdf ───────────────────────────────────
  .get(
    '/:id/proforma/pdf',
    async ({ params, query, set }) => {
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
      const requestedSide = (query.side === 'DESTINATION_BUY' ? 'DESTINATION_BUY' : 'SOURCE_SELL') as 'SOURCE_SELL' | 'DESTINATION_BUY';
      const transferBlock = await getTransferDocumentBlockReason(order, requestedSide);
      if (transferBlock) {
        set.status = 400;
        return { success: false, message: transferBlock };
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
      query: t.Object({ side: t.Optional(t.String()) }),
      detail: {
        tags: ['Documents'],
        summary: 'Generate proforma invoice PDF for an order/inquiry. For internal-transfer orders, optional `side=SOURCE_SELL|DESTINATION_BUY` selects which transfer side must be FINALIZED.',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── GET /orders/:id/invoice/pdf ────────────────────────────────────
  .get(
    '/:id/invoice/pdf',
    async ({ params, query, set }) => {
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
      const requestedSide = (query.side === 'DESTINATION_BUY' ? 'DESTINATION_BUY' : 'SOURCE_SELL') as 'SOURCE_SELL' | 'DESTINATION_BUY';
      const transferBlock = await getTransferDocumentBlockReason(order, requestedSide);
      if (transferBlock) {
        set.status = 400;
        return { success: false, message: transferBlock };
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
      query: t.Object({ side: t.Optional(t.String()) }),
      detail: {
        tags: ['Documents'],
        summary: 'Generate invoice PDF for an order. For internal-transfer orders, optional `side=SOURCE_SELL|DESTINATION_BUY` selects which transfer side must be FINALIZED.',
        description: 'Fetches order, client, items and generates a professional invoice PDF.',
        security: [{ bearerAuth: [] }],
      },
    },
  );
