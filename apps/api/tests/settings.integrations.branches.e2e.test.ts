import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

describe('settings integrations branch e2e', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    await truncateAll();
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function adminToken() {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const login = await loginE2E(seeded.user.email, seeded.password);
    return login.accessToken;
  }

  it('maps LLI verification HTTP failures through controller response', async () => {
    const token = await adminToken();

    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('lloydslistintelligence.com/v1/tokenprovider')) {
        return new Response('bad creds', {
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'content-type': 'text/plain' },
        });
      }
      return originalFetch(input, _init);
    }) as unknown as typeof globalThis.fetch;

    const lli = await requestJson('/admin/settings/integrations/lli', {
      method: 'PUT',
      token,
      body: { username: 'lli-user', password: 'lli-pass' },
    });

    expect(lli.status).toBe(200);
    expect(lli.data?.success).toBe(false);
    expect(String(lli.data?.message ?? '')).toContain('Verification failed: 401 Unauthorized');
  });

  it('maps LLI invalid-payload verification failures through controller response', async () => {
    const token = await adminToken();

    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('lloydslistintelligence.com/v1/tokenprovider')) {
        return new Response(JSON.stringify({ Message: 'Denied', Payload: '' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return originalFetch(input, _init);
    }) as unknown as typeof globalThis.fetch;

    const lli = await requestJson('/admin/settings/integrations/lli', {
      method: 'PUT',
      token,
      body: { username: 'lli-user', password: 'lli-pass' },
    });

    expect(lli.status).toBe(200);
    expect(lli.data?.success).toBe(false);
    expect(String(lli.data?.message ?? '')).toContain('Invalid credentials — LLI returned: Denied');
  });

  it('persists LLI credentials and reports configured status on successful verification', async () => {
    const token = await adminToken();

    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('lloydslistintelligence.com/v1/tokenprovider')) {
        return new Response(JSON.stringify({ Message: 'Success', Payload: 'token123' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return originalFetch(input, _init);
    }) as unknown as typeof globalThis.fetch;

    const lli = await requestJson('/admin/settings/integrations/lli', {
      method: 'PUT',
      token,
      body: { username: 'lli-user', password: 'lli-pass' },
    });

    expect(lli.status).toBe(200);
    expect(lli.data?.success).toBe(true);

    const integrations = await requestJson('/admin/settings/integrations', { token });
    expect(integrations.status).toBe(200);
    expect(integrations.data?.success).toBe(true);

    const items = (integrations.data?.data ?? []) as Array<{ provider: string; configured: boolean; username?: string | null }>;
    const lliStatus = items.find((item) => item.provider === 'LLI');
    expect(lliStatus?.configured).toBe(true);
    expect(lliStatus?.username).toBe('lli-user');
  });
});
