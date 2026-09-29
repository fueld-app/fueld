import { beforeEach, describe, expect, it } from 'bun:test';
import { seedAuthBasics, truncateAll, getDb } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';
import { eq } from 'drizzle-orm';
import {
  counterparties,
  orderItems,
  orders,
  supplierInvoiceLines,
  supplierInvoices,
  supplierPayments,
  tenants,
} from '../src/db/schema';

/**
 * Supplier invoices — the real receivable for commission a SUPPLIER funds on a
 * broker deal.
 *
 * Why a separate ledger: `invoices` has no payer column, so collections, ageing,
 * company balance and QuickBooks all infer the payer from `orders.client_id`. A
 * supplier-addressed row there would be booked as a CUSTOMER receivable. These
 * tests pin both the behaviour AND that separation.
 *
 * The other invariant under test is the SNAPSHOT: an issued invoice must keep
 * serving the figures it was issued with. Editing the order afterwards must not
 * restate a document the supplier already holds.
 */

/**
 * Raising and voiding a supplier invoice is admin-only, and `seedAuthBasics`
 * creates a TRADER. Tests that exercise the happy path promote the user; one
 * test below deliberately does not, to pin the gate.
 */
async function promoteToAdmin(userId: string) {
  const db = await getDb();
  const { users } = await import('../src/db/schema');
  await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, userId));
}

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

async function createBrokerDealWithLines(
  token: string,
  clientId: string,
  vesselId: string,
  placeId: string,
  lines: Array<{ productType: string; quantity: string; unit?: string; commissionPerUnit?: string | null; supplierCommissionPerUnit?: string | null }>,
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
      eta: opts.deliveredAt ?? '2026-09-15',
      ...(opts.supplierId ? { supplierId: opts.supplierId } : {}),
    },
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
        ...(l.commissionPerUnit !== undefined ? { commissionPerUnit: l.commissionPerUnit } : {}),
        ...(l.supplierCommissionPerUnit !== undefined
          ? { supplierCommissionPerUnit: l.supplierCommissionPerUnit }
          : {}),
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

describe('supplier invoices e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('raises one invoice per supplier from the period, with a real number and the lines', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const thor = await createSupplier(seeded.tenant.id, 'Thor Marine Trading');

    // 145 MT x 19 funded entirely by the supplier — the shape Moxie confirmed.
    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'LSMGO', quantity: '145', commissionPerUnit: '0', supplierCommissionPerUnit: '19' }],
      { supplierId: thor, status: 'CONFIRMED', deliveredAt: '2026-09-15' },
    );

    const res = await requestJson('/supplier-invoices', {
      method: 'POST',
      token,
      body: { from: '2026-09-01', to: '2026-09-30' },
    });
    expect(res.status).toBe(200);
    const result = res.data?.data;
    expect(result.created.length).toBe(1);
    expect(result.created[0].supplierName).toBe('Thor Marine Trading');
    expect(parseFloat(result.created[0].amount)).toBe(2755);
    // Its OWN series, not the customer invoice series.
    expect(result.created[0].invoiceNumber).toMatch(/^SINV-/);

    const db = await getDb();
    const [issuedInvoice] = await db.select().from(supplierInvoices);
    const detail = await requestJson(`/supplier-invoices/${issuedInvoice!.id}`, { token });
    const invoice = detail.data?.data;
    expect(invoice.lines.length).toBe(1);
    expect(parseFloat(invoice.lines[0].amount)).toBe(2755);
    expect(parseFloat(invoice.lines[0].rate)).toBe(19);
    expect(invoice.lines[0].productType).toBe('LSMGO');
    expect(invoice.status).toBe('SENT');
    expect(parseFloat(invoice.amountOutstanding)).toBe(2755);
  });

  it('is idempotent per period: a second call creates nothing and names the invoice', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Fueling Maritime');

    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '0', supplierCommissionPerUnit: '86.42' }],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-15' },
    );

    const first = await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });
    expect(first.data?.data?.created.length).toBe(1);
    const number = first.data?.data?.created[0].invoiceNumber;

    // A double click, a second tab, or a retry must not bill the supplier twice.
    const second = await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });
    expect(second.data?.data?.created.length).toBe(0);
    expect(second.data?.data?.alreadyInvoiced.length).toBe(1);
    expect(second.data?.data?.alreadyInvoiced[0].invoiceNumber).toBe(number);

    const db = await getDb();
    const all = await db.select().from(supplierInvoices);
    expect(all.length).toBe(1);
  });

  it('does not restate an issued invoice when the order is edited afterwards', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Rename Me Ltd');

    const orderId = await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '0', supplierCommissionPerUnit: '19' }],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-15' },
    );

    await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });

    const db = await getDb();
    const [issued] = await db.select().from(supplierInvoices);
    const before = await requestJson(`/supplier-invoices/${issued!.id}`, { token });

    // Now change everything the invoice was built from.
    await db.update(counterparties).set({ name: 'Renamed After Issue' }).where(eq(counterparties.id, supplierId));
    await db.update(orderItems).set({ supplierCommissionPerUnit: '999' }).where(eq(orderItems.orderId, orderId));

    const after = await requestJson(`/supplier-invoices/${issued!.id}`, { token });
    expect(after.data?.data?.supplierName).toBe('Rename Me Ltd');
    expect(after.data?.data?.amount).toBe(before.data?.data?.amount);
    expect(parseFloat(after.data?.data?.lines[0].rate)).toBe(19);
    expect(parseFloat(after.data?.data?.lines[0].amount)).toBe(1900);

    // And the snapshot really is stored, not merely re-derived to the same value.
    const stored = await db.select().from(supplierInvoiceLines).where(eq(supplierInvoiceLines.supplierInvoiceId, issued!.id));
    expect(stored.length).toBe(1);
    expect(parseFloat(stored[0]!.amount)).toBe(1900);
  });

  it('settles from the payments actually recorded, then reopens when one is removed', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Paying Supplier');

    const orderId = await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '0', supplierCommissionPerUnit: '10' }],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-15' },
    );
    await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });

    const db = await getDb();
    const [invoice] = await db.select().from(supplierInvoices);
    // 100 x 10 = 1000
    expect(parseFloat(invoice!.amount)).toBe(1000);

    // A receipt from the supplier needs a real supplier leg, which the broker
    // deal's supplier sync created.
    const { orderSuppliers } = await import('../src/db/schema');
    const [leg] = await db.select().from(orderSuppliers).where(eq(orderSuppliers.orderId, orderId)).limit(1);
    expect(leg).toBeTruthy();


    // A receipt recorded through the ORDERS route — the real path an operator
    // uses — must settle the invoice. Asserted unconditionally: a conditional
    // check here would silently pass if the route stopped accepting
    // `supplierInvoiceId` altogether.
    const viaApi = await requestJson(`/orders/${orderId}/suppliers/${leg!.id}/payments`, {
      method: 'POST',
      token,
      body: { amount: '400', currency: 'USD', supplierInvoiceId: invoice!.id },
    });
    expect(viaApi.status).toBe(200);
    const [receipt] = await db.select().from(supplierPayments).limit(1);
    expect(receipt?.supplierInvoiceId).toBe(invoice!.id);

    let view = await requestJson(`/supplier-invoices/${invoice!.id}`, { token });
    expect(view.data?.data?.status).toBe('PARTIALLY_PAID');
    expect(parseFloat(view.data?.data?.amountReceived)).toBe(400);
    expect(parseFloat(view.data?.data?.amountOutstanding)).toBe(600);

    // A receipt in another currency must be REFUSED, not silently ignored by the
    // settlement sum — otherwise a EUR receipt could mark a USD invoice paid.
    const mismatched = await requestJson(`/orders/${orderId}/suppliers/${leg!.id}/payments`, {
      method: 'POST',
      token,
      body: { amount: '100', currency: 'EUR', supplierInvoiceId: invoice!.id },
    });
    expect(mismatched.data?.success).toBe(false);

    // Settle the balance, then remove it: amounts are the truth, so the invoice
    // must reopen rather than keep a stale PAID flag.
    const [balance] = await db.insert(supplierPayments).values({
      tenantId: seeded.tenant.id,
      orderSupplierId: leg!.id,
      orderId,
      supplierId,
      supplierInvoiceId: invoice!.id,
      amount: '600',
      currency: 'USD',
    }).returning();
    view = await requestJson(`/supplier-invoices/${invoice!.id}`, { token });
    expect(view.data?.data?.status).toBe('PAID');
    expect(parseFloat(view.data?.data?.amountOutstanding)).toBe(0);

    await db.delete(supplierPayments).where(eq(supplierPayments.id, balance!.id));

    // No manual recompute: the detail read must self-heal, which is what makes a
    // payment written outside the ledger helper safe.
    view = await requestJson(`/supplier-invoices/${invoice!.id}`, { token });
    expect(view.data?.data?.status).toBe('PARTIALLY_PAID');
    expect(parseFloat(view.data?.data?.amountReceived)).toBe(400);
    expect(parseFloat(view.data?.data?.amountOutstanding)).toBe(600);
  });

  it('excludes a voided invoice and lets a new one be raised for the period', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Void Test Ltd');

    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '50', commissionPerUnit: '0', supplierCommissionPerUnit: '10' }],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-15' },
    );
    await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });

    const db = await getDb();
    const [issued] = await db.select().from(supplierInvoices);

    const voided = await requestJson(`/supplier-invoices/${issued!.id}/void`, { method: 'POST', token, body: { reason: 'wrong rate' } });
    expect(voided.data?.data?.status).toBe('VOID');

    // Hidden from the default list, but still on file for audit.
    const list = await requestJson('/supplier-invoices', { token });
    expect(list.data?.data.length).toBe(0);
    const withVoid = await requestJson('/supplier-invoices?includeVoid=true', { token });
    expect(withVoid.data?.data.length).toBe(1);

    // The number is NOT reused, so the two documents stay traceable.
    const again = await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });
    expect(again.data?.data?.created.length).toBe(1);
    expect(again.data?.data?.created[0].invoiceNumber).not.toBe(issued!.invoiceNumber);
  });

  it('reports suppliers it could not invoice rather than silently omitting them', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;

    // A rate set but NO supplier on the order: nobody to bill.
    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '0', supplierCommissionPerUnit: '19' }],
      { status: 'CONFIRMED', deliveredAt: '2026-09-15' },
    );

    const res = await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });
    expect(res.status).toBe(200);
    // Nothing to bill, and the caller can tell that apart from "no commission".
    expect(res.data?.data?.created.length).toBe(0);

    const candidates = await requestJson('/supplier-invoices/candidates?from=2026-09-01&to=2026-09-30', { token });
    expect(candidates.data?.data.length).toBe(0);
  });

  it('hides everything when the tenant does not have broker deals enabled', async () => {
    const seeded = await seedAuthBasics();
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;

    for (const [method, url] of [
      ['GET', '/supplier-invoices'],
      ['GET', '/supplier-invoices/candidates?from=2026-09-01&to=2026-09-30'],
    ] as const) {
      const res = await requestJson(url, { method, token });
      expect(res.status).toBe(404);
    }
    const create = await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });
    expect(create.status).toBe(404);
  });

  it('refuses to raise or void a supplier invoice for a non-admin', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    // Deliberately NOT promoted: seedAuthBasics creates a TRADER.
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;

    const create = await requestJson('/supplier-invoices', {
      method: 'POST',
      token,
      body: { from: '2026-09-01', to: '2026-09-30' },
    });
    expect(create.status).toBe(403);

    // Reading is allowed for any authenticated user of the tenant.
    const list = await requestJson('/supplier-invoices', { token });
    expect(list.status).toBe(200);

    const voidRes = await requestJson('/supplier-invoices/00000000-0000-0000-0000-000000000000/void', {
      method: 'POST',
      token,
      body: {},
    });
    expect(voidRes.status).toBe(403);
  });

  it('list and detail agree on the received figure, including for a foreign-currency receipt', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Agreement Test Ltd');

    const orderId = await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '0', supplierCommissionPerUnit: '10' }],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-15' },
    );
    await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });

    const db = await getDb();
    const [invoice] = await db.select().from(supplierInvoices);
    const { orderSuppliers } = await import('../src/db/schema');
    const [leg] = await db.select().from(orderSuppliers).where(eq(orderSuppliers.orderId, orderId)).limit(1);

    // A USD receipt and a EUR one written straight to the table — the foreign
    // one must count in NEITHER view.
    await db.insert(supplierPayments).values({
      tenantId: seeded.tenant.id, orderSupplierId: leg!.id, orderId, supplierId,
      supplierInvoiceId: invoice!.id, amount: '250', currency: 'USD',
    });
    await db.insert(supplierPayments).values({
      tenantId: seeded.tenant.id, orderSupplierId: leg!.id, orderId, supplierId,
      supplierInvoiceId: invoice!.id, amount: '9999', currency: 'EUR',
    });

    const detail = await requestJson(`/supplier-invoices/${invoice!.id}`, { token });
    const list = await requestJson('/supplier-invoices', { token });
    const listRow = list.data?.data[0];

    expect(parseFloat(detail.data?.data?.amountReceived)).toBe(250);
    expect(parseFloat(detail.data?.data?.amountOutstanding)).toBe(750);
    // The list must not disagree with the detail.
    expect(parseFloat(listRow?.amountReceived)).toBe(250);
    expect(parseFloat(listRow?.amountOutstanding)).toBe(750);
    expect(listRow?.status).toBe(detail.data?.data?.status);
  });

  it('does not count a receipt from the supplier as money we paid the supplier', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Direction Test Ltd');

    const orderId = await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '0', supplierCommissionPerUnit: '10' }],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-15' },
    );
    await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });

    const db = await getDb();
    const [invoice] = await db.select().from(supplierInvoices);
    const { orderSuppliers } = await import('../src/db/schema');
    const [leg] = await db.select().from(orderSuppliers).where(eq(orderSuppliers.orderId, orderId)).limit(1);

    // An OUTBOUND payment we made to the supplier for fuel.
    await db.insert(supplierPayments).values({
      tenantId: seeded.tenant.id, orderSupplierId: leg!.id, orderId, supplierId,
      amount: '500', currency: 'USD',
    });
    // A receipt FROM the supplier settling their commission invoice.
    await requestJson(`/orders/${orderId}/suppliers/${leg!.id}/payments`, {
      method: 'POST',
      token,
      body: { amount: '400', currency: 'USD', supplierInvoiceId: invoice!.id },
    });

    // The leg's "amount paid" is what WE paid: 500, not 900.
    const { listSupplierPayments, updateOrderSupplierAmountPaid } = await import('../src/modules/orders/orders.service');
    await updateOrderSupplierAmountPaid(leg!.id);
    const outbound = await listSupplierPayments(leg!.id);
    expect(outbound.length).toBe(1);
    expect(parseFloat(outbound[0]!.amount)).toBe(500);

    // And the receipt still settled the invoice.
    const detail = await requestJson(`/supplier-invoices/${invoice!.id}`, { token });
    expect(parseFloat(detail.data?.data?.amountReceived)).toBe(400);
  });

  it('serializes concurrent issues: two parallel calls create exactly one invoice', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Concurrency Ltd');

    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '0', supplierCommissionPerUnit: '19' }],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-15' },
    );

    // Two tabs, or a double click, arriving together. The advisory lock plus the
    // unique index must produce exactly one invoice and one "already invoiced",
    // never two numbers for the same period.
    const [a, b] = await Promise.all([
      requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } }),
      requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } }),
    ]);

    const created = [...(a.data?.data?.created ?? []), ...(b.data?.data?.created ?? [])];
    const already = [...(a.data?.data?.alreadyInvoiced ?? []), ...(b.data?.data?.alreadyInvoiced ?? [])];
    expect(created.length).toBe(1);
    expect(already.length).toBe(1);
    expect(already[0].invoiceNumber).toBe(created[0].invoiceNumber);

    const db = await getDb();
    const all = await db.select().from(supplierInvoices);
    expect(all.length).toBe(1);
  });

  it('keeps supplier invoices out of the customer receivable ledger', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Separation Test Ltd');

    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '0', supplierCommissionPerUnit: '19' }],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-15' },
    );
    await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });

    const db = await getDb();
    const { invoices } = await import('../src/db/schema');
    // The customer ledger must be untouched: this is not a customer receivable.
    const customerInvoices = await db.select().from(invoices);
    expect(customerInvoices.length).toBe(0);
    const supplierInvoiceRows = await db.select().from(supplierInvoices);
    expect(supplierInvoiceRows.length).toBe(1);
  });

  it('does not leak another tenant\'s invoice through the detail route', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Tenant A Supplier');

    await createBrokerDealWithLines(
      token, seeded.client.id, seeded.vessel.id, seeded.place.id,
      [{ productType: 'VLSFO', quantity: '100', commissionPerUnit: '0', supplierCommissionPerUnit: '19' }],
      { supplierId, status: 'CONFIRMED', deliveredAt: '2026-09-15' },
    );
    await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });

    const db = await getDb();
    const [invoice] = await db.select().from(supplierInvoices);

    // A second tenant with the same feature enabled.
    const [other] = await db.insert(tenants).values({ name: 'Other Tenant', domain: 'other.local' }).returning();
    const { users } = await import('../src/db/schema');
    const { hashPassword } = await import('../src/modules/auth/password.service');
    await db.insert(users).values({
      tenantId: other!.id,
      email: 'other@test.local',
      name: 'Other User',
      role: 'ADMIN',
      passwordHash: await hashPassword('Password123!'),
    });
    await enableBrokerDeals(other!.id);
    const otherToken = (await loginE2E('other@test.local', 'Password123!')).accessToken;

    const res = await requestJson(`/supplier-invoices/${invoice!.id}`, { token: otherToken });
    expect(res.status).toBe(404);
  });
});
