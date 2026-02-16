import { beforeEach, describe, expect, it } from 'bun:test';
import { getDb, seedBasics, truncateAll } from './helpers/db';

async function loadOrdersService() {
  return import('../src/modules/orders/orders.service');
}

describe('orders.service edge branches', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('covers listOrders search/salesRep/sort/page filters deterministically', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder, listOrders, updateOrder } = await loadOrdersService();

    const first = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    const second = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    await updateOrder(second.id, { status: 'CONFIRMED' });

    const search = await listOrders({ search: second.orderNumber ?? '' });
    expect(search.total).toBe(1);
    expect(search.items[0]?.id).toBe(second.id);

    const filteredByRep = await listOrders({ salesRepId: user.id, statuses: ['INQUIRY', 'CONFIRMED'] });
    expect(filteredByRep.total).toBe(2);

    const paged = await listOrders({
      statuses: ['INQUIRY', 'CONFIRMED'],
      sortBy: 'createdAt',
      sortDir: 'asc',
      page: 2,
      limit: 1,
    });
    expect(paged.items.length).toBe(1);
    expect(paged.total).toBe(2);
  });

  it('covers no-invoice payment path and payments ordering', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder, createOrderPayment, listOrderPayments } = await loadOrdersService();

    const order = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    const older = await createOrderPayment(order.id, {
      amount: '10.00',
      currency: 'EUR',
      receivedAt: '2025-01-01T00:00:00.000Z',
      createdBy: user.id,
    });

    const newer = await createOrderPayment(order.id, {
      amount: '20.00',
      currency: 'USD',
      receivedAt: '2025-01-02T00:00:00.000Z',
      createdBy: user.id,
    });

    expect(older?.invoiceId).toBeNull();
    expect(newer?.invoiceId).toBeNull();

    const rows = await listOrderPayments(order.id);
    expect(rows.length).toBe(2);
    expect(rows[0]?.id).toBe(newer?.id);
    expect(rows[1]?.id).toBe(older?.id);
  });

  it('covers null-return branches for missing order mutations', async () => {
    const { updateOrder, updateOrderStatus, deleteOrder, getOrderActivity } = await loadOrdersService();
    const missing = '123e4567-e89b-12d3-a456-426614174000';

    const updated = await updateOrder(missing, { status: 'CONFIRMED' });
    expect(updated).toBeNull();

    const statusUpdated = await updateOrderStatus(missing, 'CONFIRMED');
    expect(statusUpdated).toBeNull();

    const deleted = await deleteOrder(missing);
    expect(deleted).toBeNull();

    const activity = await getOrderActivity(missing);
    expect(activity).toEqual([]);
  });
});
