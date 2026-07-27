import { beforeEach, describe, expect, it } from 'bun:test';
import { seedAuthBasics, truncateAll, getDb } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';
import { eq } from 'drizzle-orm';
import { orders } from '../src/db/schema';

/**
 * Comprehensive line item save + persistence verification.
 * Simulates: create order → save items → re-fetch (page refresh) → verify all fields.
 */

describe('line item save persistence e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('saves and persists all line item fields including hideOnDocuments after re-fetch', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    // 1. Create order
    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: { clientId: seeded.client.id, vesselId: seeded.vessel.id, placeId: seeded.place.id },
    });
    const orderId = created.data?.data?.id as string;
    expect(orderId).toBeTruthy();

    // 2. Save items with various fields including hideOnDocuments
    const saveRes = await requestJson(`/orders/${orderId}/items`, {
      method: 'PUT',
      token,
      body: {
        items: [
          {
            productType: 'VLSFO',
            quantity: '100',
            unit: 'MT',
            costPrice: '500',
            costCurrency: 'USD',
            salesPrice: '600',
            salesCurrency: 'USD',
            description: 'Test description',
            hideOnDocuments: false,
          },
          {
            productType: 'Brokerage Commission',
            quantity: '1',
            unit: 'MT',
            costPrice: '300',
            costCurrency: 'USD',
            salesPrice: '300',
            salesCurrency: 'USD',
            hideOnDocuments: true,
          },
        ],
      },
    });
    expect(saveRes.status).toBe(200);
    expect(saveRes.data?.success).toBe(true);

    // 3. Re-fetch order (simulates page refresh)
    const detail = await requestJson(`/orders/${orderId}`, { token });
    expect(detail.status).toBe(200);
    expect(detail.data?.success).toBe(true);

    const items = detail.data?.data?.items ?? [];
    expect(items.length).toBe(2);

    // 4. Verify item 1 (visible)
    const item1 = items[0];
    expect(item1.productType).toBe('VLSFO');
    expect(parseFloat(item1.quantity)).toBe(100);
    expect(item1.unit).toBe('MT');
    expect(parseFloat(item1.costPrice)).toBe(500);
    expect(item1.costCurrency).toBe('USD');
    expect(parseFloat(item1.salesPrice)).toBe(600);
    expect(item1.salesCurrency).toBe('USD');
    expect(item1.description).toBe('Test description');
    expect(item1.hideOnDocuments).toBe(false);

    // 5. Verify item 2 (hidden)
    const item2 = items[1];
    expect(item2.productType).toBe('Brokerage Commission');
    expect(item2.hideOnDocuments).toBe(true);

    // 6. Update item — toggle hideOnDocuments and change quantity
    const updateRes = await requestJson(`/orders/${orderId}/items`, {
      method: 'PUT',
      token,
      body: {
        items: [
          {
            id: item1.id,
            productType: 'VLSFO',
            quantity: '150',
            unit: 'MT',
            costPrice: '500',
            costCurrency: 'USD',
            salesPrice: '600',
            salesCurrency: 'USD',
            hideOnDocuments: true,
          },
          {
            id: item2.id,
            productType: 'Brokerage Commission',
            quantity: '1',
            unit: 'MT',
            costPrice: '300',
            costCurrency: 'USD',
            salesPrice: '300',
            salesCurrency: 'USD',
            hideOnDocuments: false,
          },
        ],
      },
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.data?.success).toBe(true);

    // 7. Re-fetch and verify the update persisted
    const detail2 = await requestJson(`/orders/${orderId}`, { token });
    const items2 = detail2.data?.data?.items ?? [];
    expect(items2.length).toBe(2);

    // Item 1 should now be hidden with quantity 150
    const updated1 = items2.find((i: any) => i.productType === 'VLSFO');
    expect(updated1).toBeTruthy();
    expect(parseFloat(updated1.quantity)).toBe(150);
    expect(updated1.hideOnDocuments).toBe(true);

    // Item 2 should now be visible
    const updated2 = items2.find((i: any) => i.productType === 'Brokerage Commission');
    expect(updated2).toBeTruthy();
    expect(updated2.hideOnDocuments).toBe(false);
  });

  it('saves items without hideOnDocuments field (defaults to false)', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: { clientId: seeded.client.id, vesselId: seeded.vessel.id, placeId: seeded.place.id },
    });
    const orderId = created.data?.data?.id as string;

    // Save items WITHOUT hideOnDocuments — should default to false
    await requestJson(`/orders/${orderId}/items`, {
      method: 'PUT',
      token,
      body: {
        items: [
          {
            productType: 'VLSFO',
            quantity: '100',
            unit: 'MT',
            costPrice: '500',
            costCurrency: 'USD',
            salesPrice: '600',
            salesCurrency: 'USD',
          },
        ],
      },
    });

    // Verify it defaults to false
    const detail = await requestJson(`/orders/${orderId}`, { token });
    const items = detail.data?.data?.items ?? [];
    expect(items.length).toBe(1);
    expect(items[0].hideOnDocuments).toBe(false);
  });

  it('saves single item with only required fields', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: { clientId: seeded.client.id, vesselId: seeded.vessel.id, placeId: seeded.place.id },
    });
    const orderId = created.data?.data?.id as string;

    // Save a minimal item
    const saveRes = await requestJson(`/orders/${orderId}/items`, {
      method: 'PUT',
      token,
      body: {
        items: [
          {
            productType: 'MGO',
            quantity: '50',
            unit: 'MT',
          },
        ],
      },
    });
    expect(saveRes.status).toBe(200);
    expect(saveRes.data?.success).toBe(true);

    // Verify it persisted
    const detail = await requestJson(`/orders/${orderId}`, { token });
    const items = detail.data?.data?.items ?? [];
    expect(items.length).toBe(1);
    expect(items[0].productType).toBe('MGO');
    expect(parseFloat(items[0].quantity)).toBe(50);
  });
});