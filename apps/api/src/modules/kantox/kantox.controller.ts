// ═══════════════════════════════════════════════════════════════════════
//  Kantox Controller (Dynamic Hedging)
//
//  GET  /kantox/status             (ADMIN, FINANCE) — config/health snapshot
//  POST /kantox/test-connection    (ADMIN)          — preprod/sandbox roundtrip
//  GET  /kantox/hedges             (ADMIN, FINANCE) — recent hedge rows
//  GET  /orders/:id/hedge     (order-scoped; ADMIN, FINANCE, TEAMLEAD)
//
//  Feature-gated on reads: returns empty/disabled unless the tenant's
//  kantoxSettings.enabled is true AND credentials resolve (read-side gate,
//  panel finding K-Missing). Sandbox credentials live ONLY on the staging
//  tenant; production credentials only on Riviera Marine (Patrick, 17/09).
// ═══════════════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db';
import { kantoxHedgeEntries, tenants } from '../../db/schema';
import type { ApiResponse } from '@fueld/types';
import { authGuard } from '../auth/auth.guard';
import {
  getKantoxSettingsView,
  listHedgesForOrder,
  resolveKantoxSettings,
  makeClient,
  updateKantoxSettings,
  type KantoxSettingsView,
} from './kantox.service';
import { resolveOrderId } from '../orders/orders.service';

function requireRoles(auth: { role: string } | undefined, roles: string[]) {
  if (!auth || !roles.includes(auth.role)) {
    return { success: false, data: null, message: `Requires one of: ${roles.join(', ')}` };
  }
  return null;
}

async function tenantSettingsFor(tenantId: string): Promise<any | null> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return (tenant?.settings as any) ?? null;
}

export const kantoxController = new Elysia({ prefix: '/kantox' })
  .use(authGuard)

  // Config + health snapshot for the admin settings UI (non-secret fields only)
  .get('/status', async ({ auth }) => {
    const denied = requireRoles(auth, ['ADMIN', 'FINANCE']);
    if (denied) return denied satisfies ApiResponse<null>;
    const settings = await tenantSettingsFor(auth!.tenantId);
    const cfg = settings?.kantoxSettings ?? {};
    const resolved = await resolveKantoxSettings(auth!.tenantId, settings);
    return {
      success: true,
      data: {
        enabled: !!resolved,
        configured: !!(cfg.apiUser && cfg.companyRef && resolved),
        apiBaseUrl: cfg.apiBaseUrl ?? null,   // sandbox vs prod visible for safety
        apiUser: cfg.apiUser ?? null,          // non-secret only; password never returned
        companyRef: cfg.companyRef ?? null,
        marginHedgePercent: cfg.marginHedgePercent ?? null,
        valueDateRounding: cfg.valueDateRounding ?? null,
        amountBasis: cfg.amountBasis ?? null,
      },
    } satisfies ApiResponse<unknown>;
  })

  // Connectivity check against the configured base URL (sandbox on staging,
  // prod on Riviera). Admin-only: costs one login roundtrip.
  .post('/test-connection', async ({ auth }) => {
    const denied = requireRoles(auth, ['ADMIN']);
    if (denied) return denied satisfies ApiResponse<null>;
    const settings = await tenantSettingsFor(auth!.tenantId);
    const resolved = await resolveKantoxSettings(auth!.tenantId, settings);
    if (!resolved) {
      return { success: false, data: null, message: 'Kantox not enabled/configured for this tenant' } as ApiResponse<null>;
    }
    try {
      const result = await makeClient(resolved).testConnection();
      return { success: true, data: result } as ApiResponse<{ ok: boolean; companyRef: string }>;
    } catch (err: any) {
      return {
        success: false,
        data: null,
        message: `Kantox connection failed: ${err?.message ?? err}`,
      } as ApiResponse<null>;
    }
  })

  // Recent hedge rows for the tenant
  .get('/hedges', async ({ auth }) => {
    const denied = requireRoles(auth, ['ADMIN', 'FINANCE']);
    if (denied) return denied satisfies ApiResponse<null>;
    const settings = await tenantSettingsFor(auth!.tenantId);
    const resolved = await resolveKantoxSettings(auth!.tenantId, settings);
    if (!resolved) return { success: true, data: [] } as ApiResponse<unknown[]>; // feature off → empty
    const rows = await db
      .select()
      .from(kantoxHedgeEntries)
      .where(eq(kantoxHedgeEntries.tenantId, auth!.tenantId))
      .orderBy(desc(kantoxHedgeEntries.createdAt))
      .limit(100);
    return { success: true, data: rows } as ApiResponse<unknown>;
  })

  // Non-secret config for the admin settings form (password never returned)
  .get('/settings', async ({ auth }) => {
    const denied = requireRoles(auth, ['ADMIN']);
    if (denied) return denied satisfies ApiResponse<null>;
    const data = await getKantoxSettingsView(auth!.tenantId);
    return { success: true, data } satisfies ApiResponse<KantoxSettingsView>;
  }, {
    detail: { tags: ['Kantox'], summary: 'Get Kantox Dynamic Hedging settings' },
  })

  // Merge-write of the configurable fields. Deliberately excludes the API
  // password — that lives in the encrypted credential vault (Admin →
  // Integrations) so it is never round-tripped through this form.
  .put('/settings', async ({ auth, body }) => {
    const denied = requireRoles(auth, ['ADMIN']);
    if (denied) return denied satisfies ApiResponse<null>;
    try {
      const data = await updateKantoxSettings(auth!.tenantId, body);
      return { success: true, data } satisfies ApiResponse<KantoxSettingsView>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save Kantox settings';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      enabled: t.Optional(t.Boolean()),
      apiBaseUrl: t.Optional(t.String()),
      apiUser: t.Optional(t.String()),
      companyRef: t.Optional(t.String()),
      hedgeCurrency: t.Optional(t.String()),
      hedgeCounterCurrency: t.Optional(t.String()),
      marginHedgePercent: t.Optional(t.Number({ minimum: 0, maximum: 100 })),
      paymentDateBufferDays: t.Optional(t.Number({ minimum: 0, maximum: 365 })),
      dailyHedgeLimitUsd: t.Optional(t.Number({ minimum: 0 })),
      valueDateRounding: t.Optional(t.Union([
        t.Literal('NONE'),
        t.Literal('WEEKLY_MONDAY'),
        t.Literal('TWICE_MONTHLY'),
        t.Literal('MONTHLY'),
      ])),
      hedgeCodPrepay: t.Optional(t.Boolean()),
      amountBasis: t.Optional(t.Union([
        t.Literal('MINIMUM'),
        t.Literal('EXACT_AT_INVOICE'),
      ])),
    }),
    detail: { tags: ['Kantox'], summary: 'Update Kantox Dynamic Hedging settings' },
  });

// Order-scoped read — mounted under /orders (matches plan §7)
export const kantoxOrderHedgeController = new Elysia()
  .use(authGuard)
  .get('/orders/:id/hedge', async ({ auth, params }) => {
    const denied = requireRoles(auth, ['ADMIN', 'FINANCE', 'TEAMLEAD']);
    if (denied) return denied satisfies ApiResponse<null>;
    const settings = await tenantSettingsFor(auth!.tenantId);
    const resolved = await resolveKantoxSettings(auth!.tenantId, settings);
    if (!resolved) return { success: true, data: { enabled: false, hedges: [], positions: [] } } as ApiResponse<unknown>;

    // The route param is an order number on the detail page (/trading/orders/
    // 20260911-000522), not a UUID. Every sibling endpoint resolves it first —
    // passing the raw value here hits a uuid column and 500s.
    const orderId = await resolveOrderId(params.id);
    if (!orderId) return { success: false, data: null, message: 'Order not found' } as ApiResponse<null>;

    const hedges = await listHedgesForOrder(auth!.tenantId, orderId);
    // Position reads are best-effort — order page must render even if Kantox is down.
    let positions: unknown[] = [];
    try {
      positions = await makeClient(resolved).listPositions();
    } catch (err: any) {
      console.error(`[Kantox] position read failed for order ${params.id}: ${err?.message ?? err}`);
    }
    return { success: true, data: { enabled: true, hedges, positions } } as ApiResponse<unknown>;
  });