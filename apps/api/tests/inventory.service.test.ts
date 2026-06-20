// ═══════════════════════════════════════════════════════════════════════
//  Inventory Service — focused coverage of availability + replenishment.
//
//  Verifies the core invariants from the implementation plan:
//    1. zero stock blocks an outbound check until the next replenishment
//    2. completing a replenishment plan early shifts availability earlier
//    3. reservations reduce availability immediately at confirmation
//    4. manual replenishment can be disabled per-warehouse
// ═══════════════════════════════════════════════════════════════════════

import { describe, expect, test, beforeAll, beforeEach } from 'bun:test';
import { eq } from 'drizzle-orm';
import { getDb, seedBasics, truncateAll } from './helpers/db';
import * as inventory from '../src/modules/inventory/inventory.service';
import { counterparties, inventorySkus, warehouses } from '../src/db/schema';

let context: Awaited<ReturnType<typeof seedBasics>>;
let warehouseId: string;
let skuId: string;

beforeAll(async () => {
  await truncateAll();
});

beforeEach(async () => {
  await truncateAll();
  context = await seedBasics();

  // Mark tenant company as own + physical-ops so we can create warehouses for it.
  const db = await getDb();
  await db
    .update(counterparties)
    .set({ isOwnCompany: true, physicalOpsEnabled: true })
    .where(eq(counterparties.id, context.client.id));

  const wh = await inventory.createWarehouse({
    ownerCompanyId: context.client.id,
    name: 'Test Warehouse',
    type: 'VESSEL',
    vesselId: context.vessel.id,
    inventoryEnabled: true,
    allowManualReplenishment: true,
  });
  warehouseId = wh.id;

  const sku = await inventory.createInventorySku({
    productType: 'VLSFO' as never,
    grade: 'RMG 380',
    displayName: 'VLSFO RMG 380',
    baseUnit: 'MT',
    inventoryTracked: true,
  });
  skuId = sku.id;
});

describe('inventory availability', () => {
  test('zero stock makes a check fail and points to the next replenishment', async () => {
    const future = new Date(Date.now() + 5 * 86_400_000); // +5 days
    await inventory.createReplenishmentPlan({
      warehouseId,
      skuId,
      quantity: '500',
      unit: 'MT',
      expectedAt: future.toISOString(),
    });

    // Need 200 MT now (before the replenishment).
    const now = new Date();
    const result = await inventory.checkAvailability({
      warehouseId,
      skuId,
      quantity: '200',
      neededAt: now.toISOString(),
    });

    expect(result.ok).toBe(false);
    expect(result.earliestAvailableAt).not.toBeNull();
    // The earliest moment we can deliver should equal the replenishment time.
    if (result.earliestAvailableAt) {
      expect(new Date(result.earliestAvailableAt).getTime()).toBe(future.getTime());
    }
  });

  test('replenishment delivered early via completeReplenishmentPlan moves availability earlier', async () => {
    const future = new Date(Date.now() + 5 * 86_400_000);
    const plan = await inventory.createReplenishmentPlan({
      warehouseId,
      skuId,
      quantity: '500',
      unit: 'MT',
      expectedAt: future.toISOString(),
    });

    // Realize the replenishment 1 day early.
    const earlyArrival = new Date(Date.now() + 4 * 86_400_000);
    await inventory.completeReplenishmentPlan(plan.id, { occurredAt: earlyArrival });

    const result = await inventory.checkAvailability({
      warehouseId,
      skuId,
      quantity: '200',
      neededAt: future.toISOString(),
    });
    expect(result.ok).toBe(true);
    if (result.earliestAvailableAt) {
      expect(new Date(result.earliestAvailableAt).getTime()).toBe(earlyArrival.getTime());
    }
  });

  test('reservations reduce availableNow immediately', async () => {
    // Seed 1000 MT of stock via an opening balance movement.
    await inventory.recordMovement({
      warehouseId,
      skuId,
      quantity: 1000,
      unit: 'MT',
      movementType: 'OPENING_BALANCE',
      occurredAt: new Date(Date.now() - 86_400_000),
    });

    // Create an outbound reservation against a synthetic order/item.
    // Inserting raw rows is acceptable because the production path runs through
    // `updateOrderStatus` which we cover in higher-level e2e tests.
    const db = await getDb();
    const { orders, orderItems, tenants } = await import('../src/db/schema');
    const [tenant] = await db.select().from(tenants).limit(1);
    const [order] = await db.insert(orders).values({
      tenantId: tenant!.id,
      clientId: context.client.id,
      vesselId: context.vessel.id,
      placeId: context.place.id,
    }).returning();
    const [item] = await db.insert(orderItems).values({
      orderId: order!.id,
      productType: 'VLSFO',
      quantity: '300',
      unit: 'MT',
      inventorySkuId: skuId,
      warehouseId,
    }).returning();

    await inventory.upsertReservation({
      warehouseId,
      skuId,
      quantity: 300,
      reservedFor: new Date(),
      orderId: order!.id,
      orderItemId: item!.id,
    });

    const balance = await inventory.getBalance(warehouseId, skuId);
    expect(balance.onHand).toBe(1000);
    expect(balance.reserved).toBe(300);
    expect(balance.availableNow).toBe(700);
  });

  test('manual replenishment can be blocked per warehouse', async () => {
    const db = await getDb();
    await db
      .update(warehouses)
      .set({ allowManualReplenishment: false })
      .where(eq(warehouses.id, warehouseId));

    let error: Error | null = null;
    try {
      await inventory.createReplenishmentPlan({
        warehouseId,
        skuId,
        quantity: '100',
        unit: 'MT',
        expectedAt: new Date().toISOString(),
      });
    } catch (err) {
      error = err as Error;
    }
    expect(error).not.toBeNull();
    expect(error?.message).toContain('Manual replenishment');
  });

  test('SKU deletion is blocked when movements exist', async () => {
    await inventory.recordMovement({
      warehouseId,
      skuId,
      quantity: 50,
      unit: 'MT',
      movementType: 'OPENING_BALANCE',
      occurredAt: new Date(),
    });

    let error: Error | null = null;
    try {
      await inventory.deleteInventorySku(skuId);
    } catch (err) {
      error = err as Error;
    }
    expect(error).not.toBeNull();
  });

  test('checkAvailability passes immediately when stock covers the request', async () => {
    await inventory.recordMovement({
      warehouseId,
      skuId,
      quantity: 1000,
      unit: 'MT',
      movementType: 'OPENING_BALANCE',
      occurredAt: new Date(Date.now() - 86_400_000),
    });

    const result = await inventory.checkAvailability({
      warehouseId,
      skuId,
      quantity: '500',
      neededAt: new Date().toISOString(),
    });
    expect(result.ok).toBe(true);
    expect(result.shortageQuantity).toBeNull();
    expect(result.reason).toBeNull();
  });

  test('checkAvailability reports shortage with no future replenishment', async () => {
    await inventory.recordMovement({
      warehouseId,
      skuId,
      quantity: 100,
      unit: 'MT',
      movementType: 'OPENING_BALANCE',
      occurredAt: new Date(Date.now() - 86_400_000),
    });

    const result = await inventory.checkAvailability({
      warehouseId,
      skuId,
      quantity: '300',
      neededAt: new Date().toISOString(),
    });
    expect(result.ok).toBe(false);
    expect(result.earliestAvailableAt).toBeNull();
    expect(result.shortageQuantity).toBe('200.000');
    expect(result.reason).toContain('no future replenishment');
  });

  test('getBalance.earliestAvailableAt points to the next future replenishment, not a past movement', async () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    const today = new Date();
    const tomorrow = new Date(Date.now() + 86_400_000);

    // 1000 in stock yesterday, then a 1200 outbound today -> onHand = -200 (shortfall).
    await inventory.recordMovement({
      warehouseId,
      skuId,
      quantity: 1000,
      unit: 'MT',
      movementType: 'OPENING_BALANCE',
      occurredAt: yesterday,
    });
    await inventory.recordMovement({
      warehouseId,
      skuId,
      quantity: -1200,
      unit: 'MT',
      movementType: 'OUTBOUND_DELIVERY',
      occurredAt: today,
    });

    // Future replenishment that bridges the gap.
    await inventory.createReplenishmentPlan({
      warehouseId,
      skuId,
      quantity: '500',
      unit: 'MT',
      expectedAt: tomorrow.toISOString(),
    });

    const result = await inventory.getBalance(warehouseId, skuId);
    expect(result.availableNow).toBeLessThan(0);
    expect(result.earliestAvailableAt).not.toBeNull();
    // Must be the future replenishment, not the past opening-balance movement
    // (the old `running = onHand` double-count returned the past movement date).
    expect(result.earliestAvailableAt!.getTime()).toBe(tomorrow.getTime());
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  Warehouse master data
// ═══════════════════════════════════════════════════════════════════════

describe('warehouses', () => {
  test('createWarehouse rejects companies without physical_ops_enabled', async () => {
    const db = await getDb();
    // Reset the seeded company so it is no longer physical-ops eligible.
    await db
      .update(counterparties)
      .set({ physicalOpsEnabled: false })
      .where(eq(counterparties.id, context.client.id));

    let error: Error | null = null;
    try {
      await inventory.createWarehouse({
        ownerCompanyId: context.client.id,
        name: 'Bad Warehouse',
        type: 'VESSEL',
        vesselId: context.vessel.id,
        inventoryEnabled: true,
        allowManualReplenishment: true,
      });
    } catch (err) {
      error = err as Error;
    }
    expect(error).not.toBeNull();
    expect(error?.message).toContain('not enabled for physical operations');
  });

  test('updateWarehouse toggles flags and persists notes', async () => {
    const updated = await inventory.updateWarehouse(warehouseId, {
      inventoryEnabled: false,
      allowManualReplenishment: false,
      notes: 'Out of service for dry dock',
    });
    expect(updated?.inventoryEnabled).toBe(false);
    expect(updated?.allowManualReplenishment).toBe(false);
    expect(updated?.notes).toContain('dry dock');
  });

  test('listWarehouses honors inventoryEnabledOnly + activeOnly filters', async () => {
    // Disable the seeded warehouse and confirm it is filtered out.
    await inventory.updateWarehouse(warehouseId, { inventoryEnabled: false });
    const enabled = await inventory.listWarehouses({ inventoryEnabledOnly: true });
    expect(enabled.find((w) => w.id === warehouseId)).toBeUndefined();
    const all = await inventory.listWarehouses();
    expect(all.find((w) => w.id === warehouseId)).toBeDefined();
  });

  test('getWarehouseById returns null for unknown ids', async () => {
    const result = await inventory.getWarehouseById('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  Inventory SKU master data
// ═══════════════════════════════════════════════════════════════════════

describe('inventory SKUs', () => {
  test('createInventorySku enforces unique (productType, grade) per tenant', async () => {
    let error: Error | null = null;
    try {
      await inventory.createInventorySku({
        productType: 'VLSFO' as never,
        grade: 'RMG 380',
        displayName: 'Duplicate',
      });
    } catch (err) {
      error = err as Error;
    }
    expect(error).not.toBeNull();
  });

  test('createInventorySku infers displayName from productType and grade when omitted', async () => {
    const sku = await inventory.createInventorySku({
      productType: 'MGO' as never,
      grade: 'DMA',
      baseUnit: 'MT',
    });

    expect(sku.displayName).toBe('MGO DMA');
    expect(sku.grade).toBe('DMA');
  });

  test('updateInventorySku updates allowedUnits and inventoryTracked', async () => {
    const updated = await inventory.updateInventorySku(skuId, {
      allowedUnits: ['MT', 'CBM'],
      inventoryTracked: false,
    });
    expect(updated?.allowedUnits).toEqual(['MT', 'CBM']);
    expect(updated?.inventoryTracked).toBe(false);
  });

  test('deleteInventorySku succeeds when no movements reference it', async () => {
    const sku = await inventory.createInventorySku({
      productType: 'MGO' as never,
      grade: null,
      displayName: 'MGO Generic',
    });
    const ok = await inventory.deleteInventorySku(sku.id);
    expect(ok).toBe(true);
    expect(await inventory.getInventorySkuById(sku.id)).toBeNull();
  });

  test('getInventorySkuById returns null for unknown ids', async () => {
    const result = await inventory.getInventorySkuById('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  Replenishment plan lifecycle
// ═══════════════════════════════════════════════════════════════════════

describe('replenishment plans', () => {
  test('listReplenishmentPlans filters by status', async () => {
    const future = new Date(Date.now() + 5 * 86_400_000);
    const plan = await inventory.createReplenishmentPlan({
      warehouseId,
      skuId,
      quantity: '500',
      unit: 'MT',
      expectedAt: future.toISOString(),
    });
    expect(plan.status).toBe('PLANNED');

    const planned = await inventory.listReplenishmentPlans({ status: 'PLANNED' });
    expect(planned.some((p) => p.id === plan.id)).toBe(true);

    await inventory.cancelReplenishmentPlan(plan.id);
    const cancelled = await inventory.listReplenishmentPlans({ status: 'CANCELLED' });
    expect(cancelled.some((p) => p.id === plan.id)).toBe(true);
  });

  test('updateReplenishmentPlan adjusts quantity + expectedAt', async () => {
    const future = new Date(Date.now() + 5 * 86_400_000);
    const plan = await inventory.createReplenishmentPlan({
      warehouseId,
      skuId,
      quantity: '100',
      unit: 'MT',
      expectedAt: future.toISOString(),
    });

    const newDate = new Date(Date.now() + 10 * 86_400_000);
    const updated = await inventory.updateReplenishmentPlan(plan.id, {
      quantity: '750',
      expectedAt: newDate.toISOString(),
    });
    // Postgres numeric returns the value with the column's scale baked in.
    expect(Number(updated?.quantity)).toBe(750);
    expect(new Date(updated!.expectedAt).getTime()).toBe(newDate.getTime());
  });

  test('completeReplenishmentPlan creates an INBOUND_DELIVERY movement', async () => {
    const future = new Date(Date.now() + 3 * 86_400_000);
    const plan = await inventory.createReplenishmentPlan({
      warehouseId,
      skuId,
      quantity: '200',
      unit: 'MT',
      expectedAt: future.toISOString(),
    });

    const arrived = new Date(Date.now() + 1 * 86_400_000);
    await inventory.completeReplenishmentPlan(plan.id, { occurredAt: arrived });

    const balance = await inventory.getBalance(warehouseId, skuId);
    expect(balance.onHand).toBe(200);

    const movements = await inventory.listMovementsByWarehouse(warehouseId);
    const created = movements.find((m) => m.replenishmentPlanId === plan.id);
    expect(created).toBeDefined();
    expect(created?.movementType).toBe('INBOUND_DELIVERY');
  });

  test('completeReplenishmentPlan is idempotent for COMPLETED plans', async () => {
    const future = new Date(Date.now() + 3 * 86_400_000);
    const plan = await inventory.createReplenishmentPlan({
      warehouseId,
      skuId,
      quantity: '200',
      unit: 'MT',
      expectedAt: future.toISOString(),
    });

    await inventory.completeReplenishmentPlan(plan.id, { occurredAt: new Date() });
    // A second completion call must not double-record.
    await inventory.completeReplenishmentPlan(plan.id, { occurredAt: new Date() });

    const balance = await inventory.getBalance(warehouseId, skuId);
    expect(balance.onHand).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  Reservations + balances
// ═══════════════════════════════════════════════════════════════════════

describe('reservations and balances', () => {
  test('upsertReservation replaces an existing reservation for the same item', async () => {
    const db = await getDb();
    const { orders, orderItems, tenants } = await import('../src/db/schema');
    const [tenant] = await db.select().from(tenants).limit(1);
    const [order] = await db.insert(orders).values({
      tenantId: tenant!.id,
      clientId: context.client.id,
      vesselId: context.vessel.id,
      placeId: context.place.id,
    }).returning();
    const [item] = await db.insert(orderItems).values({
      orderId: order!.id,
      productType: 'VLSFO',
      quantity: '100',
      unit: 'MT',
      inventorySkuId: skuId,
      warehouseId,
    }).returning();

    await inventory.recordMovement({
      warehouseId,
      skuId,
      quantity: 1000,
      unit: 'MT',
      movementType: 'OPENING_BALANCE',
      occurredAt: new Date(Date.now() - 86_400_000),
    });

    await inventory.upsertReservation({
      warehouseId,
      skuId,
      quantity: 100,
      reservedFor: new Date(),
      orderId: order!.id,
      orderItemId: item!.id,
    });
    let bal = await inventory.getBalance(warehouseId, skuId);
    expect(bal.reserved).toBe(100);

    // Upsert again with a larger quantity — must replace, not duplicate.
    await inventory.upsertReservation({
      warehouseId,
      skuId,
      quantity: 250,
      reservedFor: new Date(),
      orderId: order!.id,
      orderItemId: item!.id,
    });
    bal = await inventory.getBalance(warehouseId, skuId);
    expect(bal.reserved).toBe(250);
    expect(bal.availableNow).toBe(750);
  });

  test('releaseReservationByOrderItem removes the reservation', async () => {
    const db = await getDb();
    const { orders, orderItems, tenants } = await import('../src/db/schema');
    const [tenant] = await db.select().from(tenants).limit(1);
    const [order] = await db.insert(orders).values({
      tenantId: tenant!.id,
      clientId: context.client.id,
      vesselId: context.vessel.id,
      placeId: context.place.id,
    }).returning();
    const [item] = await db.insert(orderItems).values({
      orderId: order!.id,
      productType: 'VLSFO',
      quantity: '50',
      unit: 'MT',
      inventorySkuId: skuId,
      warehouseId,
    }).returning();

    await inventory.upsertReservation({
      warehouseId,
      skuId,
      quantity: 50,
      reservedFor: new Date(),
      orderId: order!.id,
      orderItemId: item!.id,
    });
    expect((await inventory.getBalance(warehouseId, skuId)).reserved).toBe(50);

    await inventory.releaseReservationByOrderItem(item!.id);
    expect((await inventory.getBalance(warehouseId, skuId)).reserved).toBe(0);
  });

  test('getInventoryOverview returns one row per active warehouse+tracked SKU with movement', async () => {
    await inventory.recordMovement({
      warehouseId,
      skuId,
      quantity: 500,
      unit: 'MT',
      movementType: 'OPENING_BALANCE',
      occurredAt: new Date(),
    });
    const overview = await inventory.getInventoryOverview();
    const row = overview.find((r) => r.warehouseId === warehouseId && r.skuId === skuId);
    expect(row).toBeDefined();
    expect(row?.onHand).toBe('500.000');
  });

  test('getInventoryOverview hides untracked SKUs even when movements exist', async () => {
    // Mark the SKU as untracked.
    await inventory.updateInventorySku(skuId, { inventoryTracked: false });
    await inventory.recordMovement({
      warehouseId,
      skuId,
      quantity: 100,
      unit: 'MT',
      movementType: 'OPENING_BALANCE',
      occurredAt: new Date(),
    });
    const overview = await inventory.getInventoryOverview();
    expect(overview.find((r) => r.skuId === skuId)).toBeUndefined();
  });

});
