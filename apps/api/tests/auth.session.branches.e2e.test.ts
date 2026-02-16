import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

describe('auth session branch e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('covers refresh invalid-token and revoked-token branches', async () => {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    const invalid = await requestJson('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: 'not-a-real-token' },
    });
    expect(invalid.status).toBe(200);
    expect(invalid.data?.success).toBe(false);
    expect(String(invalid.data?.message ?? '')).toContain('Invalid or expired refresh token');

    const login = await loginE2E(seeded.user.email, seeded.password);
    expect(login.data?.success).toBe(true);

    await db
      .update(users)
      .set({ refreshToken: 'manually-revoked-token', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const revoked = await requestJson('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: String(login.refreshToken ?? '') },
    });
    expect(revoked.status).toBe(200);
    expect(revoked.data?.success).toBe(false);
    expect(String(revoked.data?.message ?? '')).toContain('Refresh token revoked or invalid');
  });

  it('covers logout success for invalid token and valid-token refresh revocation', async () => {
    const seeded = await seedAuthBasics();

    const logoutInvalid = await requestJson('/auth/logout', {
      method: 'POST',
      body: { accessToken: 'invalid-token' },
    });
    expect(logoutInvalid.status).toBe(200);
    expect(logoutInvalid.data?.success).toBe(true);
    expect(String(logoutInvalid.data?.message ?? '')).toContain('Logged out');

    const login = await loginE2E(seeded.user.email, seeded.password);
    expect(login.data?.success).toBe(true);

    const db = await getDb();
    const before = await db
      .select({ refreshToken: users.refreshToken })
      .from(users)
      .where(eq(users.id, seeded.user.id))
      .limit(1);
    expect(before[0]?.refreshToken).toBeTruthy();

    const logoutValid = await requestJson('/auth/logout', {
      method: 'POST',
      body: { accessToken: String(login.accessToken ?? '') },
    });
    expect(logoutValid.status).toBe(200);
    expect(logoutValid.data?.success).toBe(true);

    const after = await db
      .select({ refreshToken: users.refreshToken })
      .from(users)
      .where(eq(users.id, seeded.user.id))
      .limit(1);
    expect(after[0]?.refreshToken).toBeNull();

    const refreshAfterLogout = await requestJson('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: String(login.refreshToken ?? '') },
    });
    expect(refreshAfterLogout.status).toBe(200);
    expect(refreshAfterLogout.data?.success).toBe(false);
    expect(String(refreshAfterLogout.data?.message ?? '')).toContain('Refresh token revoked or invalid');
  });
});
