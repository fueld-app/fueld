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
import type { ApiResponse, SupplierCommissionReportDto } from '@fueld/types';
import { API } from '@app/core/config/api';

@Component({
  selector: 'app-supplier-commission-report-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">{{ reportTitle() }}</h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-muted">
          Commission owed to Moxie by suppliers on broker deals, from the supplier-side per-line rate. Manually generated — run once all deliveries for the period are in.
        </p>
      </div>

      <!-- Date range + filters -->
      <div class="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">From</label>
          <input type="date" [ngModel]="fromDate()" (ngModelChange)="fromDate.set($event)"
            class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">To</label>
          <input type="date" [ngModel]="toDate()" (ngModelChange)="toDate.set($event)"
            class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none" />
        </div>
        <button (click)="generate()" [disabled]="!canGenerate() || loading()"
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 inline-flex items-center gap-2">
          @if (loading()) {
            <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            Generating…
          } @else {
            Generate Report
          }
        </button>
        @if (report()) {
          <div class="flex gap-2">
            <a [href]="csvUrl()" download
              class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint">
              CSV
            </a>
            <a [href]="xlsxUrl()" download
              class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint">
              XLSX
            </a>
          </div>
        }
      </div>

      <!-- Report -->
      @if (report(); as r) {
        <!-- Summary -->
        <div class="mb-4 rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-4 shadow-sm">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-gray-500 dark:text-muted">Period: {{ r.period.from }} to {{ r.period.to }}</p>
              <p class="text-2xl font-bold text-gray-900 dark:text-ink mt-1">{{ formatAmount(r.totalCommission) }} {{ r.currency }}</p>
              <p class="text-sm text-gray-500 dark:text-muted">Total Commission (owed by suppliers)</p>
              <p class="text-sm text-gray-500 dark:text-muted mt-1">Customer-side: {{ totalCustomerCommission() }} {{ r.currency }} — billed to customers on the same lines</p>
            </div>
            <div class="text-right">
              <p class="text-sm text-gray-500 dark:text-muted">{{ r.bySupplier.length }} suppliers</p>
              <p class="text-sm text-gray-500 dark:text-muted">{{ totalOrders(r) }} lines</p>
            </div>
          </div>
          @if (r.attributedToMultipleSuppliers.length > 0) {
            <div class="mt-3 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 px-3 py-2">
              <p class="text-sm font-medium text-amber-900 dark:text-amber-200">
                Not included — supplier commission could not be attributed to one supplier:
              </p>
              <p class="text-sm text-amber-800 dark:text-amber-300 font-mono">{{ r.attributedToMultipleSuppliers.join(', ') }}</p>
              <p class="text-xs text-amber-800 dark:text-amber-300 mt-1">
                These deals have more than one supplier leg, so the statement would under-bill. Split the deal before sending.
              </p>
            </div>
          }
        </div>

        <!-- By supplier -->
        @for (sup of r.bySupplier; track sup.supplierId) {
          <div class="mb-4 rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm overflow-hidden">
            <div class="border-b border-gray-100 dark:border-line px-5 py-3 bg-gray-50 dark:bg-surface-2">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim">{{ sup.supplierName }}</h3>
                <div class="text-right">
                  <span class="text-sm font-medium text-gray-900 dark:text-ink">{{ formatAmount(sup.totalCommission) }} {{ r.currency }}</span>
                  <span class="text-xs text-gray-400 dark:text-muted ml-2">{{ sup.lineCount }} lines · {{ formatQty(sup.totalQuantity) }}</span>
                </div>
              </div>
            </div>
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-100 dark:border-line">
                  <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Order #</th>
                  <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Vessel</th>
                  <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Place</th>
                  <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Customer</th>
                  <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Product</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-500 dark:text-muted">Qty</th>
                  <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Unit</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-500 dark:text-muted">Rate</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-500 dark:text-muted">Commission</th>
                  <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Delivered</th>
                  <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Status</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50 dark:divide-line">
                @for (o of sup.orders; track o.orderNumber) {
                  <tr class="hover:bg-gray-50/50 dark:hover:bg-surface-tint">
                    <td class="px-4 py-2 font-mono text-xs text-gray-500 dark:text-muted">{{ o.orderNumber }}</td>
                    <td class="px-4 py-2 text-gray-900 dark:text-ink">{{ o.vesselName }}</td>
                    <td class="px-4 py-2 text-gray-600 dark:text-ink-dim">{{ o.placeName }}</td>
                    <td class="px-4 py-2 text-gray-600 dark:text-ink-dim">{{ o.customerName }}</td>
                    <td class="px-4 py-2 text-gray-600 dark:text-ink-dim">{{ o.productType }}</td>
                    <td class="px-4 py-2 text-right text-gray-600 dark:text-ink-dim">{{ formatQty(o.quantity) }}</td>
                    <td class="px-4 py-2 text-gray-600 dark:text-ink-dim">{{ o.unit }}</td>
                    <td class="px-4 py-2 text-right text-gray-600 dark:text-ink-dim">{{ o.commissionPerMt }}</td>
                    <td class="px-4 py-2 text-right font-medium text-gray-900 dark:text-ink">{{ formatAmount(o.commissionAmount) }} {{ r.currency }}</td>
                    <td class="px-4 py-2 text-gray-500 dark:text-muted text-xs">{{ o.deliveredAt ? formatDate(o.deliveredAt) : '—' }}</td>
                    <td class="px-4 py-2 text-xs text-gray-600 dark:text-ink-dim">{{ o.status }}</td>
                  </tr>
                }
              </tbody>
              <tfoot class="border-t border-gray-100 dark:border-line bg-gray-50/50 dark:bg-surface-2">
                <tr>
                  <td class="px-4 py-2 text-xs font-semibold text-gray-500 dark:text-muted" colspan="4">{{ sup.supplierName }} subtotal</td>
                  <td class="px-4 py-2"></td>
                  <td class="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-ink-dim">{{ formatQty(sup.totalQuantity) }}</td>
                  <td class="px-4 py-2"></td>
                  <td class="px-4 py-2"></td>
                  <td class="px-4 py-2 text-right text-xs font-semibold text-gray-900 dark:text-ink">{{ formatAmount(sup.totalCommission) }} {{ r.currency }}</td>
                  <td class="px-4 py-2"></td>
                  <td class="px-4 py-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        } @empty {
          <div class="text-center py-12 text-gray-400 dark:text-muted">
            No supplier commission found in the selected period.
          </div>
        }
      } @else if (!loading()) {
        <div class="text-center py-12 text-gray-400 dark:text-muted">
          Select a date range and click "Generate Report" to view the commission report.
        </div>
      }
    </div>
  `,
})
export class SupplierCommissionReportPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly loading = signal(false);
  readonly report = signal<SupplierCommissionReportDto | null>(null);

  readonly reportTitle = computed(() => 'Supplier Commission Report');

  /** What customers are billed on the same lines — context for the supplier-side total. */
  readonly totalCustomerCommission = computed(() =>
    this.formatAmount(this.report()?.customerCommission ?? '0'),
  );

  ngOnInit(): void {
    // Default to current month. Built from local date parts, not
    // `toISOString()`: in a non-UTC zone the ISO conversion shifts local
    // midnight back a day, yielding e.g. Aug 31 → Sep 29 for September.
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    this.fromDate.set(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`);
    this.toDate.set(
      `${lastDay.getFullYear()}-${pad(lastDay.getMonth() + 1)}-${pad(lastDay.getDate())}`,
    );
  }

  canGenerate(): boolean {
    return !!this.fromDate() && !!this.toDate();
  }

  async generate(): Promise<void> {
    if (!this.canGenerate()) return;
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<SupplierCommissionReportDto>>(
          `${API}/reports/supplier-commission?from=${this.fromDate()}&to=${this.toDate()}`,
        ),
      );
      if (res.success && res.data) {
        this.report.set(res.data);
      }
    } catch {
      // ignore
    } finally {
      this.loading.set(false);
    }
  }

  csvUrl(): string {
    return `${API}/reports/supplier-commission/export?from=${this.fromDate()}&to=${this.toDate()}`;
  }

  xlsxUrl(): string {
    return `${API}/reports/supplier-commission/export.xlsx?from=${this.fromDate()}&to=${this.toDate()}`;
  }

  totalOrders(r: SupplierCommissionReportDto): number {
    return r.bySupplier.reduce((sum, s) => sum + s.lineCount, 0);
  }

  formatAmount(value: string): string {
    const num = parseFloat(value) || 0;
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  formatQty(value: string): string {
    const num = parseFloat(value) || 0;
    return num.toLocaleString('en-US', { maximumFractionDigits: 3 });
  }

  formatDate(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}
