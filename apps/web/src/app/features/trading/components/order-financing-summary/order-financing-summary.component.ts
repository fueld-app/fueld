import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { OrderItemsEconomics } from '../order-items/order-item.types';

@Component({
  selector: 'app-order-financing-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div class="flex flex-wrap items-stretch divide-x divide-gray-100">
        <!-- Gross Profit -->
        <div class="flex flex-1 flex-col items-center justify-center gap-0.5 px-3 py-3 min-w-[100px]">
          <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500">Gross</span>
          <span class="text-sm font-bold tabular-nums" [class.text-green-600]="economics().totalGrossProfit > 0" [class.text-red-600]="economics().totalGrossProfit < 0">
            {{ economics().totalGrossProfit | number:'1.2-2' }}
          </span>
          <span class="text-[9px] text-gray-400">{{ baseCurrency() }}</span>
        </div>

        <!-- Financing Cost -->
        <div class="flex flex-1 flex-col items-center justify-center gap-0.5 px-3 py-3 min-w-[100px]">
          <span class="text-[10px] font-medium uppercase tracking-wider text-amber-700">Financing</span>
          <span class="text-sm font-bold tabular-nums text-amber-800">
            {{ economics().totalFinancingCost | number:'1.2-2' }}
          </span>
          <span class="text-[9px] text-amber-600/60">{{ baseCurrency() }}</span>
        </div>

        <!-- Net Profit -->
        <div class="flex flex-1 flex-col items-center justify-center gap-0.5 px-3 py-3 min-w-[100px]">
          <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500">Net</span>
          <span class="text-sm font-bold tabular-nums" [class.text-green-600]="economics().totalNetProfit > 0" [class.text-red-600]="economics().totalNetProfit < 0">
            {{ economics().totalNetProfit | number:'1.2-2' }}
          </span>
          <span class="text-[9px] text-gray-400">{{ baseCurrency() }}</span>
        </div>

        <!-- Net Margin -->
        <div class="flex flex-1 flex-col items-center justify-center gap-0.5 px-3 py-3 min-w-[80px]">
          <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500">Margin</span>
          <span class="text-sm font-bold tabular-nums text-gray-900">
            {{ (economics().netMarginPct ?? 0) | number:'1.1-1' }}%
          </span>
        </div>

        <!-- Financing / MT -->
        <div class="hidden lg:flex flex-1 flex-col items-center justify-center gap-0.5 px-3 py-3 min-w-[80px]">
          <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500">/ MT</span>
          <span class="text-sm font-bold tabular-nums text-gray-900">
            {{ (economics().financingCostPerMt ?? 0) | number:'1.2-2' }}
          </span>
          <span class="text-[9px] text-gray-400">{{ baseCurrency() }}</span>
        </div>

        <!-- Terms badge -->
        <div class="flex items-center gap-1.5 px-3 py-3 shrink-0">
          <span class="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 whitespace-nowrap">
            {{ (financingRateAnnual() * 100) | number:'1.1-1' }}% · {{ financingDays() }}d
          </span>
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
