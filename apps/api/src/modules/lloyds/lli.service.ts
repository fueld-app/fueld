// ═══════════════════════════════════════════════════════════════════════
//  Lloyd's List Intelligence — Service
//  Search local DB first; fall back to LLI API if not found.
// ═══════════════════════════════════════════════════════════════════════

import { eq, ilike, or, and, sql, asc, desc } from 'drizzle-orm';
import { db } from '../../db';
import { vessels, places, counterparties, orders, portSuppliers, users, companyContacts } from '../../db/schema';
import { lliGet, seasearcherPlaceSearch, seasearcherPlaceDetail, seasearcherNearbyVessels, seasearcherNearbyVesselsSpatial, seasearcherPortFacilities, seasearcherExpectedArrivals } from './lli.client';
import { resolveIanaTimezone } from '../../utils/timezone';

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

// ── Seasearcher Place Response ───────────────────────────────────────

interface SeasearcherPlaceResponse {
  results: SeasearcherPlace[];
  totalMatches: number;
}

interface SeasearcherPlace {
  id: string;
  name: string;
  country: { code: string; name: string };
  area: string;
  subRegion: string;
  type: string;
  typeCode: string;
  unctadLocode: string;
  admiraltyChart: string;
  timezone: string;
  location: { lat: number; lng: number };
  parentPlaceId: string | null;
  parentPlaceName: string | null;
  editDate: string | null;
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
  parentPlaceUnlocode?: string;
  admiraltyChart?: string;
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
  if (query.name) {
    const term = query.name.trim();
    // Match against name OR unlocode (spaced form like "IN MUN" and compact form like "INMUN")
    conditions.push(
      or(
        ilike(places.name, `%${term}%`),
        ilike(places.unlocode, `%${term}%`),
        sql`lower(replace(${places.unlocode}, ' ', '')) LIKE lower(${'%' + term.replace(/\s+/g, '') + '%'})`,
        sql`lower((SELECT replace(p2.unlocode, ' ', '') FROM places p2 WHERE p2.id = ${places.parentPlaceId})) LIKE lower(${'%' + term.replace(/\s+/g, '') + '%'})`,
      )!,
    );
  }
  if (query.country) conditions.push(ilike(places.country, `%${query.country}%`));

  if (conditions.length > 0) {
    const localResults = await db
      .select({
        id: places.id,
        lliPlaceId: places.lliPlaceId,
        name: places.name,
        country: places.country,
        countryIso: places.countryIso,
        area: places.area,
        placeType: places.placeType,
        lat: places.lat,
        long: places.long,
        unlocode: places.unlocode,
        admiraltyChart: places.admiraltyChart,
        parentPlaceId: places.parentPlaceId,
        parentPlaceName: places.parentPlaceName,
        parentPlaceUnlocode: sql<string | null>`(SELECT p2.unlocode FROM places p2 WHERE p2.id = ${places.parentPlaceId})`.as('parent_place_unlocode'),
      })
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
        parentPlaceUnlocode: p.parentPlaceUnlocode ?? undefined,
        parentPlaceId: p.parentPlaceId ?? undefined,
        admiraltyChart: p.admiraltyChart ?? undefined,
        parentPlaceName: p.parentPlaceName ?? undefined,
      });
    }
  }

  // ── 2. Seasearcher search (always, to supplement local results) ────
  try {
    if (query.name) {
      const ss = await seasearcherPlaceSearch<SeasearcherPlaceResponse>(query.name, 50);

      if (ss.results?.length) {
        // Collect local LLI IDs to avoid duplicates
        const localLliIds = new Set(results.map((r) => r.lliPlaceId).filter(Boolean));

        for (const p of ss.results) {
          if (localLliIds.has(p.id)) continue; // skip duplicates

          // Filter by placeType if requested
          if (query.placeType && p.typeCode !== query.placeType) continue;

          results.push({
            source: 'lloyds' as const,
            lliPlaceId: p.id,
            name: p.name,
            country: p.country.name,
            countryIso: p.country.code,
            area: p.area,
            type: p.typeCode,
            latitude: p.location?.lat ?? null,
            longitude: p.location?.lng ?? null,
            unlocode: p.unctadLocode || undefined,
            admiraltyChart: p.admiraltyChart || undefined,
            parentPlaceId: p.parentPlaceId ?? undefined,
            parentPlaceName: p.parentPlaceName ?? undefined,
          });
        }
      }
    }
  } catch (err) {
    console.error('[Seasearcher] Place search failed:', err);
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

  // Fetch details from Seasearcher
  const pd = await seasearcherPlaceDetail<SeasearcherPlace>(
    lliPlaceId,
  );

  if (!pd || !pd.id) {
    throw new Error(`Seasearcher place ${lliPlaceId} not found`);
  }

  const mapped = PLACE_TYPE_MAP[pd.type] ?? (pd.typeCode as any) ?? null;

  // Resolve IANA timezone from coordinates, falling back to LLI timezone string
  const ianaTimezone = resolveIanaTimezone(
    pd.location?.lat ?? null,
    pd.location?.lng ?? null,
    pd.timezone || null,
  );

  const [inserted] = await db
    .insert(places)
    .values({
      lliPlaceId: pd.id,
      name: pd.name,
      country: pd.country?.code ?? pd.country?.name ?? '',
      countryIso: pd.country?.code ?? null,
      area: pd.area || null,
      subRegion: pd.subRegion || null,
      placeType: mapped,
      timezone: ianaTimezone,
      timezoneLegacy: pd.timezone || null,
      lat: pd.location?.lat ?? null,
      long: pd.location?.lng ?? null,
      unlocode: pd.unctadLocode || null,
      admiraltyChart: pd.admiraltyChart || null,
      parentPlaceName: pd.parentPlaceName ?? null,
      lliLastUpdated: pd.editDate ? new Date(pd.editDate) : null,
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
  responsibleUserId?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  page?: number;
}) {
  const conditions = [];
  if (query?.search) {
    const term = query.search.trim();
    // Match against name OR unlocode (spaced form like "IN MUN" and compact form like "INMUN")
    conditions.push(
      or(
        ilike(places.name, `%${term}%`),
        ilike(places.unlocode, `%${term}%`),
        sql`lower(replace(${places.unlocode}, ' ', '')) LIKE lower(${'%' + term.replace(/\s+/g, '') + '%'})`,
        sql`lower((SELECT replace(p2.unlocode, ' ', '') FROM places p2 WHERE p2.id = ${places.parentPlaceId})) LIKE lower(${'%' + term.replace(/\s+/g, '') + '%'})`,
      )!,
    );
  }
  if (query?.country) conditions.push(ilike(places.country, `%${query.country}%`));
  if (query?.placeType) conditions.push(eq(places.placeType, query.placeType as any));
  if (query?.responsibleUserId) conditions.push(eq(places.responsibleUserId, query.responsibleUserId));

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
    name: places.name,
    country: places.country,
    placeType: places.placeType,
    unlocode: places.unlocode,
    area: places.area,
    createdAt: places.createdAt,
  };
  const sortCol = sortMap[query?.sortBy ?? ''] ?? places.name;
  const sortFn = query?.sortDir === 'desc' ? desc : asc;

  // Alias for responsible user to avoid conflict with other user joins
  const responsibleUser = users;

  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: places.id,
        lliPlaceId: places.lliPlaceId,
        unlocode: places.unlocode,
        name: places.name,
        country: places.country,
        countryIso: places.countryIso,
        area: places.area,
        subRegion: places.subRegion,
        placeType: places.placeType,
        timezone: places.timezone,
        lat: places.lat,
        long: places.long,
        admiraltyChart: places.admiraltyChart,
        parentPlaceId: places.parentPlaceId,
        parentPlaceName: places.parentPlaceName,
        parentPlaceUnlocode: sql<string | null>`(SELECT p2.unlocode FROM places p2 WHERE p2.id = ${places.parentPlaceId})`.as('parent_place_unlocode'),
        responsibleUserId: places.responsibleUserId,
        responsibleUserName: responsibleUser.name,
        lliLastUpdated: places.lliLastUpdated,
        createdAt: places.createdAt,
        updatedAt: places.updatedAt,
        orderCount: sql<number>`count(${orders.id})::int`.as('order_count'),
        activeOrderCount: sql<number>`count(case when ${orders.status} in ('INQUIRY','OFFER','CONFIRMED') then 1 end)::int`.as('active_order_count'),
      })
      .from(places)
      .leftJoin(orders, eq(orders.placeId, places.id))
      .leftJoin(responsibleUser, eq(places.responsibleUserId, responsibleUser.id))
      .where(where)
      .groupBy(places.id, responsibleUser.name)
      .limit(limit)
      .offset(offset)
      .orderBy(sortFn(sortCol)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(places)
      .where(where),
  ]);

  return { places: rows, total: countResult[0]?.count ?? 0 };
}

// ═══════════════════════════════════════════════════════════════════════
//  GET SINGLE LOCAL PLACE BY ID
// ═══════════════════════════════════════════════════════════════════════

export async function getPlaceById(id: string) {
  const rows = await db
    .select({
      place: places,
      responsibleUserName: users.name,
    })
    .from(places)
    .leftJoin(users, eq(places.responsibleUserId, users.id))
    .where(eq(places.id, id))
    .limit(1);

  if (!rows[0]) return null;
  const { place, responsibleUserName } = rows[0];
  return { ...place, responsibleUserName: responsibleUserName ?? null };
}

export async function getPlaceByLliId(lliPlaceId: string) {
  const rows = await db
    .select()
    .from(places)
    .where(eq(places.lliPlaceId, lliPlaceId))
    .limit(1);

  return rows[0] ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  GET SEASEARCHER ENRICHMENT (geoJson, hierarchy, parent)
// ═══════════════════════════════════════════════════════════════════════

export interface HierarchyNode {
  id: string;
  name: string;
  type: string;
  category: string;
  children: HierarchyNode[];
}

export interface ChildPlace {
  id: string;
  name: string;
  type: string;
  typeCode: string;
  category: string;
  lat: number | null;
  lng: number | null;
  geoJsonObject: unknown | null;
  childrenData: { type: string; count: number }[];
}

export interface PlaceEnrichment {
  geoJsonObject: unknown | null;
  hierarchy: HierarchyNode[];
  parentPlaceId: string | null;
  parentPlaceName: string | null;
  childrenData: { type: string; count: number }[];
  children: ChildPlace[];
}

export async function getPlaceEnrichment(seasearcherId: string): Promise<PlaceEnrichment> {
  const detail = await seasearcherPlaceDetail<Record<string, unknown>>(seasearcherId);

  const rawChildren = (detail.children as any[]) ?? [];
  const children: ChildPlace[] = rawChildren.map((c: any) => ({
    id: String(c.id ?? ''),
    name: String(c.name ?? ''),
    type: c.type ? String(c.type) : '',
    typeCode: c.typeCode ? String(c.typeCode) : '',
    category: c.category ? String(c.category) : '',
    lat: c.location?.lat != null ? Number(c.location.lat) : null,
    lng: c.location?.lng != null ? Number(c.location.lng) : null,
    geoJsonObject: c.geoJsonObject ?? null,
    childrenData: (c.childrenData as { type: string; count: number }[]) ?? [],
  }));

  return {
    geoJsonObject: (detail.geoJsonObject as unknown) ?? null,
    hierarchy: (detail.hierarchy as HierarchyNode[]) ?? [],
    parentPlaceId: (detail.parentPlaceId as string) ?? null,
    parentPlaceName: (detail.parentPlaceName as string) ?? null,
    childrenData: (detail.childrenData as { type: string; count: number }[]) ?? [],
    children,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  NEARBY VESSELS (Seasearcher nearPort)
// ═══════════════════════════════════════════════════════════════════════

export interface NearbyVessel {
  id: string;
  name: string;
  imo: string | null;
  mmsi: string | null;
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  lengthOverall: number | null;
  breadth: number | null;
  draught: number | null;
  dwt: number | null;
  grossTonnage: number | null;
  buildYear: number | null;
  vesselType: string | null;
  flag: string | null;
  flagCode: string | null;
  distance: number | null;
  status: string | null;
}

export async function getNearbyVessels(seasearcherId: string): Promise<NearbyVessel[]> {
  const data = await seasearcherNearbyVessels<{
    totalMatches: number;
    results?: Record<string, unknown>[];
  }>(seasearcherId);

  const vessels: Record<string, unknown>[] = data?.results ?? [];
  if (!vessels.length) return [];

  return vessels.map((v: any) => {
    const info = v.latestInformation ?? {};
    const pos = info.position ?? {};

    return {
      id: String(v.id ?? ''),
      name: String(v.name ?? ''),
      imo: v.imo ? String(v.imo) : null,
      mmsi: v.mmsi ? String(v.mmsi) : null,
      lat: Number(pos.lat ?? 0),
      lng: Number(pos.lng ?? 0),
      heading: info.trueHeading != null ? Number(info.trueHeading) : null,
      speed: info.aisSpeed != null ? Number(info.aisSpeed) : null,
      lengthOverall: v.lengthOverall != null ? Number(v.lengthOverall) : (info.length != null ? Number(info.length) : null),
      breadth: v.breadthExtreme != null ? Number(v.breadthExtreme) : (info.width != null ? Number(info.width) : null),
      draught: info.draught != null ? Number(info.draught) : (v.draught != null ? Number(v.draught) : null),
      dwt: v.deadWeightTonnage != null ? Number(v.deadWeightTonnage) : (v.derivedDwt?.value != null ? Number(v.derivedDwt.value) : null),
      grossTonnage: v.grossTonnage != null ? Number(v.grossTonnage) : (v.derivedGt?.value != null ? Number(v.derivedGt.value) : null),
      buildYear: v.buildYear != null ? Number(v.buildYear) : null,
      vesselType: v.type ? String(v.type) : null,
      flag: v.flag?.name ? String(v.flag.name) : null,
      flagCode: v.flag?.code ? String(v.flag.code) : null,
      distance: v.distance != null ? Number(v.distance) : null,
      status: info.status ? String(info.status) : null,
    };
  });
}

/**
 * Lightweight position-only fetch from spatial query.
 * Returns id + position/heading/speed/distance for merging with full vessel data.
 */
export interface VesselPositionUpdate {
  id: string;
  lat: number;
  lng: number;
  heading: number | null;
}

export async function getNearbyVesselPositions(seasearcherId: string): Promise<VesselPositionUpdate[]> {
  const data = await seasearcherNearbyVesselsSpatial<{
    totalMatches: number;
    clusters?: { relevantDocumentDetails: Record<string, unknown>[] }[];
    nonClusteredRecords?: Record<string, unknown>[];
  }>(seasearcherId);

  const vessels: Record<string, unknown>[] = [];
  if (data?.nonClusteredRecords?.length) {
    vessels.push(...data.nonClusteredRecords);
  }
  if (data?.clusters?.length) {
    for (const c of data.clusters) {
      if (c.relevantDocumentDetails?.length) vessels.push(...c.relevantDocumentDetails);
    }
  }
  if (!vessels.length) return [];

  return vessels.map((v: any) => {
    const info = v.latestInformation ?? {};
    const pos = info.position ?? {};

    const update: VesselPositionUpdate = {
      id: String(v.id ?? ''),
      lat: Number(pos.lat ?? 0),
      lng: Number(pos.lng ?? 0),
      heading: null,
    };
    if (info.trueHeading != null) update.heading = Number(info.trueHeading);
    else delete (update as any).heading;
    return update;
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  CREATE LOCAL PLACE (manual entry)
// ═══════════════════════════════════════════════════════════════════════

export async function createPlace(data: {
  name: string;
  country: string;
  countryIso?: string;
  area?: string;
  subRegion?: string;
  placeType?: 'POR' | 'PSP' | 'ANC' | 'TER' | 'FIL';
  timezone?: string;
  lat?: number;
  long?: number;
  unlocode?: string;
  admiraltyChart?: string;
  parentPlaceId?: string;
  parentPlaceName?: string;
}) {
  // Resolve IANA timezone from coordinates if not provided or not valid IANA
  const ianaTimezone = resolveIanaTimezone(
    data.lat ?? null,
    data.long ?? null,
    data.timezone ?? null,
  );

  const [created] = await db
    .insert(places)
    .values({
      name: data.name,
      country: data.country,
      countryIso: data.countryIso ?? null,
      area: data.area ?? null,
      subRegion: data.subRegion ?? null,
      placeType: data.placeType ?? null,
      timezone: ianaTimezone,
      lat: data.lat ?? null,
      long: data.long ?? null,
      unlocode: data.unlocode ?? null,
      admiraltyChart: data.admiraltyChart ?? null,
      parentPlaceId: data.parentPlaceId ?? null,
      parentPlaceName: data.parentPlaceName ?? null,
    })
    .returning();

  return created;
}

// ═══════════════════════════════════════════════════════════════════════
//  UPDATE LOCAL PLACE (manual entry)
// ═══════════════════════════════════════════════════════════════════════

export async function updateLocalPlace(
  id: string,
  data: {
    name?: string;
    country?: string;
    countryIso?: string | null;
    area?: string | null;
    subRegion?: string | null;
    placeType?: 'POR' | 'PSP' | 'ANC' | 'TER' | 'FIL' | null;
    timezone?: string | null;
    lat?: number | null;
    long?: number | null;
    unlocode?: string | null;
    admiraltyChart?: string | null;
    parentPlaceId?: string | null;
    parentPlaceName?: string | null;
    orderRemark?: string | null;
  },
) {
  const patch: Partial<typeof places.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (data.name !== undefined) patch.name = data.name;
  if (data.country !== undefined) patch.country = data.country;
  if (data.countryIso !== undefined) patch.countryIso = data.countryIso;
  if (data.area !== undefined) patch.area = data.area;
  if (data.subRegion !== undefined) patch.subRegion = data.subRegion;
  if (data.placeType !== undefined) patch.placeType = data.placeType;
  if (data.lat !== undefined) patch.lat = data.lat;
  if (data.long !== undefined) patch.long = data.long;
  if (data.unlocode !== undefined) patch.unlocode = data.unlocode;
  if (data.admiraltyChart !== undefined) patch.admiraltyChart = data.admiraltyChart;
  if (data.parentPlaceId !== undefined) patch.parentPlaceId = data.parentPlaceId;
  if (data.parentPlaceName !== undefined) patch.parentPlaceName = data.parentPlaceName;
  if (data.orderRemark !== undefined) patch.orderRemark = data.orderRemark;

  // If timezone is explicitly set, use it directly (user has entered a valid IANA tz)
  // If lat/long changed but timezone wasn't explicitly set, try to resolve from new coords
  if (data.timezone !== undefined) {
    patch.timezone = data.timezone;
  } else if (data.lat !== undefined || data.long !== undefined) {
    // Get existing place to fill in missing coord
    const existing = await db.select({ lat: places.lat, long: places.long, timezone: places.timezone })
      .from(places).where(eq(places.id, id)).limit(1);
    if (existing.length > 0) {
      const newLat = data.lat ?? existing[0].lat;
      const newLong = data.long ?? existing[0].long;
      const resolved = resolveIanaTimezone(newLat, newLong, existing[0].timezone);
      if (resolved) patch.timezone = resolved;
    }
  }

  const [updated] = await db
    .update(places)
    .set(patch)
    .where(eq(places.id, id))
    .returning();

  return updated ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  UPDATE PLACE DEFAULT ORDER REMARK (applies to all orders in the place)
// ═══════════════════════════════════════════════════════════════════════

export async function updatePlaceOrderRemark(id: string, orderRemark: string | null) {
  const trimmed = orderRemark?.trim() ?? '';
  const value = trimmed ? trimmed : null;

  const [updated] = await db
    .update(places)
    .set({
      orderRemark: value,
      updatedAt: new Date(),
    })
    .where(eq(places.id, id))
    .returning();

  return updated ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  DELETE LOCAL PLACE
// ═══════════════════════════════════════════════════════════════════════

export async function deletePlace(id: string): Promise<boolean> {
  const result = await db
    .delete(places)
    .where(eq(places.id, id))
    .returning({ id: places.id });

  return result.length > 0;
}

// ═══════════════════════════════════════════════════════════════════════
//  SYNC PLACE FROM SEASEARCHER (update local record with latest data)
// ═══════════════════════════════════════════════════════════════════════

export async function syncPlaceFromSeasearcher(placeId: string): Promise<typeof places.$inferSelect | null> {
  // Get the local place record
  const local = await getPlaceById(placeId);
  if (!local || !local.lliPlaceId) return null;

  // Fetch latest from Seasearcher
  const pd = await seasearcherPlaceDetail<SeasearcherPlace>(local.lliPlaceId);
  if (!pd || !pd.id) return null;

  const mapped = PLACE_TYPE_MAP[pd.type] ?? (pd.typeCode as any) ?? null;

  // Resolve IANA timezone from updated coordinates
  const syncLat = pd.location?.lat ?? local.lat;
  const syncLng = pd.location?.lng ?? local.long;
  const ianaTimezone = resolveIanaTimezone(syncLat, syncLng, local.timezone);

  const [updated] = await db
    .update(places)
    .set({
      name: pd.name,
      country: pd.country?.code ?? pd.country?.name ?? local.country,
      countryIso: pd.country?.code ?? local.countryIso,
      area: pd.area || local.area,
      subRegion: pd.subRegion || local.subRegion,
      placeType: mapped ?? local.placeType,
      timezone: ianaTimezone ?? local.timezone,
      timezoneLegacy: pd.timezone || local.timezoneLegacy,
      lat: syncLat,
      long: syncLng,
      unlocode: pd.unctadLocode || local.unlocode,
      admiraltyChart: pd.admiraltyChart || local.admiraltyChart,
      parentPlaceName: pd.parentPlaceName ?? local.parentPlaceName,
      lliLastUpdated: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(places.id, placeId))
    .returning();

  return updated ?? null;
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

// ═══════════════════════════════════════════════════════════════════════
//  ORDERS FOR A PLACE
// ═══════════════════════════════════════════════════════════════════════

export async function getOrdersForPlace(placeId: string) {
  const rows = await db
    .select({
      id: orders.id,
      status: orders.status,
      eta: orders.eta,
      etd: orders.etd,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      clientName: counterparties.name,
      vesselName: vessels.name,
      vesselImo: vessels.imo,
      salesRepId: orders.salesRepId,
    })
    .from(orders)
    .innerJoin(counterparties, eq(orders.clientId, counterparties.id))
    .innerJoin(vessels, eq(orders.vesselId, vessels.id))
    .where(eq(orders.placeId, placeId))
    .orderBy(sql`${orders.createdAt} desc`);

  return rows;
}

// ═══════════════════════════════════════════════════════════════════════
//  PORT FACILITIES (from Seasearcher)
// ═══════════════════════════════════════════════════════════════════════

const FACILITY_TYPE_LABELS: Record<number, string> = {
  1: 'Port Authority',
  2: 'Overview',
  3: 'Security',
  4: 'Regulations',
  5: 'Documentation',
  6: 'Approach',
  7: 'Anchorage',
  8: 'Pilotage',
  9: 'Radio',
  10: 'Pratique',
  11: 'Quarantine',
  12: 'Customs',
  13: 'Maximum Size',
  14: 'Berths',
  15: 'Cranes',
  16: 'Storage',
  17: 'Passenger Facilities',
  18: 'Cargo Handling',
  19: 'Bunkering',
  20: 'Fresh Water',
  21: 'Towage',
  22: 'Repairs & Maintenance',
  23: 'Ship Chandlers',
  24: 'Shipping Agents',
  25: 'Stevedoring',
  26: 'Surveyors',
  27: 'Medical',
  28: 'Airport',
  29: 'Railway',
  30: 'Developments',
  31: "Lloyd's Agents",
  32: 'Waste Reception',
};

interface SeasearcherFacility {
  id: string;
  type: number;
  text: string;
  editDate: string;
}

interface SeasearcherCompanyFacility {
  type: number;
  companies: {
    id: string;
    sectorName: string;
    companyName: string;
    addressLine1: string;
    addressLine2: string;
    town: string;
    countyState: string;
    postCode1: string;
    postCode2: string;
    country: string;
    telephone: string;
    fax: string;
    emailAddress: string;
    webAddress: string;
  }[];
}

interface SeasearcherPortFacilitiesResponse {
  portFacilities: SeasearcherFacility[];
  portCompanyFacilities: SeasearcherCompanyFacility[];
}

export async function getPortFacilities(seasearcherId: string) {
  const data = await seasearcherPortFacilities<SeasearcherPortFacilitiesResponse>(seasearcherId);

  const facilities = (data.portFacilities ?? []).map((f) => ({
    id: f.id,
    type: f.type,
    label: FACILITY_TYPE_LABELS[f.type] ?? `Type ${f.type}`,
    text: f.text,
    editDate: f.editDate,
  }));

  const companies = (data.portCompanyFacilities ?? []).map((c) => ({
    type: c.type,
    label: FACILITY_TYPE_LABELS[c.type] ?? c.companies[0]?.sectorName ?? `Type ${c.type}`,
    companies: c.companies.map((co) => ({
      id: co.id,
      name: co.companyName,
      sector: co.sectorName,
      address: [co.addressLine1, co.addressLine2].filter(Boolean).join(', '),
      town: co.town,
      country: co.country,
      telephone: co.telephone?.trim() || null,
      fax: co.fax?.trim() || null,
      email: co.emailAddress || null,
      website: co.webAddress || null,
    })),
  }));

  return { facilities, companies };
}

// ═══════════════════════════════════════════════════════════════════════
//  EXPECTED ARRIVALS (Seasearcher)
// ═══════════════════════════════════════════════════════════════════════

export interface ExpectedArrival {
  id: string;
  name: string;
  imo: string | null;
  mmsi: string | null;
  flag: string | null;
  flagCode: string | null;
  vesselType: string | null;
  dwt: number | null;
  grossTonnage: number | null;
  eta: string | null;
  commercialOperator: string | null;
  lastPort: string | null;
  destination: string | null;
}

export async function getExpectedArrivals(seasearcherId: string, daysAhead = 7): Promise<ExpectedArrival[]> {
  const data = await seasearcherExpectedArrivals<{ results: Record<string, unknown>[]; totalMatches: number }>(
    seasearcherId,
    daysAhead,
  );

  if (!data?.results?.length) return [];

  return data.results.map((v: any) => ({
    id: String(v.id ?? ''),
    name: String(v.name ?? ''),
    imo: v.imo ? String(v.imo) : null,
    mmsi: v.mmsi ? String(v.mmsi) : null,
    flag: v.flag?.name ? String(v.flag.name) : null,
    flagCode: v.flag?.code ? String(v.flag.code) : null,
    vesselType: v.type ? String(v.type) : null,
    dwt: v.deadWeightTonnage != null ? Number(v.deadWeightTonnage) : null,
    grossTonnage: v.grossTonnage != null ? Number(v.grossTonnage) : null,
    eta: v.eta ?? null,
    commercialOperator: v.commercialOperator?.name ? String(v.commercialOperator.name) : null,
    lastPort: v.lastPort?.name ? String(v.lastPort.name) : null,
    destination: v.destination?.name ? String(v.destination.name) : null,
  }));
}

// ═══════════════════════════════════════════════════════════════════════
//  PORT SUPPLIERS (CRUD) — linked to counterparties (companies)
// ═══════════════════════════════════════════════════════════════════════

export async function getPortSuppliers(placeId: string) {
  return db
    .select({
      id: portSuppliers.id,
      placeId: portSuppliers.placeId,
      companyId: portSuppliers.companyId,
      companyName: counterparties.name,
      contactId: portSuppliers.contactId,
      contactName: companyContacts.name,
      products: portSuppliers.products,
      note: portSuppliers.note,
      addedById: portSuppliers.addedById,
      addedByName: portSuppliers.addedByName,
      createdAt: portSuppliers.createdAt,
      updatedAt: portSuppliers.updatedAt,
    })
    .from(portSuppliers)
    .innerJoin(counterparties, eq(portSuppliers.companyId, counterparties.id))
    .leftJoin(companyContacts, eq(portSuppliers.contactId, companyContacts.id))
    .where(eq(portSuppliers.placeId, placeId))
    .orderBy(counterparties.name);
}

export async function addPortSupplier(placeId: string, data: { companyId: string; contactId?: string | null; products?: string[]; note?: string }, userId: string, userName: string) {
  const [created] = await db
    .insert(portSuppliers)
    .values({
      placeId,
      companyId: data.companyId,
      contactId: data.contactId ?? null,
      products: data.products ?? [],
      note: data.note ?? null,
      addedById: userId,
      addedByName: userName,
    })
    .returning();
  // Re-fetch with company name + contact name
  const [full] = await db
    .select({
      id: portSuppliers.id,
      placeId: portSuppliers.placeId,
      companyId: portSuppliers.companyId,
      companyName: counterparties.name,
      contactId: portSuppliers.contactId,
      contactName: companyContacts.name,
      products: portSuppliers.products,
      note: portSuppliers.note,
      addedById: portSuppliers.addedById,
      addedByName: portSuppliers.addedByName,
      createdAt: portSuppliers.createdAt,
      updatedAt: portSuppliers.updatedAt,
    })
    .from(portSuppliers)
    .innerJoin(counterparties, eq(portSuppliers.companyId, counterparties.id))
    .leftJoin(companyContacts, eq(portSuppliers.contactId, companyContacts.id))
    .where(eq(portSuppliers.id, created.id));
  return full;
}

export async function updatePortSupplier(id: string, data: { contactId?: string | null; products?: string[]; note?: string }) {
  const [updated] = await db
    .update(portSuppliers)
    .set({
      ...(data.contactId !== undefined && { contactId: data.contactId }),
      ...(data.products !== undefined && { products: data.products }),
      ...(data.note !== undefined && { note: data.note }),
      updatedAt: new Date(),
    })
    .where(eq(portSuppliers.id, id))
    .returning();
  if (!updated) return null;
  // Re-fetch with company + contact name
  const [full] = await db
    .select({
      id: portSuppliers.id,
      placeId: portSuppliers.placeId,
      companyId: portSuppliers.companyId,
      companyName: counterparties.name,
      contactId: portSuppliers.contactId,
      contactName: companyContacts.name,
      products: portSuppliers.products,
      note: portSuppliers.note,
      addedById: portSuppliers.addedById,
      addedByName: portSuppliers.addedByName,
      createdAt: portSuppliers.createdAt,
      updatedAt: portSuppliers.updatedAt,
    })
    .from(portSuppliers)
    .innerJoin(counterparties, eq(portSuppliers.companyId, counterparties.id))
    .leftJoin(companyContacts, eq(portSuppliers.contactId, companyContacts.id))
    .where(eq(portSuppliers.id, updated.id));
  return full ?? null;
}

export async function deletePortSupplier(id: string) {
  // Fetch company name before deletion
  const [info] = await db
    .select({
      id: portSuppliers.id,
      placeId: portSuppliers.placeId,
      companyId: portSuppliers.companyId,
      companyName: counterparties.name,
      products: portSuppliers.products,
    })
    .from(portSuppliers)
    .innerJoin(counterparties, eq(portSuppliers.companyId, counterparties.id))
    .where(eq(portSuppliers.id, id));
  if (!info) return null;
  await db.delete(portSuppliers).where(eq(portSuppliers.id, id));
  return info;
}

export async function getSupplyPortsForCompany(companyId: string) {
  return db
    .select({
      id: portSuppliers.id,
      placeId: portSuppliers.placeId,
      placeName: places.name,
      placeCode: places.unlocode,
      placeCountry: places.country,
      products: portSuppliers.products,
      note: portSuppliers.note,
      createdAt: portSuppliers.createdAt,
    })
    .from(portSuppliers)
    .innerJoin(places, eq(portSuppliers.placeId, places.id))
    .where(eq(portSuppliers.companyId, companyId))
    .orderBy(places.name);
}

// ═══════════════════════════════════════════════════════════════════════
//  RESPONSIBLE USER
// ═══════════════════════════════════════════════════════════════════════

export async function updateResponsibleUser(placeId: string, userId: string | null) {
  const [updated] = await db
    .update(places)
    .set({ responsibleUserId: userId, updatedAt: new Date() })
    .where(eq(places.id, placeId))
    .returning();
  return updated ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  TEAM USERS (light list for dropdowns)
// ═══════════════════════════════════════════════════════════════════════

export async function listActiveUsers() {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(users.name);
}