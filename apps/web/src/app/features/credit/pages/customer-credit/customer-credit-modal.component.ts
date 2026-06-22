import {
  Component,
  ChangeDetectionStrategy,
  signal,
  input,
  output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { CreditLineForm, CounterpartyOption, OwnCompanyOption } from './customer-credit.types';
import { emptyCreditLineForm } from './customer-credit.types';

@Component({
  selector: 'app-customer-credit-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div class="rounded-xl bg-white dark:bg-surface p-6 shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" (click)="$event.stopPropagation()">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-ink">{{ editing() ? 'Edit' : 'Add' }} Customer Credit Line</h3>

          @if (error()) {
            <div class="mt-3 rounded-lg bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 p-3 text-sm text-red-700 dark:text-red-400">{{ error() }}</div>
          }

          <div class="mt-4 space-y-4">
            <!-- Customer search + multi-select -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Customer(s) *</label>
              <div class="relative mt-1">
                <input type="text" [ngModel]="companySearch()" (ngModelChange)="companySearchChange.emit($event)"
                  (focus)="onSearchFocus()"
                  placeholder="Search customers to add..."
                  class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none" />
                @if (showDropdown() && searchResults().length) {
                  <div class="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-lg max-h-48 overflow-y-auto">
                    @for (c of searchResults(); track c.key) {
                      <button (click)="selectCounterparty.emit(c)" class="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-surface-tint">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400 dark:text-muted" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                        </svg>
                        <span class="font-medium text-gray-900 dark:text-ink">{{ c.name }}</span>
                        @if (c.source === 'seasearcher') {
                          <span class="rounded-full border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-400">Import</span>
                        } @else if (c.country) {
                          <span class="text-xs text-gray-500 dark:text-muted">{{ c.country }}</span>
                        }
                      </button>
                    }
                  </div>
                }
              </div>
              @if (selectedCounterparties().length) {
                <div class="mt-2 flex flex-wrap gap-1.5">
                  @for (co of selectedCounterparties(); track co.id) {
                    <span class="inline-flex items-center gap-1 rounded-full bg-blue-50 dark:bg-blue-500/15 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-400">
                      {{ co.name }}
                      <button (click)="removeCounterparty.emit(co.id!)" class="text-blue-400 hover:text-blue-700">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                        </svg>
                      </button>
                    </span>
                  }
                </div>
              }
            </div>

            @if (showDropdown()) {
              <div class="fixed inset-0 z-0" (click)="showDropdown.set(false)"></div>
            }

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Credit Amount *</label>
                <input type="number" step="0.01" [ngModel]="form().creditAmount" (ngModelChange)="updateForm('creditAmount', $event)"
                  class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                  placeholder="100000" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Currency *</label>
                <select [ngModel]="form().currency" (ngModelChange)="updateForm('currency', $event)"
                  class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none bg-white dark:bg-surface">
                  @for (c of currencies(); track c) {
                    <option [value]="c">{{ c }}</option>
                  }
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Expires</label>
                <input type="date" [ngModel]="form().expires" (ngModelChange)="updateForm('expires', $event)"
                  class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Period (days) *</label>
                <input type="number" [ngModel]="form().periodDays" (ngModelChange)="updateForm('periodDays', +$event)"
                  class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                  placeholder="30" />
              </div>
            </div>

            <!-- Own Companies multi-select -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim mb-2">
                Our Companies
                <span class="text-xs text-gray-400 dark:text-muted ml-1">(which of our entities is giving this credit?)</span>
              </label>
              @if (ownCompanies().length === 0) {
                <p class="text-sm text-gray-400 dark:text-muted">No own companies configured.</p>
              } @else {
                <div class="space-y-1.5 max-h-36 overflow-y-auto">
                  @for (co of ownCompanies(); track co.id) {
                    <label class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-surface-tint cursor-pointer">
                      <input type="checkbox" [checked]="selectedOwnCompanyIds().has(co.id)"
                        (change)="toggleOwnCompany.emit(co.id)"
                        class="h-4 w-4 rounded border-gray-300 dark:border-line-strong text-brand-600 dark:text-brand-400 focus:ring-brand-600" />
                      <span class="text-sm text-gray-900 dark:text-ink">{{ co.name }}</span>
                      @if (co.country) {
                        <span class="text-xs text-gray-500 dark:text-muted">{{ co.country }}</span>
                      }
                    </label>
                  }
                </div>
              }
            </div>

            <div class="flex items-center gap-6">
              <label class="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" [ngModel]="form().fromDelivery" (ngModelChange)="updateForm('fromDelivery', $event)"
                  class="h-4 w-4 rounded border-gray-300 dark:border-line-strong text-brand-600 dark:text-brand-400 focus:ring-brand-600" />
                <span class="text-sm text-gray-700 dark:text-ink-dim">From Delivery</span>
              </label>
              <label class="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" [ngModel]="form().qualified" (ngModelChange)="updateForm('qualified', $event)"
                  class="h-4 w-4 rounded border-gray-300 dark:border-line-strong text-brand-600 dark:text-brand-400 focus:ring-brand-600" />
                <span class="text-sm text-gray-700 dark:text-ink-dim">Qualified</span>
              </label>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Notes</label>
              <textarea [ngModel]="form().notes" (ngModelChange)="updateForm('notes', $event)" rows="2"
                class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                placeholder="Optional notes..."></textarea>
            </div>
          </div>

          <div class="mt-5 flex justify-end gap-2">
            <button (click)="cancel.emit()"
              class="rounded-lg border border-gray-300 dark:border-line-strong px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint">Cancel</button>
            <button (click)="save.emit()" [disabled]="saving()"
              class="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
              @if (saving()) { Saving... } @else { {{ editing() ? 'Update' : 'Create' }} }
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class CustomerCreditModalComponent {
  readonly open = input(false);
  readonly editing = input(false);
  readonly saving = input(false);
  readonly error = input('');
  readonly currencies = input<string[]>(['USD', 'EUR', 'DKK', 'AED']);
  readonly form = input<CreditLineForm>(emptyCreditLineForm());
  readonly companySearch = input('');
  readonly searchResults = input<CounterpartyOption[]>([]);
  readonly selectedCounterparties = input<CounterpartyOption[]>([]);
  readonly ownCompanies = input<OwnCompanyOption[]>([]);
  readonly selectedOwnCompanyIds = input<Set<string>>(new Set());

  readonly cancel = output<void>();
  readonly save = output<void>();
  readonly companySearchChange = output<string>();
  readonly selectCounterparty = output<CounterpartyOption>();
  readonly removeCounterparty = output<string>();
  readonly toggleOwnCompany = output<string>();
  readonly formChange = output<Partial<CreditLineForm>>();

  showDropdown = signal(false);

  onSearchFocus(): void {
    this.showDropdown.set(this.searchResults().length > 0);
  }

  updateForm<K extends keyof CreditLineForm>(key: K, value: CreditLineForm[K]): void {
    this.formChange.emit({ [key]: value } as Partial<CreditLineForm>);
  }
}