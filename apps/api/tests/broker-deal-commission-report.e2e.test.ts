import { beforeEach, describe, expect, it } from 'bun:test';
import { seedAuthBasics, truncateAll, getDb } from './helpers/db';
import { loginE2E, requestJson, requestRaw } from './helpers/e2e';
import { eq } from 'drizzle-orm';
import { tenants, orders, orderItems } from '../src/db/schema';

/**
 * API E2E tests for the broker commission report endpoint + exports.
 *
 * Covers:
 * - Report returns correct commission math (quantity × commissionPerUnit)
 * - Fallback to tenant defaultCommissionRate when order item commissionPerUnit is null
 * - Date range filtering uses configured reportDateField with reportDateFallback
 * - Status filtering uses configured reportStatuses
 * - Unit conversion (e.g. GAL→MT) — NOTE: currently NOT implemented (audit M1)
 * - Client filter (clientId parameter)
 * - CSV and XLSX export endpoints return correct data
 * - Empty report when no broker deals match criteria
 *
 * NOTE: The report reads commission from orderItems.commissionPerUnit, NOT
 * orders.commissionPerMt. Items must be saved with commissionPerUnit set.
 */

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

/** Create a broker deal order, add items with commission, and set status. */
async function createBrokerDeal(
  token: string,
  clientId: string,
  vesselId: string,
  placeId: string,
  opts: {
    commissionPerUnit?: string | null;
    quantity?: string;
    unit?: string;
    status?: string;
    deliveredAt?: string;
    eta?: string;
    unitConversionFactor?: string;
  } = {},
): Promise<string> {
  const created = await requestJson('/orders', {
    method: 'POST',
    token,
    body: {
      clientId,
      vesselId,
      placeId,
      isBrokerDeal: true,
      eta: opts.eta ?? '2026-07-15',
    },
  });
  const orderId = created.data?.data?.id as string;

  // Save order items with commission
  const item: Record<string, unknown> = {
    productType: 'VLSFO',
    quantity: opts.quantity ?? '100',
    unit: opts.unit ?? 'MT',
    costPrice: '100',
    costCurrency: 'USD',
    salesPrice: '115',
    salesCurrency: 'USD',
  };
  // Only set commissionPerUnit if explicitly provided (null means no per-item commission → fallback to tenant default)
  if (opts.commissionPerUnit !== undefined) {
    item.commissionPerUnit = opts.commissionPerUnit ?? null;
  } else {
    item.commissionPerUnit = '3'; // default for tests
  }
  if (opts.unitConversionFactor) {
    item.unitConversionFactor = opts.unitConversionFactor;
  }

  await requestJson(`/orders/${orderId}/items`, {
    method: 'PUT',
    token,
    body: { items: [item] },
  });

  // Set status if provided
  if (opts.status && opts.status !== 'INQUIRY') {
    await requestJson(`/orders/${orderId}/status`, {
      method: 'PUT',
      token,
      body: { status: opts.status },
    });
  }

  // Set deliveredAt directly via DB if provided
  if (opts.deliveredAt) {
    const db = await getDb();
    await db.update(orders).set({ deliveredAt: new Date(opts.deliveredAt) }).where(eq(orders.id, orderId));
  }

  return orderId;
}

describe('broker commission report e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns correct commission math (quantity × commissionPerUnit)', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    // Create a broker deal with 100 MT at $3/MT commission = $300
    await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      commissionPerUnit: '3',
      quantity: '100',
      status: 'CONFIRMED',
      deliveredAt: '2026-07-10',
    });

    const report = await requestJson('/reports/broker-commission?from=2026-07-01&to=2026-07-31', { token });
    expect(report.status).toBe(200);
    expect(report.data?.success).toBe(true);
    expect(report.data?.data?.byCustomer.length).toBe(1);
    expect(parseFloat(report.data?.data?.totalCommission)).toBe(300);
    expect(report.data?.data?.currency).toBe('USD');

    const cust = report.data?.data?.byCustomer[0];
    expect(cust.orderCount).toBe(1);
    expect(parseFloat(cust.totalQuantity)).toBe(100);
    expect(parseFloat(cust.totalCommission)).toBe(300);
  });

  it('falls back to tenant defaultCommissionRate when item commissionPerUnit is null', async () => {
    const seeded = await seedAuthBasics();
    // Set default commission rate to 5 (use both field names for compat)
    await enableBrokerDeals(seeded.tenant.id, { defaultCommissionRate: 5, defaultCommissionPerMt: 5 });
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    // Create a broker deal with NO commissionPerUnit on the item
    await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      commissionPerUnit: null,
      quantity: '80',
      status: 'CONFIRMED',
      deliveredAt: '2026-07-10',
    });

    const report = await requestJson('/reports/broker-commission?from=2026-07-01&to=2026-07-31', { token });
    expect(report.data?.success).toBe(true);
    // 80 MT × $5/MT = $400
    expect(parseFloat(report.data?.data?.totalCommission)).toBe(400);
  });

  it('filters by date range using deliveredAt (default reportDateField)', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    // Order in July (should be included)
    await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      quantity: '100',
      status: 'CONFIRMED',
      deliveredAt: '2026-07-10',
    });

    // Order in August (should be excluded from July report)
    await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      quantity: '200',
      status: 'CONFIRMED',
      deliveredAt: '2026-08-15',
    });

    const report = await requestJson('/reports/broker-commission?from=2026-07-01&to=2026-07-31', { token });
    expect(report.data?.success).toBe(true);
    expect(report.data?.data?.byCustomer.length).toBe(1);
    expect(report.data?.data?.byCustomer[0].orderCount).toBe(1);
    expect(parseFloat(report.data?.data?.totalCommission)).toBe(300); // 100 × 3
  });

  it('uses eta as date fallback when deliveredAt is null', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    // Create a confirmed broker deal with eta in July but no deliveredAt
    await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      quantity: '50',
      status: 'CONFIRMED',
      eta: '2026-07-15',
      deliveredAt: undefined, // no deliveredAt — should fall back to eta
    });

    const report = await requestJson('/reports/broker-commission?from=2026-07-01&to=2026-07-31', { token });
    expect(report.data?.success).toBe(true);
    expect(parseFloat(report.data?.data?.totalCommission)).toBe(150); // 50 × 3
  });

  it('filters by status — only includes orders in reportStatuses', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    // CONFIRMED order — should be included
    await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      quantity: '100',
      status: 'CONFIRMED',
      deliveredAt: '2026-07-10',
    });

    // INQUIRY order — should NOT be included (not in reportStatuses)
    await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      quantity: '200',
      status: 'INQUIRY',
      deliveredAt: '2026-07-10',
    });

    const report = await requestJson('/reports/broker-commission?from=2026-07-01&to=2026-07-31', { token });
    expect(report.data?.success).toBe(true);
    expect(report.data?.data?.byCustomer.length).toBe(1);
    expect(report.data?.data?.byCustomer[0].orderCount).toBe(1);
    expect(parseFloat(report.data?.data?.totalCommission)).toBe(300); // only 100 × 3
  });

  it('uses custom reportStatuses from tenant settings', async () => {
    const seeded = await seedAuthBasics();
    // Only DELIVERED status should be in report
    await enableBrokerDeals(seeded.tenant.id, { reportStatuses: ['DELIVERED'] });
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    // CONFIRMED order — should NOT be included with custom reportStatuses=['DELIVERED']
    await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      quantity: '100',
      status: 'CONFIRMED',
      deliveredAt: '2026-07-10',
    });

    const report = await requestJson('/reports/broker-commission?from=2026-07-01&to=2026-07-31', { token });
    expect(report.data?.success).toBe(true);
    expect(report.data?.data?.byCustomer.length).toBe(0);
    expect(parseFloat(report.data?.data?.totalCommission)).toBe(0);
  });

  it('filters by clientId parameter', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    // Create a second client
    const db = await getDb();
    const { counterparties } = await import('../src/db/schema');
    const [client2] = await db.insert(counterparties).values({
      tenantId: seeded.tenant.id,
      name: 'Second Client',
      type: 'CLIENT',
      types: ['CLIENT'],
      country: 'USA',
    }).returning();

    // Order for client 1
    await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      quantity: '100',
      status: 'CONFIRMED',
      deliveredAt: '2026-07-10',
    });

    // Order for client 2
    await createBrokerDeal(token, client2.id, seeded.vessel.id, seeded.place.id, {
      quantity: '200',
      status: 'CONFIRMED',
      deliveredAt: '2026-07-10',
    });

    // Report for all clients
    const allReport = await requestJson('/reports/broker-commission?from=2026-07-01&to=2026-07-31', { token });
    expect(allReport.data?.data?.byCustomer.length).toBe(2);
    expect(parseFloat(allReport.data?.data?.totalCommission)).toBe(900); // 300 + 600

    // Report filtered to client 1 only
    const clientReport = await requestJson(
      `/reports/broker-commission?from=2026-07-01&to=2026-07-31&clientId=${seeded.client.id}`,
      { token },
    );
    expect(clientReport.data?.data?.byCustomer.length).toBe(1);
    expect(parseFloat(clientReport.data?.data?.totalCommission)).toBe(300);
  });

  it('CSV export returns correct data', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      quantity: '100',
      status: 'CONFIRMED',
      deliveredAt: '2026-07-10',
    });

    const csvRes = await requestRaw('/reports/broker-commission/export?from=2026-07-01&to=2026-07-31', { token });
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get('content-type')).toContain('text/csv');
    const csvText = typeof csvRes.data === 'string' ? csvRes.data : '';
    expect(csvText).toContain('Broker Commission Report');
    expect(csvText).toContain(seeded.client.name);
    expect(csvText).toContain('300');
  });

  it('XLSX export returns correct content type', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      quantity: '100',
      status: 'CONFIRMED',
      deliveredAt: '2026-07-10',
    });

    const xlsxRes = await requestRaw(
      '/reports/broker-commission/export.xlsx?from=2026-07-01&to=2026-07-31',
      { token },
    );
    expect(xlsxRes.status).toBe(200);
    expect(xlsxRes.headers.get('content-type')).toContain('spreadsheetml');
  });

  it('returns empty report when no broker deals match criteria', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const report = await requestJson('/reports/broker-commission?from=2026-01-01&to=2026-01-31', { token });
    expect(report.status).toBe(200);
    expect(report.data?.success).toBe(true);
    expect(report.data?.data?.byCustomer.length).toBe(0);
    expect(parseFloat(report.data?.data?.totalCommission)).toBe(0);
    expect(report.data?.data?.period.from).toBe('2026-01-01');
    expect(report.data?.data?.period.to).toBe('2026-01-31');
  });

  it('does not include non-broker deals in the report', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    // Regular order (NOT a broker deal)
    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: {
        clientId: seeded.client.id,
        vesselId: seeded.vessel.id,
        placeId: seeded.place.id,
        // isBrokerDeal defaults to false
      },
    });
    const orderId = created.data?.data?.id as string;

    // Add items with commission
    await requestJson(`/orders/${orderId}/items`, {
      method: 'PUT',
      token,
      body: {
        items: [{
          productType: 'VLSFO',
          quantity: '100',
          unit: 'MT',
          costPrice: '100',
          costCurrency: 'USD',
          salesPrice: '115',
          salesCurrency: 'USD',
          commissionPerUnit: '3',
        }],
      },
    });

    // Set to CONFIRMED with delivery date
    await requestJson(`/orders/${orderId}/status`, {
      method: 'PUT',
      token,
      body: { status: 'CONFIRMED' },
    });
    const db = await getDb();
    await db.update(orders).set({ deliveredAt: new Date('2026-07-10') }).where(eq(orders.id, orderId));

    // Report should be empty — no broker deals
    const report = await requestJson('/reports/broker-commission?from=2026-07-01&to=2026-07-31', { token });
    expect(report.data?.data?.byCustomer.length).toBe(0);
    expect(parseFloat(report.data?.data?.totalCommission)).toBe(0);
  });
});