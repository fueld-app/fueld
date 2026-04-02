import { Elysia } from 'elysia';
import { jwtAccessPlugin, type JwtPayload } from './jwt.setup';
import { findUserById, getMfaStatus } from './auth.service';
import { extractClientIp } from '../../utils/client-ip';

// ─── Auth Guard ──────────────────────────────────────────────────────
// Reusable Elysia plugin that protects routes.
// Any route that `.use(authGuard)` will:
//   1. Require a `Bearer <token>` header
//   2. Verify + decode the JWT
//   3. Check IP restriction (if configured for user)
//   4. Expose `auth` on the context ({ sub, email, role })
// ─────────────────────────────────────────────────────────────────────

/** Check if an IP matches a CIDR range or exact IP */
function ipMatchesCidr(ip: string, cidr: string): boolean {
  // Exact match
  if (ip === cidr) return true;

  // CIDR notation
  const parts = cidr.split('/');
  if (parts.length !== 2) return false;
  const [baseIp, prefixStr] = parts;
  const prefix = parseInt(prefixStr!, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const ipNum = ipToNumber(ip);
  const baseNum = ipToNumber(baseIp!);
  if (ipNum === null || baseNum === null) return false;

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (baseNum & mask);
}

function ipToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    const n = parseInt(part!, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0;
}

function isIpAllowed(clientIp: string, allowedIps: string[]): boolean {
  return allowedIps.some((cidr) => ipMatchesCidr(clientIp, cidr));
}

export const authGuard = new Elysia({ name: 'auth-guard' })
  .use(jwtAccessPlugin)
  .derive({ as: 'scoped' }, async ({ jwtAccess, headers, set, request }) => {
    const authHeader = headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      set.status = 401;
      throw new Error('Missing or malformed Authorization header');
    }

    const token = authHeader.slice(7);
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
      // If getUserAllowedIps fails (e.g. user deleted), let it through to fail on other checks
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
