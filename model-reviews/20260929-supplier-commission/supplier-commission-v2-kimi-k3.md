# Panel Review — Supplier-Funded Broker Commission

**Verdict: APPROVE-WITH-CONDITIONS** — two MUSTs below, neither requires redesign. The core modeling decision (explicit per-line supplier rate, statement-not-invoice, no fallback chain) is sound and I do not dispute it.

---

## Agreement with the decision

- **Report, not invoice: correct.** The stated rationale stands on its own evidence — if `invoices` truly has no payer column and collections/aging/company-balance/QB all resolve payer from `orders.client_id`, a supplier-addressed invoice row would silently corrupt four downstream consumers. Statement is the right deliverable.
- **Explicit two-rate model: correct.** The two WhatsApp messages are genuinely irreconcilable under a "$3 baseline + excess" model; two stored numbers is the only design that satisfies both.
- **No fallback chain for the supplier rate: correct**, and the NULL-means-zero reading for pre-existing rows is safe because the column is new.

## Answers to the posed challenges (condensed)

1. **Summed `grossProfit`**: correct for every surface named (list column, dashboard KPIs). Moxie's revenue *is* commission; who pays is irrelevant to "did this deal make money." Note the semantic shift: `grossProfit` for broker deals now exceeds what `createCommissionOrdersFromReport` can ever bill. Documented in the diff comment — acceptable. No split needed now.
2. **`totalQuantity`**: "tonnes that generated supplier commission" is the right reading for a billing statement. Agree.
3. **`customerCommission` via full chain**: the claim holds **iff** `createCommissionOrdersFromReport` consumes `buildBrokerCommissionReport` output — the adjacent `CommissionOrderCreationResult` interface implies it does. But the refactor of the *customer* report onto `commissionLineFigures` is not in Appendix A; if the customer report still carries inline math, the anti-drift guarantee is aspirational. See SHOULD-2.
4. **Skipping zero lines**: correct for a statement, but creates a silent-revenue-loss path (trader forgets the rate → deal vanishes from the only surface that would reveal the omission). See SHOULD-4.
5. **`orders.supplier_id` only**: unproven assumption on production data. See MUST-2.
6. **No FX**: theoretical for Moxie (your own evidence: all deals USD), but the report labels totals with a *tenant-configurable* `commissionCurrency` it never converts into. A tenant setting `commissionCurrency: 'EUR'` gets USD sums labeled EUR. See SHOULD-5.
7. **Migration**: safe. `ADD COLUMN numeric(14,7) NULL, no default` is metadata-only in Postgres ≥11 — instantaneous, brief ACCESS EXCLUSIVE lock, no table rewrite. The `0124` hazard was an `ALTER TYPE` (full rewrite); not comparable. Run off-peak as standard practice. No objection.
8. **Shared DTO gap**: a trap, and it grows with every new field. See SHOULD-6.

## Additional findings (not in your list)

- **F1 — Tenant gating is UI-only; the API contradicts the decision record.** The decision says "No other tenant sees it." The three new routes (`reports.controller.ts:419–468`) check only bearer auth; the new body field (`orders.controller.ts:1159`) is accepted from any tenant. Any authenticated user of any tenant can read/write this feature.
- **F2 — Statement doesn't foot.** Lines are formatted with `.toFixed(2)` but totals accumulate raw floats (`reports.service.ts`, `bySupplierMap` loop). With scale-7 rates (UI step is `0.0001`), the displayed subtotal can differ from the sum of displayed lines by cents — on a document sent to a counterparty to request money, that invites disputes.
- **F3 — Negative rates pass end-to-end.** `min="0"` on an `<input type="number">` is not enforced; `sanitizeNumeric` presumably passes strings through; the report skips only `=== 0`. A negative supplier rate would silently reduce a supplier's statement total.
- **F4 — Full-history scan before date filtering.** The query has no date predicate; filtering is in JS after fetching every broker-deal row for the tenant. Fine at Moxie's scale; it is an unbounded growth pattern mirrored from the customer report.
- **F5 — Minor:** `from`/`to` are unconstrained `t.String()` interpolated into a `Content-Disposition` filename; CSV cells are not guarded against spreadsheet formula injection. Both pre-existing patterns, both one-line fixes.

## Action items

**MUST-1 — Reconcile gating (F1).** Either enforce `brokerDeals.enabled` server-side on the three new routes (404/403 when disabled — cheap, settings are already fetched in the service) and reject `supplierCommissionPerUnit` for non-enabled tenants, or amend the decision record to say "UI-gated only." The current code falsifies the written claim. — `apps/api/src/modules/reports/reports.controller.ts:419–468`

**MUST-2 — Gate first real use on the multi-leg data check (challenge 5).** Before Moxie sends its first statement, run read-only against production: does any broker deal have >1 row in `order_suppliers`? If yes, this report misattributes commission to the primary leg and must not be used for those deals until legs are joined per-line. Record the result in the PR.

**SHOULD-1 — Make the statement foot (F2).** Round each line to cents, then sum rounded values for subtotals/grand total in `buildSupplierCommissionReport` (`reports.service.ts`, accumulation loop) so displayed lines sum exactly to displayed totals.

**SHOULD-2 — Confirm the customer report actually uses `commissionLineFigures`.** Not visible in Appendix A. If it doesn't, wire it or add a cross-report drift test. — `reports.service.ts:2614` area.

**SHOULD-3 — Clamp at write time (F3).** Reject `'NaN'`/`'Infinity'`/negatives in `sanitizeNumeric` or a CHECK constraint (`supplier_commission_per_unit >= 0`). Defense at one boundary instead of every reader. — `schema.ts:~1323`, `orders.service.ts:2082`.

**SHOULD-4 — Surface skipped deals.** Add a count (or list) of in-period broker deals with a supplier but no supplier rate to the DTO, so a forgotten rate is detectable. — `reports.service.ts`, return payload; `packages/types/src/dto.ts:~3041`.

**SHOULD-5 — Currency honesty (F1/challenge 6).** Either convert via `getFxRate` per line or hard-label the report "amounts unconverted; USD assumed" and ignore `commissionCurrency` until conversion exists.

**SHOULD-6 — Add both commission fields to `OrderItemDto`** in `packages/types` now that two fields share the local-typing workaround.

**SHOULD-7 — Audit all `order_items` writers/readers** for the Elysia-strip trap: duplicate-order, PATCH items, import paths, and the web-side item payload builders. One missed path = silent column wipe, the exact hazard the controller comment documents.

**Nit —** Name the new DTO field `supplierCommissionPerMt` instead of reusing customer-report `commissionPerMt` naming on net-new API surface. — `dto.ts:~3060`.

## Verification gaps acknowledged

Production migration untried (low risk per challenge-7 analysis), deployed UI unverified, pre-existing suite failures unrelated. Rollout notes, not blockers.

**Conditions for the approval:** MUST-1 and MUST-2 resolved (code change + a query result, respectively). Everything else is SHOULD.
