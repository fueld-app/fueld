import { Elysia, t } from 'elysia';
import { join } from 'path';
import { jwtAccessPlugin, jwtRefreshPlugin, type JwtPayload } from './jwt.setup';
import {
  loginWithPassword,
  loginWithO365,
  registerUser,
  storeRefreshToken,
  clearRefreshToken,
  findUserById,
  findUserByEmail,
  getAuthEnforcement,
  generate2faSecret,
  enable2fa,
  disable2fa,
  verify2faToken,
} from './auth.service';
import { resetPasswordWithToken } from './password-reset.service';
import {
  listPasskeys,
  renamePasskey,
  deletePasskey,
  isPasskeyEnabled,
  userHasPasskeys,
  generatePasskeyRegistrationOptions,
  verifyAndStorePasskey,
  generatePasskeyAuthenticationOptions,
  verifyPasskeyAuthentication,
} from './passkey.service';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import type { ApiResponse } from '@fueld/types';

// ─── Helpers ─────────────────────────────────────────────────────────

/** Strip sensitive fields before returning a user in an API response. */
function sanitiseUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string | null;
  is2faEnabled: boolean;
  isActive: boolean;
  isOnLeave: boolean;
  leaveEndDate: string | null;
  delegateId: string | null;
  avatarUrl?: string | null;
  phone?: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
    is2faEnabled: user.is2faEnabled,
    isActive: user.isActive,
    isOnLeave: user.isOnLeave,
    leaveEndDate: user.leaveEndDate,
    delegateId: user.delegateId,
    avatarUrl: user.avatarUrl ?? null,
    phone: user.phone ?? null,
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
function userToPayload(user: { id: string; email: string; name: string; role: string }): JwtPayload {
  return { sub: user.id, email: user.email, name: user.name, role: user.role };
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
            requiresMfaSetup: false,
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
        const { user } = await loginWithPassword(
          body.email,
          body.password,
        );

        // Block deactivated users
        if (!user.isActive) {
          return {
            success: false,
            data: null,
            message: 'Your account has been deactivated. Contact an admin.',
          } satisfies ApiResponse<null>;
        }

        const passkeyConfig = await isPasskeyEnabled();
        const hasKeys = passkeyConfig.enabled && await userHasPasskeys(user.id);
        const enforcement = await getAuthEnforcement();
        const requires2fa = user.is2faEnabled && !hasKeys;
        const requiresMfaSetup = enforcement.enforce2FA && !user.is2faEnabled && !hasKeys;

        // If 2FA is required, return a temporary token (sub only)
        // The client must call /auth/verify-2fa with this token + TOTP code
        if (requires2fa) {
          const tempToken = await jwtAccess.sign({
            sub: user.id,
            email: user.email,
            role: user.role,
            pending2fa: 'true',
          } satisfies JwtPayload);

          // Check if the user has passkeys (so the 2FA page can show "Use Passkey")
          return {
            success: true,
            data: {
              requires2fa: true,
              tempToken,
              hasPasskeys: hasKeys,
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
            requiresMfaSetup,
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

  // ── POST /auth/password-reset — complete reset using emailed token ──
  .post(
    '/password-reset',
    async ({ body }) => {
      try {
        await resetPasswordWithToken({
          token: body.token,
          newPassword: body.password,
        });

        return {
          success: true,
          data: null,
          message: 'Password has been reset',
        } satisfies ApiResponse<null>;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Password reset failed';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({
        token: t.String({ minLength: 1 }),
        password: t.String({ minLength: 8 }),
      }),
      detail: {
        tags: ['Auth'],
        summary: 'Reset password using a reset token',
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
            requiresMfaSetup: false,
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

  // ── POST /auth/verify-passkey ────────────────────────────────────
  // Step 2 of 2FA passkey flow: verify the assertion from the browser
  .post(
    '/verify-passkey',
    async ({ body, jwtAccess, jwtRefresh }) => {
      try {
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

        // Check passkeys are enabled
        const config = await isPasskeyEnabled();
        if (!config.enabled) {
          return {
            success: false,
            data: null,
            message: 'Passkey authentication is not enabled',
          } satisfies ApiResponse<null>;
        }

        const verified = await verifyPasskeyAuthentication(userId, body.assertionResponse);
        if (!verified) {
          return {
            success: false,
            data: null,
            message: 'Passkey verification failed',
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
        const message = err instanceof Error ? err.message : 'Passkey verification failed';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({
        tempToken: t.String(),
        assertionResponse: t.Any(),
      }),
      detail: {
        tags: ['Auth'],
        summary: 'Verify 2FA using a registered passkey (WebAuthn assertion)',
      },
    },
  )

  // ── POST /auth/passkeys/auth-options ──────────────────────────────
  // Step 1 of passwordless passkey login: generate an authentication challenge
  .post(
    '/passkeys/auth-options',
    async ({ body }) => {
      try {
        const config = await isPasskeyEnabled();
        if (!config.enabled || !config.allowPasswordless) {
          return {
            success: false,
            data: null,
            message: 'Passwordless passkey login is not enabled',
          } satisfies ApiResponse<null>;
        }

        const result = await generatePasskeyAuthenticationOptions({ email: body.email });
        if (!result) {
          return { success: false, data: null, message: 'No passkeys registered for this account' } satisfies ApiResponse<null>;
        }
        return { success: true, data: result.options } satisfies ApiResponse<typeof result.options>;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate passkey options';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
      }),
      detail: {
        tags: ['Auth'],
        summary: 'Generate WebAuthn authentication options for passwordless login',
      },
    },
  )

  // ── POST /auth/passkeys/auth-options-2fa ────────────────────────
  // Step 1 of 2FA passkey flow: generate an authentication challenge
  .post(
    '/passkeys/auth-options-2fa',
    async ({ body, jwtAccess }) => {
      try {
        const config = await isPasskeyEnabled();
        if (!config.enabled) {
          return {
            success: false,
            data: null,
            message: 'Passkey authentication is not enabled',
          } satisfies ApiResponse<null>;
        }

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
        const result = await generatePasskeyAuthenticationOptions({ userId });
        if (!result) {
          return { success: false, data: null, message: 'No passkeys registered for this account' } satisfies ApiResponse<null>;
        }
        return { success: true, data: result.options } satisfies ApiResponse<typeof result.options>;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate passkey options';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({
        tempToken: t.String(),
      }),
      detail: {
        tags: ['Auth'],
        summary: 'Generate WebAuthn authentication options for 2FA passkey verification',
      },
    },
  )

  // ── POST /auth/login/passkey ─────────────────────────────────────
  // Step 2 of passwordless login: verify the assertion response
  .post(
    '/login/passkey',
    async ({ body, jwtAccess, jwtRefresh }) => {
      try {
        const config = await isPasskeyEnabled();
        if (!config.enabled || !config.allowPasswordless) {
          return {
            success: false,
            data: null,
            message: 'Passwordless passkey login is not enabled',
          } satisfies ApiResponse<null>;
        }

        // Look up user by email
        const userRecord = await findUserByEmail(body.email);
        if (!userRecord) {
          return {
            success: false,
            data: null,
            message: 'User not found',
          } satisfies ApiResponse<null>;
        }

        if (!userRecord.isActive) {
          return {
            success: false,
            data: null,
            message: 'Your account has been deactivated. Contact an admin.',
          } satisfies ApiResponse<null>;
        }

        const verified = await verifyPasskeyAuthentication(userRecord.id, body.assertionResponse);
        if (!verified) {
          return {
            success: false,
            data: null,
            message: 'Passkey authentication failed',
          } satisfies ApiResponse<null>;
        }

        const user = await findUserById(userRecord.id);
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
            requires2fa: false,
            user: sanitiseUser(user),
            accessToken,
            refreshToken,
            requiresMfaSetup: false,
          },
        } satisfies ApiResponse<unknown>;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Passkey login failed';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        assertionResponse: t.Any(),
      }),
      detail: {
        tags: ['Auth'],
        summary: 'Verify WebAuthn assertion for passwordless login',
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
  )

  // ── GET /auth/passkeys — list user's passkeys ──────────────────────
  .get(
    '/passkeys',
    async ({ headers, jwtAccess }) => {
      try {
        const authHeader = headers['authorization'];
        if (!authHeader?.startsWith('Bearer ')) {
          return { success: false, data: null, message: 'Missing authorization header' } satisfies ApiResponse<null>;
        }
        const token = authHeader.slice(7);
        const decoded = extractPayload(await jwtAccess.verify(token));
        if (!decoded) {
          return { success: false, data: null, message: 'Invalid token' } satisfies ApiResponse<null>;
        }
        const keys = await listPasskeys(decoded.sub);
        return { success: true, data: keys } satisfies ApiResponse<typeof keys>;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to list passkeys';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      detail: { tags: ['Auth'], summary: 'List all passkeys for the current user', security: [{ bearerAuth: [] }] },
    },
  )

  // ── POST /auth/passkeys/register-options — generate registration challenge ──
  .post(
    '/passkeys/register-options',
    async ({ headers, jwtAccess }) => {
      try {
        const authHeader = headers['authorization'];
        if (!authHeader?.startsWith('Bearer ')) {
          return { success: false, data: null, message: 'Missing authorization header' } satisfies ApiResponse<null>;
        }
        const token = authHeader.slice(7);
        const decoded = extractPayload(await jwtAccess.verify(token));
        if (!decoded) {
          return { success: false, data: null, message: 'Invalid token' } satisfies ApiResponse<null>;
        }
        const user = await findUserById(decoded.sub);
        if (!user) {
          return { success: false, data: null, message: 'User not found' } satisfies ApiResponse<null>;
        }
        const options = await generatePasskeyRegistrationOptions(user.id, user.email, user.name);
        return { success: true, data: options } satisfies ApiResponse<typeof options>;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate registration options';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      detail: { tags: ['Auth'], summary: 'Generate WebAuthn registration options', security: [{ bearerAuth: [] }] },
    },
  )

  // ── POST /auth/passkeys/register-verify — verify attestation and store passkey ──
  .post(
    '/passkeys/register-verify',
    async ({ body, headers, jwtAccess }) => {
      try {
        const authHeader = headers['authorization'];
        if (!authHeader?.startsWith('Bearer ')) {
          return { success: false, data: null, message: 'Missing authorization header' } satisfies ApiResponse<null>;
        }
        const token = authHeader.slice(7);
        const decoded = extractPayload(await jwtAccess.verify(token));
        if (!decoded) {
          return { success: false, data: null, message: 'Invalid token' } satisfies ApiResponse<null>;
        }
        const passkey = await verifyAndStorePasskey(
          decoded.sub,
          body.friendlyName,
          body.attestationResponse as RegistrationResponseJSON,
        );
        return { success: true, data: passkey } satisfies ApiResponse<typeof passkey>;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to register passkey';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({
        friendlyName: t.String({ minLength: 1, maxLength: 100 }),
        attestationResponse: t.Any(),
      }),
      detail: { tags: ['Auth'], summary: 'Verify WebAuthn attestation and store passkey', security: [{ bearerAuth: [] }] },
    },
  )

  // ── PUT /auth/passkeys/:id — rename a passkey ──────────────────────
  .put(
    '/passkeys/:id',
    async ({ params, body, headers, jwtAccess }) => {
      try {
        const authHeader = headers['authorization'];
        if (!authHeader?.startsWith('Bearer ')) {
          return { success: false, data: null, message: 'Missing authorization header' } satisfies ApiResponse<null>;
        }
        const token = authHeader.slice(7);
        const decoded = extractPayload(await jwtAccess.verify(token));
        if (!decoded) {
          return { success: false, data: null, message: 'Invalid token' } satisfies ApiResponse<null>;
        }
        const ok = await renamePasskey(decoded.sub, params.id, body.friendlyName);
        if (!ok) {
          return { success: false, data: null, message: 'Passkey not found' } satisfies ApiResponse<null>;
        }
        return { success: true, data: null, message: 'Passkey renamed' } satisfies ApiResponse<null>;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to rename passkey';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({ friendlyName: t.String({ minLength: 1, maxLength: 100 }) }),
      detail: { tags: ['Auth'], summary: 'Rename a passkey', security: [{ bearerAuth: [] }] },
    },
  )

  // ── DELETE /auth/passkeys/:id — delete a passkey ───────────────────
  .delete(
    '/passkeys/:id',
    async ({ params, headers, jwtAccess }) => {
      try {
        const authHeader = headers['authorization'];
        if (!authHeader?.startsWith('Bearer ')) {
          return { success: false, data: null, message: 'Missing authorization header' } satisfies ApiResponse<null>;
        }
        const token = authHeader.slice(7);
        const decoded = extractPayload(await jwtAccess.verify(token));
        if (!decoded) {
          return { success: false, data: null, message: 'Invalid token' } satisfies ApiResponse<null>;
        }
        const ok = await deletePasskey(decoded.sub, params.id);
        if (!ok) {
          return { success: false, data: null, message: 'Passkey not found' } satisfies ApiResponse<null>;
        }
        return { success: true, data: null, message: 'Passkey deleted' } satisfies ApiResponse<null>;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete passkey';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      detail: { tags: ['Auth'], summary: 'Delete a passkey', security: [{ bearerAuth: [] }] },
    },
  )

  // ══════════════════════════════════════════════════════════════════
  //  PROFILE
  // ══════════════════════════════════════════════════════════════════

  // ── PATCH /auth/phone — update user phone number ───────────────────
  .patch(
    '/phone',
    async ({ body, headers, jwtAccess }) => {
      try {
        const authHeader = headers['authorization'];
        if (!authHeader?.startsWith('Bearer ')) {
          return { success: false, data: null, message: 'Missing authorization header' } satisfies ApiResponse<null>;
        }
        const decoded = extractPayload(await jwtAccess.verify(authHeader.slice(7)));
        if (!decoded) {
          return { success: false, data: null, message: 'Invalid token' } satisfies ApiResponse<null>;
        }

        const phone = body.phone?.trim() || null;

        const { db } = await import('../../db');
        const { users } = await import('../../db/schema');
        const { eq } = await import('drizzle-orm');
        await db.update(users).set({ phone, updatedAt: new Date() }).where(eq(users.id, decoded.sub));

        const user = await findUserById(decoded.sub);
        if (!user) {
          return { success: false, data: null, message: 'User not found' } satisfies ApiResponse<null>;
        }
        return { success: true, data: { user: sanitiseUser(user) } } satisfies ApiResponse<any>;
      } catch (err) {
        console.error('[Profile] Phone update failed:', err);
        return { success: false, data: null, message: 'Failed to update phone number' } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({ phone: t.Union([t.String(), t.Null()]) }),
      detail: { tags: ['Auth'], summary: 'Update user phone number', security: [{ bearerAuth: [] }] },
    },
  )

  // ══════════════════════════════════════════════════════════════════
  //  AVATAR
  // ══════════════════════════════════════════════════════════════════

  // ── PUT /auth/avatar — upload user avatar ──────────────────────────
  .put(
    '/avatar',
    async ({ body, headers, jwtAccess }) => {
      try {
        const authHeader = headers['authorization'];
        if (!authHeader?.startsWith('Bearer ')) {
          return { success: false, data: null, message: 'Missing authorization header' } satisfies ApiResponse<null>;
        }
        const decoded = extractPayload(await jwtAccess.verify(authHeader.slice(7)));
        if (!decoded) {
          return { success: false, data: null, message: 'Invalid token' } satisfies ApiResponse<null>;
        }

        const file = body.avatar;
        if (!file || !(file instanceof Blob)) {
          return { success: false, data: null, message: 'No file provided' } satisfies ApiResponse<null>;
        }

        // Validate type
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!allowed.includes(file.type)) {
          return { success: false, data: null, message: 'Only JPEG, PNG, WebP or GIF allowed' } satisfies ApiResponse<null>;
        }

        // Max 2MB
        if (file.size > 2 * 1024 * 1024) {
          return { success: false, data: null, message: 'File too large (max 2MB)' } satisfies ApiResponse<null>;
        }

        const ext = file.type.split('/')[1] === 'jpeg' ? 'jpg' : file.type.split('/')[1];
        const filename = `${decoded.sub}.${ext}`;
        const uploadDir = join(import.meta.dir, '../../../uploads/avatars');
        const filepath = join(uploadDir, filename);

        // Delete old avatar files for this user
        const { readdirSync, unlinkSync } = await import('fs');
        try {
          for (const f of readdirSync(uploadDir)) {
            if (f.startsWith(decoded.sub + '.')) {
              unlinkSync(join(uploadDir, f));
            }
          }
        } catch { /* dir may not exist yet */ }

        // Write new file
        await Bun.write(filepath, file);

        // Update user record
        const avatarUrl = `/uploads/avatars/${filename}`;
        const { db } = await import('../../db');
        const { users } = await import('../../db/schema');
        const { eq } = await import('drizzle-orm');
        await db.update(users).set({ avatarUrl, updatedAt: new Date() }).where(eq(users.id, decoded.sub));

        // Return updated user
        const user = await findUserById(decoded.sub);
        if (!user) {
          return { success: false, data: null, message: 'User not found' } satisfies ApiResponse<null>;
        }
        return { success: true, data: { user: sanitiseUser(user), avatarUrl } } satisfies ApiResponse<any>;
      } catch (err) {
        console.error('[Avatar] Upload failed:', err);
        return { success: false, data: null, message: 'Failed to upload avatar' } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({ avatar: t.File() }),
      detail: { tags: ['Auth'], summary: 'Upload user avatar', security: [{ bearerAuth: [] }] },
    },
  )

  // ── DELETE /auth/avatar — remove user avatar ───────────────────────
  .delete(
    '/avatar',
    async ({ headers, jwtAccess }) => {
      try {
        const authHeader = headers['authorization'];
        if (!authHeader?.startsWith('Bearer ')) {
          return { success: false, data: null, message: 'Missing authorization header' } satisfies ApiResponse<null>;
        }
        const decoded = extractPayload(await jwtAccess.verify(authHeader.slice(7)));
        if (!decoded) {
          return { success: false, data: null, message: 'Invalid token' } satisfies ApiResponse<null>;
        }

        // Delete avatar files
        const uploadDir = join(import.meta.dir, '../../../uploads/avatars');
        const { readdirSync, unlinkSync } = await import('fs');
        try {
          for (const f of readdirSync(uploadDir)) {
            if (f.startsWith(decoded.sub + '.')) {
              unlinkSync(join(uploadDir, f));
            }
          }
        } catch { /* ok */ }

        // Clear avatar URL in DB
        const { db } = await import('../../db');
        const { users } = await import('../../db/schema');
        const { eq } = await import('drizzle-orm');
        await db.update(users).set({ avatarUrl: null, updatedAt: new Date() }).where(eq(users.id, decoded.sub));

        return { success: true, data: null, message: 'Avatar removed' } satisfies ApiResponse<null>;
      } catch (err) {
        return { success: false, data: null, message: 'Failed to remove avatar' } satisfies ApiResponse<null>;
      }
    },
    {
      detail: { tags: ['Auth'], summary: 'Remove user avatar', security: [{ bearerAuth: [] }] },
    },
  );
