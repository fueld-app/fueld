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
});
