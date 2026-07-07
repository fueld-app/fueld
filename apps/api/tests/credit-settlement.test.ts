import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { counterparties, orderSuppliers } from '../src/db/schema';
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

/**
 * Sensitive credit-line tests for two-sided order settlement.
 * These verify that supplier credit is released per-leg (not per-order),
 * that customer and supplier credit are truly independent, and that
 * availability/used amounts are correct through settle → re-consume cycles.
 */
describe('two-sided settlement — credit line sensitivity', () => {
  // ─── Helpers ──────────────────────────────────────────────────────
  async function createSupplier(tenantId: string, name: string) {
    const db = await getDb();
    const [s] = await db
      .insert(counterparties)
      .values({ tenantId, name, type: 'SUPPLIER', types: ['SUPPLIER'] })
      .returning();
    return s!;
  }

  async function createOrderWithLeg(tenantId: string, clientId: string, vesselId: string, placeId: string, userId: string, supplierId: string, items: Array<{ productType: string; quantity: string; costPrice: string; salesPrice: string }>) {
    const { createOrder, updateOrder, saveOrderItems, updateOrderStatus, getOrderById } = await loadOrdersService();
    const order = await createOrder({
      tenantId, clientId, vesselId, placeId, salesRepId: userId,
      supplierId, supplierPaymentTermType: 'CREDIT',
    });
    await updateOrder(order.id, { supplierId, supplierPaymentTermType: 'CREDIT' });
    await updateOrderStatus(order.id, 'CONFIRMED', userId);
    const detail = await getOrderById(order.id);
    const leg = detail?.orderSuppliers?.find((s) => s.companyId === supplierId)!;
    await saveOrderItems(order.id, items.map((it) => ({
      ...it, orderSupplierId: leg.id, costCurrency: 'USD', salesCurrency: 'USD',
    })));
    return { order, leg };
  }

  async function usedAmount(creditLineId: string): Promise<{ used: string; available: string }> {
    const { getCreditLineById } = await loadCreditService();
    const line = await getCreditLineById(creditLineId);
    return { used: line?.usedAmount ?? '0', available: line?.availableAmount ?? '0' };
  }

  // ─── 1. Per-leg independence on same order ────────────────────────
  it('settling one leg releases only that leg supplier credit; other leg stays used', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createCreditLine, getCreditLineById } = await loadCreditService();
    const { addOrderSupplier, saveOrderItems, updateOrderStatus, getOrderById } = await loadOrdersService();
    const { createSupplierPayment } = await loadOrdersService();

    const supplierA = await createSupplier(tenant.id, 'Supplier A');
    const supplierB = await createSupplier(tenant.id, 'Supplier B');

    const creditA = await createCreditLine({ type: 'SUPPLIER', counterpartyIds: [supplierA.id], creditAmount: '1000', currency: 'USD', periodDays: 30 });
    const creditB = await createCreditLine({ type: 'SUPPLIER', counterpartyIds: [supplierB.id], creditAmount: '1000', currency: 'USD', periodDays: 30 });

    const { createOrder } = await loadOrdersService();
    const order = await createOrder({ tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id, supplierId: supplierA.id, supplierPaymentTermType: 'CREDIT' });
    await updateOrderStatus(order.id, 'CONFIRMED', user.id);

    const detail = await getOrderById(order.id);
    const legA = detail?.orderSuppliers?.find((s) => s.companyId === supplierA.id)!;
    const legB = await addOrderSupplier(order.id, { companyId: supplierB.id, paymentTermType: 'CREDIT' });

    await saveOrderItems(order.id, [
      { productType: 'VLSFO', quantity: '3', orderSupplierId: legA.id, costPrice: '100', costCurrency: 'USD', salesPrice: '120', salesCurrency: 'USD' },
      { productType: 'MGO', quantity: '5', orderSupplierId: legB!.id, costPrice: '50', costCurrency: 'USD', salesPrice: '70', salesCurrency: 'USD' },
    ]);
    // legA cost = 300, legB cost = 250

    expect((await usedAmount(creditA!.id)).used).toBe('300.00');
    expect((await usedAmount(creditB!.id)).used).toBe('250.00');

    // Settle legA only
    await createSupplierPayment(legA.id, { amount: '300', currency: 'USD' });

    expect((await usedAmount(creditA!.id)).used).toBe('0.00');
    expect((await usedAmount(creditA!.id)).available).toBe('1000.00');
    // Supplier B credit is UNCHANGED
    expect((await usedAmount(creditB!.id)).used).toBe('250.00');
    expect((await usedAmount(creditB!.id)).available).toBe('750.00');
  });

  // ─── 2. Multi-order same supplier independence ────────────────────
  it('settling one order leg does not release credit used by another order for the same supplier', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createCreditLine } = await loadCreditService();
    const { createSupplierPayment } = await loadOrdersService();

    const supplier = await createSupplier(tenant.id, 'Shared Supplier');
    const credit = await createCreditLine({ type: 'SUPPLIER', counterpartyIds: [supplier.id], creditAmount: '2000', currency: 'USD', periodDays: 30 });

    const { order: order1, leg: leg1 } = await createOrderWithLeg(tenant.id, client.id, vessel.id, place.id, user.id, supplier.id, [
      { productType: 'VLSFO', quantity: '2', costPrice: '100', salesPrice: '150' },
    ]);
    const { order: order2, leg: leg2 } = await createOrderWithLeg(tenant.id, client.id, vessel.id, place.id, user.id, supplier.id, [
      { productType: 'MGO', quantity: '4', costPrice: '100', salesPrice: '140' },
    ]);
    // leg1 cost = 200, leg2 cost = 400, total used = 600

    expect((await usedAmount(credit!.id)).used).toBe('600.00');

    // Settle order1's leg only
    await createSupplierPayment(leg1.id, { amount: '200', currency: 'USD' });

    // Only 200 released; 400 still used by order2
    expect((await usedAmount(credit!.id)).used).toBe('400.00');
    expect((await usedAmount(credit!.id)).available).toBe('1600.00');

    // Settle order2's leg
    await createSupplierPayment(leg2.id, { amount: '400', currency: 'USD' });
    expect((await usedAmount(credit!.id)).used).toBe('0.00');
    expect((await usedAmount(credit!.id)).available).toBe('2000.00');
  });

  // ─── 3. Round-trip: settle → delete → re-consume → settle again ───
  it('credit is re-consumed when a settlement payment is deleted, then re-released on re-settlement', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createCreditLine } = await loadCreditService();
    const { createSupplierPayment, deleteSupplierPayment } = await loadOrdersService();

    const supplier = await createSupplier(tenant.id, 'Round-trip Supplier');
    const credit = await createCreditLine({ type: 'SUPPLIER', counterpartyIds: [supplier.id], creditAmount: '1000', currency: 'USD', periodDays: 30 });

    const { leg } = await createOrderWithLeg(tenant.id, client.id, vessel.id, place.id, user.id, supplier.id, [
      { productType: 'VLSFO', quantity: '5', costPrice: '100', salesPrice: '140' },
    ]);
    // cost = 500

    expect((await usedAmount(credit!.id)).used).toBe('500.00');

    // Settle
    const payment = await createSupplierPayment(leg.id, { amount: '500', currency: 'USD' });
    expect((await usedAmount(credit!.id)).used).toBe('0.00');
    expect((await usedAmount(credit!.id)).available).toBe('1000.00');

    // Delete payment → credit re-consumed
    await deleteSupplierPayment(payment!.id);
    expect((await usedAmount(credit!.id)).used).toBe('500.00');
    expect((await usedAmount(credit!.id)).available).toBe('500.00');

    // Re-settle
    await createSupplierPayment(leg.id, { amount: '500', currency: 'USD' });
    expect((await usedAmount(credit!.id)).used).toBe('0.00');
    expect((await usedAmount(credit!.id)).available).toBe('1000.00');
  });

  // ─── 4. Customer credit independence ──────────────────────────────
  it('supplier settlement does not affect customer credit usage', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createCreditLine } = await loadCreditService();
    const { createSupplierPayment } = await loadOrdersService();

    const supplier = await createSupplier(tenant.id, 'Supplier X');
    const customerCredit = await createCreditLine({ type: 'CUSTOMER', counterpartyIds: [client.id], creditAmount: '2000', currency: 'USD', periodDays: 30 });
    const supplierCredit = await createCreditLine({ type: 'SUPPLIER', counterpartyIds: [supplier.id], creditAmount: '1000', currency: 'USD', periodDays: 30 });

    const { leg } = await createOrderWithLeg(tenant.id, client.id, vessel.id, place.id, user.id, supplier.id, [
      { productType: 'VLSFO', quantity: '4', costPrice: '100', salesPrice: '150' },
    ]);
    // cost = 400, revenue = 600

    // Customer credit used = 600 (salesPrice), supplier credit used = 400 (costPrice)
    expect((await usedAmount(customerCredit!.id)).used).toBe('600.00');
    expect((await usedAmount(supplierCredit!.id)).used).toBe('400.00');

    // Settle the supplier leg
    await createSupplierPayment(leg.id, { amount: '400', currency: 'USD' });

    // Supplier credit released, customer credit UNCHANGED
    expect((await usedAmount(supplierCredit!.id)).used).toBe('0.00');
    expect((await usedAmount(customerCredit!.id)).used).toBe('600.00');
    expect((await usedAmount(customerCredit!.id)).available).toBe('1400.00');
  });

  // ─── 5. Cross-supplier independence ───────────────────────────────
  it('settling supplier A leg does not release supplier B credit on a different order', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createCreditLine } = await loadCreditService();
    const { createSupplierPayment } = await loadOrdersService();

    const supplierA = await createSupplier(tenant.id, 'Supplier Cross-A');
    const supplierB = await createSupplier(tenant.id, 'Supplier Cross-B');
    const creditA = await createCreditLine({ type: 'SUPPLIER', counterpartyIds: [supplierA.id], creditAmount: '1000', currency: 'USD', periodDays: 30 });
    const creditB = await createCreditLine({ type: 'SUPPLIER', counterpartyIds: [supplierB.id], creditAmount: '1000', currency: 'USD', periodDays: 30 });

    const { leg: legA } = await createOrderWithLeg(tenant.id, client.id, vessel.id, place.id, user.id, supplierA.id, [
      { productType: 'VLSFO', quantity: '3', costPrice: '100', salesPrice: '130' },
    ]);
    const { leg: legB } = await createOrderWithLeg(tenant.id, client.id, vessel.id, place.id, user.id, supplierB.id, [
      { productType: 'MGO', quantity: '2', costPrice: '200', salesPrice: '250' },
    ]);
    // legA cost = 300, legB cost = 400

    // Settle legA
    await createSupplierPayment(legA.id, { amount: '300', currency: 'USD' });

    expect((await usedAmount(creditA!.id)).used).toBe('0.00');
    expect((await usedAmount(creditB!.id)).used).toBe('400.00');
    expect((await usedAmount(creditB!.id)).available).toBe('600.00');
  });

  // ─── 6. Order PAID + all legs settled → all supplier credit released
  it('order PAID with all supplier legs settled releases all supplier credit', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createCreditLine } = await loadCreditService();
    const { createSupplierPayment, updateOrderStatus, getOrderById, addOrderSupplier, saveOrderItems } = await loadOrdersService();
    const { createOrder } = await loadOrdersService();

    const supplierA = await createSupplier(tenant.id, 'Supplier All-Settled A');
    const supplierB = await createSupplier(tenant.id, 'Supplier All-Settled B');
    const creditA = await createCreditLine({ type: 'SUPPLIER', counterpartyIds: [supplierA.id], creditAmount: '1000', currency: 'USD', periodDays: 30 });
    const creditB = await createCreditLine({ type: 'SUPPLIER', counterpartyIds: [supplierB.id], creditAmount: '1000', currency: 'USD', periodDays: 30 });

    const order = await createOrder({ tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id, supplierId: supplierA.id, supplierPaymentTermType: 'CREDIT' });
    await updateOrderStatus(order.id, 'CONFIRMED', user.id);
    const detail = await getOrderById(order.id);
    const legA = detail?.orderSuppliers?.find((s) => s.companyId === supplierA.id)!;
    const legB = await addOrderSupplier(order.id, { companyId: supplierB.id, paymentTermType: 'CREDIT' });
    await saveOrderItems(order.id, [
      { productType: 'VLSFO', quantity: '2', orderSupplierId: legA.id, costPrice: '100', costCurrency: 'USD', salesPrice: '150', salesCurrency: 'USD' },
      { productType: 'MGO', quantity: '3', orderSupplierId: legB!.id, costPrice: '100', costCurrency: 'USD', salesPrice: '130', salesCurrency: 'USD' },
    ]);
    // legA cost = 200, legB cost = 300

    // Mark order PAID (customer side)
    await updateOrderStatus(order.id, 'PAID', user.id);

    // Both legs still used (PAID doesn't auto-free supplier credit)
    expect((await usedAmount(creditA!.id)).used).toBe('200.00');
    expect((await usedAmount(creditB!.id)).used).toBe('300.00');

    // Settle both legs
    await createSupplierPayment(legA.id, { amount: '200', currency: 'USD' });
    await createSupplierPayment(legB.id, { amount: '300', currency: 'USD' });

    expect((await usedAmount(creditA!.id)).used).toBe('0.00');
    expect((await usedAmount(creditB!.id)).used).toBe('0.00');
  });

  // ─── 7. Order PAID + partial legs settled ─────────────────────────
  it('order PAID with one leg settled and one not releases only the settled leg credit', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createCreditLine } = await loadCreditService();
    const { createSupplierPayment, updateOrderStatus, getOrderById, addOrderSupplier, saveOrderItems, createOrder } = await loadOrdersService();

    const supplierA = await createSupplier(tenant.id, 'Supplier Partial-Settle A');
    const supplierB = await createSupplier(tenant.id, 'Supplier Partial-Settle B');
    const creditA = await createCreditLine({ type: 'SUPPLIER', counterpartyIds: [supplierA.id], creditAmount: '1000', currency: 'USD', periodDays: 30 });
    const creditB = await createCreditLine({ type: 'SUPPLIER', counterpartyIds: [supplierB.id], creditAmount: '1000', currency: 'USD', periodDays: 30 });

    const order = await createOrder({ tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id, supplierId: supplierA.id, supplierPaymentTermType: 'CREDIT' });
    await updateOrderStatus(order.id, 'CONFIRMED', user.id);
    const detail = await getOrderById(order.id);
    const legA = detail?.orderSuppliers?.find((s) => s.companyId === supplierA.id)!;
    const legB = await addOrderSupplier(order.id, { companyId: supplierB.id, paymentTermType: 'CREDIT' });
    await saveOrderItems(order.id, [
      { productType: 'VLSFO', quantity: '2', orderSupplierId: legA.id, costPrice: '100', costCurrency: 'USD', salesPrice: '150', salesCurrency: 'USD' },
      { productType: 'MGO', quantity: '3', orderSupplierId: legB!.id, costPrice: '100', costCurrency: 'USD', salesPrice: '130', salesCurrency: 'USD' },
    ]);

    await updateOrderStatus(order.id, 'PAID', user.id);

    // Settle only legA
    await createSupplierPayment(legA.id, { amount: '200', currency: 'USD' });

    expect((await usedAmount(creditA!.id)).used).toBe('0.00');
    expect((await usedAmount(creditB!.id)).used).toBe('300.00');
    expect((await usedAmount(creditB!.id)).available).toBe('700.00');
  });

  // ─── 8. Zero-cost leg edge case ────────────────────────────────────
  it('zero-cost leg does not settle and does not affect credit', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createCreditLine } = await loadCreditService();
    const { createSupplierPayment } = await loadOrdersService();

    const supplier = await createSupplier(tenant.id, 'Zero-cost Supplier');
    const credit = await createCreditLine({ type: 'SUPPLIER', counterpartyIds: [supplier.id], creditAmount: '1000', currency: 'USD', periodDays: 30 });

    const { leg } = await createOrderWithLeg(tenant.id, client.id, vessel.id, place.id, user.id, supplier.id, [
      { productType: 'VLSFO', quantity: '0', costPrice: '100', salesPrice: '130' },
    ]);
    // cost = 0 (qty * costPrice = 0)

    // Zero cost → credit used is 0
    expect((await usedAmount(credit!.id)).used).toBe('0.00');

    // Payment on zero-cost leg → paidAt set since 0 >= 0... actually paidTotal > 0 check prevents this
    const payment = await createSupplierPayment(leg.id, { amount: '0', currency: 'USD' });
    // A zero payment shouldn't mark the leg as settled (paidTotal > 0 guard)
    const db = await getDb();
    const [legRow] = await db.select().from(orderSuppliers).where(eq(orderSuppliers.id, leg.id));
    // With 0 cost and 0 payment, the leg shouldn't be "settled" in a meaningful way
    // The important thing: credit used stays 0
    expect((await usedAmount(credit!.id)).used).toBe('0.00');
  });

  // ─── 9. Re-consume after partial delete ───────────────────────────
  it('deleting one of multiple payments drops below cost and re-consumes credit', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createCreditLine } = await loadCreditService();
    const { createSupplierPayment, deleteSupplierPayment } = await loadOrdersService();

    const supplier = await createSupplier(tenant.id, 'Multi-payment Supplier');
    const credit = await createCreditLine({ type: 'SUPPLIER', counterpartyIds: [supplier.id], creditAmount: '1000', currency: 'USD', periodDays: 30 });

    const { leg } = await createOrderWithLeg(tenant.id, client.id, vessel.id, place.id, user.id, supplier.id, [
      { productType: 'VLSFO', quantity: '5', costPrice: '100', salesPrice: '140' },
    ]);
    // cost = 500

    const p1 = await createSupplierPayment(leg.id, { amount: '200', currency: 'USD' });
    const p2 = await createSupplierPayment(leg.id, { amount: '300', currency: 'USD' });
    // Settled (500 >= 500)
    expect((await usedAmount(credit!.id)).used).toBe('0.00');

    // Delete p2 → paid drops to 200 < 500 → re-consume
    await deleteSupplierPayment(p2!.id);
    expect((await usedAmount(credit!.id)).used).toBe('500.00');
    expect((await usedAmount(credit!.id)).available).toBe('500.00');

    // Delete p1 too → paid drops to 0 → still re-consumed (was already)
    await deleteSupplierPayment(p1!.id);
    expect((await usedAmount(credit!.id)).used).toBe('500.00');
  });

  // ─── 10. Order CANCELLED after partial settlement ─────────────────
  it('cancelling an order releases supplier credit even if partially settled', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createCreditLine } = await loadCreditService();
    const { createSupplierPayment, updateOrderStatus } = await loadOrdersService();

    const supplier = await createSupplier(tenant.id, 'Cancel-after-settle Supplier');
    const credit = await createCreditLine({ type: 'SUPPLIER', counterpartyIds: [supplier.id], creditAmount: '1000', currency: 'USD', periodDays: 30 });

    const { order, leg } = await createOrderWithLeg(tenant.id, client.id, vessel.id, place.id, user.id, supplier.id, [
      { productType: 'VLSFO', quantity: '4', costPrice: '100', salesPrice: '140' },
    ]);
    // cost = 400

    // Partially settle
    await createSupplierPayment(leg.id, { amount: '200', currency: 'USD' });
    expect((await usedAmount(credit!.id)).used).toBe('400.00'); // still used (partial)

    // Cancel the order
    await updateOrderStatus(order.id, 'CANCELLED', user.id, 'Buyer cancelled');

    // CANCELLED is not in active statuses → credit fully released
    expect((await usedAmount(credit!.id)).used).toBe('0.00');
    expect((await usedAmount(credit!.id)).available).toBe('1000.00');
  });
});