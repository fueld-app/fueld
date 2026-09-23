import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { orders, orderItems, users } from '../src/db/schema';
import { ensureOrderInvoice, listLiveOrderInvoices } from '../src/modules/orders/invoice.service';
import { setOrderPaymentSchedule } from '../src/modules/orders/payment-schedule.service';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson, requestRaw } from './helpers/e2e';

describe('settings quickbooks branch e2e', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    QB_CLIENT_ID: process.env['QB_CLIENT_ID'],
    QB_CLIENT_SECRET: process.env['QB_CLIENT_SECRET'],
    QB_REDIRECT_URI: process.env['QB_REDIRECT_URI'],
    CORS_ORIGIN: process.env['CORS_ORIGIN'],
  };

  beforeEach(async () => {
    await truncateAll();
    globalThis.fetch = originalFetch;
    process.env['QB_CLIENT_ID'] = 'qb-client-id';
    process.env['QB_CLIENT_SECRET'] = 'qb-client-secret';
    process.env['QB_REDIRECT_URI'] = 'http://localhost:3000/admin/settings/integrations/quickbooks/callback';
    process.env['CORS_ORIGIN'] = 'http://localhost:4200';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env['QB_CLIENT_ID'] = originalEnv.QB_CLIENT_ID;
    process.env['QB_CLIENT_SECRET'] = originalEnv.QB_CLIENT_SECRET;
    process.env['QB_REDIRECT_URI'] = originalEnv.QB_REDIRECT_URI;
    process.env['CORS_ORIGIN'] = originalEnv.CORS_ORIGIN;
  });

  async function adminToken(): Promise<string> {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const login = await loginE2E(seeded.user.email, seeded.password);
    if (!login.accessToken) {
      throw new Error('Expected login to return an accessToken');
    }
    return login.accessToken;
  }

  async function getOAuthState(token: string): Promise<string> {
    const authUrlRes = await requestJson('/admin/settings/integrations/quickbooks/auth-url', { token });
    expect(authUrlRes.status).toBe(200);
    expect(authUrlRes.data?.success).toBe(true);

    const authUrl = String(authUrlRes.data?.data?.authUrl ?? '');
    const state = new URL(authUrl).searchParams.get('state');
    if (!state) {
      throw new Error('QuickBooks auth-url did not include a state parameter');
    }
    return state;
  }

  it('redirects with token_exchange reason when OAuth token exchange fails', async () => {
    const token = await adminToken();
    const state = await getOAuthState(token);

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/oauth2/v1/tokens/bearer')) {
        return new Response('invalid_grant', { status: 400, statusText: 'Bad Request' });
      }
      return originalFetch(input, init);
    }) as unknown as typeof globalThis.fetch;

    const callback = await requestRaw(`/admin/settings/integrations/quickbooks/callback?code=bad&realmId=1234&state=${state}`, { token });
    expect(callback.status).toBe(302);
    expect(String(callback.headers.get('location') ?? '')).toContain('qb=error&reason=token_exchange');
  });

  it('redirects with unknown reason when OAuth callback throws unexpectedly', async () => {
    const token = await adminToken();
    const state = await getOAuthState(token);

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/oauth2/v1/tokens/bearer')) {
        throw new Error('network down');
      }
      return originalFetch(input, init);
    }) as unknown as typeof globalThis.fetch;

    const callback = await requestRaw(`/admin/settings/integrations/quickbooks/callback?code=abc&realmId=5678&state=${state}`, { token });
    expect(callback.status).toBe(302);
    expect(String(callback.headers.get('location') ?? '')).toContain('qb=error&reason=unknown');
  });

  it('disconnect succeeds and clears status even if token revoke request fails', async () => {
    const token = await adminToken();
    const state = await getOAuthState(token);

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/oauth2/v1/tokens/bearer')) {
        return new Response(JSON.stringify({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          x_refresh_token_expires_in: 8640000,
          token_type: 'bearer',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.includes('/v3/company/') && String(init?.headers ? JSON.stringify(init.headers) : '').length >= 0) {
        return new Response(JSON.stringify({ CompanyInfo: { CompanyName: 'QB E2E Co' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.includes('/v2/oauth2/tokens/revoke')) {
        throw new Error('revoke network failure');
      }

      return originalFetch(input, init);
    }) as unknown as typeof globalThis.fetch;

    const callback = await requestRaw(`/admin/settings/integrations/quickbooks/callback?code=ok&realmId=9999&state=${state}`, { token });
    expect(callback.status).toBe(302);
    expect(String(callback.headers.get('location') ?? '')).toContain('qb=connected');

    const disconnect = await requestJson('/admin/settings/integrations/quickbooks', {
      method: 'DELETE',
      token,
    });

    expect(disconnect.status).toBe(200);
    expect(disconnect.data?.success).toBe(true);

    const integrations = await requestJson('/admin/settings/integrations', { token });
    expect(integrations.status).toBe(200);
    expect(integrations.data?.success).toBe(true);

    const items = (integrations.data?.data ?? []) as Array<{ provider: string; configured: boolean }>;
    const qb = items.find((item) => item.provider === 'QUICKBOOKS');
    expect(qb?.configured).toBe(false);
  });
});

describe('quickbooks split-terms refusal (HTTP)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    await truncateAll();
    globalThis.fetch = originalFetch;
  });

  it('refuses to sync a split order, names the alternative, and exposes it as a route', async () => {
    // Seed ONCE: a second seedAuthBasics collides on the tenant domain.
    const seeded = await seedAuthBasics();
    const db = await getDb();
    await db.update(users).set({ role: 'ADMIN', updatedAt: new Date() }).where(eq(users.id, seeded.user.id));
    const login = await loginE2E(seeded.user.email, seeded.password);
    if (!login.accessToken) throw new Error('Expected login to return an accessToken');
    const token = login.accessToken;
    const { tenant, client, vessel, place } = seeded;

    const [order] = await db.insert(orders).values({
      tenantId: tenant.id, clientId: client.id, vesselId: vessel.id, placeId: place.id,
      orderNumber: `QBSPLIT-${Date.now()}`, currency: 'USD', status: 'DELIVERED',
      customerPaymentTermType: 'CREDIT', customerCreditDays: 21,
    }).returning();
    await db.insert(orderItems).values({
      orderId: order!.id, productType: 'VLSFO', quantity: '100', unit: 'MT',
      costPrice: '600', salesPrice: '5000', costCurrency: 'USD', salesCurrency: 'USD',
    });
    await setOrderPaymentSchedule(order!.id, [
      { label: 'Deposit', percent: 50, dueBasis: 'ON_ISSUE' },
      { label: 'Balance', percent: 50, dueBasis: 'FROM_DELIVERY', creditDays: 21 },
    ]);
    await ensureOrderInvoice(order!.id);
    const live = await listLiveOrderInvoices(order!.id);
    expect(live.length).toBe(2);

    // "The order's invoice" is not a single document, so the order-level sync
    // must refuse rather than push one tranche and call the order synced.
    const orderSync = await requestJson(`/admin/settings/integrations/quickbooks/sync-order/${order!.id}`, {
      method: 'POST', token,
    });
    expect(orderSync.data?.success).toBe(false);
    expect(String(orderSync.data?.message ?? '')).toContain('sync each invoice');

    // The order-sync status must not claim a half-synced order is done.
    const status = await requestJson(`/admin/settings/integrations/quickbooks/order-status/${order!.id}`, { token });
    expect(status.status).toBe(200);
    expect((status.data?.data as { synced: boolean } | null)?.synced).toBe(false);

    // And the per-invoice route the refusal points at must exist (it fails on
    // configuration, not on a missing route).
    const perInvoice = await requestJson(`/admin/settings/integrations/quickbooks/sync-invoice/${live[0]!.id}`, {
      method: 'POST', token,
    });
    expect(perInvoice.status).toBe(200);
    expect(String(perInvoice.data?.message ?? '')).not.toContain('not found');
  });
});
