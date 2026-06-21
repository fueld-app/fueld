import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

describe('auth passkey/2fa branch e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function setPasskeyAuthForTenant(
    userId: string,
    email: string,
    password: string,
    passkeyEnabled: boolean,
    passkeyAllowPasswordless: boolean,
  ) {
    const db = await getDb();

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, userId));

    const adminLogin = await loginE2E(email, password);
    const adminToken = adminLogin.accessToken;

    const updated = await requestJson('/admin/security', {
      method: 'PUT',
      token: adminToken,
      body: {
        passkeyEnabled,
        passkeyAllowPasswordless,
      },
    });

    expect(updated.status).toBe(200);
    expect(updated.data?.success).toBe(true);
  }

  it('rejects /auth/verify-2fa with invalid temporary token', async () => {
    await seedAuthBasics();

    const verify = await requestJson('/auth/verify-2fa', {
      method: 'POST',
      body: {
        tempToken: 'not-a-valid-temp-token',
        code: '123456',
      },
    });

    expect(verify.status).toBe(200);
    expect(verify.data?.success).toBe(false);
    expect(String(verify.data?.message ?? '')).toContain('Invalid or expired temporary token');
  });

  it('rejects /auth/verify-passkey with invalid temporary token', async () => {
    const seeded = await seedAuthBasics();

    await setPasskeyAuthForTenant(
      seeded.user.id,
      seeded.user.email,
      seeded.password,
      false,
      false,
    );

    const verify = await requestJson('/auth/verify-passkey', {
      method: 'POST',
      body: {
        tempToken: 'not-a-valid-temp-token',
        assertionResponse: {},
        sessionId: 'any',
      },
    });

    expect(verify.status).toBe(200);
    expect(verify.data?.success).toBe(false);
    expect(String(verify.data?.message ?? '')).toContain('Invalid or expired temporary token');
  });

  it('rejects /auth/passkeys/auth-options-2fa with invalid temporary token when passkey is enabled', async () => {
    const seeded = await seedAuthBasics();

    await setPasskeyAuthForTenant(
      seeded.user.id,
      seeded.user.email,
      seeded.password,
      true,
      true,
    );

    const options = await requestJson('/auth/passkeys/auth-options-2fa', {
      method: 'POST',
      body: {
        tempToken: 'not-a-valid-temp-token',
      },
    });

    expect(options.status).toBe(200);
    expect(options.data?.success).toBe(false);
    expect(String(options.data?.message ?? '')).toContain('Invalid or expired temporary token');
  });

  it('returns user-not-found for /auth/login/passkey when passkey passwordless is enabled', async () => {
    const seeded = await seedAuthBasics();

    await setPasskeyAuthForTenant(
      seeded.user.id,
      seeded.user.email,
      seeded.password,
      true,
      true,
    );

    const login = await requestJson('/auth/login/passkey', {
      method: 'POST',
      body: {
        email: 'missing-user@test.local',
        assertionResponse: {},
        sessionId: 'any',
      },
    });

    expect(login.status).toBe(200);
    expect(login.data?.success).toBe(false);
    expect(String(login.data?.message ?? '')).toContain('User not found');
  });
});
