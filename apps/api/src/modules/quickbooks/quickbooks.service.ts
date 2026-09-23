// ═══════════════════════════════════════════════════════════════════════
//  QuickBooks Integration Service
//
//  Supports both QuickBooks Online (OAuth2) and QuickBooks Desktop
//  (Web Connector credentials). Stores tokens/credentials encrypted
//  using the same AES-256-GCM scheme as LLI credentials.
// ═══════════════════════════════════════════════════════════════════════

import { and, desc, eq, isNull, ne, notInArray, or } from 'drizzle-orm';
import { db } from '../../db';
import { integrationCredentials, tenants, users, orders, invoices, orderItems, counterparties, type TenantSettings } from '../../db/schema';
import { customerFacingItems } from '../documents/customer-facing-items';
import { encrypt, decrypt } from '../../lib/crypto';
import { randomBytes } from 'crypto';
import type { IntegrationStatusDto } from '@fueld/types';
import { sendNotificationEmail } from '../../lib/email';

// ─── Constants ───────────────────────────────────────────────────────

const PROVIDER = 'QUICKBOOKS';

// Intuit OAuth2 endpoints
const INTUIT_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const INTUIT_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const QB_API_BASE_PROD = 'https://quickbooks.api.intuit.com';
const QB_API_BASE_SANDBOX = 'https://sandbox-quickbooks.api.intuit.com';

// OAuth2 scopes
const SCOPES = 'com.intuit.quickbooks.accounting';

/**
 * Extract Intuit's `intuit_tid` correlation id from a failed response —
 * included in every error message/log so Intuit support can trace the
 * exact request when troubleshooting.
 */
function intuitTid(res: Response): string {
  return res.headers.get('intuit_tid') ?? 'not-present';
}

/**
 * Relay mode — one shared OAuth callback URL for ALL tenants.
 *
 * Intuit only allows whitelisting redirect URIs manually in the developer
 * dashboard (no API/CLI), and caps them (~25 per app), so per-tenant URIs
 * don't scale. Instead, a single relay URL is whitelisted in the Intuit app
 * and the tenant's origin is encoded in the OAuth `state` parameter:
 *
 *   state = `${base64url(tenantOrigin)}.${randomHex}`
 *
 * The relay endpoint (mounted on every instance) validates the origin
 * against an allowlist and 302-forwards the Intuit response to that
 * tenant's normal callback. Adding a new tenant then requires ZERO
 * changes in the Intuit dashboard.
 *
 * Set QB_OAUTH_RELAY_ORIGIN (e.g. https://oauth.fueld.app) on every VPS
 * to enable; the relay URL is then `<QB_OAUTH_RELAY_ORIGIN>/api/admin/
 * settings/integrations/quickbooks/relay`.
 */
const QB_RELAY_PATH = '/api/admin/settings/integrations/quickbooks/relay';

function qbRelayOrigin(): string {
  return (process.env['QB_OAUTH_RELAY_ORIGIN'] ?? '').replace(/\/$/, '');
}

function encodeStateOrigin(origin: string): string {
  return Buffer.from(origin).toString('base64url');
}

export function decodeStateOrigin(state: string): string | null {
  try {
    const [encoded] = state.split('.');
    const origin = Buffer.from(encoded, 'base64url').toString('utf8');
    // Allowlist: only fueld.app subdomains over HTTPS — prevents abuse of
    // the relay as an open redirector while allowing any future tenant.
    if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.fueld\.app$/.test(origin)) return null;
    return origin;
  } catch {
    return null;
  }
}

// ─── Config helpers ──────────────────────────────────────────────────

function getQBConfig() {
  const redirectUri =
    process.env['QB_REDIRECT_URI'] ??
    deriveRedirectUri();
  const environment = (process.env['QB_ENVIRONMENT'] ?? 'production') as 'sandbox' | 'production';
  const frontendUrl = process.env['CORS_ORIGIN'] ?? 'http://localhost:4200';

  return { redirectUri, environment, frontendUrl };
}

/**
 * Derive the OAuth redirect URI from the public origin when QB_REDIRECT_URI
 * is not set. The API is publicly served under the /api prefix, so the
 * Intuit-registered callback is `<origin>/api/admin/settings/.../callback`.
 */
function deriveRedirectUri(): string {
  const origin = process.env['CORS_ORIGIN'] ?? '';
  if (!origin) return 'http://localhost:3000/admin/settings/integrations/quickbooks/callback';
  return `${origin}/api/admin/settings/integrations/quickbooks/callback`;
}

/**
 * Resolve the Intuit app credentials (Client ID + Secret) for a tenant.
 * Server env vars (QB_CLIENT_ID / QB_CLIENT_SECRET) take precedence;
 * when they are absent, per-tenant credentials saved from the admin UI
 * (integration_credentials, encrypted) are used. This lets each tenant
 * connect their own QuickBooks company without any server-side changes.
 */
async function getQBAppCredentials(tenantId: string): Promise<{
  clientId: string;
  clientSecret: string;
  source: 'env' | 'tenant' | 'none';
}> {
  const envClientId = process.env['QB_CLIENT_ID'] ?? '';
  const envClientSecret = process.env['QB_CLIENT_SECRET'] ?? '';
  if (envClientId && envClientSecret) {
    return { clientId: envClientId, clientSecret: envClientSecret, source: 'env' };
  }

  const [storedId, storedSecret] = await Promise.all([
    getCredential(tenantId, 'app_client_id'),
    getCredential(tenantId, 'app_client_secret'),
  ]);
  if (storedId && storedSecret) {
    return { clientId: storedId, clientSecret: storedSecret, source: 'tenant' };
  }

  return { clientId: '', clientSecret: '', source: 'none' };
}

async function isQBAppConfigured(tenantId: string): Promise<boolean> {
  const { source } = await getQBAppCredentials(tenantId);
  return source !== 'none';
}

/**
 * Resolve the QBO environment (production vs sandbox).
 * Env var wins; otherwise the per-tenant saved value; else production.
 */
async function getEnvironment(tenantId: string): Promise<'sandbox' | 'production'> {
  const envVal = process.env['QB_ENVIRONMENT'];
  if (envVal === 'sandbox' || envVal === 'production') return envVal;
  const stored = await getCredential(tenantId, 'app_environment');
  return stored === 'sandbox' ? 'sandbox' : 'production';
}

function apiBaseFor(environment: 'sandbox' | 'production'): string {
  return environment === 'production' ? QB_API_BASE_PROD : QB_API_BASE_SANDBOX;
}

/** Get the single tenant id. */
async function getTenantId(): Promise<string> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');
  return tenant.id;
}

// ─── OAuth State Management ─────────────────────────────────────────

// In-memory map of state → { userId, nonce, createdAt }
// Expires after 10 minutes
const pendingStates = new Map<string, { userId: string; nonce: string; createdAt: number }>();

function cleanExpiredStates() {
  const now = Date.now();
  for (const [key, val] of pendingStates) {
    if (now - val.createdAt > 10 * 60 * 1000) pendingStates.delete(key);
  }
}

// ─── Credential Storage (reuses integrationCredentials table) ───────

async function upsertCredential(tenantId: string, key: string, value: string, userId: string) {
  const enc = encrypt(value);
  const now = new Date();
  // updatedBy is a UUID column — empty string is not valid, convert to null
  const updatedBy = userId || null;

  const existing = await db
    .select({ id: integrationCredentials.id })
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, PROVIDER),
        eq(integrationCredentials.key, key),
      ),
    )
    .limit(1);

  if (existing.length) {
    await db
      .update(integrationCredentials)
      .set({
        encryptedValue: enc.encrypted,
        iv: enc.iv,
        authTag: enc.authTag,
        updatedBy,
        updatedAt: now,
      })
      .where(eq(integrationCredentials.id, existing[0].id));
  } else {
    await db.insert(integrationCredentials).values({
      tenantId,
      provider: PROVIDER,
      key,
      encryptedValue: enc.encrypted,
      iv: enc.iv,
      authTag: enc.authTag,
      updatedBy: updatedBy as string | null,
    });
  }
}

async function getCredential(tenantId: string, key: string): Promise<string | null> {
  const row = await db
    .select({
      encryptedValue: integrationCredentials.encryptedValue,
      iv: integrationCredentials.iv,
      authTag: integrationCredentials.authTag,
    })
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, PROVIDER),
        eq(integrationCredentials.key, key),
      ),
    )
    .limit(1);

  if (!row.length) return null;
  return decrypt(row[0].encryptedValue, row[0].iv, row[0].authTag);
}

async function deleteAllCredentials(tenantId: string) {
  await db
    .delete(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, PROVIDER),
      ),
    );
}

// ═══════════════════════════════════════════════════════════════════════
//  QuickBooks Online — OAuth2 Flow
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate the Intuit OAuth2 authorization URL.
 * Returns the URL that the admin should be redirected to.
 */
export async function generateAuthUrl(userId: string): Promise<string> {
  const tenantId = await getTenantId();
  if (!(await isQBAppConfigured(tenantId))) {
    throw new Error(
      'QuickBooks app not configured. Save the Intuit app Client ID and Secret below, or set QB_CLIENT_ID and QB_CLIENT_SECRET on the server.',
    );
  }

  cleanExpiredStates();

  const relayOrigin = qbRelayOrigin();
  const { redirectUri: directRedirectUri, frontendUrl } = getQBConfig();
  const { clientId: resolvedClientId } = await getQBAppCredentials(tenantId);
  const nonce = randomBytes(16).toString('hex');
  const randomState = randomBytes(24).toString('hex');

  // Relay mode (single whitelisted URL for all tenants) encodes this
  // tenant's origin into the state so the relay can route the callback.
  // Direct mode keeps the plain state and uses the per-domain redirect URI.
  const state = relayOrigin
    ? `${encodeStateOrigin(frontendUrl)}.${randomState}`
    : randomState;
  const redirectUri = relayOrigin
    ? `${relayOrigin}${QB_RELAY_PATH}`
    : directRedirectUri;

  pendingStates.set(state, { userId, nonce, createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: resolvedClientId,
    response_type: 'code',
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
  });

  return `${INTUIT_AUTH_URL}?${params.toString()}`;
}

/**
 * Handle the OAuth2 callback from Intuit.
 * Exchanges the authorization code for tokens and stores them encrypted.
 */
export async function handleOAuthCallback(
  code: string,
  realmId: string,
  state: string,
): Promise<{ success: boolean; redirectUrl: string }> {
  cleanExpiredStates();

  // Verify state
  const pending = pendingStates.get(state);
  if (!pending) {
    const { frontendUrl } = getQBConfig();
    return { success: false, redirectUrl: `${frontendUrl}/admin/integrations?qb=error&reason=invalid_state` };
  }
  pendingStates.delete(state);

  const { userId } = pending;
  const tenantId = await getTenantId();
  const { clientId, clientSecret } = await getQBAppCredentials(tenantId);
  const { redirectUri, frontendUrl } = getQBConfig();

  try {
    // Exchange code for tokens
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch(INTUIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text().catch(() => '');
      console.error('[QB] Token exchange failed:', tokenRes.status, `(intuit_tid: ${intuitTid(tokenRes)})`, errorText);
      return { success: false, redirectUrl: `${frontendUrl}/admin/integrations?qb=error&reason=token_exchange` };
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number; // seconds (typically 3600)
      x_refresh_token_expires_in: number; // seconds (typically ~8.6M = 100 days)
      token_type: string;
    };

    // Fetch company info from QBO API to get company name
    let companyName = `Realm ${realmId}`;
    try {
      const environment = await getEnvironment(tenantId);
      const apiBase = apiBaseFor(environment);
      const companyRes = await fetch(
        `${apiBase}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=65`,
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${tokenData.access_token}`,
          },
        },
      );
      if (companyRes.ok) {
        const companyData = (await companyRes.json()) as {
          CompanyInfo: { CompanyName: string };
        };
        companyName = companyData.CompanyInfo?.CompanyName ?? companyName;
      }
    } catch {
      // Non-critical — we can still connect without the name
    }

    // Store all tokens and metadata encrypted
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    const refreshExpiresAt = new Date(
      Date.now() + tokenData.x_refresh_token_expires_in * 1000,
    ).toISOString();

    await Promise.all([
      upsertCredential(tenantId, 'access_token', tokenData.access_token, userId),
      upsertCredential(tenantId, 'refresh_token', tokenData.refresh_token, userId),
      upsertCredential(tenantId, 'realm_id', realmId, userId),
      upsertCredential(tenantId, 'company_name', companyName, userId),
      upsertCredential(tenantId, 'connection_type', 'online', userId),
      upsertCredential(tenantId, 'token_expires_at', expiresAt, userId),
      upsertCredential(tenantId, 'refresh_token_expires_at', refreshExpiresAt, userId),
    ]);

    console.log(`[QB] Connected to company "${companyName}" (realm ${realmId})`);
    return { success: true, redirectUrl: `${frontendUrl}/admin/integrations?qb=connected` };
  } catch (err) {
    console.error('[QB] OAuth callback error:', err);
    return { success: false, redirectUrl: `${frontendUrl}/admin/integrations?qb=error&reason=unknown` };
  }
}

/**
 * Refresh the QBO access token using the stored refresh token.
 * Called automatically when the access token has expired.
 */
export async function refreshAccessToken(): Promise<boolean> {
  const tenantId = await getTenantId();
  const refreshToken = await getCredential(tenantId, 'refresh_token');
  if (!refreshToken) return false;

  const { clientId, clientSecret } = await getQBAppCredentials(tenantId);
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  try {
    const res = await fetch(INTUIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      console.error('[QB] Token refresh failed:', res.status, `(intuit_tid: ${intuitTid(res)})`, errorText);
      return false;
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      x_refresh_token_expires_in: number;
    };

    // Get the user who originally connected (for updatedBy field)
    const updaterRow = await db
      .select({ updatedBy: integrationCredentials.updatedBy })
      .from(integrationCredentials)
      .where(
        and(
          eq(integrationCredentials.tenantId, tenantId),
          eq(integrationCredentials.provider, PROVIDER),
          eq(integrationCredentials.key, 'access_token'),
        ),
      )
      .limit(1);
    const userId = updaterRow[0]?.updatedBy ?? '';

    const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
    const refreshExpiresAt = new Date(
      Date.now() + data.x_refresh_token_expires_in * 1000,
    ).toISOString();

    await Promise.all([
      upsertCredential(tenantId, 'access_token', data.access_token, userId),
      upsertCredential(tenantId, 'refresh_token', data.refresh_token, userId),
      upsertCredential(tenantId, 'token_expires_at', expiresAt, userId),
      upsertCredential(tenantId, 'refresh_token_expires_at', refreshExpiresAt, userId),
    ]);

    console.log('[QB] Access token refreshed successfully');
    return true;
  } catch (err) {
    console.error('[QB] Token refresh error:', err);
    return false;
  }
}

/**
 * Get a valid QBO access token, refreshing if needed.
 * Returns null if not connected.
 */
export async function getValidAccessToken(): Promise<{ token: string; realmId: string } | null> {
  const tenantId = await getTenantId();
  const connectionType = await getCredential(tenantId, 'connection_type');
  if (connectionType !== 'online') return null;

  const realmId = await getCredential(tenantId, 'realm_id');
  if (!realmId) return null;

  // Check if token is expired
  const expiresAtStr = await getCredential(tenantId, 'token_expires_at');
  const accessToken = await getCredential(tenantId, 'access_token');
  if (!accessToken) return null;

  if (expiresAtStr) {
    const expiresAt = new Date(expiresAtStr).getTime();
    // Refresh if expires within 5 minutes
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      const refreshed = await refreshAccessToken();
      if (!refreshed) return null;
      // Re-read the new access token
      const newToken = await getCredential(tenantId, 'access_token');
      return newToken ? { token: newToken, realmId } : null;
    }
  }

  return { token: accessToken, realmId };
}

// ═══════════════════════════════════════════════════════════════════════
//  QuickBooks Desktop — Web Connector Credentials
// ═══════════════════════════════════════════════════════════════════════

/**
 * Store Desktop Web Connector credentials.
 */
export async function setDesktopCredentials(
  companyName: string,
  username: string,
  password: string,
  userId: string,
): Promise<void> {
  const tenantId = await getTenantId();

  // Clear any existing QBO tokens first (switching mode)
  await deleteAllCredentials(tenantId);

  await Promise.all([
    upsertCredential(tenantId, 'connection_type', 'desktop', userId),
    upsertCredential(tenantId, 'company_name', companyName, userId),
    upsertCredential(tenantId, 'desktop_username', username, userId),
    upsertCredential(tenantId, 'desktop_password', password, userId),
  ]);

  console.log(`[QB Desktop] Credentials saved for "${companyName}"`);
}

// ═══════════════════════════════════════════════════════════════════════
//  Status & Disconnect
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get QuickBooks integration status for the status dashboard.
 */
export async function getQuickBooksStatus(): Promise<IntegrationStatusDto> {
  const tenantId = await getTenantId();

  const rows = await db
    .select({
      key: integrationCredentials.key,
      encryptedValue: integrationCredentials.encryptedValue,
      iv: integrationCredentials.iv,
      authTag: integrationCredentials.authTag,
      updatedAt: integrationCredentials.updatedAt,
      updatedBy: integrationCredentials.updatedBy,
    })
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, PROVIDER),
      ),
    );

  if (!rows.length) {
    return {
      provider: PROVIDER,
      configured: false,
      username: null,
      updatedAt: null,
      updatedBy: null,
      connectionType: null,
      realmId: null,
      companyName: null,
      tokenExpiresAt: null,
    };
  }

  // Decrypt fields
  const values = new Map<string, string>();
  let lastUpdated: Date | null = null;
  let lastUpdaterId: string | null = null;

  for (const row of rows) {
    values.set(row.key, decrypt(row.encryptedValue, row.iv, row.authTag));
    if (!lastUpdated || (row.updatedAt && row.updatedAt > lastUpdated)) {
      lastUpdated = row.updatedAt;
      lastUpdaterId = row.updatedBy;
    }
  }

  // Get updater email
  let updatedBy: string | null = null;
  if (lastUpdaterId) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, lastUpdaterId),
    });
    updatedBy = user?.email ?? null;
  }

  const connectionType = (values.get('connection_type') as 'online' | 'desktop') ?? null;
  const configured = connectionType === 'online'
    ? !!(values.get('access_token') && values.get('realm_id'))
    : connectionType === 'desktop'
      ? !!(values.get('desktop_username') && values.get('desktop_password'))
      : false;

  return {
    provider: PROVIDER,
    configured,
    username: values.get('company_name') ?? null,
    updatedAt: lastUpdated?.toISOString() ?? null,
    updatedBy,
    connectionType,
    realmId: values.get('realm_id') ?? null,
    companyName: values.get('company_name') ?? null,
    tokenExpiresAt: values.get('token_expires_at') ?? null,
  };
}

/**
 * Disconnect QuickBooks — revoke tokens (for QBO) and delete all stored credentials.
 */
export async function disconnect(userId: string): Promise<void> {
  const tenantId = await getTenantId();

  // For QBO: try to revoke the token at Intuit
  const connectionType = await getCredential(tenantId, 'connection_type');
  if (connectionType === 'online') {
    const refreshToken = await getCredential(tenantId, 'refresh_token');
    if (refreshToken) {
      const { clientId, clientSecret } = await getQBAppCredentials(tenantId);
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      try {
        await fetch(INTUIT_REVOKE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${basicAuth}`,
          },
          body: JSON.stringify({ token: refreshToken }),
        });
      } catch {
        // Non-critical — deletion still proceeds
      }
    }
  }

  await deleteAllCredentials(tenantId);
  console.log(`[QB] Disconnected by user ${userId}`);
}

/**
 * Check if QuickBooks app credentials (Client ID + Secret) are configured —
 * either at the environment level or as per-tenant credentials saved from
 * the admin UI (needed before OAuth can work).
 */
export async function isAppConfigured(): Promise<boolean> {
  const tenantId = await getTenantId();
  return isQBAppConfigured(tenantId);
}

/**
 * Details about the Intuit app configuration for the admin UI:
 * where the credentials come from, a masked client id for verification,
 * and the exact redirect URI to whitelist in the Intuit developer dashboard.
 */
export async function getAppConfigInfo(): Promise<{
  appConfigured: boolean;
  source: 'env' | 'tenant' | 'none';
  clientIdMasked: string | null;
  hasTenantCredentials: boolean;
  redirectUri: string;
  relayMode: boolean;
  environment: 'sandbox' | 'production';
}> {
  const tenantId = await getTenantId();
  const { clientId, source } = await getQBAppCredentials(tenantId);
  const hasTenantCredentials = !!(
    await getCredential(tenantId, 'app_client_id')
  );
  // In relay mode the whitelisted redirect URI is the shared relay, not the
  // per-domain callback — show the URL that must be registered at Intuit.
  const relayOrigin = qbRelayOrigin();
  const relayMode = !!relayOrigin;
  const redirectUri = relayMode
    ? `${relayOrigin}${QB_RELAY_PATH}`
    : getQBConfig().redirectUri;
  const environment = await getEnvironment(tenantId);
  return {
    appConfigured: source !== 'none',
    source,
    clientIdMasked: clientId ? `${clientId.slice(0, 6)}…${clientId.slice(-4)}` : null,
    hasTenantCredentials,
    redirectUri,
    relayMode,
    environment,
  };
}

/**
 * Save per-tenant Intuit app credentials (admin UI fallback when the
 * QB_CLIENT_ID / QB_CLIENT_SECRET env vars are not set on this server).
 */
export async function setAppCredentials(
  clientId: string,
  clientSecret: string,
  environment: 'sandbox' | 'production' | undefined,
  userId: string,
): Promise<void> {
  const tenantId = await getTenantId();
  await upsertCredential(tenantId, 'app_client_id', clientId.trim(), userId);
  await upsertCredential(tenantId, 'app_client_secret', clientSecret.trim(), userId);
  if (environment) {
    await upsertCredential(tenantId, 'app_environment', environment, userId);
  }
  console.log(`[QB] App credentials saved for tenant ${tenantId} (source: tenant)`);
}

/** Remove the per-tenant Intuit app credentials override. */
export async function clearAppCredentials(): Promise<void> {
  const tenantId = await getTenantId();
  await db
    .delete(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, PROVIDER),
        or(
          eq(integrationCredentials.key, 'app_client_id'),
          eq(integrationCredentials.key, 'app_client_secret'),
          eq(integrationCredentials.key, 'app_environment'),
        ),
      ),
    );
  console.log(`[QB] Per-tenant app credentials cleared for tenant ${tenantId}`);
}

// ─── QuickBooks Invoice Sync ────────────────────────────────────────────

/**
 * Find or create a QuickBooks customer for a given counterparty.
 * Stores the QB customer ID in integrationCredentials for future lookups.
 * Returns the QB customer ID.
 */
export async function findOrCreateQBCustomer(counterpartyId: string): Promise<{ id: string; name: string }> {
  const tenantId = await getTenantId();

  // Check if we already have a QB customer ID for this counterparty
  const existingQbId = await getCredential(tenantId, `qb_customer_${counterpartyId}`);
  if (existingQbId) {
    // We have a stored QB customer ID — return it (with name from counterparty)
    const [counterparty] = await db
      .select({ name: counterparties.name })
      .from(counterparties)
      .where(eq(counterparties.id, counterpartyId))
      .limit(1);
    return { id: existingQbId, name: counterparty?.name ?? 'Unknown' };
  }

  // Fetch counterparty details
  const [counterparty] = await db
    .select({
      name: counterparties.name,
      headOfficeEmail: counterparties.headOfficeEmail,
      headOfficePhone: counterparties.headOfficePhone,
    })
    .from(counterparties)
    .where(eq(counterparties.id, counterpartyId))
    .limit(1);

  if (!counterparty) throw new Error(`Counterparty ${counterpartyId} not found`);

  const tokenInfo = await getValidAccessToken();
  if (!tokenInfo) throw new Error('QuickBooks is not connected. Please connect via Settings → Integrations → QuickBooks.');

  const { token, realmId } = tokenInfo;
  const apiBase = apiBaseFor(await getEnvironment(tenantId));

  // Query QB for an existing customer with the same DisplayName
  const queryRes = await fetch(
    `${apiBase}/v3/company/${realmId}/query?query=${encodeURIComponent(`SELECT Id, DisplayName FROM Customer WHERE DisplayName = '${counterparty.name.replace(/'/g, "\\'")}' MAXRESULTS 1`)}`,
    { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
  );

  if (queryRes.ok) {
    const queryData = await queryRes.json() as { QueryResponse?: { Customer?: { Id: string; DisplayName: string }[] } };
    const existing = queryData.QueryResponse?.Customer?.[0];
    if (existing) {
      // Store the QB customer ID for future lookups
      await upsertCredential(tenantId, `qb_customer_${counterpartyId}`, existing.Id, '');
      return { id: existing.Id, name: existing.DisplayName };
    }
  }

  // Customer not found — create a new one
  const customerBody: Record<string, unknown> = {
    DisplayName: counterparty.name,
  };
  if (counterparty.headOfficeEmail) {
    customerBody.PrimaryEmailAddr = { Address: counterparty.headOfficeEmail };
  }
  if (counterparty.headOfficePhone) {
    customerBody.PrimaryPhone = { FreeFormNumber: counterparty.headOfficePhone };
  }

  const createRes = await fetch(`${apiBase}/v3/company/${realmId}/customer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(customerBody),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create QuickBooks customer: ${createRes.status} (intuit_tid: ${intuitTid(createRes)}) ${errText}`);
  }

  const createData = await createRes.json() as { Customer?: { Id: string; DisplayName: string } };
  const qbCustomer = createData.Customer;
  if (!qbCustomer?.Id) throw new Error('QuickBooks customer creation returned no ID');

  // Store the QB customer ID
  await upsertCredential(tenantId, `qb_customer_${counterpartyId}`, qbCustomer.Id, '');
  console.log(`[QB] Created customer "${qbCustomer.DisplayName}" (QB ID: ${qbCustomer.Id})`);
  return { id: qbCustomer.Id, name: qbCustomer.DisplayName };
}

/**
 * Create a QuickBooks invoice from a Fueld invoice + order data.
 * Stores the QB invoice ID in integrationCredentials.
 * Returns the QB invoice ID.
 */
export async function createQBInvoice(invoiceId: string): Promise<{ qbInvoiceId: string; qbInvoiceNumber: string }> {
  const tenantId = await getTenantId();

  // Check if already synced
  const existingQbInvoiceId = await getCredential(tenantId, `qb_invoice_${invoiceId}`);
  if (existingQbInvoiceId) {
    throw new Error('This invoice has already been synced to QuickBooks.');
  }

  // Fetch invoice with order + items
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
  // A voided invoice is not a receivable; never push it to QuickBooks, whichever
  // entry point was used.
  if (invoice.status === 'VOID') throw new Error(`Invoice ${invoice.invoiceNumber} is void and cannot be synced`);

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, invoice.orderId))
    .limit(1);
  if (!order) throw new Error(`Order for invoice not found`);

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(orderItems.sortOrder);

  // Find or create the QB customer
  const customer = await findOrCreateQBCustomer(order.clientId);

  const tokenInfo = await getValidAccessToken();
  if (!tokenInfo) throw new Error('QuickBooks is not connected.');

  const { token, realmId } = tokenInfo;
  const apiBase = apiBaseFor(await getEnvironment(tenantId));

  // Load product mappings from TenantSettings
  const [tenantRow] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const qbSettings = ((tenantRow?.settings ?? {}) as TenantSettings).quickbooksSettings;
  const productMappings = new Map<string, string>();
  for (const m of qbSettings?.productMappings ?? []) {
    productMappings.set(m.productType.toLowerCase(), m.qbItemId);
  }

  // Find a fallback Item in QB (for SalesItemLineDetail)
  let fallbackItemId = '1'; // Default to first item
  try {
    const itemQueryRes = await fetch(
      `${apiBase}/v3/company/${realmId}/query?query=${encodeURIComponent('SELECT Id, Name FROM Item WHERE Active = true MAXRESULTS 1')}`,
      { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
    );
    if (itemQueryRes.ok) {
      const itemData = await itemQueryRes.json() as { QueryResponse?: { Item?: { Id: string; Name: string }[] } };
      const firstItem = itemData.QueryResponse?.Item?.[0];
      if (firstItem?.Id) fallbackItemId = firstItem.Id;
    }
  } catch {
    // Non-critical — use default item ID
  }

  // Build line items.
  //
  // These must mirror the invoice exactly, because the QB total is now
  // reconcilable against a real `invoices.amount`:
  //   - customerFacingItems drops broker-commission (`hideOnDocuments`) and
  //     legacy supplier credit-note placeholder lines, which the customer
  //     invoice also omits.
  //   - the billed quantity is the delivered quantity where recorded, matching
  //     computeInvoiceAmount.
  // Without both, the QB invoice silently disagreed with the invoice the
  // customer received (measured across all three tenants before this fix).
  const lines = customerFacingItems(items).map((item) => {
    const qty = parseFloat(String(item.deliveredQuantity ?? item.quantity ?? '0')) || 0;
    const price = parseFloat(item.salesPrice?.toString() ?? '0') || 0;
    // Rounded per line: QuickBooks totals the lines we send, so an unrounded
    // float here (7dp prices) would push a total that disagrees with the invoice.
    const amount = Number((qty * price).toFixed(2));
    const desc = [
      item.productType,
      item.description?.trim(),
      `${qty} ${item.salesUnit ?? item.unit} @ ${price} ${item.salesCurrency ?? order.currency}`,
    ].filter(Boolean).join(' — ');

    return {
      Amount: amount,
      DetailType: 'SalesItemLineDetail',
      Description: desc,
      SalesItemLineDetail: { ItemRef: { value: productMappings.get(item.productType.toLowerCase()) ?? fallbackItemId } },
    };
  });

  // Lines that do not sum to the invoice (an all-hidden order, or a rounding
  // drift) would push a QB invoice that disagrees with the customer's copy.
  // Fall back to a single line carrying the invoice amount.
  const lineTotal = lines.reduce((sum, line) => sum + line.Amount, 0);
  const invoiceTotal = parseFloat(invoice.amount?.toString() ?? '0') || 0;
  if (lines.length === 0 || Math.abs(lineTotal - invoiceTotal) > 0.005) {
    lines.length = 0;
    lines.push({
      Amount: invoiceTotal,
      DetailType: 'SalesItemLineDetail',
      Description: `Invoice ${invoice.invoiceNumber} — Order ${order.orderNumber ?? ''}`,
      SalesItemLineDetail: { ItemRef: { value: fallbackItemId } },
    });
  }

  // Create QB invoice
  const invoiceBody = {
    CustomerRef: { value: customer.id },
    Line: lines,
    CustomerMemo: { value: `Fueld Order ${order.orderNumber ?? ''} — Invoice ${invoice.invoiceNumber}` },
    BillEmail: { Address: '' }, // Will be set if customer has email
    // Carry the invoice's own due date across so QuickBooks ages the receivable
    // on the same date the customer was told to pay.
    DueDate: invoice.dueDate,
  };

  const createRes = await fetch(`${apiBase}/v3/company/${realmId}/invoice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(invoiceBody),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create QuickBooks invoice: ${createRes.status} (intuit_tid: ${intuitTid(createRes)}) ${errText}`);
  }

  const createData = await createRes.json() as { Invoice?: { Id: string; DocNumber: string } };
  const qbInvoice = createData.Invoice;
  if (!qbInvoice?.Id) throw new Error('QuickBooks invoice creation returned no ID');

  // Store the QB invoice ID
  await upsertCredential(tenantId, `qb_invoice_${invoiceId}`, qbInvoice.Id, '');
  console.log(`[QB] Created invoice ${qbInvoice.DocNumber} (QB ID: ${qbInvoice.Id}) for Fueld invoice ${invoice.invoiceNumber}`);

  // Send notification email (e.g. to Kathy at backoffice@channeltx.com)
  if (qbSettings?.notifyEmail) {
    try {
      const html = `
        <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;max-width:600px;">
          <h2 style="margin:0 0 8px;">Invoice synced to QuickBooks</h2>
          <p style="margin:0 0 16px;color:#6b7280;">The following invoice has been pushed to QuickBooks Online:</p>
          <table style="width:100%;font-size:14px;">
            <tr><td style="padding:4px 0;color:#6b7280;">Fueld Invoice:</td><td style="padding:4px 0;font-weight:500;">${invoice.invoiceNumber}</td></tr>
            <tr><td style="padding:4px 0;color:#6b7280;">Order:</td><td style="padding:4px 0;font-weight:500;">${order.orderNumber ?? ''}</td></tr>
            <tr><td style="padding:4px 0;color:#6b7280;">QuickBooks Invoice:</td><td style="padding:4px 0;font-weight:500;">${qbInvoice.DocNumber} (ID: ${qbInvoice.Id})</td></tr>
          </table>
          <p style="margin-top:16px;color:#9ca3af;font-size:11px;">This is an automated notification from Fueld.</p>
        </div>
      `;
      await sendNotificationEmail(
        [qbSettings.notifyEmail],
        `Invoice ${invoice.invoiceNumber} synced to QuickBooks`,
        html,
        { textContent: `Invoice ${invoice.invoiceNumber} (Order ${order.orderNumber ?? ''}) has been synced to QuickBooks as invoice ${qbInvoice.DocNumber}.` },
      );
    } catch (emailErr) {
      console.error('[QB] Failed to send notification email:', emailErr);
    }
  }

  return { qbInvoiceId: qbInvoice.Id, qbInvoiceNumber: qbInvoice.DocNumber };
}

/**
 * Sync an invoice to QuickBooks. This is the main orchestrator.
 * Throws if QB is not connected or if invoice is already synced.
 */
export async function syncInvoiceToQuickBooks(invoiceId: string): Promise<{ qbInvoiceId: string; qbInvoiceNumber: string }> {
 // Check if already synced
  const status = await getInvoiceSyncStatus(invoiceId);
  if (status.synced) {
    return { qbInvoiceId: status.qbInvoiceId!, qbInvoiceNumber: status.qbInvoiceNumber ?? '' };
  }

  return createQBInvoice(invoiceId);
}

/**
 * Check if an invoice has been synced to QuickBooks.
 */
export async function getInvoiceSyncStatus(invoiceId: string): Promise<{
  synced: boolean;
  qbInvoiceId: string | null;
  qbInvoiceNumber: string | null;
}> {
  const tenantId = await getTenantId();
  const qbInvoiceId = await getCredential(tenantId, `qb_invoice_${invoiceId}`);
  if (!qbInvoiceId) {
    return { synced: false, qbInvoiceId: null, qbInvoiceNumber: null };
  }

  // Try to fetch the QB invoice number from the API for display
  let qbInvoiceNumber: string | null = null;
  try {
    const tokenInfo = await getValidAccessToken();
    if (tokenInfo) {
      const { token, realmId } = tokenInfo;
      const apiBase = apiBaseFor(await getEnvironment(tenantId));
      const res = await fetch(
        `${apiBase}/v3/company/${realmId}/query?query=${encodeURIComponent(`SELECT DocNumber FROM Invoice WHERE Id = '${qbInvoiceId}' MAXRESULTS 1`)}`,
        { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const data = await res.json() as { QueryResponse?: { Invoice?: { DocNumber: string }[] } };
        qbInvoiceNumber = data.QueryResponse?.Invoice?.[0]?.DocNumber ?? null;
      }
    }
  } catch {
    // Non-critical — we still know it's synced
  }

  return { synced: true, qbInvoiceId, qbInvoiceNumber };
}

/**
 * Sync an order's invoice to QuickBooks. Finds the invoice for the order
 * and syncs it. This is the order-based entry point used by the frontend.
 */
export async function syncOrderToQuickBooks(orderId: string): Promise<{ qbInvoiceId: string; qbInvoiceNumber: string }> {
  // Find the invoice for this order
  const [invoice] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), notInArray(invoices.status, ['VOID', 'DRAFT'])))
    .orderBy(desc(invoices.createdAt))
    .limit(1);

  if (!invoice) {
    throw new Error('No invoice found for this order. Generate an invoice first.');
  }

  return syncInvoiceToQuickBooks(invoice.id);
}

/**
 * Check if an order's invoice has been synced to QuickBooks.
 */
export async function getOrderSyncStatus(orderId: string): Promise<{
  synced: boolean;
  qbInvoiceId: string | null;
  qbInvoiceNumber: string | null;
}> {
  const [invoice] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), notInArray(invoices.status, ['VOID', 'DRAFT'])))
    .orderBy(desc(invoices.createdAt))
    .limit(1);

  if (!invoice) {
    return { synced: false, qbInvoiceId: null, qbInvoiceNumber: null };
  }

  return getInvoiceSyncStatus(invoice.id);
}

/**
 * Fetch active Items/Services from QuickBooks for product mapping UI.
 */
export async function getQBItems(): Promise<Array<{ id: string; name: string; type: string }>> {
  const tokenInfo = await getValidAccessToken();
  if (!tokenInfo) throw new Error('QuickBooks is not connected.');

  const { token, realmId } = tokenInfo;
  const apiBase = apiBaseFor(await getEnvironment(await getTenantId()));

  const res = await fetch(
    `${apiBase}/v3/company/${realmId}/query?query=${encodeURIComponent('SELECT Id, Name, Type FROM Item WHERE Active = true ORDER BY Name MAXRESULTS 100')}`,
    { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) throw new Error(`Failed to fetch QB items: ${res.status} (intuit_tid: ${intuitTid(res)})`);

  const data = await res.json() as { QueryResponse?: { Item?: { Id: string; Name: string; Type: string }[] } };
  return (data.QueryResponse?.Item ?? []).map((item) => ({ id: item.Id, name: item.Name, type: item.Type }));
}

/**
 * Get QuickBooks integration settings for the current tenant.
 */
export async function getQuickBooksSettings(): Promise<{
  notifyEmail: string;
  autoSyncInvoices: boolean;
  productMappings: { productType: string; qbItemId: string; qbItemName: string }[];
}> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = (tenant.settings ?? {}) as TenantSettings;
  const qb = settings.quickbooksSettings;
  return {
    notifyEmail: qb?.notifyEmail ?? '',
    autoSyncInvoices: qb?.autoSyncInvoices ?? false,
    productMappings: qb?.productMappings ?? [],
  };
}
