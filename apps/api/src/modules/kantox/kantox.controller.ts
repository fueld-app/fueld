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

import { Elysia } from 'elysia';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db';
import { kantoxHedgeEntries, tenants } from '../../db/schema';
import type { ApiResponse } from '@fueld/types';
import { authGuard } from '../auth/auth.guard';
import {
  listHedgesForOrder,
  resolveKantoxSettings,
  makeClient,
} from './kantox.service';

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
    const hedges = await listHedgesForOrder(auth!.tenantId, params.id);
    // Position reads are best-effort — order page must render even if Kantox is down.
    let positions: unknown[] = [];
    try {
      positions = await makeClient(resolved).listPositions();
    } catch (err: any) {
      console.error(`[Kantox] position read failed for order ${params.id}: ${err?.message ?? err}`);
    }
    return { success: true, data: { enabled: true, hedges, positions } } as ApiResponse<unknown>;
  });