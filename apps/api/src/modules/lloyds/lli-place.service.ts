// ═══════════════════════════════════════════════════════════════════════
//  LLI Place Service — search, CRUD, enrichment for places/ports
// ═══════════════════════════════════════════════════════════════════════

import { eq, ilike, or, and, sql, asc, desc } from 'drizzle-orm';
import { db } from '../../db';
import { escapeLikePattern } from '../../utils/like';
import {
  vessels, places, counterparties, orders, portSuppliers, users, companyContacts,
} from '../../db/schema';
import {
  lliGet, seasearcherPlaceSearch, seasearcherPlaceDetail,
  seasearcherPortFacilities, seasearcherExpectedArrivals,
} from './lli.client';
import { resolveIanaTimezone } from '../../utils/timezone';
import { applyMatchingCompanyPlaceSupplyRulesForPlace } from '../companies/company.service';
import type {
  LliResponse, LliPlaceBasicCharsData, LliPlaceAdvancedCharsData,
  LliPlaceBasic, LliPlaceAdvancedItem,
  SeasearcherPlaceResponse, SeasearcherPlaceDetailResponse,
  PlaceSearchResult, PlaceEnrichment, HierarchyNode, ChildPlace,
  NearbyVessel, PortFacility, ExpectedArrival,
  CompanySearchResult,
} from './lli.types';

// ═══════════════════════════════════════════════════════════════════════
//  PLACE SEARCH
// ═══════════════════════════════════════════════════════════════════════

export async function searchPlaces(query: {
  name?: string;
  country?: string;
  placeType?: string;
}): Promise<PlaceSearchResult[]> {
  const results: PlaceSearchResult[] = [];

  const conditions: any[] = [];

  if (query.name) {
    const term = query.name.trim();
    conditions.push(
      or(
        ilike(places.name, `%${escapeLikePattern(term)}%`),
        ilike(places.unlocode, `%${escapeLikePattern(term)}%`),
        sql`lower(replace(${places.unlocode}, ' ', '')) LIKE lower(${'%' + escapeLikePattern(term.replace(/\s+/g, '')) + '%'})`,
        sql`lower((SELECT replace(p2.unlocode, ' ', '') FROM places p2 WHERE p2.id = ${places.parentPlaceId})) LIKE lower(${'%' + escapeLikePattern(term.replace(/\s+/g, '')) + '%'})`,
      )!,
    );
  }
  if (query.country) conditions.push(ilike(places.country, `%${escapeLikePattern(query.country)}%`));

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
        source: 'local',
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

  try {
    if (query.name) {
      const ss = await seasearcherPlaceSearch<SeasearcherPlaceResponse>(query.name, 50);
      if (ss.results?.length) {
        const localLliIds = new Set(results.map((r) => r.lliPlaceId).filter(Boolean));
        for (const p of ss.results) {
          if (localLliIds.has(p.id)) continue;
          if (query.placeType && p.typeCode !== query.placeType) continue;
          results.push({
            source: 'lloyds',
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
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
//  IMPORT PLACE
// ═══════════════════════════════════════════════════════════════════════

export async function importPlaceFromLli(lliPlaceId: string): Promise<{ id: string; name: string }> {
  const existing = await getPlaceByLliId(lliPlaceId);
  if (existing) return { id: existing.id, name: existing.name };

  const detail = await lliGet<LliResponse<LliPlaceBasic>>(
    `placebasiccharacteristics/${lliPlaceId}`,
    {},
  );

  if (!detail.IsSuccess || !detail.Data) {
    // Fallback: try Seasearcher
    try {
      const ss = await seasearcherPlaceDetail<SeasearcherPlaceDetailResponse>(lliPlaceId);
      const [created] = await db
        .insert(places as any)
        .values({
          
          name: ss.name as any,
          lliPlaceId: ss.id,
          country: ss.country.name,
          countryIso: ss.country.code,
          placeType: ss.typeCode,
          lat: ss.location?.lat?.toFixed(6) ?? null,
          long: ss.location?.lng?.toFixed(6) ?? null,
        })
        .returning();

      if (created) {
        try { await applyMatchingCompanyPlaceSupplyRulesForPlace(created.id); } catch { /* best-effort */ }
        return { id: created.id, name: created.name };
      }
    } catch {
      throw new Error(`Place ${lliPlaceId} not found in Seasearcher`);
    }
    throw new Error(`Place ${lliPlaceId} not found in LLI`);
  }

  const place = detail.Data;
  const [created] = await db
    .insert(places as any)
    .values({
          
      name: place.name,
      lliPlaceId: place.placeId,
      country: place.country,
      countryIso: place.countryIso,
      area: place.area,
      placeType: place.type,
      lat: place.latitude?.toFixed(6) ?? null,
      long: place.longitude?.toFixed(6) ?? null,
      unlocode: place.unlocode || null,
      admiraltyChart: place.admiraltyChart || null,
    })
    .returning();

  if (created) {
    try { await applyMatchingCompanyPlaceSupplyRulesForPlace(created.id); } catch { /* best-effort */ }
  }

  return { id: created.id, name: created.name };
}

// ═══════════════════════════════════════════════════════════════════════
//  LIST PLACES
// ═══════════════════════════════════════════════════════════════════════

export async function listPlaces(query?: {
  search?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}) {
  const conditions: any[] = [];

  if (query?.search) {
    conditions.push(
      or(
        ilike(places.name, `%${escapeLikePattern(query.search)}%`),
        ilike(places.unlocode, `%${escapeLikePattern(query.search)}%`),
        ilike(places.country, `%${escapeLikePattern(query.search)}%`),
      ),
    );
  }

  const where = conditions.length ? (conditions.length === 1 ? conditions[0] : and(...conditions)) : undefined;
  const limit = query?.limit ?? 25;
  const page = query?.page ?? 1;
  const offset = (page - 1) * limit;

  const sortMap: Record<string, any> = {
    name: places.name, country: places.country, type: places.placeType,
    unlocode: places.unlocode, createdAt: places.createdAt,
  };
  const sortCol = sortMap[query?.sortBy ?? ''] ?? places.name;
  const sortFn = query?.sortDir === 'desc' ? desc : asc;

  const [rows, countResult] = await Promise.all([
    db.select().from(places).where(where).limit(limit).offset(offset).orderBy(sortFn(sortCol)),
    db.select({ count: sql<number>`count(*)::int` }).from(places).where(where),
  ]);

  return { places: rows, total: countResult[0]?.count ?? 0 };
}

// ═══════════════════════════════════════════════════════════════════════
//  GET PLACE BY ID
// ═══════════════════════════════════════════════════════════════════════

export async function getPlaceById(id: string) {
  const [row] = await db.select().from(places).where(eq(places.id, id)).limit(1);
  return row ?? null;
}

export async function getPlaceByLliId(lliPlaceId: string) {
  const [row] = await db.select().from(places).where(eq(places.lliPlaceId, lliPlaceId)).limit(1);
  return row ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  PLACE ENRICHMENT
// ═══════════════════════════════════════════════════════════════════════

export async function getPlaceEnrichment(seasearcherId: string): Promise<PlaceEnrichment> {
  const [hierarchy, children, nearbyVessels, portFacilities, expectedArrivals] = await Promise.all([
    getPlaceHierarchy(seasearcherId),
    getChildPlaces(seasearcherId),
    getNearbyVessels(seasearcherId),
    getPortFacilities(seasearcherId),
    getExpectedArrivals(seasearcherId),
  ]);

  return { hierarchy, children, nearbyVessels, portFacilities, expectedArrivals };
}

async function getPlaceHierarchy(seasearcherId: string): Promise<HierarchyNode | null> {
  try {
    const data = await lliGet<LliResponse<{ items: Array<{ placeId: string; name: string; type?: string; unlocode?: string; parentPlaceId?: string; children?: any[] }> }>>(
      `placeadvancedchars_v3/${seasearcherId}`,
      {},
    );

    if (data.IsSuccess && data.Data?.items?.length) {
      const item = data.Data.items[0]!;
      return {
        level: 0,
        placeId: item.placeId,
        name: item.name,
        type: item.type ?? '',
        unlocode: item.unlocode,
        children: [],
        parentPlaceId: item.parentPlaceId,
      };
    }
  } catch {
    // Hierarchy is optional
  }
  return null;
}

async function getChildPlaces(seasearcherId: string): Promise<ChildPlace[]> {
  try {
    const data = await lliGet<LliResponse<{ items: Array<{ placeId: string; name: string; type?: string; unlocode?: string }> }>>(
      `placeadvancedchars_v3/${seasearcherId}`,
      {},
    );

    if (data.IsSuccess && data.Data?.items?.length) {
      const item = data.Data.items[0]!;
      if (item.type === 'POR' && item.unlocode) {
        const children = await db
          .select({ id: places.id, name: places.name, placeType: places.placeType, unlocode: places.unlocode })
          .from(places)
          .where(eq(places.parentPlaceId, seasearcherId));
        return children.map((c) => ({ id: c.id, name: c.name, placeType: c.placeType ?? '', unlocode: c.unlocode }));
      }
    }
  } catch {
    // Children are optional
  }
  return [];
}

import { getNearbyVessels } from './lli-vessel.service';

// ═══════════════════════════════════════════════════════════════════════
//  CREATE PLACE (manual)
// ═══════════════════════════════════════════════════════════════════════

export async function createPlace(data: {
  name: string;
  country: string;
  countryIso?: string;
  placeType: string;
  unlocode?: string;
  lat?: string | null;
  long?: string | null;
}) {
  const [created] = await db
    .insert(places as any)
    .values({
          
      name: data.name,
      country: data.country,
      countryIso: data.countryIso ?? null,
      placeType: data.placeType,
      unlocode: data.unlocode ?? null,
      lat: data.lat ?? null,
      long: data.long ?? null,
    })
    .returning();
  return created;
}

// ═══════════════════════════════════════════════════════════════════════
//  UPDATE PLACE
// ═══════════════════════════════════════════════════════════════════════

export async function updateLocalPlace(
  id: string,
  data: Partial<{
    name: string;
    country: string;
    countryIso: string;
    placeType: string;
    unlocode: string;
    lat: string;
    long: string;
    admiraltyChart: string;
    area: string;
    lliPlaceId: string;
  }>,
) {
  const [updated] = await db
    .update(places as any)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(places.id, id))
    .returning();
  return updated ?? null;
}

export async function updatePlaceOrderRemark(id: string, orderRemark: string | null) {
  const [updated] = await db
    .update(places as any)
    .set({ orderRemark, updatedAt: new Date() })
    .where(eq(places.id, id))
    .returning();
  return updated ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  DELETE PLACE
// ═══════════════════════════════════════════════════════════════════════

export async function deletePlace(id: string): Promise<boolean> {
  const [deleted] = await db
    .delete(places)
    .where(eq(places.id, id))
    .returning({ id: places.id });
  return !!deleted;
}

// ═══════════════════════════════════════════════════════════════════════
//  SYNC PLACE FROM SEASEARCHER
// ═══════════════════════════════════════════════════════════════════════

export async function syncPlaceFromSeasearcher(
  placeId: string,
): Promise<typeof places.$inferSelect | null> {
  const local = await getPlaceById(placeId);
  if (!local?.lliPlaceId) return null;

  try {
    const ss = await seasearcherPlaceDetail<SeasearcherPlaceDetailResponse>(local.lliPlaceId);
    const [updated] = await db
      .update(places)
      .set({
        name: ss.name ?? local.name,
        country: ss.country.name ?? local.country,
        countryIso: ss.country.code ?? local.countryIso,
        lat: ss.location?.lat?.toFixed(6) ?? local.lat,
        long: ss.location?.lng?.toFixed(6) ?? local.long,
        updatedAt: new Date(),
      } as any)
      .where(eq(places.id, placeId))
      .returning();
    if (updated) {
      try { await applyMatchingCompanyPlaceSupplyRulesForPlace(updated.id); } catch { /* best-effort */ }
    }
    return updated ?? null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  COMPANY SEARCH (Seasearcher)
// ═══════════════════════════════════════════════════════════════════════

export async function searchCompanies(query: {
  name?: string;
  country?: string;
}): Promise<CompanySearchResult[]> {
  const results: CompanySearchResult[] = [];

  // 1. Local DB
  const localConditions: any[] = [];
  if (query.name) localConditions.push(ilike(counterparties.name, `%${escapeLikePattern(query.name)}%`));
  if (query.country) localConditions.push(ilike(counterparties.country, `%${escapeLikePattern(query.country)}%`));

  if (localConditions.length > 0) {
    const local = await db
      .select({ id: counterparties.id, name: counterparties.name, country: counterparties.country })
      .from(counterparties)
      .where(localConditions.length === 1 ? localConditions[0] : and(...localConditions))
      .limit(20);

    for (const c of local) {
      results.push({ source: 'local', localId: c.id, name: c.name, country: c.country });
    }
  }

  // 2. Seasearcher fallback
  try {
    const { seasearcherCompanySearch } = await import('./lli.client');
    if (query.name) {
      const ss = await seasearcherCompanySearch<{
        results: Array<{ id: string; name: string; country: { code: string; name: string } | null }>;
      }>(query.name, 30);

      if (ss.results?.length) {
        for (const c of ss.results) {
          if (results.some((r) => r.seasearcherId === c.id)) continue;
          results.push({
            source: 'seasearcher',
            seasearcherId: c.id,
            name: c.name,
            country: c.country?.name ?? null,
          });
        }
      }
    }
  } catch {
    // Company search is optional
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
//  ORDERS FOR PLACE
// ═══════════════════════════════════════════════════════════════════════

export async function getOrdersForPlace(placeId: string) {
  const rows = await db
    .select({
      id: orders.id,
      status: orders.status,
      eta: orders.eta,
      vesselName: vessels.name,
      vesselImo: vessels.imo,
      clientName: counterparties.name,
    })
    .from(orders)
    .innerJoin(vessels, eq(orders.vesselId, vessels.id))
    .innerJoin(counterparties, eq(orders.clientId, counterparties.id))
    .where(eq(orders.placeId, placeId))
    .orderBy(desc(orders.createdAt));

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    eta: r.eta?.toISOString() ?? null,
    vesselName: r.vesselName,
    vesselImo: r.vesselImo,
    clientName: r.clientName,
  }));
}

// ═══════════════════════════════════════════════════════════════════════
//  PORT FACILITIES
// ═══════════════════════════════════════════════════════════════════════

export async function getPortFacilities(seasearcherId: string) {
  const results: PortFacility[] = [];

  try {
    const ss = await seasearcherPortFacilities<{ results: PortFacility[] }>(seasearcherId);
    if (ss.results?.length) return ss.results;
  } catch {
    // Fall through
  }

  try {
    const lli = await lliGet<LliResponse<{ currentPage: number; items: PortFacility[] }>>(
      `placeportfacilities_v3/${seasearcherId}`,
      {},
    );
    if (lli.IsSuccess && lli.Data?.items?.length) {
      return lli.Data.items;
    }
  } catch {
    // Port facilities are optional
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
//  EXPECTED ARRIVALS
// ═══════════════════════════════════════════════════════════════════════

export async function getExpectedArrivals(
  seasearcherId: string,
  daysAhead = 7,
): Promise<ExpectedArrival[]> {
  try {
    const ss = await seasearcherExpectedArrivals<{ results: ExpectedArrival[] }>(
      seasearcherId,
      daysAhead,
    );
    if (ss.results?.length) return ss.results;
  } catch {
    // Fall through
  }

  try {
    const lli = await lliGet<LliResponse<{ currentPage: number; items: ExpectedArrival[] }>>(
      `placeexpectedarrivals_v2/${seasearcherId}?days=${daysAhead}`,
      {},
    );
    if (lli.IsSuccess && lli.Data?.items?.length) {
      return lli.Data.items;
    }
  } catch {
    // Expected arrivals are optional
  }

  return [];
}

// ═══════════════════════════════════════════════════════════════════════
//  PORT SUPPLIERS
// ═══════════════════════════════════════════════════════════════════════

export async function getPortSuppliers(placeId: string) {
  return db
    .select()
    .from(portSuppliers)
    .innerJoin(counterparties, eq(portSuppliers.companyId, counterparties.id))
    .leftJoin(companyContacts, eq(portSuppliers.contactId, companyContacts.id))
    .where(eq(portSuppliers.placeId, placeId))
    .orderBy(counterparties.name);
}

export async function addPortSupplier(
  placeId: string,
  data: { companyId: string; contactId?: string | null; products?: string[]; note?: string },
  userId: string,
  userName: string,
) {
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

  const [full] = await db
    .select()
    .from(portSuppliers)
    .innerJoin(counterparties, eq(portSuppliers.companyId, counterparties.id))
    .leftJoin(companyContacts, eq(portSuppliers.contactId, companyContacts.id))
    .where(eq(portSuppliers.id, created.id));

  return full;
}

export async function updatePortSupplier(
  id: string,
  data: { contactId?: string | null; products?: string[]; note?: string },
) {
  const setData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.contactId !== undefined) setData.contactId = data.contactId;
  if (data.products !== undefined) setData.products = data.products;
  if (data.note !== undefined) setData.note = data.note;

  const [updated] = await db
    .update(portSuppliers)
    .set(setData)
    .where(eq(portSuppliers.id, id))
    .returning();
  return updated ?? null;
}

export async function deletePortSupplier(id: string) {
  const [deleted] = await db
    .delete(portSuppliers)
    .where(eq(portSuppliers.id, id))
    .returning({ id: portSuppliers.id });
  return deleted ?? null;
}

export async function getSupplyPortsForCompany(companyId: string) {
  return db
    .select({
      id: portSuppliers.id,
      placeId: portSuppliers.placeId,
      placeName: places.name,
      placeCountry: places.country,
      contactId: portSuppliers.contactId,
      contactName: companyContacts.name,
      products: portSuppliers.products,
      note: portSuppliers.note,
    })
    .from(portSuppliers)
    .innerJoin(places, eq(portSuppliers.placeId, places.id))
    .leftJoin(companyContacts, eq(portSuppliers.contactId, companyContacts.id))
    .where(eq(portSuppliers.companyId, companyId))
    .orderBy(places.name);
}

// ═══════════════════════════════════════════════════════════════════════
//  RESPONSIBLE USER
// ═══════════════════════════════════════════════════════════════════════

export async function updateResponsibleUser(placeId: string, userId: string | null) {
  const [updated] = await db
    .update(places as any)
    .set({ responsibleUserId: userId, updatedAt: new Date() })
    .where(eq(places.id, placeId))
    .returning();
  return updated ?? null;
}

export async function listActiveUsers() {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(asc(users.name));
}
