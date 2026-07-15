import { beforeEach, describe, expect, it } from 'bun:test';
import { seedAuthBasics, truncateAll, getDb } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';
import { eq } from 'drizzle-orm';
import { tenants } from '../src/db/schema';

async function enableBrokerDeals(tenantId: string, overrides?: Record<string, unknown>) {
  const db = await getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error('Tenant not found');
  const settings = {
    ...(tenant.settings as any),
    brokerDeals: {
      enabled: true,
      defaultCommissionRate: 3,
      reportStatuses: ['CONFIRMED', 'DELIVERED', 'INVOICED', 'PAID'],
      autoReleaseCredit: true,
      autoReleaseBufferDays: 0,
      ...overrides,
    },
  };
  await db.update(tenants).set({ settings, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
}

describe('broker-deal orders e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('creates an order with isBrokerDeal=true and commissionPerMt, verifies fields persisted', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: {
        clientId: seeded.client.id,
        vesselId: seeded.vessel.id,
        placeId: seeded.place.id,
        isBrokerDeal: true,
        commissionPerMt: '3.00',
      },
    });

    expect(created.status).toBe(200);
    expect(created.data?.success).toBe(true);
    expect(created.data?.data?.isBrokerDeal).toBe(true);
    expect(parseFloat(created.data?.data?.commissionPerMt)).toBe(3);
  });

  it('creates a regular order without broker deal fields, defaults isBrokerDeal=false', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: { clientId: seeded.client.id, vesselId: seeded.vessel.id, placeId: seeded.place.id },
    });

    expect(created.status).toBe(200);
    expect(created.data?.data?.isBrokerDeal).toBe(false);
    expect(created.data?.data?.commissionPerMt).toBeNull();
  });

  it('updates order to toggle isBrokerDeal and set commissionPerMt', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: { clientId: seeded.client.id, vesselId: seeded.vessel.id, placeId: seeded.place.id },
    });
    const orderId = created.data?.data?.id as string;

    const updated = await requestJson(`/orders/${orderId}`, {
      method: 'PUT',
      token,
      body: { isBrokerDeal: true, commissionPerMt: '5.50' },
    });

    expect(updated.status).toBe(200);
    expect(updated.data?.data?.isBrokerDeal).toBe(true);
    expect(parseFloat(updated.data?.data?.commissionPerMt)).toBe(5.5);

    const detail = await requestJson(`/orders/${orderId}`, { token });
    expect(detail.data?.data?.isBrokerDeal).toBe(true);
    expect(parseFloat(detail.data?.data?.commissionPerMt)).toBe(5.5);
  });

  it('updates order to unset isBrokerDeal and clear commissionPerMt', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: { clientId: seeded.client.id, vesselId: seeded.vessel.id, placeId: seeded.place.id, isBrokerDeal: true, commissionPerMt: '3.00' },
    });
    const orderId = created.data?.data?.id as string;

    const updated = await requestJson(`/orders/${orderId}`, {
      method: 'PUT',
      token,
      body: { isBrokerDeal: false, commissionPerMt: null },
    });

    expect(updated.data?.data?.isBrokerDeal).toBe(false);
    expect(updated.data?.data?.commissionPerMt).toBeNull();
  });

  it('lists orders filtered by isBrokerDeal=true, returns only broker deals', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    await requestJson('/orders', { method: 'POST', token, body: { clientId: seeded.client.id, vesselId: seeded.vessel.id, placeId: seeded.place.id, isBrokerDeal: true, commissionPerMt: '3.00' } });
    await requestJson('/orders', { method: 'POST', token, body: { clientId: seeded.client.id, vesselId: seeded.vessel.id, placeId: seeded.place.id } });

    const brokerList = await requestJson('/orders?isBrokerDeal=true', { token });
    expect(brokerList.data?.data?.total).toBe(1);

    const regularList = await requestJson('/orders?isBrokerDeal=false', { token });
    expect(regularList.data?.data?.total).toBe(1);
  });

  it('verifies non-broker orders excluded from broker deal list and vice versa', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    for (let i = 0; i < 2; i++) {
      await requestJson('/orders', { method: 'POST', token, body: { clientId: seeded.client.id, vesselId: seeded.vessel.id, placeId: seeded.place.id, isBrokerDeal: true, commissionPerMt: '3.00' } });
      await requestJson('/orders', { method: 'POST', token, body: { clientId: seeded.client.id, vesselId: seeded.vessel.id, placeId: seeded.place.id } });
    }

    expect((await requestJson('/orders?isBrokerDeal=true', { token })).data?.data?.total).toBe(2);
    expect((await requestJson('/orders?isBrokerDeal=false', { token })).data?.data?.total).toBe(2);
    expect((await requestJson('/orders', { token })).data?.data?.total).toBe(4);
  });

  it('verifies broker deal fields are rejected when tenant feature is disabled (H1 fixed)', async () => {
    const seeded = await seedAuthBasics();
    // Do NOT enable broker deals — feature is disabled
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: { clientId: seeded.client.id, vesselId: seeded.vessel.id, placeId: seeded.place.id, isBrokerDeal: true, commissionPerMt: '3.00' },
    });

    expect(created.status).toBe(200);
    expect(created.data?.success).toBe(true);
    // H1 FIXED: isBrokerDeal is now forced to false when feature is disabled
    expect(created.data?.data?.isBrokerDeal).toBe(false);
  });
});