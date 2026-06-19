// ═══════════════════════════════════════════════════════════════════════
//  Report Builders — all report computation logic
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, gte, lte, inArray, isNotNull, asc, ne, sql } from 'drizzle-orm';
import { db } from '../../db';
import { invoices, orders, orderItems, counterparties, vessels, users, teams } from '../../db/schema';
import { calculateOrderEconomics, calculateRevenueBase } from '../orders/order-financing';
import { parseNumber, formatMoney, formatQuantity, formatPercentValue, monthKey, getAgingBucket, buildVarianceValue, buildVarianceRows, buildComparisonWindow, normalizeComparisonMode } from './report-utils.service';
import { fetchScopedDataset, buildEconomicsByOrder } from './report-dataset.service';
import { resolveReportAccessContext } from './report-access.service';
import type { ScopedDataset, ReportAccessContext } from './report.types';
import type { ReportFiltersDto, ReportComparisonMode, ReportDrilldownTarget, ReportDrilldownResponseDto, ReportDrilldownOrderRowDto, ReleaseOneReportsDto, ReleaseTwoReportsDto, ReportsExceptionsDto, ReportsAccessDto, InvoiceAgingReportDto, InvoiceAgingReportRowDto, CommercialSummaryReportDto, ConversionMetricsDto, LossAnalysisResponseDto, PipelineStageDto, MarginAnalysisReportDto, MarginAnalysisRowDto, MarginTrendPointDto, TraderPerformanceReportDto, TraderPerformanceReportRowDto, ReportExceptionRowDto, ReportExceptionType, ReportFilterOptionsDto, ReportScheduleMode, SavedReportViewDto, ReportScheduleDto, ReportScheduleType, ReportScheduleDeliveryMode, ReportScheduleBodyMode } from '@fueld/types';
import { Role } from '@fueld/types';
import { logActivity } from '../activity/activity.service';

// ─── Empty state helpers ────────────────────────────────────────────

function emptyTraderPerformance(): TraderPerformanceReportDto {
  return { rows: [], totals: { orderCount: 0, wonCount: 0, lostCount: 0, winRate: 0, totalVolume: '0.000', totalRevenue: '0.00', totalGrossProfit: '0.00', totalFinancingCost: '0.00', totalNetProfit: '0.00', avgDealSize: '0.00' } };
}

function emptyInvoiceAging(): InvoiceAgingReportDto {
  return { rows: [], buckets: ['CURRENT', '1-30', '31-60', '61-90', '90+'].map((label) => ({ label, count: 0, outstandingAmount: '0.00' })), totalInvoices: 0, totalOutstanding: '0.00' };
}

function emptyVariance(): any {
  return { comparison: null, summary: null, topTraderMovers: [], topCustomerMovers: [], topProductMovers: [] };
}

function emptyExceptions(): ReportsExceptionsDto {
  return { totalCount: 0, byType: [], rows: [] };
}

// ─── Trader Performance ─────────────────────────────────────────────

export function buildTraderPerformanceReport(dataset: ScopedDataset): TraderPerformanceReportDto {
  if (dataset.orderRows.length === 0) return emptyTraderPerformance();
  const economicsByOrder = buildEconomicsByOrder(dataset) as any;
  const wonStatuses = new Set(['CONFIRMED', 'DELIVERED', 'INVOICED', 'PAID']);
  const stats = new Map<string, { row: TraderPerformanceReportRowDto; totalRevenueValue: number; totalNetProfitValue: number }>();

  for (const order of dataset.orderRows) {
    const current = stats.get(order.traderId) ?? {
      row: { traderId: order.traderId, traderName: order.traderName, traderEmail: order.traderEmail, teamName: order.teamName, orderCount: 0, wonCount: 0, lostCount: 0, winRate: 0, totalVolume: '0.000', totalRevenue: '0.00', totalGrossProfit: '0.00', totalFinancingCost: '0.00', totalNetProfit: '0.00', avgDealSize: '0.00' },
      totalRevenueValue: 0, totalNetProfitValue: 0,
    };

    if (order.status === 'CANCELLED') {
      current.row.lostCount += 1;
      current.row.winRate = formatPercentValue(current.row.wonCount, current.row.wonCount + current.row.lostCount);
      stats.set(order.traderId, current); continue;
    }

    if (wonStatuses.has(order.status)) { current.row.wonCount += 1; current.row.winRate = formatPercentValue(current.row.wonCount, current.row.wonCount + current.row.lostCount); }
    const economics = economicsByOrder.get(order.orderId);
    if (!economics) { stats.set(order.traderId, current); continue; }

    current.row.orderCount += 1;
    current.totalRevenueValue += economics.totalRevenueBase;
    current.totalNetProfitValue += economics.totalNetProfit;
    current.row.totalVolume = formatQuantity(parseNumber(current.row.totalVolume) + economics.totalQuantity);
    current.row.totalRevenue = formatMoney(current.totalRevenueValue);
    current.row.totalGrossProfit = formatMoney(parseNumber(current.row.totalGrossProfit) + economics.totalGrossProfit);
    current.row.totalFinancingCost = formatMoney(parseNumber(current.row.totalFinancingCost) + economics.totalFinancingCost);
    current.row.totalNetProfit = formatMoney(current.totalNetProfitValue);
    current.row.avgDealSize = formatMoney(current.row.orderCount > 0 ? current.totalRevenueValue / current.row.orderCount : 0);
    stats.set(order.traderId, current);
  }

  const rows = Array.from(stats.values()).map((e) => e.row).sort((a, b) => parseNumber(b.totalNetProfit) - parseNumber(a.totalNetProfit));
  const totalOrders = rows.reduce((s, r) => s + r.orderCount, 0);
  const totalRevenue = rows.reduce((s, r) => s + parseNumber(r.totalRevenue), 0);
  const totalWon = rows.reduce((s, r) => s + r.wonCount, 0);
  const totalLost = rows.reduce((s, r) => s + r.lostCount, 0);

  return { rows, totals: { orderCount: totalOrders, wonCount: totalWon, lostCount: totalLost, winRate: formatPercentValue(totalWon, totalWon + totalLost), totalVolume: formatQuantity(rows.reduce((s, r) => s + parseNumber(r.totalVolume), 0)), totalRevenue: formatMoney(totalRevenue), totalGrossProfit: formatMoney(rows.reduce((s, r) => s + parseNumber(r.totalGrossProfit), 0)), totalFinancingCost: formatMoney(rows.reduce((s, r) => s + parseNumber(r.totalFinancingCost), 0)), totalNetProfit: formatMoney(rows.reduce((s, r) => s + parseNumber(r.totalNetProfit), 0)), avgDealSize: formatMoney(totalOrders > 0 ? totalRevenue / totalOrders : 0) } };
}

// ─── Invoice Aging ──────────────────────────────────────────────────

export async function buildInvoiceAgingReport(tenantId: string, context: ReportAccessContext, filters: ReportFiltersDto, dataset: ScopedDataset): Promise<InvoiceAgingReportDto> {
  if (dataset.orderRows.length === 0) return emptyInvoiceAging();
  const today = new Date().toISOString().slice(0, 10);
  const conditions: any[] = [eq(orders.tenantId, tenantId), sql`${invoices.status} <> 'PAID'`, sql`${invoices.status} <> 'VOID'`, inArray(orders.id, dataset.orderRows.map((r) => r.orderId))];
  if (context.userIds) conditions.push(inArray(orders.salesRepId, context.userIds));
  if (filters.from) conditions.push(gte(invoices.dueDate, filters.from));
  if (filters.to) conditions.push(lte(invoices.dueDate, filters.to));

  const invoiceRows = await db.select({ invoiceId: invoices.id, invoiceNumber: invoices.invoiceNumber, orderId: orders.id, clientName: counterparties.name, vesselName: vessels.name, traderName: users.name, dueDate: invoices.dueDate, status: invoices.status, amount: invoices.amount, amountPaid: invoices.amountPaid }).from(invoices).innerJoin(orders, eq(invoices.orderId, orders.id)).innerJoin(counterparties, eq(orders.clientId, counterparties.id)).innerJoin(vessels, eq(orders.vesselId, vessels.id)).leftJoin(users, eq(orders.salesRepId, users.id)).where(and(...conditions)).orderBy(asc(invoices.dueDate));

  const rows: InvoiceAgingReportRowDto[] = invoiceRows.map((row) => {
    const amount = parseNumber(row.amount); const amountPaid = parseNumber(row.amountPaid);
    const outstandingAmount = Math.max(0, amount - amountPaid); const bucket = getAgingBucket(row.dueDate, today);
    return { invoiceId: row.invoiceId, invoiceNumber: row.invoiceNumber, orderId: row.orderId, clientName: row.clientName, vesselName: row.vesselName, traderName: row.traderName ?? null, dueDate: row.dueDate, status: row.status as any, amount: formatMoney(amount), amountPaid: formatMoney(amountPaid), outstandingAmount: formatMoney(outstandingAmount), daysOverdue: bucket.daysOverdue, agingBucket: bucket.label };
  });

  const bucketOrder = ['CURRENT', '1-30', '31-60', '61-90', '90+'];
  const bucketMap = new Map<string, { count: number; outstandingAmount: number }>();
  for (const l of bucketOrder) bucketMap.set(l, { count: 0, outstandingAmount: 0 });
  for (const r of rows) { const c = bucketMap.get(r.agingBucket)!; c.count += 1; c.outstandingAmount += parseNumber(r.outstandingAmount); }

  return { rows, buckets: bucketOrder.map((l) => ({ label: l, count: bucketMap.get(l)!.count, outstandingAmount: formatMoney(bucketMap.get(l)!.outstandingAmount) })), totalInvoices: rows.length, totalOutstanding: formatMoney(rows.reduce((s, r) => s + parseNumber(r.outstandingAmount), 0)) };
}

// ─── Conversion Metrics ─────────────────────────────────────────────

export function buildConversionMetrics(dataset: ScopedDataset): ConversionMetricsDto {
  const wonStatuses = new Set(['CONFIRMED', 'DELIVERED', 'INVOICED', 'PAID']);
  let totalWon = 0, totalLost = 0, closeDaysSum = 0, closeDaysCount = 0;
  for (const o of dataset.orderRows) {
    if (wonStatuses.has(o.status)) { totalWon += 1; if (o.closedAt) { closeDaysSum += (new Date(o.closedAt).getTime() - new Date(o.createdAt).getTime()) / 86_400_000; closeDaysCount += 1; } }
    else if (o.status === 'CANCELLED') totalLost += 1;
  }
  return { totalInquiries: dataset.orderRows.length, totalWon, totalLost, winRate: formatPercentValue(totalWon, totalWon + totalLost), avgDaysToClose: closeDaysCount > 0 ? Number((closeDaysSum / closeDaysCount).toFixed(1)) : null };
}

// ─── Loss Analysis ──────────────────────────────────────────────────

export async function buildLossAnalysisFromDb(tenantId: string, context: ReportAccessContext, filters: ReportFiltersDto): Promise<LossAnalysisResponseDto> {
  const conditions: any[] = [eq(orders.tenantId, tenantId), eq(orders.status, 'CANCELLED'), isNotNull(orders.lossReason)];
  if (filters.from) conditions.push(gte(orders.createdAt, new Date(`${filters.from}T00:00:00`)));
  if (filters.to) conditions.push(lte(orders.createdAt, new Date(`${filters.to}T23:59:59`)));
  if (context.userIds) conditions.push(inArray(orders.salesRepId, context.userIds));
  if (filters.traderId) conditions.push(eq(orders.salesRepId, filters.traderId));
  if (filters.customerId) conditions.push(eq(orders.clientId, filters.customerId));

  const rows = await db.select({ reason: orders.lossReason, count: sql<number>`count(*)::int`.as('count') }).from(orders).where(and(...conditions)).groupBy(orders.lossReason).orderBy(sql`count(*) desc`);
  const totalCancelled = rows.reduce((s, r) => s + Number(r.count), 0);
  return { totalCancelled, reasons: rows.map((r) => ({ reason: r.reason ?? 'Unknown', count: Number(r.count), percentage: formatPercentValue(Number(r.count), totalCancelled) })) };
}

// ─── Pipeline Summary ───────────────────────────────────────────────

export function buildPipelineSummary(dataset: ScopedDataset): PipelineStageDto[] {
  const stats = new Map<string, { count: number; totalValue: number }>();
  for (const order of dataset.orderRows) {
    const c = stats.get(order.status) ?? { count: 0, totalValue: 0 }; c.count += 1;
    for (const item of dataset.itemsByOrder.get(order.orderId) ?? []) c.totalValue += calculateRevenueBase(item);
    stats.set(order.status, c);
  }
  return Array.from(stats.entries()).map(([s, v]) => ({ status: s, count: v.count, totalValue: formatMoney(v.totalValue) }));
}

// ─── Commercial Summary ─────────────────────────────────────────────

export async function buildCommercialSummary(tenantId: string, context: ReportAccessContext, filters: ReportFiltersDto, dataset: ScopedDataset): Promise<CommercialSummaryReportDto> {
  return { conversion: buildConversionMetrics(dataset), lossAnalysis: await buildLossAnalysisFromDb(tenantId, context, filters), pipeline: buildPipelineSummary(dataset) };
}

// ─── Margin Analysis ────────────────────────────────────────────────

function accumulateMarginRow(map: Map<string, any>, key: string, label: string, values: any) {
  const c = map.get(key) ?? { row: { key, label, orderCount: 0, totalVolume: '0.000', totalRevenue: '0.00', totalGrossProfit: '0.00', totalFinancingCost: '0.00', totalNetProfit: '0.00', netMarginPct: null }, revenue: 0, netProfit: 0 };
  c.row.orderCount += values.orderCount ?? 0;
  c.row.totalVolume = formatQuantity(parseNumber(c.row.totalVolume) + values.quantity); c.revenue += values.revenue; c.netProfit += values.netProfit;
  c.row.totalRevenue = formatMoney(c.revenue); c.row.totalGrossProfit = formatMoney(parseNumber(c.row.totalGrossProfit) + values.grossProfit);
  c.row.totalFinancingCost = formatMoney(parseNumber(c.row.totalFinancingCost) + values.financingCost); c.row.totalNetProfit = formatMoney(c.netProfit);
  c.row.netMarginPct = c.revenue > 0 ? Number(((c.netProfit / c.revenue) * 100).toFixed(2)) : null; map.set(key, c);
}

export function buildMarginAnalysis(dataset: ScopedDataset): MarginAnalysisReportDto {
  const economicsByOrder = buildEconomicsByOrder(dataset) as any;
  const byCustomer = new Map(), byProduct = new Map(), byVessel = new Map();
  const monthlyTrend = new Map<string, { revenue: number; netProfit: number; orderCount: number }>();

  for (const order of dataset.orderRows) {
    const economics = economicsByOrder.get(order.orderId); if (!economics) continue;
    accumulateMarginRow(byCustomer, order.clientId, order.clientName, { orderCount: 1, quantity: economics.totalQuantity, revenue: economics.totalRevenueBase, grossProfit: economics.totalGrossProfit, financingCost: economics.totalFinancingCost, netProfit: economics.totalNetProfit });
    accumulateMarginRow(byVessel, order.vesselId, order.vesselName, { orderCount: 1, quantity: economics.totalQuantity, revenue: economics.totalRevenueBase, grossProfit: economics.totalGrossProfit, financingCost: economics.totalFinancingCost, netProfit: economics.totalNetProfit });

    const trendKey = monthKey(order.createdAt);
    const ct = monthlyTrend.get(trendKey) ?? { revenue: 0, netProfit: 0, orderCount: 0 }; ct.orderCount += 1; ct.revenue += economics.totalRevenueBase; ct.netProfit += economics.totalNetProfit; monthlyTrend.set(trendKey, ct);

    const items = dataset.itemsByOrder.get(order.orderId) ?? [];
    economics.lineEconomics.forEach((line: any, idx: number) => { const item = items[idx]; if (!item) return; accumulateMarginRow(byProduct, item.productType, item.productType, { quantity: line.quantity, revenue: line.revenueBase, grossProfit: line.grossProfit, financingCost: line.financingCost, netProfit: line.netProfit }); });
  }

  const sortRows = (m: Map<string, any>) => Array.from(m.values()).map((e) => e.row).sort((a: any, b: any) => parseNumber(b.totalNetProfit) - parseNumber(a.totalNetProfit));
  const trendRows: MarginTrendPointDto[] = Array.from(monthlyTrend.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, orderCount: v.orderCount, totalRevenue: formatMoney(v.revenue), totalNetProfit: formatMoney(v.netProfit), netMarginPct: v.revenue > 0 ? Number(((v.netProfit / v.revenue) * 100).toFixed(2)) : null }));

  return { byCustomer: sortRows(byCustomer), byProduct: sortRows(byProduct), byVessel: sortRows(byVessel), monthlyTrend: trendRows };
}

// ─── Variance ───────────────────────────────────────────────────────

export async function buildVariance(tenantId: string, context: ReportAccessContext, currentFilters: ReportFiltersDto, current: { traderPerformance: TraderPerformanceReportDto; invoiceAging: InvoiceAgingReportDto; commercialSummary: CommercialSummaryReportDto; marginAnalysis: MarginAnalysisReportDto }, comparisonMode?: ReportComparisonMode | null): Promise<any> {
  const comparison = buildComparisonWindow(currentFilters, comparisonMode);
  if (!comparison || !comparison.previousFrom || !comparison.previousTo) return emptyVariance();

  const prevFilters: ReportFiltersDto = { ...currentFilters, from: comparison.previousFrom, to: comparison.previousTo };
  const prevDataset = await fetchScopedDataset(tenantId, context, prevFilters);
  const [prevInvoiceAging, prevCommercialSummary] = await Promise.all([buildInvoiceAgingReport(tenantId, context, prevDataset.filtersApplied, prevDataset), buildCommercialSummary(tenantId, context, prevDataset.filtersApplied, prevDataset)]);
  const prevTraderPerformance = buildTraderPerformanceReport(prevDataset);
  const prevMarginAnalysis = buildMarginAnalysis(prevDataset);

  return {
    comparison: comparison as any, summary: {
      totalRevenue: buildVarianceValue(parseNumber(current.traderPerformance.totals.totalRevenue), parseNumber(prevTraderPerformance.totals.totalRevenue), formatMoney),
      totalNetProfit: buildVarianceValue(parseNumber(current.traderPerformance.totals.totalNetProfit), parseNumber(prevTraderPerformance.totals.totalNetProfit), formatMoney),
      totalOutstanding: buildVarianceValue(parseNumber(current.invoiceAging.totalOutstanding), parseNumber(prevInvoiceAging.totalOutstanding), formatMoney),
      winRate: buildVarianceValue(current.commercialSummary.conversion.winRate * 100, prevCommercialSummary.conversion.winRate * 100, (v) => v.toFixed(1)),
      avgDealSize: buildVarianceValue(parseNumber(current.traderPerformance.totals.avgDealSize), parseNumber(prevTraderPerformance.totals.avgDealSize), formatMoney),
    },
    topTraderMovers: buildVarianceRows(current.traderPerformance.rows.map((r) => ({ key: r.traderId, label: r.traderName, value: parseNumber(r.totalNetProfit) })), prevTraderPerformance.rows.map((r) => ({ key: r.traderId, label: r.traderName, value: parseNumber(r.totalNetProfit) }))),
    topCustomerMovers: buildVarianceRows(current.marginAnalysis.byCustomer.map((r) => ({ key: r.key, label: r.label, value: parseNumber(r.totalNetProfit) })), prevMarginAnalysis.byCustomer.map((r) => ({ key: r.key, label: r.label, value: parseNumber(r.totalNetProfit) }))),
    topProductMovers: buildVarianceRows(current.marginAnalysis.byProduct.map((r) => ({ key: r.key, label: r.label, value: parseNumber(r.totalNetProfit) })), prevMarginAnalysis.byProduct.map((r) => ({ key: r.key, label: r.label, value: parseNumber(r.totalNetProfit) }))),
  };
}

// ─── Exceptions ─────────────────────────────────────────────────────

export function buildExceptions(dataset: ScopedDataset, invoiceAging: InvoiceAgingReportDto, marginAnalysis: MarginAnalysisReportDto): ReportsExceptionsDto {
  const economicsByOrder = buildEconomicsByOrder(dataset) as any;
  const rows: ReportExceptionRowDto[] = [];

  for (const order of dataset.orderRows) {
    const economics = economicsByOrder.get(order.orderId);
    if (!economics || economics.totalNetProfit >= 0) continue;
    rows.push({ type: 'NEGATIVE_NET_PROFIT_ORDER', severity: 'HIGH', entityType: 'order', entityId: order.orderId, title: `${order.clientName} / ${order.vesselName}`, description: `${order.traderName} order is running at a negative net profit.`, primaryValue: formatMoney(economics.totalNetProfit), secondaryValue: `${formatMoney(economics.totalRevenueBase)} revenue` });
  }

  for (const invoice of invoiceAging.rows) {
    if (invoice.daysOverdue < 61) continue;
    rows.push({ type: 'SEVERELY_OVERDUE_INVOICE', severity: invoice.daysOverdue >= 90 ? 'HIGH' : 'MEDIUM', entityType: 'invoice', entityId: invoice.invoiceId, title: invoice.invoiceNumber, description: `${invoice.clientName} is ${invoice.daysOverdue} days overdue.`, primaryValue: invoice.outstandingAmount, secondaryValue: invoice.agingBucket });
  }

  for (const customer of marginAnalysis.byCustomer) {
    if (customer.netMarginPct === null || customer.netMarginPct >= 5 || parseNumber(customer.totalRevenue) < 1000) continue;
    rows.push({ type: 'LOW_MARGIN_CUSTOMER', severity: customer.netMarginPct < 2 ? 'HIGH' : 'MEDIUM', entityType: 'customer', entityId: customer.key, title: customer.label, description: 'Customer margin is below the operating threshold.', primaryValue: `${customer.netMarginPct.toFixed(1)}%`, secondaryValue: `${customer.totalRevenue} revenue` });
  }

  const byTypeMap = new Map<ReportExceptionType, number>();
  for (const row of rows) byTypeMap.set(row.type, (byTypeMap.get(row.type) ?? 0) + 1);

  return { totalCount: rows.length, byType: Array.from(byTypeMap.entries()).map(([t, c]) => ({ type: t, count: c })), rows: rows.sort((a, b) => { const s = (a.severity === 'HIGH' ? 1 : 0) - (b.severity === 'HIGH' ? 1 : 0); return s !== 0 ? (s > 0 ? -1 : 1) : a.title.localeCompare(b.title); }).slice(0, 25) };
}

// ─── Filter Options ─────────────────────────────────────────────────

export async function buildFilterOptions(tenantId: string, context: ReportAccessContext): Promise<ReportFilterOptionsDto> {
  const userConditions: any[] = [eq(users.tenantId, tenantId), eq(users.isActive, true)];
  if (context.userIds) userConditions.push(inArray(users.id, context.userIds));
  const [traderRows, teamRows, customerRows, productRows] = await Promise.all([
    db.select({ id: users.id, label: users.name, subtitle: users.email }).from(users).where(and(...userConditions)).orderBy(asc(users.name)),
    context.teamId ? db.select({ id: teams.id, label: teams.name }).from(teams).where(eq(teams.id, context.teamId)).orderBy(asc(teams.name)) : db.select({ id: teams.id, label: teams.name }).from(teams).where(eq(teams.tenantId, tenantId)).orderBy(asc(teams.name)),
    db.select({ id: counterparties.id, label: counterparties.name }).from(counterparties).where(eq(counterparties.tenantId, tenantId)).orderBy(asc(counterparties.name)),
    db.selectDistinct({ id: orderItems.productType, label: orderItems.productType }).from(orderItems).orderBy(asc(orderItems.productType)),
  ]);

  return { traders: traderRows, teams: teamRows, customers: customerRows, products: productRows };
}

// ─── Drilldown ──────────────────────────────────────────────────────

function buildOrderDrilldownRows(dataset: ScopedDataset, orderRows: any[]): ReportDrilldownOrderRowDto[] {
  const economicsByOrder = buildEconomicsByOrder(dataset) as any;
  return orderRows.map((order) => {
    const e = economicsByOrder.get(order.orderId);
    return { orderId: order.orderId, traderId: order.traderId, traderName: order.traderName, clientId: order.clientId, clientName: order.clientName, vesselId: order.vesselId, vesselName: order.vesselName, status: order.status, createdAt: order.createdAt.toISOString(), totalQuantity: formatQuantity(e?.totalQuantity ?? 0), totalRevenue: formatMoney(e?.totalRevenueBase ?? 0), totalGrossProfit: formatMoney(e?.totalGrossProfit ?? 0), totalFinancingCost: formatMoney(e?.totalFinancingCost ?? 0), totalNetProfit: formatMoney(e?.totalNetProfit ?? 0), netMarginPct: e?.netMarginPct ?? null };
  }).sort((a, b) => parseNumber(b.totalNetProfit) - parseNumber(a.totalNetProfit));
}

export async function getReportDrilldown(tenantId: string, requestingUserId: string, input: any): Promise<ReportDrilldownResponseDto> {
  const context = await resolveReportAccessContext(tenantId, requestingUserId);
  if (input.dimension === 'AGING_BUCKET') {
    const dataset = await fetchScopedDataset(tenantId, context, input);
    const invoiceAging = await buildInvoiceAgingReport(tenantId, context, dataset.filtersApplied, dataset);
    const invoices = invoiceAging.rows.filter((r) => r.agingBucket === input.value);
    return { title: `Invoices in ${input.value}`, dataset: 'INVOICES', target: 'AGING_BUCKET', totalCount: invoices.length, orders: [], invoices };
  }

  const dataset = await fetchScopedDataset(tenantId, context, input);
  const orders = dataset.orderRows.filter((r) => { if (input.dimension === 'TRADER') return r.traderId === input.value; if (input.dimension === 'CUSTOMER') return r.clientId === input.value; if (input.dimension === 'PRODUCT') return (dataset.itemsByOrder.get(r.orderId) ?? []).some((item) => item.productType === input.value); return false; });
  return { title: input.dimension === 'TRADER' ? `Orders for ${orders[0]?.traderName ?? input.value}` : input.dimension === 'CUSTOMER' ? `Orders for ${orders[0]?.clientName ?? input.value}` : `Orders for ${input.value}`, dataset: 'ORDERS', target: input.dimension, totalCount: orders.length, orders: buildOrderDrilldownRows(dataset, orders), invoices: [] };
}
