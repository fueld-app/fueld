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

  // Supplier-invoice due-date override (Riviera Marine): some suppliers grant
  // credit from invoice receipt, not delivery. When the primary supplier leg
  // pins an exact due date, financing days derive from it and the order-level
  // mirror is kept in sync.
  it('derives supplier effective days from a due-date override on the primary leg', async () => {
    const { effectiveSupplierDays, getFinancingDays } = await import('../src/modules/orders/order-financing');

    // No override → null (caller falls back to credit days)
    expect(effectiveSupplierDays({ supplierDueDate: null, deliveredAt: '2026-09-01', supplierPaymentTermType: 'CREDIT' })).toBeNull();
    // Non-CREDIT terms never produce an override
    expect(effectiveSupplierDays({ supplierDueDate: '2026-10-01', deliveredAt: '2026-09-01', supplierPaymentTermType: 'COD' })).toBeNull();
    // Delivery 2026-09-01 → override 2026-10-01 = 30 days
    expect(effectiveSupplierDays({ supplierDueDate: '2026-10-01', deliveredAt: '2026-09-01', supplierPaymentTermType: 'CREDIT' })).toBe(30);
    // Falls back to eta when no delivery date
    expect(effectiveSupplierDays({ supplierDueDate: '2026-09-16', eta: '2026-09-01', supplierPaymentTermType: 'CREDIT' })).toBe(15);

    // Financing uses the effective days when present (40 customer − 60 supplier → clamped to 0)
    expect(getFinancingDays({
      customerPaymentTermType: 'CREDIT', customerCreditDays: 40,
      supplierPaymentTermType: 'CREDIT', supplierCreditDays: 30,
      supplierEffectiveDays: 60,
    })).toBe(0);
    // And shortens financing when the override pushes payment out beyond credit days
    expect(getFinancingDays({
      customerPaymentTermType: 'CREDIT', customerCreditDays: 40,
      supplierPaymentTermType: 'CREDIT', supplierCreditDays: 30,
      supplierEffectiveDays: 50,
    })).toBe(0);
    // Override earlier than delivery clamps at 0 supplier days
    expect(getFinancingDays({
      customerPaymentTermType: 'CREDIT', customerCreditDays: 40,
      supplierPaymentTermType: 'CREDIT', supplierCreditDays: 30,
      supplierEffectiveDays: -5,
    })).toBe(40);
  });

  it('persists a supplier due-date override and mirrors it to the order', async () => {
    const seeded = await seedBasics();
    const { createOrder, updateOrderSupplierRecord, getOrderById, getOrderSuppliers } = await loadOrdersService();

    const order2 = await createOrder({
      tenantId: seeded.tenant.id,
      clientId: seeded.client.id,
      vesselId: seeded.vessel.id,
      placeId: seeded.place.id,
      supplierId: seeded.client.id,
      supplierPaymentTermType: 'CREDIT',
      supplierCreditDays: 30,
    });

    // createOrder syncs the legacy order-level supplier into a primary leg
    const legs = await getOrderSuppliers(order2.id);
    const leg = legs[0];
    expect(leg).toBeDefined();
    const updated = await updateOrderSupplierRecord(order2.id, leg!.id, { supplierDueDate: '2026-10-15' });
    expect(updated?.supplierDueDate).toBe('2026-10-15');

    const detail = await getOrderById(order2.id);
    expect(detail?.supplierDueDate).toBe('2026-10-15');
    expect(detail?.orderSuppliers?.find((s: { id: string }) => s.id === leg!.id)?.supplierDueDate).toBe('2026-10-15');

    // Clearing works
    const cleared = await updateOrderSupplierRecord(order2.id, leg!.id, { supplierDueDate: null });
    expect(cleared?.supplierDueDate).toBeNull();

    // Invalid date strings are rejected (stored as null), not corrupted
    const invalid = await updateOrderSupplierRecord(order2.id, leg!.id, { supplierDueDate: '15/10/2026' });
    expect(invalid?.supplierDueDate).toBeNull();
  });
});