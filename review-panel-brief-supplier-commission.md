# REVIEW INSTRUCTIONS — READ FIRST

You are a code reviewer. You have NO tools, no filesystem and no repository access. Everything you need is in this payload: the decision, the constraints, the diffs (appendices A–C), and the verification evidence. Do NOT attempt to call tools or read files — reason only from the text below and produce a written review.

Deliver: consensus-worthy findings, any disagreement with the decision, concrete file/line action items marked MUST or SHOULD, and a verdict of APPROVE / APPROVE-WITH-CONDITIONS / NO-GO. Be terse and evidence-first.

---

# Panel Review — supplier-funded broker commission + Supplier Commission Report

Repo: `/Users/patrickpereira/fueld`. Working tree (uncommitted). Tenant: **Moxie Brokerage** (Bun + Elysia + Drizzle + Angular, tenant-gated broker-deal feature).

## Trigger

Daniel Kvist (Moxie), WhatsApp 2026-09-29, verbatim:

> "Nu kommer jeg lige med noget banebrydende. Kan man, hvis man laver en broker deal og kommission stiger over $3/mt, gøre så den kan lave en invoice til supplier på den kommission? Fx 20260916-000132. Broker deal. Her er aftalt 19/mt – men de kommer fra supplier og ikke fra kunden."
>
> *(Can we, when a broker deal's commission rises above $3/MT, make it able to raise an invoice to the supplier for that commission? E.g. 20260916-000132 — broker deal, agreed 19/MT — but they come from the supplier and not from the customer.)*

**Business context.** Moxie brokers bunker deals: the *supplier* invoices the *customer* directly, Moxie never takes title, and Moxie's entire revenue is its commission. The standard rate is $3/MT and the customer normally funds it. On some deals Moxie negotiates more; the excess (and in the referenced deal the *whole* rate) is funded by the supplier. Moxie currently cannot bill for that at all.

**Decision already taken with the user (do not re-litigate):**
1. **Explicit per-line rates.** The trader enters *both* what the customer pays (`order_items.commission_per_unit`, existing, unchanged) and what the supplier pays (`order_items.supplier_commission_per_unit`, new). Nothing is derived from a "$3 standard" — the standard is a tenant *default*, not a stored baseline, and message #1 ("over $3/mt") and message #2 ("19/mt … from supplier") conflict on whether the excess or the whole rate moves. Two explicit numbers sidestep that.
2. **Deliverable = a "Supplier Commission Report"** (statement + CSV/XLSX) that Moxie sends itself. **Not** an invoice, **no** receivable, **no** order, **no** payment tracking.
   *Rationale to challenge if you disagree:* `invoices` (schema.ts:1446) has **no payer/direction column** — every reader (collections `dashboard.service.ts:99`, aging `reports.service.ts:846`, company balance `company.service.ts:2465`, QuickBooks `quickbooks.service.ts:866`) derives the payer from `orders.client_id`. A supplier-addressed invoice row would be reported as a customer receivable, counted in the customer's outstanding balance and pushed to QuickBooks as a *customer* invoice. `document_type` (schema.ts:126) also has no supplier-invoice member.
3. **Moxie/tenant-gated** behind the existing `brokerDeals.enabled` flag. No other tenant sees it.

## The change

### Schema + migration
`apps/api/drizzle/0133_supplier_commission.sql` (new, registered in `meta/_journal.json` as idx 133):
```sql
ALTER TABLE order_items ADD COLUMN supplier_commission_per_unit numeric(14, 7);
```
Nullable. NULL = "the supplier owes nothing on this line", which is the correct reading for all pre-existing rows. **There is deliberately no fallback chain for this column** — no order-level twin, no tenant default — because the customer-side chain (per-line → `orders.commission_per_mt` → tenant `brokerDeals.defaultCommissionRate`) all describes what the *customer* is billed.

`order_items.commission_per_unit` keeps its exact current meaning and consumers.

### API
- `orders.service.ts`: `OrderItemInput.supplierCommissionPerUnit`, persisted via `sanitizeNumeric` in `saveOrderItems`, returned in the order-detail item payload.
- `orders.controller.ts`: added to the items body schema. *Without declaring it there, Elysia strips the key and every save silently wipes the column* — the same trap the adjacent inventory fields are commented for.
- New shared helper `commissionLineFigures()` + `buildSupplierCommissionReport(tenantId, from, to)` in `reports.service.ts`, `supplierCommissionReportToCsv` / `...ToXlsx`. Grouped by `orders.supplier_id` (inner-joined; a deal with no supplier leg has nobody to bill). Lines with a null/zero supplier rate are skipped rather than listed at 0. Fee/service lines are excluded via the existing shared `isCommissionableLine`. `supplier_payments`/`invoices` untouched.
- Routes: `GET /reports/supplier-commission`, `/export` (CSV), `/export.xlsx`. **Read-only** — deliberately no `create-orders` counterpart.
- `order-financing.calculateLineEconomics` (the broker-deal profit column, used by orders list, dashboard and reports) now sums **both** rates: `quantity * (customerRate + supplierRate) * fx`. Supplier rate has no fallback. Without this a supplier-funded deal's profit would read as 0 — which is exactly the deals at issue.
- Two new item SELECTs carry the column (`orders.service.ts`, `dashboard.service.ts`).
- `schema.ts` `TenantSettings.brokerDeals` gained the four keys the reports already read (`defaultCommissionPerMt` legacy, `reportDateField`, `reportDateFallback`, `commissionCurrency`) so the reports can read them without `as any`; **no runtime change** (same defaults).

### Web
- `order-items.component.ts`: second per-line input column `Supp./Unit` (desktop + a mobile card that previously had no commission input at all), colspan arithmetic 3→4 for the broker branch.
- **Zero-coercion fix:** both commission inputs used `+$event || null`, which turned a typed `0` into `null`. Under the new model a trader *must* be able to enter `0` (whole commission sits with the supplier). Both now use a `parseDecimalInput` that returns null only for empty input.
- `brokerProfitForRow` = `(customerRate + supplierRate) * qty`.
- New page `supplier-commission-report-page.component.ts`, route `/reports/supplier-commission`, nav entry (both gated by `requiresBrokerDeals`).

## Data evidence (Moxie production, read-only)

Deals at issue — all currently bill the **customer**:

| Order | Customer | Supplier | Line rate | Qty | Commission |
|---|---|---|---|---|---|
| 20260916-000132 | United O7 Singapore | Thor Marine Trading | 19 | 145 | 2,755.00 |
| 20260916-000130 | Global Seatrade BV | Fueling Maritime ME | 86.42 | 100 | 8,642.00 |
| 20260917-000133 | Global Seatrade BV | Thor Marine Trading | 55.50 | 195 | 10,822.50 |
| 20260915-000129 | Global Seatrade BV | Fueling Maritime ME | 24 / 15 | 380 / 55 | 9,945.00 |
| 20260815-000038 | Global Seatrade BV | Thor Marine Trading | 37 | 150 | 5,550.00 |

On every one `cost_price == sales_price` — commission is the only revenue. All Ocean7 deals are exactly 3.00. September customer-side total is 52,797.51 USD, of which 29,409.50 is these five.

## What was verified (reproduce or refute)

- **Tests discriminate.** New `apps/api/tests/broker-deal-supplier-commission.e2e.test.ts` (8 tests) — all pass. Setting `supplierRate` to read `itemCommissionPerUnit` instead makes **4 fail**. Restored. `order-financing.test.ts` 53 pass (7 new). Existing `broker-deal-commission-report.e2e.test.ts` 23 pass.
- **Real data, exact match.** A local probe DB was loaded with Moxie's live `orders`/`order_items`/`counterparties`, supplier rates simulated, then the report read through the real HTTP endpoint: `totalCommission 32,164.50` over two suppliers (Fueling Maritime 18,587.00; Thor Marine 13,577.50), matching an independent raw-SQL aggregate to the cent, including 20260916-000132 = 145 × 19 = 2,755.
- **Profit column is two-sided**, proved by toggling the column on the live order: `totalNetProfit` 5,510.00 with the supplier rate 19 set, 2,755.00 when set to 0.
- `tsc` clean in `apps/api` and `apps/web`. CSV export shows both commission columns.
- **Not verified:** Moxie's deployed UI (no production login); no production migration has been run; the full API suite has pre-existing failures unrelated to this change (baseline being collected).

## Specific things I want challenged

1. **Is summing both rates into `calculateLineEconomics`'s `grossProfit` correct?** That figure feeds the broker-deal profit column, dashboard KPIs and the orders list. `LineEconomics` has one `grossProfit` field and no split, so the two commission halves are now indistinguishable downstream. Is a split needed, or is a single "total commission earned" the right number for those surfaces?
2. **`totalQuantity` semantics in the new report.** Quantity is summed only over lines that carry a supplier rate, so a supplier's tonnage is "tonnes that generated supplier commission", not the deal's tonnage. Is that the right reading for a statement, or should it be all products on those deals?
3. **`customerCommission` carried in the report.** It is resolved through the FULL customer fallback chain, so a deal with no per-line and no order-level rate silently uses the tenant default of 3 — meaning the "customer-side" context figure could report a number the customer was never actually billed (their invoice comes from `createCommissionOrdersFromReport`, which uses the same chain, so it would match — verify that claim).
4. **Skipping zero-supplier-rate lines.** A deal where the supplier funds nothing is invisible in this report. Is silently omitting it right, or does Moxie need a zero row to see "this deal is not billable to anyone"?
5. **`orders.supplier_id` as the grouping party.** Broker deals can have multiple supplier legs (`order_suppliers`); the report uses the legacy primary `orders.supplier_id` only. Is that a real gap for Moxie (does any broker deal there have more than one supplier leg)?
6. **No FX conversion in either commission report** (`order-financing` multiplies by `getFxRate(currency)`; the reports do not). Pre-existing, but the new report inherits it. Real or theoretical for Moxie (all their deals are USD)?
7. **Migration safety.** `ADD COLUMN ... numeric(14,7)` with no default and nullable, on a large `order_items`. Any lock concern given the repo's documented hazard on `0124_price_precision_7dp.sql`?
8. **Anything I missed** where the supplier rate should have been plumbed — I checked that `packages/types`' `OrderItemDto` omits both commission fields (web types them locally); is leaving the shared DTO incomplete right, or a trap?


## Appendix A — diff: reports.service.ts + order-financing.ts

```diff
diff --git a/apps/api/src/modules/orders/order-financing.ts b/apps/api/src/modules/orders/order-financing.ts
index d2975edb..6cbfa682 100644
--- a/apps/api/src/modules/orders/order-financing.ts
+++ b/apps/api/src/modules/orders/order-financing.ts
@@ -36,8 +36,13 @@ export interface FinancingItemInput {
   salesPrice?: string | number | null;
   salesCurrency?: string | null;
   unitConversionFactor?: string | number | null;
-  // Broker deal — per-line commission rate (falls back to the order-level rate).
+  // Broker deal — per-line commission rates: what the CUSTOMER is billed and,
+  // when the negotiated rate above the standard is funded by the supplier, what
+  // the SUPPLIER pays on the same line. The supplier side deliberately has no
+  // fallback chain (no order-level twin, no tenant default) — see the schema
+  // comment on `orderItems.supplierCommissionPerUnit`.
   commissionPerUnit?: string | number | null;
+  supplierCommissionPerUnit?: string | number | null;
 }
 
 export interface LineEconomics {
@@ -275,14 +280,22 @@ export function calculateLineEconomics(
     // Closing it needs the tenant default plumbed in — see `defaultCommissionRate`
     // on calculateLineEconomics, which already accepts it.
     //
-    // Note the UI cannot store a per-line 0 (its `+$event || null` turns one
-    // into null), so a stored 0 is intentional.
+    // A stored 0 is deliberate — the line earns no commission. The UI now sends
+    // an empty input as null and any other value as its number, so a typed 0
+    // survives the round trip.
     const rate = toFiniteNumber(item.commissionPerUnit)
       ?? toFiniteNumber(orderCommissionPerMt)
       ?? toFiniteNumber(defaultCommissionRate)
       ?? 0;
+    // The same line can ALSO be funded by the supplier: a rate negotiated above
+    // the standard (Moxie's is $3/MT) may be paid by the supplier instead of the
+    // customer, and on some deals the supplier funds the whole rate while the
+    // customer is billed none of it. That second rate has no fallback chain —
+    // the three tiers above all describe what the customer is billed. Leaving it
+    // out would report a supplier-funded deal as earning nothing.
+    const supplierRate = toFiniteNumber(item.supplierCommissionPerUnit) ?? 0;
     const currency = normalizedCurrency(item.salesCurrency ?? item.costCurrency);
-    const commissionBase = quantity * rate * getFxRate(currency);
+    const commissionBase = quantity * (rate + supplierRate) * getFxRate(currency);
     return {
       quantity,
       costBase,
diff --git a/apps/api/src/modules/reports/reports.service.ts b/apps/api/src/modules/reports/reports.service.ts
index 3bf172ff..53823102 100644
--- a/apps/api/src/modules/reports/reports.service.ts
+++ b/apps/api/src/modules/reports/reports.service.ts
@@ -1,5 +1,6 @@
 import { and, asc, eq, gte, inArray, isNotNull, lte, ne, sql } from 'drizzle-orm';
 import type { SQL } from 'drizzle-orm';
+import { alias } from 'drizzle-orm/pg-core';
 import type {
   CommercialSummaryReportDto,
   ConversionMetricsDto,
@@ -35,6 +36,9 @@ import type {
   BrokerCommissionReportDto,
   BrokerCommissionReportByCustomerDto,
   BrokerCommissionReportOrderDto,
+  SupplierCommissionReportDto,
+  SupplierCommissionReportBySupplierDto,
+  SupplierCommissionReportOrderDto,
   ThroughputReportDto,
   ThroughputReportRowDto,
   ThroughputLocationDto,
@@ -2606,6 +2610,271 @@ export function brokerCommissionReportToXlsx(report: BrokerCommissionReportDto):
   return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
 }
 
+// ── Supplier commission report ───────────────────────────────────
+//
+// The mirror of `buildBrokerCommissionReport`, grouped by SUPPLIER.
+//
+// Why it exists: a broker deal's supplier invoices the customer directly and
+// Moxie's revenue is the commission. Normally the customer funds all of it, but
+// a rate negotiated above the standard (Moxie's is $3/MT) can be funded by the
+// supplier instead — and on some deals the supplier funds the whole rate and
+// the customer is billed none of it. Daniel (Moxie) asked exactly this: "hvis
+// man laver en broker deal og kommission stiger over $3/mt, kan den så lave en
+// invoice til supplier på den kommission?" That is what this statement is for.
+//
+// It is NOT an invoice and NOT a receivable. Nothing here creates an order, an
+// invoice row or a number series — `invoices` has no payer column and every
+// reader of it (collections, aging, company balance, QuickBooks) resolves the
+// payer from `orders.client_id`, so a supplier-addressed invoice would be
+// reported as a customer receivable. The statement is generated and sent by
+// Moxie outside the system.
+//
+// Every figure comes from ONE column, `order_items.supplier_commission_per_unit`.
+// It does NOT resolve through the customer-side chain (per-line → order-level →
+// tenant default), because those three tiers all describe what the CUSTOMER is
+// billed; a line with no supplier rate means the supplier owes nothing, which
+// is what every line written before this column means.
+//
+// The customer-side figures are carried alongside, never subtracted: the two
+// sides price the same line independently, and a reader reconciling the two
+// reports needs the same line's customer number in front of them.
+
+/** Rows one report line contributes to both the supplier and the customer side. */
+interface CommissionLineFigures {
+  qty: number;
+  supplierRate: number;
+  supplierAmount: number;
+  customerAmount: number;
+}
+
+/**
+ * Shared per-line arithmetic for the two commission reports, so the customer
+ * column of the supplier report can never drift from the customer report.
+ * Returns null for a line that earns no commission at all (fees, services).
+ */
+function commissionLineFigures(
+  row: {
+    productType: string;
+    quantity: string | null;
+    deliveredQuantity: string | null;
+    itemCommissionPerUnit: string | null;
+    orderCommissionPerMt: string | null;
+    supplierCommissionPerUnit: string | null;
+  },
+  defaultCommissionRate: number,
+): CommissionLineFigures | null {
+  if (!isCommissionableLine(row.productType)) return null;
+  // Same resolution order AND the same shared toFiniteNumber guard as
+  // order-financing.calculateLineEconomics. A non-finite rate poisons every
+  // total downstream (NaN), and Postgres numeric accepts the literals 'NaN'
+  // and 'Infinity', so such a row can be stored.
+  const customerRate = toFiniteNumber(row.itemCommissionPerUnit)
+    ?? toFiniteNumber(row.orderCommissionPerMt)
+    ?? toFiniteNumber(defaultCommissionRate)
+    ?? 0;
+  const qty = toFiniteNumber(row.deliveredQuantity) ?? toFiniteNumber(row.quantity) ?? 0;
+  const supplierRate = toFiniteNumber(row.supplierCommissionPerUnit) ?? 0;
+  return {
+    qty,
+    supplierRate,
+    supplierAmount: supplierRate * qty,
+    customerAmount: customerRate * qty,
+  };
+}
+
+export async function buildSupplierCommissionReport(
+  tenantId: string,
+  from: string,
+  to: string,
+): Promise<SupplierCommissionReportDto> {
+  const [tenant] = await db
+    .select({ settings: tenants.settings })
+    .from(tenants)
+    .where(eq(tenants.id, tenantId))
+    .limit(1);
+
+  const bd = tenant?.settings?.brokerDeals;
+  const reportStatuses: (typeof orders.status.enumValues)[number][] = (bd?.reportStatuses ?? [
+    'CONFIRMED', 'DELIVERED', 'INVOICED', 'PAID',
+  ]) as (typeof orders.status.enumValues)[number][];
+  const reportDateField: string = bd?.reportDateField ?? 'deliveredAt';
+  const reportDateFallback: string = bd?.reportDateFallback ?? 'eta';
+  // Pre-rename key accepted for the same reason as the customer report: the
+  // rename (fd69d793) updated the settings API but not the reports, so an
+  // instance provisioned before it still carries `defaultCommissionPerMt` and
+  // reading only the new key would silently report $0.00.
+  const defaultCommissionRate = bd?.defaultCommissionRate ?? bd?.defaultCommissionPerMt ?? 0;
+  const commissionCurrency: string = bd?.commissionCurrency ?? 'USD';
+
+  const dateColumn = reportDateField === 'eta' ? orders.eta : reportDateField === 'createdAt' ? orders.createdAt : orders.deliveredAt;
+  const fallbackColumn = reportDateFallback === 'eta' ? orders.eta : reportDateFallback === 'createdAt' ? orders.createdAt : orders.deliveredAt;
+
+  // The supplier is joined on the PRIMARY supplier leg (`orders.supplier_id`),
+  // matching how a broker deal is ordered: client = the buyer the supplier
+  // invoices, supplier = the party being billed here. `orders.client` is joined
+  // through a second alias because `counterparties` appears twice in one query.
+  const clients = alias(counterparties, 'commission_report_clients');
+
+  const rows = await db
+    .select({
+      orderNumber: orders.orderNumber,
+      vesselName: vessels.name,
+      placeName: places.name,
+      customerName: clients.name,
+      supplierId: orders.supplierId,
+      supplierName: counterparties.name,
+      productType: orderItems.productType,
+      quantity: orderItems.quantity,
+      unit: orderItems.unit,
+      itemCommissionPerUnit: orderItems.commissionPerUnit,
+      orderCommissionPerMt: orders.commissionPerMt,
+      supplierCommissionPerUnit: orderItems.supplierCommissionPerUnit,
+      deliveredQuantity: orderItems.deliveredQuantity,
+      deliveredAt: orders.deliveredAt,
+      status: orders.status,
+      primaryDate: dateColumn,
+      fallbackDate: fallbackColumn,
+    })
+    .from(orders)
+    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
+    .innerJoin(vessels, eq(orders.vesselId, vessels.id))
+    .innerJoin(places, eq(orders.placeId, places.id))
+    .innerJoin(clients, eq(orders.clientId, clients.id))
+    // INNER JOIN on the supplier: a deal with no supplier leg has nobody to
+    // bill, and `orders.supplier_id` is nullable.
+    .innerJoin(counterparties, eq(orders.supplierId, counterparties.id))
+    .where(
+      and(
+        eq(orders.tenantId, tenantId),
+        eq(orders.isBrokerDeal, true),
+        inArray(orders.status, reportStatuses),
+        isNotNull(orders.supplierId),
+      ),
+    );
+
+  const fromDate = new Date(from);
+  const toDate = new Date(to + 'T23:59:59.999Z');
+  const filtered = rows.filter((r) => {
+    const date = r.primaryDate ?? r.fallbackDate;
+    if (!date) return false;
+    return date >= fromDate && date <= toDate;
+  });
+
+  const bySupplierMap = new Map<string, SupplierCommissionReportBySupplierDto>();
+  let grandTotalCommission = 0;
+  let grandTotalCustomerCommission = 0;
+
+  for (const r of filtered) {
+    const figures = commissionLineFigures(r, defaultCommissionRate);
+    if (!figures) continue;
+    // A line whose supplier rate is null owes nothing. Skip it rather than
+    // listing a zero row — the same choice the customer report makes for fee
+    // lines, and it keeps a supplier's quantity total meaningful.
+    if (figures.supplierRate === 0) continue;
+    // The query INNER JOINs the supplier, so this is always set; a row without
+    // one has nobody to bill and is dropped rather than guessed at.
+    const supplierId = r.supplierId;
+    if (!supplierId) continue;
+
+    grandTotalCommission += figures.supplierAmount;
+    grandTotalCustomerCommission += figures.customerAmount;
+
+    const order: SupplierCommissionReportOrderDto = {
+      orderNumber: r.orderNumber ?? '—',
+      vesselName: r.vesselName ?? '—',
+      placeName: r.placeName ?? '—',
+      customerName: r.customerName ?? '—',
+      productType: r.productType,
+      quantity: String(figures.qty),
+      unit: r.unit,
+      commissionPerMt: String(figures.supplierRate),
+      commissionAmount: figures.supplierAmount.toFixed(2),
+      customerCommissionAmount: figures.customerAmount.toFixed(2),
+      deliveredAt: r.deliveredAt?.toISOString() ?? null,
+      status: r.status,
+    };
+
+    const existing = bySupplierMap.get(supplierId);
+    if (existing) {
+      existing.orders.push(order);
+      existing.orderCount++;
+      existing.totalCommission = ((toFiniteNumber(existing.totalCommission) ?? 0) + figures.supplierAmount).toFixed(2);
+      existing.customerCommission = ((toFiniteNumber(existing.customerCommission) ?? 0) + figures.customerAmount).toFixed(2);
+      existing.totalQuantity = ((toFiniteNumber(existing.totalQuantity) ?? 0) + figures.qty).toFixed(6);
+    } else {
+      bySupplierMap.set(supplierId, {
+        supplierId,
+        supplierName: r.supplierName ?? '—',
+        orderCount: 1,
+        totalQuantity: figures.qty.toFixed(6),
+        totalCommission: figures.supplierAmount.toFixed(2),
+        customerCommission: figures.customerAmount.toFixed(2),
+        orders: [order],
+      });
+    }
+  }
+
+  return {
+    period: { from, to },
+    totalCommission: grandTotalCommission.toFixed(2),
+    customerCommission: grandTotalCustomerCommission.toFixed(2),
+    currency: commissionCurrency,
+    bySupplier: Array.from(bySupplierMap.values()),
+  };
+}
+
+export function supplierCommissionReportToCsv(report: SupplierCommissionReportDto): string {
+  const rows: string[][] = [];
+  rows.push(['Supplier Commission Report']);
+  rows.push([`Period: ${report.period.from} to ${report.period.to}`]);
+  rows.push([]);
+  rows.push(['Supplier', 'Order #', 'Vessel', 'Place', 'Customer', 'Product', 'Quantity', 'Unit', 'Rate', 'Commission', 'Customer Commission', 'Delivered At', 'Status']);
+
+  for (const sup of report.bySupplier) {
+    for (const o of sup.orders) {
+      rows.push([sup.supplierName, o.orderNumber, o.vesselName, o.placeName, o.customerName, o.productType, o.quantity, o.unit, o.commissionPerMt, o.commissionAmount, o.customerCommissionAmount, o.deliveredAt ?? '', o.status]);
+    }
+    rows.push(['', '', '', '', '', '', 'Subtotal', '', '', sup.totalCommission, sup.customerCommission, '', `${sup.orderCount} lines`]);
+    rows.push([]);
+  }
+  rows.push(['', '', '', '', '', '', 'TOTAL', '', '', report.totalCommission, report.customerCommission, '', '']);
+
+  return rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
+}
+
+export function supplierCommissionReportToXlsx(report: SupplierCommissionReportDto): ArrayBuffer {
+  const data: any[] = [];
+  for (const sup of report.bySupplier) {
+    for (const o of sup.orders) {
+      data.push({
+        Supplier: sup.supplierName,
+        'Order #': o.orderNumber,
+        Vessel: o.vesselName,
+        Place: o.placeName,
+        Customer: o.customerName,
+        Product: o.productType,
+        Quantity: o.quantity,
+        Unit: o.unit,
+        Rate: o.commissionPerMt,
+        Commission: o.commissionAmount,
+        'Customer Commission': o.customerCommissionAmount,
+        'Delivered At': o.deliveredAt ?? '',
+        Status: o.status,
+      });
+    }
+    data.push({
+      Supplier: '', 'Order #': '', Vessel: '', Place: '', Customer: '', Product: '',
+      Quantity: '', Unit: 'Subtotal', Rate: '', Commission: sup.totalCommission,
+      'Customer Commission': sup.customerCommission,
+      'Delivered At': '', Status: `${sup.orderCount} lines`,
+    });
+  }
+  const ws = XLSX.utils.json_to_sheet(data);
+  const wb = XLSX.utils.book_new();
+  XLSX.utils.book_append_sheet(wb, ws, 'Supplier Commission');
+  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
+}
+
 /** What one call to createCommissionOrdersFromReport produced. */
 export interface CommissionOrderCreationResult {
   /** Orders created by THIS call. */

```


## Appendix B — diff: controller, schema, orders service/controller, DTOs, tests

```diff
diff --git a/apps/api/src/db/schema.ts b/apps/api/src/db/schema.ts
index bdf73d90..51a76111 100644
--- a/apps/api/src/db/schema.ts
+++ b/apps/api/src/db/schema.ts
@@ -425,7 +425,20 @@ export interface TenantSettings {
   brokerDeals?: {
     enabled: boolean;                  // Master toggle
     defaultCommissionRate: number;     // Default commission rate per unit (e.g., 3.00)
+    /**
+     * Legacy name for `defaultCommissionRate`, from before the rename in
+     * fd69d793 (which updated the settings API but not the commission report,
+     * so the fallback briefly read a field nothing wrote). Still accepted on
+     * read so an instance provisioned before the rename keeps its rate.
+     */
+    defaultCommissionPerMt?: number;
     reportStatuses: string[];          // Which statuses to include in report (default: ['CONFIRMED', 'DELIVERED', 'INVOICED', 'PAID'])
+    /** Which date the commission report period filters on (default 'deliveredAt'). */
+    reportDateField?: string;
+    /** Fallback date when the primary is null (default 'eta'). */
+    reportDateFallback?: string;
+    /** Display currency for commission reports (default 'USD'). */
+    commissionCurrency?: string;
     autoReleaseCredit: boolean;        // Auto-release supplier credit after credit period (default: true)
     autoReleaseBufferDays: number;     // Extra buffer days before auto-release (default: 0)
     /**
@@ -1297,8 +1310,19 @@ export const orderItems = pgTable('order_items', {
   // appear on customer documents but are included in margin calculations.
   hideOnDocuments: boolean('hide_on_documents').notNull().default(false),
 
-  // Broker deal — per-line-item commission rate (e.g., 3.00 for $3/unit)
+  // Broker deal — per-line-item commission rate (e.g., 3.00 for $3/unit).
+  // This is the CUSTOMER-side rate: what the customer is billed for this line.
   commissionPerUnit: numeric('commission_per_unit', { precision: 14, scale: 7 }),
+  /**
+   * Broker deal — the commission the SUPPLIER pays on this same line, when a
+   * negotiated rate above the standard $3/MT is funded by the supplier (or the
+   * supplier funds the whole rate and the customer is billed none of it).
+   *
+   * Deliberately has NO fallback chain: no order-level twin, no tenant default.
+   * NULL means the supplier owes nothing on this line, which is the right
+   * reading for every line written before this column existed.
+   */
+  supplierCommissionPerUnit: numeric('supplier_commission_per_unit', { precision: 14, scale: 7 }),
 
   // ── Inventory linkage (optional; only set for tracked SKUs) ───────
   // When set, this line participates in inventory rules: stock checks at
diff --git a/apps/api/src/modules/orders/orders.controller.ts b/apps/api/src/modules/orders/orders.controller.ts
index c398a471..016bf3cd 100644
--- a/apps/api/src/modules/orders/orders.controller.ts
+++ b/apps/api/src/modules/orders/orders.controller.ts
@@ -1156,6 +1156,10 @@ export const ordersController = new Elysia({ prefix: '/orders' })
             salesPriceFinalized: t.Optional(t.Nullable(t.Boolean())),
             taxRate: t.Optional(t.Nullable(t.String())),
             commissionPerUnit: t.Optional(t.Nullable(t.String())),
+            // Supplier-side commission rate. Without declaring it here Elysia
+            // strips the key from the items payload and every save wipes it —
+            // the same silent-wipe trap documented for the inventory fields.
+            supplierCommissionPerUnit: t.Optional(t.Nullable(t.String())),
             hideOnDocuments: t.Optional(t.Boolean()),
             // Inventory linkage — the frontend payload includes these; without
             // declaring them Elysia strips the keys and every items save
diff --git a/apps/api/src/modules/orders/orders.service.ts b/apps/api/src/modules/orders/orders.service.ts
index 08f66760..289b8df1 100644
--- a/apps/api/src/modules/orders/orders.service.ts
+++ b/apps/api/src/modules/orders/orders.service.ts
@@ -206,6 +206,8 @@ interface SaveItemInput {
   plannedInventoryAt?: string | null;
   // Broker deal — per-line-item commission
   commissionPerUnit?: string | null;
+  /** Commission the supplier pays on this line. No fallback chain — see schema. */
+  supplierCommissionPerUnit?: string | null;
   // Hide from customer-facing documents
   hideOnDocuments?: boolean | null;
 }
@@ -1323,6 +1325,7 @@ export async function listOrders(query?: ListOrdersQuery) {
           salesCurrency: orderItems.salesCurrency,
           unitConversionFactor: orderItems.unitConversionFactor,
           commissionPerUnit: orderItems.commissionPerUnit,
+          supplierCommissionPerUnit: orderItems.supplierCommissionPerUnit,
         })
         .from(orderItems)
         .where(inArray(orderItems.orderId, orderIds)),
@@ -1701,6 +1704,7 @@ export async function getOrderById(idOrNumber: string) {
       taxAmount: i.taxAmount ?? null,
       // Broker deal — per-line-item commission
       commissionPerUnit: i.commissionPerUnit ?? null,
+      supplierCommissionPerUnit: i.supplierCommissionPerUnit ?? null,
       // Hide from customer-facing documents
       hideOnDocuments: i.hideOnDocuments ?? false,
     })),
@@ -2075,8 +2079,9 @@ export async function saveOrderItems(orderId: string, items: SaveItemInput[]) {
       inventorySkuId: item.inventorySkuId ?? null,
       warehouseId: item.warehouseId ?? null,
       plannedInventoryAt: item.plannedInventoryAt ? new Date(item.plannedInventoryAt) : null,
-      // Broker deal — per-line-item commission
+      // Broker deal — per-line-item commission, customer side and supplier side
       commissionPerUnit: sanitizeNumeric(item.commissionPerUnit),
+      supplierCommissionPerUnit: sanitizeNumeric(item.supplierCommissionPerUnit),
       // Hide from customer-facing documents
       hideOnDocuments: item.hideOnDocuments ?? false,
     };
diff --git a/apps/api/src/modules/reports/reports.controller.ts b/apps/api/src/modules/reports/reports.controller.ts
index a6fd18b1..3003014b 100644
--- a/apps/api/src/modules/reports/reports.controller.ts
+++ b/apps/api/src/modules/reports/reports.controller.ts
@@ -33,6 +33,9 @@ import {
   buildBrokerCommissionReport,
   brokerCommissionReportToCsv,
   brokerCommissionReportToXlsx,
+  buildSupplierCommissionReport,
+  supplierCommissionReportToCsv,
+  supplierCommissionReportToXlsx,
   createCommissionOrdersFromReport,
   buildThroughputReport,
   exportThroughputXlsx,
@@ -413,6 +416,53 @@ export const reportsController = new Elysia({ prefix: '/reports' })
     detail: { tags: ['Reports'], summary: 'Export broker commission report as XLSX', security: [{ bearerAuth: [] }] },
   })
 
+  // ── Supplier commission report ─────────────────────────────────
+  // The mirror of the customer report above, grouped by supplier. Read-only on
+  // purpose: Moxie sends this statement itself and invoices the supplier
+  // outside the system. There is deliberately no create-orders counterpart —
+  // the `invoices` table has no payer column, so an order/invoice raised here
+  // would be reported as a customer receivable by collections, aging, the
+  // company balance and QuickBooks (all of which resolve the payer from
+  // `orders.client_id`).
+  .get('/supplier-commission', async ({ auth, query }) => {
+    const data = await buildSupplierCommissionReport(auth.tenantId, query.from, query.to);
+    return { success: true, data } satisfies ApiResponse<unknown>;
+  }, {
+    query: t.Object({
+      from: t.String(),
+      to: t.String(),
+    }),
+    detail: { tags: ['Reports'], summary: 'Supplier commission report', security: [{ bearerAuth: [] }] },
+  })
+
+  .get('/supplier-commission/export', async ({ auth, query, set }) => {
+    const report = await buildSupplierCommissionReport(auth.tenantId, query.from, query.to);
+    const csv = supplierCommissionReportToCsv(report);
+    set.headers['content-type'] = 'text/csv';
+    set.headers['content-disposition'] = `attachment; filename="supplier_commission_${query.from}_${query.to}.csv"`;
+    return csv;
+  }, {
+    query: t.Object({
+      from: t.String(),
+      to: t.String(),
+    }),
+    detail: { tags: ['Reports'], summary: 'Export supplier commission report as CSV', security: [{ bearerAuth: [] }] },
+  })
+
+  .get('/supplier-commission/export.xlsx', async ({ auth, query, set }) => {
+    const report = await buildSupplierCommissionReport(auth.tenantId, query.from, query.to);
+    const buffer = supplierCommissionReportToXlsx(report);
+    set.headers['content-type'] = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
+    set.headers['content-disposition'] = `attachment; filename="supplier_commission_${query.from}_${query.to}.xlsx"`;
+    return new Response(buffer as ArrayBuffer);
+  }, {
+    query: t.Object({
+      from: t.String(),
+      to: t.String(),
+    }),
+    detail: { tags: ['Reports'], summary: 'Export supplier commission report as XLSX', security: [{ bearerAuth: [] }] },
+  })
+
   .post('/broker-commission/create-orders', async ({ auth, body, set }) => {
     if (auth.role !== 'ADMIN') {
       set.status = 403;
diff --git a/packages/types/src/dto.ts b/packages/types/src/dto.ts
index 5a80af00..3f9a9371 100644
--- a/packages/types/src/dto.ts
+++ b/packages/types/src/dto.ts
@@ -3039,6 +3039,58 @@ export interface BrokerCommissionReportDto {
   currency: string;
   byCustomer: BrokerCommissionReportByCustomerDto[];
 }
+
+// ── Supplier commission report ───────────────────────────────────
+// The mirror of the customer-side report above, grouped by SUPPLIER.
+//
+// On a broker deal the supplier invoices the customer directly and Moxie's
+// revenue is the commission. Usually the customer funds all of it, but when a
+// rate above the standard $3/MT is negotiated the excess — sometimes the whole
+// rate — is funded by the supplier, and Moxie bills the supplier for it via a
+// statement it sends itself. This report is that statement.
+//
+// It is deliberately NOT an invoice: it creates no receivable, no invoice
+// number and no order. `supplierCommissionPerUnit` on each line is the only
+// source of the supplier figure — there is no order-level or tenant default.
+
+export interface SupplierCommissionReportOrderDto {
+  orderNumber: string;
+  vesselName: string;
+  placeName: string;
+  /** The deal's customer — context for who the supplier invoiced. */
+  customerName: string;
+  productType: string;
+  quantity: string;
+  unit: string;
+  /** The rate the supplier pays per unit on this line. */
+  commissionPerMt: string;
+  /** Commission owed to us by the supplier on this line. */
+  commissionAmount: string;
+  /** What the customer is billed for the SAME line, for reconciliation. */
+  customerCommissionAmount: string;
+  deliveredAt: string | null;
+  status: string;
+}
+
+export interface SupplierCommissionReportBySupplierDto {
+  supplierId: string;
+  supplierName: string;
+  orderCount: number;
+  totalQuantity: string;
+  totalCommission: string;
+  /** Customer-side commission on the same lines — context, never subtracted. */
+  customerCommission: string;
+  orders: SupplierCommissionReportOrderDto[];
+}
+
+export interface SupplierCommissionReportDto {
+  period: { from: string; to: string };
+  totalCommission: string;
+  customerCommission: string;
+  currency: string;
+  bySupplier: SupplierCommissionReportBySupplierDto[];
+}
+
 // ── Kantox Dynamic Hedging (USD→EUR margin hedging) ───────────────
 // Feature is per-tenant (TenantSettings.kantoxSettings.enabled). The API
 // password is stored in the encrypted credential vault and is never part

```


## Appendix C — diff: order-items.component.ts

```diff
diff --git a/apps/web/src/app/features/trading/components/order-items/order-items.component.ts b/apps/web/src/app/features/trading/components/order-items/order-items.component.ts
index 0bbf72a5..3a420338 100644
--- a/apps/web/src/app/features/trading/components/order-items/order-items.component.ts
+++ b/apps/web/src/app/features/trading/components/order-items/order-items.component.ts
@@ -83,6 +83,8 @@ import type {
               @if (isBrokerDeal()) {
                 <th class="px-4 py-3 text-right font-medium text-gray-600 dark:text-ink-dim min-w-[180px]">Price</th>
                 <th class="px-4 py-3 text-right font-medium text-gray-600 dark:text-ink-dim min-w-[100px]">Comm./Unit</th>
+                <th class="px-4 py-3 text-right font-medium text-gray-600 dark:text-ink-dim min-w-[100px]"
+                    title="Commission paid by the supplier instead of the customer">Supp./Unit</th>
                 <th class="px-4 py-3 text-right font-medium text-gray-600 dark:text-ink-dim min-w-[120px]">Profit ({{ baseCurrency() }})</th>
               } @else {
                 <th class="px-4 py-3 text-right font-medium text-gray-600 dark:text-ink-dim min-w-[180px]">Cost</th>
@@ -253,20 +255,34 @@ import type {
                     (plattsSelect)="selectPlattsMatch(i, 'cost', $event)"
                   />
                 </td>
-                <!-- Broker deal: Commission per unit -->
+                <!-- Broker deal: Commission per unit (customer pays) -->
                 <td class="px-4 py-2 align-top">
                   @if (readonly()) {
                     <span class="text-sm text-gray-500 dark:text-muted">{{ row.commissionPerUnit ?? '—' }}</span>
                   } @else {
                     <input type="number" step="0.01" min="0"
                       [ngModel]="row.commissionPerUnit ?? ''"
-                      (ngModelChange)="updateField(i, 'commissionPerUnit', +$event || null)"
+                      (ngModelChange)="updateField(i, 'commissionPerUnit', parseDecimalInput($event))"
                       placeholder="0"
                       class="w-20 rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-right text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                     />
                   }
                 </td>
-                <!-- Broker deal: Profit (commission × quantity) -->
+                <!-- Broker deal: Commission per unit (supplier pays — no fallback) -->
+                <td class="px-4 py-2 align-top">
+                  @if (readonly()) {
+                    <span class="text-sm text-gray-500 dark:text-muted">{{ row.supplierCommissionPerUnit ?? '—' }}</span>
+                  } @else {
+                    <input type="number" step="0.0001" min="0"
+                      [ngModel]="row.supplierCommissionPerUnit ?? ''"
+                      (ngModelChange)="updateField(i, 'supplierCommissionPerUnit', parseDecimalInput($event))"
+                      placeholder="0"
+                      title="Commission paid by the supplier instead of the customer"
+                      class="w-20 rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-right text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
+                    />
+                  }
+                </td>
+                <!-- Broker deal: Profit (customer + supplier commission × quantity) -->
                 <td class="px-4 py-3 text-right tabular-nums text-sm font-semibold text-green-600 dark:text-green-400">
                   {{ brokerProfitForRow(row) | number:'1.2-2' }}
                 </td>
@@ -462,13 +478,13 @@ import type {
                 [warehouseOptions]="warehouseOptionsInput()"
                 [inventorySkuOptions]="inventorySkuOptionsInput()"
                 [availability]="availabilityByRowId()[row.id]"
-                [colspan]="(readonly() ? 4 : 5) + (showSupplierColumn() ? 1 : 0) + (allowDeliveredEdit() ? 1 : 0) + (canSeePrices() ? (isBrokerDeal() ? 3 : 5) : 0)"
+                [colspan]="(readonly() ? 4 : 5) + (showSupplierColumn() ? 1 : 0) + (allowDeliveredEdit() ? 1 : 0) + (canSeePrices() ? (isBrokerDeal() ? 4 : 5) : 0)"
                 (fieldChange)="onInventoryFieldChange(i, $event)"
               />
             }
           } @empty {
             <tr>
-              <td [attr.colspan]="(readonly() ? 4 : 5) + (showSupplierColumn() ? 1 : 0) + (allowDeliveredEdit() ? 1 : 0) + (canSeePrices() ? (isBrokerDeal() ? 3 : 5) : 0)" class="px-4 py-12 text-center">
+              <td [attr.colspan]="(readonly() ? 4 : 5) + (showSupplierColumn() ? 1 : 0) + (allowDeliveredEdit() ? 1 : 0) + (canSeePrices() ? (isBrokerDeal() ? 4 : 5) : 0)" class="px-4 py-12 text-center">
                 <p class="text-sm text-gray-400 dark:text-muted">No line items yet.</p>
                 @if (!readonly()) {
                   <button
@@ -740,6 +756,39 @@ import type {
                 (plattsSelect)="selectPlattsMatch(i, 'cost', $event)"
               />
             </div>
+
+            <!-- Broker deal: Commission per unit (customer pays) -->
+            <div>
+              <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">Comm./Unit</label>
+              @if (readonly()) {
+                <span class="text-sm text-gray-500 dark:text-muted">{{ row.commissionPerUnit ?? '—' }}</span>
+              } @else {
+                <input type="number" step="0.01" min="0"
+                  [ngModel]="row.commissionPerUnit ?? ''"
+                  (ngModelChange)="updateField(i, 'commissionPerUnit', parseDecimalInput($event))"
+                  placeholder="0"
+                  class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-1.5 text-right text-sm tabular-nums focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
+                />
+              }
+            </div>
+
+            <!-- Broker deal: Commission per unit (supplier pays — no fallback) -->
+            <div>
+              <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted"
+                     title="Commission paid by the supplier instead of the customer">Supp./Unit</label>
+              @if (readonly()) {
+                <span class="text-sm text-gray-500 dark:text-muted">{{ row.supplierCommissionPerUnit ?? '—' }}</span>
+              } @else {
+                <input type="number" step="0.0001" min="0"
+                  [ngModel]="row.supplierCommissionPerUnit ?? ''"
+                  (ngModelChange)="updateField(i, 'supplierCommissionPerUnit', parseDecimalInput($event))"
+                  placeholder="0"
+                  title="Commission paid by the supplier instead of the customer"
+                  class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-1.5 text-right text-sm tabular-nums focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
+                />
+              }
+            </div>
+
             } @else {
             <!-- Cost -->
             <div>
@@ -1573,25 +1622,33 @@ export class OrderItemsComponent implements OnInit, OnDestroy {
   }
 
   /**
-   * Broker deal profit = rate × quantity, mirroring
+   * Broker deal profit = (customer rate + supplier rate) × quantity, mirroring
    * `order-financing.calculateLineEconomics` so the editor and the server agree.
    *
+   * A broker deal can be paid from both sides of the trade: the customer rate
+   * (whatever the customer is charged on top) and the supplier rate (the extra
+   * the SUPPLIER pays when a deal is negotiated above the standard rate). Both
+   * apply to the same line quantity and are summed here.
+   *
+   * The customer rate falls back per-line → order-level, which matters because
+   * most broker-deal lines carry NO per-line rate (the UI seeds the tenant
+   * default onto the ORDER): without the fallback this preview read $0 for a
+   * line the report billed in full. The SUPPLIER rate has NO fallback — the
+   * per-line value is its only source, so an unset supplier rate contributes 0.
+   * Delivered quantity wins over ordered, matching the server, so a partially
+   * delivered deal does not preview the wrong figure.
+   *
    * Fees and services earn nothing — a barging fee is a lump sum stored with
    * quantity 1, so multiplying it by the per-MT rate showed a flat rate as
    * though it were a tonne, and the row total counted the fee as tonnage. Uses
    * the same shared rule as the commission report and the profit column.
-   *
-   * The rate falls back per-line → order-level, which matters because most
-   * broker-deal lines carry NO per-line rate (the UI seeds the tenant default
-   * onto the ORDER): without the fallback this preview read $0 for a line the
-   * report billed in full. Delivered quantity wins over ordered, matching the
-   * server, so a partially delivered deal does not preview the wrong figure.
    */
   brokerProfitForRow(row: OrderItemRow): number {
     if (!isCommissionableLine(row.productType)) return 0;
-    const rate = row.commissionPerUnit ?? this.parseNullableNumber(this.commissionPerMt()) ?? 0;
+    const customerRate = row.commissionPerUnit ?? this.parseNullableNumber(this.commissionPerMt()) ?? 0;
+    const supplierRate = row.supplierCommissionPerUnit ?? 0;
     const qty = row.deliveredQuantity ?? row.quantity ?? 0;
-    return rate * qty;
+    return (customerRate + supplierRate) * qty;
   }
 
   /** Parse an optional numeric input, treating blank/absent as "no value". */

```
