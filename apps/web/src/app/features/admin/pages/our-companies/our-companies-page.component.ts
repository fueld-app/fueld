import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, OwnCompanyDto, CounterpartyDto, BankAccountDto } from '@fueld/types';
import { OurCompaniesBankAccountModalComponent } from './our-companies-bank-account-modal.component';
import { emptyBankAccountForm, bankAccountToForm, type BankAccountFormData } from './our-companies.types';

import { API } from '@app/core/config/api';

interface CompanySearchResult {
  source: 'local' | 'seasearcher';
  localId?: string;
  seasearcherId?: string;
  name: string;
  country?: string | null;
}

interface CompanySearchResultOption {
  key: string;
  source: 'local' | 'seasearcher';
  id?: string;
  seasearcherId?: string;
  name: string;
  country?: string | null;
}

@Component({
  selector: 'app-our-companies-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, OurCompaniesBankAccountModalComponent],
  template: `
    <div>
      <!-- Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">Our Companies</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-muted">
            Companies that belong to your organization. Manage logos and bank accounts for invoicing.
          </p>
        </div>
        <button
          (click)="openAddModal()"
          class="app-button-add"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          Add Company
        </button>
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <svg class="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else {
        <div class="space-y-4">
          @for (co of companies(); track co.id) {
            <div class="app-panel">
              <!-- Company Header Row -->
              <div class="app-panel-header app-panel-header--brand justify-between px-5 py-4">
                <div class="flex items-center gap-4 min-w-0">
                  <!-- Logo -->
                  <div class="relative group flex-shrink-0">
                    <input type="file" class="hidden" accept="image/jpeg,image/png,image/webp,image/svg+xml"
                      (change)="onLogoSelected($event, co.id)" />
                    @if (co.logoUrl) {
                      <button
                        (click)="triggerLogoUpload($event, co.id)"
                        class="flex h-12 w-12 items-center justify-center rounded-lg border border-gray-200 dark:border-line overflow-hidden hover:border-brand-400 transition-colors cursor-pointer"
                      >
                        <img [src]="resolveUrl(co.logoUrl)" alt="" class="h-full w-full object-contain" />
                        <div class="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" />
                          </svg>
                        </div>
                      </button>
                      <button
                        (click)="removeLogo(co.id); $event.stopPropagation()"
                        class="absolute -top-1.5 -right-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                        title="Remove logo"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                        </svg>
                      </button>
                    } @else {
                      <button
                        (click)="triggerLogoUpload($event, co.id)"
                        class="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 dark:border-line-strong hover:border-brand-400 text-gray-400 dark:text-muted hover:text-brand-500 transition-colors cursor-pointer"
                        title="Upload logo"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" />
                        </svg>
                      </button>
                    }
                    @if (uploadingLogoId() === co.id) {
                      <div class="absolute inset-0 flex items-center justify-center rounded-lg bg-white/80">
                        <svg class="h-5 w-5 animate-spin text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none">
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                      </div>
                    }
                  </div>
                  <div class="min-w-0">
                    <a [routerLink]="['/companies', co.id]" class="font-semibold text-gray-900 dark:text-ink hover:text-brand-700 hover:underline truncate block">
                      {{ co.name }}
                    </a>
                    <p class="text-sm text-gray-500 dark:text-muted">{{ co.country ?? '\u2014' }}</p>
                  </div>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  <button
                    (click)="toggleExpand(co.id)"
                    class="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-line px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M10.5 6a.5.5 0 0 0-1 0v3.5H6a.5.5 0 0 0 0 1h3.5V14a.5.5 0 0 0 1 0v-3.5H14a.5.5 0 0 0 0-1h-3.5V6Z" />
                      <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-1a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" clip-rule="evenodd" />
                    </svg>
                    {{ expandedCompanyId() === co.id ? 'Hide Details' : 'Show Details' }}
                  </button>
                  <button (click)="confirmRemove(co)"
                    class="rounded-md p-1.5 text-gray-400 dark:text-muted hover:text-red-500 transition-colors" title="Remove company">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>

              <!-- Bank Accounts Expandable Section -->
              @if (expandedCompanyId() === co.id) {
                <div class="px-5 py-4 bg-gray-50/50">
                  <div class="flex items-center justify-between mb-3">
                    <h3 class="text-xs font-semibold text-gray-500 dark:text-muted uppercase tracking-wider">Bank Accounts</h3>
                    <button
                      (click)="openBankAccountModal(co.id)"
                      class="app-button-add px-2.5 py-1 text-xs"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                      </svg>
                      Add Account
                    </button>
                  </div>

                  @if (bankAccountsLoading()) {
                    <div class="flex items-center justify-center py-6">
                      <svg class="h-5 w-5 animate-spin text-gray-400 dark:text-muted" viewBox="0 0 24 24" fill="none">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                    </div>
                  } @else if (bankAccounts().length === 0) {
                    <div class="text-center py-6 text-sm text-gray-400 dark:text-muted">
                      No bank accounts yet. Add one to include banking details on invoices.
                    </div>
                  } @else {
                    <div class="space-y-3">
                      @for (ba of bankAccounts(); track ba.id) {
                        <div class="rounded-lg border bg-white dark:bg-surface p-4" [class]="ba.isDefault ? 'border-brand-200 dark:border-brand-500/30 ring-1 ring-brand-100' : 'border-gray-200 dark:border-line'">
                          <div class="flex items-start justify-between">
                            <div>
                              <div class="flex items-center gap-2">
                                <span class="font-semibold text-sm text-gray-900 dark:text-ink">{{ ba.label }}</span>
                                <span class="inline-flex items-center rounded-full bg-gray-100 dark:bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:text-ink-dim">{{ ba.currency }}</span>
                                @if (ba.isDefault) {
                                  <span class="inline-flex items-center rounded-full bg-brand-50 dark:bg-brand-700/15 px-2 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-400">Default</span>
                                }
                              </div>
                              <p class="text-sm text-gray-600 dark:text-ink-dim mt-0.5">{{ ba.bankName }}</p>
                            </div>
                            <div class="flex items-center gap-1">
                              <button (click)="editBankAccount(ba)"
                                class="rounded-md p-1 text-gray-400 dark:text-muted hover:text-brand-600 transition-colors" title="Edit">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                </svg>
                              </button>
                              <button (click)="confirmDeleteBankAccount(ba)"
                                class="rounded-md p-1 text-gray-400 dark:text-muted hover:text-red-500 transition-colors" title="Delete">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                  <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                                </svg>
                              </button>
                            </div>
                          </div>
                          <div class="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-1 text-xs">
                            @if (ba.accountName) {
                              <div><span class="text-gray-400 dark:text-muted">Beneficiary:</span> <span class="text-gray-700 dark:text-ink-dim">{{ ba.accountName }}</span></div>
                            }
                            @if (ba.iban) {
                              <div><span class="text-gray-400 dark:text-muted">IBAN:</span> <span class="text-gray-700 dark:text-ink-dim font-mono">{{ ba.iban }}</span></div>
                            }
                            @if (ba.accountNumber) {
                              <div><span class="text-gray-400 dark:text-muted">Account #:</span> <span class="text-gray-700 dark:text-ink-dim font-mono">{{ ba.accountNumber }}</span></div>
                            }
                            @if (ba.swiftBic) {
                              <div><span class="text-gray-400 dark:text-muted">SWIFT/BIC:</span> <span class="text-gray-700 dark:text-ink-dim font-mono">{{ ba.swiftBic }}</span></div>
                            }
                            @if (ba.sortCode) {
                              <div><span class="text-gray-400 dark:text-muted">Sort Code:</span> <span class="text-gray-700 dark:text-ink-dim font-mono">{{ ba.sortCode }}</span></div>
                            }
                            @if (ba.routingNumber) {
                              <div><span class="text-gray-400 dark:text-muted">Routing #:</span> <span class="text-gray-700 dark:text-ink-dim font-mono">{{ ba.routingNumber }}</span></div>
                            }
                            @if (ba.intermediaryBank) {
                              <div class="col-span-2"><span class="text-gray-400 dark:text-muted">Intermediary Bank:</span> <span class="text-gray-700 dark:text-ink-dim">{{ ba.intermediaryBank }}</span></div>
                            }
                            @if (ba.branchAddress) {
                              <div class="col-span-2"><span class="text-gray-400 dark:text-muted">Branch:</span> <span class="text-gray-700 dark:text-ink-dim">{{ ba.branchAddress }}</span></div>
                            }
                            @if (ba.notes) {
                              <div class="col-span-full"><span class="text-gray-400 dark:text-muted">Notes:</span> <span class="text-gray-700 dark:text-ink-dim">{{ ba.notes }}</span></div>
                            }
                          </div>
                        </div>
                      }
                    </div>
                  }

                  <!-- Terms (applies to Confirmation/Nomination PDFs) -->
                  <div class="mt-6 border-t border-gray-200 dark:border-line pt-5">
                    <div class="flex items-center justify-between">
                      <h3 class="text-xs font-semibold text-gray-500 dark:text-muted uppercase tracking-wider">Terms, VAT & Invoicing</h3>
                      <button
                        (click)="saveTerms(co.id)"
                        [disabled]="savingTerms()"
                        class="app-button-primary px-2.5 py-1 text-xs disabled:opacity-60"
                      >
                        {{ savingTerms() ? 'Saving…' : 'Save terms' }}
                      </button>
                    </div>
                    <p class="mt-1 text-xs text-gray-500 dark:text-muted">
                      These are read-only on the order and included in Confirmation and Nomination PDFs. You can use <span class="font-mono">$&#123;companyName&#125;</span> and <span class="font-mono">$&#123;documentName&#125;</span> in the text (e.g. Offer/Confirmation).
                    </p>

                    @if (termsError()) {
                      <div class="mt-3 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-4 py-3 text-sm text-red-700 dark:text-red-400" role="alert">
                        {{ termsError() }}
                      </div>
                    }

                    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div>
                        <label class="block text-xs font-semibold text-gray-600 dark:text-ink-dim mb-1">Customer terms</label>
                        <textarea
                          rows="10"
                          [ngModel]="customerTermsDraft()"
                          (ngModelChange)="customerTermsDraft.set($event)"
                          class="app-input w-full bg-white dark:bg-surface text-xs text-gray-700 dark:text-ink-dim whitespace-pre-line"
                        ></textarea>
                      </div>
                      <div>
                        <label class="block text-xs font-semibold text-gray-600 dark:text-ink-dim mb-1">Supplier terms</label>
                        <textarea
                          rows="10"
                          [ngModel]="supplierTermsDraft()"
                          (ngModelChange)="supplierTermsDraft.set($event)"
                          class="app-input w-full bg-white dark:bg-surface text-xs text-gray-700 dark:text-ink-dim whitespace-pre-line"
                        ></textarea>
                      </div>
                    </div>

                    <!-- VAT & Fraud Prevention (invoice-specific) -->
                    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div>
                        <label class="block text-xs font-semibold text-gray-600 dark:text-ink-dim mb-1">VAT Number</label>
                        <input
                          type="text"
                          [ngModel]="vatDraft()"
                          (ngModelChange)="vatDraft.set($event)"
                          placeholder="e.g. FR31000060599"
                          class="app-input w-full bg-white dark:bg-surface text-gray-700 dark:text-ink-dim"
                        />
                      </div>
                      <div>
                        <label class="block text-xs font-semibold text-gray-600 dark:text-ink-dim mb-1">Company Registration Number</label>
                        <input
                          type="text"
                          [ngModel]="companyRegistrationNumberDraft()"
                          (ngModelChange)="companyRegistrationNumberDraft.set($event)"
                          placeholder="e.g. 12345678"
                          class="app-input w-full bg-white dark:bg-surface text-gray-700 dark:text-ink-dim"
                        />
                      </div>
                      <div>
                        <label class="block text-xs font-semibold text-gray-600 dark:text-ink-dim mb-1">Late Payment Interest <span class="text-gray-400 dark:text-muted font-normal">(shown on invoices)</span></label>
                        <input
                          type="text"
                          [ngModel]="latePaymentInterestDraft()"
                          (ngModelChange)="latePaymentInterestDraft.set($event)"
                          placeholder="e.g. 2%"
                          class="app-input w-full bg-white dark:bg-surface text-gray-700 dark:text-ink-dim"
                        />
                      </div>
                      <div>
                        <label class="block text-xs font-semibold text-gray-600 dark:text-ink-dim mb-1">Email Header Color <span class="text-gray-400 dark:text-muted font-normal">(hex, e.g. #1a56db)</span></label>
                        <div class="flex items-center gap-2">
                          <input
                            type="color"
                            [ngModel]="brandColorDraft() || '#ffffff'"
                            (ngModelChange)="brandColorDraft.set($event)"
                            class="h-9 w-12 cursor-pointer rounded border border-gray-300 dark:border-line-strong p-0.5"
                          />
                          <input
                            type="text"
                            [ngModel]="brandColorDraft()"
                            (ngModelChange)="brandColorDraft.set($event)"
                            placeholder="#ffffff"
                            class="app-input flex-1 bg-white dark:bg-surface text-gray-700 dark:text-ink-dim"
                          />
                        </div>
                      </div>
                      <div>
                        <label class="block text-xs font-semibold text-gray-600 dark:text-ink-dim mb-1">Fraud Prevention Notice <span class="text-gray-400 dark:text-muted font-normal">(shown on invoices)</span></label>
                        <textarea
                          rows="4"
                          [ngModel]="fraudDraft()"
                          (ngModelChange)="fraudDraft.set($event)"
                          class="app-input w-full bg-white dark:bg-surface text-xs text-gray-700 dark:text-ink-dim whitespace-pre-line"
                        ></textarea>
                      </div>
                    </div>

                    @if (termsSaved()) {
                      <p class="mt-2 text-xs font-medium text-green-700 dark:text-green-400">Saved</p>
                    }
                  </div>
                </div>
              }
            </div>
          } @empty {
            <div class="app-panel px-4 py-8 text-center text-gray-400 dark:text-muted">
              No companies marked as own yet. Click "Add Company" to add one.
            </div>
          }
        </div>
      }

      <!-- Add Company Modal -->
      @if (showAddModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div class="rounded-xl bg-white dark:bg-surface p-6 shadow-xl w-full max-w-lg mx-4" (click)="$event.stopPropagation()">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-ink">Add Own Company</h3>
            <p class="mt-1 text-sm text-gray-500 dark:text-muted">Search for and select an existing company to mark as your own.</p>

            <div class="mt-4">
              <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Company *</label>
              <div class="relative mt-1">
                <input type="text" [ngModel]="searchTerm()" (ngModelChange)="onSearch($event)"
                  (focus)="dropdownOpen.set(searchResults().length > 0)"
                  placeholder="Search companies\u2026"
                  class="app-input w-full" />
                @if (dropdownOpen() && searchResults().length) {
                  <div class="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-lg max-h-48 overflow-y-auto">
                    @for (c of searchResults(); track c.key) {
                      <button (click)="addCompany(c)" class="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-surface-tint">
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
            </div>

            @if (dropdownOpen()) {
              <div class="fixed inset-0 z-0" (click)="dropdownOpen.set(false)"></div>
            }

            <div class="mt-5 flex justify-end">
              <button (click)="showAddModal.set(false)"
                class="rounded-lg border border-gray-300 dark:border-line-strong px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint">Cancel</button>
            </div>
          </div>
        </div>
      }

      <!-- Bank Account Modal -->
      <app-our-companies-bank-account-modal
        [open]="bankAccountModalOpen()"
        [editing]="!!editingBankAccount()"
        [saving]="savingBankAccount()"
        [error]="bankAccountError()"
        [currencies]="configuredCurrencies()"
        [initialForm]="bankAccountFormData()"
        (cancel)="bankAccountModalOpen.set(false)"
        (save)="onBankAccountSave($event)"
      />

      <!-- Remove company confirmation -->
      @if (removeTarget()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="removeTarget.set(null)">
          <div class="rounded-xl bg-white dark:bg-surface p-6 shadow-xl max-w-sm mx-4" (click)="$event.stopPropagation()">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-ink">Remove own company?</h3>
            <p class="mt-2 text-sm text-gray-500 dark:text-muted">
              Are you sure you want to remove <strong>{{ removeTarget()!.name }}</strong> from your own companies?
            </p>
            <div class="mt-4 flex justify-end gap-2">
              <button (click)="removeTarget.set(null)"
                class="rounded-lg border border-gray-300 dark:border-line-strong px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint">Cancel</button>
              <button (click)="executeRemove()"
                class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Remove</button>
            </div>
          </div>
        </div>
      }

      <!-- Delete bank account confirmation -->
      @if (deleteBankAccountTarget()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="deleteBankAccountTarget.set(null)">
          <div class="rounded-xl bg-white dark:bg-surface p-6 shadow-xl max-w-sm mx-4" (click)="$event.stopPropagation()">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-ink">Delete bank account?</h3>
            <p class="mt-2 text-sm text-gray-500 dark:text-muted">
              Are you sure you want to delete <strong>{{ deleteBankAccountTarget()!.label }}</strong>?
            </p>
            <div class="mt-4 flex justify-end gap-2">
              <button (click)="deleteBankAccountTarget.set(null)"
                class="rounded-lg border border-gray-300 dark:border-line-strong px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint">Cancel</button>
              <button (click)="executeDeleteBankAccount()"
                class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class OurCompaniesPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly companies = signal<OwnCompanyDto[]>([]);
  readonly loading = signal(true);

  // Add company modal
  readonly showAddModal = signal(false);
  readonly searchTerm = signal('');
  readonly searchResults = signal<CompanySearchResultOption[]>([]);
  readonly dropdownOpen = signal(false);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  // Remove company
  readonly removeTarget = signal<OwnCompanyDto | null>(null);

  // Expanded section
  readonly expandedCompanyId = signal<string | null>(null);

  // Terms editing (per expanded company)
  readonly customerTermsDraft = signal('');
  readonly supplierTermsDraft = signal('');
  readonly vatDraft = signal('');
  readonly companyRegistrationNumberDraft = signal('');
  readonly fraudDraft = signal('');
  readonly latePaymentInterestDraft = signal('');
  readonly brandColorDraft = signal('');
  readonly savingTerms = signal(false);
  readonly termsError = signal('');
  readonly termsSaved = signal(false);

  // Bank accounts
  readonly bankAccounts = signal<BankAccountDto[]>([]);
  readonly bankAccountsLoading = signal(false);
  readonly bankAccountModalOpen = signal(false);
  readonly editingBankAccount = signal<BankAccountDto | null>(null);
  readonly savingBankAccount = signal(false);
  readonly bankAccountError = signal('');
  readonly deleteBankAccountTarget = signal<BankAccountDto | null>(null);
  readonly bankAccountCounts = signal<Record<string, number>>({});

  readonly bankAccountFormData = signal<BankAccountFormData>(emptyBankAccountForm());
  private baCompanyId = '';

  // Logo
  readonly uploadingLogoId = signal<string | null>(null);

  // Configured currencies
  readonly configuredCurrencies = signal<string[]>(['USD', 'EUR', 'DKK', 'AED']);

  ngOnInit(): void {
    this.loadData();
    this.loadCurrencies();
  }

  private async loadCurrencies(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ currencies: string[] }>>(API + '/admin/settings/my-currencies'),
      );
      if (res.success && res.data.currencies.length) {
        this.configuredCurrencies.set(res.data.currencies);
      }
    } catch { /* keep defaults */ }
  }

  resolveUrl(url: string | null): string {
    if (!url) return '';
    return url.startsWith('/') ? API + url : url;
  }

  async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<OwnCompanyDto[]>>(API + '/admin/settings/own-companies'),
      );
      if (res.success) {
        this.companies.set(res.data);
        this.loadAllBankAccountCounts(res.data);
      }
    } catch (err) {
      console.error('Failed to load own companies:', err);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadAllBankAccountCounts(companies: OwnCompanyDto[]): Promise<void> {
    const counts: Record<string, number> = {};
    await Promise.all(
      companies.map(async (co) => {
        try {
          const res = await firstValueFrom(
            this.http.get<ApiResponse<BankAccountDto[]>>(API + '/admin/settings/companies/' + co.id + '/bank-accounts'),
          );
          if (res.success) counts[co.id] = res.data.length;
        } catch { /* ignore */ }
      }),
    );
    this.bankAccountCounts.set(counts);
  }

  openAddModal(): void {
    this.searchTerm.set('');
    this.searchResults.set([]);
    this.showAddModal.set(true);
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (term.length < 2) {
      this.searchResults.set([]);
      this.dropdownOpen.set(false);
      return;
    }
    this.searchTimer = setTimeout(async () => {
      try {
        const res = await firstValueFrom(
          this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
            API + '/companies/local?search=' + encodeURIComponent(term) + '&limit=10',
          ),
        );
        const ownIds = new Set(this.companies().map((c) => c.id));
        const localResults = res.success && res.data?.companies
          ? res.data.companies.filter((c) => !ownIds.has(c.id))
          : [];
        if (localResults.length) {
          this.searchResults.set(
            localResults.map((c) => ({
              key: c.id,
              source: 'local',
              id: c.id,
              name: c.name,
              country: c.country ?? null,
            })),
          );
          this.dropdownOpen.set(true);
          return;
        }

        const importRes = await firstValueFrom(
          this.http.get<ApiResponse<CompanySearchResult[]>>(
            `${API}/companies/search?term=${encodeURIComponent(term)}`,
          ),
        );
        if (importRes.success && importRes.data) {
          this.searchResults.set(
            importRes.data
              .filter((r) => r.source === 'seasearcher' && r.seasearcherId)
              .map((r) => ({
                key: `seasearcher:${r.seasearcherId}`,
                source: 'seasearcher',
                seasearcherId: r.seasearcherId,
                name: r.name,
                country: r.country ?? null,
              })),
          );
        } else {
          this.searchResults.set([]);
        }
        this.dropdownOpen.set(true);
      } catch {
        this.searchResults.set([]);
      }
    }, 300);
  }

  async addCompany(company: CompanySearchResultOption): Promise<void> {
    if (company.source === 'seasearcher' && company.seasearcherId) {
      await this.importOwnCompany(company.seasearcherId);
      return;
    }
    if (!company.id) return;
    try {
      await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(API + '/admin/settings/own-companies', {
          companyId: company.id,
        }),
      );
      this.showAddModal.set(false);
      await this.loadData();
    } catch (err) {
      console.error('Failed to add own company:', err);
    }
  }

  private async importOwnCompany(seasearcherId: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<CounterpartyDto>>(`${API}/companies/import`, { seasearcherId }),
      );
      if (res.success && res.data) {
        await this.addCompany({
          key: res.data.id,
          source: 'local',
          id: res.data.id,
          name: res.data.name,
          country: res.data.country ?? null,
        });
      } else {
        console.error('Failed to import own company:', res.message ?? 'Unknown error');
      }
    } catch (err) {
      console.error('Failed to import own company:', err);
    }
  }

  confirmRemove(company: OwnCompanyDto): void {
    this.removeTarget.set(company);
  }

  async executeRemove(): Promise<void> {
    const target = this.removeTarget();
    if (!target) return;
    try {
      await firstValueFrom(
        this.http.delete<ApiResponse<unknown>>(API + '/admin/settings/own-companies/' + target.id),
      );
      this.removeTarget.set(null);
      if (this.expandedCompanyId() === target.id) this.expandedCompanyId.set(null);
      await this.loadData();
    } catch (err) {
      console.error('Failed to remove own company:', err);
    }
  }

  async toggleExpand(companyId: string): Promise<void> {
    if (this.expandedCompanyId() === companyId) {
      this.expandedCompanyId.set(null);
      return;
    }
    this.expandedCompanyId.set(companyId);
    this.populateTermsDraft(companyId);
    await this.loadBankAccounts(companyId);
  }

  private populateTermsDraft(companyId: string): void {
    const co = this.companies().find((c) => c.id === companyId);
    this.customerTermsDraft.set(co?.customerTerms ?? '');
    this.supplierTermsDraft.set(co?.supplierTerms ?? '');
    this.vatDraft.set(co?.vatNumber ?? '');
    this.companyRegistrationNumberDraft.set(co?.companyRegistrationNumber ?? '');
    this.fraudDraft.set(co?.fraudPreventionText ?? '');
    this.latePaymentInterestDraft.set(co?.latePaymentInterest ?? '');
    this.brandColorDraft.set(co?.brandColor ?? '');
    this.termsError.set('');
    this.termsSaved.set(false);
  }

  async saveTerms(companyId: string): Promise<void> {
    if (this.savingTerms()) return;
    this.savingTerms.set(true);
    this.termsError.set('');
    this.termsSaved.set(false);

    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<OwnCompanyDto>>(
          API + '/admin/settings/own-companies/' + companyId + '/terms',
          {
            customerTerms: this.customerTermsDraft().trim() || null,
            supplierTerms: this.supplierTermsDraft().trim() || null,
            vatNumber: this.vatDraft().trim() || null,
            companyRegistrationNumber: this.companyRegistrationNumberDraft().trim() || null,
            fraudPreventionText: this.fraudDraft().trim() || null,
            latePaymentInterest: this.latePaymentInterestDraft().trim() || null,
            brandColor: this.brandColorDraft().trim() || null,
          },
        ),
      );

      if (!res.success || !res.data) {
        this.termsError.set(res.message || 'Failed to save terms');
        return;
      }

      // Update local list
      this.companies.update((list) => list.map((c) => (c.id === companyId ? res.data! : c)));
      this.populateTermsDraft(companyId);
      this.termsSaved.set(true);
      setTimeout(() => this.termsSaved.set(false), 1500);
    } catch (err: any) {
      const msg = err?.error?.message || err?.error?.error || 'Failed to save terms';
      this.termsError.set(msg);
    } finally {
      this.savingTerms.set(false);
    }
  }

  private async loadBankAccounts(companyId: string): Promise<void> {
    this.bankAccountsLoading.set(true);
    this.bankAccounts.set([]);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<BankAccountDto[]>>(API + '/admin/settings/companies/' + companyId + '/bank-accounts'),
      );
      if (res.success) this.bankAccounts.set(res.data);
    } catch (err) {
      console.error('Failed to load bank accounts:', err);
    } finally {
      this.bankAccountsLoading.set(false);
    }
  }

  openBankAccountModal(companyId: string): void {
    this.baCompanyId = companyId;
    this.editingBankAccount.set(null);
    this.bankAccountError.set('');
    this.bankAccountFormData.set(emptyBankAccountForm());
    this.bankAccountModalOpen.set(true);
  }

  editBankAccount(ba: BankAccountDto): void {
    this.baCompanyId = ba.counterpartyId;
    this.editingBankAccount.set(ba);
    this.bankAccountError.set('');
    this.bankAccountFormData.set(bankAccountToForm(ba));
    this.bankAccountModalOpen.set(true);
  }

  async onBankAccountSave(formData: BankAccountFormData): Promise<void> {
    if (!formData.label || !formData.bankName || !formData.currency) {
      this.bankAccountError.set('Label, bank name, and currency are required.');
      return;
    }
    this.savingBankAccount.set(true);
    this.bankAccountError.set('');

    const body: Record<string, unknown> = {
      label: formData.label,
      bankName: formData.bankName,
      currency: formData.currency,
      accountName: formData.accountName || null,
      accountNumber: formData.accountNumber || null,
      iban: formData.iban || null,
      swiftBic: formData.swiftBic || null,
      branchAddress: formData.branchAddress || null,
      sortCode: formData.sortCode || null,
      routingNumber: formData.routingNumber || null,
      intermediaryBank: formData.intermediaryBank || null,
      notes: formData.notes || null,
      isDefault: formData.isDefault,
    };

    try {
      const editing = this.editingBankAccount();
      if (editing) {
        await firstValueFrom(
          this.http.patch<ApiResponse<BankAccountDto>>(
            API + '/admin/settings/companies/' + this.baCompanyId + '/bank-accounts/' + editing.id,
            body,
          ),
        );
      } else {
        await firstValueFrom(
          this.http.post<ApiResponse<BankAccountDto>>(
            API + '/admin/settings/companies/' + this.baCompanyId + '/bank-accounts',
            body,
          ),
        );
      }
      this.bankAccountModalOpen.set(false);
      await this.loadBankAccounts(this.baCompanyId);
      const counts = { ...this.bankAccountCounts() };
      counts[this.baCompanyId] = this.bankAccounts().length;
      this.bankAccountCounts.set(counts);
    } catch (err) {
      this.bankAccountError.set('Failed to save bank account.');
      console.error(err);
    } finally {
      this.savingBankAccount.set(false);
    }
  }

  confirmDeleteBankAccount(ba: BankAccountDto): void {
    this.deleteBankAccountTarget.set(ba);
  }

  async executeDeleteBankAccount(): Promise<void> {
    const ba = this.deleteBankAccountTarget();
    if (!ba) return;
    try {
      await firstValueFrom(
        this.http.delete<ApiResponse<unknown>>(
          API + '/admin/settings/companies/' + ba.counterpartyId + '/bank-accounts/' + ba.id,
        ),
      );
      this.deleteBankAccountTarget.set(null);
      await this.loadBankAccounts(ba.counterpartyId);
      const counts = { ...this.bankAccountCounts() };
      counts[ba.counterpartyId] = this.bankAccounts().length;
      this.bankAccountCounts.set(counts);
    } catch (err) {
      console.error('Failed to delete bank account:', err);
    }
  }

  triggerLogoUpload(event: Event, _companyId: string): void {
    event.stopPropagation();
    const button = event.currentTarget as HTMLElement;
    const container = button.closest('.relative');
    const input = container?.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (input) input.click();
  }

  async onLogoSelected(event: Event, companyId: string): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    this.uploadingLogoId.set(companyId);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ logoUrl: string }>>(
          API + '/admin/settings/companies/' + companyId + '/logo',
          formData,
        ),
      );
      if (res.success) {
        this.companies.update((list) =>
          list.map((c) => c.id === companyId ? { ...c, logoUrl: res.data.logoUrl } : c),
        );
      }
    } catch (err) {
      console.error('Failed to upload logo:', err);
    } finally {
      this.uploadingLogoId.set(null);
    }
  }

  async removeLogo(companyId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.delete<ApiResponse<unknown>>(API + '/admin/settings/companies/' + companyId + '/logo'),
      );
      this.companies.update((list) =>
        list.map((c) => c.id === companyId ? { ...c, logoUrl: null } : c),
      );
    } catch (err) {
      console.error('Failed to remove logo:', err);
    }
  }
}
