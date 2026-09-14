import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { OrderItemsEconomics } from '../order-items/order-item.types';

@Component({
  selector: 'app-order-financing-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm">
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-gray-100 dark:border-line px-4 py-2.5">
        <div class="flex items-center gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-[0.15em] text-gray-600 dark:text-ink-dim">P&amp;L</h3>
          <span class="text-[11px] text-gray-400 dark:text-muted">·</span>
          <span class="text-xs text-gray-500 dark:text-muted">{{ baseCurrency() }}</span>
        </div>
        <span class="rounded-full bg-amber-50 dark:bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
          {{ (financingRateAnnual() * 100) | number:'1.1-1' }}% · {{ financingDays() }}d
        </span>
      </div>

      <!-- Metrics -->
      <div class="grid grid-cols-3 divide-x divide-gray-100 dark:divide-line">
        <!-- Gross Profit -->
        <div class="px-4 py-3">
          <p class="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-muted">Gross</p>
          <p class="mt-1 text-lg font-bold tabular-nums leading-tight"
            [class.text-green-600]="economics().totalGrossProfit > 0"
            [class.text-red-600]="economics().totalGrossProfit < 0">
            {{ economics().totalGrossProfit | number:'1.2-2' }}
          </p>
        </div>

        <!-- Financing Cost -->
        <div class="px-4 py-3 bg-amber-50/30">
          <p class="text-[11px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">Financing</p>
          <p class="mt-1 text-lg font-bold tabular-nums leading-tight text-amber-800 dark:text-amber-300">
            {{ economics().totalFinancingCost | number:'1.2-2' }}
          </p>
        </div>

        <!-- Trading Profit (gross − TPC − trader commission) — deal-economics view -->
        @if (hasCommissions()) {
          <div class="px-4 py-3">
            <p class="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-muted">Trading</p>
            <p class="mt-1 text-lg font-bold tabular-nums leading-tight"
              [class.text-green-600]="(tradingProfit() ?? 0) > 0"
              [class.text-red-600]="(tradingProfit() ?? 0) < 0">
              {{ (tradingProfit() ?? 0) | number:'1.2-2' }}
            </p>
          </div>
        }

        <!-- Net Profit -->
        <div class="px-4 py-3">
          <p class="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-muted">Net</p>
          <p class="mt-1 text-lg font-bold tabular-nums leading-tight"
            [class.text-green-600]="economics().totalNetProfit > 0"
            [class.text-red-600]="economics().totalNetProfit < 0">
            {{ economics().totalNetProfit | number:'1.2-2' }}
          </p>
        </div>
      </div>

      <!-- Supplier credits adjustment row (only when credits exist) -->
      @if ((totalSupplierCredits() ?? 0) > 0 || (expectedSupplierCredits() ?? 0) > 0) {
        <div class="flex items-center justify-between border-t border-gray-100 dark:border-line px-4 py-2 text-xs">
          <div class="flex items-center gap-4">
            @if ((totalSupplierCredits() ?? 0) > 0) {
              <span>Supplier credits (received) <strong class="text-emerald-600 dark:text-emerald-400">−{{ totalSupplierCredits() | number:'1.2-2' }}</strong></span>
              <span class="text-gray-500 dark:text-muted">Net after credits
                <strong [class.text-green-600]="(netProfitAfterCredits() ?? 0) > 0"
                        [class.text-red-600]="(netProfitAfterCredits() ?? 0) < 0"
                        class="tabular-nums">{{ netProfitAfterCredits() | number:'1.2-2' }}</strong>
              </span>
            }
            @if ((expectedSupplierCredits() ?? 0) > 0) {
              <span class="text-amber-600 dark:text-amber-400">Expected credits {{ expectedSupplierCredits() | number:'1.2-2' }} (not in margin)</span>
            }
          </div>
        </div>
      }

      <!-- Secondary metrics row -->
      <div class="flex items-center justify-between border-t border-gray-100 dark:border-line px-4 py-2">
        <div class="flex items-center gap-4 text-xs text-gray-500 dark:text-muted">
          <span>Margin <strong class="text-gray-700 dark:text-ink-dim">{{ (economics().netMarginPct ?? 0) | number:'1.1-1' }}%</strong></span>
          <span class="hidden sm:inline">Financing/MT <strong class="text-gray-700 dark:text-ink-dim">{{ (economics().financingCostPerMt ?? 0) | number:'1.2-2' }} {{ baseCurrency() }}</strong></span>
        </div>
        <div class="text-[11px] text-gray-400 dark:text-muted">
          <span>Qty <strong class="text-gray-600 dark:text-ink-dim">{{ economics().totalQuantity | number:'1.0-0' }} MT</strong></span>
        </div>
      </div>
    </div>
  `,
})
export class OrderFinancingSummaryComponent {
  readonly baseCurrency = input('USD');
  readonly hasCommissions = input(false);
  readonly tradingProfit = input<number | null>(null);
  readonly financingRateAnnual = input(0.08);
  readonly financingDays = input(0);
  readonly financingDayCountConvention = input(365);
  /** Received supplier credits (positive) — shown with the net-after-credits figure. */
  readonly totalSupplierCredits = input<number | null>(null);
  readonly expectedSupplierCredits = input<number | null>(null);
  readonly netProfitAfterCredits = input<number | null>(null);
  readonly economics = input<OrderItemsEconomics>({
    totalQuantity: 0,
    totalCost: 0,
    totalRevenue: 0,
    totalGrossProfit: 0,
    totalFinancingCost: 0,
    financingCostPerMt: null,
    totalNetProfit: 0,
    netMarginPct: null,
  });
}
