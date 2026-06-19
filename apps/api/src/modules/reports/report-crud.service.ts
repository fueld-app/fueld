// ═══════════════════════════════════════════════════════════════════════
//  Report CRUD — main report entry points
// ═══════════════════════════════════════════════════════════════════════

import { resolveReportAccessContext } from './report-access.service';
import { fetchScopedDataset } from './report-dataset.service';
import { getTenantSettingsRow, updateTenantReportSettings } from './report-dataset.service';
import { normalizeScheduleMode, normalizeDeliveryMode, resolveScheduleBodyMode, normalizeExceptionTypes } from './report-utils.service';
import { buildTraderPerformanceReport, buildInvoiceAgingReport, buildCommercialSummary, buildMarginAnalysis, buildVariance, buildExceptions, buildFilterOptions } from './report-builders.service';
import type { ReportAccessContext, StoredReportSettings } from './report.types';
import type { ReportFiltersDto, ReportComparisonMode, ReleaseOneReportsDto, ReleaseTwoReportsDto, ReportFilterOptionsDto, SavedReportViewDto, ReportScheduleDto } from '@fueld/types';
import type { TenantSettings } from '../../db/schema';

export async function getReleaseOneReports(tenantId: string, requestingUserId: string, filters: ReportFiltersDto): Promise<ReleaseOneReportsDto> {
  const context = await resolveReportAccessContext(tenantId, requestingUserId);
  const dataset = await fetchScopedDataset(tenantId, context, filters);
  const [invoiceAging, commercialSummary] = await Promise.all([
    buildInvoiceAgingReport(tenantId, context, dataset.filtersApplied, dataset),
    buildCommercialSummary(tenantId, context, dataset.filtersApplied, dataset),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    access: context.access,
    traderPerformance: buildTraderPerformanceReport(dataset),
    invoiceAging,
    commercialSummary,
  };
}

export async function getReleaseTwoReports(tenantId: string, requestingUserId: string, filters: any): Promise<ReleaseTwoReportsDto> {
  const context = await resolveReportAccessContext(tenantId, requestingUserId);
  const tenant = await getTenantSettingsRow(tenantId);
  const settings = normalizeReportSettings(((tenant.settings ?? {}) as TenantSettings).reportsSettings);
  const dataset = await fetchScopedDataset(tenantId, context, filters);
  const [invoiceAging, commercialSummary, filterOptions] = await Promise.all([
    buildInvoiceAgingReport(tenantId, context, dataset.filtersApplied, dataset),
    buildCommercialSummary(tenantId, context, dataset.filtersApplied, dataset),
    buildFilterOptions(tenantId, context),
  ]);

  const traderPerformance = buildTraderPerformanceReport(dataset);
  const marginAnalysis = buildMarginAnalysis(dataset);
  const variance = await buildVariance(tenantId, context, dataset.filtersApplied, { traderPerformance, invoiceAging, commercialSummary, marginAnalysis }, filters.comparisonMode);
  const exceptions = buildExceptions(dataset, invoiceAging, marginAnalysis);

  return {
    generatedAt: new Date().toISOString(),
    access: context.access,
    filtersApplied: dataset.filtersApplied,
    filterOptions,
    savedViews: mapSavedViews(settings),
    schedules: mapSchedules(settings),
    traderPerformance,
    invoiceAging,
    commercialSummary,
    marginAnalysis,
    variance,
    exceptions,
  };
}

function mapSavedViews(settings: any): SavedReportViewDto[] {
  return (settings.savedViews ?? []).map((view: any) => ({ id: view.id, name: view.name, description: view.description ?? null, filters: view.filters ?? {}, createdAt: view.createdAt, updatedAt: view.updatedAt, createdByName: view.createdByName ?? null }));
}

function mapSchedules(settings: any): ReportScheduleDto[] {
  return (settings.schedules ?? []).map((schedule: any) => ({
    id: schedule.id, name: schedule.name, description: schedule.description ?? null,
    reportMode: normalizeScheduleMode(schedule.reportMode), reportType: schedule.reportType,
    deliveryMode: normalizeDeliveryMode(schedule.deliveryMode), bodyMode: resolveScheduleBodyMode(schedule.deliveryMode, schedule.bodyMode),
    hourUtc: schedule.hourUtc, recipientRoles: (schedule.recipientRoles ?? []) as any[],
    extraEmails: schedule.extraEmails ?? [], exceptionTypes: normalizeExceptionTypes(schedule.exceptionTypes as any),
    sendOnlyWhenNonEmpty: schedule.sendOnlyWhenNonEmpty ?? false, filters: schedule.filters ?? {},
    isActive: schedule.isActive ?? true, lastSentAt: schedule.lastSentAt ?? null, createdAt: schedule.createdAt, updatedAt: schedule.updatedAt,
  }));
}

function normalizeReportSettings(settings?: any): any {
  return { savedViews: [...(settings?.savedViews ?? [])], schedules: [...(settings?.schedules ?? [])] };
}
