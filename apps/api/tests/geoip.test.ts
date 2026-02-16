import { afterEach, describe, expect, test } from 'bun:test';
import { lookupIp, lookupIpSync } from '../src/modules/activity/geoip';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('geoip', () => {
  test('returns empty for null or private IP without network calls', async () => {
    let callCount = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      callCount += 1;
      throw new Error('should not fetch');
    }) as unknown as typeof globalThis.fetch;

    expect(await lookupIp(null)).toEqual({ country: null, city: null });
    expect(await lookupIp('127.0.0.1')).toEqual({ country: null, city: null });
    expect(await lookupIp('10.0.0.1')).toEqual({ country: null, city: null });

    expect(callCount).toBe(0);
  });

  test('normalizes IPv4 with port and caches successful response', async () => {
    const ipWithPort = '203.0.113.42:52314';
    let callCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
      callCount += 1;
      const url = String(input);
      expect(url).toContain('/203.0.113.42?fields=');
      return new Response(JSON.stringify({ status: 'success', countryCode: 'DK', city: 'Aarhus' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof globalThis.fetch;

    const first = await lookupIp(ipWithPort);
    const second = await lookupIp('203.0.113.42');

    expect(first).toEqual({ country: 'DK', city: 'Aarhus' });
    expect(second).toEqual({ country: 'DK', city: 'Aarhus' });
    expect(callCount).toBe(1);
  });

  test('returns empty when provider reports non-success and then uses cached empty', async () => {
    let callCount = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      callCount += 1;
      return new Response(JSON.stringify({ status: 'fail' }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const first = await lookupIp('198.51.100.11');
    const second = await lookupIp('198.51.100.11');

    expect(first).toEqual({ country: null, city: null });
    expect(second).toEqual({ country: null, city: null });
    expect(callCount).toBe(1);
  });

  test('lookupIpSync returns empty immediately and hydrates cache in background', async () => {
    let callCount = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      callCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(
        JSON.stringify({ status: 'success', countryCode: 'NO', city: 'Oslo' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof globalThis.fetch;

    const immediate = lookupIpSync('198.51.100.21');
    expect(immediate).toEqual({ country: null, city: null });

    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = lookupIpSync('198.51.100.21');

    expect(after).toEqual({ country: 'NO', city: 'Oslo' });
    expect(callCount).toBe(1);
  });
});
