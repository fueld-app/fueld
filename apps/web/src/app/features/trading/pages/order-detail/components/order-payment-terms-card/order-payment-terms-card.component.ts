import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import type { DropdownOption } from '../../../../shared/components/searchable-dropdown/searchable-dropdown.component';

export interface CreditSummary {
  available: number;
  currency: string;
  maxDays: number;
}

export type PaymentSide = 'customer' | 'supplier';

@Component({
  selector: 'app-order-payment-terms-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe],
  template: `
    <div>
      <p class="text-xs font-medium uppercase tracking-wider text-gray-400 mb-1.5">Payment</p>

      @if (readonly()) {
        <p class="mt-1 text-sm font-semibold text-gray-900">{{ formattedTerms() }}</p>
      } @else {
        <div class="flex items-center gap-2">
          <select
            [ngModel]="paymentTermType()"
            (ngModelChange)="onPaymentTermChange($event)"
            class="fueld-select-no-chevron w-full appearance-none rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                   focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
          >
            <option value="">Select</option>
            @for (opt of paymentTermOptions(); track opt.value) {
              <option
                [value]="opt.value"
                [disabled]="(opt.value === 'CREDIT' && !canUseCredit())"
              >
                {{ opt.value === 'CREDIT' && !canUseCredit() ? (creditFrozen() ? 'Credit (frozen)' : 'Credit (no line)') : opt.label }}
              </option>
            }
          </select>
          @if (paymentTermType() === 'CREDIT') {
            <input
              type="number"
              min="0"
              [attr.max]="creditSummary()?.maxDays ?? null"
              [ngModel]="creditDays()"
              (ngModelChange)="onCreditDaysChange($event)"
              placeholder="Days"
              class="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm
                     focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          }
        </div>

        <div class="mt-2 text-xs text-gray-500">
          @if (creditLoading()) {
            <span>Loading credit line...</span>
          } @else if (creditSummary(); as cs) {
            @if (creditFrozen()) {
              <span class="text-red-600 font-medium">Credit frozen — risk monitoring hit</span>
            } @else {
              <span>
                Available: {{ cs.available | number:'1.2-2' }}
                {{ cs.currency }} · Max {{ cs.maxDays }} days
              </span>
            }
            @if (side() === 'customer') {
              <button (click)="requestCredit.emit()"
                class="ml-2 text-xs text-brand-600 hover:text-brand-700 underline">Request Increase</button>
            }
          } @else {
            <span>No credit line on file.</span>
            @if (side() === 'customer') {
              <button (click)="requestCredit.emit()"
                class="ml-1 text-xs text-brand-600 hover:text-brand-700 underline">Request Credit</button>
            }
          }
        </div>
      }

      <!-- Note toggle -->
      @if (!readonly()) {
        @if (showNote()) {
          <div class="mt-2">
            <textarea
              rows="2"
              [ngModel]="note()"
              (ngModelChange)="onNoteChange($event)"
              [placeholder]="side() === 'customer' ? 'Customer note for PDFs and emails' : 'Supplier note'"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700
                     focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            ></textarea>
            <button (click)="showNoteChange.emit(false)"
              class="mt-1 text-xs text-gray-400 hover:text-gray-600 transition-colors">Hide note</button>
          </div>
        } @else {
          <button (click)="showNoteChange.emit(true)"
            class="mt-2 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-brand-600 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 10.5a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1-.75-.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Z" />
            </svg>
            {{ note() ? 'Edit note' : 'Add note' }}
          </button>
        }
      } @else if (note()) {
        <p class="mt-2 text-xs text-gray-500 whitespace-pre-line">{{ note() }}</p>
      }
    </div>
  `,
})
export class OrderPaymentTermsCardComponent {
  readonly side = input.required<PaymentSide>();
  readonly readonly = input(false);
  readonly paymentTermType = input<string>('');
  readonly creditDays = input<number | null>(null);
  readonly creditSummary = input<CreditSummary | null>(null);
  readonly creditLoading = input(false);
  readonly creditFrozen = input(false);
  readonly canUseCredit = input(false);
  readonly note = input<string | null>(null);
  readonly showNote = input(false);
  readonly paymentTermOptions = input<DropdownOption[]>([]);

  readonly paymentTermTypeChange = output<string>();
  readonly creditDaysChange = output<number>();
  readonly noteChange = output<string>();
  readonly showNoteChange = output<boolean>();
  readonly requestCredit = output<void>();

  protected formattedTerms = computed(() => {
    const type = this.paymentTermType();
    if (!type) return '-';
    if (type === 'CREDIT') {
      const days = this.creditDays() ?? 0;
      return `Credit ${days} days`;
    }
    if (type === 'COD') return 'Cash on Delivery';
    if (type === 'PREPAY') return 'Cash in advance';
    return type;
  });

  protected onPaymentTermChange(value: string): void {
    this.paymentTermTypeChange.emit(value);
  }

  protected onCreditDaysChange(value: number | string): void {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    this.creditDaysChange.emit(Number.isFinite(num) ? num : 0);
  }

  protected onNoteChange(value: string): void {
    this.noteChange.emit(value);
  }
}
