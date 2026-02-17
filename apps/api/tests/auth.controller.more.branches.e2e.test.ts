import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as OTPAuth from 'otpauth';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

const originalFetch = globalThis.fetch;

describe('auth controller more branches e2e', () => {
  beforeEach(async () => {
    await truncateAll();
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function promoteToAdminAndLogin(userId: string, email: string, password: string) {
    const db = await getDb();
    await db.update(users).set({ role: 'ADMIN', updatedAt: new Date() }).where(eq(users.id, userId));
    return loginE2E(email, password);
  }

  it('covers successful /auth/login/sso branch', async () => {
    globalThis.fetch = ((async () =>
      new Response(
        JSON.stringify({
          id: 'ms-sso-1',
          displayName: 'SSO User',
          mail: 'sso-user@test.local',
          userPrincipalName: 'sso-user@test.local',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as unknown) as typeof fetch;

    const res = await requestJson('/auth/login/sso', {
      method: 'POST',
      body: { microsoftAccessToken: 'valid-microsoft-token' },
    });

    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(true);
    expect(res.data?.data?.accessToken).toBeTruthy();
    expect(res.data?.data?.refreshToken).toBeTruthy();
    expect(res.data?.data?.user?.email).toBe('sso-user@test.local');
  });

  it('returns passkey-disabled response for /auth/passkeys/auth-options-2fa', async () => {
    const res = await requestJson('/auth/passkeys/auth-options-2fa', {
      method: 'POST',
      body: { tempToken: 'any' },
    });

    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(false);
    expect(String(res.data?.message ?? '')).toContain('Passkey authentication is not enabled');
  });

  it('returns passkey-disabled response for /auth/verify-passkey when temp token is valid', async () => {
    const seeded = await seedAuthBasics();

    const login = await loginE2E(seeded.user.email, seeded.password);
    expect(login.data?.success).toBe(true);

    const generate = await requestJson('/auth/2fa/generate', {
      method: 'POST',
      token: login.accessToken,
    });
    expect(generate.status).toBe(200);
    expect(generate.data?.success).toBe(true);

    const secret = String(generate.data?.data?.secret ?? '');
    const totp = new OTPAuth.TOTP({
      issuer: 'Fueld',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    const enable = await requestJson('/auth/2fa/enable', {
      method: 'POST',
      token: login.accessToken,
      body: { code: totp.generate() },
    });
    expect(enable.status).toBe(200);
    expect(enable.data?.success).toBe(true);

    const login2 = await loginE2E(seeded.user.email, seeded.password);
    expect(login2.status).toBe(200);
    expect(login2.data?.success).toBe(true);
    expect(login2.data?.data?.requires2fa).toBe(true);

    const tempToken = String(login2.data?.data?.tempToken ?? '');
    expect(tempToken).toBeTruthy();

    const verify = await requestJson('/auth/verify-passkey', {
      method: 'POST',
      body: { tempToken, assertionResponse: {} },
    });

    expect(verify.status).toBe(200);
    expect(verify.data?.success).toBe(false);
    expect(String(verify.data?.message ?? '')).toContain('Passkey authentication is not enabled');
  });

  it('returns deactivated-user branch for /auth/login/passkey when passwordless is enabled', async () => {
    const seeded = await seedAuthBasics();
    const adminLogin = await promoteToAdminAndLogin(seeded.user.id, seeded.user.email, seeded.password);

    const security = await requestJson('/admin/security', {
      method: 'PUT',
      token: adminLogin.accessToken,
      body: { passkeyEnabled: true, passkeyAllowPasswordless: true },
    });
    expect(security.status).toBe(200);
    expect(security.data?.success).toBe(true);

    const db = await getDb();
    await db
      .insert(users)
      .values({
        tenantId: seeded.tenant.id,
        email: 'deactivated-passkey@test.local',
        name: 'Deactivated User',
        role: 'TRADER',
        isActive: false,
      })
      .returning();

    const login = await requestJson('/auth/login/passkey', {
      method: 'POST',
      body: { email: 'deactivated-passkey@test.local', assertionResponse: {} },
    });

    expect(login.status).toBe(200);
    expect(login.data?.success).toBe(false);
    expect(String(login.data?.message ?? '')).toContain('deactivated');
  });
});
