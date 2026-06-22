import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlaceDetailStore } from '../../place-detail.store';

@Component({
  selector: 'app-place-suppliers-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="app-panel h-[420px] flex flex-col">
      <div class="app-panel-header app-panel-header--blue justify-between px-5 py-3">
        <h2 class="text-sm font-semibold text-gray-700 dark:text-ink-dim">Suppliers
          @if (store.portSuppliers().length) {
            <span class="ml-1 inline-flex items-center rounded-full bg-gray-100 dark:bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:text-ink-dim">
              {{ store.portSuppliers().length }}
            </span>
          }
        </h2>
        <button
          (click)="store.openAddSupplier()"
          class="app-button-add text-[11px]"
        >
          Add supplier
        </button>
      </div>

      @if (store.showAddSupplier()) {
        <div class="border-b border-gray-100 dark:border-line px-5 py-3 space-y-3">
          <div class="relative">
            <input
              type="text"
              [ngModel]="store.supplierCompanySearch()"
              (ngModelChange)="store.onSupplierCompanySearch($event)"
              placeholder="Search companies…"
              class="app-input w-full text-sm"
            />
            @if (store.supplierContactsLoading()) {
              <svg class="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400 dark:text-muted" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            }
          </div>
          @if (store.supplierCompanyResults().length) {
            <div class="max-h-48 overflow-y-auto rounded-md border border-gray-100 dark:border-line shadow-sm">
              @for (company of store.supplierCompanyResults(); track company.key) {
                <button
                  (click)="store.selectSupplierCompany(company)"
                  class="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-surface-tint"
                >
                  <span class="font-medium text-gray-700 dark:text-ink-dim">{{ company.name }}</span>
                  @if (company.country) {
                    <span class="ml-1 text-xs text-gray-400 dark:text-muted">· {{ company.country }}</span>
                  }
                </button>
              }
            </div>
          }

          @if (store.selectedSupplierCompany(); as selected) {
            <div class="text-sm text-gray-700 dark:text-ink-dim">Selected: <span class="font-medium">{{ selected.name }}</span></div>

            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-ink-dim mb-1">Contact</label>
              <select
                [ngModel]="store.supplierForm().contactId ?? ''"
                (ngModelChange)="store.updateSupplierForm('contactId', $event || null)"
                class="app-input w-full text-sm"
              >
                <option value="">— None —</option>
                @for (contact of store.supplierContacts(); track contact.id) {
                  <option [value]="contact.id">{{ contact.name }}</option>
                }
              </select>
            </div>

            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-ink-dim mb-1">Products</label>
              <div class="flex flex-wrap gap-2">
                @for (product of store.productOptions; track product) {
                  <label class="inline-flex items-center gap-1 text-xs text-gray-700 dark:text-ink-dim">
                    <input
                      type="checkbox"
                      [checked]="store.supplierForm().products.includes(product)"
                      (change)="store.toggleProduct(product)"
                      class="rounded border-gray-300 dark:border-line-strong"
                    />
                    {{ product }}
                  </label>
                }
              </div>
            </div>

            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-ink-dim mb-1">Note</label>
              <textarea
                [ngModel]="store.supplierForm().note"
                (ngModelChange)="store.updateSupplierForm('note', $event)"
                rows="2"
                class="app-input w-full text-sm"
              ></textarea>
            </div>

            <div class="flex justify-end gap-2">
              <button (click)="store.cancelSupplierForm()" class="app-button-secondary text-xs">Cancel</button>
              <button
                (click)="store.saveSupplier()"
                [disabled]="store.savingSupplier() || !store.supplierForm().companyId"
                class="app-button-primary text-xs"
              >
                @if (store.savingSupplier()) { Saving… } @else { Save }
              </button>
            </div>
          }
        </div>
      }

      <div class="flex-1 overflow-y-auto">
        @if (!store.portSuppliers().length) {
          <div class="px-5 py-6 text-center text-sm text-gray-400 dark:text-muted">No suppliers linked to this place</div>
        } @else {
          <div class="divide-y divide-gray-50">
            @for (supplier of store.portSuppliers(); track supplier.id) {
              <div class="px-5 py-3">
                <div class="flex items-center justify-between">
                  <button
                    (click)="store.navigateToCompany(supplier.companyId)"
                    class="text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-800 hover:underline text-left"
                  >
                    {{ supplier.companyName }}
                  </button>
                  <div class="flex items-center gap-2">
                    <button
                      (click)="store.openEditSupplier(supplier)"
                      class="text-xs text-gray-500 dark:text-muted hover:text-gray-700"
                    >
                      Edit
                    </button>
                    <button
                      (click)="store.deleteSupplier(supplier.id)"
                      class="text-xs text-red-500 dark:text-red-300 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                @if (supplier.products.length) {
                  <div class="mt-1 flex flex-wrap gap-1">
                    @for (product of supplier.products; track product) {
                      <span class="inline-flex items-center rounded bg-gray-100 dark:bg-surface-3 px-1.5 py-0.5 text-[10px] text-gray-600 dark:text-ink-dim">
                        {{ product }}
                      </span>
                    }
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class PlaceSuppliersCardComponent {
  readonly store = inject(PlaceDetailStore);
}
