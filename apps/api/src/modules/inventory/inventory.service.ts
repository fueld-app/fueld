// ═══════════════════════════════════════════════════════════════════════
//  Inventory Service — warehouses, SKUs, ledger, reservations,
//  replenishment plans, and availability calculation.
//
//  Stock model:
//    onHand        = sum of past `inventory_movements.quantity` (signed)
//    reserved      = sum of active outbound `inventory_reservations.quantity`
//    availableNow  = onHand - reserved
//    plannedInbound  = sum of pending replenishment plans + future inbound movements
//    plannedOutbound = sum of future outbound reservations
//
//  Availability for an outbound delivery `(qty, neededAt)`:
//    Walk a chronologically-sorted timeline of inbound increments and outbound
//    decrements (movements + reservations + replenishment plans). The earliest
//    timestamp at which cumulative balance is ≥ qty AND ≤ neededAt indicates
//    feasibility; otherwise return that earliest timestamp as a deferral signal.
// ═══════════════════════════════════════════════════════════════════════

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  counterparties,
  inventoryMovements,
  inventoryReplenishmentPlans,
  inventoryReservations,
  inventorySkus,
  orders,
  places,
  tenants,
  users,
  vessels,
  warehouses,
} from '../../db/schema';
import type {
  CreateInventorySkuDto,
  CreateReplenishmentPlanDto,
  CreateWarehouseDto,
  InventoryAvailabilityCheckDto,
  InventoryAvailabilityResultDto,
  InventoryBalanceDto,
  InventoryMovementDto,
  InventoryMovementType,
  InventoryReplenishmentPlanDto,
  InventoryReservationDto,
  InventorySkuDto,
  ReplenishmentStatus,
  ReservationDirection,
  UpdateInventorySkuDto,
  UpdateReplenishmentPlanDto,
  UpdateWarehouseDto,
  WarehouseDto,
} from '@fueld/types';

// ─── Tenant helper ──────────────────────────────────────────────────

async function getTenantId(): Promise<string> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');
  return tenant.id;
}

// ─── Numeric helpers ────────────────────────────────────────────────

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toFixedString(n: number, scale = 3): string {
  return n.toFixed(scale);
}

// ═══════════════════════════════════════════════════════════════════════
//  INVENTORY SKUS
// ═══════════════════════════════════════════════════════════════════════

function mapSku(row: typeof inventorySkus.$inferSelect): InventorySkuDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    // The database stores enum string codes; cast to the shared ProductType.
    productType: row.productType as InventorySkuDto['productType'],
    grade: row.grade ?? null,
    displayName: row.displayName,
    baseUnit: row.baseUnit,
    inventoryTracked: row.inventoryTracked,
    allowedUnits: (row.allowedUnits ?? []) as string[],
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function inferInventorySkuDisplayName(productType: string, grade?: string | null): string {
  const normalizedProductType = productType.trim();
  const normalizedGrade = grade?.trim();
  return normalizedGrade ? `${normalizedProductType} ${normalizedGrade}` : normalizedProductType;
}

export async function listInventorySkus(): Promise<InventorySkuDto[]> {
  const tenantId = await getTenantId();
  const rows = await db
    .select()
    .from(inventorySkus)
    .where(eq(inventorySkus.tenantId, tenantId))
    .orderBy(asc(inventorySkus.displayName));
  return rows.map(mapSku);
}

export async function getInventorySkuById(id: string): Promise<InventorySkuDto | null> {
  const [row] = await db
    .select()
    .from(inventorySkus)
    .where(eq(inventorySkus.id, id))
    .limit(1);
  return row ? mapSku(row) : null;
}

export async function createInventorySku(input: CreateInventorySkuDto): Promise<InventorySkuDto> {
  const tenantId = await getTenantId();
  const normalizedGrade = input.grade?.trim() || null;
  const normalizedDisplayName = input.displayName?.trim();
  const [created] = await db
    .insert(inventorySkus)
    .values({
      tenantId,
      // Cast string code to drizzle's enum literal type — the DB validates the value.
      productType: input.productType as typeof inventorySkus.$inferInsert.productType,
      grade: normalizedGrade,
      displayName: normalizedDisplayName || inferInventorySkuDisplayName(String(input.productType), normalizedGrade),
      baseUnit: input.baseUnit ?? 'MT',
      inventoryTracked: input.inventoryTracked ?? true,
      allowedUnits: input.allowedUnits ?? [],
    })
    .returning();
  return mapSku(created!);
}

export async function updateInventorySku(
  id: string,
  input: UpdateInventorySkuDto,
): Promise<InventorySkuDto | null> {
  const setData: Record<string, unknown> = { updatedAt: new Date() };
  if (input.grade !== undefined) setData.grade = input.grade;
  if (input.displayName !== undefined) setData.displayName = input.displayName;
  if (input.baseUnit !== undefined) setData.baseUnit = input.baseUnit;
  if (input.inventoryTracked !== undefined) setData.inventoryTracked = input.inventoryTracked;
  if (input.allowedUnits !== undefined) setData.allowedUnits = input.allowedUnits;
  if (input.active !== undefined) setData.active = input.active;

  const [updated] = await db
    .update(inventorySkus)
    .set(setData)
    .where(eq(inventorySkus.id, id))
    .returning();
  return updated ? mapSku(updated) : null;
}

export async function deleteInventorySku(id: string): Promise<boolean> {
  // Block deletion if movements reference the SKU; SKUs participating in
  // historical movements should be deactivated rather than deleted.
  const [movement] = await db
    .select({ id: inventoryMovements.id })
    .from(inventoryMovements)
    .where(eq(inventoryMovements.skuId, id))
    .limit(1);
  if (movement) {
    throw new Error('SKU has movements and cannot be deleted; deactivate it instead.');
  }
  const result = await db
    .delete(inventorySkus)
    .where(eq(inventorySkus.id, id))
    .returning({ id: inventorySkus.id });
  return result.length > 0;
}

// ═══════════════════════════════════════════════════════════════════════
//  WAREHOUSES
// ═══════════════════════════════════════════════════════════════════════

const warehouseSelectFields = {
  id: warehouses.id,
  tenantId: warehouses.tenantId,
  ownerCompanyId: warehouses.ownerCompanyId,
  ownerCompanyName: counterparties.name,
  name: warehouses.name,
  type: warehouses.type,
  vesselId: warehouses.vesselId,
  vesselName: vessels.name,
  placeId: warehouses.placeId,
  placeName: places.name,
  inventoryEnabled: warehouses.inventoryEnabled,
  allowManualReplenishment: warehouses.allowManualReplenishment,
  active: warehouses.active,
  notes: warehouses.notes,
  createdAt: warehouses.createdAt,
  updatedAt: warehouses.updatedAt,
} as const;

function mapWarehouseRow(row: {
  id: string;
  tenantId: string;
  ownerCompanyId: string;
  ownerCompanyName: string | null;
  name: string;
  type: string;
  vesselId: string | null;
  vesselName: string | null;
  placeId: string | null;
  placeName: string | null;
  inventoryEnabled: boolean;
  allowManualReplenishment: boolean;
  active: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}): WarehouseDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    ownerCompanyId: row.ownerCompanyId,
    ownerCompanyName: row.ownerCompanyName ?? '',
    name: row.name,
    type: row.type as WarehouseDto['type'],
    vesselId: row.vesselId,
    vesselName: row.vesselName,
    placeId: row.placeId,
    placeName: row.placeName,
    inventoryEnabled: row.inventoryEnabled,
    allowManualReplenishment: row.allowManualReplenishment,
    active: row.active,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listWarehouses(filters?: {
  ownerCompanyId?: string;
  vesselId?: string;
  inventoryEnabledOnly?: boolean;
  activeOnly?: boolean;
}): Promise<WarehouseDto[]> {
  const tenantId = await getTenantId();
  const conds = [eq(warehouses.tenantId, tenantId)];
  if (filters?.ownerCompanyId) conds.push(eq(warehouses.ownerCompanyId, filters.ownerCompanyId));
  if (filters?.vesselId) conds.push(eq(warehouses.vesselId, filters.vesselId));
  if (filters?.inventoryEnabledOnly) conds.push(eq(warehouses.inventoryEnabled, true));
  if (filters?.activeOnly) conds.push(eq(warehouses.active, true));

  const rows = await db
    .select(warehouseSelectFields)
    .from(warehouses)
    .innerJoin(counterparties, eq(warehouses.ownerCompanyId, counterparties.id))
    .leftJoin(vessels, eq(warehouses.vesselId, vessels.id))
    .leftJoin(places, eq(warehouses.placeId, places.id))
    .where(and(...conds))
    .orderBy(asc(warehouses.name));

  return rows.map(mapWarehouseRow);
}

export async function getWarehouseById(id: string): Promise<WarehouseDto | null> {
  const [row] = await db
    .select(warehouseSelectFields)
    .from(warehouses)
    .innerJoin(counterparties, eq(warehouses.ownerCompanyId, counterparties.id))
    .leftJoin(vessels, eq(warehouses.vesselId, vessels.id))
    .leftJoin(places, eq(warehouses.placeId, places.id))
    .where(eq(warehouses.id, id))
    .limit(1);
  return row ? mapWarehouseRow(row) : null;
}

export async function createWarehouse(input: CreateWarehouseDto): Promise<WarehouseDto> {
  const tenantId = await getTenantId();

  // Verify the owner is physical-ops eligible.
  const [owner] = await db
    .select({
      id: counterparties.id,
      physicalOpsEnabled: counterparties.physicalOpsEnabled,
    })
    .from(counterparties)
    .where(and(eq(counterparties.id, input.ownerCompanyId), eq(counterparties.tenantId, tenantId)))
    .limit(1);
  if (!owner) throw new Error('Owner company not found');
  if (!owner.physicalOpsEnabled) {
    throw new Error('Owner company is not enabled for physical operations');
  }

  const [created] = await db
    .insert(warehouses)
    .values({
      tenantId,
      ownerCompanyId: input.ownerCompanyId,
      name: input.name,
      type: (input.type ?? 'VESSEL') as 'VESSEL',
      vesselId: input.vesselId ?? null,
      placeId: input.placeId ?? null,
      inventoryEnabled: input.inventoryEnabled ?? false,
      allowManualReplenishment: input.allowManualReplenishment ?? true,
      notes: input.notes ?? null,
    })
    .returning();
  const dto = await getWarehouseById(created!.id);
  if (!dto) throw new Error('Failed to load created warehouse');
  return dto;
}

export async function updateWarehouse(
  id: string,
  input: UpdateWarehouseDto,
): Promise<WarehouseDto | null> {
  const setData: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) setData.name = input.name;
  if (input.type !== undefined) setData.type = input.type;
  if (input.vesselId !== undefined) setData.vesselId = input.vesselId;
  if (input.placeId !== undefined) setData.placeId = input.placeId;
  if (input.inventoryEnabled !== undefined) setData.inventoryEnabled = input.inventoryEnabled;
  if (input.allowManualReplenishment !== undefined) {
    setData.allowManualReplenishment = input.allowManualReplenishment;
  }
  if (input.active !== undefined) setData.active = input.active;
  if (input.notes !== undefined) setData.notes = input.notes;

  await db.update(warehouses).set(setData).where(eq(warehouses.id, id));
  return getWarehouseById(id);
}

// ═══════════════════════════════════════════════════════════════════════
//  MOVEMENTS LEDGER
// ═══════════════════════════════════════════════════════════════════════

interface RecordMovementInput {
  warehouseId: string;
  skuId: string;
  /** Signed quantity in base units. Positive = inbound, negative = outbound. */
  quantity: number;
  unit?: string;
  movementType: InventoryMovementType;
  occurredAt: Date;
  orderId?: string | null;
  orderItemId?: string | null;
  replenishmentPlanId?: string | null;
  note?: string | null;
  createdBy?: string | null;
}

export async function recordMovement(
  input: RecordMovementInput,
): Promise<InventoryMovement> {
  const tenantId = await getTenantId();
  const [created] = await db
    .insert(inventoryMovements)
    .values({
      tenantId,
      warehouseId: input.warehouseId,
      skuId: input.skuId,
      quantity: toFixedString(input.quantity),
      unit: input.unit ?? 'MT',
      movementType: input.movementType,
      occurredAt: input.occurredAt,
      orderId: input.orderId ?? null,
      orderItemId: input.orderItemId ?? null,
      replenishmentPlanId: input.replenishmentPlanId ?? null,
      note: input.note ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return created!;
}

type InventoryMovement = typeof inventoryMovements.$inferSelect;

export async function listMovementsByWarehouse(warehouseId: string): Promise<InventoryMovementDto[]> {
  const rows = await db
    .select({
      id: inventoryMovements.id,
      warehouseId: inventoryMovements.warehouseId,
      warehouseName: warehouses.name,
      skuId: inventoryMovements.skuId,
      skuDisplayName: inventorySkus.displayName,
      quantity: inventoryMovements.quantity,
      unit: inventoryMovements.unit,
      movementType: inventoryMovements.movementType,
      occurredAt: inventoryMovements.occurredAt,
      orderId: inventoryMovements.orderId,
      orderItemId: inventoryMovements.orderItemId,
      replenishmentPlanId: inventoryMovements.replenishmentPlanId,
      note: inventoryMovements.note,
      createdByName: users.name,
      createdAt: inventoryMovements.createdAt,
    })
    .from(inventoryMovements)
    .innerJoin(warehouses, eq(inventoryMovements.warehouseId, warehouses.id))
    .innerJoin(inventorySkus, eq(inventoryMovements.skuId, inventorySkus.id))
    .leftJoin(users, eq(inventoryMovements.createdBy, users.id))
    .where(eq(inventoryMovements.warehouseId, warehouseId))
    .orderBy(desc(inventoryMovements.occurredAt));

  return rows.map((r) => ({
    id: r.id,
    warehouseId: r.warehouseId,
    warehouseName: r.warehouseName,
    skuId: r.skuId,
    skuDisplayName: r.skuDisplayName,
    quantity: r.quantity,
    unit: r.unit,
    movementType: r.movementType as InventoryMovementType,
    occurredAt: r.occurredAt.toISOString(),
    orderId: r.orderId,
    orderItemId: r.orderItemId,
    replenishmentPlanId: r.replenishmentPlanId,
    note: r.note,
    createdByName: r.createdByName,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ═══════════════════════════════════════════════════════════════════════
//  RESERVATIONS
// ═══════════════════════════════════════════════════════════════════════

interface UpsertReservationInput {
  warehouseId: string;
  skuId: string;
  quantity: number;
  unit?: string;
  reservedFor: Date;
  orderId: string;
  orderItemId: string;
  direction?: ReservationDirection;
}

export async function upsertReservation(input: UpsertReservationInput) {
  const tenantId = await getTenantId();
  // Drop any prior (or stale) reservation for this order item, then insert fresh.
  await db
    .delete(inventoryReservations)
    .where(eq(inventoryReservations.orderItemId, input.orderItemId));

  const [created] = await db
    .insert(inventoryReservations)
    .values({
      tenantId,
      warehouseId: input.warehouseId,
      skuId: input.skuId,
      quantity: toFixedString(input.quantity),
      unit: input.unit ?? 'MT',
      reservedFor: input.reservedFor,
      orderId: input.orderId,
      orderItemId: input.orderItemId,
      direction: input.direction ?? 'OUTBOUND',
    })
    .returning();
  return created!;
}

export async function releaseReservationByOrderItem(orderItemId: string) {
  await db
    .delete(inventoryReservations)
    .where(eq(inventoryReservations.orderItemId, orderItemId));
}

export async function releaseReservationsByOrder(orderId: string) {
  await db
    .delete(inventoryReservations)
    .where(eq(inventoryReservations.orderId, orderId));
}

// ═══════════════════════════════════════════════════════════════════════
//  REPLENISHMENT PLANS
// ═══════════════════════════════════════════════════════════════════════

export async function listReplenishmentPlans(filters?: {
  warehouseId?: string;
  skuId?: string;
  status?: ReplenishmentStatus;
}): Promise<InventoryReplenishmentPlanDto[]> {
  const tenantId = await getTenantId();
  const conds = [eq(inventoryReplenishmentPlans.tenantId, tenantId)];
  if (filters?.warehouseId) conds.push(eq(inventoryReplenishmentPlans.warehouseId, filters.warehouseId));
  if (filters?.skuId) conds.push(eq(inventoryReplenishmentPlans.skuId, filters.skuId));
  if (filters?.status) conds.push(eq(inventoryReplenishmentPlans.status, filters.status));

  const rows = await db
    .select({
      id: inventoryReplenishmentPlans.id,
      warehouseId: inventoryReplenishmentPlans.warehouseId,
      warehouseName: warehouses.name,
      skuId: inventoryReplenishmentPlans.skuId,
      skuDisplayName: inventorySkus.displayName,
      quantity: inventoryReplenishmentPlans.quantity,
      unit: inventoryReplenishmentPlans.unit,
      expectedAt: inventoryReplenishmentPlans.expectedAt,
      status: inventoryReplenishmentPlans.status,
      orderId: inventoryReplenishmentPlans.orderId,
      orderNumber: orders.orderNumber,
      note: inventoryReplenishmentPlans.note,
      createdByName: users.name,
      createdAt: inventoryReplenishmentPlans.createdAt,
      updatedAt: inventoryReplenishmentPlans.updatedAt,
    })
    .from(inventoryReplenishmentPlans)
    .innerJoin(warehouses, eq(inventoryReplenishmentPlans.warehouseId, warehouses.id))
    .innerJoin(inventorySkus, eq(inventoryReplenishmentPlans.skuId, inventorySkus.id))
    .leftJoin(orders, eq(inventoryReplenishmentPlans.orderId, orders.id))
    .leftJoin(users, eq(inventoryReplenishmentPlans.createdBy, users.id))
    .where(and(...conds))
    .orderBy(asc(inventoryReplenishmentPlans.expectedAt));

  return rows.map((r) => ({
    id: r.id,
    warehouseId: r.warehouseId,
    warehouseName: r.warehouseName,
    skuId: r.skuId,
    skuDisplayName: r.skuDisplayName,
    quantity: r.quantity,
    unit: r.unit,
    expectedAt: r.expectedAt.toISOString(),
    status: r.status as ReplenishmentStatus,
    orderId: r.orderId,
    orderNumber: r.orderNumber,
    note: r.note,
    createdByName: r.createdByName,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function createReplenishmentPlan(
  input: CreateReplenishmentPlanDto,
  userId?: string | null,
): Promise<InventoryReplenishmentPlanDto> {
  const tenantId = await getTenantId();

  // Verify warehouse allows manual replenishment when no order link is set.
  const [warehouse] = await db
    .select({
      id: warehouses.id,
      allowManualReplenishment: warehouses.allowManualReplenishment,
      inventoryEnabled: warehouses.inventoryEnabled,
    })
    .from(warehouses)
    .where(eq(warehouses.id, input.warehouseId))
    .limit(1);
  if (!warehouse) throw new Error('Warehouse not found');
  if (!warehouse.inventoryEnabled) {
    throw new Error('Warehouse has inventory disabled');
  }
  if (!input.orderId && !warehouse.allowManualReplenishment) {
    throw new Error('Manual replenishment is disabled for this warehouse');
  }

  const [created] = await db
    .insert(inventoryReplenishmentPlans)
    .values({
      tenantId,
      warehouseId: input.warehouseId,
      skuId: input.skuId,
      quantity: input.quantity,
      unit: input.unit ?? 'MT',
      expectedAt: new Date(input.expectedAt),
      status: input.orderId ? 'LINKED' : 'PLANNED',
      orderId: input.orderId ?? null,
      note: input.note ?? null,
      createdBy: userId ?? null,
    })
    .returning();

  const list = await listReplenishmentPlans({ warehouseId: input.warehouseId });
  const dto = list.find((p) => p.id === created!.id);
  if (!dto) throw new Error('Failed to load created replenishment plan');
  return dto;
}

export async function updateReplenishmentPlan(
  id: string,
  input: UpdateReplenishmentPlanDto,
): Promise<InventoryReplenishmentPlanDto | null> {
  const setData: Record<string, unknown> = { updatedAt: new Date() };
  if (input.quantity !== undefined) setData.quantity = input.quantity;
  if (input.unit !== undefined) setData.unit = input.unit;
  if (input.expectedAt !== undefined) setData.expectedAt = new Date(input.expectedAt);
  if (input.status !== undefined) setData.status = input.status;
  if (input.orderId !== undefined) setData.orderId = input.orderId;
  if (input.note !== undefined) setData.note = input.note;

  const [updated] = await db
    .update(inventoryReplenishmentPlans)
    .set(setData)
    .where(eq(inventoryReplenishmentPlans.id, id))
    .returning();
  if (!updated) return null;
  const list = await listReplenishmentPlans({ warehouseId: updated.warehouseId });
  return list.find((p) => p.id === id) ?? null;
}

export async function cancelReplenishmentPlan(id: string) {
  await db
    .update(inventoryReplenishmentPlans)
    .set({ status: 'CANCELLED', updatedAt: new Date() })
    .where(eq(inventoryReplenishmentPlans.id, id));
}

/** Convert a replenishment plan into a real movement (used when an inbound order is delivered). */
export async function completeReplenishmentPlan(
  id: string,
  args: { occurredAt: Date; orderId?: string | null; orderItemId?: string | null; createdBy?: string | null },
) {
  const [plan] = await db
    .select()
    .from(inventoryReplenishmentPlans)
    .where(eq(inventoryReplenishmentPlans.id, id))
    .limit(1);
  if (!plan) throw new Error('Replenishment plan not found');
  if (plan.status === 'COMPLETED') return;

  await recordMovement({
    warehouseId: plan.warehouseId,
    skuId: plan.skuId,
    quantity: toNumber(plan.quantity),
    unit: plan.unit,
    movementType: 'INBOUND_DELIVERY',
    occurredAt: args.occurredAt,
    orderId: args.orderId ?? plan.orderId ?? null,
    orderItemId: args.orderItemId ?? null,
    replenishmentPlanId: plan.id,
    createdBy: args.createdBy ?? null,
  });

  await db
    .update(inventoryReplenishmentPlans)
    .set({ status: 'COMPLETED', updatedAt: new Date() })
    .where(eq(inventoryReplenishmentPlans.id, id));
}

// ═══════════════════════════════════════════════════════════════════════
//  AVAILABILITY CALCULATION
// ═══════════════════════════════════════════════════════════════════════

interface TimelineEvent {
  at: Date;
  delta: number; // signed, in base units
}

async function buildTimelineEvents(
  warehouseId: string,
  skuId: string,
): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];

  // Past + dated movements (always counted with their occurredAt).
  const movements = await db
    .select({
      occurredAt: inventoryMovements.occurredAt,
      quantity: inventoryMovements.quantity,
    })
    .from(inventoryMovements)
    .where(and(
      eq(inventoryMovements.warehouseId, warehouseId),
      eq(inventoryMovements.skuId, skuId),
    ));
  for (const m of movements) {
    events.push({ at: m.occurredAt, delta: toNumber(m.quantity) });
  }

  // Active outbound reservations consume stock at reservedFor.
  const reservations = await db
    .select({
      reservedFor: inventoryReservations.reservedFor,
      quantity: inventoryReservations.quantity,
      releasedAt: inventoryReservations.releasedAt,
    })
    .from(inventoryReservations)
    .where(and(
      eq(inventoryReservations.warehouseId, warehouseId),
      eq(inventoryReservations.skuId, skuId),
      isNull(inventoryReservations.releasedAt),
    ));
  for (const r of reservations) {
    events.push({ at: r.reservedFor, delta: -toNumber(r.quantity) });
  }

  // Pending replenishment plans add inbound stock at expectedAt.
  const plans = await db
    .select({
      expectedAt: inventoryReplenishmentPlans.expectedAt,
      quantity: inventoryReplenishmentPlans.quantity,
      status: inventoryReplenishmentPlans.status,
    })
    .from(inventoryReplenishmentPlans)
    .where(and(
      eq(inventoryReplenishmentPlans.warehouseId, warehouseId),
      eq(inventoryReplenishmentPlans.skuId, skuId),
    ));
  for (const p of plans) {
    if (p.status === 'PLANNED' || p.status === 'LINKED') {
      events.push({ at: p.expectedAt, delta: toNumber(p.quantity) });
    }
  }

  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  return events;
}

/** Compute the canonical balance summary for a (warehouse, SKU) pair. */
export async function getBalance(warehouseId: string, skuId: string): Promise<{
  onHand: number;
  reserved: number;
  availableNow: number;
  plannedInbound: number;
  plannedOutbound: number;
  earliestAvailableAt: Date | null;
}> {
  const events = await buildTimelineEvents(warehouseId, skuId);
  const now = new Date();

  let onHand = 0;
  let plannedInbound = 0;
  let plannedOutbound = 0;
  for (const e of events) {
    if (e.at <= now && e.delta !== 0 /* movements only at past moments */) {
      // We can't distinguish movement vs reservation/plan from events alone here;
      // recompute precisely from sources to keep onHand and reserved separate.
    }
  }

  // Recompute precisely from sources for clarity.
  const movementsAgg = await db
    .select({ sum: sql<string>`coalesce(sum(${inventoryMovements.quantity}::numeric), 0)::text` })
    .from(inventoryMovements)
    .where(and(
      eq(inventoryMovements.warehouseId, warehouseId),
      eq(inventoryMovements.skuId, skuId),
    ));
  onHand = toNumber(movementsAgg[0]?.sum);

  const reservationsAgg = await db
    .select({ sum: sql<string>`coalesce(sum(${inventoryReservations.quantity}::numeric), 0)::text` })
    .from(inventoryReservations)
    .where(and(
      eq(inventoryReservations.warehouseId, warehouseId),
      eq(inventoryReservations.skuId, skuId),
      isNull(inventoryReservations.releasedAt),
    ));
  const reserved = toNumber(reservationsAgg[0]?.sum);

  // Future replenishment plans (PLANNED + LINKED, expectedAt >= now).
  const plannedRows = await db
    .select({ quantity: inventoryReplenishmentPlans.quantity, expectedAt: inventoryReplenishmentPlans.expectedAt, status: inventoryReplenishmentPlans.status })
    .from(inventoryReplenishmentPlans)
    .where(and(
      eq(inventoryReplenishmentPlans.warehouseId, warehouseId),
      eq(inventoryReplenishmentPlans.skuId, skuId),
    ));
  for (const p of plannedRows) {
    if ((p.status === 'PLANNED' || p.status === 'LINKED') && p.expectedAt >= now) {
      plannedInbound += toNumber(p.quantity);
    }
  }

  const futureReservationRows = await db
    .select({ quantity: inventoryReservations.quantity, reservedFor: inventoryReservations.reservedFor })
    .from(inventoryReservations)
    .where(and(
      eq(inventoryReservations.warehouseId, warehouseId),
      eq(inventoryReservations.skuId, skuId),
      isNull(inventoryReservations.releasedAt),
    ));
  for (const r of futureReservationRows) {
    if (r.reservedFor >= now) plannedOutbound += toNumber(r.quantity);
  }

  const availableNow = onHand - reserved;

  // Earliest moment availableNow ≥ 0 (ie no shortfall) — if already >= 0 it's now, else find first inbound that bridges the gap.
  let earliestAvailableAt: Date | null = availableNow >= 0 ? null : null;
  if (availableNow < 0) {
    let running = onHand;
    for (const e of events) {
      running += e.delta;
      if (running >= 0) {
        earliestAvailableAt = e.at;
        break;
      }
    }
  }

  return { onHand, reserved, availableNow, plannedInbound, plannedOutbound, earliestAvailableAt };
}

/** Check whether `quantity` can be delivered from a warehouse by `neededAt`. */
export async function checkAvailability(
  input: InventoryAvailabilityCheckDto,
): Promise<InventoryAvailabilityResultDto> {
  const events = await buildTimelineEvents(input.warehouseId, input.skuId);
  const needed = toNumber(input.quantity);
  const neededAt = new Date(input.neededAt);

  // Sum past + future events up to and including neededAt; deduct desired qty.
  // We compute the cumulative balance trajectory and find the earliest time it
  // stays at or above the requested quantity through neededAt.
  let balance = 0;
  let earliestPossible: Date | null = null;

  // Build a candidate timeline: all event timestamps plus neededAt itself.
  const stops = [...events, { at: neededAt, delta: 0 } as TimelineEvent].sort(
    (a, b) => a.at.getTime() - b.at.getTime(),
  );

  let runningMin = Infinity;
  for (const e of stops) {
    balance += e.delta;
    if (e.at.getTime() <= neededAt.getTime()) {
      if (balance >= needed && earliestPossible === null) {
        earliestPossible = e.at;
      }
    }
  }

  // Final balance at neededAt.
  let balanceAtNeed = 0;
  for (const e of events) {
    if (e.at.getTime() <= neededAt.getTime()) balanceAtNeed += e.delta;
  }

  if (balanceAtNeed >= needed) {
    return {
      ok: true,
      earliestAvailableAt: (earliestPossible ?? neededAt).toISOString(),
      shortageQuantity: null,
      reason: null,
    };
  }

  // Not enough by neededAt — find the earliest time in the future where balance ≥ needed.
  let futureBalance = 0;
  let earliestFuture: Date | null = null;
  for (const e of events) {
    futureBalance += e.delta;
    if (futureBalance >= needed) {
      earliestFuture = e.at;
      break;
    }
  }

  return {
    ok: false,
    earliestAvailableAt: earliestFuture ? earliestFuture.toISOString() : null,
    shortageQuantity: toFixedString(needed - balanceAtNeed),
    reason: earliestFuture
      ? `Stock not sufficient until ${earliestFuture.toISOString()}`
      : 'Insufficient stock and no future replenishment covers the shortfall',
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  INVENTORY OVERVIEW (aggregate balances across warehouses + SKUs)
// ═══════════════════════════════════════════════════════════════════════

export async function getInventoryOverview(filters?: {
  ownerCompanyId?: string;
  warehouseId?: string;
  vesselId?: string;
}): Promise<InventoryBalanceDto[]> {
  const warehouseList = await listWarehouses({
    ownerCompanyId: filters?.ownerCompanyId,
    vesselId: filters?.vesselId,
    activeOnly: true,
    inventoryEnabledOnly: true,
  });
  const skus = await listInventorySkus();
  const trackedSkus = skus.filter((s) => s.inventoryTracked && s.active);

  const targetWarehouses = filters?.warehouseId
    ? warehouseList.filter((w) => w.id === filters.warehouseId)
    : warehouseList;

  const out: InventoryBalanceDto[] = [];
  for (const wh of targetWarehouses) {
    for (const sku of trackedSkus) {
      const bal = await getBalance(wh.id, sku.id);
      // Skip rows with no activity at all to keep the overview compact.
      if (
        bal.onHand === 0 &&
        bal.reserved === 0 &&
        bal.plannedInbound === 0 &&
        bal.plannedOutbound === 0
      ) {
        continue;
      }
      out.push({
        warehouseId: wh.id,
        warehouseName: wh.name,
        ownerCompanyId: wh.ownerCompanyId,
        ownerCompanyName: wh.ownerCompanyName,
        vesselId: wh.vesselId,
        vesselName: wh.vesselName,
        skuId: sku.id,
        skuDisplayName: sku.displayName,
        productType: sku.productType,
        grade: sku.grade,
        baseUnit: sku.baseUnit,
        onHand: toFixedString(bal.onHand),
        reserved: toFixedString(bal.reserved),
        availableNow: toFixedString(bal.availableNow),
        plannedInbound: toFixedString(bal.plannedInbound),
        plannedOutbound: toFixedString(bal.plannedOutbound),
        earliestAvailableAt: bal.earliestAvailableAt
          ? bal.earliestAvailableAt.toISOString()
          : null,
      });
    }
  }
  return out;
}
