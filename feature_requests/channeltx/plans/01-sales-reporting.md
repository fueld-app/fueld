# Feature 1: Sales Reporting by Product

**Priority:** P1 · **Complexity:** Low · **Effort:** S (1–3 days) · **Dependencies:** None

## Request

Report showing what products were sold in a particular time frame (throughput / gallons / products sold). Currently using a spreadsheet.

## Existing Infrastructure

| Component | Location | Notes |
|-----------|----------|-------|
| Reports Service | `modules/reports/reports.service.ts` (2525L) | Has margin analysis with product-type grouping (`accumulateMarginRow`), trader performance, XLSX/CSV export |
| Order Items | `orderItems` table | `productType` (text field — not enum-constrained), `quantity`, `unit`, `salesPrice`, `costPrice` |
| Scheduled Reports | `runDueReportSchedules` / `startReportsScheduleJob` | Hourly cron for scheduled report delivery |
| Order Categories | `TenantSettings.orderCategories` | Groups orders by business line (fuels, services, etc.) |
| XLSX Export | `exportMarginAnalysisXlsx` pattern | Existing XLSX workbook builder |

## Gap

Existing reports are margin/trader-focused, not pure throughput/volume by product. ChannelTX measures in gallons (not MT) and their "products" are services (Strip Liquid Free, VTC, Sniff Test) — not standard fuel products (`productTypeEnum` values like VLSFO, LSMGO). However, `orderItems.productType` is a **text field**, so it already holds any service name.

## Implementation

### Backend
1. Add a `buildThroughputReport()` function to `reports.service.ts` that:
   - Queries `orderItems` joined with `orders` filtered by date range (`orders.deliveredAt` or `orders.createdAt`)
   - Aggregates `quantity` grouped by `productType`
   - Applies unit conversion via existing `unitConversionFactor` field
   - Optionally groups by `orderCategories` (tenant setting)
2. Add `reportType: 'THROUGHPUT'` to the scheduled report delivery system
3. Add `exportThroughputXlsx()` following the existing XLSX export pattern
4. Add API endpoint for on-demand report generation + drilldown

### Frontend
1. Add "Throughput Report" as a new report type in the reports page
2. Date range picker (reuse existing report filter UI)
3. Product category filter (reuse existing product type dropdown)
4. Table view with totals row
5. Export to XLSX button

### Schema Changes
**None** — all data already exists in `orderItems` and `orders`.

### TenantSettings Flag

```typescript
throughputReport?: {
  enabled: boolean;
  defaultUnit?: string;          // e.g., 'Gallons', 'MT'
  groupByCategory?: boolean;    // group by orderCategories
};
```

## Questions for ChannelTX

- What units do you report in — gallons, barrels, MT?
- Should the report include just volume/throughput, or also revenue and pricing?
- What time periods do you typically need — daily, weekly, monthly, or custom date ranges?
- Are your "products" things like "Strip Liquid Free", "VTC", "Sniff Test" (services), or do you also sell physical fuel products?
- Do you need this exportable to Excel like your current spreadsheet?