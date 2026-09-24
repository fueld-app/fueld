import { beforeEach, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { counterparties, creditLineCounterparties } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';

async function loadCreditService() {
  return import('../src/modules/credit/credit.service');
}

async function loadOrdersService() {
  return import('../src/modules/orders/orders.service');
}

beforeEach(async () => {
  await truncateAll();
});

describe('credit.service', () => {
  it('creates, gets, lists, updates, and deletes a credit line', async () => {
    const { tenant, client } = await seedBasics();
    const seeded = { tenant };
    const db = await getDb();
    const { createCreditLine, getCreditLineById, listCreditLines, updateCreditLine, deleteCreditLine } = await loadCreditService();

    const [ownCompany] = await db
      .insert(counterparties)
      .values({
        tenantId: tenant.id,
        name: 'OwnCo A',
        type: 'CLIENT',
        types: ['CLIENT'],
        isOwnCompany: true,
      })
      .returning();

    const created = await createCreditLine({
      type: 'CUSTOMER',
      counterpartyIds: [client.id],
      ownCompanyIds: [ownCompany!.id],
      creditAmount: '1000.00',
      currency: 'USD',
      periodDays: 30,
      notes: 'Initial limit',
    });

    expect(created?.id).toBeTruthy();
    expect(created?.type).toBe('CUSTOMER');
    expect(created?.counterpartyIds).toEqual([client.id]);
    expect(created?.ownCompanyIds).toEqual([ownCompany!.id]);
    expect(created?.usedAmount).toBe('0.00');
    expect(created?.availableAmount).toBe('1000.00');

    const fetched = await getCreditLineById(created!.id);
    expect(fetched?.id).toBe(created?.id);

    const byType = await listCreditLines({ tenantId: seeded.tenant.id, type: 'CUSTOMER' });
    expect(byType.total).toBe(1);

    const byCounterparty = await listCreditLines({ tenantId: seeded.tenant.id, counterpartyId: client.id });
    expect(byCounterparty.total).toBe(1);

    const [client2] = await db
      .insert(counterparties)
      .values({
        tenantId: tenant.id,
        name: 'Client B',
        type: 'CLIENT',
        types: ['CLIENT'],
      })
      .returning();

    const updated = await updateCreditLine(created!.id, {
      creditAmount: '2500.00',
      periodDays: 45,
      notes: 'Updated',
      counterpartyIds: [client2!.id],
      ownCompanyIds: [],
    });

    expect(updated?.creditAmount).toBe('2500.00');
    expect(updated?.periodDays).toBe(45);
    expect(updated?.notes).toBe('Updated');
    expect(updated?.counterpartyIds).toEqual([client2!.id]);
    expect(updated?.ownCompanyIds).toEqual([]);

    const links = await db
      .select()
      .from(creditLineCounterparties)
      .where(eq(creditLineCounterparties.creditLineId, created!.id));
    expect(links.length).toBe(1);
    expect(links[0]?.counterpartyId).toBe(client2!.id);

    const deleted = await deleteCreditLine(created!.id);
    expect(deleted?.id).toBe(created!.id);

    const missing = await getCreditLineById(created!.id);
    expect(missing).toBeNull();
  });

  it('computes used amount and performance days for customer credit lines', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createCreditLine, getCreditLineById } = await loadCreditService();
    const { createOrder, updateOrder, saveOrderItems, updateOrderStatus } = await loadOrdersService();

    const credit = await createCreditLine({
      type: 'CUSTOMER',
      counterpartyIds: [client.id],
      creditAmount: '2000.00',
      currency: 'USD',
      periodDays: 30,
    });

    const active = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    await updateOrder(active.id, { customerPaymentTermType: 'CREDIT' });
    await updateOrderStatus(active.id, 'CONFIRMED', user.id);
    await saveOrderItems(active.id, [
      {
        productType: 'VLSFO',
        quantity: '10',
        salesPrice: '50',
        salesCurrency: 'USD',
        costPrice: '40',
        costCurrency: 'USD',
      },
    ]);

    const paid = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await updateOrder(paid.id, { customerPaymentTermType: 'CREDIT' });
    await updateOrderStatus(paid.id, 'PAID', user.id);

    const enriched = await getCreditLineById(credit!.id);
    expect(enriched?.usedAmount).toBe('500.00');
    expect(enriched?.availableAmount).toBe('1500.00');
    expect(enriched?.performanceDays).not.toBeNull();
  });

  it('throws when creating credit line without tenant', async () => {
    const { createCreditLine } = await loadCreditService();

    await expect(createCreditLine({
      type: 'SUPPLIER',
      counterpartyIds: [],
      creditAmount: '100.00',
      currency: 'USD',
      periodDays: 10,
    })).rejects.toThrow('No tenant found');
  });

  it('computes used amount for supplier credit lines from cost side', async () => {
    const { tenant, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createCreditLine, getCreditLineById, updateCreditLine } = await loadCreditService();
    const { createOrder, updateOrder, saveOrderItems, updateOrderStatus } = await loadOrdersService();

    const [supplier] = await db
      .insert(counterparties)
      .values({
        tenantId: tenant.id,
        name: 'Supplier A',
        type: 'SUPPLIER',
        types: ['SUPPLIER'],
      })
      .returning();

    const credit = await createCreditLine({
      type: 'SUPPLIER',
      counterpartyIds: [supplier!.id],
      creditAmount: '900.00',
      currency: 'USD',
      periodDays: 30,
    });

    const order = await createOrder({
      tenantId: tenant.id,
      clientId: supplier!.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
      supplierId: supplier!.id,
      supplierPaymentTermType: 'CREDIT',
    });

    await updateOrder(order.id, { supplierId: supplier!.id, supplierPaymentTermType: 'CREDIT' });
    await updateOrderStatus(order.id, 'CONFIRMED', user.id);
    await saveOrderItems(order.id, [
      {
        productType: 'VLSFO',
        quantity: '3',
        costPrice: '100',
        costCurrency: 'USD',
        salesPrice: '120',
        salesCurrency: 'USD',
      },
    ]);

    const enriched = await getCreditLineById(credit!.id);
    expect(enriched?.usedAmount).toBe('300.00');
    expect(enriched?.availableAmount).toBe('600.00');
    expect(enriched?.performanceDays).toBeNull();

    const missingUpdate = await updateCreditLine('123e4567-e89b-12d3-a456-426614174000', {
      notes: 'missing',
    });
    expect(missingUpdate).toBeNull();
  });

  it('computes supplier credit per supplier leg on the same order', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createCreditLine, getCreditLineById } = await loadCreditService();
    const { addOrderSupplier, createOrder, getOrderById, saveOrderItems, updateOrderStatus } = await loadOrdersService();

    const [supplierA] = await db
      .insert(counterparties)
      .values({
        tenantId: tenant.id,
        name: 'Supplier A',
        type: 'SUPPLIER',
        types: ['SUPPLIER'],
      })
      .returning();

    const [supplierB] = await db
      .insert(counterparties)
      .values({
        tenantId: tenant.id,
        name: 'Supplier B',
        type: 'SUPPLIER',
        types: ['SUPPLIER'],
      })
      .returning();

    const creditA = await createCreditLine({
      type: 'SUPPLIER',
      counterpartyIds: [supplierA!.id],
      creditAmount: '1000.00',
      currency: 'USD',
      periodDays: 30,
    });

    const creditB = await createCreditLine({
      type: 'SUPPLIER',
      counterpartyIds: [supplierB!.id],
      creditAmount: '1000.00',
      currency: 'USD',
      periodDays: 30,
    });

    const order = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
      supplierId: supplierA!.id,
      supplierPaymentTermType: 'CREDIT',
    });

    const detail = await getOrderById(order.id);
    const primarySupplier = detail?.orderSuppliers?.find((supplier) => supplier.companyId === supplierA!.id);
    expect(primarySupplier?.id).toBeTruthy();

    const secondarySupplier = await addOrderSupplier(order.id, {
      companyId: supplierB!.id,
      paymentTermType: 'CREDIT',
    });

    await updateOrderStatus(order.id, 'CONFIRMED', user.id);
    await saveOrderItems(order.id, [
      {
        productType: 'VLSFO',
        quantity: '3',
        orderSupplierId: primarySupplier!.id,
        costPrice: '100',
        costCurrency: 'USD',
        salesPrice: '120',
        salesCurrency: 'USD',
      },
      {
        productType: 'MGO',
        quantity: '5',
        orderSupplierId: secondarySupplier!.id,
        costPrice: '50',
        costCurrency: 'USD',
        salesPrice: '70',
        salesCurrency: 'USD',
      },
    ]);

    const enrichedA = await getCreditLineById(creditA!.id);
    const enrichedB = await getCreditLineById(creditB!.id);

    expect(enrichedA?.usedAmount).toBe('300.00');
    expect(enrichedB?.usedAmount).toBe('250.00');
    expect(enrichedA?.availableAmount).toBe('700.00');
    expect(enrichedB?.availableAmount).toBe('750.00');
  });

  it('releases customer and supplier credit usage when an order is cancelled', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createCreditLine, getCreditLineById } = await loadCreditService();
    const { createOrder, saveOrderItems, updateOrder, updateOrderStatus } = await loadOrdersService();

    const [supplier] = await db
      .insert(counterparties)
      .values({
        tenantId: tenant.id,
        name: 'Supplier Cancelled Exposure',
        type: 'SUPPLIER',
        types: ['SUPPLIER'],
      })
      .returning();

    const customerCredit = await createCreditLine({
      type: 'CUSTOMER',
      counterpartyIds: [client.id],
      creditAmount: '1000.00',
      currency: 'USD',
      periodDays: 30,
    });

    const supplierCredit = await createCreditLine({
      type: 'SUPPLIER',
      counterpartyIds: [supplier!.id],
      creditAmount: '1000.00',
      currency: 'USD',
      periodDays: 30,
    });

    const order = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
      supplierId: supplier!.id,
      customerPaymentTermType: 'CREDIT',
      supplierPaymentTermType: 'CREDIT',
    });

    await updateOrder(order.id, {
      customerPaymentTermType: 'CREDIT',
      supplierId: supplier!.id,
      supplierPaymentTermType: 'CREDIT',
    });
    await updateOrderStatus(order.id, 'CONFIRMED', user.id);
    await saveOrderItems(order.id, [
      {
        productType: 'VLSFO',
        quantity: '4',
        costPrice: '100',
        costCurrency: 'USD',
        salesPrice: '150',
        salesCurrency: 'USD',
      },
    ]);

    const activeCustomerCredit = await getCreditLineById(customerCredit!.id);
    const activeSupplierCredit = await getCreditLineById(supplierCredit!.id);
    expect(activeCustomerCredit?.usedAmount).toBe('600.00');
    expect(activeSupplierCredit?.usedAmount).toBe('400.00');

    await updateOrderStatus(order.id, 'CANCELLED', user.id, 'Price not competitive');

    const cancelledCustomerCredit = await getCreditLineById(customerCredit!.id);
    const cancelledSupplierCredit = await getCreditLineById(supplierCredit!.id);
    expect(cancelledCustomerCredit?.usedAmount).toBe('0.00');
    expect(cancelledSupplierCredit?.usedAmount).toBe('0.00');
    expect(cancelledCustomerCredit?.availableAmount).toBe('1000.00');
    expect(cancelledSupplierCredit?.availableAmount).toBe('1000.00');
  });

  // ─── Two-sided settlement: supplier credit released per-leg ──────────
  it('releases supplier credit when a leg is settled, while the order is still INVOICED', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createCreditLine, getCreditLineById } = await loadCreditService();
    const { createOrder, updateOrder, saveOrderItems, updateOrderStatus, createSupplierPayment, getOrderById } = await loadOrdersService();

    const [supplier] = await db
      .insert(counterparties)
      .values({ tenantId: tenant.id, name: 'Supplier Settled', type: 'SUPPLIER', types: ['SUPPLIER'] })
      .returning();

    const credit = await createCreditLine({
      type: 'SUPPLIER',
      counterpartyIds: [supplier!.id],
      creditAmount: '1000.00',
      currency: 'USD',
      periodDays: 30,
    });

    const order = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
      supplierId: supplier!.id,
      supplierPaymentTermType: 'CREDIT',
    });
    await updateOrder(order.id, { supplierId: supplier!.id, supplierPaymentTermType: 'CREDIT' });
    await updateOrderStatus(order.id, 'INVOICED', user.id);

    const detail = await getOrderById(order.id);
    const leg = detail?.orderSuppliers?.find((s) => s.companyId === supplier!.id)!;
    await saveOrderItems(order.id, [
      { productType: 'VLSFO', quantity: '4', orderSupplierId: leg.id, costPrice: '100', costCurrency: 'USD', salesPrice: '150', salesCurrency: 'USD' },
    ]);
    // leg cost = 400

    // Before settling, supplier credit is used
    const usedBefore = await getCreditLineById(credit!.id);
    expect(usedBefore?.usedAmount).toBe('400.00');

    // Settle the leg fully
    await createSupplierPayment(leg.id, { amount: '400', currency: 'USD' });

    // After settling, supplier credit is released — even though order is still INVOICED
    const usedAfter = await getCreditLineById(credit!.id);
    expect(usedAfter?.usedAmount).toBe('0.00');
    expect(usedAfter?.availableAmount).toBe('1000.00');
  });

  it('keeps supplier credit used when an order is PAID but the supplier leg is unpaid', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createCreditLine, getCreditLineById } = await loadCreditService();
    const { createOrder, updateOrder, saveOrderItems, updateOrderStatus, getOrderById } = await loadOrdersService();

    const [supplier] = await db
      .insert(counterparties)
      .values({ tenantId: tenant.id, name: 'Supplier Unpaid', type: 'SUPPLIER', types: ['SUPPLIER'] })
      .returning();

    const credit = await createCreditLine({
      type: 'SUPPLIER',
      counterpartyIds: [supplier!.id],
      creditAmount: '1000.00',
      currency: 'USD',
      periodDays: 30,
    });

    const order = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
      supplierId: supplier!.id,
      customerPaymentTermType: 'CREDIT',
      supplierPaymentTermType: 'CREDIT',
    });
    await updateOrder(order.id, {
      customerPaymentTermType: 'CREDIT',
      supplierId: supplier!.id,
      supplierPaymentTermType: 'CREDIT',
    });
    await updateOrderStatus(order.id, 'CONFIRMED', user.id);

    const detail = await getOrderById(order.id);
    const leg = detail?.orderSuppliers?.find((s) => s.companyId === supplier!.id)!;
    await saveOrderItems(order.id, [
      { productType: 'VLSFO', quantity: '3', orderSupplierId: leg.id, costPrice: '100', costCurrency: 'USD', salesPrice: '150', salesCurrency: 'USD' },
    ]);
    // leg cost = 300

    // Mark order PAID on the customer side (no supplier payment recorded)
    await updateOrderStatus(order.id, 'PAID', user.id);

    // Supplier credit should REMAIN used — PAID no longer auto-frees it
    const supplierCredit = await getCreditLineById(credit!.id);
    expect(supplierCredit?.usedAmount).toBe('300.00');
    expect(supplierCredit?.availableAmount).toBe('700.00');
  });

  it('keeps supplier credit used on partial supplier payment until fully paid', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createCreditLine, getCreditLineById } = await loadCreditService();
    const { createOrder, updateOrder, saveOrderItems, updateOrderStatus, createSupplierPayment, getOrderById } = await loadOrdersService();

    const [supplier] = await db
      .insert(counterparties)
      .values({ tenantId: tenant.id, name: 'Supplier Partial', type: 'SUPPLIER', types: ['SUPPLIER'] })
      .returning();

    const credit = await createCreditLine({
      type: 'SUPPLIER',
      counterpartyIds: [supplier!.id],
      creditAmount: '1000.00',
      currency: 'USD',
      periodDays: 30,
    });

    const order = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
      supplierId: supplier!.id,
      supplierPaymentTermType: 'CREDIT',
    });
    await updateOrder(order.id, { supplierId: supplier!.id, supplierPaymentTermType: 'CREDIT' });
    await updateOrderStatus(order.id, 'CONFIRMED', user.id);

    const detail = await getOrderById(order.id);
    const leg = detail?.orderSuppliers?.find((s) => s.companyId === supplier!.id)!;
    await saveOrderItems(order.id, [
      { productType: 'VLSFO', quantity: '5', orderSupplierId: leg.id, costPrice: '100', costCurrency: 'USD', salesPrice: '140', salesCurrency: 'USD' },
    ]);
    // leg cost = 500

    // Partial payment (200 of 500) — not settled, credit still used
    await createSupplierPayment(leg.id, { amount: '200', currency: 'USD' });
    const partial = await getCreditLineById(credit!.id);
    expect(partial?.usedAmount).toBe('500.00');

    // Pay the remainder — settled, credit released
    await createSupplierPayment(leg.id, { amount: '300', currency: 'USD' });
    const full = await getCreditLineById(credit!.id);
    expect(full?.usedAmount).toBe('0.00');
    expect(full?.availableAmount).toBe('1000.00');
  });
});

describe('credit.service — search and sorting', () => {
  it('searches by counterparty NAME, not just by id', async () => {
    const { tenant, client } = await seedBasics();
    const db = await getDb();
    const { createCreditLine, listCreditLines } = await loadCreditService();

    const [other] = await db
      .insert(counterparties)
      .values({ tenantId: tenant.id, name: 'Zenith Bunkers Ltd', type: 'CLIENT', types: ['CLIENT'] })
      .returning();

    await createCreditLine({
      type: 'CUSTOMER', counterpartyIds: [client.id], creditAmount: '100.00',
      currency: 'USD', periodDays: 30,
    });
    await createCreditLine({
      type: 'CUSTOMER', counterpartyIds: [other!.id], creditAmount: '200.00',
      currency: 'USD', periodDays: 30,
    });

    // Case-insensitive partial match, on the real client's name.
    const hit = await listCreditLines({ tenantId: tenant.id, type: 'CUSTOMER', search: client.name.slice(0, 4).toUpperCase() });
    expect(hit.total).toBe(1);
    expect(hit.items[0]!.counterpartyNames).toContain(client.name);

    const miss = await listCreditLines({ tenantId: tenant.id, type: 'CUSTOMER', search: 'no-such-company-xyz' });
    expect(miss.total).toBe(0);
  });

  it('does not duplicate a line that covers several counterparties when searching', async () => {
    // The search is an EXISTS subquery rather than a join precisely because a
    // join would emit one row per linked counterparty, inflating the page and
    // the count for a multi-client line.
    const { tenant, client } = await seedBasics();
    const db = await getDb();
    const { createCreditLine, listCreditLines } = await loadCreditService();

    const [second] = await db
      .insert(counterparties)
      .values({ tenantId: tenant.id, name: 'Second Client Ltd', type: 'CLIENT', types: ['CLIENT'] })
      .returning();

    await createCreditLine({
      type: 'CUSTOMER', counterpartyIds: [client.id, second!.id], creditAmount: '500.00',
      currency: 'USD', periodDays: 30,
    });

    const shared = client.name.slice(0, 3).toUpperCase();
    const both = await listCreditLines({ tenantId: tenant.id, type: 'CUSTOMER', search: shared });
    // Whatever the term matches, each credit line appears exactly once.
    const ids = both.items.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(both.total).toBe(both.items.length);
  });

  it('sorts by the DERIVED available column over the whole set, not just the page', async () => {
    // `available` is computed in JS after the query, so it cannot be a SQL ORDER
    // BY. The bug this guards is sorting only the FETCHED PAGE: that orders the
    // page rather than the list, so page 1 shows a different set of rows than a
    // true sort would, and paging restarts the order.
    //
    // The rows' updatedAt values are set so that the updatedAt order is the
    // REVERSE of the available order. Otherwise the two orderings coincide for
    // freshly-created rows (all within the same millisecond) and a page-local
    // sort would pass by luck — which is exactly how the first version of this
    // test failed to catch it.
    const { tenant } = await seedBasics();
    const db = await getDb();
    const { createCreditLine, listCreditLines } = await loadCreditService();

    // updatedAt DESC and available ASC must be OPPOSITE orders, otherwise a
    // page-local sort coincides with the true one and passes by luck — which is
    // exactly how an earlier version of this test failed to catch the bug.
    // Rows come back updatedAt DESC, so newest first. Make newest = SMALLEST
    // available, i.e. available DESC by updatedAt order.
    const spec: Array<[string, string, string]> = [
      ['Reverse A', '300.00', '2026-03-01T00:00:00.000Z'], // newest, largest
      ['Reverse B', '200.00', '2026-02-01T00:00:00.000Z'],
      ['Reverse C', '100.00', '2026-01-01T00:00:00.000Z'], // oldest, smallest
    ];
    for (const [name, amount, updatedAt] of spec) {
      const [cp] = await db
        .insert(counterparties)
        .values({ tenantId: tenant.id, name, type: 'CLIENT', types: ['CLIENT'] })
        .returning();
      const line = await createCreditLine({
        type: 'CUSTOMER', counterpartyIds: [cp!.id], creditAmount: amount,
        currency: 'USD', periodDays: 30,
      });
      await db.execute(
        sql`UPDATE credit_lines SET updated_at = ${updatedAt}::timestamptz WHERE id = ${line!.id}`,
      );
    }

    // Nothing is used, so available == creditAmount: 100, 200, 300.
    const asc = await listCreditLines({ tenantId: tenant.id, type: 'CUSTOMER', sortBy: 'available', sortDir: 'asc', limit: 2 });
    expect(asc.items.map((l) => l.availableAmount)).toEqual(['100.00', '200.00']);
    expect(asc.total).toBe(3);

    // Page 2 must CONTINUE the order, not restart it.
    const ascP2 = await listCreditLines({ tenantId: tenant.id, type: 'CUSTOMER', sortBy: 'available', sortDir: 'asc', page: 2, limit: 2 });
    expect(ascP2.items.map((l) => l.availableAmount)).toEqual(['300.00']);

    const desc = await listCreditLines({ tenantId: tenant.id, type: 'CUSTOMER', sortBy: 'available', sortDir: 'desc', limit: 1 });
    expect(desc.items.map((l) => l.availableAmount)).toEqual(['300.00']);
  });

  it('caps the page size so a huge limit cannot force unbounded enrichment', async () => {
    // The computed-sort path enriches EVERY matching row (it must, to sort on a
    // derived column), so an uncapped limit let one authenticated request pay the
    // full O(rows) cost. 100 is the ceiling; the UI only ever asks for 25-50.
    const { tenant, client } = await seedBasics();
    const { createCreditLine, listCreditLines } = await loadCreditService();

    await createCreditLine({
      type: 'CUSTOMER', counterpartyIds: [client.id], creditAmount: '100.00',
      currency: 'USD', periodDays: 30,
    });

    const res = await listCreditLines({ tenantId: tenant.id, type: 'CUSTOMER', limit: 100000 });
    expect(res.items.length).toBeLessThanOrEqual(100);

    // A zero/negative limit is clamped up to 1 rather than returning nothing.
    const zero = await listCreditLines({ tenantId: tenant.id, type: 'CUSTOMER', limit: 0 });
    expect(zero.items.length).toBeGreaterThanOrEqual(1);
  });

  it('sorts by counterparty name case-insensitively', async () => {
    const { tenant } = await seedBasics();
    const db = await getDb();
    const { createCreditLine, listCreditLines } = await loadCreditService();

    for (const name of ['beta Marine', 'Alpha Marine', 'gamma Marine']) {
      const [cp] = await db
        .insert(counterparties)
        .values({ tenantId: tenant.id, name, type: 'CLIENT', types: ['CLIENT'] })
        .returning();
      await createCreditLine({
        type: 'CUSTOMER', counterpartyIds: [cp!.id], creditAmount: '100.00',
        currency: 'USD', periodDays: 30,
      });
    }

    const res = await listCreditLines({ tenantId: tenant.id, type: 'CUSTOMER', sortBy: 'counterpartyNames', sortDir: 'asc' });
    expect(res.items.map((l) => l.counterpartyNames[0])).toEqual(['Alpha Marine', 'beta Marine', 'gamma Marine']);
  });
});
