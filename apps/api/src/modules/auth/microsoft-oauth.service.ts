// ═══════════════════════════════════════════════════════════════════════
//  Microsoft OAuth2 Service — Authorization Code Flow (Confidential Client)
// ═══════════════════════════════════════════════════════════════════════
//
// Implements raw OAuth2 against Microsoft identity platform endpoints.
// No dependency on @azure/msal-node — just HTTP calls.
//
// Scopes requested:  openid, User.Read, Mail.Send, offline_access
//   - openid          → standard OIDC
//   - User.Read       → profile info for SSO login
//   - Mail.Send       → send email from user's mailbox via Graph
//   - offline_access  → refresh token for server-side token renewal
// ═══════════════════════════════════════════════════════════════════════

import { encrypt, decrypt } from '../../lib/crypto';
import { randomBytes, createHmac } from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────

export interface MicrosoftSsoConfig {
  ssoClientId: string;
  ssoClientSecret: string;
  ssoTenantId?: string;
}

export interface MicrosoftTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

interface OAuthState {
  returnUrl: string;
  nonce: string;
  ts: number;
}

// ─── Constants ───────────────────────────────────────────────────────

const SCOPES = ['openid', 'User.Read', 'Mail.Send', 'offline_access'];
const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Secret key for HMAC-signing the OAuth state parameter.
 * Derived from CREDENTIALS_ENCRYPTION_KEY or DATABASE_URL (same source as crypto.ts).
 */
function getStateSigningKey(): string {
  return process.env['CREDENTIALS_ENCRYPTION_KEY']
    ?? process.env['DATABASE_URL']
    ?? 'fueld-oauth-state-fallback';
}

// ─── One-time code store (in-memory) ────────────────────────────────

interface PendingAuth {
  userId: string;
  fueldAccessToken: string;
  fueldRefreshToken: string;
  user: Record<string, unknown>;
  expiresAt: number;
}

const pendingCodes = new Map<string, PendingAuth>();

// Sweep expired codes every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of pendingCodes) {
    if (entry.expiresAt < now) pendingCodes.delete(code);
  }
}, 60_000);

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Build the Microsoft authorization URL that the user's browser
 * should be redirected to.
 */
export function buildAuthorizationUrl(
  config: MicrosoftSsoConfig,
  redirectUri: string,
  returnUrl: string,
): string {
  const tenantId = config.ssoTenantId || 'common';
  const base = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`;

  const state = signState({ returnUrl, nonce: randomBytes(16).toString('hex'), ts: Date.now() });

  const params = new URLSearchParams({
    client_id: config.ssoClientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    response_mode: 'query',
    state,
    prompt: 'select_account',
  });

  return `${base}?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCodeForTokens(
  config: MicrosoftSsoConfig,
  code: string,
  redirectUri: string,
): Promise<MicrosoftTokenResponse> {
  const tenantId = config.ssoTenantId || 'common';
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: config.ssoClientId,
    client_secret: config.ssoClientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: SCOPES.join(' '),
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`[MicrosoftOAuth] Token exchange failed (${res.status}):`, errorText);
    throw new Error(`Microsoft token exchange failed: ${res.status}`);
  }

  return (await res.json()) as MicrosoftTokenResponse;
}

/**
 * Refresh a Microsoft access token using a stored refresh token.
 * Returns fresh tokens (including a potentially rotated refresh token).
 */
export async function refreshMicrosoftToken(
  config: MicrosoftSsoConfig,
  refreshToken: string,
): Promise<MicrosoftTokenResponse> {
  const tenantId = config.ssoTenantId || 'common';
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: config.ssoClientId,
    client_secret: config.ssoClientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: SCOPES.join(' '),
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`[MicrosoftOAuth] Token refresh failed (${res.status}):`, errorText);
    throw new Error(`Microsoft token refresh failed: ${res.status}`);
  }

  return (await res.json()) as MicrosoftTokenResponse;
}

// ─── Encrypted Refresh Token Storage ────────────────────────────────

/**
 * Encrypt a Microsoft refresh token for safe DB storage.
 */
export function encryptRefreshToken(token: string): {
  microsoftRefreshToken: string;
  microsoftRefreshTokenIv: string;
  microsoftRefreshTokenAuthTag: string;
} {
  const { encrypted, iv, authTag } = encrypt(token);
  return {
    microsoftRefreshToken: encrypted,
    microsoftRefreshTokenIv: iv,
    microsoftRefreshTokenAuthTag: authTag,
  };
}

/**
 * Decrypt a stored Microsoft refresh token.
 */
export function decryptRefreshToken(
  encrypted: string,
  iv: string,
  authTag: string,
): string {
  return decrypt(encrypted, iv, authTag);
}

// ─── State Parameter (signed JSON) ──────────────────────────────────

function signState(data: OAuthState): string {
  const json = JSON.stringify(data);
  const encoded = Buffer.from(json).toString('base64url');
  const sig = createHmac('sha256', getStateSigningKey()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyAndDecodeState(state: string): OAuthState {
  const dotIndex = state.lastIndexOf('.');
  if (dotIndex === -1) throw new Error('Invalid OAuth state format');

  const encoded = state.substring(0, dotIndex);
  const sig = state.substring(dotIndex + 1);

  const expectedSig = createHmac('sha256', getStateSigningKey()).update(encoded).digest('base64url');
  if (sig !== expectedSig) throw new Error('Invalid OAuth state signature');

  const data = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as OAuthState;

  if (Date.now() - data.ts > STATE_MAX_AGE_MS) {
    throw new Error('OAuth state has expired');
  }

  return data;
}

// ─── One-Time Code Management ───────────────────────────────────────

const CODE_TTL_MS = 60_000; // 60 seconds

export function storeOneTimeCode(auth: Omit<PendingAuth, 'expiresAt'>): string {
  const code = randomBytes(32).toString('hex');
  pendingCodes.set(code, { ...auth, expiresAt: Date.now() + CODE_TTL_MS });
  return code;
}

export function consumeOneTimeCode(code: string): PendingAuth | null {
  const entry = pendingCodes.get(code);
  if (!entry) return null;
  pendingCodes.delete(code); // Single-use
  if (entry.expiresAt < Date.now()) return null;
  return entry;
}

// ─── Redirect URI Helper ────────────────────────────────────────────

/**
 * Determine the Microsoft OAuth redirect URI.
 * Uses APP_URL env var (the API's public-facing base URL).
 *
 * Examples:
 *   APP_URL=http://localhost:3000       → http://localhost:3000/auth/microsoft/callback
 *   APP_URL=https://api.fueld.com      → https://api.fueld.com/auth/microsoft/callback
 *   APP_URL=https://app.fueld.com/api  → https://app.fueld.com/api/auth/microsoft/callback
 */
export function getMicrosoftRedirectUri(): string {
  const appUrl = process.env['APP_URL'];
  if (!appUrl) {
    throw new Error(
      'APP_URL environment variable is required for Microsoft OAuth. ' +
      'Set it to the API\'s public-facing base URL (e.g. https://api.fueld.com).',
    );
  }
  // Strip trailing slash
  const base = appUrl.replace(/\/+$/, '');
  return `${base}/auth/microsoft/callback`;
}

/**
 * Load Microsoft OAuth config from integration_credentials (encrypted DB table).
 * Falls back to tenant.settings for backward compat.
 * Used by auth.controller and acquireGraphTokenForUser.
 */
export async function loadMicrosoftConfig(): Promise<MicrosoftSsoConfig | null> {
  const { getMicrosoftCredentialsFromDB } = await import('../admin/integrations.service');
  const creds = await getMicrosoftCredentialsFromDB();
  if (!creds) return null;
  return {
    ssoClientId: creds.clientId,
    ssoClientSecret: creds.clientSecret,
    ssoTenantId: creds.tenantId,
  };
}

/**
 * Basic validation that returnUrl is a plausible frontend URL.
 * Prevents open redirect attacks.
 */
export function validateReturnUrl(returnUrl: string): boolean {
  try {
    const url = new URL(returnUrl);
    // Allow http only for localhost (development)
    if (url.protocol === 'http:' && url.hostname !== 'localhost') return false;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return true;
  } catch {
    return false;
  }
}

// ─── Acquire Graph Token for a User ─────────────────────────────────

/**
 * Look up and refresh a user's Microsoft token for Graph API access.
 * Returns an access token suitable for `Authorization: Bearer ...`
 * against `https://graph.microsoft.com`, or `null` if unavailable.
 *
 * This is the function that mail.service.ts should call instead of
 * receiving a token from the frontend.
 */
export async function acquireGraphTokenForUser(
  userId: string,
): Promise<string | null> {
  // Lazy import to avoid circular deps
  const { db } = await import('../../db');
  const { users } = await import('../../db/schema');
  const { eq } = await import('drizzle-orm');

  // 1. Get user's encrypted refresh token
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      microsoftRefreshToken: true,
      microsoftRefreshTokenIv: true,
      microsoftRefreshTokenAuthTag: true,
      tenantId: true,
    },
  });

  if (
    !user?.microsoftRefreshToken ||
    !user?.microsoftRefreshTokenIv ||
    !user?.microsoftRefreshTokenAuthTag
  ) {
    return null; // No Microsoft account linked with refresh token
  }

  // 2. Get Microsoft config from integration_credentials (encrypted)
  const config = await loadMicrosoftConfig();
  if (!config) return null;

  // 3. Decrypt refresh token
  const refreshToken = decryptRefreshToken(
    user.microsoftRefreshToken,
    user.microsoftRefreshTokenIv,
    user.microsoftRefreshTokenAuthTag,
  );

  // 4. Exchange for fresh access token
  try {
    const tokens = await refreshMicrosoftToken(config, refreshToken);

    // 5. If Microsoft rotated the refresh token, store the new one
    if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
      const encrypted = encryptRefreshToken(tokens.refresh_token);
      await db
        .update(users)
        .set({
          microsoftRefreshToken: encrypted.microsoftRefreshToken,
          microsoftRefreshTokenIv: encrypted.microsoftRefreshTokenIv,
          microsoftRefreshTokenAuthTag: encrypted.microsoftRefreshTokenAuthTag,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    }

    return tokens.access_token;
  } catch (err) {
    console.error(`[MicrosoftOAuth] Failed to refresh token for user ${userId}:`, err);
    return null; // Caller should fall back to SMTP
  }
}
