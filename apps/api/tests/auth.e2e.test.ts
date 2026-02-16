import { beforeEach, describe, expect, it } from 'bun:test';
import { seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

describe('auth e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('logs in with password and accesses protected endpoint', async () => {
    const seeded = await seedAuthBasics();

    const login = await loginE2E(seeded.user.email, seeded.password);
    expect(login.status).toBe(200);
    expect(login.data?.success).toBe(true);
    expect(login.data?.data?.requires2fa).toBe(false);
    expect(login.accessToken).toBeTruthy();
    expect(login.refreshToken).toBeTruthy();

    const protectedRes = await requestJson('/orders', {
      token: login.accessToken,
    });
    expect(protectedRes.status).toBe(200);
    expect(protectedRes.data?.success).toBe(true);
    expect(Array.isArray(protectedRes.data?.data?.items)).toBe(true);
  });

  it('rejects wrong password and rotates refresh token', async () => {
    const seeded = await seedAuthBasics();

    const badLogin = await loginE2E(seeded.user.email, 'wrong-password');
    expect(badLogin.status).toBe(200);
    expect(badLogin.data?.success).toBe(false);
    expect(badLogin.data?.message).toContain('Invalid email or password');

    const login = await loginE2E(seeded.user.email, seeded.password);
    expect(login.data?.success).toBe(true);

    const refresh = await requestJson('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: login.refreshToken },
    });

    expect(refresh.status).toBe(200);
    expect(refresh.data?.success).toBe(true);
    expect(refresh.data?.data?.accessToken).toBeTruthy();
    expect(refresh.data?.data?.refreshToken).toBeTruthy();
  });

  it('revokes refresh token on logout', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);

    expect(login.data?.success).toBe(true);
    expect(login.accessToken).toBeTruthy();
    expect(login.refreshToken).toBeTruthy();

    const logout = await requestJson('/auth/logout', {
      method: 'POST',
      body: { accessToken: login.accessToken },
    });

    expect(logout.status).toBe(200);
    expect(logout.data?.success).toBe(true);

    const refreshAfterLogout = await requestJson('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: login.refreshToken },
    });

    expect(refreshAfterLogout.status).toBe(200);
    expect(refreshAfterLogout.data?.success).toBe(false);
    expect(String(refreshAfterLogout.data?.message ?? '')).toContain('Refresh token revoked');
  });
});
