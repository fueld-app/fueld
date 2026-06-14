import {
  Component,
  ChangeDetectionStrategy,
  signal,
  input,
  output,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, CustomerPaymentDto } from '@fueld/types';
import type { DropdownOption } from '@app/shared/components/searchable-dropdown/searchable-dropdown.component';
import { API_URL } from '@app/core/config/api';

@Component({
  selector: 'app-order-payment-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div class="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold text-gray-900">Record payment</h3>
            <button type="button" (click)="close()" class="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label class="text-xs font-medium text-gray-500">Amount</label>
              <input type="number" min="0" [ngModel]="amount()" (ngModelChange)="amount.set($event); validationError.set('')"
                class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
              @if (validationError()) {
                <p class="mt-1 text-xs text-red-500">{{ validationError() }}</p>
              }
            </div>
            <div>
              <label class="text-xs font-medium text-gray-500">Currency</label>
              <select [ngModel]="currency()" (ngModelChange)="currency.set($event)"
                class="fueld-select-no-chevron mt-1 w-full appearance-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 uppercase focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 bg-white">
                @for (c of currencyOptions(); track c.value) {
                  <option [value]="c.value">{{ c.label }}</option>
                }
              </select>
            </div>
            <div>
              <label class="text-xs font-medium text-gray-500">Received at</label>
              <input type="date" [ngModel]="receivedAt()" (ngModelChange)="receivedAt.set($event)"
                class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
            </div>
            <div>
              <label class="text-xs font-medium text-gray-500">Method</label>
              <input type="text" [ngModel]="method()" (ngModelChange)="method.set($event)" placeholder="Wire, ACH, card"
                class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
            </div>
          </div>
          <div class="mt-3">
            <label class="text-xs font-medium text-gray-500">Note</label>
            <textarea rows="3" [ngModel]="note()" (ngModelChange)="note.set($event)"
              class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"></textarea>
          </div>
          <div class="mt-5 flex items-center justify-end gap-3">
            <button type="button" (click)="close()"
              class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600">Cancel</button>
            <button type="button" (click)="submit()" [disabled]="saving()"
              class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50">
              Record payment
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class OrderPaymentModalComponent {
  private readonly http = inject(HttpClient);

  readonly orderId = input.required<string>();
  readonly currencyOptions = input<DropdownOption[]>([]);
  readonly defaultCurrency = input('USD');
  readonly todayLocal = input('');

  readonly saved = output<void>();
  readonly closed = output<void>();

  readonly open = signal(false);
  readonly saving = signal(false);
  readonly validationError = signal('');
  readonly amount = signal<number | string>('');
  readonly currency = signal('USD');
  readonly receivedAt = signal('');
  readonly method = signal('');
  readonly note = signal('');

  openModal(): void {
    this.amount.set('');
    this.currency.set(this.defaultCurrency());
    this.receivedAt.set(this.todayLocal());
    this.method.set('');
    this.note.set('');
    this.open.set(true);
  }

  close(): void {
    this.open.set(false);
    this.closed.emit();
  }

  async submit(): Promise<void> {
    const id = this.orderId();
    const amountStr = String(this.amount() ?? '').trim();
    if (!amountStr) {
      this.validationError.set('Amount is required.');
      return;
    }

    this.saving.set(true);
    try {
      const receivedIso = this.receivedAt() ? new Date(`${this.receivedAt()}T12:00:00`).toISOString() : undefined;
      await firstValueFrom(
        this.http.post<ApiResponse<CustomerPaymentDto>>(`${API_URL}/orders/${id}/payments`, {
          amount: amountStr,
          currency: this.currency().trim() || this.defaultCurrency(),
          receivedAt: receivedIso,
          method: this.method() || null,
          note: this.note() || null,
        }),
      );
      this.open.set(false);
      this.saved.emit();
    } catch {
      // Error handled by parent via toast
    } finally {
      this.saving.set(false);
    }
  }
}
