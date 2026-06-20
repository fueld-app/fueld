import { Elysia } from 'elysia';
import jwt from '@elysiajs/jwt';
import { isProductionRuntime } from '../../lib/crypto';

// ─── JWT Plugin (dual-token pattern) ─────────────────────────────────
// Access Token  → 15 min, stateless bearer for API calls
// Refresh Token → 7 days, stored in DB, used to rotate access tokens

const DEV_ACCESS_SECRET = 'dev-access-secret';
const DEV_REFRESH_SECRET = 'dev-refresh-secret';

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
