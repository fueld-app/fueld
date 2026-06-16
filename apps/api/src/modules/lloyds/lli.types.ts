// ═══════════════════════════════════════════════════════════════════════
//  LLI Types — Shared response types for Lloyd's List Intelligence
// ═══════════════════════════════════════════════════════════════════════

export interface LliResponse<T> {
  IsSuccess: boolean;
  Data: T;
  Errors: unknown[];
}

// ── Vessel Basic Characteristics ─────────────────────────────────────

export interface LliVesselBasicCharsData {
  CurrentPage: number;
  TotalPages: number;
  TotalRecords: number;
  vessels: LliVesselBasic[];
}

export interface LliVesselBasic {
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

export interface LliPlaceBasicCharsData {
  currentPage: number;
  totalPages: number;
  totalRecords: number;
  items: LliPlaceBasic[];
}

export interface LliPlaceBasic {
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

// ── Place Advanced Characteristics ───────────────────────────────────

export interface LliPlaceAdvancedCharsData {
  currentPage: number;
  totalPages: number;
  totalRecords: number;
  items: LliPlaceAdvancedItem[];
}

export interface LliPlaceAdvancedItem {
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
  principalFacilities: string[];
}

// ── Seasearcher Place Search ─────────────────────────────────────────

export interface SeasearcherPlaceResponse {
  results: Array<{
    id: string;
    name: string;
    country: { code: string; name: string };
    area: string;
    location?: { lat: number; lng: number };
    type: string;
    typeCode: string;
    unctadLocode?: string;
    admiraltyChart?: string;
    parentPlaceId?: string;
    parentPlaceName?: string;
  }>;
}

export interface SeasearcherPlaceDetailResponse {
  id: string;
  name: string;
  country: { code: string; name: string };
  location?: { lat: number; lng: number };
  type: string;
  typeCode: string;
}

// ── Nearby Vessels ───────────────────────────────────────────────────

export interface NearbyVessel {
  vesselId: string;
  imo: string | null;
  vesselName: string;
  aisClass: string;
  flag: string;
  callsign: string;
  mmsi: string;
  vesselType: string;
  destination: string | null;
  eta: string | null;
  speed: number | null;
  heading: number | null;
  navStatus: string | null;
  lat: number;
  lng: number;
  loa: number | null;
  beam: number | null;
  draught: number | null;
  lastUpdated: string;
}

export interface VesselPositionUpdate {
  vesselId: string;
  imo: string | null;
  vesselName: string;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  navStatus: string | null;
  destination: string | null;
  eta: string | null;
  lastUpdated: string;
}

// ── Port Facilities / Expected Arrivals ──────────────────────────────

export interface ExpectedArrival {
  vesselId: string;
  vesselName: string;
  imo: string | null;
  fromPortId: string | null;
  fromPort: string | null;
  fromCountry: string | null;
  toPortId: string;
  toPort: string;
  toCountry: string;
  arrivalUtc: string | null;
  departureUtc: string | null;
  destination: string | null;
  lastPort: string | null;
  speed: number | null;
  heading: number | null;
  loa: number | null;
  draught: number | null;
}

// ── Port Facilities ──────────────────────────────────────────────────

export interface PortFacility {
  name: string;
  type: string;
  maxLoa: number | null;
  maxDraught: number | null;
  maxDwt: number | null;
  cargoTypes: string[];
  // Trade data (volumes)
  totalVolume: number | null;
  liquidBulkVolume: number | null;
  dryBulkVolume: number | null;
  containerVolume: number | null;
  generalCargoVolume: number | null;
  unitCount: number | null;
  liquidBulkUnitCount: number | null;
  dryBulkUnitCount: number | null;
  breakBulkUnitCount: number | null;
  containerUnitCount: number | null;
  unitType: string | null;
  year: string | null;
  lastUpdated: string | null;
}

// ── Hierarchy ────────────────────────────────────────────────────────

export interface HierarchyNode {
  level: number;
  placeId: string;
  name: string;
  type: string;
  unlocode?: string;
  children: HierarchyNode[];
  parentPlaceId?: string;
}

export interface ChildPlace {
  id: string;
  name: string;
  placeType: string;
  unlocode: string | null;
}

// ── Place Enrichment ─────────────────────────────────────────────────

export interface PlaceEnrichment {
  hierarchy: HierarchyNode | null;
  children: ChildPlace[];
  nearbyVessels: NearbyVessel[];
  portFacilities: PortFacility[];
  expectedArrivals: ExpectedArrival[];
}

// ── Vessel Search Result ─────────────────────────────────────────────

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

// ── Place Search Result ──────────────────────────────────────────────

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

// ── Company Search Result ────────────────────────────────────────────

export interface CompanySearchResult {
  source: 'local' | 'seasearcher';
  localId?: string;
  seasearcherId?: string;
  name: string;
  country?: string | null;
}
