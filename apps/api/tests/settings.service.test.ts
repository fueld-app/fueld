import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { counterparties, users } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';

async function loadSettingsService() {
  return import('../src/modules/admin/settings.service');
}

beforeEach(async () => {
  await truncateAll();
});

describe('admin settings.service', () => {
  it('handles own-company flags and user company access fallbacks/overrides', async () => {
    const { tenant, user, client } = await seedBasics();
    const db = await getDb();
    const {
      listOwnCompanies,
      setOwnCompany,
      getUserCompanyAccess,
      createTeam,
      setUserCompanyOverrides,
    } = await loadSettingsService();

    const [own2] = await db
      .insert(counterparties)
      .values({
        tenantId: tenant.id,
        name: 'Own 2',
        type: 'CLIENT',
        types: ['CLIENT'],
      })
      .returning();

    await setOwnCompany(client.id, true);
    await setOwnCompany(own2!.id, true);

    const own = await listOwnCompanies();
    expect(own.map((c) => c.id).sort()).toEqual([client.id, own2!.id].sort());

    const accessNoTeam = await getUserCompanyAccess(user.id);
    expect(accessNoTeam.map((c) => c.id).sort()).toEqual([client.id, own2!.id].sort());

    const team = await createTeam({ name: 'Team A', companyIds: [client.id] });
    await db.update(users).set({ teamId: team.id }).where(eq(users.id, user.id));

    const accessByTeam = await getUserCompanyAccess(user.id);
    expect(accessByTeam.map((c) => c.id)).toEqual([client.id]);

    const accessByOverride = await setUserCompanyOverrides(user.id, [own2!.id]);
    expect(accessByOverride.map((c) => c.id)).toEqual([own2!.id]);
  });

  it('supports team and company-group CRUD with not-found errors', async () => {
    const { tenant, client, user } = await seedBasics();
    const db = await getDb();
    const {
      createTeam,
      listTeams,
      updateTeam,
      deleteTeam,
      createCompanyGroup,
      listCompanyGroups,
      updateCompanyGroup,
      deleteCompanyGroup,
    } = await loadSettingsService();

    const [companyB] = await db
      .insert(counterparties)
      .values({
        tenantId: tenant.id,
        name: 'Company B',
        type: 'CLIENT',
        types: ['CLIENT'],
      })
      .returning();

    const team = await createTeam({ name: 'Ops', companyIds: [client.id] });
    await db.update(users).set({ teamId: team.id }).where(eq(users.id, user.id));

    const listedTeams = await listTeams();
    const teamRow = listedTeams.find((t) => t.id === team.id)!;
    expect(teamRow.memberCount).toBe(1);
    expect(teamRow.companyIds).toEqual([client.id]);

    const updatedTeam = await updateTeam(team.id, { name: 'Ops 2', companyIds: [companyB!.id] });
    expect(updatedTeam.name).toBe('Ops 2');
    expect(updatedTeam.companyIds).toEqual([companyB!.id]);

    const deletedTeam = await deleteTeam(team.id);
    expect(deletedTeam.id).toBe(team.id);

    await expect(updateTeam('123e4567-e89b-12d3-a456-426614174000', { name: 'x' })).rejects.toThrow('Team not found');
    await expect(deleteTeam('123e4567-e89b-12d3-a456-426614174000')).rejects.toThrow('Team not found');

    const group = await createCompanyGroup({ name: 'Group A', companyIds: [client.id] });
    expect(group.companyIds).toEqual([client.id]);

    const groups = await listCompanyGroups();
    expect(groups.length).toBe(1);

    const updatedGroup = await updateCompanyGroup(group.id, { name: 'Group B', companyIds: [companyB!.id] });
    expect(updatedGroup.name).toBe('Group B');
    expect(updatedGroup.companyIds).toEqual([companyB!.id]);

    const deletedGroup = await deleteCompanyGroup(group.id);
    expect(deletedGroup.id).toBe(group.id);

    await expect(updateCompanyGroup('123e4567-e89b-12d3-a456-426614174000', { name: 'x' })).rejects.toThrow('Company group not found');
    await expect(deleteCompanyGroup('123e4567-e89b-12d3-a456-426614174000')).rejects.toThrow('Company group not found');
  });

  it('supports bank account CRUD and default switching', async () => {
    const { client } = await seedBasics();
    const {
      createBankAccount,
      listBankAccounts,
      updateBankAccount,
      deleteBankAccount,
    } = await loadSettingsService();

    const a1 = await createBankAccount(client.id, {
      label: 'Main USD',
      bankName: 'Bank A',
      currency: 'usd',
      isDefault: true,
    });

    const a2 = await createBankAccount(client.id, {
      label: 'EUR',
      bankName: 'Bank B',
      currency: 'eur',
      isDefault: true,
    });

    const rows = await listBankAccounts(client.id);
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.id === a1.id)?.isDefault).toBe(false);
    expect(rows.find((r) => r.id === a2.id)?.isDefault).toBe(true);

    const updated = await updateBankAccount(a1.id, client.id, { currency: 'dkk', isDefault: true });
    expect(updated.currency).toBe('DKK');
    expect(updated.isDefault).toBe(true);

    await deleteBankAccount(a2.id, client.id);
    const afterDelete = await listBankAccounts(client.id);
    expect(afterDelete.length).toBe(1);

    await expect(updateBankAccount('123e4567-e89b-12d3-a456-426614174000', client.id, { label: 'x' })).rejects.toThrow('Bank account not found');
    await expect(deleteBankAccount('123e4567-e89b-12d3-a456-426614174000', client.id)).rejects.toThrow('Bank account not found');
  });

  it('supports logo + tenant settings getters and updates', async () => {
    const { client } = await seedBasics();
    const {
      setCompanyLogo,
      getCompanyLogo,
      getDefaultLogo,
      setDefaultLogo,
      getOrderNumberSettings,
      updateOrderNumberSettings,
      getProductSettings,
      updateProductSettings,
      getUnitSettings,
      updateUnitSettings,
      getCurrencySettings,
      updateCurrencySettings,
      getCompanyTypeSettings,
      updateCompanyTypeSettings,
    } = await loadSettingsService();

    await setCompanyLogo(client.id, 'https://cdn/logo.png');
    expect(await getCompanyLogo(client.id)).toBe('https://cdn/logo.png');

    expect(await getDefaultLogo()).toBeNull();
    await setDefaultLogo('https://cdn/default.png');
    expect(await getDefaultLogo()).toBe('https://cdn/default.png');

    const before = await getOrderNumberSettings();
    expect(before.template).toBeTruthy();
    const after = await updateOrderNumberSettings({ template: '{PREFIX}-{SEQ:4}', prefix: 'FU' });
    expect(after.template).toBe('{PREFIX}-{SEQ:4}');
    expect(after.prefix).toBe('FU');
    expect(after.preview.startsWith('FU-')).toBe(true);

    expect((await getProductSettings()).products.length).toBeGreaterThan(0);
    expect((await updateProductSettings(['MGO', 'LUBE'])).products).toEqual(['MGO', 'LUBE']);

    expect((await getUnitSettings()).units.length).toBeGreaterThan(0);
    expect((await updateUnitSettings(['MT', 'BBL'])).units).toEqual(['MT', 'BBL']);

    expect((await getCurrencySettings()).currencies.length).toBeGreaterThan(0);
    const updatedCurrencies = (await updateCurrencySettings(['USD', 'EUR'])).currencies;
    expect(updatedCurrencies).toContain('USD');
    expect(updatedCurrencies).toContain('EUR');

    expect((await getCompanyTypeSettings()).companyTypes.length).toBeGreaterThan(0);
    expect((await updateCompanyTypeSettings(['CLIENT', 'SUPPLIER'])).companyTypes).toEqual(['CLIENT', 'SUPPLIER']);
  });

  it('falls back to own companies when user team has no assigned companies', async () => {
    const { tenant, user, client } = await seedBasics();
    const db = await getDb();
    const {
      setOwnCompany,
      createTeam,
      getUserCompanyAccess,
    } = await loadSettingsService();

    const [own2] = await db
      .insert(counterparties)
      .values({
        tenantId: tenant.id,
        name: 'Own Fallback 2',
        type: 'CLIENT',
        types: ['CLIENT'],
      })
      .returning();

    await setOwnCompany(client.id, true);
    await setOwnCompany(own2!.id, true);

    const emptyTeam = await createTeam({ name: 'No Companies Team', companyIds: [] });
    await db.update(users).set({ teamId: emptyTeam.id, updatedAt: new Date() }).where(eq(users.id, user.id));

    const access = await getUserCompanyAccess(user.id);
    expect(access.map((c) => c.id).sort()).toEqual([client.id, own2!.id].sort());
  });

  it('covers no-tenant branches for tenant-scoped settings helpers', async () => {
    const {
      listTeams,
      createTeam,
      listCompanyGroups,
      createCompanyGroup,
      setDefaultLogo,
      getDefaultLogo,
      getOrderNumberSettings,
      updateOrderNumberSettings,
      getVesselCompanyRoleSettings,
      updateVesselCompanyRoleSettings,
      getProductSettings,
      updateProductSettings,
      getUnitSettings,
      updateUnitSettings,
      getCurrencySettings,
      updateCurrencySettings,
      getCompanyTypeSettings,
      updateCompanyTypeSettings,
    } = await loadSettingsService();

    expect(await getDefaultLogo()).toBeNull();

    await expect(listTeams()).rejects.toThrow('No tenant found');
    await expect(createTeam({ name: 'x', companyIds: [] })).rejects.toThrow('No tenant found');
    await expect(listCompanyGroups()).rejects.toThrow('No tenant found');
    await expect(createCompanyGroup({ name: 'x', companyIds: [] })).rejects.toThrow('No tenant found');
    await expect(setDefaultLogo('https://cdn/none.png')).rejects.toThrow('No tenant found');
    await expect(getOrderNumberSettings()).rejects.toThrow('No tenant found');
    await expect(updateOrderNumberSettings({ prefix: 'X' })).rejects.toThrow('No tenant found');
    await expect(getVesselCompanyRoleSettings()).rejects.toThrow('No tenant found');
    await expect(updateVesselCompanyRoleSettings([])).rejects.toThrow('No tenant found');
    await expect(getProductSettings()).rejects.toThrow('No tenant found');
    await expect(updateProductSettings(['MGO'])).rejects.toThrow('No tenant found');
    await expect(getUnitSettings()).rejects.toThrow('No tenant found');
    await expect(updateUnitSettings(['MT'])).rejects.toThrow('No tenant found');
    await expect(getCurrencySettings()).rejects.toThrow('No tenant found');
    await expect(updateCurrencySettings(['USD'])).rejects.toThrow('No tenant found');
    await expect(getCompanyTypeSettings()).rejects.toThrow('No tenant found');
    await expect(updateCompanyTypeSettings(['CLIENT'])).rejects.toThrow('No tenant found');
  });
});
