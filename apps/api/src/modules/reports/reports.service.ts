import { and, asc, eq, gte, inArray, isNotNull, lte, ne, sql } from 'drizzle-orm';
import type {
  CommercialSummaryReportDto,
  ConversionMetricsDto,
  InvoiceAgingReportDto,
  InvoiceAgingReportRowDto,
  LossAnalysisResponseDto,
  MarginAnalysisReportDto,
  MarginAnalysisRowDto,
  MarginTrendPointDto,
  PipelineStageDto,
  ReportComparisonMode,
  ReportComparisonWindowDto,
  ReportDrilldownOrderRowDto,
  ReportDrilldownResponseDto,
  ReportDrilldownTarget,
  ReportExceptionRowDto,
  ReportExceptionType,
  ReportScheduleMode,
  ReleaseOneReportsDto,
  ReleaseTwoReportsDto,
  ReportFilterOptionsDto,
  ReportScheduleBodyMode,
  ReportFiltersDto,
  ReportScheduleDeliveryMode,
  ReportScheduleDto,
  ReportScheduleType,
  ReportsAccessDto,
  ReportsExceptionsDto,
  ReportsVarianceDto,
  SavedReportViewDto,
  TraderPerformanceReportDto,
  TraderPerformanceReportRowDto,
} from '@fueld/types';
import { Role } from '@fueld/types';
import * as XLSX from 'xlsx';
import { db } from '../../db';
import {
  counterparties,
  invoices,
  orderItems,
  orders,
  teams,
  tenants,
  type TenantSettings,
  users,
  userTeams,
  vessels,
} from '../../db/schema';
import { sendNotificationEmail } from '../../lib/email';
import { logActivity } from '../activity/activity.service';
import { calculateOrderEconomics, calculateRevenueBase, getFinancingRateAnnual } from '../orders/order-financing';

const MANAGE_SHARED_REPORT_ROLES: Role[] = [
  Role.Admin,
  Role.Finance,
  Role.Teamlead,
  Role.CreditManager,
];

type StoredReportSettings = NonNullable<TenantSettings['reportsSettings']>;

type ScopedOrderRow = {
  orderId: string;
  traderId: string;
  traderName: string;
  traderEmail: string;
  teamId: string | null;
  teamName: string | null;
  clientId: string;
  clientName: string;
  vesselId: string;
  vesselName: string;
  status: string;
  createdAt: Date;
  closedAt: Date | null;
  customerPaymentTermType: string | null;
  customerCreditDays: number | null;
  supplierPaymentTermType: string | null;
  supplierCreditDays: number | null;
};

type ScopedItemRow = {
  orderId: string;
  productType: string;
  quantity: string | number | null;
  deliveredQuantity: string | number | null;
  costPrice: string | number | null;
  costCurrency: string | null;
  costConversionFactor: string | number | null;
  salesPrice: string | number | null;
  salesCurrency: string | null;
  unitConversionFactor: string | number | null;
};

type ReportAccessContext = {
  access: ReportsAccessDto;
  userIds: string[] | null;
  teamId: string | null;
};

type ScopedDataset = {
  filtersApplied: ReportFiltersDto;
  orderRows: ScopedOrderRow[];
  itemRows: ScopedItemRow[];
  itemsByOrder: Map<string, ScopedItemRow[]>;
  financingRateAnnual: number;
};

type ReportsQueryInput = ReportFiltersDto & {
  comparisonMode?: ReportComparisonMode | null;
};

type ReportDrilldownInput = ReportFiltersDto & {
  dimension: ReportDrilldownTarget;
  value: string;
};

function parseNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatMoney(value: number): string {
  return value.toFixed(2);
}

function formatQuantity(value: number): string {
  return value.toFixed(3);
}

function formatPercentValue(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function formatPercentDisplay(value: number): string {
  return (value * 100).toFixed(1);
}

function escapeCsv(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function buildCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map((row) => row.map((cell) => escapeCsv(cell)).join(',')).join('\n');
}

function buildFileSuffix(filters: ReportFiltersDto): string {
  if (filters.from || filters.to) {
    return [filters.from ?? 'start', filters.to ?? 'end'].join('_');
  }
  return new Date().toISOString().slice(0, 10);
}

function normalizeComparisonMode(mode?: ReportComparisonMode | null): ReportComparisonMode {
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

function normalizeScheduleMode(mode?: ReportScheduleMode | null): ReportScheduleMode {
  return mode === 'EXCEPTIONS' ? 'EXCEPTIONS' : 'SUMMARY';
}

function normalizeExceptionTypes(exceptionTypes?: ReportExceptionType[] | null): ReportExceptionType[] {
  return Array.from(new Set((exceptionTypes ?? []).filter((value): value is ReportExceptionType => Boolean(value))));
}

function startOfDayUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function addYears(date: Date, years: number): Date {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

function buildComparisonWindow(filters: ReportFiltersDto, mode?: ReportComparisonMode | null): ReportComparisonWindowDto | null {
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

function reportDirection(delta: number): 'UP' | 'DOWN' | 'FLAT' {
  if (delta > 0.00001) return 'UP';
  if (delta < -0.00001) return 'DOWN';
  return 'FLAT';
}

function buildVarianceValue(currentValue: number, previousValue: number, formatter: (value: number) => string) {
  const deltaValue = currentValue - previousValue;
  return {
    currentValue: formatter(currentValue),
    previousValue: formatter(previousValue),
    deltaValue: formatter(deltaValue),
    deltaPct: Math.abs(previousValue) > 0.00001 ? Number((((deltaValue / previousValue) * 100)).toFixed(1)) : null,
    direction: reportDirection(deltaValue),
  };
}

function buildVarianceRows(
  currentRows: Array<{ key: string; label: string; value: number }>,
  previousRows: Array<{ key: string; label: string; value: number }>,
): ReportsVarianceDto['topTraderMovers'] {
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

function emptyVariance(): ReportsVarianceDto {
  return {
    comparison: null,
    summary: null,
    topTraderMovers: [],
    topCustomerMovers: [],
    topProductMovers: [],
  };
}

function emptyExceptions(): ReportsExceptionsDto {
  return {
    totalCount: 0,
    byType: [],
    rows: [],
  };
}

function normalizeDeliveryMode(mode?: ReportScheduleDeliveryMode | null): ReportScheduleDeliveryMode {
  return mode === 'CSV' || mode === 'XLSX' || mode === 'CSV_XLSX' ? mode : 'HTML';
}

function normalizeBodyMode(mode?: ReportScheduleBodyMode | null): ReportScheduleBodyMode {
  return mode === 'ATTACHMENT_ONLY' ? 'ATTACHMENT_ONLY' : 'HTML_SUMMARY';
}

function resolveScheduleBodyMode(
  deliveryMode?: ReportScheduleDeliveryMode | null,
  bodyMode?: ReportScheduleBodyMode | null,
): ReportScheduleBodyMode {
  const normalizedDeliveryMode = normalizeDeliveryMode(deliveryMode);
  const normalizedBodyMode = normalizeBodyMode(bodyMode);
  return normalizedDeliveryMode === 'HTML' ? 'HTML_SUMMARY' : normalizedBodyMode;
}

function normalizeScheduleRecipientRoles(recipientRoles?: Role[]): Role[] {
  return Array.from(new Set((recipientRoles ?? []).filter(Boolean)));
}

function normalizeExtraEmails(extraEmails?: string[]): string[] {
  return Array.from(new Set((extraEmails ?? []).map((email) => email.trim()).filter(Boolean)));
}

function getAgingBucket(dueDate: string, today: string): { label: string; daysOverdue: number } {
  const dueMs = new Date(dueDate).getTime();
  const todayMs = new Date(today).getTime();
  const diffDays = Math.floor((todayMs - dueMs) / 86_400_000);

  if (diffDays <= 0) return { label: 'CURRENT', daysOverdue: 0 };
  if (diffDays <= 30) return { label: '1-30', daysOverdue: diffDays };
  if (diffDays <= 60) return { label: '31-60', daysOverdue: diffDays };
  if (diffDays <= 90) return { label: '61-90', daysOverdue: diffDays };
  return { label: '90+', daysOverdue: diffDays };
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function normalizeReportSettings(settings?: TenantSettings['reportsSettings'] | null): StoredReportSettings {
  return {
    savedViews: [...(settings?.savedViews ?? [])],
    schedules: [...(settings?.schedules ?? [])],
  };
}

function normalizeFilterValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeReportFilters(filters: ReportFiltersDto | undefined, context: ReportAccessContext): ReportFiltersDto {
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

async function getTenantSettingsRow(tenantId: string) {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { id: true, name: true, settings: true },
  });

  if (!tenant) throw new Error('Tenant not found');
  return tenant;
}

async function updateTenantReportSettings(
  tenantId: string,
  updater: (current: StoredReportSettings) => StoredReportSettings,
): Promise<StoredReportSettings> {
  const tenant = await getTenantSettingsRow(tenantId);
  const currentSettings = (tenant.settings ?? {}) as TenantSettings;
  const nextReportSettings = updater(normalizeReportSettings(currentSettings.reportsSettings));
  const nextSettings: TenantSettings = {
    ...currentSettings,
    reportsSettings: nextReportSettings,
  };

  await db.update(tenants).set({ settings: nextSettings, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
  return nextReportSettings;
}

async function logReportConfigActivity(params: {
  tenantId: string;
  userId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  entityType: 'report_saved_view' | 'report_schedule';
  entityId: string;
  entityName: string;
  httpMethod: 'POST' | 'PATCH' | 'DELETE';
  httpPath: string;
  metadata: Record<string, unknown>;
}) {
  await logActivity({
    userId: params.userId,
    tenantId: params.tenantId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    entityName: params.entityName,
    httpMethod: params.httpMethod,
    httpPath: params.httpPath,
    metadata: params.metadata,
  });
}

async function resolveReportAccessContext(
  tenantId: string,
  requestingUserId: string,
): Promise<ReportAccessContext> {
  const requestingUser = await db.query.users.findFirst({
    where: eq(users.id, requestingUserId),
    columns: { id: true, role: true, primaryTeamId: true },
  });

  if (!requestingUser) throw new Error('User not found');

  // Load all teams this user belongs to
  const userTeamRows = await db
    .select({ teamId: userTeams.teamId })
    .from(userTeams)
    .where(eq(userTeams.userId, requestingUserId));
  const userTeamIds = userTeamRows.map((r) => r.teamId);

  const canManage = MANAGE_SHARED_REPORT_ROLES.includes(requestingUser.role as Role);
  const canViewAll = [Role.Admin, Role.Finance, Role.CreditManager].includes(requestingUser.role as Role);

  if (canViewAll) {
    return {
      access: {
        role: requestingUser.role as Role,
        scope: 'ALL',
        canExport: true,
        canViewFinance: true,
        canViewTeamPerformance: true,
        canViewCollections: true,
        canManageSharedViews: canManage,
        canManageSchedules: canManage,
      },
      userIds: null,
      teamId: requestingUser.primaryTeamId ?? null,
    };
  }

  if (requestingUser.role === Role.Teamlead && userTeamIds.length > 0) {
    const teamMembers = await db
      .select({ id: userTeams.userId })
      .from(userTeams)
      .innerJoin(users, eq(userTeams.userId, users.id))
      .where(
        and(
          eq(users.tenantId, tenantId),
          inArray(userTeams.teamId, userTeamIds),
          inArray(users.role, [Role.Trader, Role.Teamlead]),
        ),
      );

    return {
      access: {
        role: requestingUser.role as Role,
        scope: teamMembers.length > 1 ? 'TEAM' : 'SELF',
        canExport: true,
        canViewFinance: false,
        canViewTeamPerformance: teamMembers.length > 1,
        canViewCollections: true,
        canManageSharedViews: canManage,
        canManageSchedules: canManage,
      },
      userIds: teamMembers.map((member) => member.id),
      teamId: requestingUser.primaryTeamId ?? null,
    };
  }

  const delegatedUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.delegateId, requestingUserId), eq(users.isOnLeave, true)));

  return {
    access: {
      role: requestingUser.role as Role,
      scope: 'SELF',
      canExport: true,
      canViewFinance: false,
      canViewTeamPerformance: false,
      canViewCollections: true,
      canManageSharedViews: false,
      canManageSchedules: false,
    },
    userIds: Array.from(new Set([requestingUserId, ...delegatedUsers.map((user) => user.id)])),
    teamId: requestingUser.primaryTeamId ?? null,
  };
}

function assertCanManageSharedViews(context: ReportAccessContext): void {
  if (!context.access.canManageSharedViews) {
    throw new Error('Forbidden: insufficient role to manage shared report views');
  }
}

function assertCanManageSchedules(context: ReportAccessContext): void {
  if (!context.access.canManageSchedules) {
    throw new Error('Forbidden: insufficient role to manage report schedules');
  }
}

async function fetchScopedDataset(
  tenantId: string,
  context: ReportAccessContext,
  filters: ReportFiltersDto,
): Promise<ScopedDataset> {
  const filtersApplied = normalizeReportFilters(filters, context);
  const conditions = [eq(orders.tenantId, tenantId), isNotNull(orders.salesRepId)];
  if (filtersApplied.from) conditions.push(gte(orders.createdAt, new Date(`${filtersApplied.from}T00:00:00`)));
  if (filtersApplied.to) conditions.push(lte(orders.createdAt, new Date(`${filtersApplied.to}T23:59:59`)));
  if (context.userIds) conditions.push(inArray(orders.salesRepId, context.userIds));
  if (filtersApplied.traderId) conditions.push(eq(orders.salesRepId, filtersApplied.traderId));
  if (filtersApplied.customerId) conditions.push(eq(orders.clientId, filtersApplied.customerId));

  const orderRows = await db
    .select({
      orderId: orders.id,
      traderId: orders.salesRepId,
      traderName: users.name,
      traderEmail: users.email,
      teamId: users.primaryTeamId,
      teamName: teams.name,
      clientId: counterparties.id,
      clientName: counterparties.name,
      vesselId: vessels.id,
      vesselName: vessels.name,
      status: orders.status,
      createdAt: orders.createdAt,
      closedAt: orders.closedAt,
      customerPaymentTermType: orders.customerPaymentTermType,
      customerCreditDays: orders.customerCreditDays,
      supplierPaymentTermType: orders.supplierPaymentTermType,
      supplierCreditDays: orders.supplierCreditDays,
    })
    .from(orders)
    .innerJoin(users, eq(orders.salesRepId, users.id))
    .leftJoin(teams, eq(users.primaryTeamId, teams.id))
    .innerJoin(counterparties, eq(orders.clientId, counterparties.id))
    .innerJoin(vessels, eq(orders.vesselId, vessels.id))
    .where(and(...conditions));

  // When filtering by team, look up all users who belong to that team via user_teams.
  // This correctly handles users who belong to multiple teams — their orders appear
  // under every team they are a member of, not just their primaryTeamId.
  let teamFilteredOrderRows = orderRows;
  if (filtersApplied.teamId) {
    const teamUserIds = await db
      .select({ userId: userTeams.userId })
      .from(userTeams)
      .where(eq(userTeams.teamId, filtersApplied.teamId));
    const teamUserIdSet = new Set(teamUserIds.map((r) => r.userId));
    teamFilteredOrderRows = orderRows.filter((row) => teamUserIdSet.has(row.traderId));
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { settings: true },
  });
  const financingRateAnnual = getFinancingRateAnnual((tenant?.settings ?? {}) as TenantSettings);

  if (teamFilteredOrderRows.length === 0) {
    return {
      filtersApplied,
      orderRows: [],
      itemRows: [],
      itemsByOrder: new Map(),
      financingRateAnnual,
    };
  }

  const itemRows = await db
    .select({
      orderId: orderItems.orderId,
      productType: orderItems.productType,
      quantity: orderItems.quantity,
      deliveredQuantity: orderItems.deliveredQuantity,
      costPrice: orderItems.costPrice,
      costCurrency: orderItems.costCurrency,
      costConversionFactor: orderItems.costConversionFactor,
      salesPrice: orderItems.salesPrice,
      salesCurrency: orderItems.salesCurrency,
      unitConversionFactor: orderItems.unitConversionFactor,
    })
    .from(orderItems)
    .where(and(
      inArray(orderItems.orderId, teamFilteredOrderRows.map((row) => row.orderId)),
      ...(filtersApplied.productType ? [eq(orderItems.productType, filtersApplied.productType as any)] : []),
    ));

  const itemsByOrder = new Map<string, ScopedItemRow[]>();
  for (const item of itemRows) {
    const current = itemsByOrder.get(item.orderId) ?? [];
    current.push(item as ScopedItemRow);
    itemsByOrder.set(item.orderId, current);
  }

  const filteredOrderRows = filtersApplied.productType
    ? teamFilteredOrderRows.filter((row) => itemsByOrder.has(row.orderId))
    : teamFilteredOrderRows;

  return {
    filtersApplied,
    orderRows: filteredOrderRows as ScopedOrderRow[],
    itemRows: itemRows as ScopedItemRow[],
    itemsByOrder,
    financingRateAnnual,
  };
}

function buildEconomicsByOrder(dataset: ScopedDataset) {
  const revenueEligibleStatuses = new Set(['OFFER', 'CONFIRMED', 'DELIVERED', 'INVOICED', 'PAID']);
  const orderEconomics = new Map<string, ReturnType<typeof calculateOrderEconomics>>();

  for (const order of dataset.orderRows) {
    if (!revenueEligibleStatuses.has(order.status)) continue;
    const economics = calculateOrderEconomics(
      {
        customerPaymentTermType: order.customerPaymentTermType,
        customerCreditDays: order.customerCreditDays,
        supplierPaymentTermType: order.supplierPaymentTermType,
        supplierCreditDays: order.supplierCreditDays,
      },
      dataset.itemsByOrder.get(order.orderId) ?? [],
      dataset.financingRateAnnual,
    );
    orderEconomics.set(order.orderId, economics);
  }

  return orderEconomics;
}

function emptyTraderPerformanceReport(): TraderPerformanceReportDto {
  return {
    rows: [],
    totals: {
      orderCount: 0,
      wonCount: 0,
      lostCount: 0,
      winRate: 0,
      totalVolume: '0.000',
      totalRevenue: '0.00',
      totalGrossProfit: '0.00',
      totalFinancingCost: '0.00',
      totalNetProfit: '0.00',
      avgDealSize: '0.00',
    },
  };
}

function buildTraderPerformanceReport(dataset: ScopedDataset): TraderPerformanceReportDto {
  if (dataset.orderRows.length === 0) return emptyTraderPerformanceReport();

  const economicsByOrder = buildEconomicsByOrder(dataset);
  const wonStatuses = new Set(['CONFIRMED', 'DELIVERED', 'INVOICED', 'PAID']);
  const stats = new Map<string, {
    row: TraderPerformanceReportRowDto;
    totalRevenueValue: number;
    totalNetProfitValue: number;
  }>();

  for (const order of dataset.orderRows) {
    const current = stats.get(order.traderId) ?? {
      row: {
        traderId: order.traderId,
        traderName: order.traderName,
        traderEmail: order.traderEmail,
        teamName: order.teamName,
        orderCount: 0,
        wonCount: 0,
        lostCount: 0,
        winRate: 0,
        totalVolume: '0.000',
        totalRevenue: '0.00',
        totalGrossProfit: '0.00',
        totalFinancingCost: '0.00',
        totalNetProfit: '0.00',
        avgDealSize: '0.00',
      },
      totalRevenueValue: 0,
      totalNetProfitValue: 0,
    };

    if (order.status === 'CANCELLED') {
      current.row.lostCount += 1;
      current.row.winRate = formatPercentValue(current.row.wonCount, current.row.wonCount + current.row.lostCount);
      stats.set(order.traderId, current);
      continue;
    }

    if (wonStatuses.has(order.status)) {
      current.row.wonCount += 1;
      current.row.winRate = formatPercentValue(current.row.wonCount, current.row.wonCount + current.row.lostCount);
    }

    const economics = economicsByOrder.get(order.orderId);
    if (!economics) {
      stats.set(order.traderId, current);
      continue;
    }

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

  const rows = Array.from(stats.values())
    .map((entry) => entry.row)
    .sort((left, right) => parseNumber(right.totalNetProfit) - parseNumber(left.totalNetProfit));

  const totalRevenue = rows.reduce((sum, row) => sum + parseNumber(row.totalRevenue), 0);
  const totalOrders = rows.reduce((sum, row) => sum + row.orderCount, 0);
  const totalWon = rows.reduce((sum, row) => sum + row.wonCount, 0);
  const totalLost = rows.reduce((sum, row) => sum + row.lostCount, 0);

  return {
    rows,
    totals: {
      orderCount: totalOrders,
      wonCount: totalWon,
      lostCount: totalLost,
      winRate: formatPercentValue(totalWon, totalWon + totalLost),
      totalVolume: formatQuantity(rows.reduce((sum, row) => sum + parseNumber(row.totalVolume), 0)),
      totalRevenue: formatMoney(totalRevenue),
      totalGrossProfit: formatMoney(rows.reduce((sum, row) => sum + parseNumber(row.totalGrossProfit), 0)),
      totalFinancingCost: formatMoney(rows.reduce((sum, row) => sum + parseNumber(row.totalFinancingCost), 0)),
      totalNetProfit: formatMoney(rows.reduce((sum, row) => sum + parseNumber(row.totalNetProfit), 0)),
      avgDealSize: formatMoney(totalOrders > 0 ? totalRevenue / totalOrders : 0),
    },
  };
}

function emptyInvoiceAgingReport(): InvoiceAgingReportDto {
  return {
    rows: [],
    buckets: ['CURRENT', '1-30', '31-60', '61-90', '90+'].map((label) => ({ label, count: 0, outstandingAmount: '0.00' })),
    totalInvoices: 0,
    totalOutstanding: '0.00',
  };
}

async function buildInvoiceAgingReport(
  tenantId: string,
  context: ReportAccessContext,
  filters: ReportFiltersDto,
  dataset: ScopedDataset,
): Promise<InvoiceAgingReportDto> {
  if (dataset.orderRows.length === 0) return emptyInvoiceAgingReport();

  const today = new Date().toISOString().slice(0, 10);
  const conditions = [
    eq(orders.tenantId, tenantId),
    ne(invoices.status, 'PAID'),
    ne(invoices.status, 'VOID'),
    inArray(orders.id, dataset.orderRows.map((row) => row.orderId)),
  ];
  if (context.userIds) conditions.push(inArray(orders.salesRepId, context.userIds));
  if (filters.from) conditions.push(gte(invoices.dueDate, filters.from));
  if (filters.to) conditions.push(lte(invoices.dueDate, filters.to));

  const invoiceRows = await db
    .select({
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      orderId: orders.id,
      clientName: counterparties.name,
      vesselName: vessels.name,
      traderName: users.name,
      dueDate: invoices.dueDate,
      status: invoices.status,
      amount: invoices.amount,
      amountPaid: invoices.amountPaid,
    })
    .from(invoices)
    .innerJoin(orders, eq(invoices.orderId, orders.id))
    .innerJoin(counterparties, eq(orders.clientId, counterparties.id))
    .innerJoin(vessels, eq(orders.vesselId, vessels.id))
    .leftJoin(users, eq(orders.salesRepId, users.id))
    .where(and(...conditions))
    .orderBy(asc(invoices.dueDate));

  const rows: InvoiceAgingReportRowDto[] = invoiceRows.map((row) => {
    const amount = parseNumber(row.amount);
    const amountPaid = parseNumber(row.amountPaid);
    const outstandingAmount = Math.max(0, amount - amountPaid);
    const bucket = getAgingBucket(row.dueDate, today);

    return {
      invoiceId: row.invoiceId,
      invoiceNumber: row.invoiceNumber,
      orderId: row.orderId,
      clientName: row.clientName,
      vesselName: row.vesselName,
      traderName: row.traderName ?? null,
      dueDate: row.dueDate,
      status: row.status as InvoiceAgingReportRowDto['status'],
      amount: formatMoney(amount),
      amountPaid: formatMoney(amountPaid),
      outstandingAmount: formatMoney(outstandingAmount),
      daysOverdue: bucket.daysOverdue,
      agingBucket: bucket.label,
    };
  });

  const bucketOrder = ['CURRENT', '1-30', '31-60', '61-90', '90+'];
  const bucketMap = new Map<string, { count: number; outstandingAmount: number }>();
  for (const label of bucketOrder) bucketMap.set(label, { count: 0, outstandingAmount: 0 });

  for (const row of rows) {
    const current = bucketMap.get(row.agingBucket) ?? { count: 0, outstandingAmount: 0 };
    current.count += 1;
    current.outstandingAmount += parseNumber(row.outstandingAmount);
    bucketMap.set(row.agingBucket, current);
  }

  return {
    rows,
    buckets: bucketOrder.map((label) => ({
      label,
      count: bucketMap.get(label)?.count ?? 0,
      outstandingAmount: formatMoney(bucketMap.get(label)?.outstandingAmount ?? 0),
    })),
    totalInvoices: rows.length,
    totalOutstanding: formatMoney(rows.reduce((sum, row) => sum + parseNumber(row.outstandingAmount), 0)),
  };
}

function buildPipelineSummary(dataset: ScopedDataset): PipelineStageDto[] {
  const stats = new Map<string, { count: number; totalValue: number }>();
  for (const order of dataset.orderRows) {
    const current = stats.get(order.status) ?? { count: 0, totalValue: 0 };
    current.count += 1;
    for (const item of dataset.itemsByOrder.get(order.orderId) ?? []) {
      current.totalValue += calculateRevenueBase(item);
    }
    stats.set(order.status, current);
  }

  return Array.from(stats.entries()).map(([status, values]) => ({
    status,
    count: values.count,
    totalValue: formatMoney(values.totalValue),
  }));
}

async function buildLossAnalysisFromDb(tenantId: string, context: ReportAccessContext, filters: ReportFiltersDto): Promise<LossAnalysisResponseDto> {
  const normalized = normalizeReportFilters(filters, context);
  const conditions = [eq(orders.tenantId, tenantId), eq(orders.status, 'CANCELLED'), isNotNull(orders.lossReason)];
  if (normalized.from) conditions.push(gte(orders.createdAt, new Date(`${normalized.from}T00:00:00`)));
  if (normalized.to) conditions.push(lte(orders.createdAt, new Date(`${normalized.to}T23:59:59`)));
  if (context.userIds) conditions.push(inArray(orders.salesRepId, context.userIds));
  if (normalized.traderId) conditions.push(eq(orders.salesRepId, normalized.traderId));
  if (normalized.customerId) conditions.push(eq(orders.clientId, normalized.customerId));

  const rows = await db
    .select({ reason: orders.lossReason, count: sql<number>`count(*)::int`.as('count') })
    .from(orders)
    .where(and(...conditions))
    .groupBy(orders.lossReason)
    .orderBy(sql`count(*) desc`);

  const totalCancelled = rows.reduce((sum, row) => sum + Number(row.count), 0);
  return {
    totalCancelled,
    reasons: rows.map((row) => ({
      reason: row.reason ?? 'Unknown',
      count: Number(row.count),
      percentage: formatPercentValue(Number(row.count), totalCancelled),
    })),
  };
}

function buildConversionMetrics(dataset: ScopedDataset): ConversionMetricsDto {
  const wonStatuses = new Set(['CONFIRMED', 'DELIVERED', 'INVOICED', 'PAID']);
  let totalWon = 0;
  let totalLost = 0;
  let closeDaysSum = 0;
  let closeDaysCount = 0;

  for (const order of dataset.orderRows) {
    if (wonStatuses.has(order.status)) {
      totalWon += 1;
      if (order.closedAt) {
        closeDaysSum += (new Date(order.closedAt).getTime() - new Date(order.createdAt).getTime()) / 86_400_000;
        closeDaysCount += 1;
      }
    } else if (order.status === 'CANCELLED') {
      totalLost += 1;
    }
  }

  return {
    totalInquiries: dataset.orderRows.length,
    totalWon,
    totalLost,
    winRate: formatPercentValue(totalWon, totalWon + totalLost),
    avgDaysToClose: closeDaysCount > 0 ? Number((closeDaysSum / closeDaysCount).toFixed(1)) : null,
  };
}

async function buildCommercialSummary(
  tenantId: string,
  context: ReportAccessContext,
  filters: ReportFiltersDto,
  dataset: ScopedDataset,
): Promise<CommercialSummaryReportDto> {
  const lossAnalysis = await buildLossAnalysisFromDb(tenantId, context, filters);
  return {
    conversion: buildConversionMetrics(dataset),
    lossAnalysis,
    pipeline: buildPipelineSummary(dataset),
  };
}

function accumulateMarginRow(
  map: Map<string, { row: MarginAnalysisRowDto; revenue: number; netProfit: number }>,
  key: string,
  label: string,
  values: { orderCount?: number; quantity: number; revenue: number; grossProfit: number; financingCost: number; netProfit: number },
) {
  const current = map.get(key) ?? {
    row: {
      key,
      label,
      orderCount: 0,
      totalVolume: '0.000',
      totalRevenue: '0.00',
      totalGrossProfit: '0.00',
      totalFinancingCost: '0.00',
      totalNetProfit: '0.00',
      netMarginPct: null,
    },
    revenue: 0,
    netProfit: 0,
  };

  current.row.orderCount += values.orderCount ?? 0;
  current.row.totalVolume = formatQuantity(parseNumber(current.row.totalVolume) + values.quantity);
  current.revenue += values.revenue;
  current.netProfit += values.netProfit;
  current.row.totalRevenue = formatMoney(current.revenue);
  current.row.totalGrossProfit = formatMoney(parseNumber(current.row.totalGrossProfit) + values.grossProfit);
  current.row.totalFinancingCost = formatMoney(parseNumber(current.row.totalFinancingCost) + values.financingCost);
  current.row.totalNetProfit = formatMoney(current.netProfit);
  current.row.netMarginPct = current.revenue > 0 ? Number(((current.netProfit / current.revenue) * 100).toFixed(2)) : null;
  map.set(key, current);
}

function buildMarginAnalysis(dataset: ScopedDataset): MarginAnalysisReportDto {
  const economicsByOrder = buildEconomicsByOrder(dataset);
  const byCustomer = new Map<string, { row: MarginAnalysisRowDto; revenue: number; netProfit: number }>();
  const byProduct = new Map<string, { row: MarginAnalysisRowDto; revenue: number; netProfit: number }>();
  const byVessel = new Map<string, { row: MarginAnalysisRowDto; revenue: number; netProfit: number }>();
  const monthlyTrend = new Map<string, { revenue: number; netProfit: number; orderCount: number }>();

  for (const order of dataset.orderRows) {
    const economics = economicsByOrder.get(order.orderId);
    if (!economics) continue;

    accumulateMarginRow(byCustomer, order.clientId, order.clientName, {
      orderCount: 1,
      quantity: economics.totalQuantity,
      revenue: economics.totalRevenueBase,
      grossProfit: economics.totalGrossProfit,
      financingCost: economics.totalFinancingCost,
      netProfit: economics.totalNetProfit,
    });

    accumulateMarginRow(byVessel, order.vesselId, order.vesselName, {
      orderCount: 1,
      quantity: economics.totalQuantity,
      revenue: economics.totalRevenueBase,
      grossProfit: economics.totalGrossProfit,
      financingCost: economics.totalFinancingCost,
      netProfit: economics.totalNetProfit,
    });

    const trendKey = monthKey(order.createdAt);
    const currentTrend = monthlyTrend.get(trendKey) ?? { revenue: 0, netProfit: 0, orderCount: 0 };
    currentTrend.orderCount += 1;
    currentTrend.revenue += economics.totalRevenueBase;
    currentTrend.netProfit += economics.totalNetProfit;
    monthlyTrend.set(trendKey, currentTrend);

    const items = dataset.itemsByOrder.get(order.orderId) ?? [];
    economics.lineEconomics.forEach((line, index) => {
      const item = items[index];
      if (!item) return;
      accumulateMarginRow(byProduct, item.productType, item.productType, {
        quantity: line.quantity,
        revenue: line.revenueBase,
        grossProfit: line.grossProfit,
        financingCost: line.financingCost,
        netProfit: line.netProfit,
      });
    });
  }

  const sortRows = (rows: Map<string, { row: MarginAnalysisRowDto }>) => Array.from(rows.values())
    .map((entry) => entry.row)
    .sort((left, right) => parseNumber(right.totalNetProfit) - parseNumber(left.totalNetProfit));

  const trendRows: MarginTrendPointDto[] = Array.from(monthlyTrend.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, values]) => ({
      month,
      orderCount: values.orderCount,
      totalRevenue: formatMoney(values.revenue),
      totalNetProfit: formatMoney(values.netProfit),
      netMarginPct: values.revenue > 0 ? Number(((values.netProfit / values.revenue) * 100).toFixed(2)) : null,
    }));

  return {
    byCustomer: sortRows(byCustomer),
    byProduct: sortRows(byProduct),
    byVessel: sortRows(byVessel),
    monthlyTrend: trendRows,
  };
}

async function buildFilterOptions(tenantId: string, context: ReportAccessContext): Promise<ReportFilterOptionsDto> {
  const userConditions = [eq(users.tenantId, tenantId), eq(users.isActive, true)];
  if (context.userIds) userConditions.push(inArray(users.id, context.userIds));

  const [traderRows, teamRows, customerRows, productRows] = await Promise.all([
    db.select({ id: users.id, label: users.name, subtitle: users.email }).from(users).where(and(...userConditions)).orderBy(asc(users.name)),
    context.teamId
      ? db.select({ id: teams.id, label: teams.name }).from(teams).where(eq(teams.id, context.teamId)).orderBy(asc(teams.name))
      : db.select({ id: teams.id, label: teams.name }).from(teams).where(eq(teams.tenantId, tenantId)).orderBy(asc(teams.name)),
    db.select({ id: counterparties.id, label: counterparties.name }).from(counterparties).where(eq(counterparties.tenantId, tenantId)).orderBy(asc(counterparties.name)),
    db.selectDistinct({ id: orderItems.productType, label: orderItems.productType }).from(orderItems).orderBy(asc(orderItems.productType)),
  ]);

  return {
    traders: traderRows,
    teams: teamRows,
    customers: customerRows,
    products: productRows,
  };
}

function mapSavedViews(settings: StoredReportSettings): SavedReportViewDto[] {
  return (settings.savedViews ?? []).map((view) => ({
    id: view.id,
    name: view.name,
    description: view.description ?? null,
    filters: view.filters ?? {},
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    createdByName: view.createdByName ?? null,
  }));
}

function mapSchedules(settings: StoredReportSettings): ReportScheduleDto[] {
  return (settings.schedules ?? []).map((schedule) => ({
    id: schedule.id,
    name: schedule.name,
    description: schedule.description ?? null,
    reportMode: normalizeScheduleMode(schedule.reportMode),
    reportType: schedule.reportType,
    deliveryMode: normalizeDeliveryMode(schedule.deliveryMode),
    bodyMode: resolveScheduleBodyMode(schedule.deliveryMode, schedule.bodyMode),
    hourUtc: schedule.hourUtc,
    recipientRoles: (schedule.recipientRoles ?? []) as Role[],
    extraEmails: schedule.extraEmails ?? [],
    exceptionTypes: normalizeExceptionTypes(schedule.exceptionTypes as ReportExceptionType[] | undefined),
    sendOnlyWhenNonEmpty: schedule.sendOnlyWhenNonEmpty ?? false,
    filters: schedule.filters ?? {},
    isActive: schedule.isActive ?? true,
    lastSentAt: schedule.lastSentAt ?? null,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
  }));
}

async function buildVariance(
  tenantId: string,
  context: ReportAccessContext,
  currentFilters: ReportFiltersDto,
  current: {
    traderPerformance: TraderPerformanceReportDto;
    invoiceAging: InvoiceAgingReportDto;
    commercialSummary: CommercialSummaryReportDto;
    marginAnalysis: MarginAnalysisReportDto;
  },
  comparisonMode?: ReportComparisonMode | null,
): Promise<ReportsVarianceDto> {
  const comparison = buildComparisonWindow(currentFilters, comparisonMode);
  if (!comparison || !comparison.previousFrom || !comparison.previousTo) return emptyVariance();

  const previousFilters: ReportFiltersDto = {
    ...currentFilters,
    from: comparison.previousFrom,
    to: comparison.previousTo,
  };
  const previousDataset = await fetchScopedDataset(tenantId, context, previousFilters);
  const [previousInvoiceAging, previousCommercialSummary] = await Promise.all([
    buildInvoiceAgingReport(tenantId, context, previousDataset.filtersApplied, previousDataset),
    buildCommercialSummary(tenantId, context, previousDataset.filtersApplied, previousDataset),
  ]);
  const previousTraderPerformance = buildTraderPerformanceReport(previousDataset);
  const previousMarginAnalysis = buildMarginAnalysis(previousDataset);

  return {
    comparison,
    summary: {
      totalRevenue: buildVarianceValue(
        parseNumber(current.traderPerformance.totals.totalRevenue),
        parseNumber(previousTraderPerformance.totals.totalRevenue),
        formatMoney,
      ),
      totalNetProfit: buildVarianceValue(
        parseNumber(current.traderPerformance.totals.totalNetProfit),
        parseNumber(previousTraderPerformance.totals.totalNetProfit),
        formatMoney,
      ),
      totalOutstanding: buildVarianceValue(
        parseNumber(current.invoiceAging.totalOutstanding),
        parseNumber(previousInvoiceAging.totalOutstanding),
        formatMoney,
      ),
      winRate: buildVarianceValue(
        current.commercialSummary.conversion.winRate * 100,
        previousCommercialSummary.conversion.winRate * 100,
        (value) => value.toFixed(1),
      ),
      avgDealSize: buildVarianceValue(
        parseNumber(current.traderPerformance.totals.avgDealSize),
        parseNumber(previousTraderPerformance.totals.avgDealSize),
        formatMoney,
      ),
    },
    topTraderMovers: buildVarianceRows(
      current.traderPerformance.rows.map((row) => ({ key: row.traderId, label: row.traderName, value: parseNumber(row.totalNetProfit) })),
      previousTraderPerformance.rows.map((row) => ({ key: row.traderId, label: row.traderName, value: parseNumber(row.totalNetProfit) })),
    ),
    topCustomerMovers: buildVarianceRows(
      current.marginAnalysis.byCustomer.map((row) => ({ key: row.key, label: row.label, value: parseNumber(row.totalNetProfit) })),
      previousMarginAnalysis.byCustomer.map((row) => ({ key: row.key, label: row.label, value: parseNumber(row.totalNetProfit) })),
    ),
    topProductMovers: buildVarianceRows(
      current.marginAnalysis.byProduct.map((row) => ({ key: row.key, label: row.label, value: parseNumber(row.totalNetProfit) })),
      previousMarginAnalysis.byProduct.map((row) => ({ key: row.key, label: row.label, value: parseNumber(row.totalNetProfit) })),
    ),
  };
}

function buildExceptions(
  dataset: ScopedDataset,
  invoiceAging: InvoiceAgingReportDto,
  marginAnalysis: MarginAnalysisReportDto,
): ReportsExceptionsDto {
  const economicsByOrder = buildEconomicsByOrder(dataset);
  const rows: ReportExceptionRowDto[] = [];

  for (const order of dataset.orderRows) {
    const economics = economicsByOrder.get(order.orderId);
    if (!economics || economics.totalNetProfit >= 0) continue;
    rows.push({
      type: 'NEGATIVE_NET_PROFIT_ORDER',
      severity: 'HIGH',
      entityType: 'order',
      entityId: order.orderId,
      title: `${order.clientName} / ${order.vesselName}`,
      description: `${order.traderName} order is running at a negative net profit.`,
      primaryValue: formatMoney(economics.totalNetProfit),
      secondaryValue: `${formatMoney(economics.totalRevenueBase)} revenue`,
    });
  }

  for (const invoice of invoiceAging.rows) {
    if (invoice.daysOverdue < 61) continue;
    rows.push({
      type: 'SEVERELY_OVERDUE_INVOICE',
      severity: invoice.daysOverdue >= 90 ? 'HIGH' : 'MEDIUM',
      entityType: 'invoice',
      entityId: invoice.invoiceId,
      title: invoice.invoiceNumber,
      description: `${invoice.clientName} is ${invoice.daysOverdue} days overdue.`,
      primaryValue: invoice.outstandingAmount,
      secondaryValue: invoice.agingBucket,
    });
  }

  for (const customer of marginAnalysis.byCustomer) {
    if (customer.netMarginPct === null || customer.netMarginPct >= 5 || parseNumber(customer.totalRevenue) < 1000) continue;
    rows.push({
      type: 'LOW_MARGIN_CUSTOMER',
      severity: customer.netMarginPct < 2 ? 'HIGH' : 'MEDIUM',
      entityType: 'customer',
      entityId: customer.key,
      title: customer.label,
      description: 'Customer margin is below the operating threshold.',
      primaryValue: `${customer.netMarginPct.toFixed(1)}%`,
      secondaryValue: `${customer.totalRevenue} revenue`,
    });
  }

  const byTypeMap = new Map<ReportExceptionType, number>();
  for (const row of rows) {
    byTypeMap.set(row.type, (byTypeMap.get(row.type) ?? 0) + 1);
  }

  return {
    totalCount: rows.length,
    byType: Array.from(byTypeMap.entries()).map(([type, count]) => ({ type, count })),
    rows: rows.sort((left, right) => {
      const severityDelta = (left.severity === 'HIGH' ? 1 : 0) - (right.severity === 'HIGH' ? 1 : 0);
      if (severityDelta !== 0) return severityDelta > 0 ? -1 : 1;
      return left.title.localeCompare(right.title);
    }).slice(0, 25),
  };
}

export async function getReleaseOneReports(
  tenantId: string,
  requestingUserId: string,
  filters: ReportFiltersDto,
): Promise<ReleaseOneReportsDto> {
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

export async function getReleaseTwoReports(
  tenantId: string,
  requestingUserId: string,
  filters: ReportsQueryInput,
): Promise<ReleaseTwoReportsDto> {
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
  const variance = await buildVariance(tenantId, context, dataset.filtersApplied, {
    traderPerformance,
    invoiceAging,
    commercialSummary,
    marginAnalysis,
  }, filters.comparisonMode);
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

export async function createSavedReportView(
  tenantId: string,
  requestingUserId: string,
  userName: string | null,
  input: { name: string; description?: string | null; filters?: ReportFiltersDto },
): Promise<SavedReportViewDto[]> {
  const context = await resolveReportAccessContext(tenantId, requestingUserId);
  assertCanManageSharedViews(context);
  const now = new Date().toISOString();
  const filters = normalizeReportFilters(input.filters ?? {}, context);
  const settings = await updateTenantReportSettings(tenantId, (current) => ({
    ...current,
    savedViews: [
      {
        id: crypto.randomUUID(),
        name: input.name.trim(),
        description: input.description?.trim() || null,
        filters,
        createdAt: now,
        updatedAt: now,
        createdByName: userName,
      },
      ...(current.savedViews ?? []),
    ],
  }));

  const createdView = settings.savedViews?.[0];
  if (createdView) {
    await logReportConfigActivity({
      tenantId,
      userId: requestingUserId,
      action: 'CREATE',
      entityType: 'report_saved_view',
      entityId: createdView.id,
      entityName: createdView.name,
      httpMethod: 'POST',
      httpPath: '/reports/saved-views',
      metadata: {
        name: createdView.name,
        description: createdView.description ?? null,
        filters: createdView.filters ?? {},
      },
    });
  }

  return mapSavedViews(settings);
}

export async function updateSavedReportView(
  tenantId: string,
  requestingUserId: string,
  savedViewId: string,
  input: { name: string; description?: string | null; filters?: ReportFiltersDto },
): Promise<SavedReportViewDto[]> {
  const context = await resolveReportAccessContext(tenantId, requestingUserId);
  assertCanManageSharedViews(context);
  const now = new Date().toISOString();
  const filters = normalizeReportFilters(input.filters ?? {}, context);

  const settings = await updateTenantReportSettings(tenantId, (current) => ({
    ...current,
    savedViews: (current.savedViews ?? []).map((view) => view.id === savedViewId
      ? {
          ...view,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          filters,
          updatedAt: now,
        }
      : view),
  }));

  const updatedView = settings.savedViews?.find((view) => view.id === savedViewId);
  if (!updatedView) throw new Error('Saved view not found');

  await logReportConfigActivity({
    tenantId,
    userId: requestingUserId,
    action: 'UPDATE',
    entityType: 'report_saved_view',
    entityId: updatedView.id,
    entityName: updatedView.name,
    httpMethod: 'PATCH',
    httpPath: `/reports/saved-views/${savedViewId}`,
    metadata: {
      name: updatedView.name,
      description: updatedView.description ?? null,
      filters: updatedView.filters ?? {},
    },
  });

  return mapSavedViews(settings);
}

export async function deleteSavedReportView(
  tenantId: string,
  requestingUserId: string,
  savedViewId: string,
): Promise<SavedReportViewDto[]> {
  const context = await resolveReportAccessContext(tenantId, requestingUserId);
  assertCanManageSharedViews(context);
  const tenant = await getTenantSettingsRow(tenantId);
  const existingView = normalizeReportSettings(((tenant.settings ?? {}) as TenantSettings).reportsSettings)
    .savedViews
    ?.find((view) => view.id === savedViewId);
  const settings = await updateTenantReportSettings(tenantId, (current) => ({
    ...current,
    savedViews: (current.savedViews ?? []).filter((view) => view.id !== savedViewId),
  }));

  if (!existingView) throw new Error('Saved view not found');

  await logReportConfigActivity({
    tenantId,
    userId: requestingUserId,
    action: 'DELETE',
    entityType: 'report_saved_view',
    entityId: existingView.id,
    entityName: existingView.name,
    httpMethod: 'DELETE',
    httpPath: `/reports/saved-views/${savedViewId}`,
    metadata: {
      name: existingView.name,
      description: existingView.description ?? null,
      filters: existingView.filters ?? {},
    },
  });

  return mapSavedViews(settings);
}

export async function createReportSchedule(
  tenantId: string,
  requestingUserId: string,
  input: {
    name: string;
    description?: string | null;
    reportMode?: ReportScheduleMode;
    reportType: ReportScheduleType;
    deliveryMode?: ReportScheduleDeliveryMode;
    bodyMode?: ReportScheduleBodyMode;
    hourUtc: number;
    recipientRoles: Role[];
    extraEmails?: string[];
    exceptionTypes?: ReportExceptionType[];
    sendOnlyWhenNonEmpty?: boolean;
    filters?: ReportFiltersDto;
  },
): Promise<ReportScheduleDto[]> {
  const context = await resolveReportAccessContext(tenantId, requestingUserId);
  assertCanManageSchedules(context);
  const now = new Date().toISOString();
  const filters = normalizeReportFilters(input.filters ?? {}, context);
  const settings = await updateTenantReportSettings(tenantId, (current) => ({
    ...current,
    schedules: [
      {
        id: crypto.randomUUID(),
        name: input.name.trim(),
        description: input.description?.trim() || null,
        reportMode: normalizeScheduleMode(input.reportMode),
        reportType: input.reportType,
        deliveryMode: normalizeDeliveryMode(input.deliveryMode),
        bodyMode: resolveScheduleBodyMode(input.deliveryMode, input.bodyMode),
        hourUtc: Math.max(0, Math.min(23, Math.round(input.hourUtc))),
        recipientRoles: normalizeScheduleRecipientRoles(input.recipientRoles),
        extraEmails: normalizeExtraEmails(input.extraEmails),
        exceptionTypes: normalizeExceptionTypes(input.exceptionTypes),
        sendOnlyWhenNonEmpty: input.sendOnlyWhenNonEmpty ?? false,
        filters,
        isActive: true,
        lastSentAt: null,
        createdAt: now,
        updatedAt: now,
      },
      ...(current.schedules ?? []),
    ],
  }));

  const createdSchedule = settings.schedules?.[0];
  if (createdSchedule) {
    await logReportConfigActivity({
      tenantId,
      userId: requestingUserId,
      action: 'CREATE',
      entityType: 'report_schedule',
      entityId: createdSchedule.id,
      entityName: createdSchedule.name,
      httpMethod: 'POST',
      httpPath: '/reports/schedules',
      metadata: {
        reportMode: normalizeScheduleMode(createdSchedule.reportMode),
        reportType: createdSchedule.reportType,
        deliveryMode: normalizeDeliveryMode(createdSchedule.deliveryMode),
        bodyMode: resolveScheduleBodyMode(createdSchedule.deliveryMode, createdSchedule.bodyMode),
        hourUtc: createdSchedule.hourUtc,
        recipientRoles: createdSchedule.recipientRoles,
        extraEmails: createdSchedule.extraEmails ?? [],
        exceptionTypes: createdSchedule.exceptionTypes ?? [],
        sendOnlyWhenNonEmpty: createdSchedule.sendOnlyWhenNonEmpty ?? false,
      },
    });
  }

  return mapSchedules(settings);
}

export async function updateReportSchedule(
  tenantId: string,
  requestingUserId: string,
  scheduleId: string,
  input: {
    name: string;
    description?: string | null;
    reportMode?: ReportScheduleMode;
    reportType: ReportScheduleType;
    deliveryMode?: ReportScheduleDeliveryMode;
    bodyMode?: ReportScheduleBodyMode;
    hourUtc: number;
    recipientRoles: Role[];
    extraEmails?: string[];
    exceptionTypes?: ReportExceptionType[];
    sendOnlyWhenNonEmpty?: boolean;
    filters?: ReportFiltersDto;
    isActive?: boolean;
  },
): Promise<ReportScheduleDto[]> {
  const context = await resolveReportAccessContext(tenantId, requestingUserId);
  assertCanManageSchedules(context);
  const now = new Date().toISOString();
  const filters = normalizeReportFilters(input.filters ?? {}, context);

  const settings = await updateTenantReportSettings(tenantId, (current) => ({
    ...current,
    schedules: (current.schedules ?? []).map((schedule) => schedule.id === scheduleId
      ? {
          ...schedule,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          reportMode: normalizeScheduleMode(input.reportMode ?? schedule.reportMode),
          reportType: input.reportType,
          deliveryMode: normalizeDeliveryMode(input.deliveryMode),
          bodyMode: resolveScheduleBodyMode(input.deliveryMode, input.bodyMode),
          hourUtc: Math.max(0, Math.min(23, Math.round(input.hourUtc))),
          recipientRoles: normalizeScheduleRecipientRoles(input.recipientRoles),
          extraEmails: normalizeExtraEmails(input.extraEmails),
          exceptionTypes: normalizeExceptionTypes(input.exceptionTypes ?? schedule.exceptionTypes),
          sendOnlyWhenNonEmpty: input.sendOnlyWhenNonEmpty ?? schedule.sendOnlyWhenNonEmpty ?? false,
          filters,
          isActive: input.isActive ?? schedule.isActive ?? true,
          updatedAt: now,
        }
      : schedule),
  }));

  const updatedSchedule = settings.schedules?.find((schedule) => schedule.id === scheduleId);
  if (!updatedSchedule) throw new Error('Schedule not found');

  await logReportConfigActivity({
    tenantId,
    userId: requestingUserId,
    action: 'UPDATE',
    entityType: 'report_schedule',
    entityId: updatedSchedule.id,
    entityName: updatedSchedule.name,
    httpMethod: 'PATCH',
    httpPath: `/reports/schedules/${scheduleId}`,
    metadata: {
      reportMode: normalizeScheduleMode(updatedSchedule.reportMode),
      reportType: updatedSchedule.reportType,
      deliveryMode: normalizeDeliveryMode(updatedSchedule.deliveryMode),
      bodyMode: resolveScheduleBodyMode(updatedSchedule.deliveryMode, updatedSchedule.bodyMode),
      hourUtc: updatedSchedule.hourUtc,
      recipientRoles: updatedSchedule.recipientRoles,
      extraEmails: updatedSchedule.extraEmails ?? [],
      exceptionTypes: updatedSchedule.exceptionTypes ?? [],
      sendOnlyWhenNonEmpty: updatedSchedule.sendOnlyWhenNonEmpty ?? false,
      isActive: updatedSchedule.isActive ?? true,
    },
  });

  return mapSchedules(settings);
}

export async function deleteReportSchedule(
  tenantId: string,
  requestingUserId: string,
  scheduleId: string,
): Promise<ReportScheduleDto[]> {
  const context = await resolveReportAccessContext(tenantId, requestingUserId);
  assertCanManageSchedules(context);
  const tenant = await getTenantSettingsRow(tenantId);
  const existingSchedule = normalizeReportSettings(((tenant.settings ?? {}) as TenantSettings).reportsSettings)
    .schedules
    ?.find((schedule) => schedule.id === scheduleId);
  const settings = await updateTenantReportSettings(tenantId, (current) => ({
    ...current,
    schedules: (current.schedules ?? []).filter((schedule) => schedule.id !== scheduleId),
  }));

  if (!existingSchedule) throw new Error('Schedule not found');

  await logReportConfigActivity({
    tenantId,
    userId: requestingUserId,
    action: 'DELETE',
    entityType: 'report_schedule',
    entityId: existingSchedule.id,
    entityName: existingSchedule.name,
    httpMethod: 'DELETE',
    httpPath: `/reports/schedules/${scheduleId}`,
    metadata: {
      reportMode: normalizeScheduleMode(existingSchedule.reportMode),
      reportType: existingSchedule.reportType,
      deliveryMode: normalizeDeliveryMode(existingSchedule.deliveryMode),
      bodyMode: resolveScheduleBodyMode(existingSchedule.deliveryMode, existingSchedule.bodyMode),
      hourUtc: existingSchedule.hourUtc,
      recipientRoles: existingSchedule.recipientRoles,
      extraEmails: existingSchedule.extraEmails ?? [],
      exceptionTypes: existingSchedule.exceptionTypes ?? [],
      sendOnlyWhenNonEmpty: existingSchedule.sendOnlyWhenNonEmpty ?? false,
    },
  });

  return mapSchedules(settings);
}

export async function exportTraderPerformanceCsv(
  tenantId: string,
  requestingUserId: string,
  filters: ReportFiltersDto,
): Promise<{ fileName: string; csv: string }> {
  const report = await getReleaseTwoReports(tenantId, requestingUserId, filters);
  const csv = buildCsv([
    ['Trader', 'Team', 'Orders', 'Won', 'Lost', 'Win Rate %', 'Volume', 'Revenue USD', 'Gross Profit USD', 'Financing Cost USD', 'Net Profit USD', 'Avg Deal Size USD'],
    ...report.traderPerformance.rows.map((row) => [
      row.traderName,
      row.teamName,
      row.orderCount,
      row.wonCount,
      row.lostCount,
      (row.winRate * 100).toFixed(1),
      row.totalVolume,
      row.totalRevenue,
      row.totalGrossProfit,
      row.totalFinancingCost,
      row.totalNetProfit,
      row.avgDealSize,
    ]),
    [],
    ['TOTAL', '', report.traderPerformance.totals.orderCount, report.traderPerformance.totals.wonCount, report.traderPerformance.totals.lostCount, (report.traderPerformance.totals.winRate * 100).toFixed(1), report.traderPerformance.totals.totalVolume, report.traderPerformance.totals.totalRevenue, report.traderPerformance.totals.totalGrossProfit, report.traderPerformance.totals.totalFinancingCost, report.traderPerformance.totals.totalNetProfit, report.traderPerformance.totals.avgDealSize],
  ]);

  return { fileName: `trader-performance_${buildFileSuffix(report.filtersApplied)}.csv`, csv };
}

export async function exportInvoiceAgingCsv(
  tenantId: string,
  requestingUserId: string,
  filters: ReportFiltersDto,
): Promise<{ fileName: string; csv: string }> {
  const report = await getReleaseTwoReports(tenantId, requestingUserId, filters);
  const csv = buildCsv([
    ['Invoice', 'Client', 'Vessel', 'Trader', 'Due Date', 'Status', 'Amount USD', 'Paid USD', 'Outstanding USD', 'Days Overdue', 'Bucket'],
    ...report.invoiceAging.rows.map((row) => [row.invoiceNumber, row.clientName, row.vesselName, row.traderName, row.dueDate, row.status, row.amount, row.amountPaid, row.outstandingAmount, row.daysOverdue, row.agingBucket]),
    [],
    ['BUCKET', 'COUNT', 'OUTSTANDING USD'],
    ...report.invoiceAging.buckets.map((bucket) => [bucket.label, bucket.count, bucket.outstandingAmount]),
    [],
    ['TOTAL OPEN INVOICES', report.invoiceAging.totalInvoices, report.invoiceAging.totalOutstanding],
  ]);

  return { fileName: `invoice-aging_${buildFileSuffix(report.filtersApplied)}.csv`, csv };
}

export async function exportCommercialSummaryCsv(
  tenantId: string,
  requestingUserId: string,
  filters: ReportFiltersDto,
): Promise<{ fileName: string; csv: string }> {
  const report = await getReleaseTwoReports(tenantId, requestingUserId, filters);
  const csv = buildCsv([
    ['METRIC', 'VALUE'],
    ['Total Inquiries', report.commercialSummary.conversion.totalInquiries],
    ['Won', report.commercialSummary.conversion.totalWon],
    ['Lost', report.commercialSummary.conversion.totalLost],
    ['Win Rate %', (report.commercialSummary.conversion.winRate * 100).toFixed(1)],
    ['Avg Days To Close', report.commercialSummary.conversion.avgDaysToClose ?? ''],
    [],
    ['LOSS REASON', 'COUNT', 'PERCENTAGE'],
    ...report.commercialSummary.lossAnalysis.reasons.map((reason) => [reason.reason, reason.count, (reason.percentage * 100).toFixed(1)]),
    [],
    ['PIPELINE STATUS', 'COUNT', 'VALUE USD'],
    ...report.commercialSummary.pipeline.map((stage) => [stage.status, stage.count, stage.totalValue]),
  ]);

  return { fileName: `commercial-summary_${buildFileSuffix(report.filtersApplied)}.csv`, csv };
}

export async function exportMarginAnalysisCsv(
  tenantId: string,
  requestingUserId: string,
  filters: ReportFiltersDto,
): Promise<{ fileName: string; csv: string }> {
  const report = await getReleaseTwoReports(tenantId, requestingUserId, filters);
  const section = (title: string, rows: MarginAnalysisRowDto[]) => [
    [title],
    ['Label', 'Orders', 'Volume', 'Revenue USD', 'Gross Profit USD', 'Financing Cost USD', 'Net Profit USD', 'Net Margin %'],
    ...rows.map((row) => [row.label, row.orderCount, row.totalVolume, row.totalRevenue, row.totalGrossProfit, row.totalFinancingCost, row.totalNetProfit, row.netMarginPct ?? '']),
    [],
  ];
  const csv = buildCsv([
    ...section('BY CUSTOMER', report.marginAnalysis.byCustomer),
    ...section('BY PRODUCT', report.marginAnalysis.byProduct),
    ...section('BY VESSEL', report.marginAnalysis.byVessel),
    ['MONTH', 'ORDERS', 'REVENUE USD', 'NET PROFIT USD', 'NET MARGIN %'],
    ...report.marginAnalysis.monthlyTrend.map((point) => [point.month, point.orderCount, point.totalRevenue, point.totalNetProfit, point.netMarginPct ?? '']),
  ]);
  return { fileName: `margin-analysis_${buildFileSuffix(report.filtersApplied)}.csv`, csv };
}

export async function exportTraderPerformanceXlsx(
  tenantId: string,
  requestingUserId: string,
  filters: ReportFiltersDto,
): Promise<{ fileName: string; content: Buffer }> {
  const report = await getReleaseTwoReports(tenantId, requestingUserId, filters);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.traderPerformance.rows.map((row) => ({
    Trader: row.traderName,
    Team: row.teamName,
    Orders: row.orderCount,
    Won: row.wonCount,
    Lost: row.lostCount,
    'Win Rate %': Number((row.winRate * 100).toFixed(1)),
    Volume: Number(row.totalVolume),
    'Revenue USD': Number(row.totalRevenue),
    'Gross Profit USD': Number(row.totalGrossProfit),
    'Financing Cost USD': Number(row.totalFinancingCost),
    'Net Profit USD': Number(row.totalNetProfit),
    'Avg Deal Size USD': Number(row.avgDealSize),
  }))), 'Trader Performance');

  return {
    fileName: `trader-performance_${buildFileSuffix(report.filtersApplied)}.xlsx`,
    content: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
  };
}

export async function exportInvoiceAgingXlsx(
  tenantId: string,
  requestingUserId: string,
  filters: ReportFiltersDto,
): Promise<{ fileName: string; content: Buffer }> {
  const report = await getReleaseTwoReports(tenantId, requestingUserId, filters);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.invoiceAging.rows.map((row) => ({
    Invoice: row.invoiceNumber,
    Client: row.clientName,
    Vessel: row.vesselName,
    Trader: row.traderName,
    'Due Date': row.dueDate,
    Status: row.status,
    'Amount USD': Number(row.amount),
    'Paid USD': Number(row.amountPaid),
    'Outstanding USD': Number(row.outstandingAmount),
    'Days Overdue': row.daysOverdue,
    Bucket: row.agingBucket,
  }))), 'Invoice Aging');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.invoiceAging.buckets.map((bucket) => ({
    Bucket: bucket.label,
    Count: bucket.count,
    'Outstanding USD': Number(bucket.outstandingAmount),
  }))), 'Buckets');

  return {
    fileName: `invoice-aging_${buildFileSuffix(report.filtersApplied)}.xlsx`,
    content: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
  };
}

export async function exportCommercialSummaryXlsx(
  tenantId: string,
  requestingUserId: string,
  filters: ReportFiltersDto,
): Promise<{ fileName: string; content: Buffer }> {
  const report = await getReleaseTwoReports(tenantId, requestingUserId, filters);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Metric', 'Value'],
    ['Total Inquiries', report.commercialSummary.conversion.totalInquiries],
    ['Won', report.commercialSummary.conversion.totalWon],
    ['Lost', report.commercialSummary.conversion.totalLost],
    ['Win Rate %', Number((report.commercialSummary.conversion.winRate * 100).toFixed(1))],
    ['Avg Days To Close', report.commercialSummary.conversion.avgDaysToClose ?? ''],
  ]), 'Conversion');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.commercialSummary.lossAnalysis.reasons.map((row) => ({
    Reason: row.reason,
    Count: row.count,
    'Percentage %': Number((row.percentage * 100).toFixed(1)),
  }))), 'Loss Reasons');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.commercialSummary.pipeline.map((row) => ({
    Status: row.status,
    Count: row.count,
    'Value USD': Number(row.totalValue),
  }))), 'Pipeline');

  return {
    fileName: `commercial-summary_${buildFileSuffix(report.filtersApplied)}.xlsx`,
    content: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
  };
}

export async function exportMarginAnalysisXlsx(
  tenantId: string,
  requestingUserId: string,
  filters: ReportFiltersDto,
): Promise<{ fileName: string; content: Buffer }> {
  const report = await getReleaseTwoReports(tenantId, requestingUserId, filters);
  return {
    fileName: `margin-analysis_${buildFileSuffix(report.filtersApplied)}.xlsx`,
    content: buildMarginWorkbook(report),
  };
}

export async function exportExceptionsCsv(
  tenantId: string,
  requestingUserId: string,
  filters: ReportsQueryInput,
): Promise<{ fileName: string; csv: string }> {
  const report = await getReleaseTwoReports(tenantId, requestingUserId, filters);
  const csv = buildCsv([
    ['Type', 'Severity', 'Title', 'Description', 'Primary Value', 'Secondary Value'],
    ...report.exceptions.rows.map((row) => [row.type, row.severity, row.title, row.description, row.primaryValue, row.secondaryValue ?? '']),
  ]);

  return { fileName: `report-exceptions_${buildFileSuffix(report.filtersApplied)}.csv`, csv };
}

export async function exportExceptionsXlsx(
  tenantId: string,
  requestingUserId: string,
  filters: ReportsQueryInput,
): Promise<{ fileName: string; content: Buffer }> {
  const report = await getReleaseTwoReports(tenantId, requestingUserId, filters);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.exceptions.rows.map((row) => ({
    Type: row.type,
    Severity: row.severity,
    Title: row.title,
    Description: row.description,
    'Primary Value': row.primaryValue,
    'Secondary Value': row.secondaryValue ?? '',
  }))), 'Exceptions');

  return {
    fileName: `report-exceptions_${buildFileSuffix(report.filtersApplied)}.xlsx`,
    content: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
  };
}

function buildOrderDrilldownRows(dataset: ScopedDataset, orderRows: ScopedOrderRow[]): ReportDrilldownOrderRowDto[] {
  const economicsByOrder = buildEconomicsByOrder(dataset);
  return orderRows.map((order) => {
    const economics = economicsByOrder.get(order.orderId);
    return {
      orderId: order.orderId,
      traderId: order.traderId,
      traderName: order.traderName,
      clientId: order.clientId,
      clientName: order.clientName,
      vesselId: order.vesselId,
      vesselName: order.vesselName,
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      totalQuantity: formatQuantity(economics?.totalQuantity ?? 0),
      totalRevenue: formatMoney(economics?.totalRevenueBase ?? 0),
      totalGrossProfit: formatMoney(economics?.totalGrossProfit ?? 0),
      totalFinancingCost: formatMoney(economics?.totalFinancingCost ?? 0),
      totalNetProfit: formatMoney(economics?.totalNetProfit ?? 0),
      netMarginPct: economics?.netMarginPct ?? null,
    };
  }).sort((left, right) => parseNumber(right.totalNetProfit) - parseNumber(left.totalNetProfit));
}

export async function getReportDrilldown(
  tenantId: string,
  requestingUserId: string,
  input: ReportDrilldownInput,
): Promise<ReportDrilldownResponseDto> {
  const context = await resolveReportAccessContext(tenantId, requestingUserId);

  if (input.dimension === 'AGING_BUCKET') {
    const dataset = await fetchScopedDataset(tenantId, context, input);
    const invoiceAging = await buildInvoiceAgingReport(tenantId, context, dataset.filtersApplied, dataset);
    const invoices = invoiceAging.rows.filter((row) => row.agingBucket === input.value);
    return {
      title: `Invoices in ${input.value}`,
      dataset: 'INVOICES',
      target: 'AGING_BUCKET',
      totalCount: invoices.length,
      orders: [],
      invoices,
    };
  }

  const dataset = await fetchScopedDataset(tenantId, context, input);
  const orders = dataset.orderRows.filter((row) => {
    if (input.dimension === 'TRADER') return row.traderId === input.value;
    if (input.dimension === 'CUSTOMER') return row.clientId === input.value;
    if (input.dimension === 'PRODUCT') return (dataset.itemsByOrder.get(row.orderId) ?? []).some((item) => item.productType === input.value);
    return false;
  });

  return {
    title: input.dimension === 'TRADER'
      ? `Orders for ${orders[0]?.traderName ?? input.value}`
      : input.dimension === 'CUSTOMER'
        ? `Orders for ${orders[0]?.clientName ?? input.value}`
        : `Orders for ${input.value}`,
    dataset: 'ORDERS',
    target: input.dimension,
    totalCount: orders.length,
    orders: buildOrderDrilldownRows(dataset, orders),
    invoices: [],
  };
}

function buildSummaryBundleCsv(report: ReleaseTwoReportsDto): string {
  return buildCsv([
    ['TRADER PERFORMANCE'],
    ['Trader', 'Team', 'Orders', 'Won', 'Lost', 'Win Rate %', 'Revenue USD', 'Net Profit USD'],
    ...report.traderPerformance.rows.map((row) => [row.traderName, row.teamName, row.orderCount, row.wonCount, row.lostCount, (row.winRate * 100).toFixed(1), row.totalRevenue, row.totalNetProfit]),
    [],
    ['INVOICE AGING'],
    ['Invoice', 'Client', 'Outstanding USD', 'Days Overdue', 'Bucket'],
    ...report.invoiceAging.rows.map((row) => [row.invoiceNumber, row.clientName, row.outstandingAmount, row.daysOverdue, row.agingBucket]),
    [],
    ['COMMERCIAL SUMMARY'],
    ['Metric', 'Value'],
    ['Total Inquiries', report.commercialSummary.conversion.totalInquiries],
    ['Won', report.commercialSummary.conversion.totalWon],
    ['Lost', report.commercialSummary.conversion.totalLost],
    ['Win Rate %', (report.commercialSummary.conversion.winRate * 100).toFixed(1)],
  ]);
}

function buildSummaryWorkbook(report: ReleaseTwoReportsDto): Buffer {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.traderPerformance.rows.map((row) => ({
    Trader: row.traderName,
    Team: row.teamName,
    Orders: row.orderCount,
    Won: row.wonCount,
    Lost: row.lostCount,
    'Win Rate %': Number((row.winRate * 100).toFixed(1)),
    'Revenue USD': Number(row.totalRevenue),
    'Net Profit USD': Number(row.totalNetProfit),
  }))), 'Trader Performance');

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.invoiceAging.rows.map((row) => ({
    Invoice: row.invoiceNumber,
    Client: row.clientName,
    Trader: row.traderName,
    'Due Date': row.dueDate,
    'Outstanding USD': Number(row.outstandingAmount),
    'Days Overdue': row.daysOverdue,
    Bucket: row.agingBucket,
  }))), 'Invoice Aging');

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Metric', 'Value'],
    ['Total Inquiries', report.commercialSummary.conversion.totalInquiries],
    ['Won', report.commercialSummary.conversion.totalWon],
    ['Lost', report.commercialSummary.conversion.totalLost],
    ['Win Rate %', Number((report.commercialSummary.conversion.winRate * 100).toFixed(1))],
    ['Avg Days To Close', report.commercialSummary.conversion.avgDaysToClose ?? ''],
    [],
    ['Loss Reason', 'Count', 'Percentage'],
    ...report.commercialSummary.lossAnalysis.reasons.map((reason) => [reason.reason, reason.count, Number((reason.percentage * 100).toFixed(1))]),
  ]), 'Commercial Summary');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function buildMarginWorkbook(report: ReleaseTwoReportsDto): Buffer {
  const workbook = XLSX.utils.book_new();
  const toSheetRows = (rows: MarginAnalysisRowDto[]) => rows.map((row) => ({
    Label: row.label,
    Orders: row.orderCount,
    Volume: Number(row.totalVolume),
    'Revenue USD': Number(row.totalRevenue),
    'Gross Profit USD': Number(row.totalGrossProfit),
    'Financing Cost USD': Number(row.totalFinancingCost),
    'Net Profit USD': Number(row.totalNetProfit),
    'Net Margin %': row.netMarginPct ?? '',
  }));

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(toSheetRows(report.marginAnalysis.byCustomer)), 'By Customer');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(toSheetRows(report.marginAnalysis.byProduct)), 'By Product');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(toSheetRows(report.marginAnalysis.byVessel)), 'By Vessel');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.marginAnalysis.monthlyTrend.map((row) => ({
    Month: row.month,
    Orders: row.orderCount,
    'Revenue USD': Number(row.totalRevenue),
    'Net Profit USD': Number(row.totalNetProfit),
    'Net Margin %': row.netMarginPct ?? '',
  }))), 'Monthly Trend');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function buildScheduledAttachments(schedule: ReportScheduleDto, report: ReleaseTwoReportsDto) {
  const suffix = buildFileSuffix(report.filtersApplied);
  const attachments: Array<{ filename: string; content: string | Buffer; contentType: string }> = [];
  const wantsCsv = schedule.deliveryMode === 'CSV' || schedule.deliveryMode === 'CSV_XLSX';
  const wantsXlsx = schedule.deliveryMode === 'XLSX' || schedule.deliveryMode === 'CSV_XLSX';
  const baseName = schedule.reportMode === 'EXCEPTIONS'
    ? 'exceptions'
    : schedule.reportType === 'MARGIN_ANALYSIS'
      ? 'margin-analysis'
      : 'summary';
  const exceptionRows = schedule.exceptionTypes.length > 0
    ? report.exceptions.rows.filter((row) => schedule.exceptionTypes.includes(row.type))
    : report.exceptions.rows;

  if (wantsCsv) {
    attachments.push({
      filename: `${baseName}_${suffix}.csv`,
      content: schedule.reportMode === 'EXCEPTIONS'
        ? buildCsv([
            ['Type', 'Severity', 'Title', 'Description', 'Primary Value', 'Secondary Value'],
            ...exceptionRows.map((row) => [row.type, row.severity, row.title, row.description, row.primaryValue, row.secondaryValue ?? '']),
          ])
        : schedule.reportType === 'MARGIN_ANALYSIS'
          ? buildCsv([
              ['MONTH', 'ORDERS', 'REVENUE USD', 'NET PROFIT USD', 'NET MARGIN %'],
              ...report.marginAnalysis.monthlyTrend.map((point) => [point.month, point.orderCount, point.totalRevenue, point.totalNetProfit, point.netMarginPct ?? '']),
            ])
          : buildSummaryBundleCsv(report),
      contentType: 'text/csv; charset=utf-8',
    });
  }

  if (wantsXlsx) {
    const workbook = schedule.reportMode === 'EXCEPTIONS'
      ? (() => {
          const nextWorkbook = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(nextWorkbook, XLSX.utils.json_to_sheet(exceptionRows.map((row) => ({
            Type: row.type,
            Severity: row.severity,
            Title: row.title,
            Description: row.description,
            'Primary Value': row.primaryValue,
            'Secondary Value': row.secondaryValue ?? '',
          }))), 'Exceptions');
          return XLSX.write(nextWorkbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
        })()
      : schedule.reportType === 'MARGIN_ANALYSIS'
        ? buildMarginWorkbook(report)
        : buildSummaryWorkbook(report);
    attachments.push({
      filename: `${baseName}_${suffix}.xlsx`,
      content: workbook,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  return attachments;
}

const escHtml = (s: string | number | null | undefined) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function buildSummaryEmailHtml(tenantName: string, report: ReleaseTwoReportsDto): string {
  const topTraders = report.traderPerformance.rows.slice(0, 5)
    .map((row) => `<tr><td style="padding:6px 0;">${escHtml(row.traderName)}</td><td style="padding:6px 0; text-align:right;">${formatMoney(parseNumber(row.totalNetProfit))}</td></tr>`)
    .join('');
  const agingRows = report.invoiceAging.buckets
    .map((bucket) => `<tr><td style="padding:6px 0;">${escHtml(bucket.label)}</td><td style="padding:6px 0; text-align:right;">${bucket.count}</td><td style="padding:6px 0; text-align:right;">${bucket.outstandingAmount}</td></tr>`)
    .join('');

  return `
    <div style="font-family: Arial, sans-serif; color:#111827; line-height:1.5;">
      <h2 style="margin:0 0 12px;">${escHtml(tenantName)} report summary</h2>
      <p style="margin:0 0 18px; color:#6b7280;">Generated ${new Date(report.generatedAt).toUTCString()}</p>
      <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:12px; margin-bottom:18px;">
        <div style="border:1px solid #e5e7eb; border-radius:12px; padding:12px;">
          <div style="font-size:12px; color:#6b7280; text-transform:uppercase; letter-spacing:0.08em;">Net Profit</div>
          <div style="font-size:24px; font-weight:600;">${report.traderPerformance.totals.totalNetProfit} USD</div>
        </div>
        <div style="border:1px solid #e5e7eb; border-radius:12px; padding:12px;">
          <div style="font-size:12px; color:#6b7280; text-transform:uppercase; letter-spacing:0.08em;">Win Rate</div>
          <div style="font-size:24px; font-weight:600;">${(report.commercialSummary.conversion.winRate * 100).toFixed(1)}%</div>
        </div>
      </div>
      <h3 style="margin:0 0 8px;">Top traders by net profit</h3>
      <table style="width:100%; border-collapse:collapse; margin-bottom:18px;"><tbody>${topTraders || '<tr><td>No trader data</td></tr>'}</tbody></table>
      <h3 style="margin:0 0 8px;">Invoice aging</h3>
      <table style="width:100%; border-collapse:collapse;"><tbody>${agingRows}</tbody></table>
    </div>
  `;
}

function buildMarginEmailHtml(tenantName: string, report: ReleaseTwoReportsDto): string {
  const topCustomers = report.marginAnalysis.byCustomer.slice(0, 5)
    .map((row) => `<tr><td style="padding:6px 0;">${escHtml(row.label)}</td><td style="padding:6px 0; text-align:right;">${row.totalNetProfit}</td><td style="padding:6px 0; text-align:right;">${row.netMarginPct ?? '—'}%</td></tr>`)
    .join('');
  const trendRows = report.marginAnalysis.monthlyTrend
    .map((point) => `<tr><td style="padding:6px 0;">${escHtml(point.month)}</td><td style="padding:6px 0; text-align:right;">${point.totalRevenue}</td><td style="padding:6px 0; text-align:right;">${point.totalNetProfit}</td></tr>`)
    .join('');

  return `
    <div style="font-family: Arial, sans-serif; color:#111827; line-height:1.5;">
      <h2 style="margin:0 0 12px;">${escHtml(tenantName)} margin analysis</h2>
      <p style="margin:0 0 18px; color:#6b7280;">Generated ${new Date(report.generatedAt).toUTCString()}</p>
      <h3 style="margin:0 0 8px;">Top customers by net profit</h3>
      <table style="width:100%; border-collapse:collapse; margin-bottom:18px;"><tbody>${topCustomers || '<tr><td>No customer data</td></tr>'}</tbody></table>
      <h3 style="margin:0 0 8px;">Monthly trend</h3>
      <table style="width:100%; border-collapse:collapse;"><tbody>${trendRows || '<tr><td>No trend data</td></tr>'}</tbody></table>
    </div>
  `;
}

function buildExceptionsEmailHtml(tenantName: string, rows: ReportExceptionRowDto[]): string {
  const tableRows = rows.slice(0, 10)
    .map((row) => `<tr><td style="padding:6px 0;">${escHtml(row.title)}</td><td style="padding:6px 0;">${escHtml(row.type)}</td><td style="padding:6px 0; text-align:right;">${escHtml(row.primaryValue)}</td></tr>`)
    .join('');

  return `
    <div style="font-family: Arial, sans-serif; color:#111827; line-height:1.5;">
      <h2 style="margin:0 0 12px;">${escHtml(tenantName)} report exceptions</h2>
      <p style="margin:0 0 18px; color:#6b7280;">${rows.length} exception${rows.length === 1 ? '' : 's'} matched the current schedule.</p>
      <table style="width:100%; border-collapse:collapse;"><tbody>${tableRows || '<tr><td>No exceptions</td></tr>'}</tbody></table>
    </div>
  `;
}

async function runScheduleForTenant(tenantId: string, tenantName: string, schedule: ReportScheduleDto): Promise<boolean> {
  const userRows = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true), inArray(users.role, schedule.recipientRoles)));

  const recipients = Array.from(new Set([
    ...userRows.map((row) => row.email),
    ...schedule.extraEmails,
  ].map((value) => value.trim()).filter(Boolean)));

  if (recipients.length === 0) return false;

  const report = await getReleaseTwoReports(tenantId, userRows.length > 0 ? (await db.query.users.findFirst({ where: and(eq(users.tenantId, tenantId), eq(users.role, Role.Admin)), columns: { id: true } }))?.id ?? '' : '', schedule.filters ?? {});
  if (!report) return false;

  const exceptionRows = schedule.exceptionTypes.length > 0
    ? report.exceptions.rows.filter((row) => schedule.exceptionTypes.includes(row.type))
    : report.exceptions.rows;
  if (schedule.reportMode === 'EXCEPTIONS' && schedule.sendOnlyWhenNonEmpty && exceptionRows.length === 0) {
    return false;
  }

  const html = schedule.reportMode === 'EXCEPTIONS'
    ? buildExceptionsEmailHtml(tenantName, exceptionRows)
    : schedule.reportType === 'MARGIN_ANALYSIS'
      ? buildMarginEmailHtml(tenantName, report)
      : buildSummaryEmailHtml(tenantName, report);

  const effectiveBodyMode = resolveScheduleBodyMode(schedule.deliveryMode, schedule.bodyMode);
  const htmlBody = effectiveBodyMode === 'ATTACHMENT_ONLY'
    ? '<div style="font-family: Arial, sans-serif; color:#111827; line-height:1.5;"><p>Your scheduled Fueld report is attached.</p></div>'
    : html;
  const textBody = effectiveBodyMode === 'ATTACHMENT_ONLY'
    ? 'Your scheduled Fueld report is attached.'
    : undefined;

  return sendNotificationEmail(recipients, `Fueld report: ${schedule.name}`, htmlBody, {
    textContent: textBody,
    attachments: buildScheduledAttachments(schedule, report),
  });
}

export async function runDueReportSchedules(now = new Date()): Promise<void> {
  const tenantsWithSettings = await db.select({ id: tenants.id, name: tenants.name, settings: tenants.settings }).from(tenants);
  const hourUtc = now.getUTCHours();
  const todayKey = now.toISOString().slice(0, 10);

  for (const tenant of tenantsWithSettings) {
    const currentSettings = (tenant.settings ?? {}) as TenantSettings;
    const reportSettings = normalizeReportSettings(currentSettings.reportsSettings);
    let updated = false;

    const adminUser = await db.query.users.findFirst({
      where: and(eq(users.tenantId, tenant.id), eq(users.role, Role.Admin)),
      columns: { id: true },
    });
    if (!adminUser) continue;

    for (const schedule of reportSettings.schedules ?? []) {
      if (schedule.isActive === false) continue;
      if (Math.round(schedule.hourUtc) !== hourUtc) continue;
      if ((schedule.lastSentAt ?? '').slice(0, 10) === todayKey) continue;

      const sent = await runScheduleForTenant(tenant.id, tenant.name, {
        id: schedule.id,
        name: schedule.name,
        description: schedule.description ?? null,
        reportMode: normalizeScheduleMode(schedule.reportMode),
        reportType: schedule.reportType,
        deliveryMode: normalizeDeliveryMode(schedule.deliveryMode),
        bodyMode: resolveScheduleBodyMode(schedule.deliveryMode, schedule.bodyMode),
        hourUtc: schedule.hourUtc,
        recipientRoles: (schedule.recipientRoles ?? []) as Role[],
        extraEmails: schedule.extraEmails ?? [],
        exceptionTypes: normalizeExceptionTypes(schedule.exceptionTypes as ReportExceptionType[] | undefined),
        sendOnlyWhenNonEmpty: schedule.sendOnlyWhenNonEmpty ?? false,
        filters: schedule.filters ?? {},
        isActive: schedule.isActive ?? true,
        lastSentAt: schedule.lastSentAt ?? null,
        createdAt: schedule.createdAt,
        updatedAt: schedule.updatedAt,
      });
      if (!sent) continue;

      schedule.lastSentAt = now.toISOString();
      schedule.updatedAt = now.toISOString();
      updated = true;
    }

    if (updated) {
      await db.update(tenants)
        .set({ settings: { ...currentSettings, reportsSettings: reportSettings }, updatedAt: new Date() })
        .where(eq(tenants.id, tenant.id));
    }
  }
}

export function startReportsScheduleJob(): void {
  const intervalMs = 60 * 60 * 1000;
  const run = async () => {
    try {
      await runDueReportSchedules();
    } catch (error) {
      console.error('[Reports] Scheduled delivery failed:', error);
    }
  };

  setTimeout(run, 20_000);
  setInterval(run, intervalMs);
  console.log('[Reports] Background job started (interval: 1h)');
}
