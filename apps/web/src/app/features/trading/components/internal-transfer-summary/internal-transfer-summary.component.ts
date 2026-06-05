// ═══════════════════════════════════════════════════════════════════════
//  Internal Transfer Summary — header card for INTERNAL_TRANSFER orders.
//
//  Renders source / destination companies and warehouses inline at the top
//  of the order detail page. Read-only by design; structural transfer fields
//  are set at creation time and edited via the sides editor below.
// ═══════════════════════════════════════════════════════════════════════

import {
  Component,
  ChangeDetectionStrategy,
  input,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import type { OrderTransferDto } from '@fueld/types';

@Component({
  selector: 'app-internal-transfer-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    @if (transfer(); as t) {
      <div class="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
              Internal transfer
            </span>
            @if (t.plannedArrivalAt) {
              <span class="text-xs text-gray-600">
                Planned arrival
                <strong class="text-gray-900">{{ t.plannedArrivalAt | date:'mediumDate' }}</strong>
              </span>
            }
          </div>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
          <!-- Source -->
          <div class="rounded-xl border border-gray-200 bg-white p-4">
            <p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Source</p>
            <p class="mt-1 text-sm font-semibold text-gray-900">{{ t.sourceCompanyName }}</p>
            <p class="mt-0.5 text-xs text-gray-500">{{ t.sourceWarehouseName }}</p>
          </div>

          <!-- Arrow -->
          <div class="hidden items-center justify-center md:flex">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </div>

          <!-- Destination -->
          <div class="rounded-xl border border-gray-200 bg-white p-4">
            <p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Destination</p>
            <p class="mt-1 text-sm font-semibold text-gray-900">{{ t.destinationCompanyName }}</p>
            <p class="mt-0.5 text-xs text-gray-500">{{ t.destinationWarehouseName }}</p>
          </div>
        </div>
      </div>
    }
  `,
})
export class InternalTransferSummaryComponent {
  readonly transfer = input<OrderTransferDto | null>(null);
}
