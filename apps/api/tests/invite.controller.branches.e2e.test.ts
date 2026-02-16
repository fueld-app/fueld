import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { invitations, users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

describe('invite controller branch e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function createInviteToken(email: string) {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const adminLogin = await loginE2E(seeded.user.email, seeded.password);
    const adminToken = adminLogin.accessToken;

    const invite = await requestJson('/admin/users/invite', {
      method: 'POST',
      token: adminToken,
      body: {
        email,
        name: 'Invited User',
        role: 'TRADER',
      },
    });

    expect(invite.status).toBe(200);
    expect(invite.data?.success).toBe(true);

    return {
      token: String(invite.data?.data?.token ?? ''),
      db,
    };
  }

  it('returns invalid invitation for unknown tokens', async () => {
    await seedAuthBasics();

    const validate = await requestJson('/invite/not-a-real-token');
    expect(validate.status).toBe(200);
    expect(validate.data?.success).toBe(false);
    expect(String(validate.data?.message ?? '')).toContain('Invalid invitation');

    const accept = await requestJson('/invite/not-a-real-token/accept', {
      method: 'POST',
      body: { password: 'Passw0rd!3' },
    });
    expect(accept.status).toBe(200);
    expect(accept.data?.success).toBe(false);
    expect(String(accept.data?.message ?? '')).toContain('Invalid invitation token');
  });

  it('returns expired invitation for validate and accept', async () => {
    const created = await createInviteToken('expired-invite@test.local');

    await created.db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(invitations.token, created.token));

    const validate = await requestJson(`/invite/${created.token}`);
    expect(validate.status).toBe(200);
    expect(validate.data?.success).toBe(false);
    expect(String(validate.data?.message ?? '')).toContain('Invitation expired');

    const accept = await requestJson(`/invite/${created.token}/accept`, {
      method: 'POST',
      body: { password: 'Passw0rd!3' },
    });
    expect(accept.status).toBe(200);
    expect(accept.data?.success).toBe(false);
    expect(String(accept.data?.message ?? '')).toContain('expired');
  });

  it('returns already-used branch when accepting an invite twice', async () => {
    const created = await createInviteToken('used-invite@test.local');

    const first = await requestJson(`/invite/${created.token}/accept`, {
      method: 'POST',
      body: { password: 'Passw0rd!3' },
    });
    expect(first.status).toBe(200);
    expect(first.data?.success).toBe(true);

    const second = await requestJson(`/invite/${created.token}/accept`, {
      method: 'POST',
      body: { password: 'Passw0rd!4' },
    });
    expect(second.status).toBe(200);
    expect(second.data?.success).toBe(false);
    expect(String(second.data?.message ?? '')).toContain('already been used');

    const validateAfterUse = await requestJson(`/invite/${created.token}`);
    expect(validateAfterUse.status).toBe(200);
    expect(validateAfterUse.data?.success).toBe(false);
    expect(String(validateAfterUse.data?.message ?? '')).toContain('already used');
  });
});
