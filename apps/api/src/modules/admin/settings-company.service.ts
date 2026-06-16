// ═══════════════════════════════════════════════════════════════════════
//  Settings Company Service — own companies, teams, groups, banks, logos
// ═══════════════════════════════════════════════════════════════════════

import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { counterparties, teams as teamsTable, userTeams, companyGroups, companyGroupMembers, bankAccounts, users, tenants } from '../../db/schema';
import type { TenantSettings } from '../../db/schema';

async function getTenantSettingsRow() {
  const [tenant] = await db.select({ id: tenants.id, settings: tenants.settings }).from(tenants).limit(1);
  return { tenantId: tenant?.id ?? '', settings: (tenant?.settings ?? {}) as TenantSettings };
}

async function updateTenantField<T>(key: string, value: T): Promise<T> {
  const { tenantId, settings } = await getTenantSettingsRow();
  await db.update(tenants).set({ settings: { ...settings, [key]: value }, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
  return value;
}
import type { OwnCompanyDto, TeamDto, CompanyGroupDto, BankAccountDto } from '@fueld/types';

// ─── Own Companies ─────────────────────────────────────────────────

export async function listOwnCompanies(): Promise<OwnCompanyDto[]> {
  const rows = await db.select().from(counterparties).where(eq(counterparties.isOwnCompany, true)).orderBy(counterparties.name);
  return rows.map((r) => ({ id: r.id, name: r.name, country: r.country, brandColor: r.brandColor, physicalOpsEnabled: r.physicalOpsEnabled ?? false }));
}

export async function setOwnCompany(companyId: string, isOwn: boolean) {
  await db.update(counterparties).set({ isOwnCompany: isOwn, updatedAt: new Date() }).where(eq(counterparties.id, companyId));
}

export async function setCompanyPhysicalOpsEnabled(companyId: string, enabled: boolean) {
  await db.update(counterparties).set({ physicalOpsEnabled: enabled, updatedAt: new Date() }).where(eq(counterparties.id, companyId));
}

export async function updateOwnCompanyTerms(companyId: string, data: { customerTerms?: string | null; supplierTerms?: string | null }) {
  const setData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.customerTerms !== undefined) setData.customerTerms = data.customerTerms;
  if (data.supplierTerms !== undefined) setData.supplierTerms = data.supplierTerms;
  await db.update(counterparties).set(setData).where(eq(counterparties.id, companyId));
}

// ─── Teams ─────────────────────────────────────────────────────────

export async function listTeams(): Promise<TeamDto[]> {
  const rows = await db.select().from(teamsTable).orderBy(teamsTable.name);
  return Promise.all(rows.map(async (team) => {
    const members = await db.select({ userId: userTeams.userId }).from(userTeams).where(eq(userTeams.teamId, team.id));
    return { id: team.id, name: team.name, companyIds: team.companyIds ?? [], userIds: members.map((m) => m.userId) };
  }));
}

export async function createTeam(data: { name: string; companyIds: string[] }): Promise<TeamDto> {
  const [created] = await db.insert(teamsTable).values({ name: data.name, companyIds: data.companyIds }).returning();
  return { id: created.id, name: created.name, companyIds: created.companyIds ?? [], userIds: [] };
}

export async function updateTeam(id: string, data: { name?: string; companyIds?: string[] }): Promise<TeamDto> {
  const [updated] = await db.update(teamsTable).set({ ...data, updatedAt: new Date() }).where(eq(teamsTable.id, id)).returning();
  if (!updated) throw new Error('Team not found');
  const members = await db.select({ userId: userTeams.userId }).from(userTeams).where(eq(userTeams.teamId, updated.id));
  return { id: updated.id, name: updated.name, companyIds: updated.companyIds ?? [], userIds: members.map((m) => m.userId) };
}

export async function deleteTeam(teamId: string) {
  await db.delete(userTeams).where(eq(userTeams.teamId, teamId));
  await db.delete(teamsTable).where(eq(teamsTable.id, teamId));
}

// ─── Company Groups ───────────────────────────────────────────────

export async function listCompanyGroups(): Promise<CompanyGroupDto[]> {
  const rows = await db.select().from(companyGroups).orderBy(companyGroups.name);
  return Promise.all(rows.map(async (g) => {
    const members = await db.select({ companyId: companyGroupMembers.companyId }).from(companyGroupMember).where(eq(companyGroupMembers.groupId, g.id));
    return { id: g.id, name: g.name, companyIds: members.map((m) => m.companyId) };
  }));
}

export async function createCompanyGroup(data: { name: string; companyIds: string[] }): Promise<CompanyGroupDto> {
  const [created] = await db.insert(companyGroups).values({ name: data.name }).returning();
  if (data.companyIds.length) await db.insert(companyGroupMember).values(data.companyIds.map((cid) => ({ groupId: created.id, companyId: cid })));
  return { id: created.id, name: created.name, companyIds: data.companyIds };
}

export async function updateCompanyGroup(id: string, data: { name?: string; companyIds?: string[] }): Promise<CompanyGroupDto> {
  const [updated] = await db.update(companyGroups).set({ name: data.name, updatedAt: new Date() }).where(eq(companyGroups.id, id)).returning();
  if (!updated) throw new Error('Company group not found');
  if (data.companyIds) {
    await db.delete(companyGroupMember).where(eq(companyGroupMembers.groupId, id));
    if (data.companyIds.length) await db.insert(companyGroupMember).values(data.companyIds.map((cid) => ({ groupId: id, companyId: cid })));
  }
  const members = await db.select({ companyId: companyGroupMembers.companyId }).from(companyGroupMember).where(eq(companyGroupMembers.groupId, id));
  return { id: updated.id, name: updated.name, companyIds: members.map((m) => m.companyId) };
}

export async function deleteCompanyGroup(groupId: string) {
  await db.delete(companyGroupMember).where(eq(companyGroupMembers.groupId, groupId));
  await db.delete(companyGroups).where(eq(companyGroups.id, groupId));
}

// ─── User Company Access ──────────────────────────────────────────

export async function getUserCompanyAccess(userId: string): Promise<OwnCompanyDto[]> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { role: true } });
  if (!user || user.role === 'ADMIN') return listOwnCompanies();
  const allOwn = await listOwnCompanies();
  return allOwn;
}

export async function setUserCompanyOverrides(userId: string, companyIds: string[]) {
  await db.update(users).set({ companyOverrides: companyIds, updatedAt: new Date() }).where(eq(users.id, userId));
}

// ─── Banks ─────────────────────────────────────────────────────────

export async function listBankAccounts(counterpartyId: string): Promise<BankAccountDto[]> {
  const rows = await db.select().from(bankAccounts).where(eq(bankAccounts.counterpartyId, counterpartyId)).orderBy(bankAccounts.label);
  return rows.map((r) => ({ id: r.id, counterpartyId: r.counterpartyId, label: r.label, bankName: r.bankName, accountName: r.accountName, accountNumber: r.accountNumber, iban: r.iban, swift: r.swift, currency: r.currency, isDefault: r.isDefault, sortCode: r.sortCode, routingNumber: r.routingNumber, intermediaryBank: r.intermediaryBank, branchAddress: r.branchAddress }));
}

export async function createBankAccount(counterpartyId: string, data: { label: string; bankName?: string; accountName?: string; accountNumber?: string; iban?: string; swift?: string; currency?: string; isDefault?: boolean }): Promise<BankAccountDto> {
  const [created] = await db.insert(bankAccounts).values({ counterpartyId, ...data }).returning();
  return (await listBankAccounts(counterpartyId)).find((a) => a.id === created.id)!;
}

export async function updateBankAccount(id: string, data: Partial<{ label: string; bankName: string; accountName: string; accountNumber: string; iban: string; swift: string; currency: string; isDefault: boolean }>): Promise<BankAccountDto> {
  const [row] = await db.select({ counterpartyId: bankAccounts.counterpartyId }).from(bankAccounts).where(eq(bankAccounts.id, id)).limit(1);
  if (!row) throw new Error('Bank account not found');
  await db.update(bankAccounts).set({ ...data, updatedAt: new Date() }).where(eq(bankAccounts.id, id));
  return (await listBankAccounts(row.counterpartyId)).find((a) => a.id === id)!;
}

export async function deleteBankAccount(id: string, counterpartyId: string): Promise<void> {
  await db.delete(bankAccounts).where(eq(bankAccounts.id, id));
}

// ─── Logos ────────────────────────────────────────────────────

export async function setCompanyLogo(companyId: string, logoUrl: string | null): Promise<void> {
  await db.update(counterparties).set({ logoUrl, updatedAt: new Date() }).where(eq(counterparties.id, companyId));
}

export async function getCompanyLogo(companyId: string): Promise<string | null> {
  const [row] = await db.select({ logoUrl: counterparties.logoUrl }).from(counterparties).where(eq(counterparties.id, companyId)).limit(1);
  return row?.logoUrl ?? null;
}

export async function getDefaultLogo(): Promise<string | null> {
  const { settings } = await getTenantSettingsRow();
  return settings.defaultLogoUrl ?? null;
}

export async function setDefaultLogo(logoUrl: string | null): Promise<void> {
  await updateTenantField('defaultLogoUrl', logoUrl);
}

// ─── Company Terms ────────────────────────────────────────────────

export async function getCompanyTerms(companyId: string): Promise<{ customerTerms: string | null; supplierTerms: string | null }> {
  const [row] = await db.select({ customerTerms: counterparties.customerTerms, supplierTerms: counterparties.supplierTerms }).from(counterparties).where(eq(counterparties.id, companyId)).limit(1);
  return { customerTerms: row?.customerTerms ?? null, supplierTerms: row?.supplierTerms ?? null };
}
