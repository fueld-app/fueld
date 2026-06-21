import { beforeEach, describe, expect, it } from 'bun:test';
import * as OTPAuth from 'otpauth';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson, requestRaw } from './helpers/e2e';

describe('auth advanced e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('runs full 2FA generate/enable/login-verify/disable lifecycle', async () => {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    const login = await loginE2E(seeded.user.email, seeded.password);
    const accessToken = login.accessToken;

    expect(accessToken).toBeTruthy();

    const generate = await requestJson('/auth/2fa/generate', {
      method: 'POST',
      token: accessToken,
    });

    expect(generate.status).toBe(200);
    expect(generate.data?.success).toBe(true);
    expect(generate.data?.data?.secret).toBeTruthy();
    expect(String(generate.data?.data?.qrDataUrl ?? '')).toContain('data:image/png;base64,');

    const secret = generate.data?.data?.secret as string;
    const totp = new OTPAuth.TOTP({
      issuer: 'Fueld',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    const enable = await requestJson('/auth/2fa/enable', {
      method: 'POST',
      token: accessToken,
      body: { code: totp.generate() },
    });

    expect(enable.status).toBe(200);
    expect(enable.data?.success).toBe(true);

    const [enabledUser] = await db.select().from(users).where(eq(users.id, seeded.user.id)).limit(1);
    expect(enabledUser?.is2faEnabled).toBe(true);

    const login2 = await loginE2E(seeded.user.email, seeded.password);
    expect(login2.status).toBe(200);
    expect(login2.data?.success).toBe(true);
    expect(login2.data?.data?.requires2fa).toBe(true);
    expect(login2.data?.data?.tempToken).toBeTruthy();

    const verify = await requestJson('/auth/verify-2fa', {
      method: 'POST',
      body: {
        tempToken: login2.data?.data?.tempToken,
        code: totp.generate(),
      },
    });

    expect(verify.status).toBe(200);
    expect(verify.data?.success).toBe(true);
    expect(verify.data?.data?.accessToken).toBeTruthy();

    const disable = await requestJson('/auth/2fa/disable', {
      method: 'POST',
      token: verify.data?.data?.accessToken,
      body: { code: totp.generate() },
    });

    expect(disable.status).toBe(200);
    expect(disable.data?.success).toBe(true);

    const [disabledUser] = await db.select().from(users).where(eq(users.id, seeded.user.id)).limit(1);
    expect(disabledUser?.is2faEnabled).toBe(false);
    expect(disabledUser?.twoFactorSecret).toBeNull();
  });

  it('handles avatar upload validation and remove flow', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const badForm = new FormData();
    badForm.set('avatar', new File(['not-image'], 'avatar.txt', { type: 'text/plain' }));

    const badUpload = await requestRaw('/auth/avatar', {
      method: 'PUT',
      token,
      body: badForm,
    });

    expect(badUpload.status).toBe(200);
    expect((badUpload.data as any)?.success).toBe(false);
    expect(String((badUpload.data as any)?.message ?? '')).toContain('Only JPEG, PNG, WebP or GIF');

    const okForm = new FormData();
    okForm.set('avatar', new File([new Uint8Array([137, 80, 78, 71])], 'avatar.png', { type: 'image/png' }));

    const okUpload = await requestRaw('/auth/avatar', {
      method: 'PUT',
      token,
      body: okForm,
    });

    expect(okUpload.status).toBe(200);
    expect((okUpload.data as any)?.success).toBe(true);
    expect(String((okUpload.data as any)?.data?.avatarUrl ?? '')).toContain('/uploads/avatars/');

    const removed = await requestJson('/auth/avatar', {
      method: 'DELETE',
      token,
    });

    expect(removed.status).toBe(200);
    expect(removed.data?.success).toBe(true);
  });

  it('returns passkey passwordless disabled response by default', async () => {
    const seeded = await seedAuthBasics();

    const res = await requestJson('/auth/passkeys/auth-options', {
      method: 'POST',
      body: { email: seeded.user.email },
    });

    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(false);
    expect(String(res.data?.message ?? '')).toContain('Passwordless passkey login is not enabled');
  });

  it('returns auth errors for missing auth headers on protected auth endpoints', async () => {
    const generate = await requestJson('/auth/2fa/generate', { method: 'POST' });
    expect(generate.status).toBe(200);
    expect(generate.data?.success).toBe(false);
    expect(String(generate.data?.message ?? '')).toContain('Missing authentication token');

    const passkeys = await requestJson('/auth/passkeys', { method: 'GET' });
    expect(passkeys.status).toBe(200);
    expect(passkeys.data?.success).toBe(false);
    expect(String(passkeys.data?.message ?? '')).toContain('Missing authentication token');
  });

  it('covers invalid-token and revoked-token auth branches', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);

    const refreshInvalid = await requestJson('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: 'not-a-real-token' },
    });
    expect(refreshInvalid.status).toBe(200);
    expect(refreshInvalid.data?.success).toBe(false);
    expect(String(refreshInvalid.data?.message ?? '')).toContain('Invalid or expired refresh token');

    const passkeysInvalid = await requestJson('/auth/passkeys', {
      method: 'GET',
      token: 'not-a-real-token',
    });
    expect(passkeysInvalid.status).toBe(200);
    expect(passkeysInvalid.data?.success).toBe(false);
    expect(String(passkeysInvalid.data?.message ?? '')).toContain('Invalid token');

    const logoutInvalid = await requestJson('/auth/logout', {
      method: 'POST',
      body: { accessToken: 'not-a-real-token' },
    });
    expect(logoutInvalid.status).toBe(200);
    expect(logoutInvalid.data?.success).toBe(true);

    const logoutValid = await requestJson('/auth/logout', {
      method: 'POST',
      body: { accessToken: login.accessToken },
    });
    expect(logoutValid.status).toBe(200);
    expect(logoutValid.data?.success).toBe(true);

    const refreshRevoked = await requestJson('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: login.refreshToken },
    });
    expect(refreshRevoked.status).toBe(200);
    expect(refreshRevoked.data?.success).toBe(false);
    expect(String(refreshRevoked.data?.message ?? '')).toContain('Refresh token revoked or invalid');
  });
});
