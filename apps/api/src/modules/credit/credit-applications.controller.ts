// ═══════════════════════════════════════════════════════════════════════
//  Credit Applications Controller
//
//  GET    /credit/applications?status=&type=&counterpartyId=&page=&limit=
//  GET    /credit/applications/pending-count
//  GET    /credit/applications/:id
//  POST   /credit/applications
//  POST   /credit/applications/:id/review
//  POST   /credit/applications/:id/cancel
//  GET    /credit/applications/settings
//  PATCH  /credit/applications/settings
// ═══════════════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import {
  listCreditApplications,
  getCreditApplicationById,
  createCreditApplication,
  cancelCreditApplication,
  submitReview,
  countPendingApplications,
  getCreditApplicationSettings,
  updateCreditApplicationSettings,
  getCreditManagerUserIds,
} from './credit-applications.service';
import { sendNotificationToUsers } from '../push/push.service';
import type { ApiResponse } from '@fueld/types';

export const creditApplicationsController = new Elysia({ prefix: '/credit/applications' })
  .use(authGuard)

  // ─── List Applications ──────────────────────────────────────────
  // Any authenticated user can list (traders see their own, credit managers see all)
  .get(
    '/',
    async ({ query, auth }) => {
      const results = await listCreditApplications({
        status: query.status as any,
        type: query.type as any,
        counterpartyId: query.counterpartyId,
        requesterUserId: auth.sub,
        requesterRole: auth.role,
        page: query.page ? parseInt(query.page) : undefined,
        limit: query.limit ? parseInt(query.limit) : undefined,
      });
      return { success: true, data: results } satisfies ApiResponse<typeof results>;
    },
    {
      query: t.Object({
        status: t.Optional(t.String()),
        type: t.Optional(t.String()),
        counterpartyId: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Credit Applications'],
        summary: 'List credit applications (paginated, filterable)',
      },
    },
  )

  // ─── Pending Count (for badge) ─────────────────────────────────
  .get(
    '/pending-count',
    async () => {
      const count = await countPendingApplications();
      return { success: true, data: { count } } satisfies ApiResponse<{ count: number }>;
    },
    {
      detail: {
        tags: ['Credit Applications'],
        summary: 'Count pending credit applications',
      },
    },
  )

  // ─── Get Settings ───────────────────────────────────────────────
  .get(
    '/settings',
    async ({ auth, set }) => {
      if (auth.role !== 'ADMIN' && auth.role !== 'CREDITMANAGER') {
        set.status = 403;
        return { success: false, data: null, message: 'Forbidden' };
      }
      const settings = await getCreditApplicationSettings();
      return { success: true, data: settings } satisfies ApiResponse<typeof settings>;
    },
    {
      detail: {
        tags: ['Credit Applications'],
        summary: 'Get credit application settings',
      },
    },
  )

  // ─── Update Settings ────────────────────────────────────────────
  .patch(
    '/settings',
    async ({ auth, set, body }) => {
      if (auth.role !== 'ADMIN') {
        set.status = 403;
        return { success: false, data: null, message: 'Admin access required' };
      }
      const settings = await updateCreditApplicationSettings(body);
      return { success: true, data: settings } satisfies ApiResponse<typeof settings>;
    },
    {
      body: t.Object({
        requiredApprovals: t.Optional(t.Number({ minimum: 1, maximum: 10 })),
        autoApplyOnApproval: t.Optional(t.Boolean()),
        immediateRejection: t.Optional(t.Boolean()),
        notifyCreditManagers: t.Optional(t.Boolean()),
      }),
      detail: {
        tags: ['Credit Applications'],
        summary: 'Update credit application settings (admin only)',
      },
    },
  )

  // ─── Get Single Application ──────────────────────────────────────
  .get(
    '/:id',
    async ({ params }) => {
      const app = await getCreditApplicationById(params.id);
      if (!app) {
        return { success: false, data: null, message: 'Application not found' };
      }
      return { success: true, data: app } satisfies ApiResponse<typeof app>;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Credit Applications'],
        summary: 'Get a single credit application',
      },
    },
  )

  // ─── Create Application ──────────────────────────────────────────
  .post(
    '/',
    async ({ auth, body }) => {
      try {
        const app = await createCreditApplication(body, auth.sub);

        // Notify credit managers via push notification
        try {
          const settings = await getCreditApplicationSettings();
          if (settings.notifyCreditManagers) {
            const cmUserIds = await getCreditManagerUserIds();
            if (cmUserIds.length > 0) {
              await sendNotificationToUsers(cmUserIds, {
                title: 'New Credit Application',
                body: `${auth.email ?? 'A trader'} submitted a credit application for ${app.counterpartyName} (${app.requestedCurrency} ${Number(app.requestedAmount).toLocaleString()})`,
                url: `/credit/applications`,
              }, auth.tenantId);
            }
          }
        } catch (e) {
          console.error('[CreditApplications] Push notification failed:', e);
        }

        return { success: true, data: app } satisfies ApiResponse<typeof app>;
      } catch (err) {
        console.error('[CreditApplications] Create failed:', err);
        return { success: false, data: null, message: 'Failed to create credit application' };
      }
    },
    {
      body: t.Object({
        type: t.Union([t.Literal('SUPPLIER'), t.Literal('CUSTOMER')]),
        counterpartyId: t.String(),
        orderId: t.Optional(t.String()),
        creditLineId: t.Optional(t.String()),
        requestedAmount: t.String(),
        requestedCurrency: t.String(),
        requestedDays: t.Optional(t.Number()),
        reason: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Credit Applications'],
        summary: 'Submit a new credit application',
      },
    },
  )

  // ─── Review Application ──────────────────────────────────────────
  .post(
    '/:id/review',
    async ({ auth, set, params, body }) => {
      if (auth.role !== 'ADMIN' && auth.role !== 'CREDITMANAGER') {
        set.status = 403;
        return { success: false, data: null, message: 'Only credit managers can review applications' };
      }
      try {
        const app = await submitReview(params.id, auth.sub, body.decision, body.comment);
        if (!app) {
          return { success: false, data: null, message: 'Application not found or already resolved' };
        }
        return { success: true, data: app } satisfies ApiResponse<typeof app>;
      } catch (err: any) {
        console.error('[CreditApplications] Review failed:', err);
        return { success: false, data: null, message: err.message ?? 'Failed to submit review' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        decision: t.Union([t.Literal('APPROVED'), t.Literal('REJECTED')]),
        comment: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Credit Applications'],
        summary: 'Submit a review (approve/reject) for a credit application',
      },
    },
  )

  // ─── Cancel Application ──────────────────────────────────────────
  .post(
    '/:id/cancel',
    async ({ auth, params }) => {
      const app = await cancelCreditApplication(params.id, auth.sub, auth.role);
      if (!app) {
        return { success: false, data: null, message: 'Application not found or cannot be cancelled' };
      }
      return { success: true, data: app } satisfies ApiResponse<typeof app>;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Credit Applications'],
        summary: 'Cancel a pending credit application',
      },
    },
  );
