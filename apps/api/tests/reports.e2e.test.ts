import { beforeEach, describe, expect, it } from 'bun:test';
import { seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

describe('reports e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns order drilldown rows from the real reports endpoint', async () => {
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

    const statusUpdate = await requestJson(`/orders/${orderId}/status`, {
      method: 'PUT',
      token,
      body: { status: 'CONFIRMED' },
    });

    expect(statusUpdate.status).toBe(200);
    expect(statusUpdate.data?.success).toBe(true);

    const detail = await requestJson(
      `/reports/drilldown/orders?dimension=TRADER&value=${seeded.user.id}&from=2020-01-01&to=2030-12-31`,
      { token },
    );

    expect(detail.status).toBe(200);
    expect(detail.data?.success).toBe(true);
    expect(detail.data?.data?.dataset).toBe('ORDERS');
    expect(detail.data?.data?.target).toBe('TRADER');
    expect(detail.data?.data?.orders?.length).toBe(1);
    expect(detail.data?.data?.orders?.[0]?.orderId).toBe(orderId);
    expect(detail.data?.data?.orders?.[0]?.traderId).toBe(seeded.user.id);
    expect(detail.data?.data?.orders?.[0]?.clientName).toBe(seeded.client.name);
  });
});