## P0 Issues

### 1. **Critical: `getMonthlyHistory` uses `calculateOrderEconomics` with empty terms object — breaks existing net/gross semantics**
**File:** `apps/api/src/modules/dashboard/dashboard.service.ts`

The call `calculateOrderEconomics({}, items, ...)` passes an empty `FinancingTermsInput` object. This will cause `getFinancingDays(terms)` to fail or return incorrect values, potentially throwing an error or producing wrong financing calculations. The existing `calculateOrderEconomics` signature requires proper terms (customerPaymentTermType, supplierPaymentTermType) — passing `{}` will likely throw a TypeError when accessing `terms.customerPaymentTermType`.

**Fix:** Pass proper terms or refactor to use a dedicated function that doesn't require financing terms.

### 2. **Critical: `tpcPerMt` and `traderCommissionPct` are `numeric` columns but passed as strings to `parseNumber` — potential precision loss**
**File:** `apps/api/src/modules/orders/order-financing.ts`

The `numeric` columns return strings from Drizzle, but `parseNumber` may not handle all edge cases (e.g., `null`, empty string, scientific notation). More critically, the `totalTpc` calculation uses `totals.totalQuantity * tpcPerMt * tpcRate` — if `tpcPerMt` is a string like `"109.228"`, the multiplication will coerce it to a number, but if it's `null` or `undefined`, `parseNumber` returns `0` which is correct, but the code doesn't validate that `tpcCurrency` is a valid currency before calling `getFxRate`.

### 3. **Critical: `getMonthlyHistory` doesn't check `enabledViews` — data leakage to non-enabled tenants**
**File:** `apps/api/src/modules/dashboard/dashboard.controller.ts`

The `GET /dashboard/monthly-history` endpoint has no check for the `performance-history` view being enabled. Any authenticated user (non-light) can call this endpoint and get profit/turnover data even if the tenant hasn't enabled the view. The frontend gates it, but the API is exposed.

**Fix:** Add a check in the controller: if `!tenant.settings.enabledViews?.includes('performance-history')`, return empty.

### 4. **Critical: `gateDealEconomicsFields` doesn't validate `salesRepId` belongs to the tenant**
**File:** `apps/api/src/modules/orders/orders.controller.ts`

When auto-filling `traderCommissionPct`, the function looks up `schemes.find((c) => c.userId === salesRepId)` but doesn't verify that `salesRepId` is a valid user in the tenant. A malicious client could pass any `salesRepId` to get a commission rate from another tenant's config (if the scheme exists with that userId).

**Fix:** Validate `salesRepId` belongs to the tenant before using it for auto-fill.

---

## P1 Issues

### 1. **High: `tpcCurrency` not validated — could be arbitrary string causing `getFxRate` to throw**
**File:** `apps/api/src/modules/orders/order-financing.ts`

`getFxRate(normalizedCurrency(dealCommissions?.tpcCurrency))` — if `tpcCurrency` is an invalid currency code (e.g., "XYZ"), `getFxRate` may throw or return undefined, causing `totalTpc` to be `NaN` or incorrect.

**Fix:** Validate currency against a known list; default to USD if invalid.

### 2. **High: `traderCommissionPct` auto-fill race condition in `gateDealEconomicsFields`**
**File:** `apps/api/src/modules/orders/orders.controller.ts`

The function reads tenant settings, then modifies the body. If two concurrent requests (e.g., autosave + manual save) hit the same order, the second request may overwrite the first's auto-filled value. Also, the function doesn't handle the case where `body.traderCommissionPct` is explicitly `null` (user wants to clear it) — it will auto-fill it again.

**Fix:** Only auto-fill if `body.traderCommissionPct === undefined` (not null), and consider using a transaction or optimistic locking.

### 3. **High: Frontend `totalTpc` calculation doesn't match backend — currency conversion mismatch**
**File:** `apps/web/src/app/features/trading/components/order-items/order-items.component.ts`

The frontend computes `totalTpc` using `this.getFxRate(cur)` and `this.toDisplayCurrency(...)`, but the backend uses `getFxRate(normalizedCurrency(dealCommissions?.tpcCurrency))` directly. If the display currency differs from the TPC currency, the frontend and backend will show different values.

**Fix:** Ensure both use the same currency conversion logic and base currency.

### 4. **High: `getMonthlyHistory` doesn't handle `tpcCurrency` being null — `getFxRate(null)` behavior undefined**
**File:** `apps/api/src/modules/dashboard/dashboard.service.ts`

When `tpcCurrency` is null (which is the default for orders without TPC), `getFxRate(normalizedCurrency(null))` may return undefined or throw. The code should default to USD or skip TPC calculation when currency is null.

### 5. **High: `ViewsService.load()` caches forever — tenant settings changes not reflected until page reload**
**File:** `apps/web/src/app/core/views/views.service.ts`

The `loaded` flag prevents re-fetching. If an admin enables/disables a view while a user has the app open, the user won't see the change until full page reload. This could cause confusion and potential data exposure if a view is disabled but still shown.

**Fix:** Add a TTL or re-fetch on route change.

---

## P2 Issues

### 1. **Medium: `tpcPerMt` and `traderCommissionPct` are `numeric` but frontend sends strings — type mismatch in DTO**
**File:** `packages/types/src/dto.ts`

The DTO declares `tpcPerMt?: string | null` but the frontend sends strings from inputs. This is consistent, but the backend `numeric` columns will return strings, and the frontend `Number()` conversion in `order-items.component.ts` could lose precision for large values.

### 2. **Medium: `getMonthlyHistory` doesn't include `orderCount` in the response type**
**File:** `apps/api/src/modules/dashboard/dashboard.service.ts`

The `MonthlyHistoryPoint` interface includes `orderCount`, but the frontend type in `dashboard-page.component.ts` doesn't include it. This is a minor type mismatch.

### 3. **Medium: `onDealTypeChange` clears `traderCommissionPct` but doesn't trigger a save**
**File:** `apps/web/src/app/features/trading/pages/order-detail/order-detail-page.component.ts`

The comment says "the server re-fills it from the tenant traderCommissions scheme on save" — but if the user changes deal type and doesn't save, the UI shows `null` for commission while the server still has the old value. This could confuse users.

### 4. **Low: `ViewsSettingsCardComponent` doesn't validate JSON input for rates**
**File:** `apps/web/src/app/features/admin/pages/settings/views-settings-card.component.ts`

The `updateRates` method silently ignores invalid JSON, but the user sees no error. They might think the rates were saved when they weren't.

### 5. **Low: `getMonthlyHistory` doesn't handle timezone correctly for month bucketing**
**File:** `apps/api/src/modules/dashboard/dashboard.service.ts`

`String(row.period).slice(0, 7)` extracts YYYY-MM from the timestamp, but this is in the database's timezone, not necessarily the tenant's timezone. Orders near month boundaries could be bucketed incorrectly.

### 6. **Low: No migration file for the new columns**
The diff shows schema changes but no migration file (e.g., `0117` mentioned in the plan). This could cause deployment issues.

---

## Verdict

**Conditional Go** — The feature is well-designed and addresses a real business need, but there are critical issues that must be fixed before production:

1. **P0-1 (empty terms object)** will likely cause runtime errors in the dashboard endpoint.
2. **P0-2 (missing view gating on API)** is a data leakage risk.
3. **P0-3 (salesRepId validation)** is a cross-tenant data access risk.
4. **P0-4 (currency validation)** could cause calculation errors.

The calculation logic itself (TPC, trader commission, trading profit) matches the business rules, and the backward-compatible approach to `calculateOrderEconomics` is sound. The frontend gating via `ViewsService` is a good pattern, but the API must enforce the same gates.

**Recommendation:** Fix all P0s, address the P1s (especially currency handling and race conditions), then proceed with the phased rollout. The plan's decision to gate Phase 2 on clarifying with Mario is correct — the commission semantics need confirmation before production use.

---

## Executor disposition (2026-09-04)

- **P0-1 (empty terms object)**: false positive — `getFinancingDays({})` returns 0 (COD path); the endpoint only uses tradingProfit (pre-financing), not netProfit. Safe.
- **P0-2 (parseNumber/precision)**: false positive — parseNumber handles null/empty → 0; getFxRate falls back to 1 for unknown codes.
- **P0-3 (monthly-history not view-gated)**: VALID — fixed. Controller now returns empty when the tenant has not enabled 'performance-history'.
- **P0-4 (salesRepId cross-tenant)**: false positive — schemes come from the *calling* tenant's settings; a foreign userId simply won't match → no auto-fill, no data returned.
- P1-2 (auto-fill race): the gate treats explicit `null` as fillable and explicit values as overrides; concurrent autosaves converge to the scheme value.
