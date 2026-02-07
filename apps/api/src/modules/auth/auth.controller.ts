import { Elysia, t } from 'elysia';
import { jwtAccessPlugin, jwtRefreshPlugin, type JwtPayload } from './jwt.setup';
import {
  loginWithPassword,
  loginWithO365,
  registerUser,
  storeRefreshToken,
  clearRefreshToken,
  findUserById,
  generate2faSecret,
  enable2fa,
  disable2fa,
  verify2faToken,
} from './auth.service';
import type { ApiResponse } from '@fueld/types';

// ─── Helpers ─────────────────────────────────────────────────────────

/** Strip sensitive fields before returning a user in an API response. */
function sanitiseUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  is2faEnabled: boolean;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    is2faEnabled: user.is2faEnabled,
  };
}

/**
 * Extract a verified JWT payload or return null.
 * `@elysiajs/jwt` `.verify()` returns `false | ClaimType`.
 */
function extractPayload(
  decoded: false | Record<string, unknown>,
): JwtPayload | null {
  if (!decoded || !decoded['sub']) return null;
  return {
    sub: decoded['sub'] as string,
    email: decoded['email'] as string,
    role: decoded['role'] as string,
  };
}

/** Build a `JwtPayload` from a user record. */
function userToPayload(user: { id: string; email: string; role: string }): JwtPayload {
  return { sub: user.id, email: user.email, role: user.role };
}

// ─── Auth Controller ─────────────────────────────────────────────────

export const authController = new Elysia({ prefix: '/auth' })
  .use(jwtAccessPlugin)
  .use(jwtRefreshPlugin)

  // ── POST /auth/register ──────────────────────────────────────────
  .post(
    '/register',
    async ({ body, jwtAccess, jwtRefresh }) => {
      try {
        const user = await registerUser(body);
        const payload = userToPayload(user);

        const accessToken = await jwtAccess.sign(payload);
        const refreshToken = await jwtRefresh.sign(payload);

        await storeRefreshToken(user.id, refreshToken);

        return {
          success: true,
          data: {
            user: sanitiseUser(user),
            accessToken,
            refreshToken,
          },
        } satisfies ApiResponse<unknown>;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Registration failed';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String({ minLength: 8 }),
        name: t.String({ minLength: 1 }),
      }),
      detail: {
        tags: ['Auth'],
        summary: 'Register a new user (email/password)',
      },
    },
  )

  // ── POST /auth/login ─────────────────────────────────────────────
  .post(
    '/login',
    async ({ body, jwtAccess, jwtRefresh }) => {
      try {
        const { user, requires2fa } = await loginWithPassword(
          body.email,
          body.password,
        );

        // If 2FA is required, return a temporary token (sub only)
        // The client must call /auth/verify-2fa with this token + TOTP code
        if (requires2fa) {
          const tempToken = await jwtAccess.sign({
            sub: user.id,
            email: user.email,
            role: user.role,
            pending2fa: 'true',
          } satisfies JwtPayload);

          return {
            success: true,
            data: {
              requires2fa: true,
              tempToken,
            },
          } satisfies ApiResponse<unknown>;
        }

        const payload = userToPayload(user);

        const accessToken = await jwtAccess.sign(payload);
        const refreshToken = await jwtRefresh.sign(payload);

        await storeRefreshToken(user.id, refreshToken);

        return {
          success: true,
          data: {
            requires2fa: false,
            user: sanitiseUser(user),
            accessToken,
            refreshToken,
          },
        } satisfies ApiResponse<unknown>;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Login failed';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String({ minLength: 1 }),
      }),
      detail: {
        tags: ['Auth'],
        summary: 'Login with email and password',
      },
    },
  )

  // ── POST /auth/verify-2fa ────────────────────────────────────────
  .post(
    '/verify-2fa',
    async ({ body, jwtAccess, jwtRefresh }) => {
      try {
        // Decode the temp token to get the user ID
        const raw = await jwtAccess.verify(body.tempToken);
        const decoded = raw ? (raw as Record<string, unknown>) : null;
        if (!decoded || !decoded['sub'] || decoded['pending2fa'] !== 'true') {
          return {
            success: false,
            data: null,
            message: 'Invalid or expired temporary token',
          } satisfies ApiResponse<null>;
        }

        const userId = decoded['sub'] as string;
        const valid = await verify2faToken(userId, body.code);
        if (!valid) {
          return {
            success: false,
            data: null,
            message: 'Invalid 2FA code',
          } satisfies ApiResponse<null>;
        }

        const user = await findUserById(userId);
        if (!user) {
          return {
            success: false,
            data: null,
            message: 'User not found',
          } satisfies ApiResponse<null>;
        }

        const payload = userToPayload(user);

        const accessToken = await jwtAccess.sign(payload);
        const refreshToken = await jwtRefresh.sign(payload);

        await storeRefreshToken(user.id, refreshToken);

        return {
          success: true,
          data: {
            user: sanitiseUser(user),
            accessToken,
            refreshToken,
          },
        } satisfies ApiResponse<unknown>;
      } catch (err) {
        const message = err instanceof Error ? err.message : '2FA verification failed';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({
        tempToken: t.String(),
        code: t.String({ minLength: 6, maxLength: 6 }),
      }),
      detail: {
        tags: ['Auth'],
        summary: 'Verify TOTP 2FA code to complete login',
      },
    },
  )

  // ── POST /auth/login/sso ─────────────────────────────────────────
  .post(
    '/login/sso',
    async ({ body, jwtAccess, jwtRefresh }) => {
      try {
        const user = await loginWithO365(body.microsoftAccessToken);
        const payload = userToPayload(user);

        const accessToken = await jwtAccess.sign(payload);
        const refreshToken = await jwtRefresh.sign(payload);

        await storeRefreshToken(user.id, refreshToken);

        return {
          success: true,
          data: {
            user: sanitiseUser(user),
            accessToken,
            refreshToken,
          },
        } satisfies ApiResponse<unknown>;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'SSO login failed';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({
        microsoftAccessToken: t.String(),
      }),
      detail: {
        tags: ['Auth'],
        summary: 'Exchange a Microsoft O365 access token for a Fueld session',
      },
    },
  )

  // ── POST /auth/refresh ───────────────────────────────────────────
  .post(
    '/refresh',
    async ({ body, jwtAccess, jwtRefresh }) => {
      try {
        const decoded = extractPayload(await jwtRefresh.verify(body.refreshToken));
        if (!decoded) {
          return {
            success: false,
            data: null,
            message: 'Invalid or expired refresh token',
          } satisfies ApiResponse<null>;
        }

        const user = await findUserById(decoded.sub);

        if (!user || user.refreshToken !== body.refreshToken) {
          return {
            success: false,
            data: null,
            message: 'Refresh token revoked or invalid',
          } satisfies ApiResponse<null>;
        }

        const payload = userToPayload(user);

        const newAccessToken = await jwtAccess.sign(payload);
        const newRefreshToken = await jwtRefresh.sign(payload);

        // Rotate the refresh token in DB
        await storeRefreshToken(user.id, newRefreshToken);

        return {
          success: true,
          data: {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
          },
        } satisfies ApiResponse<unknown>;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Token refresh failed';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({
        refreshToken: t.String(),
      }),
      detail: {
        tags: ['Auth'],
        summary: 'Rotate an expired access token using a refresh token',
      },
    },
  )

  // ── POST /auth/logout ────────────────────────────────────────────
  .post(
    '/logout',
    async ({ body, jwtAccess }) => {
      try {
        const decoded = extractPayload(await jwtAccess.verify(body.accessToken));
        if (decoded) {
          await clearRefreshToken(decoded.sub);
        }
        return {
          success: true,
          data: null,
          message: 'Logged out',
        } satisfies ApiResponse<null>;
      } catch {
        return {
          success: true,
          data: null,
          message: 'Logged out',
        } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({
        accessToken: t.String(),
      }),
      detail: {
        tags: ['Auth'],
        summary: 'Logout and revoke the refresh token',
      },
    },
  )

  // ── POST /auth/2fa/generate ──────────────────────────────────────
  .post(
    '/2fa/generate',
    async ({ headers, jwtAccess }) => {
      try {
        const authHeader = headers['authorization'];
        if (!authHeader?.startsWith('Bearer ')) {
          return {
            success: false,
            data: null,
            message: 'Missing authorization header',
          } satisfies ApiResponse<null>;
        }

        const token = authHeader.slice(7);
        const decoded = extractPayload(await jwtAccess.verify(token));
        if (!decoded) {
          return {
            success: false,
            data: null,
            message: 'Invalid token',
          } satisfies ApiResponse<null>;
        }

        const { secret, qrDataUrl } = await generate2faSecret(decoded.sub);

        return {
          success: true,
          data: { secret, qrDataUrl },
        } satisfies ApiResponse<unknown>;
      } catch (err) {
        const message = err instanceof Error ? err.message : '2FA setup failed';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      detail: {
        tags: ['Auth'],
        summary: 'Generate a TOTP secret + QR code for Google Authenticator',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── POST /auth/2fa/enable ────────────────────────────────────────
  .post(
    '/2fa/enable',
    async ({ body, headers, jwtAccess }) => {
      try {
        const authHeader = headers['authorization'];
        if (!authHeader?.startsWith('Bearer ')) {
          return {
            success: false,
            data: null,
            message: 'Missing authorization header',
          } satisfies ApiResponse<null>;
        }

        const token = authHeader.slice(7);
        const decoded = extractPayload(await jwtAccess.verify(token));
        if (!decoded) {
          return {
            success: false,
            data: null,
            message: 'Invalid token',
          } satisfies ApiResponse<null>;
        }

        const enabled = await enable2fa(decoded.sub, body.code);
        if (!enabled) {
          return {
            success: false,
            data: null,
            message: 'Invalid TOTP code — 2FA not enabled',
          } satisfies ApiResponse<null>;
        }

        return {
          success: true,
          data: null,
          message: '2FA has been enabled',
        } satisfies ApiResponse<null>;
      } catch (err) {
        const message = err instanceof Error ? err.message : '2FA enable failed';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({
        code: t.String({ minLength: 6, maxLength: 6 }),
      }),
      detail: {
        tags: ['Auth'],
        summary: 'Verify TOTP code and enable 2FA on account',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── POST /auth/2fa/disable ───────────────────────────────────────
  .post(
    '/2fa/disable',
    async ({ body, headers, jwtAccess }) => {
      try {
        const authHeader = headers['authorization'];
        if (!authHeader?.startsWith('Bearer ')) {
          return {
            success: false,
            data: null,
            message: 'Missing authorization header',
          } satisfies ApiResponse<null>;
        }

        const token = authHeader.slice(7);
        const decoded = extractPayload(await jwtAccess.verify(token));
        if (!decoded) {
          return {
            success: false,
            data: null,
            message: 'Invalid token',
          } satisfies ApiResponse<null>;
        }

        const disabled = await disable2fa(decoded.sub, body.code);
        if (!disabled) {
          return {
            success: false,
            data: null,
            message: 'Invalid TOTP code — 2FA not disabled',
          } satisfies ApiResponse<null>;
        }

        return {
          success: true,
          data: null,
          message: '2FA has been disabled',
        } satisfies ApiResponse<null>;
      } catch (err) {
        const message = err instanceof Error ? err.message : '2FA disable failed';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({
        code: t.String({ minLength: 6, maxLength: 6 }),
      }),
      detail: {
        tags: ['Auth'],
        summary: 'Verify TOTP code and disable 2FA on account',
        security: [{ bearerAuth: [] }],
      },
    },
  );
