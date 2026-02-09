// ═══════════════════════════════════════════════════════════════════════
//  QuickBooks Integration Service
//
//  Supports both QuickBooks Online (OAuth2) and QuickBooks Desktop
//  (Web Connector credentials). Stores tokens/credentials encrypted
//  using the same AES-256-GCM scheme as LLI credentials.
// ═══════════════════════════════════════════════════════════════════════

import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { integrationCredentials, tenants, users } from '../../db/schema';
import { encrypt, decrypt } from '../../lib/crypto';
import { randomBytes, createHash } from 'crypto';
import type { IntegrationStatusDto } from '@fueld/types';

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

// ─── Config helpers ──────────────────────────────────────────────────

function getQBConfig() {
  const clientId = process.env['QB_CLIENT_ID'] ?? '';
  const clientSecret = process.env['QB_CLIENT_SECRET'] ?? '';
  const redirectUri =
    process.env['QB_REDIRECT_URI'] ??
    'http://localhost:3000/admin/settings/integrations/quickbooks/callback';
  const environment = (process.env['QB_ENVIRONMENT'] ?? 'sandbox') as 'sandbox' | 'production';
  const frontendUrl = process.env['CORS_ORIGIN'] ?? 'http://localhost:4200';

  return { clientId, clientSecret, redirectUri, environment, frontendUrl };
}

function isQBAppConfigured(): boolean {
  const { clientId, clientSecret } = getQBConfig();
  return !!(clientId && clientSecret);
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
        updatedBy: userId,
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
      updatedBy: userId,
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
export function generateAuthUrl(userId: string): string {
  if (!isQBAppConfigured()) {
    throw new Error(
      'QuickBooks app not configured. Set QB_CLIENT_ID and QB_CLIENT_SECRET environment variables.',
    );
  }

  cleanExpiredStates();

  const { clientId, redirectUri } = getQBConfig();
  const nonce = randomBytes(16).toString('hex');
  const state = randomBytes(24).toString('hex');

  pendingStates.set(state, { userId, nonce, createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: clientId,
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
  const { clientId, clientSecret, redirectUri, frontendUrl } = getQBConfig();

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
      console.error('[QB] Token exchange failed:', tokenRes.status, errorText);
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
      const { environment } = getQBConfig();
      const apiBase = environment === 'production' ? QB_API_BASE_PROD : QB_API_BASE_SANDBOX;
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
    const tenantId = await getTenantId();
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

  const { clientId, clientSecret } = getQBConfig();
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
      console.error('[QB] Token refresh failed:', res.status);
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
      const { clientId, clientSecret } = getQBConfig();
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
 * Check if QuickBooks app credentials (Client ID + Secret) are configured
 * at the environment level (needed before OAuth can work).
 */
export function isAppConfigured(): boolean {
  return isQBAppConfigured();
}
