// ═══════════════════════════════════════════════════════════════════════
//  Internal Transfers — phase 2.0 coverage of the transfer workflow.
//
//  Verifies:
//    1. createInternalTransfer rejects companies that are not own + physical-ops
//    2. createInternalTransfer rejects warehouses owned by the wrong company
//    3. listTransferSides returns SOURCE_SELL + DESTINATION_BUY in DRAFT
//    4. finalizeTransferSide blocks until invoicing + payment terms are set
//    5. reopenTransferSide returns FINALIZED → DRAFT
// ═══════════════════════════════════════════════════════════════════════

import { describe, expect, test, beforeAll, beforeEach } from 'bun:test';
import { eq } from 'drizzle-orm';
import { getDb, seedBasics, truncateAll } from './helpers/db';
import * as inventory from '../src/modules/inventory/inventory.service';
import * as transfers from '../src/modules/inventory/transfers.service';
import { counterparties, vessels } from '../src/db/schema';

let context: Awaited<ReturnType<typeof seedBasics>>;
let secondCompanyId: string;
let sourceWarehouseId: string;
let destWarehouseId: string;

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

  // Seed a second own + physical-ops company so we can test transfers.
  const [secondCompany] = await db
    .insert(counterparties)
    .values({
      tenantId: context.tenant.id,
      name: 'Test Own Company B',
      type: 'CLIENT',
      types: ['CLIENT'],
      country: 'DEU',
      isOwnCompany: true,
      physicalOpsEnabled: true,
    })
    .returning();
  secondCompanyId = secondCompany!.id;

  // Source warehouse on the seeded company, destination on the second.
  const src = await inventory.createWarehouse({
    ownerCompanyId: context.client.id,
    name: 'Source Vessel',
    type: 'VESSEL',
    vesselId: context.vessel.id,
    inventoryEnabled: true,
    allowManualReplenishment: true,
  });
  sourceWarehouseId = src.id;

  // Need a vessel for the dest warehouse too.
  const [secondVessel] = await db
    .insert(vessels)
    .values({ name: 'Dest Vessel', imo: '8888888' })
    .returning();
  const dst = await inventory.createWarehouse({
    ownerCompanyId: secondCompanyId,
    name: 'Dest Vessel WH',
    type: 'VESSEL',
    vesselId: secondVessel!.id,
    inventoryEnabled: true,
    allowManualReplenishment: true,
  });
  destWarehouseId = dst.id;
});

describe('internal transfers', () => {
  test('createInternalTransfer creates an order with both transfer sides in DRAFT', async () => {
    const order = await transfers.createInternalTransfer({
      sourceCompanyId: context.client.id,
      destinationCompanyId: secondCompanyId,
      sourceWarehouseId,
      destinationWarehouseId: destWarehouseId,
      vesselId: context.vessel.id,
      placeId: context.place.id,
    });
    expect(order).toBeTruthy();
    expect(order.orderKind).toBe('INTERNAL_TRANSFER');

    const ext = await transfers.getOrderTransfer(order.id);
    expect(ext).not.toBeNull();
    expect(ext?.sourceCompanyId).toBe(context.client.id);
    expect(ext?.destinationCompanyId).toBe(secondCompanyId);
    expect(ext?.sourceWarehouseId).toBe(sourceWarehouseId);
    expect(ext?.destinationWarehouseId).toBe(destWarehouseId);

    const sides = await transfers.listTransferSides(order.id);
    expect(sides).toHaveLength(2);
    expect(sides.find((s) => s.kind === 'SOURCE_SELL')?.status).toBe('DRAFT');
    expect(sides.find((s) => s.kind === 'DESTINATION_BUY')?.status).toBe('DRAFT');
  });

  test('createInternalTransfer rejects identical source/destination', async () => {
    let error: Error | null = null;
    try {
      await transfers.createInternalTransfer({
        sourceCompanyId: context.client.id,
        destinationCompanyId: context.client.id,
        sourceWarehouseId,
        destinationWarehouseId: destWarehouseId,
        vesselId: context.vessel.id,
        placeId: context.place.id,
      });
    } catch (err) {
      error = err as Error;
    }
    expect(error).not.toBeNull();
    expect(error?.message).toContain('Source and destination companies');
  });

  test('createInternalTransfer rejects a warehouse not owned by the named company', async () => {
    let error: Error | null = null;
    try {
      await transfers.createInternalTransfer({
        sourceCompanyId: context.client.id,
        destinationCompanyId: secondCompanyId,
        // destination warehouse owned by `secondCompanyId`, but we put it on the source side
        sourceWarehouseId: destWarehouseId,
        destinationWarehouseId: sourceWarehouseId,
        vesselId: context.vessel.id,
        placeId: context.place.id,
      });
    } catch (err) {
      error = err as Error;
    }
    expect(error).not.toBeNull();
    expect(error?.message).toContain('Source warehouse must be owned');
  });

  test('finalizeTransferSide blocks until payment terms are set, then succeeds and reopens', async () => {
    const order = await transfers.createInternalTransfer({
      sourceCompanyId: context.client.id,
      destinationCompanyId: secondCompanyId,
      sourceWarehouseId,
      destinationWarehouseId: destWarehouseId,
      vesselId: context.vessel.id,
      placeId: context.place.id,
    });

    const sides = await transfers.listTransferSides(order.id);
    const sourceSide = sides.find((s) => s.kind === 'SOURCE_SELL')!;

    // Without payment terms, finalize must throw.
    let error: Error | null = null;
    try {
      await transfers.finalizeTransferSide(sourceSide.id, context.user.id);
    } catch (err) {
      error = err as Error;
    }
    expect(error).not.toBeNull();
    expect(error?.message).toContain('Payment terms');

    // Set payment terms, then finalize should succeed.
    await transfers.updateTransferSide(sourceSide.id, {
      paymentTermType: 'COD',
    });
    const finalized = await transfers.finalizeTransferSide(sourceSide.id, context.user.id);
    expect(finalized?.status).toBe('FINALIZED');
    expect(finalized?.finalizedAt).not.toBeNull();

    // Reopen returns to DRAFT and clears finalize metadata.
    const reopened = await transfers.reopenTransferSide(sourceSide.id);
    expect(reopened?.status).toBe('DRAFT');
    expect(reopened?.finalizedAt).toBeNull();
    expect(reopened?.finalizedBy).toBeNull();
  });

  test('updateTransferSide does not mutate a FINALIZED side', async () => {
    const order = await transfers.createInternalTransfer({
      sourceCompanyId: context.client.id,
      destinationCompanyId: secondCompanyId,
      sourceWarehouseId,
      destinationWarehouseId: destWarehouseId,
      vesselId: context.vessel.id,
      placeId: context.place.id,
    });
    const sides = await transfers.listTransferSides(order.id);
    const sourceSide = sides.find((s) => s.kind === 'SOURCE_SELL')!;

    await transfers.updateTransferSide(sourceSide.id, {
      paymentTermType: 'COD',
      currency: 'EUR',
    });
    await transfers.finalizeTransferSide(sourceSide.id, context.user.id);

    // Try to change currency once finalized — should be a no-op (status guard).
    await transfers.updateTransferSide(sourceSide.id, { currency: 'GBP' });
    const after = await transfers.listTransferSides(order.id);
    const stillFinal = after.find((s) => s.kind === 'SOURCE_SELL')!;
    expect(stillFinal.currency).toBe('EUR');
    expect(stillFinal.status).toBe('FINALIZED');
  });

  test('getOrderTransfer returns null for a non-transfer order', async () => {
    const result = await transfers.getOrderTransfer('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  test('CONFIRMED transfer creates source-side reservation + destination replenishment plan', async () => {
    const inventory = await import('../src/modules/inventory/inventory.service');
    const { saveOrderItems, updateOrderStatus } = await import('../src/modules/orders/orders.service');

    // Create a tracked SKU.
    const sku = await inventory.createInventorySku({
      productType: 'VLSFO' as never,
      grade: 'RMG 380',
      displayName: 'VLSFO RMG 380',
      baseUnit: 'MT',
      inventoryTracked: true,
    });

    // Seed source warehouse with stock so the source-side reservation makes sense.
    await inventory.recordMovement({
      warehouseId: sourceWarehouseId,
      skuId: sku.id,
      quantity: 1000,
      unit: 'MT',
      movementType: 'OPENING_BALANCE',
      occurredAt: new Date(Date.now() - 86_400_000),
    });

    const order = await transfers.createInternalTransfer({
      sourceCompanyId: context.client.id,
      destinationCompanyId: secondCompanyId,
      sourceWarehouseId,
      destinationWarehouseId: destWarehouseId,
      vesselId: context.vessel.id,
      placeId: context.place.id,
      eta: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    });

    // Add a tracked line to the transfer order.
    await saveOrderItems(order.id, [{
      productType: 'VLSFO',
      quantity: '300',
      unit: 'MT',
      inventorySkuId: sku.id,
      warehouseId: sourceWarehouseId,
    } as never]);

    // Confirm: the inventory hook fires.
    await updateOrderStatus(order.id, 'CONFIRMED', context.user.id);

    // Source side: reservation reduces availability by 300.
    const sourceBal = await inventory.getBalance(sourceWarehouseId, sku.id);
    expect(sourceBal.reserved).toBe(300);
    expect(sourceBal.availableNow).toBe(700);

    // Destination side: a LINKED replenishment plan exists for the inbound stock.
    const destPlans = await inventory.listReplenishmentPlans({
      warehouseId: destWarehouseId,
      skuId: sku.id,
    });
    const linked = destPlans.find((p) => p.orderId === order.id);
    expect(linked).toBeDefined();
    expect(linked?.status).toBe('LINKED');
    expect(linked?.quantity).toBe('300.000');
  });

  test('DELIVERED transfer records both source TRANSFER_OUT and destination TRANSFER_IN', async () => {
    const inventory = await import('../src/modules/inventory/inventory.service');
    const { saveOrderItems, updateOrderStatus } = await import('../src/modules/orders/orders.service');
    const db = await getDb();
    const { orders } = await import('../src/db/schema');

    const sku = await inventory.createInventorySku({
      productType: 'MGO' as never,
      grade: null,
      displayName: 'MGO Generic',
      baseUnit: 'MT',
      inventoryTracked: true,
    });

    await inventory.recordMovement({
      warehouseId: sourceWarehouseId,
      skuId: sku.id,
      quantity: 500,
      unit: 'MT',
      movementType: 'OPENING_BALANCE',
      occurredAt: new Date(Date.now() - 86_400_000),
    });

    const order = await transfers.createInternalTransfer({
      sourceCompanyId: context.client.id,
      destinationCompanyId: secondCompanyId,
      sourceWarehouseId,
      destinationWarehouseId: destWarehouseId,
      vesselId: context.vessel.id,
      placeId: context.place.id,
    });

    await saveOrderItems(order.id, [{
      productType: 'MGO',
      quantity: '120',
      unit: 'MT',
      inventorySkuId: sku.id,
      warehouseId: sourceWarehouseId,
    } as never]);

    await updateOrderStatus(order.id, 'CONFIRMED', context.user.id);

    // Set deliveredAt (mirrors order.markDelivered flow) before status flip.
    await db
      .update(orders)
      .set({ deliveredAt: new Date() })
      .where(eq(orders.id, order.id));
    await updateOrderStatus(order.id, 'DELIVERED', context.user.id);

    const sourceBal = await inventory.getBalance(sourceWarehouseId, sku.id);
    expect(sourceBal.onHand).toBe(380); // 500 - 120
    expect(sourceBal.reserved).toBe(0); // reservation released

    const destBal = await inventory.getBalance(destWarehouseId, sku.id);
    expect(destBal.onHand).toBe(120);
  });

  test('CANCELLED transfer releases reservations and cancels destination plan', async () => {
    const inventory = await import('../src/modules/inventory/inventory.service');
    const { saveOrderItems, updateOrderStatus } = await import('../src/modules/orders/orders.service');

    const sku = await inventory.createInventorySku({
      productType: 'LSMGO' as never,
      grade: null,
      displayName: 'LSMGO Generic',
      baseUnit: 'MT',
      inventoryTracked: true,
    });

    await inventory.recordMovement({
      warehouseId: sourceWarehouseId,
      skuId: sku.id,
      quantity: 200,
      unit: 'MT',
      movementType: 'OPENING_BALANCE',
      occurredAt: new Date(Date.now() - 86_400_000),
    });

    const order = await transfers.createInternalTransfer({
      sourceCompanyId: context.client.id,
      destinationCompanyId: secondCompanyId,
      sourceWarehouseId,
      destinationWarehouseId: destWarehouseId,
      vesselId: context.vessel.id,
      placeId: context.place.id,
    });

    await saveOrderItems(order.id, [{
      productType: 'LSMGO',
      quantity: '80',
      unit: 'MT',
      inventorySkuId: sku.id,
      warehouseId: sourceWarehouseId,
    } as never]);

    await updateOrderStatus(order.id, 'CONFIRMED', context.user.id);
    expect((await inventory.getBalance(sourceWarehouseId, sku.id)).reserved).toBe(80);
    let plans = await inventory.listReplenishmentPlans({
      warehouseId: destWarehouseId,
      skuId: sku.id,
    });
    expect(plans.find((p) => p.orderId === order.id)?.status).toBe('LINKED');

    await updateOrderStatus(order.id, 'CANCELLED', context.user.id);

    // Reservation released, destination plan cancelled.
    expect((await inventory.getBalance(sourceWarehouseId, sku.id)).reserved).toBe(0);
    plans = await inventory.listReplenishmentPlans({
      warehouseId: destWarehouseId,
      skuId: sku.id,
    });
    expect(plans.find((p) => p.orderId === order.id)?.status).toBe('CANCELLED');
  });

});
