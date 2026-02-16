import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

describe('settings controller branch e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function adminContext() {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const login = await loginE2E(seeded.user.email, seeded.password);
    return { seeded, token: login.accessToken };
  }

  it('maps missing team/group errors through controller responses', async () => {
    const { token } = await adminContext();

    const teamPatch = await requestJson('/admin/settings/teams/123e4567-e89b-12d3-a456-426614174000', {
      method: 'PATCH',
      token,
      body: { name: 'Missing Team' },
    });

    expect(teamPatch.status).toBe(200);
    expect(teamPatch.data?.success).toBe(false);
    expect(String(teamPatch.data?.message ?? '')).toContain('Team not found');

    const teamDelete = await requestJson('/admin/settings/teams/123e4567-e89b-12d3-a456-426614174000', {
      method: 'DELETE',
      token,
    });

    expect(teamDelete.status).toBe(200);
    expect(teamDelete.data?.success).toBe(false);
    expect(String(teamDelete.data?.message ?? '')).toContain('Team not found');

    const groupPatch = await requestJson('/admin/settings/company-groups/123e4567-e89b-12d3-a456-426614174000', {
      method: 'PATCH',
      token,
      body: { name: 'Missing Group' },
    });

    expect(groupPatch.status).toBe(200);
    expect(groupPatch.data?.success).toBe(false);
    expect(String(groupPatch.data?.message ?? '')).toContain('Company group not found');

    const groupDelete = await requestJson('/admin/settings/company-groups/123e4567-e89b-12d3-a456-426614174000', {
      method: 'DELETE',
      token,
    });

    expect(groupDelete.status).toBe(200);
    expect(groupDelete.data?.success).toBe(false);
    expect(String(groupDelete.data?.message ?? '')).toContain('Company group not found');
  });

  it('maps missing bank-account and user-team errors through controller responses', async () => {
    const { seeded, token } = await adminContext();

    const bankPatch = await requestJson('/admin/settings/companies/' + seeded.client.id + '/bank-accounts/123e4567-e89b-12d3-a456-426614174000', {
      method: 'PATCH',
      token,
      body: { label: 'Missing Account' },
    });

    expect(bankPatch.status).toBe(200);
    expect(bankPatch.data?.success).toBe(false);
    expect(String(bankPatch.data?.message ?? '')).toContain('Bank account not found');

    const bankDelete = await requestJson('/admin/settings/companies/' + seeded.client.id + '/bank-accounts/123e4567-e89b-12d3-a456-426614174000', {
      method: 'DELETE',
      token,
    });

    expect(bankDelete.status).toBe(200);
    expect(bankDelete.data?.success).toBe(false);
    expect(String(bankDelete.data?.message ?? '')).toContain('Bank account not found');

    const userTeamMissing = await requestJson('/admin/settings/users/123e4567-e89b-12d3-a456-426614174000/team', {
      method: 'PATCH',
      token,
      body: { teamId: null },
    });

    expect(userTeamMissing.status).toBe(200);
    expect(userTeamMissing.data?.success).toBe(false);
    expect(String(userTeamMissing.data?.message ?? '')).toContain('User not found');
  });
});
