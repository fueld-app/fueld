## Panel review — supplier-funded broker commission report

Overall: **approve with one blocking item to verify (multi-supplier legs) and several non-blocking corrections.** The design decisions already made (two explicit rates, report-not-invoice, tenant gating) are sound, and the implementation is careful. The supplier report correctly avoids the `invoices` payer ambiguity.

### 1. Summing both rates into `calculateLineEconomics.grossProfit`

**Correct as-is.** A broker deal’s profit is total commission earned from both sides. `LineEconomics.grossProfit` is a single profit figure used by surfaces that answer “how much did this deal make?”, not “from whom?”. Adding the supplier rate is the right fix for supplier-funded deals reading as $0.

No split is needed in `LineEconomics`. The split lives in the report DTO and in `order_items` itself. If a downstream consumer later needs source-of-profit, add a separate field then — do not complicate the common path now.

One caveat: `grossProfit` is converted by `getFxRate(currency)`, so it is base-currency, while the report totals are raw currency. Those surfaces will disagree when base currency ≠ line currency. That is acceptable if the profit column is explicitly base-currency, but it should be documented.

### 2. `totalQuantity` semantics

**Current semantics are correct for a billing statement**, but the name is misleading. The supplier report is a commission statement; its quantity should be “quantity on which supplier commission was charged”. Including all deal tonnage would make the subtotal quantity meaningless against the subtotal commission.

Rename the field/column to `billableQuantity` or `commissionableQuantity` (DTO + UI) so it cannot be read as “deal tonnage”. Keep the current computation.

### 3. `customerCommission` resolved through the full fallback chain

The fallback chain itself is likely shared with `createCommissionOrdersFromReport`, so the customer-side context should match what an invoice created from the customer report would bill. **But verify the quantity basis.** `commissionLineFigures` uses `deliveredQuantity ?? quantity`. If `createCommissionOrdersFromReport` uses ordered `quantity` only, then on partially delivered deals the supplier report’s `customerCommission` will differ from the actual customer invoice.

Also note: if no customer invoice has been generated yet, the `customerCommission` figure is a system-derived reference (including the tenant default), not a record of an actual billing. Label it clearly in the UI/export as “Customer commission (system)” or add a note so Moxie does not treat it as an issued invoice amount.

### 4. Skipping zero-supplier-rate lines

**Correct.** A supplier commission statement should contain only lines where the supplier owes something. A zero row for every non-supplier-funded line would duplicate the customer report and destroy the meaning of `totalQuantity`.

If Moxie later wants an “all broker deals, who pays what” reconciliation, that is a separate report. Do not add zero rows here.

### 5. `orders.supplier_id` as grouping party

**This is the one blocking item to verify.** The code groups by the legacy primary `orders.supplier_id`. If any broker deal has more than one supplier leg in `order_suppliers`, the report will attribute all supplier commission to the primary supplier, silently under-billing secondary suppliers.

The data evidence shows one supplier per order, but that is a small sample. Check production for broker deals with multiple `order_suppliers` rows. If none exist today, the feature can ship with a guard: when an order has multiple supplier legs and any line has a non-null `supplierCommissionPerUnit`, either fail/warn or require line-level supplier assignment. If multi-supplier deals are possible, the current model is incomplete and needs a line-to-supplier-leg mapping before this can be correct.

### 6. No FX conversion in commission reports

**Theoretical for Moxie if all their deals are USD, but real for any non-USD line.** The report totals are in `commissionCurrency` (default USD), but line amounts are raw `rate × qty` in the line’s own currency. A EUR line would be added to USD totals as if 1 EUR = 1 USD.

Since Moxie’s current deals are USD, this is not an immediate production bug, but it is a latent defect. Fix both the existing customer report and the new supplier report with `getFxRate(currency)`, or at minimum add an explicit assertion/comment that all included lines must already be in the report currency. Do not leave it undocumented.

### 7. Migration safety

**Safe.** `ADD COLUMN supplier_commission_per_unit numeric(14,7)` nullable with no default is metadata-only on modern Postgres — it does not rewrite the table and takes only a brief `ACCESS EXCLUSIVE` lock. The hazard on `0124_price_precision_7dp.sql` was likely an `ALTER COLUMN TYPE` or adding a default, which does rewrite. No concern here.

### 8. Shared DTO omission / missed plumbing

**Yes, add both commission fields to `OrderItemDto`.** Leaving `supplierCommissionPerUnit` (and the existing `commissionPerUnit`) out of the shared DTO is a trap for any future API consumer that generates types from `packages/types`. The controller schema now includes the field, so the shared DTO is wrong. Add both.

Also verify these additional places:
- Any **create-order** endpoint that accepts an `items` array — the controller diff shows the field in the items body schema, but confirm that schema is shared by create and update, not only `saveOrderItems`.
- **`buildBrokerCommissionReport`** — if it now uses `commissionLineFigures`, its row SELECT must include `supplierCommissionPerUnit` or the shared helper will not compile.
- **Order copy / duplicate / import-export** flows, if they reconstruct order items, must carry the new column or supplier-funded commissions will be lost on copy.

---

### Additional non-blocking observations

- **Date filtering in memory** — the supplier report fetches all broker orders with the configured statuses and filters by date in JS. For Moxie’s volume this is fine, but it is inefficient and inherits the existing pattern. Consider moving the date predicate into SQL later.
- **Negative supplier rates** — the UI has `min="0"`, but the API does not validate non-negative. A negative rate would produce negative commission and silently reduce the supplier’s total. Add API validation or a sanitizer guard.
- **`commissionLineFigures` quantity basis** — it uses `deliveredQuantity ?? quantity`. Verify `calculateLineEconomics` uses the same basis; otherwise the profit column and the report can disagree on partially delivered deals.

No change is needed to the report-not-invoice decision. The `invoices` payer problem is real; do not add supplier invoice rows without a schema-level payer/direction column.
