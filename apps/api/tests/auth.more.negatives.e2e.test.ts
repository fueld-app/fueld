import { beforeEach, describe, expect, it } from 'bun:test';
import * as OTPAuth from 'otpauth';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

describe('auth additional negative e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function promoteToAdminAndLogin(userId: string, email: string, password: string) {
    const db = await getDb();

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, userId));

    return loginE2E(email, password);
  }

  it('returns invalid-code branch for /auth/2fa/enable', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const generated = await requestJson('/auth/2fa/generate', {
      method: 'POST',
      token,
    });
    expect(generated.status).toBe(200);
    expect(generated.data?.success).toBe(true);

    const enable = await requestJson('/auth/2fa/enable', {
      method: 'POST',
      token,
      body: { code: '000000' },
    });

    expect(enable.status).toBe(200);
    expect(enable.data?.success).toBe(false);
    expect(String(enable.data?.message ?? '')).toContain('Invalid TOTP code');
  });

  it('returns invalid-code branch for /auth/verify-2fa and /auth/2fa/disable', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const generated = await requestJson('/auth/2fa/generate', {
      method: 'POST',
      token,
    });
    expect(generated.status).toBe(200);
    expect(generated.data?.success).toBe(true);

    const secret = String(generated.data?.data?.secret ?? '');
    const totp = new OTPAuth.TOTP({
      issuer: 'Fueld',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    const enable = await requestJson('/auth/2fa/enable', {
      method: 'POST',
      token,
      body: { code: totp.generate() },
    });
    expect(enable.status).toBe(200);
    expect(enable.data?.success).toBe(true);

    const login2 = await loginE2E(seeded.user.email, seeded.password);
    expect(login2.status).toBe(200);
    expect(login2.data?.success).toBe(true);
    expect(login2.data?.data?.requires2fa).toBe(true);

    const verify = await requestJson('/auth/verify-2fa', {
      method: 'POST',
      body: {
        tempToken: String(login2.data?.data?.tempToken ?? ''),
        code: '000000',
      },
    });
    expect(verify.status).toBe(200);
    expect(verify.data?.success).toBe(false);
    expect(String(verify.data?.message ?? '')).toContain('Invalid 2FA code');

    const disable = await requestJson('/auth/2fa/disable', {
      method: 'POST',
      token,
      body: { code: '000000' },
    });
    expect(disable.status).toBe(200);
    expect(disable.data?.success).toBe(false);
    expect(String(disable.data?.message ?? '')).toContain('Invalid TOTP code');
  });

  it('returns no-passkeys branch for /auth/passkeys/auth-options when passwordless is enabled', async () => {
    const seeded = await seedAuthBasics();
    const adminLogin = await promoteToAdminAndLogin(seeded.user.id, seeded.user.email, seeded.password);
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

    const options = await requestJson('/auth/passkeys/auth-options', {
      method: 'POST',
      body: { email: seeded.user.email },
    });

    expect(options.status).toBe(200);
    expect(options.data?.success).toBe(false);
    expect(String(options.data?.message ?? '')).toContain('No passkeys registered for this account');
  });

  it('returns error response for invalid SSO token', async () => {
    await seedAuthBasics();

    const sso = await requestJson('/auth/login/sso', {
      method: 'POST',
      body: {
        microsoftAccessToken: 'invalid-microsoft-token',
      },
    });

    expect(sso.status).toBe(200);
    expect(sso.data?.success).toBe(false);
    expect(typeof sso.data?.message).toBe('string');
    expect(String(sso.data?.message ?? '').length).toBeGreaterThan(0);
  });
});
