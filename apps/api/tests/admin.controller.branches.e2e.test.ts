import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { invitations, users } from '../src/db/schema';
import { hashPassword } from '../src/modules/auth/password.service';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

describe('admin controller branch e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function adminTokenForSeededUser() {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const login = await loginE2E(seeded.user.email, seeded.password);
    return { seeded, token: login.accessToken };
  }

  it('rejects invalid IP/CIDR values in allowed-ips patch', async () => {
    const { seeded, token } = await adminTokenForSeededUser();
    const db = await getDb();

    const [otherUser] = await db
      .insert(users)
      .values({
        tenantId: seeded.tenant.id,
        email: 'allowed-ips-target@test.local',
        name: 'Allowed Ips Target',
        role: 'TRADER',
        passwordHash: await hashPassword('Passw0rd!2'),
      })
      .returning();

    expect(otherUser?.id).toBeTruthy();

    const res = await requestJson(`/admin/users/${otherUser!.id}/allowed-ips`, {
      method: 'PATCH',
      token,
      body: { allowedIps: ['999.0.0.1'] },
    });

    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(false);
    expect(String(res.data?.message ?? '')).toContain('Invalid IP address or CIDR');
  });

  it('blocks admin from resetting own 2FA', async () => {
    const { seeded, token } = await adminTokenForSeededUser();

    const res = await requestJson(`/admin/users/${seeded.user.id}/reset-2fa`, {
      method: 'POST',
      token,
    });

    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(false);
    expect(String(res.data?.message ?? '')).toContain('cannot reset your own 2FA');
  });

  it('returns user-not-found for reset-2fa on unknown user', async () => {
    const { token } = await adminTokenForSeededUser();

    const res = await requestJson('/admin/users/123e4567-e89b-12d3-a456-426614174000/reset-2fa', {
      method: 'POST',
      token,
    });

    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(false);
    expect(String(res.data?.message ?? '')).toContain('User not found');
  });

  it('returns pending-invite error on duplicate invitation', async () => {
    const { token } = await adminTokenForSeededUser();

    const first = await requestJson('/admin/users/invite', {
      method: 'POST',
      token,
      body: {
        email: 'duplicate-invite@test.local',
        name: 'Duplicate Invite',
        role: 'TRADER',
      },
    });

    expect(first.status).toBe(200);
    expect(first.data?.success).toBe(true);

    const second = await requestJson('/admin/users/invite', {
      method: 'POST',
      token,
      body: {
        email: 'duplicate-invite@test.local',
        name: 'Duplicate Invite',
        role: 'TRADER',
      },
    });

    expect(second.status).toBe(200);
    expect(second.data?.success).toBe(false);
    expect(String(second.data?.message ?? '')).toContain('already pending');
  });

  it('reissues a pending invitation via the existing invite endpoint', async () => {
    const { token } = await adminTokenForSeededUser();
    const db = await getDb();

    const first = await requestJson('/admin/users/invite', {
      method: 'POST',
      token,
      body: {
        email: 'reinvite-via-invite@test.local',
        name: 'Reinvite Target',
        role: 'TRADER',
      },
    });

    expect(first.status).toBe(200);
    expect(first.data?.success).toBe(true);

    const originalToken = String(first.data?.data?.token ?? '');
    const originalId = String(first.data?.data?.id ?? '');
    expect(originalToken).toBeTruthy();
    expect(originalId).toBeTruthy();

    const second = await requestJson('/admin/users/invite', {
      method: 'POST',
      token,
      body: {
        email: 'reinvite-via-invite@test.local',
        name: 'Reinvite Target',
        role: 'TRADER',
        allowReinvite: true,
      },
    });

    expect(second.status).toBe(200);
    expect(second.data?.success).toBe(true);
    expect(String(second.data?.data?.id ?? '')).toBe(originalId);
    expect(String(second.data?.data?.token ?? '')).not.toBe(originalToken);
    expect(String(second.data?.data?.inviteLink ?? '')).toContain('/invite/');

    const rows = await db
      .select({ id: invitations.id, token: invitations.token })
      .from(invitations)
      .where(eq(invitations.email, 'reinvite-via-invite@test.local'));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(originalId);
    expect(rows[0]?.token).toBe(String(second.data?.data?.token ?? ''));
  });
});
