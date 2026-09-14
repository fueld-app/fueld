import {
  Component,
  ChangeDetectionStrategy,
  signal,
  input,
  output,
  inject,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, SupplierCreditNoteDto } from '@fueld/types';
import type { DropdownOption } from '@app/shared/components/searchable-dropdown/searchable-dropdown.component';
import { API_URL } from '@app/core/config/api';

/**
 * Supplier credit note modal (Phase 2 credit-note support).
 * POST /orders/:id/supplier-credit-notes
 * Amount is positive — the credit direction (money back) is implicit.
 * When the credit currency differs from the order currency, a manual FX
 * snapshot (rate + converted amount) is captured — no live FX.
 */
@Component({
  selector: 'app-supplier-credit-note-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div class="w-full max-w-lg rounded-xl bg-white dark:bg-surface p-6 shadow-xl max-h-[90vh] overflow-auto">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-ink">Add supplier credit note</h3>
            <button type="button" (click)="close()" class="text-gray-400 dark:text-muted hover:text-gray-600">✕</button>
          </div>
          <p class="mt-1 text-xs text-gray-500 dark:text-muted">
            Money back from the supplier. Received credits reduce the order's net profit; expected credits are shown separately.
          </p>
          <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label class="text-xs font-medium text-gray-500 dark:text-muted">Supplier leg</label>
              <select [ngModel]="legId()" (ngModelChange)="legId.set($event)"
                class="mt-1 w-full appearance-none rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 bg-white dark:bg-surface">
                @for (leg of legOptions(); track leg.value) {
                  <option [value]="leg.value">{{ leg.label }}</option>
                }
              </select>
            </div>
            <div>
              <label class="text-xs font-medium text-gray-500 dark:text-muted">Amount</label>
              <input type="number" min="0" step="0.01" [ngModel]="amount()" (ngModelChange)="amount.set($event); validationError.set('')"
                class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20" />
              @if (validationError()) {
                <p class="mt-1 text-xs text-red-500 dark:text-red-300">{{ validationError() }}</p>
              }
            </div>
            <div>
              <label class="text-xs font-medium text-gray-500 dark:text-muted">Currency</label>
              <select [ngModel]="currency()" (ngModelChange)="currency.set($event)"
                class="mt-1 w-full appearance-none rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm text-gray-700 dark:text-ink-dim uppercase focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 bg-white dark:bg-surface">
                @for (c of currencyOptions(); track c.value) {
                  <option [value]="c.value">{{ c.label }}</option>
                }
              </select>
            </div>
            <div>
              <label class="text-xs font-medium text-gray-500 dark:text-muted">Credit date</label>
              <input type="date" [ngModel]="creditDate()" (ngModelChange)="creditDate.set($event)"
                class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20" />
            </div>
            @if (currency() !== defaultCurrency()) {
              <div>
                <label class="text-xs font-medium text-gray-500 dark:text-muted">FX rate to {{ defaultCurrency() }} (manual)</label>
                <input type="number" min="0" step="0.00000001" [ngModel]="fxRate()" (ngModelChange)="fxRate.set($event)"
                  class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20" />
              </div>
            }
            <div>
              <label class="text-xs font-medium text-gray-500 dark:text-muted">Supplier's CN reference</label>
              <input type="text" [ngModel]="reference()" (ngModelChange)="reference.set($event)" placeholder="e.g. CN-4482"
                class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20" />
            </div>
            <div>
              <label class="text-xs font-medium text-gray-500 dark:text-muted">Reason</label>
              <select [ngModel]="reason()" (ngModelChange)="reason.set($event)"
                class="mt-1 w-full appearance-none rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 bg-white dark:bg-surface">
                <option value="PRICE_CORRECTION">Price correction</option>
                <option value="QUANTITY_SHORTAGE">Quantity shortage</option>
                <option value="QUALITY_CLAIM">Quality claim</option>
                <option value="REBATE">Rebate</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label class="text-xs font-medium text-gray-500 dark:text-muted">Status</label>
              <select [ngModel]="status()" (ngModelChange)="status.set($event)"
                class="mt-1 w-full appearance-none rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 bg-white dark:bg-surface">
                <option value="EXPECTED">Expected (not in margin yet)</option>
                <option value="RECEIVED">Received (reduces net profit)</option>
              </select>
            </div>
            <div class="sm:col-span-2">
              <label class="text-xs font-medium text-gray-500 dark:text-muted">Note</label>
              <textarea rows="2" [ngModel]="note()" (ngModelChange)="note.set($event)" placeholder="Optional context"
                class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"></textarea>
            </div>
          </div>
          <div class="mt-5 flex items-center justify-end gap-3">
            <button type="button" (click)="close()"
              class="rounded-lg border border-gray-300 dark:border-line-strong px-4 py-2 text-sm font-medium text-gray-600 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-white/5">
              Cancel
            </button>
            <button type="button" (click)="submit()" [disabled]="saving()"
              class="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-800 disabled:opacity-50">
              {{ saving() ? 'Saving…' : 'Add credit note' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class SupplierCreditNoteModalComponent {
  private readonly http = inject(HttpClient);

  readonly orderId = input.required<string>();
  readonly legOptions = input<DropdownOption[]>([]);
  readonly currencyOptions = input<DropdownOption[]>([]);
  readonly defaultCurrency = input('USD');

  readonly saved = output<void>();
  readonly closed = output<void>();

  readonly open = signal(false);
  readonly saving = signal(false);
  readonly validationError = signal('');
  readonly legId = signal('');
  readonly amount = signal<number | string>('');
  readonly currency = signal('USD');
  readonly creditDate = signal('');
  readonly fxRate = signal<number | string>('');
  readonly reference = signal('');
  readonly reason = signal('PRICE_CORRECTION');
  readonly status = signal<'EXPECTED' | 'RECEIVED'>('EXPECTED');
  readonly note = signal('');

  openModal(): void {
    this.legId.set(this.legOptions()[0]?.value ?? '');
    this.amount.set('');
    this.currency.set(this.defaultCurrency());
    this.creditDate.set(this.todayLocal());
    this.fxRate.set('');
    this.reference.set('');
    this.reason.set('PRICE_CORRECTION');
    this.status.set('EXPECTED');
    this.note.set('');
    this.validationError.set('');
    this.open.set(true);
  }

  close(): void {
    this.open.set(false);
    this.closed.emit();
  }

  private todayLocal(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  async submit(): Promise<void> {
    const amountStr = String(this.amount() ?? '').trim();
    const amountNum = Number(amountStr);
    if (!amountStr || !Number.isFinite(amountNum) || amountNum <= 0) {
      this.validationError.set('Amount must be a positive number.');
      return;
    }
    if (!this.legId()) {
      this.validationError.set('Select a supplier leg.');
      return;
    }

    this.saving.set(true);
    try {
      const creditDateIso = this.creditDate() ? new Date(`${this.creditDate()}T12:00:00`).toISOString() : undefined;
      const rateNum = Number(this.fxRate());
      const res = await firstValueFrom(
        this.http.post<ApiResponse<SupplierCreditNoteDto>>(
          `${API_URL}/orders/${this.orderId()}/supplier-credit-notes`,
          {
            orderSupplierId: this.legId(),
            amount: amountStr,
            currency: this.currency().trim() || this.defaultCurrency(),
            fxRate: this.fxRate() !== '' && this.fxRate() != null ? String(this.fxRate()) : null,
            amountInOrderCurrency: this.fxRate() !== '' && this.fxRate() != null
              ? (amountNum * Number(this.fxRate())).toFixed(2)
              : null,
            creditDate: creditDateIso,
            supplierReference: this.reference() || null,
            reason: this.reason(),
            status: this.status(),
            note: this.note() || null,
          },
        ),
      );
      if (res.success) {
        this.open.set(false);
        this.saved.emit();
      } else {
        this.validationError.set(res.message ?? 'Failed to save credit note.');
      }
    } catch {
      this.validationError.set('Failed to save credit note.');
    } finally {
      this.saving.set(false);
    }
  }
}