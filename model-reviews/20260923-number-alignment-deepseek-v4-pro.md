## Panel review — `c255e5d6`

### (1) Numbered findings

1. **LOW** — `apps/api/src/lib/numbers.ts:21-22`  
   The comment claims Postgres `numeric` accepts both `'NaN'` and `'Infinity'`. PostgreSQL `numeric` accepts `'NaN'`, but **not** `'Infinity'` (that is floating-point types only). The guard is still useful defensively, but the justification is partly false.  
   Fix: correct the comment to say `NaN` is storable; `Infinity` guard is defensive only.

2. **LOW** — `apps/api/src/lib/numbers.ts:36` / `reports.service.ts:2493`  
   `toFiniteNumber` treats non-finite **non-empty** values as absent, so a corrupt `'NaN'` per-line commission rate falls through to the order/default rate and **pays commission** rather than producing zero or surfacing the bad row. This is pre-existing report behaviour and not a new regression, but it is still a money-adjacent risk.  
   Fix: at minimum log when a non-empty value is non-finite; consider returning `0` or throwing for invalid non-empty input instead of falling through to a valid fallback.

3. **NIT** — `apps/api/tests/order-financing.test.ts`  
   Six of the seven tests pass before this commit; only the deliberate per-line `0` test is a true regression guard. The other six are characterisation tests. They are not dishonest, but several duplicate existing coverage (especially delivered quantity).  
   Fix: keep the `0`/blank/NaN tests, trim or mark the others as semantic pinning.

4. **NIT** — `apps/api/src/modules/orders/order-financing.ts`  
   Other `||` fallbacks remain: `parseNumber(item.costConversionFactor) || 1`, `parseNumber(item.unitConversionFactor) || 1`, and `orderCommissionPerMt = parseNumber(commissionPerMt) || 0`. These are not the same bug class unless `0` is a meaningful conversion factor, but they should be explicitly reviewed.  
   Fix: grep for numeric fallbacks and decide per field whether `0` should win or be treated as absent.

---

### (2) Explicit answers to the 8 focus items

1. **`Number` vs `parseFloat`**  
   The premise that the report previously used `parseFloat` is **not true for this diff range**. The local `num()` removed in `reports.service.ts` already used `Number(value)`, so the main rate-resolution path has no comma-decimal behaviour change in this commit. `Number('3,5')` returning `NaN` is correct for a numeric DB column; `parseFloat('3,5') === 3` would silently truncate a malformed value. I would keep `Number`.

2. **`parseNumber` semantics changed?**  
   No effective change. Old: blank string → `Number('') === 0`; new: blank → `null` → `?? 0` → `0`. Null/undefined and non-finite values also resolve to `0` both ways. No caller should observe a difference.

3. **Did aligning `||` → `??` change any real calculation?**  
   Only for a deliberate per-line `0`. With `orderCommissionPerMt` derived as `parseNumber(...) || 0`, it is never `null`, but since its fallback is already `0`, the `?? 0` tail behaves identically. `NaN`, blank, null, and undefined all fall through in both old and new code. The reachable change is exactly the intended one: a stored per-line `0` now wins.

4. **`??` on possibly-`undefined` property**  
   Safe. `calculateLineEconomics` declares `orderCommissionPerMt: number | null = null`. The default parameter initializer runs on `undefined`, so any explicit or omitted `undefined` becomes `null`. No path leaves it `undefined` at runtime.

5. **Is `toFiniteNumber` the right home and shape?**  
   Yes. `lib/numbers.ts` is a reasonable shared location, and returning `number | null` is the correct primitive for `??` fallback chains. A separate `toFiniteNumberOrZero` helper would be convenient but not necessary. The null contract is documented clearly enough to avoid `if (x)` misuse.

6. **Are the 7 tests honest?**  
   They are honest, but only the deliberate-`0` test fails pre-commit and therefore is the true regression guard. The blank, NaN, and no-rate tests pin `toFiniteNumber` semantics usefully; the delivered-quantity test likely duplicates existing `getEffectiveQuantity` coverage. Not blocking.

7. **Other `||`-chained numeric fallbacks**  
   In `order-financing.ts`:  
   - `parseNumber(item.costConversionFactor) || 1`  
   - `parseNumber(item.unitConversionFactor) || 1`  
   - `orderCommissionPerMt = parseNumber(commissionPerMt) || 0`  
   The conversion-factor ones are not the same bug class unless a factor of `0` is a valid deliberate value. The commission-per-Mt one is harmless because the fallback is already `0`.  
   In `reports.service.ts`, I did not have the full file to grep other `parseFloat` sites; recommend a targeted audit for any `parseFloat(...) ||` chain on money fields.

8. **The `'NaN'` claim**  
   PostgreSQL `numeric` **does** accept `'NaN'`; it does **not** accept `'Infinity'`. `sanitizeNumeric` as described leaves `'NaN'` untouched, so a string `'NaN'` can reach a numeric column. Therefore the `NaN` guard is live. The `Infinity` guard is defensive/dead for `numeric`, though harmless.

---

### (3) What is done well

The shared `toFiniteNumber` helper is well-documented, handles the blank-string `Number('') === 0` trap correctly, and centralises the exact semantics that previously drifted between the report and the profit column. The deliberate per-line `0` regression test is the right test and would catch the original divergence. The `??` alignment is the correct primitive for this data.

---

### (4) Verified-by-reading vs unverifiable

Verified by reading: the diff logic, the `||` → `??` change, `parseNumber` semantics, and the test intent.  
Unverifiable without a running DB: the author’s test counts, the exact PostgreSQL `numeric` acceptance of `Infinity` in this specific schema, and whether any production path writes comma-decimal strings into numeric columns.

---

### (5) Final verdict

**VERDICT: ship-it** — the core alignment is correct and the deliberate-zero regression is properly guarded. The remaining issues are documentation accuracy and low-risk invalid-data semantics, not blockers.