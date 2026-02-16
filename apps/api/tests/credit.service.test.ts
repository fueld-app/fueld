import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
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

    const byType = await listCreditLines({ type: 'CUSTOMER' });
    expect(byType.total).toBe(1);

    const byCounterparty = await listCreditLines({ counterpartyId: client.id });
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
});
