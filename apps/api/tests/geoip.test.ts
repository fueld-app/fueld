import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { __geoipTestUtils, lookupIp, lookupIpSync } from '../src/modules/activity/geoip';

beforeEach(() => {
  __geoipTestUtils.clearCache();
});

afterEach(() => {
  __geoipTestUtils.clearCache();
  __geoipTestUtils.resetFetchImpl();
});

describe('geoip', () => {
  let sequence = 0;
  const suiteSalt = (Date.now() ^ Math.floor(Math.random() * 1_000_000)) >>> 0;

  const uniqueIp = (lastOctet: number): string => {
    sequence += 1;
    const thirdOctet = ((suiteSalt >>> 8) + sequence) & 0xff;
    const fourthOctet = ((suiteSalt & 0xff) + lastOctet + sequence) & 0xff;
    return `203.0.${thirdOctet}.${fourthOctet}`;
  };

  test.serial('returns empty for null or private IP without network calls', async () => {
    let callCount = 0;
    __geoipTestUtils.setFetchImpl((async (_input: RequestInfo | URL, _init?: RequestInit) => {
      callCount += 1;
      throw new Error('should not fetch');
    }) as unknown as typeof globalThis.fetch);

    expect(await lookupIp(null)).toEqual({ country: null, city: null });
    expect(await lookupIp('127.0.0.1')).toEqual({ country: null, city: null });
    expect(await lookupIp('10.0.0.1')).toEqual({ country: null, city: null });

    expect(callCount).toBe(0);
  });

  test.serial('normalizes IPv4 with port and caches successful response', async () => {
    const baseIp = uniqueIp(42);
    const ipWithPort = `${baseIp}:52314`;
    let callCount = 0;
    __geoipTestUtils.setFetchImpl((async (input: RequestInfo | URL, _init?: RequestInit) => {
      callCount += 1;
      const url = String(input);
      expect(url).toContain(`/${baseIp}?fields=`);
      return new Response(JSON.stringify({ status: 'success', countryCode: 'DK', city: 'Aarhus' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof globalThis.fetch);

    const first = await lookupIp(ipWithPort);
    const second = await lookupIp(baseIp);

    expect(first).toEqual({ country: 'DK', city: 'Aarhus' });
    expect(second).toEqual({ country: 'DK', city: 'Aarhus' });
    expect(callCount).toBe(1);
  });

  test.serial('returns empty when provider reports non-success and then uses cached empty', async () => {
    const ip = uniqueIp(11);
    let callCount = 0;
    __geoipTestUtils.setFetchImpl((async (_input: RequestInfo | URL, _init?: RequestInit) => {
      callCount += 1;
      return new Response(JSON.stringify({ status: 'fail' }), { status: 200 });
    }) as unknown as typeof globalThis.fetch);

    const first = await lookupIp(ip);
    const second = await lookupIp(ip);

    expect(first).toEqual({ country: null, city: null });
    expect(second).toEqual({ country: null, city: null });
    expect(callCount).toBe(1);
  });

  test.serial('lookupIpSync returns empty immediately and hydrates cache in background', async () => {
    const ip = uniqueIp(21);
    let callCount = 0;
    __geoipTestUtils.setFetchImpl((async (_input: RequestInfo | URL, _init?: RequestInit) => {
      callCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(
        JSON.stringify({ status: 'success', countryCode: 'NO', city: 'Oslo' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof globalThis.fetch);

    const immediate = lookupIpSync(ip);
    expect(immediate).toEqual({ country: null, city: null });

    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = lookupIpSync(ip);

    expect(after).toEqual({ country: 'NO', city: 'Oslo' });
    expect(callCount).toBe(1);
  });
});
