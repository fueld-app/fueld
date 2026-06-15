import {
  Component,
  ChangeDetectionStrategy,
  signal,
  input,
  output,
  effect,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { BankAccountFormData } from './our-companies.types';
import { emptyBankAccountForm } from './our-companies.types';

@Component({
  selector: 'app-our-companies-bank-account-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div class="rounded-xl bg-white p-6 shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" (click)="$event.stopPropagation()">
          <h3 class="text-lg font-semibold text-gray-900">{{ editing() ? 'Edit' : 'Add' }} Bank Account</h3>
          <form class="mt-4 space-y-4" (ngSubmit)="submit()">
            <div class="grid grid-cols-2 gap-4">
              <div class="col-span-2">
                <label class="block text-xs font-medium text-gray-600">Label *</label>
                <input type="text" [(ngModel)]="formData.label" name="label" required placeholder="e.g. USD Main Account"
                  class="app-input mt-1 w-full" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-600">Bank Name *</label>
                <input type="text" [(ngModel)]="formData.bankName" name="bankName" required placeholder="e.g. HSBC"
                  class="app-input mt-1 w-full" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-600">Currency *</label>
                <select [(ngModel)]="formData.currency" name="currency" required
                  class="app-input-mono-uppercase mt-1 w-full bg-white">
                  @for (c of currencies(); track c) {
                    <option [value]="c">{{ c }}</option>
                  }
                </select>
              </div>
              <div class="col-span-2">
                <label class="block text-xs font-medium text-gray-600">Beneficiary Name</label>
                <input type="text" [(ngModel)]="formData.accountName" name="accountName" placeholder="Account holder name"
                  class="app-input mt-1 w-full" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-600">IBAN</label>
                <input type="text" [(ngModel)]="formData.iban" name="iban" placeholder="e.g. AE07033\u2026"
                  class="app-input-mono mt-1 w-full" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-600">Account Number</label>
                <input type="text" [(ngModel)]="formData.accountNumber" name="accountNumber"
                  class="app-input-mono mt-1 w-full" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-600">SWIFT / BIC</label>
                <input type="text" [(ngModel)]="formData.swiftBic" name="swiftBic" placeholder="e.g. BBMEAEAD"
                  class="app-input-mono mt-1 w-full" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-600">Sort Code</label>
                <input type="text" [(ngModel)]="formData.sortCode" name="sortCode"
                  class="app-input-mono mt-1 w-full" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-600">Routing Number</label>
                <input type="text" [(ngModel)]="formData.routingNumber" name="routingNumber"
                  class="app-input-mono mt-1 w-full" />
              </div>
              <div class="col-span-2">
                <label class="block text-xs font-medium text-gray-600">Intermediary Bank</label>
                <input type="text" [(ngModel)]="formData.intermediaryBank" name="intermediaryBank" placeholder="e.g. SWIFT BSUIFRPP / CACIB"
                  class="app-input-mono mt-1 w-full" />
              </div>
              <div class="col-span-2">
                <label class="block text-xs font-medium text-gray-600">Branch Address</label>
                <input type="text" [(ngModel)]="formData.branchAddress" name="branchAddress"
                  class="app-input mt-1 w-full" />
              </div>
              <div class="col-span-2">
                <label class="block text-xs font-medium text-gray-600">Notes</label>
                <textarea [(ngModel)]="formData.notes" name="notes" rows="2"
                  class="app-input mt-1 w-full resize-none"></textarea>
              </div>
              <div class="col-span-2 flex items-center gap-2">
                <input type="checkbox" id="isDefault" [(ngModel)]="formData.isDefault" name="isDefault"
                  class="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                <label for="isDefault" class="text-sm text-gray-700">Set as default account for this company</label>
              </div>
            </div>

            @if (error()) {
              <p class="text-sm text-red-600">{{ error() }}</p>
            }

            <div class="flex justify-end gap-2 pt-2">
              <button type="button" (click)="cancel.emit()"
                class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="submit" [disabled]="saving()"
                class="app-button-primary disabled:opacity-50">
                {{ saving() ? 'Saving\u2026' : editing() ? 'Update' : 'Create' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    }
  `,
})
export class OurCompaniesBankAccountModalComponent {
  readonly open = input(false);
  readonly editing = input(false);
  readonly saving = input(false);
  readonly error = input('');
  readonly currencies = input<string[]>(['USD', 'EUR', 'DKK', 'AED']);
  readonly initialForm = input<BankAccountFormData>(emptyBankAccountForm());
  readonly cancel = output<void>();
  readonly save = output<BankAccountFormData>();

  formData = emptyBankAccountForm();

  constructor() {
    effect(() => {
      // Re-initialize form when modal opens with new data
      if (this.open()) {
        this.formData = { ...this.initialForm() };
      }
    });
  }

  submit(): void {
    if (!this.formData.label || !this.formData.bankName || !this.formData.currency) return;
    this.save.emit(this.formData);
  }
}