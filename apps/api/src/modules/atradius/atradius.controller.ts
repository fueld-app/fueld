/**
 * Atradius insurance cover routes (tenant-gated feature).
 *
 * Gate for every route: atradiusSettings.enabled for the caller's tenant.
 * Mutations (import, mapping): ADMIN | CREDITMANAGER | FINANCE — the credit
 * manager and finance users (e.g. Pierre at Riviera) run the monthly upload;
 * credit-line mutations remain ADMIN|CREDITMANAGER only.
 */
import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import type { ApiResponse } from '@fueld/types';
import { getAtradiusSettings } from '../admin/settings.service';
import {
  importAtradiusFile,
  mapBuyerToCounterparty,
  getAtradiusCover,
  listUnmatchedBuyers,
} from './atradius.service';

const canManageAtradius = (role: string | undefined) =>
  role === 'ADMIN' || role === 'CREDITMANAGER' || role === 'FINANCE';

async function ensureFeatureEnabled(tenantId: string): Promise<void> {
  const settings = await getAtradiusSettings(tenantId);
  if (!settings.enabled) {
    throw new Error('Atradius cover feature is not enabled for this tenant');
  }
}

export const atradiusController = new Elysia({ prefix: '/atradius' })
  .use(authGuard)
  .post(
    '/import',
    async ({ auth, body, set }) => {
      try {
        if (!canManageAtradius(auth.role)) {
          set.status = 403;
          return { success: false, data: null, message: 'Forbidden: insufficient role' };
        }
        await ensureFeatureEnabled(auth.tenantId);
        const data = await importAtradiusFile({
          tenantId: auth.tenantId,
          userId: auth.userId,
          fileName: body.file.name,
          file: body.file,
        });
        set.status = 201;
        return { success: true, data } satisfies ApiResponse<typeof data>;
      } catch (error) {
        console.error('[Atradius] Import failed:', error);
        const message = error instanceof Error ? error.message : 'Failed to import Atradius file';
        set.status = 400;
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({ file: t.File() }),
      detail: { tags: ['Atradius'], summary: 'Upload the monthly Atradius policy export (replaces previous)' },
    },
  )
  .get(
    '/unmatched',
    async ({ auth, set }) => {
      try {
        if (!canManageAtradius(auth.role)) {
          set.status = 403;
          return { success: false, data: null, message: 'Forbidden: insufficient role' };
        }
        await ensureFeatureEnabled(auth.tenantId);
        const data = await listUnmatchedBuyers(auth.tenantId);
        return { success: true, data } satisfies ApiResponse<typeof data>;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      detail: { tags: ['Atradius'], summary: 'Buyer rows of the current import without a counterparty mapping' },
    },
  )
  .put(
    '/buyers/match',
    async ({ auth, body, set }) => {
      try {
        if (!canManageAtradius(auth.role)) {
          set.status = 403;
          return { success: false, data: null, message: 'Forbidden: insufficient role' };
        }
        await ensureFeatureEnabled(auth.tenantId);
        const ok = await mapBuyerToCounterparty({
          tenantId: auth.tenantId,
          buyerNumber: body.buyerNumber,
          counterpartyId: body.counterpartyId,
        });
        if (!ok) {
          set.status = 404;
          return { success: false, data: null, message: 'Buyer rows not found' };
        }
        return { success: true, data: { buyerNumber: body.buyerNumber } } satisfies ApiResponse<{ buyerNumber: string }>;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({
        buyerNumber: t.String(),
        counterpartyId: t.Union([t.String(), t.Null()]),
      }),
      detail: { tags: ['Atradius'], summary: 'Map an Atradius buyer number to a Fueld counterparty (all decision rows)' },
    },
  )
  .get(
    '/cover',
    async ({ auth, set }) => {
      try {
        await ensureFeatureEnabled(auth.tenantId);
        const data = await getAtradiusCover(auth.tenantId);
        return { success: true, data } satisfies ApiResponse<typeof data>;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      detail: { tags: ['Atradius'], summary: 'Current Atradius cover per counterparty + last import metadata' },
    },
  );