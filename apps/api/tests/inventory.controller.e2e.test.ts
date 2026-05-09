// ═══════════════════════════════════════════════════════════════════════
//  Inventory + Transfers controller e2e — role gating + REST shape.
//
//  Verifies:
//    1. Auth required on /inventory/* and /transfers/*
//    2. Read endpoints (overview, list, balance) work for any authed user
//    3. Mutating endpoints require ADMIN or OPERATIONSMANAGER
//    4. Warehouse + SKU + replenishment + availability work end-to-end
//    5. /transfers POST creates an INTERNAL_TRANSFER order
// ═══════════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { counterparties, users, vessels } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

async function seededAdmin() {
  const seeded = await seedAuthBasics();
  const db = await getDb();

  // Promote to ADMIN + mark seeded counterparty as own + physical-ops.
  await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, seeded.user.id));
  await db
    .update(counterparties)
    .set({ isOwnCompany: true, physicalOpsEnabled: true })
    .where(eq(counterparties.id, seeded.client.id));

  const login = await loginE2E(seeded.user.email, seeded.password);
  return { seeded, token: login.accessToken as string };
}

async function seededTrader() {
  const seeded = await seedAuthBasics('TraderPass1!');
  const db = await getDb();
  await db.update(users).set({ role: 'TRADER' }).where(eq(users.id, seeded.user.id));
  await db
    .update(counterparties)
    .set({ isOwnCompany: true, physicalOpsEnabled: true })
    .where(eq(counterparties.id, seeded.client.id));
  const login = await loginE2E(seeded.user.email, seeded.password);
  return { seeded, token: login.accessToken as string };
}

describe('inventory controller e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('rejects all routes without auth', async () => {
    expect((await requestJson('/inventory/skus')).status).toBe(401);
    expect((await requestJson('/inventory/warehouses')).status).toBe(401);
    expect((await requestJson('/inventory/overview')).status).toBe(401);
    expect((await requestJson('/inventory/replenishment-plans')).status).toBe(401);
    expect((await requestJson('/transfers/00000000-0000-0000-0000-000000000000')).status).toBe(401);
  });

  it('admin can create + list + update warehouses', async () => {
    const { seeded, token } = await seededAdmin();

    const create = await requestJson('/inventory/warehouses', {
      method: 'POST',
      token,
      body: {
        ownerCompanyId: seeded.client.id,
        name: 'WH-1',
        type: 'VESSEL',
        vesselId: seeded.vessel.id,
        inventoryEnabled: true,
        allowManualReplenishment: true,
      },
    });
    expect(create.status).toBe(200);
    expect(create.data?.success).toBe(true);
    const warehouseId = create.data?.data?.id as string;
    expect(warehouseId).toBeTruthy();

    const list = await requestJson('/inventory/warehouses', { token });
    expect(list.status).toBe(200);
    expect(Array.isArray(list.data?.data)).toBe(true);
    expect(list.data?.data.find((w: { id: string }) => w.id === warehouseId)).toBeDefined();

    const update = await requestJson(`/inventory/warehouses/${warehouseId}`, {
      method: 'PATCH',
      token,
      body: { allowManualReplenishment: false },
    });
    expect(update.status).toBe(200);
    expect(update.data?.data?.allowManualReplenishment).toBe(false);
  });

  it('rejects warehouse creation when owner is not physical-ops eligible', async () => {
    const { seeded, token } = await seededAdmin();
    const db = await getDb();
    await db
      .update(counterparties)
      .set({ physicalOpsEnabled: false })
      .where(eq(counterparties.id, seeded.client.id));

    const res = await requestJson('/inventory/warehouses', {
      method: 'POST',
      token,
      body: {
        ownerCompanyId: seeded.client.id,
        name: 'Bad WH',
        type: 'VESSEL',
        inventoryEnabled: true,
      },
    });
    expect(res.status).toBe(200); // controller returns success:false on domain errors
    expect(res.data?.success).toBe(false);
    expect(String(res.data?.message ?? '')).toContain('physical operations');
  });

  it('non-privileged users cannot create warehouses, SKUs, or replenishment plans', async () => {
    const { token } = await seededTrader();

    const wh = await requestJson('/inventory/warehouses', {
      method: 'POST',
      token,
      body: { ownerCompanyId: '00000000-0000-0000-0000-000000000000', name: 'X' },
    });
    expect(wh.status).toBe(500); // requirePrivileged throws → handled as server error
    // The actual error body bubbles through Elysia's default error handler.
    // We assert it's not a 200 success.

    const sku = await requestJson('/inventory/skus', {
      method: 'POST',
      token,
      body: { productType: 'VLSFO', displayName: 'Should not create' },
    });
    expect(sku.status).toBe(500);

    const plan = await requestJson('/inventory/replenishment-plans', {
      method: 'POST',
      token,
      body: {
        warehouseId: '00000000-0000-0000-0000-000000000000',
        skuId: '00000000-0000-0000-0000-000000000000',
        quantity: '1',
        expectedAt: new Date().toISOString(),
      },
    });
    expect(plan.status).toBe(500);
  });

  it('any authed user can read SKUs, warehouses, overview, and check availability', async () => {
    const { token } = await seededTrader();

    const skus = await requestJson('/inventory/skus', { token });
    expect(skus.status).toBe(200);
    expect(skus.data?.success).toBe(true);

    const warehouses = await requestJson('/inventory/warehouses', { token });
    expect(warehouses.status).toBe(200);

    const overview = await requestJson('/inventory/overview', { token });
    expect(overview.status).toBe(200);

    // Availability check is read-shaped: any user can call it.
    const av = await requestJson('/inventory/check-availability', {
      method: 'POST',
      token,
      body: {
        warehouseId: '00000000-0000-0000-0000-000000000000',
        skuId: '00000000-0000-0000-0000-000000000000',
        quantity: '1',
        neededAt: new Date().toISOString(),
      },
    });
    expect(av.status).toBe(200);
    expect(av.data?.data?.ok).toBe(false);
  });

  it('full happy-path: create SKU → warehouse → plan → check-availability', async () => {
    const { seeded, token } = await seededAdmin();

    const skuRes = await requestJson('/inventory/skus', {
      method: 'POST',
      token,
      body: { productType: 'VLSFO', displayName: 'VLSFO Generic' },
    });
    expect(skuRes.status).toBe(200);
    const skuId = skuRes.data?.data?.id as string;

    const whRes = await requestJson('/inventory/warehouses', {
      method: 'POST',
      token,
      body: {
        ownerCompanyId: seeded.client.id,
        name: 'Test WH',
        type: 'VESSEL',
        vesselId: seeded.vessel.id,
        inventoryEnabled: true,
      },
    });
    const warehouseId = whRes.data?.data?.id as string;

    const planRes = await requestJson('/inventory/replenishment-plans', {
      method: 'POST',
      token,
      body: {
        warehouseId,
        skuId,
        quantity: '500',
        unit: 'MT',
        expectedAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      },
    });
    expect(planRes.status).toBe(200);
    expect(planRes.data?.data?.status).toBe('PLANNED');

    const balance = await requestJson(`/inventory/warehouses/${warehouseId}/balance/${skuId}`, { token });
    expect(balance.status).toBe(200);
    expect(balance.data?.data?.onHand).toBe('0.000');

    const av = await requestJson('/inventory/check-availability', {
      method: 'POST',
      token,
      body: {
        warehouseId,
        skuId,
        quantity: '100',
        neededAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
      },
    });
    expect(av.status).toBe(200);
    expect(av.data?.data?.ok).toBe(true);
  });

  it('POST /transfers creates an INTERNAL_TRANSFER order with sides', async () => {
    const { seeded, token } = await seededAdmin();
    const db = await getDb();

    const [secondCompany] = await db
      .insert(counterparties)
      .values({
        tenantId: seeded.tenant.id,
        name: 'Second Own',
        type: 'CLIENT',
        types: ['CLIENT'],
        country: 'DEU',
        isOwnCompany: true,
        physicalOpsEnabled: true,
      })
      .returning();
    const [secondVessel] = await db
      .insert(vessels)
      .values({ name: 'Dest', imo: '6666666' })
      .returning();

    const sourceWh = await requestJson('/inventory/warehouses', {
      method: 'POST',
      token,
      body: {
        ownerCompanyId: seeded.client.id,
        name: 'Source',
        type: 'VESSEL',
        vesselId: seeded.vessel.id,
        inventoryEnabled: true,
      },
    });
    const destWh = await requestJson('/inventory/warehouses', {
      method: 'POST',
      token,
      body: {
        ownerCompanyId: secondCompany!.id,
        name: 'Dest',
        type: 'VESSEL',
        vesselId: secondVessel!.id,
        inventoryEnabled: true,
      },
    });

    const transfer = await requestJson('/transfers', {
      method: 'POST',
      token,
      body: {
        sourceCompanyId: seeded.client.id,
        destinationCompanyId: secondCompany!.id,
        sourceWarehouseId: sourceWh.data?.data?.id,
        destinationWarehouseId: destWh.data?.data?.id,
        vesselId: seeded.vessel.id,
        placeId: seeded.place.id,
      },
    });
    expect(transfer.status).toBe(200);
    expect(transfer.data?.success).toBe(true);
    const orderId = transfer.data?.data?.id as string;
    expect(orderId).toBeTruthy();

    const detail = await requestJson(`/transfers/${orderId}`, { token });
    expect(detail.status).toBe(200);
    expect(detail.data?.data?.transfer?.sourceCompanyId).toBe(seeded.client.id);
    expect(detail.data?.data?.sides).toHaveLength(2);
  });
});
