import { beforeEach, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { counterparties, creditLineCounterparties, tenants } from '../src/db/schema';
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
      tenantId: tenant.id,
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

    const updated = await updateCreditLine(created!.id, tenant.id, {
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

    const deleted = await deleteCreditLine(created!.id, tenant.id);
    expect(deleted?.id).toBe(created!.id);

    const missing = await getCreditLineById(created!.id);
    expect(missing).toBeNull();
  });

  it('computes used amount and performance days for customer credit lines', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createCreditLine, getCreditLineById } = await loadCreditService();
    const { createOrder, updateOrder, saveOrderItems, updateOrderStatus } = await loadOrdersService();

    const credit = await createCreditLine({
      tenantId: tenant.id,
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

  it('creates the line in the CALLER tenant, never an arbitrary one', async () => {
    // Regression guard for the cross-tenant write hole: the service used to do
    // `tenants.findFirst()` (no filter), so a user in tenant B could create a
    // line that landed in whichever tenant happened to sort first. The line must
    // belong to the tenant the caller passed.
    const { tenant } = await seedBasics();
    const db = await getDb();
    const { createCreditLine, getCreditLineById } = await loadCreditService();

    // A second tenant, inserted FIRST so a findFirst() regression would pick it.
    const [otherTenant] = await db
      .insert(tenants)
      .values({ name: 'Aardvark Shipping', domain: 'aardvark.test' })
      .returning();
    const [otherCp] = await db
      .insert(counterparties)
      .values({ tenantId: otherTenant!.id, name: 'Other Co', type: 'CLIENT', types: ['CLIENT'] })
      .returning();

    const created = await createCreditLine({
      tenantId: tenant.id,
      type: 'CUSTOMER',
      counterpartyIds: [otherCp!.id],
      creditAmount: '100.00',
      currency: 'USD',
      periodDays: 10,
    });

    expect(created?.tenantId).toBe(tenant.id);
    const reread = await getCreditLineById(created!.id);
    expect(reread?.tenantId).toBe(tenant.id);
  });

  it('does not let one tenant update or delete another tenant\'s line', async () => {
    // The mutation must be scoped IN THE WHERE, not checked after: an unscoped
    // UPDATE/DELETE commits and then reports 404, so the write lands anyway.
    const { tenant, client } = await seedBasics();
    const db = await getDb();
    const { createCreditLine, updateCreditLine, deleteCreditLine, getCreditLineById } = await loadCreditService();

    const [otherTenant] = await db.insert(tenants).values({ name: 'Other Tenant', domain: 'other.test' }).returning();
    const owned = await createCreditLine({
      tenantId: tenant.id,
      type: 'CUSTOMER',
      counterpartyIds: [client.id],
      creditAmount: '100.00',
      currency: 'USD',
      periodDays: 10,
    });

    // The other tenant tries to mutate it: both must be no-ops.
    const crossUpdate = await updateCreditLine(owned!.id, otherTenant!.id, { creditAmount: '999999.00' });
    expect(crossUpdate).toBeNull();
    const crossDelete = await deleteCreditLine(owned!.id, otherTenant!.id);
    expect(crossDelete).toBeNull();

    // The row is untouched and still owned by the original tenant.
    const after = await getCreditLineById(owned!.id);
    expect(after?.creditAmount).toBe('100.00');
    expect(after?.tenantId).toBe(tenant.id);
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
      tenantId: tenant.id,
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

    const missingUpdate = await updateCreditLine('123e4567-e89b-12d3-a456-426614174000', tenant.id, {
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
      tenantId: tenant.id,
      type: 'SUPPLIER',
      counterpartyIds: [supplierA!.id],
      creditAmount: '1000.00',
      currency: 'USD',
      periodDays: 30,
    });

    const creditB = await createCreditLine({
      tenantId: tenant.id,
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
      tenantId: tenant.id,
      type: 'CUSTOMER',
      counterpartyIds: [client.id],
      creditAmount: '1000.00',
      currency: 'USD',
      periodDays: 30,
    });

    const supplierCredit = await createCreditLine({
      tenantId: tenant.id,
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
      tenantId: tenant.id,
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
      tenantId: tenant.id,
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
      tenantId: tenant.id,
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
      tenantId: tenant.id,
      type: 'CUSTOMER', counterpartyIds: [client.id], creditAmount: '100.00',
      currency: 'USD', periodDays: 30,
    });
    await createCreditLine({
      tenantId: tenant.id,
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
      tenantId: tenant.id,
      type: 'CUSTOMER', counterpartyIds: [client.id, second!.id], creditAmount: '500.00',
      currency: 'USD', periodDays: 30,
    });

    // The term must match MORE THAN ONE linked counterparty, or the test cannot
    // distinguish the EXISTS subquery from the join it replaced: with a
    // single-match term the join also emits one row and passes. 'Client' is
    // shared by both names below, so a join-based implementation would emit the
    // line TWICE (page 2 rows, count 1) and fail the assertions.
    const both = await listCreditLines({ tenantId: tenant.id, type: 'CUSTOMER', search: 'client' });
    expect(both.total).toBe(1);
    expect(both.items.length).toBe(1);
    // Case-insensitive too (ILIKE, not LIKE).
    expect(both.items[0]?.counterpartyNames.length).toBe(2);
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

    // Two independent failure modes to defeat, with ONE fixture:
    //
    //  1. A page-local sort (order rows by updatedAt, slice the page, then sort
    //     the page) coincides with the true sort whenever updatedAt order equals
    //     available order. So make them OPPOSITE: newest = SMALLEST available.
    //
    //  2. Lexicographic comparison: 90/100/1000 are NOT digit-aligned, so
    //     localeCompare puts "100.00" before "90.00" and "1000.00" before
    //     "100.00". A numeric comparator is the only thing that yields 90<100<1000.
    //
    // With updatedAt DESC = [90, 1000, 100] and available ASC = [90, 100, 1000],
    // a page-local sort returns the wrong page and a string sort returns the
    // wrong page — both now fail the assertions below.
    const spec: Array<[string, string, string]> = [
      ['Reverse A', '90.00', '2026-03-01T00:00:00.000Z'], // newest, SMALLEST
      ['Reverse B', '1000.00', '2026-02-01T00:00:00.000Z'],
      ['Reverse C', '100.00', '2026-01-01T00:00:00.000Z'], // oldest, middle
    ];
    for (const [name, amount, updatedAt] of spec) {
      const [cp] = await db
        .insert(counterparties)
        .values({ tenantId: tenant.id, name, type: 'CLIENT', types: ['CLIENT'] })
        .returning();
      const line = await createCreditLine({
      tenantId: tenant.id,
        type: 'CUSTOMER', counterpartyIds: [cp!.id], creditAmount: amount,
        currency: 'USD', periodDays: 30,
      });
      await db.execute(
        sql`UPDATE credit_lines SET updated_at = ${updatedAt}::timestamptz WHERE id = ${line!.id}`,
      );
    }

    // Nothing is used, so available == creditAmount. Numeric order: 90, 100, 1000.
    // Lexicographic order would be "100.00" < "1000.00" < "90.00" — wrong.
    const asc = await listCreditLines({ tenantId: tenant.id, type: 'CUSTOMER', sortBy: 'available', sortDir: 'asc', limit: 2 });
    expect(asc.items.map((l) => l.availableAmount)).toEqual(['90.00', '100.00']);
    expect(asc.total).toBe(3);

    // Page 2 must CONTINUE the order, not restart it.
    const ascP2 = await listCreditLines({ tenantId: tenant.id, type: 'CUSTOMER', sortBy: 'available', sortDir: 'asc', page: 2, limit: 2 });
    expect(ascP2.items.map((l) => l.availableAmount)).toEqual(['1000.00']);

    const desc = await listCreditLines({ tenantId: tenant.id, type: 'CUSTOMER', sortBy: 'available', sortDir: 'desc', limit: 3 });
    expect(desc.items.map((l) => l.availableAmount)).toEqual(['1000.00', '100.00', '90.00']);
  });

  it('caps the page size so a huge limit cannot force unbounded enrichment', async () => {
    // The computed-sort path enriches EVERY matching row (it must, to sort on a
    // derived column), so an uncapped limit let one authenticated request pay the
    // full O(rows) cost. 100 is the ceiling; the UI only ever asks for 25-50.
    const { tenant, client } = await seedBasics();
    const { createCreditLine, listCreditLines } = await loadCreditService();

    await createCreditLine({
      tenantId: tenant.id,
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

    // The discriminating pair is lowercase 'alpha' vs uppercase 'Beta': a
    // case-SENSITIVE ASCII compare puts 'B' (66) before 'a' (97), so it would
    // order 'Beta Marine' FIRST. Case-insensitive ordering puts 'alpha' first.
    // Declared in the case-sensitive order, so only a case-folding comparator
    // produces the expected case-insensitive result.
    for (const name of ['Beta Marine', 'gamma Marine', 'alpha Marine']) {
      const [cp] = await db
        .insert(counterparties)
        .values({ tenantId: tenant.id, name, type: 'CLIENT', types: ['CLIENT'] })
        .returning();
      await createCreditLine({
        tenantId: tenant.id,
        type: 'CUSTOMER', counterpartyIds: [cp!.id], creditAmount: '100.00',
        currency: 'USD', periodDays: 30,
      });
    }

    const res = await listCreditLines({ tenantId: tenant.id, type: 'CUSTOMER', sortBy: 'counterpartyNames', sortDir: 'asc' });
    expect(res.items.map((l) => l.counterpartyNames[0])).toEqual(['alpha Marine', 'Beta Marine', 'gamma Marine']);
  });
});
