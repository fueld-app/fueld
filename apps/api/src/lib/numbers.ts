// ═══════════════════════════════════════════════════════════════════════
//  Numeric parsing — one primitive for money-adjacent values.
//
//  Two broker-deal modules (the commission report and the profit column)
//  computed the same concept from the same columns and disagreed, because one
//  used `??` and the other `||` to chain its fallbacks. That is a money bug
//  waiting for a zero to be stored. Both now resolve rates through here.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Parse to a finite number, or `null` when the value is absent or not finite.
 *
 * Returns `null` — not `0` — for absent/unparsable input, so callers can chain
 * fallbacks with `??` and distinguish "this field is unset" from "this field is
 * deliberately zero".
 *
 * Why each guard exists:
 *
 * - **Blank strings → null.** `Number('')` is `0` and `Number('  ')` is `0`.
 *   Without this, a blank rate silently becomes a real $0 that *overrides* a
 *   valid fallback — which is exactly how the broker commission report managed
 *   to report zero on every deal.
 * - **`Number.isFinite` → null.** Rejects `NaN` and `Infinity`. Postgres
 *   `numeric` accepts the literals `'NaN'` and `'Infinity'`, and the item write
 *   path's `sanitizeNumeric` only nulls `''`/`'null'`/`'undefined'`, so such a
 *   value is storable. Un-guarded, `NaN` propagates through a running sum and
 *   poisons an entire report total.
 * - **Numbers pass through the same finiteness check**, so a `NaN` that
 *   arrived as a number is treated the same as one that arrived as a string.
 *
 * Callers that need a plain number rather than a fallback chain should write
 * `toFiniteNumber(v) ?? 0`.
 */
export function toFiniteNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
