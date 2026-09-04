# Code Review — Deals Register (`/orders/deal-economics` + `/trading/deals`)

## P0

None.

Security posture is sound: role check runs before any DB access, tenant view-gate is enforced server-side (frontend gating is cosmetic only, correctly so), all queries are tenant-scoped (`eq(orders.tenantId, ...)`), items are fetched only for already tenant-filtered order IDs, and Drizzle `sql` templates parameterize the date values. One conditional build-break risk is tracked as P1-3.

## P1

**1. `dateBasis` toggle never re-fetches — mislabeled financials** (`deals-list-page.component.ts`)
The Delivery/Created switch only does `dateBasis.set(...)`; `load()` is called only from `ngOnInit` and `onYearChange`. A user flips to "Created", the UI labels the data as created-basis, but the numbers remain delivery-basis until they also change the year. On a finance register this is a mislabeled-numbers bug, not a cosmetic one. Fix: call `void this.load()` in the toggle handler (or use an `effect`).

**2. `calculateOrderEconomics({}, items, ...)` — empty order context** (`orders.service.ts`, `listDealEconomics`)
The function is pre-approved, but the *call site* is new and passes `{}` as the order. If it reads any order-level field — `status` to decide delivered vs. ordered quantity (these rows are DELIVERED/INVOICED/PAID, where `deliveredQuantity` should win), or delivery/payment-term dates for the financing term — the register's Qty/Buy/Sell/Profit will be computed from the wrong basis, and a `NaN` result would also break Angular's `number` pipe rendering. Verify which fields it consumes; if any, pass them from the row (you already select most of what's needed). If `{}` is intentionally sufficient, add a one-line comment saying so.

**3. Controller uses `db`, `tenants`, `eq` — imports not in the diff** (`orders.controller.ts`)
The handler queries the DB directly (`db.select(...).from(tenants).where(eq(...))`), but the diff only adds `listDealEconomics` to the service import. If the controller doesn't already import `db`/`tenants`/`eq`/`ApiResponse`, this fails `tsc` — i.e., a build break (P0 in practice). Verify. Regardless, prefer moving the enabled-views check into `listDealEconomics` (or a small `isViewEnabled(tenantId, view)` helper) to keep the controller thin and make the gate reusable for the "per-user view assignment" you already anticipate.

## P2

- **Forbidden returns HTTP 200** — `{ success: false, message: 'Forbidden' }` should set `set.status = 403` so clients/proxies/logs can distinguish authz failures (and match how the frontend swallows it silently today).
- **Date handling inconsistencies** (`orders.service.ts`):
  - `new Date(\`${opts.from}T00:00:00\`)` parses in **server-local time**, while `period` grouping uses `AT TIME ZONE 'UTC'` — a deal near a month boundary can be grouped into a month the filter excludes (VPS is probably UTC, but don't rely on it). Use `T00:00:00Z` / `T23:59:59.999Z`.
  - `to` uses `T23:59:59`, dropping anything in the final second; use `< from + 1 day` semantics or `.999`.
  - `from`/`to` are unvalidated strings; garbage input throws `RangeError` on `toISOString()` — caught by the try/catch, but validate with a date regex (or `format: 'date'` on the query schema) and return a 400 instead of a 500-flavored failure.
- **Duplicate `orderItems` queries** — `itemRows` and `itemTypes` scan the same table with different projections; merge into one select and derive both maps.
- **No bound on result size** — "All time" loads every confirmed+ order and its items into memory and renders them all. Acceptable for single-tenant-per-VPS today; add a limit/pagination before this becomes the slowest endpoint on the box.
- **Role list triplicated** (`orders.controller.ts`, `deals-list-page.component.ts`, `main-layout.component.ts`) — extract a shared `MONEY_PRIVILEGED_ROLES` constant; this is exactly the kind of list that drifts.
- **Column redundancy** — per-row "Turnover" renders `d.revenueBase` (identical to "Sell"), and `MonthGroup.qty`/`totalRow()` computes totals that are never displayed (colspan 7 swallows the Qty column). Confirm Excel parity is intended; otherwise drop.
- **No route guard on `/trading/deals`** — relying on the component's post-`views.load()` redirect is fine since the server enforces, but a `canActivate` guard avoids the flash-of-load for unauthorized deep links.

**Route shadowing — checked, no issue:** Elysia/Memoirist prioritizes static segments over dynamic params regardless of registration order, so `GET /orders/deal-economics` wins over `GET /orders/:id`. On the Angular side, `trading/deals` is a distinct sibling path to `trading/orders/:orderNumber`, so no conflict there either.

## Verdict

**Request changes.** P1-1 is a definite bug (mislabeled financial data) and must be fixed before merge; P1-2 and P1-3 need verification — both are cheap to confirm and either could invalidate the feature or the build. Security design (server-side role + view gating, tenant scoping) is correct as proposed; no route-shadowing problem. P2s are follow-up material, with the date-timezone fix worth doing soon since it touches the same `from`/`to` logic.

---

## Executor disposition (2026-09-04)

- **P1-1 (dateBasis toggle doesn't re-fetch)**: VALID — fixed; the toggle now calls load().
- **P1-2 ({} terms)**: verified safe — `{}` only zeroes financingDays, which this metric intentionally excludes (trading profit is pre-financing). Comment added at the call site. deliveredQuantity is item-level and selected.
- **P1-3 (imports)**: typecheck clean — db/tenants/eq already imported in the controller (used by the deal-economics gate). Helper extraction deferred.
- P2s: 403 status + UTC-suffix date parsing + .999 applied; duplicate item queries / pagination / shared role constant / route guard deferred as follow-ups.
