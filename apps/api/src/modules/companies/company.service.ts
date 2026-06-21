// ═══════════════════════════════════════════════════════════════════════
//  Company Service — CRUD + Seasearcher sync for counterparties
// ═══════════════════════════════════════════════════════════════════════

import { eq, ilike, or, and, sql, asc, desc, inArray, isNull, ne } from 'drizzle-orm';
import { db } from '../../db';
import { escapeLikePattern } from '../../utils/like';
import { counterparties, companyAttachments, companyContacts, companyEmails, companyOffices, orders, orderSuppliers, vessels, places, users, vesselCompanies, customerPayments, creditApplications, portSuppliers, companyPlaceSupplyRules, creditLines, creditLineCounterparties } from '../../db/schema';
import type { CompanyEmailType } from '@fueld/types';
import { matchLocalVessels } from '../vessels/vessel.service';
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

function buildSeasearcherContactFingerprint(contact: {
  name?: string | null;
  role?: string | null;
  email?: string | null;
}): string {
  return [contact.name, contact.role, contact.email]
    .map((value) => (value ?? '').trim().toLowerCase())
    .join('|');
}

const COMPANY_PLACE_SUPPLY_RULE_TYPES = ['POR', 'PSP', 'ANC', 'TER', 'FIL'] as const;
const COMPANY_PLACE_SUPPLY_RULE_SOURCE = 'company_place_supply_rule';

type CompanyPlaceSupplyRulePlaceType = (typeof COMPANY_PLACE_SUPPLY_RULE_TYPES)[number];

type CompanyPlaceSupplyRuleRow = {
  id: string;
  companyId: string;
  countryIso: string;
  placeTypes: string[];
  contactId: string | null;
  contactName: string | null;
  products: string[];
  note: string | null;
  isActive: boolean;
  addedById: string | null;
  addedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function uniqueNonEmptyStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(
    values
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  ));
}

function normalizeCountryIso(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw Object.assign(new Error('Country code must be a 3-letter ISO code.'), { code: 'INVALID_COUNTRY_ISO' });
  }
  return normalized;
}

function normalizeRulePlaceTypes(values: string[]): CompanyPlaceSupplyRulePlaceType[] {
  const normalized = uniqueNonEmptyStrings(values.map((value) => value.toUpperCase()))
    .filter((value): value is CompanyPlaceSupplyRulePlaceType => COMPANY_PLACE_SUPPLY_RULE_TYPES.includes(value as CompanyPlaceSupplyRulePlaceType))
    .sort((left, right) => COMPANY_PLACE_SUPPLY_RULE_TYPES.indexOf(left) - COMPANY_PLACE_SUPPLY_RULE_TYPES.indexOf(right));

  if (!normalized.length) {
    throw Object.assign(new Error('Select at least one place type.'), { code: 'INVALID_PLACE_TYPES' });
  }

  return normalized;
}

function normalizeRuleProducts(values?: string[] | null): string[] {
  return uniqueNonEmptyStrings(values ?? []);
}

function normalizeRuleNote(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isIso3CountryCode(value: string | null | undefined): value is string {
  return /^[A-Z]{3}$/.test((value ?? '').trim().toUpperCase());
}

function getPlaceCountryIsoCandidates(place: { countryIso: string | null; country: string | null }): string[] {
  const fallback = isIso3CountryCode(place.country) ? place.country.trim().toUpperCase() : null;
  return uniqueNonEmptyStrings([place.countryIso?.trim().toUpperCase() ?? null, fallback]);
}

function hasRulePlaceTypeOverlap(left: string[], right: string[]): boolean {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function serializeCompanyPlaceSupplyRule(row: CompanyPlaceSupplyRuleRow) {
  return {
    id: row.id,
    companyId: row.companyId,
    countryIso: row.countryIso,
    placeTypes: row.placeTypes,
    contactId: row.contactId,
    contactName: row.contactName,
    products: row.products,
    note: row.note,
    isActive: row.isActive,
    addedById: row.addedById,
    addedByName: row.addedByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildCompanyPlaceSupplyRuleSelection() {
  return {
    id: companyPlaceSupplyRules.id,
    companyId: companyPlaceSupplyRules.companyId,
    countryIso: companyPlaceSupplyRules.countryIso,
    placeTypes: companyPlaceSupplyRules.placeTypes,
    contactId: companyPlaceSupplyRules.contactId,
    contactName: companyContacts.name,
    products: companyPlaceSupplyRules.products,
    note: companyPlaceSupplyRules.note,
    isActive: companyPlaceSupplyRules.isActive,
    addedById: companyPlaceSupplyRules.addedById,
    addedByName: companyPlaceSupplyRules.addedByName,
    createdAt: companyPlaceSupplyRules.createdAt,
    updatedAt: companyPlaceSupplyRules.updatedAt,
  };
}

async function getCompanyPlaceSupplyRuleRowById(ruleId: string): Promise<CompanyPlaceSupplyRuleRow | null> {
  const [row] = await db
    .select(buildCompanyPlaceSupplyRuleSelection())
    .from(companyPlaceSupplyRules)
    .leftJoin(companyContacts, eq(companyPlaceSupplyRules.contactId, companyContacts.id))
    .where(eq(companyPlaceSupplyRules.id, ruleId))
    .limit(1);

  return row ?? null;
}

async function assertRuleContactBelongsToCompany(companyId: string, contactId?: string | null): Promise<void> {
  if (!contactId) return;

  const [contact] = await db
    .select({ id: companyContacts.id })
    .from(companyContacts)
    .where(and(eq(companyContacts.id, contactId), eq(companyContacts.counterpartyId, companyId)))
    .limit(1);

  if (!contact) {
    throw Object.assign(new Error('Selected contact does not belong to this company.'), { code: 'INVALID_CONTACT' });
  }
}

async function assertNoOverlappingCompanyPlaceSupplyRules(
  companyId: string,
  countryIso: string,
  placeTypes: string[],
  excludeRuleId?: string,
): Promise<void> {
  const conditions = [
    eq(companyPlaceSupplyRules.companyId, companyId),
    eq(companyPlaceSupplyRules.countryIso, countryIso),
    eq(companyPlaceSupplyRules.isActive, true),
  ];

  if (excludeRuleId) {
    conditions.push(ne(companyPlaceSupplyRules.id, excludeRuleId));
  }

  const existingRules = await db
    .select({
      id: companyPlaceSupplyRules.id,
      placeTypes: companyPlaceSupplyRules.placeTypes,
    })
    .from(companyPlaceSupplyRules)
    .where(and(...conditions));

  const overlappingRule = existingRules.find((rule) => hasRulePlaceTypeOverlap(rule.placeTypes, placeTypes));
  if (overlappingRule) {
    throw Object.assign(new Error('An active rule for this country already covers one or more of the selected place types.'), {
      code: 'OVERLAPPING_RULE',
      ruleId: overlappingRule.id,
    });
  }
}

async function getMatchingPlacesForCompanyPlaceSupplyRule(rule: CompanyPlaceSupplyRuleRow) {
  if (!rule.placeTypes.length) return [];

  return db
    .select({
      id: places.id,
      placeType: places.placeType,
      countryIso: places.countryIso,
      country: places.country,
    })
    .from(places)
    .where(and(
      or(
        eq(places.countryIso, rule.countryIso),
        sql`upper(${places.country}) = ${rule.countryIso}`,
      )!,
      inArray(places.placeType, rule.placeTypes as CompanyPlaceSupplyRulePlaceType[]),
    ));
}

async function ensurePortSupplierFromCoverageRule(placeId: string, rule: CompanyPlaceSupplyRuleRow): Promise<'created' | 'updated' | 'skipped'> {
  const [existing] = await db
    .select({
      id: portSuppliers.id,
      coverageRuleId: portSuppliers.coverageRuleId,
      coverageSource: portSuppliers.coverageSource,
    })
    .from(portSuppliers)
    .where(and(eq(portSuppliers.placeId, placeId), eq(portSuppliers.companyId, rule.companyId)))
    .limit(1);

  if (!existing) {
    await db.insert(portSuppliers).values({
      placeId,
      companyId: rule.companyId,
      contactId: rule.contactId ?? null,
      products: rule.products,
      note: rule.note,
      coverageRuleId: rule.id,
      coverageSource: COMPANY_PLACE_SUPPLY_RULE_SOURCE,
      addedById: rule.addedById ?? null,
      addedByName: rule.addedByName ?? null,
    });
    return 'created';
  }

  if (existing.coverageRuleId === rule.id) {
    await db
      .update(portSuppliers)
      .set({
        contactId: rule.contactId ?? null,
        products: rule.products,
        note: rule.note,
        coverageSource: COMPANY_PLACE_SUPPLY_RULE_SOURCE,
        updatedAt: new Date(),
      })
      .where(eq(portSuppliers.id, existing.id));
    return 'updated';
  }

  return 'skipped';
}

async function applyCompanyPlaceSupplyRuleRow(rule: CompanyPlaceSupplyRuleRow) {
  const matches = await getMatchingPlacesForCompanyPlaceSupplyRule(rule);
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const place of matches) {
    const result = await ensurePortSupplierFromCoverageRule(place.id, rule);
    if (result === 'created') created += 1;
    else if (result === 'updated') updated += 1;
    else skipped += 1;
  }

  return {
    created,
    updated,
    skipped,
    matchedPlaceCount: matches.length,
  };
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
    personId: number;
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

interface SeasearcherFleetOwner {
  type?: string | null;
  typeCode?: string | null;
  companyId?: string | null;
  companyName?: string | null;
}

interface SeasearcherFleetVessel {
  id?: string | null;
  imo?: string | null;
  name?: string | null;
  owners?: SeasearcherFleetOwner[] | null;
}

interface GroupCompanyRecord {
  id: string;
  name: string;
  seasearcherId: string | null;
}

export interface GroupVesselRow {
  id: string;
  vesselId: string;
  localVesselId: string | null;
  seasearcherVesselId: string | null;
  vesselName: string;
  vesselImo: string | null;
  companyId: string;
  companyName: string;
  role: string;
  source: string | null;
  contactId: string | null;
  note: string | null;
  addedById: string | null;
  addedByName: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface GroupFleetResponse {
  results: Array<Record<string, any>>;
  totalMatches: number;
  queriedCompanyCount: number;
  totalCompanyCount: number;
  truncated: boolean;
  maxCompanies: number;
}

const GROUP_FLEET_MAX_COMPANIES = 12;

// ═══════════════════════════════════════════════════════════════════════
//  LIST COMPANIES (local DB, paginated)
// ═══════════════════════════════════════════════════════════════════════

export async function listCompanies(query?: {
  search?: string;
  type?: string;
  country?: string;
  responsibleUserId?: string;
  segment?: string; // format: "categoryKey:optionKey"
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  page?: number;
}) {
  const conditions = [];
  if (query?.search) conditions.push(ilike(counterparties.name, `%${escapeLikePattern(query.search)}%`));
  if (query?.type) conditions.push(sql`${counterparties.types} @> ${JSON.stringify([query.type])}::jsonb`);
  if (query?.country) conditions.push(ilike(counterparties.country, `%${escapeLikePattern(query.country)}%`));
  if (query?.responsibleUserId) conditions.push(eq(counterparties.responsibleUserId, query.responsibleUserId));
  if (query?.segment) {
    const [catKey, optKey] = query.segment.split(':');
    if (catKey && optKey) {
      // Match both single-select (string) and multi-select (array contains).
      // catKey/optKey are bound as parameters (not sql.raw) to avoid SQL injection.
      conditions.push(sql`(
        ${counterparties.segments}->>${catKey} = ${optKey}
        OR ${counterparties.segments}->${catKey} @> ${JSON.stringify([optKey])}::jsonb
      )`);
    }
  }

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
        contactsCount: sql<number>`(SELECT count(*)::int FROM company_contacts cc WHERE cc.counterparty_id = ${counterparties.id} AND cc.deleted_at IS NULL)`,
        parentId: counterparties.parentId,
        parentName: sql<string | null>`(SELECT c2.name FROM counterparties c2 WHERE c2.id = ${counterparties.parentId})`.as('parent_name'),
        segments: counterparties.segments,
        preferredInvoicingCompanyId: counterparties.preferredInvoicingCompanyId,
        preferredInvoicingCompanyName: sql<string | null>`(SELECT c3.name FROM counterparties c3 WHERE c3.id = ${counterparties.preferredInvoicingCompanyId})`.as('preferred_invoicing_company_name'),
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

  // Compute credit limit from actual credit lines (not just the manual column).
  // The counterparties.creditLimit column is only synced when a credit application
  // is approved. If credit lines were created directly, we need to aggregate them.
  const creditLineRows = await db
    .select({ creditAmount: creditLines.creditAmount })
    .from(creditLines)
    .innerJoin(creditLineCounterparties, eq(creditLineCounterparties.creditLineId, creditLines.id))
    .where(eq(creditLineCounterparties.counterpartyId, id));
  const computedCreditLimit = creditLineRows.reduce((sum, r) => sum + (parseFloat(r.creditAmount) || 0), 0);
  const manualCreditLimit = parseFloat(row.creditLimit ?? '0') || 0;
  // Use the higher of: manual column or sum of credit lines
  const effectiveCreditLimit = Math.max(computedCreditLimit, manualCreditLimit);

  return { ...row, responsibleUserName, creditLimit: effectiveCreditLimit.toFixed(2) };
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

  // Sync branch offices from Seasearcher
  if (detail.offices?.length) {
    await syncOfficesFromSeasearcher(created.id, detail.offices);
  }

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
  dismissed: boolean;
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
  const dismissed: Record<string, any> = (local.dismissedConflicts as Record<string, any>) ?? {};
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
        // Check if this SS value was previously dismissed
        const dismissedStr = JSON.stringify(dismissed[field] ?? null);
        const isDismissed = dismissedStr === ssStr;
        conflicts.push({
          field,
          localValue: localVal,
          seasearcherValue: ssValue,
          dismissed: isDismissed,
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

  // Sync branch offices from Seasearcher
  if (detail.offices?.length) {
    await syncOfficesFromSeasearcher(companyId, detail.offices);
  }

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

  // Also clear any dismissed conflict for this field
  const dismissed: Record<string, any> = { ...((local.dismissedConflicts as Record<string, any>) ?? {}) };
  delete dismissed[field];

  const setFields: Record<string, any> = {
    manualOverrides: overrides,
    dismissedConflicts: dismissed,
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
//  KEEP MINE (dismiss a conflict by storing the SS value we're ignoring)
// ═══════════════════════════════════════════════════════════════════════

export async function keepMineValue(companyId: string, field: string, seasearcherValue: string | number | null) {
  const local = await getCompanyById(companyId);
  if (!local) return null;

  const dismissed: Record<string, any> = { ...((local.dismissedConflicts as Record<string, any>) ?? {}) };
  dismissed[field] = seasearcherValue;

  const [updated] = await db
    .update(counterparties)
    .set({ dismissedConflicts: dismissed, updatedAt: new Date() })
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
    specialCustomerTerms?: string | null;
    preferredInvoicingCompanyId?: string | null;
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
  if (data.specialCustomerTerms !== undefined) setFields.specialCustomerTerms = data.specialCustomerTerms;
  if (data.preferredInvoicingCompanyId !== undefined) setFields.preferredInvoicingCompanyId = data.preferredInvoicingCompanyId;

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
//  UPDATE COMPANY SEGMENTS
// ═══════════════════════════════════════════════════════════════════════

export async function updateCompanySegments(companyId: string, segments: Record<string, string | string[]>) {
  const [updated] = await db
    .update(counterparties)
    .set({ segments, updatedAt: new Date() })
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
    .select({ count: sql<number>`count(distinct ${orders.id})::int` })
    .from(orders)
    .leftJoin(orderSuppliers, eq(orderSuppliers.orderId, orders.id))
    .where(
      or(
        eq(orders.clientId, id),
        eq(orders.supplierId, id),
        eq(orderSuppliers.companyId, id),
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
    .where(ilike(counterparties.name, `%${escapeLikePattern(term)}%`))
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
      ignoreForCreditEnforcement: vessels.ignoreForCreditEnforcement,
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
    .where(and(eq(companyContacts.counterpartyId, counterpartyId), isNull(companyContacts.deletedAt)))
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
  const [current] = await db
    .select({
      id: companyContacts.id,
      source: companyContacts.source,
      seasearcherPersonId: companyContacts.seasearcherPersonId,
    })
    .from(companyContacts)
    .where(eq(companyContacts.id, contactId))
    .limit(1);
  if (!current) return null;

  const [updated] = await db
    .update(companyContacts)
    .set({
      ...data,
      ...(current.source === 'seasearcher' || current.seasearcherPersonId !== null ? { source: 'manual' } : {}),
      deletedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(companyContacts.id, contactId))
    .returning();
  return updated;
}

export async function deleteCompanyContact(contactId: string) {
  const [current] = await db
    .select({
      id: companyContacts.id,
      source: companyContacts.source,
      seasearcherPersonId: companyContacts.seasearcherPersonId,
    })
    .from(companyContacts)
    .where(eq(companyContacts.id, contactId))
    .limit(1);
  if (!current) return;

  if (current.source === 'seasearcher' || current.seasearcherPersonId !== null) {
    await db
      .update(companyContacts)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(companyContacts.id, contactId));
    return;
  }

  await db.delete(companyContacts).where(eq(companyContacts.id, contactId));
}

/**
 * Sync contacts from Seasearcher enrichment data into the company_contacts table.
 * Upserts synced contacts by personId, preserves manual overrides, and keeps
 * deleted synced contacts hidden on future syncs.
 */
export async function syncContactsFromSeasearcher(
  counterpartyId: string,
  headOffice: SeasearcherCompanyOffice | null,
) {
  if (!headOffice?.personnel?.length) {
    await db
      .update(companyContacts)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(companyContacts.counterpartyId, counterpartyId),
          eq(companyContacts.source, 'seasearcher'),
          isNull(companyContacts.deletedAt),
        ),
      );
    return;
  }

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

  const existingContacts = await db
    .select({
      id: companyContacts.id,
      source: companyContacts.source,
      name: companyContacts.name,
      role: companyContacts.role,
      email: companyContacts.email,
      seasearcherPersonId: companyContacts.seasearcherPersonId,
      deletedAt: companyContacts.deletedAt,
    })
    .from(companyContacts)
    .where(eq(companyContacts.counterpartyId, counterpartyId));

  const existingByPersonId = new Map<number, (typeof existingContacts)[number]>();
  const legacyByFingerprint = new Map<string, (typeof existingContacts)[number]>();
  for (const existing of existingContacts) {
    if (existing.seasearcherPersonId !== null) {
      existingByPersonId.set(existing.seasearcherPersonId, existing);
      continue;
    }
    if (existing.source === 'seasearcher') {
      legacyByFingerprint.set(buildSeasearcherContactFingerprint(existing), existing);
    }
  }

  const seenPersonIds = new Set<number>();
  for (const person of headOffice.personnel) {
    seenPersonIds.add(person.personId);

    const nextValues = {
      name: person.name,
      role: person.jobTitle || null,
      phone,
      fax,
      email: headOffice.emailAddress ?? null,
      seasearcherPersonId: person.personId,
      deletedAt: null,
      updatedAt: new Date(),
    };
    const existing = existingByPersonId.get(person.personId)
      ?? legacyByFingerprint.get(buildSeasearcherContactFingerprint(nextValues));

    if (existing) {
      if (existing.deletedAt !== null) continue;

      if (existing.source === 'manual') {
        if (existing.seasearcherPersonId === null) {
          await db
            .update(companyContacts)
            .set({ seasearcherPersonId: person.personId, updatedAt: new Date() })
            .where(eq(companyContacts.id, existing.id));
        }
        continue;
      }

      await db
        .update(companyContacts)
        .set({
          ...nextValues,
          source: 'seasearcher',
        })
        .where(eq(companyContacts.id, existing.id));
      continue;
    }

    await db.insert(companyContacts).values({
      counterpartyId,
      source: 'seasearcher',
      ...nextValues,
    });
  }

  const staleSyncedIds = existingContacts
    .filter((contact) => contact.source === 'seasearcher' && contact.deletedAt === null)
    .filter((contact) => contact.seasearcherPersonId !== null && !seenPersonIds.has(contact.seasearcherPersonId))
    .map((contact) => contact.id);

  if (staleSyncedIds.length) {
    await db
      .update(companyContacts)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(inArray(companyContacts.id, staleSyncedIds));
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

// ═══════════════════════════════════════════════════════════════════════
//  Company Offices
// ═══════════════════════════════════════════════════════════════════════

export async function getCompanyOffices(counterpartyId: string) {
  return db
    .select()
    .from(companyOffices)
    .where(eq(companyOffices.counterpartyId, counterpartyId))
    .orderBy(companyOffices.city);
}

export async function addCompanyOffice(
  counterpartyId: string,
  data: { city: string; country?: string; countryCode?: string; address?: string; phone?: string; email?: string; source?: string; seasearcherOfficeId?: number },
) {
  const [created] = await db
    .insert(companyOffices)
    .values({
      counterpartyId,
      city: data.city,
      country: data.country ?? null,
      countryCode: data.countryCode ?? null,
      address: data.address ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
      source: data.source ?? 'manual',
      seasearcherOfficeId: data.seasearcherOfficeId ?? null,
    })
    .returning();
  return created;
}

export async function updateCompanyOffice(
  id: string,
  data: { city?: string; country?: string; countryCode?: string; address?: string; phone?: string; email?: string },
) {
  const [updated] = await db
    .update(companyOffices)
    .set({
      ...(data.city !== undefined && { city: data.city }),
      ...(data.country !== undefined && { country: data.country }),
      ...(data.countryCode !== undefined && { countryCode: data.countryCode }),
      ...(data.address !== undefined && { address: data.address }),
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.email !== undefined && { email: data.email }),
      updatedAt: new Date(),
    })
    .where(eq(companyOffices.id, id))
    .returning();
  return updated ?? null;
}

export async function deleteCompanyOffice(id: string) {
  const [deleted] = await db
    .delete(companyOffices)
    .where(eq(companyOffices.id, id))
    .returning({ id: companyOffices.id, city: companyOffices.city });
  return deleted ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  Company Attachments
// ═══════════════════════════════════════════════════════════════════════

export async function getCompanyAttachments(counterpartyId: string) {
  const rows = await db
    .select({
      id: companyAttachments.id,
      counterpartyId: companyAttachments.counterpartyId,
      fileName: companyAttachments.fileName,
      filePath: companyAttachments.filePath,
      mimeType: companyAttachments.mimeType,
      fileSize: companyAttachments.fileSize,
      uploadedBy: companyAttachments.uploadedBy,
      createdAt: companyAttachments.createdAt,
    })
    .from(companyAttachments)
    .where(eq(companyAttachments.counterpartyId, counterpartyId))
    .orderBy(desc(companyAttachments.createdAt));

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function createCompanyAttachment(input: {
  counterpartyId: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  fileSize: number;
  uploadedBy?: string | null;
}) {
  const [created] = await db
    .insert(companyAttachments)
    .values({
      counterpartyId: input.counterpartyId,
      fileName: input.fileName,
      filePath: input.filePath,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      uploadedBy: input.uploadedBy ?? null,
    })
    .returning();

  if (!created) return null;

  return {
    ...created,
    createdAt: created.createdAt.toISOString(),
  };
}

export async function deleteCompanyAttachment(id: string) {
  const [deleted] = await db
    .delete(companyAttachments)
    .where(eq(companyAttachments.id, id))
    .returning({
      id: companyAttachments.id,
      counterpartyId: companyAttachments.counterpartyId,
      fileName: companyAttachments.fileName,
      filePath: companyAttachments.filePath,
    });

  return deleted ?? null;
}

export async function syncOfficesFromSeasearcher(
  counterpartyId: string,
  offices: SeasearcherCompanyOffice[],
) {
  for (const office of offices) {
    const addressParts = [office.addressLine1, office.addressLine2, office.addressLine3, office.addressLine4].filter(Boolean);
    if (office.postCode1) addressParts.push(office.postCode1);
    const phoneStr = office.telephoneNumbers?.[0]
      ? `+${office.telephoneNumbers[0].countryDialingCode} ${office.telephoneNumbers[0].areaDialingCode} ${office.telephoneNumbers[0].number}`.trim()
      : null;

    // Upsert by seasearcherOfficeId if present
    const [existing] = await db
      .select({ id: companyOffices.id })
      .from(companyOffices)
      .where(and(eq(companyOffices.counterpartyId, counterpartyId), eq(companyOffices.seasearcherOfficeId, office.officeId)))
      .limit(1);

    if (existing) {
      await db.update(companyOffices).set({
        city: office.town || 'Unknown',
        country: office.country ?? null,
        countryCode: office.countryCode ?? null,
        address: addressParts.join(', ') || null,
        phone: phoneStr,
        email: office.emailAddress ?? null,
        updatedAt: new Date(),
      }).where(eq(companyOffices.id, existing.id));
    } else {
      await db.insert(companyOffices).values({
        counterpartyId,
        city: office.town || 'Unknown',
        country: office.country ?? null,
        countryCode: office.countryCode ?? null,
        address: addressParts.join(', ') || null,
        phone: phoneStr,
        email: office.emailAddress ?? null,
        source: 'seasearcher',
        seasearcherOfficeId: office.officeId,
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  PARENT / CHILD HIERARCHY
//  Single-level only: a parent cannot be a child; a child cannot be a parent.
// ═══════════════════════════════════════════════════════════════════════

/** Get child companies for a parent. */
export async function getChildCompanies(parentId: string) {
  return db
    .select({
      id: counterparties.id,
      name: counterparties.name,
      country: counterparties.country,
      creditLimit: counterparties.creditLimit,
      creditUsed: counterparties.creditUsed,
      fleetSize: counterparties.fleetSize,
      isSanctioned: counterparties.isSanctioned,
    })
    .from(counterparties)
    .where(eq(counterparties.parentId, parentId))
    .orderBy(counterparties.name);
}

/** Get parent summary for a child company. */
export async function getParentCompany(childId: string) {
  const [child] = await db
    .select({ parentId: counterparties.parentId })
    .from(counterparties)
    .where(eq(counterparties.id, childId))
    .limit(1);
  if (!child?.parentId) return null;

  const [parent] = await db
    .select({
      id: counterparties.id,
      name: counterparties.name,
      country: counterparties.country,
    })
    .from(counterparties)
    .where(eq(counterparties.id, child.parentId))
    .limit(1);
  return parent ?? null;
}

/** Set the parent for a child company (link). Enforces single-level constraint. */
export async function setParentCompany(childId: string, parentId: string) {
  if (childId === parentId) {
    throw Object.assign(new Error('A company cannot be its own parent.'), { code: 'SELF_REFERENCE' });
  }

  // The target parent must not itself be a child
  const [parentRow] = await db
    .select({ parentId: counterparties.parentId })
    .from(counterparties)
    .where(eq(counterparties.id, parentId))
    .limit(1);
  if (!parentRow) throw Object.assign(new Error('Parent company not found.'), { code: 'NOT_FOUND' });
  if (parentRow.parentId) {
    throw Object.assign(new Error('Cannot link to a company that is already a child of another company.'), { code: 'ALREADY_CHILD' });
  }

  // The child must not already have children (would create depth > 1)
  const [hasChildren] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(counterparties)
    .where(eq(counterparties.parentId, childId));
  if (hasChildren && hasChildren.count > 0) {
    throw Object.assign(
      new Error('Cannot make a parent company into a child. Remove its children first.'),
      { code: 'HAS_CHILDREN' },
    );
  }

  const [updated] = await db
    .update(counterparties)
    .set({ parentId, updatedAt: new Date() })
    .where(eq(counterparties.id, childId))
    .returning();
  return updated ?? null;
}

/** Remove the parent link from a child company (unlink). */
export async function removeParentCompany(childId: string) {
  const [updated] = await db
    .update(counterparties)
    .set({ parentId: null, updatedAt: new Date() })
    .where(eq(counterparties.id, childId))
    .returning();
  return updated ?? null;
}

/** Aggregated credit, fleet, and order totals for a parent + all its children. */
export async function getCompanyGroupAggregate(parentId: string) {
  const [row] = await db.execute<{
    total_credit_limit: string;
    total_credit_used: string;
    total_fleet_size: string;
    total_orders: string;
    child_count: string;
  }>(sql`
    WITH family AS (
      SELECT id, credit_limit, credit_used, fleet_size
      FROM counterparties
      WHERE id = ${parentId} OR parent_id = ${parentId}
    )
    SELECT
      COALESCE(SUM(f.credit_limit), 0)::text AS total_credit_limit,
      COALESCE(SUM(f.credit_used), 0)::text AS total_credit_used,
      COALESCE(SUM(f.fleet_size), 0)::int AS total_fleet_size,
      (SELECT count(*)::int FROM orders WHERE client_id IN (SELECT id FROM family)) AS total_orders,
      (SELECT count(*)::int FROM family WHERE id != ${parentId}) AS child_count
    FROM family f
  `);

  return {
    totalCreditLimit: row?.total_credit_limit ?? '0',
    totalCreditUsed: row?.total_credit_used ?? '0',
    totalFleetSize: Number(row?.total_fleet_size ?? 0),
    totalOrders: Number(row?.total_orders ?? 0),
    childCount: Number(row?.child_count ?? 0),
  };
}

/** Get orders for a parent + all its children. */
export async function getGroupOrdersForCompany(parentId: string) {
  return db
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
      clientId: orders.clientId,
      clientName: counterparties.name,
    })
    .from(orders)
    .innerJoin(vessels, eq(orders.vesselId, vessels.id))
    .innerJoin(places, eq(orders.placeId, places.id))
    .innerJoin(counterparties, eq(orders.clientId, counterparties.id))
    .where(
      or(
        eq(orders.clientId, parentId),
        sql`${orders.clientId} IN (SELECT id FROM counterparties WHERE parent_id = ${parentId})`,
      )!,
    )
    .orderBy(sql`${orders.createdAt} desc`);
}

async function getCompanyFamily(companyId: string): Promise<GroupCompanyRecord[]> {
  const [company] = await db
    .select({
      id: counterparties.id,
      parentId: counterparties.parentId,
    })
    .from(counterparties)
    .where(eq(counterparties.id, companyId))
    .limit(1);

  if (!company) return [];

  const rootId = company.parentId ?? company.id;
  return db
    .select({
      id: counterparties.id,
      name: counterparties.name,
      seasearcherId: counterparties.seasearcherId,
    })
    .from(counterparties)
    .where(
      or(
        eq(counterparties.id, rootId),
        eq(counterparties.parentId, rootId),
      )!,
    )
    .orderBy(
      sql`CASE WHEN ${counterparties.id} = ${rootId} THEN 0 ELSE 1 END`,
      counterparties.name,
    );
}

function normalizeGroupFleetRole(role?: string | null): string {
  if (!role) return 'FLEET';
  return role.trim().replace(/\s+/g, '_').toUpperCase();
}

function buildGroupVesselDedupKey(row: Pick<GroupVesselRow, 'companyId' | 'localVesselId' | 'seasearcherVesselId' | 'vesselImo' | 'vesselName' | 'role'>): string {
  return [
    row.companyId,
    row.role,
    row.localVesselId ?? row.seasearcherVesselId ?? row.vesselImo ?? row.vesselName.trim().toLowerCase(),
  ].join('|');
}

async function getSeasearcherGroupVessels(family: GroupCompanyRecord[]): Promise<GroupVesselRow[]> {
  const companies = family.filter((company) => company.seasearcherId);
  if (!companies.length) return [];

  const settled = await Promise.allSettled(
    companies.map(async (company) => {
      const fleet = await seasearcherCompanyFleet<{ results: SeasearcherFleetVessel[]; totalMatches: number }>(company.seasearcherId!);
      return (fleet.results ?? []).flatMap((vessel) => {
        const matchingOwners = (vessel.owners ?? []).filter(
          (owner) => String(owner.companyId ?? '') === String(company.seasearcherId),
        );

        const owners = matchingOwners.length
          ? matchingOwners
          : [{
              type: null,
              typeCode: null,
              companyId: company.seasearcherId,
              companyName: company.name,
            } satisfies SeasearcherFleetOwner];

        return owners.map((owner, index) => ({
          id: `ss:${company.id}:${vessel.id ?? vessel.imo ?? vessel.name ?? index}:${normalizeGroupFleetRole(owner.typeCode ?? owner.type)}`,
          vesselId: String(vessel.id ?? vessel.imo ?? vessel.name ?? `${company.id}-${index}`),
          localVesselId: null,
          seasearcherVesselId: vessel.id ? String(vessel.id) : null,
          vesselName: vessel.name?.trim() || 'Unknown vessel',
          vesselImo: vessel.imo ? String(vessel.imo) : null,
          companyId: company.id,
          companyName: company.name,
          role: normalizeGroupFleetRole(owner.typeCode ?? owner.type),
          source: 'seasearcher',
          contactId: null,
          note: null,
          addedById: null,
          addedByName: null,
          createdAt: null,
          updatedAt: null,
        }));
      });
    }),
  );

  const rows = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  if (!rows.length) return rows;

  const matches = await matchLocalVessels({
    seasearcherIds: rows.map((row) => row.seasearcherVesselId ?? '').filter(Boolean),
    imos: rows.map((row) => row.vesselImo ?? '').filter(Boolean),
  });

  const matchesBySeasearcherId = new Map(matches.map((match) => [match.seasearcherId ?? '', match]));
  const matchesByImo = new Map(matches.map((match) => [match.imo ?? '', match]));

  return rows.map((row) => {
    const localMatch =
      (row.seasearcherVesselId ? matchesBySeasearcherId.get(row.seasearcherVesselId) : null)
      ?? (row.vesselImo ? matchesByImo.get(row.vesselImo) : null)
      ?? null;

    return {
      ...row,
      vesselId: localMatch?.id ?? row.vesselId,
      localVesselId: localMatch?.id ?? null,
    };
  });
}

export async function getGroupFleetForCompany(companyId: string): Promise<GroupFleetResponse> {
  const family = await getCompanyFamily(companyId);
  const companiesWithFleet = family.filter((company) => company.seasearcherId);
  const queriedCompanies = companiesWithFleet.slice(0, GROUP_FLEET_MAX_COMPANIES);

  const settled = await Promise.allSettled(
    queriedCompanies.map(async (company) => {
      const fleet = await seasearcherCompanyFleet<{ results: Array<Record<string, any>>; totalMatches: number }>(company.seasearcherId!);
      return { company, fleet };
    }),
  );

  const fulfilled = settled.filter(
    (result): result is PromiseFulfilledResult<{ company: GroupCompanyRecord; fleet: { results: Array<Record<string, any>>; totalMatches: number } }> => result.status === 'fulfilled',
  );

  const results = fulfilled.flatMap(({ value }) =>
    (value.fleet.results ?? []).map((vessel) => ({
      ...vessel,
      companyId: value.company.id,
      companyName: value.company.name,
    })),
  );

  return {
    results,
    totalMatches: fulfilled.reduce((sum, { value }) => sum + (value.fleet.totalMatches ?? value.fleet.results?.length ?? 0), 0),
    queriedCompanyCount: queriedCompanies.length,
    totalCompanyCount: companiesWithFleet.length,
    truncated: companiesWithFleet.length > queriedCompanies.length,
    maxCompanies: GROUP_FLEET_MAX_COMPANIES,
  };
}

/** Get vessels for a company group (root parent + all direct children). */
export async function getGroupVesselsForCompany(companyId: string) {
  const family = await getCompanyFamily(companyId);
  if (!family.length) return [];

  const familyIds = family.map((company) => company.id);
  const [manualRows, seasearcherRows] = await Promise.all([
    db
    .select({
      id: vesselCompanies.id,
      vesselId: vesselCompanies.vesselId,
      localVesselId: vesselCompanies.vesselId,
      seasearcherVesselId: vessels.seasearcherId,
      vesselName: vessels.name,
      vesselImo: vessels.imo,
      companyId: vesselCompanies.companyId,
      companyName: counterparties.name,
      role: vesselCompanies.role,
      source: vesselCompanies.source,
      contactId: vesselCompanies.contactId,
      note: vesselCompanies.note,
      addedById: vesselCompanies.addedById,
      addedByName: vesselCompanies.addedByName,
      createdAt: vesselCompanies.createdAt,
      updatedAt: vesselCompanies.updatedAt,
    })
    .from(vesselCompanies)
    .innerJoin(vessels, eq(vesselCompanies.vesselId, vessels.id))
    .innerJoin(counterparties, eq(vesselCompanies.companyId, counterparties.id))
    .where(inArray(vesselCompanies.companyId, familyIds)),
    getSeasearcherGroupVessels(family),
  ]);

  const merged = new Map<string, GroupVesselRow>();
  for (const row of seasearcherRows) {
    merged.set(buildGroupVesselDedupKey(row), row);
  }
  for (const row of manualRows) {
    merged.set(buildGroupVesselDedupKey(row), row);
  }

  return Array.from(merged.values()).sort((left, right) => {
    const companyCompare = left.companyName.localeCompare(right.companyName);
    if (companyCompare !== 0) return companyCompare;
    const roleCompare = left.role.localeCompare(right.role);
    if (roleCompare !== 0) return roleCompare;
    return left.vesselName.localeCompare(right.vesselName);
  });
}

/** Top parent companies by aggregated credit exposure (parent + children). */
export async function getTopCreditGroups(limit = 10) {
  const rows = await db.execute(sql`
    WITH grouped AS (
      SELECT
        p.id,
        p.name,
        p.country,
        COALESCE(p.credit_limit, 0) + COALESCE(SUM(c.credit_limit), 0) AS "totalCreditLimit",
        COALESCE(p.credit_used, 0) + COALESCE(SUM(c.credit_used), 0) AS "totalCreditUsed",
        1 + COUNT(c.id)::int AS "childCount"
      FROM counterparties p
      INNER JOIN counterparties c ON c.parent_id = p.id
      GROUP BY p.id, p.name, p.country, p.credit_limit, p.credit_used
    )
    SELECT *
    FROM grouped
    WHERE "totalCreditLimit" > 0 OR "totalCreditUsed" > 0
    ORDER BY "totalCreditUsed" DESC, "totalCreditLimit" DESC, name ASC
    LIMIT ${limit}
  `);
  return rows as unknown as {
    id: string;
    name: string;
    country: string | null;
    totalCreditLimit: string;
    totalCreditUsed: string;
    childCount: number;
  }[];
}

// ═══════════════════════════════════════════════════════════════════════
//  COMPANY PLACE SUPPLY RULES
// ═══════════════════════════════════════════════════════════════════════

export async function listCompanyPlaceSupplyRules(companyId: string) {
  const rows = await db
    .select(buildCompanyPlaceSupplyRuleSelection())
    .from(companyPlaceSupplyRules)
    .leftJoin(companyContacts, eq(companyPlaceSupplyRules.contactId, companyContacts.id))
    .where(eq(companyPlaceSupplyRules.companyId, companyId))
    .orderBy(asc(companyPlaceSupplyRules.countryIso), asc(companyPlaceSupplyRules.createdAt));

  return rows.map((row) => serializeCompanyPlaceSupplyRule(row));
}

export async function createCompanyPlaceSupplyRule(
  companyId: string,
  data: {
    countryIso: string;
    placeTypes: string[];
    contactId?: string | null;
    products?: string[];
    note?: string | null;
    isActive?: boolean;
  },
  userId: string,
  userName: string,
) {
  const countryIso = normalizeCountryIso(data.countryIso);
  const placeTypes = normalizeRulePlaceTypes(data.placeTypes);
  const contactId = data.contactId ?? null;
  const products = normalizeRuleProducts(data.products);
  const note = normalizeRuleNote(data.note);
  const isActive = data.isActive ?? true;

  await assertRuleContactBelongsToCompany(companyId, contactId);
  if (isActive) {
    await assertNoOverlappingCompanyPlaceSupplyRules(companyId, countryIso, placeTypes);
  }

  const [created] = await db
    .insert(companyPlaceSupplyRules)
    .values({
      companyId,
      countryIso,
      placeTypes,
      contactId,
      products,
      note,
      isActive,
      addedById: userId,
      addedByName: userName,
    })
    .returning({ id: companyPlaceSupplyRules.id });

  const rule = created ? await getCompanyPlaceSupplyRuleRowById(created.id) : null;
  if (!rule) {
    throw new Error('Failed to create place supply rule.');
  }

  const applySummary = rule.isActive
    ? await applyCompanyPlaceSupplyRuleRow(rule)
    : { created: 0, updated: 0, skipped: 0, matchedPlaceCount: 0 };

  return {
    rule: serializeCompanyPlaceSupplyRule(rule),
    ...applySummary,
  };
}

export async function updateCompanyPlaceSupplyRule(
  companyId: string,
  ruleId: string,
  data: {
    countryIso?: string;
    placeTypes?: string[];
    contactId?: string | null;
    products?: string[];
    note?: string | null;
    isActive?: boolean;
  },
) {
  const existing = await getCompanyPlaceSupplyRuleRowById(ruleId);
  if (!existing || existing.companyId !== companyId) return null;

  const nextCountryIso = data.countryIso !== undefined ? normalizeCountryIso(data.countryIso) : existing.countryIso;
  const nextPlaceTypes = data.placeTypes !== undefined ? normalizeRulePlaceTypes(data.placeTypes) : existing.placeTypes as CompanyPlaceSupplyRulePlaceType[];
  const nextContactId = data.contactId !== undefined ? data.contactId ?? null : existing.contactId;
  const nextProducts = data.products !== undefined ? normalizeRuleProducts(data.products) : existing.products;
  const nextNote = data.note !== undefined ? normalizeRuleNote(data.note) : existing.note;
  const nextIsActive = data.isActive ?? existing.isActive;

  await assertRuleContactBelongsToCompany(existing.companyId, nextContactId);
  if (nextIsActive) {
    await assertNoOverlappingCompanyPlaceSupplyRules(existing.companyId, nextCountryIso, nextPlaceTypes, ruleId);
  }

  await db
    .update(companyPlaceSupplyRules)
    .set({
      countryIso: nextCountryIso,
      placeTypes: nextPlaceTypes,
      contactId: nextContactId,
      products: nextProducts,
      note: nextNote,
      isActive: nextIsActive,
      updatedAt: new Date(),
    })
    .where(eq(companyPlaceSupplyRules.id, ruleId));

  const updated = await getCompanyPlaceSupplyRuleRowById(ruleId);
  return updated ? serializeCompanyPlaceSupplyRule(updated) : null;
}

export async function deleteCompanyPlaceSupplyRule(companyId: string, ruleId: string) {
  const [deleted] = await db
    .delete(companyPlaceSupplyRules)
    .where(and(eq(companyPlaceSupplyRules.id, ruleId), eq(companyPlaceSupplyRules.companyId, companyId)))
    .returning({
      id: companyPlaceSupplyRules.id,
      companyId: companyPlaceSupplyRules.companyId,
      countryIso: companyPlaceSupplyRules.countryIso,
      placeTypes: companyPlaceSupplyRules.placeTypes,
    });

  return deleted ?? null;
}

export async function reapplyCompanyPlaceSupplyRule(companyId: string, ruleId: string) {
  const rule = await getCompanyPlaceSupplyRuleRowById(ruleId);
  if (!rule || rule.companyId !== companyId) return null;

  const summary = rule.isActive
    ? await applyCompanyPlaceSupplyRuleRow(rule)
    : { created: 0, updated: 0, skipped: 0, matchedPlaceCount: 0 };

  return {
    rule: serializeCompanyPlaceSupplyRule(rule),
    ...summary,
  };
}

export async function applyMatchingCompanyPlaceSupplyRulesForPlace(placeId: string) {
  const [place] = await db
    .select({
      id: places.id,
      countryIso: places.countryIso,
      country: places.country,
      placeType: places.placeType,
    })
    .from(places)
    .where(eq(places.id, placeId))
    .limit(1);

  if (!place || !place.placeType) {
    return { created: 0, updated: 0, skipped: 0, matchedRuleCount: 0 };
  }

  const countryCandidates = getPlaceCountryIsoCandidates(place);
  if (!countryCandidates.length) {
    return { created: 0, updated: 0, skipped: 0, matchedRuleCount: 0 };
  }

  const rules = await db
    .select(buildCompanyPlaceSupplyRuleSelection())
    .from(companyPlaceSupplyRules)
    .leftJoin(companyContacts, eq(companyPlaceSupplyRules.contactId, companyContacts.id))
    .where(and(
      eq(companyPlaceSupplyRules.isActive, true),
      inArray(companyPlaceSupplyRules.countryIso, countryCandidates),
    ));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let matchedRuleCount = 0;

  for (const rule of rules) {
    if (!rule.placeTypes.includes(place.placeType)) {
      continue;
    }

    matchedRuleCount += 1;
    const result = await ensurePortSupplierFromCoverageRule(place.id, rule);
    if (result === 'created') created += 1;
    else if (result === 'updated') updated += 1;
    else skipped += 1;
  }

  return { created, updated, skipped, matchedRuleCount };
}
