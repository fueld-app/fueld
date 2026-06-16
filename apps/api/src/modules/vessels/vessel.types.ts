// ═══════════════════════════════════════════════════════════════════════
//  Vessel Types — Seasearcher response types + shared interfaces
// ═══════════════════════════════════════════════════════════════════════

export interface SeasearcherVesselSearchResult {
  id: number;
  name: string;
  imo: number;
  mmsi: number | null;
  flag: { code: string; name: string } | null;
  type: string | null;
  status: string | null;
  deadWeightTonnage: number | null;
  grossTonnage: number | null;
  loa: number | null;
  breadthExtreme: number | null;
  buildYear: number | null;
  isSanctioned: boolean;
}

export interface SeasearcherVesselSearchResponse {
  results: SeasearcherVesselSearchResult[];
  allMatchingCount: number;
}

export interface SeasearcherVesselDetailResponse {
  id: number;
  name: string;
  imo: number;
  mmsi: number | null;
  flag: { code: string; name: string } | null;
  type: string;
  status: string;
  lengthOverall: string | null;
  breadthExtreme: string | null;
  breadthMoulded: string | null;
  depth: string | null;
  deadWeightTonnage: number | null;
  grossTonnage: number | null;
  buildYear: number | null;
  builtBy: string | null;
  currentClassName: string | null;
  isSanctioned: boolean;
  latestInformation: {
    draught: number | null;
    position: { lat: number; lon: number } | null;
    trueHeading: number | null;
    aisSpeed: number | null;
    destination: string | null;
  } | null;
  [key: string]: unknown;
}

export interface VesselTypeaheadResult {
  source: 'local' | 'seasearcher';
  localId?: string;
  seasearcherId?: string;
  name: string;
  imo?: string;
  mmsi?: string;
  flag?: string;
  flagCode?: string;
  type?: string;
  status?: string;
  dwt?: number;
  gt?: number;
  buildYear?: number;
  isSanctioned?: boolean;
}

export interface OwnershipEntry {
  type: string;
  typeCode: string;
  companyId: string | null;
  companyName: string;
  from: string;
  to: string | null;
  currentIndicator: boolean;
  country: { code: string | null; name: string | null };
}
