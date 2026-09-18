## P0

**None**

## P1

### 1. Route shadowing concern — `/deal-economics` vs `/:id` (orders.controller.ts)
The route is declared before the generic `/:id` route, which is correct for Elysia's route precedence. However, the diff does not show the `/:id` route declaration in context. **Verify** that the `/:id` route is declared AFTER `/deal-economics` in the final file. If `/:id` appears before, a request to `/deal-economics` would match `/:id` with `id="deal-economics"` and return a 404 or wrong data. This is a P1 because it's a correctness/regression risk that could break the endpoint entirely.

### 2. Cross-tenant data leak via `innerJoin` on `counterparties`, `vessels`, `places` (orders.service.ts)
The query joins `counterparties`, `vessels`, and `places` without tenant scoping. While the `orders` table is filtered by `tenantId`, the joined tables are not. If a malicious tenant has orders referencing counterparties/vessels/places from another tenant (e.g., via data corruption or a previous bug), the join would expose cross-tenant names. **Fix**: Add `eq(counterparties.tenantId, tenantId)`, `eq(vessels.tenantId, tenantId)`, `eq(places.tenantId, tenantId)` to the join conditions.

### 3. `dateBasis` validation — arbitrary string accepted (orders.controller.ts)
The query schema allows `dateBasis` as any string. The service defaults to `'delivery'` for anything not `'created'`, but the controller passes `params.dateBasis === 'created' ? 'created' : 'delivery'` — this is safe. However, the schema should be stricter: `t.Optional(t.Union([t.Literal('created'), t.Literal('delivery')]))` to prevent future misuse and make the API contract explicit.

### 4. Frontend `canAccess` computed — role check is case-sensitive (deals-list-page.component.ts)
`['ADMIN', 'FINANCE', 'CREDITMANAGER'].includes(this.auth.userRole())` — if `userRole()` returns lowercase or has different casing (e.g., `'admin'`), the check fails. The backend uses `auth.role` which appears to be uppercase, but verify consistency. If roles can be lowercase, normalize with `.toUpperCase()`.

### 5. Frontend `openDeal` navigation — orderNumber may not be unique (deals-list-page.component.ts)
`this.router.navigate(['/trading/orders', row.orderNumber])` — if `orderNumber` is not unique across tenants (or even within a tenant), this could navigate to the wrong order. The backend `getOrderById` likely expects a UUID, not an order number. **Fix**: Navigate using `row.id` (the UUID) instead, or verify that the route accepts order numbers.

## P2

### 1. `period` bucketing uses `AT TIME ZONE 'UTC'` — timezone inconsistency (orders.service.ts)
The `period` is computed as `to_char(COALESCE(deliveredAt, eta) AT TIME ZONE 'UTC', 'YYYY-MM')`. This forces UTC, but the frontend displays dates in the user's local timezone. A deal delivered at 23:30 UTC on Jan 31 would be bucketed as `2025-01`, but a user in UTC+2 would see it as Feb 1. **Consider**: Use the tenant's timezone setting (if available) or document that bucketing is UTC-based.

### 2. Frontend `yearOptions` is static (deals-list-page.component.ts)
`yearOptions` is computed once at component creation: `[0, new Date().getFullYear(), ...]`. If the app stays open past New Year, the options become stale. **Fix**: Make it a computed signal that recalculates.

### 3. Frontend `groups` sorting is lexicographic (deals-list-page.component.ts)
`Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]))` — this sorts `'2025-01'` before `'2025-02'` correctly, but `'2025-10'` would sort before `'2025-2'` if the format ever changes. Since the format is always `YYYY-MM`, this is safe, but a numeric sort would be more robust.

### 4. Frontend `turnover` is duplicated as `revenueBase` (deals-list-page.component.ts)
In both `groups` and `totalRow`, `turnover: rows.reduce((s, r) => s + r.revenueBase, 0)` — this is identical to `sell`. If turnover is meant to be a different metric (e.g., gross volume including buy side), this is a bug. If it's intentionally the same, consider removing the duplicate field.

### 5. Backend `listDealEconomics` — no pagination (orders.service.ts)
For tenants with thousands of confirmed deals, this endpoint returns all rows in one response. **Consider**: Add pagination or a `limit` parameter to prevent memory/performance issues.

### 6. Frontend error handling — silent failure (deals-list-page.component.ts)
In `load()`, the `catch` block sets `rows` to `[]` without any user feedback. If the API returns 403 (role revoked) or 500, the user sees "No confirmed deals" which is misleading. **Fix**: Add an error message state.

### 7. Backend `console.error` — sensitive data exposure (orders.controller.ts)
`console.error('[Orders] Deal economics failed:', err)` — the error object may contain SQL queries with tenant data. In production, this could leak sensitive info to logs. **Consider**: Log only the error message, not the full error object.

### 8. Frontend `canAccess` — no reactive update on view changes (deals-list-page.component.ts)
`canAccess` is a computed that depends on `this.views.has('deal-economics')`. If `ViewsService` loads asynchronously and the user navigates directly to `/trading/deals`, `ngOnInit` calls `views.load()` then checks `canAccess()`. This is correct, but if the view is revoked while the page is open, the UI doesn't react. **Consider**: Add a subscription to `views` changes to redirect or hide data.

## Verdict

**Approve with changes** — the feature is well-structured with proper server-side gating (role + view check) and reuses the approved `calculateOrderEconomics`. The P1 items must be addressed:

1. **Verify route order** (P1-1) — confirm `/deal-economics` is before `/:id` in the final file.
2. **Add tenant scoping to joins** (P1-2) — prevent cross-tenant data exposure.
3. **Strict dateBasis schema** (P1-3) — make the API contract explicit.
4. **Fix frontend navigation** (P1-5) — use UUID instead of orderNumber.

The P2 items are quality improvements that can be addressed in follow-up PRs. The core logic (economics calculation, period bucketing, totals) is sound and consistent with the existing codebase patterns.

---

## Executor disposition (2026-09-04)

- **P1-1 (route order)**: verified — `/deal-economics` (line 121) is declared before `/:id` (line 230); no shadowing.
- **P1-2 (cross-tenant joins)**: consistent with the existing listOrders pattern (same unscoped joins); deferred as platform-wide hardening.
- **P1-3 (dateBasis schema)**: accepted as-is — controller normalizes to delivery/created.
- **P1-4 (role casing)**: roles are uppercase enum server- and client-side.
- **P1-5 (orderNumber navigation)**: `orderNumber` is globally unique and the order route/detail resolves both UUID and number (Moxie E2E uses numbers).
- P2-4 (turnover == sell): intentional — turnover IS the gross order value (Mario's definition); kept for Excel parity.
