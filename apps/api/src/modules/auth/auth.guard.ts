import { Elysia } from 'elysia';
import { jwtAccessPlugin, type JwtPayload } from './jwt.setup';

// ─── Auth Guard ──────────────────────────────────────────────────────
// Reusable Elysia plugin that protects routes.
// Any route that `.use(authGuard)` will:
//   1. Require a `Bearer <token>` header
//   2. Verify + decode the JWT
//   3. Expose `auth` on the context ({ sub, email, role })
// ─────────────────────────────────────────────────────────────────────

export const authGuard = new Elysia({ name: 'auth-guard' })
  .use(jwtAccessPlugin)
  .derive(async ({ jwtAccess, headers, set }) => {
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

    return {
      auth: {
        sub: decoded['sub'] as string,
        email: decoded['email'] as string,
        role: decoded['role'] as string,
      } satisfies JwtPayload,
    };
  });
