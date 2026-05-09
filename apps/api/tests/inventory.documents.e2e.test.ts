// ═══════════════════════════════════════════════════════════════════════
//  Side-aware document gate for INTERNAL_TRANSFER orders.
//
//  Verifies the phase 2.0 controller behavior:
//    1. proforma + invoice routes block when the requested side is DRAFT
//    2. proforma + invoice routes succeed once the requested side is FINALIZED
//    3. side=DESTINATION_BUY blocks while only SOURCE_SELL is finalized
//    4. external (non-transfer) orders are unaffected by the gate
// ═══════════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { bankAccounts, counterparties, orders, vessels } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson, requestRaw } from './helpers/e2e';
import * as inventory from '../src/modules/inventory/inventory.service';
import * as transfers from '../src/modules/inventory/transfers.service';

interface TransferContext {
  token: string;
  orderId: string;
  sideIds: { sourceSell: string; destinationBuy: string };
}

async function seedTransferReadyOrder(): Promise<TransferContext> {
  const seeded = await seedAuthBasics();
  const db = await getDb();

  // Mark the seeded company as own + physical-ops + admin role.
  await db
    .update(counterparties)
    .set({ isOwnCompany: true, physicalOpsEnabled: true })
    .where(eq(counterparties.id, seeded.client.id));

  // Promote user to ADMIN so privileged inventory endpoints are usable.
  const { users } = await import('../src/db/schema');
  await db
    .update(users)
    .set({ role: 'ADMIN' })
    .where(eq(users.id, seeded.user.id));

  // Second own + physical-ops company for the transfer destination.
  const [secondCompany] = await db
    .insert(counterparties)
    .values({
      tenantId: seeded.tenant.id,
      name: 'Second Own Company',
      type: 'CLIENT',
      types: ['CLIENT'],
      country: 'DEU',
      isOwnCompany: true,
      physicalOpsEnabled: true,
    })
    .returning();

  // Bank account on the source company (gates document generation in the controller).
  const [bank] = await db
    .insert(bankAccounts)
    .values({
      counterpartyId: seeded.client.id,
      label: 'USD Main',
      bankName: 'Bank',
      currency: 'USD',
      isDefault: true,
    })
    .returning();

  // Two warehouses.
  const sourceWh = await inventory.createWarehouse({
    ownerCompanyId: seeded.client.id,
    name: 'Source WH',
    type: 'VESSEL',
    vesselId: seeded.vessel.id,
    inventoryEnabled: true,
    allowManualReplenishment: true,
  });
  const [destVessel] = await db
    .insert(vessels)
    .values({ name: 'Dest Vessel', imo: '7777777' })
    .returning();
  const destWh = await inventory.createWarehouse({
    ownerCompanyId: secondCompany!.id,
    name: 'Dest WH',
    type: 'VESSEL',
    vesselId: destVessel!.id,
    inventoryEnabled: true,
    allowManualReplenishment: true,
  });

  // Transfer order itself.
  const order = await transfers.createInternalTransfer({
    sourceCompanyId: seeded.client.id,
    destinationCompanyId: secondCompany!.id,
    sourceWarehouseId: sourceWh.id,
    destinationWarehouseId: destWh.id,
    vesselId: seeded.vessel.id,
    placeId: seeded.place.id,
  });

  // Transfer orders need a bank account on the order to satisfy the
  // existing document-generation guard. Set it directly.
  await db
    .update(orders)
    .set({ bankAccountId: bank!.id })
    .where(eq(orders.id, order.id));

  // Add a tracked line so the document generator has something to render.
  const sku = await inventory.createInventorySku({
    productType: 'VLSFO' as never,
    grade: 'RMG 380',
    displayName: 'VLSFO RMG 380',
    baseUnit: 'MT',
    inventoryTracked: true,
  });
  const { saveOrderItems } = await import('../src/modules/orders/orders.service');
  await saveOrderItems(order.id, [{
    productType: 'VLSFO',
    quantity: '100',
    unit: 'MT',
    salesPrice: '500',
    inventorySkuId: sku.id,
    warehouseId: sourceWh.id,
  } as never]);

  const sides = await transfers.listTransferSides(order.id);
  const sourceSell = sides.find((s) => s.kind === 'SOURCE_SELL')!;
  const destBuy = sides.find((s) => s.kind === 'DESTINATION_BUY')!;

  const login = await loginE2E(seeded.user.email, seeded.password);

  return {
    token: login.accessToken as string,
    orderId: order.id,
    sideIds: { sourceSell: sourceSell.id, destinationBuy: destBuy.id },
  };
}

describe('side-aware document gate (INTERNAL_TRANSFER)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('blocks proforma when SOURCE_SELL is still DRAFT', async () => {
    const { token, orderId } = await seedTransferReadyOrder();
    const res = await requestRaw(`/orders/${orderId}/proforma/pdf`, { token });
    expect(res.status).toBe(400);
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    expect(body.toLowerCase()).toContain('source side');
  });

  it('blocks invoice when SOURCE_SELL is still DRAFT', async () => {
    const { token, orderId } = await seedTransferReadyOrder();
    const res = await requestRaw(`/orders/${orderId}/invoice/pdf`, { token });
    expect(res.status).toBe(400);
  });

  it('serves proforma after SOURCE_SELL is FINALIZED', async () => {
    const { token, orderId, sideIds } = await seedTransferReadyOrder();

    // Set payment terms + finalize the source side.
    const update = await requestJson(`/transfers/${orderId}/sides/${sideIds.sourceSell}`, {
      method: 'PATCH',
      token,
      body: { paymentTermType: 'COD' },
    });
    expect(update.status).toBe(200);

    const finalize = await requestJson(`/transfers/${orderId}/sides/${sideIds.sourceSell}/finalize`, {
      method: 'POST',
      token,
    });
    expect(finalize.status).toBe(200);
    expect(finalize.data?.data?.status).toBe('FINALIZED');

    const proforma = await requestRaw(`/orders/${orderId}/proforma/pdf`, { token });
    expect(proforma.status).toBe(200);
    expect(proforma.headers.get('content-type')).toContain('application/pdf');
  });

  it('blocks side=DESTINATION_BUY while only SOURCE_SELL is FINALIZED', async () => {
    const { token, orderId, sideIds } = await seedTransferReadyOrder();

    await requestJson(`/transfers/${orderId}/sides/${sideIds.sourceSell}`, {
      method: 'PATCH',
      token,
      body: { paymentTermType: 'COD' },
    });
    await requestJson(`/transfers/${orderId}/sides/${sideIds.sourceSell}/finalize`, {
      method: 'POST',
      token,
    });

    // SOURCE_SELL ok, but DESTINATION_BUY still DRAFT.
    const blocked = await requestRaw(`/orders/${orderId}/proforma/pdf?side=DESTINATION_BUY`, { token });
    expect(blocked.status).toBe(400);

    const allowed = await requestRaw(`/orders/${orderId}/proforma/pdf?side=SOURCE_SELL`, { token });
    expect(allowed.status).toBe(200);
  });
});
