import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type {
  ApiResponse,
  ReleaseTwoReportsDto,
  ReportComparisonMode,
  ReportDrilldownResponseDto,
  ReportDrilldownTarget,
  ReportExceptionType,
  ReportFiltersDto,
  ReportScheduleBodyMode,
  ReportScheduleDeliveryMode,
  ReportScheduleMode,
  ReportScheduleType,
  SavedReportViewDto,
} from '@fueld/types';
import { Role } from '@fueld/types';
import { API } from '@app/core/config/api';

type ExportKind = 'trader-performance' | 'invoice-aging' | 'commercial-summary' | 'margin-analysis' | 'exceptions';
type ExportFormat = 'csv' | 'xlsx';
type DatePresetKey = 'today' | 'yesterday' | 'this_week' | 'last_7_days' | 'this_month' | 'last_30_days' | 'this_quarter' | 'year_to_date' | 'custom';

@Injectable()
export class ReportsPageStore {
  private readonly http = inject(HttpClient);
  autoReloadHandle: ReturnType<typeof setTimeout> | null = null;

  readonly utcHours = Array.from({ length: 24 }, (_, index) => index);
  readonly scheduleRoleOptions: Role[] = [Role.Admin, Role.Finance, Role.Teamlead, Role.CreditManager, Role.OperationsManager, Role.Light];

  readonly today = signal(this.formatDateInput(new Date()));
  readonly defaultFrom = signal(this.formatDateInput(new Date(new Date().getFullYear(), 0, 1)));
  readonly from = signal(this.defaultFrom());
  readonly to = signal(this.today());
  readonly dateDropdownOpen = signal(false);
  readonly selectedDatePreset = signal<DatePresetKey>('year_to_date');
  readonly customDateFrom = signal(this.defaultFrom());
  readonly customDateTo = signal(this.today());
  readonly datePresets: Array<{ key: Exclude<DatePresetKey, 'custom'>; label: string }> = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'this_week', label: 'This Week' },
    { key: 'last_7_days', label: 'Last 7 Days' },
    { key: 'this_month', label: 'This Month' },
    { key: 'last_30_days', label: 'Last 30 Days' },
    { key: 'this_quarter', label: 'This Quarter' },
    { key: 'year_to_date', label: 'Year to Date' },
  ];
  readonly dateRangeLabel = computed(() => {
    const preset = this.selectedDatePreset();
    if (preset === 'custom') {
      const from = this.customDateFrom();
      const to = this.customDateTo();
      if (from && to) return `${this.formatShortDate(from)} - ${this.formatShortDate(to)}`;
      return 'Custom Range';
    }
    return this.datePresets.find((option) => option.key === preset)?.label ?? 'Year to Date';
  });
  readonly traderId = signal<string | null>(null);
  readonly teamId = signal<string | null>(null);
  readonly customerId = signal<string | null>(null);
  readonly productType = signal<string | null>(null);
  readonly comparisonMode = signal<ReportComparisonMode>('PREVIOUS_PERIOD');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly data = signal<ReleaseTwoReportsDto | null>(null);
  readonly drilldownLoading = signal(false);
  readonly drilldownError = signal<string | null>(null);
  readonly drilldownData = signal<ReportDrilldownResponseDto | null>(null);

  readonly editingViewId = signal<string | null>(null);
  readonly newViewName = signal('');
  readonly newViewDescription = signal('');
  readonly savingView = signal(false);

  readonly editingScheduleId = signal<string | null>(null);
  readonly scheduleName = signal('');
  readonly scheduleDescription = signal('');
  readonly scheduleMode = signal<ReportScheduleMode>('SUMMARY');
  readonly scheduleReportType = signal<ReportScheduleType>('SUMMARY');
  readonly scheduleDeliveryMode = signal<ReportScheduleDeliveryMode>('HTML');
  readonly scheduleBodyMode = signal<ReportScheduleBodyMode>('HTML_SUMMARY');
  readonly scheduleHourUtc = signal(8);
  readonly scheduleRecipientRoles = signal<Role[]>([Role.Admin, Role.Finance]);
  readonly scheduleHourValue = computed(() => `${this.scheduleHourUtc()}`);
  readonly scheduleExtraEmails = signal('');
  readonly scheduleExceptionTypes = signal<ReportExceptionType[]>([]);
  readonly scheduleSendOnlyWhenNonEmpty = signal(true);
  readonly scheduleActive = signal(true);
  readonly savingSchedule = signal(false);

  readonly summaryCards = computed(() => {
    const reportData = this.data();
    if (!reportData) return [];

    return [
      {
        label: 'Net Profit',
        value: this.formatCurrency(reportData.traderPerformance.totals.totalNetProfit),
        description: 'Visible net profit across the selected reporting scope.',
      },
      {
        label: 'Open Invoices',
        value: reportData.invoiceAging.totalInvoices.toString(),
        description: `${this.formatCurrency(reportData.invoiceAging.totalOutstanding)} outstanding across all aging buckets.`,
      },
      {
        label: 'Win Rate',
        value: this.formatPercent(reportData.commercialSummary.conversion.winRate),
        description: `Won ${reportData.commercialSummary.conversion.totalWon} and lost ${reportData.commercialSummary.conversion.totalLost}.`,
      },
      {
        label: 'Margin',
        value: this.formatPercentFromRevenue(reportData.traderPerformance.totals.totalNetProfit, reportData.traderPerformance.totals.totalRevenue),
        description: `Average deal size ${this.formatCurrency(reportData.traderPerformance.totals.avgDealSize)}.`,
      },
    ];
  });

  constructor() {
    void this.reload();
  }

  destroy(): void {
    if (this.autoReloadHandle !== null) {
      clearTimeout(this.autoReloadHandle);
      this.autoReloadHandle = null;
    }
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const body = this.currentFilters();
      const response = await firstValueFrom(
        this.http.post<ApiResponse<ReleaseTwoReportsDto>>(
          `${API}/reports/release-two`,
          body,
        ),
      );
      if (response.success && response.data) {
        this.data.set(response.data);
        this.drilldownData.set(null);
        this.drilldownError.set(null);
      } else {
        this.error.set(response.message ?? 'Failed to load reports');
      }
    } catch (err: any) {
      this.error.set(this.describeError(err, 'Failed to load reports'));
    } finally {
      this.loading.set(false);
      this.queueAutoReload();
    }
  }

  async exportReport(kind: ExportKind, format: ExportFormat): Promise<void> {
    const query = this.buildQuery();
    const endpoint = `${API}/reports/${format === 'csv' ? 'export' : 'xlsx'}/${kind}?${query}`;
    try {
      const response = await firstValueFrom(
        this.http.get(endpoint, { responseType: 'blob', observe: 'response' }),
      );
      this.downloadBlob(response.body, this.extractFileName(response.headers.get('content-disposition'), `${kind}.${format}`));
    } catch (err) {
      console.error('Export failed:', err);
    }
  }

  async saveCurrentView(): Promise<void> {
    const editId = this.editingViewId();
    const name = this.newViewName().trim();
    if (!name) return;

    this.savingView.set(true);
    try {
      const filters = this.currentFilters();
      const endpoint = editId
        ? `${API}/reports/saved-views/${editId}`
        : `${API}/reports/saved-views`;

      let response;
      if (editId) {
        response = await firstValueFrom(
          this.http.patch<ApiResponse<SavedReportViewDto[]>>(endpoint, {
            name,
            description: this.newViewDescription().trim() || null,
            filters,
          } as any),
        );
      } else {
        response = await firstValueFrom(
          this.http.post<ApiResponse<SavedReportViewDto[]>>(endpoint, {
            name,
            description: this.newViewDescription().trim() || null,
            filters,
          } as any),
        );
      }

      if (response.success && response.data) {
        const current = this.data();
        if (current) {
          this.data.set({ ...current, savedViews: response.data });
        }
        this.cancelViewEdit();
      }
    } catch (err) {
      console.error('Failed to save view:', err);
    } finally {
      this.savingView.set(false);
    }
  }

  async deleteSavedView(id: string): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.delete<ApiResponse<SavedReportViewDto[]>>(`${API}/reports/saved-views/${id}`),
      );
      if (response.success && response.data) {
        const current = this.data();
        if (current) {
          this.data.set({ ...current, savedViews: response.data });
        }
      }
    } catch (err) {
      console.error('Failed to delete view:', err);
    }
  }

  async saveSchedule(): Promise<void> {
    const name = this.scheduleName().trim();
    if (!name) return;

    this.savingSchedule.set(true);
    try {
      const editId = this.editingScheduleId();
      const filters = this.currentFilters();
      const payload = {
        name,
        description: this.scheduleDescription().trim() || null,
        reportMode: this.scheduleMode(),
        reportType: this.scheduleReportType(),
        deliveryMode: this.scheduleDeliveryMode(),
        bodyMode: this.scheduleBodyMode(),
        hourUtc: this.scheduleHourUtc(),
        recipientRoles: this.scheduleRecipientRoles(),
        extraEmails: this.scheduleExtraEmails().split(',').map((e) => e.trim()).filter(Boolean),
        exceptionTypes: this.scheduleExceptionTypes(),
        sendOnlyWhenNonEmpty: this.scheduleSendOnlyWhenNonEmpty(),
        isActive: this.scheduleActive(),
        filters,
      };

      const endpoint = editId
        ? `${API}/reports/schedules/${editId}`
        : `${API}/reports/schedules`;

      let response;
      if (editId) {
        response = await firstValueFrom(
          this.http.patch<ApiResponse<ReleaseTwoReportsDto['schedules']>>(
            endpoint,
            payload as any,
          ),
        );
      } else {
        response = await firstValueFrom(
          this.http.post<ApiResponse<ReleaseTwoReportsDto['schedules']>>(
            endpoint,
            payload as any,
          ),
        );
      }

      if (response.success && response.data) {
        const current = this.data();
        if (current) {
          this.data.set({ ...current, schedules: response.data });
        }
        this.cancelScheduleEdit();
      }
    } catch (err) {
      console.error('Failed to save schedule:', err);
    } finally {
      this.savingSchedule.set(false);
    }
  }

  async deleteSchedule(id: string): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.delete<ApiResponse<ReleaseTwoReportsDto['schedules']>>(`${API}/reports/schedules/${id}`),
      );
      if (response.success && response.data) {
        const current = this.data();
        if (current) {
          this.data.set({ ...current, schedules: response.data });
        }
      }
    } catch (err) {
      console.error('Failed to delete schedule:', err);
    }
  }

  async toggleScheduleActive(schedule: ReleaseTwoReportsDto['schedules'][number]): Promise<void> {
    await this.saveScheduleEdit(schedule);
  }

  private async saveScheduleEdit(schedule: ReleaseTwoReportsDto['schedules'][number]): Promise<void> {
    this.savingSchedule.set(true);
    try {
      const response = await firstValueFrom(
        this.http.patch<ApiResponse<ReleaseTwoReportsDto['schedules']>>(
          `${API}/reports/schedules/${schedule.id}`,
          {
            name: schedule.name,
            description: schedule.description,
            reportMode: schedule.reportMode,
            reportType: schedule.reportType,
            deliveryMode: schedule.deliveryMode,
            bodyMode: schedule.bodyMode,
            hourUtc: schedule.hourUtc,
            recipientRoles: schedule.recipientRoles,
            extraEmails: schedule.extraEmails,
            exceptionTypes: schedule.exceptionTypes,
            sendOnlyWhenNonEmpty: schedule.sendOnlyWhenNonEmpty,
            isActive: !schedule.isActive,
            filters: schedule.filters,
          } as any,
        ),
      );
      if (response.success && response.data) {
        const current = this.data();
        if (current) {
          this.data.set({ ...current, schedules: response.data });
        }
      }
    } catch (err) {
      console.error('Failed to toggle schedule:', err);
    } finally {
      this.savingSchedule.set(false);
    }
  }

  async openOrderDrilldown(
    dimension: Extract<ReportDrilldownTarget, 'TRADER' | 'CUSTOMER' | 'PRODUCT'>,
    value: string,
  ): Promise<void> {
    this.drilldownLoading.set(true);
    this.drilldownError.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<ReportDrilldownResponseDto>>(`${API}/reports/drilldown`, {
          ...this.currentFilters(),
          dimension,
          value,
        }),
      );
      if (response.success && response.data) {
        this.drilldownData.set(response.data);
      } else {
        this.drilldownError.set(response.message ?? 'Failed to load drilldown');
      }
    } catch (err: any) {
      this.drilldownError.set(this.describeError(err, 'Failed to load drilldown'));
    } finally {
      this.drilldownLoading.set(false);
    }
  }

  async openInvoiceDrilldown(bucket: string): Promise<void> {
    this.drilldownLoading.set(true);
    this.drilldownError.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<ReportDrilldownResponseDto>>(`${API}/reports/drilldown`, {
          ...this.currentFilters(),
          dimension: 'AGING_BUCKET',
          value: bucket,
        }),
      );
      if (response.success && response.data) {
        this.drilldownData.set(response.data);
      } else {
        this.drilldownError.set(response.message ?? 'Failed to load drilldown');
      }
    } catch (err: any) {
      this.drilldownError.set(this.describeError(err, 'Failed to load drilldown'));
    } finally {
      this.drilldownLoading.set(false);
    }
  }

  clearFilters(): void {
    this.from.set(this.defaultFrom());
    this.to.set(this.today());
    this.traderId.set(null);
    this.teamId.set(null);
    this.customerId.set(null);
    this.productType.set(null);
    this.comparisonMode.set('PREVIOUS_PERIOD');
    this.selectedDatePreset.set('year_to_date');
    void this.reload();
  }

  editView(view: SavedReportViewDto): void {
    this.editingViewId.set(view.id);
    this.newViewName.set(view.name);
    this.newViewDescription.set(view.description ?? '');
  }

  cancelViewEdit(): void {
    this.editingViewId.set(null);
    this.newViewName.set('');
    this.newViewDescription.set('');
  }

  editSchedule(schedule: ReleaseTwoReportsDto['schedules'][number]): void {
    this.editingScheduleId.set(schedule.id);
    this.scheduleName.set(schedule.name);
    this.scheduleDescription.set(schedule.description ?? '');
    this.scheduleMode.set(schedule.reportMode);
    this.scheduleReportType.set(schedule.reportType);
    this.scheduleDeliveryMode.set(schedule.deliveryMode);
    this.scheduleBodyMode.set(schedule.bodyMode);
    this.scheduleHourUtc.set(schedule.hourUtc);
    this.scheduleRecipientRoles.set(schedule.recipientRoles);
    this.scheduleExtraEmails.set((schedule.extraEmails ?? []).join(', '));
    this.scheduleExceptionTypes.set(schedule.exceptionTypes);
    this.scheduleSendOnlyWhenNonEmpty.set(schedule.sendOnlyWhenNonEmpty);
    this.scheduleActive.set(schedule.isActive);
  }

  cancelScheduleEdit(): void {
    this.editingScheduleId.set(null);
    this.scheduleName.set('');
    this.scheduleDescription.set('');
    this.scheduleMode.set('SUMMARY');
    this.scheduleReportType.set('SUMMARY');
    this.scheduleDeliveryMode.set('HTML');
    this.scheduleBodyMode.set('HTML_SUMMARY');
    this.scheduleHourUtc.set(8);
    this.scheduleRecipientRoles.set([Role.Admin, Role.Finance]);
    this.scheduleExtraEmails.set('');
    this.scheduleExceptionTypes.set([]);
    this.scheduleSendOnlyWhenNonEmpty.set(true);
    this.scheduleActive.set(true);
  }

  selectDatePreset(preset: DatePresetKey): void {
    this.selectedDatePreset.set(preset);
    if (preset === 'custom') {
      this.dateDropdownOpen.set(false);
      return;
    }
    const resolved = this.resolveDatePreset(preset);
    this.from.set(resolved.from);
    this.to.set(resolved.to);
    this.dateDropdownOpen.set(false);
    void this.reload();
  }

  applyCustomDateRange(): void {
    const from = this.customDateFrom();
    const to = this.customDateTo();
    if (!from || !to) return;
    this.from.set(from);
    this.to.set(to);
    this.selectedDatePreset.set('custom');
    this.dateDropdownOpen.set(false);
    void this.reload();
  }

  selectFilter(key: 'traderId' | 'teamId' | 'customerId' | 'productType', value: string | null): void {
    this[key].set(value);
    void this.reload();
  }

  setComparisonMode(mode: ReportComparisonMode): void {
    this.comparisonMode.set(mode);
    void this.reload();
  }

  closeDrilldown(): void {
    this.drilldownData.set(null);
    this.drilldownError.set(null);
  }

  // ─── Private helpers ─────────────────────────────────────────────

  private currentFilters(): ReportFiltersDto & { comparisonMode?: ReportComparisonMode } {
    return {
      from: this.from() || undefined,
      to: this.to() || undefined,
      traderId: this.traderId() ?? undefined,
      teamId: this.teamId() ?? undefined,
      customerId: this.customerId() ?? undefined,
      productType: this.productType() ?? undefined,
      comparisonMode: this.comparisonMode(),
    };
  }

  private buildQuery(): string {
    const filters = this.currentFilters();
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.traderId) params.set('traderId', filters.traderId);
    if (filters.teamId) params.set('teamId', filters.teamId);
    if (filters.customerId) params.set('customerId', filters.customerId);
    if (filters.productType) params.set('productType', filters.productType);
    if (filters.comparisonMode) params.set('comparisonMode', filters.comparisonMode);
    return params.toString();
  }

  private formatDateInput(date: Date): string {
    return date.toLocaleDateString('en-CA');
  }

  private formatShortDate(value: string): string {
    const d = new Date(`${value}T00:00:00`);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }

  private resolveDatePreset(preset: Exclude<DatePresetKey, 'custom'>): { from: string; to: string } {
    const today = new Date();
    const to = this.formatDateInput(today);

    switch (preset) {
      case 'today':
        return { from: to, to };
      case 'yesterday': {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = this.formatDateInput(yesterday);
        return { from: yesterdayStr, to: yesterdayStr };
      }
      case 'this_week': {
        const weekStart = new Date(today);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        return { from: this.formatDateInput(weekStart), to };
      }
      case 'last_7_days': {
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        return { from: this.formatDateInput(sevenDaysAgo), to };
      }
      case 'this_month': {
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        return { from: this.formatDateInput(monthStart), to };
      }
      case 'last_30_days': {
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
        return { from: this.formatDateInput(thirtyDaysAgo), to };
      }
      case 'this_quarter': {
        const quarterStart = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
        return { from: this.formatDateInput(quarterStart), to };
      }
      case 'year_to_date':
      default: {
        const yearStart = new Date(today.getFullYear(), 0, 1);
        return { from: this.formatDateInput(yearStart), to };
      }
    }
  }

  private extractFileName(contentDisposition: string | null, fallback: string): string {
    if (!contentDisposition) return fallback;
    const match = contentDisposition.match(/filename="?([^"]+)"?/);
    return match?.[1] ?? fallback;
  }

  private downloadBlob(blob: Blob | null, fileName: string): void {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private describeError(error: unknown, fallback: string): string {
    if (error instanceof Error) return error.message;
    return fallback;
  }

  private queueAutoReload(): void {
    if (this.autoReloadHandle !== null) {
      clearTimeout(this.autoReloadHandle);
    }
    this.autoReloadHandle = setTimeout(() => {
      if (document.visibilityState === 'visible') {
        void this.reload();
      }
    }, 120_000);
  }

  // ─── Template helpers ────────────────────────────────────────────

  formatCurrency(value: string): string {
    const num = parseFloat(value);
    if (Math.abs(num) >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
    if (Math.abs(num) >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
    return `$${num.toFixed(0)}`;
  }

  formatPercent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
  }

  formatPercentFromRevenue(netProfit: string, revenue: string): string {
    const rev = parseFloat(revenue);
    if (rev === 0) return '—';
    return `${((parseFloat(netProfit) / rev) * 100).toFixed(1)}%`;
  }

  describeScope(scope: string): string {
    switch (scope) {
      case 'ALL': return 'All Traders';
      case 'TEAM': return 'Team';
      case 'SELF': return 'My Data';
      default: return scope;
    }
  }
}
