// ═══════════════════════════════════════════════════════════════════════
//  Risk Monitoring Controller
//
//  GET    /risk-monitoring/summary/:counterpartyId
//  GET    /risk-monitoring/checks/:counterpartyId
//  GET    /risk-monitoring/hits/:counterpartyId
//  POST   /risk-monitoring/check/:counterpartyId       (manual re-check)
//  GET    /risk-monitoring/frozen/:counterpartyId
//  POST   /risk-monitoring/frozen/batch                 (batch frozen check)
//  GET    /risk-monitoring/overrides/:counterpartyId
//  GET    /risk-monitoring/overrides/pending
//  POST   /risk-monitoring/overrides
//  POST   /risk-monitoring/overrides/:id/decide
//  GET    /risk-monitoring/settings
//  PUT    /risk-monitoring/settings
// ═══════════════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import type { ApiResponse } from '@fueld/types';
import {
  getRiskSummary,
  getChecksForCompany,
  getHitsForCompany,
  triggerManualCheck,
  isCreditFrozen,
  getFrozenCounterpartyIds,
  createOverride,
  approveOrRejectOverride,
  getOverridesForCompany,
  getPendingOverrides,
  getRiskMonitoringSettings,
  updateRiskMonitoringSettings,
} from './risk-monitoring.service';

export const riskMonitoringController = new Elysia({ prefix: '/risk-monitoring' })
  .use(authGuard)

  // ─── Risk Summary ───────────────────────────────────────────────
  .get(
    '/summary/:counterpartyId',
    async ({ params, auth }) => {
      const summary = await getRiskSummary(params.counterpartyId, auth.tenantId);
      if (!summary) return { success: false, data: null, message: 'Company not found' } satisfies ApiResponse<null>;
      return { success: true, data: summary } satisfies ApiResponse<typeof summary>;
    },
    {
      params: t.Object({ counterpartyId: t.String() }),
      detail: { tags: ['Risk Monitoring'], summary: 'Get risk summary for a company' },
    },
  )

  // ─── Check History ──────────────────────────────────────────────
  .get(
    '/checks/:counterpartyId',
    async ({ params, query }) => {
      const checks = await getChecksForCompany(params.counterpartyId, query.limit ? parseInt(query.limit) : 50);
      return { success: true, data: checks } satisfies ApiResponse<typeof checks>;
    },
    {
      params: t.Object({ counterpartyId: t.String() }),
      query: t.Object({ limit: t.Optional(t.String()) }),
      detail: { tags: ['Risk Monitoring'], summary: 'Get risk check history' },
    },
  )

  // ─── Active Hits ────────────────────────────────────────────────
  .get(
    '/hits/:counterpartyId',
    async ({ params, query }) => {
      const activeOnly = query.activeOnly !== 'false';
      const hits = await getHitsForCompany(params.counterpartyId, activeOnly);
      return { success: true, data: hits } satisfies ApiResponse<typeof hits>;
    },
    {
      params: t.Object({ counterpartyId: t.String() }),
      query: t.Object({ activeOnly: t.Optional(t.String()) }),
      detail: { tags: ['Risk Monitoring'], summary: 'Get risk hits for a company' },
    },
  )

  // ─── Manual Re-Check ───────────────────────────────────────────
  .post(
    '/check/:counterpartyId',
    async ({ params, auth, set }) => {
      if (auth.role !== 'ADMIN' && auth.role !== 'CREDITMANAGER') {
        set.status = 403;
        return { success: false, data: null, message: 'Forbidden' } satisfies ApiResponse<null>;
      }
      const summary = await triggerManualCheck(params.counterpartyId, auth.tenantId);
      if (!summary) return { success: false, data: null, message: 'Company not found or monitoring disabled' } satisfies ApiResponse<null>;
      return { success: true, data: summary } satisfies ApiResponse<typeof summary>;
    },
    {
      params: t.Object({ counterpartyId: t.String() }),
      detail: { tags: ['Risk Monitoring'], summary: 'Trigger manual risk check' },
    },
  )

  // ─── Frozen Status (single) ─────────────────────────────────────
  .get(
    '/frozen/:counterpartyId',
    async ({ params }) => {
      const frozen = await isCreditFrozen(params.counterpartyId);
      return { success: true, data: { frozen } } satisfies ApiResponse<{ frozen: boolean }>;
    },
    {
      params: t.Object({ counterpartyId: t.String() }),
      detail: { tags: ['Risk Monitoring'], summary: 'Check if credit is frozen for a company' },
    },
  )

  // ─── Frozen Status (batch) ──────────────────────────────────────
  .post(
    '/frozen/batch',
    async ({ body }) => {
      const frozenIds = await getFrozenCounterpartyIds(body.counterpartyIds);
      return {
        success: true,
        data: { frozenCounterpartyIds: Array.from(frozenIds) },
      } satisfies ApiResponse<{ frozenCounterpartyIds: string[] }>;
    },
    {
      body: t.Object({ counterpartyIds: t.Array(t.String()) }),
      detail: { tags: ['Risk Monitoring'], summary: 'Batch check frozen status' },
    },
  )

  // ─── Overrides for Company ──────────────────────────────────────
  .get(
    '/overrides/:counterpartyId',
    async ({ params }) => {
      const overrides = await getOverridesForCompany(params.counterpartyId);
      return { success: true, data: overrides } satisfies ApiResponse<typeof overrides>;
    },
    {
      params: t.Object({ counterpartyId: t.String() }),
      detail: { tags: ['Risk Monitoring'], summary: 'Get overrides for a company' },
    },
  )

  // ─── Pending Overrides (for approval dashboard) ─────────────────
  .get(
    '/overrides',
    async ({ auth, set }) => {
      if (auth.role !== 'ADMIN' && auth.role !== 'CREDITMANAGER') {
        set.status = 403;
        return { success: false, data: null, message: 'Forbidden' } satisfies ApiResponse<null>;
      }
      const overrides = await getPendingOverrides(auth.tenantId);
      return { success: true, data: overrides } satisfies ApiResponse<typeof overrides>;
    },
    {
      detail: { tags: ['Risk Monitoring'], summary: 'Get all pending overrides' },
    },
  )

  // ─── Request Override ───────────────────────────────────────────
  .post(
    '/overrides',
    async ({ body, auth, set }) => {
      if (auth.role !== 'ADMIN' && auth.role !== 'CREDITMANAGER') {
        set.status = 403;
        return { success: false, data: null, message: 'Forbidden' } satisfies ApiResponse<null>;
      }
      const settings = await getRiskMonitoringSettings(auth.tenantId);
      const override = await createOverride(
        body.counterpartyId,
        auth.tenantId,
        auth.userId,
        body.reason,
        settings.overrideExpiryDays,
      );
      return { success: true, data: override } satisfies ApiResponse<typeof override>;
    },
    {
      body: t.Object({
        counterpartyId: t.String(),
        reason: t.String({ minLength: 1 }),
      }),
      detail: { tags: ['Risk Monitoring'], summary: 'Request a risk override' },
    },
  )

  // ─── Approve/Reject Override ────────────────────────────────────
  .post(
    '/overrides/:id/decide',
    async ({ params, body, auth, set }) => {
      if (auth.role !== 'ADMIN' && auth.role !== 'CREDITMANAGER') {
        set.status = 403;
        return { success: false, data: null, message: 'Forbidden' } satisfies ApiResponse<null>;
      }
      const result = await approveOrRejectOverride(params.id, auth.userId, body.decision, body.comment);
      if (!result) {
        set.status = 400;
        return { success: false, data: null, message: 'Override not found, already decided, or you already voted' } satisfies ApiResponse<null>;
      }
      return { success: true, data: result } satisfies ApiResponse<typeof result>;
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        decision: t.Union([t.Literal('APPROVED'), t.Literal('REJECTED')]),
        comment: t.Optional(t.String()),
      }),
      detail: { tags: ['Risk Monitoring'], summary: 'Approve or reject a risk override' },
    },
  )

  // ─── Settings ───────────────────────────────────────────────────
  .get(
    '/settings',
    async ({ auth, set }) => {
      if (auth.role !== 'ADMIN') {
        set.status = 403;
        return { success: false, data: null, message: 'Admin only' } satisfies ApiResponse<null>;
      }
      const settings = await getRiskMonitoringSettings(auth.tenantId);
      return { success: true, data: settings } satisfies ApiResponse<typeof settings>;
    },
    {
      detail: { tags: ['Risk Monitoring'], summary: 'Get risk monitoring settings' },
    },
  )

  .put(
    '/settings',
    async ({ body, auth, set }) => {
      if (auth.role !== 'ADMIN') {
        set.status = 403;
        return { success: false, data: null, message: 'Admin only' } satisfies ApiResponse<null>;
      }
      const settings = await updateRiskMonitoringSettings(auth.tenantId, body);
      return { success: true, data: settings } satisfies ApiResponse<typeof settings>;
    },
    {
      body: t.Object({
        enabled: t.Optional(t.Boolean()),
        checkIntervalHours: t.Optional(t.Number({ minimum: 1 })),
        openSanctionsEnabled: t.Optional(t.Boolean()),
        openSanctionsBaseUrl: t.Optional(t.String()),
        companiesHouseEnabled: t.Optional(t.Boolean()),
        companiesHouseApiKey: t.Optional(t.String()),
        seasearcherEnabled: t.Optional(t.Boolean()),
        autoEnforceOnHit: t.Optional(t.Boolean()),
        overrideExpiryDays: t.Optional(t.Number({ minimum: 1, maximum: 90 })),
        notifyPush: t.Optional(t.Boolean()),
        notifyEmail: t.Optional(t.Boolean()),
        notifyWhatsApp: t.Optional(t.Boolean()),
      }),
      detail: { tags: ['Risk Monitoring'], summary: 'Update risk monitoring settings' },
    },
  );
