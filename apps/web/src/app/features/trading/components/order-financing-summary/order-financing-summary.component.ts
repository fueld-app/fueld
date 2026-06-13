import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { OrderItemsEconomics } from '../order-items/order-item.types';

@Component({
  selector: 'app-order-financing-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <div class="flex items-center gap-2">
          <h3 class="text-xs font-semibold uppercase tracking-[0.15em] text-gray-600">P&amp;L</h3>
          <span class="text-[11px] text-gray-400">·</span>
          <span class="text-xs text-gray-500">{{ baseCurrency() }}</span>
        </div>
        <span class="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
          {{ (financingRateAnnual() * 100) | number:'1.1-1' }}% · {{ financingDays() }}d
        </span>
      </div>

      <!-- Metrics -->
      <div class="grid grid-cols-3 divide-x divide-gray-100">
        <!-- Gross Profit -->
        <div class="px-4 py-3">
          <p class="text-[11px] font-medium uppercase tracking-wider text-gray-500">Gross</p>
          <p class="mt-1 text-lg font-bold tabular-nums leading-tight"
            [class.text-green-600]="economics().totalGrossProfit > 0"
            [class.text-red-600]="economics().totalGrossProfit < 0">
            {{ economics().totalGrossProfit | number:'1.2-2' }}
          </p>
        </div>

        <!-- Financing Cost -->
        <div class="px-4 py-3 bg-amber-50/30">
          <p class="text-[11px] font-medium uppercase tracking-wider text-amber-700">Financing</p>
          <p class="mt-1 text-lg font-bold tabular-nums leading-tight text-amber-800">
            {{ economics().totalFinancingCost | number:'1.2-2' }}
          </p>
        </div>

        <!-- Net Profit -->
        <div class="px-4 py-3">
          <p class="text-[11px] font-medium uppercase tracking-wider text-gray-500">Net</p>
          <p class="mt-1 text-lg font-bold tabular-nums leading-tight"
            [class.text-green-600]="economics().totalNetProfit > 0"
            [class.text-red-600]="economics().totalNetProfit < 0">
            {{ economics().totalNetProfit | number:'1.2-2' }}
          </p>
        </div>
      </div>

      <!-- Secondary metrics row -->
      <div class="flex items-center justify-between border-t border-gray-100 px-4 py-2">
        <div class="flex items-center gap-4 text-xs text-gray-500">
          <span>Margin <strong class="text-gray-700">{{ (economics().netMarginPct ?? 0) | number:'1.1-1' }}%</strong></span>
          <span class="hidden sm:inline">Financing/MT <strong class="text-gray-700">{{ (economics().financingCostPerMt ?? 0) | number:'1.2-2' }} {{ baseCurrency() }}</strong></span>
        </div>
        <div class="text-[11px] text-gray-400">
          <span>Qty <strong class="text-gray-600">{{ economics().totalQuantity | number:'1.0-0' }} MT</strong></span>
        </div>
      </div>
    </div>
  `,
})
export class OrderFinancingSummaryComponent {
  readonly baseCurrency = input('USD');
  readonly financingRateAnnual = input(0.08);
  readonly financingDays = input(0);
  readonly financingDayCountConvention = input(365);
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
