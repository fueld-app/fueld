// ═══════════════════════════════════════════════════════════════════════
//  Documents Offer Controller — Offer & Nomination PDF generation
//
//  Routes for generating customer-facing document PDFs.
// ═══════════════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import { generateNominationPdfBuffer, generateOfferPdfBuffer } from './document.service';
import { resolveOrderId, getOrderById } from '../orders/orders.service';
import { getSupplierNominationSummary } from './supplier-nomination.service';
import {
  resolveNominationOrderSupplier,
  countNominationItemsForSupplier,
} from './documents.helpers';

export const documentsOfferController = new Elysia({ prefix: '/orders' })
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
  );
