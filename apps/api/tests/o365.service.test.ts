import { afterEach, describe, expect, test } from 'bun:test';
import { validateO365Token } from '../src/modules/auth/o365.service';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('o365.service', () => {
  test('returns profile when graph API responds with usable identity fields', async () => {
    globalThis.fetch = ((async () =>
      new Response(
        JSON.stringify({
          id: 'ms-1',
          displayName: 'Microsoft User',
          mail: 'user@test.local',
          userPrincipalName: 'user@test.local',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as unknown) as typeof fetch;

    const profile = await validateO365Token('valid-token');
    expect(profile).toEqual({
      id: 'ms-1',
      displayName: 'Microsoft User',
      mail: 'user@test.local',
      userPrincipalName: 'user@test.local',
    });
  });

  test('returns null when graph API response is non-OK', async () => {
    globalThis.fetch = ((async () => new Response('unauthorized', { status: 401 })) as unknown) as typeof fetch;

    const profile = await validateO365Token('bad-token');
    expect(profile).toBeNull();
  });

  test('returns null when neither mail nor userPrincipalName is present', async () => {
    globalThis.fetch = ((async () =>
      new Response(
        JSON.stringify({
          id: 'ms-2',
          displayName: 'No Email User',
          mail: null,
          userPrincipalName: '',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as unknown) as typeof fetch;

    const profile = await validateO365Token('missing-email-token');
    expect(profile).toBeNull();
  });

  test('returns null when fetch throws', async () => {
    globalThis.fetch = ((async () => {
      throw new Error('network down');
    }) as unknown) as typeof fetch;

    const profile = await validateO365Token('throws-token');
    expect(profile).toBeNull();
  });
});
