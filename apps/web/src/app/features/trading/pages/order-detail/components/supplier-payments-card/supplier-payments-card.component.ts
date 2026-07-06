import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import type { SupplierPaymentDto } from '@fueld/types';

/**
 * Per-leg supplier payments card (two-sided order settlement).
 * Mirrors the customer-side OrderPaymentsCard but adds a cost-due comparison
 * and a "Mark supplier paid" action enabled when paid >= cost.
 */
@Component({
  selector: 'app-supplier-payments-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe],
  template: `
    <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm h-full max-h-[520px] flex flex-col">
      <div class="flex items-center justify-between gap-4">
        <div>
          <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim uppercase tracking-wider">Supplier Payments</h3>
          <p class="mt-1 text-xs text-gray-500 dark:text-muted">
            @if (canSeePrices()) {
              Paid: {{ paymentsTotal() | number:'1.2-2' }} / {{ legCost() | number:'1.2-2' }} {{ currency() }}
            } @else {
              Payment details hidden
            }
          </p>
        </div>
        @if (canRecordPayment()) {
          <button
            type="button"
            (click)="addPayment.emit()"
            class="inline-flex items-center justify-center rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold
                   text-white shadow-sm transition-colors hover:bg-brand-800 disabled:opacity-50"
          >
            Add payment
          </button>
        }
      </div>

      @if (canSeePrices() && legCost() > 0) {
        <div class="mt-3">
          @if (isFullyPaid()) {
            <span class="inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-500/30">
              Settled {{ paidAt() ? (paidAt() | date : 'mediumDate') : '' }}
            </span>
          } @else {
            <span class="inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-500/30">
              Outstanding: {{ outstanding() | number:'1.2-2' }} {{ currency() }}
            </span>
          }
        </div>
      }

      <div class="mt-4 flex-1 overflow-auto">
        @if (canSeePrices()) {
          @if (loading()) {
            <p class="text-sm text-gray-400 dark:text-muted">Loading supplier payments...</p>
          } @else if (payments().length === 0) {
            <p class="text-sm text-gray-400 dark:text-muted">No supplier payments recorded yet.</p>
          } @else {
            <ul class="divide-y divide-gray-100 dark:divide-line">
              @for (payment of payments(); track payment.id) {
                <li class="flex items-start justify-between gap-4 py-3 text-sm">
                  <div>
                    <div class="font-semibold text-gray-900 dark:text-ink">
                      {{ payment.amount }} {{ payment.currency }}
                    </div>
                    <div class="mt-0.5 text-xs text-gray-500 dark:text-muted">
                      {{ payment.paidAt | date : 'mediumDate' }}
                      @if (payment.method) { · {{ payment.method }} }
                    </div>
                    @if (payment.note) {
                      <div class="mt-1 text-xs text-gray-600 dark:text-ink-dim whitespace-pre-line">{{ payment.note }}</div>
                    }
                  </div>
                  @if (canRecordPayment()) {
                    <button
                      type="button"
                      (click)="deletePayment.emit(payment.id)"
                      class="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      aria-label="Delete supplier payment"
                    >
                      Remove
                    </button>
                  }
                </li>
              }
            </ul>
          }
        } @else {
          <div class="flex-1 overflow-auto flex items-center justify-center">
            <p class="text-sm text-gray-400 dark:text-muted italic">Payment information is not available for your role.</p>
          </div>
        }
      </div>
    </div>
  `,
})
export class SupplierPaymentsCardComponent {
  readonly payments = input<SupplierPaymentDto[]>([]);
  readonly paymentsTotal = input(0);
  readonly legCost = input(0);
  readonly currency = input('USD');
  readonly loading = input(false);
  readonly canSeePrices = input(false);
  readonly canRecordPayment = input(false);
  readonly paidAt = input<string | null>(null);

  readonly addPayment = output<void>();
  readonly deletePayment = output<string>();

  isFullyPaid(): boolean {
    return this.paymentsTotal() >= this.legCost() - 0.005 && this.legCost() > 0;
  }

  outstanding(): number {
    return Math.max(this.legCost() - this.paymentsTotal(), 0);
  }
}