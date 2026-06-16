// ═══════════════════════════════════════════════════════════════════════
//  Vessel Seasearcher Service — import, sync, merge, lookup, enrichment
// ═══════════════════════════════════════════════════════════════════════

import { eq, or, ilike } from 'drizzle-orm';
import { db } from '../../db';
import { vessels } from '../../db/schema';
import {
  seasearcherVesselDetail,
  seasearcherVesselSearch,
  seasearcherVesselMovements,
} from '../lloyds/lli.client';
import { getVesselById, getVesselBySeasearcherId } from './vessel-crud.service';
import type {
  SeasearcherVesselDetailResponse,
  SeasearcherVesselSearchResponse,
  VesselTypeaheadResult,
} from './vessel.types';

// ═══════════════════════════════════════════════════════════════════════
//  IMPORT VESSEL FROM SEASEARCHER
// ═══════════════════════════════════════════════════════════════════════

export async function importVesselFromSeasearcher(seasearcherId: string) {
  const existing = await getVesselBySeasearcherId(seasearcherId);
  if (existing) return existing;

  const detail = await seasearcherVesselDetail<SeasearcherVesselDetailResponse>(seasearcherId);

  const [created] = await db
    .insert(vessels)
    .values({
      name: detail.name,
      imo: detail.imo ? String(detail.imo) : null,
      mmsi: detail.mmsi ? String(detail.mmsi) : null,
      seasearcherId: String(detail.id),
      flag: detail.flag?.name ?? null,
      flagCode: detail.flag?.code ?? null,
      type: detail.type ?? null,
      status: detail.status ?? null,
      loa: detail.lengthOverall ? parseFloat(detail.lengthOverall) : null,
      breadth: detail.breadthExtreme
        ? parseFloat(detail.breadthExtreme)
        : detail.breadthMoulded
          ? parseFloat(detail.breadthMoulded)
          : null,
      depth: detail.depth ? parseFloat(detail.depth) : null,
      draught: detail.latestInformation?.draught ?? null,
      deadWeightTonnage: detail.deadWeightTonnage ?? null,
      grossTonnage: detail.grossTonnage ?? null,
      buildYear: detail.buildYear ?? null,
      builder: detail.builtBy ?? null,
      classificationSociety: detail.currentClassName ?? null,
      lastSynced: new Date(),
    })
    .returning();

  return created;
}

// ═══════════════════════════════════════════════════════════════════════
//  SYNC VESSEL FROM SEASEARCHER (update existing local record)
// ═══════════════════════════════════════════════════════════════════════

export async function syncVesselFromSeasearcher(vesselId: string) {
  const local = await getVesselById(vesselId);
  if (!local || !local.seasearcherId) return null;

  const detail = await seasearcherVesselDetail<SeasearcherVesselDetailResponse>(
    local.seasearcherId,
  );

  const [updated] = await db
    .update(vessels)
    .set({
      name: detail.name,
      imo: detail.imo ? String(detail.imo) : local.imo,
      mmsi: detail.mmsi ? String(detail.mmsi) : local.mmsi,
      flag: detail.flag?.name ?? local.flag,
      flagCode: detail.flag?.code ?? null,
      type: detail.type ?? local.type,
      status: detail.status ?? local.status,
      loa: detail.lengthOverall ? parseFloat(detail.lengthOverall) : local.loa,
      breadth: detail.breadthExtreme
        ? parseFloat(detail.breadthExtreme)
        : detail.breadthMoulded
          ? parseFloat(detail.breadthMoulded)
          : local.breadth,
      depth: detail.depth ? parseFloat(detail.depth) : local.depth,
      draught: detail.latestInformation?.draught ?? local.draught,
      deadWeightTonnage: detail.deadWeightTonnage ?? local.deadWeightTonnage,
      grossTonnage: detail.grossTonnage ?? local.grossTonnage,
      buildYear: detail.buildYear ?? local.buildYear,
      builder: detail.builtBy ?? local.builder,
      classificationSociety: detail.currentClassName ?? local.classificationSociety,
      lastSynced: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(vessels.id, vesselId))
    .returning();

  return updated ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  LOOKUP VESSEL BY IMO IN SEASEARCHER
// ═══════════════════════════════════════════════════════════════════════

export async function lookupSeasearcherByImo(imo: string) {
  try {
    const ss = await seasearcherVesselSearch<SeasearcherVesselSearchResponse>(imo, 10);
    if (!ss.results?.length) return null;

    const match = ss.results.find((r) => String(r.imo) === imo);
    if (!match) return null;

    const existing = await getVesselBySeasearcherId(String(match.id));

    return {
      seasearcherId: String(match.id),
      name: match.name,
      imo: match.imo ? String(match.imo) : null,
      mmsi: match.mmsi ? String(match.mmsi) : null,
      flag: match.flag?.name ?? null,
      flagCode: match.flag?.code ?? null,
      type: match.type ?? null,
      status: match.status ?? null,
      dwt: match.deadWeightTonnage ?? null,
      grossTonnage: match.grossTonnage ?? null,
      buildYear: match.buildYear ?? null,
      isSanctioned: match.isSanctioned,
      alreadyImportedByVesselId: existing?.id ?? null,
    };
  } catch (err) {
    console.error('[Vessels] Seasearcher IMO lookup failed:', err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  MERGE MANUAL VESSEL WITH SEASEARCHER
// ═══════════════════════════════════════════════════════════════════════

export async function mergeWithSeasearcher(vesselId: string, seasearcherId: string) {
  const local = await getVesselById(vesselId);
  if (!local) return null;

  if (local.seasearcherId) {
    throw new Error('Vessel is already linked to Seasearcher');
  }

  const conflict = await getVesselBySeasearcherId(seasearcherId);
  if (conflict) {
    throw new Error(
      `Another vessel (${conflict.name}) is already linked to this Seasearcher record`,
    );
  }

  const detail = await seasearcherVesselDetail<SeasearcherVesselDetailResponse>(seasearcherId);

  const [updated] = await db
    .update(vessels)
    .set({
      seasearcherId: String(detail.id),
      name: detail.name || local.name,
      imo: detail.imo ? String(detail.imo) : local.imo,
      mmsi: detail.mmsi ? String(detail.mmsi) : local.mmsi,
      flag: detail.flag?.name ?? local.flag,
      flagCode: detail.flag?.code ?? null,
      type: detail.type ?? local.type,
      status: detail.status ?? local.status,
      loa: detail.lengthOverall ? parseFloat(detail.lengthOverall) : local.loa,
      breadth: detail.breadthExtreme
        ? parseFloat(detail.breadthExtreme)
        : detail.breadthMoulded
          ? parseFloat(detail.breadthMoulded)
          : local.breadth,
      depth: detail.depth ? parseFloat(detail.depth) : local.depth,
      draught: detail.latestInformation?.draught ?? local.draught,
      deadWeightTonnage: detail.deadWeightTonnage ?? local.deadWeightTonnage,
      grossTonnage: detail.grossTonnage ?? local.grossTonnage,
      buildYear: detail.buildYear ?? local.buildYear,
      builder: detail.builtBy ?? local.builder,
      classificationSociety: detail.currentClassName ?? local.classificationSociety,
      lastSynced: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(vessels.id, vesselId))
    .returning();

  return updated ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  GET VESSEL ENRICHMENT (raw Seasearcher data for detail page)
// ═══════════════════════════════════════════════════════════════════════

export async function getVesselEnrichment(seasearcherId: string) {
  const detail = await seasearcherVesselDetail<SeasearcherVesselDetailResponse>(seasearcherId);
  return detail;
}

// ═══════════════════════════════════════════════════════════════════════
//  GET VESSEL MOVEMENTS (port calls from Seasearcher)
// ═══════════════════════════════════════════════════════════════════════

export async function getVesselMovements(seasearcherId: string) {
  const data = await seasearcherVesselMovements<{
    results: any[];
    allMatchingCount: number;
  }>(seasearcherId);
  return data.results ?? [];
}

// ═══════════════════════════════════════════════════════════════════════
//  SEARCH VESSELS (local + Seasearcher typeahead)
// ═══════════════════════════════════════════════════════════════════════


export async function searchVesselsTypeahead(
  term: string,
): Promise<VesselTypeaheadResult[]> {
  const results: VesselTypeaheadResult[] = [];

  // 1. Local DB
  const localResults = await db
    .select()
    .from(vessels)
    .where(
      or(
        ilike(vessels.name, `%${term}%`),
        ilike(vessels.imo, `%${term}%`),
        ilike(vessels.mmsi, `%${term}%`),
      ),
    )
    .limit(20);

  const localSeasearcherIds = new Set<string>();
  for (const v of localResults) {
    if (v.seasearcherId) localSeasearcherIds.add(v.seasearcherId);
    results.push({
      source: 'local',
      localId: v.id,
      seasearcherId: v.seasearcherId ?? undefined,
      name: v.name,
      imo: v.imo ?? undefined,
      mmsi: v.mmsi ?? undefined,
      flag: v.flag ?? undefined,
      flagCode: v.flagCode ?? undefined,
      type: v.type ?? undefined,
      status: v.status ?? undefined,
      dwt: v.deadWeightTonnage ?? undefined,
      gt: v.grossTonnage ?? undefined,
      buildYear: v.buildYear ?? undefined,
    });
  }

  // 2. Seasearcher search
  try {
    const ss = await seasearcherVesselSearch<SeasearcherVesselSearchResponse>(term, 50);
    if (ss.results?.length) {
      for (const v of ss.results) {
        if (localSeasearcherIds.has(String(v.id))) continue;
        results.push({
          source: 'seasearcher',
          seasearcherId: String(v.id),
          name: v.name,
          imo: v.imo ? String(v.imo) : undefined,
          mmsi: v.mmsi ? String(v.mmsi) : undefined,
          flag: v.flag?.name,
          flagCode: v.flag?.code,
          type: v.type ?? undefined,
          status: v.status ?? undefined,
          dwt: v.deadWeightTonnage ?? undefined,
          gt: v.grossTonnage ?? undefined,
          buildYear: v.buildYear ?? undefined,
          isSanctioned: v.isSanctioned,
        });
      }
    }
  } catch (err) {
    console.error('[Seasearcher] Vessel search failed:', err);
  }

  return results;
}
