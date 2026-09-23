# Panel digest — broker commission report fix (`ca6929c3` → `016748cd`)

Panel: deepseek-v4-pro:cloud, glm-5.3:cloud, kimi-k3:cloud (via `ollama run`).
Raw artifacts: `model-reviews/20260923-broker-commission-{deepseek-v4-pro,glm-5.3,kimi-k3}.md`.

## Verdict tally
- deepseek-v4-pro: needs-fixes (sampled 4×; 3 needs-fixes, 1 ship-it — verdict unstable)
- glm-5.3: needs-fixes
- kimi-k3: needs-fixes (a second run sampled ship-it)

## Consensus findings (all three) — all verified against the code/DB and fixed
1. **NaN poisoning.** `parseFloat` → NaN → `grandTotalCommission += NaN` corrupts the whole report, its CSV/XLSX export, and the flow that turns totals into real commission invoices. Postgres numeric accepts `'NaN'`/`'Infinity'` literals (verified live) and `sanitizeNumeric` only nulls `''`/`'null'`/`'undefined'`. Fixed with a `Number.isFinite`-guarded `num()`.
2. **`!= null` vs `||` divergence from `order-financing.ts`.** The same per-line 0-rate yields different money in the report vs the profit column. All three preferred `!= null` as the primitive and recommended aligning `order-financing.ts` in a follow-up rather than changing this fix.
3. **Tests pinning nothing.** The order-level fallback test used `defaultCommissionRate: 3` equal to the order rate, so it passed with the branch deleted. Also, the "both new tests fail pre-fix" claim was overstated — the per-line precedence test passes pre-fix.
4. **Ordered vs delivered quantity** (deepseek + glm). "3 $/MT **leveret**" — the report billed ordered quantity. Fixed to mirror `getEffectiveQuantity`.
5. **Unit conversion** (deepseek CRITICAL, glm HIGH, kimi orthogonal). Non-MT lines × per-MT rate with no conversion. Verified pre-existing and shared with `calculateLineEconomics`, which also has no conversion — so the fix makes the report consistent rather than newly wrong. ~9 Moxie lines affected, small quantities. Design-doc M1; deferred as a product follow-up.

## Genuine disagreements
- **Unit conversion severity:** deepseek CRITICAL (blocks invoicing), glm HIGH but "not a blocker, run the one-query check", kimi orthogonal. Resolved by evidence: `order-financing.ts:239` does `quantity * rate` with no conversion either, so the report now agrees with the profit column.
- **Verdict stability:** both deepseek and kimi returned different verdicts across samples. The split is a property of the models, not the change.

## Verified-by-me, not taken on trust
- Postgres accepts `'NaN'`/`'Infinity'` in numeric columns — **confirmed live**, and `''`/whitespace is **rejected**, so the blank-rate path is defence-only.
- `Number('') === 0` — **confirmed**, so glm's catch was real (a blank rate would have resolved to $0 and overridden the order rate).
- `order-financing.ts:239` uses `||` (falsy), the UI's `+$event || null` cannot store a per-line 0, and 179 Moxie broker lines have **no** per-line rate — which is why the fix matters at all.
- Production impact re-measured after all changes: Moxie Aug–Sep **68,700.29 USD**; example order 20260813-000034 **0.00 → 240.00**.
