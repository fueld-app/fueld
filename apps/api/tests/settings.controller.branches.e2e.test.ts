import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { counterparties, teams, tenants, users, userTeams } from '../src/db/schema';
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

    const userTeamMissing = await requestJson('/admin/settings/users/123e4567-e89b-12d3-a456-426614174000/teams', {
      method: 'PATCH',
      token,
      body: { teamIds: [] },
    });

    expect(userTeamMissing.status).toBe(200);
    expect(userTeamMissing.data?.success).toBe(false);
    expect(String(userTeamMissing.data?.message ?? '')).toContain('User not found');
  });

  it('rejects cross-tenant team update and delete', async () => {
    const { token } = await adminContext();
    const db = await getDb();

    // Create a second tenant and a team belonging to it
    const [tenant2] = await db.insert(tenants).values({ name: 'Other Tenant', domain: 'other.local' }).returning();
    const [foreignTeam] = await db.insert(teams).values({ tenantId: tenant2!.id, name: 'Foreign Team' }).returning();

    // Attempt to update the foreign team via the admin token from tenant 1
    const teamPatch = await requestJson(`/admin/settings/teams/${foreignTeam!.id}`, {
      method: 'PATCH',
      token,
      body: { name: 'Hijacked' },
    });

    expect(teamPatch.status).toBe(200);
    expect(teamPatch.data?.success).toBe(false);
    expect(String(teamPatch.data?.message ?? '')).toContain('Team not found');

    // Attempt to delete the foreign team
    const teamDelete = await requestJson(`/admin/settings/teams/${foreignTeam!.id}`, {
      method: 'DELETE',
      token,
    });

    expect(teamDelete.status).toBe(200);
    expect(teamDelete.data?.success).toBe(false);
    expect(String(teamDelete.data?.message ?? '')).toContain('Team not found');
  });

  it('rejects creating a team with foreign-tenant companyIds', async () => {
    const { token } = await adminContext();
    const db = await getDb();

    // Create a second tenant and a counterparty belonging to it
    const [tenant2] = await db.insert(tenants).values({ name: 'Other Tenant', domain: 'other.local' }).returning();
    const [foreignCompany] = await db.insert(counterparties).values({
      tenantId: tenant2!.id,
      name: 'Foreign Co',
      type: 'CLIENT',
      types: ['CLIENT'],
    }).returning();

    // Attempt to create a team using the foreign company ID
    const createRes = await requestJson('/admin/settings/teams', {
      method: 'POST',
      token,
      body: { name: 'Bad Team', companyIds: [foreignCompany!.id] },
    });

    expect(createRes.status).toBe(200);
    expect(createRes.data?.success).toBe(false);
    expect(String(createRes.data?.message ?? '')).toContain('not found in this tenant');
  });

  it('rejects assigning user to foreign-tenant team', async () => {
    const { seeded, token } = await adminContext();
    const db = await getDb();

    // Create a second tenant and a team belonging to it
    const [tenant2] = await db.insert(tenants).values({ name: 'Other Tenant', domain: 'other.local' }).returning();
    const [foreignTeam] = await db.insert(teams).values({ tenantId: tenant2!.id, name: 'Foreign Team' }).returning();

    // Attempt to assign the current user (tenant 1) to the foreign team (tenant 2)
    const assignRes = await requestJson(`/admin/settings/users/${seeded.user.id}/teams`, {
      method: 'PATCH',
      token,
      body: { teamIds: [foreignTeam!.id] },
    });

    expect(assignRes.status).toBe(200);
    expect(assignRes.data?.success).toBe(false);
    expect(String(assignRes.data?.message ?? '')).toContain('not found in this tenant');
  });

  it('bulk member sync replaces all members atomically', async () => {
    const { seeded, token } = await adminContext();
    const db = await getDb();

    // Create a team
    const createRes = await requestJson('/admin/settings/teams', {
      method: 'POST',
      token,
      body: { name: 'Bulk Sync Team', companyIds: [] },
    });
    expect(createRes.data?.success).toBe(true);
    const teamId = createRes.data?.data?.id as string;
    expect(teamId).toBeTruthy();

    // Create a second user in the same tenant
    const [user2] = await db.insert(users).values({
      tenantId: seeded.tenant.id,
      email: 'bulksync@test.local',
      name: 'Bulk Sync User',
      role: 'TRADER',
    }).returning();

    // PUT members: assign both users
    const putRes = await requestJson(`/admin/settings/teams/${teamId}/members`, {
      method: 'PUT',
      token,
      body: { memberIds: [seeded.user.id, user2!.id] },
    });
    expect(putRes.data?.success).toBe(true);
    const membersAfterAdd = putRes.data?.data?.memberIds as string[];
    expect(membersAfterAdd).toContain(seeded.user.id);
    expect(membersAfterAdd).toContain(user2!.id);

    // PUT members: remove user2, keep only seeded user
    const putRes2 = await requestJson(`/admin/settings/teams/${teamId}/members`, {
      method: 'PUT',
      token,
      body: { memberIds: [seeded.user.id] },
    });
    expect(putRes2.data?.success).toBe(true);
    const membersAfterRemove = putRes2.data?.data?.memberIds as string[];
    expect(membersAfterRemove).toContain(seeded.user.id);
    expect(membersAfterRemove).not.toContain(user2!.id);

    // PUT members: empty list removes all
    const putRes3 = await requestJson(`/admin/settings/teams/${teamId}/members`, {
      method: 'PUT',
      token,
      body: { memberIds: [] },
    });
    expect(putRes3.data?.success).toBe(true);
    const membersAfterClear = putRes3.data?.data?.memberIds as string[];
    expect(membersAfterClear).toHaveLength(0);

    // Clean up
    await requestJson(`/admin/settings/teams/${teamId}`, { method: 'DELETE', token });
  });

  it('rejects bulk member sync on foreign-tenant team', async () => {
    const { seeded, token } = await adminContext();
    const db = await getDb();

    // Create a second tenant and a team belonging to it
    const [tenant2] = await db.insert(tenants).values({ name: 'Other Tenant', domain: 'other.local' }).returning();
    const [foreignTeam] = await db.insert(teams).values({ tenantId: tenant2!.id, name: 'Foreign Team' }).returning();

    // Attempt to bulk-sync members on the foreign team
    const putRes = await requestJson(`/admin/settings/teams/${foreignTeam!.id}/members`, {
      method: 'PUT',
      token,
      body: { memberIds: [seeded.user.id] },
    });

    expect(putRes.data?.success).toBe(false);
    expect(String(putRes.data?.message ?? '')).toContain('Team not found');
  });
});
