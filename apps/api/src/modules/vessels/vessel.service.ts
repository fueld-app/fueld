// ═══════════════════════════════════════════════════════════════════════
//  Vessel Service — CRUD + Seasearcher sync for vessels
// ═══════════════════════════════════════════════════════════════════════

import { eq, ilike, or, and, sql, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { vessels, orders, counterparties, places, vesselCompanies, companyContacts, users } from '../../db/schema';
import type { VesselCompanyRole } from '@fueld/types';
import {
  seasearcherVesselDetail,
  seasearcherVesselSearch,
  seasearcherVesselMovements,
} from '../lloyds/lli.client';

// ═══════════════════════════════════════════════════════════════════════
//  Seasearcher Response Types
// ═══════════════════════════════════════════════════════════════════════

interface SeasearcherVesselSearchResult {
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

interface SeasearcherVesselSearchResponse {
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

// ═══════════════════════════════════════════════════════════════════════
//  LIST VESSELS (local DB, paginated)
// ═══════════════════════════════════════════════════════════════════════

export async function listVessels(query?: {
  search?: string;
  limit?: number;
  page?: number;
}) {
  const conditions = [];
  if (query?.search) {
    conditions.push(
      or(
        ilike(vessels.name, `%${query.search}%`),
        ilike(vessels.imo, `%${query.search}%`),
        ilike(vessels.mmsi, `%${query.search}%`),
      ),
    );
  }

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
      .from(vessels)
      .where(where)
      .limit(limit)
      .offset(offset)
      .orderBy(vessels.name),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(vessels)
      .where(where),
  ]);

  return { vessels: rows, total: countResult[0]?.count ?? 0 };
}

// ═══════════════════════════════════════════════════════════════════════
//  GET SINGLE VESSEL BY ID
// ═══════════════════════════════════════════════════════════════════════

export async function getVesselById(id: string) {
  const [row] = await db
    .select()
    .from(vessels)
    .where(eq(vessels.id, id))
    .limit(1);
  return row ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  GET VESSEL BY SEASEARCHER ID
// ═══════════════════════════════════════════════════════════════════════

export async function getVesselBySeasearcherId(seasearcherId: string) {
  const [row] = await db
    .select()
    .from(vessels)
    .where(eq(vessels.seasearcherId, seasearcherId))
    .limit(1);
  return row ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  MATCH LOCAL VESSELS BY SEASEARCHER ID / IMO
// ═══════════════════════════════════════════════════════════════════════

export async function matchLocalVessels(input: {
  seasearcherIds?: string[];
  imos?: string[];
}) {
  const seasearcherIds = (input.seasearcherIds ?? []).filter(Boolean);
  const imos = (input.imos ?? []).filter(Boolean);

  if (!seasearcherIds.length && !imos.length) return [];

  const conditions = [];
  if (seasearcherIds.length) {
    conditions.push(inArray(vessels.seasearcherId, seasearcherIds));
  }
  if (imos.length) {
    conditions.push(inArray(vessels.imo, imos));
  }

  const where = conditions.length === 1 ? conditions[0] : or(...conditions);
  return db.select().from(vessels).where(where);
}

// ═══════════════════════════════════════════════════════════════════════
//  CREATE VESSEL (manual entry)
// ═══════════════════════════════════════════════════════════════════════

export async function createVessel(data: {
  name: string;
  imo?: string;
  mmsi?: string;
  flag?: string;
  flagCode?: string;
  type?: string;
  status?: string;
  loa?: number;
  breadth?: number;
  depth?: number;
  draught?: number;
  deadWeightTonnage?: number;
  grossTonnage?: number;
  buildYear?: number;
  seasearcherId?: string;
}) {
  const [created] = await db
    .insert(vessels)
    .values({
      name: data.name,
      imo: data.imo,
      mmsi: data.mmsi,
      flag: data.flag,
      flagCode: data.flagCode,
      type: data.type,
      status: data.status,
      loa: data.loa,
      breadth: data.breadth,
      depth: data.depth,
      draught: data.draught,
      deadWeightTonnage: data.deadWeightTonnage,
      grossTonnage: data.grossTonnage,
      buildYear: data.buildYear,
      seasearcherId: data.seasearcherId,
    })
    .returning();

  return created;
}

// ═══════════════════════════════════════════════════════════════════════
//  UPDATE VESSEL
// ═══════════════════════════════════════════════════════════════════════

export async function updateVessel(
  id: string,
  data: Partial<{
    name: string;
    imo: string;
    mmsi: string;
    flag: string;
    flagCode: string;
    type: string;
    status: string;
    loa: number;
    breadth: number;
    depth: number;
    draught: number;
    deadWeightTonnage: number;
    grossTonnage: number;
    buildYear: number;
    builder: string;
    classificationSociety: string;
  }>,
) {
  const [updated] = await db
    .update(vessels)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(vessels.id, id))
    .returning();
  return updated ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  IMPORT VESSEL FROM SEASEARCHER
// ═══════════════════════════════════════════════════════════════════════

export async function importVesselFromSeasearcher(seasearcherId: string) {
  // Check if already imported
  const existing = await getVesselBySeasearcherId(seasearcherId);
  if (existing) return existing;

  // Fetch from Seasearcher
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
      breadth: detail.breadthExtreme ? parseFloat(detail.breadthExtreme) : detail.breadthMoulded ? parseFloat(detail.breadthMoulded) : null,
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
      breadth: detail.breadthExtreme ? parseFloat(detail.breadthExtreme) : detail.breadthMoulded ? parseFloat(detail.breadthMoulded) : local.breadth,
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
//  DELETE VESSEL
// ═══════════════════════════════════════════════════════════════════════

export async function deleteVessel(id: string) {
  const [deleted] = await db
    .delete(vessels)
    .where(eq(vessels.id, id))
    .returning({ id: vessels.id });
  return deleted ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  LOOKUP VESSEL BY IMO IN SEASEARCHER
//  Returns the first Seasearcher match for an IMO, or null.
// ═══════════════════════════════════════════════════════════════════════

export async function lookupSeasearcherByImo(imo: string) {
  try {
    const ss = await seasearcherVesselSearch<SeasearcherVesselSearchResponse>(imo, 10);
    if (!ss.results?.length) return null;

    // Find exact IMO match
    const match = ss.results.find((r) => String(r.imo) === imo);
    if (!match) return null;

    // Check if already imported by another local vessel
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
//  Links an existing manual vessel to Seasearcher by setting the
//  seasearcherId and syncing enrichment data. Preserves the local
//  vessel ID so all company relations, orders, comments etc. persist.
// ═══════════════════════════════════════════════════════════════════════

export async function mergeWithSeasearcher(vesselId: string, seasearcherId: string) {
  const local = await getVesselById(vesselId);
  if (!local) return null;

  // Don't merge if already linked
  if (local.seasearcherId) {
    throw new Error('Vessel is already linked to Seasearcher');
  }

  // Ensure no other local vessel is using this seasearcherId
  const conflict = await getVesselBySeasearcherId(seasearcherId);
  if (conflict) {
    throw new Error(`Another vessel (${conflict.name}) is already linked to this Seasearcher record`);
  }

  // Fetch full detail from Seasearcher
  const detail = await seasearcherVesselDetail<SeasearcherVesselDetailResponse>(seasearcherId);

  // Merge: Seasearcher data wins for enrichment fields, keep local vessel ID
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
//  SEARCH VESSELS (local + Seasearcher typeahead)
// ═══════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════
//  GET VESSEL ENRICHMENT (raw Seasearcher data for detail page)
// ═══════════════════════════════════════════════════════════════════════

export async function getVesselEnrichment(seasearcherId: string) {
  const detail = await seasearcherVesselDetail<SeasearcherVesselDetailResponse>(seasearcherId);
  return detail;
}

// ═══════════════════════════════════════════════════════════════════════
//  GET ORDERS FOR A VESSEL
// ═══════════════════════════════════════════════════════════════════════

export async function getOrdersForVessel(vesselId: string) {
  const rows = await db
    .select({
      id: orders.id,
      status: orders.status,
      eta: orders.eta,
      etd: orders.etd,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      clientName: counterparties.name,
      clientCountry: counterparties.country,
      placeName: places.name,
      placeCountry: places.country,
      salesRepId: orders.salesRepId,
    })
    .from(orders)
    .innerJoin(counterparties, eq(orders.clientId, counterparties.id))
    .innerJoin(places, eq(orders.placeId, places.id))
    .where(eq(orders.vesselId, vesselId))
    .orderBy(sql`${orders.createdAt} desc`);

  return rows;
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
//  VESSEL COMPANIES (user-managed company associations)
// ═══════════════════════════════════════════════════════════════════════

export async function getVesselCompanies(vesselId: string) {
  return db
    .select({
      id: vesselCompanies.id,
      vesselId: vesselCompanies.vesselId,
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
    .innerJoin(counterparties, eq(vesselCompanies.companyId, counterparties.id))
    .leftJoin(companyContacts, eq(vesselCompanies.contactId, companyContacts.id))
    .where(eq(vesselCompanies.vesselId, vesselId))
    .orderBy(vesselCompanies.role, counterparties.name);
}

export async function addVesselCompany(
  vesselId: string,
  data: { companyId: string; role: VesselCompanyRole; contactId?: string | null; note?: string; replaceExistingRole?: boolean },
  userId: string,
  userName: string
) {
  const [existing] = await db
    .select({ id: vesselCompanies.id })
    .from(vesselCompanies)
    .where(
      and(
        eq(vesselCompanies.vesselId, vesselId),
        eq(vesselCompanies.role, data.role),
      ),
    )
    .limit(1);

  if (existing) {
    if (!data.replaceExistingRole) {
      throw new Error('Role already exists for this vessel');
    }

    const [updated] = await db
      .update(vesselCompanies)
      .set({
        companyId: data.companyId,
        contactId: data.contactId ?? null,
        note: data.note ?? null,
        addedById: userId,
        addedByName: userName,
        updatedAt: new Date(),
      })
      .where(eq(vesselCompanies.id, existing.id))
      .returning();

    if (!updated) {
      throw new Error('Failed to replace vessel role');
    }

    const [fullUpdated] = await db
      .select({
        id: vesselCompanies.id,
        vesselId: vesselCompanies.vesselId,
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
      .innerJoin(counterparties, eq(vesselCompanies.companyId, counterparties.id))
      .leftJoin(companyContacts, eq(vesselCompanies.contactId, companyContacts.id))
      .where(eq(vesselCompanies.id, existing.id));

    return fullUpdated;
  }

  const [created] = await db
    .insert(vesselCompanies)
    .values({
      vesselId,
      companyId: data.companyId,
      role: data.role,
      contactId: data.contactId ?? null,
      note: data.note ?? null,
      addedById: userId,
      addedByName: userName,
    })
    .returning();
  // Re-fetch with company name + contact name
  const [full] = await db
    .select({
      id: vesselCompanies.id,
      vesselId: vesselCompanies.vesselId,
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
    .innerJoin(counterparties, eq(vesselCompanies.companyId, counterparties.id))
    .leftJoin(companyContacts, eq(vesselCompanies.contactId, companyContacts.id))
    .where(eq(vesselCompanies.id, created.id));
  return full;
}

export async function updateVesselCompany(
  id: string,
  data: { role?: VesselCompanyRole; contactId?: string | null; note?: string }
) {
  if (data.role) {
    const [current] = await db
      .select({ vesselId: vesselCompanies.vesselId, companyId: vesselCompanies.companyId })
      .from(vesselCompanies)
      .where(eq(vesselCompanies.id, id))
      .limit(1);

    if (current) {
      const [dup] = await db
        .select({ id: vesselCompanies.id })
        .from(vesselCompanies)
        .where(
          and(
            eq(vesselCompanies.vesselId, current.vesselId),
            eq(vesselCompanies.role, data.role),
            sql`${vesselCompanies.id} <> ${id}`,
          ),
        )
        .limit(1);
      if (dup) {
        throw new Error('Role already exists for this vessel');
      }
    }
  }

  const [updated] = await db
    .update(vesselCompanies)
    .set({
      ...(data.role !== undefined && { role: data.role }),
      ...(data.contactId !== undefined && { contactId: data.contactId }),
      ...(data.note !== undefined && { note: data.note }),
      updatedAt: new Date(),
    })
    .where(eq(vesselCompanies.id, id))
    .returning();
  if (!updated) return null;
  // Re-fetch with company + contact name
  const [full] = await db
    .select({
      id: vesselCompanies.id,
      vesselId: vesselCompanies.vesselId,
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
    .innerJoin(counterparties, eq(vesselCompanies.companyId, counterparties.id))
    .leftJoin(companyContacts, eq(vesselCompanies.contactId, companyContacts.id))
    .where(eq(vesselCompanies.id, updated.id));
  return full ?? null;
}

export async function deleteVesselCompany(id: string) {
  // Fetch company info before deletion
  const [info] = await db
    .select({
      id: vesselCompanies.id,
      companyName: counterparties.name,
      role: vesselCompanies.role,
    })
    .from(vesselCompanies)
    .innerJoin(counterparties, eq(vesselCompanies.companyId, counterparties.id))
    .where(eq(vesselCompanies.id, id));
  if (!info) return null;
  await db.delete(vesselCompanies).where(eq(vesselCompanies.id, id));
  return { id: info.id, companyName: info.companyName, role: info.role };
}
