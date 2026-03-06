import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  counterparties,
  creditApplications,
  creditApplicationReviews,
  creditLines,
  creditLineCounterparties,
  tenants,
  users,
} from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';

async function loadService() {
  return import('../src/modules/credit/credit-applications.service');
}

beforeEach(async () => {
  await truncateAll();
});

// ═══════════════════════════════════════════════════════════════════════
//  Settings
// ═══════════════════════════════════════════════════════════════════════

describe('credit application settings', () => {
  it('returns default settings when nothing is configured', async () => {
    await seedBasics();
    const { getCreditApplicationSettings } = await loadService();

    const settings = await getCreditApplicationSettings();
    expect(settings.requiredApprovals).toBe(1);
    expect(settings.autoApplyOnApproval).toBe(true);
    expect(settings.immediateRejection).toBe(true);
    expect(settings.notifyCreditManagers).toBe(true);
  });

  it('updates settings and merges with defaults', async () => {
    await seedBasics();
    const { getCreditApplicationSettings, updateCreditApplicationSettings } = await loadService();

    const updated = await updateCreditApplicationSettings({
      requiredApprovals: 3,
      immediateRejection: false,
    });

    expect(updated.requiredApprovals).toBe(3);
    expect(updated.immediateRejection).toBe(false);
    // These should remain as defaults
    expect(updated.autoApplyOnApproval).toBe(true);
    expect(updated.notifyCreditManagers).toBe(true);

    // Verify persistence
    const refetched = await getCreditApplicationSettings();
    expect(refetched.requiredApprovals).toBe(3);
    expect(refetched.immediateRejection).toBe(false);
  });

  it('throws when no tenant exists', async () => {
    const { getCreditApplicationSettings } = await loadService();
    await expect(getCreditApplicationSettings()).rejects.toThrow('No tenant found');
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  Create Application
// ═══════════════════════════════════════════════════════════════════════

describe('createCreditApplication', () => {
  it('creates an application with all fields populated', async () => {
    const { user, client } = await seedBasics();
    const { createCreditApplication } = await loadService();

    const app = await createCreditApplication(
      {
        type: 'CUSTOMER',
        counterpartyId: client.id,
        requestedAmount: '5000.00',
        requestedCurrency: 'USD',
        requestedDays: 30,
        reason: 'New customer needs credit',
      },
      user.id,
    );

    expect(app.id).toBeTruthy();
    expect(app.type).toBe('CUSTOMER');
    expect(app.counterpartyId).toBe(client.id);
    expect(app.counterpartyName).toBe('Test Client');
    expect(app.requestedAmount).toBe('5000.00');
    expect(app.requestedCurrency).toBe('USD');
    expect(app.requestedDays).toBe(30);
    expect(app.reason).toBe('New customer needs credit');
    expect(app.status).toBe('PENDING');
    expect(app.requestedByUserId).toBe(user.id);
    expect(app.requestedByName).toBe('Test User');
    expect(app.reviews).toEqual([]);
    expect(app.resolvedAt).toBeNull();
    expect(app.orderId).toBeNull();
    expect(app.creditLineId).toBeNull();
  });

  it('creates application with minimal fields', async () => {
    const { user, client } = await seedBasics();
    const { createCreditApplication } = await loadService();

    const app = await createCreditApplication(
      {
        type: 'CUSTOMER',
        counterpartyId: client.id,
        requestedAmount: '1000.00',
        requestedCurrency: 'EUR',
      },
      user.id,
    );

    expect(app.id).toBeTruthy();
    expect(app.requestedDays).toBeNull();
    expect(app.reason).toBeNull();
    expect(app.orderId).toBeNull();
  });

  it('creates application linked to an order', async () => {
    const { tenant, user, client, vessel, place } = await seedBasics();
    const db = await getDb();
    const { createCreditApplication } = await loadService();
    const { createOrder } = await import('../src/modules/orders/orders.service');

    const order = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    const app = await createCreditApplication(
      {
        type: 'CUSTOMER',
        counterpartyId: client.id,
        orderId: order.id,
        requestedAmount: '2000.00',
        requestedCurrency: 'USD',
        requestedDays: 45,
      },
      user.id,
    );

    expect(app.orderId).toBe(order.id);
    expect(app.orderReference).toBeTruthy();
  });

  it('creates application linked to an existing credit line', async () => {
    const { user, client } = await seedBasics();
    const { createCreditApplication } = await loadService();
    const { createCreditLine } = await import('../src/modules/credit/credit.service');

    const creditLine = await createCreditLine({
      type: 'CUSTOMER',
      counterpartyIds: [client.id],
      creditAmount: '1000.00',
      currency: 'USD',
      periodDays: 30,
    });

    const app = await createCreditApplication(
      {
        type: 'CUSTOMER',
        counterpartyId: client.id,
        creditLineId: creditLine!.id,
        requestedAmount: '5000.00',
        requestedCurrency: 'USD',
      },
      user.id,
    );

    expect(app.creditLineId).toBe(creditLine!.id);
  });

  it('creates supplier type application', async () => {
    const { tenant, user } = await seedBasics();
    const db = await getDb();
    const { createCreditApplication } = await loadService();

    const [supplier] = await db
      .insert(counterparties)
      .values({
        tenantId: tenant.id,
        name: 'Supplier Co',
        type: 'SUPPLIER',
        types: ['SUPPLIER'],
      })
      .returning();

    const app = await createCreditApplication(
      {
        type: 'SUPPLIER',
        counterpartyId: supplier!.id,
        requestedAmount: '10000.00',
        requestedCurrency: 'USD',
      },
      user.id,
    );

    expect(app.type).toBe('SUPPLIER');
    expect(app.counterpartyName).toBe('Supplier Co');
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  List & Get
// ═══════════════════════════════════════════════════════════════════════

describe('listCreditApplications', () => {
  it('returns empty list when no applications exist', async () => {
    await seedBasics();
    const { listCreditApplications } = await loadService();

    const result = await listCreditApplications();
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
  });

  it('returns paginated applications', async () => {
    const { user, client } = await seedBasics();
    const { createCreditApplication, listCreditApplications } = await loadService();

    // Create 3 applications
    for (let i = 0; i < 3; i++) {
      await createCreditApplication(
        {
          type: 'CUSTOMER',
          counterpartyId: client.id,
          requestedAmount: `${(i + 1) * 1000}.00`,
          requestedCurrency: 'USD',
        },
        user.id,
      );
    }

    const all = await listCreditApplications();
    expect(all.total).toBe(3);
    expect(all.items.length).toBe(3);

    const page1 = await listCreditApplications({ page: 1, limit: 2 });
    expect(page1.items.length).toBe(2);
    expect(page1.total).toBe(3);

    const page2 = await listCreditApplications({ page: 2, limit: 2 });
    expect(page2.items.length).toBe(1);
  });

  it('filters by status', async () => {
    const { tenant, user, client } = await seedBasics();
    const db = await getDb();
    const { createCreditApplication, cancelCreditApplication, listCreditApplications } =
      await loadService();

    const app1 = await createCreditApplication(
      {
        type: 'CUSTOMER',
        counterpartyId: client.id,
        requestedAmount: '1000.00',
        requestedCurrency: 'USD',
      },
      user.id,
    );

    const app2 = await createCreditApplication(
      {
        type: 'CUSTOMER',
        counterpartyId: client.id,
        requestedAmount: '2000.00',
        requestedCurrency: 'USD',
      },
      user.id,
    );

    // Cancel app2
    await cancelCreditApplication(app2.id, user.id);

    const pending = await listCreditApplications({ status: 'PENDING' as any });
    expect(pending.total).toBe(1);
    expect(pending.items[0]!.id).toBe(app1.id);

    const cancelled = await listCreditApplications({ status: 'CANCELLED' as any });
    expect(cancelled.total).toBe(1);
    expect(cancelled.items[0]!.id).toBe(app2.id);
  });

  it('filters by type', async () => {
    const { tenant, user, client } = await seedBasics();
    const db = await getDb();
    const { createCreditApplication, listCreditApplications } = await loadService();

    const [supplier] = await db
      .insert(counterparties)
      .values({
        tenantId: tenant.id,
        name: 'Supplier X',
        type: 'SUPPLIER',
        types: ['SUPPLIER'],
      })
      .returning();

    await createCreditApplication(
      { type: 'CUSTOMER', counterpartyId: client.id, requestedAmount: '1000.00', requestedCurrency: 'USD' },
      user.id,
    );
    await createCreditApplication(
      { type: 'SUPPLIER', counterpartyId: supplier!.id, requestedAmount: '2000.00', requestedCurrency: 'USD' },
      user.id,
    );

    const customers = await listCreditApplications({ type: 'CUSTOMER' });
    expect(customers.total).toBe(1);

    const suppliers = await listCreditApplications({ type: 'SUPPLIER' });
    expect(suppliers.total).toBe(1);
  });

  it('filters by counterpartyId', async () => {
    const { tenant, user, client } = await seedBasics();
    const db = await getDb();
    const { createCreditApplication, listCreditApplications } = await loadService();

    const [client2] = await db
      .insert(counterparties)
      .values({
        tenantId: tenant.id,
        name: 'Client B',
        type: 'CLIENT',
        types: ['CLIENT'],
      })
      .returning();

    await createCreditApplication(
      { type: 'CUSTOMER', counterpartyId: client.id, requestedAmount: '1000.00', requestedCurrency: 'USD' },
      user.id,
    );
    await createCreditApplication(
      { type: 'CUSTOMER', counterpartyId: client2!.id, requestedAmount: '2000.00', requestedCurrency: 'USD' },
      user.id,
    );

    const result = await listCreditApplications({ counterpartyId: client2!.id });
    expect(result.total).toBe(1);
    expect(result.items[0]!.counterpartyName).toBe('Client B');
  });

  it('caps limit at 100', async () => {
    await seedBasics();
    const { listCreditApplications } = await loadService();
    const result = await listCreditApplications({ limit: 500 });
    expect(result.pageSize).toBe(100);
  });
});

describe('getCreditApplicationById', () => {
  it('returns null for non-existent id', async () => {
    await seedBasics();
    const { getCreditApplicationById } = await loadService();
    const result = await getCreditApplicationById('123e4567-e89b-12d3-a456-426614174000');
    expect(result).toBeNull();
  });

  it('returns enriched application with reviews', async () => {
    const { tenant, user, client } = await seedBasics();
    const db = await getDb();
    const { createCreditApplication, getCreditApplicationById, submitReview } = await loadService();

    const [reviewer] = await db
      .insert(users)
      .values({
        tenantId: tenant.id,
        email: 'cm@test.local',
        name: 'Credit Manager',
        role: 'CREDITMANAGER',
      })
      .returning();

    // Set requiredApprovals > 1 to keep the app pending after one review
    const { updateCreditApplicationSettings } = await loadService();
    await updateCreditApplicationSettings({ requiredApprovals: 3, immediateRejection: false });

    const app = await createCreditApplication(
      {
        type: 'CUSTOMER',
        counterpartyId: client.id,
        requestedAmount: '5000.00',
        requestedCurrency: 'USD',
        reason: 'Test',
      },
      user.id,
    );

    await submitReview(app.id, reviewer!.id, 'APPROVED', 'Looks good');

    const fetched = await getCreditApplicationById(app.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.reviews.length).toBe(1);
    expect(fetched!.reviews[0]!.reviewerName).toBe('Credit Manager');
    expect(fetched!.reviews[0]!.decision).toBe('APPROVED');
    expect(fetched!.reviews[0]!.comment).toBe('Looks good');
  });
});

describe('countPendingApplications', () => {
  it('returns 0 when no applications exist', async () => {
    await seedBasics();
    const { countPendingApplications } = await loadService();
    expect(await countPendingApplications()).toBe(0);
  });

  it('counts only pending applications', async () => {
    const { user, client } = await seedBasics();
    const { createCreditApplication, cancelCreditApplication, countPendingApplications } = await loadService();

    await createCreditApplication(
      { type: 'CUSTOMER', counterpartyId: client.id, requestedAmount: '1000.00', requestedCurrency: 'USD' },
      user.id,
    );
    const app2 = await createCreditApplication(
      { type: 'CUSTOMER', counterpartyId: client.id, requestedAmount: '2000.00', requestedCurrency: 'USD' },
      user.id,
    );

    expect(await countPendingApplications()).toBe(2);

    await cancelCreditApplication(app2.id, user.id);
    expect(await countPendingApplications()).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  Cancel Application
// ═══════════════════════════════════════════════════════════════════════

describe('cancelCreditApplication', () => {
  it('cancels a pending application', async () => {
    const { user, client } = await seedBasics();
    const { createCreditApplication, cancelCreditApplication } = await loadService();

    const app = await createCreditApplication(
      { type: 'CUSTOMER', counterpartyId: client.id, requestedAmount: '1000.00', requestedCurrency: 'USD' },
      user.id,
    );

    const cancelled = await cancelCreditApplication(app.id, user.id);
    expect(cancelled).not.toBeNull();
    expect(cancelled!.status).toBe('CANCELLED');
    expect(cancelled!.resolvedAt).not.toBeNull();
  });

  it('returns null for non-existent application', async () => {
    await seedBasics();
    const { cancelCreditApplication } = await loadService();
    const result = await cancelCreditApplication('123e4567-e89b-12d3-a456-426614174000', 'fake-user-id');
    expect(result).toBeNull();
  });

  it('returns null when trying to cancel already cancelled application', async () => {
    const { user, client } = await seedBasics();
    const { createCreditApplication, cancelCreditApplication } = await loadService();

    const app = await createCreditApplication(
      { type: 'CUSTOMER', counterpartyId: client.id, requestedAmount: '1000.00', requestedCurrency: 'USD' },
      user.id,
    );

    await cancelCreditApplication(app.id, user.id);
    const second = await cancelCreditApplication(app.id, user.id);
    expect(second).toBeNull();
  });

  it('returns null when trying to cancel approved application', async () => {
    const { tenant, user, client } = await seedBasics();
    const db = await getDb();
    const { createCreditApplication, submitReview, cancelCreditApplication } = await loadService();

    const [reviewer] = await db
      .insert(users)
      .values({
        tenantId: tenant.id,
        email: 'cm@test.local',
        name: 'CM',
        role: 'CREDITMANAGER',
      })
      .returning();

    const app = await createCreditApplication(
      { type: 'CUSTOMER', counterpartyId: client.id, requestedAmount: '1000.00', requestedCurrency: 'USD' },
      user.id,
    );

    // Approve it (default requiredApprovals = 1)
    await submitReview(app.id, reviewer!.id, 'APPROVED');

    const result = await cancelCreditApplication(app.id, user.id);
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  Submit Review — Approval Logic
// ═══════════════════════════════════════════════════════════════════════

describe('submitReview', () => {
  it('approves application with single approval (default settings)', async () => {
    const { tenant, user, client } = await seedBasics();
    const db = await getDb();
    const { createCreditApplication, submitReview } = await loadService();

    const [reviewer] = await db
      .insert(users)
      .values({
        tenantId: tenant.id,
        email: 'cm@test.local',
        name: 'Credit Manager',
        role: 'CREDITMANAGER',
      })
      .returning();

    const app = await createCreditApplication(
      { type: 'CUSTOMER', counterpartyId: client.id, requestedAmount: '5000.00', requestedCurrency: 'USD' },
      user.id,
    );

    const reviewed = await submitReview(app.id, reviewer!.id, 'APPROVED', 'Approved');
    expect(reviewed).not.toBeNull();
    expect(reviewed!.status).toBe('APPROVED');
    expect(reviewed!.resolvedAt).not.toBeNull();
    expect(reviewed!.reviews.length).toBe(1);
  });

  it('rejects immediately with default settings (immediateRejection=true)', async () => {
    const { tenant, user, client } = await seedBasics();
    const db = await getDb();
    const { createCreditApplication, submitReview } = await loadService();

    const [reviewer] = await db
      .insert(users)
      .values({
        tenantId: tenant.id,
        email: 'cm@test.local',
        name: 'CM',
        role: 'CREDITMANAGER',
      })
      .returning();

    const app = await createCreditApplication(
      { type: 'CUSTOMER', counterpartyId: client.id, requestedAmount: '5000.00', requestedCurrency: 'USD' },
      user.id,
    );

    const reviewed = await submitReview(app.id, reviewer!.id, 'REJECTED', 'Too risky');
    expect(reviewed!.status).toBe('REJECTED');
    expect(reviewed!.resolvedAt).not.toBeNull();
  });

  it('requires multiple approvals when requiredApprovals > 1', async () => {
    const { tenant, user, client } = await seedBasics();
    const db = await getDb();
    const { createCreditApplication, submitReview, updateCreditApplicationSettings } = await loadService();

    await updateCreditApplicationSettings({ requiredApprovals: 2 });

    const [cm1] = await db
      .insert(users)
      .values({ tenantId: tenant.id, email: 'cm1@test.local', name: 'CM1', role: 'CREDITMANAGER' })
      .returning();
    const [cm2] = await db
      .insert(users)
      .values({ tenantId: tenant.id, email: 'cm2@test.local', name: 'CM2', role: 'CREDITMANAGER' })
      .returning();

    const app = await createCreditApplication(
      { type: 'CUSTOMER', counterpartyId: client.id, requestedAmount: '5000.00', requestedCurrency: 'USD' },
      user.id,
    );

    // First approval — should stay pending
    const after1 = await submitReview(app.id, cm1!.id, 'APPROVED');
    expect(after1!.status).toBe('PENDING');
    expect(after1!.reviews.length).toBe(1);

    // Second approval — should be approved
    const after2 = await submitReview(app.id, cm2!.id, 'APPROVED');
    expect(after2!.status).toBe('APPROVED');
    expect(after2!.resolvedAt).not.toBeNull();
    expect(after2!.reviews.length).toBe(2);
  });

  it('rejects on majority when immediateRejection is off', async () => {
    const { tenant, user, client } = await seedBasics();
    const db = await getDb();
    const { createCreditApplication, submitReview, updateCreditApplicationSettings } = await loadService();

    await updateCreditApplicationSettings({ requiredApprovals: 2, immediateRejection: false });

    const [cm1] = await db
      .insert(users)
      .values({ tenantId: tenant.id, email: 'cm1@test.local', name: 'CM1', role: 'CREDITMANAGER' })
      .returning();
    const [cm2] = await db
      .insert(users)
      .values({ tenantId: tenant.id, email: 'cm2@test.local', name: 'CM2', role: 'CREDITMANAGER' })
      .returning();

    const app = await createCreditApplication(
      { type: 'CUSTOMER', counterpartyId: client.id, requestedAmount: '5000.00', requestedCurrency: 'USD' },
      user.id,
    );

    // First rejection — should stay pending (need requiredApprovals rejections for majority)
    const after1 = await submitReview(app.id, cm1!.id, 'REJECTED');
    expect(after1!.status).toBe('PENDING');

    // Second rejection — meets majority threshold
    const after2 = await submitReview(app.id, cm2!.id, 'REJECTED');
    expect(after2!.status).toBe('REJECTED');
    expect(after2!.resolvedAt).not.toBeNull();
  });

  it('stays pending with mixed reviews when immediateRejection is off', async () => {
    const { tenant, user, client } = await seedBasics();
    const db = await getDb();
    const { createCreditApplication, submitReview, updateCreditApplicationSettings } = await loadService();

    await updateCreditApplicationSettings({ requiredApprovals: 3, immediateRejection: false });

    const [cm1] = await db
      .insert(users)
      .values({ tenantId: tenant.id, email: 'cm1@test.local', name: 'CM1', role: 'CREDITMANAGER' })
      .returning();
    const [cm2] = await db
      .insert(users)
      .values({ tenantId: tenant.id, email: 'cm2@test.local', name: 'CM2', role: 'CREDITMANAGER' })
      .returning();

    const app = await createCreditApplication(
      { type: 'CUSTOMER', counterpartyId: client.id, requestedAmount: '5000.00', requestedCurrency: 'USD' },
      user.id,
    );

    const after1 = await submitReview(app.id, cm1!.id, 'APPROVED');
    expect(after1!.status).toBe('PENDING');

    const after2 = await submitReview(app.id, cm2!.id, 'REJECTED');
    expect(after2!.status).toBe('PENDING'); // 1 approve, 1 reject, need 3
  });

  it('throws when same reviewer reviews twice', async () => {
    const { tenant, user, client } = await seedBasics();
    const db = await getDb();
    const { createCreditApplication, submitReview, updateCreditApplicationSettings } = await loadService();

    await updateCreditApplicationSettings({ requiredApprovals: 3 });

    const [reviewer] = await db
      .insert(users)
      .values({ tenantId: tenant.id, email: 'cm@test.local', name: 'CM', role: 'CREDITMANAGER' })
      .returning();

    const app = await createCreditApplication(
      { type: 'CUSTOMER', counterpartyId: client.id, requestedAmount: '5000.00', requestedCurrency: 'USD' },
      user.id,
    );

    await submitReview(app.id, reviewer!.id, 'APPROVED');
    await expect(submitReview(app.id, reviewer!.id, 'APPROVED')).rejects.toThrow(
      'You have already reviewed this application',
    );
  });

  it('returns null for non-existent application', async () => {
    await seedBasics();
    const { submitReview } = await loadService();
    const result = await submitReview('123e4567-e89b-12d3-a456-426614174000', 'fake-user', 'APPROVED');
    expect(result).toBeNull();
  });

  it('returns null for already resolved application', async () => {
    const { tenant, user, client } = await seedBasics();
    const db = await getDb();
    const { createCreditApplication, submitReview, cancelCreditApplication } = await loadService();

    const [cm1] = await db
      .insert(users)
      .values({ tenantId: tenant.id, email: 'cm1@test.local', name: 'CM1', role: 'CREDITMANAGER' })
      .returning();

    const app = await createCreditApplication(
      { type: 'CUSTOMER', counterpartyId: client.id, requestedAmount: '1000.00', requestedCurrency: 'USD' },
      user.id,
    );

    // Cancel it first
    await cancelCreditApplication(app.id, user.id);

    const result = await submitReview(app.id, cm1!.id, 'APPROVED');
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  Auto-Apply Credit Line
// ═══════════════════════════════════════════════════════════════════════

describe('auto-apply credit line on approval', () => {
  it('creates a new credit line when approved (no existing line)', async () => {
    const { tenant, user, client } = await seedBasics();
    const db = await getDb();
    const { createCreditApplication, submitReview } = await loadService();

    const [reviewer] = await db
      .insert(users)
      .values({ tenantId: tenant.id, email: 'cm@test.local', name: 'CM', role: 'CREDITMANAGER' })
      .returning();

    const app = await createCreditApplication(
      {
        type: 'CUSTOMER',
        counterpartyId: client.id,
        requestedAmount: '5000.00',
        requestedCurrency: 'EUR',
        requestedDays: 45,
      },
      user.id,
    );

    await submitReview(app.id, reviewer!.id, 'APPROVED');

    // Verify credit line was created
    const lines = await db.select().from(creditLines);
    expect(lines.length).toBe(1);
    expect(lines[0]!.creditAmount).toBe('5000.00');
    expect(lines[0]!.currency).toBe('EUR');
    expect(lines[0]!.periodDays).toBe(45);
    expect(lines[0]!.type).toBe('CUSTOMER');

    // Verify counterparty link
    const links = await db.select().from(creditLineCounterparties);
    expect(links.length).toBe(1);
    expect(links[0]!.counterpartyId).toBe(client.id);
    expect(links[0]!.creditLineId).toBe(lines[0]!.id);
  });

  it('updates existing credit line when approved', async () => {
    const { tenant, user, client } = await seedBasics();
    const db = await getDb();
    const { createCreditApplication, submitReview } = await loadService();
    const { createCreditLine } = await import('../src/modules/credit/credit.service');

    const existingLine = await createCreditLine({
      type: 'CUSTOMER',
      counterpartyIds: [client.id],
      creditAmount: '1000.00',
      currency: 'USD',
      periodDays: 30,
    });

    const [reviewer] = await db
      .insert(users)
      .values({ tenantId: tenant.id, email: 'cm@test.local', name: 'CM', role: 'CREDITMANAGER' })
      .returning();

    const app = await createCreditApplication(
      {
        type: 'CUSTOMER',
        counterpartyId: client.id,
        creditLineId: existingLine!.id,
        requestedAmount: '5000.00',
        requestedCurrency: 'USD',
        requestedDays: 60,
      },
      user.id,
    );

    await submitReview(app.id, reviewer!.id, 'APPROVED');

    // Verify credit line was updated
    const [updated] = await db
      .select()
      .from(creditLines)
      .where(eq(creditLines.id, existingLine!.id));
    expect(updated!.creditAmount).toBe('5000.00');
    expect(updated!.periodDays).toBe(60);
  });

  it('does not auto-apply when setting is disabled', async () => {
    const { tenant, user, client } = await seedBasics();
    const db = await getDb();
    const { createCreditApplication, submitReview, updateCreditApplicationSettings } = await loadService();

    await updateCreditApplicationSettings({ autoApplyOnApproval: false });

    const [reviewer] = await db
      .insert(users)
      .values({ tenantId: tenant.id, email: 'cm@test.local', name: 'CM', role: 'CREDITMANAGER' })
      .returning();

    const app = await createCreditApplication(
      {
        type: 'CUSTOMER',
        counterpartyId: client.id,
        requestedAmount: '5000.00',
        requestedCurrency: 'USD',
      },
      user.id,
    );

    await submitReview(app.id, reviewer!.id, 'APPROVED');

    // Verify NO credit line was created
    const lines = await db.select().from(creditLines);
    expect(lines.length).toBe(0);
  });

  it('does not auto-apply on rejection', async () => {
    const { tenant, user, client } = await seedBasics();
    const db = await getDb();
    const { createCreditApplication, submitReview } = await loadService();

    const [reviewer] = await db
      .insert(users)
      .values({ tenantId: tenant.id, email: 'cm@test.local', name: 'CM', role: 'CREDITMANAGER' })
      .returning();

    const app = await createCreditApplication(
      {
        type: 'CUSTOMER',
        counterpartyId: client.id,
        requestedAmount: '5000.00',
        requestedCurrency: 'USD',
      },
      user.id,
    );

    await submitReview(app.id, reviewer!.id, 'REJECTED');

    const lines = await db.select().from(creditLines);
    expect(lines.length).toBe(0);
  });

  it('uses default 30 days when requestedDays is null for new credit line', async () => {
    const { tenant, user, client } = await seedBasics();
    const db = await getDb();
    const { createCreditApplication, submitReview } = await loadService();

    const [reviewer] = await db
      .insert(users)
      .values({ tenantId: tenant.id, email: 'cm@test.local', name: 'CM', role: 'CREDITMANAGER' })
      .returning();

    const app = await createCreditApplication(
      {
        type: 'CUSTOMER',
        counterpartyId: client.id,
        requestedAmount: '2000.00',
        requestedCurrency: 'USD',
        // No requestedDays
      },
      user.id,
    );

    await submitReview(app.id, reviewer!.id, 'APPROVED');

    const lines = await db.select().from(creditLines);
    expect(lines.length).toBe(1);
    expect(lines[0]!.periodDays).toBe(30);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  Get Credit Manager User IDs
// ═══════════════════════════════════════════════════════════════════════

describe('getCreditManagerUserIds', () => {
  it('returns empty array when no credit managers exist', async () => {
    await seedBasics(); // seeds a TRADER
    const { getCreditManagerUserIds } = await loadService();
    const ids = await getCreditManagerUserIds();
    expect(ids).toEqual([]);
  });

  it('returns CREDITMANAGER and ADMIN user ids', async () => {
    const { tenant } = await seedBasics();
    const db = await getDb();
    const { getCreditManagerUserIds } = await loadService();

    const [cm] = await db
      .insert(users)
      .values({ tenantId: tenant.id, email: 'cm@test.local', name: 'CM', role: 'CREDITMANAGER' })
      .returning();
    const [admin] = await db
      .insert(users)
      .values({ tenantId: tenant.id, email: 'admin@test.local', name: 'Admin', role: 'ADMIN' })
      .returning();

    const ids = await getCreditManagerUserIds();
    expect(ids).toContain(cm!.id);
    expect(ids).toContain(admin!.id);
    expect(ids.length).toBe(2);
  });

  it('excludes inactive users', async () => {
    const { tenant } = await seedBasics();
    const db = await getDb();
    const { getCreditManagerUserIds } = await loadService();

    const [cm] = await db
      .insert(users)
      .values({ tenantId: tenant.id, email: 'cm@test.local', name: 'CM', role: 'CREDITMANAGER', isActive: false })
      .returning();

    const ids = await getCreditManagerUserIds();
    expect(ids).not.toContain(cm!.id);
    expect(ids.length).toBe(0);
  });

  it('excludes non-credit-manager roles', async () => {
    const { tenant } = await seedBasics();
    const db = await getDb();
    const { getCreditManagerUserIds } = await loadService();

    await db
      .insert(users)
      .values({ tenantId: tenant.id, email: 'finance@test.local', name: 'Finance', role: 'FINANCE' })
      .returning();

    const ids = await getCreditManagerUserIds();
    expect(ids.length).toBe(0);
  });
});
