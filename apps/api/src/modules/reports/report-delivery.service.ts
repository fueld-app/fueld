// ═══════════════════════════════════════════════════════════════════════
//  Report Delivery — email HTML builders + scheduled runs
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { tenants, users, type TenantSettings } from '../../db/schema';
import { Role } from '@fueld/types';
import { sendNotificationEmail } from '../../lib/email';
import { getReleaseTwoReports } from './report-crud.service';
import { buildCsv, buildFileSuffix, formatMoney, parseNumber, normalizeReportSettings, normalizeScheduleMode, normalizeDeliveryMode, resolveScheduleBodyMode, normalizeExceptionTypes } from './report-utils.service';
import type { ReleaseTwoReportsDto, ReportScheduleDto, ReportExceptionRowDto } from '@fueld/types';
import * as XLSX from 'xlsx';
import type { MarginAnalysisRowDto } from '@fueld/types';

// ─── Email HTML Builders ────────────────────────────────────────────

function buildSummaryEmailHtml(tenantName: string, report: ReleaseTwoReportsDto): string {
  const topTraders = report.traderPerformance.rows.slice(0, 5).map((row) => `<tr><td style="padding:6px 0;">${row.traderName}</td><td style="padding:6px 0; text-align:right;">${formatMoney(parseNumber(row.totalNetProfit))}</td></tr>`).join('');
  const agingRows = report.invoiceAging.buckets.map((b) => `<tr><td style="padding:6px 0;">${b.label}</td><td style="padding:6px 0; text-align:right;">${b.count}</td><td style="padding:6px 0; text-align:right;">${b.outstandingAmount}</td></tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;"><h2 style="margin:0 0 12px;">${tenantName} report summary</h2><p style="margin:0 0 18px;color:#6b7280;">Generated ${new Date(report.generatedAt).toUTCString()}</p><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:18px;"><div style="border:1px solid #e5e7eb;border-radius:12px;padding:12px;"><div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;">Net Profit</div><div style="font-size:24px;font-weight:600;">${report.traderPerformance.totals.totalNetProfit} USD</div></div><div style="border:1px solid #e5e7eb;border-radius:12px;padding:12px;"><div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;">Win Rate</div><div style="font-size:24px;font-weight:600;">${(report.commercialSummary.conversion.winRate * 100).toFixed(1)}%</div></div></div><h3 style="margin:0 0 8px;">Top traders by net profit</h3><table style="width:100%;border-collapse:collapse;margin-bottom:18px;"><tbody>${topTraders || '<tr><td>No trader data</td></tr>'}</tbody></table><h3 style="margin:0 0 8px;">Invoice aging</h3><table style="width:100%;border-collapse:collapse;"><tbody>${agingRows}</tbody></table></div>`;
}

function buildMarginEmailHtml(tenantName: string, report: ReleaseTwoReportsDto): string {
  const topCustomers = report.marginAnalysis.byCustomer.slice(0, 5).map((row) => `<tr><td style="padding:6px 0;">${row.label}</td><td style="padding:6px 0;text-align:right;">${row.totalNetProfit}</td><td style="padding:6px 0;text-align:right;">${row.netMarginPct ?? '—'}%</td></tr>`).join('');
  const trendRows = report.marginAnalysis.monthlyTrend.map((p) => `<tr><td style="padding:6px 0;">${p.month}</td><td style="padding:6px 0;text-align:right;">${p.totalRevenue}</td><td style="padding:6px 0;text-align:right;">${p.totalNetProfit}</td></tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;"><h2 style="margin:0 0 12px;">${tenantName} margin analysis</h2><p style="margin:0 0 18px;color:#6b7280;">Generated ${new Date(report.generatedAt).toUTCString()}</p><h3 style="margin:0 0 8px;">Top customers by net profit</h3><table style="width:100%;border-collapse:collapse;margin-bottom:18px;"><tbody>${topCustomers || '<tr><td>No customer data</td></tr>'}</tbody></table><h3 style="margin:0 0 8px;">Monthly trend</h3><table style="width:100%;border-collapse:collapse;"><tbody>${trendRows || '<tr><td>No trend data</td></tr>'}</tbody></table></div>`;
}

function buildExceptionsEmailHtml(tenantName: string, rows: ReportExceptionRowDto[]): string {
  const tableRows = rows.slice(0, 10).map((row) => `<tr><td style="padding:6px 0;">${row.title}</td><td style="padding:6px 0;">${row.type}</td><td style="padding:6px 0;text-align:right;">${row.primaryValue}</td></tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;"><h2 style="margin:0 0 12px;">${tenantName} report exceptions</h2><p style="margin:0 0 18px;color:#6b7280;">${rows.length} exception${rows.length === 1 ? '' : 's'} matched the current schedule.</p><table style="width:100%;border-collapse:collapse;"><tbody>${tableRows || '<tr><td>No exceptions</td></tr>'}</tbody></table></div>`;
}

// ─── Attachment Builders ────────────────────────────────────────────

function buildSummaryBundleCsv(report: ReleaseTwoReportsDto): string {
  return buildCsv([['TRADER PERFORMANCE'], ['Trader', 'Team', 'Orders', 'Won', 'Lost', 'Win Rate %', 'Revenue USD', 'Net Profit USD'], ...report.traderPerformance.rows.map((r) => [r.traderName, r.teamName, r.orderCount, r.wonCount, r.lostCount, (r.winRate * 100).toFixed(1), r.totalRevenue, r.totalNetProfit]), [], ['INVOICE AGING'], ['Invoice', 'Client', 'Outstanding USD', 'Days Overdue', 'Bucket'], ...report.invoiceAging.rows.map((r) => [r.invoiceNumber, r.clientName, r.outstandingAmount, r.daysOverdue, r.agingBucket]), [], ['COMMERCIAL SUMMARY'], ['Metric', 'Value'], ['Total Inquiries', report.commercialSummary.conversion.totalInquiries], ['Won', report.commercialSummary.conversion.totalWon], ['Lost', report.commercialSummary.conversion.totalLost], ['Win Rate %', (report.commercialSummary.conversion.winRate * 100).toFixed(1)]]);
}

function buildSummaryWorkbook(report: ReleaseTwoReportsDto): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.traderPerformance.rows.map((r) => ({ Trader: r.traderName, Team: r.teamName, Orders: r.orderCount, Won: r.wonCount, Lost: r.lostCount, 'Win Rate %': Number((r.winRate * 100).toFixed(1)), 'Revenue USD': Number(r.totalRevenue), 'Net Profit USD': Number(r.totalNetProfit) }))), 'Trader Performance');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.invoiceAging.rows.map((r) => ({ Invoice: r.invoiceNumber, Client: r.clientName, Trader: r.traderName, 'Due Date': r.dueDate, 'Outstanding USD': Number(r.outstandingAmount), 'Days Overdue': r.daysOverdue, Bucket: r.agingBucket }))), 'Invoice Aging');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Metric', 'Value'], ['Total Inquiries', report.commercialSummary.conversion.totalInquiries], ['Won', report.commercialSummary.conversion.totalWon], ['Lost', report.commercialSummary.conversion.totalLost], ['Win Rate %', Number((report.commercialSummary.conversion.winRate * 100).toFixed(1))], ['Avg Days To Close', report.commercialSummary.conversion.avgDaysToClose ?? '']]), 'Commercial Summary');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function buildMarginWorkbook(report: ReleaseTwoReportsDto): Buffer {
  const workbook = XLSX.utils.book_new();
  const toSheetRows = (rows: MarginAnalysisRowDto[]) => rows.map((r) => ({ Label: r.label, Orders: r.orderCount, Volume: Number(r.totalVolume), 'Revenue USD': Number(r.totalRevenue), 'Gross Profit USD': Number(r.totalGrossProfit), 'Financing Cost USD': Number(r.totalFinancingCost), 'Net Profit USD': Number(r.totalNetProfit), 'Net Margin %': r.netMarginPct ?? '' }));
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(toSheetRows(report.marginAnalysis.byCustomer)), 'By Customer');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(toSheetRows(report.marginAnalysis.byProduct)), 'By Product');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(toSheetRows(report.marginAnalysis.byVessel)), 'By Vessel');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.marginAnalysis.monthlyTrend.map((p) => ({ Month: p.month, Orders: p.orderCount, 'Revenue USD': Number(p.totalRevenue), 'Net Profit USD': Number(p.totalNetProfit), 'Net Margin %': p.netMarginPct ?? '' }))), 'Monthly Trend');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function buildScheduledAttachments(schedule: ReportScheduleDto, report: ReleaseTwoReportsDto) {
  const suffix = buildFileSuffix(report.filtersApplied);
  const attachments: Array<{ filename: string; content: string | Buffer; contentType: string }> = [];
  const wantsCsv = schedule.deliveryMode === 'CSV' || schedule.deliveryMode === 'CSV_XLSX';
  const wantsXlsx = schedule.deliveryMode === 'XLSX' || schedule.deliveryMode === 'CSV_XLSX';
  const baseName = schedule.reportMode === 'EXCEPTIONS' ? 'exceptions' : schedule.reportType === 'MARGIN_ANALYSIS' ? 'margin-analysis' : 'summary';
  const exceptionRows = schedule.exceptionTypes.length > 0 ? report.exceptions.rows.filter((r) => schedule.exceptionTypes.includes(r.type)) : report.exceptions.rows;

  if (wantsCsv) {
    attachments.push({ filename: `${baseName}_${suffix}.csv`, content: schedule.reportMode === 'EXCEPTIONS' ? buildCsv([['Type', 'Severity', 'Title', 'Description', 'Primary Value', 'Secondary Value'], ...exceptionRows.map((r) => [r.type, r.severity, r.title, r.description, r.primaryValue, r.secondaryValue ?? ''])]) : schedule.reportType === 'MARGIN_ANALYSIS' ? buildCsv([['MONTH', 'ORDERS', 'REVENUE USD', 'NET PROFIT USD', 'NET MARGIN %'], ...report.marginAnalysis.monthlyTrend.map((p) => [p.month, p.orderCount, p.totalRevenue, p.totalNetProfit, p.netMarginPct ?? ''])]) : buildSummaryBundleCsv(report), contentType: 'text/csv; charset=utf-8' });
  }
  if (wantsXlsx) {
    const workbook = schedule.reportMode === 'EXCEPTIONS' ? (() => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exceptionRows.map((r) => ({ Type: r.type, Severity: r.severity, Title: r.title, Description: r.description, 'Primary Value': r.primaryValue, 'Secondary Value': r.secondaryValue ?? '' }))), 'Exceptions'); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer; })() : schedule.reportType === 'MARGIN_ANALYSIS' ? buildMarginWorkbook(report) : buildSummaryWorkbook(report);
    attachments.push({ filename: `${baseName}_${suffix}.xlsx`, content: workbook, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  return attachments;
}

// ─── Scheduler ──────────────────────────────────────────────────────

async function runScheduleForTenant(tenantId: string, tenantName: string, schedule: ReportScheduleDto): Promise<boolean> {
  const userRows = await db.select({ email: users.email }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.isActive, true), inArray(users.role, schedule.recipientRoles)));
  const recipients = Array.from(new Set([...userRows.map((r) => r.email), ...schedule.extraEmails].map((v) => v.trim()).filter(Boolean)));
  if (recipients.length === 0) return false;

  const adminUser = await db.query.users.findFirst({ where: and(eq(users.tenantId, tenantId), eq(users.role, Role.Admin)), columns: { id: true } });
  if (!adminUser) return false;

  const report = await getReleaseTwoReports(tenantId, adminUser.id, schedule.filters ?? {});
  if (!report) return false;

  const exceptionRows = schedule.exceptionTypes.length > 0 ? report.exceptions.rows.filter((r) => schedule.exceptionTypes.includes(r.type)) : report.exceptions.rows;
  if (schedule.reportMode === 'EXCEPTIONS' && schedule.sendOnlyWhenNonEmpty && exceptionRows.length === 0) return false;

  const html = schedule.reportMode === 'EXCEPTIONS' ? buildExceptionsEmailHtml(tenantName, exceptionRows) : schedule.reportType === 'MARGIN_ANALYSIS' ? buildMarginEmailHtml(tenantName, report) : buildSummaryEmailHtml(tenantName, report);
  const effectiveBodyMode = resolveScheduleBodyMode(schedule.deliveryMode, schedule.bodyMode);
  const htmlBody = effectiveBodyMode === 'ATTACHMENT_ONLY' ? '<div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;"><p>Your scheduled Fueld report is attached.</p></div>' : html;
  const textBody = effectiveBodyMode === 'ATTACHMENT_ONLY' ? 'Your scheduled Fueld report is attached.' : undefined;

  return sendNotificationEmail(recipients, `Fueld report: ${schedule.name}`, htmlBody, { textContent: textBody, attachments: buildScheduledAttachments(schedule, report) });
}

export async function runDueReportSchedules(now = new Date()): Promise<void> {
  const tenantsWithSettings = await db.select({ id: tenants.id, name: tenants.name, settings: tenants.settings }).from(tenants);
  const hourUtc = now.getUTCHours();
  const todayKey = now.toISOString().slice(0, 10);

  for (const tenant of tenantsWithSettings) {
    const currentSettings = (tenant.settings ?? {}) as TenantSettings;
    const reportSettings = normalizeReportSettings(currentSettings.reportsSettings);
    let updated = false;

    const adminUser = await db.query.users.findFirst({ where: and(eq(users.tenantId, tenant.id), eq(users.role, Role.Admin)), columns: { id: true } });
    if (!adminUser) continue;

    for (const schedule of reportSettings.schedules ?? []) {
      if (schedule.isActive === false) continue;
      if (Math.round(schedule.hourUtc) !== hourUtc) continue;
      if ((schedule.lastSentAt ?? '').slice(0, 10) === todayKey) continue;

      const sent = await runScheduleForTenant(tenant.id, tenant.name, {
        id: schedule.id, name: schedule.name, description: schedule.description ?? null,
        reportMode: normalizeScheduleMode(schedule.reportMode), reportType: schedule.reportType,
        deliveryMode: normalizeDeliveryMode(schedule.deliveryMode), bodyMode: resolveScheduleBodyMode(schedule.deliveryMode, schedule.bodyMode),
        hourUtc: schedule.hourUtc, recipientRoles: (schedule.recipientRoles ?? []) as any[],
        extraEmails: schedule.extraEmails ?? [], exceptionTypes: normalizeExceptionTypes(schedule.exceptionTypes as any),
        sendOnlyWhenNonEmpty: schedule.sendOnlyWhenNonEmpty ?? false, filters: schedule.filters ?? {},
        isActive: schedule.isActive ?? true, lastSentAt: schedule.lastSentAt ?? null, createdAt: schedule.createdAt, updatedAt: schedule.updatedAt,
      });
      if (!sent) continue;
      schedule.lastSentAt = now.toISOString();
      schedule.updatedAt = now.toISOString();
      updated = true;
    }

    if (updated) {
      await db.update(tenants).set({ settings: { ...currentSettings, reportsSettings: reportSettings }, updatedAt: new Date() }).where(eq(tenants.id, tenant.id));
    }
  }
}

export function startReportsScheduleJob(): void {
  const intervalMs = 60 * 60 * 1000;
  const run = async () => {
    try { await runDueReportSchedules(); } catch (error) { console.error('[Reports] Scheduled delivery failed:', error); }
  };
  setTimeout(run, 20_000);
  setInterval(run, intervalMs);
  console.log('[Reports] Background job started (interval: 1h)');
}
