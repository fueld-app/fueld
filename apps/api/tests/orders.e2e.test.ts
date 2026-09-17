import { beforeEach, describe, expect, it } from 'bun:test';
import { seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

describe('orders e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('creates, updates, and queries an order through HTTP endpoints', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    expect(token).toBeTruthy();

    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: {
        clientId: seeded.client.id,
        vesselId: seeded.vessel.id,
        placeId: seeded.place.id,
      },
    });

    expect(created.status).toBe(200);
    expect(created.data?.success).toBe(true);

    const orderId = created.data?.data?.id as string;
    expect(orderId).toBeTruthy();

    const savedItems = await requestJson(`/orders/${orderId}/items`, {
      method: 'PUT',
      token,
      body: {
        items: [
          {
            productType: 'VLSFO',
            quantity: '20',
            unit: 'MT',
            costPrice: '100',
            costCurrency: 'USD',
            salesPrice: '115',
            salesCurrency: 'USD',
          },
        ],
      },
    });

    expect(savedItems.status).toBe(200);
    expect(savedItems.data?.success).toBe(true);
    expect(savedItems.data?.data?.length).toBe(1);

    const detail = await requestJson(`/orders/${orderId}`, {
      token,
    });
    expect(detail.status).toBe(200);
    expect(detail.data?.success).toBe(true);
    expect(detail.data?.data?.items?.length).toBe(1);

    const statusUpdate = await requestJson(`/orders/${orderId}/status`, {
      method: 'PUT',
      token,
      body: {
        status: 'CONFIRMED',
      },
    });

    expect(statusUpdate.status).toBe(200);
    expect(statusUpdate.data?.success).toBe(true);
    expect(statusUpdate.data?.data?.status).toBe('CONFIRMED');

    const listed = await requestJson('/orders?statuses=CONFIRMED', {
      token,
    });

    expect(listed.status).toBe(200);
    expect(listed.data?.success).toBe(true);
    expect(listed.data?.data?.total).toBeGreaterThanOrEqual(1);
    const ids = (listed.data?.data?.items ?? []).map((order: { id: string }) => order.id);
    expect(ids).toContain(orderId);
  });

  // Regression: Daniel Kvist / Moxie 2026-09-17 — the frontend serialized item
  // credit days as strings ('30') while the schema demanded Number|null, so the
  // whole PUT /items 422'd, items were never persisted, and converting the
  // inquiry to an order reported "Add at least one line item".
  it('accepts string credit days on items save and persists them as integers', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: {
        clientId: seeded.client.id,
        vesselId: seeded.vessel.id,
        placeId: seeded.place.id,
      },
    });
    expect(created.status).toBe(200);
    const orderId = created.data?.data?.id as string;

    const savedItems = await requestJson(`/orders/${orderId}/items`, {
      method: 'PUT',
      token,
      body: {
        items: [
          {
            productType: 'VLSFO',
            quantity: '500',
            unit: 'MT',
            costCreditDays: '30',
            salesCreditDays: '14',
            costCurrency: 'USD',
            salesCurrency: 'USD',
          },
        ],
      },
    });

    expect(savedItems.status).toBe(200);
    expect(savedItems.data?.success).toBe(true);
    expect(savedItems.data?.data?.length).toBe(1);
    expect(savedItems.data?.data?.[0]?.costCreditDays).toBe(30);
    expect(savedItems.data?.data?.[0]?.salesCreditDays).toBe(14);

    // Whitespace / negative / garbage → null, not a crash.
    const edge = await requestJson(`/orders/${orderId}/items`, {
      method: 'PUT',
      token,
      body: {
        items: [
          {
            productType: 'VLSFO',
            quantity: '500',
            unit: 'MT',
            costCreditDays: ' 7 ',
            salesCreditDays: -5,
          },
        ],
      },
    });
    expect(edge.status).toBe(200);
    expect(edge.data?.data?.[0]?.costCreditDays).toBe(7);
    expect(edge.data?.data?.[0]?.salesCreditDays).toBeNull();
  });

  // Regression: the frontend payload includes inventory linkage fields; without
  // declaring them in the schema Elysia strips the keys and every items save
  // re-inserted rows with the linkage nulled out.
  it('persists inventory linkage fields on items save', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    // Real SKU + warehouse rows (FK targets for the linkage columns)
    const dbMod = await import('../src/db/schema');
    const db = await (await import('./helpers/db')).getDb();
    const [sku] = await db
      .insert(dbMod.inventorySkus)
      .values({ tenantId: seeded.tenant.id, productType: 'VLSFO' as never, displayName: 'Test VLSFO', allowedUnits: ['MT'] })
      .returning();
    const [wh] = await db
      .insert(dbMod.warehouses)
      .values({ tenantId: seeded.tenant.id, ownerCompanyId: seeded.client.id, name: 'Test WH', type: 'VESSEL' as never })
      .returning();

    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: {
        clientId: seeded.client.id,
        vesselId: seeded.vessel.id,
        placeId: seeded.place.id,
      },
    });
    const orderId = created.data?.data?.id as string;

    const savedItems = await requestJson(`/orders/${orderId}/items`, {
      method: 'PUT',
      token,
      body: {
        items: [
          {
            productType: 'VLSFO',
            quantity: '100',
            unit: 'MT',
            inventorySkuId: sku.id,
            warehouseId: wh.id,
          },
        ],
      },
    });

    expect(savedItems.status).toBe(200);
    expect(savedItems.data?.data?.[0]?.inventorySkuId).toBe(sku.id);
    expect(savedItems.data?.data?.[0]?.warehouseId).toBe(wh.id);
  });
});
