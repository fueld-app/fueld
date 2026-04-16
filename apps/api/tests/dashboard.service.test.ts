import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { entityComments, invoices, orderItems, orders, users } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';

async function loadDashboardService() {
  return import('../src/modules/dashboard/dashboard.service');
}

async function loadOrdersService() {
  return import('../src/modules/orders/orders.service');
}

async function loadCommentsService() {
  return import('../src/modules/comments/comments.service');
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
  // ─── Collections ─────────────────────────────────────────────────

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

  // ─── Team Stats ──────────────────────────────────────────────────

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
    await db.update(orders).set({ status: 'CONFIRMED', createdAt: new Date('2026-03-01T10:00:00.000Z'), updatedAt: new Date() }).where(eq(orders.id, oldOrder.id));
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
    await db.update(orders).set({ status: 'CONFIRMED', createdAt: new Date('2026-03-05T10:00:00.000Z'), updatedAt: new Date() }).where(eq(orders.id, newOrder.id));
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

  it('returns team stats for credit managers across all visible traders', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createOrder, saveOrderItems } = await loadOrdersService();
    const { getTeamStats } = await loadDashboardService();

    await db.update(users).set({ role: 'CREDITMANAGER', updatedAt: new Date() }).where(eq(users.id, user.id));

    const [traderTwo] = await db.insert(users).values({
      tenantId: tenant.id,
      email: 'trader.two@test.local',
      name: 'Trader Two',
      role: 'TRADER',
    }).returning();

    const ownOrder = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await db.update(orders).set({ status: 'CONFIRMED', updatedAt: new Date() }).where(eq(orders.id, ownOrder.id));
    await saveOrderItems(ownOrder.id, [
      { productType: 'VLSFO', quantity: '10', unit: 'MT', salesPrice: '100', costPrice: '80' },
    ]);

    const otherOrder = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: traderTwo.id,
    });
    await db.update(orders).set({ status: 'CONFIRMED', updatedAt: new Date() }).where(eq(orders.id, otherOrder.id));
    await saveOrderItems(otherOrder.id, [
      { productType: 'LSMGO', quantity: '20', unit: 'MT', salesPrice: '110', costPrice: '90' },
    ]);

    const stats = await getTeamStats(tenant.id, user.id);

    expect(stats.length).toBe(2);
    expect(stats.some((item) => item.traderId === user.id)).toBe(true);
    expect(stats.some((item) => item.traderId === traderTwo.id)).toBe(true);
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
    await db.update(orders).set({ status: 'CONFIRMED', updatedAt: new Date() }).where(eq(orders.id, ownOrder.id));
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
    await db.update(orders).set({ status: 'CONFIRMED', updatedAt: new Date() }).where(eq(orders.id, delegatedOrder.id));
    await saveOrderItems(delegatedOrder.id, [
      { productType: 'LSMGO', quantity: '7', unit: 'MT', salesPrice: '300', costPrice: '250' },
    ]);

    const stats = await getTeamStats(tenant.id, user.id);
    expect(stats.length).toBe(2);
    const visibleIds = stats.map((item) => item.traderId).sort();
    expect(visibleIds).toEqual([delegator.id, user.id].sort());
  });

  // ─── Pipeline Summary ────────────────────────────────────────────

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
      { orderId: inquiryOrder.id, productType: 'VLSFO', quantity: '10', unit: 'MT', salesPrice: '100', costPrice: '80', profit: '200.0000', costPricingModel: 'FIXED', salesPricingModel: 'FIXED', costPriceFinalized: false, salesPriceFinalized: false },
      { orderId: inquiryOrder.id, productType: 'LSMGO', quantity: '5', unit: 'MT', salesPrice: '120', costPrice: '100', profit: '100.0000', costPricingModel: 'FIXED', salesPricingModel: 'FIXED', costPriceFinalized: false, salesPriceFinalized: false },
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
      { orderId: confirmedOrder.id, productType: 'VLSFO', quantity: '2', unit: 'MT', salesPrice: '500', costPrice: '450', profit: '100.0000', costPricingModel: 'FIXED', salesPricingModel: 'FIXED', costPriceFinalized: false, salesPriceFinalized: false },
    ]);

    const pipeline = await getPipelineSummary(tenant.id);
    const inquiry = pipeline.find((item) => item.status === 'INQUIRY');
    const confirmed = pipeline.find((item) => item.status === 'CONFIRMED');

    expect(inquiry?.count).toBe(1);
    expect(Number(inquiry?.totalValue)).toBe(1600);
    expect(confirmed?.count).toBe(1);
    expect(Number(confirmed?.totalValue)).toBe(1000);
  });

  it('filters pipeline by date range', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder } = await loadOrdersService();
    const { getPipelineSummary } = await loadDashboardService();
    const db = await getDb();

    const oldOrder = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await db.update(orders).set({ createdAt: new Date('2026-01-15T10:00:00.000Z') }).where(eq(orders.id, oldOrder.id));
    await db.insert(orderItems).values([
      { orderId: oldOrder.id, productType: 'VLSFO', quantity: '10', unit: 'MT', salesPrice: '100', costPrice: '80', profit: '200.0000', costPricingModel: 'FIXED', salesPricingModel: 'FIXED', costPriceFinalized: false, salesPriceFinalized: false },
    ]);

    const newOrder = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await db.update(orders).set({ createdAt: new Date('2026-03-10T10:00:00.000Z') }).where(eq(orders.id, newOrder.id));
    await db.insert(orderItems).values([
      { orderId: newOrder.id, productType: 'LSMGO', quantity: '5', unit: 'MT', salesPrice: '200', costPrice: '150', profit: '250.0000', costPricingModel: 'FIXED', salesPricingModel: 'FIXED', costPriceFinalized: false, salesPriceFinalized: false },
    ]);

    // Without filter — both orders
    const allPipeline = await getPipelineSummary(tenant.id);
    const allInquiry = allPipeline.find((s) => s.status === 'INQUIRY');
    expect(allInquiry?.count).toBe(2);

    // With date filter — only March order
    const filtered = await getPipelineSummary(tenant.id, '2026-03-01', '2026-03-31');
    const marchInquiry = filtered.find((s) => s.status === 'INQUIRY');
    expect(marchInquiry?.count).toBe(1);
    expect(Number(marchInquiry?.totalValue)).toBe(1000);
  });

  // ─── Loss Analysis ───────────────────────────────────────────────

  it('aggregates cancel reasons with counts and percentages', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder } = await loadOrdersService();
    const { getLossAnalysis } = await loadDashboardService();
    const db = await getDb();

    // Create 3 cancelled orders with different reasons
    for (const reason of ['Price not competitive', 'Price not competitive', 'Customer cancelled request']) {
      const order = await createOrder({
        tenantId: tenant.id,
        clientId: client.id,
        vesselId: vessel.id,
        placeId: place.id,
        salesRepId: user.id,
      });
      await db.update(orders).set({
        status: 'CANCELLED',
        lossReason: reason,
        closedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(orders.id, order.id));
    }

    // Create a non-cancelled order — should not appear
    await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    const result = await getLossAnalysis(tenant.id);
    expect(result.totalCancelled).toBe(3);
    expect(result.reasons.length).toBe(2);

    const priceReason = result.reasons.find((r) => r.reason === 'Price not competitive');
    expect(priceReason?.count).toBe(2);
    expect(priceReason?.percentage).toBeCloseTo(2 / 3, 4);

    const cancelReason = result.reasons.find((r) => r.reason === 'Customer cancelled request');
    expect(cancelReason?.count).toBe(1);
    expect(cancelReason?.percentage).toBeCloseTo(1 / 3, 4);
  });

  it('filters loss analysis by date range', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder } = await loadOrdersService();
    const { getLossAnalysis } = await loadDashboardService();
    const db = await getDb();

    const oldOrder = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await db.update(orders).set({
      status: 'CANCELLED',
      lossReason: 'Old reason',
      closedAt: new Date('2026-01-10T12:00:00Z'),
      createdAt: new Date('2026-01-10T12:00:00Z'),
      updatedAt: new Date(),
    }).where(eq(orders.id, oldOrder.id));

    const recentOrder = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await db.update(orders).set({
      status: 'CANCELLED',
      lossReason: 'Recent reason',
      closedAt: new Date('2026-03-10T12:00:00Z'),
      createdAt: new Date('2026-03-10T12:00:00Z'),
      updatedAt: new Date(),
    }).where(eq(orders.id, recentOrder.id));

    const all = await getLossAnalysis(tenant.id);
    expect(all.totalCancelled).toBe(2);

    const filtered = await getLossAnalysis(tenant.id, '2026-03-01', '2026-03-31');
    expect(filtered.totalCancelled).toBe(1);
    expect(filtered.reasons[0]?.reason).toBe('Recent reason');
  });

  it('returns empty loss analysis when no cancellations exist', async () => {
    const { tenant } = await seedBasics();
    const { getLossAnalysis } = await loadDashboardService();

    const result = await getLossAnalysis(tenant.id);
    expect(result.totalCancelled).toBe(0);
    expect(result.reasons).toEqual([]);
  });

  // ─── Conversion Metrics ──────────────────────────────────────────

  it('calculates win rate and average days to close', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder } = await loadOrdersService();
    const { getConversionMetrics } = await loadDashboardService();
    const db = await getDb();

    // Won order (CONFIRMED) with closedAt
    const wonOrder = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await db.update(orders).set({
      status: 'CONFIRMED',
      createdAt: new Date('2026-03-01T10:00:00Z'),
      closedAt: new Date('2026-03-04T10:00:00Z'),
      updatedAt: new Date(),
    }).where(eq(orders.id, wonOrder.id));

    // Another won order (PAID)
    const paidOrder = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await db.update(orders).set({
      status: 'PAID',
      createdAt: new Date('2026-03-02T10:00:00Z'),
      closedAt: new Date('2026-03-06T10:00:00Z'),
      updatedAt: new Date(),
    }).where(eq(orders.id, paidOrder.id));

    // Lost order
    const lostOrder = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await db.update(orders).set({
      status: 'CANCELLED',
      lossReason: 'Price not competitive',
      createdAt: new Date('2026-03-03T10:00:00Z'),
      closedAt: new Date('2026-03-03T14:00:00Z'),
      updatedAt: new Date(),
    }).where(eq(orders.id, lostOrder.id));

    // Open inquiry (neither won nor lost)
    const openInquiry = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await db.update(orders).set({
      createdAt: new Date('2026-03-05T10:00:00Z'),
      updatedAt: new Date(),
    }).where(eq(orders.id, openInquiry.id));

    const metrics = await getConversionMetrics(tenant.id, '2026-03-01', '2026-03-31');
    expect(metrics.totalInquiries).toBe(4);
    expect(metrics.totalWon).toBe(2);
    expect(metrics.totalLost).toBe(1);
    expect(metrics.winRate).toBeCloseTo(2 / 3, 4);
    // Won orders: 3 days + 4 days = 7, avg = 3.5
    expect(metrics.avgDaysToClose).toBe(3.5);
  });

  it('returns zero win rate when no decided orders exist', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder } = await loadOrdersService();
    const { getConversionMetrics } = await loadDashboardService();

    // Only open inquiries
    await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    const metrics = await getConversionMetrics(tenant.id);
    expect(metrics.totalInquiries).toBe(1);
    expect(metrics.totalWon).toBe(0);
    expect(metrics.totalLost).toBe(0);
    expect(metrics.winRate).toBe(0);
    expect(metrics.avgDaysToClose).toBeNull();
  });

  it('filters conversion metrics by date range', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder } = await loadOrdersService();
    const { getConversionMetrics } = await loadDashboardService();
    const db = await getDb();

    // Old won order outside the filter range
    const oldWon = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await db.update(orders).set({
      status: 'CONFIRMED',
      createdAt: new Date('2026-01-05T10:00:00Z'),
      closedAt: new Date('2026-01-08T10:00:00Z'),
      updatedAt: new Date(),
    }).where(eq(orders.id, oldWon.id));

    // Recent lost order inside the filter range
    const recentLost = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await db.update(orders).set({
      status: 'CANCELLED',
      lossReason: 'No supplier availability',
      createdAt: new Date('2026-03-10T10:00:00Z'),
      closedAt: new Date('2026-03-10T12:00:00Z'),
      updatedAt: new Date(),
    }).where(eq(orders.id, recentLost.id));

    const metrics = await getConversionMetrics(tenant.id, '2026-03-01', '2026-03-31');
    expect(metrics.totalInquiries).toBe(1);
    expect(metrics.totalWon).toBe(0);
    expect(metrics.totalLost).toBe(1);
    expect(metrics.winRate).toBe(0);
  });

  // ─── Dashboard KPI Consistency ───────────────────────────────────
  // These tests verify that the numbers shown on the dashboard (as in
  // the screenshot) are internally consistent and computed correctly.

  describe('KPI card consistency', () => {
    it('Total Revenue YTD equals sum of all trader revenues', async () => {
      const { tenant, client, vessel, place, user } = await seedBasics();
      const db = await getDb();
      const { createOrder, saveOrderItems } = await loadOrdersService();
      const { getTeamStats } = await loadDashboardService();

      await db.update(users).set({ role: 'ADMIN', updatedAt: new Date() }).where(eq(users.id, user.id));

      const [trader2] = await db.insert(users).values({
        tenantId: tenant.id,
        email: 'trader-b@test.local',
        name: 'Trader B',
        role: 'TRADER',
      }).returning();

      // Trader 1 (admin) - two confirmed orders
      const o1 = await createOrder({ tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id });
      await db.update(orders).set({ status: 'CONFIRMED', updatedAt: new Date() }).where(eq(orders.id, o1.id));
      await saveOrderItems(o1.id, [
        { productType: 'VLSFO', quantity: '500', unit: 'MT', salesPrice: '650', costPrice: '620' },
      ]);
      const o2 = await createOrder({ tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id });
      await db.update(orders).set({ status: 'DELIVERED', updatedAt: new Date() }).where(eq(orders.id, o2.id));
      await saveOrderItems(o2.id, [
        { productType: 'LSMGO', quantity: '200', unit: 'MT', salesPrice: '700', costPrice: '670' },
      ]);

      // Trader 2 - one confirmed order
      const o3 = await createOrder({ tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: trader2.id });
      await db.update(orders).set({ status: 'INVOICED', updatedAt: new Date() }).where(eq(orders.id, o3.id));
      await saveOrderItems(o3.id, [
        { productType: 'VLSFO', quantity: '300', unit: 'MT', salesPrice: '640', costPrice: '610' },
      ]);

      const stats = await getTeamStats(tenant.id, user.id);
      const totalRevenue = stats.reduce((sum, s) => sum + Number(s.totalRevenue), 0);
      const totalOrders = stats.reduce((sum, s) => sum + s.orderCount, 0);
      const avgDealSize = totalRevenue / totalOrders;

      // Expected: 500*650 + 200*700 + 300*640 = 325000 + 140000 + 192000 = 657000
      expect(totalRevenue).toBe(657_000);
      expect(totalOrders).toBe(3);
      expect(avgDealSize).toBeCloseTo(219_000, 0);
    });

    it('Gross Profit YTD equals revenue minus cost', async () => {
      const { tenant, client, vessel, place, user } = await seedBasics();
      const db = await getDb();
      const { createOrder, saveOrderItems } = await loadOrdersService();
      const { getTeamStats } = await loadDashboardService();

      const order = await createOrder({
        tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id,
      });
      await db.update(orders).set({ status: 'CONFIRMED', updatedAt: new Date() }).where(eq(orders.id, order.id));
      await saveOrderItems(order.id, [
        { productType: 'VLSFO', quantity: '100', unit: 'MT', salesPrice: '500', costPrice: '450' },
        { productType: 'LSMGO', quantity: '50', unit: 'MT', salesPrice: '600', costPrice: '550' },
      ]);

      const stats = await getTeamStats(tenant.id, user.id);
      expect(stats.length).toBe(1);

      const rev = Number(stats[0]!.totalRevenue);
      const cost = Number(stats[0]!.totalCost);
      const gross = Number(stats[0]!.totalProfit);

      // revenue = 100*500 + 50*600 = 50000 + 30000 = 80000
      // cost    = 100*450 + 50*550 = 45000 + 27500 = 72500
      // gross   = 80000 - 72500 = 7500
      expect(rev).toBe(80_000);
      expect(cost).toBe(72_500);
      expect(gross).toBe(7_500);
      expect(gross).toBe(rev - cost);
    });

    it('Net Profit YTD equals Gross Profit minus financing cost', async () => {
      const { tenant, client, vessel, place, user } = await seedBasics();
      const db = await getDb();
      const { createOrder, saveOrderItems } = await loadOrdersService();
      const { getTeamStats } = await loadDashboardService();

      const order = await createOrder({
        tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id,
        customerPaymentTermType: 'CREDIT',
        customerCreditDays: 30,
        supplierPaymentTermType: 'CREDIT',
        supplierCreditDays: 10,
      });
      await db.update(orders).set({ status: 'CONFIRMED', updatedAt: new Date() }).where(eq(orders.id, order.id));
      await saveOrderItems(order.id, [
        { productType: 'VLSFO', quantity: '100', unit: 'MT', salesPrice: '500', costPrice: '450' },
      ]);

      const stats = await getTeamStats(tenant.id, user.id);
      const s = stats[0]!;
      const gross = Number(s.totalProfit);
      const financing = Number(s.totalFinancingCost);
      const net = Number(s.totalNetProfit);

      // financing = costBase * rate * days / 365 = 45000 * 0.08 * 20 / 365 ≈ 197.26
      expect(financing).toBeCloseTo(45_000 * 0.08 * 20 / 365, 2);
      expect(net).toBeCloseTo(gross - financing, 2);
    });

    it('applies density conversion factors in dashboard gross and net profit totals', async () => {
      const { tenant, client, vessel, place, user } = await seedBasics();
      const db = await getDb();
      const { createOrder, saveOrderItems } = await loadOrdersService();
      const { getTeamStats } = await loadDashboardService();

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
      await db.update(orders).set({ status: 'CONFIRMED', updatedAt: new Date() }).where(eq(orders.id, order.id));
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

      const stats = await getTeamStats(tenant.id, user.id);
      const s = stats[0]!;

      expect(Number(s.totalRevenue)).toBeCloseTo(262900, 2);
      expect(Number(s.totalCost)).toBeCloseTo(219725, 2);
      expect(Number(s.totalProfit)).toBeCloseTo(43175, 2);
      expect(Number(s.totalFinancingCost)).toBeCloseTo(722.3836, 2);
      expect(Number(s.totalNetProfit)).toBeCloseTo(42452.6164, 2);
    });

    it('revenue excludes INQUIRY and CANCELLED orders', async () => {
      const { tenant, client, vessel, place, user } = await seedBasics();
      const db = await getDb();
      const { createOrder, saveOrderItems } = await loadOrdersService();
      const { getTeamStats } = await loadDashboardService();

      const inquiry = await createOrder({
        tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id,
      });
      await saveOrderItems(inquiry.id, [
        { productType: 'VLSFO', quantity: '100', unit: 'MT', salesPrice: '500', costPrice: '450' },
      ]);
      // Default status is INQUIRY — should NOT count

      const confirmed = await createOrder({
        tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id,
      });
      await db.update(orders).set({ status: 'CONFIRMED', updatedAt: new Date() }).where(eq(orders.id, confirmed.id));
      await saveOrderItems(confirmed.id, [
        { productType: 'LSMGO', quantity: '200', unit: 'MT', salesPrice: '600', costPrice: '550' },
      ]);

      const cancelled = await createOrder({
        tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id,
      });
      await db.update(orders).set({ status: 'CANCELLED', lossReason: 'Price not competitive', updatedAt: new Date() }).where(eq(orders.id, cancelled.id));
      await saveOrderItems(cancelled.id, [
        { productType: 'VLSFO', quantity: '300', unit: 'MT', salesPrice: '650', costPrice: '620' },
      ]);

      const stats = await getTeamStats(tenant.id, user.id);
      const totalRevenue = Number(stats[0]!.totalRevenue);
      const orderCount = stats[0]!.orderCount;

      // Only the CONFIRMED order contributes to revenue:
      // 200*600 = 120000
      expect(orderCount).toBe(1);
      expect(totalRevenue).toBe(120_000);
    });

    it('pipeline total value uses raw salesPrice*quantity without FX', async () => {
      // This test documents the pipeline calculation approach: raw SQL
      // multiplication of salesPrice × quantity, without FX conversion.
      const { tenant, client, vessel, place, user } = await seedBasics();
      const db = await getDb();
      const { createOrder } = await loadOrdersService();
      const { getPipelineSummary } = await loadDashboardService();

      const order = await createOrder({
        tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id,
      });
      await db.insert(orderItems).values([
        { orderId: order.id, productType: 'VLSFO', quantity: '100', unit: 'MT', salesPrice: '500', costPrice: '450', profit: '5000.0000', costPricingModel: 'FIXED', salesPricingModel: 'FIXED', costPriceFinalized: false, salesPriceFinalized: false },
        { orderId: order.id, productType: 'LSMGO', quantity: '50', unit: 'MT', salesPrice: '600', costPrice: '550', profit: '2500.0000', costPricingModel: 'FIXED', salesPricingModel: 'FIXED', costPriceFinalized: false, salesPriceFinalized: false },
      ]);

      const pipeline = await getPipelineSummary(tenant.id);
      const inquiry = pipeline.find((s) => s.status === 'INQUIRY');

      // Pipeline: raw SQL sum(salesPrice * quantity) = 100*500 + 50*600 = 80000
      expect(Number(inquiry?.totalValue)).toBe(80_000);
    });

    it('pipeline total across statuses equals Sum(salesPrice*qty) for all orders', async () => {
      const { tenant, client, vessel, place, user } = await seedBasics();
      const db = await getDb();
      const { createOrder } = await loadOrdersService();
      const { getPipelineSummary } = await loadDashboardService();

      // Inquiry order
      const o1 = await createOrder({ tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id });
      await db.insert(orderItems).values([
        { orderId: o1.id, productType: 'VLSFO', quantity: '100', unit: 'MT', salesPrice: '500', costPrice: '450', profit: '5000.0000', costPricingModel: 'FIXED', salesPricingModel: 'FIXED', costPriceFinalized: false, salesPriceFinalized: false },
      ]);

      // Confirmed order
      const o2 = await createOrder({ tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id });
      await db.update(orders).set({ status: 'CONFIRMED', updatedAt: new Date() }).where(eq(orders.id, o2.id));
      await db.insert(orderItems).values([
        { orderId: o2.id, productType: 'LSMGO', quantity: '50', unit: 'MT', salesPrice: '600', costPrice: '550', profit: '2500.0000', costPricingModel: 'FIXED', salesPricingModel: 'FIXED', costPriceFinalized: false, salesPriceFinalized: false },
      ]);

      // Cancelled order
      const o3 = await createOrder({ tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id });
      await db.update(orders).set({ status: 'CANCELLED', lossReason: 'Test', updatedAt: new Date() }).where(eq(orders.id, o3.id));
      await db.insert(orderItems).values([
        { orderId: o3.id, productType: 'VLSFO', quantity: '200', unit: 'MT', salesPrice: '650', costPrice: '620', profit: '6000.0000', costPricingModel: 'FIXED', salesPricingModel: 'FIXED', costPriceFinalized: false, salesPriceFinalized: false },
      ]);

      const pipeline = await getPipelineSummary(tenant.id);
      const totalPipelineValue = pipeline.reduce((sum, s) => sum + Number(s.totalValue), 0);

      // 100*500 + 50*600 + 200*650 = 50000 + 30000 + 130000 = 210000
      expect(totalPipelineValue).toBe(210_000);
    });

    it('orders without items contribute 0 to revenue but 1 to count', async () => {
      const { tenant, client, vessel, place, user } = await seedBasics();
      const db = await getDb();
      const { createOrder, saveOrderItems } = await loadOrdersService();
      const { getTeamStats } = await loadDashboardService();

      // Order WITH items (CONFIRMED)
      const o1 = await createOrder({
        tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id,
      });
      await db.update(orders).set({ status: 'CONFIRMED', updatedAt: new Date() }).where(eq(orders.id, o1.id));
      await saveOrderItems(o1.id, [
        { productType: 'VLSFO', quantity: '100', unit: 'MT', salesPrice: '500', costPrice: '450' },
      ]);

      // Order WITHOUT items (CONFIRMED)
      const o2 = await createOrder({
        tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id,
      });
      await db.update(orders).set({ status: 'CONFIRMED', updatedAt: new Date() }).where(eq(orders.id, o2.id));

      const stats = await getTeamStats(tenant.id, user.id);
      expect(stats.length).toBe(1);
      expect(stats[0]!.orderCount).toBe(2);
      expect(Number(stats[0]!.totalRevenue)).toBe(50_000);
    });

    it('win rate uses only decided orders (won + lost), not total', async () => {
      const { tenant, client, vessel, place, user } = await seedBasics();
      const db = await getDb();
      const { createOrder } = await loadOrdersService();
      const { getConversionMetrics } = await loadDashboardService();

      // 1 won, 3 cancelled, 6 inquiries = 10 total
      const won = await createOrder({ tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id });
      await db.update(orders).set({ status: 'CONFIRMED', closedAt: new Date(), updatedAt: new Date() }).where(eq(orders.id, won.id));

      for (let i = 0; i < 3; i++) {
        const lost = await createOrder({ tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id });
        await db.update(orders).set({ status: 'CANCELLED', lossReason: 'Test', closedAt: new Date(), updatedAt: new Date() }).where(eq(orders.id, lost.id));
      }

      for (let i = 0; i < 6; i++) {
        await createOrder({ tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id });
      }

      const metrics = await getConversionMetrics(tenant.id);
      expect(metrics.totalInquiries).toBe(10);
      expect(metrics.totalWon).toBe(1);
      expect(metrics.totalLost).toBe(3);
      // Win Rate = won / (won + lost) = 1/4 = 25%
      expect(metrics.winRate).toBeCloseTo(0.25, 4);
    });

    it('all KPI numbers are consistent in a complete dashboard scenario', async () => {
      // Simulates the full dashboard: multiple traders, mixed statuses,
      // overdue invoices, and conversion metrics — verifies everything ties out.
      const { tenant, client, vessel, place, user } = await seedBasics();
      const db = await getDb();
      const { createOrder, saveOrderItems } = await loadOrdersService();
      const { getTeamStats, getCollections, getPipelineSummary, getLossAnalysis, getConversionMetrics } = await loadDashboardService();

      await db.update(users).set({ role: 'ADMIN', updatedAt: new Date() }).where(eq(users.id, user.id));

      const [trader2] = await db.insert(users).values({
        tenantId: tenant.id,
        email: 'trader-c@test.local',
        name: 'Trader C',
        role: 'TRADER',
      }).returning();

      // --- Create orders across various statuses ---

      // 2 inquiry orders (user)
      for (let i = 0; i < 2; i++) {
        const o = await createOrder({ tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id });
        await saveOrderItems(o.id, [
          { productType: 'VLSFO', quantity: '100', unit: 'MT', salesPrice: '500', costPrice: '450' },
        ]);
      }

      // 1 confirmed order (trader2)
      const confirmed = await createOrder({ tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: trader2.id });
      await db.update(orders).set({ status: 'CONFIRMED', closedAt: new Date('2026-03-05'), createdAt: new Date('2026-03-01'), updatedAt: new Date() }).where(eq(orders.id, confirmed.id));
      await saveOrderItems(confirmed.id, [
        { productType: 'LSMGO', quantity: '200', unit: 'MT', salesPrice: '600', costPrice: '550' },
      ]);

      // 1 cancelled order (user)
      const cancelled = await createOrder({ tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id, salesRepId: user.id });
      await db.update(orders).set({ status: 'CANCELLED', lossReason: 'Price not competitive', closedAt: new Date(), updatedAt: new Date() }).where(eq(orders.id, cancelled.id));
      await saveOrderItems(cancelled.id, [
        { productType: 'VLSFO', quantity: '150', unit: 'MT', salesPrice: '650', costPrice: '620' },
      ]);

      // --- Team Stats (revenue, profit) ---
      const stats = await getTeamStats(tenant.id, user.id);
      const totalOrders = stats.reduce((s, t) => s + t.orderCount, 0);
      const totalRevenue = stats.reduce((s, t) => s + Number(t.totalRevenue), 0);
      const totalGross = stats.reduce((s, t) => s + Number(t.totalProfit), 0);

      expect(totalOrders).toBe(1); // only the 1 confirmed order counts
      // revenue: 200*600 = 120000 (inquiry & cancelled excluded)
      expect(totalRevenue).toBe(120_000);
      // cost: 200*550 = 110000
      // gross = 120000 - 110000 = 10000
      expect(totalGross).toBe(10_000);

      // --- Conversion Metrics ---
      const conv = await getConversionMetrics(tenant.id);
      expect(conv.totalInquiries).toBe(4);
      expect(conv.totalWon).toBe(1);
      expect(conv.totalLost).toBe(1);
      expect(conv.winRate).toBeCloseTo(0.5, 4);

      // --- Loss Analysis ---
      const loss = await getLossAnalysis(tenant.id);
      expect(loss.totalCancelled).toBe(1);
      expect(loss.reasons[0]?.reason).toBe('Price not competitive');

      // --- Collections (no overdue invoices created) ---
      const collections = await getCollections(tenant.id);
      expect(collections.length).toBe(0);
    });

    it('returns overdue, today, and upcoming follow-ups ordered by date', async () => {
      const { tenant, client, vessel, place, user } = await seedBasics();
      const db = await getDb();
      const { createOrder } = await loadOrdersService();
      const { createComment } = await loadCommentsService();
      const { getFollowUps } = await loadDashboardService();

      const order = await createOrder({
        tenantId: tenant.id,
        clientId: client.id,
        vesselId: vessel.id,
        placeId: place.id,
        salesRepId: user.id,
      });

      await createComment({
        entityType: 'company',
        entityId: client.id,
        userId: user.id,
        userName: user.name,
        content: 'Overdue company follow-up',
        followUpDate: isoDate(-2),
      });

      await createComment({
        entityType: 'order',
        entityId: order.id,
        userId: user.id,
        userName: user.name,
        content: 'Due today order follow-up',
        followUpDate: isoDate(0),
      });

      await createComment({
        entityType: 'vessel',
        entityId: vessel.id,
        userId: user.id,
        userName: user.name,
        content: 'Upcoming vessel follow-up',
        followUpDate: isoDate(4),
      });

      const completed = await createComment({
        entityType: 'place',
        entityId: place.id,
        userId: user.id,
        userName: user.name,
        content: 'Completed follow-up',
        followUpDate: isoDate(1),
      });
      await db
        .update(entityComments)
        .set({ followUpCompleted: true, updatedAt: new Date() })
        .where(eq(entityComments.id, completed.id));

      await createComment({
        entityType: 'company',
        entityId: client.id,
        userId: user.id,
        userName: user.name,
        content: 'No follow-up date',
      });

      const items = await getFollowUps(tenant.id);

      expect(items.map((item) => item.content)).toEqual([
        'Overdue company follow-up',
        'Due today order follow-up',
        'Upcoming vessel follow-up',
      ]);
      expect(items[0]?.entityName).toBe(client.name);
      expect(items[1]?.entityName).toBe(order.orderNumber ?? order.id);
      expect(items[2]?.entityName).toBe(vessel.name);
    });

    it('filters follow-ups by user id when provided', async () => {
      const { tenant, client, user } = await seedBasics();
      const db = await getDb();
      const { createComment } = await loadCommentsService();
      const { getFollowUps } = await loadDashboardService();

      const [otherUser] = await db.insert(users).values({
        tenantId: tenant.id,
        email: 'followups-other@test.local',
        name: 'Other User',
        role: 'TRADER',
      }).returning();

      await createComment({
        entityType: 'company',
        entityId: client.id,
        userId: user.id,
        userName: user.name,
        content: 'Mine',
        followUpDate: isoDate(2),
      });

      await createComment({
        entityType: 'company',
        entityId: client.id,
        userId: otherUser.id,
        userName: otherUser.name,
        content: 'Theirs',
        followUpDate: isoDate(1),
      });

      const items = await getFollowUps(tenant.id, user.id);

      expect(items).toHaveLength(1);
      expect(items[0]?.content).toBe('Mine');
      expect(items[0]?.userId).toBe(user.id);
    });
  });
});