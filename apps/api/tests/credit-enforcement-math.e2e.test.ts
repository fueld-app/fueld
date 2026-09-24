/**
 * Regression tests for the credit-enforcement math fixes of 2026-09-14:
 *
 *   1. Self-exclusion (excludeOrderId): the deal being validated must not
 *      count against its own usage — otherwise converting a priced deal
 *      needs 2x its value in available credit.
 *
 *   2. Payment netting: customer-side used-amount nets payments actually
 *      received per order (parity with supplier-side paidAt netting).
 *      Recorded payments must release credit without a manual mark-PAID.
 *
 *   3. Currency scoping: payments recorded in another currency than the
 *      order's currency must not net against it.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { customerPayments, orders, orderItems } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';

type CreditService = typeof import('../src/modules/credit/credit.service');

async function loadCreditService(): Promise<CreditService> {
  return import('../src/modules/credit/credit.service');
}

async function seedCustomerWithLine(creditAmount: string, currency = 'USD', isBroker = false) {
  const seeded = await seedBasics();
  const db = await getDb();
  const svc = await loadCreditService();
  const line = await svc.createCreditLine({
    tenantId: seeded.tenant.id,
    counterpartyIds: [seeded.client.id],
    type: 'CUSTOMER',
    creditAmount,
    currency,
    periodDays: 30,
    isBrokerCreditLine: isBroker,
  });
  return { seeded, db, svc, line };
}

type OrderStatus = 'INQUIRY' | 'CONFIRMED' | 'INVOICED';

async function addCreditOrder(
  db: Awaited<ReturnType<typeof getDb>>,
  seeded: Awaited<ReturnType<typeof seedBasics>>,
  orderNumber: string,
  status: OrderStatus,
) {
  const [order] = await db
    .insert(orders)
    .values({
      tenantId: seeded.tenant.id,
      orderNumber,
      clientId: seeded.client.id,
      vesselId: seeded.vessel.id,
      placeId: seeded.place.id,
      status,
      isBrokerDeal: false,
      customerPaymentTermType: 'CREDIT',
      currency: 'USD',
    })
    .returning();
  return order;
}

async function addPayment(
  db: Awaited<ReturnType<typeof getDb>>,
  seeded: Awaited<ReturnType<typeof seedBasics>>,
  orderId: string,
  amount: string,
  currency = 'USD',
) {
  await db.insert(customerPayments).values({
    tenantId: seeded.tenant.id,
    customerId: seeded.client.id,
    orderId,
    amount,
    currency,
  });
}

describe('credit enforcement math fixes', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('a deal exactly matching the line converts when its own value is excluded', async () => {
    const { seeded, db, svc } = await seedCustomerWithLine('100000');

    // One open inquiry priced at exactly the full line amount.
    const order = await addCreditOrder(db, seeded, 'SELF-EXCL-001', 'INQUIRY');
    await db.insert(orderItems).values({
      orderId: order.id,
      productType: 'VLSFO',
      quantity: '100',
      unit: 'MT',
      costPrice: '800',
      costCurrency: 'USD',
      salesPrice: '1000',
      salesCurrency: 'USD',
    });

    // Old broken behavior (no exclusion): used includes the deal itself,
    // so the deal could never fit its own line.
    const before = await svc.checkCreditAvailability({
      tenantId: seeded.tenant.id,
      type: 'CUSTOMER',
      counterpartyId: seeded.client.id,
      currency: 'USD',
      isBrokerDeal: false,
      required: 100000,
      label: 'Customer credit',
    });
    expect(before.ok).toBe(false);
    expect(before.available).toBe(0);

    // With self-exclusion: no other exposure, the line covers the deal.
    const result = await svc.checkCreditAvailability({
      tenantId: seeded.tenant.id,
      type: 'CUSTOMER',
      counterpartyId: seeded.client.id,
      currency: 'USD',
      isBrokerDeal: false,
      required: 100000,
      excludeOrderId: order.id,
      label: 'Customer credit',
    });
    expect(result.ok).toBe(true);
    expect(result.available).toBeCloseTo(100000, 0);
  });

  it('recorded customer payments release credit without manual mark-PAID', async () => {
    const { seeded, db, svc } = await seedCustomerWithLine('100000');

    // Fully-paid CONFIRMED order.
    const paidOrder = await addCreditOrder(db, seeded, 'NET-001', 'CONFIRMED');
    await db.insert(orderItems).values({
      orderId: paidOrder.id,
      productType: 'VLSFO',
      quantity: '600',
      unit: 'MT',
      costPrice: '100',
      costCurrency: 'USD',
      salesPrice: '100',
      salesCurrency: 'USD',
    });
    await addPayment(db, seeded, paidOrder.id, '60000');

    // Partially-paid CONFIRMED order.
    const partialOrder = await addCreditOrder(db, seeded, 'NET-002', 'CONFIRMED');
    await db.insert(orderItems).values({
      orderId: partialOrder.id,
      productType: 'VLSFO',
      quantity: '200',
      unit: 'MT',
      costPrice: '100',
      costCurrency: 'USD',
      salesPrice: '100',
      salesCurrency: 'USD',
    });
    await addPayment(db, seeded, partialOrder.id, '5000');

    // Line 100000 - (fully paid nets to 0) - (20000 - 5000 partial) = 85000.
    const line = await svc.getCreditLineById((await db.query.creditLines.findFirst())!.id);
    expect(parseFloat(line!.usedAmount)).toBeCloseTo(15000, 0);
    expect(parseFloat(line!.availableAmount)).toBeCloseTo(85000, 0);
  });

  it('overpayment never creates negative usage (floored at zero per order)', async () => {
    const { seeded, db, svc } = await seedCustomerWithLine('50000');

    const order = await addCreditOrder(db, seeded, 'NET-OVER-001', 'INVOICED');
    await db.insert(orderItems).values({
      orderId: order.id,
      productType: 'VLSFO',
      quantity: '100',
      unit: 'MT',
      costPrice: '100',
      costCurrency: 'USD',
      salesPrice: '100',
      salesCurrency: 'USD',
    });
    // Overpaid by 2000.
    await addPayment(db, seeded, order.id, '12000');

    const line = await svc.getCreditLineById((await db.query.creditLines.findFirst())!.id);
    expect(parseFloat(line!.usedAmount)).toBe(0);
    expect(parseFloat(line!.availableAmount)).toBeCloseTo(50000, 0);
  });

  it('multi-item orders net payments at the ORDER level, not per item row', async () => {
    const { seeded, db, svc } = await seedCustomerWithLine('100000');

    // One order, TWO item rows (50k each = 100k), payments of 30k received.
    // Per-item netting would compute 2 × (50k − 30k) = 40k (over-netted,
    // fail-open). Correct net usage = 100k − 30k = 70k.
    const order = await addCreditOrder(db, seeded, 'MULTI-ITEM-001', 'CONFIRMED');
    await db.insert(orderItems).values([
      { orderId: order.id, productType: 'VLSFO', quantity: '500', unit: 'MT', costPrice: '100', costCurrency: 'USD', salesPrice: '100', salesCurrency: 'USD' },
      { orderId: order.id, productType: 'MGO', quantity: '500', unit: 'MT', costPrice: '100', costCurrency: 'USD', salesPrice: '100', salesCurrency: 'USD' },
    ]);
    await addPayment(db, seeded, order.id, '30000');

    const line = await svc.getCreditLineById((await db.query.creditLines.findFirst())!.id);
    expect(parseFloat(line!.usedAmount)).toBeCloseTo(70000, 0);
    expect(parseFloat(line!.availableAmount)).toBeCloseTo(30000, 0);
  });

  it('payments in a different currency do not net against the order', async () => {
    const { seeded, db, svc } = await seedCustomerWithLine('100000');

    const order = await addCreditOrder(db, seeded, 'NET-FX-001', 'CONFIRMED');
    await db.insert(orderItems).values({
      orderId: order.id,
      productType: 'VLSFO',
      quantity: '400',
      unit: 'MT',
      costPrice: '100',
      costCurrency: 'USD',
      salesPrice: '100',
      salesCurrency: 'USD',
    });
    // Payment recorded in EUR — must NOT reduce the USD exposure.
    await addPayment(db, seeded, order.id, '40000', 'EUR');

    const line = await svc.getCreditLineById((await db.query.creditLines.findFirst())!.id);
    expect(parseFloat(line!.usedAmount)).toBeCloseTo(40000, 0);
  });

  it('a paid-up book frees the line for new conversions end-to-end', async () => {
    const { seeded, db, svc } = await seedCustomerWithLine('2000000', 'USD', true);

    // Mirror the Moxie shape: one stale fully-paid INVOICED order + the new deal.
    const settled = await addCreditOrder(db, seeded, 'MOXIE-001', 'INVOICED');
    await db.insert(orderItems).values({
      orderId: settled.id,
      productType: 'VLSFO',
      quantity: '19000',
      unit: 'MT',
      costPrice: '100',
      costCurrency: 'USD',
      salesPrice: '100',
      salesCurrency: 'USD',
    });
    await addPayment(db, seeded, settled.id, '1900000');

    const deal = await addCreditOrder(db, seeded, 'MOXIE-002', 'INQUIRY');
    await db.insert(orderItems).values({
      orderId: deal.id,
      productType: 'VLSFO',
      quantity: '3651.6',
      unit: 'MT',
      costPrice: '100',
      costCurrency: 'USD',
      salesPrice: '100',
      salesCurrency: 'USD',
    });

    const result = await svc.checkCreditAvailability({
      tenantId: seeded.tenant.id,
      type: 'CUSTOMER',
      counterpartyId: seeded.client.id,
      currency: 'USD',
      isBrokerDeal: true,
      required: 365160,
      excludeOrderId: deal.id,
      label: 'Customer credit',
    });
    expect(result.ok).toBe(true);
    expect(result.available).toBeCloseTo(2000000, 0);
  });
});