import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { orders, teams, userTeams, users } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';

async function loadReportsService() {
  return import('../src/modules/reports/reports.service');
}

async function loadOrdersService() {
  return import('../src/modules/orders/orders.service');
}

beforeEach(async () => {
  await truncateAll();
});

describe('reports team attribution', () => {
  it('orders by a multi-team user appear when filtering by any of their teams', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();

    // Create two teams
    const [teamA] = await db.insert(teams).values({ tenantId: tenant.id, name: 'Team A' }).returning();
    const [teamB] = await db.insert(teams).values({ tenantId: tenant.id, name: 'Team B' }).returning();
    expect(teamA?.id).toBeTruthy();
    expect(teamB?.id).toBeTruthy();

    // Assign user to BOTH teams via user_teams
    await db.insert(userTeams).values([
      { userId: user.id, teamId: teamA!.id },
      { userId: user.id, teamId: teamB!.id },
    ]);

    // Set primaryTeamId to teamA (so we can verify the bug is fixed — orders should
    // appear under teamB too, even though primaryTeamId is teamA)
    await db.update(users).set({ primaryTeamId: teamA!.id }).where(eq(users.id, user.id));

    // Create an order for this user
    const { createOrder, saveOrderItems } = await loadOrdersService();
    const order = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await saveOrderItems(order.id, [
      { productType: 'VLSFO', quantity: '100', unit: 'MT', salesPrice: '500', costPrice: '450' },
    ]);

    // Set order to CONFIRMED so it's included in trader performance economics
    await db.update(orders).set({ status: 'CONFIRMED' }).where(eq(orders.id, order.id));

    // Make the user an admin so they get 'ALL' scope (no userIds restriction)
    await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, user.id));

    const { getReleaseTwoReports } = await loadReportsService();

    // Filter by Team A — should include the order (user is in Team A)
    const reportA = await getReleaseTwoReports(tenant.id, user.id, {
      teamId: teamA!.id,
    });
    expect(reportA.traderPerformance.rows.length).toBeGreaterThan(0);
    const traderRowA = reportA.traderPerformance.rows.find((r) => r.traderId === user.id);
    expect(traderRowA).toBeTruthy();
    expect(traderRowA!.orderCount).toBeGreaterThanOrEqual(1);

    // Filter by Team B — should ALSO include the order, even though primaryTeamId is Team A
    // This is the key assertion: before the fix, this would return 0 rows
    const reportB = await getReleaseTwoReports(tenant.id, user.id, {
      teamId: teamB!.id,
    });
    expect(reportB.traderPerformance.rows.length).toBeGreaterThan(0);
    const traderRowB = reportB.traderPerformance.rows.find((r) => r.traderId === user.id);
    expect(traderRowB).toBeTruthy();
    expect(traderRowB!.orderCount).toBeGreaterThanOrEqual(1);

    // Both reports should show the same order count for this trader
    expect(traderRowA!.orderCount).toBe(traderRowB!.orderCount);
  });

  it('orders by a user not in the filtered team are excluded', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();

    // Create two teams
    const [teamA] = await db.insert(teams).values({ tenantId: tenant.id, name: 'Team A' }).returning();
    const [teamB] = await db.insert(teams).values({ tenantId: tenant.id, name: 'Team B' }).returning();

    // Create a second user, only in Team B
    const [user2] = await db.insert(users).values({
      tenantId: tenant.id,
      email: 'user2@test.local',
      name: 'User Two',
      role: 'TRADER',
    }).returning();

    await db.insert(userTeams).values([
      { userId: user.id, teamId: teamA!.id },
      { userId: user2.id, teamId: teamB!.id },
    ]);

    // Create orders for both users
    const { createOrder, saveOrderItems } = await loadOrdersService();
    const order1 = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });
    await saveOrderItems(order1.id, [
      { productType: 'VLSFO', quantity: '100', unit: 'MT', salesPrice: '500', costPrice: '450' },
    ]);

    const order2 = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user2.id,
    });
    await saveOrderItems(order2.id, [
      { productType: 'LSMGO', quantity: '50', unit: 'MT', salesPrice: '600', costPrice: '550' },
    ]);

    // Set orders to CONFIRMED so they're included in trader performance economics
    await db.update(orders).set({ status: 'CONFIRMED' }).where(eq(orders.id, order1.id));
    await db.update(orders).set({ status: 'CONFIRMED' }).where(eq(orders.id, order2.id));

    // Make user1 admin
    await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, user.id));

    const { getReleaseTwoReports } = await loadReportsService();

    // Filter by Team A — should only include user1's order, not user2's
    const reportA = await getReleaseTwoReports(tenant.id, user.id, {
      teamId: teamA!.id,
    });
    const traderIdsA = reportA.traderPerformance.rows.map((r) => r.traderId);
    expect(traderIdsA).toContain(user.id);
    expect(traderIdsA).not.toContain(user2.id);

    // Filter by Team B — should only include user2's order, not user1's
    const reportB = await getReleaseTwoReports(tenant.id, user.id, {
      teamId: teamB!.id,
    });
    const traderIdsB = reportB.traderPerformance.rows.map((r) => r.traderId);
    expect(traderIdsB).toContain(user2.id);
    expect(traderIdsB).not.toContain(user.id);
  });
});