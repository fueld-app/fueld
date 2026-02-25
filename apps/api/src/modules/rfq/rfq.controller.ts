import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import {
  listPendingRfqs,
  listAllRfqs,
  dismissRfq,
  acceptRfq,
  saveIncomingRfq,
  getUserTenantId,
} from './rfq.service';
import { parseRFQ } from '../whatsapp/rfq-parser';
import type { ApiResponse } from '@fueld/types';

// ═══════════════════════════════════════════════════════════════════════
//  RFQ Controller — Incoming RFQ review, manual paste, accept/dismiss
// ═══════════════════════════════════════════════════════════════════════

export const rfqController = new Elysia({ prefix: '/rfqs' })
  .use(authGuard)

  // ── GET /rfqs — list pending RFQs ──────────────────────────────────
  .get(
    '/',
    async ({ auth, query }) => {
      const rfqs = query.all === 'true'
        ? await listAllRfqs(auth.userId)
        : await listPendingRfqs(auth.userId);
      return { success: true, data: rfqs } satisfies ApiResponse<typeof rfqs>;
    },
    {
      query: t.Object({
        all: t.Optional(t.String()),
      }),
      detail: {
        tags: ['RFQ'],
        summary: 'List incoming RFQs (pending by default)',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── POST /rfqs/parse — manual paste  ───────────────────────────────
  .post(
    '/parse',
    async ({ auth, body }) => {
      const parsed = parseRFQ(body.text, 'manual', null);
      if (!parsed) {
        return { success: true, data: { parsed: false } } satisfies ApiResponse<any>;
      }

      const tenantId = await getUserTenantId(auth.userId);
      if (!tenantId) {
        return { success: false, data: null, message: 'User has no tenant' } satisfies ApiResponse<any>;
      }

      const rfqId = await saveIncomingRfq(auth.userId, tenantId, parsed, 'manual');
      return {
        success: true,
        data: {
          parsed: true,
          rfqId,
          vesselName: parsed.vesselName,
          imo: parsed.imo,
          port: parsed.port,
          products: parsed.products,
          eta: parsed.eta,
          confidence: parsed.confidence,
        },
      } satisfies ApiResponse<any>;
    },
    {
      body: t.Object({
        text: t.String({ minLength: 10 }),
      }),
      detail: {
        tags: ['RFQ'],
        summary: 'Parse pasted RFQ text and save it',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── PUT /rfqs/:id/dismiss — dismiss an RFQ ────────────────────────
  .put(
    '/:id/dismiss',
    async ({ auth, params }) => {
      const ok = await dismissRfq(params.id, auth.userId);
      return { success: ok, data: { dismissed: ok } } satisfies ApiResponse<any>;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['RFQ'],
        summary: 'Dismiss an incoming RFQ',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── PUT /rfqs/:id/accept — accept RFQ (link to order) ─────────────
  .put(
    '/:id/accept',
    async ({ auth, params, body }) => {
      const ok = await acceptRfq(params.id, auth.userId, body.orderId);
      return { success: ok, data: { accepted: ok } } satisfies ApiResponse<any>;
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        orderId: t.String(),
      }),
      detail: {
        tags: ['RFQ'],
        summary: 'Accept an RFQ and link it to a created order',
        security: [{ bearerAuth: [] }],
      },
    },
  );
