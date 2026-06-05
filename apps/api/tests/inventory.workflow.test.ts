// ═══════════════════════════════════════════════════════════════════════
//  Inventory ↔ Order workflow integration tests.
//
//  Verifies that updateOrderStatus correctly applies inventory effects
//  for EXTERNAL orders. (Transfer orders are exercised in the dedicated
//  inventory.transfers.test.ts.)
//
//  Cases:
//    1. CONFIRMED on a tracked external order creates an outbound reservation
//    2. DELIVERED on a tracked external order records OUTBOUND_DELIVERY +
//       releases the reservation
//    3. CANCELLED releases reservations and cancels linked plans
//    4. Untracked line items bypass inventory entirely
//    5. Reservation date prefers plannedInventoryAt > ETA > now
// ═══════════════════════════════════════════════════════════════════════

import { describe, expect, test, beforeAll, beforeEach } from 'bun:test';
import { eq } from 'drizzle-orm';
import { getDb, seedBasics, truncateAll } from './helpers/db';
import * as inventory from '../src/modules/inventory/inventory.service';
import { saveOrderItems, updateOrderStatus } from '../src/modules/orders/orders.service';
import { counterparties, orders } from '../src/db/schema';

let context: Awaited<ReturnType<typeof seedBasics>>;
let warehouseId: string;
let skuId: string;

beforeAll(async () => {
  await truncateAll();
});

beforeEach(async () => {
  await truncateAll();
  context = await seedBasics();

  const db = await getDb();
  await db
    .update(counterparties)
    .set({ isOwnCompany: true, physicalOpsEnabled: true })
    .where(eq(counterparties.id, context.client.id));

  const wh = await inventory.createWarehouse({
    ownerCompanyId: context.client.id,
    name: 'External Order Warehouse',
    type: 'VESSEL',
    vesselId: context.vessel.id,
    inventoryEnabled: true,
    allowManualReplenishment: true,
  });
  warehouseId = wh.id;

  const sku = await inventory.createInventorySku({
    productType: 'VLSFO' as never,
    grade: null,
    displayName: 'VLSFO Generic',
    baseUnit: 'MT',
    inventoryTracked: true,
  });
  skuId = sku.id;

  // Seed plenty of opening stock so reservations and movements can succeed.
  await inventory.recordMovement({
    warehouseId,
    skuId,
    quantity: 1000,
    unit: 'MT',
    movementType: 'OPENING_BALANCE',
    occurredAt: new Date(Date.now() - 86_400_000),
  });
});

async function createExternalOrder(eta?: Date) {
  const db = await getDb();
  const [order] = await db
    .insert(orders)
    .values({
      tenantId: context.tenant.id,
      clientId: context.client.id,
      vesselId: context.vessel.id,
      placeId: context.place.id,
      eta: eta ?? null,
    })
    .returning();
  return order!;
}

describe('inventory ↔ order workflow (EXTERNAL)', () => {
  test('CONFIRMED creates a reservation for tracked lines', async () => {
    const order = await createExternalOrder(new Date(Date.now() + 2 * 86_400_000));
    await saveOrderItems(order.id, [{
      productType: 'VLSFO',
      quantity: '250',
      unit: 'MT',
      inventorySkuId: skuId,
      warehouseId,
    } as never]);

    await updateOrderStatus(order.id, 'CONFIRMED', context.user.id);

    const balance = await inventory.getBalance(warehouseId, skuId);
    expect(balance.reserved).toBe(250);
    expect(balance.availableNow).toBe(750);
  });

  test('DELIVERED records OUTBOUND_DELIVERY + releases reservation', async () => {
    const order = await createExternalOrder();
    await saveOrderItems(order.id, [{
      productType: 'VLSFO',
      quantity: '150',
      unit: 'MT',
      inventorySkuId: skuId,
      warehouseId,
    } as never]);

    await updateOrderStatus(order.id, 'CONFIRMED', context.user.id);

    const db = await getDb();
    await db
      .update(orders)
      .set({ deliveredAt: new Date() })
      .where(eq(orders.id, order.id));
    await updateOrderStatus(order.id, 'DELIVERED', context.user.id);

    const balance = await inventory.getBalance(warehouseId, skuId);
    expect(balance.onHand).toBe(850); // 1000 - 150
    expect(balance.reserved).toBe(0);

    const movements = await inventory.listMovementsByWarehouse(warehouseId);
    const delivery = movements.find((m) => m.orderId === order.id && m.movementType === 'OUTBOUND_DELIVERY');
    expect(delivery).toBeDefined();
    expect(Number(delivery?.quantity)).toBe(-150);
  });

  test('CANCELLED releases all reservations on the order', async () => {
    const order = await createExternalOrder();
    await saveOrderItems(order.id, [
      {
        productType: 'VLSFO',
        quantity: '60',
        unit: 'MT',
        inventorySkuId: skuId,
        warehouseId,
      } as never,
      {
        productType: 'VLSFO',
        quantity: '40',
        unit: 'MT',
        inventorySkuId: skuId,
        warehouseId,
      } as never,
    ]);

    await updateOrderStatus(order.id, 'CONFIRMED', context.user.id);
    expect((await inventory.getBalance(warehouseId, skuId)).reserved).toBe(100);

    await updateOrderStatus(order.id, 'CANCELLED', context.user.id);
    expect((await inventory.getBalance(warehouseId, skuId)).reserved).toBe(0);
  });

  test('lines without inventorySkuId/warehouseId bypass the inventory hook', async () => {
    const order = await createExternalOrder();
    await saveOrderItems(order.id, [{
      productType: 'COMMISSION',
      quantity: '1',
      unit: 'PCS',
      // No inventorySkuId / warehouseId — this is a non-stock item.
    } as never]);

    await updateOrderStatus(order.id, 'CONFIRMED', context.user.id);

    // No reservation should exist.
    const balance = await inventory.getBalance(warehouseId, skuId);
    expect(balance.reserved).toBe(0);
  });

  test('reservedFor uses plannedInventoryAt when present', async () => {
    const order = await createExternalOrder(new Date(Date.now() + 10 * 86_400_000));
    const planned = new Date(Date.now() + 3 * 86_400_000);
    await saveOrderItems(order.id, [{
      productType: 'VLSFO',
      quantity: '100',
      unit: 'MT',
      inventorySkuId: skuId,
      warehouseId,
      plannedInventoryAt: planned.toISOString(),
    } as never]);

    await updateOrderStatus(order.id, 'CONFIRMED', context.user.id);

    // The reservation should be dated at plannedInventoryAt, not the ETA.
    const db = await getDb();
    const { inventoryReservations } = await import('../src/db/schema');
    const [reservation] = await db
      .select()
      .from(inventoryReservations)
      .where(eq(inventoryReservations.orderId, order.id))
      .limit(1);
    expect(reservation).toBeDefined();
    expect(reservation!.reservedFor.getTime()).toBe(planned.getTime());
  });

  test('CONFIRMED is a no-op when an external order has no inventory-tracked lines', async () => {
    const order = await createExternalOrder();
    await saveOrderItems(order.id, [{
      productType: 'VLSFO',
      quantity: '50',
      unit: 'MT',
      // intentionally no inventorySkuId/warehouseId
    } as never]);

    await updateOrderStatus(order.id, 'CONFIRMED', context.user.id);

    const balance = await inventory.getBalance(warehouseId, skuId);
    expect(balance.reserved).toBe(0);
    expect(balance.onHand).toBe(1000);
  });
});
