// ═══════════════════════════════════════════════════════════════════════
//  LLI Vessel Service — vessel search, nearby vessels, positions
// ═══════════════════════════════════════════════════════════════════════

import { eq, ilike, or } from 'drizzle-orm';
import { db } from '../../db';
import { vessels } from '../../db/schema';
import { lliGet, seasearcherNearbyVessels, seasearcherNearbyVesselsSpatial } from './lli.client';
import type {
  LliResponse,
  LliVesselBasicCharsData,
  VesselSearchResult,
  NearbyVessel,
  VesselPositionUpdate,
} from './lli.types';

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
  const conditions: any[] = [];
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

/**
 * Get nearby vessels for a given place from Seasearcher.
 * Falls back to LLI's nearby vessels API if not found.
 */
export async function getNearbyVessels(seasearcherId: string): Promise<NearbyVessel[]> {
  try {
    const ss = await seasearcherNearbyVessels<{ results: NearbyVessel[] }>(seasearcherId);
    if (ss.results?.length) {
      return ss.results;
    }
  } catch {
    // Fall through to LLI
  }

  // Secondary LLI-based lookup: use LLI place ID (stored as seasearcherId)
  try {
    const lli = await lliGet<LliResponse<{ currentPage: number; items: NearbyVessel[] }>>(
      `vesselnearbyposition/${seasearcherId}`,
      {},
    );
    if (lli.IsSuccess && lli.Data?.items?.length) {
      return lli.Data.items;
    }
  } catch {
    // Nearby vessels are optional
  }

  return [];
}

/**
 * Get nearby vessel positions (live AIS updates) for a given place.
 */
export async function getNearbyVesselPositions(
  seasearcherId: string,
): Promise<VesselPositionUpdate[]> {
  try {
    const data = await seasearcherNearbyVesselsSpatial<{
      list: VesselPositionUpdate[];
    }>(seasearcherId);
    if (data.list?.length) {
      return data.list;
    }
  } catch {
    // Positions are optional
  }

  return [];
}
