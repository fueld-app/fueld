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
  imports: [FormsModule, RouterLink],
  template: `
    <div>
      <!-- Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Our Companies</h1>
          <p class="mt-1 text-sm text-gray-500">
            Companies that belong to your organization. Manage logos and bank accounts for invoicing.
          </p>
        </div>
        <button
          (click)="openAddModal()"
          class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          Add Company
        </button>
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <svg class="h-8 w-8 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else {
        <div class="space-y-4">
          @for (co of companies(); track co.id) {
            <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
              <!-- Company Header Row -->
              <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <div class="flex items-center gap-4 min-w-0">
                  <!-- Logo -->
                  <div class="relative group flex-shrink-0">
                    <input type="file" class="hidden" accept="image/jpeg,image/png,image/webp,image/svg+xml"
                      (change)="onLogoSelected($event, co.id)" />
                    @if (co.logoUrl) {
                      <button
                        (click)="triggerLogoUpload($event, co.id)"
                        class="flex h-12 w-12 items-center justify-center rounded-lg border border-gray-200 overflow-hidden hover:border-brand-400 transition-colors cursor-pointer"
                      >
                        <img [src]="resolveUrl(co.logoUrl)" alt="" class="h-full w-full object-contain" />
                        <div class="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" />
                          </svg>
                        </div>
                      </button>
                    } @else {
                      <button
                        (click)="triggerLogoUpload($event, co.id)"
                        class="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 hover:border-brand-400 text-gray-400 hover:text-brand-500 transition-colors cursor-pointer"
                        title="Upload logo"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" />
                        </svg>
                      </button>
                    }
                    @if (uploadingLogoId() === co.id) {
                      <div class="absolute inset-0 flex items-center justify-center rounded-lg bg-white/80">
                        <svg class="h-5 w-5 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                      </div>
                    }
                  </div>
                  <div class="min-w-0">
                    <a [routerLink]="['/companies', co.id]" class="font-semibold text-gray-900 hover:text-brand-700 hover:underline truncate block">
                      {{ co.name }}
                    </a>
                    <p class="text-sm text-gray-500">{{ co.country ?? '\u2014' }}</p>
                  </div>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  @if (co.logoUrl) {
                    <button (click)="removeLogo(co.id)"
                      class="rounded-md p-1.5 text-gray-400 hover:text-red-500 transition-colors" title="Remove logo">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                      </svg>
                    </button>
                  }
                  <button
                    (click)="toggleExpand(co.id)"
                    class="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M4 4a2 2 0 00-2 2v1h20V6a2 2 0 00-2-2H4zM2 9v7a2 2 0 002 2h12a2 2 0 002-2V9H2zm6 2a1 1 0 000 2h4a1 1 0 100-2H8z" />
                    </svg>
                    Bank Accounts
                    @if (bankAccountCounts()[co.id]) {
                      <span class="inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">{{ bankAccountCounts()[co.id] }}</span>
                    }
                  </button>
                  <button (click)="confirmRemove(co)"
                    class="rounded-md p-1.5 text-gray-400 hover:text-red-500 transition-colors" title="Remove company">
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
                    <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Bank Accounts</h3>
                    <button
                      (click)="openBankAccountModal(co.id)"
                      class="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                      </svg>
                      Add Account
                    </button>
                  </div>

                  @if (bankAccountsLoading()) {
                    <div class="flex items-center justify-center py-6">
                      <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                    </div>
                  } @else if (bankAccounts().length === 0) {
                    <div class="text-center py-6 text-sm text-gray-400">
                      No bank accounts yet. Add one to include banking details on invoices.
                    </div>
                  } @else {
                    <div class="space-y-3">
                      @for (ba of bankAccounts(); track ba.id) {
                        <div class="rounded-lg border bg-white p-4" [class]="ba.isDefault ? 'border-brand-200 ring-1 ring-brand-100' : 'border-gray-200'">
                          <div class="flex items-start justify-between">
                            <div>
                              <div class="flex items-center gap-2">
                                <span class="font-semibold text-sm text-gray-900">{{ ba.label }}</span>
                                <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">{{ ba.currency }}</span>
                                @if (ba.isDefault) {
                                  <span class="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700">Default</span>
                                }
                              </div>
                              <p class="text-sm text-gray-600 mt-0.5">{{ ba.bankName }}</p>
                            </div>
                            <div class="flex items-center gap-1">
                              <button (click)="editBankAccount(ba)"
                                class="rounded-md p-1 text-gray-400 hover:text-brand-600 transition-colors" title="Edit">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                </svg>
                              </button>
                              <button (click)="confirmDeleteBankAccount(ba)"
                                class="rounded-md p-1 text-gray-400 hover:text-red-500 transition-colors" title="Delete">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                  <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                                </svg>
                              </button>
                            </div>
                          </div>
                          <div class="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-1 text-xs">
                            @if (ba.accountName) {
                              <div><span class="text-gray-400">Beneficiary:</span> <span class="text-gray-700">{{ ba.accountName }}</span></div>
                            }
                            @if (ba.iban) {
                              <div><span class="text-gray-400">IBAN:</span> <span class="text-gray-700 font-mono">{{ ba.iban }}</span></div>
                            }
                            @if (ba.accountNumber) {
                              <div><span class="text-gray-400">Account #:</span> <span class="text-gray-700 font-mono">{{ ba.accountNumber }}</span></div>
                            }
                            @if (ba.swiftBic) {
                              <div><span class="text-gray-400">SWIFT/BIC:</span> <span class="text-gray-700 font-mono">{{ ba.swiftBic }}</span></div>
                            }
                            @if (ba.sortCode) {
                              <div><span class="text-gray-400">Sort Code:</span> <span class="text-gray-700 font-mono">{{ ba.sortCode }}</span></div>
                            }
                            @if (ba.routingNumber) {
                              <div><span class="text-gray-400">Routing #:</span> <span class="text-gray-700 font-mono">{{ ba.routingNumber }}</span></div>
                            }
                            @if (ba.branchAddress) {
                              <div class="col-span-2"><span class="text-gray-400">Branch:</span> <span class="text-gray-700">{{ ba.branchAddress }}</span></div>
                            }
                            @if (ba.notes) {
                              <div class="col-span-full"><span class="text-gray-400">Notes:</span> <span class="text-gray-700">{{ ba.notes }}</span></div>
                            }
                          </div>
                        </div>
                      }
                    </div>
                  }

                  <!-- Terms (applies to Confirmation/Nomination PDFs) -->
                  <div class="mt-6 border-t border-gray-200 pt-5">
                    <div class="flex items-center justify-between">
                      <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Customer & Supplier Terms</h3>
                      <button
                        (click)="saveTerms(co.id)"
                        [disabled]="savingTerms()"
                        class="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                      >
                        {{ savingTerms() ? 'Saving…' : 'Save terms' }}
                      </button>
                    </div>
                    <p class="mt-1 text-xs text-gray-500">
                      These are read-only on the order and included in Confirmation and Nomination PDFs. You can use <span class="font-mono">$&#123;companyName&#125;</span> in the text.
                    </p>

                    @if (termsError()) {
                      <div class="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
                        {{ termsError() }}
                      </div>
                    }

                    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div>
                        <label class="block text-xs font-semibold text-gray-600 mb-1">Customer terms</label>
                        <textarea
                          rows="10"
                          [ngModel]="customerTermsDraft()"
                          (ngModelChange)="customerTermsDraft.set($event)"
                          class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-700 whitespace-pre-line
                                 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                        ></textarea>
                      </div>
                      <div>
                        <label class="block text-xs font-semibold text-gray-600 mb-1">Supplier terms</label>
                        <textarea
                          rows="10"
                          [ngModel]="supplierTermsDraft()"
                          (ngModelChange)="supplierTermsDraft.set($event)"
                          class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-700 whitespace-pre-line
                                 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                        ></textarea>
                      </div>
                    </div>

                    <!-- VAT & Fraud Prevention (invoice-specific) -->
                    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div>
                        <label class="block text-xs font-semibold text-gray-600 mb-1">VAT Number</label>
                        <input
                          type="text"
                          [ngModel]="vatDraft()"
                          (ngModelChange)="vatDraft.set($event)"
                          placeholder="e.g. FR31000060599"
                          class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700
                                 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                        />
                      </div>
                      <div>
                        <label class="block text-xs font-semibold text-gray-600 mb-1">Fraud Prevention Notice <span class="text-gray-400 font-normal">(shown on invoices)</span></label>
                        <textarea
                          rows="4"
                          [ngModel]="fraudDraft()"
                          (ngModelChange)="fraudDraft.set($event)"
                          class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-700 whitespace-pre-line
                                 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                        ></textarea>
                      </div>
                    </div>

                    @if (termsSaved()) {
                      <p class="mt-2 text-xs font-medium text-green-700">Saved</p>
                    }
                  </div>
                </div>
              }
            </div>
          } @empty {
            <div class="rounded-xl border border-gray-200 bg-white shadow-sm px-4 py-8 text-center text-gray-400">
              No companies marked as own yet. Click "Add Company" to add one.
            </div>
          }
        </div>
      }

      <!-- Add Company Modal -->
      @if (showAddModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div class="rounded-xl bg-white p-6 shadow-xl w-full max-w-lg mx-4" (click)="$event.stopPropagation()">
            <h3 class="text-lg font-semibold text-gray-900">Add Own Company</h3>
            <p class="mt-1 text-sm text-gray-500">Search for and select an existing company to mark as your own.</p>

            <div class="mt-4">
              <label class="block text-sm font-medium text-gray-700">Company *</label>
              <div class="relative mt-1">
                <input type="text" [ngModel]="searchTerm()" (ngModelChange)="onSearch($event)"
                  (focus)="dropdownOpen.set(searchResults().length > 0)"
                  placeholder="Search companies\u2026"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
                @if (dropdownOpen() && searchResults().length) {
                  <div class="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-48 overflow-y-auto">
                    @for (c of searchResults(); track c.key) {
                      <button (click)="addCompany(c)" class="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50">
                        <span class="font-medium text-gray-900">{{ c.name }}</span>
                        @if (c.source === 'seasearcher') {
                          <span class="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Import</span>
                        } @else if (c.country) {
                          <span class="text-xs text-gray-500">{{ c.country }}</span>
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
                class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        </div>
      }

      <!-- Bank Account Modal (Create / Edit) -->
      @if (bankAccountModalOpen()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div class="rounded-xl bg-white p-6 shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" (click)="$event.stopPropagation()">
            <h3 class="text-lg font-semibold text-gray-900">{{ editingBankAccount() ? 'Edit' : 'Add' }} Bank Account</h3>
            <form class="mt-4 space-y-4" (ngSubmit)="saveBankAccount()">
              <div class="grid grid-cols-2 gap-4">
                <div class="col-span-2">
                  <label class="block text-xs font-medium text-gray-600">Label *</label>
                  <input type="text" [(ngModel)]="baForm.label" name="label" required placeholder="e.g. USD Main Account"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600">Bank Name *</label>
                  <input type="text" [(ngModel)]="baForm.bankName" name="bankName" required placeholder="e.g. HSBC"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600">Currency *</label>
                  <input type="text" [(ngModel)]="baForm.currency" name="currency" required placeholder="USD" maxlength="3"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono uppercase focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
                </div>
                <div class="col-span-2">
                  <label class="block text-xs font-medium text-gray-600">Beneficiary Name</label>
                  <input type="text" [(ngModel)]="baForm.accountName" name="accountName" placeholder="Account holder name"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600">IBAN</label>
                  <input type="text" [(ngModel)]="baForm.iban" name="iban" placeholder="e.g. AE07033\u2026"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600">Account Number</label>
                  <input type="text" [(ngModel)]="baForm.accountNumber" name="accountNumber"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600">SWIFT / BIC</label>
                  <input type="text" [(ngModel)]="baForm.swiftBic" name="swiftBic" placeholder="e.g. BBMEAEAD"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600">Sort Code</label>
                  <input type="text" [(ngModel)]="baForm.sortCode" name="sortCode"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-600">Routing Number</label>
                  <input type="text" [(ngModel)]="baForm.routingNumber" name="routingNumber"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
                </div>
                <div class="col-span-2">
                  <label class="block text-xs font-medium text-gray-600">Intermediary Bank</label>
                  <input type="text" [(ngModel)]="baForm.intermediaryBank" name="intermediaryBank" placeholder="e.g. SWIFT BSUIFRPP / CACIB"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
                </div>
                <div class="col-span-2">
                  <label class="block text-xs font-medium text-gray-600">Branch Address</label>
                  <input type="text" [(ngModel)]="baForm.branchAddress" name="branchAddress"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
                </div>
                <div class="col-span-2">
                  <label class="block text-xs font-medium text-gray-600">Notes</label>
                  <textarea [(ngModel)]="baForm.notes" name="notes" rows="2"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none resize-none"></textarea>
                </div>
                <div class="col-span-2 flex items-center gap-2">
                  <input type="checkbox" id="isDefault" [(ngModel)]="baForm.isDefault" name="isDefault"
                    class="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                  <label for="isDefault" class="text-sm text-gray-700">Set as default account for this company</label>
                </div>
              </div>

              @if (bankAccountError()) {
                <p class="text-sm text-red-600">{{ bankAccountError() }}</p>
              }

              <div class="flex justify-end gap-2 pt-2">
                <button type="button" (click)="bankAccountModalOpen.set(false)"
                  class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" [disabled]="savingBankAccount()"
                  class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors">
                  @if (savingBankAccount()) {
                    Saving\u2026
                  } @else {
                    {{ editingBankAccount() ? 'Update' : 'Create' }}
                  }
                </button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- Remove company confirmation -->
      @if (removeTarget()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="removeTarget.set(null)">
          <div class="rounded-xl bg-white p-6 shadow-xl max-w-sm mx-4" (click)="$event.stopPropagation()">
            <h3 class="text-lg font-semibold text-gray-900">Remove own company?</h3>
            <p class="mt-2 text-sm text-gray-500">
              Are you sure you want to remove <strong>{{ removeTarget()!.name }}</strong> from your own companies?
            </p>
            <div class="mt-4 flex justify-end gap-2">
              <button (click)="removeTarget.set(null)"
                class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button (click)="executeRemove()"
                class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Remove</button>
            </div>
          </div>
        </div>
      }

      <!-- Delete bank account confirmation -->
      @if (deleteBankAccountTarget()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="deleteBankAccountTarget.set(null)">
          <div class="rounded-xl bg-white p-6 shadow-xl max-w-sm mx-4" (click)="$event.stopPropagation()">
            <h3 class="text-lg font-semibold text-gray-900">Delete bank account?</h3>
            <p class="mt-2 text-sm text-gray-500">
              Are you sure you want to delete <strong>{{ deleteBankAccountTarget()!.label }}</strong>?
            </p>
            <div class="mt-4 flex justify-end gap-2">
              <button (click)="deleteBankAccountTarget.set(null)"
                class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
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
  readonly fraudDraft = signal('');
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

  // Bank account form
  baForm = {
    label: '',
    bankName: '',
    accountName: '',
    accountNumber: '',
    iban: '',
    swiftBic: '',
    currency: '',
    branchAddress: '',
    sortCode: '',
    routingNumber: '',
    intermediaryBank: '',
    notes: '',
    isDefault: false,
  };
  private baCompanyId = '';

  // Logo
  readonly uploadingLogoId = signal<string | null>(null);

  ngOnInit(): void {
    this.loadData();
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
    this.fraudDraft.set(co?.fraudPreventionText ?? '');
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
            fraudPreventionText: this.fraudDraft().trim() || null,
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
    this.baForm = {
      label: '', bankName: '', accountName: '', accountNumber: '',
      iban: '', swiftBic: '', currency: '', branchAddress: '',
      sortCode: '', routingNumber: '', intermediaryBank: '', notes: '', isDefault: false,
    };
    this.bankAccountModalOpen.set(true);
  }

  editBankAccount(ba: BankAccountDto): void {
    this.baCompanyId = ba.counterpartyId;
    this.editingBankAccount.set(ba);
    this.bankAccountError.set('');
    this.baForm = {
      label: ba.label,
      bankName: ba.bankName,
      accountName: ba.accountName ?? '',
      accountNumber: ba.accountNumber ?? '',
      iban: ba.iban ?? '',
      swiftBic: ba.swiftBic ?? '',
      currency: ba.currency,
      branchAddress: ba.branchAddress ?? '',
      sortCode: ba.sortCode ?? '',
      routingNumber: ba.routingNumber ?? '',
      intermediaryBank: (ba as any).intermediaryBank ?? '',
      notes: ba.notes ?? '',
      isDefault: ba.isDefault,
    };
    this.bankAccountModalOpen.set(true);
  }

  async saveBankAccount(): Promise<void> {
    if (!this.baForm.label || !this.baForm.bankName || !this.baForm.currency) {
      this.bankAccountError.set('Label, bank name, and currency are required.');
      return;
    }
    this.savingBankAccount.set(true);
    this.bankAccountError.set('');

    const body: Record<string, unknown> = {
      label: this.baForm.label,
      bankName: this.baForm.bankName,
      currency: this.baForm.currency,
      accountName: this.baForm.accountName || null,
      accountNumber: this.baForm.accountNumber || null,
      iban: this.baForm.iban || null,
      swiftBic: this.baForm.swiftBic || null,
      branchAddress: this.baForm.branchAddress || null,
      sortCode: this.baForm.sortCode || null,
      routingNumber: this.baForm.routingNumber || null,
      intermediaryBank: this.baForm.intermediaryBank || null,
      notes: this.baForm.notes || null,
      isDefault: this.baForm.isDefault,
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
