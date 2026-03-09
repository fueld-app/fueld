import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { OrderItemsEconomics } from '../order-items/order-items.component';

@Component({
  selector: 'app-order-financing-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <div class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-700">Financing Summary</h3>
          <p class="mt-1 text-xs text-gray-500">Net margin after financing based on buy value and payment-day spread.</p>
        </div>
        <div class="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
          {{ (financingRateAnnual() * 100) | number:'1.2-2' }}% p.a. · {{ financingDays() }} day{{ financingDays() === 1 ? '' : 's' }}
        </div>
      </div>

      <div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div class="rounded-xl border border-gray-200 bg-gray-50/70 p-4">
          <p class="text-xs font-medium uppercase tracking-wider text-gray-500">Gross Profit</p>
          <p class="mt-2 text-2xl font-semibold" [class.text-green-600]="economics().totalGrossProfit > 0" [class.text-red-600]="economics().totalGrossProfit < 0">
            {{ economics().totalGrossProfit | number:'1.2-2' }} {{ baseCurrency() }}
          </p>
        </div>
        <div class="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <p class="text-xs font-medium uppercase tracking-wider text-amber-700">Financing Cost</p>
          <p class="mt-2 text-2xl font-semibold text-amber-800">
            {{ economics().totalFinancingCost | number:'1.2-2' }} {{ baseCurrency() }}
          </p>
        </div>
        <div class="rounded-xl border border-gray-200 bg-gray-50/70 p-4">
          <p class="text-xs font-medium uppercase tracking-wider text-gray-500">Net Profit</p>
          <p class="mt-2 text-2xl font-semibold" [class.text-green-600]="economics().totalNetProfit > 0" [class.text-red-600]="economics().totalNetProfit < 0">
            {{ economics().totalNetProfit | number:'1.2-2' }} {{ baseCurrency() }}
          </p>
        </div>
        <div class="rounded-xl border border-gray-200 bg-gray-50/70 p-4">
          <p class="text-xs font-medium uppercase tracking-wider text-gray-500">Net Margin</p>
          <p class="mt-2 text-2xl font-semibold text-gray-900">
            {{ (economics().netMarginPct ?? 0) | number:'1.2-2' }}%
          </p>
        </div>
        <div class="rounded-xl border border-gray-200 bg-gray-50/70 p-4">
          <p class="text-xs font-medium uppercase tracking-wider text-gray-500">Financing / MT</p>
          <p class="mt-2 text-2xl font-semibold text-gray-900">
            {{ (economics().financingCostPerMt ?? 0) | number:'1.2-2' }} {{ baseCurrency() }}
          </p>
        </div>
        <div class="rounded-xl border border-gray-200 bg-gray-50/70 p-4">
          <p class="text-xs font-medium uppercase tracking-wider text-gray-500">Day Count</p>
          <p class="mt-2 text-2xl font-semibold text-gray-900">{{ financingDayCountConvention() }}</p>
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