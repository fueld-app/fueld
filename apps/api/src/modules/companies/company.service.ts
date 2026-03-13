// ═══════════════════════════════════════════════════════════════════════
//  Company Service — CRUD + Seasearcher sync for counterparties
// ═══════════════════════════════════════════════════════════════════════

import { eq, ilike, or, and, sql, asc, desc } from 'drizzle-orm';
import { db } from '../../db';
import { counterparties, companyContacts, companyEmails, orders, vessels, places, users, vesselCompanies, customerPayments, creditApplications } from '../../db/schema';
import type { CompanyEmailType } from '@fueld/types';
import {
  seasearcherCompanyDetail,
  seasearcherCompanySearch,
  seasearcherCompanyFleet,
  seasearcherCompanyHierarchy,
  seasearcherCompanySeizures,
  seasearcherCompanySanctions,
} from '../lloyds/lli.client';

function isMissingCompanyRegistrationColumnError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /company_registration_number/i.test(error.message);
}

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
  responsibleUserId?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  page?: number;
}) {
  const conditions = [];
  if (query?.search) conditions.push(ilike(counterparties.name, `%${query.search}%`));
  if (query?.type) conditions.push(sql`${counterparties.types} @> ${JSON.stringify([query.type])}::jsonb`);
  if (query?.country) conditions.push(ilike(counterparties.country, `%${query.country}%`));
  if (query?.responsibleUserId) conditions.push(eq(counterparties.responsibleUserId, query.responsibleUserId));

  const where = conditions.length
    ? conditions.length === 1
      ? conditions[0]
      : and(...conditions)
    : undefined;

  const limit = query?.limit ?? 25;
  const page = query?.page ?? 1;
  const offset = (page - 1) * limit;

  // Sortable columns
  const sortMap: Record<string, any> = {
    name: counterparties.name,
    type: counterparties.type,
    country: counterparties.country,
    creditLimit: counterparties.creditLimit,
    responsible: users.name,
    createdAt: counterparties.createdAt,
  };
  const sortCol = sortMap[query?.sortBy ?? ''] ?? counterparties.name;
  const sortFn = query?.sortDir === 'desc' ? desc : asc;

  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: counterparties.id,
        tenantId: counterparties.tenantId,
        name: counterparties.name,
        type: counterparties.type,
        types: counterparties.types,
        creditLimit: counterparties.creditLimit,
        creditUsed: counterparties.creditUsed,
        country: counterparties.country,
        isOwnCompany: counterparties.isOwnCompany,
        seasearcherId: counterparties.seasearcherId,
        companyImo: counterparties.companyImo,
        countryIso: counterparties.countryIso,
        fleetSize: counterparties.fleetSize,
        isSanctioned: counterparties.isSanctioned,
        responsibleUserId: counterparties.responsibleUserId,
        responsibleUserName: users.name,
        contactsCount: sql<number>`(SELECT count(*)::int FROM company_contacts cc WHERE cc.counterparty_id = ${counterparties.id})`,
        createdAt: counterparties.createdAt,
        updatedAt: counterparties.updatedAt,
      })
      .from(counterparties)
      .leftJoin(users, eq(counterparties.responsibleUserId, users.id))
      .where(where)
      .limit(limit)
      .offset(offset)
      .orderBy(sortFn(sortCol)),
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
  let row: typeof counterparties.$inferSelect | null = null;
  try {
    const [selected] = await db
      .select()
      .from(counterparties)
      .where(eq(counterparties.id, id))
      .limit(1);
    row = selected ?? null;
  } catch (error) {
    if (!isMissingCompanyRegistrationColumnError(error)) throw error;
    row = await db.query.counterparties.findFirst({
      where: eq(counterparties.id, id),
      columns: {
        companyRegistrationNumber: false,
      },
    }) as typeof counterparties.$inferSelect | null;
  }
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
  let row: typeof counterparties.$inferSelect | null = null;
  try {
    const [selected] = await db
      .select()
      .from(counterparties)
      .where(eq(counterparties.seasearcherId, seasearcherId))
      .limit(1);
    row = selected ?? null;
  } catch (error) {
    if (!isMissingCompanyRegistrationColumnError(error)) throw error;
    row = await db.query.counterparties.findFirst({
      where: eq(counterparties.seasearcherId, seasearcherId),
      columns: {
        companyRegistrationNumber: false,
      },
    }) as typeof counterparties.$inferSelect | null;
  }
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

  const inserted = await db.execute(sql`
    insert into counterparties (
      tenant_id,
      name,
      type,
      types,
      country,
      country_iso,
      credit_limit,
      company_imo,
      seasearcher_id
    ) values (
      ${tenantRow.id},
      ${data.name},
      ${primaryType}::counterparty_type,
      ${JSON.stringify(data.types)}::jsonb,
      ${data.country ?? null},
      ${data.countryIso ?? null},
      ${data.creditLimit ?? '0'},
      ${data.companyImo ?? null},
      ${data.seasearcherId ?? null}
    )
    returning id
  `);

  const createdId = (inserted[0] as { id?: string } | undefined)?.id;
  if (!createdId) throw new Error('Failed to create company');

  const created = await getCompanyById(createdId);
  if (!created) throw new Error('Failed to load created company');

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
//
//  Respects manualOverrides: fields the user has manually edited are
//  NOT overwritten. If SeaSearcher has different data for overridden
//  fields, those conflicts are returned so the frontend can prompt.
// ═══════════════════════════════════════════════════════════════════════

export interface SyncConflict {
  field: string;
  localValue: string | number | null;
  seasearcherValue: string | number | null;
}

export interface SyncResult {
  company: typeof counterparties.$inferSelect;
  conflicts: SyncConflict[];
}

export async function syncCompanyFromSeasearcher(companyId: string): Promise<SyncResult | null> {
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

  // Map SeaSearcher data to local field names
  const ssData: Record<string, any> = {
    name: detail.companyName,
    country: detail.country?.name ?? null,
    countryIso: detail.country?.code ?? detail.countryOfAllegiance ?? null,
    companyImo: detail.companyImo ?? null,
    yearFormed: detail.yearFormed ?? null,
    companyRoles: detail.companyRoles ?? null,
    fleetSize: detail.companyFleetStats?.totalFleetSize ?? null,
    headOfficeAddress,
    headOfficePhone,
    headOfficeEmail,
    website,
  };

  const overrides = new Set<string>(local.manualOverrides ?? []);
  const conflicts: SyncConflict[] = [];
  const setFields: Record<string, any> = {
    isSanctioned: detail.isSanctioned ?? false,
    lastSynced: new Date(),
    updatedAt: new Date(),
  };

  // For each field: if user manually overrode it, check for conflict;
  // otherwise apply SeaSearcher value
  for (const [field, ssValue] of Object.entries(ssData)) {
    if (overrides.has(field)) {
      // Compare local vs SeaSearcher — if different, record conflict
      const localVal = (local as any)[field];
      const ssStr = JSON.stringify(ssValue);
      const localStr = JSON.stringify(localVal);
      if (ssStr !== localStr && ssValue != null) {
        conflicts.push({
          field,
          localValue: localVal,
          seasearcherValue: ssValue,
        });
      }
      // Don't overwrite — keep user's manual value
    } else {
      // No manual override — apply SeaSearcher value (fallback to local if SS is null)
      setFields[field] = ssValue ?? (local as any)[field];
    }
  }

  const [updated] = await db
    .update(counterparties)
    .set(setFields)
    .where(eq(counterparties.id, companyId))
    .returning();

  // Sync contacts from Seasearcher (only source='seasearcher' contacts get replaced)
  await syncContactsFromSeasearcher(companyId, detail.headOffice);

  return updated ? { company: updated, conflicts } : null;
}

// ═══════════════════════════════════════════════════════════════════════
//  ACCEPT SEASEARCHER VALUE (resolve a conflict by accepting SS data)
// ═══════════════════════════════════════════════════════════════════════

export async function acceptSeasearcherValue(companyId: string, field: string) {
  const local = await getCompanyById(companyId);
  if (!local || !local.seasearcherId) return null;

  // Remove the field from manualOverrides
  const overrides = (local.manualOverrides ?? []).filter((f: string) => f !== field);

  // Re-fetch and apply only this field from SeaSearcher
  const detail = await seasearcherCompanyDetail<SeasearcherCompanyDetail>(local.seasearcherId);

  let value: any = null;
  switch (field) {
    case 'name': value = detail.companyName; break;
    case 'country': value = detail.country?.name ?? null; break;
    case 'countryIso': value = detail.country?.code ?? detail.countryOfAllegiance ?? null; break;
    case 'companyImo': value = detail.companyImo ?? null; break;
    case 'yearFormed': value = detail.yearFormed ?? null; break;
    case 'companyRoles': value = detail.companyRoles ?? null; break;
    case 'fleetSize': value = detail.companyFleetStats?.totalFleetSize ?? null; break;
    case 'headOfficeAddress': {
      if (detail.headOffice) {
        const ho = detail.headOffice;
        const parts = [ho.addressLine1, ho.addressLine2, ho.addressLine3, ho.addressLine4].filter(Boolean);
        if (ho.town) parts.push(ho.town);
        if (ho.country) parts.push(ho.country);
        if (ho.postCode1) parts.push(ho.postCode1);
        value = parts.join(', ');
      }
      break;
    }
    case 'headOfficePhone': {
      if (detail.headOffice?.telephoneNumbers?.length) {
        const t = detail.headOffice.telephoneNumbers[0];
        value = `+${t.countryDialingCode} ${t.areaDialingCode} ${t.number}`.trim();
      }
      break;
    }
    case 'headOfficeEmail': value = detail.headOffice?.emailAddress ?? null; break;
    case 'website': value = detail.headOffice?.webAddress ?? null; break;
  }

  const setFields: Record<string, any> = {
    manualOverrides: overrides,
    updatedAt: new Date(),
  };
  setFields[field] = value;

  const [updated] = await db
    .update(counterparties)
    .set(setFields)
    .where(eq(counterparties.id, companyId))
    .returning();
  return updated ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  UPDATE COMPANY (manual fields)
// ═══════════════════════════════════════════════════════════════════════

// Fields that can be manually overridden (synced from SeaSearcher)
const OVERRIDABLE_FIELDS = [
  'name', 'country', 'countryIso', 'yearFormed', 'fleetSize',
  'headOfficeAddress', 'headOfficePhone', 'headOfficeEmail', 'website',
  'companyImo', 'companyRoles',
] as const;

export async function updateCompany(
  companyId: string,
  data: {
    name?: string;
    country?: string | null;
    countryIso?: string | null;
    creditLimit?: string | null;
    yearFormed?: number | null;
    fleetSize?: number | null;
    headOfficeAddress?: string | null;
    headOfficePhone?: string | null;
    headOfficeEmail?: string | null;
    website?: string | null;
    companyImo?: string | null;
    companyRoles?: string[] | null;
  },
) {
  // Load current company to merge manualOverrides
  const current = await getCompanyById(companyId);
  if (!current) return null;

  const setFields: Record<string, any> = { updatedAt: new Date() };
  const newOverrides = new Set<string>(current.manualOverrides ?? []);

  // Track which overridable fields the user is changing
  if (data.name !== undefined) { setFields.name = data.name; newOverrides.add('name'); }
  if (data.country !== undefined) { setFields.country = data.country; newOverrides.add('country'); }
  if (data.countryIso !== undefined) { setFields.countryIso = data.countryIso; newOverrides.add('countryIso'); }
  if (data.yearFormed !== undefined) { setFields.yearFormed = data.yearFormed; newOverrides.add('yearFormed'); }
  if (data.fleetSize !== undefined) { setFields.fleetSize = data.fleetSize; newOverrides.add('fleetSize'); }
  if (data.headOfficeAddress !== undefined) { setFields.headOfficeAddress = data.headOfficeAddress; newOverrides.add('headOfficeAddress'); }
  if (data.headOfficePhone !== undefined) { setFields.headOfficePhone = data.headOfficePhone; newOverrides.add('headOfficePhone'); }
  if (data.headOfficeEmail !== undefined) { setFields.headOfficeEmail = data.headOfficeEmail; newOverrides.add('headOfficeEmail'); }
  if (data.website !== undefined) { setFields.website = data.website; newOverrides.add('website'); }
  if (data.companyImo !== undefined) { setFields.companyImo = data.companyImo; newOverrides.add('companyImo'); }
  if (data.companyRoles !== undefined) { setFields.companyRoles = data.companyRoles; newOverrides.add('companyRoles'); }

  // Non-overridable fields
  if (data.creditLimit !== undefined) setFields.creditLimit = data.creditLimit;

  // Persist manual overrides
  setFields.manualOverrides = [...newOverrides];

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
  // Pre-check: refuse if any orders/inquiries reference this company
  const [linked] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(
      or(
        eq(orders.clientId, id),
        eq(orders.supplierId, id),
        eq(orders.invoicingCompanyId, id),
      ),
    );

  if (linked && linked.count > 0) {
    const label = linked.count === 1 ? 'order/inquiry' : 'orders/inquiries';
    throw Object.assign(
      new Error(`Cannot delete: company is linked to ${linked.count} ${label}. Remove them first.`),
      { code: 'HAS_ORDERS', count: linked.count },
    );
  }

  // Clean up records that reference this company but aren't orders
  await db.delete(customerPayments).where(eq(customerPayments.customerId, id));
  await db.delete(creditApplications).where(eq(creditApplications.counterpartyId, id));

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
    .select({
      id: counterparties.id,
      seasearcherId: counterparties.seasearcherId,
      name: counterparties.name,
      companyImo: counterparties.companyImo,
      country: counterparties.country,
      countryIso: counterparties.countryIso,
      fleetSize: counterparties.fleetSize,
      isSanctioned: counterparties.isSanctioned,
    })
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
      source: vesselCompanies.source,
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
