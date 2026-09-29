# Panel synthesis — supplier-funded broker commission + Supplier Commission Report

Payload: `review-panel-brief-supplier-commission.md` (48 KB; decision, constraints, data evidence, diffs A–C).
Run 1 `supplier-commission-v1`: deepseek-v4-pro OK; kimi-k3 attempted tool calls (finish_reason `tool_calls`, 193-byte content) and glm-5.3 returned empty `content` — the runner fell back to its reasoning scratchpad and marked it `OK*`, so **`supplier-commission-v1-glm-5.3.md` is unvalidated scratch output, not a review; do not cite it.** Payload amended with an explicit no-tools directive; run 2 `supplier-commission-v2` produced usable reviews from kimi-k3 and glm-5.3. No member returned NO-GO.

Outputs: `model-reviews/20260929-supplier-commission/supplier-commission-v1-deepseek-v4-pro.md`, `…-v2-kimi-k3.md`, `…-v2-glm-5.3.md`.

## Verdicts

| Model | Verdict |
|---|---|
| deepseek-v4-pro | APPROVE-WITH-CONDITIONS |
| kimi-k3 | APPROVE-WITH-CONDITIONS |
| glm-5.3 | APPROVE-WITH-CONDITIONS |
| **Mine** | **APPROVE — all MUSTs and the material SHOULDs are closed and verified** |

The three core decisions were endorsed unanimously with no dissent: explicit two-rate entry, statement-not-invoice, and no fallback chain on the supplier rate. deepseek independently confirmed the `invoices`-has-no-payer risk that motivated not building an invoice.

## Consensus (all three, ordered by severity)

1. **The report is un-gated server-side.** The decision says "Moxie only"; the routes checked bearer auth only, so any authenticated user of any tenant could read it. *kimi MUST-1, glm SHOULD-12.*
2. **`orderCount` counts lines, not orders** — on a document sent to a counterparty to request money. *glm MUST-2.*
3. **A statement must foot** — line amounts were formatted to cents while totals accumulated raw floats with 7-decimal rates. *kimi F2/SHOULD-1.*
4. **A shared-arithmetic claim that the diff did not show** — Appendix A declared `commissionLineFigures` shared between the two reports but contained no hunk touching the customer report. *kimi SHOULD-2, glm MUST-1.*
5. **Negative rates pass end-to-end**; `min="0"` is advisory. *kimi F3/SHOULD-3, glm SHOULD-11.*
6. **Multi-supplier-leg grouping is a guess until checked against data.** *kimi MUST-2, glm MUST-5.*
7. **`OrderItemDto` omits both commission fields.** *all three.*
8. **Migration is safe** — `ADD COLUMN … NULL` with no default is catalog-only on PG11+; the `0124` hazard was an `ALTER TYPE`. Unanimous, no action.

## Disagreements, adjudicated

- **FX conversion.** deepseek: fix both reports with `getFxRate`. glm: comment the assumption. kimi: label honestly. → I did **neither conversion nor a bare comment**: changing it would silently restate amounts that `createCommissionOrdersFromReport` already bills verbatim. A deal priced outside `commissionCurrency` is now *excluded and named* in the DTO, on screen and in both exports. That is strictly more honest than either proposal and does not move existing money.
- **`grossProfit` split.** kimi and glm both judged a single summed figure correct and no split needed; deepseek agreed. No conflict — implemented as-is, with the two-sided rule commented at the call site.
- **`totalQuantity` naming.** deepseek wanted a rename to `billableQuantity`; glm wanted a documented label. Took the documented label (page reads "lines · qty"); a rename would touch a DTO only this feature consumes, for no behavioural gain.

## Action items — disposition

**MUST (all closed):**

| # | Item | Resolution |
|---|---|---|
| 1 | Server-side tenant gate on the three routes | `isBrokerDealsEnabled()` in `reports.service.ts`, checked in all three handlers (`reports.controller.ts`). **Proven live**: 404 with the flag off, 200 with it on. Test `hides the report entirely when the tenant has broker deals disabled`. |
| 2 | `orderCount` → lines | Renamed to `lineCount` across DTO, builder, CSV, XLSX and the page. |
| 3 | Statement must foot | `roundToCents` applied **once, per line**, in the shared helper. Verified against real data: sum of displayed lines = sum of subtotals = grand total = 32,164.50. New test with sub-cent rates (`0.3333 × 3`) pins it. |
| 4 | Prove the shared arithmetic | Customer report refactored onto `commissionLineFigures` — the duplication was real and is gone. It returns `null` for non-commissionable lines, so the old `continue` is preserved. All 23 pre-existing customer-report tests still pass unchanged, i.e. no customer number moved. |
| 5 | Multi-leg check on production | **Queried Moxie production: 0 of 146 broker deals have more than one `order_suppliers` row.** The gap is latent, not live. Guarded anyway: such deals are excluded and named (`attributedToMultipleSuppliers`), surfaced on screen and in both exports, rather than silently attributed to the primary. |
| 6 | Deploy order migration → API → web | Recorded below. |

**SHOULD (closed):** negative-rate rejection at the API (`orders.service.ts`, on both commission fields — `sanitizeNumeric` passes negatives through, so the panel was right); both commission fields added to `OrderItemDto`; CSV formula-injection guard (new `quoteCsvCell`); `from`/`to` constrained to `^\d{4}-\d{2}-\d{2}$` (invalid input now 422, verified live — it was previously interpolated unvalidated into a `Content-Disposition` filename); XLSX gained the TOTAL row the CSV already had; the write-path audit found exactly two `order_items` writers — `saveOrderItems` (updated) and the synthetic `BROKERAGE_COMMISSION` line, which correctly has no supplier rate — and one payload builder (`buildItemPayload`), which carries the field, so there is no silent-wipe path.

**Open, deliberately (with reasons):**

- **FX conversion** — as adjudicated above; excluded-and-named instead. Converting is a separate decision about restating issued commission figures.
- **In-memory date filtering** — inherited from the customer report; fine at Moxie's volume. Not changed, so the two reports keep identical period semantics.
- **Drizzle snapshot for `0133`** — the repo's journal is hand-registered and the migration is applied by the app's own runner; the test DB and a fresh DB both applied 0133 correctly (verified: `supplier_commission_per_unit` present). Flagged for the deployer.

## Verification (all re-run after the fixes)

- `apps/api` + `apps/web` `tsc` clean.
- New suite `broker-deal-supplier-commission.e2e.test.ts`: **13 pass**, including footing, gating, negative-rate, multi-leg and currency cases.
- Existing `broker-deal-commission-report.e2e.test.ts` 23 pass, `order-financing.test.ts` 53 pass — no customer figure moved.
- Real Moxie data through the real endpoint: total 32,164.50 over 2 suppliers, matching an independent raw-SQL aggregate to the cent; `20260916-000132` = 145 × 19 = 2,755.
- Profit column two-sided: `totalNetProfit` 5,510 with the supplier rate set, 2,755 with it zeroed.
- Live UI: report renders both supplier blocks, subtotals, 5 lines, and the cited order.
- Full API suite re-run and diffed against a pristine `HEAD` worktree: **identical failure set** (50 pre-existing, all in auth/email/PDF/inventory domains) with 14 more passing tests. Zero regressions.

## Deploy order (blocking)

1. **Migration `0133`** — nullable, no default, catalog-only lock; run off-peak as standard.
2. **API** — the controller schema is what keeps the column from being stripped on every items save.
3. **Web** — last. A web-first deploy sends `supplierCommissionPerUnit` to an API that does not declare it, and Elysia silently drops the key on every save.
