// ═══════════════════════════════════════════════════════════════════════
//  Settings Service — Own companies, teams, company groups
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  counterparties,
  teams,
  teamCompanies,
  users,
  userCompanyOverrides,
  companyGroups,
  companyGroupMembers,
  tenants,
  bankAccounts,
} from '../../db/schema';
import type { OwnCompanyDto, TeamDto, CompanyGroupDto, BankAccountDto } from '@fueld/types';

/** Get tenant ID (single-tenant setup). */
async function getTenantId(): Promise<string> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');
  return tenant.id;
}

// ═══════════════════════════════════════════════════════════════════════
//  OWN COMPANIES
// ═══════════════════════════════════════════════════════════════════════

export async function listOwnCompanies(): Promise<OwnCompanyDto[]> {
  const rows = await db
    .select({
      id: counterparties.id,
      name: counterparties.name,
      country: counterparties.country,
      countryIso: counterparties.countryIso,
      logoUrl: counterparties.logoUrl,
    })
    .from(counterparties)
    .where(eq(counterparties.isOwnCompany, true))
    .orderBy(counterparties.name);

  return rows;
}

export async function setOwnCompany(companyId: string, isOwn: boolean) {
  const [updated] = await db
    .update(counterparties)
    .set({ isOwnCompany: isOwn, updatedAt: new Date() })
    .where(eq(counterparties.id, companyId))
    .returning({ id: counterparties.id, name: counterparties.name });

  if (!updated) throw new Error('Company not found');
  return updated;
}

// ═══════════════════════════════════════════════════════════════════════
//  TEAMS
// ═══════════════════════════════════════════════════════════════════════

export async function listTeams(): Promise<TeamDto[]> {
  const tenantId = await getTenantId();

  const teamRows = await db
    .select({
      id: teams.id,
      tenantId: teams.tenantId,
      name: teams.name,
      createdAt: teams.createdAt,
      updatedAt: teams.updatedAt,
    })
    .from(teams)
    .where(eq(teams.tenantId, tenantId))
    .orderBy(teams.name);

  const result: TeamDto[] = [];
  for (const t of teamRows) {
    // Get members of this team
    const companyRows = await db
      .select({
        id: counterparties.id,
        name: counterparties.name,
      })
      .from(teamCompanies)
      .innerJoin(counterparties, eq(teamCompanies.counterpartyId, counterparties.id))
      .where(eq(teamCompanies.teamId, t.id));

    // Count users in this team
    const [memberCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.teamId, t.id));

    // Get member details
    const memberRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.teamId, t.id))
      .orderBy(users.name);

    result.push({
      id: t.id,
      tenantId: t.tenantId,
      name: t.name,
      companyIds: companyRows.map((c) => c.id),
      companyNames: companyRows.map((c) => c.name),
      memberCount: memberCount?.count ?? 0,
      memberIds: memberRows.map((m) => m.id),
      memberNames: memberRows.map((m) => m.name),
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    });
  }

  return result;
}

export async function createTeam(data: { name: string; companyIds: string[] }): Promise<TeamDto> {
  const tenantId = await getTenantId();

  const [team] = await db
    .insert(teams)
    .values({ tenantId, name: data.name })
    .returning();

  // Insert team ↔ company links
  if (data.companyIds.length > 0) {
    await db.insert(teamCompanies).values(
      data.companyIds.map((cid) => ({ teamId: team!.id, counterpartyId: cid })),
    );
  }

  return (await listTeams()).find((t) => t.id === team!.id)!;
}

export async function updateTeam(
  teamId: string,
  data: { name?: string; companyIds?: string[] },
): Promise<TeamDto> {
  if (data.name !== undefined) {
    await db
      .update(teams)
      .set({ name: data.name, updatedAt: new Date() })
      .where(eq(teams.id, teamId));
  }

  if (data.companyIds !== undefined) {
    // Replace all team company links
    await db.delete(teamCompanies).where(eq(teamCompanies.teamId, teamId));
    if (data.companyIds.length > 0) {
      await db.insert(teamCompanies).values(
        data.companyIds.map((cid) => ({ teamId, counterpartyId: cid })),
      );
    }
  }

  const result = (await listTeams()).find((t) => t.id === teamId);
  if (!result) throw new Error('Team not found');
  return result;
}

export async function deleteTeam(teamId: string) {
  // Unassign users from this team
  await db
    .update(users)
    .set({ teamId: null, updatedAt: new Date() })
    .where(eq(users.teamId, teamId));

  const [deleted] = await db
    .delete(teams)
    .where(eq(teams.id, teamId))
    .returning({ id: teams.id });

  if (!deleted) throw new Error('Team not found');
  return deleted;
}

// ═══════════════════════════════════════════════════════════════════════
//  COMPANY GROUPS
// ═══════════════════════════════════════════════════════════════════════

export async function listCompanyGroups(): Promise<CompanyGroupDto[]> {
  const tenantId = await getTenantId();

  const groupRows = await db
    .select({
      id: companyGroups.id,
      tenantId: companyGroups.tenantId,
      name: companyGroups.name,
      createdAt: companyGroups.createdAt,
      updatedAt: companyGroups.updatedAt,
    })
    .from(companyGroups)
    .where(eq(companyGroups.tenantId, tenantId))
    .orderBy(companyGroups.name);

  const result: CompanyGroupDto[] = [];
  for (const g of groupRows) {
    const memberRows = await db
      .select({
        id: counterparties.id,
        name: counterparties.name,
      })
      .from(companyGroupMembers)
      .innerJoin(counterparties, eq(companyGroupMembers.counterpartyId, counterparties.id))
      .where(eq(companyGroupMembers.groupId, g.id));

    result.push({
      id: g.id,
      tenantId: g.tenantId,
      name: g.name,
      companyIds: memberRows.map((m) => m.id),
      companyNames: memberRows.map((m) => m.name),
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt.toISOString(),
    });
  }

  return result;
}

export async function createCompanyGroup(data: {
  name: string;
  companyIds: string[];
}): Promise<CompanyGroupDto> {
  const tenantId = await getTenantId();

  const [group] = await db
    .insert(companyGroups)
    .values({ tenantId, name: data.name })
    .returning();

  if (data.companyIds.length > 0) {
    await db.insert(companyGroupMembers).values(
      data.companyIds.map((cid) => ({ groupId: group!.id, counterpartyId: cid })),
    );
  }

  return (await listCompanyGroups()).find((g) => g.id === group!.id)!;
}

export async function updateCompanyGroup(
  groupId: string,
  data: { name?: string; companyIds?: string[] },
): Promise<CompanyGroupDto> {
  if (data.name !== undefined) {
    await db
      .update(companyGroups)
      .set({ name: data.name, updatedAt: new Date() })
      .where(eq(companyGroups.id, groupId));
  }

  if (data.companyIds !== undefined) {
    await db.delete(companyGroupMembers).where(eq(companyGroupMembers.groupId, groupId));
    if (data.companyIds.length > 0) {
      await db.insert(companyGroupMembers).values(
        data.companyIds.map((cid) => ({ groupId, counterpartyId: cid })),
      );
    }
  }

  const result = (await listCompanyGroups()).find((g) => g.id === groupId);
  if (!result) throw new Error('Company group not found');
  return result;
}

export async function deleteCompanyGroup(groupId: string) {
  const [deleted] = await db
    .delete(companyGroups)
    .where(eq(companyGroups.id, groupId))
    .returning({ id: companyGroups.id });

  if (!deleted) throw new Error('Company group not found');
  return deleted;
}

// ═══════════════════════════════════════════════════════════════════════
//  USER COMPANY ACCESS — resolve which own companies a user can access
// ═══════════════════════════════════════════════════════════════════════

export async function getUserCompanyAccess(userId: string): Promise<OwnCompanyDto[]> {
  // Check for per-user overrides first
  const overrides = await db
    .select({
      id: counterparties.id,
      name: counterparties.name,
      country: counterparties.country,
      countryIso: counterparties.countryIso,
    })
    .from(userCompanyOverrides)
    .innerJoin(counterparties, eq(userCompanyOverrides.counterpartyId, counterparties.id))
    .where(eq(userCompanyOverrides.userId, userId));

  if (overrides.length > 0) {
    return overrides;
  }

  // Fall back to team companies
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user?.teamId) {
    // No team, no overrides → return all own companies
    return listOwnCompanies();
  }

  const teamCos = await db
    .select({
      id: counterparties.id,
      name: counterparties.name,
      country: counterparties.country,
      countryIso: counterparties.countryIso,
    })
    .from(teamCompanies)
    .innerJoin(counterparties, eq(teamCompanies.counterpartyId, counterparties.id))
    .where(eq(teamCompanies.teamId, user.teamId));

  // If team has no companies assigned, return all own companies
  return teamCos.length > 0 ? teamCos : listOwnCompanies();
}

export async function setUserCompanyOverrides(userId: string, companyIds: string[]) {
  await db.delete(userCompanyOverrides).where(eq(userCompanyOverrides.userId, userId));

  if (companyIds.length > 0) {
    await db.insert(userCompanyOverrides).values(
      companyIds.map((cid) => ({ userId, counterpartyId: cid })),
    );
  }

  return getUserCompanyAccess(userId);
}

// ═══════════════════════════════════════════════════════════════════════
//  BANK ACCOUNTS
// ═══════════════════════════════════════════════════════════════════════

export async function listBankAccounts(counterpartyId: string): Promise<BankAccountDto[]> {
  const rows = await db
    .select()
    .from(bankAccounts)
    .where(eq(bankAccounts.counterpartyId, counterpartyId))
    .orderBy(bankAccounts.label);
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function createBankAccount(
  counterpartyId: string,
  data: {
    label: string;
    bankName: string;
    accountName?: string | null;
    accountNumber?: string | null;
    iban?: string | null;
    swiftBic?: string | null;
    currency: string;
    branchAddress?: string | null;
    sortCode?: string | null;
    routingNumber?: string | null;
    isDefault?: boolean;
    notes?: string | null;
  },
): Promise<BankAccountDto> {
  // If this one is default, unset others
  if (data.isDefault) {
    await db
      .update(bankAccounts)
      .set({ isDefault: false })
      .where(eq(bankAccounts.counterpartyId, counterpartyId));
  }

  const [row] = await db
    .insert(bankAccounts)
    .values({
      counterpartyId,
      label: data.label,
      bankName: data.bankName,
      accountName: data.accountName ?? null,
      accountNumber: data.accountNumber ?? null,
      iban: data.iban ?? null,
      swiftBic: data.swiftBic ?? null,
      currency: data.currency.toUpperCase(),
      branchAddress: data.branchAddress ?? null,
      sortCode: data.sortCode ?? null,
      routingNumber: data.routingNumber ?? null,
      isDefault: data.isDefault ?? false,
      notes: data.notes ?? null,
    })
    .returning();

  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function updateBankAccount(
  id: string,
  counterpartyId: string,
  data: Record<string, unknown>,
): Promise<BankAccountDto> {
  // If setting as default, unset others first
  if (data.isDefault === true) {
    await db
      .update(bankAccounts)
      .set({ isDefault: false })
      .where(eq(bankAccounts.counterpartyId, counterpartyId));
  }

  const setData: Record<string, unknown> = { updatedAt: new Date() };
  const allowed = [
    'label', 'bankName', 'accountName', 'accountNumber', 'iban',
    'swiftBic', 'currency', 'branchAddress', 'sortCode', 'routingNumber',
    'isDefault', 'notes',
  ];
  for (const key of allowed) {
    if (data[key] !== undefined) {
      setData[key] = key === 'currency' && typeof data[key] === 'string'
        ? (data[key] as string).toUpperCase()
        : data[key];
    }
  }

  const [row] = await db
    .update(bankAccounts)
    .set(setData)
    .where(and(eq(bankAccounts.id, id), eq(bankAccounts.counterpartyId, counterpartyId)))
    .returning();

  if (!row) throw new Error('Bank account not found');
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function deleteBankAccount(id: string, counterpartyId: string): Promise<void> {
  const result = await db
    .delete(bankAccounts)
    .where(and(eq(bankAccounts.id, id), eq(bankAccounts.counterpartyId, counterpartyId)))
    .returning({ id: bankAccounts.id });

  if (!result.length) throw new Error('Bank account not found');
}

// ═══════════════════════════════════════════════════════════════════════
//  COMPANY LOGO
// ═══════════════════════════════════════════════════════════════════════

export async function setCompanyLogo(companyId: string, logoUrl: string | null): Promise<void> {
  await db
    .update(counterparties)
    .set({ logoUrl, updatedAt: new Date() })
    .where(eq(counterparties.id, companyId));
}

export async function getCompanyLogo(companyId: string): Promise<string | null> {
  const [row] = await db
    .select({ logoUrl: counterparties.logoUrl })
    .from(counterparties)
    .where(eq(counterparties.id, companyId));
  return row?.logoUrl ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  DEFAULT LOGO (tenant setting)
// ═══════════════════════════════════════════════════════════════════════

export async function getDefaultLogo(): Promise<string | null> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) return null;
  return (tenant.settings as any)?.defaultLogoUrl ?? null;
}

export async function setDefaultLogo(logoUrl: string | null): Promise<void> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');
  const settings = { ...(tenant.settings as any), defaultLogoUrl: logoUrl };
  await db.update(tenants).set({ settings, updatedAt: new Date() }).where(eq(tenants.id, tenant.id));
}

// ═══════════════════════════════════════════════════════════════════════
//  ORDER NUMBER SETTINGS
// ═══════════════════════════════════════════════════════════════════════

export interface OrderNumberSettingsDto {
  template: string;
  prefix: string;
  nextSeq: number;
  preview: string;
}

function generatePreview(template: string, prefix: string, seq: number): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');

  let result = template
    .replace('{PREFIX}', prefix)
    .replace('{YYYY}', yyyy)
    .replace('{MM}', mm)
    .replace('{DD}', dd);

  result = result.replace(/\{SEQ:(\d+)\}/g, (_match: string, digits: string) => {
    return String(seq).padStart(parseInt(digits, 10), '0');
  });
  result = result.replace('{SEQ}', String(seq).padStart(6, '0'));

  return result;
}

export async function getOrderNumberSettings(): Promise<OrderNumberSettingsDto> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = (tenant.settings ?? {}) as import('../../db/schema').TenantSettings;
  const template = settings.orderNumberTemplate ?? '{YYYY}{MM}{DD}-{SEQ:6}';
  const prefix = settings.orderNumberPrefix ?? '';

  // Get current sequence
  const [seqRow] = await db
    .select({ lastSeq: sql<number>`COALESCE(last_seq, 0)` })
    .from(sql`order_number_sequences`)
    .where(sql`tenant_id = ${tenant.id}`)
    .limit(1);
  const nextSeq = (seqRow?.lastSeq ?? 0) + 1;

  return {
    template,
    prefix,
    nextSeq,
    preview: generatePreview(template, prefix, nextSeq),
  };
}

export async function updateOrderNumberSettings(data: {
  template?: string;
  prefix?: string;
}): Promise<OrderNumberSettingsDto> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = { ...(tenant.settings as any) };
  if (data.template !== undefined) settings.orderNumberTemplate = data.template;
  if (data.prefix !== undefined) settings.orderNumberPrefix = data.prefix;

  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));

  return getOrderNumberSettings();
}
// ═══════════════════════════════════════════════════════════════════════
//  VESSEL COMPANY ROLE SETTINGS
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_VESSEL_COMPANY_ROLES = [
  // Legal & Financial Owners
  { key: 'REGISTERED_OWNER', label: 'Registered Owner', group: 'Legal & Financial', description: 'The company holding the ship\'s legal title, almost always a shell company set up in a favorable flag state to limit liability.', seasearcherCode: 'RO' },
  { key: 'NOMINAL_OWNER', label: 'Nominal Owner', group: 'Legal & Financial', description: 'The company named on legal documents that holds no real economic power or operational control.', seasearcherCode: 'NO' },
  { key: 'BENEFICIAL_OWNER', label: 'Beneficial Owner', group: 'Legal & Financial', description: 'The actual individuals or entities at the top of the corporate ladder who ultimately control the vessel and receive its financial profits.', seasearcherCode: 'BO' },
  { key: 'GROUP_BENEFICIAL_OWNER', label: 'Group Beneficial Owner', group: 'Legal & Financial', description: 'The parent company or overarching shipping conglomerate that holds the controlling interest over a fleet of vessels.' },
  // Operational & Commercial Controllers
  { key: 'COMMERCIAL_OPERATOR', label: 'Commercial Operator', group: 'Operational & Commercial', description: 'The company responsible for the day-to-day commercial employment, chartering, and routing of the ship.', seasearcherCode: 'CO' },
  { key: 'THIRD_PARTY_OPERATOR', label: 'Third-Party Operator', group: 'Operational & Commercial', description: 'An external company contracted to operate the vessel, used to distinguish outsourced management from in-house operations.', seasearcherCode: 'TP' },
  { key: 'DISPONENT_OWNER', label: 'Disponent Owner', group: 'Operational & Commercial', description: 'A company that does not hold legal title but has chartered the ship and is commercially controlling or sub-chartering it to third parties as if they were the owner.' },
  { key: 'BAREBOAT_CHARTERER', label: 'Bareboat Charterer', group: 'Operational & Commercial', description: 'A company that leases the vessel completely bare (no crew, fuel, or provisions) and takes on full legal and operational responsibility for the lease duration.' },
  // Technical & Safety Managers
  { key: 'TECHNICAL_MANAGER', label: 'Technical Manager', group: 'Technical & Safety', description: 'The company responsible for the physical upkeep, maintenance, repairs, supplying of spare parts, and often the crewing of the ship.', seasearcherCode: 'TM' },
  { key: 'ISM_MANAGER', label: 'ISM Manager', group: 'Technical & Safety', description: 'The entity officially registered with the IMO as legally responsible for the ship\'s safety and pollution prevention under the ISM Code.', seasearcherCode: 'IM' },
  { key: 'SHIP_MANAGER', label: 'Ship Manager', group: 'Technical & Safety', description: 'The overarching company entrusted with the general management of the vessel, which may handle or subcontract the technical, commercial, and ISM duties.' },
];

export async function getVesselCompanyRoleSettings(): Promise<{ roles: { key: string; label: string; group: string; description?: string; seasearcherCode?: string }[] }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = (tenant.settings ?? {}) as import('../../db/schema').TenantSettings;
  const roles = settings.vesselCompanyRoles ?? DEFAULT_VESSEL_COMPANY_ROLES;
  return { roles };
}

export async function updateVesselCompanyRoleSettings(
  roles: { key: string; label: string; group: string; description?: string; seasearcherCode?: string }[],
): Promise<{ roles: { key: string; label: string; group: string; description?: string; seasearcherCode?: string }[] }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = { ...(tenant.settings as any) };
  settings.vesselCompanyRoles = roles;

  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));

  return getVesselCompanyRoleSettings();
}

// ═══════════════════════════════════════════════════════════════════════
//  PRODUCT SETTINGS
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_PRODUCTS = ['VLSFO', 'LSMGO', 'IFO380', 'MGO', 'LUBE'];

export async function getProductSettings(): Promise<{ products: string[] }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = (tenant.settings ?? {}) as import('../../db/schema').TenantSettings;
  return { products: settings.products ?? DEFAULT_PRODUCTS };
}

export async function updateProductSettings(products: string[]): Promise<{ products: string[] }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = { ...(tenant.settings as any) };
  settings.products = products;

  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));

  return getProductSettings();
}

// ═══════════════════════════════════════════════════════════════════════
//  UNIT SETTINGS
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_UNITS = ['MT', 'CBM', 'LT', 'BBL', 'GAL', 'KG'];

export async function getUnitSettings(): Promise<{ units: string[] }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = (tenant.settings ?? {}) as import('../../db/schema').TenantSettings;
  return { units: settings.units ?? DEFAULT_UNITS };
}

export async function updateUnitSettings(units: string[]): Promise<{ units: string[] }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = { ...(tenant.settings as any) };
  settings.units = units;

  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));

  return getUnitSettings();
}

// ═══════════════════════════════════════════════════════════════════════
//  CURRENCY SETTINGS
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_CURRENCIES = ['USD', 'EUR', 'DKK', 'AED'];

export async function getCurrencySettings(): Promise<{ currencies: string[] }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = (tenant.settings ?? {}) as import('../../db/schema').TenantSettings;
  return { currencies: settings.currencies ?? DEFAULT_CURRENCIES };
}

export async function updateCurrencySettings(currencies: string[]): Promise<{ currencies: string[] }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = { ...(tenant.settings as any) };
  settings.currencies = currencies;

  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));

  return getCurrencySettings();
}

// ═══════════════════════════════════════════════════════════════════════
//  COMPANY TYPE SETTINGS
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_COMPANY_TYPES = ['CLIENT', 'SUPPLIER', 'BARGE'];

export async function getCompanyTypeSettings(): Promise<{ companyTypes: string[] }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = (tenant.settings ?? {}) as import('../../db/schema').TenantSettings;
  return { companyTypes: settings.companyTypes ?? DEFAULT_COMPANY_TYPES };
}

export async function updateCompanyTypeSettings(companyTypes: string[]): Promise<{ companyTypes: string[] }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = { ...(tenant.settings as any) };
  settings.companyTypes = companyTypes;

  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));

  return getCompanyTypeSettings();
}