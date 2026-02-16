import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { hashPassword } from '../src/modules/auth/password.service';
import { loginE2E, requestJson } from './helpers/e2e';

describe('admin/security e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('enforces admin role on security settings and allows admin updates with clamping', async () => {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    const traderLogin = await loginE2E(seeded.user.email, seeded.password);
    const traderToken = traderLogin.accessToken;

    const forbidden = await requestJson('/admin/security', {
      method: 'GET',
      token: traderToken,
    });

    expect(forbidden.status).toBe(403);
    expect(forbidden.data?.success).toBe(false);

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const adminLogin = await loginE2E(seeded.user.email, seeded.password);
    const adminToken = adminLogin.accessToken;

    const before = await requestJson('/admin/security', {
      method: 'GET',
      token: adminToken,
    });

    expect(before.status).toBe(200);
    expect(before.data?.success).toBe(true);

    const updated = await requestJson('/admin/security', {
      method: 'PUT',
      token: adminToken,
      body: {
        ssoProvider: 'microsoft',
        ssoClientId: 'client-1',
        ssoTenantId: 'tenant-1',
        ssoEnabled: true,
        enforce2FA: true,
        passkeyEnabled: true,
        passkeyAllowPasswordless: true,
        tokenExpirationMinutes: 2,
        sessionTimeoutMinutes: 20000,
      },
    });

    expect(updated.status).toBe(200);
    expect(updated.data?.success).toBe(true);
    expect(updated.data?.data?.ssoProvider).toBe('microsoft');
    expect(updated.data?.data?.ssoEnabled).toBe(true);
    expect(updated.data?.data?.enforce2FA).toBe(true);
    expect(updated.data?.data?.passkeyEnabled).toBe(true);
    expect(updated.data?.data?.passkeyAllowPasswordless).toBe(true);
    expect(updated.data?.data?.tokenExpirationMinutes).toBe(5);
    expect(updated.data?.data?.sessionTimeoutMinutes).toBe(10080);
  });

  it('enforces admin self-protection checks and supports invitation accept flow', async () => {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const [otherUser] = await db
      .insert(users)
      .values({
        tenantId: seeded.tenant.id,
        email: 'other-admin-flow@test.local',
        name: 'Other User',
        role: 'TRADER',
        passwordHash: await hashPassword('Passw0rd!2'),
      })
      .returning();

    expect(otherUser?.id).toBeTruthy();

    const adminLogin = await loginE2E(seeded.user.email, seeded.password);
    const adminToken = adminLogin.accessToken;

    const selfRole = await requestJson(`/admin/users/${seeded.user.id}/role`, {
      method: 'PATCH',
      token: adminToken,
      body: { role: 'TRADER' },
    });

    expect(selfRole.status).toBe(400);
    expect(selfRole.data?.success).toBe(false);
    expect(String(selfRole.data?.message ?? '')).toContain('cannot change your own role');

    const selfActive = await requestJson(`/admin/users/${seeded.user.id}/active`, {
      method: 'PATCH',
      token: adminToken,
      body: { isActive: false },
    });

    expect(selfActive.status).toBe(200);
    expect(selfActive.data?.success).toBe(false);
    expect(String(selfActive.data?.message ?? '')).toContain('cannot deactivate yourself');

    const selfIps = await requestJson(`/admin/users/${seeded.user.id}/allowed-ips`, {
      method: 'PATCH',
      token: adminToken,
      body: { allowedIps: ['203.0.113.0/24'] },
    });

    expect(selfIps.status).toBe(200);
    expect(selfIps.data?.success).toBe(false);
    expect(String(selfIps.data?.message ?? '')).toContain('cannot set IP restrictions on your own account');

    const invite = await requestJson('/admin/users/invite', {
      method: 'POST',
      token: adminToken,
      body: {
        email: 'invitee-e2e@test.local',
        name: 'Invite E2E',
        role: 'TRADER',
      },
    });

    expect(invite.status).toBe(200);
    expect(invite.data?.success).toBe(true);
    expect(invite.data?.data?.token).toBeTruthy();

    const token = invite.data?.data?.token as string;

    const validate = await requestJson(`/invite/${token}`);
    expect(validate.status).toBe(200);
    expect(validate.data?.success).toBe(true);
    expect(validate.data?.data?.email).toBe('invitee-e2e@test.local');

    const accept = await requestJson(`/invite/${token}/accept`, {
      method: 'POST',
      body: { password: 'Passw0rd!3' },
    });

    expect(accept.status).toBe(200);
    expect(accept.data?.success).toBe(true);
    expect(accept.data?.data?.accessToken).toBeTruthy();
    expect(accept.data?.data?.refreshToken).toBeTruthy();
    expect(accept.data?.data?.requiresMfaSetup).toBe(true);

    const validateAfterUse = await requestJson(`/invite/${token}`);
    expect(validateAfterUse.status).toBe(200);
    expect(validateAfterUse.data?.success).toBe(false);
    expect(String(validateAfterUse.data?.message ?? '')).toContain('already used');

    const promoteOther = await requestJson(`/admin/users/${otherUser!.id}/role`, {
      method: 'PATCH',
      token: adminToken,
      body: { role: 'FINANCE' },
    });

    expect(promoteOther.status).toBe(200);
    expect(promoteOther.data?.success).toBe(true);
    expect(promoteOther.data?.data?.role).toBe('FINANCE');
  });

  it('covers auth guard, non-admin PUT guard, lower-bound clamping, and secret non-exposure', async () => {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    const noAuthGet = await requestJson('/admin/security');
    expect(noAuthGet.status).toBe(401);

    const noAuthPut = await requestJson('/admin/security', {
      method: 'PUT',
      body: { ssoEnabled: true },
    });
    expect(noAuthPut.status).toBe(401);

    const traderLogin = await loginE2E(seeded.user.email, seeded.password);
    const traderToken = traderLogin.accessToken;

    const traderPut = await requestJson('/admin/security', {
      method: 'PUT',
      token: traderToken,
      body: { ssoEnabled: true },
    });
    expect(traderPut.status).toBe(403);
    expect(traderPut.data?.success).toBe(false);
    expect(String(traderPut.data?.message ?? '')).toContain('Admin access required');

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const adminLogin = await loginE2E(seeded.user.email, seeded.password);
    const adminToken = adminLogin.accessToken;

    const updated = await requestJson('/admin/security', {
      method: 'PUT',
      token: adminToken,
      body: {
        ssoProvider: 'google',
        ssoClientId: 'client-visible',
        ssoClientSecret: 'super-secret-should-not-be-returned',
        tokenExpirationMinutes: 5000,
        sessionTimeoutMinutes: 1,
      },
    });

    expect(updated.status).toBe(200);
    expect(updated.data?.success).toBe(true);
    expect(updated.data?.data?.ssoProvider).toBe('google');
    expect(updated.data?.data?.ssoClientId).toBe('client-visible');
    expect(updated.data?.data?.tokenExpirationMinutes).toBe(1440);
    expect(updated.data?.data?.sessionTimeoutMinutes).toBe(5);
    expect((updated.data?.data as Record<string, unknown>)['ssoClientSecret']).toBeUndefined();

    const fetched = await requestJson('/admin/security', {
      token: adminToken,
    });
    expect(fetched.status).toBe(200);
    expect(fetched.data?.success).toBe(true);
    expect(fetched.data?.data?.ssoProvider).toBe('google');
    expect(fetched.data?.data?.tokenExpirationMinutes).toBe(1440);
    expect(fetched.data?.data?.sessionTimeoutMinutes).toBe(5);
    expect((fetched.data?.data as Record<string, unknown>)['ssoClientSecret']).toBeUndefined();
  });
});
