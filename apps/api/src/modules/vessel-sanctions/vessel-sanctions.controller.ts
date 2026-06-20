// ═══════════════════════════════════════════════════════════════════════
//  Vessel Sanction Check Controller
//
//  GET    /vessel-sanctions/settings            — get settings
//  PUT    /vessel-sanctions/settings            — update settings
//  GET    /vessel-sanctions/history             — check history
//  POST   /vessel-sanctions/check-now           — trigger manual check
// ═══════════════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import type { ApiResponse } from '@fueld/types';
import {
  getVesselSanctionSettings,
  updateVesselSanctionSettings,
  getVesselSanctionHistory,
  runVesselSanctionCheckForTenant,
} from './vessel-sanctions.service';

function requireAdmin(auth: { role: string } | undefined) {
  if (!auth || auth.role !== 'ADMIN') {
    throw new Error('Admin access required');
  }
}

export const vesselSanctionsController = new Elysia({ prefix: '/vessel-sanctions' })
  .use(authGuard)

  // ─── Get Settings ──────────────────────────────────────────────
  .get('/settings', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getVesselSanctionSettings(auth.tenantId);
      return { success: true, data } satisfies ApiResponse<typeof data>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Vessel Sanctions'], summary: 'Get vessel sanction check settings' },
  })

  // ─── Update Settings ──────────────────────────────────────────
  .put('/settings', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateVesselSanctionSettings(auth.tenantId, body);
      return { success: true, data } satisfies ApiResponse<typeof data>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      enabled: t.Optional(t.Boolean()),
      checkIntervalHours: t.Optional(t.Number({ minimum: 1, maximum: 720 })),
      notifyPush: t.Optional(t.Boolean()),
      notifyEmail: t.Optional(t.Boolean()),
      notifyWhatsApp: t.Optional(t.Boolean()),
    }),
    detail: { tags: ['Vessel Sanctions'], summary: 'Update vessel sanction check settings' },
  })

  // ─── Check History ─────────────────────────────────────────────
  .get('/history', async ({ auth, query }) => {
    try {
      requireAdmin(auth);
      const data = await getVesselSanctionHistory(auth.tenantId, {
        limit: query.limit && Number.isFinite(Number(query.limit)) ? Number(query.limit) : undefined,
        page: query.page && Number.isFinite(Number(query.page)) ? Number(query.page) : undefined,
      });
      return { success: true, data } satisfies ApiResponse<typeof data>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    query: t.Object({
      limit: t.Optional(t.String()),
      page: t.Optional(t.String()),
    }),
    detail: { tags: ['Vessel Sanctions'], summary: 'Get vessel sanction check history' },
  })

  // ─── Manual Check ─────────────────────────────────────────────
  .post('/check-now', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const result = await runVesselSanctionCheckForTenant(auth.tenantId);
      return { success: true, data: result } satisfies ApiResponse<typeof result>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to run sanction check';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Vessel Sanctions'], summary: 'Trigger a manual vessel sanction check' },
  });
