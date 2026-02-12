// ═══════════════════════════════════════════════════════════════════════
//  Company Service — CRUD + Seasearcher sync for counterparties
// ═══════════════════════════════════════════════════════════════════════

import { eq, ilike, or, and, sql } from 'drizzle-orm';
import { db } from '../../db';
import { counterparties, companyContacts, companyEmails, orders, vessels, places, users, vesselCompanies } from '../../db/schema';
import type { CompanyEmailType } from '@fueld/types';
import {
  seasearcherCompanyDetail,
  seasearcherCompanySearch,
  seasearcherCompanyFleet,
  seasearcherCompanyHierarchy,
  seasearcherCompanySeizures,
  seasearcherCompanySanctions,
} from '../lloyds/lli.client';

// ═══════════════════════════════════════════════════════════════════════
//  Seasearcher Response Types
// ═══════════════════════════════════════════════════════════════════════

interface SeasearcherCompanyOffice {
  officeId: number;
  country: string;
  town: string;
  countryCode: string;
  addressLine1: string;
  addressLine2: string;
  addressLine3: string;
  addressLine4: string;
  postCode1: string;
  telephoneNumbers: Array<{
    countryDialingCode: string;
    areaDialingCode: string;
    number: string;
  }>;
  faxNumbers?: Array<{
    countryDialingCode: string;
    areaDialingCode: string;
    number: string;
  }>;
  emailAddress: string | null;
  webAddress: string | null;
  personnel?: Array<{
    name: string;
    jobTitle: string;
  }>;
}

export interface SeasearcherCompanyDetail {
  id: string;
  companyImo: string;
  companyName: string;
  shortname: string;
  countryOfAllegiance: string;
  yearFormed: number | null;
  country: { code: string; name: string };
  headOffice: SeasearcherCompanyOffice | null;
  offices: SeasearcherCompanyOffice[];
  companyRoles: string[];
  companyFleetStats: {
    totalFleetSize: number;
    mostFrequentVesselType: string;
    fleetStatsBreakdown: Array<{
      key: string;
      vesselCount: number;
      totalGrossTonnage: number;
      totalDwt: number;
    }>;
  } | null;
  isSanctioned: boolean;
  showSanctionedBadge: boolean;
  hasVesselsSanctions: boolean;
  lastUpdated: string;
  companyRegistration: {
    localName: string | null;
    registryName: string | null;
    incorporationDate: string | null;
    registrationNumbers: Array<{ value: string | null; typeDescription: string | null }>;
  } | null;
  counterpartyRiskReportMetadata: {
    ratingDate: string;
    creditOpinion: string;
    overallPerformance: { text: string; textAbbreviation: string };
    overallRating: { text: string };
    paymentPerformance: { text: string };
  } | null;
  companyNameHistory: Array<{ name: string; fromDate: string }>;
  builtVesselsCount: number;
  tier: number;
}

interface SeasearcherCompanySearchResult {
  id: string;
  companyName: string;
  companyImo: string;
  location: string;
  countryCode: string;
  yearFormed: number | null;
  boFleetSize: number;
  coFleetSize: number;
  tmFleetSize: number;
  tpFleetSize: number;
  isSanctioned: boolean;
  headOfficeAddress: {
    streetLine1: string;
    city: string;
    country: string;
  } | null;
}

interface SeasearcherCompanySearchResponse {
  results: SeasearcherCompanySearchResult[];
  allMatchingCount: number;
}

// ═══════════════════════════════════════════════════════════════════════
//  LIST COMPANIES (local DB, paginated)
// ═══════════════════════════════════════════════════════════════════════

export async function listCompanies(query?: {
  search?: string;
  type?: string;
  country?: string;
  limit?: number;
  page?: number;
}) {
  const conditions = [];
  if (query?.search) conditions.push(ilike(counterparties.name, `%${query.search}%`));
  if (query?.type) conditions.push(sql`${counterparties.types} @> ${JSON.stringify([query.type])}::jsonb`);
  if (query?.country) conditions.push(ilike(counterparties.country, `%${query.country}%`));

  const where = conditions.length
    ? conditions.length === 1
      ? conditions[0]
      : and(...conditions)
    : undefined;

  const limit = query?.limit ?? 25;
  const page = query?.page ?? 1;
  const offset = (page - 1) * limit;

  const [rows, countResult] = await Promise.all([
    db
      .select()
      .from(counterparties)
      .where(where)
      .limit(limit)
      .offset(offset)
      .orderBy(counterparties.name),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(counterparties)
      .where(where),
  ]);

  return { companies: rows, total: countResult[0]?.count ?? 0 };
}

// ═══════════════════════════════════════════════════════════════════════
//  GET SINGLE COMPANY BY ID
// ═══════════════════════════════════════════════════════════════════════

export async function getCompanyById(id: string) {
  const [row] = await db
    .select()
    .from(counterparties)
    .where(eq(counterparties.id, id))
    .limit(1);
  if (!row) return null;

  let responsibleUserName: string | null = null;
  if (row.responsibleUserId) {
    const [userRow] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, row.responsibleUserId))
      .limit(1);
    responsibleUserName = userRow?.name ?? null;
  }

  return { ...row, responsibleUserName };
}

// ═══════════════════════════════════════════════════════════════════════
//  GET COMPANY BY SEASEARCHER ID
// ═══════════════════════════════════════════════════════════════════════

export async function getCompanyBySeasearcherId(seasearcherId: string) {
  const [row] = await db
    .select()
    .from(counterparties)
    .where(eq(counterparties.seasearcherId, seasearcherId))
    .limit(1);
  return row ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  CREATE COMPANY (manual entry)
// ═══════════════════════════════════════════════════════════════════════

export async function createCompany(data: {
  name: string;
  types: string[];
  country?: string;
  countryIso?: string;
  creditLimit?: string;
  companyImo?: string;
  seasearcherId?: string;
}) {
  // Use first tenant (single-tenant for now)
  const tenantRow = await db.query.tenants.findFirst();
  if (!tenantRow) throw new Error('No tenant found');

  const primaryType = data.types[0] ?? 'CLIENT';

  const [created] = await db
    .insert(counterparties)
    .values({
      tenantId: tenantRow.id,
      name: data.name,
      type: primaryType as any,
      types: data.types,
      country: data.country,
      countryIso: data.countryIso,
      creditLimit: data.creditLimit ?? '0',
      companyImo: data.companyImo,
      seasearcherId: data.seasearcherId,
    })
    .returning();

  return created;
}

// ═══════════════════════════════════════════════════════════════════════
//  IMPORT COMPANY FROM SEASEARCHER
// ═══════════════════════════════════════════════════════════════════════

export async function importCompanyFromSeasearcher(seasearcherId: string) {
  // Check if already imported
  const existing = await getCompanyBySeasearcherId(seasearcherId);
  if (existing) return existing;

  // Fetch from Seasearcher
  const detail = await seasearcherCompanyDetail<SeasearcherCompanyDetail>(seasearcherId);

  // Build address string from head office
  let headOfficeAddress: string | null = null;
  let headOfficePhone: string | null = null;
  let headOfficeEmail: string | null = null;
  let website: string | null = null;

  if (detail.headOffice) {
    const ho = detail.headOffice;
    const parts = [ho.addressLine1, ho.addressLine2, ho.addressLine3, ho.addressLine4]
      .filter(Boolean);
    if (ho.town) parts.push(ho.town);
    if (ho.country) parts.push(ho.country);
    if (ho.postCode1) parts.push(ho.postCode1);
    headOfficeAddress = parts.join(', ');
    if (ho.telephoneNumbers?.length) {
      const t = ho.telephoneNumbers[0];
      headOfficePhone = `+${t.countryDialingCode} ${t.areaDialingCode} ${t.number}`.trim();
    }
    headOfficeEmail = ho.emailAddress;
    website = ho.webAddress;
  }

  const tenantRow = await db.query.tenants.findFirst();
  if (!tenantRow) throw new Error('No tenant found');

  const [created] = await db
    .insert(counterparties)
    .values({
      tenantId: tenantRow.id,
      name: detail.companyName,
      type: 'CLIENT',
      types: ['CLIENT'],
      country: detail.country?.name ?? null,
      countryIso: detail.country?.code ?? detail.countryOfAllegiance ?? null,
      seasearcherId: detail.id,
      companyImo: detail.companyImo,
      yearFormed: detail.yearFormed ?? null,
      companyRoles: detail.companyRoles ?? [],
      fleetSize: detail.companyFleetStats?.totalFleetSize ?? null,
      headOfficeAddress,
      headOfficePhone,
      headOfficeEmail,
      website,
      isSanctioned: detail.isSanctioned ?? false,
      lastSynced: new Date(),
    })
    .returning();

  // Sync contacts from Seasearcher
  await syncContactsFromSeasearcher(created.id, detail.headOffice);

  return created;
}

// ═══════════════════════════════════════════════════════════════════════
//  IMPORT COMPANY BY NAME (search Seasearcher, import first match)
// ═══════════════════════════════════════════════════════════════════════

export async function importCompanyByName(companyName: string) {
  const searchResult = await seasearcherCompanySearch<{ results: { id: string; companyName: string }[] }>(companyName, 5);
  const match = searchResult.results?.find(
    (r) => r.companyName.toLowerCase() === companyName.toLowerCase(),
  ) ?? searchResult.results?.[0];

  if (!match) {
    throw new Error(`No Seasearcher company found for name: ${companyName}`);
  }

  return importCompanyFromSeasearcher(match.id);
}

// ═══════════════════════════════════════════════════════════════════════
//  SYNC COMPANY FROM SEASEARCHER (update existing local record)
// ═══════════════════════════════════════════════════════════════════════

export async function syncCompanyFromSeasearcher(companyId: string) {
  const local = await getCompanyById(companyId);
  if (!local || !local.seasearcherId) return null;

  const detail = await seasearcherCompanyDetail<SeasearcherCompanyDetail>(local.seasearcherId);

  let headOfficeAddress: string | null = null;
  let headOfficePhone: string | null = null;
  let headOfficeEmail: string | null = null;
  let website: string | null = null;

  if (detail.headOffice) {
    const ho = detail.headOffice;
    const parts = [ho.addressLine1, ho.addressLine2, ho.addressLine3, ho.addressLine4]
      .filter(Boolean);
    if (ho.town) parts.push(ho.town);
    if (ho.country) parts.push(ho.country);
    if (ho.postCode1) parts.push(ho.postCode1);
    headOfficeAddress = parts.join(', ');
    if (ho.telephoneNumbers?.length) {
      const t = ho.telephoneNumbers[0];
      headOfficePhone = `+${t.countryDialingCode} ${t.areaDialingCode} ${t.number}`.trim();
    }
    headOfficeEmail = ho.emailAddress;
    website = ho.webAddress;
  }

  const [updated] = await db
    .update(counterparties)
    .set({
      name: detail.companyName,
      country: detail.country?.name ?? local.country,
      countryIso: detail.country?.code ?? local.countryIso,
      companyImo: detail.companyImo ?? local.companyImo,
      yearFormed: detail.yearFormed ?? local.yearFormed,
      companyRoles: detail.companyRoles ?? local.companyRoles,
      fleetSize: detail.companyFleetStats?.totalFleetSize ?? local.fleetSize,
      headOfficeAddress,
      headOfficePhone,
      headOfficeEmail,
      website,
      isSanctioned: detail.isSanctioned ?? false,
      lastSynced: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(counterparties.id, companyId))
    .returning();

  // Sync contacts from Seasearcher
  await syncContactsFromSeasearcher(companyId, detail.headOffice);

  return updated ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  UPDATE COMPANY (manual fields)
// ═══════════════════════════════════════════════════════════════════════

export async function updateCompany(
  companyId: string,
  data: {
    name?: string;
    country?: string | null;
    countryIso?: string | null;
    creditLimit?: string | null;
  },
) {
  const setFields: Record<string, any> = { updatedAt: new Date() };
  if (data.name !== undefined) setFields.name = data.name;
  if (data.country !== undefined) setFields.country = data.country;
  if (data.countryIso !== undefined) setFields.countryIso = data.countryIso;
  if (data.creditLimit !== undefined) setFields.creditLimit = data.creditLimit;

  const [updated] = await db
    .update(counterparties)
    .set(setFields)
    .where(eq(counterparties.id, companyId))
    .returning();
  return updated ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  UPDATE COMPANY TYPES
// ═══════════════════════════════════════════════════════════════════════

export async function updateCompanyTypes(companyId: string, types: string[]) {
  const primaryType = types[0] ?? 'CLIENT';
  const [updated] = await db
    .update(counterparties)
    .set({
      type: primaryType as any,
      types,
      updatedAt: new Date(),
    })
    .where(eq(counterparties.id, companyId))
    .returning();
  return updated ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  UPDATE COMPANY RESPONSIBLE USER
// ═══════════════════════════════════════════════════════════════════════

export async function updateCompanyResponsibleUser(companyId: string, userId: string | null) {
  const [updated] = await db
    .update(counterparties)
    .set({
      responsibleUserId: userId,
      updatedAt: new Date(),
    })
    .where(eq(counterparties.id, companyId))
    .returning();
  return updated ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  DELETE COMPANY
// ═══════════════════════════════════════════════════════════════════════

export async function deleteCompany(id: string) {
  const [deleted] = await db
    .delete(counterparties)
    .where(eq(counterparties.id, id))
    .returning({ id: counterparties.id });
  return deleted ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  SEARCH COMPANIES (Seasearcher typeahead)
// ═══════════════════════════════════════════════════════════════════════

export interface CompanyTypeaheadResult {
  source: 'local' | 'seasearcher';
  localId?: string;
  seasearcherId?: string;
  name: string;
  companyImo?: string;
  country?: string;
  countryCode?: string;
  yearFormed?: number | null;
  fleetSize?: number;
  isSanctioned?: boolean;
}

export async function searchCompaniesTypeahead(
  term: string,
): Promise<CompanyTypeaheadResult[]> {
  const results: CompanyTypeaheadResult[] = [];

  // 1. Local DB
  const localResults = await db
    .select()
    .from(counterparties)
    .where(ilike(counterparties.name, `%${term}%`))
    .limit(20);

  const localSeasearcherIds = new Set<string>();
  for (const c of localResults) {
    if (c.seasearcherId) localSeasearcherIds.add(c.seasearcherId);
    results.push({
      source: 'local',
      localId: c.id,
      seasearcherId: c.seasearcherId ?? undefined,
      name: c.name,
      companyImo: c.companyImo ?? undefined,
      country: c.country ?? undefined,
      countryCode: c.countryIso ?? undefined,
      fleetSize: c.fleetSize ?? undefined,
      isSanctioned: c.isSanctioned ?? false,
    });
  }

  // 2. Seasearcher search — fetch up to 50 results in one call
  try {
    const ss = await seasearcherCompanySearch<SeasearcherCompanySearchResponse>(term, 50);
    if (ss.results?.length) {
      for (const c of ss.results) {
        if (localSeasearcherIds.has(c.id)) continue;
        results.push({
          source: 'seasearcher',
          seasearcherId: c.id,
          name: c.companyName,
          companyImo: c.companyImo,
          country: c.location,
          countryCode: c.countryCode,
          yearFormed: c.yearFormed,
          fleetSize: c.boFleetSize + c.coFleetSize + c.tmFleetSize + c.tpFleetSize,
          isSanctioned: c.isSanctioned,
        });
      }
    }
  } catch (err) {
    console.error('[Seasearcher] Company search failed:', err);
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
//  GET COMPANY ENRICHMENT (raw Seasearcher data for detail page)
// ═══════════════════════════════════════════════════════════════════════

export async function getCompanyEnrichment(seasearcherId: string) {
  const detail = await seasearcherCompanyDetail<SeasearcherCompanyDetail>(seasearcherId);
  return detail;
}

// ═══════════════════════════════════════════════════════════════════════
//  GET COMPANY FLEET (from Seasearcher)
// ═══════════════════════════════════════════════════════════════════════

export async function getCompanyFleet(seasearcherId: string) {
  const data = await seasearcherCompanyFleet<{ results: any[]; totalMatches: number }>(seasearcherId);
  return data;
}

// ═══════════════════════════════════════════════════════════════════════
//  GET COMPANY HIERARCHY (from Seasearcher)
// ═══════════════════════════════════════════════════════════════════════

export async function getCompanyHierarchy(seasearcherId: string) {
  const data = await seasearcherCompanyHierarchy<any>(seasearcherId);
  return data;
}

// ═══════════════════════════════════════════════════════════════════════
//  GET COMPANY SEIZURES (from Seasearcher)
// ═══════════════════════════════════════════════════════════════════════

export async function getCompanySeizures(seasearcherId: string) {
  const data = await seasearcherCompanySeizures<{ results: any[]; totalMatches: number }>(seasearcherId);
  return data;
}

// ═══════════════════════════════════════════════════════════════════════
//  GET COMPANY SANCTIONS (from Seasearcher)
// ═══════════════════════════════════════════════════════════════════════

export async function getCompanySanctions(seasearcherId: string) {
  const data = await seasearcherCompanySanctions<any[]>(seasearcherId);
  return data;
}

// ═══════════════════════════════════════════════════════════════════════
//  GET ORDERS FOR A COMPANY
// ═══════════════════════════════════════════════════════════════════════

export async function getOrdersForCompany(companyId: string) {
  const rows = await db
    .select({
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
    })
    .from(orders)
    .innerJoin(vessels, eq(orders.vesselId, vessels.id))
    .innerJoin(places, eq(orders.placeId, places.id))
    .where(eq(orders.clientId, companyId))
    .orderBy(sql`${orders.createdAt} desc`);

  return rows;
}

// ═══════════════════════════════════════════════════════════════════════
//  GET VESSELS LINKED TO A COMPANY (via vessel_companies)
// ═══════════════════════════════════════════════════════════════════════

export async function getVesselsForCompany(companyId: string) {
  return db
    .select({
      id: vesselCompanies.id,
      vesselId: vesselCompanies.vesselId,
      vesselName: vessels.name,
      vesselImo: vessels.imo,
      companyId: vesselCompanies.companyId,
      companyName: counterparties.name,
      role: vesselCompanies.role,
      contactId: vesselCompanies.contactId,
      contactName: companyContacts.name,
      note: vesselCompanies.note,
      addedById: vesselCompanies.addedById,
      addedByName: vesselCompanies.addedByName,
      createdAt: vesselCompanies.createdAt,
      updatedAt: vesselCompanies.updatedAt,
    })
    .from(vesselCompanies)
    .innerJoin(vessels, eq(vesselCompanies.vesselId, vessels.id))
    .innerJoin(counterparties, eq(vesselCompanies.companyId, counterparties.id))
    .leftJoin(companyContacts, eq(vesselCompanies.contactId, companyContacts.id))
    .where(eq(vesselCompanies.companyId, companyId))
    .orderBy(vesselCompanies.role, vessels.name);
}

// ═══════════════════════════════════════════════════════════════════════
//  COMPANY CONTACTS CRUD
// ═══════════════════════════════════════════════════════════════════════

export async function getCompanyContacts(counterpartyId: string) {
  return db
    .select()
    .from(companyContacts)
    .where(eq(companyContacts.counterpartyId, counterpartyId))
    .orderBy(sql`${companyContacts.source} asc, ${companyContacts.name} asc`);
}

export async function createCompanyContact(
  counterpartyId: string,
  data: { name: string; role?: string; phone?: string; fax?: string; email?: string; notes?: string },
) {
  const [contact] = await db
    .insert(companyContacts)
    .values({
      counterpartyId,
      name: data.name,
      role: data.role ?? null,
      phone: data.phone ?? null,
      fax: data.fax ?? null,
      email: data.email ?? null,
      notes: data.notes ?? null,
      source: 'manual',
    })
    .returning();
  return contact;
}

export async function updateCompanyContact(
  contactId: string,
  data: { name?: string; role?: string; phone?: string; fax?: string; email?: string; notes?: string },
) {
  const [updated] = await db
    .update(companyContacts)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(companyContacts.id, contactId))
    .returning();
  return updated;
}

export async function deleteCompanyContact(contactId: string) {
  await db.delete(companyContacts).where(eq(companyContacts.id, contactId));
}

/**
 * Sync contacts from Seasearcher enrichment data into the company_contacts table.
 * Replaces all 'seasearcher'-sourced contacts; manual contacts are preserved.
 */
export async function syncContactsFromSeasearcher(
  counterpartyId: string,
  headOffice: SeasearcherCompanyOffice | null,
) {
  // Delete existing seasearcher-sourced contacts
  await db
    .delete(companyContacts)
    .where(
      and(
        eq(companyContacts.counterpartyId, counterpartyId),
        eq(companyContacts.source, 'seasearcher'),
      ),
    );

  if (!headOffice?.personnel?.length) return;

  // Build phone string from head office
  const phone = headOffice.telephoneNumbers?.length
    ? headOffice.telephoneNumbers
        .map((t) => `+${t.countryDialingCode} ${t.areaDialingCode} ${t.number}`.trim())
        .join(', ')
    : null;

  const fax = headOffice.faxNumbers?.length
    ? headOffice.faxNumbers
        .map((f) => `+${f.countryDialingCode} ${f.areaDialingCode} ${f.number}`.trim())
        .join(', ')
    : null;

  // Insert each contact person
  const values = headOffice.personnel.map((c) => ({
    counterpartyId,
    name: c.name,
    role: c.jobTitle || null,
    phone,
    fax,
    email: headOffice.emailAddress ?? null,
    source: 'seasearcher' as const,
  }));

  if (values.length) {
    await db.insert(companyContacts).values(values);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  COMPANY EMAILS (flexible email types per company)
// ═══════════════════════════════════════════════════════════════════════

export async function getCompanyEmails(counterpartyId: string) {
  return db
    .select({
      id: companyEmails.id,
      counterpartyId: companyEmails.counterpartyId,
      emailType: companyEmails.emailType,
      email: companyEmails.email,
      label: companyEmails.label,
      isPrimary: companyEmails.isPrimary,
      addedById: companyEmails.addedById,
      addedByName: companyEmails.addedByName,
      createdAt: companyEmails.createdAt,
      updatedAt: companyEmails.updatedAt,
    })
    .from(companyEmails)
    .where(eq(companyEmails.counterpartyId, counterpartyId))
    .orderBy(companyEmails.emailType, companyEmails.email);
}

export async function addCompanyEmail(
  counterpartyId: string,
  data: { emailType: CompanyEmailType; email: string; label?: string; isPrimary?: boolean },
  userId: string,
  userName: string
) {
  // If setting as primary, unset other primaries of the same type
  if (data.isPrimary) {
    await db
      .update(companyEmails)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(
        and(
          eq(companyEmails.counterpartyId, counterpartyId),
          eq(companyEmails.emailType, data.emailType),
          eq(companyEmails.isPrimary, true),
        )
      );
  }

  const [created] = await db
    .insert(companyEmails)
    .values({
      counterpartyId,
      emailType: data.emailType,
      email: data.email,
      label: data.label ?? null,
      isPrimary: data.isPrimary ?? false,
      addedById: userId,
      addedByName: userName,
    })
    .returning();
  return created;
}

export async function updateCompanyEmail(
  id: string,
  data: { emailType?: CompanyEmailType; email?: string; label?: string; isPrimary?: boolean }
) {
  // If setting as primary, fetch counterpartyId and emailType first
  if (data.isPrimary) {
    const [existing] = await db
      .select({ counterpartyId: companyEmails.counterpartyId, emailType: companyEmails.emailType })
      .from(companyEmails)
      .where(eq(companyEmails.id, id));
    if (existing) {
      const typeToUse = data.emailType ?? existing.emailType;
      await db
        .update(companyEmails)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(
          and(
            eq(companyEmails.counterpartyId, existing.counterpartyId),
            eq(companyEmails.emailType, typeToUse),
            eq(companyEmails.isPrimary, true),
          )
        );
    }
  }

  const [updated] = await db
    .update(companyEmails)
    .set({
      ...(data.emailType !== undefined && { emailType: data.emailType }),
      ...(data.email !== undefined && { email: data.email }),
      ...(data.label !== undefined && { label: data.label }),
      ...(data.isPrimary !== undefined && { isPrimary: data.isPrimary }),
      updatedAt: new Date(),
    })
    .where(eq(companyEmails.id, id))
    .returning();
  return updated ?? null;
}

export async function deleteCompanyEmail(id: string) {
  const [deleted] = await db
    .delete(companyEmails)
    .where(eq(companyEmails.id, id))
    .returning({ id: companyEmails.id, email: companyEmails.email, emailType: companyEmails.emailType });
  return deleted ?? null;
}
