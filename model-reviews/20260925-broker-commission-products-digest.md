# Panel digest — products-only broker commission (324b48b6 → 2ab020bb)

Three independent reviewers on frozen commit **`324b48b6`** (Moxie: a $3/MT commission rate was being charged on barging fees). Each ran read-only against the code and, where reachable, Moxie's live DB.

| Reviewer | Verdict | Independent verification |
|---|---|---|
| DeepSeek V4 Pro | **needs-fixes** | Reproduced live: all-lines `16618.19` vs products-only `16585.19`, diff **$33.00** = 10 BARGING_FEE + 1 ITEM × $3. Reverted classifier → 2 new e2e tests fail. |
| GLM 5.3 | **ship-it** | Reverted classifier → 17 pass / 2 fail (e2e), 46/1 (financing), 11/2 (types). Could not reach production DB. |
| Kimi K3 | **needs-fixes** | Live via SSH tunnel: `16,585.19`, types `[LSMGO, VLSFO]`. Confirmed no fourth commission consumer. |

All three **confirmed the core fix and that the tests discriminate**. All three **independently reached the same two open items**, and all three flagged the same NIT.

## Real defects the commit missed (fixed in 2ab020bb)

**1. `listDealEconomics` "products" column still listed fee types** (DeepSeek #3, verified by me).
The row rendered `"VLSFO, BARGING_FEE"` beside a `totalQuantity` that already excluded the fee — self-contradictory. Fixed and scoped to broker deals only.

**2. The order-items preview showed $0 for most broker lines** (DeepSeek #1, verified by me on live data).
`brokerProfitForRow` had no order-level rate fallback and used ordered rather than delivered quantity. Most broker-deal lines carry **no per-line rate** (the UI seeds the tenant default onto the *order*). Measured on Moxie: **139 product lines worth $52,448.28 displayed $0** while the report billed them in full. Now mirrors `calculateLineEconomics` via a new `commissionPerMt` input.

Both were **pre-existing** (not introduced by 324b48b6) but surfaced by it: the change made the report exclude fees, which is precisely what made these two inconsistencies visible.

## Raised by the panel, deliberately NOT changed

| Item | Reviewers | Disposition |
|---|---|---|
| `createCommissionOrdersFromReport` double-clickable — two clicks create two invoices | Kimi HIGH, GLM MEDIUM | **Pre-existing**, separate function my diff never touched. Out of scope for this fix; worth its own change. |
| Historical months counted fees; re-running an old month now shows fewer dollars | Kimi HIGH, GLM MEDIUM | Bounded on Moxie: **$147 all-time** ($33 in August). `BROKERAGE_COMMISSION` rows = **0** — no commission invoice was ever generated, so nothing is overstated on paper. Customer communication, not code. |
| `ITEM` in the deny list is a bet on tenant data | all three | Verified across the **whole tenant**: all 9 ITEM lines are charges (trucking, agency, overtime, taxes, pump-back), all quantity 1. Deny-list retained (an allow-list would drop B30/B100). A tripwire for a future tenant using ITEM as fuel is a noted follow-up. |
| Report `orderCount` counts product *lines*, not orders | DeepSeek #4, Kimi #6 | Pre-existing; the label ("N orders" in CSV, "N deliveries" in the invoice note) is the imprecise part. Cosmetic. |
| Fail-open on absent `productType` could over-commission if a future caller forgets to select the column | DeepSeek #5 | Deliberate and documented: all 5 broker call sites now select it, and failing closed silently zeroes a caller's whole total. Pinned by test. |
| CSV/XLSX subtotal row puts "Subtotal" in the Unit column | Kimi #5 | Cosmetic, pre-existing, exports reconcile arithmetically. |
| `brokerTotalProfit()` is dead code | GLM #5 | Pre-existing (no template caller). Left alone — deleting unrelated code is out of scope. |
| Typo `mulitplying`; missing trailing newline | Kimi #8, GLM #6 | Fixed. |

## Verification claims

- **Reproduced by two reviewers independently** against live Moxie data: the Aug report moves `16,618.19 → 16,585.19`, exactly the $33.00 fee delta.
- **Tests discriminate** — confirmed by all three via the revert-the-classifier experiment. I additionally verified the new deal-economics test fails (1 fail) against the unfixed `products` line.
- Full API suite **941 pass / 42 fail, zero new failures**; web 113 pass; api, web, types typecheck clean.

## Caveats

- GLM could not reach Moxie's DB; its live-number claim is unverified by it (the other two verified independently).
- None of the three ran the full API suite; each verified only the affected suites. I ran it and diffed against the pre-change baseline.
- Nobody has exercised Moxie's deployed UI end-to-end (no production login) — the last untested link remains a human generating the report and opening an order in the editor.
