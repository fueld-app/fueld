// ═══════════════════════════════════════════════════════════════════════
//  Settings Service — Own companies, teams, company groups
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, sql, isNull } from 'drizzle-orm';
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
  priceReferences,
} from '../../db/schema';
import type { OwnCompanyDto, TeamDto, CompanyGroupDto, BankAccountDto } from '@fueld/types';

export const DEFAULT_FINANCING_RATE_ANNUAL = 0.08;
export const DEFAULT_FINANCING_DAY_COUNT = 365;

const DEFAULT_CUSTOMER_TERMS =
  "This ${documentName} is made subject to ${companyName}’s General Terms and Conditions of Sale effective February 2026 (“ GTCs”), available at www.rivieramarine.mc,\n" +
  "which together with this ${documentName} constitute the entire agreement between the parties. In the event of conflict, this ${documentName} shall prevail, except in respect of Title\n" +
  "and Retention of Title, Payment, Credit & Security, Sanctions & Compliance, Limitation of Liability and Law & Arbitration, which may only be amended by written agreement\n" +
  "signed by Seller. Any terms or conditions submitted by Buyer are expressly rejected.\n" +
  "Delivery procedures, sampling and operational formalities may be carried out in accordance with the Physical Supplier’s standard procedures; however, as between Seller\n" +
  "and Buyer, the GTCs shall prevail in case of inconsistency.\n" +
  "Buyer is requested to confirm acceptance. Absent written objection prior to delivery, performance of the Contract shall constitute full acceptance of these Terms.";

const DEFAULT_SUPPLIER_TERMS =
  "Supplier warrants and represents that:\n" +
  "1. The Products are not of sanctioned origin and neither Supplier, its affiliates, directors, officers, employees nor ultimate beneficial owners are subject to sanctions\n" +
  "imposed by the United Nations, European Union, United Kingdom, United States or Singapore.\n" +
  "2. Supplier is and shall remain in full compliance with all applicable trade sanctions, export controls and related laws (“Sanctions Laws”).\n" +
  "If, in ${companyName}’s reasonable opinion, any of the above warranties are inaccurate, or if payment under this contract may be delayed, blocked or exposed to\n" +
  "regulatory risk, ${companyName} shall be entitled , without liability , to suspend performance , terminate the contract , change the currency of payment , or\n" +
  "implement any alternative lawful payment mechanism at its sole discretion.\n" +
  "Supplier further warrants that:\n" +
  "• The supply complies with MARPOL Annex VI and applicable MEPC guidelines;\n" +
  "• The supply complies with SOLAS requirements, including provision of a valid MSDS prior to delivery;\n" +
  "• The MARPOL sample shall be drawn at the receiving vessel’s manifold by continuous drip sampler;\n" +
  "• The Products shall be stable, homogeneous and free from waste oils or harmful contaminants.\n" +
  "Quantities ordered are maximum quantities. ${companyName} shall not be responsible for payment of quantities supplied in excess of those nominated unless\n" +
  "expressly agreed in writing.\n" +
  "Signed and stamped Bunker Delivery Receipts must be provided with the invoice. ${companyName} reserves the right to withhold payment pending receipt of\n" +
  "proper delivery documentation.";

/** Get tenant ID (single-tenant setup). */
async function getTenantId(): Promise<string> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');
  return tenant.id;
}

const OWN_COMPANY_SELECT = {
  id: counterparties.id,
  name: counterparties.name,
  country: counterparties.country,
  countryIso: counterparties.countryIso,
  logoUrl: counterparties.logoUrl,
  brandColor: counterparties.brandColor,
  customerTerms: counterparties.customerTerms,
  supplierTerms: counterparties.supplierTerms,
  vatNumber: counterparties.vatNumber,
  companyRegistrationNumber: counterparties.companyRegistrationNumber,
  fraudPreventionText: counterparties.fraudPreventionText,
  latePaymentInterest: counterparties.latePaymentInterest,
};

const OWN_COMPANY_SELECT_LEGACY = {
  id: counterparties.id,
  name: counterparties.name,
  country: counterparties.country,
  countryIso: counterparties.countryIso,
  logoUrl: counterparties.logoUrl,
  brandColor: counterparties.brandColor,
  customerTerms: counterparties.customerTerms,
  supplierTerms: counterparties.supplierTerms,
  vatNumber: counterparties.vatNumber,
  fraudPreventionText: counterparties.fraudPreventionText,
  latePaymentInterest: counterparties.latePaymentInterest,
};

function isMissingCompanyRegistrationNumberColumnError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('company_registration_number');
}

function withLegacyRegistrationNumber(
  rows: Array<Omit<OwnCompanyDto, 'companyRegistrationNumber'>>,
): OwnCompanyDto[] {
  return rows.map((row) => ({ ...row, companyRegistrationNumber: null, brandColor: row.brandColor ?? null }));
}

// ═══════════════════════════════════════════════════════════════════════
//  OWN COMPANIES
// ═══════════════════════════════════════════════════════════════════════

export async function listOwnCompanies(): Promise<OwnCompanyDto[]> {
  try {
    const rows = await db
      .select(OWN_COMPANY_SELECT)
      .from(counterparties)
      .where(eq(counterparties.isOwnCompany, true))
      .orderBy(counterparties.name);

    return rows;
  } catch (err) {
    if (!isMissingCompanyRegistrationNumberColumnError(err)) throw err;

    const legacyRows = await db
      .select(OWN_COMPANY_SELECT_LEGACY)
      .from(counterparties)
      .where(eq(counterparties.isOwnCompany, true))
      .orderBy(counterparties.name);

    return withLegacyRegistrationNumber(legacyRows);
  }
}

export async function setOwnCompany(companyId: string, isOwn: boolean) {
  const [updated] = await db
    .update(counterparties)
    .set({ isOwnCompany: isOwn, updatedAt: new Date() })
    .where(eq(counterparties.id, companyId))
    .returning({ id: counterparties.id, name: counterparties.name });

  if (!updated) throw new Error('Company not found');

  if (isOwn) {
    // Initialize default terms for newly-marked own companies.
    await db
      .update(counterparties)
      .set({ customerTerms: DEFAULT_CUSTOMER_TERMS, updatedAt: new Date() })
      .where(and(eq(counterparties.id, companyId), isNull(counterparties.customerTerms)));
    await db
      .update(counterparties)
      .set({ supplierTerms: DEFAULT_SUPPLIER_TERMS, updatedAt: new Date() })
      .where(and(eq(counterparties.id, companyId), isNull(counterparties.supplierTerms)));
  }

  return updated;
}

/** Toggle physical-ops eligibility for a company (warehouses + inventory rules). */
export async function setCompanyPhysicalOpsEnabled(companyId: string, enabled: boolean) {
  const [updated] = await db
    .update(counterparties)
    .set({ physicalOpsEnabled: enabled, updatedAt: new Date() })
    .where(eq(counterparties.id, companyId))
    .returning({
      id: counterparties.id,
      name: counterparties.name,
      physicalOpsEnabled: counterparties.physicalOpsEnabled,
    });
  if (!updated) throw new Error('Company not found');
  return updated;
}

export async function updateOwnCompanyTerms(companyId: string, data: {
  customerTerms?: string | null;
  supplierTerms?: string | null;
  vatNumber?: string | null;
  companyRegistrationNumber?: string | null;
  fraudPreventionText?: string | null;
  latePaymentInterest?: string | null;
  brandColor?: string | null;
}): Promise<OwnCompanyDto> {
  const [row] = await db
    .select({
      id: counterparties.id,
      isOwnCompany: counterparties.isOwnCompany,
    })
    .from(counterparties)
    .where(eq(counterparties.id, companyId))
    .limit(1);

  if (!row) throw new Error('Company not found');
  if (!row.isOwnCompany) throw new Error('Company is not marked as own');

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (data.customerTerms !== undefined) {
    patch.customerTerms = data.customerTerms?.trim() ? data.customerTerms : null;
  }
  if (data.supplierTerms !== undefined) {
    patch.supplierTerms = data.supplierTerms?.trim() ? data.supplierTerms : null;
  }
  if (data.vatNumber !== undefined) {
    patch.vatNumber = data.vatNumber?.trim() ? data.vatNumber : null;
  }
  if (data.companyRegistrationNumber !== undefined) {
    patch.companyRegistrationNumber = data.companyRegistrationNumber?.trim()
      ? data.companyRegistrationNumber
      : null;
  }
  if (data.fraudPreventionText !== undefined) {
    patch.fraudPreventionText = data.fraudPreventionText?.trim() ? data.fraudPreventionText : null;
  }
  if (data.latePaymentInterest !== undefined) {
    patch.latePaymentInterest = data.latePaymentInterest?.trim() ? data.latePaymentInterest : null;
  }
  if (data.brandColor !== undefined) {
    patch.brandColor = data.brandColor?.trim() ? data.brandColor : null;
  }

  try {
    await db.update(counterparties).set(patch).where(eq(counterparties.id, companyId));
  } catch (err) {
    if (!isMissingCompanyRegistrationNumberColumnError(err) || !('companyRegistrationNumber' in patch)) {
      throw err;
    }
    delete patch['companyRegistrationNumber'];
    await db.update(counterparties).set(patch).where(eq(counterparties.id, companyId));
  }

  const list = await listOwnCompanies();
  const updated = list.find((c) => c.id === companyId);
  if (!updated) throw new Error('Failed to load updated own company');
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
  const overrides = await (async () => {
    try {
      return await db
        .select(OWN_COMPANY_SELECT)
        .from(userCompanyOverrides)
        .innerJoin(counterparties, eq(userCompanyOverrides.counterpartyId, counterparties.id))
        .where(eq(userCompanyOverrides.userId, userId));
    } catch (err) {
      if (!isMissingCompanyRegistrationNumberColumnError(err)) throw err;
      const legacy = await db
        .select(OWN_COMPANY_SELECT_LEGACY)
        .from(userCompanyOverrides)
        .innerJoin(counterparties, eq(userCompanyOverrides.counterpartyId, counterparties.id))
        .where(eq(userCompanyOverrides.userId, userId));
      return withLegacyRegistrationNumber(legacy);
    }
  })();

  if (overrides.length > 0) {
    return overrides;
  }

  // Fall back to team companies
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  const teamId = user?.teamId;
  if (!teamId) {
    // No team, no overrides → return all own companies
    return listOwnCompanies();
  }

  const teamCos = await (async () => {
    try {
      return await db
        .select(OWN_COMPANY_SELECT)
        .from(teamCompanies)
        .innerJoin(counterparties, eq(teamCompanies.counterpartyId, counterparties.id))
        .where(eq(teamCompanies.teamId, teamId));
    } catch (err) {
      if (!isMissingCompanyRegistrationNumberColumnError(err)) throw err;
      const legacy = await db
        .select(OWN_COMPANY_SELECT_LEGACY)
        .from(teamCompanies)
        .innerJoin(counterparties, eq(teamCompanies.counterpartyId, counterparties.id))
        .where(eq(teamCompanies.teamId, teamId));
      return withLegacyRegistrationNumber(legacy);
    }
  })();

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
    intermediaryBank?: string | null;
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
      intermediaryBank: data.intermediaryBank ?? null,
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
    'intermediaryBank', 'isDefault', 'notes',
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

function normalizeOrderNumberTemplate(template: string): string {
  const trimmed = template.trim();
  if (!trimmed) return '{YYYY}{MM}{DD}-{SEQ:6}';

  const hasSeqToken = /\{SEQ(?::\d+)?\}/.test(trimmed);
  if (hasSeqToken) return trimmed;

  return `${trimmed}-{SEQ:6}`;
}

function generatePreview(template: string, prefix: string, seq: number): string {
  const normalizedTemplate = normalizeOrderNumberTemplate(template);
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');

  let result = normalizedTemplate
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
  const template = normalizeOrderNumberTemplate(
    settings.orderNumberTemplate ?? '{YYYY}{MM}{DD}-{SEQ:6}',
  );
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
  if (data.template !== undefined) {
    settings.orderNumberTemplate = normalizeOrderNumberTemplate(data.template);
  }
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

const DEFAULT_PRODUCTS = [
  'VLSFO', 'LSMGO', 'IFO380CST', 'IFO180CST', 'IFO120CST', 'IFO30CST',
  'IFO', 'MGO', 'MDO', 'LSIFO', 'LUBE',
  'ITEM', 'COMMISSION', 'HIRE', 'PAYMENT', 'CREDIT_NOTE',
  'CUTTERSTOCK', 'PYGAS', 'BARGING_FEE',
];

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

const DEFAULT_UNITS = ['MT', 'MTS', 'CBM', 'LT', 'BBL', 'GAL', 'KG'];

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
//  UNIT CONVERSION SETTINGS
// ═══════════════════════════════════════════════════════════════════════

export interface UnitConversion {
  productType?: string;
  fromUnit: string;
  toUnit: string;
  factor: number;
}

const DEFAULT_UNIT_CONVERSIONS: UnitConversion[] = [
  { productType: 'IFO380CST', fromUnit: 'MT', toUnit: 'CBM', factor: 1.009 },
  { productType: 'VLSFO', fromUnit: 'MT', toUnit: 'CBM', factor: 1.053 },
  { productType: 'LSMGO', fromUnit: 'MT', toUnit: 'CBM', factor: 1.183 },
  { productType: 'HSFO', fromUnit: 'MT', toUnit: 'CBM', factor: 1.02 },
  { fromUnit: 'MT', toUnit: 'CBM', factor: 1.1765 },
  { fromUnit: 'CBM', toUnit: 'MT', factor: 0.85 },
  { fromUnit: 'MT', toUnit: 'BBL', factor: 7.33 },
  { fromUnit: 'BBL', toUnit: 'MT', factor: 0.1364 },
];

export async function getUnitConversionSettings(): Promise<{ conversions: UnitConversion[] }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = (tenant.settings ?? {}) as import('../../db/schema').TenantSettings;
  return { conversions: settings.unitConversions ?? DEFAULT_UNIT_CONVERSIONS };
}

export async function updateUnitConversionSettings(conversions: UnitConversion[]): Promise<{ conversions: UnitConversion[] }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = { ...(tenant.settings as any) };
  settings.unitConversions = conversions;

  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));

  return getUnitConversionSettings();
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
//  FINANCING SETTINGS
// ═══════════════════════════════════════════════════════════════════════

export async function getFinancingSettings(): Promise<{ annualRate: number; dayCountConvention: number }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = (tenant.settings ?? {}) as import('../../db/schema').TenantSettings;
  const annualRate = typeof settings.financingRateAnnual === 'number' && Number.isFinite(settings.financingRateAnnual)
    ? settings.financingRateAnnual
    : DEFAULT_FINANCING_RATE_ANNUAL;

  return {
    annualRate,
    dayCountConvention: DEFAULT_FINANCING_DAY_COUNT,
  };
}

export async function updateFinancingSettings(annualRate: number): Promise<{ annualRate: number; dayCountConvention: number }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  if (!Number.isFinite(annualRate) || annualRate < 0 || annualRate > 1) {
    throw new Error('Financing annual rate must be between 0 and 1');
  }

  const settings = { ...(tenant.settings as any) };
  settings.financingRateAnnual = annualRate;

  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));

  return getFinancingSettings();
}

// ═══════════════════════════════════════════════════════════════════════
//  COMPANY TYPE SETTINGS
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_COMPANY_TYPES = ['CLIENT', 'SUPPLIER', 'BROKER', 'AGENT'];
const DEFAULT_ATTACHMENT_TYPES = ['BDR', 'OTHER'];

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

// ═══════════════════════════════════════════════════════════════════════
//  ATTACHMENT TYPE SETTINGS
// ═══════════════════════════════════════════════════════════════════════

export async function getAttachmentTypeSettings(): Promise<{ attachmentTypes: string[] }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = (tenant.settings ?? {}) as import('../../db/schema').TenantSettings;
  return { attachmentTypes: settings.attachmentTypes ?? DEFAULT_ATTACHMENT_TYPES };
}

export async function updateAttachmentTypeSettings(attachmentTypes: string[]): Promise<{ attachmentTypes: string[] }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const cleaned = Array.from(new Set(
    attachmentTypes
      .map((type) => type.trim().toUpperCase())
      .filter((type) => type.length > 0),
  ));

  if (!cleaned.length) {
    throw new Error('At least one attachment type is required');
  }

  const settings = { ...(tenant.settings as any) };
  settings.attachmentTypes = cleaned;

  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));

  return getAttachmentTypeSettings();
}

// ═══════════════════════════════════════════════════════════════════════
//  INQUIRY CANCELLATION REASON SETTINGS
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_INQUIRY_CANCEL_REASONS = [
  'Price not competitive',
  'Customer cancelled request',
  'No supplier availability',
  'Credit not approved',
  'Duplicate inquiry',
  'Other',
];

export async function getInquiryCancelReasonSettings(): Promise<{ reasons: string[] }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = (tenant.settings ?? {}) as import('../../db/schema').TenantSettings;
  return { reasons: settings.inquiryCancelReasons ?? DEFAULT_INQUIRY_CANCEL_REASONS };
}

export async function updateInquiryCancelReasonSettings(reasons: string[]): Promise<{ reasons: string[] }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const cleaned = reasons
    .map((reason) => reason.trim())
    .filter((reason) => reason.length > 0);

  if (!cleaned.length) {
    throw new Error('At least one inquiry cancellation reason is required');
  }

  const settings = { ...(tenant.settings as any) };
  settings.inquiryCancelReasons = cleaned;

  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));

  return getInquiryCancelReasonSettings();
}

// ═══════════════════════════════════════════════════════════════════════
//  INQUIRY SETTINGS
// ═══════════════════════════════════════════════════════════════════════

export const DEFAULT_SUPPLIER_RESPONSE_URL_ENABLED = true;
export const DEFAULT_AUTO_MARK_NO_REPLY_AFTER_HOURS = 168;
export const DEFAULT_RESPONSE_DEADLINE_HOURS = 48;
export const DEFAULT_NOTIFY_QUOTE_SUBMIT_EMAIL = false;
export const DEFAULT_NOTIFY_QUOTE_SUBMIT_PUSH = false;
export const DEFAULT_NOTIFY_QUOTE_SUBMIT_WHATSAPP = false;

export interface InquirySettings {
  supplierResponseUrlEnabled: boolean;
  autoMarkNoReplyAfterHours: number | null;
  defaultResponseDeadlineHours: number | null;
  notifyQuoteSubmitEmail: boolean;
  notifyQuoteSubmitPush: boolean;
  notifyQuoteSubmitWhatsApp: boolean;
}

export async function getInquirySettings(): Promise<InquirySettings> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = (tenant.settings ?? {}) as import('../../db/schema').TenantSettings;
  const inquirySettings = settings.inquirySettings ?? {};
  const autoMarkNoReplyAfterHours = inquirySettings.autoMarkNoReplyAfterHours;

  return {
    supplierResponseUrlEnabled: inquirySettings.supplierResponseUrlEnabled ?? DEFAULT_SUPPLIER_RESPONSE_URL_ENABLED,
    autoMarkNoReplyAfterHours:
      autoMarkNoReplyAfterHours === null
        ? null
        : typeof autoMarkNoReplyAfterHours === 'number'
          ? autoMarkNoReplyAfterHours
          : DEFAULT_AUTO_MARK_NO_REPLY_AFTER_HOURS,
    defaultResponseDeadlineHours:
      inquirySettings.defaultResponseDeadlineHours === null
        ? null
        : typeof inquirySettings.defaultResponseDeadlineHours === 'number' && inquirySettings.defaultResponseDeadlineHours > 0
        ? inquirySettings.defaultResponseDeadlineHours
        : DEFAULT_RESPONSE_DEADLINE_HOURS,
    notifyQuoteSubmitEmail: inquirySettings.notifyQuoteSubmitEmail ?? DEFAULT_NOTIFY_QUOTE_SUBMIT_EMAIL,
    notifyQuoteSubmitPush: inquirySettings.notifyQuoteSubmitPush ?? DEFAULT_NOTIFY_QUOTE_SUBMIT_PUSH,
    notifyQuoteSubmitWhatsApp: inquirySettings.notifyQuoteSubmitWhatsApp ?? DEFAULT_NOTIFY_QUOTE_SUBMIT_WHATSAPP,
  };
}

export async function updateInquirySettings(data: {
  supplierResponseUrlEnabled?: boolean;
  autoMarkNoReplyAfterHours?: number | null;
  defaultResponseDeadlineHours?: number | null;
  notifyQuoteSubmitEmail?: boolean;
  notifyQuoteSubmitPush?: boolean;
  notifyQuoteSubmitWhatsApp?: boolean;
}): Promise<InquirySettings> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = { ...(tenant.settings as any) };
  const inquirySettings = { ...(settings.inquirySettings ?? {}) };

  if (data.supplierResponseUrlEnabled !== undefined) {
    inquirySettings.supplierResponseUrlEnabled = data.supplierResponseUrlEnabled;
  }

  if (data.notifyQuoteSubmitEmail !== undefined) {
    inquirySettings.notifyQuoteSubmitEmail = data.notifyQuoteSubmitEmail;
  }

  if (data.notifyQuoteSubmitPush !== undefined) {
    inquirySettings.notifyQuoteSubmitPush = data.notifyQuoteSubmitPush;
  }

  if (data.notifyQuoteSubmitWhatsApp !== undefined) {
    inquirySettings.notifyQuoteSubmitWhatsApp = data.notifyQuoteSubmitWhatsApp;
  }

  if (data.autoMarkNoReplyAfterHours !== undefined) {
    if (data.autoMarkNoReplyAfterHours === null) {
      inquirySettings.autoMarkNoReplyAfterHours = null;
    } else {
      const normalized = Number(data.autoMarkNoReplyAfterHours);
      if (!Number.isFinite(normalized) || normalized < 0) {
        throw new Error('Auto-mark no reply hours must be zero or greater');
      }
      inquirySettings.autoMarkNoReplyAfterHours = Math.round(normalized);
    }
  }

  if (data.defaultResponseDeadlineHours !== undefined) {
    if (data.defaultResponseDeadlineHours === null) {
      inquirySettings.defaultResponseDeadlineHours = null;
      settings.inquirySettings = inquirySettings;

      await db
        .update(tenants)
        .set({ settings, updatedAt: new Date() })
        .where(eq(tenants.id, tenant.id));

      return getInquirySettings();
    }

    const normalized = Number(data.defaultResponseDeadlineHours);
    if (!Number.isFinite(normalized) || normalized < 1) {
      throw new Error('Response deadline must be at least 1 hour');
    }
    inquirySettings.defaultResponseDeadlineHours = Math.round(normalized);
  }

  settings.inquirySettings = inquirySettings;

  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));

  return getInquirySettings();
}

// ═══════════════════════════════════════════════════════════════════════
//  WHATSAPP SETTINGS
// ═══════════════════════════════════════════════════════════════════════

export async function getWhatsAppSettings(): Promise<{ enabled: boolean; defaultGroupJid: string | null; incomingRfqEnabled: boolean; firstInquiryGroupNotificationEnabled: boolean }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = (tenant.settings ?? {}) as import('../../db/schema').TenantSettings;
  return {
    enabled: settings.whatsappEnabled ?? false,
    defaultGroupJid: settings.whatsappDefaultGroupJid ?? null,
    incomingRfqEnabled: settings.whatsappIncomingRfqEnabled ?? true,
    firstInquiryGroupNotificationEnabled: settings.whatsappFirstInquiryGroupNotificationEnabled ?? true,
  };
}

export async function updateWhatsAppSettings(data: { enabled?: boolean; defaultGroupJid?: string | null; incomingRfqEnabled?: boolean; firstInquiryGroupNotificationEnabled?: boolean }): Promise<{ enabled: boolean; defaultGroupJid: string | null; incomingRfqEnabled: boolean; firstInquiryGroupNotificationEnabled: boolean }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = { ...(tenant.settings as any) };
  if (data.enabled !== undefined) settings.whatsappEnabled = data.enabled;
  if (data.defaultGroupJid !== undefined) settings.whatsappDefaultGroupJid = data.defaultGroupJid;
  if (data.incomingRfqEnabled !== undefined) settings.whatsappIncomingRfqEnabled = data.incomingRfqEnabled;
  if (data.firstInquiryGroupNotificationEnabled !== undefined) {
    settings.whatsappFirstInquiryGroupNotificationEnabled = data.firstInquiryGroupNotificationEnabled;
  }

  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));

  return getWhatsAppSettings();
}

/**
 * Fetch terms for a selected company.
 * @param companyId - The ID of the selected company.
 * @returns An object containing customer and supplier terms.
 */
export async function getCompanyTerms(companyId: string): Promise<{ customerTerms: string | null; supplierTerms: string | null }> {
  const companies = await listOwnCompanies();
  const selectedCompany = companies.find((company) => company.id === companyId);

  if (!selectedCompany) {
    throw new Error(`Company with ID ${companyId} not found.`);
  }

  return {
    customerTerms: selectedCompany.customerTerms,
    supplierTerms: selectedCompany.supplierTerms,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  PRICE REFERENCE SETTINGS (formula pricing sources)
// ═══════════════════════════════════════════════════════════════════════

function mapPriceReference(row: typeof priceReferences.$inferSelect) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    code: row.code,
    description: row.description ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listPriceReferences() {
  const tenantId = await getTenantId();
  const rows = await db
    .select()
    .from(priceReferences)
    .where(eq(priceReferences.tenantId, tenantId))
    .orderBy(priceReferences.name);
  return rows.map(mapPriceReference);
}

export async function createPriceReference(input: { name: string; code: string; description?: string | null }) {
  const tenantId = await getTenantId();
  const [created] = await db
    .insert(priceReferences)
    .values({
      tenantId,
      name: input.name.trim(),
      code: input.code.trim().toUpperCase(),
      description: input.description?.trim() || null,
    })
    .returning();
  return mapPriceReference(created);
}

export async function updatePriceReference(id: string, input: { name?: string; code?: string; description?: string | null }) {
  const setData: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) setData.name = input.name.trim();
  if (input.code !== undefined) setData.code = input.code.trim().toUpperCase();
  if (input.description !== undefined) setData.description = input.description?.trim() || null;

  const [updated] = await db
    .update(priceReferences)
    .set(setData)
    .where(eq(priceReferences.id, id))
    .returning();
  if (!updated) throw new Error('Price reference not found');
  return mapPriceReference(updated);
}

export async function deletePriceReference(id: string) {
  const [deleted] = await db
    .delete(priceReferences)
    .where(eq(priceReferences.id, id))
    .returning({ id: priceReferences.id });
  if (!deleted) throw new Error('Price reference not found');
  return deleted;
}

// ═══════════════════════════════════════════════════════════════════════
//  SEGMENT SETTINGS
// ═══════════════════════════════════════════════════════════════════════

export type SegmentCategory = {
  key: string;
  label: string;
  mode: 'multi' | 'single';
  options: { key: string; label: string; description?: string }[];
};

const DEFAULT_SEGMENT_CATEGORIES: SegmentCategory[] = [
  {
    key: 'business',
    label: 'Business',
    mode: 'multi',
    options: [
      { key: 'tramp', label: 'Tramp' },
      { key: 'liner', label: 'Liner' },
      { key: 'project', label: 'Project' },
      { key: 'others', label: 'Others' },
    ],
  },
  {
    key: 'purchasing',
    label: 'Purchasing',
    mode: 'single',
    options: [
      { key: 'department', label: 'Department' },
      { key: 'dedicated_buyer', label: 'Dedicated Buyer' },
      { key: 'operators', label: 'Operators' },
      { key: 'others', label: 'Others' },
    ],
  },
];

export async function getSegmentSettings(): Promise<{ segmentCategories: SegmentCategory[] }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = (tenant.settings ?? {}) as import('../../db/schema').TenantSettings;
  return { segmentCategories: settings.segmentCategories ?? DEFAULT_SEGMENT_CATEGORIES };
}

export async function updateSegmentSettings(segmentCategories: SegmentCategory[]): Promise<{ segmentCategories: SegmentCategory[] }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = { ...(tenant.settings as any) };
  settings.segmentCategories = segmentCategories;

  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));

  return getSegmentSettings();
}

// ─── Broker Settings ──────────────────────────────────────────────────

export async function getBrokerSettings(): Promise<{ brokerCcCustomer: boolean }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = (tenant.settings ?? {}) as import('../../db/schema').TenantSettings;
  return { brokerCcCustomer: settings.brokerCcCustomer ?? false };
}

export async function updateBrokerSettings(data: { brokerCcCustomer?: boolean }): Promise<{ brokerCcCustomer: boolean }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = { ...(tenant.settings as any) };
  if (data.brokerCcCustomer !== undefined) settings.brokerCcCustomer = data.brokerCcCustomer;

  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));

  return getBrokerSettings();
}

// ═══════════════════════════════════════════════════════════════════════
//  FOLLOW-UP SETTINGS
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_FOLLOW_UP_DAYS = 90;

export async function getFollowUpSettings(): Promise<{ defaultFollowUpDays: number }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = (tenant.settings ?? {}) as import('../../db/schema').TenantSettings;
  const days = settings.followUpSettings?.defaultFollowUpDays;
  return { defaultFollowUpDays: typeof days === 'number' && days > 0 ? days : DEFAULT_FOLLOW_UP_DAYS };
}

export async function updateFollowUpSettings(data: { defaultFollowUpDays?: number }): Promise<{ defaultFollowUpDays: number }> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = { ...(tenant.settings as any) };
  const followUpSettings = { ...(settings.followUpSettings ?? {}) };

  if (data.defaultFollowUpDays !== undefined) {
    if (!Number.isFinite(data.defaultFollowUpDays) || data.defaultFollowUpDays < 1 || data.defaultFollowUpDays > 365) {
      throw new Error('Default follow-up days must be between 1 and 365');
    }
    followUpSettings.defaultFollowUpDays = Math.round(data.defaultFollowUpDays);
  }

  settings.followUpSettings = followUpSettings;

  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));

  return getFollowUpSettings();
}