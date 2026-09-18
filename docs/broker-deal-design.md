# Broker Deal Feature — Design Document

## Background

Moxie acts as a broker for Ocean7 companies (Ocean7 Chartering, Ocean7 Projects,
Ocean7 Shipping, Ocean7 Heavy Lifts, Ocean7 Bulk). They earn $3/MT commission
on all products. The supplier invoices go directly to Ocean7 — Moxie does not
invoice. Moxie needs to:

1. Flag orders as "broker deals" (they're the broker, not the trader)
2. Track commission ($3/MT) per deal
3. Generate monthly reports per Ocean7 company showing all deliveries + commission
4. Use Ocean7's supplier credit lines
5. Keep the feature tenant-specific (other tenants are unaffected)

### Example from Moxie

- Order 20260702-000005: Customer = Ocean7 Projects, Supplier = World Fuel Services
- 80 MT LSMGO at $1035/MT
- World Fuel invoices Ocean7 directly after delivery
- Moxie prepares a monthly report to Ocean7: all deliveries in the month + $3/MT commission

### Example from Riviera Marine (broker perspective)

- Riviera Marine trade 20260624-000289: Riviera buys from Sonangol, sells to Ocean7
- In Moxie's system: Moxie is the broker, Riviera = supplier, Ocean7 = customer

---

## Recommended Approach

**Add a `isBrokerDeal` boolean flag to orders + a `commissionPerMt` field,
gated by a tenant setting. Add a "Broker Deals" sidebar tab and a monthly
commission report.**

This is the simplest approach that:
- Reuses the existing order infrastructure (no new table, no new order kind)
- Is tenant-specific (gated by `tenant.settings.brokerDealsEnabled`)
- Doesn't affect other tenants (the flag defaults to `false`, the tab is hidden)
- Allows commission tracking at the order level
- Supports a monthly commission report grouped by customer

### Why not a new `orderKind = 'BROKER'`?

The `orderKind` enum (`EXTERNAL` / `INTERNAL_TRANSFER`) drives inventory logic
(reservations, movements). Adding `BROKER` would require branching in every
inventory code path. A simple boolean flag is cleaner — broker deals behave
exactly like regular orders except for:
- No invoicing (the supplier invoices the customer directly)
- Commission tracking
- Monthly reporting

### Why not reuse the existing `brokerId` field?

The existing `brokerId` / `brokerGetsAll` fields represent a third-party broker
on a trade (e.g., a shipping broker). Moxie's use case is different — Moxie IS
the broker, not a third party on someone else's trade. The `isBrokerDeal` flag
is semantically distinct and avoids confusion.

---

## 1. Database Schema Changes

### 1a. Orders table — add two columns

```sql
ALTER TABLE orders ADD COLUMN is_broker_deal boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN commission_per_mt numeric(12, 4);
```

- `is_broker_deal`: Flags the order as a broker deal. Defaults to `false` so
  all existing orders and other tenants are unaffected.
- `commission_per_mt`: The commission rate per MT (e.g., 3.00 for $3/MT).
  Nullable — only set on broker deals. If null on a broker deal, the report
  can fall back to a tenant-level default (see below).

### 1b. Tenant settings — add broker deal configuration

In `TenantSettings` (the JSONB `settings` column on `tenants`):

```typescript
// Broker deal settings — tenant-specific feature gating
brokerDeals?: {
  enabled: boolean;                  // Master toggle — only show broker UI when true
  defaultCommissionPerMt: number;   // Default commission rate (e.g., 3.00) — always same for all products/companies
  commissionCurrency: string;        // Currency for commission (e.g., 'USD')
  commissionUnit: string;            // Unit for commission calc: 'MT', 'GAL', 'BBL', etc. (default 'MT')
  reportTitle: string;              // Report header (e.g., 'Moxie Brokerage — Monthly Commission Report')
  reportStatuses: string[];          // Which statuses to include in report (default: ['CONFIRMED', 'DELIVERED', 'INVOICED', 'PAID'])
  reportDateField: string;           // Primary date field for report period filtering (default 'deliveredAt')
  reportDateFallback: string;        // Fallback date field if primary is null (default 'eta')
  hideInvoicingFields: boolean;      // Hide invoicing company/bank account fields on broker deals (default true)
  brokerDealLabel: string;           // Display label for the checkbox (default 'Broker Deal')
  commissionLabel: string;           // Display label for the commission column (default 'Commission')
  // Credit tracking
  autoReleaseCredit: boolean;        // Auto-release supplier credit after credit period from delivery date (default: true)
  autoReleaseBufferDays: number;     // Extra buffer days before auto-release (default: 0)
  brokerCreditLabel: string;         // Label for broker credit lines in UI (default: 'Broker Credit')
};
```

**Every value above is configurable via Admin → Settings. Nothing is hardcoded.**
If a setting is omitted, the defaults shown in parentheses apply.

**Decisions confirmed with Moxie (July 2026):**
- Moxie does both trading AND brokering → need separate broker credit lines
- Commission is always $3/MT across all companies and products
- Credit period starts from delivery date
- Auto-release after credit period is fine — no "payment delayed" blocking needed
- Mixed group/individual credit lines — some Ocean7 companies share a group line, others have individual lines
- Report is manually generated (not auto-scheduled)
- Report includes confirmed orders and above (not just delivered)

This is read by:
- Frontend: to show/hide the "Broker Deals" tab and the `isBrokerDeal` checkbox
- API: to validate that broker deals are only created when the feature is enabled

### 1c. Migration

```sql
-- 00XX_broker_deals.sql
ALTER TABLE orders ADD COLUMN is_broker_deal boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN commission_per_mt numeric(12, 4);
ALTER TABLE credit_lines ADD COLUMN is_broker_credit_line boolean NOT NULL DEFAULT false;
```

Register in `meta/_journal.json` as usual.

### 1d. Credit lines — add broker credit flag

```sql
ALTER TABLE credit_lines ADD COLUMN is_broker_credit_line boolean NOT NULL DEFAULT false;
```

- `is_broker_credit_line`: When `true`, this credit line tracks broker deal
  exposure (on behalf of Ocean7 companies). When `false` (default), it tracks
  regular trade exposure (Moxie's own) — same as today.
- The existing `credit_line_counterparties` table already supports many-to-many
  linking, so group credit lines (multiple Ocean7 companies) and individual
  credit lines (single Ocean7 company) both work without schema changes.

### 1e. No `paidBy` field needed

The original design considered adding a `paid_by` enum to `order_suppliers`.
This is NOT needed because Moxie confirmed they don't need to track who pays —
the system auto-releases credit based on time (delivery date + credit days),
not on manual payment confirmation.

---

## 2. API Changes

### 2a. Order creation/update — accept broker deal fields

In `CreateOrderInput` and `UpdateOrderInput` (orders.service.ts):

```typescript
isBrokerDeal?: boolean;
commissionPerMt?: number | null;
```

The `createOrder` and `updateOrder` functions pass these through to the
`orders` table insert/update.

### 2b. Order list — filter by broker deals

In `listOrders` (orders.service.ts), add an optional query parameter:

```typescript
isBrokerDeal?: boolean;
```

When `isBrokerDeal === true`, filter to only broker deals. This powers the
"Broker Deals" tab.

### 2c. Commission report endpoint

New endpoint: `GET /reports/broker-commission`

Query parameters:
- `from`: date (YYYY-MM-DD) — start of period
- `to`: date (YYYY-MM-DD) — end of period
- `clientId`: optional — filter to a specific Ocean7 company

Response:
```typescript
interface BrokerCommissionReportDto {
  period: { from: string; to: string };
  totalCommission: number;
  currency: string;
  byCustomer: Array<{
    customerId: string;
    customerName: string;
    orderCount: number;
    totalQuantity: number;
    totalCommission: number;
    orders: Array<{
      orderNumber: string;
      vesselName: string;
      placeName: string;
      productType: string;
      quantity: number;
      unit: string;
      commissionPerMt: number;
      commissionAmount: number;
      deliveredAt: string | null;
      status: string;
    }>;
  }>;
}
```

The report queries orders where:
- `is_broker_deal = true`
- `status` is in the tenant's configured `reportStatuses` (default: `['DELIVERED', 'INVOICED', 'PAID']`)
- The tenant's configured `reportDateField` (default: `delivered_at`, fallback: `eta`) falls within the date range

Commission per order = `SUM(order_items.quantity converted to commissionUnit * commission_per_mt)`.

The commission unit (default 'MT') is configurable via `brokerDeals.commissionUnit`.
Quantity conversion uses the existing `unitConversionFactor` on order items.

If `commission_per_mt` is null on the order, fall back to
`tenant.settings.brokerDeals.defaultCommissionPerMt`.

### 2d. Commission report export

`GET /reports/broker-commission/export` — CSV export
`GET /reports/broker-commission/export.xlsx` — XLSX export

Same data as the JSON endpoint, formatted as a spreadsheet with one row per
order, grouped by customer.

### 2e. Credit line usage — time-based auto-release for broker deals

Modified `calcUsedAmountForSupplier` in `credit.service.ts`:

For **regular credit lines** (`is_broker_credit_line = false`):
- Same as today: credit released when `paidAt IS NOT NULL`

For **broker credit lines** (`is_broker_credit_line = true`):
- Credit auto-released when `deliveredAt + supplierCreditDays` has passed
- No manual `paidAt` needed — Moxie confirmed they don't get payment confirmations
- If `paidAt` IS set manually (early override), credit releases sooner
- If `autoReleaseBufferDays` is configured, add extra days as safety margin

```sql
-- Broker credit usage: count orders still within credit period
WHERE order_suppliers.companyId = ANY($counterpartyIds)
  AND order_suppliers.paymentTermType = 'CREDIT'
  AND orders.status = ANY($activeStatuses)
  AND (
    -- Released: manually marked paid
    order_suppliers.paidAt IS NOT NULL
    OR (
      -- Released: broker deal past credit period
      orders.is_broker_deal = true
      AND orders.deliveredAt IS NOT NULL
      AND orders.deliveredAt + (order_suppliers.creditDays || ' days')::interval
          + ($bufferDays || ' days')::interval < now()
    )
  ) = false
```

The `is_broker_credit_line` flag on the credit line determines which orders
to count:
- `is_broker_credit_line = true`: count broker deals (`is_broker_deal = true`)
  where the customer is one of the credit line's counterparties
- `is_broker_credit_line = false`: count regular orders (same as today)

This separates Moxie's own trading exposure from Ocean7's broker exposure,
even when both use the same supplier (e.g., World Fuel).

### 2f. Credit line API — accept broker credit flag

In `createCreditLine` and `updateCreditLine` (credit.service.ts):

```typescript
isBrokerCreditLine?: boolean;
```

When `true`, the credit line is a broker credit line. The counterparties
linked to the line are the Ocean7 companies (the "on behalf of" parties).
The existing `creditLineCounterparties` table supports linking multiple
companies (for group credit lines) or a single company (for individual lines).

---

## 3. Frontend Changes

### 3a. Sidebar — "Broker Deals" tab

In `main-layout.component.ts`, add a new nav item under Trading:

```typescript
{ label: 'Broker Deals', route: '/trading/broker-deals' },
```

This item is **conditionally shown** based on `tenant.settings.brokerDeals.enabled`.
The `navItems` computed needs to be extended to check tenant settings for
broker-specific items.

### 3b. Broker Deals list page

Reuse the existing `InquiriesListPageComponent` with a new mode:

```typescript
mode="broker-deals"
```

This mode:
- Filters orders by `isBrokerDeal=true` (sends `isBrokerDeal=true` to the API)
- Shows all statuses (not just one status like the other tabs)
- Adds a "Commission" column showing `$3/MT × quantity = $total`
- Adds a "Commission Report" button that opens the report

### 3c. Order detail — broker deal toggle

In the order detail page (meta-cards or a new section), add:
- A checkbox labeled with the tenant's `brokerDealLabel` (default: 'Broker Deal') — only visible when `brokerDeals.enabled` is true
- When checked, show a "Commission per MT" input field (label uses `commissionUnit` from settings, e.g., 'Commission per MT' or 'Commission per GAL')
- When `isBrokerDeal` is true:
  - If `hideInvoicingFields` is true (default), hide invoicing company + bank account fields — not needed for broker deals
  - Show a commission summary: quantity × commissionPerMt = total commission
  - The order still goes through the normal status flow (Inquiry → Confirmed → Delivered → etc.)
  - No invoice is generated by Fueld (the supplier invoices the customer directly)

### 3d. New inquiry modal — broker deal option

In the new inquiry modal, add a "Broker Deal" checkbox (when enabled).
When checked, the user doesn't need to select an invoicing company or bank account.

### 3e. Commission report page

A new page at `/reports/broker-commission` (or a modal from the Broker Deals tab):
- Report title from `brokerDeals.reportTitle` setting (default: 'Broker Commission Report')
- Date range picker (from/to) — filters on the configured `reportDateField`
- Optional customer filter (dropdown of customers that have broker deals)
- Table grouped by customer showing:
  - Customer name
  - Order count
  - Total quantity (in the configured `commissionUnit`)
  - Total commission (in the configured `commissionCurrency`)
  - Expandable: individual orders with details
- Export buttons (CSV, XLSX)
- **Manually generated** (not auto-scheduled) — Moxie confirmed they generate
  it when all deliveries and BDRs for the month are in

### 3f. Credit line UI — broker credit lines

**Admin → Credit → Suppliers:**
- Regular credit lines show as before
- Broker credit lines show with a badge from `brokerCreditLabel` setting (default: 'Broker Credit')
- Shows linked Ocean7 companies (the counterparties on the credit line)
- A filter toggle: "Show broker credit lines" (only visible when `brokerDeals.enabled`)
- For group credit lines, all linked Ocean7 companies are shown
- For individual credit lines, only one company is shown

**Credit line creation form** (when `brokerDeals.enabled` is true):
- New checkbox: "Broker Credit Line" (label from `brokerCreditLabel` setting)
- When checked:
  - The counterparties field labels as "On behalf of" (the Ocean7 companies)
  - Multiple companies can be selected (for group credit lines)
  - The credit limit and period apply to all selected companies collectively

### 3g. Order detail — broker credit display

When `isBrokerDeal = true` and the supplier has a broker credit line:
- The payment terms card shows: "Broker credit — auto-releases {creditDays} days after delivery"
- A countdown: "Credit releases in 12 days" (if within the period)
- Or "Credit auto-released on {date}" (if past the period)
- No "Record Payment" button for broker deals (payment is automatic)
- The credit usage shows the Ocean7 company's exposure, not Moxie's own

---

## 4. Tenant-Specific Feature Gating

### How it works:

1. **Admin settings page**: Add a "Broker Deals" section under Admin → Settings
   with the following configurable options (all stored in `tenant.settings.brokerDeals`):

   | Setting | Description | Default |
   |---------|-------------|--------|
   | `enabled` | Master toggle for the broker deal feature | `false` |
   | `defaultCommissionPerMt` | Default commission rate per unit | `0` |
   | `commissionCurrency` | Currency for commission amounts | `'USD'` |
   | `commissionUnit` | Unit for commission calculation (`'MT'`, `'GAL'`, `'BBL'`, etc.) | `'MT'` |
   | `reportTitle` | Header text for the commission report | `'Broker Commission Report'` |
   | `reportStatuses` | Which order statuses to include in the report | `['DELIVERED', 'INVOICED', 'PAID']` |
   | `reportDateField` | Primary date field for report period filtering | `'deliveredAt'` |
   | `reportDateFallback` | Fallback date field if primary is null | `'eta'` |
   | `hideInvoicingFields` | Hide invoicing company/bank account on broker deals | `true` |
   | `brokerDealLabel` | Display label for the broker deal checkbox | `'Broker Deal'` |
   | `commissionLabel` | Display label for the commission column/field | `'Commission'` |

2. **API**: The `GET /admin/settings/my-broker-deal-settings` endpoint (any
   authenticated user) returns:
   ```typescript
   {
     enabled: boolean;
     defaultCommissionPerMt: number;
     commissionCurrency: string;
     commissionUnit: string;
     reportTitle: string;
     reportStatuses: string[];
     reportDateField: string;
     reportDateFallback: string;
     hideInvoicingFields: boolean;
     brokerDealLabel: string;
     commissionLabel: string;
   }
   ```
   This is used by the frontend to show/hide broker UI elements and apply
   all configurable labels, units, and behavior.

3. **Frontend**: A `BrokerDealService` (or extend `UserPreferencesService`) loads
   the broker deal settings on app init. Components check this to show/hide:
   - The "Broker Deals" sidebar tab
   - The "Broker Deal" checkbox on the order detail page
   - The "Broker Deal" checkbox on the new inquiry modal
   - The "Commission per MT" field

4. **Other tenants**: The feature is completely invisible. The `isBrokerDeal`
   flag defaults to `false`, the sidebar tab is hidden, and the API ignores
   broker deal parameters when the feature is disabled.

---

## 5. Monthly Commission Report Design

### Report layout:

```
Moxie Brokerage — Monthly Commission Report
Period: July 1–31, 2026

┌─────────────────────────────────────────────────────────────────┐
│ Ocean7 Projects                                                 │
│                                                                 │
│ Order #         Vessel          Product    Qty    Commission    │
│ 20260702-000005 MV LILLIAN D   LSMGO      80 MT   $240.00       │
│ 20260705-000012 MV SAFETY      LSMGO     120 MT   $360.00       │
│ ─────────────────────────────────────────────────────────────── │
│ Subtotal: 2 orders, 200 MT, $600.00                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Ocean7 Chartering                                               │
│                                                                 │
│ Order #         Vessel          Product    Qty    Commission    │
│ 20260710-000020 MV ATLANTIC     VLSFO     500 MT   $1,500.00    │
│ ─────────────────────────────────────────────────────────────── │
│ Subtotal: 1 order, 500 MT, $1,500.00                           │
└─────────────────────────────────────────────────────────────────┘

═════════════════════════════════════════════════════════════════
TOTAL: 3 orders, 700 MT, $2,100.00
```

### Calculation:

```
Commission per order = quantity (in MT) × commissionPerMt
```

If the order has multiple line items, sum the quantities (converted to MT)
and multiply by the commission rate.

### Data source:

The SQL query uses the tenant's configured `reportStatuses`, `reportDateField`,
and `reportDateFallback` from `brokerDeals` settings. Example with defaults
(`delivered_at` with `eta` fallback, statuses `DELIVERED/INVOICED/PAID`):

```sql
SELECT
  o.order_number,
  v.name AS vessel_name,
  p.name AS place_name,
  c.name AS customer_name,
  oi.product_type,
  oi.quantity,
  oi.unit,
  o.commission_per_mt,
  (oi.quantity * COALESCE(o.commission_per_mt, ts.settings->'brokerDeals'->>'defaultCommissionPerMt')::numeric) AS commission_amount,
  COALESCE(o.delivered_at, o.eta) AS report_date,
  o.status
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN vessels v ON o.vessel_id = v.id
JOIN places p ON o.place_id = p.id
JOIN counterparties c ON o.client_id = c.id
JOIN tenants t ON o.tenant_id = t.id
WHERE o.is_broker_deal = true
  AND o.status = ANY($1)  -- $1: tenant's configured reportStatuses array
  AND COALESCE(o.delivered_at, o.eta) >= $2  -- $2: from date
  AND COALESCE(o.delivered_at, o.eta) <= $3  -- $3: to date
  AND o.tenant_id = $4
ORDER BY c.name, o.order_number;
```

The `COALESCE` date field and `ANY($1)` status list are built dynamically
from the tenant's `brokerDeals` settings — not hardcoded.

---

## 6. What Stays the Same

- **Order flow**: Broker deals go through the same status flow
  (Inquiry → Confirmed → Delivered → Invoiced → Paid)
- **Order items**: Same structure — products, quantities, prices
- **Credit lines**: Broker credit lines (`is_broker_credit_line = true`) track
  Ocean7's exposure with suppliers. Regular credit lines (`is_broker_credit_line
  = false`) track Moxie's own exposure. Both coexist — same supplier can have
  both types of credit lines. Group lines link multiple Ocean7 companies;
  individual lines link one. Credit auto-releases after the credit period
  from delivery date (no manual payment confirmation needed).
- **Documents**: Same document generation (confirmation, nomination, etc.)
- **WhatsApp notifications**: Same notification system
- **Search**: Broker deals appear in global search like regular orders

## 7. What Changes

| Area | Change |
|------|--------|
| Orders table | +`is_broker_deal` boolean, +`commission_per_mt` numeric |
| Credit lines table | +`is_broker_credit_line` boolean (separates Moxie's own vs broker credit) |
| Tenant settings | +`brokerDeals` config block (14 configurable options) |
| Order API | Accept + return broker deal fields; filter by `isBrokerDeal` |
| Credit API | Accept + return `isBrokerCreditLine`; modified usage calc with time-based release |
| Reports API | +`/reports/broker-commission` endpoint + exports (uses configurable statuses, date fields) |
| Settings API | +`/admin/settings/my-broker-deal-settings` endpoint (returns all config) |
| Admin settings UI | +"Broker Deals" settings section (all options configurable via UI) |
| Sidebar | +"Broker Deals" tab (tenant-gated by `enabled` setting) |
| Order detail | +broker deal checkbox + commission field + broker credit display with auto-release countdown |
| New inquiry modal | +"Broker Deal" checkbox (tenant-gated) |
| Invoicing fields | Hidden on broker deals when `hideInvoicingFields` is true (configurable, default true) |
| Credit line UI | +broker credit line badge, creation form, filter toggle (tenant-gated) |
| Commission report | Title from `reportTitle`, statuses from `reportStatuses`, date field from `reportDateField` — all configurable, manually generated |

## 8. Implementation Order

1. **Schema migration** — add `is_broker_deal`, `commission_per_mt` to orders; add `is_broker_credit_line` to credit_lines; update tenant settings type
2. **API: orders** — order create/update accepts broker fields; list filter by `isBrokerDeal`
3. **API: credit** — credit line create/update accepts `isBrokerCreditLine`; modified usage calculation with time-based auto-release for broker deals
4. **API: commission report** — `/reports/broker-commission` endpoint + CSV/XLSX export
5. **API: settings** — `/admin/settings/my-broker-deal-settings` endpoint
6. **Frontend: admin settings** — broker deal config UI (all 14 options)
7. **Frontend: order detail** — broker deal checkbox + commission field + broker credit display with auto-release countdown
8. **Frontend: new inquiry modal** — broker deal checkbox
9. **Frontend: broker deals tab** — filtered list page with commission column
10. **Frontend: credit line UI** — broker credit line badge, creation form, filter toggle
11. **Frontend: commission report** — report page with date range + export (manually generated)
12. **Test on staging** — verify end-to-end with Moxie's data
13. **Deploy** — all servers

## 9. Alternative Considered & Rejected

### Separate "Broker Universe" (rejected)

Daniel asked if Moxie should have "its own universe/tab." A completely
separate section would require duplicating the entire order management UI
(order detail, items, documents, suppliers, etc.). This is expensive and
creates maintenance burden. The flag-based approach reuses 100% of the
existing infrastructure and only adds the broker-specific layer on top.

### New order kind `BROKER` (rejected)

Adding a `BROKER` value to the `order_kind` enum would require branching in
every inventory code path (reservations, movements, effects). Since broker
deals don't have different inventory behavior (they're still physical
deliveries), this adds complexity without benefit.

### Commission on order items instead of order (deferred)

Storing `commissionPerMt` on `order_items` instead of `orders` would allow
different commission rates per product. This is a possible future enhancement
but adds complexity. For now, a single rate per order (with tenant-level
default) covers Moxie's stated requirement of "$3/MT on all products."