import { beforeEach, describe, expect, it } from 'bun:test';
import { counterparties, creditLines, orders, orderSuppliers, orderItems, tenants } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { getDb, seedBasics, truncateAll } from './helpers/db';

async function loadCreditService() {
  return import('../src/modules/credit/credit.service');
}

/** Set broker deal settings on the tenant. */
async function setBrokerDealSettings(tenantId: string, settings: Record<string, unknown>) {
  const db = await getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error('Tenant not found');
  const newSettings = { ...(tenant.settings as any), brokerDeals: { enabled: true, defaultCommissionRate: 3, reportStatuses: ['CONFIRMED', 'DELIVERED', 'INVOICED', 'PAID'], autoReleaseCredit: true, autoReleaseBufferDays: 0, ...settings } };
  await db.update(tenants).set({ settings: newSettings, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
}

/**
 * API-level tests for broker credit line auto-release logic.
 *
 * Covers:
 * - Broker credit line usage counts only broker deals (is_broker_deal=true)
 *   NOTE: Currently BROKEN due to C1 (isBrokerCreditLine never selected in queries)
 * - Regular credit line excludes broker deals
 * - Auto-release after deliveredAt + creditDays has passed
 * - Manual paidAt still releases credit early
 * - Credit line create/update accepts isBrokerCreditLine flag
 *
 * These tests call the service directly (like credit.service.test.ts) to avoid
 * HTTP auth overhead for admin-only endpoints.
 */

describe('broker credit auto-release', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('credit line create accepts isBrokerCreditLine flag', async () => {
    const { tenant, client } = await seedBasics();
    const db = await getDb();
    const { createCreditLine, getCreditLineById } = await loadCreditService();

    const [supplier] = await db.insert(counterparties).values({
      tenantId: tenant.id,
      name: 'Test Supplier',
      type: 'SUPPLIER',
      types: ['SUPPLIER'],
      country: 'USA',
    }).returning();

    const line = await createCreditLine({
      counterpartyIds: [supplier.id],
      type: 'SUPPLIER',
      creditAmount: '100000',
      currency: 'USD',
      periodDays: 30,
      isBrokerCreditLine: true,
    });

    expect(line).toBeTruthy();
    // C1 FIXED: isBrokerCreditLine is now returned by getCreditLineById
    expect(line!.isBrokerCreditLine).toBe(true);
  });

  it('credit line update accepts isBrokerCreditLine flag', async () => {
    const { tenant, client } = await seedBasics();
    const db = await getDb();
    const { createCreditLine, updateCreditLine, getCreditLineById } = await loadCreditService();

    const [supplier] = await db.insert(counterparties).values({
      tenantId: tenant.id,
      name: 'Test Supplier',
      type: 'SUPPLIER',
      types: ['SUPPLIER'],
      country: 'USA',
    }).returning();

    const line = await createCreditLine({
      counterpartyIds: [supplier.id],
      type: 'SUPPLIER',
      creditAmount: '100000',
      currency: 'USD',
      periodDays: 30,
    });
    // C1 BUG: isBrokerCreditLine not returned by getCreditLineById
    // Verify via DB that it defaults to false
    const [dbRow1] = await db.select().from(creditLines).where(eq(creditLines.id, line!.id)).limit(1);
    expect(dbRow1?.isBrokerCreditLine).toBe(false);

    const updated = await updateCreditLine(line!.id, { isBrokerCreditLine: true });
    expect(updated).toBeTruthy();
    // C1 FIXED: isBrokerCreditLine is now selected in queries
    expect(updated?.isBrokerCreditLine).toBe(true);
  });

  it('regular credit line excludes broker deals from usage', async () => {
    const seeded = await seedBasics();
    const db = await getDb();
    const { createCreditLine, getCreditLineById } = await loadCreditService();

    const [supplier] = await db.insert(counterparties).values({
      tenantId: seeded.tenant.id,
      name: 'Test Supplier',
      type: 'SUPPLIER',
      types: ['SUPPLIER'],
      country: 'USA',
    }).returning();

    const line = await createCreditLine({
      counterpartyIds: [supplier.id],
      type: 'SUPPLIER',
      creditAmount: '100000',
      currency: 'USD',
      periodDays: 30,
    });

    // Create a broker deal order
    const [brokerOrder] = await db.insert(orders).values({
      tenantId: seeded.tenant.id,
      orderNumber: 'TEST-BD-001',
      clientId: seeded.client.id,
      vesselId: seeded.vessel.id,
      placeId: seeded.place.id,
      status: 'CONFIRMED',
      isBrokerDeal: true,
      supplierId: supplier.id,
      supplierPaymentTermType: 'CREDIT',
      supplierCreditDays: 30,
      currency: 'USD',
    }).returning();

    const [os] = await db.insert(orderSuppliers).values({
      orderId: brokerOrder.id,
      companyId: supplier.id,
      paymentTermType: 'CREDIT',
      creditDays: 30,
      isPrimary: true,
    }).returning();

    await db.insert(orderItems).values({
      orderId: brokerOrder.id,
      orderSupplierId: os.id,
      productType: 'VLSFO',
      quantity: '100',
      unit: 'MT',
      costPrice: '500',
      costCurrency: 'USD',
      salesPrice: '600',
      salesCurrency: 'USD',
      sortOrder: 0,
    });

    // Regular credit line filters is_broker_deal = false, so broker deals excluded
    const fetched = await getCreditLineById(line!.id);
    expect(fetched).toBeTruthy();
    expect(parseFloat(fetched!.usedAmount)).toBe(0);
  });

  it('broker credit line should count only broker deals (currently broken — C1)', async () => {
    const seeded = await seedBasics();
    const db = await getDb();
    const { createCreditLine, getCreditLineById } = await loadCreditService();

    const [supplier] = await db.insert(counterparties).values({
      tenantId: seeded.tenant.id,
      name: 'Test Supplier',
      type: 'SUPPLIER',
      types: ['SUPPLIER'],
      country: 'USA',
    }).returning();

    const line = await createCreditLine({
      counterpartyIds: [supplier.id],
      type: 'SUPPLIER',
      creditAmount: '100000',
      currency: 'USD',
      periodDays: 30,
      isBrokerCreditLine: true,
    });

    // Create a broker deal order
    const [brokerOrder] = await db.insert(orders).values({
      tenantId: seeded.tenant.id,
      orderNumber: 'TEST-BD-001',
      clientId: seeded.client.id,
      vesselId: seeded.vessel.id,
      placeId: seeded.place.id,
      status: 'CONFIRMED',
      isBrokerDeal: true,
      supplierId: supplier.id,
      supplierPaymentTermType: 'CREDIT',
      supplierCreditDays: 30,
      currency: 'USD',
    }).returning();

    const [os] = await db.insert(orderSuppliers).values({
      orderId: brokerOrder.id,
      companyId: supplier.id,
      paymentTermType: 'CREDIT',
      creditDays: 30,
      isPrimary: true,
    }).returning();

    await db.insert(orderItems).values({
      orderId: brokerOrder.id,
      orderSupplierId: os.id,
      productType: 'VLSFO',
      quantity: '100',
      unit: 'MT',
      costPrice: '500',
      costCurrency: 'USD',
      salesPrice: '600',
      salesCurrency: 'USD',
      sortOrder: 0,
    });

    // Create a regular (non-broker) order
    const [regularOrder] = await db.insert(orders).values({
      tenantId: seeded.tenant.id,
      orderNumber: 'TEST-REG-001',
      clientId: seeded.client.id,
      vesselId: seeded.vessel.id,
      placeId: seeded.place.id,
      status: 'CONFIRMED',
      isBrokerDeal: false,
      supplierId: supplier.id,
      supplierPaymentTermType: 'CREDIT',
      supplierCreditDays: 30,
      currency: 'USD',
    }).returning();

    const [os2] = await db.insert(orderSuppliers).values({
      orderId: regularOrder.id,
      companyId: supplier.id,
      paymentTermType: 'CREDIT',
      creditDays: 30,
      isPrimary: true,
    }).returning();

    await db.insert(orderItems).values({
      orderId: regularOrder.id,
      orderSupplierId: os2.id,
      productType: 'VLSFO',
      quantity: '100',
      unit: 'MT',
      costPrice: '300',
      costCurrency: 'USD',
      salesPrice: '400',
      salesCurrency: 'USD',
      sortOrder: 0,
    });

    // C1 FIXED: isBrokerCreditLine is now selected in queries, so
    // calcUsedAmountForSupplier correctly filters for broker deals.
    // Broker credit line should now count only broker deals ($50000),
    // NOT regular orders ($30000).
    const fetched = await getCreditLineById(line!.id);
    expect(fetched).toBeTruthy();
    expect(parseFloat(fetched!.usedAmount)).toBe(50000);
  });

  it('auto-releases broker credit after deliveredAt + creditDays has passed', async () => {
    const seeded = await seedBasics();
    const db = await getDb();
    const { createCreditLine, getCreditLineById } = await loadCreditService();

    const [supplier] = await db.insert(counterparties).values({
      tenantId: seeded.tenant.id,
      name: 'Test Supplier',
      type: 'SUPPLIER',
      types: ['SUPPLIER'],
      country: 'USA',
    }).returning();

    const line = await createCreditLine({
      counterpartyIds: [supplier.id],
      type: 'SUPPLIER',
      creditAmount: '100000',
      currency: 'USD',
      periodDays: 30,
      isBrokerCreditLine: true,
    });

    // Create a broker deal order delivered 60 days ago (past 30-day credit period)
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 60);

    const [brokerOrder] = await db.insert(orders).values({
      tenantId: seeded.tenant.id,
      orderNumber: 'TEST-BD-OLD',
      clientId: seeded.client.id,
      vesselId: seeded.vessel.id,
      placeId: seeded.place.id,
      status: 'CONFIRMED',
      isBrokerDeal: true,
      supplierId: supplier.id,
      supplierPaymentTermType: 'CREDIT',
      supplierCreditDays: 30,
      deliveredAt: oldDate,
      currency: 'USD',
    }).returning();

    const [os] = await db.insert(orderSuppliers).values({
      orderId: brokerOrder.id,
      companyId: supplier.id,
      paymentTermType: 'CREDIT',
      creditDays: 30,
      isPrimary: true,
    }).returning();

    await db.insert(orderItems).values({
      orderId: brokerOrder.id,
      orderSupplierId: os.id,
      productType: 'VLSFO',
      quantity: '100',
      unit: 'MT',
      costPrice: '500',
      costCurrency: 'USD',
      salesPrice: '600',
      salesCurrency: 'USD',
      sortOrder: 0,
    });

    // C1 FIXED: broker credit line now correctly filters for is_broker_deal=true.
    // The broker deal was delivered 60 days ago with 30-day credit period,
    // so it should be auto-released (usedAmount = 0).
    const fetched = await getCreditLineById(line!.id);
    expect(fetched).toBeTruthy();
    expect(parseFloat(fetched!.usedAmount)).toBe(0);
  });

  it('manual paidAt releases credit early', async () => {
    const seeded = await seedBasics();
    const db = await getDb();
    const { createCreditLine, getCreditLineById } = await loadCreditService();

    const [supplier] = await db.insert(counterparties).values({
      tenantId: seeded.tenant.id,
      name: 'Test Supplier',
      type: 'SUPPLIER',
      types: ['SUPPLIER'],
      country: 'USA',
    }).returning();

    const line = await createCreditLine({
      counterpartyIds: [supplier.id],
      type: 'SUPPLIER',
      creditAmount: '100000',
      currency: 'USD',
      periodDays: 30,
    });

    // Create a regular order (not broker deal)
    const [order] = await db.insert(orders).values({
      tenantId: seeded.tenant.id,
      orderNumber: 'TEST-REG-PAID',
      clientId: seeded.client.id,
      vesselId: seeded.vessel.id,
      placeId: seeded.place.id,
      status: 'CONFIRMED',
      isBrokerDeal: false,
      supplierId: supplier.id,
      supplierPaymentTermType: 'CREDIT',
      supplierCreditDays: 30,
      currency: 'USD',
    }).returning();

    const [os] = await db.insert(orderSuppliers).values({
      orderId: order.id,
      companyId: supplier.id,
      paymentTermType: 'CREDIT',
      creditDays: 30,
      isPrimary: true,
      paidAt: new Date(), // manually marked paid
    }).returning();

    await db.insert(orderItems).values({
      orderId: order.id,
      orderSupplierId: os.id,
      productType: 'VLSFO',
      quantity: '100',
      unit: 'MT',
      costPrice: '500',
      costCurrency: 'USD',
      salesPrice: '600',
      salesCurrency: 'USD',
      sortOrder: 0,
    });

    // Credit should be released (usedAmount = 0) because paidAt is set
    const fetched = await getCreditLineById(line!.id);
    expect(fetched).toBeTruthy();
    expect(parseFloat(fetched!.usedAmount)).toBe(0);
  });

  it('bufferDays keeps credit in use when past creditDays but within buffer (C2 fixed)', async () => {
    const seeded = await seedBasics();
    const db = await getDb();
    const { createCreditLine, getCreditLineById } = await loadCreditService();

    // Set bufferDays = 40 — credit period is 30 + 40 = 70 days
    await setBrokerDealSettings(seeded.tenant.id, { autoReleaseBufferDays: 40, autoReleaseCredit: true });

    const [supplier] = await db.insert(counterparties).values({
      tenantId: seeded.tenant.id,
      name: 'Test Supplier',
      type: 'SUPPLIER',
      types: ['SUPPLIER'],
      country: 'USA',
    }).returning();

    const line = await createCreditLine({
      counterpartyIds: [supplier.id],
      type: 'SUPPLIER',
      creditAmount: '100000',
      currency: 'USD',
      periodDays: 30,
      isBrokerCreditLine: true,
    });

    // Broker deal delivered 50 days ago — past 30-day credit period
    // but within 30 + 40 = 70 day period (with buffer)
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 50);

    const [brokerOrder] = await db.insert(orders).values({
      tenantId: seeded.tenant.id,
      orderNumber: 'TEST-BD-BUFFER',
      clientId: seeded.client.id,
      vesselId: seeded.vessel.id,
      placeId: seeded.place.id,
      status: 'CONFIRMED',
      isBrokerDeal: true,
      supplierId: supplier.id,
      supplierPaymentTermType: 'CREDIT',
      supplierCreditDays: 30,
      deliveredAt: recentDate,
      currency: 'USD',
    }).returning();

    const [os] = await db.insert(orderSuppliers).values({
      orderId: brokerOrder.id,
      companyId: supplier.id,
      paymentTermType: 'CREDIT',
      creditDays: 30,
      isPrimary: true,
    }).returning();

    await db.insert(orderItems).values({
      orderId: brokerOrder.id,
      orderSupplierId: os.id,
      productType: 'VLSFO',
      quantity: '100',
      unit: 'MT',
      costPrice: '500',
      costCurrency: 'USD',
      salesPrice: '600',
      salesCurrency: 'USD',
      sortOrder: 0,
    });

    // Credit should still be in use (50 days < 70 days with buffer)
    const fetched = await getCreditLineById(line!.id);
    expect(fetched).toBeTruthy();
    expect(parseFloat(fetched!.usedAmount)).toBe(50000); // costPrice=500 × qty=100
  });

  it('autoReleaseCredit=false prevents time-based release (C3 fixed)', async () => {
    const seeded = await seedBasics();
    const db = await getDb();
    const { createCreditLine, getCreditLineById } = await loadCreditService();

    // Disable auto-release — only manual paidAt should release credit
    await setBrokerDealSettings(seeded.tenant.id, { autoReleaseCredit: false });

    const [supplier] = await db.insert(counterparties).values({
      tenantId: seeded.tenant.id,
      name: 'Test Supplier',
      type: 'SUPPLIER',
      types: ['SUPPLIER'],
      country: 'USA',
    }).returning();

    const line = await createCreditLine({
      counterpartyIds: [supplier.id],
      type: 'SUPPLIER',
      creditAmount: '100000',
      currency: 'USD',
      periodDays: 30,
      isBrokerCreditLine: true,
    });

    // Broker deal delivered 90 days ago (well past 30-day credit period)
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 90);

    const [brokerOrder] = await db.insert(orders).values({
      tenantId: seeded.tenant.id,
      orderNumber: 'TEST-BD-NORELEASE',
      clientId: seeded.client.id,
      vesselId: seeded.vessel.id,
      placeId: seeded.place.id,
      status: 'CONFIRMED',
      isBrokerDeal: true,
      supplierId: supplier.id,
      supplierPaymentTermType: 'CREDIT',
      supplierCreditDays: 30,
      deliveredAt: oldDate,
      currency: 'USD',
    }).returning();

    const [os] = await db.insert(orderSuppliers).values({
      orderId: brokerOrder.id,
      companyId: supplier.id,
      paymentTermType: 'CREDIT',
      creditDays: 30,
      isPrimary: true,
    }).returning();

    await db.insert(orderItems).values({
      orderId: brokerOrder.id,
      orderSupplierId: os.id,
      productType: 'VLSFO',
      quantity: '100',
      unit: 'MT',
      costPrice: '500',
      costCurrency: 'USD',
      salesPrice: '600',
      salesCurrency: 'USD',
      sortOrder: 0,
    });

    // Credit should STILL be in use — autoReleaseCredit=false prevents time-based release
    const fetched = await getCreditLineById(line!.id);
    expect(fetched).toBeTruthy();
    expect(parseFloat(fetched!.usedAmount)).toBe(50000); // still in use
  });
});