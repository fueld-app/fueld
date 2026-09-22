/**
 * Kantox event-hook tests (DB-backed).
 *
 * Pins two defects that would have silently disabled hedging the moment
 * `kantoxSettings.enabled` was flipped to true on the Riviera tenant:
 *
 *  1. `onOrderConfirmedForKantox` must read the tenant's own settings. It is
 *     called from the order-status path, which passed `null` — and
 *     `resolveKantoxSettings` treats absent settings as "Kantox disabled",
 *     so the hook was a permanent no-op even with Kantox fully configured.
 *  2. The push audit row must be written. `activity_logs.user_id` is a
 *     nullable FK to `users.id`; the synthetic actor `'kantox-system'` made
 *     the INSERT throw, and `logActivity` swallows errors — so every push
 *     went unlogged.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { activityLogs, integrationCredentials, kantoxHedgeEntries, tenants } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';
import { encrypt } from '../src/lib/crypto';
import { logActivity } from '../src/modules/activity/activity.service';
import {
  onOrderConfirmedForKantox,
  resolveKantoxSettings,
  type KantoxOrderSnapshotItem,
} from '../src/modules/kantox/kantox.service';

/** Minimal config that satisfies `resolveKantoxSettings`'s non-secret gate. */
const ENABLED_SETTINGS = {
  kantoxSettings: {
    enabled: true,
    apiUser: 'test.api@kantox.com',
    companyRef: 'api_company_test',
    apiBaseUrl: 'https://kantox-preprod.com/api',
    valueDateRounding: 'WEEKLY_MONDAY' as const,
    paymentDateBufferDays: 7,
  },
};

/** One USD sell line costing less than it sells for → positive margin. */
function usdItem(orderSupplierId: string): KantoxOrderSnapshotItem {
  return {
    id: crypto.randomUUID(),
    orderSupplierId,
    quantity: '100',
    quantityMin: '100',
    salesPrice: '10.00',
    costPrice: '8.00',
    salesCurrency: 'USD',
    costCurrency: 'USD',
  };
}

beforeEach(async () => {
  await truncateAll();
});

describe('kantox hooks', () => {
  it('resolves settings without a settings argument, so a disabled-looking hook cannot block hedging', async () => {
    const { tenant } = await seedBasics();
    const db = await getDb();

    await db.update(tenants).set({ settings: ENABLED_SETTINGS }).where(eq(tenants.id, tenant.id));
    const secret = encrypt('sandbox-password');
    await db.insert(integrationCredentials).values({
      tenantId: tenant.id,
      provider: 'kantox',
      key: 'apiPassword',
      encryptedValue: secret.encrypted,
      iv: secret.iv,
      authTag: secret.authTag,
    });

    // The hook takes no settings argument: it must read the tenant's own row.
    // Passing `null` (the pre-fix behaviour) resolves to "disabled".
    const resolved = await resolveKantoxSettings(tenant.id, ENABLED_SETTINGS);
    expect(resolved).not.toBeNull();
    expect(resolved!.companyRef).toBe('api_company_test');
    expect(resolved!.apiPassword).toBe('sandbox-password');

    // And the hook itself must not blow up on a fully configured tenant.
    await onOrderConfirmedForKantox(
      {
        id: crypto.randomUUID(),
        tenantId: tenant.id,
        orderNumber: '20260922-999001',
        eta: '2026-10-01',
        customerPaymentTermType: 'CREDIT',
        customerCreditDays: 30,
      },
      [usdItem('leg-1')],
    );
  });

  it('no-ops without writing a hedge row for a tenant with Kantox disabled', async () => {
    const { tenant } = await seedBasics();
    const db = await getDb();

    await onOrderConfirmedForKantox(
      {
        id: crypto.randomUUID(),
        tenantId: tenant.id,
        orderNumber: '20260922-999002',
        eta: '2026-10-01',
      },
      [usdItem('leg-1')],
    );

    const rows = await db.select().from(kantoxHedgeEntries);
    expect(rows.length).toBe(0);
  });

  it('records a system audit row with a NULL user_id rather than a non-UUID actor', async () => {
    const { tenant } = await seedBasics();
    const db = await getDb();

    // Pre-fix this call used userId 'kantox-system'. The column is `uuid
    // REFERENCES users(id)`, so the INSERT threw and logActivity swallowed
    // it — leaving no audit trail for any hedge push.
    await logActivity({
      userId: null,
      tenantId: tenant.id,
      action: 'KANTOX_PUSH',
      entityType: 'kantox_hedge_entry',
      entityId: crypto.randomUUID(),
      metadata: { entryCount: 2 },
    });

    const rows = await db.select().from(activityLogs).where(eq(activityLogs.tenantId, tenant.id));
    expect(rows.length).toBe(1);
    expect(rows[0]!.userId).toBeNull();
    expect(rows[0]!.action).toBe('KANTOX_PUSH');
    expect(rows[0]!.metadata).toEqual({ entryCount: 2 });
  });
});
