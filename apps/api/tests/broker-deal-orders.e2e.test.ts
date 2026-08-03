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

  it('lists broker deals with commission-based profit (Gross=Net=commission, Financing=0) instead of sales−cost margin', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    // Broker deal: pass-through prices where sales < cost would normally show a
    // loss ((100−115)×100 = −1500). With the fix, Gross/Net = commission.
    const brokerCreated = await requestJson('/orders', {
      method: 'POST',
      token,
      body: { clientId: seeded.client.id, vesselId: seeded.vessel.id, placeId: seeded.place.id, isBrokerDeal: true, commissionPerMt: '3.00' },
    });
    const brokerId = brokerCreated.data?.data?.id as string;
    await requestJson(`/orders/${brokerId}/items`, {
      method: 'PUT',
      token,
      body: { items: [{ productType: 'VLSFO', quantity: '100', unit: 'MT', costPrice: '115', costCurrency: 'USD', salesPrice: '100', salesCurrency: 'USD', commissionPerUnit: '3' }] },
    });
    await requestJson(`/orders/${brokerId}/status`, { method: 'PUT', token, body: { status: 'CONFIRMED' } });

    // Regular order: same prices reversed → normal trade margin (115−100)×100 = +1500.
    const regularCreated = await requestJson('/orders', {
      method: 'POST',
      token,
      body: { clientId: seeded.client.id, vesselId: seeded.vessel.id, placeId: seeded.place.id },
    });
    const regularId = regularCreated.data?.data?.id as string;
    await requestJson(`/orders/${regularId}/items`, {
      method: 'PUT',
      token,
      body: { items: [{ productType: 'VLSFO', quantity: '100', unit: 'MT', costPrice: '100', costCurrency: 'USD', salesPrice: '115', salesCurrency: 'USD' }] },
    });
    await requestJson(`/orders/${regularId}/status`, { method: 'PUT', token, body: { status: 'CONFIRMED' } });

    const list = await requestJson('/orders?statuses=CONFIRMED', { token });
    const rows = list.data?.data?.items as Array<Record<string, unknown>>;
    const brokerRow = rows.find((r) => r.id === brokerId)!;
    const regularRow = rows.find((r) => r.id === regularId)!;

    // Broker deal: profit is commission (3 × 100 = 300), no financing, no margin %.
    expect(parseFloat(String(brokerRow.totalProfit))).toBeCloseTo(300, 2);
    expect(parseFloat(String(brokerRow.totalFinancingCost))).toBe(0);
    expect(parseFloat(String(brokerRow.totalNetProfit))).toBeCloseTo(300, 2);
    expect(brokerRow.netMarginPct).toBeNull();

    // Regular order: unchanged — standard gross margin (115−100)×100 = 1500.
    expect(parseFloat(String(regularRow.totalProfit))).toBeCloseTo(1500, 2);
    expect(parseFloat(String(regularRow.totalNetProfit))).toBeCloseTo(1500, 2);
  });
});