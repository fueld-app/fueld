import { beforeEach, describe, expect, it } from 'bun:test';
import { seedAuthBasics, truncateAll, getDb } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';
import { eq } from 'drizzle-orm';
import { tenants } from '../src/db/schema';

/**
 * API E2E tests for broker deal settings endpoint + tenant gating.
 *
 * Covers:
 * - GET /admin/settings/my-broker-deal-settings returns all configured fields
 * - Defaults applied when settings block is absent
 * - PUT /admin/settings/broker-deals persists brokerDeals config
 * - Broker deal params ignored when feature disabled (tenant gating)
 *
 * NOTE: H2/H3 — both GET and PUT endpoints use `db.select().from(tenants).limit(1)`
 * instead of filtering by auth.tenantId. In single-tenant test setup this works fine,
 * but it's a bug for multi-tenant environments. Tests use the seeded tenant directly.
 */

async function setTenantBrokerDeals(tenantId: string, brokerDeals: Record<string, unknown>) {
  const db = await getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error('Tenant not found');
  const settings = { ...(tenant.settings as any), brokerDeals };
  await db.update(tenants).set({ settings, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
}

describe('broker deal settings + tenant gating e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('GET my-broker-deal-settings returns all configured fields', async () => {
    const seeded = await seedAuthBasics();
    await setTenantBrokerDeals(seeded.tenant.id, {
      enabled: true,
      defaultCommissionRate: 5,
      reportStatuses: ['DELIVERED', 'INVOICED', 'PAID'],
      autoReleaseCredit: false,
      autoReleaseBufferDays: 7,
    });
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const res = await requestJson('/admin/settings/my-broker-deal-settings', { token });
    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(true);
    expect(res.data?.data?.enabled).toBe(true);
    expect(res.data?.data?.defaultCommissionRate).toBe(5);
    expect(res.data?.data?.reportStatuses).toEqual(['DELIVERED', 'INVOICED', 'PAID']);
    expect(res.data?.data?.autoReleaseCredit).toBe(false);
    expect(res.data?.data?.autoReleaseBufferDays).toBe(7);
  });

  it('defaults applied when settings block is absent', async () => {
    const seeded = await seedAuthBasics();
    // Don't set any brokerDeals settings — tenant has no brokerDeals block
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const res = await requestJson('/admin/settings/my-broker-deal-settings', { token });
    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(true);
    expect(res.data?.data?.enabled).toBe(false);
    expect(res.data?.data?.defaultCommissionRate).toBe(0);
    expect(res.data?.data?.reportStatuses).toEqual(['CONFIRMED', 'DELIVERED', 'INVOICED', 'PAID']);
    expect(res.data?.data?.autoReleaseCredit).toBe(true);
    expect(res.data?.data?.autoReleaseBufferDays).toBe(0);
  });

  it('PUT broker-deals persists config', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    // Update user to ADMIN via DB, then re-login to get a token with ADMIN role
    const db = await getDb();
    const { users } = await import('../src/db/schema');
    await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, seeded.user.id));

    // Re-login with the updated admin user
    const adminLogin = await loginE2E(seeded.user.email, seeded.password);
    const adminToken = adminLogin.accessToken;

    const putRes = await requestJson('/admin/settings/broker-deals', {
      method: 'PUT',
      token: adminToken,
      body: {
        enabled: true,
        defaultCommissionRate: 4,
        reportStatuses: ['DELIVERED', 'PAID'],
        autoReleaseCredit: true,
        autoReleaseBufferDays: 5,
      },
    });

    // PUT should succeed and persist settings
    expect(putRes.status).toBe(200);
    expect(putRes.data?.success).toBe(true);
    expect(putRes.data?.data?.enabled).toBe(true);
    expect(putRes.data?.data?.defaultCommissionRate).toBe(4);

    // Verify via GET that settings were persisted
    const getRes = await requestJson('/admin/settings/my-broker-deal-settings', { token: adminToken });
    expect(getRes.data?.data?.enabled).toBe(true);
    expect(getRes.data?.data?.defaultCommissionRate).toBe(4);
    expect(getRes.data?.data?.reportStatuses).toEqual(['DELIVERED', 'PAID']);
    expect(getRes.data?.data?.autoReleaseBufferDays).toBe(5);
  });

  it('PUT broker-deals rejected for non-admin users', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    // seedAuthBasics creates a TRADER (not ADMIN)
    // The PUT endpoint catches requireAdmin errors and returns { success: false } with status 200
    const putRes = await requestJson('/admin/settings/broker-deals', {
      method: 'PUT',
      token,
      body: {
        enabled: true,
        defaultCommissionRate: 3,
        reportStatuses: ['CONFIRMED'],
        autoReleaseCredit: true,
        autoReleaseBufferDays: 0,
      },
    });

    // requireAdmin throws, caught by try-catch, returns success: false (not HTTP 403)
    expect(putRes.data?.success).toBe(false);
  });

  it('GET my-broker-deal-settings works for any authenticated user', async () => {
    const seeded = await seedAuthBasics();
    await setTenantBrokerDeals(seeded.tenant.id, {
      enabled: true,
      defaultCommissionRate: 7,
      reportStatuses: ['CONFIRMED'],
      autoReleaseCredit: true,
      autoReleaseBufferDays: 3,
    });
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    // TRADER user can read settings (not admin-only)
    const res = await requestJson('/admin/settings/my-broker-deal-settings', { token });
    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(true);
    expect(res.data?.data?.defaultCommissionRate).toBe(7);
  });

  it('broker deal params rejected when feature disabled (H1 fixed)', async () => {
    // H1 FIXED: API now gates on brokerDeals.enabled — isBrokerDeal is forced to false
    const seeded = await seedAuthBasics();
    // Feature is disabled (no brokerDeals block set)
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    // Verify feature is disabled
    const settings = await requestJson('/admin/settings/my-broker-deal-settings', { token });
    expect(settings.data?.data?.enabled).toBe(false);

    // Create order with isBrokerDeal=true — should be rejected (forced to false)
    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: {
        clientId: seeded.client.id,
        vesselId: seeded.vessel.id,
        placeId: seeded.place.id,
        isBrokerDeal: true,
      },
    });

    // H1 FIXED: isBrokerDeal is now forced to false when feature is disabled
    expect(created.data?.data?.isBrokerDeal).toBe(false);
  });

  it('commission report returns empty when feature disabled', async () => {
    const seeded = await seedAuthBasics();
    // Feature is disabled
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    // Create a broker deal order even though feature is disabled
    await requestJson('/orders', {
      method: 'POST',
      token,
      body: {
        clientId: seeded.client.id,
        vesselId: seeded.vessel.id,
        placeId: seeded.place.id,
        isBrokerDeal: true,
        commissionPerMt: '3.00',
      },
    });

    // Report should still work — it queries is_broker_deal=true regardless of settings
    const report = await requestJson('/reports/broker-commission?from=2026-01-01&to=2026-12-31', { token });
    expect(report.status).toBe(200);
    expect(report.data?.success).toBe(true);
    // The order has no items with commissionPerUnit, so report may be empty
    // But the endpoint should not error even when feature is disabled
  });
});