// ═══════════════════════════════════════════════════════════════════════
//  Unit tests for lib/numbers.toFiniteNumber
//
//  This is the single parsing primitive for money-adjacent values across the
//  broker commission report and the broker-deal profit column. They previously
//  disagreed on the same data (one chained fallbacks with `??`, the other with
//  `||`) and reported different money for one deal, so the edge cases here are
//  pinned directly rather than only through the modules that consume it.
// ═══════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'bun:test';
import { toFiniteNumber } from '../../src/lib/numbers';

describe('toFiniteNumber', () => {
  it('returns null for absent input, so callers can chain with ??', () => {
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
  });

  it('returns null for blank and whitespace strings', () => {
    // Number('') and Number('  ') are both 0. Un-guarded, a blank rate becomes
    // a real $0 that overrides the next fallback — which is how the commission
    // report came to report zero on every deal.
    expect(toFiniteNumber('')).toBeNull();
    expect(toFiniteNumber('   ')).toBeNull();
    expect(toFiniteNumber('\t\n')).toBeNull();
  });

  it('parses valid numeric strings, including signs and exponents', () => {
    expect(toFiniteNumber('3')).toBe(3);
    expect(toFiniteNumber('3.5')).toBe(3.5);
    expect(toFiniteNumber('-3.5')).toBe(-3.5);
    expect(toFiniteNumber('1e2')).toBe(100);
    expect(toFiniteNumber('0')).toBe(0);
    expect(toFiniteNumber('  42  ')).toBe(42);
  });

  it('passes finite numbers through unchanged, including zero', () => {
    expect(toFiniteNumber(0)).toBe(0);
    expect(toFiniteNumber(-1.25)).toBe(-1.25);
    expect(toFiniteNumber(1e9)).toBe(1e9);
  });

  it('returns null for NaN and Infinity in either representation', () => {
    // Postgres numeric accepts the literals 'NaN' and 'Infinity' (verified on
    // this deployment, PG16) and sanitizeNumeric only nulls
    // ''/'null'/'undefined', so these are storable and must not reach a sum.
    expect(toFiniteNumber('NaN')).toBeNull();
    expect(toFiniteNumber('Infinity')).toBeNull();
    expect(toFiniteNumber('-Infinity')).toBeNull();
    expect(toFiniteNumber(NaN)).toBeNull();
    expect(toFiniteNumber(Infinity)).toBeNull();
    expect(toFiniteNumber(-Infinity)).toBeNull();
  });

  it('returns null for unparsable strings rather than guessing a prefix', () => {
    expect(toFiniteNumber('abc')).toBeNull();
    expect(toFiniteNumber('3abc')).toBeNull();
    // parseFloat would have returned 3 here, silently truncating malformed
    // input into a plausible-looking rate. Falling through is safer.
    expect(toFiniteNumber('3,5')).toBeNull();
  });

  it('distinguishes a deliberate zero from an absent value', () => {
    // The whole point of returning null rather than 0: a stored 0 is a real
    // "earns nothing" and must win, whereas absent input must fall through.
    expect(toFiniteNumber('0')).toBe(0);
    expect(toFiniteNumber('')).toBeNull();
    expect(toFiniteNumber('0') ?? 7).toBe(0);
    expect(toFiniteNumber('') ?? 7).toBe(7);
  });

  it('rejects non-string, non-number types instead of JS-coercing them', () => {
    // TypeScript forbids these, but unvalidated JSON can deliver them:
    // Number(true) is 1 and Number(['5']) is 5, either of which would win a ??
    // chain as a plausible-looking rate.
    expect(toFiniteNumber(true as unknown as number)).toBeNull();
    expect(toFiniteNumber(false as unknown as number)).toBeNull();
    expect(toFiniteNumber(['5'] as unknown as string)).toBeNull();
    expect(toFiniteNumber({} as unknown as number)).toBeNull();
  });

  it('keeps a running sum finite when a poisoned value is chained', () => {
    const rows = ['100', 'NaN', '50', ''];
    const total = rows.reduce<number>((sum, r) => sum + (toFiniteNumber(r) ?? 0), 0);
    expect(Number.isFinite(total)).toBe(true);
    expect(total).toBe(150);
  });
});
