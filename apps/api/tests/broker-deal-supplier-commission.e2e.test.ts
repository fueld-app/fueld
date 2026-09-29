import { beforeEach, describe, expect, it } from 'bun:test';
import { seedAuthBasics, truncateAll, getDb } from './helpers/db';
import { loginE2E, requestJson, requestRaw } from './helpers/e2e';
import { eq } from 'drizzle-orm';
import { counterparties, orderItems, orderSuppliers, orders, tenants } from '../src/db/schema';

/**
 * Supplier commission report — the mirror of the customer-side broker
 * commission report, grouped by SUPPLIER.
 *
 * Why: on a broker deal the supplier invoices the customer directly and the
 * broker's revenue is the commission. When a rate above the standard is
 * negotiated, the excess — and sometimes the whole rate — is funded by the
 * supplier, and the broker has to bill the supplier for it themselves. The
 * trader therefore enters TWO rates per line: what the customer pays
 * (`commissionPerUnit`, unchanged, with its three-tier fallback chain) and what
 * the supplier pays (`supplierCommissionPerUnit`, no fallback at all).
 *
 * These tests pin the separation: the supplier side must never inherit the
 * customer's rate, its fallbacks, or its grouping.
 */

async function enableBrokerDeals(tenantId: string, overrides?: Record<string, unknown>) {
  const db = await getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error('Tenant not found');
  const settings = {
    ...tenant.settings,
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

async function createSupplier(tenantId: string, name: string): Promise<string> {
  const db = await getDb();
  const [supplier] = await db
    .insert(counterparties)
    .values({ tenantId, name, type: 'SUPPLIER', types: ['SUPPLIER'], country: 'USA' })
    .returning();
  return supplier!.id;
}

interface TestLine {
  productType: string;
  quantity: string;
  unit?: string;
  commissionPerUnit?: string | null;
  supplierCommissionPerUnit?: string | null;
}

/**
 * Create a broker deal with explicit per-line rates on both sides.
 * `opts.supplierId` is what makes the deal billable to a supplier at all —
 * without it there is no party to bill and the report must skip the deal.
 */
async function createBrokerDealWithLines(
  token: string,
  clientId: string,
  vesselId: string,
  placeId: string,
  lines: TestLine[],
  opts: { supplierId?: string; status?: string; deliveredAt?: string } = {},
): Promise<string> {
  const created = await requestJson('/orders', {
    method: 'POST',
    token,
    body: {
      clientId,
      vesselId,
      placeId,
      isBrokerDeal: true,
      eta: opts.deliveredAt ?? '2026-07-15',
      ...(opts.supplierId ? { supplierId: opts.supplierId } : {}),
    },
  });
  const orderId = created.data?.data?.id as string;

  const saved = await requestJson(`/orders/${orderId}/items`, {
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
        ...(l.commissionPerUnit !== undefined ? { commissionPerUnit: l.commissionPerUnit } : {}),
        ...(l.supplierCommissionPerUnit !== undefined
          ? { supplierCommissionPerUnit: l.supplierCommissionPerUnit }
          : {}),
      })),
    },
  });
  if (saved.status !== 200) {
    throw new Error(`Saving items failed: ${JSON.stringify(saved.data)}`);
  }

  if (opts.status && opts.status !== 'INQUIRY') {
    await requestJson(`/orders/${orderId}/status`, { method: 'PUT', token, body: { status: opts.status } });
  }
  if (opts.deliveredAt) {
    const db = await getDb();
    await db.update(orders).set({ deliveredAt: new Date(opts.deliveredAt) }).where(eq(orders.id, orderId));
  }
  return orderId;
}

describe('supplier commission report e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('groups the supplier-funded commission by supplier, not by customer', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;

    const thor = await createSupplier(seeded.tenant.id, 'Thor Marine Trading');
    const fueling = await createSupplier(seeded.tenant.id, 'Fueling Maritime');

    // 145 MT at $19/MT funded by the supplier. The customer rate is 0 — the
    // supplier funds the whole rate, which is the shape Daniel described for
    // 20260916-000132 (the customer is not billed for it).
    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'LSMGO', quantity: '145', commissionPerUnit: '0', supplierCommissionPerUnit: '19' }],
      { supplierId: thor, status: 'CONFIRMED', deliveredAt: '2026-09-20' },
    );
    // 100 MT at $86.42/MT to a different supplier — must land in its own group.
    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '3', supplierCommissionPerUnit: '86.42' }],
      { supplierId: fueling, status: 'CONFIRMED', deliveredAt: '2026-09-22' },
    );

    const res = await requestJson('/reports/supplier-commission?from=2026-09-01&to=2026-09-30', { token });
    expect(res.status).toBe(200);
    const report = res.data?.data;
    expect(report.currency).toBe('USD');
    expect(report.bySupplier.length).toBe(2);

    const thorGroup = report.bySupplier.find((s: { supplierName: string }) => s.supplierName === 'Thor Marine Trading');
    expect(thorGroup).toBeTruthy();
    // 145 × 19 = 2755
    expect(parseFloat(thorGroup.totalCommission)).toBe(2755);
    expect(parseFloat(thorGroup.totalQuantity)).toBe(145);
    expect(thorGroup.supplierId).toBe(thor);
    // The same line's customer side is 145 × 0 — carried for reconciliation,
    // never subtracted from the supplier figure.
    expect(parseFloat(thorGroup.customerCommission)).toBe(0);

    const fuelingGroup = report.bySupplier.find((s: { supplierName: string }) => s.supplierName === 'Fueling Maritime');
    expect(parseFloat(fuelingGroup.totalCommission)).toBe(8642);
    expect(parseFloat(fuelingGroup.customerCommission)).toBe(300);

    expect(parseFloat(report.totalCommission)).toBe(2755 + 8642);
    expect(parseFloat(report.customerCommission)).toBe(0 + 300);
  });

  it('does not leak the customer rate into the supplier total when no supplier rate is set', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'World Fuel Services');

    // Ordinary Moxie deal: the customer funds $3/MT, the supplier funds nothing.
    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '3' }],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-20' },
    );

    const supplierRes = await requestJson('/reports/supplier-commission?from=2026-09-01&to=2026-09-30', { token });
    expect(supplierRes.data?.data?.bySupplier.length).toBe(0);
    expect(parseFloat(supplierRes.data?.data?.totalCommission)).toBe(0);

    // The customer report still bills it — the two reports are independent.
    const customerRes = await requestJson('/reports/broker-commission?from=2026-09-01&to=2026-09-30', { token });
    expect(parseFloat(customerRes.data?.data?.totalCommission)).toBe(300);
  });

  it('does not inherit the order-level commission rate on the supplier side', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Integr8 Fuels');

    // Deliberately NO per-line customer rate and an order-level rate of 9 — the
    // customer report falls back to it, the supplier report must not.
    const orderId = await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100' }],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-20' },
    );
    const db = await getDb();
    await db.update(orders).set({ commissionPerMt: '9' }).where(eq(orders.id, orderId));

    const customerRes = await requestJson('/reports/broker-commission?from=2026-09-01&to=2026-09-30', { token });
    expect(parseFloat(customerRes.data?.data?.totalCommission)).toBe(900);

    const supplierRes = await requestJson('/reports/supplier-commission?from=2026-09-01&to=2026-09-30', { token });
    expect(parseFloat(supplierRes.data?.data?.totalCommission)).toBe(0);
  });

  it('persists supplierCommissionPerUnit on the line, including a deliberate zero', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;

    const orderId = await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [
        { productType: 'VLSFO', quantity: '100', commissionPerUnit: '0', supplierCommissionPerUnit: '19' },
        { productType: 'LSMGO', quantity: '50', commissionPerUnit: '3', supplierCommissionPerUnit: '0' },
      ],
      { status: 'CONFIRMED', deliveredAt: '2026-09-20' },
    );

    const detail = await requestJson(`/orders/${orderId}`, { token });
    const items = detail.data?.data?.items ?? [];
    const vlsfo = items.find((i: { productType: string }) => i.productType === 'VLSFO');
    const lsmgo = items.find((i: { productType: string }) => i.productType === 'LSMGO');

    expect(parseFloat(vlsfo.supplierCommissionPerUnit)).toBe(19);
    // The customer pays NOTHING on this line — the supplier funds the whole
    // rate (confirmed by Moxie for 20260916-000132). A customer-side 0 must
    // survive as a stored 0: if it were normalized to null, the customer report
    // would fall back to the order-level rate and bill the customer commission
    // that the supplier is paying.
    // The API returns numerics as strings ("0.0000000"), and that value is the
    // point: a null here would let the customer report fall back to the
    // order-level rate and bill the customer the commission the supplier pays.
    expect(vlsfo.commissionPerUnit).not.toBeNull();
    expect(parseFloat(vlsfo.commissionPerUnit)).toBe(0);
    expect(String(vlsfo.commissionPerUnit)).toMatch(/^0(\.0+)?$/);
    // A stored 0 means "the supplier owes nothing on this line" — it must not be
    // normalized to null, or the API could not tell it apart from "unset".
    expect(parseFloat(lsmgo.supplierCommissionPerUnit)).toBe(0);
    expect(parseFloat(lsmgo.commissionPerUnit)).toBe(3);
  });

  it('excludes charge lines from the supplier side, like the customer side', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Arte Bunkering');

    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [
        { productType: 'VLSFO', quantity: '100', commissionPerUnit: '3', supplierCommissionPerUnit: '5' },
        // A barging fee is a lump sum stored with quantity 1; even with a rate
        // set it is not a product and earns nothing on either side.
        { productType: 'BARGING_FEE', quantity: '1', commissionPerUnit: '10', supplierCommissionPerUnit: '10' },
      ],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-20' },
    );

    const res = await requestJson('/reports/supplier-commission?from=2026-09-01&to=2026-09-30', { token });
    const group = res.data?.data?.bySupplier[0];
    expect(group.orders.length).toBe(1);
    expect(group.orders[0].productType).toBe('VLSFO');
    // 100 × 5, and the fee's quantity 1 is not counted as tonnage.
    expect(parseFloat(group.totalCommission)).toBe(500);
    expect(parseFloat(group.totalQuantity)).toBe(100);
  });

  it('omits a broker deal that has no supplier leg, and is empty for a period with none', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;

    // A rate is set but there is no supplier to bill.
    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '3', supplierCommissionPerUnit: '19' }],
      { status: 'CONFIRMED', deliveredAt: '2026-09-20' },
    );

    const res = await requestJson('/reports/supplier-commission?from=2026-09-01&to=2026-09-30', { token });
    expect(res.status).toBe(200);
    expect(res.data?.data?.bySupplier.length).toBe(0);
    expect(parseFloat(res.data?.data?.totalCommission)).toBe(0);

    const otherPeriod = await requestJson('/reports/supplier-commission?from=2026-01-01&to=2026-01-31', { token });
    expect(otherPeriod.data?.data?.bySupplier.length).toBe(0);
  });

  it('exports CSV and XLSX with the supplier and customer columns', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Minerva Bunkering');

    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'LSMGO', quantity: '145', commissionPerUnit: '3', supplierCommissionPerUnit: '19' }],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-20' },
    );

    const csvRes = await requestRaw('/reports/supplier-commission/export?from=2026-09-01&to=2026-09-30', { token });
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get('content-type')).toContain('text/csv');
    const csvText = typeof csvRes.data === 'string' ? csvRes.data : '';
    expect(csvText).toContain('Supplier Commission Report');
    expect(csvText).toContain('Minerva Bunkering');
    expect(csvText).toContain(seeded.client.name);
    // 145 × 19 = 2755 supplier side, 145 × 3 = 435 customer side, both present.
    expect(csvText).toContain('2755');
    expect(csvText).toContain('435');

    const xlsxRes = await requestRaw('/reports/supplier-commission/export.xlsx?from=2026-09-01&to=2026-09-30', { token });
    expect(xlsxRes.status).toBe(200);
    expect(xlsxRes.headers.get('content-type')).toContain('spreadsheetml');
  });

  it('excludes a multi-supplier-leg deal rather than attributing it to the primary', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;

    const primary = await createSupplier(seeded.tenant.id, 'Primary Supplier');
    const secondary = await createSupplier(seeded.tenant.id, 'Secondary Supplier');

    const orderId = await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '3', supplierCommissionPerUnit: '19' }],
      { supplierId: primary, status: 'CONFIRMED', deliveredAt: '2026-09-20' },
    );

    // A second supplier leg on the same order. `orders.supplier_id` is only the
    // primary, so the report cannot tell which supplier this line's commission
    // belongs to. Attributing it to the primary would under-bill the other.
    const db = await getDb();
    await db.insert(orderSuppliers).values({
      orderId,
      companyId: secondary,
      isPrimary: false,
      sortOrder: 1,
    });

    const res = await requestJson('/reports/supplier-commission?from=2026-09-01&to=2026-09-30', { token });
    expect(res.status).toBe(200);
    const report = res.data?.data;
    expect(report.bySupplier.length).toBe(0);
    expect(parseFloat(report.totalCommission)).toBe(0);
    expect(report.attributedToMultipleSuppliers.length).toBe(1);

    // And the exclusion is stated in the exported document, not only on screen.
    const csvRes = await requestRaw('/reports/supplier-commission/export?from=2026-09-01&to=2026-09-30', { token });
    const csvText = typeof csvRes.data === 'string' ? csvRes.data : '';
    expect(csvText).toContain('EXCLUDED');
  });

  it('still attributes a deal whose single leg matches the order supplier', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Solo Supplier');

    // One leg, matching — the normal case must not be caught by the guard.
    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '3', supplierCommissionPerUnit: '19' }],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-20' },
    );

    const res = await requestJson('/reports/supplier-commission?from=2026-09-01&to=2026-09-30', { token });
    expect(res.data?.data?.attributedToMultipleSuppliers.length).toBe(0);
    expect(parseFloat(res.data?.data?.totalCommission)).toBe(1900);
  });

  it('statement foots: displayed lines and subtotals sum to the displayed total', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Rounding Supplier');

    // Rates chosen so the raw product has sub-cent precision and only the
    // per-line rounding makes the columns add up: 0.3333 × 3 = 0.9999, and
    // 7.7777 × 3 = 23.3331. Without the rounding these would drift the total
    // away from the sum of the line amounts a reader can see.
    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [
        { productType: 'VLSFO', quantity: '3', commissionPerUnit: '0.3333', supplierCommissionPerUnit: '0.3333' },
        { productType: 'LSMGO', quantity: '3', commissionPerUnit: '7.7777', supplierCommissionPerUnit: '7.7777' },
      ],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-20' },
    );

    const res = await requestJson('/reports/supplier-commission?from=2026-09-01&to=2026-09-30', { token });
    const report = res.data?.data;
    const lineSum = report.bySupplier
      .flatMap((s: { orders: Array<{ commissionAmount: string }> }) => s.orders)
      .reduce((sum: number, o: { commissionAmount: string }) => sum + parseFloat(o.commissionAmount), 0);
    const subtotalSum = report.bySupplier
      .reduce((sum: number, s: { totalCommission: string }) => sum + parseFloat(s.totalCommission), 0);

    const grand = parseFloat(report.totalCommission);
    // 1.00 + 23.33 = 24.33
    expect(grand).toBe(24.33);
    expect(lineSum.toFixed(2)).toBe(grand.toFixed(2));
    expect(subtotalSum.toFixed(2)).toBe(grand.toFixed(2));
  });

  it('hides the report entirely when the tenant has broker deals disabled', async () => {
    const seeded = await seedAuthBasics();
    // Feature left OFF: the tenant never enabled broker deals.
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;

    // The nav link is hidden client-side, but the API is the authority — an
    // authenticated user of any tenant must not be able to read the statement.
    for (const url of [
      '/reports/supplier-commission?from=2026-09-01&to=2026-09-30',
      '/reports/supplier-commission/export?from=2026-09-01&to=2026-09-30',
      '/reports/supplier-commission/export.xlsx?from=2026-09-01&to=2026-09-30',
    ]) {
      const res = await requestJson(url, { token });
      expect(res.status).toBe(404);
    }

    // And it becomes readable the moment the feature is switched on.
    await enableBrokerDeals(seeded.tenant.id);
    const after = await requestJson('/reports/supplier-commission?from=2026-09-01&to=2026-09-30', { token });
    expect(after.status).toBe(200);
  });

  it('rejects a negative commission rate at the API, not just in the form', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;

    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: { clientId: seeded.client.id, vesselId: seeded.vessel.id, placeId: seeded.place.id, isBrokerDeal: true },
    });
    const orderId = created.data?.data?.id as string;

    // The input has min="0" but that is advisory — a direct API call bypasses
    // the form. A negative rate would silently reduce what the supplier owes.
    const save = await requestJson(`/orders/${orderId}/items`, {
      method: 'PUT',
      token,
      body: {
        items: [{
          productType: 'VLSFO', quantity: '100', unit: 'MT',
          costPrice: '100', costCurrency: 'USD', salesPrice: '115', salesCurrency: 'USD',
          commissionPerUnit: '3', supplierCommissionPerUnit: '-19',
        }],
      },
    });
    expect(save.status).toBe(200);
    expect(save.data?.success).toBe(false);
    expect(String(save.data?.message)).toContain('negative');
  });

  it('leaves a non-broker order out even when it carries supplier rates', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Stena Oil');

    // Ordinary trade (isBrokerDeal false) with both rates set.
    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: { clientId: seeded.client.id, vesselId: seeded.vessel.id, placeId: seeded.place.id, supplierId },
    });
    const orderId = created.data?.data?.id as string;
    await requestJson(`/orders/${orderId}/items`, {
      method: 'PUT',
      token,
      body: {
        items: [{
          productType: 'VLSFO', quantity: '100', unit: 'MT',
          costPrice: '100', costCurrency: 'USD', salesPrice: '115', salesCurrency: 'USD',
          commissionPerUnit: '3', supplierCommissionPerUnit: '19',
        }],
      },
    });
    await requestJson(`/orders/${orderId}/status`, { method: 'PUT', token, body: { status: 'CONFIRMED' } });
    const db = await getDb();
    await db.update(orders).set({ deliveredAt: new Date('2026-09-20') }).where(eq(orders.id, orderId));

    const res = await requestJson('/reports/supplier-commission?from=2026-09-01&to=2026-09-30', { token });
    expect(res.data?.data?.bySupplier.length).toBe(0);
    expect(parseFloat(res.data?.data?.totalCommission)).toBe(0);

    // And the rate really was stored, so the exclusion is the broker-deal gate
    // and not a silently dropped field.
    const [row] = await db
      .select({ supplierRate: orderItems.supplierCommissionPerUnit })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    expect(parseFloat(row!.supplierRate!)).toBe(19);
  });
});
