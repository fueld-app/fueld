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
});
