import { describe, expect, test } from 'bun:test';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  CSRF_COOKIE,
  STATE_CHANGING_METHODS,
  generateCsrfToken,
  flattenElysiaCookies,
  parseCookieHeader,
  setAuthCookies,
  clearAuthCookies,
  extractAccessToken,
  extractRefreshToken,
  validateCsrfToken,
  resolveAccessToken,
} from '../src/modules/auth/jwt.setup';

const isProd = process.env['NODE_ENV'] === 'production';
const secure = isProd;

describe('cookie / csrf helpers', () => {
  // ── generateCsrfToken ────────────────────────────────────────────
  describe('generateCsrfToken', () => {
    test('returns a non-empty token', () => {
      const t = generateCsrfToken();
      expect(t.length).toBeGreaterThan(0);
    });

    test('two calls produce different tokens', () => {
      expect(generateCsrfToken()).not.toBe(generateCsrfToken());
    });

    test('is 64 hex chars (256 bits)', () => {
      expect(generateCsrfToken()).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ── flattenElysiaCookies ──────────────────────────────────────────
  describe('flattenElysiaCookies', () => {
    test('extracts .value from each cookie', () => {
      const flat = flattenElysiaCookies({
        fueld_access: { value: 'access-jwt' },
        fueld_csrf: { value: 'csrf-token' },
      });
      expect(flat).toEqual({ fueld_access: 'access-jwt', fueld_csrf: 'csrf-token' });
    });

    test('skips cookies without a value', () => {
      const flat = flattenElysiaCookies({
        fueld_access: { value: 'access-jwt' },
        empty: { value: undefined },
        missing: undefined,
      });
      expect(flat).toEqual({ fueld_access: 'access-jwt' });
    });

    test('handles null/undefined input', () => {
      expect(flattenElysiaCookies(undefined)).toEqual({});
      expect(flattenElysiaCookies(null)).toEqual({});
    });
  });

  // ── parseCookieHeader ─────────────────────────────────────────────
  describe('parseCookieHeader', () => {
    test('parses a Cookie header', () => {
      expect(parseCookieHeader('fueld_access=abc; fueld_csrf=xyz')).toEqual({
        fueld_access: 'abc',
        fueld_csrf: 'xyz',
      });
    });

    test('decodes percent-encoded values', () => {
      expect(parseCookieHeader('fueld_access=a%2Bb')).toEqual({ fueld_access: 'a+b' });
    });

    test('handles empty header', () => {
      expect(parseCookieHeader('')).toEqual({});
    });

    test('handles values containing =', () => {
      expect(parseCookieHeader('fueld_access=a=b=c')).toEqual({ fueld_access: 'a=b=c' });
    });
  });

  // ── extractAccessToken ───────────────────────────────────────────
  describe('extractAccessToken', () => {
    test('prefers the cookie', () => {
      expect(
        extractAccessToken(
          { authorization: 'Bearer header-token' },
          { fueld_access: 'cookie-token' },
        ),
      ).toBe('cookie-token');
    });

    test('falls back to Authorization: Bearer', () => {
      expect(extractAccessToken({ authorization: 'Bearer header-token' }, {})).toBe('header-token');
    });

    test('returns null when neither is present', () => {
      expect(extractAccessToken({}, {})).toBeNull();
    });

    test('returns null for a malformed Authorization header', () => {
      expect(extractAccessToken({ authorization: 'Token abc' }, {})).toBeNull();
    });
  });

  // ── extractRefreshToken ──────────────────────────────────────────
  describe('extractRefreshToken', () => {
    test('prefers the cookie', () => {
      expect(extractRefreshToken({ fueld_refresh: 'cookie-rt' }, { refreshToken: 'body-rt' })).toBe('cookie-rt');
    });

    test('falls back to body.refreshToken', () => {
      expect(extractRefreshToken({}, { refreshToken: 'body-rt' })).toBe('body-rt');
    });

    test('returns null when neither is present', () => {
      expect(extractRefreshToken({}, {})).toBeNull();
      expect(extractRefreshToken({})).toBeNull();
    });
  });

  // ── validateCsrfToken ───────────────────────────────────────────
  describe('validateCsrfToken', () => {
    test('true when header matches cookie', () => {
      expect(validateCsrfToken({ 'x-csrf-token': 'match' }, { fueld_csrf: 'match' })).toBe(true);
    });

    test('false on mismatch', () => {
      expect(validateCsrfToken({ 'x-csrf-token': 'nope' }, { fueld_csrf: 'match' })).toBe(false);
    });

    test('false when the header is missing', () => {
      expect(validateCsrfToken({}, { fueld_csrf: 'match' })).toBe(false);
    });

    test('false when the cookie is missing', () => {
      expect(validateCsrfToken({ 'x-csrf-token': 'match' }, {})).toBe(false);
    });

    test('is constant-time (equal-length mismatches still compare fully)', () => {
      // Not a true timing test, but confirms a same-length wrong token is rejected.
      expect(validateCsrfToken({ 'x-csrf-token': 'aaaaaaaa' }, { fueld_csrf: 'bbbbbbbb' })).toBe(false);
    });
  });

  // ── resolveAccessToken ───────────────────────────────────────────
  describe('resolveAccessToken', () => {
    test('ok with a cookie on a GET', () => {
      const r = resolveAccessToken({}, { fueld_access: 'cookie-token' }, 'GET');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.token).toBe('cookie-token');
    });

    test('ok with a cookie on a POST when CSRF matches', () => {
      const r = resolveAccessToken(
        { 'x-csrf-token': 'csrf' },
        { fueld_access: 'cookie-token', fueld_csrf: 'csrf' },
        'POST',
      );
      expect(r.ok).toBe(true);
    });

    test('csrf failure on a POST with a cookie but no X-CSRF-Token', () => {
      const r = resolveAccessToken({}, { fueld_access: 'cookie-token', fueld_csrf: 'csrf' }, 'POST');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('csrf');
    });

    test('csrf failure on a POST with a mismatched X-CSRF-Token', () => {
      const r = resolveAccessToken(
        { 'x-csrf-token': 'wrong' },
        { fueld_access: 'cookie-token', fueld_csrf: 'csrf' },
        'POST',
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('csrf');
    });

    test('ok with a Bearer header on a POST (CSRF skipped)', () => {
      const r = resolveAccessToken({ authorization: 'Bearer header-token' }, {}, 'POST');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.token).toBe('header-token');
    });

    test('missing when no token at all', () => {
      const r = resolveAccessToken({}, {}, 'POST');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('missing');
    });
  });

  // ── STATE_CHANGING_METHODS ───────────────────────────────────────
  test('STATE_CHANGING_METHODS covers POST/PUT/PATCH/DELETE', () => {
    expect(STATE_CHANGING_METHODS.has('POST')).toBe(true);
    expect(STATE_CHANGING_METHODS.has('PUT')).toBe(true);
    expect(STATE_CHANGING_METHODS.has('PATCH')).toBe(true);
    expect(STATE_CHANGING_METHODS.has('DELETE')).toBe(true);
    expect(STATE_CHANGING_METHODS.has('GET')).toBe(false);
  });

  // ── setAuthCookies ───────────────────────────────────────────────
  describe('setAuthCookies', () => {
    test('writes all three cookies in the object form with correct attributes', () => {
      const set: { cookie?: Record<string, Record<string, unknown>> } = {};
      setAuthCookies(set, 'access-jwt', 'refresh-jwt', 'csrf-token');

      expect(set.cookie).toBeDefined();
      const access = set.cookie![ACCESS_COOKIE];
      expect(access).toMatchObject({
        value: 'access-jwt',
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure,
        maxAge: 15 * 60,
      });

      const refresh = set.cookie![REFRESH_COOKIE];
      expect(refresh).toMatchObject({
        value: 'refresh-jwt',
        path: '/api/auth/refresh',
        httpOnly: true,
        sameSite: 'lax',
        secure,
        maxAge: 7 * 86400,
      });

      const csrf = set.cookie![CSRF_COOKIE];
      expect(csrf).toMatchObject({
        value: 'csrf-token',
        path: '/',
        httpOnly: false, // JS must read this
        sameSite: 'lax',
        secure,
      });
      // CSRF lifetime matches the refresh cookie so silent refresh always has a token.
      expect(csrf!.maxAge).toBe(7 * 86400);
    });

    test('initializes the jar when absent', () => {
      const set: { cookie?: Record<string, Record<string, unknown>> } = {};
      setAuthCookies(set, 'a', 'b', 'c');
      expect(set.cookie).toBeDefined();
      expect(Object.keys(set.cookie!).length).toBe(3);
    });
  });

  // ── clearAuthCookies ──────────────────────────────────────────────
  describe('clearAuthCookies', () => {
    test('clears each cookie with Max-Age=0 and the matching Path', () => {
      const set: { cookie?: Record<string, Record<string, unknown>> } = {};
      clearAuthCookies(set);

      expect(set.cookie).toBeDefined();
      expect(set.cookie![ACCESS_COOKIE]).toMatchObject({ value: '', path: '/', maxAge: 0 });
      expect(set.cookie![REFRESH_COOKIE]).toMatchObject({
        value: '',
        path: '/api/auth/refresh',
        maxAge: 0,
      });
      expect(set.cookie![CSRF_COOKIE]).toMatchObject({ value: '', path: '/', maxAge: 0 });
    });
  });
});