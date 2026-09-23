# Panel digest — outstanding items: per-tranche financing, QB tranche sync, dead-code removal (20260923)

Brief: `review-panel-brief-outstanding.md`
Reviewed at `9ea6360e`; fixes landed in `d9e7a363`. Final range: **`becccde5..d9e7a363`**.

## Verdicts

| Reviewer | Verdict |
|---|---|
| kimi-k3 | needs-fixes at `9ea6360e` (found a reachable money bug) → **ship-it** at `d9e7a363` |
| glm-5.3 | no CRITICAL/HIGH/MEDIUM; all 7 focus items verified → **ship-it** |
| deepseek-v4-pro | all findings resolved → **ship-it** |

## What landed

1. **Per-tranche financing cost.** Financing days were one figure for the whole cost base (`customerDays − supplierDays`). Split terms collect the money in instalments, so the share-weighted excess over the supplier's own days is now computed per tranche and **summed**. A weighted *average* floors real cost to zero whenever the average gap lands at or below the supplier's days — the settled decision (project memory), and Kimi/GLM independently verified the sum is dimensionally exact, not an approximation: `Σ shareᵢ × costBase × rate × excessᵢ/365` is the true instalment-by-instalment cost. Reduction is exact (one 100% tranche at the credit days == the single-term answer), and normalising by the tranches' own total makes the API's ±0.001 percent tolerance safe.
2. **Wiring.** A batched `getFinancingTranchesByOrder` (2 queries for N orders) feeds all four financing-bearing call sites; the two that pass literal `{}` (`listDealEconomics`, `getMonthlyHistory`) were independently confirmed to consume no financing field.
3. **QuickBooks tranche sync.** The `sync-quickbooks` action pushes each issued tranche by id (a split order has no single invoice to push), falling back to the order-level sync otherwise.
4. **Cleanup.** `OrderPdfService` deleted — a fully superseded duplicate whose four methods all live in `order-action.service`, injected into the page and never called.

## The bug the panel caught

**A reachable money bug in the change being reviewed** (Kimi, confirmed CRITICAL by DeepSeek):

A `FIXED_DATE` tranche measures its days from the delivery/ETA anchor. Both columns are nullable and the schedule endpoint accepts `FIXED_DATE`, so a tranche on an order with neither has no anchor → `dueDays = null` → `t.dueDays ?? 0` read it as **due immediately**, i.e. cash in advance. A split order on 60-day credit with un-datable fixed tranches therefore reported **zero** financing days where the same order on plain credit terms reports 30. The error was in the *flattering* direction and reached the dashboard, team stats and all four report builders.

Fixed by falling through to the order's own terms whenever any tranche is unusable — an unknowable due date, or a share that could not be read (dropping one would shrink the denominator and inflate the survivors). Conservative over-statement, never a fabricated zero. Also fixed: the percent parse no longer coerces to 0, and the QB partial-failure toast now reports how many tranches landed (idempotent retry).

**Test-integrity finding:** two of the four new financing tests did not discriminate — they would pass against the pre-change code because they also set `customerCreditDays` (so the single-term fallback produced the expected value) or because the old code returned 0 for an unrelated reason. Rewritten and **verified against the old implementation** to fail at base (0 vs 30, 30 vs 0, 30 vs 15). Three discriminating fallback tests added.

## Accepted, not changed

An absurd positive `dueDays` (e.g. `creditDays` 99999, or a far-future `FIXED_DATE`) yields an absurd financing figure with no upper clamp. Both reviewers agreed with leaving it: the single-term path has the identical unbounded-input class via `customerCreditDays`, and clamping only the tranche side would make the two paths disagree at reduction. A silent clamp would hide real data.

## Verification

- `order-financing.test.ts` **38 pass** (7 financing cases, every one now discriminating). Full API sweep of 14 suites: **240 pass, 2 fail** (both pre-existing, baseline-confirmed). Web **106 pass**. Both typechecks clean — and the web one now really checks (it was a no-op until Phase 2).
- Live probe on the real code path: same order (cost base 500,000; 60d customer / 30d supplier) = **1643.84** with a 50/50 schedule vs **3287.67** as a single 60-day term; `getFinancingTranchesByOrder` genuinely reads the schedule. GLM reproduced the math independently.
- Edge cases probed: past `FIXED_DATE` → 0 (no inflation), unknown days → fallback, odd percent totals (99.999/100.002) → normalised, `supplierEffectiveDays` override honoured, empty array → single term, PREPAY → 0.

## Not done

Deployed to all four instances as `d9e7a363` after these fixes. The remaining known deferrals are unchanged: split sibling payment rows have no group identity (safe while no payment edit/delete route exists), no per-tranche PDF line proration, no per-tranche Kantox value dates, and `verificationRef` remains a date+revision display label rather than an identity.
