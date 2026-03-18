import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { tenants } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';

async function loadOrdersService() {
  return import('../src/modules/orders/orders.service');
}

beforeEach(async () => {
  await truncateAll();
});

describe('orders financing', () => {
  it('derives financing cost and net profit from the payment spread', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createOrder, saveOrderItems, getOrderById, listOrders } = await loadOrdersService();

    await db
      .update(tenants)
      .set({ settings: { financingRateAnnual: 0.08 }, updatedAt: new Date() })
      .where(eq(tenants.id, tenant.id));

    const order = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
      customerPaymentTermType: 'CREDIT',
      customerCreditDays: 15,
      supplierPaymentTermType: 'COD',
    });

    await saveOrderItems(order.id, [
      {
        productType: 'MGO',
        quantity: '800',
        unit: 'MT',
        costPrice: '1595',
        costCurrency: 'USD',
        salesPrice: '1635',
        salesCurrency: 'USD',
      },
    ]);

    const detail = await getOrderById(order.id);
    expect(detail).not.toBeNull();
    expect(detail?.financingRateAnnual).toBe(0.08);
    expect(detail?.financingDays).toBe(15);
    expect(Number(detail?.totalFinancingCost)).toBeCloseTo(4195.0685, 3);
    expect(Number(detail?.financingCostPerMt)).toBeCloseTo(5.2438, 3);
    expect(Number(detail?.totalNetProfit)).toBeCloseTo(27804.9315, 3);
    expect(Number(detail?.netMarginPct)).toBeCloseTo(2.1258, 3);
    expect(Number(detail?.items[0]?.financingCost)).toBeCloseTo(4195.0685, 3);
    expect(Number(detail?.items[0]?.netProfit)).toBeCloseTo(27804.9315, 3);

    const listed = await listOrders({ statuses: ['INQUIRY'] });
    expect(listed.items[0]?.totalFinancingCost).toBeCloseTo(4195.0685, 3);
    expect(listed.items[0]?.totalNetProfit).toBeCloseTo(27804.9315, 3);
    expect(listed.items[0]?.netMarginPct).toBeCloseTo(2.1258, 3);
  });

  it('applies cost-side density conversion in list order economics', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createOrder, saveOrderItems, getOrderById, listOrders } = await loadOrdersService();

    await db
      .update(tenants)
      .set({ settings: { financingRateAnnual: 0.08 }, updatedAt: new Date() })
      .where(eq(tenants.id, tenant.id));

    const order = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
      customerPaymentTermType: 'CREDIT',
      customerCreditDays: 15,
      supplierPaymentTermType: 'COD',
    });

    await saveOrderItems(order.id, [
      {
        productType: 'MGO',
        quantity: '220',
        unit: 'CBM',
        costUnit: 'MT',
        salesUnit: 'CBM',
        costPrice: '1175',
        costCurrency: 'USD',
        costConversionFactor: '0.85',
        salesPrice: '1195',
        salesCurrency: 'USD',
        unitConversionFactor: '1',
      },
    ]);

    const detail = await getOrderById(order.id);
    const listed = await listOrders({ statuses: ['INQUIRY'] });
    const listItem = listed.items[0];

    expect(listItem).toBeDefined();
    expect(detail).not.toBeNull();
    expect(listItem?.totalValue).toBeCloseTo(262900, 3);
    expect(listItem?.totalProfit).toBeCloseTo(43175, 3);
    expect(listItem?.totalFinancingCost).toBeCloseTo(Number(detail?.totalFinancingCost ?? 0), 3);
    expect(listItem?.totalNetProfit).toBeCloseTo(Number(detail?.totalNetProfit ?? 0), 3);
    expect(listItem?.netMarginPct).toBeCloseTo(Number(detail?.netMarginPct ?? 0), 3);
  });
});