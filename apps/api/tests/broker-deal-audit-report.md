# Broker Deal Feature — Implementation Audit Report

**Date:** 2026-07-15  
**Scope:** DB schema, API (orders, credit, reports, settings), frontend

## Summary

7 critical/high bugs found and fixed. Remaining issues are medium/low priority. Per user instruction, the implementation has intentional improvements over the original design doc (per-item commission via `orderItems.commissionPerUnit` instead of per-order `orders.commissionPerMt`, simplified 5-field settings) that should be preserved.

| Severity | Total | Fixed | Remaining |
|----------|-------|-------|-----------|
| 🔴 Critical | 3 | 3 (C1, C2, C3) | 0 |
| 🟠 High | 4 | 4 (H1-H4) | 0 |
| 🟡 Medium | 3 | 0 | 3 (M1-M3) |
| 🔵 Low | 1 | 0 | 1 (L1) |

## Fixed Issues

### C1 ✅ — `isBrokerCreditLine` not selected in credit line queries
**Fix:** Added `isBrokerCreditLine` to both `listCreditLines()` and `getCreditLineById()` SELECT queries.

### C2 ✅ — `autoReleaseBufferDays` not applied in credit auto-release SQL
**Fix:** Pass `bufferDays` from tenant settings to `calcUsedAmountForSupplier()`. SQL now uses `COALESCE(creditDays, 30) + bufferDays`.

### C3 ✅ — `autoReleaseCredit` setting not checked
**Fix:** Pass `autoReleaseCredit` boolean. SQL only applies time-based release when `autoReleaseCredit = true`.

### H1 ✅ — No tenant gating on order create/update
**Fix:** Added `gateBrokerDealFields()` that strips `isBrokerDeal`/`commissionPerMt` when feature disabled.

### H2 ✅ — Settings GET not tenant-scoped
**Fix:** Filter by `auth.tenantId` instead of `.limit(1)`.

### H3 ✅ — Settings PUT not tenant-scoped + `tenant.id` undefined
**Fix:** Select `id` column alongside `settings`. Filter by `auth.tenantId`.

### H4 ✅ — create-commission-orders not admin-only
**Fix:** Added admin role check.

## Remaining Issues (Intentional Improvements / Lower Priority)

### M1 — Unit conversion not implemented in commission report
The report uses raw quantity × rate. `unitConversionFactor` on order items is not used. Test documents this behavior.

### M2 — Commission uses per-item `commissionPerUnit` (intentional improvement)
The report reads from `orderItems.commissionPerUnit` instead of `orders.commissionPerMt`. This is an intentional improvement over the design doc — allows per-line-item commission rates. Preserved per user instruction.

### M3 — `showInvoicingFields` computed is dead code
The `showInvoicingFields` computed is defined in the order detail component (returns false for broker deals) but is NOT used in the HTML template. Invoicing fields are always visible. Test documents this actual behavior.

## Test Summary

| File | Tests | Status |
|------|-------|--------|
| broker-deal-orders.e2e.test.ts | 7 | ✅ |
| broker-deal-commission-report.e2e.test.ts | 12 | ✅ |
| broker-deal-credit.e2e.test.ts | 8 | ✅ |
| broker-deal-settings.e2e.test.ts | 7 | ✅ |
| broker-deals.spec.ts (Playwright) | 6 | ✅ |
| broker-admin-report.spec.ts (Playwright) | 8 | ✅ |
| orders.e2e.test.ts (existing) | 1 | ✅ |
| credit.service.test.ts (existing) | 10 | ✅ |
| **Total** | **59** | **All pass** |