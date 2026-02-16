import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { seedBasics, truncateAll } from './helpers/db';

async function loadQuickBooksService() {
  return import('../src/modules/quickbooks/quickbooks.service');
}

const originalFetch = globalThis.fetch;
const ORIGINAL_ENV = {
  QB_CLIENT_ID: process.env.QB_CLIENT_ID,
  QB_CLIENT_SECRET: process.env.QB_CLIENT_SECRET,
  QB_REDIRECT_URI: process.env.QB_REDIRECT_URI,
  QB_ENVIRONMENT: process.env.QB_ENVIRONMENT,
  CORS_ORIGIN: process.env.CORS_ORIGIN,
};

function restoreEnv() {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function setQbEnv() {
  process.env.QB_CLIENT_ID = 'qb-client';
  process.env.QB_CLIENT_SECRET = 'qb-secret';
  process.env.QB_REDIRECT_URI = 'http://localhost:3000/qb/callback';
  process.env.QB_ENVIRONMENT = 'sandbox';
  process.env.CORS_ORIGIN = 'http://localhost:4200';
}

beforeEach(async () => {
  await truncateAll();
  restoreEnv();
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  restoreEnv();
  globalThis.fetch = originalFetch;
});

describe('quickbooks.service', () => {
  test('isAppConfigured reflects env and generateAuthUrl validates config', async () => {
    const qb = await loadQuickBooksService();

    delete process.env.QB_CLIENT_ID;
    delete process.env.QB_CLIENT_SECRET;

    expect(qb.isAppConfigured()).toBe(false);
    expect(() => qb.generateAuthUrl('user-id')).toThrow('QuickBooks app not configured');

    setQbEnv();
    expect(qb.isAppConfigured()).toBe(true);

    const url = qb.generateAuthUrl('user-id');
    expect(url.startsWith('https://appcenter.intuit.com/connect/oauth2?')).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get('client_id')).toBe('qb-client');
    expect(params.get('redirect_uri')).toBe('http://localhost:3000/qb/callback');
    expect(params.get('state')).toBeTruthy();
  });

  test('oauth callback online flow stores credentials, returns status, valid token, and disconnects', async () => {
    const { user } = await seedBasics();
    setQbEnv();
    const qb = await loadQuickBooksService();

    const fetchCalls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url.includes('/tokens/bearer')) {
        return new Response(
          JSON.stringify({
            access_token: 'access-1',
            refresh_token: 'refresh-1',
            expires_in: 3600,
            x_refresh_token_expires_in: 8640000,
            token_type: 'bearer',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/companyinfo/')) {
        return new Response(
          JSON.stringify({ CompanyInfo: { CompanyName: 'QB Sandbox Company' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/tokens/revoke')) {
        return new Response('', { status: 200 });
      }

      return new Response('', { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const authUrl = qb.generateAuthUrl(user.id);
    const state = new URL(authUrl).searchParams.get('state')!;

    const callback = await qb.handleOAuthCallback('auth-code', 'realm-123', state);
    expect(callback.success).toBe(true);
    expect(callback.redirectUrl).toContain('qb=connected');

    const status = await qb.getQuickBooksStatus();
    expect(status.configured).toBe(true);
    expect(status.connectionType).toBe('online');
    expect(status.realmId).toBe('realm-123');
    expect(status.companyName).toBe('QB Sandbox Company');

    const token = await qb.getValidAccessToken();
    expect(token).toEqual({ token: 'access-1', realmId: 'realm-123' });

    await qb.disconnect(user.id);
    const statusAfterDisconnect = await qb.getQuickBooksStatus();
    expect(statusAfterDisconnect.configured).toBe(false);

    expect(fetchCalls.some((u) => u.includes('/tokens/bearer'))).toBe(true);
    expect(fetchCalls.some((u) => u.includes('/companyinfo/'))).toBe(true);
    expect(fetchCalls.some((u) => u.includes('/tokens/revoke'))).toBe(true);
  });

  test('invalid oauth state returns error redirect and desktop credentials work', async () => {
    const { user } = await seedBasics();
    setQbEnv();
    const qb = await loadQuickBooksService();

    const invalid = await qb.handleOAuthCallback('code', 'realm-1', 'invalid-state');
    expect(invalid.success).toBe(false);
    expect(invalid.redirectUrl).toContain('invalid_state');

    await qb.setDesktopCredentials('Desktop Co', 'desktop-user', 'desktop-pass', user.id);

    const status = await qb.getQuickBooksStatus();
    expect(status.configured).toBe(true);
    expect(status.connectionType).toBe('desktop');
    expect(status.companyName).toBe('Desktop Co');

    const token = await qb.getValidAccessToken();
    expect(token).toBeNull();
  });

  test('refreshAccessToken returns false when no refresh token is configured', async () => {
    await seedBasics();
    setQbEnv();
    const qb = await loadQuickBooksService();

    const refreshed = await qb.refreshAccessToken();
    expect(refreshed).toBe(false);
  });

  test('getValidAccessToken refreshes and returns new token when current token is near expiry', async () => {
    const { user } = await seedBasics();
    setQbEnv();
    const qb = await loadQuickBooksService();

    const fetchCalls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push(url);

      if (url.includes('/tokens/bearer')) {
        const body = String(init?.body ?? '');
        if (body.includes('grant_type=authorization_code')) {
          return new Response(
            JSON.stringify({
              access_token: 'access-old',
              refresh_token: 'refresh-old',
              expires_in: 1,
              x_refresh_token_expires_in: 8640000,
              token_type: 'bearer',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (body.includes('grant_type=refresh_token')) {
          return new Response(
            JSON.stringify({
              access_token: 'access-new',
              refresh_token: 'refresh-new',
              expires_in: 3600,
              x_refresh_token_expires_in: 8640000,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
      }

      if (url.includes('/companyinfo/')) {
        return new Response(
          JSON.stringify({ CompanyInfo: { CompanyName: 'QB Refresh Co' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('', { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const authUrl = qb.generateAuthUrl(user.id);
    const state = new URL(authUrl).searchParams.get('state')!;

    const callback = await qb.handleOAuthCallback('auth-code', 'realm-refresh', state);
    expect(callback.success).toBe(true);

    const token = await qb.getValidAccessToken();
    expect(token).toEqual({ token: 'access-new', realmId: 'realm-refresh' });

    const tokenCalls = fetchCalls.filter((u) => u.includes('/tokens/bearer'));
    expect(tokenCalls.length).toBeGreaterThanOrEqual(2);
  });

  test('getValidAccessToken returns null when refresh attempt fails', async () => {
    const { user } = await seedBasics();
    setQbEnv();
    const qb = await loadQuickBooksService();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/tokens/bearer')) {
        const body = String(init?.body ?? '');
        if (body.includes('grant_type=authorization_code')) {
          return new Response(
            JSON.stringify({
              access_token: 'access-old',
              refresh_token: 'refresh-old',
              expires_in: 1,
              x_refresh_token_expires_in: 8640000,
              token_type: 'bearer',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (body.includes('grant_type=refresh_token')) {
          return new Response('refresh failed', { status: 500, statusText: 'Server Error' });
        }
      }

      if (url.includes('/companyinfo/')) {
        return new Response(
          JSON.stringify({ CompanyInfo: { CompanyName: 'QB Refresh Fail Co' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('', { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const authUrl = qb.generateAuthUrl(user.id);
    const state = new URL(authUrl).searchParams.get('state')!;

    const callback = await qb.handleOAuthCallback('auth-code', 'realm-refresh-fail', state);
    expect(callback.success).toBe(true);

    const token = await qb.getValidAccessToken();
    expect(token).toBeNull();
  });
});
