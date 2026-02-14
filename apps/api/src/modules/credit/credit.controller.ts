// ═══════════════════════════════════════════════════════════════════════
//  Credit Controller
//
//  GET    /credit/lines?type=SUPPLIER|CUSTOMER&counterpartyId=&page=&limit=
//  GET    /credit/lines/:id
//  POST   /credit/lines
//  PATCH  /credit/lines/:id
//  DELETE /credit/lines/:id
// ═══════════════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import {
  listCreditLines,
  getCreditLineById,
  createCreditLine,
  updateCreditLine,
  deleteCreditLine,
} from './credit.service';
import type { ApiResponse } from '@fueld/types';

export const creditController = new Elysia({ prefix: '/credit' })
  .use(authGuard)
  // Only ADMIN and CREDITMANAGER may access credit endpoints
  .onBeforeHandle(({ auth, set }) => {
    if (auth.role !== 'ADMIN' && auth.role !== 'CREDITMANAGER') {
      set.status = 403;
      return { success: false, error: 'Forbidden: insufficient role' };
    }
  })

  // ─── List Credit Lines ──────────────────────────────────────────
  .get(
    '/lines',
    async ({ query }) => {
      const results = await listCreditLines({
        type: query.type as 'SUPPLIER' | 'CUSTOMER' | undefined,
        counterpartyId: query.counterpartyId,
        sortBy: query.sortBy,
        sortDir: query.sortDir as 'asc' | 'desc' | undefined,
        page: query.page ? parseInt(query.page) : undefined,
        limit: query.limit ? parseInt(query.limit) : undefined,
      });
      return { success: true, data: results } satisfies ApiResponse<typeof results>;
    },
    {
      query: t.Object({
        type: t.Optional(t.String()),
        counterpartyId: t.Optional(t.String()),
        sortBy: t.Optional(t.String()),
        sortDir: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Credit'],
        summary: 'List credit lines (paginated, filtered by type)',
      },
    },
  )

  // ─── Get Single Credit Line ─────────────────────────────────────
  .get(
    '/lines/:id',
    async ({ params }) => {
      const line = await getCreditLineById(params.id);
      if (!line) {
        return { success: false, data: null, message: 'Credit line not found' };
      }
      return { success: true, data: line } satisfies ApiResponse<typeof line>;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Credit'],
        summary: 'Get a single credit line by ID',
      },
    },
  )

  // ─── Create Credit Line ─────────────────────────────────────────
  .post(
    '/lines',
    async ({ body }) => {
      try {
        const line = await createCreditLine(body);
        return { success: true, data: line } satisfies ApiResponse<typeof line>;
      } catch (err) {
        console.error('[Credit] Create failed:', err);
        return { success: false, data: null, message: 'Failed to create credit line' };
      }
    },
    {
      body: t.Object({
        counterpartyIds: t.Array(t.String()),
        type: t.Union([t.Literal('SUPPLIER'), t.Literal('CUSTOMER')]),
        creditAmount: t.String(),
        currency: t.String(),
        expires: t.Optional(t.String()),
        periodDays: t.Number(),
        fromDelivery: t.Optional(t.Boolean()),
        qualified: t.Optional(t.Boolean()),
        notes: t.Optional(t.String()),
        ownCompanyIds: t.Optional(t.Array(t.String())),
      }),
      detail: {
        tags: ['Credit'],
        summary: 'Create a new credit line',
      },
    },
  )

  // ─── Update Credit Line ─────────────────────────────────────────
  .patch(
    '/lines/:id',
    async ({ params, body }) => {
      const updated = await updateCreditLine(params.id, body);
      if (!updated) {
        return { success: false, data: null, message: 'Credit line not found' };
      }
      return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        creditAmount: t.Optional(t.String()),
        currency: t.Optional(t.String()),
        expires: t.Optional(t.Nullable(t.String())),
        periodDays: t.Optional(t.Number()),
        fromDelivery: t.Optional(t.Boolean()),
        qualified: t.Optional(t.Boolean()),
        notes: t.Optional(t.Nullable(t.String())),
        counterpartyIds: t.Optional(t.Array(t.String())),
        ownCompanyIds: t.Optional(t.Array(t.String())),
      }),
      detail: {
        tags: ['Credit'],
        summary: 'Update a credit line',
      },
    },
  )

  // ─── Delete Credit Line ─────────────────────────────────────────
  .delete(
    '/lines/:id',
    async ({ params }) => {
      const deleted = await deleteCreditLine(params.id);
      if (!deleted) {
        return { success: false, data: null, message: 'Credit line not found' };
      }
      return { success: true, data: deleted } satisfies ApiResponse<typeof deleted>;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Credit'],
        summary: 'Delete a credit line',
      },
    },
  );
