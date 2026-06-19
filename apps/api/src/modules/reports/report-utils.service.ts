// ═══════════════════════════════════════════════════════════════════════
//  Report Utils — parsing, formatting, date helpers, normalizers
// ═══════════════════════════════════════════════════════════════════════

import type { Role } from '@fueld/types';
import type { ReportFiltersDto, ReportComparisonMode } from '@fueld/types';

// ─── Parsing ────────────────────────────────────────────────────────

export function parseNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function formatMoney(value: number): string {
  return value.toFixed(2);
}

export function formatQuantity(value: number): string {
  return value.toFixed(3);
}

export function formatPercentValue(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export function formatPercentDisplay(value: number): string {
  return (value * 100).toFixed(1);
}

export function escapeCsv(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function buildCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map((row) => row.map((cell) => escapeCsv(cell)).join(',')).join('\n');
}

export function buildFileSuffix(filters: ReportFiltersDto): string {
  if (filters.from || filters.to) {
    return [filters.from ?? 'start', filters.to ?? 'end'].join('_');
  }
  return new Date().toISOString().slice(0, 10);
}

// ─── Date Helpers ───────────────────────────────────────────────────

export function startOfDayUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

export function addYears(date: Date, years: number): Date {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ─── Comparison / Variance ──────────────────────────────────────────

export function normalizeComparisonMode(mode?: ReportComparisonMode | null): ReportComparisonMode {
  switch (mode) {
    case 'PREVIOUS_PERIOD':
    case 'PREVIOUS_MONTH':
    case 'PREVIOUS_QUARTER':
    case 'PREVIOUS_YEAR':
      return mode;
    default:
      return 'NONE';
  }
}

export function buildComparisonWindow(
  filters: ReportFiltersDto,
  mode?: ReportComparisonMode | null,
): { mode: string; label: string; currentFrom: string; currentTo: string; previousFrom: string; previousTo: string } | null {
  const normalizedMode = normalizeComparisonMode(mode);
  if (normalizedMode === 'NONE' || !filters.from || !filters.to) return null;

  const currentFrom = startOfDayUtc(filters.from);
  const currentTo = startOfDayUtc(filters.to);
  let previousFrom: Date;
  let previousTo: Date;
  let label: string;

  switch (normalizedMode) {
    case 'PREVIOUS_MONTH':
      previousFrom = addMonths(currentFrom, -1);
      previousTo = addMonths(currentTo, -1);
      label = 'vs previous month';
      break;
    case 'PREVIOUS_QUARTER':
      previousFrom = addMonths(currentFrom, -3);
      previousTo = addMonths(currentTo, -3);
      label = 'vs previous quarter';
      break;
    case 'PREVIOUS_YEAR':
      previousFrom = addYears(currentFrom, -1);
      previousTo = addYears(currentTo, -1);
      label = 'vs previous year';
      break;
    case 'PREVIOUS_PERIOD': {
      const durationDays = Math.max(1, Math.round((currentTo.getTime() - currentFrom.getTime()) / 86_400_000) + 1);
      previousTo = addDays(currentFrom, -1);
      previousFrom = addDays(previousTo, -(durationDays - 1));
      label = 'vs previous period';
      break;
    }
    default:
      return null;
  }

  return {
    mode: normalizedMode,
    label,
    currentFrom: filters.from,
    currentTo: filters.to,
    previousFrom: formatDateOnly(previousFrom),
    previousTo: formatDateOnly(previousTo),
  };
}

export function reportDirection(delta: number): 'UP' | 'DOWN' | 'FLAT' {
  if (delta > 0.00001) return 'UP';
  if (delta < -0.00001) return 'DOWN';
  return 'FLAT';
}

// ─── Normalizers ────────────────────────────────────────────────────

export function normalizeFilterValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function normalizeReportFilters(
  filters: ReportFiltersDto | undefined,
  context: { userIds: string[] | null; teamId: string | null },
): ReportFiltersDto {
  const traderId = normalizeFilterValue(filters?.traderId ?? undefined);
  const teamId = normalizeFilterValue(filters?.teamId ?? undefined);
  const customerId = normalizeFilterValue(filters?.customerId ?? undefined);
  const productType = normalizeFilterValue(filters?.productType ?? undefined);

  const normalized: ReportFiltersDto = {
    from: normalizeFilterValue(filters?.from ?? undefined) ?? undefined,
    to: normalizeFilterValue(filters?.to ?? undefined) ?? undefined,
    customerId,
    productType,
  };

  if (context.userIds === null) {
    normalized.traderId = traderId;
    normalized.teamId = teamId;
    return normalized;
  }

  normalized.traderId = traderId && context.userIds.includes(traderId) ? traderId : null;
  normalized.teamId = context.teamId && teamId === context.teamId ? teamId : null;
  return normalized;
}

export function getAgingBucket(dueDate: string, today: string): { label: string; daysOverdue: number } {
  const dueMs = new Date(dueDate).getTime();
  const todayMs = new Date(today).getTime();
  const diffDays = Math.floor((todayMs - dueMs) / 86_400_000);

  if (diffDays <= 0) return { label: 'CURRENT', daysOverdue: 0 };
  if (diffDays <= 30) return { label: '1-30', daysOverdue: diffDays };
  if (diffDays <= 60) return { label: '31-60', daysOverdue: diffDays };
  if (diffDays <= 90) return { label: '61-90', daysOverdue: diffDays };
  return { label: '90+', daysOverdue: diffDays };
}

export function buildVarianceValue(
  currentValue: number,
  previousValue: number,
  formatter: (value: number) => string,
) {
  const deltaValue = currentValue - previousValue;
  return {
    currentValue: formatter(currentValue),
    previousValue: formatter(previousValue),
    deltaValue: formatter(deltaValue),
    deltaPct: Math.abs(previousValue) > 0.00001 ? Number((((deltaValue / previousValue) * 100)).toFixed(1)) : null,
    direction: reportDirection(deltaValue),
  };
}

export function buildVarianceRows(
  currentRows: Array<{ key: string; label: string; value: number }>,
  previousRows: Array<{ key: string; label: string; value: number }>,
) {
  const previousMap = new Map(previousRows.map((row) => [row.key, row]));
  const currentMap = new Map(currentRows.map((row) => [row.key, row]));
  const keys = new Set([...currentMap.keys(), ...previousMap.keys()]);

  return Array.from(keys).map((key) => {
    const current = currentMap.get(key);
    const previous = previousMap.get(key);
    const currentValue = current?.value ?? 0;
    const previousValue = previous?.value ?? 0;
    const deltaValue = currentValue - previousValue;
    return {
      key,
      label: current?.label ?? previous?.label ?? key,
      currentValue: formatMoney(currentValue),
      previousValue: formatMoney(previousValue),
      deltaValue: formatMoney(deltaValue),
      deltaPct: Math.abs(previousValue) > 0.00001 ? Number((((deltaValue / previousValue) * 100)).toFixed(1)) : null,
      direction: reportDirection(deltaValue),
    };
  }).sort((left, right) => Math.abs(parseNumber(right.deltaValue)) - Math.abs(parseNumber(left.deltaValue))).slice(0, 8);
}

// ─── Schedule normalizers ───────────────────────────────────────────

import type { ReportScheduleMode, ReportScheduleDeliveryMode, ReportScheduleBodyMode, ReportExceptionType } from '@fueld/types';

export function normalizeScheduleMode(mode?: ReportScheduleMode | null): ReportScheduleMode {
  return mode === 'EXCEPTIONS' ? 'EXCEPTIONS' : 'SUMMARY';
}

export function normalizeDeliveryMode(mode?: ReportScheduleDeliveryMode | null): ReportScheduleDeliveryMode {
  return mode === 'CSV' || mode === 'XLSX' || mode === 'CSV_XLSX' ? mode : 'HTML';
}

export function normalizeBodyMode(mode?: ReportScheduleBodyMode | null): ReportScheduleBodyMode {
  return mode === 'ATTACHMENT_ONLY' ? 'ATTACHMENT_ONLY' : 'HTML_SUMMARY';
}

export function resolveScheduleBodyMode(
  deliveryMode?: ReportScheduleDeliveryMode | null,
  bodyMode?: ReportScheduleBodyMode | null,
): ReportScheduleBodyMode {
  const normalizedDeliveryMode = normalizeDeliveryMode(deliveryMode);
  const normalizedBodyMode = normalizeBodyMode(bodyMode);
  return normalizedDeliveryMode === 'HTML' ? 'HTML_SUMMARY' : normalizedBodyMode;
}

export function normalizeScheduleRecipientRoles(recipientRoles?: Role[]): Role[] {
  return Array.from(new Set((recipientRoles ?? []).filter(Boolean)));
}

export function normalizeExtraEmails(extraEmails?: string[]): string[] {
  return Array.from(new Set((extraEmails ?? []).map((email) => email.trim()).filter(Boolean)));
}

export function normalizeExceptionTypes(exceptionTypes?: ReportExceptionType[] | null): ReportExceptionType[] {
  return Array.from(new Set((exceptionTypes ?? []).filter((value): value is ReportExceptionType => Boolean(value))));
}

export function normalizeReportSettings(settings?: any | null): any {
  return { savedViews: [...(settings?.savedViews ?? [])], schedules: [...(settings?.schedules ?? [])] };
}

export function emptyVariance(): any {
  return { comparison: null, summary: null, topTraderMovers: [], topCustomerMovers: [], topProductMovers: [] };
}

export function emptyExceptions() {
  return { totalCount: 0, byType: [], rows: [] };
}
