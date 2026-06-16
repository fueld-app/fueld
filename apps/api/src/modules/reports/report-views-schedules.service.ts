// ═══════════════════════════════════════════════════════════════════════
//  Report Views & Schedules — CRUD for saved views + schedules
// ═══════════════════════════════════════════════════════════════════════

import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { tenants, type TenantSettings } from '../../db/schema';
import { logActivity } from '../activity/activity.service';
import { resolveReportAccessContext, assertCanManageSharedViews, assertCanManageSchedules } from './report-access.service';
import { normalizeReportFilters, normalizeScheduleMode, normalizeDeliveryMode, resolveScheduleBodyMode, normalizeScheduleRecipientRoles, normalizeExtraEmails, normalizeExceptionTypes } from './report-utils.service';
import { getTenantSettingsRow, updateTenantReportSettings } from './report-dataset.service';
import type { ReportFiltersDto, Role, SavedReportViewDto, ReportScheduleDto, ReportScheduleMode, ReportScheduleType, ReportScheduleDeliveryMode, ReportScheduleBodyMode, ReportExceptionType } from '@fueld/types';

function mapSavedViews(settings: any): SavedReportViewDto[] {
  return (settings.savedViews ?? []).map((view: any) => ({ id: view.id, name: view.name, description: view.description ?? null, filters: view.filters ?? {}, createdAt: view.createdAt, updatedAt: view.updatedAt, createdByName: view.createdByName ?? null }));
}

function mapSchedules(settings: any): ReportScheduleDto[] {
  return (settings.schedules ?? []).map((schedule: any) => ({
    id: schedule.id, name: schedule.name, description: schedule.description ?? null,
    reportMode: normalizeScheduleMode(schedule.reportMode), reportType: schedule.reportType,
    deliveryMode: normalizeDeliveryMode(schedule.deliveryMode), bodyMode: resolveScheduleBodyMode(schedule.deliveryMode, schedule.bodyMode),
    hourUtc: schedule.hourUtc, recipientRoles: (schedule.recipientRoles ?? []) as Role[],
    extraEmails: schedule.extraEmails ?? [], exceptionTypes: normalizeExceptionTypes(schedule.exceptionTypes as any),
    sendOnlyWhenNonEmpty: schedule.sendOnlyWhenNonEmpty ?? false, filters: schedule.filters ?? {},
    isActive: schedule.isActive ?? true, lastSentAt: schedule.lastSentAt ?? null, createdAt: schedule.createdAt, updatedAt: schedule.updatedAt,
  }));
}

// ─── Saved Views ────────────────────────────────────────────────────

export async function createSavedReportView(tenantId: string, requestingUserId: string, userName: string | null, input: { name: string; description?: string | null; filters?: ReportFiltersDto }): Promise<SavedReportViewDto[]> {
  const context = await resolveReportAccessContext(tenantId, requestingUserId);
  assertCanManageSharedViews(context);
  const now = new Date().toISOString();
  const filters = normalizeReportFilters(input.filters ?? {}, context);
  const settings = await updateTenantReportSettings(tenantId, (current: any) => ({ ...current, savedViews: [{ id: crypto.randomUUID(), name: input.name.trim(), description: input.description?.trim() || null, filters, createdAt: now, updatedAt: now, createdByName: userName }, ...(current.savedViews ?? [])] }));
  const createdView = settings.savedViews?.[0];
  if (createdView) await logActivity({ userId: requestingUserId, tenantId, action: 'CREATE', entityType: 'report_saved_view', entityId: createdView.id, entityName: createdView.name, httpMethod: 'POST', httpPath: '/reports/saved-views', metadata: { name: createdView.name, description: createdView.description ?? null, filters: createdView.filters ?? {} } });
  return mapSavedViews(settings);
}

export async function updateSavedReportView(tenantId: string, requestingUserId: string, savedViewId: string, input: { name: string; description?: string | null; filters?: ReportFiltersDto }): Promise<SavedReportViewDto[]> {
  const context = await resolveReportAccessContext(tenantId, requestingUserId);
  assertCanManageSharedViews(context);
  const now = new Date().toISOString();
  const filters = normalizeReportFilters(input.filters ?? {}, context);
  const settings = await updateTenantReportSettings(tenantId, (current: any) => ({ ...current, savedViews: (current.savedViews ?? []).map((view: any) => view.id === savedViewId ? { ...view, name: input.name.trim(), description: input.description?.trim() || null, filters, updatedAt: now } : view) }));
  const updatedView = settings.savedViews?.find((v: any) => v.id === savedViewId);
  if (!updatedView) throw new Error('Saved view not found');
  await logActivity({ userId: requestingUserId, tenantId, action: 'UPDATE', entityType: 'report_saved_view', entityId: updatedView.id, entityName: updatedView.name, httpMethod: 'PATCH', httpPath: `/reports/saved-views/${savedViewId}`, metadata: { name: updatedView.name, description: updatedView.description ?? null, filters: updatedView.filters ?? {} } });
  return mapSavedViews(settings);
}

export async function deleteSavedReportView(tenantId: string, requestingUserId: string, savedViewId: string): Promise<SavedReportViewDto[]> {
  const context = await resolveReportAccessContext(tenantId, requestingUserId);
  assertCanManageSharedViews(context);
  const tenant = await getTenantSettingsRow(tenantId);
  const existingView = ((tenant.settings ?? {}) as TenantSettings).reportsSettings?.savedViews?.find((v: any) => v.id === savedViewId);
  const settings = await updateTenantReportSettings(tenantId, (current: any) => ({ ...current, savedViews: (current.savedViews ?? []).filter((v: any) => v.id !== savedViewId) }));
  if (!existingView) throw new Error('Saved view not found');
  await logActivity({ userId: requestingUserId, tenantId, action: 'DELETE', entityType: 'report_saved_view', entityId: existingView.id, entityName: existingView.name, httpMethod: 'DELETE', httpPath: `/reports/saved-views/${savedViewId}`, metadata: { name: existingView.name, description: existingView.description ?? null, filters: existingView.filters ?? {} } });
  return mapSavedViews(settings);
}

// ─── Schedules ──────────────────────────────────────────────────────

export async function createReportSchedule(tenantId: string, requestingUserId: string, input: { name: string; description?: string | null; reportMode?: ReportScheduleMode; reportType: ReportScheduleType; deliveryMode?: ReportScheduleDeliveryMode; bodyMode?: ReportScheduleBodyMode; hourUtc: number; recipientRoles: Role[]; extraEmails?: string[]; exceptionTypes?: ReportExceptionType[]; sendOnlyWhenNonEmpty?: boolean; filters?: ReportFiltersDto }): Promise<ReportScheduleDto[]> {
  const context = await resolveReportAccessContext(tenantId, requestingUserId);
  assertCanManageSchedules(context);
  const now = new Date().toISOString();
  const filters = normalizeReportFilters(input.filters ?? {}, context);
  const settings = await updateTenantReportSettings(tenantId, (current: any) => ({ ...current, schedules: [{ id: crypto.randomUUID(), name: input.name.trim(), description: input.description?.trim() || null, reportMode: normalizeScheduleMode(input.reportMode), reportType: input.reportType, deliveryMode: normalizeDeliveryMode(input.deliveryMode), bodyMode: resolveScheduleBodyMode(input.deliveryMode, input.bodyMode), hourUtc: Math.max(0, Math.min(23, Math.round(input.hourUtc))), recipientRoles: normalizeScheduleRecipientRoles(input.recipientRoles), extraEmails: normalizeExtraEmails(input.extraEmails), exceptionTypes: normalizeExceptionTypes(input.exceptionTypes), sendOnlyWhenNonEmpty: input.sendOnlyWhenNonEmpty ?? false, filters, isActive: true, lastSentAt: null, createdAt: now, updatedAt: now }, ...(current.schedules ?? [])] }));
  const createdSchedule = settings.schedules?.[0];
  if (createdSchedule) await logActivity({ userId: requestingUserId, tenantId, action: 'CREATE', entityType: 'report_schedule', entityId: createdSchedule.id, entityName: createdSchedule.name, httpMethod: 'POST', httpPath: '/reports/schedules', metadata: { reportMode: normalizeScheduleMode(createdSchedule.reportMode), reportType: createdSchedule.reportType, deliveryMode: normalizeDeliveryMode(createdSchedule.deliveryMode), bodyMode: resolveScheduleBodyMode(createdSchedule.deliveryMode, createdSchedule.bodyMode), hourUtc: createdSchedule.hourUtc } });
  return mapSchedules(settings);
}

export async function updateReportSchedule(tenantId: string, requestingUserId: string, scheduleId: string, input: { name: string; description?: string | null; reportMode?: ReportScheduleMode; reportType: ReportScheduleType; deliveryMode?: ReportScheduleDeliveryMode; bodyMode?: ReportScheduleBodyMode; hourUtc: number; recipientRoles: Role[]; extraEmails?: string[]; exceptionTypes?: ReportExceptionType[]; sendOnlyWhenNonEmpty?: boolean; filters?: ReportFiltersDto; isActive?: boolean }): Promise<ReportScheduleDto[]> {
  const context = await resolveReportAccessContext(tenantId, requestingUserId);
  assertCanManageSchedules(context);
  const now = new Date().toISOString();
  const filters = normalizeReportFilters(input.filters ?? {}, context);
  const settings = await updateTenantReportSettings(tenantId, (current: any) => ({ ...current, schedules: (current.schedules ?? []).map((s: any) => s.id === scheduleId ? { ...s, name: input.name.trim(), description: input.description?.trim() || null, reportMode: normalizeScheduleMode(input.reportMode ?? s.reportMode), reportType: input.reportType, deliveryMode: normalizeDeliveryMode(input.deliveryMode), bodyMode: resolveScheduleBodyMode(input.deliveryMode, input.bodyMode), hourUtc: Math.max(0, Math.min(23, Math.round(input.hourUtc))), recipientRoles: normalizeScheduleRecipientRoles(input.recipientRoles), extraEmails: normalizeExtraEmails(input.extraEmails), exceptionTypes: normalizeExceptionTypes(input.exceptionTypes ?? s.exceptionTypes), sendOnlyWhenNonEmpty: input.sendOnlyWhenNonEmpty ?? s.sendOnlyWhenNonEmpty ?? false, filters, isActive: input.isActive ?? s.isActive ?? true, updatedAt: now } : s) }));
  const updatedSchedule = settings.schedules?.find((s: any) => s.id === scheduleId);
  if (!updatedSchedule) throw new Error('Schedule not found');
  await logActivity({ userId: requestingUserId, tenantId, action: 'UPDATE', entityType: 'report_schedule', entityId: updatedSchedule.id, entityName: updatedSchedule.name, httpMethod: 'PATCH', httpPath: `/reports/schedules/${scheduleId}`, metadata: { reportMode: normalizeScheduleMode(updatedSchedule.reportMode), reportType: updatedSchedule.reportType, deliveryMode: normalizeDeliveryMode(updatedSchedule.deliveryMode), bodyMode: resolveScheduleBodyMode(updatedSchedule.deliveryMode, updatedSchedule.bodyMode), hourUtc: updatedSchedule.hourUtc } });
  return mapSchedules(settings);
}

export async function deleteReportSchedule(tenantId: string, requestingUserId: string, scheduleId: string): Promise<ReportScheduleDto[]> {
  const context = await resolveReportAccessContext(tenantId, requestingUserId);
  assertCanManageSchedules(context);
  const tenant = await getTenantSettingsRow(tenantId);
  const existingSchedule = ((tenant.settings ?? {}) as TenantSettings).reportsSettings?.schedules?.find((s: any) => s.id === scheduleId);
  const settings = await updateTenantReportSettings(tenantId, (current: any) => ({ ...current, schedules: (current.schedules ?? []).filter((s: any) => s.id !== scheduleId) }));
  if (!existingSchedule) throw new Error('Schedule not found');
  await logActivity({ userId: requestingUserId, tenantId, action: 'DELETE', entityType: 'report_schedule', entityId: existingSchedule.id, entityName: existingSchedule.name, httpMethod: 'DELETE', httpPath: `/reports/schedules/${scheduleId}`, metadata: { reportMode: normalizeScheduleMode(existingSchedule.reportMode), reportType: existingSchedule.reportType } });
  return mapSchedules(settings);
}
