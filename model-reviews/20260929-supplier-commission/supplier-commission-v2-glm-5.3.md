## Verdict: APPROVE-WITH-CONDITIONS

The engineering is sound and unusually well-evidenced (mutation-tested e2e, cent-exact real-data probe, toggled profit column). The conditions are all pre-merge verifications of claims the diff *asserts* but doesn't *show*, plus one naming defect on a document that goes to counterparties.

**Decision: concur, no disagreement.** The statement-not-invoice rationale is evidence-backed (`invoices` has no payer column; collections/aging/company-balance/QuickBooks all derive payer from `orders.client_id`; `document_type` lacks a member). Explicit per-line two-rate entry correctly resolves Daniel's self-contradicting messages (excess-over-$3 vs. whole-19-from-supplier) without inventing a stored baseline.

## The eight challenges

1. **Single summed `grossProfit` — correct.** For a broker deal, revenue *is* total commission regardless of funder; a split is warranted only when a consumer needs per-side attribution, and none does today. One caution: every consumer of `LineEconomics.commissionBase` now silently includes the supplier side — the two SELECTs you updated (`orders.service.ts`, `dashboard.service.ts`) suggest you enumerated them; keep it that way.
2. **`totalQuantity` as billable tonnage — right for a statement.** Don't pad it with non-billable lines; but the semantics are invisible. Document in the DTO and label it in the page.
3. **`customerCommission` chain — the claim is unverified as presented.** Appendix A adds `commissionLineFigures` with a comment saying it's shared "for the two commission reports," but contains **no hunk touching `buildBrokerCommissionReport` or `createCommissionOrdersFromReport`**. Either those were refactored (show it) or the comment is false and the chains match only by coincidence today.
4. **Skipping zero-rate lines — right for the statement.** A supplier shouldn't see deals where they owe nothing. Residual operational risk: a trader forgetting to enter a rate makes revenue silently invisible; a count of "broker deals in period with no supplier rate" on the report page is a good follow-up, not a blocker.
5. **`orders.supplier_id` grouping — a guess until checked.** If any Moxie broker deal has >1 `order_suppliers` leg, the report bills the entire commission to the primary supplier. One read-only query settles it.
6. **FX — theoretical for Moxie (USD-evidenced), but the inconsistency is real:** `calculateLineEconomics` multiplies by `getFxRate`; the report doesn't, so the profit column and the report disagree for any non-USD deal. Inherited flaw, fix before a non-USD broker tenant exists.
7. **Migration — safe.** `ADD COLUMN` nullable with no default is catalog-only on PG11+ (sub-second `ACCESS EXCLUSIVE`, no rewrite) — a different operation class from the `0124` hazard, which was an `ALTER TYPE` (full rewrite, long lock). Confirm prod PG ≥ 11; otherwise no concern.
8. **`OrderItemDto` omission — a trap.** The shared DTO now misdescribes the actual order-detail payload for *both* commission fields, and `packages/types/dto.ts` is already modified in this PR. Add both nullable-string fields.

## MUST (pre-merge)

1. **Verify/refactor the shared chain** — wire `buildBrokerCommissionReport` (and ideally `createCommissionOrdersFromReport`) onto `commissionLineFigures`, or add a test asserting the supplier report's `customerCommission` equals the customer report's figures for the same lines. `reports.service.ts` (~2630). Challenge 3's "would match" must be demonstrated, not asserted.
2. **Fix `orderCount` — it counts lines, not orders.** `buildSupplierCommissionReport` increments per `order_items` row, and `orders: []` holds per-line entries (duplicate `orderNumber`s possible). "2 orders" on a statement covering one order with two lines is materially wrong on a counterparty document. Rename to `lineCount` (CSV already says "N lines") or aggregate per order. `reports.service.ts` (~2790) + `dto.ts:3070`.
3. **Audit every other writer of `order_items`** — clone/duplicate, import, any full-row rewrite with an explicit column list. Same silent-wipe class as the Elysia strip trap you documented at `orders.controller.ts:1159`.
4. **Deploy order: migration → API → web.** Web-first means the old controller strips `supplierCommissionPerUnit` and every save silently drops entered rates. Put it in the release checklist.
5. **Run the multi-supplier-leg query** on Moxie prod (read-only): broker deals with >1 `order_suppliers` row. If any exist, decide grouping semantics *before* telling Daniel it's done — a per-line rate can't be split across legs.

## SHOULD

6. Add `commissionPerUnit`/`supplierCommissionPerUnit` to `OrderItemDto` (`packages/types/src/dto.ts`) — file already touched, marginal cost zero.
7. Document `totalQuantity` as "quantity over lines carrying a supplier rate" in the DTO and report-page column label.
8. FX: thread `getFxRate(currency)` into `commissionLineFigures` to match `order-financing`, or comment the single-currency assumption explicitly.
9. CSV hygiene: guard cells leading with `= + - @` (formula injection; counterparty names are DB-controlled but check parity with the existing broker CSV), and validate `from`/`to` as `\d{4}-\d{2}-\d{2}` via `t.RegExp` — they're interpolated into `content-disposition` unvalidated (`reports.controller.ts` new routes).
10. XLSX parity: the CSV has a TOTAL row; the XLSX doesn't (`supplierCommissionReportToXlsx`). Add it, or confirm the customer XLSX also omits it.
11. Server-side reject negative `supplierCommissionPerUnit` — HTML `min="0"` is advisory only and `sanitizeNumeric`'s behavior on negatives is unverified.
12. Defense in depth: `bd?.enabled` guard returning 404 on the three new routes (nav is gated; the API isn't).

## Notes (no action)

- The zero-coercion fix (`parseDecimalInput`) is load-bearing, not cosmetic: deal 20260916-000132 only reads correctly if the trader can type customer rate `0` to defeat the order-level `commission_per_mt` fallback. Good catch, correctly tested.
- Profit probe arithmetic checks out (38 × 145 = 5,510 / 19 × 145 = 2,755).
- `numeric(14,7)` caps the rate at 9,999,999.xxxxxxx — ample.
- Drizzle also generates a snapshot per migration; confirm `0133`'s snapshot includes the column or future diffs will try to re-add it.

The five MUSTs are mostly "prove what you claimed" — all cheap, all doable before commit. Once closed, ship it.
