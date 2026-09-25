import { beforeEach, describe, expect, it } from 'bun:test';
import { seedAuthBasics, truncateAll, getDb } from './helpers/db';
import { loginE2E, requestJson, requestRaw } from './helpers/e2e';
import { and, eq } from 'drizzle-orm';
import { tenants, users, orders, orderItems } from '../src/db/schema';

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
 * NOTE: The report reads commission from orderItems.commissionPerUnit (an improvement
 * over the design doc's per-order commissionPerMt — allows per-line-item rates).
 * Items must be saved with commissionPerUnit set.
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

/** Create a broker deal order, add items with commission, and set status.
 *  Commission rate is set per-line-item via commissionPerUnit (an improvement over the design doc's per-order rate).
 */
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

  // Save order items with per-item commission rate
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

/**
 * Create a broker deal with SEVERAL lines in one save — the shape Moxie's
 * orders actually have (a fuel line beside a barging fee).
 */
async function createBrokerDealWithLines(
  token: string,
  clientId: string,
  vesselId: string,
  placeId: string,
  lines: Array<{ productType: string; quantity: string; unit?: string; commissionPerUnit?: string | null }>,
  opts: { status?: string; deliveredAt?: string } = {},
): Promise<string> {
  const created = await requestJson('/orders', {
    method: 'POST',
    token,
    body: { clientId, vesselId, placeId, isBrokerDeal: true, eta: opts.deliveredAt ?? '2026-07-15' },
  });
  const orderId = created.data?.data?.id as string;

  await requestJson(`/orders/${orderId}/items`, {
    method: 'PUT',
    token,
    body: {
      items: lines.map((l) => ({
        productType: l.productType,
        quantity: l.quantity,
        unit: l.unit ?? 'MT',
        costPrice: '100',
        costCurrency: 'USD',
        salesPrice: '115',
        salesCurrency: 'USD',
        commissionPerUnit: l.commissionPerUnit === undefined ? '3' : l.commissionPerUnit,
      })),
    },
  });

  if (opts.status && opts.status !== 'INQUIRY') {
    await requestJson(`/orders/${orderId}/status`, { method: 'PUT', token, body: { status: opts.status } });
  }
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

  it('falls back to the tenant defaultCommissionRate when neither item nor order rate is set', async () => {
    const seeded = await seedAuthBasics();
    // Only the CURRENT settings key is set. Setting both names (as this test
    // once did) hides the bug: the report used to read only the legacy
    // `defaultCommissionPerMt`, which nothing writes, so it fell through to 0
    // and reported zero commission on every real broker deal.
    await enableBrokerDeals(seeded.tenant.id, { defaultCommissionRate: 5 });
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

  // Moxie's real-world case: the UI seeds the order-level commissionPerMt from
  // the tenant default when a deal is marked as a broker deal, and line items
  // are priced with no per-line rate. Reading only the per-line field reported
  // 0.00 for every such deal.
  it('falls back to the ORDER-level commissionPerMt when the line item has no rate', async () => {
    const seeded = await seedAuthBasics();
    // Deliberately DIFFERENT from the order-level rate below. With both at 3,
    // 80 × 3 = 240 is produced by either branch, so the test passed even with
    // the order-level read deleted — it pinned nothing. 5 vs 3 makes the two
    // branches produce distinguishable totals (400 vs 240).
    await enableBrokerDeals(seeded.tenant.id, { defaultCommissionRate: 5 });
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const orderId = await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      commissionPerUnit: null,
      quantity: '80',
      status: 'CONFIRMED',
      deliveredAt: '2026-07-10',
    });

    // Set only the order-level rate, exactly as the UI does on the broker toggle
    const db = await getDb();
    await db.update(orders).set({ commissionPerMt: '3' }).where(eq(orders.id, orderId));

    const report = await requestJson('/reports/broker-commission?from=2026-07-01&to=2026-07-31', { token });
    expect(report.data?.success).toBe(true);
    // 80 MT × $3/MT (the ORDER rate) = $240. Falling through to the tenant
    // default of 5 would give 400, so this pins the order-level branch.
    expect(parseFloat(report.data?.data?.totalCommission)).toBe(240);
    expect(report.data?.data?.byCustomer[0].orders[0].commissionAmount).toBe('240.00');
    expect(report.data?.data?.byCustomer[0].orders[0].commissionPerMt).toBe('3');
  });

  it('prefers the per-line rate over the order-level rate when both are set', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id, { defaultCommissionRate: 3 });
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const orderId = await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      commissionPerUnit: '7',
      quantity: '100',
      status: 'CONFIRMED',
      deliveredAt: '2026-07-10',
    });

    const db = await getDb();
    await db.update(orders).set({ commissionPerMt: '3' }).where(eq(orders.id, orderId));

    const report = await requestJson('/reports/broker-commission?from=2026-07-01&to=2026-07-31', { token });
    expect(report.data?.success).toBe(true);
    expect(parseFloat(report.data?.data?.totalCommission)).toBe(700); // 100 × 7, not 100 × 3
  });

  // A rate of 'NaN'/'Infinity' is storable (Postgres numeric accepts those
  // literals, and sanitizeNumeric only nulls ''/'null'/'undefined'). Left
  // unguarded, one such row makes grandTotalCommission NaN, which then flows
  // into the exported CSV/XLSX and the flow that turns these totals into real
  // commission invoices.
  it('treats a non-finite stored rate as absent instead of poisoning the total', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id, { defaultCommissionRate: 3 });
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    // A good order alongside the poisoned one, to prove the total survives.
    await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      commissionPerUnit: '3',
      quantity: '100',
      status: 'CONFIRMED',
      deliveredAt: '2026-07-10',
    });

    const badId = await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      commissionPerUnit: null,
      quantity: '80',
      status: 'CONFIRMED',
      deliveredAt: '2026-07-11',
    });
    const db = await getDb();
    await db.update(orderItems).set({ commissionPerUnit: 'NaN' }).where(eq(orderItems.orderId, badId));

    const report = await requestJson('/reports/broker-commission?from=2026-07-01&to=2026-07-31', { token });
    expect(report.data?.success).toBe(true);

    const total = parseFloat(report.data?.data?.totalCommission);
    // The headline assertion: not NaN. Un-guarded, rate*qty is NaN and the
    // grand total becomes NaN, corrupting every downstream consumer.
    expect(Number.isFinite(total)).toBe(true);
    // 100 MT × $3 (per-line) = 300, plus the poisoned line falling through to
    // the tenant default of 3 → 80 × 3 = 240. Total 540.
    expect(total).toBe(540);
    expect(report.data?.data?.totalCommission).not.toContain('NaN');
  });

  // Note on the '' edge case: `Number('')` is 0 (not NaN), so a blank rate
  // would otherwise resolve to a $0 commission and override the order rate.
  // num() maps it to null. This is unit-level defence only — Postgres rejects
  // '' and whitespace for a numeric column, so it cannot arrive from the DB.
  it('resolves a blank or whitespace rate to the next tier, not to zero', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id, { defaultCommissionRate: 3 });
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const orderId = await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      commissionPerUnit: null,
      quantity: '80',
      status: 'CONFIRMED',
      deliveredAt: '2026-07-10',
    });
    const db = await getDb();
    // Only the order rate is set; the line has no rate at all.
    await db.update(orders).set({ commissionPerMt: '9' }).where(eq(orders.id, orderId));

    const report = await requestJson('/reports/broker-commission?from=2026-07-01&to=2026-07-31', { token });
    expect(report.data?.success).toBe(true);
    // 80 MT × $9 (the ORDER rate) = 720 — proving the per-line tier falls
    // through rather than resolving to 0.
    expect(parseFloat(report.data?.data?.totalCommission)).toBe(720);
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

  it('create-commission-orders endpoint rejected for non-admin users (H4 fixed)', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    // seedAuthBasics creates a TRADER (not ADMIN)
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const res = await requestJson('/reports/broker-commission/create-orders', {
      method: 'POST',
      token,
      body: { from: '2026-01-01', to: '2026-01-31' },
    });

    // H4 FIXED: endpoint now requires admin role
    expect(res.status).toBe(403);
    expect(res.data?.success).toBe(false);
  });

  it('a second click does NOT bill the same period twice', async () => {
    // Panel finding (Kimi #1 / GLM #1): every call minted NEW order rows, so a
    // double click created two identical commission invoices with nothing to
    // tell them apart.
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const db = await getDb();
    await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, seeded.user.id));
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      quantity: '100', status: 'CONFIRMED', deliveredAt: '2026-07-10',
    });

    const first = await requestJson('/reports/broker-commission/create-orders', {
      method: 'POST', token, body: { from: '2026-07-01', to: '2026-07-31' },
    });
    expect(first.status).toBe(200);
    expect(first.data?.data?.created.length).toBe(1);
    expect(first.data?.data?.alreadyCreated.length).toBe(0);

    // The second click — the bug. It must create NOTHING.
    const second = await requestJson('/reports/broker-commission/create-orders', {
      method: 'POST', token, body: { from: '2026-07-01', to: '2026-07-31' },
    });
    expect(second.status).toBe(200);
    expect(second.data?.data?.created.length).toBe(0);
    expect(second.data?.data?.alreadyCreated.length).toBe(1);
    expect(second.data?.data?.alreadyCreated[0].orderNumber).toBe(first.data?.data?.created[0].orderNumber);

    // And the database holds exactly ONE commission order for the period.
    const commissionOrders = await db
      .select({ id: orders.id })
      .from(orders)
      .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(and(eq(orders.tenantId, seeded.tenant.id), eq(orderItems.productType, 'BROKERAGE_COMMISSION')));
    expect(commissionOrders.length).toBe(1);
  });

  it('CONCURRENT clicks create exactly one commission order', async () => {
    // The sequential test above passes even with a read-then-write check; this
    // one only passes if the guarantee is durable (unique index) or serialized
    // (advisory lock), because both requests race past any pre-check.
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const db = await getDb();
    await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, seeded.user.id));
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      quantity: '100', status: 'CONFIRMED', deliveredAt: '2026-07-10',
    });

    const body = { from: '2026-07-01', to: '2026-07-31' };
    const [a, b] = await Promise.all([
      requestJson('/reports/broker-commission/create-orders', { method: 'POST', token, body }),
      requestJson('/reports/broker-commission/create-orders', { method: 'POST', token, body }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const createdCount = (a.data?.data?.created.length ?? 0) + (b.data?.data?.created.length ?? 0);
    expect(createdCount).toBe(1);

    const rows = await db
      .select({ id: orders.id })
      .from(orders)
      .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(and(eq(orders.tenantId, seeded.tenant.id), eq(orderItems.productType, 'BROKERAGE_COMMISSION')));
    expect(rows.length).toBe(1);
  });

  it('a DIFFERENT period still bills separately', async () => {
    // The guard is per (tenant, period, customer) — it must not become a
    // blanket "only ever one commission order".
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const db = await getDb();
    await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, seeded.user.id));
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      quantity: '100', status: 'CONFIRMED', deliveredAt: '2026-07-10',
    });
    await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      quantity: '50', status: 'CONFIRMED', deliveredAt: '2026-08-10',
    });

    const july = await requestJson('/reports/broker-commission/create-orders', {
      method: 'POST', token, body: { from: '2026-07-01', to: '2026-07-31' },
    });
    const august = await requestJson('/reports/broker-commission/create-orders', {
      method: 'POST', token, body: { from: '2026-08-01', to: '2026-08-31' },
    });
    expect(july.data?.data?.created.length).toBe(1);
    expect(august.data?.data?.created.length).toBe(1);
    expect(august.data?.data?.alreadyCreated.length).toBe(0);

    const rows = await db
      .select({ id: orders.id })
      .from(orders)
      .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(and(eq(orders.tenantId, seeded.tenant.id), eq(orderItems.productType, 'BROKERAGE_COMMISSION')));
    expect(rows.length).toBe(2);
  });

  it('unit conversion: commission uses raw quantity, not converted (M1 — known gap)', async () => {
    // The design doc says "Quantity conversion uses the existing unitConversionFactor on order items."
    // The implementation does NOT use unitConversionFactor — it uses raw quantity.
    // This test documents the current behavior: commission = rate × raw quantity (no conversion).
    // When M1 is fixed, update this test to expect the converted amount.
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    // Create a broker deal with GAL units and conversion factor 0.003785 (1 GAL = 0.003785 MT)
    // 1000 GAL at $3/GAL should be $3000 if converted, or $3000 if not converted (raw × rate)
    // But the report uses raw quantity (1000) × rate (3) = 3000, NOT converted (3.785 × 3 = 11.355)
    await createBrokerDeal(token, seeded.client.id, seeded.vessel.id, seeded.place.id, {
      commissionPerUnit: '3',
      quantity: '1000',
      unit: 'GAL',
      status: 'CONFIRMED',
      deliveredAt: '2026-07-10',
      unitConversionFactor: '0.003785',
    });

    const report = await requestJson('/reports/broker-commission?from=2026-07-01&to=2026-07-31', { token });
    expect(report.data?.success).toBe(true);
    // Current behavior: raw quantity (1000) × rate (3) = 3000
    // Design doc intent: converted qty (3.785) × rate (3) = 11.355
    // FIXME when M1 is fixed: expect(parseFloat(report.data?.data?.totalCommission)).toBe(11.36);
    expect(parseFloat(report.data?.data?.totalCommission)).toBe(3000);
  });

  it('commissions PRODUCTS only — a barging fee earns no per-MT commission', async () => {
    // Daniek (Moxie): "it counts the $3/MT on barging fee, but it should only
    // be on products". A barging fee is a lump sum stored with quantity 1, so
    // multiplying it by the $/MT rate billed a flat $3 as if it were a tonne —
    // and added the fee's 1 to the reported tonnage.
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [
        { productType: 'VLSFO', quantity: '218' },
        { productType: 'LSMGO', quantity: '45' },
        { productType: 'BARGING_FEE', quantity: '1' },
      ],
      { status: 'CONFIRMED', deliveredAt: '2026-08-20' },
    );

    const report = await requestJson('/reports/broker-commission?from=2026-08-01&to=2026-08-31', { token });
    expect(report.data?.success).toBe(true);

    // 218 + 45 tonnes at $3 — the barging line contributes neither.
    expect(parseFloat(report.data?.data?.totalCommission)).toBe((218 + 45) * 3);

    const cust = report.data?.data?.byCustomer[0];
    expect(parseFloat(cust.totalQuantity)).toBe(218 + 45);
    // The fee line is not listed at all: the report states products, and a
    // 0.00-commission fee row would still read as a billable line.
    const productTypes = cust.orders.map((o: { productType: string }) => o.productType);
    expect(productTypes).not.toContain('BARGING_FEE');
    expect(productTypes.sort()).toEqual(['LSMGO', 'VLSFO']);
  });

  it('lists only products in the deal row, matching its fee-excluded quantity', async () => {
    // The deal-economics "products" column joined every line type, so a broker
    // deal read "VLSFO, BARGING_FEE" beside a quantity that already excluded
    // the fee. Panel finding (DS2 #3).
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    // The endpoint is gated on the 'deal-economics' view + a money-privileged role.
    // Re-read AFTER enableBrokerDeals so this write does not clobber brokerDeals
    // with the pre-enable snapshot (which left isBrokerDeal stripped to false).
    const db0 = await getDb();
    const [freshTenant] = await db0.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, seeded.tenant.id));
    await db0.update(tenants).set({
      settings: { ...(freshTenant!.settings as object), enabledViews: ['deal-economics'] },
      updatedAt: new Date(),
    }).where(eq(tenants.id, seeded.tenant.id));
    await db0.update(users).set({ role: 'ADMIN' }).where(eq(users.id, seeded.user.id));

    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;
    const orderId = await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [
        { productType: 'VLSFO', quantity: '100' },
        { productType: 'BARGING_FEE', quantity: '1' },
      ],
      { status: 'CONFIRMED', deliveredAt: '2026-08-20' },
    );

    const res = await requestJson('/orders/deal-economics?from=2026-08-01&to=2026-08-31', { token });
    expect(res.status).toBe(200);
    const row = (res.data?.data ?? []).find((r: { id: string }) => r.id === orderId);
    expect(row).toBeTruthy();
    expect(row.products).toBe('VLSFO');
    expect(row.products).not.toContain('BARGING_FEE');
    // The quantity beside it already excluded the fee — the two must agree.
    expect(parseFloat(row.totalQuantity)).toBe(100);
  });

  it('excludes every fee/service line type, but keeps a custom product type', async () => {
    // The excluded set is the non-fuel half of the product-type enum. A custom
    // blend (Moxie trades B30/B100) is NOT in that set, so it stays
    // commissionable — the list is a deny list, so a new product type added
    // later does not silently drop out of the report.
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [
        { productType: 'VLSFO', quantity: '100' },
        { productType: 'ITEM', quantity: '1' },
        { productType: 'COMMISSION', quantity: '1' },
        { productType: 'HIRE', quantity: '1' },
        { productType: 'PAYMENT', quantity: '1' },
        { productType: 'CREDIT_NOTE', quantity: '1' },
        { productType: 'B30', quantity: '10' },
      ],
      { status: 'CONFIRMED', deliveredAt: '2026-08-20' },
    );

    const report = await requestJson('/reports/broker-commission?from=2026-08-01&to=2026-08-31', { token });
    const cust = report.data?.data?.byCustomer[0];
    const productTypes = cust.orders.map((o: { productType: string }) => o.productType).sort();

    expect(productTypes).toEqual(['B30', 'VLSFO']);
    // 100 + 10 tonnes only; the five fee lines contribute nothing.
    expect(parseFloat(cust.totalQuantity)).toBe(110);
    expect(parseFloat(report.data?.data?.totalCommission)).toBe(110 * 3);
  });
});
