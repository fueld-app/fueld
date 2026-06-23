import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import type { SupplierNominationSummaryDto } from '@fueld/types';

@Component({
  selector: 'app-order-delivery-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm h-full max-h-[520px] flex flex-col">
      <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim uppercase tracking-wider">Delivery Details</h3>
      <div class="mt-3">
        <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">Delivery Method</label>
        <select
          [ngModel]="deliveryMethod()"
          (ngModelChange)="deliveryMethodChange.emit($event)"
          class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 bg-white dark:bg-surface"
        >
          <option value="">— Select —</option>
          @for (m of deliveryMethodOptions(); track m) {
            <option [value]="m">{{ m }}</option>
          }
        </select>
      </div>
      <div class="mt-3">
        <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">
          Delivered At
          @if (hasMultipleSuppliers() && supplierLabel()) {
            <span class="text-gray-400 dark:text-muted">for {{ supplierLabel() }}</span>
          }
          @if (timezoneAbbr()) {
            <span class="text-gray-400 dark:text-muted">({{ timezoneAbbr() }})</span>
          }
        </label>
        <input
          type="date"
          [ngModel]="deliveredAtLocal()"
          (ngModelChange)="deliveredAtChange.emit($event)"
          class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
        />
      </div>
      <p class="mt-3 text-xs text-gray-400 dark:text-muted">
        Delivered quantities can be edited in the items grid above.
        The final invoice will use delivered quantities.
      </p>

      @if (nomination(); as n) {
        <div class="mt-4 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/70 p-4 text-sm text-amber-900 dark:text-amber-300">
          <div class="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400">Supplier submission</div>
          <div class="mt-2 space-y-2">
            <div>
              <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700/80">Status</div>
              <div class="mt-1 font-semibold">{{ n.status }}</div>
            </div>
            @if (n.deliveryCompletedAt) {
              <div>
                <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700/80">Supplier exact delivery time</div>
                <div class="mt-1 font-semibold">{{ n.deliveryCompletedAt | date : 'medium' }}</div>
              </div>
            }
            @if (internalDeliveredAt()) {
              <div>
                <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700/80">Internal delivered date</div>
                <div class="mt-1 font-semibold">{{ internalDeliveredAt() }}</div>
              </div>
            }
            @if (dateMismatch()) {
              <div class="rounded-lg border border-amber-300 bg-white/80 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                Supplier-submitted delivery date differs from the internal delivered date.
              </div>
            }
            @if (n.supplierReference) {
              <div>
                <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700/80">Supplier reference</div>
                <div class="mt-1">{{ n.supplierReference }}</div>
              </div>
            }
            @if (n.attachments.length > 0) {
              <div>
                <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700/80">Delivery docs uploaded</div>
                <div class="mt-1 font-semibold">{{ n.attachments.length }}</div>
              </div>
            }
            @if (n.supplierComment) {
              <div>
                <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700/80">Comment</div>
                <div class="mt-1 whitespace-pre-line">{{ n.supplierComment }}</div>
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class OrderDeliveryCardComponent {
  readonly deliveredAtLocal = input<string | null>(null);
  readonly deliveryMethod = input<string | null>(null);
  readonly deliveryMethodOptions = input<string[]>([]);
  readonly deliveryMethodChange = output<string | null>();
  readonly nomination = input<SupplierNominationSummaryDto | null>(null);
  readonly internalDeliveredAt = input<string | null>(null);
  readonly dateMismatch = input(false);
  readonly hasMultipleSuppliers = input(false);
  readonly supplierLabel = input<string | null>(null);
  readonly timezoneAbbr = input<string | null>(null);

  readonly deliveredAtChange = output<string>();
}
