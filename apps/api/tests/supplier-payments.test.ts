import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { counterparties, orderSuppliers } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';

async function loadOrdersService() {
  return import('../src/modules/orders/orders.service');
}

beforeEach(async () => {
  await truncateAll();
});

describe('supplier payments (per-leg settlement)', () => {
  it('creates a supplier payment, updates amountPaid, and lists ordered by paidAt desc', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createOrder, updateOrderStatus, saveOrderItems, addOrderSupplier, createSupplierPayment, listSupplierPayments } =
      await loadOrdersService();

    const [supplier] = await db
      .insert(counterparties)
      .values({ tenantId: tenant.id, name: 'Supplier A', type: 'SUPPLIER', types: ['SUPPLIER'] })
      .returning();

    const order = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
      supplierId: supplier!.id,
      supplierPaymentTermType: 'CREDIT',
    });
    await updateOrderStatus(order.id, 'CONFIRMED', user.id);

    const detail = await (await import('../src/modules/orders/orders.service')).getOrderById(order.id);
    const leg = detail?.orderSuppliers?.find((s) => s.companyId === supplier!.id);
    expect(leg?.id).toBeTruthy();

    await saveOrderItems(order.id, [
      {
        productType: 'VLSFO',
        quantity: '5',
        orderSupplierId: leg!.id,
        costPrice: '100',
        costCurrency: 'USD',
        salesPrice: '150',
        salesCurrency: 'USD',
      },
    ]);
    // leg cost = 5 * 100 = 500

    const p1 = await createSupplierPayment(leg!.id, {
      amount: '200',
      currency: 'USD',
      paidAt: '2026-01-01T00:00:00.000Z',
    });
    expect(p1?.id).toBeTruthy();
    expect(p1?.amount).toBe('200.00');

    // amountPaid should be 200, not yet fully paid → paidAt null
    const [legRow1] = await db.select().from(orderSuppliers).where(eq(orderSuppliers.id, leg!.id));
    expect(legRow1!.amountPaid).toBe('200.00');
    expect(legRow1!.paidAt).toBeNull();

    const p2 = await createSupplierPayment(leg!.id, {
      amount: '300',
      currency: 'USD',
      paidAt: '2026-01-05T00:00:00.000Z',
    });

    // Now total paid (500) >= cost (500) → paidAt set
    const [legRow2] = await db.select().from(orderSuppliers).where(eq(orderSuppliers.id, leg!.id));
    expect(legRow2!.amountPaid).toBe('500.00');
    expect(legRow2!.paidAt).toBeTruthy();

    // List ordered by paidAt desc → p2 (Jan 5) first, p1 (Jan 1) second
    const list = await listSupplierPayments(leg!.id);
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe(p2!.id);
    expect(list[1]!.id).toBe(p1!.id);
  });

  it('clears paidAt when a payment is deleted so the leg drops below cost', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createOrder, updateOrderStatus, saveOrderItems, createSupplierPayment, deleteSupplierPayment } =
      await loadOrdersService();

    const [supplier] = await db
      .insert(counterparties)
      .values({ tenantId: tenant.id, name: 'Supplier B', type: 'SUPPLIER', types: ['SUPPLIER'] })
      .returning();

    const order = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
      supplierId: supplier!.id,
      supplierPaymentTermType: 'CREDIT',
    });
    await updateOrderStatus(order.id, 'CONFIRMED', user.id);

    const detail = await (await import('../src/modules/orders/orders.service')).getOrderById(order.id);
    const leg = detail?.orderSuppliers?.find((s) => s.companyId === supplier!.id)!;

    await saveOrderItems(order.id, [
      { productType: 'VLSFO', quantity: '4', orderSupplierId: leg.id, costPrice: '100', costCurrency: 'USD', salesPrice: '140', salesCurrency: 'USD' },
    ]);
    // leg cost = 400

    const p1 = await createSupplierPayment(leg.id, { amount: '150', currency: 'USD' });
    const p2 = await createSupplierPayment(leg.id, { amount: '250', currency: 'USD' });
    // total 400 >= cost 400 → paidAt set
    const [legRow1] = await db.select().from(orderSuppliers).where(eq(orderSuppliers.id, leg.id));
    expect(legRow1!.paidAt).toBeTruthy();

    // Delete p2 → paid drops to 150 < 400 → paidAt cleared
    const deleted = await deleteSupplierPayment(p2!.id);
    expect(deleted).toBe(true);
    const [legRow2] = await db.select().from(orderSuppliers).where(eq(orderSuppliers.id, leg.id));
    expect(legRow2!.amountPaid).toBe('150.00');
    expect(legRow2!.paidAt).toBeNull();

    // Deleting a non-existent payment returns false
    const missing = await deleteSupplierPayment('00000000-0000-0000-0000-000000000000');
    expect(missing).toBe(false);
  });

  it('updates a supplier payment and recomputes settlement', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createOrder, updateOrderStatus, saveOrderItems, createSupplierPayment, updateSupplierPayment } =
      await loadOrdersService();

    const [supplier] = await db
      .insert(counterparties)
      .values({ tenantId: tenant.id, name: 'Supplier C', type: 'SUPPLIER', types: ['SUPPLIER'] })
      .returning();

    const order = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
      supplierId: supplier!.id,
      supplierPaymentTermType: 'CREDIT',
    });
    await updateOrderStatus(order.id, 'CONFIRMED', user.id);

    const detail = await (await import('../src/modules/orders/orders.service')).getOrderById(order.id);
    const leg = detail?.orderSuppliers?.find((s) => s.companyId === supplier!.id)!;

    await saveOrderItems(order.id, [
      { productType: 'VLSFO', quantity: '2', orderSupplierId: leg.id, costPrice: '100', costCurrency: 'USD', salesPrice: '130', salesCurrency: 'USD' },
    ]);
    // leg cost = 200

    const p1 = await createSupplierPayment(leg.id, { amount: '100', currency: 'USD' });
    // paid 100 < 200 → not settled
    const [legRow1] = await db.select().from(orderSuppliers).where(eq(orderSuppliers.id, leg.id));
    expect(legRow1!.paidAt).toBeNull();

    // Bump payment to 200 → settled
    const updated = await updateSupplierPayment(p1!.id, { amount: '200' });
    expect(updated?.amount).toBe('200.00');
    const [legRow2] = await db.select().from(orderSuppliers).where(eq(orderSuppliers.id, leg.id));
    expect(legRow2!.amountPaid).toBe('200.00');
    expect(legRow2!.paidAt).toBeTruthy();
  });
});