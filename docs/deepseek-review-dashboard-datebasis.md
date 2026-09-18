### P0 (Bugs/Security/Data Loss)

- **None found.** The change does not introduce any security vulnerabilities, data loss, or critical runtime failures. The `parseDateBasis` function safely defaults to `'created'` for invalid/undefined values, and the SQL uses parameterized values (via `toISOString()::timestamptz`) to prevent injection.

---

### P1 (Logic Errors)

1. **`getTeamStats` delivery basis excludes orders with no ETA/deliveredAt, but `getPipelineSummary` and `getConversionMetrics` may double-count or misattribute orders across periods**  
   - In `applyOrderPeriodFilter`, for `'delivery'` basis, the condition `COALESCE(deliveredAt, eta) >= from` and `<= to` is applied. However, for orders that have both `deliveredAt` and `eta` (e.g., a delivered order with a future ETA), the `COALESCE` picks `deliveredAt`, which is correct. But for undelivered orders with an ETA, the ETA is used. This is fine.  
   - **Issue:** In `getPipelineSummary` and `getConversionMetrics`, the `status` filter (e.g., `inArray(orders.status, ['CONFIRMED', 'DELIVERED', ...])`) is applied *after* the date filter. For a delivered order with `deliveredAt` in March but `createdAt` in January, the delivery basis correctly includes it in March. However, if the order status is `'CONFIRMED'` (undelivered) but has an ETA in March, it will be counted in March. This is intended.  
   - **Potential logic error:** The `applyOrderPeriodFilter` for `'delivery'` adds `(deliveredAt IS NOT NULL OR eta IS NOT NULL)` to the conditions. This is applied to *all* queries, including `getTeamStats`, which also has `notInArray(orders.status, revenueExcludedStatuses)`. If an order has `status = 'CANCELLED'` but has an ETA, it will be excluded by the status filter, which is correct. No P1 here.

2. **`getTeamStats` delivery basis may produce inconsistent `orderCount` vs `totalValue` for orders with no ETA/deliveredAt**  
   - In `getTeamStats`, the `baseConditions` include `applyOrderPeriodFilter`, which for `'delivery'` excludes orders with no ETA/deliveredAt. This means the `orderCount` and `totalValue` will both be zero for such orders, which is consistent.  
   - **However:** The `getTeamStats` function also computes `activeOrders` and `totalValue` from the same `orderRows`. If an order has `deliveredAt` in the period but `status` is `'CANCELLED'` (which is in `revenueExcludedStatuses`), it will be excluded entirely. This is pre-existing behavior, not a regression.

3. **`getLossAnalysis` with `'delivery'` basis may exclude cancelled/lost orders that have no ETA/deliveredAt**  
   - `getLossAnalysis` filters for `status IN ('CANCELLED', 'LOST')` and `lossReason IS NOT NULL`. With `'delivery'` basis, the `applyOrderPeriodFilter` adds `(deliveredAt IS NOT NULL OR eta IS NOT NULL)`. A cancelled order that was never delivered and has no ETA will be excluded from the loss analysis, even if it was created in the period. This is a **logic error** because the loss analysis is meant to capture all cancelled/lost orders in a period, regardless of delivery/ETA. The change summary says "orders with NEITHER delivered_at NOR eta are EXCLUDED (strict delivery view)", but for loss analysis, this may hide important data (e.g., a cancelled order with no ETA). This is a **P1** because it changes the semantics of loss analysis in a way that may under-report losses.

4. **Frontend `buildDateQuery` always sets `dateBasis` param, but the API's `getFollowUps` endpoint does not accept it**  
   - The diff shows `getFollowUps` in the controller has a `dateBasis` query param added (line 160), but the service function `getFollowUps` is not shown in the diff. If `getFollowUps` does not use `dateBasis`, the param is ignored, which is fine. But if the frontend sends `dateBasis` to `/dashboard/follow-ups` and the service doesn't filter by it, the follow-ups will still use `createdAt`, which may be inconsistent with the dashboard's delivery basis. This is a **P1** if the follow-ups are expected to align with the selected date basis.

---

### P2 (Minor)

1. **`parseDateBasis` default is `'created'`, but the frontend default is `'delivery'`**  
   - The API defaults to `'created'` for backward compatibility, but the frontend defaults to `'delivery'`. This means if a client (e.g., a mobile app or third-party) calls the API without `dateBasis`, they get `'created'`, while the web app sends `'delivery'`. This is intentional per the change summary, but it could cause confusion if other clients are not updated. Minor.

2. **`applyOrderPeriodFilter` uses `toISOString()::timestamptz` for `fromDate`/`toDate`**  
   - The `fromDate` and `toDate` are passed as `Date` objects, and `toISOString()` converts to UTC. This is correct, but the `toDate` for `'created'` basis uses `lte(orders.createdAt, toDate)`, which includes orders created exactly at `toDate` (e.g., `2026-03-31T23:59:59`). For `'delivery'` basis, the `COALESCE` comparison uses `<=`, which is also inclusive. This is consistent.

3. **Frontend toggle UI: `aria-checked` is set to `dateBasis() === 'created'`, but the toggle's visual state is inverted**  
   - The button's `[class.bg-brand-700]` is applied when `dateBasis() === 'created'`, and the knob translates right when `dateBasis() === 'created'`. This means the toggle is "on" for `'created'` and "off" for `'delivery'`. The labels are "Delivery" (left) and "Created" (right), but the knob position is not intuitive: when `'delivery'` is selected, the knob is on the left, which might imply "off". This is a UX minor issue.

4. **Test in `apps/api/tests/dashboard.service.test.ts` uses `getTeamStats` with `user.id` but the user role is set to `ADMIN`**  
   - The test sets `user.role = 'ADMIN'` to ensure visibility, but `getTeamStats` uses `resolveVisibleTraderIds`. If the user is an admin, it should see all traders. This is fine, but the test could be more explicit.

---

### Verdict

**Approve with minor changes.** The core logic for `'delivery'` basis is correct and well-tested. The main concern is the **P1** issue with `getLossAnalysis` excluding cancelled/lost orders with no ETA/deliveredAt, which may under-report losses. Additionally, ensure `getFollowUps` either uses `dateBasis` or is explicitly documented as not using it. The frontend toggle UX is minor and can be improved. No P0 issues found.

---

## Executor disposition (2026-09-03)

- P1 #3 (loss analysis excludes cancelled/lost orders without ETA/deliveredAt in delivery mode): **by design** — the user explicitly confirmed the strict delivery-date view ("Exclude them in delivery mode") for ALL order-based metrics. Documented in goal contract.
- P1 #4 (follow-ups dateBasis): follow-ups are comment follow-up-date based, not order-delivery based — intentionally ignores dateBasis. The query schema accepts the param harmlessly since the frontend sends the same query string to all dashboard endpoints.
- P2 #3 (toggle knob UX): knob-right = Created, matching the label order Delivery|Created; consistent with the adjacent My Orders|Team View switch pattern.
- P1 #1/#2: self-resolved rambling, no actionable issue.
