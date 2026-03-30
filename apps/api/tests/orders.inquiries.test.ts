import { describe, it, beforeEach, expect } from 'bun:test';
import { companyContacts, counterparties, orders, orderItems, invoices, tenants } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { getDb, seedBasics, truncateAll } from './helpers/db';

async function loadOrdersService() {
  return import('../src/modules/orders/orders.service');
}

beforeEach(async () => {
  await truncateAll();
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

  it('returns the selected supplier in order detail payload', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createOrder, updateOrder, getOrderById } = await loadOrdersService();

    const [supplier] = await db
      .insert(counterparties)
      .values({
        tenantId: tenant.id,
        name: 'Ajax Bunkering',
        type: 'SUPPLIER',
        types: ['SUPPLIER'],
        country: 'Greece',
      })
      .returning();

    const created = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    await updateOrder(created.id, { supplierId: supplier.id });

    const fetched = await getOrderById(created.id);
    expect(fetched?.supplierId).toBe(supplier.id);
    expect(fetched?.supplier?.id).toBe(supplier.id);
    expect(fetched?.supplier?.name).toBe('Ajax Bunkering');
  });

  it('returns the selected agent and contact in order detail payload', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createOrder, updateOrder, getOrderById } = await loadOrdersService();

    const [agent] = await db
      .insert(counterparties)
      .values({
        tenantId: tenant.id,
        name: 'Harbor Ops Agency',
        type: 'SUPPLIER',
        types: ['SUPPLIER'],
        country: 'Denmark',
      })
      .returning();

    const [agentContact] = await db
      .insert(companyContacts)
      .values({
        counterpartyId: agent.id,
        name: 'Maja Hansen',
        role: 'Port Agent',
        phone: '+4511223344',
        email: 'maja@harborops.example',
      })
      .returning();

    const created = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    await updateOrder(created.id, {
      agentId: agent.id,
      agentContactId: agentContact.id,
    });

    const fetched = await getOrderById(created.id);
    expect(fetched?.agentId).toBe(agent.id);
    expect(fetched?.agent?.id).toBe(agent.id);
    expect(fetched?.agent?.name).toBe('Harbor Ops Agency');
    expect(fetched?.agentContactId).toBe(agentContact.id);
    expect(fetched?.agentContact?.id).toBe(agentContact.id);
    expect(fetched?.agentContact?.name).toBe('Maja Hansen');
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

  it('keeps order numbers unique when tenant template omits SEQ token', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder } = await loadOrdersService();
    const db = await getDb();

    await db
      .update(tenants)
      .set({
        settings: {
          orderNumberTemplate: '{PREFIX}{YYYY}{MM}{DD}',
          orderNumberPrefix: 'RIV-',
        },
      })
      .where(eq(tenants.id, tenant.id));

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

    expect(first.orderNumber).toBeTruthy();
    expect(second.orderNumber).toBeTruthy();
    expect(first.orderNumber).not.toBe(second.orderNumber);
    expect(first.orderNumber).toContain('RIV-');
    expect(second.orderNumber).toContain('RIV-');
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

describe('orders: attachments, payments, and lookups', () => {
  it('supports resolve/get misses and uuid passthrough', async () => {
    const { resolveOrderId, getOrderById } = await loadOrdersService();

    const missing = await resolveOrderId('NO-SUCH-ORDER');
    expect(missing).toBeNull();

    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    const same = await resolveOrderId(uuid);
    expect(same).toBe(uuid);

    const noOrder = await getOrderById('NO-SUCH-ORDER');
    expect(noOrder).toBeNull();
  });

  it('creates and lists attachments with ISO dates', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder, createOrderAttachment, listOrderAttachments } = await loadOrdersService();

    const created = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    const attachment = await createOrderAttachment({
      orderId: created.id,
      type: 'OTHER',
      fileName: 'terms.pdf',
      filePath: '/uploads/attachments/terms.pdf',
      mimeType: 'application/pdf',
      fileSize: 1024,
      uploadedBy: user.id,
    });

    expect(attachment?.id).toBeTruthy();

    const rows = await listOrderAttachments(created.id);
    expect(rows.length).toBe(1);
    expect(rows[0]?.fileName).toBe('terms.pdf');
    expect(typeof rows[0]?.createdAt).toBe('string');
    expect(rows[0]?.createdAt).toContain('T');

    const empty = await listOrderAttachments('123e4567-e89b-12d3-a456-426614174000');
    expect(empty).toEqual([]);
  });

  it('creates payments and updates invoice amount paid when invoice exists', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder, createOrderPayment, listOrderPayments } = await loadOrdersService();
    const db = await getDb();

    const created = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    const [invoice] = await db
      .insert(invoices)
      .values({
        orderId: created.id,
        invoiceNumber: 'INV-TEST-0001',
        dueDate: '2030-01-01',
        amount: '1000.00',
      })
      .returning();

    const payment = await createOrderPayment(created.id, {
      amount: '150.50',
      currency: '',
      method: 'WIRE',
      note: 'Part payment',
      createdBy: user.id,
    });

    expect(payment?.id).toBeTruthy();
    expect(payment?.currency).toBe('USD');
    expect(payment?.invoiceId).toBe(invoice?.id ?? null);

    const payments = await listOrderPayments(created.id);
    expect(payments.length).toBe(1);
    expect(payments[0]?.amount).toBe('150.50');

    const invoiceRows = await db.select().from(invoices).where(eq(invoices.id, invoice!.id)).limit(1);
    expect(invoiceRows[0]?.amountPaid).toBe('150.50');
  });

  it('updates status with activity and supports delete', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder, updateOrderStatus, getOrderActivity, deleteOrder, getOrderById } = await loadOrdersService();

    const created = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    const paid = await updateOrderStatus(created.id, 'PAID', user.id);
    expect(paid?.status).toBe('PAID');
    expect(paid?.closedAt).toBeTruthy();

    const activity = await getOrderActivity(created.id);
    if (activity.length > 0) {
      expect(activity[0]?.entityType).toBe('order');
      expect(activity[0]?.entityId).toBe(created.id);
    }

    const deleted = await deleteOrder(created.id);
    expect(deleted?.id).toBe(created.id);

    const missing = await getOrderById(created.id);
    expect(missing).toBeNull();
  });

  it('returns null when creating payment for missing order', async () => {
    const { createOrderPayment } = await loadOrdersService();

    const payment = await createOrderPayment('123e4567-e89b-12d3-a456-426614174000', {
      amount: '10.00',
      currency: 'USD',
    });

    expect(payment).toBeNull();
  });

  it('sets closedAt when updateOrder status moves to PAID', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder, updateOrder } = await loadOrdersService();

    const created = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    const updated = await updateOrder(created.id, { status: 'PAID' });
    expect(updated?.status).toBe('PAID');
    expect(updated?.closedAt).toBeTruthy();
  });

  it('clears items when saveOrderItems is called with empty list', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder, saveOrderItems } = await loadOrdersService();
    const db = await getDb();

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
        quantity: '1',
        costPrice: '1',
        salesPrice: '2',
      },
    ]);

    const cleared = await saveOrderItems(created.id, []);
    expect(cleared).toEqual([]);

    const rows = await db.select().from(orderItems).where(eq(orderItems.orderId, created.id));
    expect(rows.length).toBe(0);
  });
});
