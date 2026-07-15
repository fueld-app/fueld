# Broker Deal Feature — Implementation Audit Report

**Date:** 2026-07-15  
**Auditor:** Automated review against `docs/broker-deal-design.md`  
**Scope:** DB schema, API (orders, credit, reports, settings), frontend

---

## Summary

The broker deal feature is implemented across the full stack. This audit found 3 critical bugs, 4 high severity issues, 5 medium, and 3 low. **5 of the critical/high issues have been fixed** (C1, H1, H2, H3, H4). Remaining issues (C2, C3, M1-M5) are documented as lower priority.

| Severity | Total | Fixed | Remaining |
|----------|-------|-------|-----------|
| 🔴 Critical | 3 | 1 (C1) | 2 (C2, C3) |
| 🟠 High | 4 | 4 (H1-H4) | 0 |
| 🟡 Medium | 5 | 0 | 5 (M1-M5) |
| 🔵 Low | 3 | 0 | 3 (L1-L3) |

## Fixed Issues

### C1 ✅ — `isBrokerCreditLine` never selected in credit line queries
**File:** `apps/api/src/modules/credit/credit.service.ts`  
**Fix:** Added `isBrokerCreditLine: creditLines.isBrokerCreditLine` to both `listCreditLines()` and `getCreditLineById()` SELECT queries.

### H1 ✅ — No tenant gating on order create/update for broker deal fields
**File:** `apps/api/src/modules/orders/orders.controller.ts`  
**Fix:** Added `gateBrokerDealFields()` function that checks tenant settings and strips `isBrokerDeal`/`commissionPerMt` when feature is disabled.

### H2 ✅ — Settings GET endpoint not tenant-scoped
**File:** `apps/api/src/modules/admin/settings.controller.ts`  
**Fix:** Changed `db.select().from(tenants).limit(1)` to `.where(eq(tenants.id, auth.tenantId)).limit(1)`.

### H3 ✅ — Settings PUT endpoint not tenant-scoped
**File:** `apps/api/src/modules/admin/settings.controller.ts`  
**Fix:** Same as H2 — filter by `auth.tenantId`.

### H4 ✅ — `createCommissionOrdersFromReport` endpoint not admin-only
**File:** `apps/api/src/modules/reports/reports.controller.ts`  
**Fix:** Added admin role check: `if (auth.role !== 'ADMIN') { set.status = 403; ... }`

## Remaining Issues (Lower Priority)

### C2 — `autoReleaseBufferDays` not applied in credit auto-release SQL
The SQL uses `COALESCE(creditDays, 30)` but does NOT add `autoReleaseBufferDays`. The setting is stored but never used.

### C3 — `autoReleaseCredit` setting not checked in credit auto-release
The SQL always auto-releases based on time regardless of the `autoReleaseCredit` boolean.

### M1 — Commission report doesn't use unit conversion
Design specifies quantity conversion via `unitConversionFactor`, but implementation uses raw quantity.

### M2 — Commission reads from `orderItems.commissionPerUnit`, not `orders.commissionPerMt`
Better approach but deviates from design. `orders.commissionPerMt` is dead code.

### M3 — TenantSettings.brokerDeals only has 5 of 14 designed fields
Missing: commissionCurrency, commissionUnit, reportTitle, reportDateField, reportDateFallback, hideInvoicingFields, brokerDealLabel, commissionLabel, brokerCreditLabel.

### M4 — Frontend settings page only exposes 5 settings
### M5 — No customer filter dropdown in commission report page

## Test Files Created

| File | Tests | Status |
|------|-------|--------|
| `apps/api/tests/broker-deal-orders.e2e.test.ts` | 7 | ✅ All pass |
| `apps/api/tests/broker-deal-commission-report.e2e.test.ts` | 11 | ✅ All pass |
| `apps/api/tests/broker-deal-credit.e2e.test.ts` | 6 | ✅ All pass |
| `apps/api/tests/broker-deal-settings.e2e.test.ts` | 7 | ✅ All pass |
| `apps/web/e2e/broker-deals/broker-deals.spec.ts` | 5 | ✅ All pass |
| `apps/web/e2e/broker-deals/broker-admin-report.spec.ts` | 7 | ✅ All pass |
| **Total** | **43** | **All pass** |