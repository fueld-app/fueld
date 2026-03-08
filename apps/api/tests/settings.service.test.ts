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

  it('persists WhatsApp first inquiry group sharing settings', async () => {
    await seedBasics();
    const {
      getWhatsAppSettings,
      updateWhatsAppSettings,
    } = await loadSettingsService();

    const defaults = await getWhatsAppSettings();
    expect(defaults.enabled).toBe(false);
    expect(defaults.defaultGroupJid).toBeNull();
    expect(defaults.incomingRfqEnabled).toBe(true);
    expect(defaults.firstInquiryGroupNotificationEnabled).toBe(true);

    const updated = await updateWhatsAppSettings({
      enabled: true,
      defaultGroupJid: '120363001234567890@g.us',
      incomingRfqEnabled: false,
      firstInquiryGroupNotificationEnabled: false,
    });

    expect(updated.enabled).toBe(true);
    expect(updated.defaultGroupJid).toBe('120363001234567890@g.us');
    expect(updated.incomingRfqEnabled).toBe(false);
    expect(updated.firstInquiryGroupNotificationEnabled).toBe(false);

    const reloaded = await getWhatsAppSettings();
    expect(reloaded).toEqual(updated);
  });

  it('persists inquiry settings including disabled states', async () => {
    await seedBasics();
    const {
      getInquirySettings,
      updateInquirySettings,
    } = await loadSettingsService();

    const defaults = await getInquirySettings();
    expect(defaults.supplierResponseUrlEnabled).toBe(true);
    expect(defaults.autoMarkNoReplyAfterHours).toBe(168);

    const disabled = await updateInquirySettings({
      supplierResponseUrlEnabled: false,
      autoMarkNoReplyAfterHours: null,
    });

    expect(disabled.supplierResponseUrlEnabled).toBe(false);
    expect(disabled.autoMarkNoReplyAfterHours).toBeNull();

    const reloadedDisabled = await getInquirySettings();
    expect(reloadedDisabled.supplierResponseUrlEnabled).toBe(false);
    expect(reloadedDisabled.autoMarkNoReplyAfterHours).toBeNull();

    const enabledAgain = await updateInquirySettings({
      supplierResponseUrlEnabled: true,
      autoMarkNoReplyAfterHours: 24,
    });

    expect(enabledAgain.supplierResponseUrlEnabled).toBe(true);
    expect(enabledAgain.autoMarkNoReplyAfterHours).toBe(24);

    const reloadedEnabled = await getInquirySettings();
    expect(reloadedEnabled.supplierResponseUrlEnabled).toBe(true);
    expect(reloadedEnabled.autoMarkNoReplyAfterHours).toBe(24);
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

    const expectNoTenantOrSuccess = async <T>(
      call: () => Promise<T>,
      onSuccess?: (value: T) => void,
    ) => {
      try {
        const value = await call();
        onSuccess?.(value);
      } catch (error) {
        expect(String(error)).toContain('No tenant found');
      }
    };

    expect(await getDefaultLogo()).toBeNull();

    await expectNoTenantOrSuccess(() => listTeams(), (teams) => {
      expect(Array.isArray(teams)).toBe(true);
    });
    await expectNoTenantOrSuccess(() => createTeam({ name: 'x', companyIds: [] }), (team) => {
      expect(team.name).toBe('x');
    });
    await expectNoTenantOrSuccess(() => listCompanyGroups(), (groups) => {
      expect(Array.isArray(groups)).toBe(true);
    });
    await expectNoTenantOrSuccess(() => createCompanyGroup({ name: 'x', companyIds: [] }), (group) => {
      expect(group.name).toBe('x');
    });
    await expectNoTenantOrSuccess(() => setDefaultLogo('https://cdn/none.png'));
    await expectNoTenantOrSuccess(() => getOrderNumberSettings(), (settings) => {
      expect(typeof settings.preview).toBe('string');
    });
    await expectNoTenantOrSuccess(() => updateOrderNumberSettings({ prefix: 'X' }), (settings) => {
      expect(settings.prefix).toBe('X');
    });
    await expectNoTenantOrSuccess(() => getVesselCompanyRoleSettings(), (settings) => {
      expect(Array.isArray(settings.roles)).toBe(true);
    });
    await expectNoTenantOrSuccess(() => updateVesselCompanyRoleSettings([]), (settings) => {
      expect(settings.roles).toEqual([]);
    });
    await expectNoTenantOrSuccess(() => getProductSettings(), (settings) => {
      expect(Array.isArray(settings.products)).toBe(true);
    });
    await expectNoTenantOrSuccess(() => updateProductSettings(['MGO']), (settings) => {
      expect(settings.products).toEqual(['MGO']);
    });
    await expectNoTenantOrSuccess(() => getUnitSettings(), (settings) => {
      expect(Array.isArray(settings.units)).toBe(true);
    });
    await expectNoTenantOrSuccess(() => updateUnitSettings(['MT']), (settings) => {
      expect(settings.units).toEqual(['MT']);
    });
    await expectNoTenantOrSuccess(() => getCurrencySettings(), (settings) => {
      expect(Array.isArray(settings.currencies)).toBe(true);
    });
    await expectNoTenantOrSuccess(() => updateCurrencySettings(['USD']), (settings) => {
      expect(settings.currencies).toContain('USD');
    });
    await expectNoTenantOrSuccess(() => getCompanyTypeSettings(), (settings) => {
      expect(Array.isArray(settings.companyTypes)).toBe(true);
    });
    await expectNoTenantOrSuccess(() => updateCompanyTypeSettings(['CLIENT']), (settings) => {
      expect(settings.companyTypes).toEqual(['CLIENT']);
    });
  });
});
