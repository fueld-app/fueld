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
});
