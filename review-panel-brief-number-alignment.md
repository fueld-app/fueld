# Panel Review — broker-deal numeric alignment (`c255e5d6`)

Frozen commit: **`c255e5d6`** in `/Users/patrickpereira/fueld`. Range: **`c255e5d6~1..c255e5d6`** (`git diff c255e5d6~1 c255e5d6`).

Four files: new `apps/api/src/lib/numbers.ts`; `apps/api/src/modules/orders/order-financing.ts`; `apps/api/src/modules/reports/reports.service.ts`; `apps/api/tests/order-financing.test.ts`.

## Context

Yesterday's incident: Moxie's Broker Commission Report showed **$0.00 on every broker deal**. Two faults — the report read only `orderItems.commissionPerUnit` (their line items have no per-line rate; the rate lives on `orders.commissionPerMt`), and the tenant fallback read `defaultCommissionPerMt`, renamed to `defaultCommissionRate` in `fd69d793`. That was fixed and shipped (`016748cd`).

A prior three-model panel then flagged a **divergence**: the commission report and the broker-deal profit column (`order-financing.calculateLineEconomics`) resolved the *same* columns with different zero semantics — `??` vs `||`:

```ts
// reports.service.ts (before this commit)
const rate = num(r.itemCommissionPerUnit) ?? num(r.orderCommissionPerMt) ?? num(defaultCommissionRate) ?? 0;
// order-financing.ts:239 (before this commit)
const rate = parseNumber(item.commissionPerUnit) || orderCommissionPerMt || 0;
```

For the same deal, a stored per-line `commissionPerUnit = 0` yields **$0 commission in the report** but **orderRate × qty profit** in the profit column. All three models judged `??` the better primitive and recommended aligning `order-financing.ts` to it. This commit does that.

## What this commit changes

1. **New `lib/numbers.toFiniteNumber(value): number | null`** — the single primitive. Returns `null` (not `0`) for absent/unparsable input so callers chain with `??`. Two guards: blank/whitespace → null (because `Number('') === 0`, which would become a real `$0` overriding a valid fallback), and `Number.isFinite` (rejects `NaN`/`Infinity`, which Postgres `numeric` accepts as literals and which poison a running total).
2. **`order-financing.parseNumber` delegates to it**, still returning a number (every caller feeds arithmetic): `return toFiniteNumber(value) ?? 0`.
3. **`order-financing.ts:246` commission rate now uses `??`**:
   `const rate = toFiniteNumber(item.commissionPerUnit) ?? orderCommissionPerMt ?? 0;`
4. **`reports.service.ts` drops its local `num()` copy** in favour of the shared helper.
5. **Seven new tests** in `order-financing.test.ts` covering: per-line rate wins; order-level fallback; deliberate per-line `0` honoured; blank string falls through; `'NaN'` falls through; no rate at any tier → 0; delivered quantity billed.

## Author's verification claims — reproduce or refute

- `bun test tests/order-financing.test.ts` → **45 pass, 0 fail**.
- The `0`-rate test **fails against the pre-commit `||` semantics** (verified by reverting the two lines and re-running: 44 pass / 1 fail). The other six pass both ways, so they are characterisation, not regression guards.
- `bunx tsc --noEmit` in `apps/api` → clean.
- `apps/api/tests/broker-deal-commission-report.e2e.test.ts` → 15-17 pass depending on whether another process is concurrently truncating the shared test DB ("Tenant not found" failures are that contention, not this change — documented pre-existing, and there was a concurrent `bun test tests/documents.controllers.e2e.test.ts` running).

## Mandatory review focus — attack these

1. **Is `toFiniteNumber` correct about `Number` vs `parseFloat`?** I used `Number(value)` deliberately: `Number('3,5')` is `NaN` (comma decimal rejected) whereas `parseFloat('3,5')` is `3`. The report previously used `parseFloat`, so **this is a behaviour change for comma-decimal input**: `'3,5'` used to contribute `3`, now falls through to the next tier. Is that right, or does a real European-locale path write `'3,5'` into a numeric column (which would make this a regression)? Note `Number('')`/`Number('  ')` are `0` (hence the trim guard) while `parseFloat('')` is `NaN`.
2. **`parseNumber` semantics changed in a subtle way.** Old: string → `Number(value)`, non-finite → `0`. New: same, plus blank → `0`. So blank now yields `0` either way — no change. But confirm no caller relied on `parseNumber` returning a number for a *blank* in a way that differs.
3. **Did aligning `||` → `??` change any real calculation?** With `orderCommissionPerMt` derived as `parseNumber(commissionPerMt) || 0` (i.e. never null), can the `?? 0` tail ever differ from the old `|| 0`? The only reachable difference should be a per-line `0`. Verify that, and check whether `orderCommissionPerMt` being `0`-instead-of-null makes the per-line fallback behave differently than intended.
4. **`??` on a possibly-`undefined` property.** `toFiniteNumber(item.commissionPerUnit) ?? orderCommissionPerMt ?? 0` — `orderCommissionPerMt` is a parameter typed `number` (from `calculateOrderEconomics`) but `calculateLineEconomics` takes `orderCommissionPerMt: number | null = null`. Any path where it is `undefined` rather than `null`?
5. **Is `toFiniteNumber` the right home and shape?** It lives in `lib/` and returns `number | null`. Is `?? 0` at every consumer worse than a second helper `toFiniteNumberOrZero`? Does the null-returning contract invite `if (x)` bugs?
6. **Are the 7 tests honest?** Only the `0`-rate one fails pre-commit. Should the others be considered padding? Is the delivered-quantity test in this file duplicating the report's own coverage?
7. **Did I miss other `||`-chained numeric fallbacks of the same class?** `order-financing.ts` still has `parseNumber(item.costConversionFactor) || 1`, `parseNumber(item.unitConversionFactor) || 1`, and `orderCommissionPerMt = parseNumber(commissionPerMt) || 0`. Also `reports.service.ts` has other `parseFloat` sites. Grep for the pattern and say which are genuinely the same bug class vs legitimately defaulting.
8. **The `'NaN'` claim.** I asserted Postgres `numeric` accepts `'NaN'`. Verify that is true and that `sanitizeNumeric` in `orders.service.ts:1971` really only nulls `''`/`'null'`/`'undefined'`, so a `'NaN'` string can reach the column. If it cannot, the NaN guard is dead code and should be labelled as such rather than justified by a false premise.

## Platform facts

- Tests need `DATABASE_URL='postgres://fueld:fueld@localhost:5432/fueld_test'` and must run **serially** — other sessions share that DB and truncate tables under you, producing "Tenant not found".
- `order-financing.ts` is consumed by the order detail page (profit column), the dashboard, and the reports service. Money from `calculateOrderEconomics` is customer-visible.
- The UI cannot store a per-line `0`: `order-items.component.ts:262` uses `+$event || null`, converting a typed `0` to `null`.
- Moxie production: 179 of 213 broker-deal lines have **no** per-line rate; no per-line `0` exists anywhere; 144 have `delivered_quantity` set.

## Output format

(1) Numbered findings: severity (CRITICAL/HIGH/MEDIUM/LOW/NIT), `file:line` at `c255e5d6`, one-line fix.
(2) Explicit answers to the 8 focus items.
(3) What is done well (brief).
(4) Verified-by-reading vs unverifiable.
(5) Final line exactly `VERDICT: <ship-it | needs-fixes | blocked>` + 2-3 sentences.
