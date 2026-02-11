import { describe, it, beforeEach, afterAll, expect } from 'bun:test';
import { orders, orderItems } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, seedBasics, truncateAll } from './helpers/db';

async function loadOrdersService() {
  return import('../src/modules/orders/orders.service');
}

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeDb();
});

describe('orders: inquiries flow', () => {
  it('creates an inquiry and fetches it by id', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder, getOrderById } = await loadOrdersService();

    const created = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    expect(created.id).toBeTruthy();
    expect(created.orderNumber).toBeTruthy();
    expect(created.status).toBe('INQUIRY');
    expect(created.currency).toBe('USD');

    const fetched = await getOrderById(created.id);
    expect(fetched).toBeTruthy();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.client?.id).toBe(client.id);
    expect(fetched?.vessel?.id).toBe(vessel.id);
    expect(fetched?.place?.id).toBe(place.id);
  });

  it('updates inquiry details and saves items with currencies', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder, getOrderById, saveOrderItems, updateOrder } = await loadOrdersService();

    const created = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    const updated = await updateOrder(created.id, {
      currency: 'USD',
      eta: new Date().toISOString(),
      lossReason: null,
    });
    expect(updated?.currency).toBe('USD');

    const items = await saveOrderItems(created.id, [
      {
        productType: 'VLSFO',
        quantity: '10',
        unit: 'MT',
        costPrice: '100',
        costCurrency: 'USD',
        salesPrice: '120',
        salesCurrency: 'USD',
        paymentTerms: 'CASH_ADVANCE',
      },
    ]);

    expect(items.length).toBe(1);
    const [item] = items;
    expect(item.costCurrency).toBe('USD');
    expect(item.salesCurrency).toBe('USD');
    expect(item.profit).toBe('200.0000');

    const fetched = await getOrderById(created.id);
    expect(fetched?.items?.length).toBe(1);
    expect(fetched?.items?.[0]?.costCurrency).toBe('USD');
    expect(fetched?.items?.[0]?.salesCurrency).toBe('USD');
  });

  it('lists inquiries by status', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder, listOrders, updateOrderStatus } = await loadOrdersService();

    const inquiry = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    const other = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    await updateOrderStatus(other.id, 'CONFIRMED', user.id);

    const results = await listOrders({ statuses: ['INQUIRY'] });
    expect(results.total).toBe(1);
    expect(results.items[0]?.id).toBe(inquiry.id);
  });

  it('resolves an order by order number', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder, resolveOrderId } = await loadOrdersService();

    const created = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    const resolved = await resolveOrderId(created.orderNumber!);
    expect(resolved).toBe(created.id);
  });

  it('sets closedAt when cancelling an inquiry', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder, updateOrderStatus } = await loadOrdersService();

    const created = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    const cancelled = await updateOrderStatus(created.id, 'CANCELLED', user.id, 'Client withdrew');
    expect(cancelled?.closedAt).toBeTruthy();

    const db = await getDb();
    const dbRow = await db.select().from(orders).where(eq(orders.id, created.id)).limit(1);
    expect(dbRow[0]?.closedAt).toBeTruthy();
  });
});

describe('orders: item aggregates', () => {
  it('replaces items on save and persists latest rows', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder, saveOrderItems } = await loadOrdersService();

    const created = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    await saveOrderItems(created.id, [
      {
        productType: 'MGO',
        quantity: '5',
        unit: 'MT',
        costPrice: '90',
        costCurrency: 'USD',
        salesPrice: '100',
        salesCurrency: 'USD',
      },
      {
        productType: 'VLSFO',
        quantity: '8',
        unit: 'MT',
        costPrice: '110',
        costCurrency: 'USD',
        salesPrice: '130',
        salesCurrency: 'USD',
      },
    ]);

    await saveOrderItems(created.id, [
      {
        productType: 'LUBE',
        quantity: '2',
        unit: 'MT',
        costPrice: '200',
        costCurrency: 'USD',
        salesPrice: '240',
        salesCurrency: 'USD',
      },
    ]);

    const db = await getDb();
    const rows = await db.select().from(orderItems).where(eq(orderItems.orderId, created.id));
    expect(rows.length).toBe(1);
    expect(rows[0]?.productType).toBe('LUBE');
  });
});
