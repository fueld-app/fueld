// ═══════════════════════════════════════════════════════════════════════
//  Company Relationships Service — parent/child, group, supply rules
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, sql, inArray, asc, desc } from 'drizzle-orm';
import { db } from '../../db';
import { counterparties, orders, orderSuppliers, vessels, places, vesselCompanies, companyPlaceSupplyRules, portSuppliers } from '../../db/schema';
import type { CompanyPlaceSupplyRulePlaceType } from './company.types';
import { COMPANY_PLACE_SUPPLY_RULE_SOURCE } from './company.types';

// ─── Parent / Child ───────────────────────────────────────────────

export async function getChildCompanies(parentId: string) {
  return db.select({
    id: counterparties.id, name: counterparties.name, country: counterparties.country,
    countryIso: counterparties.countryIso, createdAt: counterparties.createdAt,
  }).from(counterparties).where(eq(counterparties.parentId, parentId)).orderBy(counterparties.name);
}

export async function getParentCompany(childId: string) {
  const [child] = await db.select({ parentId: counterparties.parentId }).from(counterparties).where(eq(counterparties.id, childId)).limit(1);
  if (!child?.parentId) return null;
  const [parent] = await db.select().from(counterparties).where(eq(counterparties.id, child.parentId)).limit(1);
  return parent ?? null;
}

export async function setParentCompany(childId: string, parentId: string) {
  const [updated] = await db.update(counterparties).set({ parentId, updatedAt: new Date() }).where(eq(counterparties.id, childId)).returning();
  return updated ?? null;
}

export async function removeParentCompany(childId: string) {
  const [updated] = await db.update(counterparties).set({ parentId: null, updatedAt: new Date() }).where(eq(counterparties.id, childId)).returning();
  return updated ?? null;
}

// ─── Group ────────────────────────────────────────────────────────

export async function getCompanyGroupAggregate(parentId: string) {
  const [parent] = await db
    .select({ id: counterparties.id, name: counterparties.name })
    .from(counterparties)
    .where(eq(counterparties.id, parentId))
    .limit(1);
  if (!parent) return null;

  const children = await getChildCompanies(parentId);
  const allIds = [parentId, ...children.map((c) => c.id)];

  const [orderStats] = await db
    .select({
      totalOrders: sql<number>`count(*)::int`,
      totalRevenue: sql<number>`coalesce(sum(oi.sales_price * oi.quantity)::float, 0)`,
    })
    .from(orders)
    .leftJoin(sql`order_items oi`, sql`oi.order_id = orders.id`)
    .where(inArray(orders.clientId, allIds));

  return {
    id: parent.id,
    name: parent.name,
    childCount: children.length,
    totalOrders: orderStats?.totalOrders ?? 0,
    totalRevenue: orderStats?.totalRevenue?.toFixed(2) ?? '0.00',
  };
}

export async function getGroupOrdersForCompany(parentId: string) {
  const children = await getChildCompanies(parentId);
  const allIds = [parentId, ...children.map((c) => c.id)];

  return db
    .select({
      id: orders.id, status: orders.status, eta: orders.eta, etd: orders.etd,
      createdAt: orders.createdAt, updatedAt: orders.updatedAt,
      clientName: counterparties.name,
      vesselName: vessels.name, placeName: places.name,
      salesRepId: orders.salesRepId,
    })
    .from(orders)
    .innerJoin(counterparties, eq(orders.clientId, counterparties.id))
    .innerJoin(vessels, eq(orders.vesselId, vessels.id))
    .innerJoin(places, eq(orders.placeId, places.id))
    .where(inArray(orders.clientId, allIds))
    .orderBy(desc(orders.createdAt));
}

export async function getGroupFleetForCompany(companyId: string): Promise<{ results: any[]; totalMatches: number; queriedCompanyCount: number; totalCompanyCount: number; truncated: boolean; maxCompanies: number }> {
  const [company] = await db.select({ id: counterparties.id, seasearcherId: counterparties.seasearcherId }).from(counterparties).where(eq(counterparties.id, companyId)).limit(1);
  if (!company?.seasearcherId) return { results: [], totalMatches: 0, queriedCompanyCount: 0, totalCompanyCount: 0, truncated: false, maxCompanies: 10 };

  const children = await getChildCompanies(companyId);
  const childSeasearcherIds = children.map((c) => c.id).filter(Boolean);

  const maxCompanies = 10;
  const fleetResults: any[] = [];
  const queriedIds = new Set<string>([company.seasearcherId]);

  // Get parent fleet
  try {
    const { seasearcherCompanyFleet } = await import('../lloyds/lli.client');
    const fleet = await seasearcherCompanyFleet<any>(company.seasearcherId);
    if (fleet?.results) fleetResults.push(...fleet.results);
  } catch {}

  // Get child fleet up to limit
  for (const childId of childSeasearcherIds.slice(0, maxCompanies - 1)) {
    if (queriedIds.size >= maxCompanies) break;
    try {
      const childSeasearcherId = (await db.select({ seasearcherId: counterparties.seasearcherId }).from(counterparties).where(eq(counterparties.id, childId)).limit(1))[0]?.seasearcherId;
      if (!childSeasearcherId || queriedIds.has(childSeasearcherId)) continue;
      queriedIds.add(childSeasearcherId);
      const { seasearcherCompanyFleet } = await import('../lloyds/lli.client');
      const fleet = await seasearcherCompanyFleet<any>(childSeasearcherId);
      if (fleet?.results) fleetResults.push(...fleet.results);
    } catch {}
  }

  return {
    results: fleetResults,
    totalMatches: fleetResults.length,
    queriedCompanyCount: queriedIds.size,
    totalCompanyCount: 1 + childSeasearcherIds.length,
    truncated: queriedIds.size < 1 + childSeasearcherIds.length,
    maxCompanies,
  };
}

export async function getGroupVesselsForCompany(companyId: string) {
  const children = await getChildCompanies(companyId);
  const allIds = [companyId, ...children.map((c) => c.id)];

  return db
    .select({
      id: vesselCompanies.id, vesselId: vesselCompanies.vesselId,
      localVesselId: vesselCompanies.vesselId, seasearcherVesselId: sql`null`,
      vesselName: vessels.name, vesselImo: vessels.imo,
      companyName: counterparties.name, role: vesselCompanies.role, source: vesselCompanies.source,
    })
    .from(vesselCompanies)
    .innerJoin(vessels, eq(vesselCompanies.vesselId, vessels.id))
    .innerJoin(counterparties, eq(vesselCompanies.companyId, counterparties.id))
    .where(inArray(vesselCompanies.companyId, allIds))
    .orderBy(counterparties.name, vesselCompanies.role);
}

export async function getTopCreditGroups(limit = 10) {
  return db
    .select({
      id: counterparties.id, name: counterparties.name,
      creditLimit: counterparties.creditLimit, creditUsed: counterparties.creditUsed,
    })
    .from(counterparties)
    .where(and(sql`${counterparties.creditLimit} is not null`, sql`${counterparties.creditLimit} > 0`))
    .orderBy(desc(counterparties.creditLimit))
    .limit(limit);
}

// ─── Place Supply Rules ───────────────────────────────────────────

export async function listCompanyPlaceSupplyRules(companyId: string) {
  return db
    .select({
      id: companyPlaceSupplyRules.id,
      companyId: companyPlaceSupplyRules.companyId,
      countryIso: companyPlaceSupplyRules.countryIso,
      placeTypes: companyPlaceSupplyRules.placeTypes,
      contactId: companyPlaceSupplyRules.contactId,
      contactName: sql`c.name`,
      products: companyPlaceSupplyRules.products,
      note: companyPlaceSupplyRules.note,
      isActive: companyPlaceSupplyRules.isActive,
      addedById: companyPlaceSupplyRules.addedById,
      addedByName: companyPlaceSupplyRules.addedByName,
    })
    .from(companyPlaceSupplyRules)
    .leftJoin(sql`company_contacts c`, sql`c.id = ${companyPlaceSupplyRules.contactId}`)
    .where(eq(companyPlaceSupplyRules.companyId, companyId))
    .orderBy(companyPlaceSupplyRules.countryIso);
}

export async function createCompanyPlaceSupplyRule(
  companyId: string,
  data: { countryIso: string; placeTypes: string[]; contactId?: string | null; products: string[]; note?: string | null },
  userId: string,
  userName: string,
) {
  const [existing] = await db
    .select({ id: companyPlaceSupplyRules.id })
    .from(companyPlaceSupplyRules)
    .where(and(eq(companyPlaceSupplyRules.companyId, companyId), eq(companyPlaceSupplyRules.countryIso, data.countryIso)))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(companyPlaceSupplyRules)
      .set({ placeTypes: data.placeTypes, contactId: data.contactId ?? null, products: data.products, note: data.note ?? null, updatedAt: new Date() })
      .where(eq(companyPlaceSupplyRules.id, existing.id))
      .returning();
    return updated ?? null;
  }

  const [created] = await db
    .insert(companyPlaceSupplyRules)
    .values({ companyId, countryIso: data.countryIso, placeTypes: data.placeTypes, contactId: data.contactId ?? null, products: data.products, note: data.note ?? null, addedById: userId, addedByName: userName })
    .returning();
  return created;
}

export async function updateCompanyPlaceSupplyRule(companyId: string, ruleId: string, data: {
  countryIso?: string; placeTypes?: string[]; contactId?: string | null; products?: string[]; note?: string | null; isActive?: boolean;
}) {
  const [updated] = await db.update(companyPlaceSupplyRules).set({ ...data, updatedAt: new Date() }).where(and(eq(companyPlaceSupplyRules.id, ruleId), eq(companyPlaceSupplyRules.companyId, companyId))).returning();
  return updated ?? null;
}

export async function deleteCompanyPlaceSupplyRule(companyId: string, ruleId: string) {
  const [deleted] = await db.delete(companyPlaceSupplyRules).where(and(eq(companyPlaceSupplyRules.id, ruleId), eq(companyPlaceSupplyRules.companyId, companyId))).returning({ id: companyPlaceSupplyRules.id });
  return deleted ?? null;
}

export async function reapplyCompanyPlaceSupplyRule(companyId: string, ruleId: string) {
  const [rule] = await db.select().from(companyPlaceSupplyRules).where(and(eq(companyPlaceSupplyRules.id, ruleId), eq(companyPlaceSupplyRules.companyId, companyId))).limit(1);
  if (!rule) return null;

  // Find places matching the rule and apply as supply ports
  const matchingPlaces = await db
    .select({ id: places.id, name: places.name })
    .from(places)
    .where(and(eq(places.countryIso, rule.countryIso), inArray(places.placeType, rule.placeTypes as any)))
    .limit(50);

  for (const place of matchingPlaces) {
    const [existing] = await db
      .select({ id: portSuppliers.id })
      .from(portSuppliers)
      .where(and(eq(portSuppliers.companyId, companyId), eq(portSuppliers.placeId, place.id)))
      .limit(1);
    if (existing) continue;

    await db.insert(portSuppliers as any).values({
      companyId: companyId,
      counterpartyId: companyId,
      placeId: place.id,
      source: COMPANY_PLACE_SUPPLY_RULE_SOURCE,
      contactId: rule.contactId ?? null,
      products: rule.products,
      note: rule.note ?? null,
      isActive: rule.isActive ?? true,
    }).onConflictDoNothing();
  }

  return { applied: matchingPlaces.length };
}

export async function applyMatchingCompanyPlaceSupplyRulesForPlace(placeId: string) {
  const [place] = await db.select({ countryIso: places.countryIso, type: places.placeType }).from(places).where(eq(places.id, placeId)).limit(1);
  if (!place?.countryIso) return;

  const rules = await db
    .select()
    .from(companyPlaceSupplyRules)
    .where(and(eq(companyPlaceSupplyRules.countryIso, place.countryIso), sql`${place.type} = ANY(${companyPlaceSupplyRules.placeTypes})`));

  for (const rule of rules) {
    const [existing] = await db
      .select({ id: portSuppliers.id })
      .from(portSuppliers)
      .where(and(eq(portSuppliers.companyId, rule.companyId), eq(portSuppliers.placeId, placeId)))
      .limit(1);
    if (existing) continue;

    await db.insert(portSuppliers as any).values({
      companyId: rule.companyId,
      counterpartyId: rule.companyId,
      placeId,
      source: COMPANY_PLACE_SUPPLY_RULE_SOURCE,
      contactId: rule.contactId ?? null,
      products: rule.products,
      note: rule.note ?? null,
      isActive: rule.isActive ?? true,
    }).onConflictDoNothing();
  }
}
