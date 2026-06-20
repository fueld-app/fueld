// ═══════════════════════════════════════════════════════════════════════
//  Company CRUD Service — core CRUD + seasearcher + search
// ═══════════════════════════════════════════════════════════════════════

import { eq, ilike, or, and, sql, asc, desc, inArray, ne } from 'drizzle-orm';
import { db } from '../../db';
import { escapeLikePattern } from '../../utils/like';
import { counterparties, orders, vessels, places, users, vesselCompanies } from '../../db/schema';
import { matchLocalVessels } from '../vessels/vessel.service';
import type { SyncResult, SyncConflict } from './company.types';
import { isMissingCompanyRegistrationColumnError, normalizeSeasearcherCompanyTypes } from './company.types';
import { seasearcherCompanyDetail, seasearcherCompanySearch, seasearcherCompanyFleet, seasearcherCompanyHierarchy, seasearcherCompanySeizures, seasearcherCompanySanctions } from '../lloyds/lli.client';

export async function listCompanies(query?: {
  search?: string;
  types?: string[];
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  page?: number;
}) {
  const conditions = [];
  if (query?.search) {
    conditions.push(
      or(
        ilike(counterparties.name, `%${escapeLikePattern(query.search)}%`),
        ilike(counterparties.companyImo, `%${escapeLikePattern(query.search)}%`),
      ),
    );
  }
  if (query?.types?.length) {
    // Companies can have either 'type' singular or 'types' array
    const typeConditions = query.types.map((t) => or(eq(counterparties.type, t as any), sql`${counterparties.types} @> ARRAY[${t}]::text[]`));
    conditions.push(or(...typeConditions));
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const limit = query?.limit ?? 25;
  const page = query?.page ?? 1;
  const offset = (page - 1) * limit;

  const sortMap: Record<string, any> = {
    name: counterparties.name,
    type: counterparties.type,
    country: counterparties.country,
    createdAt: counterparties.createdAt,
  };
  const sortCol = sortMap[query?.sortBy ?? ''] ?? counterparties.name;
  const sortFn = query?.sortDir === 'desc' ? desc : asc;

  const [rows, countResult] = await Promise.all([
    db.select().from(counterparties).where(where).limit(limit).offset(offset).orderBy(sortFn(sortCol)),
    db.select({ count: sql<number>`count(*)::int` }).from(counterparties).where(where),
  ]);

  return { companies: rows, total: countResult[0]?.count ?? 0 };
}

export async function getCompanyById(id: string) {
  try {
    const [row] = await db.select().from(counterparties).where(eq(counterparties.id, id)).limit(1);
    return row ?? null;
  } catch (err) {
    if (!isMissingCompanyRegistrationColumnError(err)) throw err;
    const { getCounterpartyById } = await import('../orders/order-utils.service');
    return getCounterpartyById(id);
  }
}

export async function getCompanyBySeasearcherId(seasearcherId: string) {
  const [row] = await db.select().from(counterparties).where(eq(counterparties.seasearcherId, seasearcherId)).limit(1);
  return row ?? null;
}

export async function createCompany(data: {
  name: string;
  type?: string;
  types?: string[];
  country?: string;
  countryIso?: string;
  tenantId?: string;
  seasearcherId?: string;
}) {
  const [created] = await db.insert(counterparties as any).values({
    name: data.name,
    type: data.type ?? 'SUPPLIER',
    types: data.types ?? [data.type ?? 'SUPPLIER'],
    country: data.country ?? null,
    countryIso: data.countryIso ?? null,
    tenantId: data.tenantId ?? null,
    seasearcherId: data.seasearcherId ?? null,
  }).returning();
  return created;
}

export async function importCompanyFromSeasearcher(seasearcherId: string) {
  const existing = await getCompanyBySeasearcherId(seasearcherId);
  if (existing) return existing;

  const detail = await seasearcherCompanyDetail<any>(seasearcherId);
  const types = normalizeSeasearcherCompanyTypes(detail.companyRoles);

  const [created] = await db.insert(counterparties as any).values({
    name: detail.companyName,
    seasearcherId: String(detail.id),
    country: detail.country?.name ?? null,
    countryIso: detail.country?.code ?? null,
    type: types[0] ?? 'SUPPLIER',
    types: types.length ? types : ['SUPPLIER'],
    companyImo: detail.companyImo ?? null,
    yearFormed: detail.yearFormed ?? null,
    lastSynced: new Date(),
  }).returning();
  return created;
}

export async function importCompanyByName(companyName: string) {
  const results = await seasearcherCompanySearch<any>(companyName);
  if (!results?.results?.length) throw new Error('No company found in Seasearcher');
  const firstMatch = results.results[0];
  return importCompanyFromSeasearcher(String(firstMatch.id));
}

export async function syncCompanyFromSeasearcher(companyId: string): Promise<SyncResult | null> {
  const local = await getCompanyById(companyId);
  if (!local?.seasearcherId) return null;

  const detail = await seasearcherCompanyDetail<any>(local.seasearcherId);
  const types = normalizeSeasearcherCompanyTypes(detail.companyRoles);
  const updateFields: Record<string, any> = { lastSynced: new Date(), updatedAt: new Date() };
  const conflicts: SyncConflict[] = [];

  if (detail.companyName && detail.companyName !== local.name) {
    updateFields.name = detail.companyName;
    conflicts.push({ field: 'name', localValue: local.name, seasearcherValue: detail.companyName, dismissed: false });
  }
  if (detail.country?.name && detail.country.name !== local.country) {
    updateFields.country = detail.country.name;
    updateFields.countryIso = detail.country.code ?? null;
    conflicts.push({ field: 'country', localValue: local.country, seasearcherValue: detail.country.name, dismissed: false });
  }
  if (types.length && JSON.stringify(types) !== JSON.stringify(local.types)) {
    updateFields.types = types;
  }

  // Enrichment fields: yearFormed, etc.
  if (detail.yearFormed != null && detail.yearFormed !== local.yearFormed) {
    updateFields.yearFormed = detail.yearFormed;
  }

  await db.update(counterparties).set(updateFields).where(eq(counterparties.id, companyId));

  return { synced: true, errors: conflicts.length > 0 ? conflicts.map((c) => `Conflict: ${c.field}`) : undefined };
}

export async function acceptSeasearcherValue(companyId: string, field: string) {
  const local = await getCompanyById(companyId);
  if (!local?.seasearcherId) return null;
  const detail = await seasearcherCompanyDetail<any>(local.seasearcherId);
  const updateFields: Record<string, any> = { lastSynced: new Date(), updatedAt: new Date() };

  if (field === 'name' && detail.companyName) updateFields.name = detail.companyName;
  if (field === 'country') {
    updateFields.country = detail.country?.name ?? null;
    updateFields.countryIso = detail.country?.code ?? null;
  }

  const [updated] = await db.update(counterparties).set(updateFields).where(eq(counterparties.id, companyId)).returning();
  return updated ?? null;
}

export async function keepMineValue(companyId: string, field: string, seasearcherValue: string | number | null) {
  return { success: true, field, keptLocal: field };
}

export async function updateCompany(id: string, data: any) {
  const [updated] = await db.update(counterparties).set({ ...data, updatedAt: new Date() }).where(eq(counterparties.id, id)).returning();
  return updated ?? null;
}

export async function updateCompanyTypes(companyId: string, types: string[]) {
  const [updated] = await db.update(counterparties).set({ types, updatedAt: new Date() }).where(eq(counterparties.id, companyId)).returning();
  return updated ?? null;
}

export async function updateCompanySegments(companyId: string, segments: Record<string, string | string[]>) {
  const [updated] = await db.update(counterparties).set({ manualOverrides: { segments } as any, updatedAt: new Date() }).where(eq(counterparties.id, companyId)).returning();
  return updated ?? null;
}

export async function updateCompanyResponsibleUser(companyId: string, userId: string | null) {
  const [updated] = await db.update(counterparties).set({ responsibleUserId: userId, updatedAt: new Date() }).where(eq(counterparties.id, companyId)).returning();
  return updated ?? null;
}

export async function deleteCompany(id: string) {
  const [deleted] = await db.delete(counterparties).where(eq(counterparties.id, id)).returning({ id: counterparties.id });
  return deleted ?? null;
}

export async function searchCompaniesTypeahead(term: string, limit?: number) {
  const rows = await db.select({ id: counterparties.id, name: counterparties.name, country: counterparties.country })
    .from(counterparties)
    .where(or(ilike(counterparties.name, `%${escapeLikePattern(term)}%`), ilike(counterparties.companyImo, `%${escapeLikePattern(term)}%`)))
    .limit(limit ?? 20);
  return rows;
}

export async function getCompanyEnrichment(seasearcherId: string) {
  return seasearcherCompanyDetail<any>(seasearcherId);
}

export async function getCompanyFleet(seasearcherId: string) {
  return seasearcherCompanyFleet<any>(seasearcherId);
}

export async function getCompanyHierarchy(seasearcherId: string) {
  return seasearcherCompanyHierarchy<any>(seasearcherId);
}

export async function getCompanySeizures(seasearcherId: string) {
  return seasearcherCompanySeizures<any>(seasearcherId);
}

export async function getCompanySanctions(seasearcherId: string) {
  return seasearcherCompanySanctions<any>(seasearcherId);
}

export async function getOrdersForCompany(companyId: string) {
  return db.select({
    id: orders.id,
    status: orders.status,
    eta: orders.eta,
    etd: orders.etd,
    createdAt: orders.createdAt,
    updatedAt: orders.updatedAt,
    vesselName: vessels.name,
    vesselImo: vessels.imo,
    placeName: places.name,
    placeCountry: places.country,
    salesRepId: orders.salesRepId,
  }).from(orders)
    .innerJoin(vessels, eq(orders.vesselId, vessels.id))
    .innerJoin(places, eq(orders.placeId, places.id))
    .where(eq(orders.clientId, companyId))
    .orderBy(sql`${orders.createdAt} desc`);
}

export async function getVesselsForCompany(companyId: string) {
  return db.select().from(vesselCompanies)
    .where(eq(vesselCompanies.companyId, companyId))
    .orderBy(vesselCompanies.role, sql`${vesselCompanies.createdAt} desc`);
}
