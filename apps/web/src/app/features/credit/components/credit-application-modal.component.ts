import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  input,
  output,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type {
  CreditApplicationDto,
  CreateCreditApplicationDto,
  CreditLineType,
  ApiResponse,
} from '@fueld/types';
import { API } from '@app/core/config/api';

@Component({
  selector: 'app-credit-application-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="close()">
        <div class="rounded-xl bg-white p-6 shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" (click)="$event.stopPropagation()">
          <h3 class="text-lg font-semibold text-gray-900">
            Apply for Credit
          </h3>
          <p class="mt-1 text-sm text-gray-500">
            Submit a credit application for
            <strong>{{ counterpartyName() }}</strong>.
            This will be reviewed by credit managers.
          </p>

          @if (error()) {
            <div class="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{{ error() }}</div>
          }

          @if (success()) {
            <div class="mt-3 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">
              Credit application submitted successfully! It will be reviewed by credit managers.
            </div>
          } @else {
            <div class="mt-4 space-y-4">
              <!-- Type -->
              <div>
                <label class="block text-sm font-medium text-gray-700">Credit Type *</label>
                <select [ngModel]="type()" (ngModelChange)="type.set($event)"
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white">
                  <option value="CUSTOMER">Customer Credit</option>
                  <option value="SUPPLIER">Supplier Credit</option>
                </select>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <!-- Amount -->
                <div>
                  <label class="block text-sm font-medium text-gray-700">Requested Amount *</label>
                  <input type="number" step="0.01" [ngModel]="amount()" (ngModelChange)="amount.set(normalizeAmountInput($event))"
                    placeholder="100000"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
                </div>
                <!-- Currency -->
                <div>
                  <label class="block text-sm font-medium text-gray-700">Currency *</label>
                  <select [ngModel]="currency()" (ngModelChange)="currency.set($event)"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white">
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="SGD">SGD</option>
                  </select>
                </div>
              </div>

              <!-- Days -->
              <div>
                <label class="block text-sm font-medium text-gray-700">Credit Period (days)</label>
                <input type="number" [ngModel]="days()" (ngModelChange)="days.set(normalizeDaysInput($event))"
                  placeholder="30"
                  class="mt-1 w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
              </div>

              <!-- Reason -->
              <div>
                <label class="block text-sm font-medium text-gray-700">Reason / Justification</label>
                <textarea [ngModel]="reason()" (ngModelChange)="reason.set($event)" rows="3"
                  placeholder="Explain why this credit is needed..."
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none resize-none">
                </textarea>
              </div>
            </div>

            <!-- Footer buttons -->
            <div class="mt-6 flex items-center justify-end gap-3">
              <button (click)="close()"
                class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button (click)="submit()" [disabled]="submitting() || !amount()"
                class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 transition-colors disabled:opacity-50">
                @if (submitting()) {
                  <svg class="inline h-4 w-4 animate-spin mr-1.5" viewBox="0 0 24 24" fill="none">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  Submitting...
                } @else {
                  Submit Application
                }
              </button>
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class CreditApplicationModalComponent {
  private readonly http = inject(HttpClient);

  normalizeAmountInput(value: unknown): string {
    return value == null ? '' : String(value);
  }

  normalizeDaysInput(value: unknown): number | null {
    if (value === '' || value == null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /** Whether the modal is visible. */
  readonly open = input(false);
  /** The counterparty (customer/supplier) ID. */
  readonly counterpartyId = input.required<string>();
  /** The counterparty name (for display). */
  readonly counterpartyName = input('');
  /** Optional order ID (if initiated from an order). */
  readonly orderId = input<string | undefined>(undefined);
  /** Optional existing credit line ID (for increase). */
  readonly creditLineId = input<string | undefined>(undefined);
  /** Pre-set type. */
  readonly defaultType = input<CreditLineType>('CUSTOMER');

  /** Emitted when the modal should close. */
  readonly closed = output<void>();
  /** Emitted when an application is successfully submitted. */
  readonly submitted = output<CreditApplicationDto>();

  readonly type = signal<CreditLineType>('CUSTOMER');
  readonly amount = signal('');
  readonly currency = signal('USD');
  readonly days = signal<number | null>(30);
  readonly reason = signal('');
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly success = signal(false);

  ngOnChanges() {
    // Reset form when modal opens
    if (this.open()) {
      this.type.set(this.defaultType());
      this.amount.set('');
      this.currency.set('USD');
      this.days.set(30);
      this.reason.set('');
      this.error.set('');
      this.success.set(false);
    }
  }

  close() {
    this.closed.emit();
  }

  async submit() {
    if (!this.amount() || !this.counterpartyId()) return;

    this.submitting.set(true);
    this.error.set('');

    try {
      const body: CreateCreditApplicationDto = {
        type: this.type(),
        counterpartyId: this.counterpartyId(),
        requestedAmount: String(this.amount()),
        requestedCurrency: this.currency(),
      };
      if (this.days() !== null && this.days() !== undefined) body.requestedDays = Number(this.days());
      if (this.reason()) body.reason = this.reason();
      if (this.orderId()) body.orderId = this.orderId();
      if (this.creditLineId()) body.creditLineId = this.creditLineId();

      const res = await firstValueFrom(
        this.http.post<ApiResponse<CreditApplicationDto>>(
          `${API}/credit/applications`,
          body,
        ),
      );

      if (res.success && res.data) {
        this.success.set(true);
        this.submitted.emit(res.data);
        // Auto-close after 2 seconds
        setTimeout(() => this.close(), 2000);
      } else {
        this.error.set(res.message ?? 'Failed to submit application');
      }
    } catch (err: any) {
      this.error.set(err?.error?.message ?? 'Failed to submit application');
    } finally {
      this.submitting.set(false);
    }
  }
}
