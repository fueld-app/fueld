import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import type { CustomerPaymentDto } from '@fueld/types';

@Component({
  selector: 'app-order-payments-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe],
  template: `
    <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm h-full max-h-[520px] flex flex-col">
      <div class="flex items-center justify-between gap-4">
        <div>
          <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim uppercase tracking-wider">Payments</h3>
          <p class="mt-1 text-xs text-gray-500 dark:text-muted">
            @if (canSeePrices()) {
              Total paid: {{ paymentsTotal() | number:'1.2-2' }} {{ currency() }}
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
      <div class="mt-4 flex-1 overflow-auto">
        @if (canSeePrices()) {
          @if (loading()) {
            <p class="text-sm text-gray-400 dark:text-muted">Loading payments...</p>
          } @else if (payments().length === 0) {
            <p class="text-sm text-gray-400 dark:text-muted">No payments recorded yet.</p>
          } @else {
            <ul class="divide-y divide-gray-100 dark:divide-line">
              @for (payment of payments(); track payment.id) {
                <li class="flex items-start justify-between gap-4 py-3 text-sm">
                  <div>
                    <div class="font-semibold text-gray-900 dark:text-ink">
                      {{ payment.amount }} {{ payment.currency }}
                    </div>
                    <div class="mt-0.5 text-xs text-gray-500 dark:text-muted">
                      {{ payment.receivedAt | date : 'mediumDate' }}
                      @if (payment.method) { · {{ payment.method }} }
                    </div>
                    @if (payment.note) {
                      <div class="mt-1 text-xs text-gray-600 dark:text-ink-dim whitespace-pre-line">{{ payment.note }}</div>
                    }
                  </div>
                  <div class="text-xs text-gray-400 dark:text-muted">{{ payment.createdAt | date : 'short' }}</div>
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
export class OrderPaymentsCardComponent {
  readonly payments = input<CustomerPaymentDto[]>([]);
  readonly paymentsTotal = input(0);
  readonly currency = input('USD');
  readonly loading = input(false);
  readonly canSeePrices = input(false);
  readonly canRecordPayment = input(false);

  readonly addPayment = output<void>();
}
