// ═══════════════════════════════════════════════════════════════════════
//  Settings Operations Controller — order numbers, financing,
//  delivery docs, port docs, inquiry/cancel/follow-up, timezone,
//  vessel-company roles, and own-company access for the current user.
//
//  All endpoints require ADMIN role unless noted.
// ═══════════════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import type { ApiResponse } from '@fueld/types';
import {
  getOrderNumberSettings,
  updateOrderNumberSettings,
  getFinancingSettings,
  updateFinancingSettings,
  getDeliveryDocumentationSettings,
  updateDeliveryDocumentationSettings,
  getPortDocumentationSettings,
  updatePortDocumentationSettings,
  getInquiryCancelReasonSettings,
  updateInquiryCancelReasonSettings,
  getInquirySettings,
  updateInquirySettings,
  getFollowUpSettings,
  updateFollowUpSettings,
  getTimezoneSettings,
  updateTimezoneSettings,
  getCostSalesDecimalPrecision,
  updateCostSalesDecimalPrecision,
  getVesselCompanyRoleSettings,
  updateVesselCompanyRoleSettings,
  getUserCompanyAccess,
} from './settings.service';

function requireAdmin(auth: { role: string } | undefined) {
  if (!auth || auth.role !== 'ADMIN') {
    throw new Error('Admin access required');
  }
}

export const settingsOperationsController = new Elysia()
  .use(authGuard)

  // ─── Public: any authenticated user can fetch role options ─────────
  .get('/vessel-company-roles/options', async ({ auth }) => {
    try {
      if (!auth) throw new Error('Authentication required');
      const data = await getVesselCompanyRoleSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get vessel-company role options (any user)' },
  })

  // ── Accessible own companies for current user (non-admin) ────────
  .get('/my-companies', async ({ auth }) => {
    try {
      const data = await getUserCompanyAccess(auth.sub);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get own companies accessible to current user' },
  })

  // ═════════════════════════════════════════════════════════════════
  //  ORDER NUMBER TEMPLATE
  // ═════════════════════════════════════════════════════════════════

  .get('/order-number', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getOrderNumberSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get order number template settings' },
  })

  .put('/order-number', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateOrderNumberSettings({
        template: body.template,
        prefix: body.prefix,
      });
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      template: t.Optional(t.String()),
      prefix: t.Optional(t.String()),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update order number template settings' },
  })

  // ═════════════════════════════════════════════════════════════════
  //  VESSEL COMPANY ROLE SETTINGS
  // ═════════════════════════════════════════════════════════════════

  .get('/vessel-company-roles', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getVesselCompanyRoleSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get vessel-company role options' },
  })

  .put('/vessel-company-roles', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateVesselCompanyRoleSettings(body.roles);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      roles: t.Array(t.Object({
        key: t.String({ minLength: 1 }),
        label: t.String({ minLength: 1 }),
        group: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        seasearcherCode: t.Optional(t.String()),
      })),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update vessel-company role options' },
  })

  // ═════════════════════════════════════════════════════════════════
  //  FINANCING SETTINGS
  // ═════════════════════════════════════════════════════════════════

  .get('/financing', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getFinancingSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get financing settings' },
  })

  .put('/financing', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateFinancingSettings(body.annualRate);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      annualRate: t.Number({ minimum: 0, maximum: 1 }),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update financing settings' },
  })

  // ═════════════════════════════════════════════════════════════════
  //  DELIVERY DOCUMENTATION SETTINGS
  // ═════════════════════════════════════════════════════════════════

  .get('/delivery-documentation', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getDeliveryDocumentationSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get delivery documentation settings' },
  })

  .put('/delivery-documentation', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateDeliveryDocumentationSettings(body);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      requireDeliveryDocumentation: t.Optional(t.Boolean()),
      deliveryDocumentationTypes: t.Optional(t.Array(t.String())),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update delivery documentation settings' },
  })

  .get('/my-delivery-documentation', async () => {
    try {
      const data = await getDeliveryDocumentationSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get delivery documentation settings for current tenant' },
  })

  // ═════════════════════════════════════════════════════════════════
  //  PORT DOCUMENTATION SETTINGS
  // ═════════════════════════════════════════════════════════════════

  .get('/port-documentation', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getPortDocumentationSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get Port Documentation feature settings' },
  })

  .put('/port-documentation', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updatePortDocumentationSettings({ enabled: body.enabled });
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({ enabled: t.Boolean() }),
    detail: { tags: ['Admin Settings'], summary: 'Update Port Documentation feature settings' },
  })

  // ═════════════════════════════════════════════════════════════════
  //  INQUIRY CANCELLATION REASON SETTINGS
  // ═════════════════════════════════════════════════════════════════

  .get('/inquiry-cancel-reasons', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getInquiryCancelReasonSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get configurable inquiry cancellation reasons' },
  })

  .put('/inquiry-cancel-reasons', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateInquiryCancelReasonSettings(body.reasons);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      reasons: t.Array(t.String({ minLength: 1 })),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update configurable inquiry cancellation reasons' },
  })

  .get('/my-inquiry-cancel-reasons', async () => {
    try {
      const data = await getInquiryCancelReasonSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get inquiry cancellation reasons for current tenant' },
  })

  // ═════════════════════════════════════════════════════════════
  //  INQUIRY SETTINGS
  // ═════════════════════════════════════════════════════════════

  .get('/inquiry', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getInquirySettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get inquiry settings' },
  })

  .put('/inquiry', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateInquirySettings(body);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      supplierResponseUrlEnabled: t.Optional(t.Boolean()),
      autoMarkNoReplyAfterHours: t.Optional(t.Nullable(t.Number())),
      defaultResponseDeadlineHours: t.Optional(t.Nullable(t.Number({ minimum: 1 }))),
      notifyQuoteSubmitEmail: t.Optional(t.Boolean()),
      notifyQuoteSubmitPush: t.Optional(t.Boolean()),
      notifyQuoteSubmitWhatsApp: t.Optional(t.Boolean()),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update inquiry settings' },
  })

  // ═════════════════════════════════════════════════════════════
  //  FOLLOW-UP SETTINGS
  // ═════════════════════════════════════════════════════════════

  .get('/follow-up', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getFollowUpSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get follow-up settings' },
  })

  .put('/follow-up', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateFollowUpSettings(body);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      defaultFollowUpDays: t.Optional(t.Number({ minimum: 1, maximum: 365 })),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update follow-up settings' },
  })

  .get('/my-follow-up-settings', async () => {
    try {
      const data = await getFollowUpSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get follow-up settings for current tenant' },
  })

  // ═════════════════════════════════════════════════════════════
  //  TIMEZONE SETTINGS
  // ═════════════════════════════════════════════════════════════

  .get('/timezone', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getTimezoneSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get timezone setting' },
  })

  .put('/timezone', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateTimezoneSettings(body);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      defaultTimezone: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update timezone setting' },
  })

  .get('/my-timezone', async () => {
    try {
      const data = await getTimezoneSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get timezone setting for current tenant' },
  })

  // ═════════════════════════════════════════════════════════════
  //  COST / SALES DECIMAL PRECISION
  // ═════════════════════════════════════════════════════════════

  .get('/cost-sales-precision', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getCostSalesDecimalPrecision();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get cost/sales decimal precision' },
  })

  .put('/cost-sales-precision', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateCostSalesDecimalPrecision(body);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      precision: t.Number({ minimum: 0, maximum: 10 }),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update cost/sales decimal precision' },
  });
