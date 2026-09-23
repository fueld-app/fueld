import { Elysia, t } from 'elysia';
import {
  generateOfferPdfBuffer,
  generateProformaInvoicePdfBuffer,
  getDocumentRevisionByVerifyToken,
  getLatestDocumentRevisionByOrderId,
  getLatestInvoiceRevisionForOrder,
  isDocumentRevisionVerificationExpired,
  loadDocumentRevisionBuffer,
} from './document.service';
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

      const existingRevision = await getLatestDocumentRevisionByOrderId(orderId, 'OFFER');
      const generated = existingRevision ? null : await generateOfferPdfBuffer(orderId);
      const revision = existingRevision ?? generated!.revision;
      if (await isDocumentRevisionVerificationExpired(revision)) {
        set.status = 410;
        return { success: false, message: 'Verification link expired' };
      }
      const fileName = generated?.fileName ?? `Offer_${orderId.slice(0, 8)}.pdf`;
      const buffer = loadDocumentRevisionBuffer(revision);

      set.headers['Content-Type'] = 'application/pdf';
      set.headers['Content-Disposition'] = `inline; filename="${fileName}"`;
      set.headers['Content-Length'] = String(buffer.length);
      set.headers['X-Document-Revision'] = String(revision.revisionNumber);
      set.headers['X-Document-Reference'] = revision.verificationRef;
      set.headers['X-Document-Fingerprint'] = revision.fingerprintShort;

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

      const existingRevision = await getLatestDocumentRevisionByOrderId(orderId, 'PROFORMA_INVOICE');
      const generated = existingRevision ? null : await generateProformaInvoicePdfBuffer(orderId);
      const revision = existingRevision ?? generated!.revision;
      if (await isDocumentRevisionVerificationExpired(revision)) {
        set.status = 410;
        return { success: false, message: 'Verification link expired' };
      }
      const fileName = generated?.fileName ?? `Nomination_${orderId.slice(0, 8)}.pdf`;
      const buffer = loadDocumentRevisionBuffer(revision);

      set.headers['Content-Type'] = 'application/pdf';
      set.headers['Content-Disposition'] = `inline; filename="${fileName}"`;
      set.headers['Content-Length'] = String(buffer.length);
      set.headers['X-Document-Revision'] = String(revision.revisionNumber);
      set.headers['X-Document-Reference'] = revision.verificationRef;
      set.headers['X-Document-Fingerprint'] = revision.fingerprintShort;

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

  )

  // ── GET /verify/:orderId/invoice ──────────────────────────────────
  // Public and unauthenticated. It must NEVER generate: generation now
  // materializes the invoice row, so a public generate path would let anyone
  // mint invoice numbers and burn sequence values. Serve only what an
  // authenticated issuance already persisted. (A revision may be keyed by the
  // invoice id once one exists, so try both.)
  .get(
    '/:orderId/invoice',
    async ({ params, set }) => {
      const orderId = await resolveOrderId(params.orderId);
      if (!orderId) {
        set.status = 404;
        return { success: false, message: 'Document not found' };
      }

      const revision = await getLatestInvoiceRevisionForOrder(orderId);
      if (!revision) {
        set.status = 404;
        return { success: false, message: 'No issued invoice to verify' };
      }
      if (await isDocumentRevisionVerificationExpired(revision)) {
        set.status = 410;
        return { success: false, message: 'Verification link expired' };
      }
      const fileName = `Invoice_${orderId.slice(0, 8)}.pdf`;
      const buffer = loadDocumentRevisionBuffer(revision);

      set.headers['Content-Type'] = 'application/pdf';
      set.headers['Content-Disposition'] = `inline; filename="${fileName}"`;
      set.headers['Content-Length'] = String(buffer.length);
      set.headers['X-Document-Revision'] = String(revision.revisionNumber);
      set.headers['X-Document-Reference'] = revision.verificationRef;
      set.headers['X-Document-Fingerprint'] = revision.fingerprintShort;

      return buffer;
    },
    {
      params: t.Object({ orderId: t.String() }),
      detail: {
        tags: ['Verify'],
        summary: 'Verify an invoice document (public)',
        description: 'Returns the invoice PDF inline for verification via QR code scan. No authentication required.',
      },
    },
  )

  // ── GET /verify/token/:token ──────────────────────────────────────
  .get(
    '/token/:token',
    async ({ params, set }) => {
      const revision = await getDocumentRevisionByVerifyToken(params.token);
      if (!revision) {
        set.status = 404;
        return { success: false, message: 'Document not found' };
      }

      if (await isDocumentRevisionVerificationExpired(revision)) {
        set.status = 410;
        return { success: false, message: 'Verification link expired' };
      }

      const buffer = loadDocumentRevisionBuffer(revision);

      set.headers['Content-Type'] = 'application/pdf';
      set.headers['Content-Disposition'] = `inline; filename="${revision.verificationRef}.pdf"`;
      set.headers['Content-Length'] = String(buffer.length);
      set.headers['X-Document-Revision'] = String(revision.revisionNumber);
      set.headers['X-Document-Reference'] = revision.verificationRef;
      set.headers['X-Document-Fingerprint'] = revision.fingerprintShort;

      return buffer;
    },
    {
      params: t.Object({ token: t.String() }),
      detail: {
        tags: ['Verify'],
        summary: 'Verify a document by signed token (public)',
        description: 'Returns the exact immutable PDF revision for a verification token.',
      },
    },
  );
