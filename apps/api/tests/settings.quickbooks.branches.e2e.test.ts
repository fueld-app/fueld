import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
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
