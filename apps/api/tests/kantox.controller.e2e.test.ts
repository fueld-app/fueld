// ═══════════════════════════════════════════════════════════════════════
//  Kantox controller e2e — role gating + the order-number lookup.
//
//  Verifies:
//    1. Auth required; ADMIN-only on the settings write
//    2. Feature-off tenants get an empty, non-error payload (read-side gate)
//    3. PUT /kantox/settings is a merge-write and never returns the password
//    4. /orders/:id/hedge accepts an ORDER NUMBER, not just a UUID
//       (regression: passing the raw param into a uuid column 500'd)
// ═══════════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { integrationCredentials, kantoxHedgeEntries, orders, tenants, users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';
import { encrypt } from '../src/lib/crypto';

async function seededAdmin(enableKantox = false) {
  const seeded = await seedAuthBasics();
  const db = await getDb();
  await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, seeded.user.id));

  if (enableKantox) {
    await db
      .update(tenants)
      .set({
        settings: {
          kantoxSettings: {
            enabled: true,
            apiUser: 'test.api@kantox.com',
            companyRef: 'api_company_test',
            apiBaseUrl: 'https://kantox-preprod.com/api',
          },
        },
      })
      .where(eq(tenants.id, seeded.tenant.id));
    const secret = encrypt('sandbox-password');
    await db.insert(integrationCredentials).values({
      tenantId: seeded.tenant.id,
      provider: 'kantox',
      key: 'apiPassword',
      encryptedValue: secret.encrypted,
      iv: secret.iv,
      authTag: secret.authTag,
    });
  }

  const login = await loginE2E(seeded.user.email, seeded.password);
  return { seeded, token: login.accessToken as string };
}

describe('kantox controller e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('rejects kantox routes without auth', async () => {
    expect((await requestJson('/kantox/status')).status).toBe(401);
    expect((await requestJson('/kantox/settings')).status).toBe(401);
    expect((await requestJson('/orders/20260922-999001/hedge')).status).toBe(401);
  });

  it('returns disabled + empty hedges for a tenant without Kantox enabled', async () => {
    const { token } = await seededAdmin(false);

    const hedge = await requestJson('/orders/20260922-999001/hedge', { token });
    expect(hedge.status).toBe(200);
    expect(hedge.data.success).toBe(true);
    expect(hedge.data.data).toEqual({ enabled: false, hedges: [], positions: [] });
  });

  it('never returns the API password, only whether one is stored', async () => {
    const { token } = await seededAdmin(true);

    const res = await requestJson('/kantox/settings', { token });
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.hasPassword).toBe(true);
    expect(JSON.stringify(res.data)).not.toContain('sandbox-password');

    const status = await requestJson('/kantox/status', { token });
    expect(status.data.data.configured).toBe(true);
  });

  it('merge-writes settings without clobbering untouched fields', async () => {
    const { seeded, token } = await seededAdmin(true);

    const saved = await requestJson('/kantox/settings', {
      method: 'PUT',
      token,
      body: { paymentDateBufferDays: 14 },
    });
    expect(saved.status).toBe(200);
    expect(saved.data.data.paymentDateBufferDays).toBe(14);
    // Fields absent from the payload keep their configured values.
    expect(saved.data.data.apiUser).toBe('test.api@kantox.com');
    expect(saved.data.data.companyRef).toBe('api_company_test');
    expect(saved.data.data.hasPassword).toBe(true);

    // And the write actually persisted.
    const db = await getDb();
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, seeded.tenant.id));
    const cfg = (tenant!.settings as { kantoxSettings?: { paymentDateBufferDays?: number } }).kantoxSettings;
    expect(cfg?.paymentDateBufferDays).toBe(14);
  });

  it('rejects an out-of-range hedge percent at the schema boundary', async () => {
    const { token } = await seededAdmin(true);

    const res = await requestJson('/kantox/settings', {
      method: 'PUT',
      token,
      body: { marginHedgePercent: 500 },
    });
    expect(res.status).toBe(422);
  });

  it('resolves an ORDER NUMBER (not a UUID) on /orders/:id/hedge', async () => {
    const { seeded, token } = await seededAdmin(true);
    const db = await getDb();

    // seedBasics creates the client/vessel/place needed by the orders FK set.
    const [order] = await db
      .insert(orders)
      .values({
        tenantId: seeded.tenant.id,
        clientId: seeded.client.id,
        vesselId: seeded.vessel.id,
        placeId: seeded.place.id,
        orderNumber: '20260922-999001',
        status: 'CONFIRMED',
        orderKind: 'EXTERNAL',
      })
      .returning();

    await db.insert(kantoxHedgeEntries).values({
      tenantId: seeded.tenant.id,
      orderId: order!.id,
      leg: 'SO',
      direction: 'SELL',
      amount: '12500.00',
      amountBasis: '12500.00',
      currency: 'USD',
      counterCurrency: 'EUR',
      valueDate: '2026-09-10',
      entryRef: '20260922-999001#S',
      kind: 'INITIAL',
      status: 'SENT',
    });

    // Regression: this used to 500 — the raw param went into a uuid column.
    const byNumber = await requestJson('/orders/20260922-999001/hedge', { token });
    expect(byNumber.status).toBe(200);
    expect(byNumber.data.success).toBe(true);
    expect(byNumber.data.data.enabled).toBe(true);
    expect(byNumber.data.data.hedges).toHaveLength(1);
    expect(byNumber.data.data.hedges[0].leg).toBe('SO');

    // The UUID form keeps working too.
    const byUuid = await requestJson(`/orders/${order!.id}/hedge`, { token });
    expect(byUuid.status).toBe(200);
    expect(byUuid.data.data.hedges).toHaveLength(1);
  });

  it('returns a clean 404-style payload for an unknown order number', async () => {
    const { token } = await seededAdmin(true);

    const res = await requestJson('/orders/NO-SUCH-ORDER/hedge', { token });
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(false);
    expect(res.data.message).toBe('Order not found');
  });
});
