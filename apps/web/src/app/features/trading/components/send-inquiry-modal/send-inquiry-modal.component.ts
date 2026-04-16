import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
  inject,
  viewChild,
  ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import {
  EmailTagInputComponent,
  type EmailTag,
} from '../../../../shared/components/email-tag-input/email-tag-input.component';
import { API_URL } from '@app/core/config/api';
import {
  buildInquiryDeliveryWindowLabel,
  formatInquiryStoredDateLabel,
  syncInquiryMetadataTable,
} from './send-inquiry-modal.utils';

// ═══════════════════════════════════════════════════════════════════════
//  Send Inquiry Modal — Send RFQ emails to multiple port suppliers
// ═══════════════════════════════════════════════════════════════════════

export interface SupplierRow {
  portSupplierId: string;
  supplierId: string;
  supplierName: string;
  contactId: string | null;
  contactName: string | null;
  phone: string | null;
  waContactId: string | null;
  waContactName: string | null;
  products: string[];
  note: string | null;
  email: string | null;
  inquiryStatus: string | null;
  inquirySentAt: string | null;
  performance: {
    deliveredCountOverall: number;
    deliveredCountAtPlace: number;
    lastDeliveredAtOverall: string | null;
    lastDeliveredAtPlace: string | null;
    sentCount: number;
    quotedCount: number;
    declinedCount: number;
    noReplyCount: number;
    respondedCount: number;
    deliverableCount: number;
    nonDeliverableCount: number;
    averageResponseHours: number | null;
  };
  companyEmails: Array<{
    email: string;
    emailType: string;
    isPrimary: boolean;
  }>;
  contacts: Array<{
    id: string;
    name: string;
    role: string | null;
    email: string | null;
    phone: string | null;
  }>;
  // UI state
  selected: boolean;
  emailOverride: string;
  phoneOverride: string;
  expanded: boolean;
  ccCompanyEmail: boolean;
  personalNote: string;
}

export interface SendInquiryPayload {
  suppliers: Array<{
    supplierId: string;
    supplierName: string;
    email: string;
    contactId?: string;
    contactName?: string;
    ccEmail?: string;
    personalNote?: string;
  }>;
  recipientEmails: string[];
  subject: string;
  htmlBody: string;
  eta?: string | null;
  etd?: string | null;
  responseDeadlineAt?: string | null;
}

export interface SendInquiryWhatsAppPayload {
  recipients: Array<{
    supplierId: string;
    supplierName: string;
    phone: string;
    contactId?: string;
    contactName?: string;
    personalNote?: string;
  }>;
  subject: string;
  eta?: string | null;
  etd?: string | null;
  responseDeadlineAt?: string | null;
}

@Component({
  selector: 'app-send-inquiry-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, EmailTagInputComponent],
  template: `
    @if (open()) {
      <!-- Backdrop -->
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      >
        <!-- Modal panel -->
        <div
          class="w-full max-w-4xl rounded-2xl bg-white shadow-2xl flex flex-col max-h-[90vh]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inquiry-modal-title"
        >
          <!-- Header -->
          <div class="flex items-center justify-between border-b border-gray-200 px-6 py-4 shrink-0">
            <div>
              <h2 id="inquiry-modal-title" class="text-lg font-semibold text-gray-900">
                Send Inquiry to Suppliers
              </h2>
              <p class="text-sm text-gray-500 mt-0.5">
                Select suppliers at {{ portName() }} to send RFQ emails or WhatsApp messages
              </p>
            </div>
            <button
              (click)="close()"
              class="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>

          <!-- Body -->
          <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            <!-- Suppliers list -->
            <div>
              <div class="flex items-center justify-between mb-3">
                <label class="block text-sm font-medium text-gray-700">
                  Suppliers ({{ selectedCount() }}/{{ suppliers().length }} selected)
                </label>
                <div class="flex items-center gap-3">
                  <button
                    type="button"
                    class="text-sm font-medium text-brand-600 hover:text-brand-700"
                    (click)="showAddSupplier.set(!showAddSupplier())"
                  >
                    {{ showAddSupplier() ? 'Cancel' : '+ Add supplier' }}
                  </button>
                  <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      [checked]="allSelected()"
                      [indeterminate]="someSelected() && !allSelected()"
                      (change)="toggleAll()"
                    />
                    Select All
                  </label>
                </div>
              </div>

              <!-- Add supplier inline search -->
              @if (showAddSupplier()) {
                <div class="mb-3 rounded-lg border border-brand-200 bg-brand-50/50 p-3 space-y-2">
                  <div class="relative">
                    <input
                      type="text"
                      class="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                      [ngModel]="addSupplierQuery()"
                      (ngModelChange)="onAddSupplierSearch($event)"
                      placeholder="Search existing companies by name..."
                    />
                    @if (addSupplierLoading()) {
                      <svg class="absolute right-3 top-2.5 h-4 w-4 animate-spin text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    }
                  </div>
                  @if (addSupplierResults().length > 0) {
                    <div class="max-h-40 overflow-y-auto rounded border border-gray-200 bg-white divide-y divide-gray-100">
                      @for (company of addSupplierResults(); track company.localId) {
                        <button
                          type="button"
                          class="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
                          [disabled]="isAlreadyPortSupplier(company.localId)"
                          [class.opacity-50]="isAlreadyPortSupplier(company.localId)"
                          (click)="addCompanyAsSupplier(company.localId, company.name)"
                        >
                          <div>
                            <span class="font-medium text-gray-900">{{ company.name }}</span>
                            @if (company.country) {
                              <span class="ml-1 text-xs text-gray-500">{{ company.country }}</span>
                            }
                          </div>
                          @if (isAlreadyPortSupplier(company.localId)) {
                            <span class="text-xs text-gray-400">Already added</span>
                          } @else {
                            <span class="text-xs font-medium text-brand-600">Add</span>
                          }
                        </button>
                      }
                    </div>
                  } @else if (addSupplierQuery().length >= 2 && !addSupplierLoading()) {
                    <p class="text-xs text-gray-500 px-1">No matching companies found. Create the company first in the Companies section.</p>
                  }
                </div>
              }

              @if (suppliers().length > 0) {
                <div class="mb-3">
                  <input
                    type="text"
                    class="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    [ngModel]="supplierFilter()"
                    (ngModelChange)="supplierFilter.set($event)"
                    placeholder="Filter suppliers, contacts, emails, or products"
                  />
                </div>
              }

              @if (loadingSuppliers()) {
                <div class="flex items-center justify-center py-8 text-gray-400">
                  <svg class="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Loading suppliers...
                </div>
              } @else if (suppliers().length === 0) {
                <div class="text-center py-8 text-gray-400 text-sm">
                  No suppliers registered for this port.
                  <br/>
                  Add port suppliers via the Places section.
                </div>
              } @else if (filteredSuppliers().length === 0) {
                <div class="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
                  No suppliers match the current filter.
                </div>
              } @else {
                <div class="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-64 overflow-y-auto">
                  @for (s of filteredSuppliers(); track s.portSupplierId) {
                    <label
                      class="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                      [class.bg-brand-50]="s.selected"
                      [class.opacity-60]="!s.email && !s.emailOverride"
                    >
                      <input
                        type="checkbox"
                        class="h-4 w-4 mt-0.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                        [checked]="s.selected"
                        (change)="toggleSupplier(s)"
                        [disabled]="!s.email && !s.emailOverride"
                      />
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="text-sm font-medium text-gray-900 truncate">{{ s.supplierName }}</span>
                          @if (isRecommendedSupplier(s)) {
                            <span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                              {{ recommendationLabel(s) }}
                            </span>
                          }
                          @if (s.inquiryStatus) {
                            <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                              [class]="statusBadgeClass(s.inquiryStatus)">
                              {{ s.inquiryStatus }}
                            </span>
                          }
                        </div>
                        @if (s.contactName) {
                          <div class="text-xs text-gray-500 mt-0.5">{{ s.contactName }}</div>
                        }
                        @if (s.companyEmails.length || s.contacts.length) {
                          <div class="mt-1 flex items-center gap-3 text-[11px] text-gray-500">
                            <span>{{ recipientOptionCount(s) }} recipient option{{ recipientOptionCount(s) === 1 ? '' : 's' }}</span>
                            <button
                              type="button"
                              class="font-medium text-brand-600 hover:text-brand-700"
                              (click)="toggleExpanded(s, $event)"
                            >
                              {{ s.expanded ? 'Hide recipient tree' : 'Show recipient tree' }}
                            </button>
                          </div>
                        }
                        @if (s.products && s.products.length > 0) {
                          <div class="flex flex-wrap gap-1 mt-1">
                            @for (p of s.products; track p) {
                              <span class="inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                                {{ p }}
                              </span>
                            }
                          </div>
                        }
                        @if (hasPerformanceStats(s)) {
                          <div class="mt-1.5 flex flex-wrap gap-1.5">
                            @if (s.performance.deliveredCountOverall > 0) {
                              <span class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                                {{ s.performance.deliveredCountOverall }} delivered
                              </span>
                            }
                            @if (s.performance.deliveredCountAtPlace > 0) {
                              <span class="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 ring-1 ring-blue-200">
                                {{ s.performance.deliveredCountAtPlace }} at this place
                              </span>
                            }
                            @if (s.performance.quotedCount > 0) {
                              <span class="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">
                                {{ s.performance.quotedCount }} quoted
                              </span>
                            }
                            @if (quoteRateLabel(s)) {
                              <span class="inline-flex items-center rounded-full bg-fuchsia-50 px-2 py-0.5 text-[10px] font-medium text-fuchsia-700 ring-1 ring-fuchsia-200">
                                {{ quoteRateLabel(s) }}
                              </span>
                            }
                            @if (averageResponseLabel(s)) {
                              <span class="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">
                                {{ averageResponseLabel(s) }}
                              </span>
                            }
                            @if (deliverabilityLabel(s)) {
                              <span class="inline-flex items-center rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-700 ring-1 ring-teal-200">
                                {{ deliverabilityLabel(s) }}
                              </span>
                            }
                            @if (performanceSummary(s)) {
                              <span class="inline-flex items-center rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-600 ring-1 ring-gray-200">
                                {{ performanceSummary(s) }}
                              </span>
                            }
                          </div>
                        }
                        <!-- Email field (editable) -->
                        <div class="mt-1">
                          @if (s.email || s.emailOverride) {
                            <input
                              type="email"
                              class="w-full text-xs rounded border-gray-200 bg-gray-50 px-2 py-1 text-gray-600 focus:bg-white focus:border-brand-400 focus:ring-1 focus:ring-brand-300"
                              [value]="s.emailOverride || s.email || ''"
                              (input)="onEmailEdit(s, $event)"
                              (click)="$event.stopPropagation()"
                              placeholder="Email address"
                            />
                          } @else {
                            <span class="text-xs text-red-400">No email on file</span>
                          }
                        </div>
                        @if (resolvedRecipientEmail(s)) {
                          <div class="mt-1 text-[11px] text-gray-500">
                            Using: <span class="font-medium text-gray-700">{{ resolvedRecipientEmail(s) }}</span>
                            @if (resolvedRecipientLabel(s)) {
                              <span> • {{ resolvedRecipientLabel(s) }}</span>
                            }
                          </div>
                        }
                        <!-- CC company email checkbox -->
                        @if (s.selected && s.contactId && ccCompanyEmailAddress(s)) {
                          <label class="mt-1.5 flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer" (click)="$event.stopPropagation()">
                            <input
                              type="checkbox"
                              class="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                              [checked]="s.ccCompanyEmail"
                              (change)="toggleCcCompanyEmail(s)"
                            />
                            Also send to {{ ccCompanyEmailAddress(s) }}
                          </label>
                        }
                        <!-- Personal note -->
                        @if (s.selected) {
                          <div class="mt-1.5" (click)="$event.stopPropagation()">
                            @if (s.personalNote) {
                              <textarea
                                class="w-full text-xs rounded border-gray-200 bg-gray-50 px-2 py-1.5 text-gray-600 focus:bg-white focus:border-brand-400 focus:ring-1 focus:ring-brand-300 resize-none"
                                rows="2"
                                [value]="s.personalNote"
                                (input)="onPersonalNoteEdit(s, $event)"
                                placeholder="e.g. Hope the weekend football match went well!"
                              ></textarea>
                            } @else {
                              <button
                                type="button"
                                class="text-[11px] font-medium text-brand-600 hover:text-brand-700"
                                (click)="enablePersonalNote(s)"
                              >
                                + Add personal note
                              </button>
                            }
                          </div>
                        }
                        <div class="mt-2">
                          <input
                            type="tel"
                            class="w-full text-xs rounded border-gray-200 bg-gray-50 px-2 py-1 text-gray-600 focus:bg-white focus:border-green-400 focus:ring-1 focus:ring-green-300 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                            [value]="resolvedWhatsAppPhone(s)"
                            (input)="onPhoneEdit(s, $event)"
                            (click)="$event.stopPropagation()"
                            placeholder="WhatsApp number"
                            [disabled]="!waLinked()"
                          />
                          @if (waLinked() && resolvedWhatsAppPhone(s)) {
                            <div class="mt-1 text-[11px] text-gray-500">
                              WhatsApp: <span class="font-medium text-gray-700">{{ resolvedWhatsAppPhone(s) }}</span>
                              @if (resolvedWhatsAppLabel(s)) {
                                <span> • {{ resolvedWhatsAppLabel(s) }}</span>
                              }
                            </div>
                          } @else if (waLinked() && whatsappOptionCount(s) > 0) {
                            <div class="mt-1 text-[11px] text-gray-500">Choose a contact phone below or enter one manually.</div>
                          } @else if (!waLinked()) {
                            <div class="mt-1 text-[11px] text-gray-400">Link WhatsApp in Settings to send inquiries here.</div>
                          }
                        </div>
                        @if (s.expanded && (s.companyEmails.length || s.contacts.length)) {
                          <div class="mt-3 space-y-3 rounded-lg border border-gray-200 bg-white/80 p-3" (click)="$event.stopPropagation()">
                            @if (s.companyEmails.length) {
                              <div>
                                <div class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Company emails</div>
                                <div class="space-y-1.5 border-l border-gray-200 pl-3">
                                  @for (companyEmail of s.companyEmails; track companyEmail.email) {
                                    <button
                                      type="button"
                                      class="flex w-full items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors"
                                      [class.border-brand-300]="isSelectedRecipientOption(s, companyEmail.email, null)"
                                      [class.bg-brand-50]="isSelectedRecipientOption(s, companyEmail.email, null)"
                                      [class.border-gray-200]="!isSelectedRecipientOption(s, companyEmail.email, null)"
                                      [class.hover:border-brand-300]="!isSelectedRecipientOption(s, companyEmail.email, null)"
                                      [class.hover:bg-brand-50]="!isSelectedRecipientOption(s, companyEmail.email, null)"
                                      (click)="applySupplierEmail(s, companyEmail.email, null, null, null, $event)"
                                    >
                                      <span class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                                        [class.border-brand-500]="isSelectedRecipientOption(s, companyEmail.email, null)"
                                        [class.border-gray-300]="!isSelectedRecipientOption(s, companyEmail.email, null)">
                                        @if (isSelectedRecipientOption(s, companyEmail.email, null)) {
                                          <span class="h-2 w-2 rounded-full bg-brand-600"></span>
                                        }
                                      </span>
                                      <div class="min-w-0 flex-1">
                                        <div class="truncate text-xs font-medium text-gray-800">{{ companyEmail.email }}</div>
                                        <div class="text-[11px] text-gray-500">
                                          {{ formatEmailType(companyEmail.emailType) }}{{ companyEmail.isPrimary ? ' • Primary' : '' }}
                                        </div>
                                      </div>
                                    </button>
                                  }
                                </div>
                              </div>
                            }

                            @if (s.contacts.length) {
                              <div>
                                <div class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Contacts</div>
                                <div class="space-y-1.5 border-l border-gray-200 pl-3">
                                  @for (contact of s.contacts; track contact.id) {
                                    <button
                                      type="button"
                                      class="flex w-full items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors"
                                      [class.border-brand-300]="contact.email && isSelectedRecipientOption(s, contact.email, contact.id)"
                                      [class.bg-brand-50]="contact.email && isSelectedRecipientOption(s, contact.email, contact.id)"
                                      [class.border-gray-200]="!contact.email || !isSelectedRecipientOption(s, contact.email, contact.id)"
                                      [class.hover:border-brand-300]="contact.email && !isSelectedRecipientOption(s, contact.email, contact.id)"
                                      [class.hover:bg-brand-50]="contact.email && !isSelectedRecipientOption(s, contact.email, contact.id)"
                                      [disabled]="!contact.email"
                                      (click)="applySupplierEmail(s, contact.email!, contact.id, contact.name, contact.phone, $event)"
                                    >
                                      <span class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                                        [class.border-brand-500]="contact.email && isSelectedRecipientOption(s, contact.email, contact.id)"
                                        [class.border-gray-300]="!contact.email || !isSelectedRecipientOption(s, contact.email, contact.id)">
                                        @if (contact.email && isSelectedRecipientOption(s, contact.email, contact.id)) {
                                          <span class="h-2 w-2 rounded-full bg-brand-600"></span>
                                        }
                                      </span>
                                      <div class="min-w-0 flex-1">
                                        <div class="truncate text-xs font-medium text-gray-800">{{ contact.name }}</div>
                                        <div class="text-[11px] text-gray-500">{{ contact.role || 'Contact person' }}</div>
                                        @if (contact.email) {
                                          <div class="truncate text-[11px] text-gray-600">{{ contact.email }}</div>
                                        }
                                        @if (contact.phone) {
                                          <div class="truncate text-[11px] text-gray-600">{{ contact.phone }}</div>
                                        }
                                        @if (!contact.email && !contact.phone) {
                                          <div class="text-[11px] text-red-400">No email on file</div>
                                        }
                                      </div>
                                      @if (contact.phone) {
                                        <button
                                          type="button"
                                          class="self-center text-[11px] font-medium text-green-600 hover:text-green-700 disabled:cursor-not-allowed disabled:text-gray-300"
                                          (click)="applySupplierPhone(s, contact.phone, contact.id, contact.name, $event)"
                                          [disabled]="!waLinked()"
                                        >
                                          WA
                                        </button>
                                      }
                                    </button>
                                  }
                                </div>
                              </div>
                            }
                          </div>
                        }
                        @if (s.inquirySentAt) {
                          <div class="text-xs text-gray-400 mt-0.5">
                            Sent {{ formatDate(s.inquirySentAt) }}
                          </div>
                        }
                      </div>
                    </label>
                  }
                </div>
              }
            </div>

            <!-- Subject -->
            <div>
              <label for="inquiry-subject" class="block text-sm font-medium text-gray-700">Subject</label>
              <input
                id="inquiry-subject"
                type="text"
                class="mt-1 block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                [ngModel]="subject()"
                (ngModelChange)="subject.set($event)"
              />
            </div>

            <div>
              <label for="inquiry-deadline" class="block text-sm font-medium text-gray-700">Response deadline</label>
              <input
                id="inquiry-deadline"
                type="datetime-local"
                class="mt-1 block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                [ngModel]="responseDeadlineAt()"
                (ngModelChange)="onDeadlineChange($event)"
              />
              <p class="mt-2 text-xs leading-5 text-gray-500">A reminder will be sent automatically before this deadline if the supplier has not replied.</p>
            </div>

            <!-- Additional recipients -->
            <div>
              <label class="block text-sm font-medium text-gray-700">Additional recipients</label>
              <div class="mt-1">
                <app-email-tag-input
                  #recipientInput
                  [orderId]="orderId()"
                  placeholder="Add recipient..."
                  (tagsChange)="recipientTags.set($event)"
                />
              </div>
              <p class="mt-2 text-xs leading-5 text-gray-500">Each address here receives its own separate email, just like a selected supplier.</p>
            </div>

            <!-- Body editor -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Email Body</label>
              <p class="mb-2 text-xs leading-5 text-gray-500">
                The content you edit here is the email body that will be sent. Recipient placeholders like name, senderName, and companyName are resolved separately for each recipient when sending.
              </p>
              <div class="border border-gray-300 rounded-lg overflow-hidden">
                <!-- Toolbar -->
                <div class="flex items-center gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1.5">
                  <button type="button" (click)="execCommand('bold')" class="toolbar-btn" title="Bold">
                    <strong>B</strong>
                  </button>
                  <button type="button" (click)="execCommand('italic')" class="toolbar-btn" title="Italic">
                    <em>I</em>
                  </button>
                  <button type="button" (click)="execCommand('underline')" class="toolbar-btn" title="Underline">
                    <u>U</u>
                  </button>
                  <div class="w-px h-4 bg-gray-300 mx-1"></div>
                  <button type="button" (click)="execCommand('insertUnorderedList')" class="toolbar-btn" title="Bullet list">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M6 4.75A.75.75 0 016.75 4h10.5a.75.75 0 010 1.5H6.75A.75.75 0 016 4.75zM6 10a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H6.75A.75.75 0 016 10zm0 5.25a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H6.75a.75.75 0 01-.75-.75zM1.99 4.75a1 1 0 011-1h.01a1 1 0 010 2h-.01a1 1 0 01-1-1zm0 5.25a1 1 0 011-1h.01a1 1 0 010 2h-.01a1 1 0 01-1-1zm0 5.25a1 1 0 011-1h.01a1 1 0 010 2h-.01a1 1 0 01-1-1z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </div>
                <!-- Content editable area -->
                <div
                  #bodyEditor
                  contenteditable="true"
                  class="inquiry-email-canvas min-h-[200px] max-h-[300px] overflow-y-auto px-4 py-3 text-sm text-gray-900 focus:outline-none"
                  (input)="onBodyInput()"
                ></div>
              </div>
            </div>

            @if (htmlBody() || whatsappPreviewText()) {
              <details class="group">
                <summary class="cursor-pointer text-sm text-gray-500 hover:text-gray-700 select-none">
                  Preview message
                  @if (previewRecipientSummary()) {
                    <span class="text-gray-400"> • {{ previewRecipientSummary() }}</span>
                  }
                </summary>
                <div class="mt-3 space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  @if (previewCandidates().length > 1) {
                    <div>
                      <label for="preview-recipient" class="block text-xs font-medium uppercase tracking-[0.08em] text-gray-500">
                        Preview recipient
                      </label>
                      <select
                        id="preview-recipient"
                        class="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                        [ngModel]="previewRecipientId()"
                        (ngModelChange)="previewRecipientId.set($event)"
                      >
                        @for (candidate of previewCandidates(); track candidate.portSupplierId) {
                          <option [value]="candidate.portSupplierId">{{ previewCandidateLabel(candidate) }}</option>
                        }
                      </select>
                    </div>
                  }

                  <div class="flex items-center gap-2 border-b border-gray-200 pb-2">
                    <button
                      type="button"
                      class="rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
                      [class.bg-white]="activePreviewTab() === 'email'"
                      [class.text-gray-900]="activePreviewTab() === 'email'"
                      [class.shadow-sm]="activePreviewTab() === 'email'"
                      [class.text-gray-500]="activePreviewTab() !== 'email'"
                      [class.cursor-not-allowed]="!hasPreviewEmail()"
                      [disabled]="!hasPreviewEmail()"
                      (click)="previewTab.set('email')"
                    >
                      Email
                    </button>
                    <button
                      type="button"
                      class="rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
                      [class.bg-white]="activePreviewTab() === 'whatsapp'"
                      [class.text-gray-900]="activePreviewTab() === 'whatsapp'"
                      [class.shadow-sm]="activePreviewTab() === 'whatsapp'"
                      [class.text-gray-500]="activePreviewTab() !== 'whatsapp'"
                      [class.cursor-not-allowed]="!hasPreviewWhatsApp()"
                      [disabled]="!hasPreviewWhatsApp()"
                      (click)="previewTab.set('whatsapp')"
                    >
                      WhatsApp
                    </button>
                  </div>

                  @if (activePreviewTab() === 'email') {
                    <div class="rounded-lg border border-gray-200 bg-white p-4">
                      @if (hasPreviewEmail()) {
                        <div class="mb-3 text-xs text-gray-500">
                          Preview of the email for {{ previewRecipientSummary() || 'the selected supplier' }}
                        </div>
                        <div class="inquiry-email-canvas min-h-[200px] overflow-auto" [innerHTML]="previewEmailHtml()"></div>
                      } @else {
                        <div class="text-sm text-gray-500">This recipient does not currently have an email destination selected.</div>
                      }
                    </div>
                  } @else {
                    <div class="rounded-2xl border border-green-100 bg-[#e8f5e9] p-4 shadow-sm">
                      @if (hasPreviewWhatsApp()) {
                        <div class="mb-3 flex items-center gap-2 text-xs text-green-800/70">
                          <span class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-white font-semibold">
                            WA
                          </span>
                          <span>Preview of the message sent directly to {{ previewRecipientSummary() || 'the selected supplier' }}</span>
                        </div>
                        <div class="rounded-2xl bg-white/70 px-4 py-3">
                          <pre class="whitespace-pre-wrap break-words font-sans text-[13px] leading-6 text-gray-800">{{ whatsappPreviewText() }}</pre>
                        </div>
                      } @else {
                        <div class="text-sm text-green-900/70">This recipient does not currently have a WhatsApp destination selected.</div>
                      }
                    </div>
                  }
                </div>
              </details>
            }
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-between border-t border-gray-200 px-6 py-4 shrink-0 bg-gray-50 rounded-b-2xl">
            <span class="text-sm text-gray-500">
              @if (totalRecipientCount() > 0) {
                {{ totalRecipientCount() }} email{{ totalRecipientCount() === 1 ? '' : 's' }} will be sent
                @if (selectedWhatsAppCount() > 0) {
                  <span> • {{ selectedWhatsAppCount() }} WhatsApp recipient{{ selectedWhatsAppCount() === 1 ? '' : 's' }}</span>
                }
              } @else {
                Select at least one recipient to send
              }
            </span>
            <div class="flex items-center gap-3">
              <button
                type="button"
                (click)="copyBodyText()"
                class="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                title="Copy RFQ summary"
              >
                @if (copySuccess()) {
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-green-600" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                  </svg>
                  <span class="text-green-600">Copied</span>
                } @else {
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M8 2a1 1 0 000 2h2a1 1 0 100-2H8z" />
                    <path d="M3 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L10.414 13H15v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM15 11h2a1 1 0 110 2h-2v-2z" />
                  </svg>
                  RFQ
                }
              </button>
              <button
                type="button"
                (click)="sendViaWhatsApp()"
                [disabled]="waSending() || !waLinked() || selectedWhatsAppCount() === 0"
                class="inline-flex items-center gap-2 rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                [title]="!waLinked() ? 'Link WhatsApp in Settings to enable this' : (selectedWhatsAppCount() === 0 ? 'Select at least one supplier with a WhatsApp number' : 'Send via WhatsApp')"
              >
                @if (waSending()) {
                  <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Sending...
                } @else {
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  WhatsApp
                }
              </button>
              <button
                type="button"
                (click)="send()"
                [disabled]="sending() || totalRecipientCount() === 0 || !subject()"
                class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white
                  hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                @if (sending()) {
                  <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Sending...
                } @else {
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                  </svg>
                  Send Inquiry
                }
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .toolbar-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      padding: 4px;
      font-size: 14px;
      color: #4b5563;
      min-width: 28px;
      text-align: center;
      cursor: pointer;
      border: none;
      background: transparent;
      transition: background-color 0.15s, color 0.15s;
    }
    .toolbar-btn:hover {
      background-color: #e5e7eb;
      color: #111827;
    }
    .inquiry-email-canvas {
      word-break: break-word;
    }
    .inquiry-email-canvas :where(img) {
      max-width: 100%;
      height: auto;
    }
    .inquiry-email-canvas :where(table) {
      max-width: 100%;
    }
    .inquiry-email-canvas :where(p) {
      margin: 0 0 16px;
      line-height: 1.65;
    }
    .inquiry-email-canvas :where(li) {
      margin: 0;
    }
  `],
})
export class SendInquiryModalComponent {
  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);

  readonly orderId = input.required<string>();
  readonly senderName = input<string>('Fueld User');
  readonly companyName = input<string>('Fueld');
  readonly placeId = input<string>('');
  readonly portName = input<string>('');
  readonly waLinked = input(false);
  readonly vesselName = input<string>('');
  readonly vesselImo = input<string | null>(null);
  readonly eta = input<string | null>(null);
  readonly etd = input<string | null>(null);
  readonly items = input<{ productType: string; quantity: number; quantityMin?: number | null; unit: string }[]>([]);

  readonly sendInquiry = output<SendInquiryPayload>();
  readonly sendWhatsAppInquiry = output<SendInquiryWhatsAppPayload>();
  readonly closed = output<void>();

  readonly open = signal(false);
  readonly loadingSuppliers = signal(false);
  readonly sending = signal(false);
  readonly waSending = signal(false);
  readonly copySuccess = signal(false);
  readonly suppliers = signal<SupplierRow[]>([]);
  readonly supplierFilter = signal('');
  readonly subject = signal('');
  readonly htmlBody = signal('');
  readonly recipientTags = signal<EmailTag[]>([]);
  readonly responseDeadlineAt = signal('');
  readonly previewRecipientId = signal('');
  readonly previewTab = signal<'email' | 'whatsapp'>('email');
  readonly previewCandidates = computed(() =>
    this.suppliers().filter((supplier) => supplier.selected && (!!this.resolvedRecipientEmail(supplier) || !!this.resolvedWhatsAppPhone(supplier))),
  );
  readonly previewRecipient = computed(() => {
    const candidates = this.previewCandidates();
    if (candidates.length === 0) return null;
    return candidates.find((supplier) => supplier.portSupplierId === this.previewRecipientId()) ?? candidates[0] ?? null;
  });
  readonly previewRecipientSummary = computed(() => {
    const supplier = this.previewRecipient();
    return supplier ? this.previewCandidateLabel(supplier) : '';
  });
  readonly hasPreviewEmail = computed(() => {
    const supplier = this.previewRecipient();
    return !!supplier && !!this.resolvedRecipientEmail(supplier);
  });
  readonly hasPreviewWhatsApp = computed(() => {
    const supplier = this.previewRecipient();
    return !!supplier && !!this.resolvedWhatsAppPhone(supplier);
  });
  readonly activePreviewTab = computed<'email' | 'whatsapp'>(() => {
    const preferred = this.previewTab();
    if (preferred === 'email' && this.hasPreviewEmail()) return 'email';
    if (preferred === 'whatsapp' && this.hasPreviewWhatsApp()) return 'whatsapp';
    if (this.hasPreviewEmail()) return 'email';
    return 'whatsapp';
  });
  readonly previewEmailHtml = computed<SafeHtml>(() => {
    const supplier = this.previewRecipient();
    return this.sanitizer.bypassSecurityTrustHtml(this.renderEmailPreview(this.htmlBody(), supplier));
  });
  readonly whatsappPreviewText = computed(() => {
    const supplier = this.previewRecipient();
    if (!supplier) return '';

    const preferredName = (supplier.waContactName?.trim() || supplier.contactName?.trim() || supplier.supplierName.trim() || 'there');
    const vesselName = this.vesselName().trim() || 'Vessel';
    const vesselImo = this.vesselImo()?.trim() || null;
    const vesselLabel = vesselImo ? `${vesselName} (IMO: ${vesselImo})` : vesselName;
    const companyName = this.companyName().trim() || 'Fueld';
    const deliveryLabel = this.deliveryWindowLabel();
    const responseLabel = this.responseDeadlineLabel();
    const itemLines = this.items().map((item) => {
      const max = this.formatInquiryQuantity(item.quantity);
      const min = this.formatInquiryQuantity(item.quantityMin ?? null);
      const qtyLabel = min && min !== max ? `${min} - ${max}` : max;
      return `- ${qtyLabel} ${item.unit} ${item.productType}`;
    });

    return [
      `Good day ${preferredName},`,
      '',
      supplier.personalNote?.trim() || null,
      supplier.personalNote?.trim() ? '' : null,
      'Please offer for the following:',
      `*Vessel:* ${vesselLabel}`,
      `*Place:* ${this.portName().trim() || 'Port'}`,
      deliveryLabel ? `*Delivery:* ${deliveryLabel}` : null,
      responseLabel ? `*Reply within:* ${responseLabel}` : null,
      `*Account:* ${companyName}`,
      '',
      '*Requested items:*',
      ...itemLines,
      '',
      'Best regards,',
      this.senderName().trim() || 'Fueld User',
    ].filter((line): line is string => line !== null && line !== undefined).join('\n');
  });

  // Add-supplier search state
  readonly showAddSupplier = signal(false);
  readonly addSupplierQuery = signal('');
  readonly addSupplierResults = signal<Array<{ localId: string; name: string; country?: string }>>([]);
  readonly addSupplierLoading = signal(false);

  readonly bodyEditor = viewChild<ElementRef<HTMLDivElement>>('bodyEditor');

  readonly selectedCount = computed(() => this.suppliers().filter(s => s.selected).length);
  readonly totalRecipientCount = computed(() => this.selectedCount() + this.recipientTags().length);
  readonly selectedWhatsAppCount = computed(() => this.suppliers().filter((supplier) => supplier.selected && !!this.resolvedWhatsAppPhone(supplier)).length);
  readonly filteredSuppliers = computed(() => {
    const query = this.supplierFilter().trim().toLowerCase();
    const filtered = !query
      ? [...this.suppliers()]
      : this.suppliers().filter((supplier) => {
        const values = [
          supplier.supplierName,
          supplier.contactName ?? '',
          supplier.email ?? '',
          supplier.emailOverride,
          supplier.phone ?? '',
          supplier.phoneOverride,
          ...supplier.products,
          ...supplier.companyEmails.map((email) => email.email),
          ...supplier.contacts.flatMap((contact) => [contact.name, contact.role ?? '', contact.email ?? '', contact.phone ?? '']),
        ];
        return values.some((value) => value.toLowerCase().includes(query));
      });

    return filtered.sort((left, right) => this.compareSupplierPriority(left, right));
  });
  readonly allSelected = computed(() => {
    const list = this.suppliers().filter(s => s.email || s.emailOverride);
    return list.length > 0 && list.every(s => s.selected);
  });
  readonly someSelected = computed(() => this.suppliers().some(s => s.selected));

  /** Open the modal and load suppliers + email defaults */
  show(): void {
    this.open.set(true);
    this.recipientTags.set([]);
    this.responseDeadlineAt.set('');
    this.previewRecipientId.set('');
    this.previewTab.set('email');
    this.showAddSupplier.set(false);
    this.addSupplierQuery.set('');
    this.addSupplierResults.set([]);
    this.loadSuppliers();
    this.loadDefaults();
  }

  close(): void {
    this.open.set(false);
    this.sending.set(false);
    this.waSending.set(false);
    this.recipientTags.set([]);
    this.previewRecipientId.set('');
    this.closed.emit();
  }

  /** Mark sending complete (called from parent after API response) */
  done(): void {
    this.sending.set(false);
  }

  waDone(): void {
    this.waSending.set(false);
  }

  private loadSuppliers(): void {
    this.loadingSuppliers.set(true);
    this.http.get<{ success: boolean; data: any[] }>(`${API_URL}/orders/${this.orderId()}/inquiry/suppliers`)
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.suppliers.set(res.data.map((s: any) => ({
              ...s,
              selected: !s.inquiryStatus && !!s.email,  // pre-select unsent suppliers with email
              emailOverride: '',
              phoneOverride: '',
              expanded: (s.companyEmails?.length ?? 0) + (s.contacts?.length ?? 0) > 0,
              ccCompanyEmail: false,
              personalNote: '',
            })));
          }
          this.loadingSuppliers.set(false);
        },
        error: () => {
          this.loadingSuppliers.set(false);
        },
      });
  }

  private loadDefaults(): void {
    this.http.post<{ success: boolean; data: any }>(`${API_URL}/orders/${this.orderId()}/inquiry/defaults`, {
      eta: this.eta(),
      etd: this.etd(),
    })
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.subject.set(res.data.subject ?? '');
            this.responseDeadlineAt.set(this.toDateTimeLocal(res.data.responseDeadlineAt ?? ''));
            const syncedHtml = this.syncInquiryBodyMetadataHtml(res.data.htmlBody ?? '');
            this.htmlBody.set(syncedHtml);
            // Set the body editor content
            setTimeout(() => {
              const editor = this.bodyEditor()?.nativeElement;
              if (editor) {
                editor.innerHTML = syncedHtml;
              }
            });
          }
        },
      });
  }

  toggleAll(): void {
    const shouldSelect = !this.allSelected();
    this.suppliers.update(list =>
      list.map(s => ({
        ...s,
        selected: (s.email || s.emailOverride) ? shouldSelect : false,
      })),
    );
  }

  toggleSupplier(supplier: SupplierRow): void {
    this.suppliers.update(list =>
      list.map(s =>
        s.portSupplierId === supplier.portSupplierId
          ? { ...s, selected: !s.selected }
          : s,
      ),
    );
  }

  toggleExpanded(supplier: SupplierRow, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.suppliers.update((list) =>
      list.map((row) =>
        row.portSupplierId === supplier.portSupplierId
          ? { ...row, expanded: !row.expanded }
          : row,
      ),
    );
  }

  onEmailEdit(supplier: SupplierRow, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.suppliers.update(list =>
      list.map(s =>
        s.portSupplierId === supplier.portSupplierId
          ? { ...s, emailOverride: value, contactId: null, contactName: null }
          : s,
      ),
    );
  }

  onPhoneEdit(supplier: SupplierRow, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.suppliers.update((list) =>
      list.map((row) =>
        row.portSupplierId === supplier.portSupplierId
          ? { ...row, phoneOverride: value, waContactId: null, waContactName: null }
          : row,
      ),
    );
  }

  applySupplierEmail(
    supplier: SupplierRow,
    email: string,
    contactId: string | null,
    contactName: string | null,
    phone: string | null,
    event: Event,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    this.suppliers.update((list) =>
      list.map((row) =>
        row.portSupplierId === supplier.portSupplierId
          ? {
              ...row,
              emailOverride: email,
              contactId,
              contactName,
              phoneOverride: contactId && phone ? phone : row.phoneOverride,
              waContactId: contactId && phone ? contactId : row.waContactId,
              waContactName: contactId && phone ? contactName : row.waContactName,
              selected: true,
            }
          : row,
      ),
    );
  }

  applySupplierPhone(
    supplier: SupplierRow,
    phone: string,
    contactId: string | null,
    contactName: string | null,
    event: Event,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    this.suppliers.update((list) =>
      list.map((row) =>
        row.portSupplierId === supplier.portSupplierId
          ? {
              ...row,
              phoneOverride: phone,
              waContactId: contactId,
              waContactName: contactName,
              selected: true,
            }
          : row,
      ),
    );
  }

  onBodyInput(): void {
    const editor = this.bodyEditor()?.nativeElement;
    if (editor) {
      this.htmlBody.set(editor.innerHTML);
    }
  }

  onDeadlineChange(value: string): void {
    this.responseDeadlineAt.set(value);
    this.syncInquiryBodyMetadata();
  }

  execCommand(command: string): void {
    document.execCommand(command, false);
    this.onBodyInput();
  }

  copyBodyText(): void {
    const lines: string[] = [];
    const vessel = this.vesselName();
    if (vessel) lines.push(vessel);
    const imo = this.vesselImo();
    if (imo) lines.push(`IMO ${imo}`);
    const port = this.portName();
    if (port) lines.push(port);
    for (const item of this.items()) {
      const fmtQty = (v: number) => Number.isInteger(v) ? v.toString() : v.toString();
      const min = item.quantityMin != null ? fmtQty(item.quantityMin) : '';
      const max = fmtQty(item.quantity);
      const qty = min && min !== max ? `${min} - ${max}` : max;
      lines.push(`${item.productType} ${qty} ${item.unit}`);
    }
    const eta = this.eta();
    if (eta) {
      const d = new Date(eta);
      lines.push(`ETA ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`);
    }
    const etd = this.etd();
    if (etd) {
      const d = new Date(etd);
      lines.push(`ETD ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`);
    }
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      this.copySuccess.set(true);
      setTimeout(() => this.copySuccess.set(false), 2000);
    });
  }

  send(): void {
    const selected = this.suppliers().filter(s => s.selected);
    if (selected.length === 0 && this.recipientTags().length === 0) return;

    this.syncInquiryBodyMetadata();
    this.sending.set(true);
    this.sendInquiry.emit({
      suppliers: selected.map(s => ({
        supplierId: s.supplierId,
        supplierName: s.supplierName,
        email: s.emailOverride || s.email!,
        contactId: s.contactId ?? undefined,
        contactName: s.contactName ?? undefined,
        ccEmail: s.ccCompanyEmail ? this.ccCompanyEmailAddress(s) : undefined,
        personalNote: s.personalNote.trim() || undefined,
      })),
      recipientEmails: this.recipientTags().map((tag) => tag.email),
      subject: this.subject(),
      htmlBody: this.htmlBody(),
      eta: this.eta(),
      etd: this.etd(),
      responseDeadlineAt: this.toIsoFromDateTimeLocal(this.responseDeadlineAt()),
    });
  }

  private toDateTimeLocal(value: string): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = String(date.getFullYear()).padStart(4, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  private toIsoFromDateTimeLocal(value: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  sendViaWhatsApp(): void {
    const recipients = this.suppliers()
      .filter((supplier) => supplier.selected)
      .map((supplier) => ({
        supplierId: supplier.supplierId,
        supplierName: supplier.supplierName,
        phone: this.resolvedWhatsAppPhone(supplier),
        contactId: supplier.waContactId ?? undefined,
        contactName: supplier.waContactName ?? undefined,
        personalNote: supplier.personalNote?.trim() || undefined,
      }))
      .filter((recipient) => !!recipient.phone) as SendInquiryWhatsAppPayload['recipients'];

    if (recipients.length === 0) return;

    this.syncInquiryBodyMetadata();
    this.waSending.set(true);
    this.sendWhatsAppInquiry.emit({
      recipients,
      subject: this.subject(),
      eta: this.eta(),
      etd: this.etd(),
      responseDeadlineAt: this.toIsoFromDateTimeLocal(this.responseDeadlineAt()),
    });
  }

  statusBadgeClass(status: string): string {
    switch (status) {
      case 'SENT': return 'bg-blue-100 text-blue-700';
      case 'QUOTED': return 'bg-green-100 text-green-700';
      case 'DECLINED': return 'bg-red-100 text-red-700';
      case 'NO_REPLY': return 'bg-gray-100 text-gray-500';
      default: return 'bg-gray-100 text-gray-500';
    }
  }

  formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  formatShortDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  formatEmailType(value: string): string {
    return value
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }

  recipientOptionCount(supplier: SupplierRow): number {
    return supplier.companyEmails.length + supplier.contacts.filter((contact) => !!contact.email).length;
  }

  hasPerformanceStats(supplier: SupplierRow): boolean {
    return supplier.performance.deliveredCountOverall > 0
      || supplier.performance.deliveredCountAtPlace > 0
      || supplier.performance.sentCount > 0
      || supplier.performance.quotedCount > 0
      || supplier.performance.declinedCount > 0
      || supplier.performance.noReplyCount > 0
      || supplier.performance.respondedCount > 0
      || supplier.performance.deliverableCount > 0
      || supplier.performance.nonDeliverableCount > 0
      || !!supplier.performance.lastDeliveredAtOverall;
  }

  quoteRateLabel(supplier: SupplierRow): string {
    const sentCount = supplier.performance.sentCount;
    if (sentCount <= 0 || supplier.performance.quotedCount <= 0) return '';
    const rate = Math.round((supplier.performance.quotedCount / sentCount) * 100);
    return `${rate}% quote rate`;
  }

  averageResponseLabel(supplier: SupplierRow): string {
    const hours = supplier.performance.averageResponseHours;
    if (hours == null || supplier.performance.respondedCount <= 0) return '';
    if (hours >= 24) {
      return `${Number((hours / 24).toFixed(1))}d avg reply`;
    }
    return `${Number(hours.toFixed(1))}h avg reply`;
  }

  deliverabilityLabel(supplier: SupplierRow): string {
    const total = supplier.performance.deliverableCount + supplier.performance.nonDeliverableCount;
    if (total <= 0) return '';
    return `${Math.round((supplier.performance.deliverableCount / total) * 100)}% deliverable`;
  }

  performanceSummary(supplier: SupplierRow): string {
    if (supplier.performance.lastDeliveredAtPlace) {
      return `Last here ${this.formatShortDate(supplier.performance.lastDeliveredAtPlace)}`;
    }
    if (supplier.performance.lastDeliveredAtOverall) {
      return `Last served ${this.formatShortDate(supplier.performance.lastDeliveredAtOverall)}`;
    }
    if (supplier.performance.noReplyCount > 0) {
      return `${supplier.performance.noReplyCount} no reply`;
    }
    if (supplier.performance.declinedCount > 0) {
      return `${supplier.performance.declinedCount} declined`;
    }
    return '';
  }

  isRecommendedSupplier(supplier: SupplierRow): boolean {
    const topSupplier = this.filteredSuppliers()[0];
    return !!topSupplier && topSupplier.portSupplierId === supplier.portSupplierId && this.performanceScore(supplier) > 0;
  }

  recommendationLabel(supplier: SupplierRow): string {
    if (supplier.performance.deliveredCountAtPlace > 0) return 'Best history here';
    return 'Top match';
  }

  whatsappOptionCount(supplier: SupplierRow): number {
    return supplier.contacts.filter((contact) => !!contact.phone).length;
  }

  resolvedRecipientEmail(supplier: SupplierRow): string {
    return supplier.emailOverride || supplier.email || '';
  }

  resolvedWhatsAppPhone(supplier: SupplierRow): string {
    return supplier.phoneOverride || supplier.phone || '';
  }

  isSelectedRecipientOption(supplier: SupplierRow, email: string | null, contactId: string | null): boolean {
    if (!email) return false;
    return this.resolvedRecipientEmail(supplier).toLowerCase() === email.toLowerCase()
      && (contactId ? supplier.contactId === contactId : !supplier.contactId);
  }

  isSelectedWhatsAppOption(supplier: SupplierRow, phone: string | null, contactId: string | null): boolean {
    if (!phone) return false;
    return this.resolvedWhatsAppPhone(supplier) === phone
      && (contactId ? supplier.waContactId === contactId : !supplier.waContactId);
  }

  resolvedRecipientLabel(supplier: SupplierRow): string {
    const resolvedEmail = this.resolvedRecipientEmail(supplier);
    if (!resolvedEmail) return '';

    const selectedContact = supplier.contactId
      ? supplier.contacts.find((contact) => contact.id === supplier.contactId)
      : null;
    if (selectedContact?.name) {
      return selectedContact.role ? `${selectedContact.name} (${selectedContact.role})` : selectedContact.name;
    }

    const matchedCompanyEmail = supplier.companyEmails.find((email) => email.email.toLowerCase() === resolvedEmail.toLowerCase());
    if (matchedCompanyEmail) {
      const typeLabel = this.formatEmailType(matchedCompanyEmail.emailType);
      return matchedCompanyEmail.isPrimary ? `${typeLabel} / Primary` : typeLabel;
    }

    return supplier.contactName ? `${supplier.contactName} / Custom` : 'Custom email';
  }

  previewCandidateLabel(supplier: SupplierRow): string {
    const emailLabel = this.resolvedRecipientLabel(supplier);
    const whatsappLabel = this.resolvedWhatsAppLabel(supplier);
    const contactLabel = supplier.contactName || supplier.waContactName || supplier.supplierName;
    const channelParts = [
      this.resolvedRecipientEmail(supplier) ? 'Email' : '',
      this.resolvedWhatsAppPhone(supplier) ? 'WhatsApp' : '',
    ].filter(Boolean);

    const detail = emailLabel || whatsappLabel || supplier.supplierName;
    return `${contactLabel} - ${detail}${channelParts.length ? ` [${channelParts.join(' + ')}]` : ''}`;
  }

  resolvedWhatsAppLabel(supplier: SupplierRow): string {
    const resolvedPhone = this.resolvedWhatsAppPhone(supplier);
    if (!resolvedPhone) return '';

    const selectedContact = supplier.waContactId
      ? supplier.contacts.find((contact) => contact.id === supplier.waContactId)
      : null;
    if (selectedContact?.name) {
      return selectedContact.role ? `${selectedContact.name} (${selectedContact.role})` : selectedContact.name;
    }

    return supplier.waContactName ? `${supplier.waContactName} / Custom` : 'Custom number';
  }

  // ─── CC Company Email ───────────────────────────────────────────

  /** Return the primary company email for a supplier that differs from the resolved email. */
  ccCompanyEmailAddress(supplier: SupplierRow): string {
    const resolvedEmail = this.resolvedRecipientEmail(supplier).toLowerCase();
    const primary = supplier.companyEmails.find((e) => e.isPrimary);
    const candidate = primary ?? supplier.companyEmails[0];
    if (!candidate) return '';
    return candidate.email.toLowerCase() !== resolvedEmail ? candidate.email : '';
  }

  toggleCcCompanyEmail(supplier: SupplierRow): void {
    this.suppliers.update((list) =>
      list.map((row) =>
        row.portSupplierId === supplier.portSupplierId
          ? { ...row, ccCompanyEmail: !row.ccCompanyEmail }
          : row,
      ),
    );
  }

  // ─── Personal Note ────────────────────────────────────────────

  enablePersonalNote(supplier: SupplierRow): void {
    this.suppliers.update((list) =>
      list.map((row) =>
        row.portSupplierId === supplier.portSupplierId
          ? { ...row, personalNote: ' ' }
          : row,
      ),
    );
  }

  onPersonalNoteEdit(supplier: SupplierRow, event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.suppliers.update((list) =>
      list.map((row) =>
        row.portSupplierId === supplier.portSupplierId
          ? { ...row, personalNote: value }
          : row,
      ),
    );
  }

  // ─── Add Supplier ─────────────────────────────────────────────

  private addSupplierDebounce: any;

  onAddSupplierSearch(query: string): void {
    this.addSupplierQuery.set(query);
    clearTimeout(this.addSupplierDebounce);
    if (query.trim().length < 2) {
      this.addSupplierResults.set([]);
      return;
    }
    this.addSupplierLoading.set(true);
    this.addSupplierDebounce = setTimeout(() => {
      this.http.get<any[]>(`${API_URL}/lloyds/companies`, { params: { name: query.trim() } })
        .subscribe({
          next: (results) => {
            this.addSupplierResults.set(
              results
                .filter((r: any) => r.source === 'local' && r.localId)
                .map((r: any) => ({ localId: r.localId, name: r.name, country: r.country })),
            );
            this.addSupplierLoading.set(false);
          },
          error: () => {
            this.addSupplierResults.set([]);
            this.addSupplierLoading.set(false);
          },
        });
    }, 300);
  }

  isAlreadyPortSupplier(companyId: string): boolean {
    return this.suppliers().some((s) => s.supplierId === companyId);
  }

  addCompanyAsSupplier(companyId: string, companyName: string): void {
    const pId = this.placeId();
    if (!pId) return;
    this.http.post<any>(`${API_URL}/lloyds/places/local/${pId}/suppliers`, { companyId })
      .subscribe({
        next: () => {
          this.showAddSupplier.set(false);
          this.addSupplierQuery.set('');
          this.addSupplierResults.set([]);
          this.loadSuppliers();
        },
        error: (err) => {
          console.error('Failed to add supplier:', err);
        },
      });
  }

  private compareSupplierPriority(left: SupplierRow, right: SupplierRow): number {
    const scoreDiff = this.performanceScore(right) - this.performanceScore(left);
    if (scoreDiff !== 0) return scoreDiff;

    const leftSelectable = Number(!!this.resolvedRecipientEmail(left));
    const rightSelectable = Number(!!this.resolvedRecipientEmail(right));
    if (rightSelectable !== leftSelectable) return rightSelectable - leftSelectable;

    return left.supplierName.localeCompare(right.supplierName);
  }

  private performanceScore(supplier: SupplierRow): number {
    const lastAtPlace = supplier.performance.lastDeliveredAtPlace ? Date.parse(supplier.performance.lastDeliveredAtPlace) : 0;
    const lastOverall = supplier.performance.lastDeliveredAtOverall ? Date.parse(supplier.performance.lastDeliveredAtOverall) : 0;
    const quoteRate = supplier.performance.sentCount > 0
      ? supplier.performance.quotedCount / supplier.performance.sentCount
      : 0;
    const deliverabilityRate = supplier.performance.deliverableCount + supplier.performance.nonDeliverableCount > 0
      ? supplier.performance.deliverableCount / (supplier.performance.deliverableCount + supplier.performance.nonDeliverableCount)
      : 0;
    const responseBonus = supplier.performance.averageResponseHours == null
      ? 0
      : Math.max(0, 72 - Math.min(72, supplier.performance.averageResponseHours)) * 5;

    return supplier.performance.deliveredCountAtPlace * 1000
      + supplier.performance.deliveredCountOverall * 100
      + Math.round(quoteRate * 100) * 10
      + Math.round(deliverabilityRate * 100) * 8
      + Math.round(responseBonus)
      + Math.floor(lastAtPlace / 86400000)
      + Math.floor(lastOverall / 86400000 / 10);
  }

  private formatInquiryQuantity(value: number | string | null | undefined): string {
    if (value == null) return '';
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric)) {
      return Number.isInteger(numeric) ? numeric.toString() : numeric.toString();
    }
    return String(value).trim();
  }

  private deliveryWindowLabel(): string {
    return buildInquiryDeliveryWindowLabel(this.eta(), this.etd());
  }

  private responseDeadlineLabel(): string {
    const value = this.responseDeadlineAt();
    if (!value) return '';
    const deadline = new Date(value);
    if (Number.isNaN(deadline.getTime())) return '';
    const hours = Math.round((deadline.getTime() - Date.now()) / 3_600_000);
    if (hours < 1) return '1 hour';
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
    const days = Math.round(hours / 24);
    return days === 1 ? '1 day' : `${days} days`;
  }

  private renderEmailPreview(html: string, supplier: SupplierRow | null): string {
    if (!html) return '';

    const templateVars = this.buildPreviewTemplateVariables(supplier);
    let renderedHtml = this.renderTemplateVariables(html, templateVars);

    const personalNote = supplier?.personalNote?.trim();
    if (personalNote) {
      const escapedNote = this.escapeHtml(personalNote).replace(/\n/g, '<br/>');
      renderedHtml = `<p style="color:#374151;font-style:italic;margin-bottom:16px;">${escapedNote}</p>${renderedHtml}`;
    }

    return renderedHtml;
  }

  private buildPreviewTemplateVariables(supplier: SupplierRow | null): Record<string, string> {
    const supplierName = supplier?.supplierName?.trim() || 'Supplier';
    const contactName = supplier?.contactName?.trim() || supplier?.waContactName?.trim() || '';
    const preferredName = contactName || supplierName || 'there';
    const etaLabel = formatInquiryStoredDateLabel(this.eta()) ?? '';
    const etdLabel = formatInquiryStoredDateLabel(this.etd()) ?? '';
    const deliveryWindow = this.deliveryWindowLabel();

    return {
      vesselName: this.vesselName().trim() || 'Vessel',
      portName: this.portName().trim() || 'Port',
      orderNumber: this.orderId().slice(0, 8).toUpperCase(),
      documentLabel: 'Inquiry',
      eta: etaLabel,
      etd: etdLabel,
      deliveryWindow,
      responseDeadlineFormatted: this.responseDeadlineLabel(),
      senderName: this.senderName().trim() || 'Fueld User',
      companyName: this.companyName().trim() || 'Fueld',
      paymentTerms: '',
      customerNote: '',
      supplierNote: '',
      invoiceNumber: '',
      supplierName,
      contactName: contactName || supplierName,
      name: preferredName,
      quoteFormUrl: '#quote-form-generated-on-send',
    };
  }

  private syncInquiryBodyMetadata(): void {
    const editor = this.bodyEditor()?.nativeElement;
    const currentHtml = editor?.innerHTML ?? this.htmlBody();
    const syncedHtml = this.syncInquiryBodyMetadataHtml(currentHtml);
    if (syncedHtml === currentHtml) return;

    this.htmlBody.set(syncedHtml);
    if (editor && editor.innerHTML !== syncedHtml) {
      editor.innerHTML = syncedHtml;
    }
  }

  private syncInquiryBodyMetadataHtml(html: string): string {
    return syncInquiryMetadataTable(html, {
      deliveryLabel: this.deliveryWindowLabel(),
      responseDeadlineLabel: this.responseDeadlineLabel(),
    });
  }

  private renderTemplateVariables(template: string, variables: Record<string, string>): string {
    return Object.entries(variables).reduce((output, [key, value]) => {
      const normalizedValue = value ?? '';
      return output
        .replaceAll(`\$\{${key}\}`, normalizedValue)
        .replaceAll(`{{${key}}}`, normalizedValue);
    }, template);
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
