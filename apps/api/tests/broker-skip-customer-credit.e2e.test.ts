/**
 * Tests for the broker-deals customer-credit tenant setting:
 * settings.brokerDeals.skipCustomerCreditCheckOnBrokerDeals (default false).
 *
 * When enabled for a tenant, converting a BROKER deal must not be gated by
 * the customer's credit availability. Regular (non-broker) trading orders
 * stay gated, and the supplier-side gate is unaffected either way.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { counterparties, orderItems, orders, orderSuppliers, tenants } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { getDb, seedBasics, truncateAll } from './helpers/db';

type OrdersService = typeof import('../src/modules/orders/orders.service');

async function loadOrdersService(): Promise<OrdersService> {
  return import('../src/modules/orders/orders.service');
}

async function seedBrokerDealScenario(opts: { skipCustomerCheck: boolean }) {
  const seeded = await seedBasics();
  const db = await getDb();
  const credit = await import('../src/modules/credit/credit.service');

  // Opt the tenant in (or not).
  await db
    .update(tenants)
    .set({ settings: { brokerDeals: { enabled: true, defaultCommissionRate: 3, reportStatuses: ['CONFIRMED'], autoReleaseCredit: true, autoReleaseBufferDays: 0, skipCustomerCreditCheckOnBrokerDeals: opts.skipCustomerCheck } } })
    .where(eq(tenants.id, seeded.tenant.id));

  // Broker-flagged customer credit line with ZERO availability headroom:
  // the customer already has a fully-committed line, so any conversion
  // would fail if the customer gate applied.
  await credit.createCreditLine({
    tenantId: seeded.tenant.id,
    counterpartyIds: [seeded.client.id],
    type: 'CUSTOMER',
    creditAmount: '100000',
    currency: 'USD',
    periodDays: 30,
    isBrokerCreditLine: true,
  });

  const [committed] = await db
    .insert(orders)
    .values({
      tenantId: seeded.tenant.id,
      orderNumber: 'BROKER-EXISTING-001',
      clientId: seeded.client.id,
      vesselId: seeded.vessel.id,
      placeId: seeded.place.id,
      status: 'CONFIRMED',
      isBrokerDeal: true,
      customerPaymentTermType: 'CREDIT',
      currency: 'USD',
    })
    .returning();
  await db.insert(orderItems).values({
    orderId: committed.id,
    productType: 'VLSFO',
    quantity: '1000',
    unit: 'MT',
    costPrice: '100',
    costCurrency: 'USD',
    salesPrice: '1000',
    salesCurrency: 'USD',
  });

  // A supplier credit line so the supplier leg passes too.
  const [supplier] = await db
    .insert(counterparties)
    .values({
      tenantId: seeded.tenant.id,
      name: 'Physical Supplier',
      type: 'SUPPLIER',
      types: ['SUPPLIER'],
      country: 'USA',
    })
    .returning();
  await credit.createCreditLine({
    tenantId: seeded.tenant.id,
    counterpartyIds: [supplier.id],
    type: 'SUPPLIER',
    creditAmount: '500000',
    currency: 'USD',
    periodDays: 30,
    isBrokerCreditLine: true,
  });

  return { seeded, db, committed, supplier };
}

async function newBrokerInquiry(orderNumber: string) {
  const seeded = await seedBasics();
  void seeded;
  const db = await getDb();
  return db;
}

describe('broker deals skip customer credit gate (tenant setting)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('setting ON: converting a broker deal passes despite zero customer credit availability', async () => {
    const { seeded, db, committed, supplier } = await seedBrokerDealScenario({ skipCustomerCheck: true });
    const svc = await loadOrdersService();

    // New broker inquiry for the same customer, priced beyond the line.
    const [order] = await db
      .insert(orders)
      .values({
        tenantId: seeded.tenant.id,
        orderNumber: 'BROKER-NEW-001',
        clientId: seeded.client.id,
        vesselId: seeded.vessel.id,
        placeId: seeded.place.id,
        status: 'INQUIRY',
        isBrokerDeal: true,
        customerPaymentTermType: 'CREDIT',
        currency: 'USD',
        supplierId: supplier.id,
        supplierPaymentTermType: 'CREDIT',
        supplierCreditDays: 30,
      })
      .returning();
    await db.insert(orderItems).values({
      orderId: order.id,
      productType: 'VLSFO',
      quantity: '100',
      unit: 'MT',
      costPrice: '100',
      costCurrency: 'USD',
      salesPrice: '1000',
      salesCurrency: 'USD',
    });
    await db.insert(orderSuppliers).values({
      orderId: order.id,
      companyId: supplier.id,
      paymentTermType: 'CREDIT',
      creditDays: 30,
      isPrimary: true,
    });

    // Customer-side would fail (line fully committed); broker skip lets the
    // customer check pass, and the supplier check passes via the supplier line.
    await expect(svc.assertCreditForConfirmation(order.id)).resolves.toBeUndefined();
    void committed;
  });

  it('setting OFF: broker deal is still gated by customer credit (default unchanged)', async () => {
    const { seeded, db, supplier } = await seedBrokerDealScenario({ skipCustomerCheck: false });
    const svc = await loadOrdersService();

    const [order] = await db
      .insert(orders)
      .values({
        tenantId: seeded.tenant.id,
        orderNumber: 'BROKER-NEW-002',
        clientId: seeded.client.id,
        vesselId: seeded.vessel.id,
        placeId: seeded.place.id,
        status: 'INQUIRY',
        isBrokerDeal: true,
        customerPaymentTermType: 'CREDIT',
        currency: 'USD',
        supplierId: supplier.id,
        supplierPaymentTermType: 'CREDIT',
        supplierCreditDays: 30,
      })
      .returning();
    await db.insert(orderItems).values({
      orderId: order.id,
      productType: 'VLSFO',
      quantity: '100',
      unit: 'MT',
      costPrice: '100',
      costCurrency: 'USD',
      salesPrice: '1000',
      salesCurrency: 'USD',
    });
    await db.insert(orderSuppliers).values({
      orderId: order.id,
      companyId: supplier.id,
      paymentTermType: 'CREDIT',
      creditDays: 30,
      isPrimary: true,
    });

    await expect(svc.assertCreditForConfirmation(order.id)).rejects.toThrow(/credit/i);
  });

  it('setting ON: regular (non-broker) deals are still gated', async () => {
    const { seeded, db, supplier } = await seedBrokerDealScenario({ skipCustomerCheck: true });
    const svc = await loadOrdersService();

    const [order] = await db
      .insert(orders)
      .values({
        tenantId: seeded.tenant.id,
        orderNumber: 'REGULAR-NEW-001',
        clientId: seeded.client.id,
        vesselId: seeded.vessel.id,
        placeId: seeded.place.id,
        status: 'INQUIRY',
        isBrokerDeal: false,
        customerPaymentTermType: 'CREDIT',
        currency: 'USD',
        supplierId: supplier.id,
        supplierPaymentTermType: 'CREDIT',
        supplierCreditDays: 30,
      })
      .returning();
    await db.insert(orderItems).values({
      orderId: order.id,
      productType: 'VLSFO',
      quantity: '100',
      unit: 'MT',
      costPrice: '100',
      costCurrency: 'USD',
      salesPrice: '1000',
      salesCurrency: 'USD',
    });
    await db.insert(orderSuppliers).values({
      orderId: order.id,
      companyId: supplier.id,
      paymentTermType: 'CREDIT',
      creditDays: 30,
      isPrimary: true,
    });

    await expect(svc.assertCreditForConfirmation(order.id)).rejects.toThrow(/credit/i);
  });
});