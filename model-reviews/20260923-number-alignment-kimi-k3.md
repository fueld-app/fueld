# Panel Review — broker-deal numeric alignment (`c255e5d6`)

## (1) Numbered Findings

**1. [LOW] `apps/api/src/lib/numbers.ts:1-39` — Module lacks unit tests for the new primitive.**
The shared `toFiniteNumber` function is now the single source of truth for money-adjacent parsing across two modules, yet has no dedicated test file. While the integration tests in `order-financing.test.ts` exercise it indirectly, edge cases like `toFiniteNumber('  ')`, `toFiniteNumber(Infinity)`, `toFiniteNumber('1e2')`, and `toFiniteNumber('0x10')` are unpinned.
**Fix:** Add `apps/api/tests/lib/numbers.test.ts` with ~10 cases covering null/undefined/blank/whitespace/NaN/Infinity/hex/exponential/valid inputs.

**2. [NIT] `apps/api/src/modules/orders/order-financing.ts:79-84` — Comment block is verbose for a one-line delegation.**
The JSDoc on `parseNumber` is 5 lines explaining history and motivation for what is now `return toFiniteNumber(value) ?? 0`. The context is valuable but better suited to the commit message or a `// See lib/numbers.ts` pointer.
**Fix:** Trim to `/** Numeric parse for financing maths — delegates to toFiniteNumber, coerces null → 0. */`

**3. [NIT] `apps/api/src/modules/reports/reports.service.ts:2493` — Stale comment reference.**
The comment says "the *guard* deliberately does not — see toFiniteNumber()" but the guard *is* now `toFiniteNumber()` — the same function used by order-financing. The "deliberately does not [match]" framing is leftover from when the two modules had different guards.
**Fix:** Update to "the guard now matches — both modules share `toFiniteNumber`."

**4. [LOW] `apps/api/src/lib/numbers.ts:33` — `Number()` accepts hex/binary/octal string literals.**
`Number('0x10')` is `16`, `Number('0b101')` is `5`, `Number('0o17')` is `15`. If any API consumer sends a hex-formatted string into a numeric field, it will parse as a valid number rather than falling through. This is vanishingly unlikely for money fields, and Postgres `numeric` would reject these on write, so the exposure is limited to values that never touch the database.
**Fix:** Optional — add a regex guard like `/^-?\d+(\.\d+)?$/` if strict decimal-only parsing is desired. Not blocking.

**5. [NIT] `apps/api/tests/order-financing.test.ts:542-547` — Comment header references a future date.**
The comment says "the incident of 2026-09-23" — presumably a typo for 2025-09-23 or the date is correct and this is being written in 2026. Either way, a hardcoded date in a test comment will become confusing.
**Fix:** Use "the broker commission incident" or reference the commit hash `016748cd` instead.

---

## (2) Answers to the 8 Focus Items

### 1. Is `toFiniteNumber` correct about `Number` vs `parseFloat`?

**Yes, `Number` is the right choice, and the comma-decimal behaviour change is correct.**

The old report used `parseFloat`, which would parse `'3,5'` as `3` — silently truncating a European decimal. The new code uses `Number('3,5')` → `NaN` → `null` → falls through to the next tier. This is the safer behaviour: a malformed value falls back rather than producing a wrong number.

The question of whether a "real European-locale path" writes `'3,5'` into a numeric column is answerable from the platform facts: the column is Postgres `numeric`, which **does not accept comma decimals** (`SELECT '3,5'::numeric` errors). So `'3,5'` can never be stored in the column. The only way it could appear is if a string value bypassed the database — which doesn't happen for these fields. The behaviour change is theoretical, not practical.

Additionally, `parseFloat('')` is `NaN` while `Number('')` is `0` — the trim guard handles this correctly. The choice of `Number` over `parseFloat` is deliberate and well-reasoned.

### 2. `parseNumber` semantics changed in a subtle way.

**Confirmed: no meaningful change.**

Old `parseNumber`:
- `number` → `Number.isFinite(value) ? value : 0`
- `string` → `Number(value)`, then `Number.isFinite(parsed) ? parsed : 0`
- `null`/`undefined` → `0`

New `parseNumber` → `toFiniteNumber(value) ?? 0`:
- `number` → same finiteness check, `0` for non-finite
- `string` blank → `null` → `0` (old: `Number('')` = `0` → `0`) — **same result**
- `string` non-blank → `Number(value)`, same finiteness check — **same result**
- `null`/`undefined` → `null` → `0` — **same result**

The only theoretical difference: old code for a string `'  '` (whitespace-only) would do `Number('  ')` = `0` → return `0`. New code returns `null` → `?? 0` → `0`. Same result. No caller can observe a difference.

### 3. Did aligning `||` → `??` change any real calculation?

**The only reachable difference is a per-line `0`, which is the intended fix.**

Old: `parseNumber(item.commissionPerUnit) || orderCommissionPerMt || 0`
New: `toFiniteNumber(item.commissionPerUnit) ?? orderCommissionPerMt ?? 0`

`parseNumber` never returns `null` — it returns `0` for absent/unparsable. So old code: if `parseNumber` returned `0` (whether from a genuine `'0'` or from absent input), `||` would fall through. New code: `toFiniteNumber` returns `null` for absent input (falls through via `??`) but `0` for a genuine `'0'` (does NOT fall through via `??`).

The `orderCommissionPerMt` parameter is typed `number | null` in `calculateLineEconomics` but is derived as `parseNumber(commissionPerMt) || 0` in `calculateOrderEconomics` — so it's always a `number`, never `null`, when called through that path. When called directly with `null` (as in the test `calculateLineEconomics(item(), 0.08, 30, true, null)`), `?? null ?? 0` → `0`, which is correct.

The platform facts confirm: "no per-line `0` exists anywhere" in Moxie production, and "the UI cannot store a per-line `0`". So this change has zero production impact today — it's a correctness fix for a state that can only arise from direct API writes or future UI changes. That's exactly the right kind of preventive fix.

### 4. `??` on a possibly-`undefined` property.

**No path where `orderCommissionPerMt` is `undefined`.**

`calculateLineEconomics` signature: `orderCommissionPerMt: number | null = null`. Default is `null`, not `undefined`. The sole internal caller `calculateOrderEconomics` passes `orderCommissionPerMt` which is derived as `parseNumber(commissionPerMt) || 0` — always a `number`. The tests pass either a number or explicit `null`. Even if `undefined` somehow arrived, `?? undefined ?? 0` → `0`, which is the correct fallback. No bug.

### 5. Is `toFiniteNumber` the right home and shape?

**Yes, with a minor caveat.**

`lib/numbers.ts` is the right home — it's a shared primitive, not domain logic. Returning `number | null` is the right shape because it forces callers to make an explicit decision about the fallback (`?? 0`, `?? 1`, `?? orderRate ?? 0`, etc.). A `toFiniteNumberOrZero` convenience would save `?? 0` at call sites but would re-introduce the ambiguity this commit exists to eliminate — callers would reach for the zero-defaulting version out of habit, even when they need fallback chaining.

The concern about `if (x)` bugs is valid in general but mitigated by TypeScript: `number | null` doesn't satisfy `number` without a narrowing check, so the compiler catches unguarded usage. The `??` operator handles `null` correctly. The contract is sound.

### 6. Are the 7 tests honest?

**Yes, and the author's own characterisation is accurate.**

The author explicitly states: "The `0`-rate test fails against the pre-commit `||` semantics... The other six pass both ways, so they are characterisation, not regression guards." This is honest and correct.

The six characterisation tests are not padding — they pin the shared semantics so that if someone later changes `toFiniteNumber` (e.g., switches to `parseFloat`, removes the trim guard), the tests catch it. They also serve as executable documentation of the resolution chain.

The delivered-quantity test does overlap with the report's own coverage, but it tests `calculateLineEconomics` directly (unit level) rather than the report (integration level). Both modules need to agree on quantity, so having the assertion in both places is justified.

### 7. Did I miss other `||`-chained numeric fallbacks of the same class?

**The remaining `||` sites are legitimately defaulting, not the same bug class.**

- `parseNumber(item.costConversionFactor) || 1` — A conversion factor of `0` is meaningless (would zero out the cost). `|| 1` treats `0` as "unset" and defaults to identity. This is correct: `0` is not a deliberate conversion factor, it's absent data.
- `parseNumber(item.unitConversionFactor) || 1` — Same reasoning.
- `orderCommissionPerMt = parseNumber(commissionPerMt) || 0` — This is the order-level rate. A `0` here means "no commission on this order," and `|| 0` produces `0` either way (from absent or from `0`). The result is identical. No bug.

The commission rate case was unique because `0` is a *meaningful deliberate value* ("this line earns no commission") that differs from the fallback ("use the order-level rate"). For conversion factors, `0` is never meaningful — it's always absent data. The distinction is correct.

### 8. The `'NaN'` claim.

**Postgres `numeric` does accept `'NaN'` — verified.**

This is documented PostgreSQL behaviour: `SELECT 'NaN'::numeric` returns `NaN`. Similarly `'Infinity'` and `'-Infinity'` are accepted since PostgreSQL 14. The `sanitizeNumeric` reference at `orders.service.ts:1971` is described as only nulling `''`/`'null'`/`'undefined'` — if accurate, a `'NaN'` string would pass through sanitisation and be stored.

I cannot verify the `sanitizeNumeric` implementation from the diff alone (it's not in the changed files), but the claim is consistent with the incident description and the guard's existence. If `sanitizeNumeric` does handle `'NaN'`, the guard is defensive depth rather than dead code — it also protects against `NaN` arriving as a JavaScript `number` type (e.g., from a computed field). Either way, the guard is cheap and correct.

---

## (3) What Is Done Well

- **Root cause addressed, not symptom.** The fix doesn't just change `||` to `??` — it extracts the parsing logic into a shared primitive so the two modules cannot drift again. This is the right structural response to a divergence bug.
- **The comment in `numbers.ts` is exemplary.** It explains *why* each guard exists, references the specific incident, and documents the Postgres `numeric` behaviour. Future maintainers won't need to rediscover this.
- **The blank-string guard is the subtle win.** `Number('') === 0` is a well-known JavaScript footgun. Without the trim guard, a blank rate would silently become `$0` and override a valid fallback — reproducing the original incident. The guard is correct and well-tested.
- **Honest test characterisation.** The author explicitly states which tests are regression guards and which are characterisation. No inflated claims.
- **The `?? 0` tail on `parseNumber` preserves backward compatibility** for all existing callers while the new `toFiniteNumber` enables correct fallback chaining for the commission path.

---

## (4) Verified-by-Reading vs Unverifiable

**Verified by reading the diff:**
- `toFiniteNumber` implementation is correct for all input types (null, undefined, string, number).
- `parseNumber` delegation preserves existing behaviour (focus item 2).
- The `||` → `??` change at line 246 is correct and the only reachable difference is per-line `0` (focus item 3).
- `orderCommissionPerMt` cannot be `undefined` in any visible path (focus item 4).
- The remaining `||` sites are legitimately defaulting (focus item 7).
- The tests correctly exercise the changed semantics.
- `reports.service.ts` cleanly replaces `num()` with `toFiniteNumber` — the functions are identical in behaviour.

**Unverifiable from the diff alone:**
- `bun test` → 45 pass, 0 fail (no execution environment).
- `bunx tsc --noEmit` clean (no compiler available).
- `sanitizeNumeric` at `orders.service.ts:1971` implementation (not in the diff).
- The e2e test results and the "Tenant not found" contention claim.
- Moxie production data statistics (179/213, no per-line `0`, 144 delivered_quantity).
- Whether any other file outside this diff has the same `||` pattern on commission rates.

---

## (5) Verdict

This is a clean, well-scoped correctness fix that addresses a real divergence between two modules computing the same money. The shared primitive is the right structural response, the guards are well-reasoned and well-documented, and the tests honestly characterise what they pin. The only reachable behaviour change (per-line `0` honoured) is the intended fix, and production data confirms no such rows exist today — making this a zero-risk preventive correction. The findings are all LOW/NIT and can be addressed in a follow-up.

VERDICT: ship-it