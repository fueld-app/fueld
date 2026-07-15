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
import type { ApiResponse, BrokerCommissionReportDto } from '@fueld/types';
import { API } from '@app/core/config/api';
import { BrokerDealService } from '@app/core/services/broker-deal.service';

@Component({
  selector: 'app-broker-commission-report-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">{{ reportTitle() }}</h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-muted">
          Monthly commission report for broker deals. Manually generated — create when all deliveries and BDRs for the period are in.
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
            <button (click)="createCommissionOrders()" [disabled]="creatingOrders()"
              class="rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 inline-flex items-center gap-1.5">
              @if (creatingOrders()) {
                <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Creating…
              } @else {
                Create Commission Orders
              }
            </button>
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
              <p class="text-sm text-gray-500 dark:text-muted">Total Commission</p>
            </div>
            <div class="text-right">
              <p class="text-sm text-gray-500 dark:text-muted">{{ r.byCustomer.length }} customers</p>
              <p class="text-sm text-gray-500 dark:text-muted">{{ totalOrders(r) }} orders</p>
            </div>
          </div>
        </div>

        <!-- By customer -->
        @for (cust of r.byCustomer; track cust.customerId) {
          <div class="mb-4 rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm overflow-hidden">
            <div class="border-b border-gray-100 dark:border-line px-5 py-3 bg-gray-50 dark:bg-surface-2">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim">{{ cust.customerName }}</h3>
                <div class="text-right">
                  <span class="text-sm font-medium text-gray-900 dark:text-ink">{{ formatAmount(cust.totalCommission) }} {{ r.currency }}</span>
                  <span class="text-xs text-gray-400 dark:text-muted ml-2">{{ cust.orderCount }} orders · {{ formatQty(cust.totalQuantity) }}</span>
                </div>
              </div>
            </div>
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-100 dark:border-line">
                  <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Order #</th>
                  <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Vessel</th>
                  <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Place</th>
                  <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Product</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-500 dark:text-muted">Qty</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-500 dark:text-muted">Rate</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-500 dark:text-muted">Commission</th>
                  <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Delivered</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50 dark:divide-line">
                @for (o of cust.orders; track o.orderNumber) {
                  <tr class="hover:bg-gray-50/50 dark:hover:bg-surface-tint">
                    <td class="px-4 py-2 font-mono text-xs text-gray-500 dark:text-muted">{{ o.orderNumber }}</td>
                    <td class="px-4 py-2 text-gray-900 dark:text-ink">{{ o.vesselName }}</td>
                    <td class="px-4 py-2 text-gray-600 dark:text-ink-dim">{{ o.placeName }}</td>
                    <td class="px-4 py-2 text-gray-600 dark:text-ink-dim">{{ o.productType }}</td>
                    <td class="px-4 py-2 text-right text-gray-600 dark:text-ink-dim">{{ formatQty(o.quantity) }} {{ o.unit }}</td>
                    <td class="px-4 py-2 text-right text-gray-600 dark:text-ink-dim">{{ o.commissionPerMt }}</td>
                    <td class="px-4 py-2 text-right font-medium text-gray-900 dark:text-ink">{{ formatAmount(o.commissionAmount) }} {{ r.currency }}</td>
                    <td class="px-4 py-2 text-gray-500 dark:text-muted text-xs">{{ o.deliveredAt ? formatDate(o.deliveredAt) : '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @empty {
          <div class="text-center py-12 text-gray-400 dark:text-muted">
            No broker deals found in the selected period.
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
export class BrokerCommissionReportPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly brokerDealSvc = inject(BrokerDealService);

  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly loading = signal(false);
  readonly creatingOrders = signal(false);
  readonly report = signal<BrokerCommissionReportDto | null>(null);

  readonly reportTitle = computed(() => 'Broker Commission Report');

  ngOnInit(): void {
    this.brokerDealSvc.load();
    // Default to current month
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    this.fromDate.set(firstDay.toISOString().split('T')[0]);
    this.toDate.set(lastDay.toISOString().split('T')[0]);
  }

  canGenerate(): boolean {
    return !!this.fromDate() && !!this.toDate();
  }

  async generate(): Promise<void> {
    if (!this.canGenerate()) return;
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<BrokerCommissionReportDto>>(
          `${API}/reports/broker-commission?from=${this.fromDate()}&to=${this.toDate()}`,
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
    return `${API}/reports/broker-commission/export?from=${this.fromDate()}&to=${this.toDate()}`;
  }

  xlsxUrl(): string {
    return `${API}/reports/broker-commission/export.xlsx?from=${this.fromDate()}&to=${this.toDate()}`;
  }

  async createCommissionOrders(): Promise<void> {
    this.creatingOrders.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<any>>(`${API}/reports/broker-commission/create-orders`, {
          from: this.fromDate(),
          to: this.toDate(),
        }),
      );
      if (res.success && res.data) {
        const count = (res.data as any[]).length;
        const total = (res.data as any[]).reduce((sum, o) => sum + parseFloat(o.commissionAmount), 0);
        alert(`Created ${count} commission order(s) totaling $${total.toFixed(2)}.\n\nThese are regular orders (not broker deals) with the commission amount as profit. They appear in margin analysis and active orders.`);
      }
    } catch {
      alert('Failed to create commission orders.');
    } finally {
      this.creatingOrders.set(false);
    }
  }

  totalOrders(r: BrokerCommissionReportDto): number {
    return r.byCustomer.reduce((sum, c) => sum + c.orderCount, 0);
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