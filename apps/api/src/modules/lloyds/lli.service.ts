// ═══════════════════════════════════════════════════════════════════════
//  Lloyd's List Intelligence — Service
//  Search local DB first; fall back to LLI API if not found.
// ═══════════════════════════════════════════════════════════════════════

import { eq, ilike, or } from 'drizzle-orm';
import { db } from '../../db';
import { vessels, ports, counterparties } from '../../db/schema';
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
//  PORT SEARCH
// ═══════════════════════════════════════════════════════════════════════

export interface PortSearchResult {
  source: 'local' | 'lloyds';
  localId?: string;
  lliPlaceId?: string;
  name: string;
  country: string;
  countryIso?: string;
  type?: string;
  latitude: number | null;
  longitude: number | null;
  unlocode?: string;
}

/**
 * Search ports by name or country.
 * Checks local DB first, falls back to LLI.
 */
export async function searchPorts(query: {
  name?: string;
  country?: string;
}): Promise<PortSearchResult[]> {
  // ── 1. Local DB search ─────────────────────────────────────────────
  const conditions = [];
  if (query.name) conditions.push(ilike(ports.name, `%${query.name}%`));
  if (query.country) conditions.push(ilike(ports.country, `%${query.country}%`));

  if (conditions.length > 0) {
    const localResults = await db
      .select()
      .from(ports)
      .where(conditions.length === 1 ? conditions[0] : or(...conditions))
      .limit(20);

    if (localResults.length > 0) {
      return localResults.map((p) => ({
        source: 'local' as const,
        localId: p.id,
        name: p.name,
        country: p.country,
        latitude: p.lat,
        longitude: p.long,
      }));
    }
  }

  // ── 2. LLI fallback ───────────────────────────────────────────────
  // LLI requires country code (e.g. GBR) when searching by name
  const params: Record<string, string | undefined> = {};
  if (query.name) params.placeName = query.name;
  if (query.country) params.country = query.country;
  // Default to searching ports only
  params.placeType = 'POR';

  const lli = await lliGet<LliResponse<LliPlaceBasicCharsData>>(
    'placebasicchars_v2',
    params,
  );

  if (!lli.IsSuccess || !lli.Data?.items?.length) {
    return [];
  }

  return lli.Data.items.map((p) => ({
    source: 'lloyds' as const,
    lliPlaceId: p.placeId,
    name: p.name,
    country: p.country,
    countryIso: p.countryIso,
    type: p.type,
    latitude: p.latitude,
    longitude: p.longitude,
    unlocode: p.unlocode,
  }));
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
