// ═══════════════════════════════════════════════════════════════════════
//  Banking Controller — Enable Banking integration endpoints
//  Role access: ADMIN (setup + connect + view), FINANCE (view + sync)
// ═══════════════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import { db } from '../../db';
import type { ApiResponse } from '@fueld/types';
import {
  saveEnableBankingCredentials,
  getEnableBankingCredentials,
  isEnableBankingConfigured,
  listAvailableBanks,
  startBankConnection,
  handleOAuthCallback,
  listBankConnections,
  deleteBankConnection,
  syncBankConnection,
  syncAllConnections,
  getCashOverview,
  getTransactions,
  // Per-user functions
  isUserEnableBankingConfigured,
  initiateEnableBankingSetup,
  completeEnableBankingSetup,
  quickSetupEnableBanking,
  sendEbLoginEmail,
  getEnableBankingSetupStatus,
  isControlPanelConfigured,
  listAvailableBanksForUser,
  startBankConnectionForUser,
  handleOAuthCallbackForUser,
  syncBankConnectionForUser,
  enrichTransactionDetails,
} from './banking.service';
import { sql } from 'drizzle-orm';
// ─── OAuth2 State Management (database-backed, survives restarts) ───
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

async function saveOAuthState(state: string, tenantId: string, aspspName: string, country: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO bank_connections (tenant_id, aspsp_name, aspsp_country, session_id, session_data, status)
    VALUES (${tenantId}, ${aspspName}, ${country}, NULL, ${JSON.stringify({ state, createdAt: Date.now() })}::jsonb, 'pending')
  `);
}

async function consumeOAuthState(state: string, tenantId: string): Promise<{ aspspName: string; country: string } | null> {
  console.log(`[Banking] consumeOAuthState: state=${state}, tenant=${tenantId}, cutoff=${Date.now() - OAUTH_STATE_TTL_MS}`);
  const result = await db.execute(sql`
    DELETE FROM bank_connections
    WHERE status = 'pending'
      AND tenant_id = ${tenantId}
      AND session_data->>'state' = ${state}
      AND (session_data->>'createdAt')::bigint > ${Date.now() - OAUTH_STATE_TTL_MS}
    RETURNING aspsp_name, aspsp_country
  `);
  const rows = result as any[];
  console.log(`[Banking] consumeOAuthState: found ${rows.length} matching rows`);
  const row = rows[0];
  if (!row) return null;
  return { aspspName: row.aspsp_name, country: row.aspsp_country };
}

// ─── Rate Limiting (per-tenant, in-memory) ────────────────────────
// Prevents brute-force on the /complete endpoint. Max 10 calls/min/tenant.
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function checkRateLimit(tenantId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(tenantId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(tenantId, { count: 1, windowStart: now });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

/** Get the CORS origin for secure postMessage targeting. */
function getAllowedOrigin(): string {
  return process.env['CORS_ORIGIN'] ?? 'http://localhost:4200';
}

function requireAdmin(auth: { role: string } | undefined) {
  if (!auth || auth.role !== 'ADMIN') {
    return { success: false, data: null, message: 'Admin access required' };
  }
  return null;
}

function requireFinanceOrAdmin(auth: { role: string } | undefined) {
  if (!auth || !['ADMIN', 'FINANCE'].includes(auth.role)) {
    return { success: false, data: null, message: 'Finance or Admin access required' };
  }
  return null;
}

export const bankingController = new Elysia({ prefix: '/banking' })
  .use(authGuard)

  // ─── Status (ADMIN, FINANCE) ───────────────────────────────────
  .get('/status', async ({ auth }) => {
    const denied = requireFinanceOrAdmin(auth);
    if (denied) return denied satisfies ApiResponse<null>;
    try {
      const userConfigured = await isUserEnableBankingConfigured(auth!.userId);
      const tenantConfigured = await isEnableBankingConfigured(auth!.tenantId);
      const cpConfigured = await isControlPanelConfigured(auth!.tenantId);
      const connections = await listBankConnections(auth!.tenantId);
      const setupStatus = await getEnableBankingSetupStatus(auth!.userId);
      return { success: true, data: { configured: userConfigured || tenantConfigured, userConfigured, tenantConfigured, cpConfigured, connections, setupStatus } } satisfies ApiResponse<any>;
    } catch (e: any) {
      return { success: false, data: null, message: e.message };
    }
  }, {
    detail: { tags: ['Banking'], summary: 'Get Enable Banking configuration status (Admin, Finance)' },
  })

  // ─── Save credentials (ADMIN) ────────────────────────────────────
  .post('/credentials', async ({ auth, body }) => {
    const denied = requireAdmin(auth);
    if (denied) return denied satisfies ApiResponse<null>;
    try {
      await saveEnableBankingCredentials(
        auth!.tenantId,
        body.appId,
        body.privateKey,
        body.environment ?? 'production',
        body.redirectUrl,
        auth!.sub,
      );
      return { success: true, data: { saved: true } } satisfies ApiResponse<any>;
    } catch (e: any) {
      return { success: false, data: null, message: e.message };
    }
  }, {
    body: t.Object({
      appId: t.String(),
      privateKey: t.String(),
      environment: t.Optional(t.String()),
      redirectUrl: t.String(),
    }),
    detail: { tags: ['Banking'], summary: 'Save Enable Banking credentials (Admin only)' },
  })

  // ─── List available banks (ADMIN, FINANCE) ─────────────────────
  .get('/aspsps', async ({ auth, query }) => {
    const denied = requireFinanceOrAdmin(auth);
    if (denied) return denied satisfies ApiResponse<null>;
    try {
      const banks = await listAvailableBanksForUser(auth!.userId, auth!.tenantId, query?.country ?? 'FR');
      return { success: true, data: banks } satisfies ApiResponse<any>;
    } catch (e: any) {
      return { success: false, data: null, message: e.message };
    }
  }, {
    query: t.Optional(t.Object({ country: t.Optional(t.String()) })),
    detail: { tags: ['Banking'], summary: 'List available banks for a country (Admin, Finance)' },
  })

  // ─── Start OAuth2 flow (ADMIN, FINANCE) ────────────────────────
  .post('/connect', async ({ auth, body }) => {
    const denied = requireFinanceOrAdmin(auth);
    if (denied) return denied satisfies ApiResponse<null>;
    try {
      const country = body.country ?? 'FR';
      const result = await startBankConnectionForUser(auth!.userId, auth!.tenantId, body.aspspName, country);
      // Extract the state from the authorization URL (Enable Banking generates it)
      // and save THAT in the DB so it matches what comes back in the callback.
      const url = new URL(result.authorizationUrl);
      const state = url.searchParams.get('state') ?? crypto.randomUUID();
      if (!url.searchParams.has('state')) url.searchParams.set('state', state);
      await saveOAuthState(state, auth!.tenantId, body.aspspName, country);
      console.log(`[Banking] OAuth2 connect initiated: user=${auth!.userId}, bank=${body.aspspName}, country=${country}, state=${state}`);
      return { success: true, data: { authorizationUrl: url.toString(), state } } satisfies ApiResponse<any>;
    } catch (e: any) {
      return { success: false, data: null, message: e.message };
    }
  }, {
    body: t.Object({
      aspspName: t.String(),
      country: t.Optional(t.String()),
    }),
    detail: { tags: ['Banking'], summary: 'Start OAuth2 consent flow for a bank (Admin, Finance)' },
  })

  // ─── Complete OAuth2 (ADMIN, FINANCE — called by frontend after callback) ──
  .post('/complete', async ({ auth, body }) => {
    const denied = requireFinanceOrAdmin(auth);
    if (denied) return denied satisfies ApiResponse<null>;
    try {
      // Rate limit: max 10 completion attempts per minute per tenant
      if (!checkRateLimit(auth!.tenantId)) {
        console.warn(`[Banking] Rate limit exceeded for /complete: tenant=${auth!.tenantId}`);
        return { success: false, data: null, message: 'Too many attempts. Please wait a minute and try again.' } satisfies ApiResponse<null>;
      }
      // Validate state from database (survives process restarts)
      const pending = await consumeOAuthState(body.state, auth!.tenantId);
      if (!pending) {
        return { success: false, data: null, message: 'Invalid or expired state. Please try connecting again.' } satisfies ApiResponse<null>;
      }
      // Use the aspspName/country from the stored state (not from the request body)
      // to prevent tampering
      const result = await handleOAuthCallbackForUser(auth!.userId, auth!.tenantId, body.code, pending.aspspName, pending.country);
      console.log(`[Banking] OAuth2 complete success: user=${auth!.userId}, bank=${pending.aspspName}, session=${result.sessionId}, accounts=${result.accounts.length}`);
      // Auto-sync after connecting — delay 5s to let the session provision on EB's side
      const conns = await listBankConnections(auth!.tenantId);
      const newConn = conns.find((c: any) => c.session_id === result.sessionId);
      if (newConn) {
        // Delay to allow session to fully provision
        await new Promise(r => setTimeout(r, 5000));
        try {
          const syncResult = await syncBankConnectionForUser(auth!.tenantId, (newConn as any).id);
          console.log(`[Banking] Auto-sync after connect: ${syncResult.accounts} accounts, ${syncResult.balances} balances, ${syncResult.transactions} transactions`);
        } catch (syncErr: any) {
          console.error(`[Banking] Auto-sync after connect failed (will retry on next manual sync):`, syncErr.message);
          // Don't fail the connection — the session is valid, sync can be retried
        }
      }
      return { success: true, data: result } satisfies ApiResponse<any>;
    } catch (e: any) {
      console.error(`[Banking] OAuth2 complete FAILED: user=${auth!.userId}, error=${e.message}`);
      return { success: false, data: null, message: e.message };
    }
  }, {
    body: t.Object({
      code: t.String(),
      state: t.String(),
      aspspName: t.Optional(t.String()),
      country: t.Optional(t.String()),
    }),
    detail: { tags: ['Banking'], summary: 'Complete OAuth2 flow and create bank connection (Admin, Finance)' },
  })

  // ─── Delete connection (ADMIN, FINANCE) ─────────────────────────
  .delete('/connections/:id', async ({ auth, params }) => {
    const denied = requireFinanceOrAdmin(auth);
    if (denied) return denied satisfies ApiResponse<null>;
    try {
      await deleteBankConnection(auth!.tenantId, params.id);
      console.log(`[Banking] Connection deleted: tenant=${auth!.tenantId}, connection=${params.id}`);
      return { success: true, data: { deleted: true } } satisfies ApiResponse<any>;
    } catch (e: any) {
      return { success: false, data: null, message: e.message };
    }
  }, {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Banking'], summary: 'Delete a bank connection (Admin, Finance)' },
  })

  // ─── Cash overview (ADMIN, FINANCE) ──────────────────────────────
  .get('/overview', async ({ auth }) => {
    const denied = requireFinanceOrAdmin(auth);
    if (denied) return denied satisfies ApiResponse<null>;
    try {
      const overview = await getCashOverview(auth!.tenantId);
      return { success: true, data: overview } satisfies ApiResponse<any>;
    } catch (e: any) {
      return { success: false, data: null, message: e.message };
    }
  }, {
    detail: { tags: ['Banking'], summary: 'Cash on hand overview — per-currency totals + per-bank breakdown (Admin, Finance)' },
  })

  // ─── Transactions (ADMIN, FINANCE) ───────────────────────────────
  .get('/transactions', async ({ auth, query }) => {
    const denied = requireFinanceOrAdmin(auth);
    if (denied) return denied satisfies ApiResponse<null>;
    try {
      const txns = await getTransactions(auth!.tenantId, {
        accountId: query.accountId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
      });
      return { success: true, data: txns } satisfies ApiResponse<any>;
    } catch (e: any) {
      return { success: false, data: null, message: e.message };
    }
  }, {
    query: t.Optional(t.Object({
      accountId: t.Optional(t.String()),
      dateFrom: t.Optional(t.String()),
      dateTo: t.Optional(t.String()),
      limit: t.Optional(t.String()),
      offset: t.Optional(t.String()),
    })),
    detail: { tags: ['Banking'], summary: 'List bank transactions with optional filters (Admin, Finance)' },
  })

  // ─── Enrich transaction details on-demand (ADMIN, FINANCE) ──
  .post('/transactions/:txnId/enrich', async ({ auth, params }) => {
    const denied = requireFinanceOrAdmin(auth);
    if (denied) return denied satisfies ApiResponse<null>;
    try {
      const result = await enrichTransactionDetails(auth!.tenantId, params.txnId);
      return { success: true, data: result } satisfies ApiResponse<any>;
    } catch (e: any) {
      return { success: false, data: null, message: e.message };
    }
  }, {
    params: t.Object({ txnId: t.String() }),
    detail: { tags: ['Banking'], summary: 'Fetch enriched transaction details from Enable Banking (Admin, Finance)' },
  })

  // ─── Sync (ADMIN, FINANCE) ───────────────────────────────────────
  .post('/sync', async ({ auth, body }) => {
    const denied = requireFinanceOrAdmin(auth);
    if (denied) return denied satisfies ApiResponse<null>;
    try {
      if (body?.connectionId) {
        const result = await syncBankConnectionForUser(auth!.tenantId, body.connectionId);
        console.log(`[Banking] Manual sync: tenant=${auth!.tenantId}, connection=${body.connectionId}, accounts=${result.accounts}, balances=${result.balances}, txns=${result.transactions}`);
        return { success: true, data: result } satisfies ApiResponse<any>;
      } else {
        const result = await syncAllConnections(auth!.tenantId);
        return { success: true, data: result } satisfies ApiResponse<any>;
      }
    } catch (e: any) {
      return { success: false, data: null, message: e.message };
    }
  }, {
    body: t.Optional(t.Object({
      connectionId: t.Optional(t.String()),
    })),
    detail: { tags: ['Banking'], summary: 'Trigger sync of bank balances + transactions (Admin, Finance)' },
  })

  // ─── Self-Service Onboarding: Initiate email-link sign-in (ADMIN, FINANCE) ──
  .post('/enablebanking/initiate', async ({ auth, body }) => {
    const denied = requireFinanceOrAdmin(auth);
    if (denied) return denied satisfies ApiResponse<null>;
    try {
      const callbackUrl = `${getAllowedOrigin()}/api/banking/enablebanking/auth-callback`;
      await initiateEnableBankingSetup(auth!.userId, auth!.tenantId, body.email, callbackUrl);
      console.log(`[Banking] Enable Banking setup initiated: user=${auth!.userId}, email=${body.email}`);
      return { success: true, data: { sent: true } } satisfies ApiResponse<any>;
    } catch (e: any) {
      console.error(`[Banking] Setup initiate failed: ${e.message}`);
      return { success: false, data: null, message: e.message };
    }
  }, {
    body: t.Object({ email: t.String() }),
    detail: { tags: ['Banking'], summary: 'Initiate Enable Banking self-service setup via email link (Admin, Finance)' },
  })

  // ─── Self-Service Onboarding: Get setup status (ADMIN, FINANCE) ──
  .get('/enablebanking/status', async ({ auth }) => {
    const denied = requireFinanceOrAdmin(auth);
    if (denied) return denied satisfies ApiResponse<null>;
    try {
      const status = await getEnableBankingSetupStatus(auth!.userId);
      return { success: true, data: status } satisfies ApiResponse<any>;
    } catch (e: any) {
      return { success: false, data: null, message: e.message };
    }
  }, {
    detail: { tags: ['Banking'], summary: 'Get Enable Banking setup status for polling (Admin, Finance)' },
  })

  // ─── Self-Service Onboarding: Complete setup (ADMIN, FINANCE) ──
  .post('/enablebanking/complete', async ({ auth, body }) => {
    const denied = requireFinanceOrAdmin(auth);
    if (denied) return denied satisfies ApiResponse<null>;
    try {
      const redirectUrl = `${getAllowedOrigin()}/api/banking/callback`;
      const result = await completeEnableBankingSetup(auth!.userId, auth!.tenantId, body.email, body.oobCode ?? null, redirectUrl);
      console.log(`[Banking] Enable Banking setup completed: user=${auth!.userId}, appId=${result.appId}`);
      return { success: true, data: result } satisfies ApiResponse<any>;
    } catch (e: any) {
      console.error(`[Banking] Setup complete failed: ${e.message}`);
      await db.execute(sql`UPDATE enable_banking_auth_pending SET status = 'error', error = ${e.message}, updated_at = NOW() WHERE user_id = ${auth!.userId} AND status = 'pending'`);
      return { success: false, data: null, message: e.message };
    }
  }, {
    body: t.Object({ oobCode: t.Optional(t.String()), email: t.String() }),
    detail: { tags: ['Banking'], summary: 'Complete Enable Banking setup with oobCode from email link (Admin, Finance)' },
  })

  // ─── Self-Service Onboarding: Quick setup (ADMIN, FINANCE) ──
  // Registers an app for the user using existing Control Panel tokens — no email needed.
  .post('/enablebanking/quick-setup', async ({ auth, body }) => {
    const denied = requireFinanceOrAdmin(auth);
    if (denied) return denied satisfies ApiResponse<null>;
    try {
      const redirectUrl = `${getAllowedOrigin()}/api/banking/callback`;
      const result = await quickSetupEnableBanking(auth!.userId, auth!.tenantId, body.email, redirectUrl);
      console.log(`[Banking] Quick setup completed: user=${auth!.userId}, appId=${result.appId}`);
      return { success: true, data: result } satisfies ApiResponse<any>;
    } catch (e: any) {
      console.error(`[Banking] Quick setup failed: ${e.message}`);
      return { success: false, data: null, message: e.message };
    }
  }, {
    body: t.Object({ email: t.String() }),
    detail: { tags: ['Banking'], summary: 'Quick setup — register app using existing Control Panel tokens (Admin, Finance)' },
  })

  // ─── Send EB Control Panel login email (ADMIN, FINANCE) ──
  // Sends a sign-in email so the user can log in to the EB Control Panel
  // to activate their app and link bank accounts.
  .post('/enablebanking/send-login-email', async ({ auth, body }) => {
    const denied = requireFinanceOrAdmin(auth);
    if (denied) return denied satisfies ApiResponse<null>;
    try {
      await sendEbLoginEmail(body.email);
      console.log(`[Banking] EB login email sent: user=${auth!.userId}, email=${body.email}`);
      return { success: true, data: { sent: true } } satisfies ApiResponse<any>;
    } catch (e: any) {
      console.error(`[Banking] EB login email failed: ${e.message}`);
      return { success: false, data: null, message: e.message };
    }
  }, {
    body: t.Object({ email: t.String() }),
    detail: { tags: ['Banking'], summary: 'Send Enable Banking Control Panel login email (Admin, Finance)' },
  })

  // ─── Self-Service Onboarding: Check if CP tokens exist (ADMIN, FINANCE) ──
  .get('/enablebanking/cp-status', async ({ auth }) => {
    const denied = requireFinanceOrAdmin(auth);
    if (denied) return denied satisfies ApiResponse<null>;
    try {
      const cpConfigured = await isControlPanelConfigured(auth!.tenantId);
      return { success: true, data: { cpConfigured } } satisfies ApiResponse<any>;
    } catch (e: any) {
      return { success: false, data: null, message: e.message };
    }
  }, {
    detail: { tags: ['Banking'], summary: 'Check if Control Panel tokens are configured (Admin, Finance)' },
  });

// ─── OAuth2 callback (public — no auth, receives redirect from bank) ──
// Must be OUTSIDE the authGuard-protected bankingController.
export const bankingCallbackController = new Elysia({ prefix: '/banking' })
  .get('/callback', async ({ query, set }) => {
    try {
      const code = query.code as string;
      const state = query.state as string;
      const error = query.error as string;

      if (error) {
        set.status = 400;
        return { success: false, data: null, message: `Bank authorization failed: ${error}` };
      }
      if (!code) {
        set.status = 400;
        return { success: false, data: null, message: 'No authorization code received' };
      }

      const allowedOrigin = getAllowedOrigin();
      set.headers['Content-Type'] = 'text/html';
      return `<html><body><script>
        window.opener?.postMessage({ type: 'enablebanking-callback', code: ${JSON.stringify(code)}, state: ${JSON.stringify(state)} }, ${JSON.stringify(allowedOrigin)});
        window.close();
      </script><p>Bank authorization complete. You can close this window.</p></body></html>`;
    } catch (e: any) {
      set.status = 500;
      return { success: false, data: null, message: e.message };
    }
  }, {
    query: t.Optional(t.Object({
      code: t.Optional(t.String()),
      state: t.Optional(t.String()),
      error: t.Optional(t.String()),
    })),
    detail: { tags: ['Banking'], summary: 'OAuth2 callback from Enable Banking (public endpoint)' },
  })

  // ─── Enable Banking email-link auth callback (public — receives oobCode from email) ──
  .get('/enablebanking/auth-callback', async ({ query, set }) => {
    try {
      const oobCode = query.oobCode as string;
      const email = query.email as string;

      if (!oobCode) {
        set.status = 400;
        return { success: false, data: null, message: 'No oobCode received' };
      }

      // Redirect to frontend with oobCode and email
      // The frontend will call POST /api/banking/enablebanking/complete with auth
      const frontendUrl = getAllowedOrigin();
      set.headers['Location'] = `${frontendUrl}/banking-setup?oobCode=${encodeURIComponent(oobCode)}&email=${encodeURIComponent(email ?? '')}`;
      set.status = 302;
      return '';
    } catch (e: any) {
      set.status = 500;
      return { success: false, data: null, message: e.message };
    }
  }, {
    query: t.Optional(t.Object({
      oobCode: t.Optional(t.String()),
      email: t.Optional(t.String()),
    })),
    detail: { tags: ['Banking'], summary: 'Enable Banking email-link auth callback (public — redirects to frontend)' },
  });