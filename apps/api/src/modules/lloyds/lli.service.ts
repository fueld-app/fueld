// ═══════════════════════════════════════════════════════════════════════
//  Lloyd's List Intelligence — Service
//  Search local DB first; fall back to LLI API if not found.
// ═══════════════════════════════════════════════════════════════════════

import { eq, ilike, or, and, sql } from 'drizzle-orm';
import { db } from '../../db';
import { vessels, places, counterparties } from '../../db/schema';
import { lliGet } from './lli.client';

// ═══════════════════════════════════════════════════════════════════════
//  Response types for LLI API
// ═══════════════════════════════════════════════════════════════════════

interface LliResponse<T> {
  IsSuccess: boolean;
  Data: T;
  Errors: unknown[];
}

// ── Vessel Basic Characteristics ─────────────────────────────────────

interface LliVesselBasicCharsData {
  CurrentPage: number;
  TotalPages: number;
  TotalRecords: number;
  vessels: LliVesselBasic[];
}

interface LliVesselBasic {
  vesselId: string;
  imo: string | null;
  vesselName: string;
  built: string | null;
  flag: string;
  callsign: string;
  mmsi: string;
  portOfRegistryTownId: string;
  portOfRegistry: string;
  grossTonnage: number | null;
  deadweight: number | null;
  vesselType: string;
  lastUpdated: string;
}

// ── Place Basic Characteristics ──────────────────────────────────────

interface LliPlaceBasicCharsData {
  currentPage: number;
  totalPages: number;
  totalRecords: number;
  items: LliPlaceBasic[];
}

interface LliPlaceBasic {
  placeId: string;
  name: string;
  country: string;
  countryIso: string;
  area: string;
  type: string;
  latitude: number;
  longitude: number;
  admiraltyChart: string;
  unlocode: string;
  principalFacitilies: string[];
  portAuthorityName: string;
  lastUpdated: string;
}

// ── Place Advanced Characteristics (placeadvancedchars_v3) ────────────

interface LliPlaceAdvancedCharsData {
  currentPage: number;
  totalPages: number;
  totalRecords: number;
  items: LliPlaceAdvancedItem[];
}

interface LliPlaceAdvancedItem {
  placeDetails: LliPlaceDetails;
  parentPlaceDetails: LliParentPlaceDetails | null;
  terminals: unknown[];
  berths: unknown[];
  commodity: unknown[];
  mechanicalHandling: unknown[];
  storage: unknown[];
  portCompanies: unknown[];
}

interface LliPlaceDetails {
  placeId: string;
  name: string;
  country: string;
  countryIso: string;
  area: string;
  type: string;
  latitude: number;
  longitude: number;
  admiraltyChart: string;
  unlocode: string;
  principalFacitilies: string[];
  portAuthorityName?: string;
  lastUpdated: string;
}

interface LliParentPlaceDetails {
  parentPlaceId: string;
  parentPlaceName: string;
  parentPlaceType: string;
  parentPlaceCountry: string;
}

// ── Company Details ──────────────────────────────────────────────────

interface LliCompanyDetailsData {
  scrollId: string;
  currentPage: number;
  totalPages: number;
  totalRecords: number;
  items: LliCompanyDetail[];
}

interface LliCompanyDetail {
  companyId: string;
  imo: string;
  companyName: string;
  companyType: string[];
  countryIso: string;
  addresses: LliAddress[];
  communications: LliCommunication[];
  personnel: LliPersonnel[];
  lastUpdated: string;
}

interface LliAddress {
  addressId: number;
  officeId: number;
  address1: string;
  address2: string;
  townCity: string;
  countyState: string;
  postCode1: string;
  postCode2: string;
  countryName: string;
  headOffice: string;
  lastUpdated: string;
}

interface LliCommunication {
  commId: number;
  commType: string;
  commDetail: string;
  areaCode: string;
  idd: string;
  officeId: number;
  typeSequence: number;
}

interface LliPersonnel {
  personId: number;
  firstName: string;
  secondName: string;
  familyName: string;
  position: string;
  officeId: number;
}

// ═══════════════════════════════════════════════════════════════════════
//  VESSEL SEARCH
// ═══════════════════════════════════════════════════════════════════════

export interface VesselSearchResult {
  source: 'local' | 'lloyds';
  localId?: string;
  lliVesselId?: string;
  name: string;
  imo: string | null;
  mmsi: string | null;
  flag: string | null;
  built: string | null;
  grossTonnage: number | null;
  deadweight: number | null;
  vesselType: string | null;
}

/**
 * Search vessels by IMO, name, or MMSI.
 * Checks local DB first, falls back to LLI.
 */
export async function searchVessels(query: {
  imo?: string;
  name?: string;
  mmsi?: string;
}): Promise<VesselSearchResult[]> {
  // ── 1. Local DB search ─────────────────────────────────────────────
  const conditions = [];
  if (query.imo) conditions.push(eq(vessels.imo, query.imo));
  if (query.mmsi) conditions.push(eq(vessels.mmsi, query.mmsi));
  if (query.name) conditions.push(ilike(vessels.name, `%${query.name}%`));

  if (conditions.length > 0) {
    const localResults = await db
      .select()
      .from(vessels)
      .where(conditions.length === 1 ? conditions[0] : or(...conditions))
      .limit(20);

    if (localResults.length > 0) {
      return localResults.map((v) => ({
        source: 'local' as const,
        localId: v.id,
        name: v.name,
        imo: v.imo,
        mmsi: v.mmsi,
        flag: v.flag,
        built: null,
        grossTonnage: null,
        deadweight: null,
        vesselType: null,
      }));
    }
  }

  // ── 2. LLI fallback ───────────────────────────────────────────────
  const params: Record<string, string | undefined> = {};
  if (query.imo) params.vesselImo = query.imo;
  if (query.name) params.vesselName = query.name;
  if (query.mmsi) params.vesselMmsi = query.mmsi;

  const lli = await lliGet<LliResponse<LliVesselBasicCharsData>>(
    'vesselbasiccharacteristics_v2',
    params,
  );

  if (!lli.IsSuccess || !lli.Data?.vessels?.length) {
    return [];
  }

  return lli.Data.vessels.map((v) => ({
    source: 'lloyds' as const,
    lliVesselId: v.vesselId,
    name: v.vesselName,
    imo: v.imo,
    mmsi: v.mmsi,
    flag: v.flag,
    built: v.built,
    grossTonnage: v.grossTonnage,
    deadweight: v.deadweight,
    vesselType: v.vesselType,
  }));
}

// ═══════════════════════════════════════════════════════════════════════
//  PLACE SEARCH  (ports, anchorages, sub-ports, terminals, fields)
// ═══════════════════════════════════════════════════════════════════════

export interface PlaceSearchResult {
  source: 'local' | 'lloyds';
  localId?: string;
  lliPlaceId?: string;
  name: string;
  country: string;
  countryIso?: string;
  area?: string;
  type?: string;
  latitude: number | null;
  longitude: number | null;
  unlocode?: string;
  admiraltyChart?: string;
  principalFacilities?: string[];
  portAuthorityName?: string;
  parentPlaceId?: string;
  parentPlaceName?: string;
}

/**
 * Search places by name, country, or place type.
 * Checks local DB first, falls back to LLI.
 */
export async function searchPlaces(query: {
  name?: string;
  country?: string;
  placeType?: string;
}): Promise<PlaceSearchResult[]> {
  const results: PlaceSearchResult[] = [];

  // ── 1. Local DB search ─────────────────────────────────────────────
  const conditions = [];
  if (query.name) conditions.push(ilike(places.name, `%${query.name}%`));
  if (query.country) conditions.push(ilike(places.country, `%${query.country}%`));

  if (conditions.length > 0) {
    const localResults = await db
      .select()
      .from(places)
      .where(conditions.length === 1 ? conditions[0] : or(...conditions))
      .limit(50);

    for (const p of localResults) {
      results.push({
        source: 'local' as const,
        localId: p.id,
        lliPlaceId: p.lliPlaceId ?? undefined,
        name: p.name,
        country: p.country,
        countryIso: p.countryIso ?? undefined,
        area: p.area ?? undefined,
        type: p.placeType ?? undefined,
        latitude: p.lat,
        longitude: p.long,
        unlocode: p.unlocode ?? undefined,
        admiraltyChart: p.admiraltyChart ?? undefined,
        principalFacilities: (p.principalFacilities as string[]) ?? undefined,
        portAuthorityName: p.portAuthorityName ?? undefined,
        parentPlaceName: p.parentPlaceName ?? undefined,
      });
    }
  }

  // ── 2. LLI search (always, to supplement local results) ───────────
  try {
    const params: Record<string, string | undefined> = {};
    if (query.name) params.placeName = query.name;
    if (query.country) params.country = query.country;
    if (query.placeType) params.placeType = query.placeType;

    const lli = await lliGet<LliResponse<LliPlaceAdvancedCharsData>>(
      'placeadvancedchars_v3',
      params,
    );

    if (lli.IsSuccess && lli.Data?.items?.length) {
      // Collect local LLI IDs to avoid duplicates
      const localLliIds = new Set(results.map((r) => r.lliPlaceId).filter(Boolean));

      for (const item of lli.Data.items) {
        const pd = item.placeDetails;
        const ppd = item.parentPlaceDetails;

        if (localLliIds.has(pd.placeId)) continue; // skip duplicates

        results.push({
          source: 'lloyds' as const,
          lliPlaceId: pd.placeId,
          name: pd.name,
          country: pd.country,
          countryIso: pd.countryIso,
          area: pd.area,
          type: pd.type,
          latitude: pd.latitude,
          longitude: pd.longitude,
          unlocode: pd.unlocode,
          admiraltyChart: pd.admiraltyChart,
          principalFacilities: pd.principalFacitilies,
          portAuthorityName: pd.portAuthorityName,
          parentPlaceName: ppd?.parentPlaceName,
        });
      }
    }
  } catch (err) {
    console.error('[LLI] Place search API call failed:', err);
    // Continue with local results only
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
//  IMPORT PLACE — upsert an LLI place into local DB
// ═══════════════════════════════════════════════════════════════════════

const PLACE_TYPE_MAP: Record<string, 'POR' | 'PSP' | 'ANC' | 'TER' | 'FIL'> = {
  'Port': 'POR',
  'Sub Port': 'PSP',
  'Anchorage': 'ANC',
  'Terminal': 'TER',
  'Hydrocarbon Field': 'FIL',
};

export async function importPlaceFromLli(lliPlaceId: string): Promise<{ id: string; name: string }> {
  // Check if already imported
  const existing = await db
    .select({ id: places.id, name: places.name })
    .from(places)
    .where(eq(places.lliPlaceId, lliPlaceId))
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  // Fetch advanced details from LLI
  const lli = await lliGet<LliResponse<LliPlaceAdvancedCharsData>>(
    'placeadvancedchars_v3',
    { placeId: lliPlaceId },
  );

  if (!lli.IsSuccess || !lli.Data?.items?.length) {
    throw new Error(`LLI place ${lliPlaceId} not found`);
  }

  const item = lli.Data.items[0];
  const pd = item.placeDetails;
  const ppd = item.parentPlaceDetails;

  const mapped = PLACE_TYPE_MAP[pd.type] ?? null;

  const [inserted] = await db
    .insert(places)
    .values({
      lliPlaceId: pd.placeId,
      name: pd.name,
      country: pd.countryIso ?? pd.country,
      countryIso: pd.countryIso,
      area: pd.area,
      placeType: mapped,
      lat: pd.latitude,
      long: pd.longitude,
      unlocode: pd.unlocode,
      admiraltyChart: pd.admiraltyChart,
      principalFacilities: pd.principalFacitilies,
      portAuthorityName: pd.portAuthorityName ?? null,
      parentPlaceName: ppd?.parentPlaceName ?? null,
      lliLastUpdated: pd.lastUpdated ? new Date(pd.lastUpdated) : null,
    })
    .returning({ id: places.id, name: places.name });

  return inserted;
}

// ═══════════════════════════════════════════════════════════════════════
//  LIST ALL LOCAL PLACES
// ═══════════════════════════════════════════════════════════════════════

export async function listPlaces(query?: {
  placeType?: string;
  country?: string;
  search?: string;
  limit?: number;
  page?: number;
}) {
  const conditions = [];
  if (query?.search) conditions.push(ilike(places.name, `%${query.search}%`));
  if (query?.country) conditions.push(ilike(places.country, `%${query.country}%`));
  if (query?.placeType) conditions.push(eq(places.placeType, query.placeType as any));

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
      .from(places)
      .where(where)
      .limit(limit)
      .offset(offset)
      .orderBy(places.name),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(places)
      .where(where),
  ]);

  return { places: rows, total: countResult[0]?.count ?? 0 };
}

// ═══════════════════════════════════════════════════════════════════════
//  COMPANY / CONTACT SEARCH
// ═══════════════════════════════════════════════════════════════════════

export interface CompanySearchResult {
  source: 'local' | 'lloyds';
  localId?: string;
  lliCompanyId?: string;
  name: string;
  imo?: string;
  country?: string;
  companyType?: string[];
  addresses?: LliAddress[];
  communications?: LliCommunication[];
  personnel?: LliPersonnel[];
}

/**
 * Search companies/contacts by name or country.
 * Checks local counterparties DB first, falls back to LLI.
 */
export async function searchCompanies(query: {
  name?: string;
  country?: string;
  imo?: string;
}): Promise<CompanySearchResult[]> {
  // ── 1. Local DB search ─────────────────────────────────────────────
  const conditions = [];
  if (query.name) conditions.push(ilike(counterparties.name, `%${query.name}%`));
  if (query.country) conditions.push(ilike(counterparties.country, `%${query.country}%`));

  if (conditions.length > 0) {
    const localResults = await db
      .select()
      .from(counterparties)
      .where(conditions.length === 1 ? conditions[0] : or(...conditions))
      .limit(20);

    if (localResults.length > 0) {
      return localResults.map((c) => ({
        source: 'local' as const,
        localId: c.id,
        name: c.name,
        country: c.country ?? undefined,
      }));
    }
  }

  // ── 2. LLI fallback ───────────────────────────────────────────────
  const params: Record<string, string | undefined> = {};
  if (query.name) params.companyName = query.name;
  if (query.country) params.companyCountry = query.country;
  if (query.imo) params.companyImo = query.imo;
  // Request office + contact data
  params.dataType = 'office,fleet';

  const lli = await lliGet<LliResponse<LliCompanyDetailsData>>(
    'companydetails_v4',
    params,
  );

  if (!lli.IsSuccess || !lli.Data?.items?.length) {
    return [];
  }

  return lli.Data.items.map((c) => ({
    source: 'lloyds' as const,
    lliCompanyId: c.companyId,
    name: c.companyName,
    imo: c.imo,
    country: c.countryIso,
    companyType: c.companyType,
    addresses: c.addresses,
    communications: c.communications,
    personnel: c.personnel,
  }));
}
