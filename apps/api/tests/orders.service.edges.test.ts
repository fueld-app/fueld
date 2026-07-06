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
    expect(search.items[0]?.id).toBeDefined();
    expect(search.items[0]!.id).toBe(second.id);

    const filteredByRep = await listOrders({ salesRepIds: [user.id], statuses: ['INQUIRY', 'CONFIRMED'] });
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

  it('multi-select salesRepId filter returns orders from all selected reps (OR logic)', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createOrder, listOrders } = await loadOrdersService();
    const { users } = await import('../src/db/schema');

    const [rep2] = await db
      .insert(users)
      .values({ tenantId: tenant.id, email: 'rep2@test.local', name: 'Rep Two', role: 'TRADER' })
      .returning();

    // Order 1 — owned by the seeded user
    await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    // Order 2 — owned by rep2
    await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: rep2!.id,
    });

    // Single rep → 1 order
    const singleRep1 = await listOrders({ salesRepIds: [user.id] });
    expect(singleRep1.total).toBe(1);

    const singleRep2 = await listOrders({ salesRepIds: [rep2!.id] });
    expect(singleRep2.total).toBe(1);

    // Both reps selected → 2 orders (OR logic, not AND)
    const bothReps = await listOrders({ salesRepIds: [user.id, rep2!.id] });
    expect(bothReps.total).toBe(2);

    // A non-existent rep alongside a real one → still returns the real rep's orders
    const realAndGhost = await listOrders({ salesRepIds: [user.id, '00000000-0000-0000-0000-000000000000'] });
    expect(realAndGhost.total).toBe(1);
  });

  it('multi-select productType filter returns orders matching any selected product', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder, updateOrderStatus, saveOrderItems, listOrders } = await loadOrdersService();

    const order1 = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await updateOrderStatus(order1.id, 'CONFIRMED', user.id);
    await saveOrderItems(order1.id, [
      { productType: 'VLSFO', quantity: '10', costPrice: '100', costCurrency: 'USD', salesPrice: '150', salesCurrency: 'USD' },
    ]);

    const order2 = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await updateOrderStatus(order2.id, 'CONFIRMED', user.id);
    await saveOrderItems(order2.id, [
      { productType: 'MGO', quantity: '5', costPrice: '200', costCurrency: 'USD', salesPrice: '300', salesCurrency: 'USD' },
    ]);

    // Single product → 1 order each
    expect((await listOrders({ productTypes: ['VLSFO'] })).total).toBe(1);
    expect((await listOrders({ productTypes: ['MGO'] })).total).toBe(1);

    // Both products → 2 orders (OR logic)
    expect((await listOrders({ productTypes: ['VLSFO', 'MGO'] })).total).toBe(2);
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
    expect(newer?.id).toBeDefined();
    expect(older?.id).toBeDefined();
    expect(rows[0]?.id).toBe(newer!.id);
    expect(rows[1]?.id).toBe(older!.id);
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

  it('updates an order attachment type and returns null for missing attachment', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const {
      createOrder,
      createOrderAttachment,
      updateOrderAttachmentType,
      listOrderAttachments,
    } = await loadOrdersService();

    const order = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    // Upload an attachment as OTHER (simulating the user's mistake)
    const att = await createOrderAttachment({
      orderId: order.id,
      type: 'OTHER',
      fileName: 'bdr.pdf',
      filePath: '/uploads/attachments/test.pdf',
      mimeType: 'application/pdf',
      fileSize: 1024,
      uploadedBy: user.id,
    });
    expect(att).not.toBeNull();
    expect(att!.type).toBe('OTHER');

    // Fix the type to BDR (lowercase to verify uppercasing)
    const updated = await updateOrderAttachmentType(att!.id, order.id, 'bdr');
    expect(updated).not.toBeNull();
    expect(updated!.type).toBe('BDR');

    // Verify the change persisted
    const listed = await listOrderAttachments(order.id);
    expect(listed.length).toBe(1);
    expect(listed[0]!.type).toBe('BDR');

    // Non-existent attachment returns null
    const missing = await updateOrderAttachmentType(
      '123e4567-e89b-12d3-a456-426614174000',
      order.id,
      'BDR',
    );
    expect(missing).toBeNull();
  });
});
