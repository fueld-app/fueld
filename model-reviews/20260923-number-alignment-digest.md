# Panel digest — broker-deal numeric alignment (`c255e5d6` → `781fdb2d`)

Panel: deepseek-v4-pro:cloud, glm-5.3:cloud, kimi-k3:cloud (ollama HTTP API).
Raw artifacts: `model-reviews/20260923-number-alignment-{deepseek-v4-pro,glm-5.3,kimi-k3}.md`.

## Verdict tally — unanimous
- deepseek-v4-pro: **ship-it**
- glm-5.3: **ship-it**
- kimi-k3: **ship-it**

## Consensus findings — all applied
1. **No unit tests for the shared primitive** (all 3). `toFiniteNumber` is the single numeric parser for money across two modules but was covered only indirectly. Added `tests/lib/numbers.test.ts` (9 cases).
2. **Stale comment** (kimi). `reports.service.ts` said the guard "deliberately does not" match `toFiniteNumber` — leftover from the divergence. Corrected.

## Single-model findings — applied
3. **Non-string/non-number coercion** (glm, LOW). `Number(true)===1`, `Number(['5'])===5`; unvalidated JSON could win a `??` chain. Now rejected explicitly.
4. **Infinity claim** (deepseek, LOW — partially refuted). It argued `numeric` accepts `'NaN'` but not `'Infinity'`. **Verified live on this deployment: PG16 accepts both** (`'Infinity'` since PG14). Comment corrected to state that; the guard is justified as written.

## Documented, not closed
5. **Tier parity** (glm, MEDIUM). The report resolves three tiers (per-line → order → tenant default); the profit column resolves two. A broker deal with no per-line AND no order-level rate invoices `defaultRate × qty` while the profit column shows 0. Closing it requires plumbing the tenant default into `calculateOrderEconomics`, whose five call sites do not all have settings in scope; making it async cascades through orders + dashboard services (20+ typecheck breakages) and would collide with another session actively editing `orders.service.ts`. **Left open and recorded in-code as KNOWN GAP** — currently unreachable (0 of 197 production broker deals are unrated; all carry an order-level rate). `calculateLineEconomics` already accepts `defaultCommissionRate`, so this is a plumbing task later, not a redesign.

## Genuine disagreements
- **Comma-decimal premise.** The brief claimed `parseFloat`→`Number` was a behaviour change for `'3,5'`. Two models refuted it: the removed local `num()` already used `Number`, and old `parseNumber` also used `Number`, so **there is zero comma-decimal change in this commit**. Verified: 0 rows contain a comma, and Postgres rejects `'3,5'::numeric` anyway. The brief's premise was wrong; `Number` is still the better choice (parseFloat would silently truncate `'3,5'` to 3).
- **Test honesty.** deepseek called the six non-regression tests "padding-adjacent"; kimi and glm judged them justified as guards on shared semantics and noted the author had already labelled them correctly. I side with kimi/glm, and they now also have direct primitive-level tests.
- **deepseek on `Infinity`** — refuted by measurement (see above).

## Verified by me, not taken on trust
- `'NaN'::numeric` and `'Infinity'::numeric` both accepted on the live deployment (PG16.15) — deepseek's version-dependent claim was wrong here.
- `sanitizeNumeric` (`orders.service.ts:1971`) only nulls `''`/`'null'`/`'undefined'`, so both values are storable and the guard is live, not dead code.
- `Number('')===0` and `Number('  ')===0` but `parseFloat('')===NaN` — hence the trim guard.
- No comma-decimal values exist in production; Postgres rejects them on write.
- Remaining `|| 1` conversion-factor sites are legitimately defaulting (0 is never a valid factor) — glm's NIT to add a comment there is fair.
