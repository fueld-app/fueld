// ═══════════════════════════════════════════════════════════════════════
//  Report Export — CSV and XLSX export functions
// ═══════════════════════════════════════════════════════════════════════

import * as XLSX from 'xlsx';
import { buildCsv, buildFileSuffix, formatMoney, parseNumber } from './report-utils.service';
import { getReleaseTwoReports } from './report-crud.service';
import type { ReportFiltersDto, ReportsQueryInput, ReleaseTwoReportsDto, MarginAnalysisRowDto } from '@fueld/types';

// ─── Trader Performance ─────────────────────────────────────────────

export async function exportTraderPerformanceCsv(tenantId: string, requestingUserId: string, filters: ReportFiltersDto): Promise<{ fileName: string; csv: string }> {
  const report = await getReleaseTwoReports(tenantId, requestingUserId, filters);
  const csv = buildCsv([['Trader', 'Team', 'Orders', 'Won', 'Lost', 'Win Rate %', 'Volume', 'Revenue USD', 'Gross Profit USD', 'Financing Cost USD', 'Net Profit USD', 'Avg Deal Size USD'],
    ...report.traderPerformance.rows.map((row) => [row.traderName, row.teamName, row.orderCount, row.wonCount, row.lostCount, (row.winRate * 100).toFixed(1), row.totalVolume, row.totalRevenue, row.totalGrossProfit, row.totalFinancingCost, row.totalNetProfit, row.avgDealSize]),
    [], ['TOTAL', '', report.traderPerformance.totals.orderCount, report.traderPerformance.totals.wonCount, report.traderPerformance.totals.lostCount, (report.traderPerformance.totals.winRate * 100).toFixed(1), report.traderPerformance.totals.totalVolume, report.traderPerformance.totals.totalRevenue, report.traderPerformance.totals.totalGrossProfit, report.traderPerformance.totals.totalFinancingCost, report.traderPerformance.totals.totalNetProfit, report.traderPerformance.totals.avgDealSize]]);
  return { fileName: `trader-performance_${buildFileSuffix(report.filtersApplied)}.csv`, csv };
}

export async function exportTraderPerformanceXlsx(tenantId: string, requestingUserId: string, filters: ReportFiltersDto): Promise<{ fileName: string; content: Buffer }> {
  const report = await getReleaseTwoReports(tenantId, requestingUserId, filters);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.traderPerformance.rows.map((row) => ({ Trader: row.traderName, Team: row.teamName, Orders: row.orderCount, Won: row.wonCount, Lost: row.lostCount, 'Win Rate %': Number((row.winRate * 100).toFixed(1)), Volume: Number(row.totalVolume), 'Revenue USD': Number(row.totalRevenue), 'Gross Profit USD': Number(row.totalGrossProfit), 'Financing Cost USD': Number(row.totalFinancingCost), 'Net Profit USD': Number(row.totalNetProfit), 'Avg Deal Size USD': Number(row.avgDealSize) }))), 'Trader Performance');
  return { fileName: `trader-performance_${buildFileSuffix(report.filtersApplied)}.xlsx`, content: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer };
}

// ─── Invoice Aging ──────────────────────────────────────────────────

export async function exportInvoiceAgingCsv(tenantId: string, requestingUserId: string, filters: ReportFiltersDto): Promise<{ fileName: string; csv: string }> {
  const report = await getReleaseTwoReports(tenantId, requestingUserId, filters);
  const csv = buildCsv([['Invoice', 'Client', 'Vessel', 'Trader', 'Due Date', 'Status', 'Amount USD', 'Paid USD', 'Outstanding USD', 'Days Overdue', 'Bucket'],
    ...report.invoiceAging.rows.map((row) => [row.invoiceNumber, row.clientName, row.vesselName, row.traderName, row.dueDate, row.status, row.amount, row.amountPaid, row.outstandingAmount, row.daysOverdue, row.agingBucket]),
    [], ['BUCKET', 'COUNT', 'OUTSTANDING USD'], ...report.invoiceAging.buckets.map((b) => [b.label, b.count, b.outstandingAmount]),
    [], ['TOTAL OPEN INVOICES', report.invoiceAging.totalInvoices, report.invoiceAging.totalOutstanding]]);
  return { fileName: `invoice-aging_${buildFileSuffix(report.filtersApplied)}.csv`, csv };
}

export async function exportInvoiceAgingXlsx(tenantId: string, requestingUserId: string, filters: ReportFiltersDto): Promise<{ fileName: string; content: Buffer }> {
  const report = await getReleaseTwoReports(tenantId, requestingUserId, filters);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.invoiceAging.rows.map((row) => ({ Invoice: row.invoiceNumber, Client: row.clientName, Vessel: row.vesselName, Trader: row.traderName, 'Due Date': row.dueDate, Status: row.status, 'Amount USD': Number(row.amount), 'Paid USD': Number(row.amountPaid), 'Outstanding USD': Number(row.outstandingAmount), 'Days Overdue': row.daysOverdue, Bucket: row.agingBucket }))), 'Invoice Aging');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.invoiceAging.buckets.map((b) => ({ Bucket: b.label, Count: b.count, 'Outstanding USD': Number(b.outstandingAmount) }))), 'Buckets');
  return { fileName: `invoice-aging_${buildFileSuffix(report.filtersApplied)}.xlsx`, content: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer };
}

// ─── Commercial Summary ─────────────────────────────────────────────

export async function exportCommercialSummaryCsv(tenantId: string, requestingUserId: string, filters: ReportFiltersDto): Promise<{ fileName: string; csv: string }> {
  const report = await getReleaseTwoReports(tenantId, requestingUserId, filters);
  const csv = buildCsv([['METRIC', 'VALUE'], ['Total Inquiries', report.commercialSummary.conversion.totalInquiries], ['Won', report.commercialSummary.conversion.totalWon], ['Lost', report.commercialSummary.conversion.totalLost], ['Win Rate %', (report.commercialSummary.conversion.winRate * 100).toFixed(1)], ['Avg Days To Close', report.commercialSummary.conversion.avgDaysToClose ?? ''], [], ['LOSS REASON', 'COUNT', 'PERCENTAGE'], ...report.commercialSummary.lossAnalysis.reasons.map((r) => [r.reason, r.count, (r.percentage * 100).toFixed(1)]), [], ['PIPELINE STATUS', 'COUNT', 'VALUE USD'], ...report.commercialSummary.pipeline.map((s) => [s.status, s.count, s.totalValue])]);
  return { fileName: `commercial-summary_${buildFileSuffix(report.filtersApplied)}.csv`, csv };
}

export async function exportCommercialSummaryXlsx(tenantId: string, requestingUserId: string, filters: ReportFiltersDto): Promise<{ fileName: string; content: Buffer }> {
  const report = await getReleaseTwoReports(tenantId, requestingUserId, filters);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Metric', 'Value'], ['Total Inquiries', report.commercialSummary.conversion.totalInquiries], ['Won', report.commercialSummary.conversion.totalWon], ['Lost', report.commercialSummary.conversion.totalLost], ['Win Rate %', Number((report.commercialSummary.conversion.winRate * 100).toFixed(1))], ['Avg Days To Close', report.commercialSummary.conversion.avgDaysToClose ?? '']]), 'Conversion');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.commercialSummary.lossAnalysis.reasons.map((r) => ({ Reason: r.reason, Count: r.count, 'Percentage %': Number((r.percentage * 100).toFixed(1)) }))), 'Loss Reasons');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.commercialSummary.pipeline.map((s) => ({ Status: s.status, Count: s.count, 'Value USD': Number(s.totalValue) }))), 'Pipeline');
  return { fileName: `commercial-summary_${buildFileSuffix(report.filtersApplied)}.xlsx`, content: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer };
}

// ─── Margin Analysis ────────────────────────────────────────────────

function buildMarginWorkbook(report: ReleaseTwoReportsDto): Buffer {
  const workbook = XLSX.utils.book_new();
  const toSheetRows = (rows: MarginAnalysisRowDto[]) => rows.map((r) => ({ Label: r.label, Orders: r.orderCount, Volume: Number(r.totalVolume), 'Revenue USD': Number(r.totalRevenue), 'Gross Profit USD': Number(r.totalGrossProfit), 'Financing Cost USD': Number(r.totalFinancingCost), 'Net Profit USD': Number(r.totalNetProfit), 'Net Margin %': r.netMarginPct ?? '' }));
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(toSheetRows(report.marginAnalysis.byCustomer)), 'By Customer');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(toSheetRows(report.marginAnalysis.byProduct)), 'By Product');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(toSheetRows(report.marginAnalysis.byVessel)), 'By Vessel');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.marginAnalysis.monthlyTrend.map((p) => ({ Month: p.month, Orders: p.orderCount, 'Revenue USD': Number(p.totalRevenue), 'Net Profit USD': Number(p.totalNetProfit), 'Net Margin %': p.netMarginPct ?? '' }))), 'Monthly Trend');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export async function exportMarginAnalysisCsv(tenantId: string, requestingUserId: string, filters: ReportFiltersDto): Promise<{ fileName: string; csv: string }> {
  const report = await getReleaseTwoReports(tenantId, requestingUserId, filters);
  const section = (title: string, rows: MarginAnalysisRowDto[]) => [[title], ['Label', 'Orders', 'Volume', 'Revenue USD', 'Gross Profit USD', 'Financing Cost USD', 'Net Profit USD', 'Net Margin %'], ...rows.map((r) => [r.label, r.orderCount, r.totalVolume, r.totalRevenue, r.totalGrossProfit, r.totalFinancingCost, r.totalNetProfit, r.netMarginPct ?? '']), []];
  const csv = buildCsv([...section('BY CUSTOMER', report.marginAnalysis.byCustomer), ...section('BY PRODUCT', report.marginAnalysis.byProduct), ...section('BY VESSEL', report.marginAnalysis.byVessel), ['MONTH', 'ORDERS', 'REVENUE USD', 'NET PROFIT USD', 'NET MARGIN %'], ...report.marginAnalysis.monthlyTrend.map((p) => [p.month, p.orderCount, p.totalRevenue, p.totalNetProfit, p.netMarginPct ?? ''])]);
  return { fileName: `margin-analysis_${buildFileSuffix(report.filtersApplied)}.csv`, csv };
}

export async function exportMarginAnalysisXlsx(tenantId: string, requestingUserId: string, filters: ReportFiltersDto): Promise<{ fileName: string; content: Buffer }> {
  const report = await getReleaseTwoReports(tenantId, requestingUserId, filters);
  return { fileName: `margin-analysis_${buildFileSuffix(report.filtersApplied)}.xlsx`, content: buildMarginWorkbook(report) };
}

// ─── Exceptions ─────────────────────────────────────────────────────

export async function exportExceptionsCsv(tenantId: string, requestingUserId: string, filters: ReportsQueryInput): Promise<{ fileName: string; csv: string }> {
  const report = await getReleaseTwoReports(tenantId, requestingUserId, filters);
  const csv = buildCsv([['Type', 'Severity', 'Title', 'Description', 'Primary Value', 'Secondary Value'], ...report.exceptions.rows.map((r) => [r.type, r.severity, r.title, r.description, r.primaryValue, r.secondaryValue ?? ''])]);
  return { fileName: `report-exceptions_${buildFileSuffix(report.filtersApplied)}.csv`, csv };
}

export async function exportExceptionsXlsx(tenantId: string, requestingUserId: string, filters: ReportsQueryInput): Promise<{ fileName: string; content: Buffer }> {
  const report = await getReleaseTwoReports(tenantId, requestingUserId, filters);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.exceptions.rows.map((r) => ({ Type: r.type, Severity: r.severity, Title: r.title, Description: r.description, 'Primary Value': r.primaryValue, 'Secondary Value': r.secondaryValue ?? '' }))), 'Exceptions');
  return { fileName: `report-exceptions_${buildFileSuffix(report.filtersApplied)}.xlsx`, content: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer };
}
