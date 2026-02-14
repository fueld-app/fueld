// ═══════════════════════════════════════════════════════════════════════
//  Activity Controller — REST endpoints for activity logs & settings
// ═══════════════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import {
  queryActivity,
  getLastEditedInfo,
  getRetentionDays,
  setRetentionDays,
} from './activity.service';
import { getAllSessions, getAllSessionDtos, getUserSessionCounts } from './session-tracker';
import type { ApiResponse } from '@fueld/types';

export const activityController = new Elysia({ prefix: '/activity' })
  .use(authGuard)

  // ─── Entity activity (any authenticated user) ─────────────────────

  /** GET /activity/:entityType/:entityId  — activity log for a specific entity */
  .get(
    '/:entityType/:entityId',
    async ({ params, query }): Promise<ApiResponse<any>> => {
      const result = await queryActivity({
        entityType: params.entityType,
        entityId: params.entityId,
        action: (query as any).action ?? undefined,
        limit: Number((query as any).limit) || 50,
        offset: Number((query as any).offset) || 0,
      });

      return { success: true, data: result };
    },
    {
      params: t.Object({
        entityType: t.String(),
        entityId: t.String(),
      }),
    },
  )

  /** GET /activity/:entityType/:entityId/last-edit — most recent edit for badge */
  .get(
    '/:entityType/:entityId/last-edit',
    async ({ params }): Promise<ApiResponse<any>> => {
      const info = await getLastEditedInfo(params.entityType, params.entityId);
      return { success: true, data: info };
    },
    {
      params: t.Object({
        entityType: t.String(),
        entityId: t.String(),
      }),
    },
  );

// ═══════════════════════════════════════════════════════════════════════
//  Admin-only activity endpoints
// ═══════════════════════════════════════════════════════════════════════

export const adminActivityController = new Elysia({ prefix: '/admin' })
  .use(authGuard)

  /** GET /admin/activity — paginated activity log (admin only) */
  .get(
    '/activity',
    async ({ auth, set, query }): Promise<ApiResponse<any>> => {
      if (auth.role !== 'ADMIN') {
        set.status = 403;
        return { success: false, data: null, message: 'Admin access required' };
      }

      const page = Number((query as any).page) || 1;
      const pageSize = Number((query as any).pageSize) || Number((query as any).limit) || 50;
      const result = await queryActivity({
        userId: (query as any).userId ?? undefined,
        entityType: (query as any).entityType ?? undefined,
        action: (query as any).action ?? undefined,
        dateFrom: (query as any).dateFrom ?? undefined,
        dateTo: (query as any).dateTo ?? undefined,
        sortBy: (query as any).sortBy ?? undefined,
        sortDir: (query as any).sortDir ?? undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });

      return { success: true, data: result };
    },
  )

  /** GET /admin/sessions — current active WebSocket sessions */
  .get(
    '/sessions',
    async ({ auth, set }): Promise<ApiResponse<any>> => {
      if (auth.role !== 'ADMIN') {
        set.status = 403;
        return { success: false, data: null, message: 'Admin access required' };
      }

      return {
        success: true,
        data: {
          sessions: getAllSessionDtos(),
          counts: getUserSessionCounts(),
        },
      };
    },
  )

  /** GET /admin/settings/activity-retention — current retention period */
  .get(
    '/settings/activity-retention',
    async ({ auth, set }): Promise<ApiResponse<any>> => {
      if (auth.role !== 'ADMIN') {
        set.status = 403;
        return { success: false, data: null, message: 'Admin access required' };
      }

      const days = await getRetentionDays();
      return { success: true, data: { retentionDays: days } };
    },
  )

  /** PUT /admin/settings/activity-retention — update retention period */
  .put(
    '/settings/activity-retention',
    async ({ auth, set, body }): Promise<ApiResponse<any>> => {
      if (auth.role !== 'ADMIN') {
        set.status = 403;
        return { success: false, data: null, message: 'Admin access required' };
      }

      const days = Math.max(1, Math.min(3650, Number(body.retentionDays) || 90));
      await setRetentionDays(days);

      return { success: true, data: { retentionDays: days } };
    },
    {
      body: t.Object({
        retentionDays: t.Number(),
      }),
    },
  );
