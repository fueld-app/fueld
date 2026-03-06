import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { counterparties, users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

async function seedCreditManagerUser(tenantId: string, email = 'cm@test.local', name = 'Credit Manager') {
  const db = await getDb();
  const { hashPassword } = await import('../src/modules/auth/password.service');
  const [cm] = await db
    .insert(users)
    .values({
      tenantId,
      email,
      name,
      role: 'CREDITMANAGER',
      passwordHash: await hashPassword('Passw0rd!'),
    })
    .returning();
  return cm!;
}

async function seedAdminUser(tenantId: string, email = 'admin@test.local', name = 'Admin') {
  const db = await getDb();
  const { hashPassword } = await import('../src/modules/auth/password.service');
  const [admin] = await db
    .insert(users)
    .values({
      tenantId,
      email,
      name,
      role: 'ADMIN',
      passwordHash: await hashPassword('Passw0rd!'),
    })
    .returning();
  return admin!;
}

describe('credit applications controller e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // ─── Authentication & Authorization ────────────────────────────

  it('rejects unauthenticated requests', async () => {
    const res = await requestJson('/credit/applications');
    expect(res.status).not.toBe(200);
  });

  it('allows any authenticated user to list applications', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken!;

    const res = await requestJson('/credit/applications', { token });
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.items).toEqual([]);
    expect(res.data.data.total).toBe(0);
  });

  it('blocks trader from accessing settings', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken!;

    const res = await requestJson('/credit/applications/settings', { token });
    expect(res.status).toBe(403);
    expect(res.data.success).toBe(false);
  });

  it('allows credit manager to read settings', async () => {
    const seeded = await seedAuthBasics();
    const cm = await seedCreditManagerUser(seeded.tenant.id);
    const login = await loginE2E(cm.email, 'Passw0rd!');
    const token = login.accessToken!;

    const res = await requestJson('/credit/applications/settings', { token });
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.requiredApprovals).toBe(1);
  });

  it('blocks credit manager from updating settings', async () => {
    const seeded = await seedAuthBasics();
    const cm = await seedCreditManagerUser(seeded.tenant.id);
    const login = await loginE2E(cm.email, 'Passw0rd!');
    const token = login.accessToken!;

    const res = await requestJson('/credit/applications/settings', {
      method: 'PATCH',
      token,
      body: { requiredApprovals: 2 },
    });
    expect(res.status).toBe(403);
    expect(res.data.success).toBe(false);
  });

  it('allows admin to update settings', async () => {
    const seeded = await seedAuthBasics();
    const admin = await seedAdminUser(seeded.tenant.id);
    const login = await loginE2E(admin.email, 'Passw0rd!');
    const token = login.accessToken!;

    const res = await requestJson('/credit/applications/settings', {
      method: 'PATCH',
      token,
      body: { requiredApprovals: 3, immediateRejection: false },
    });
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.requiredApprovals).toBe(3);
    expect(res.data.data.immediateRejection).toBe(false);
    expect(res.data.data.autoApplyOnApproval).toBe(true); // unchanged default
  });

  it('blocks trader from reviewing applications', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken!;

    const res = await requestJson('/credit/applications/fake-id/review', {
      method: 'POST',
      token,
      body: { decision: 'APPROVED' },
    });
    expect(res.status).toBe(403);
  });

  // ─── Create Application ────────────────────────────────────────

  it('creates a credit application as a trader', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken!;

    const res = await requestJson('/credit/applications', {
      method: 'POST',
      token,
      body: {
        type: 'CUSTOMER',
        counterpartyId: seeded.client.id,
        requestedAmount: '5000.00',
        requestedCurrency: 'USD',
        requestedDays: 30,
        reason: 'Good customer',
      },
    });

    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.id).toBeTruthy();
    expect(res.data.data.status).toBe('PENDING');
    expect(res.data.data.counterpartyName).toBe('Test Client');
    expect(res.data.data.requestedAmount).toBe('5000.00');
  });

  it('returns error for invalid body', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken!;

    const res = await requestJson('/credit/applications', {
      method: 'POST',
      token,
      body: {
        // Missing required fields
        type: 'CUSTOMER',
      },
    });

    // Elysia validation will reject this
    expect(res.data.success === false || res.status >= 400).toBe(true);
  });

  // ─── List & Filter ─────────────────────────────────────────────

  it('lists applications with status filter', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken!;

    // Create two applications
    await requestJson('/credit/applications', {
      method: 'POST',
      token,
      body: {
        type: 'CUSTOMER',
        counterpartyId: seeded.client.id,
        requestedAmount: '1000.00',
        requestedCurrency: 'USD',
      },
    });
    const res2 = await requestJson('/credit/applications', {
      method: 'POST',
      token,
      body: {
        type: 'CUSTOMER',
        counterpartyId: seeded.client.id,
        requestedAmount: '2000.00',
        requestedCurrency: 'USD',
      },
    });

    // Cancel one
    const appId = res2.data.data.id;
    await requestJson(`/credit/applications/${appId}/cancel`, { method: 'POST', token });

    // List pending
    const pending = await requestJson('/credit/applications?status=PENDING', { token });
    expect(pending.data.success).toBe(true);
    expect(pending.data.data.total).toBe(1);

    // List cancelled
    const cancelled = await requestJson('/credit/applications?status=CANCELLED', { token });
    expect(cancelled.data.success).toBe(true);
    expect(cancelled.data.data.total).toBe(1);

    // List all
    const all = await requestJson('/credit/applications', { token });
    expect(all.data.data.total).toBe(2);
  });

  it('supports pagination', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken!;

    for (let i = 0; i < 3; i++) {
      await requestJson('/credit/applications', {
        method: 'POST',
        token,
        body: {
          type: 'CUSTOMER',
          counterpartyId: seeded.client.id,
          requestedAmount: `${(i + 1) * 1000}.00`,
          requestedCurrency: 'USD',
        },
      });
    }

    const page1 = await requestJson('/credit/applications?page=1&limit=2', { token });
    expect(page1.data.data.items.length).toBe(2);
    expect(page1.data.data.total).toBe(3);

    const page2 = await requestJson('/credit/applications?page=2&limit=2', { token });
    expect(page2.data.data.items.length).toBe(1);
  });

  // ─── Get Single Application ────────────────────────────────────

  it('gets a single application by id', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken!;

    const created = await requestJson('/credit/applications', {
      method: 'POST',
      token,
      body: {
        type: 'CUSTOMER',
        counterpartyId: seeded.client.id,
        requestedAmount: '5000.00',
        requestedCurrency: 'USD',
        reason: 'Test reason',
      },
    });

    const appId = created.data.data.id;
    const fetched = await requestJson(`/credit/applications/${appId}`, { token });
    expect(fetched.data.success).toBe(true);
    expect(fetched.data.data.id).toBe(appId);
    expect(fetched.data.data.reason).toBe('Test reason');
  });

  it('returns not found for non-existent id', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken!;

    const res = await requestJson('/credit/applications/123e4567-e89b-12d3-a456-426614174000', { token });
    expect(res.data.success).toBe(false);
    expect(res.data.message).toContain('not found');
  });

  // ─── Pending Count ─────────────────────────────────────────────

  it('returns pending count', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken!;

    const before = await requestJson('/credit/applications/pending-count', { token });
    expect(before.data.data.count).toBe(0);

    await requestJson('/credit/applications', {
      method: 'POST',
      token,
      body: {
        type: 'CUSTOMER',
        counterpartyId: seeded.client.id,
        requestedAmount: '1000.00',
        requestedCurrency: 'USD',
      },
    });

    const after = await requestJson('/credit/applications/pending-count', { token });
    expect(after.data.data.count).toBe(1);
  });

  // ─── Cancel Application ────────────────────────────────────────

  it('cancels a pending application', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken!;

    const created = await requestJson('/credit/applications', {
      method: 'POST',
      token,
      body: {
        type: 'CUSTOMER',
        counterpartyId: seeded.client.id,
        requestedAmount: '1000.00',
        requestedCurrency: 'USD',
      },
    });

    const appId = created.data.data.id;
    const cancelled = await requestJson(`/credit/applications/${appId}/cancel`, {
      method: 'POST',
      token,
    });

    expect(cancelled.data.success).toBe(true);
    expect(cancelled.data.data.status).toBe('CANCELLED');
  });

  it('fails to cancel non-existent application', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken!;

    const res = await requestJson('/credit/applications/123e4567-e89b-12d3-a456-426614174000/cancel', {
      method: 'POST',
      token,
    });
    expect(res.data.success).toBe(false);
  });

  // ─── Review Application ────────────────────────────────────────

  it('credit manager can approve an application', async () => {
    const seeded = await seedAuthBasics();
    const cm = await seedCreditManagerUser(seeded.tenant.id);

    const traderLogin = await loginE2E(seeded.user.email, seeded.password);
    const traderToken = traderLogin.accessToken!;

    const cmLogin = await loginE2E(cm.email, 'Passw0rd!');
    const cmToken = cmLogin.accessToken!;

    // Trader creates application
    const created = await requestJson('/credit/applications', {
      method: 'POST',
      token: traderToken,
      body: {
        type: 'CUSTOMER',
        counterpartyId: seeded.client.id,
        requestedAmount: '5000.00',
        requestedCurrency: 'USD',
      },
    });

    const appId = created.data.data.id;

    // Credit manager approves
    const reviewed = await requestJson(`/credit/applications/${appId}/review`, {
      method: 'POST',
      token: cmToken,
      body: { decision: 'APPROVED', comment: 'Looks good' },
    });

    expect(reviewed.data.success).toBe(true);
    expect(reviewed.data.data.status).toBe('APPROVED');
    expect(reviewed.data.data.reviews.length).toBe(1);
    expect(reviewed.data.data.reviews[0].decision).toBe('APPROVED');
    expect(reviewed.data.data.reviews[0].comment).toBe('Looks good');
  });

  it('credit manager can reject an application', async () => {
    const seeded = await seedAuthBasics();
    const cm = await seedCreditManagerUser(seeded.tenant.id);

    const traderLogin = await loginE2E(seeded.user.email, seeded.password);
    const traderToken = traderLogin.accessToken!;

    const cmLogin = await loginE2E(cm.email, 'Passw0rd!');
    const cmToken = cmLogin.accessToken!;

    const created = await requestJson('/credit/applications', {
      method: 'POST',
      token: traderToken,
      body: {
        type: 'CUSTOMER',
        counterpartyId: seeded.client.id,
        requestedAmount: '50000.00',
        requestedCurrency: 'USD',
      },
    });

    const appId = created.data.data.id;

    const reviewed = await requestJson(`/credit/applications/${appId}/review`, {
      method: 'POST',
      token: cmToken,
      body: { decision: 'REJECTED', comment: 'Too risky' },
    });

    expect(reviewed.data.success).toBe(true);
    expect(reviewed.data.data.status).toBe('REJECTED');
  });

  it('admin can also review applications', async () => {
    const seeded = await seedAuthBasics();
    const admin = await seedAdminUser(seeded.tenant.id);

    const traderLogin = await loginE2E(seeded.user.email, seeded.password);
    const traderToken = traderLogin.accessToken!;

    const adminLogin = await loginE2E(admin.email, 'Passw0rd!');
    const adminToken = adminLogin.accessToken!;

    const created = await requestJson('/credit/applications', {
      method: 'POST',
      token: traderToken,
      body: {
        type: 'CUSTOMER',
        counterpartyId: seeded.client.id,
        requestedAmount: '3000.00',
        requestedCurrency: 'USD',
      },
    });

    const appId = created.data.data.id;

    const reviewed = await requestJson(`/credit/applications/${appId}/review`, {
      method: 'POST',
      token: adminToken,
      body: { decision: 'APPROVED' },
    });

    expect(reviewed.data.success).toBe(true);
    expect(reviewed.data.data.status).toBe('APPROVED');
  });

  it('prevents duplicate review from same user', async () => {
    const seeded = await seedAuthBasics();
    const admin = await seedAdminUser(seeded.tenant.id);

    // Set required approvals to 3 so first review doesn't resolve
    const adminLogin = await loginE2E(admin.email, 'Passw0rd!');
    const adminToken = adminLogin.accessToken!;

    await requestJson('/credit/applications/settings', {
      method: 'PATCH',
      token: adminToken,
      body: { requiredApprovals: 3 },
    });

    const traderLogin = await loginE2E(seeded.user.email, seeded.password);
    const traderToken = traderLogin.accessToken!;

    const created = await requestJson('/credit/applications', {
      method: 'POST',
      token: traderToken,
      body: {
        type: 'CUSTOMER',
        counterpartyId: seeded.client.id,
        requestedAmount: '3000.00',
        requestedCurrency: 'USD',
      },
    });

    const appId = created.data.data.id;

    // First review succeeds
    const first = await requestJson(`/credit/applications/${appId}/review`, {
      method: 'POST',
      token: adminToken,
      body: { decision: 'APPROVED' },
    });
    expect(first.data.success).toBe(true);

    // Second review from same user fails
    const second = await requestJson(`/credit/applications/${appId}/review`, {
      method: 'POST',
      token: adminToken,
      body: { decision: 'APPROVED' },
    });
    expect(second.data.success).toBe(false);
    expect(second.data.message).toContain('already reviewed');
  });

  it('returns failure for reviewing already resolved application', async () => {
    const seeded = await seedAuthBasics();
    const cm = await seedCreditManagerUser(seeded.tenant.id);

    const traderLogin = await loginE2E(seeded.user.email, seeded.password);
    const traderToken = traderLogin.accessToken!;

    const cmLogin = await loginE2E(cm.email, 'Passw0rd!');
    const cmToken = cmLogin.accessToken!;

    const created = await requestJson('/credit/applications', {
      method: 'POST',
      token: traderToken,
      body: {
        type: 'CUSTOMER',
        counterpartyId: seeded.client.id,
        requestedAmount: '1000.00',
        requestedCurrency: 'USD',
      },
    });

    const appId = created.data.data.id;

    // Cancel it
    await requestJson(`/credit/applications/${appId}/cancel`, { method: 'POST', token: traderToken });

    // Try to review cancelled app
    const res = await requestJson(`/credit/applications/${appId}/review`, {
      method: 'POST',
      token: cmToken,
      body: { decision: 'APPROVED' },
    });
    expect(res.data.success).toBe(false);
  });

  // ─── Multi-approval workflow ───────────────────────────────────

  it('full multi-approval workflow: requires 2 approvals', async () => {
    const seeded = await seedAuthBasics();
    const admin = await seedAdminUser(seeded.tenant.id);
    const cm1 = await seedCreditManagerUser(seeded.tenant.id, 'cm1@test.local', 'CM One');
    const cm2 = await seedCreditManagerUser(seeded.tenant.id, 'cm2@test.local', 'CM Two');

    const adminLogin = await loginE2E(admin.email, 'Passw0rd!');
    const adminToken = adminLogin.accessToken!;

    // Set required approvals to 2
    await requestJson('/credit/applications/settings', {
      method: 'PATCH',
      token: adminToken,
      body: { requiredApprovals: 2 },
    });

    const traderLogin = await loginE2E(seeded.user.email, seeded.password);
    const traderToken = traderLogin.accessToken!;

    const created = await requestJson('/credit/applications', {
      method: 'POST',
      token: traderToken,
      body: {
        type: 'CUSTOMER',
        counterpartyId: seeded.client.id,
        requestedAmount: '10000.00',
        requestedCurrency: 'USD',
        requestedDays: 60,
      },
    });

    const appId = created.data.data.id;

    // First approval — stays pending
    const cm1Login = await loginE2E(cm1.email, 'Passw0rd!');
    const after1 = await requestJson(`/credit/applications/${appId}/review`, {
      method: 'POST',
      token: cm1Login.accessToken!,
      body: { decision: 'APPROVED', comment: 'Approve from CM1' },
    });
    expect(after1.data.data.status).toBe('PENDING');
    expect(after1.data.data.reviews.length).toBe(1);

    // Second approval — approved
    const cm2Login = await loginE2E(cm2.email, 'Passw0rd!');
    const after2 = await requestJson(`/credit/applications/${appId}/review`, {
      method: 'POST',
      token: cm2Login.accessToken!,
      body: { decision: 'APPROVED', comment: 'Approve from CM2' },
    });
    expect(after2.data.data.status).toBe('APPROVED');
    expect(after2.data.data.reviews.length).toBe(2);
    expect(after2.data.data.resolvedAt).toBeTruthy();

    // Verify pending count dropped
    const count = await requestJson('/credit/applications/pending-count', { token: traderToken });
    expect(count.data.data.count).toBe(0);
  });
});
