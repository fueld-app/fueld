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
  defaultCommissionPerMt: number;   // Default commission rate (e.g., 3.00)
  commissionCurrency: string;        // Currency for commission (e.g., 'USD')
  commissionUnit: string;            // Unit for commission calc: 'MT', 'GAL', 'BBL', etc. (default 'MT')
  reportTitle: string;              // Report header (e.g., 'Moxie Brokerage — Monthly Commission Report')
  reportStatuses: string[];          // Which statuses to include in report (default: ['DELIVERED', 'INVOICED', 'PAID'])
  reportDateField: string;           // Which date field filters the report period: 'deliveredAt' | 'eta' | 'createdAt' (default 'deliveredAt')
  reportDateFallback: string;        // Fallback date field if primary is null (default 'eta')
  hideInvoicingFields: boolean;      // Hide invoicing company/bank account fields on broker deals (default true)
  brokerDealLabel: string;           // Display label for the checkbox (default 'Broker Deal')
  commissionLabel: string;           // Display label for the commission column (default 'Commission')
};
```

**Every value above is configurable via Admin → Settings. Nothing is hardcoded.**
If a setting is omitted, the defaults shown in parentheses apply.

This is read by:
- Frontend: to show/hide the "Broker Deals" tab and the `isBrokerDeal` checkbox
- API: to validate that broker deals are only created when the feature is enabled

### 1c. Migration

```sql
-- 00XX_broker_deals.sql
ALTER TABLE orders ADD COLUMN is_broker_deal boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN commission_per_mt numeric(12, 4);
```

Register in `meta/_journal.json` as usual.

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
- **Credit lines**: Moxie can link Ocean7's supplier credit lines to the
  counterparty (Ocean7 company). The existing credit system already supports
  supplier credit lines per counterparty.
- **Documents**: Same document generation (confirmation, nomination, etc.)
- **WhatsApp notifications**: Same notification system
- **Search**: Broker deals appear in global search like regular orders

## 7. What Changes

| Area | Change |
|------|--------|
| Orders table | +`is_broker_deal` boolean, +`commission_per_mt` numeric |
| Tenant settings | +`brokerDeals` config block (11 configurable options) |
| Order API | Accept + return broker deal fields; filter by `isBrokerDeal` |
| Reports API | +`/reports/broker-commission` endpoint + exports (uses configurable statuses, date fields) |
| Settings API | +`/admin/settings/my-broker-deal-settings` endpoint (returns all config) |
| Admin settings UI | +"Broker Deals" settings section (all options configurable via UI) |
| Sidebar | +"Broker Deals" tab (tenant-gated by `enabled` setting) |
| Order detail | +broker deal checkbox (label from `brokerDealLabel` setting) + commission field (unit from `commissionUnit` setting) |
| New inquiry modal | +"Broker Deal" checkbox (tenant-gated) |
| Invoicing fields | Hidden on broker deals when `hideInvoicingFields` is true (configurable, default true) |
| Commission report | Title from `reportTitle`, statuses from `reportStatuses`, date field from `reportDateField` — all configurable |

## 8. Implementation Order

1. **Schema migration** — add columns + tenant settings type
2. **API** — order create/update accepts broker fields; list filter
3. **Commission report endpoint** — query + export
4. **Frontend: admin settings** — broker deal config UI
5. **Frontend: order detail** — broker deal checkbox + commission field
6. **Frontend: new inquiry modal** — broker deal checkbox
7. **Frontend: broker deals tab** — filtered list page
8. **Frontend: commission report** — report page with date range + export
9. **Test on staging** — verify end-to-end with Moxie's data
10. **Deploy** — all servers

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