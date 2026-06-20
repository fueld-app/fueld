import { Elysia } from 'elysia';
import jwt from '@elysiajs/jwt';
import { isProductionRuntime } from '../../lib/crypto';

// ─── JWT Plugin (dual-token pattern) ─────────────────────────────────
// Access Token  → 15 min, stateless bearer for API calls
// Refresh Token → 7 days, stored in DB, used to rotate access tokens
//
// Both tokens are delivered via HTTP-only cookies set by the server using
// Elysia's `set.cookie` (singular) jar, in the object form:
//   set.cookie[name] = { value, path, httpOnly, sameSite, secure, maxAge }
// The auth guard also accepts `Authorization: Bearer <token>` as a fallback
// for non-browser clients (scripts, API integrations).
//
// Cookie layout:
//   fueld_access  → HttpOnly, SameSite=Lax, Secure (prod), 15 min Max-Age, Path=/
//   fueld_refresh → HttpOnly, SameSite=Lax, Secure (prod), 7 day Max-Age, Path=/api/auth/refresh
//   fueld_csrf     → SameSite=Lax, Secure (prod), JS-readable (sent as X-CSRF-Token header)

const DEV_ACCESS_SECRET = 'dev-access-secret';
const DEV_REFRESH_SECRET = 'dev-refresh-secret';

/** Cookie names */
export const ACCESS_COOKIE = 'fueld_access';
export const REFRESH_COOKIE = 'fueld_refresh';
export const CSRF_COOKIE = 'fueld_csrf';

/** Access/CSRF cookie lifetime (matches the access-token JWT `exp`). */
const ACCESS_MAX_AGE = 15 * 60; // 15 minutes
/** Refresh cookie lifetime (matches the refresh-token JWT `exp`). */
const REFRESH_MAX_AGE = 7 * 86400; // 7 days

/** Methods that mutate state and therefore require a CSRF token for cookie auth. */
export const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** True when the request authenticates via cookie (no `Authorization: Bearer` header). */
export function isCookieAuth(headers: Record<string, string | undefined>): boolean {
  return !headers['authorization']?.startsWith('Bearer ');
}

/**
 * Flatten Elysia's `cookie` jar (`Record<string, { value?: string }>`) into a
 * plain `Record<string, string>`. Used wherever a handler destructures `cookie`.
 */
export function flattenElysiaCookies(cookie: unknown): Record<string, string> {
  const c = (cookie as Record<string, { value?: string } | undefined>) ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(c)) {
    if (v?.value) out[k] = v.value;
  }
  return out;
}

/**
 * Parse a raw `Cookie:` request header into a plain `Record<string, string>`.
 * Used by the WebSocket upgrade handler, which has no Elysia `cookie` derive.
 */
export function parseCookieHeader(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

/** Generate a random 256-bit CSRF token (64 hex chars). */
export function generateCsrfToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Set the access, refresh, and CSRF cookies on the response. Uses Elysia's
 * native `set.cookie` (singular) jar in the object form so the framework
 * serializes correct `Set-Cookie` headers. Initializes the jar if absent.
 */
export function setAuthCookies(
  set: { cookie?: Record<string, Record<string, unknown>> },
  accessToken: string,
  refreshToken: string,
  csrfToken: string,
): void {
  let jar = set.cookie;
  if (!jar) {
    jar = Object.create(null) as Record<string, Record<string, unknown>>;
    set.cookie = jar;
  }
  const secure = isProductionRuntime();
  jar[ACCESS_COOKIE] = {
    value: accessToken,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: ACCESS_MAX_AGE,
  };
  jar[REFRESH_COOKIE] = {
    value: refreshToken,
    path: '/api/auth/refresh',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: REFRESH_MAX_AGE,
  };
  jar[CSRF_COOKIE] = {
    // NOT httpOnly — JS must read this to send it back as X-CSRF-Token.
    // Lifetime matches the refresh cookie so a silent refresh always has a
    // valid CSRF token to send, even after the 15-min access cookie expires.
    value: csrfToken,
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    secure,
    maxAge: REFRESH_MAX_AGE,
  };
}

/** Clear all auth cookies on logout (Max-Age=0 with matching Path + attributes). */
export function clearAuthCookies(set: { cookie?: Record<string, Record<string, unknown>> }): void {
  let jar = set.cookie;
  if (!jar) {
    jar = Object.create(null) as Record<string, Record<string, unknown>>;
    set.cookie = jar;
  }
  const secure = isProductionRuntime();
  const clear = (name: string, path: string): Record<string, unknown> => ({
    value: '',
    path,
    httpOnly: name !== CSRF_COOKIE,
    sameSite: 'lax',
    secure,
    maxAge: 0,
  });
  jar[ACCESS_COOKIE] = clear(ACCESS_COOKIE, '/');
  jar[REFRESH_COOKIE] = clear(REFRESH_COOKIE, '/api/auth/refresh');
  jar[CSRF_COOKIE] = clear(CSRF_COOKIE, '/');
}

/** Read the access token from cookie, falling back to Authorization header. */
export function extractAccessToken(
  headers: Record<string, string | undefined>,
  cookies: Record<string, string>,
): string | null {
  // 1. Cookie (browser)
  const cookieToken = cookies[ACCESS_COOKIE];
  if (cookieToken) return cookieToken;
  // 2. Authorization header (API clients, scripts)
  const authHeader = headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return null;
}

/** Read the refresh token from cookie, falling back to request body. */
export function extractRefreshToken(
  cookies: Record<string, string>,
  body?: { refreshToken?: string },
): string | null {
  const cookieToken = cookies[REFRESH_COOKIE];
  if (cookieToken) return cookieToken;
  if (body?.refreshToken) return body.refreshToken;
  return null;
}

/** Constant-time string comparison (guards against timing leaks on token equality). */
function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Read the CSRF token from the header and validate it against the cookie (constant-time). */
export function validateCsrfToken(
  headers: Record<string, string | undefined>,
  cookies: Record<string, string>,
): boolean {
  const cookieCsrf = cookies[CSRF_COOKIE];
  const headerCsrf = headers['x-csrf-token'];
  if (!cookieCsrf || !headerCsrf) return false;
  return timingSafeEqualString(cookieCsrf, headerCsrf);
}

/**
 * Resolve the access token for a manually-protected route (the account-settings
 * routes that cannot use `authGuard` because they must remain reachable while
 * MFA setup is required, e.g. /auth/2fa/generate). Enforces CSRF for cookie-auth
 * state-changing methods. Returns the token on success, or an error reason.
 */
export type ResolveTokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'missing' | 'csrf' };

export function resolveAccessToken(
  headers: Record<string, string | undefined>,
  flatCookies: Record<string, string>,
  method: string,
): ResolveTokenResult {
  const token = extractAccessToken(headers, flatCookies);
  if (!token) return { ok: false, reason: 'missing' };
  if (isCookieAuth(headers) && STATE_CHANGING_METHODS.has(method)) {
    if (!validateCsrfToken(headers, flatCookies)) {
      return { ok: false, reason: 'csrf' };
    }
  }
  return { ok: true, token };
}

/**
 * Fail fast in production if the JWT signing secrets are unset. Without
 * this, a misconfigured deployment silently signs/verifies tokens with the
 * hardcoded dev fallback, which is forgeable by anyone. Non-production
 * environments keep the dev fallback so local dev needs no secrets.
 */
export function assertJwtSecretsConfig(): void {
  if (!isProductionRuntime()) return;
  const access = process.env['JWT_ACCESS_SECRET'];
  const refresh = process.env['JWT_REFRESH_SECRET'];
  if (!access || access === DEV_ACCESS_SECRET) {
    throw new Error('JWT_ACCESS_SECRET must be set in production; refusing to use the insecure dev fallback.');
  }
  if (!refresh || refresh === DEV_REFRESH_SECRET) {
    throw new Error('JWT_REFRESH_SECRET must be set in production; refusing to use the insecure dev fallback.');
  }
}

export const jwtAccessPlugin = new Elysia({ name: 'jwt-access' }).use(
  jwt({
    name: 'jwtAccess',
    secret: process.env['JWT_ACCESS_SECRET'] || DEV_ACCESS_SECRET,
    exp: '15m',
  }),
);

export const jwtRefreshPlugin = new Elysia({ name: 'jwt-refresh' }).use(
  jwt({
    name: 'jwtRefresh',
    secret: process.env['JWT_REFRESH_SECRET'] || DEV_REFRESH_SECRET,
    exp: '7d',
  }),
);

/** Payload embedded in JWT tokens. */
export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: string;
  [key: string]: string; // index signature required by @elysiajs/jwt
}