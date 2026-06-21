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
  getCreditManagerEmails,
} from './credit-applications.service';
import { sendNotificationToUsers } from '../push/push.service';
import { sendNotificationEmail } from '../../lib/email';
import { notifyCreditApplicationWhatsApp } from './credit-notifications';
import { db } from '../../db';
import { users } from '../../db/schema';
import { eq } from 'drizzle-orm';
import type { ApiResponse } from '@fueld/types';

interface CreditApplicationsControllerDeps {
  authPlugin?: typeof authGuard;
  sendNotificationToUsers?: typeof sendNotificationToUsers;
  sendNotificationEmail?: typeof sendNotificationEmail;
  notifyCreditApplicationWhatsApp?: (
    tenantId: string,
    eventType: 'credit_application_submitted' | 'credit_application_processed',
    context: Record<string, string | number | undefined>,
  ) => Promise<void>;
}

export function createCreditApplicationsController(deps: CreditApplicationsControllerDeps = {}) {
  const {
    authPlugin = authGuard,
    sendNotificationToUsers: sendNotificationToUsersFn = sendNotificationToUsers,
    sendNotificationEmail: sendNotificationEmailFn = sendNotificationEmail,
    notifyCreditApplicationWhatsApp: notifyCreditApplicationWhatsAppFn = notifyCreditApplicationWhatsApp,
  } = deps;

  return new Elysia({ prefix: '/credit/applications' })
    .use(authPlugin)

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
        page: query.page ? parseInt(query.page, 10) : undefined,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
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
        notifyPush: t.Optional(t.Boolean()),
        notifyEmail: t.Optional(t.Boolean()),
        notifyWhatsApp: t.Optional(t.Boolean()),
        notifyTraderPush: t.Optional(t.Boolean()),
        notifyTraderEmail: t.Optional(t.Boolean()),
        notifyTraderWhatsApp: t.Optional(t.Boolean()),
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

        // Notify credit managers via configured channels
        try {
          const settings = await getCreditApplicationSettings();
          const notificationBody = `${auth.email ?? 'A trader'} submitted a credit application for ${app.counterpartyName} (${app.requestedCurrency} ${Number(app.requestedAmount).toLocaleString()})`;

          // Push notification
          if (settings.notifyPush) {
            const cmUserIds = await getCreditManagerUserIds();
            if (cmUserIds.length > 0) {
              await sendNotificationToUsersFn(cmUserIds, {
                title: 'New Credit Application',
                body: notificationBody,
                url: `/credit/applications`,
              }, auth.tenantId);
            }
          }

          // Email notification
          if (settings.notifyEmail) {
            const emails = await getCreditManagerEmails();
            if (emails.length > 0) {
              await sendNotificationEmailFn(
                emails,
                'New Credit Application',
                `<div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
                  <h2 style="margin: 0 0 12px;">New Credit Application</h2>
                  <p style="margin: 0 0 8px;">${notificationBody}</p>
                  <p style="margin: 0;"><a href="${process.env['APP_URL'] ?? ''}/credit/applications" style="color: #2563eb;">View in Fueld</a></p>
                </div>`,
              );
            }
          }

          // WhatsApp notification
          if (settings.notifyWhatsApp) {
            await notifyCreditApplicationWhatsAppFn(auth.tenantId, 'credit_application_submitted', {
              traderEmail: auth.email ?? 'A trader',
              companyName: app.counterpartyName,
              currency: app.requestedCurrency,
              amount: Number(app.requestedAmount).toLocaleString(),
            });
          }
        } catch (e) {
          console.error('[CreditApplications] Notification failed:', e);
        }

        return { success: true, data: app } satisfies ApiResponse<typeof app>;
      } catch (err: any) {
        console.error('[CreditApplications] Create failed:', err);
        const pgCode = err?.cause?.code ?? err?.code;
        const detail = err?.cause?.message ?? err?.message ?? '';
        if (pgCode === '23503') {
          return { success: false, data: null, message: 'Company not found — it may have been deleted. Please refresh the page.' };
        }
        if (pgCode === '42P01') {
          return { success: false, data: null, message: 'Credit applications table does not exist. A database migration may be pending — please contact your administrator.' };
        }
        return { success: false, data: null, message: `Failed to create credit application: ${detail || 'unknown error'}` };
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

        // Notify the submitting trader when the application is resolved
        if (app.status === 'APPROVED' || app.status === 'REJECTED') {
          try {
            const settings = await getCreditApplicationSettings();
            const statusLabel = app.status === 'APPROVED' ? 'approved' : 'rejected';
            const notificationBody = `Your credit application for ${app.counterpartyName} (${app.requestedCurrency} ${Number(app.requestedAmount).toLocaleString()}) has been ${statusLabel}.`;

            if (settings.notifyTraderPush) {
              await sendNotificationToUsersFn([app.requestedByUserId], {
                title: `Credit Application ${app.status === 'APPROVED' ? 'Approved' : 'Rejected'}`,
                body: notificationBody,
                url: `/credit/applications`,
              }, auth.tenantId);
            }

            if (settings.notifyTraderEmail) {
              // Look up trader email
              const [traderRow] = await db.select({ email: users.email }).from(users).where(eq(users.id, app.requestedByUserId)).limit(1);
              if (traderRow?.email) {
                await sendNotificationEmailFn(
                  traderRow.email,
                  `Credit Application ${app.status === 'APPROVED' ? 'Approved' : 'Rejected'}`,
                  `<div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
                    <h2 style="margin: 0 0 12px;">Credit Application ${app.status === 'APPROVED' ? 'Approved' : 'Rejected'}</h2>
                    <p style="margin: 0 0 8px;">${notificationBody}</p>
                    <p style="margin: 0;"><a href="${process.env['APP_URL'] ?? ''}/credit/applications" style="color: #2563eb;">View in Fueld</a></p>
                  </div>`,
                );
              }
            }
            if (settings.notifyTraderWhatsApp) {
              await notifyCreditApplicationWhatsAppFn(auth.tenantId, 'credit_application_processed', {
                companyName: app.counterpartyName,
                currency: app.requestedCurrency,
                amount: Number(app.requestedAmount).toLocaleString(),
                status: statusLabel,
              });
            }
          } catch (e) {
            console.error('[CreditApplications] Trader notification failed:', e);
          }
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
}

export const creditApplicationsController = createCreditApplicationsController();
