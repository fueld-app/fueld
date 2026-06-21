import { Elysia } from 'elysia';
import { jwtAccessPlugin, type JwtPayload, extractAccessToken, validateCsrfToken, flattenElysiaCookies, isCookieAuth, STATE_CHANGING_METHODS } from './jwt.setup';
import { findUserById, getMfaStatus } from './auth.service';
import { extractClientIp } from '../../utils/client-ip';

// ─── Auth Guard ──────────────────────────────────────────────────────
// Reusable Elysia plugin that protects routes.
// Any route that `.use(authGuard)` will:
//   1. Read the access token from the `fueld_access` cookie (browser)
//      or `Authorization: Bearer` header (API clients / scripts)
//   2. Validate the CSRF token (cookie vs X-CSRF-Token header) for cookie-based requests
//   3. Verify + decode the JWT
//   4. Check IP restriction (if configured for user)
//   5. Expose `auth` on the context ({ sub, email, role })
// ─────────────────────────────────────────────────────────────────────

/** Check if an IP matches a CIDR range or exact IP */
function ipMatchesCidr(ip: string, cidr: string): boolean {
  // Exact match (non-CIDR)
  if (ip === cidr) return true;

  const slash = cidr.indexOf('/');
  if (slash === -1) return false;
  const baseIp = cidr.slice(0, slash);
  const prefix = parseInt(cidr.slice(slash + 1), 10);
  if (isNaN(prefix) || prefix < 0) return false;

  const isV6 = (s: string): boolean => s.includes(':');
  // IPv4 allow-list entries must not match IPv6 clients (and vice-versa).
  if (isV6(ip) !== isV6(baseIp)) return false;

  if (isV6(ip)) {
    const ipNum = ipv6ToBigInt(ip);
    const baseNum = ipv6ToBigInt(baseIp);
    if (ipNum === null || baseNum === null || prefix > 128) return false;
    if (prefix === 0) return true;
    const allOnes = (1n << 128n) - 1n;
    const mask = (allOnes << BigInt(128 - prefix)) & allOnes;
    return (ipNum & mask) === (baseNum & mask);
  }

  // IPv4
  const ipNum = ipToNumber(ip);
  const baseNum = ipToNumber(baseIp);
  if (ipNum === null || baseNum === null || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (baseNum & mask);
}

function ipToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0;
}

/** Parse an IPv6 address (with `::` expansion) into a 128-bit BigInt. */
function ipv6ToBigInt(ip: string): bigint | null {
  try {
    const addr = ip.toLowerCase();
    let groups: string[];
    if (addr.includes('::')) {
      const idx = addr.indexOf('::');
      const left = addr.slice(0, idx).split(':').filter((g) => g.length > 0);
      const right = addr.slice(idx + 2).split(':').filter((g) => g.length > 0);
      const fill = 8 - left.length - right.length;
      if (fill < 0) return null;
      groups = [...left, ...Array.from({ length: fill }, () => '0'), ...right];
    } else {
      groups = addr.split(':');
    }
    if (groups.length !== 8) return null;
    let result = 0n;
    for (const g of groups) {
      const n = parseInt(g || '0', 16);
      if (isNaN(n) || n < 0 || n > 0xffff) return null;
      result = (result << 16n) | BigInt(n);
    }
    return result;
  } catch {
    return null;
  }
}

function isIpAllowed(clientIp: string, allowedIps: string[]): boolean {
  return allowedIps.some((cidr) => ipMatchesCidr(clientIp, cidr));
}

export const authGuard = new Elysia({ name: 'auth-guard' })
  .use(jwtAccessPlugin)
  .derive({ as: 'scoped' }, async ({ jwtAccess, headers, set, request, cookie }) => {
    // Extract token from cookie (browser) or Authorization header (API clients)
    const flatCookies = flattenElysiaCookies(cookie);

    const token = extractAccessToken(headers as Record<string, string | undefined>, flatCookies);

    if (!token) {
      set.status = 401;
      throw new Error('Missing authentication token (cookie or Authorization header)');
    }

    // CSRF check: only for cookie-based requests (no Authorization header)
    // and only for state-changing methods
    if (isCookieAuth(headers as Record<string, string | undefined>) && STATE_CHANGING_METHODS.has(request.method)) {
      if (!validateCsrfToken(headers as Record<string, string | undefined>, flatCookies)) {
        set.status = 403;
        throw new Error('Invalid or missing CSRF token');
      }
    }

    const raw = await jwtAccess.verify(token);

    if (!raw) {
      set.status = 401;
      throw new Error('Invalid or expired access token');
    }

    const decoded = raw as Record<string, unknown>;

    if (!decoded['sub']) {
      set.status = 401;
      throw new Error('Invalid or expired access token');
    }

    // Reject pending-2FA tokens from being used as full auth
    if (decoded['pending2fa']) {
      set.status = 401;
      throw new Error('2FA verification required');
    }

    // Check IP restriction
    const userId = decoded['sub'] as string;
    try {
      const { getUserAllowedIps } = await import('../admin/admin.service');
      const allowedIps = await getUserAllowedIps(userId);
      if (allowedIps && allowedIps.length > 0) {
        const clientIp = extractClientIp(request);

        if (!clientIp || !isIpAllowed(clientIp, allowedIps)) {
          set.status = 403;
          throw new Error('Access denied: your IP address is not allowed');
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('IP address is not allowed')) {
        throw err;
      }
      // Fail closed: if the IP-allowlist lookup itself fails, deny rather than
      // silently bypassing the restriction (fail-open would let a restricted
      // user through on a transient fetch error).
      set.status = 403;
      throw new Error('IP allowlist check failed');
    }

    const user = await findUserById(userId);

    if (!user?.tenantId) {
      set.status = 401;
      throw new Error('User has no tenant');
    }

    const { requiresMfaSetup } = await getMfaStatus(user);
    if (requiresMfaSetup) {
      set.status = 403;
      throw new Error('MFA setup required');
    }

    return {
      auth: {
        sub: decoded['sub'] as string,
        userId,
        tenantId: user.tenantId,
        email: decoded['email'] as string,
        role: decoded['role'] as string,
      } satisfies JwtPayload & { userId: string; tenantId: string },
    };
  });
