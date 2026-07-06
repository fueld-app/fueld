# Open in New Tab — Progress

## P1: Other List Pages ✅ COMPLETE

### Files Modified:
1. **companies-page.component.ts** — Added `RouterLink` import, converted company name `<span>` to `<a [routerLink]>`, added `onRowClick` (ctrl/cmd → new tab) and `onRowAuxClick` (middle-click → new tab) on `<tr>`
2. **vessels-page.component.ts** — Same pattern: `RouterLink` import, vessel name `<div>` → `<a [routerLink]>`, `onRowClick`/`onRowAuxClick` on `<tr>`
3. **places-page.component.ts** — Same pattern for desktop table rows. Also converted mobile card `<div (click)>` to `<a [routerLink]>` block element
4. **dashboard-page.component.ts** — Two areas:
   - Frozen counterparties: `<button (click)="goToCompany()">` → added `onFrozenCompanyClick`/`onFrozenCompanyAuxClick` + company name as `<a [routerLink]>`
   - Credit groups table: `<tr (click)="goToCompanyGroup()">` → added `onCreditGroupClick`/`onCreditGroupAuxClick` + group name as `<a [routerLink]>`

### Build Status: ✅ `ng build` passes with no errors

## P2: Detail Page Inline Links ✅ COMPLETE

### Files Modified:
1. **detail-meta-cards.component.ts** — Added `RouterLink` import. Converted 5 navigation `<button>` elements to `<a [routerLink]>` tags:
   - Broker → `<a [routerLink]="['/companies', brokerId()]">`
   - Agent → `<a [routerLink]="['/companies', agentId()]">`
   - Supplier → `<a [routerLink]="['/companies', supplierId()]">`
   - Vessel → `<a [routerLink]="['/vessels', vesselId()]">`
   - Place → `<a [routerLink]="['/places', placeId()]">`
   - All use conditional routerLink (null when no ID) with `pointer-events-none` when disabled

2. **vessel-detail-page.component.ts** — Converted orders table row to support new-tab:
   - Status badge cell → `<a [routerLink]="orderRoute(o.id, o.status)">` with `(click)="$event.stopPropagation()"`
   - Added `(auxclick)` handler on `<tr>` for middle-click → `openOrderInNewTab()`
   - Added `(click)` handler on `<tr>` → `onOrderRowClick()` (detects ctrl/cmd → new tab, else normal navigation)
   - Added `orderRoute()`, `onOrderRowClick()`, `openOrderInNewTab()` helper methods
   - Note: `navigateToCompanyById()` and `navigateToPlace()` left as-is — they're async SeaSearcher/LLI ID resolution flows that can't use routerLink

3. **order-platts-signals.component.ts** — Added `RouterLink` import and `imports: [RouterLink]`:
   - "Open source report" button → `<a [routerLink]="['/resources/platts', meta()!.reportId!]">`
   - Match report buttons → `<a [routerLink]="['/resources/platts', match.reportId]">`

4. **user-menu.component.ts** — Added `RouterLink` import and `imports: [RouterLink]`:
   - Settings button → `<a routerLink="/account/settings">` with `(click)="isOpen.set(false)"` to close dropdown

5. **main-layout.component.ts** (global search) — Converted search results `<button>` to `<a [routerLink]="resultRoute(result)">`:
   - Added `resultRoute()` method that returns the correct URL array based on result kind (order, company, vessel, place)
   - Kept `(click)="goToResult(result)"` to close the search dropdown on click

6. **orders-card.component.ts** (company detail) — Added `RouterLink` import:
   - Converted vessel name `<span>` to `<a [routerLink]="['/orders', order.id]">` with `(click)="$event.stopPropagation()"`
   - Added `onRowClick()` (ctrl/cmd → new tab, else emit orderClick) and `openInNewTab()` on `<tr>`
   - Added `(auxclick)` handler for middle-click

### Files NOT Modified (async resolution flows — can't use routerLink):
- **fleet-table-card.component.ts** — `navigateToVessel.emit()` goes through async SeaSearcher ID resolution in store. Left as `<button>`.
- **registration-card.component.ts** — `navigateToCompany.emit()` goes through async SeaSearcher ID resolution. Left as `<button>`. (RouterLink import added but unused — harmless)
- **place-suppliers-card.component.ts** — `store.navigateToCompany()` is async API resolution. Left as-is.
- **place-traffic-card.component.ts** — `store.navigateToVessel()` is async API resolution. Left as-is.
- **place-hierarchy-card.component.ts** — `store.navigateToChildPlace()` is async API resolution. Left as-is.
- **place-header.component.ts** — `store.navigateToParent()` is async API resolution. Left as-is.
- **reports-page.component.ts** — `openOrderDrilldown()` loads data in-page (not navigation). Left as-is.

### Build Status: ✅ `ng build` passes with no errors
## Task 4: Global search, company-detail, dashboard, user-menu, platts links — DONE

### Files modified (5 files):

1. **`main-layout.component.ts`** — Global search results:
   - Converted `<button (click)="goToResult(result)">` to `<a [routerLink]="resultRouterLink(result)" (click)="closeSearchPanel()">`
   - Added `resultRouterLink()` method returning `['/places', id]`, `['/companies', id]`, `['/vessels', id]`, or `[orderDetailRoute, id]` based on result kind
   - Added `closeSearchPanel()` method to close search dropdown on navigation
   - `RouterLink` was already imported

2. **`dashboard-page.component.ts`** — Dashboard frozen companies + credit groups:
   - Frozen companies: converted `<button (click)="goToCompany()">` to `<a [routerLink]="['/companies', company.id]">`
   - Credit group table rows: added `<a [routerLink]>` on company name cell + `(auxclick)` + `(click)` with ctrl/meta-key detection on `<tr>`
   - Added `onGroupRowClick()` and `onAuxClick()` methods
   - Imported `RouterLink` from `@angular/router`

3. **`orders-card.component.ts`** — Company detail orders table:
   - Converted vessel name cell from `<span>` to `<a [routerLink]="['/orders', order.id]">`
   - Added `(auxclick)` + `(click)` with ctrl/meta-key detection on `<tr>`
   - Added `onRowClick()` and `onAuxClick()` methods
   - Imported `RouterLink` from `@angular/router`

4. **`order-platts-signals.component.ts`** — Platts report links:
   - Converted "Open source report" button to `<a [routerLink]="['/resources/platts', reportId]">`
   - Converted match report buttons to `<a [routerLink]="['/resources/platts', match.reportId]">`
   - Imported `RouterLink` from `@angular/router`, added `imports: [RouterLink]`

5. **`user-menu.component.ts`** — Settings link:
   - Converted Settings `<button (click)="goToSecurity()">` to `<a routerLink="/account/settings">`
   - Imported `RouterLink` from `@angular/router`, added `imports: [RouterLink]`

### Left as programmatic (not converted):
- `company-detail.store.ts` `navigateToVessel()` / `navigateToCompany()` — async SeaSearcher lookup/import flows
- `company-detail.store.ts` `openGroupVessel()` — conditional (localVesselId vs async import)
- `reports-page.component.ts` drilldown buttons — data-fetching actions (open modal, not navigation)
- `dashboard-page.component.ts` `openFollowUp()` — child component output delegation

### Build status:
All 5 modified files compile cleanly. Pre-existing build errors in `order-detail-page.component.ts` (from other subagents' changes) are unrelated to this task.
