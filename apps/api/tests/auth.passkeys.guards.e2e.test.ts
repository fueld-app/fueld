import { beforeEach, describe, expect, it } from 'bun:test';
import * as OTPAuth from 'otpauth';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

describe('auth passkeys guard/error e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('covers missing-header and invalid-token branches for passkey management endpoints', async () => {
    const missingRegisterOptions = await requestJson('/auth/passkeys/register-options', {
      method: 'POST',
    });
    expect(missingRegisterOptions.status).toBe(200);
    expect(missingRegisterOptions.data?.success).toBe(false);
    expect(String(missingRegisterOptions.data?.message ?? '')).toContain('Missing authorization header');

    const invalidRegisterOptions = await requestJson('/auth/passkeys/register-options', {
      method: 'POST',
      token: 'not-a-real-token',
    });
    expect(invalidRegisterOptions.status).toBe(200);
    expect(invalidRegisterOptions.data?.success).toBe(false);
    expect(String(invalidRegisterOptions.data?.message ?? '')).toContain('Invalid token');

    const missingRegisterVerify = await requestJson('/auth/passkeys/register-verify', {
      method: 'POST',
      body: { friendlyName: 'My key', attestationResponse: {} },
    });
    expect(missingRegisterVerify.status).toBe(200);
    expect(missingRegisterVerify.data?.success).toBe(false);
    expect(String(missingRegisterVerify.data?.message ?? '')).toContain('Missing authorization header');

    const invalidRegisterVerify = await requestJson('/auth/passkeys/register-verify', {
      method: 'POST',
      token: 'not-a-real-token',
      body: { friendlyName: 'My key', attestationResponse: {} },
    });
    expect(invalidRegisterVerify.status).toBe(200);
    expect(invalidRegisterVerify.data?.success).toBe(false);
    expect(String(invalidRegisterVerify.data?.message ?? '')).toContain('Invalid token');

    const missingRename = await requestJson('/auth/passkeys/123e4567-e89b-12d3-a456-426614174000', {
      method: 'PUT',
      body: { friendlyName: 'Renamed' },
    });
    expect(missingRename.status).toBe(200);
    expect(missingRename.data?.success).toBe(false);
    expect(String(missingRename.data?.message ?? '')).toContain('Missing authorization header');

    const invalidRename = await requestJson('/auth/passkeys/123e4567-e89b-12d3-a456-426614174000', {
      method: 'PUT',
      token: 'not-a-real-token',
      body: { friendlyName: 'Renamed' },
    });
    expect(invalidRename.status).toBe(200);
    expect(invalidRename.data?.success).toBe(false);
    expect(String(invalidRename.data?.message ?? '')).toContain('Invalid token');

    const missingDelete = await requestJson('/auth/passkeys/123e4567-e89b-12d3-a456-426614174000', {
      method: 'DELETE',
    });
    expect(missingDelete.status).toBe(200);
    expect(missingDelete.data?.success).toBe(false);
    expect(String(missingDelete.data?.message ?? '')).toContain('Missing authorization header');

    const invalidDelete = await requestJson('/auth/passkeys/123e4567-e89b-12d3-a456-426614174000', {
      method: 'DELETE',
      token: 'not-a-real-token',
    });
    expect(invalidDelete.status).toBe(200);
    expect(invalidDelete.data?.success).toBe(false);
    expect(String(invalidDelete.data?.message ?? '')).toContain('Invalid token');
  });

  it('returns disabled response for passwordless passkey login when feature is off', async () => {
    const res = await requestJson('/auth/login/passkey', {
      method: 'POST',
      body: {
        email: 'anyone@test.local',
        assertionResponse: {},
      },
    });

    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(false);
    expect(String(res.data?.message ?? '')).toContain('Passwordless passkey login is not enabled');
  });

  it('returns no-passkeys branch for /auth/passkeys/auth-options-2fa', async () => {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const adminLogin = await loginE2E(seeded.user.email, seeded.password);
    const adminToken = adminLogin.accessToken;

    const security = await requestJson('/admin/security', {
      method: 'PUT',
      token: adminToken,
      body: {
        passkeyEnabled: true,
        passkeyAllowPasswordless: true,
      },
    });
    expect(security.status).toBe(200);
    expect(security.data?.success).toBe(true);

    const generate2fa = await requestJson('/auth/2fa/generate', {
      method: 'POST',
      token: adminToken,
    });
    expect(generate2fa.status).toBe(200);
    expect(generate2fa.data?.success).toBe(true);

    const secret = String(generate2fa.data?.data?.secret ?? '');
    const totp = new OTPAuth.TOTP({
      issuer: 'Fueld',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    const enable2fa = await requestJson('/auth/2fa/enable', {
      method: 'POST',
      token: adminToken,
      body: { code: totp.generate() },
    });
    expect(enable2fa.status).toBe(200);
    expect(enable2fa.data?.success).toBe(true);

    const login2 = await loginE2E(seeded.user.email, seeded.password);
    expect(login2.status).toBe(200);
    expect(login2.data?.success).toBe(true);
    expect(login2.data?.data?.requires2fa).toBe(true);

    const tempToken = String(login2.data?.data?.tempToken ?? '');
    expect(tempToken).toBeTruthy();

    const options2fa = await requestJson('/auth/passkeys/auth-options-2fa', {
      method: 'POST',
      body: { tempToken },
    });

    expect(options2fa.status).toBe(200);
    expect(options2fa.data?.success).toBe(false);
    expect(String(options2fa.data?.message ?? '')).toContain('No passkeys registered for this account');
  });
});
