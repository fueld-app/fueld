import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { invoices, orderItems, orders, users } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';

async function loadDashboardService() {
  return import('../src/modules/dashboard/dashboard.service');
}

async function loadOrdersService() {
  return import('../src/modules/orders/orders.service');
}

function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

beforeEach(async () => {
  await truncateAll();
});

describe('dashboard.service', () => {
  it('returns overdue collections ordered by due date and respects date filters', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createOrder, saveOrderItems } = await loadOrdersService();
    const { getCollections } = await loadDashboardService();

    const olderOrder = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await saveOrderItems(olderOrder.id, [
      { productType: 'VLSFO', quantity: '100', unit: 'MT', salesPrice: '500', costPrice: '450' },
    ]);

    const newerOrder = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await saveOrderItems(newerOrder.id, [
      { productType: 'LSMGO', quantity: '50', unit: 'MT', salesPrice: '600', costPrice: '550' },
    ]);

    await db.insert(invoices).values([
      {
        orderId: olderOrder.id,
        invoiceNumber: 'INV-OLD-1',
        dueDate: isoDate(-12),
        amount: '50000.00',
        amountPaid: '10000.00',
        status: 'SENT',
      },
      {
        orderId: newerOrder.id,
        invoiceNumber: 'INV-OLD-2',
        dueDate: isoDate(-5),
        amount: '30000.00',
        amountPaid: '0.00',
        status: 'SENT',
      },
      {
        orderId: newerOrder.id,
        invoiceNumber: 'INV-PAID',
        dueDate: isoDate(-7),
        amount: '1000.00',
        amountPaid: '1000.00',
        status: 'PAID',
      },
      {
        orderId: newerOrder.id,
        invoiceNumber: 'INV-FUTURE',
        dueDate: isoDate(3),
        amount: '2000.00',
        amountPaid: '0.00',
        status: 'SENT',
      },
    ]);

    const all = await getCollections(tenant.id);
    expect(all.length).toBe(2);
    expect(all[0]?.invoiceNumber).toBe('INV-OLD-1');
    expect(all[1]?.invoiceNumber).toBe('INV-OLD-2');
    expect(all[0]?.clientName).toBe(client.name);
    expect(all[0]?.vesselName).toBe(vessel.name);
    expect(all[0]?.daysOverdue).toBeGreaterThan(all[1]!.daysOverdue);

    const filtered = await getCollections(tenant.id, isoDate(-6), isoDate(-1));
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.invoiceNumber).toBe('INV-OLD-2');
  });

  it('returns empty team stats when user cannot see any trader ids', async () => {
    const { tenant } = await seedBasics();
    const { getTeamStats } = await loadDashboardService();

    const stats = await getTeamStats(tenant.id, '00000000-0000-0000-0000-000000000000');
    expect(stats).toEqual([]);
  });

  it('returns team stats for admins across all visible traders and respects date filters', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createOrder, saveOrderItems } = await loadOrdersService();
    const { getTeamStats } = await loadDashboardService();

    await db.update(users).set({ role: 'ADMIN', updatedAt: new Date() }).where(eq(users.id, user.id));

    const [traderTwo] = await db.insert(users).values({
      tenantId: tenant.id,
      email: 'trader2@test.local',
      name: 'Trader Two',
      role: 'TRADER',
    }).returning();

    const oldOrder = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
      customerPaymentTermType: 'CREDIT',
      customerCreditDays: 15,
      supplierPaymentTermType: 'COD',
    });
    await db.update(orders).set({ createdAt: new Date('2026-03-01T10:00:00.000Z') }).where(eq(orders.id, oldOrder.id));
    await saveOrderItems(oldOrder.id, [
      {
        productType: 'VLSFO',
        quantity: '10',
        unit: 'MT',
        salesPrice: '100',
        costPrice: '80',
      },
    ]);

    const newOrder = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: traderTwo.id,
    });
    await db.update(orders).set({ createdAt: new Date('2026-03-05T10:00:00.000Z') }).where(eq(orders.id, newOrder.id));
    await saveOrderItems(newOrder.id, [
      {
        productType: 'LSMGO',
        quantity: '20',
        unit: 'MT',
        salesPrice: '110',
        costPrice: '90',
      },
    ]);

    const allStats = await getTeamStats(tenant.id, user.id);
    expect(allStats.length).toBe(2);
    const adminStat = allStats.find((item) => item.traderId === user.id);
    const traderTwoStat = allStats.find((item) => item.traderId === traderTwo.id);
    expect(adminStat?.orderCount).toBe(1);
    expect(Number(adminStat?.totalVolume)).toBe(10);
    expect(Number(adminStat?.totalRevenue)).toBe(1000);
    expect(Number(adminStat?.totalCost)).toBe(800);
    expect(Number(adminStat?.totalProfit)).toBe(200);
    expect(Number(adminStat?.totalFinancingCost)).toBeCloseTo(2.63, 2);
    expect(Number(adminStat?.totalNetProfit)).toBeCloseTo(197.37, 2);
    expect(traderTwoStat?.orderCount).toBe(1);
    expect(Number(traderTwoStat?.totalFinancingCost)).toBe(0);
    expect(Number(traderTwoStat?.totalNetProfit)).toBe(400);

    const filteredStats = await getTeamStats(tenant.id, user.id, '2026-03-04', '2026-03-06');
    expect(filteredStats.length).toBe(1);
    expect(filteredStats[0]?.traderId).toBe(traderTwo.id);
  });

  it('includes delegated on-leave traders for non-admin users', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createOrder, saveOrderItems } = await loadOrdersService();
    const { getTeamStats } = await loadDashboardService();

    const [delegator] = await db.insert(users).values({
      tenantId: tenant.id,
      email: 'delegate-from@test.local',
      name: 'On Leave Trader',
      role: 'TRADER',
      delegateId: user.id,
      isOnLeave: true,
    }).returning();

    const ownOrder = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await saveOrderItems(ownOrder.id, [
      { productType: 'VLSFO', quantity: '5', unit: 'MT', salesPrice: '200', costPrice: '190' },
    ]);

    const delegatedOrder = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: delegator.id,
    });
    await saveOrderItems(delegatedOrder.id, [
      { productType: 'LSMGO', quantity: '7', unit: 'MT', salesPrice: '300', costPrice: '250' },
    ]);

    const stats = await getTeamStats(tenant.id, user.id);
    expect(stats.length).toBe(2);
    const visibleIds = stats.map((item) => item.traderId).sort();
    expect(visibleIds).toEqual([delegator.id, user.id].sort());
  });

  it('summarizes pipeline by order status and total value', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder } = await loadOrdersService();
    const { getPipelineSummary } = await loadDashboardService();
    const db = await getDb();

    const inquiryOrder = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await db.insert(orderItems).values([
      { orderId: inquiryOrder.id, productType: 'VLSFO', quantity: '10', unit: 'MT', salesPrice: '100', costPrice: '80', profit: '200.0000' },
      { orderId: inquiryOrder.id, productType: 'LSMGO', quantity: '5', unit: 'MT', salesPrice: '120', costPrice: '100', profit: '100.0000' },
    ]);

    const confirmedOrder = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await db.update(orders).set({ status: 'CONFIRMED', updatedAt: new Date() }).where(eq(orders.id, confirmedOrder.id));
    await db.insert(orderItems).values([
      { orderId: confirmedOrder.id, productType: 'VLSFO', quantity: '2', unit: 'MT', salesPrice: '500', costPrice: '450', profit: '100.0000' },
    ]);

    const pipeline = await getPipelineSummary(tenant.id);
    const inquiry = pipeline.find((item) => item.status === 'INQUIRY');
    const confirmed = pipeline.find((item) => item.status === 'CONFIRMED');

    expect(inquiry?.count).toBe(1);
    expect(Number(inquiry?.totalValue)).toBe(1600);
    expect(confirmed?.count).toBe(1);
    expect(Number(confirmed?.totalValue)).toBe(1000);
  });
});