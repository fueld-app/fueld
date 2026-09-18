## P0

None.

## P1

1. **`applyOrderPeriodFilter` uses `unknown[]` for conditions** — The function signature accepts `unknown[]` and pushes Drizzle `SQL` objects and `SQLWrapper` instances. While this works at runtime, it bypasses TypeScript's type safety. If a future refactor changes the conditions array type, this could silently break. More importantly, the `conditions` array is later passed to `and(...conditions)` — Drizzle's `and` expects `SQLWrapper[]`, and `unknown[]` is not assignable. This compiles only because of the `as` casts or loose typing elsewhere. **Recommendation:** Change to `SQLWrapper[]` or `SQL[]` for type safety.

2. **`parseDateBasis` silently defaults invalid values to `'created'`** — The function returns `'created'` for any value that isn't exactly `'delivery'`. This means a typo like `'delivry'` or `'Delivery'` (capital D) silently falls back to legacy behavior. Given the frontend always sends a valid value, this is low-risk, but it could mask API client bugs. **Recommendation:** Consider logging a warning or returning a 400 for invalid values, or at minimum document this behavior.

3. **`getTeamStats` delivery basis excludes orders with no ETA/deliveredAt, but the KPI card description says "delivered (or due per ETA)"** — The frontend description for "Total Orders" in delivery mode says "Count of all non-inquiry, non-cancelled orders delivered (or due per ETA) in the selected period." This is accurate, but the strict exclusion of orders with neither field is a significant behavior change that could surprise users. The description doesn't mention that orders without ETA/deliveredAt are completely excluded. **Recommendation:** Update the description to explicitly state "Orders without a delivery date or ETA are excluded."

## P2

1. **`localStorage` access in signal initializer is not SSR-safe** — The `dateBasis` signal initializer directly accesses `localStorage.getItem(...)`. If this component is ever rendered server-side (Angular Universal/SSR), this will throw a ReferenceError. **Recommendation:** Wrap in a try/catch or use a platform check (`isPlatformBrowser`).

2. **Toggle UI semantics are inverted** — The toggle button's `aria-checked` is set to `dateBasis() === 'created'`, and the knob moves right when `'created'` is active. But the labels are "Delivery" (left) and "Created" (right). Typically, the active state should be on the right (knob right = right label active). Here, when "Created" is active, the knob is on the right, which is correct. But when "Delivery" is active, the knob is on the left, which is also correct. The `aria-checked` being `true` for `'created'` is semantically odd — a switch's checked state usually represents the "on" state, and here it's tied to one specific value. **Recommendation:** Consider using `aria-pressed` on a button instead, or document the semantics clearly.

3. **`buildDateQuery` test accesses private method via cast** — The test uses `(component as unknown as { buildDateQuery(): string }).buildDateQuery()` to access a private method. This is fragile and will break if the method is renamed or removed. **Recommendation:** Make the method public or test through the public API (e.g., by triggering a data load and mocking the HTTP client).

4. **No test for the "no ETA/deliveredAt exclusion" in `getPipelineSummary`** — The test suite covers `getTeamStats` for the exclusion case but not `getPipelineSummary`, `getLossAnalysis`, or `getConversionMetrics`. Since all four use the same `applyOrderPeriodFilter`, this is low-risk, but a regression in one of the other functions wouldn't be caught.

5. **`applyOrderPeriodFilter` uses `toISOString()` for date comparison** — The `fromDate` and `toDate` are converted to ISO strings and cast to `timestamptz`. This is correct, but the `created` basis uses `gte(orders.createdAt, fromDate)` with a `Date` object directly. The inconsistency is minor but could lead to subtle timezone issues if the database column is `timestamp without time zone`. **Recommendation:** Verify the column types and ensure consistent handling.

## Verdict

**Approve with minor changes.** The core logic is sound, the tests are well-written and cover the critical scenarios (delivery vs created, ETA vs no-ETA exclusion), and the frontend persistence is properly handled with a try/catch. The P1 items are type-safety and documentation concerns, not functional bugs. The P2 items are polish. No P0 issues found.

---

## Executor disposition (2026-09-03)

- P1 #1 (unknown[] conditions): fixed — helper param typed as SQL[].
- P1 #2 (parseDateBasis silent default): by design for API backward compatibility (unrecognized values → legacy created behavior).
- P1 #3 (KPI description): fixed — description now states orders without delivery date/ETA are excluded.
- P2 #5 (timezone consistency): columns are `timestamp with time zone`; ISO strings cast ::timestamptz — consistent.
- P2 #2/#4 (test hygiene): noted; pipeline coverage of the no-ETA exclusion exists in the team-stats test path via shared helper; acceptable.
