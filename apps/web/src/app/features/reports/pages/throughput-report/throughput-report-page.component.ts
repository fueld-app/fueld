import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  computed,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, ThroughputReportDto, ThroughputReportRowDto } from '@fueld/types';
import { API } from '@app/core/config/api';

type DateMode = 'daily' | 'weekly' | 'monthly' | 'custom';

@Component({
  selector: 'app-throughput-report-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (toast(); as t) {
      <div class="fixed bottom-4 right-4 z-50 rounded-lg px-4 py-3 text-sm shadow-lg"
        [class]="t.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'">
        {{ t.message }}
      </div>
    }
    @if (!throughputEnabled() && !throughputChecked()) {
      <div class="flex items-center justify-center py-20">
        <svg class="h-5 w-5 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
      </div>
    } @else if (!throughputEnabled() && throughputChecked()) {
      <div class="text-center py-20">
        <p class="text-gray-500 dark:text-muted">The throughput report is not enabled for your tenant.</p>
      </div>
    } @else {
    <div>
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">Throughput / Sales Report</h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-muted">
          Volumes by product / service for a given time frame. Replaces the manual spreadsheet.
        </p>
      </div>

      <!-- Date mode selector + date range -->
      <div class="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Period</label>
          <select
            [ngModel]="dateMode()"
            (ngModelChange)="onModeChange($event)"
            class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none bg-white dark:bg-surface"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="custom">Custom Date Range</option>
          </select>
        </div>

        @if (dateMode() === 'custom' || dateMode() === 'daily') {
          <div>
            <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">
              {{ dateMode() === 'daily' ? 'Date' : 'From' }}
            </label>
            <input type="date" [ngModel]="fromDate()" (ngModelChange)="fromDate.set($event)"
              class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none" />
          </div>
        }

        @if (dateMode() === 'custom') {
          <div>
            <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">To</label>
            <input type="date" [ngModel]="toDate()" (ngModelChange)="toDate.set($event)"
              class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none" />
          </div>
        }

        <button (click)="generate()" [disabled]="!canGenerate() || loading()"
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 inline-flex items-center gap-2">
          @if (loading()) {
            <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            Loading…
          } @else {
            Generate Report
          }
        </button>

        @if (report()) {
          <a [href]="xlsxUrl()" download
            class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint inline-flex items-center gap-1.5">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 3a.75.75 0 0 1 .75.75v6.638l1.963-2.158a.75.75 0 1 1 1.094 1.026l-3.25 3.576a.75.75 0 0 1-1.094 0l-3.25-3.576a.75.75 0 1 1 1.094-1.026l1.963 2.158V3.75A.75.75 0 0 1 10 3Z" clip-rule="evenodd" />
              <path d="M3.5 13.5a.75.75 0 0 0-1.5 0v3A2.75 2.75 0 0 0 4.75 19.5h10.5A2.75 2.75 0 0 0 18 16.5v-3a.75.75 0 0 0-1.5 0v3c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-3Z" />
            </svg>
            Export to Excel
          </a>
        }
      </div>

      <!-- Report -->
      @if (report(); as r) {
        <!-- Summary -->
        <div class="mb-4 rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-4 shadow-sm">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-gray-500 dark:text-muted">
                Period: {{ r.from ?? 'All time' }}{{ r.to ? ' to ' + r.to : '' }}
              </p>
              <p class="text-2xl font-bold text-gray-900 dark:text-ink mt-1">{{ r.rows.length }}</p>
              <p class="text-sm text-gray-500 dark:text-muted">Product / Service Types</p>
            </div>
            <div class="text-right">
              <p class="text-2xl font-bold text-gray-900 dark:text-ink">{{ r.totalOrderCount }}</p>
              <p class="text-sm text-gray-500 dark:text-muted">Orders</p>
            </div>
          </div>
        </div>

        <!-- Results table -->
        @if (r.rows.length > 0) {
          <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-100 dark:border-line bg-gray-50 dark:bg-surface-2">
                  <th class="px-4 py-3 text-left font-medium text-gray-500 dark:text-muted">Product / Service</th>
                  <th class="px-4 py-3 text-right font-medium text-gray-500 dark:text-muted">Total Quantity</th>
                  <th class="px-4 py-3 text-left font-medium text-gray-500 dark:text-muted">Unit</th>
                  <th class="px-4 py-3 text-right font-medium text-gray-500 dark:text-muted">Orders</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50 dark:divide-line">
                @for (row of r.rows; track row.productType) {
                  <tr class="hover:bg-gray-50/50 dark:hover:bg-surface-tint">
                    <td class="px-4 py-2.5 text-gray-900 dark:text-ink">{{ row.productType }}</td>
                    <td class="px-4 py-2.5 text-right font-medium text-gray-900 dark:text-ink">{{ formatQty(row.totalQuantity) }}</td>
                    <td class="px-4 py-2.5 text-gray-600 dark:text-ink-dim">{{ row.unit }}</td>
                    <td class="px-4 py-2.5 text-right text-gray-600 dark:text-ink-dim">{{ row.orderCount }}</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr class="border-t-2 border-gray-200 dark:border-line-strong bg-gray-50 dark:bg-surface-2">
                  <td class="px-4 py-3 font-semibold text-gray-900 dark:text-ink">Total</td>
                  <td class="px-4 py-3 text-right font-semibold text-gray-900 dark:text-ink">{{ r.totalOrderCount }} orders</td>
                  <td colspan="2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        } @else {
          <div class="text-center py-12 text-gray-400 dark:text-muted">
            No data found for the selected period.
          </div>
        }
      } @else if (!loading()) {
        <div class="text-center py-12 text-gray-400 dark:text-muted">
          Select a date range and click "Generate Report" to view the throughput report.
        </div>
      }
    </div>
    }
  `,
})
export class ThroughputReportPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly dateMode = signal<DateMode>('monthly');
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly loading = signal(false);
  readonly report = signal<ThroughputReportDto | null>(null);
  readonly throughputEnabled = signal(false);
  readonly throughputChecked = signal(false);
  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);

  ngOnInit(): void {
    // Check if throughput report is enabled for this tenant
    this.checkEnabled();
    // Default to current month
    this.applyDateMode('monthly');
  }

  private async checkEnabled(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ enabled: boolean }>>(`${API}/admin/settings/my-throughput-report-settings`),
      );
      if (res.success && res.data) {
        this.throughputEnabled.set(res.data.enabled);
      }
      this.throughputChecked.set(true);
    } catch {
      // Default to enabled if we can't check (fail open for testing)
      this.throughputChecked.set(true);
    }
  }

  onModeChange(mode: string): void {
    this.dateMode.set(mode as DateMode);
    this.applyDateMode(mode as DateMode);
  }

  private applyDateMode(mode: DateMode): void {
    const now = new Date();
    if (mode === 'daily') {
      this.fromDate.set(now.toISOString().split('T')[0]);
      this.toDate.set('');
    } else if (mode === 'weekly') {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      this.fromDate.set(weekAgo.toISOString().split('T')[0]);
      this.toDate.set(now.toISOString().split('T')[0]);
    } else if (mode === 'monthly') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      this.fromDate.set(firstDay.toISOString().split('T')[0]);
      this.toDate.set(lastDay.toISOString().split('T')[0]);
    }
    // custom: leave dates as-is for user to pick
  }

  canGenerate(): boolean {
    if (this.dateMode() === 'daily') return !!this.fromDate();
    if (this.dateMode() === 'custom') return !!this.fromDate() && !!this.toDate();
    return true; // weekly/monthly have auto-set dates
  }

  async generate(): Promise<void> {
    if (!this.canGenerate()) return;
    this.loading.set(true);
    try {
      const params = this.dateMode() === 'daily'
        ? `from=${this.fromDate()}&to=${this.fromDate()}`
        : `from=${this.fromDate()}&to=${this.toDate()}`;
      const res = await firstValueFrom(
        this.http.get<ApiResponse<ThroughputReportDto>>(`${API}/reports/throughput?${params}`),
      );
      if (res.success && res.data) {
        this.report.set(res.data);
      }
    } catch {
      this.report.set(null);
      this.toast.set({ type: 'error', message: 'Failed to generate report. Please try again or contact support.' });
      setTimeout(() => this.toast.set(null), 5000);
    } finally {
      this.loading.set(false);
    }
  }

  xlsxUrl(): string {
    const params = this.dateMode() === 'daily'
      ? `from=${this.fromDate()}&to=${this.fromDate()}`
      : `from=${this.fromDate()}&to=${this.toDate()}`;
    return `${API}/reports/throughput/export.xlsx?${params}`;
  }

  formatQty(value: number): string {
    return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
  }
}