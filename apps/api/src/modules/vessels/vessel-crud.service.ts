// ═══════════════════════════════════════════════════════════════════════
//  Vessel CRUD Service — core create, read, update, delete operations
// ═══════════════════════════════════════════════════════════════════════

import { eq, ilike, or, and, sql, inArray, asc, desc } from 'drizzle-orm';
import { db } from '../../db';
import { vessels, orders, counterparties, places } from '../../db/schema';

// ═══════════════════════════════════════════════════════════════════════
//  LIST VESSELS (local DB, paginated)
// ═══════════════════════════════════════════════════════════════════════

export async function listVessels(query?: {
  search?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
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

  const sortMap: Record<string, any> = {
    name: vessels.name,
    type: vessels.type,
    flag: vessels.flag,
    dwt: vessels.deadWeightTonnage,
    gt: vessels.grossTonnage,
    buildYear: vessels.buildYear,
    createdAt: vessels.createdAt,
  };
  const sortCol = sortMap[query?.sortBy ?? ''] ?? vessels.name;
  const sortFn = query?.sortDir === 'desc' ? desc : asc;

  const [rows, countResult] = await Promise.all([
    db
      .select()
      .from(vessels)
      .where(where)
      .limit(limit)
      .offset(offset)
      .orderBy(sortFn(sortCol)),
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
    phone: string;
    ignoreForCreditEnforcement: boolean;
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
