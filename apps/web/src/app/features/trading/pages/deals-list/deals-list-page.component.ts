import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse } from '@fueld/types';

import { API } from '@app/core/config/api';
import { AuthService } from '@app/core/auth/auth.service';
import { ViewsService } from '@app/core/views/views.service';

interface DealRow {
  id: string;
  orderNumber: string | null;
  salesRepName: string | null;
  vesselName: string;
  placeName: string;
  clientName: string;
  status: string;
  products: string;
  totalQuantity: number;
  costBase: number;
  revenueBase: number;
  tpc: number;
  traderCommission: number;
  tradingProfit: number;
  period: string; // YYYY-MM
  deliveredAt: string | null;
  eta: string | null;
  createdAt: string;
}

interface MonthGroup {
  label: string;
  rows: DealRow[];
  buy: number;
  sell: number;
  tpc: number;
  commission: number;
  profit: number;
  turnover: number;
  qty: number;
}

//  Deals — the deal-economics register (Riviera "DEALS" sheet): one row per
//  confirmed-and-beyond deal with buy/sell/TPC/trader commission/trading
//  profit, grouped by month with subtotals. Restricted to money-privileged
//  roles on tenants with the 'deal-economics' view enabled (enforced
//  server-side too). Per-user/role view customization may replace the role
//  check later.

@Component({
  selector: 'app-deals-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="p-4 sm:p-6 lg:p-8">
      <!-- Header -->
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 class="text-xl font-bold text-gray-900 dark:text-ink">Deals</h1>
          <p class="text-sm text-gray-500 dark:text-muted">Confirmed and beyond — full deal economics, USD.</p>
        </div>
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-gray-600 dark:text-ink-dim" [class.opacity-40]="dateBasis() !== 'delivery'">Delivery</span>
            <button type="button" role="switch" [attr.aria-checked]="dateBasis() === 'created'"
              (click)="onDateBasisChange()"
              class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
              [class.bg-brand-700]="dateBasis() === 'created'"
              [class.bg-surface-3]="dateBasis() !== 'created'">
              <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                [class.translate-x-5]="dateBasis() === 'created'"
                [class.translate-x-0]="dateBasis() !== 'created'"></span>
            </button>
            <span class="text-sm font-medium text-gray-600 dark:text-ink-dim" [class.opacity-40]="dateBasis() !== 'created'">Created</span>
          </div>
          <select [ngModel]="year()" (ngModelChange)="onYearChange($event)" class="app-input w-32 bg-white dark:bg-surface">
            @for (y of yearOptions; track y) {
              <option [value]="y">{{ y === 0 ? 'All time' : y }}</option>
            }
          </select>
        </div>
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-20">
          <svg class="h-7 w-7 animate-spin text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else if (groups().length === 0) {
        <div class="app-panel p-10 text-center text-sm text-gray-500 dark:text-muted">
          No confirmed deals in the selected period.
        </div>
      } @else {
        <div class="app-panel overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200 dark:border-line text-left text-xs uppercase tracking-wider text-gray-500 dark:text-muted">
                <th class="px-3 py-2.5">No.</th>
                <th class="px-3 py-2.5">Trader</th>
                <th class="px-3 py-2.5">Vessel</th>
                <th class="px-3 py-2.5">Port</th>
                <th class="px-3 py-2.5">Customer</th>
                <th class="px-3 py-2.5">Product</th>
                <th class="px-3 py-2.5 text-right">Qty (MT)</th>
                <th class="px-3 py-2.5 text-right">Buy</th>
                <th class="px-3 py-2.5 text-right">Sell</th>
                <th class="px-3 py-2.5 text-right">TPC</th>
                <th class="px-3 py-2.5 text-right">Commission</th>
                <th class="px-3 py-2.5 text-right">Trading Profit</th>
                <th class="px-3 py-2.5 text-right">Turnover</th>
                <th class="px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              @for (group of groups(); track group.label) {
                <!-- Month subtotal header row (Mario's sheet: monthly totals) -->
                <tr class="bg-gray-50 dark:bg-bg-2 border-b border-gray-200 dark:border-line">
                  <td class="px-3 py-2 font-semibold text-gray-900 dark:text-ink" colspan="7">{{ group.label }}</td>
                  <td class="px-3 py-2 text-right tabular-nums font-medium">{{ group.buy | number:'1.0-0' }}</td>
                  <td class="px-3 py-2 text-right tabular-nums font-medium">{{ group.sell | number:'1.0-0' }}</td>
                  <td class="px-3 py-2 text-right tabular-nums font-medium">{{ group.tpc | number:'1.0-0' }}</td>
                  <td class="px-3 py-2 text-right tabular-nums font-medium">{{ group.commission | number:'1.0-0' }}</td>
                  <td class="px-3 py-2 text-right tabular-nums font-semibold"
                    [class.text-green-700]="group.profit > 0" [class.text-red-600]="group.profit < 0">
                    {{ group.profit | number:'1.0-0' }}</td>
                  <td class="px-3 py-2 text-right tabular-nums font-medium">{{ group.turnover | number:'1.0-0' }}</td>
                  <td></td>
                </tr>
                @for (d of group.rows; track d.id) {
                  <tr class="border-b border-gray-100 dark:border-line/60 hover:bg-gray-50/60 dark:hover:bg-bg-2/60 cursor-pointer" (click)="openDeal(d)">
                    <td class="px-3 py-2 font-mono text-xs text-gray-600 dark:text-ink-dim whitespace-nowrap">{{ d.orderNumber }}</td>
                    <td class="px-3 py-2 text-gray-700 dark:text-ink-dim">{{ d.salesRepName || '—' }}</td>
                    <td class="px-3 py-2 text-gray-900 dark:text-ink">{{ d.vesselName }}</td>
                    <td class="px-3 py-2 text-gray-600 dark:text-ink-dim">{{ d.placeName }}</td>
                    <td class="px-3 py-2 text-gray-900 dark:text-ink">{{ d.clientName }}</td>
                    <td class="px-3 py-2 text-gray-600 dark:text-ink-dim">{{ d.products || '—' }}</td>
                    <td class="px-3 py-2 text-right tabular-nums">{{ d.totalQuantity | number:'1.0-0' }}</td>
                    <td class="px-3 py-2 text-right tabular-nums">{{ d.costBase | number:'1.0-0' }}</td>
                    <td class="px-3 py-2 text-right tabular-nums">{{ d.revenueBase | number:'1.0-0' }}</td>
                    <td class="px-3 py-2 text-right tabular-nums">{{ d.tpc | number:'1.0-0' }}</td>
                    <td class="px-3 py-2 text-right tabular-nums">{{ d.traderCommission | number:'1.0-0' }}</td>
                    <td class="px-3 py-2 text-right tabular-nums font-medium"
                      [class.text-green-700]="d.tradingProfit > 0" [class.text-red-600]="d.tradingProfit < 0">
                      {{ d.tradingProfit | number:'1.0-0' }}</td>
                    <td class="px-3 py-2 text-right tabular-nums">{{ d.revenueBase | number:'1.0-0' }}</td>
                    <td class="px-3 py-2"><span class="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-muted">{{ d.status }}</span></td>
                  </tr>
                }
              }
            </tbody>
            <tfoot>
              <tr class="border-t-2 border-gray-300 dark:border-line-strong bg-brand-50/40 dark:bg-brand-500/5 font-semibold">
                <td class="px-3 py-3 text-gray-900 dark:text-ink" colspan="7">Total — {{ totalRow().count }} deals</td>
                <td class="px-3 py-3 text-right tabular-nums">{{ totalRow().buy | number:'1.0-0' }}</td>
                <td class="px-3 py-3 text-right tabular-nums">{{ totalRow().sell | number:'1.0-0' }}</td>
                <td class="px-3 py-3 text-right tabular-nums">{{ totalRow().tpc | number:'1.0-0' }}</td>
                <td class="px-3 py-3 text-right tabular-nums">{{ totalRow().commission | number:'1.0-0' }}</td>
                <td class="px-3 py-3 text-right tabular-nums"
                  [class.text-green-700]="totalRow().profit > 0" [class.text-red-600]="totalRow().profit < 0">
                  {{ totalRow().profit | number:'1.0-0' }}</td>
                <td class="px-3 py-3 text-right tabular-nums">{{ totalRow().turnover | number:'1.0-0' }}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      }
    </div>
  `,
})
export class DealsListPageComponent implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);
  protected auth = inject(AuthService);
  protected views = inject(ViewsService);

  readonly loading = signal(true);
  readonly rows = signal<DealRow[]>([]);
  readonly dateBasis = signal<'delivery' | 'created'>('delivery');
  readonly year = signal<number>(new Date().getFullYear());
  readonly yearOptions: number[] = [0, new Date().getFullYear(), new Date().getFullYear() - 1, new Date().getFullYear() - 2, new Date().getFullYear() - 3];

  /** Restricted: money-privileged roles only (server enforces too). */
  readonly canAccess = computed(() =>
    ['ADMIN', 'FINANCE', 'CREDITMANAGER'].includes(this.auth.userRole()) && this.views.has('deal-economics'),
  );

  readonly groups = computed<MonthGroup[]>(() => {
    const byMonth = new Map<string, DealRow[]>();
    for (const d of this.rows()) {
      const list = byMonth.get(d.period) ?? [];
      list.push(d);
      byMonth.set(d.period, list);
    }
    return Array.from(byMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, rows]) => {
        const [y, m] = period.split('-');
        const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
        return {
          label,
          rows,
          qty: rows.reduce((s, r) => s + r.totalQuantity, 0),
          buy: rows.reduce((s, r) => s + r.costBase, 0),
          sell: rows.reduce((s, r) => s + r.revenueBase, 0),
          tpc: rows.reduce((s, r) => s + r.tpc, 0),
          commission: rows.reduce((s, r) => s + r.traderCommission, 0),
          profit: rows.reduce((s, r) => s + r.tradingProfit, 0),
          turnover: rows.reduce((s, r) => s + r.revenueBase, 0),
        };
      });
  });

  readonly totalRow = computed(() => {
    const rows = this.rows();
    return {
      count: rows.length,
      buy: rows.reduce((s, r) => s + r.costBase, 0),
      sell: rows.reduce((s, r) => s + r.revenueBase, 0),
      tpc: rows.reduce((s, r) => s + r.tpc, 0),
      commission: rows.reduce((s, r) => s + r.traderCommission, 0),
      profit: rows.reduce((s, r) => s + r.tradingProfit, 0),
      turnover: rows.reduce((s, r) => s + r.revenueBase, 0),
    };
  });

  ngOnInit(): void {
    void this.views.load().then(() => {
      if (!this.canAccess()) {
        this.router.navigate(['/dashboard']);
        return;
      }
      void this.load();
    });
  }

  onDateBasisChange(): void {
    this.dateBasis.set(this.dateBasis() === 'delivery' ? 'created' : 'delivery');
    void this.load();
  }

  onYearChange(year: string | number): void {
    this.year.set(Number(year));
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const params = new URLSearchParams({ dateBasis: this.dateBasis() });
      const y = this.year();
      if (y > 0) {
        params.set('from', `${y}-01-01`);
        params.set('to', `${y}-12-31`);
      }
      const res = await firstValueFrom(
        this.http.get<ApiResponse<DealRow[]>>(`${API}/orders/deal-economics?${params.toString()}`),
      );
      this.rows.set(res.data ?? []);
    } catch {
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  openDeal(row: DealRow): void {
    if (row.orderNumber) this.router.navigate(['/trading/orders', row.orderNumber]);
  }
}