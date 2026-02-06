import { Elysia } from 'elysia';
import jwt from '@elysiajs/jwt';

// ─── JWT Plugin (dual-token pattern) ─────────────────────────────────
// Access Token  → 15 min, stateless bearer for API calls
// Refresh Token → 7 days, stored in DB, used to rotate access tokens

export const jwtAccessPlugin = new Elysia({ name: 'jwt-access' }).use(
  jwt({
    name: 'jwtAccess',
    secret: process.env['JWT_ACCESS_SECRET'] || 'dev-access-secret',
    exp: '15m',
  }),
);

export const jwtRefreshPlugin = new Elysia({ name: 'jwt-refresh' }).use(
  jwt({
    name: 'jwtRefresh',
    secret: process.env['JWT_REFRESH_SECRET'] || 'dev-refresh-secret',
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
