import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  OnInit,
  OnDestroy,
  effect,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DecimalPipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, firstValueFrom } from 'rxjs';
import {
  OrderStatus,
  PaymentTermType,
  type OrderDto,
  type CounterpartyDto,
  type VesselDto,
  type PlaceDto,
  type ApiResponse,
  type OwnCompanyDto,
  type CreditLineDto,
  type CompanyContactDto,
  type BankAccountDto,
} from '@fueld/types';

import {
  OrderItemsComponent,
  type OrderItemRow,
} from '../../components/order-items/order-items.component';
import {
  SearchableDropdownComponent,
  type DropdownOption,
} from '../../../../shared/components/searchable-dropdown/searchable-dropdown.component';
import { CommentsCardComponent } from '../../../../shared/components/comments-card/comments-card.component';
import { PdfPreviewModalComponent } from '../../../../shared/components/pdf-preview-modal/pdf-preview-modal.component';
import { ActivityTimelineComponent } from '../../../../shared/components/activity-timeline/activity-timeline.component';
import { FormsModule } from '@angular/forms';
import { TradingDetailHeaderComponent } from '../../components/detail-header/detail-header.component';
import { TradingDetailMetaCardsComponent } from '../../components/detail-meta-cards/detail-meta-cards.component';
import { AuthService } from '../../../../core/auth/auth.service';

// ═══════════════════════════════════════════════════════════════════════
//  Inquiry Detail Page
//
//  Like an order detail but for INQUIRY / OFFER status.
//  Actions: Save, Send Offer to Customer, Send Inquiry to Supplier,
//           Convert to Order, Cancel.
// ═══════════════════════════════════════════════════════════════════════

import { API } from '@app/core/config/api';

interface TeamUserOption {
  id: string;
  name: string;
  email: string;
}

interface CompanySearchResult {
  source: 'local' | 'seasearcher';
  localId?: string;
  seasearcherId?: string;
  name: string;
  country?: string;
}

interface VesselSearchResult {
  source: 'local' | 'seasearcher';
  localId?: string;
  seasearcherId?: string;
  name: string;
  imo?: string;
}

interface LliSearchResult {
  source: 'local' | 'lloyds';
  localId?: string;
  lliPlaceId?: string;
  name: string;
  country?: string;
}

@Component({
  selector: 'app-inquiry-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    DecimalPipe,
    TradingDetailHeaderComponent,
    TradingDetailMetaCardsComponent,
    OrderItemsComponent,
    SearchableDropdownComponent,
    CommentsCardComponent,
    ActivityTimelineComponent,
    PdfPreviewModalComponent,
  ],
  template: `
    @if (pageLoading()) {
      <div class="flex items-center justify-center py-20">
        <svg class="h-8 w-8 animate-spin text-brand-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
      </div>
    } @else {
      <app-trading-detail-header
        title="Inquiry Detail"
        breadcrumbLabel="Inquiries"
        breadcrumbLink="/trading/inquiries"
        [entityNumber]="order()?.orderNumber ?? null"
        [fallbackId]="inquiryId()"
        [status]="order()?.status ?? 'INQUIRY'"
        [subtitle]="subtitle()"
        [showAutosave]="true"
        [autoSaving]="autoSaving()"
        [lastSaved]="lastSaved()"
      >
        <div detail-actions class="flex flex-wrap items-center gap-2">
          <!-- Actions dropdown -->
          <div class="relative">
            <button
              (click)="actionsOpen.set(!actionsOpen())"
              class="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
                     font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
            >
              Actions
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
              </svg>
            </button>

            @if (actionsOpen()) {
              <!-- Backdrop to close -->
              <div class="fixed inset-0 z-40" (click)="actionsOpen.set(false)"></div>
              <div class="absolute right-0 z-50 mt-1 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                @if (!hasInvoicingCompany()) {
                  <div class="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-100">
                    Select an invoicing company to send emails
                  </div>
                }
                <button
                  (click)="openSendOfferModal(); actionsOpen.set(false)"
                  [disabled]="true"
                  class="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-blue-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.154.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" />
                  </svg>
                  Send Offer to Customer
                </button>
                <button
                  (click)="openSendInquiryModal(); actionsOpen.set(false)"
                  [disabled]="true"
                  class="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-purple-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fill-rule="evenodd" d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v11.75A2.75 2.75 0 0 0 16.75 18h-12A2.75 2.75 0 0 1 2 15.25V3.5Zm3.75 7a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-4.5Zm0 3a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-4.5ZM5 5.75A.75.75 0 0 1 5.75 5h4.5a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 8.25v-2.5Z" clip-rule="evenodd" />
                  </svg>
                  Send Inquiry to Supplier
                </button>
                <hr class="my-1 border-gray-100">
                <button
                  (click)="viewOfferPdf(); actionsOpen.set(false)"
                  class="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
                    <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
                  </svg>
                  View Offer PDF
                </button>
                <button
                  (click)="viewProformaPdf(); actionsOpen.set(false)"
                  class="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fill-rule="evenodd" d="M4.5 2A1.5 1.5 0 0 0 3 3.5v13A1.5 1.5 0 0 0 4.5 18h11a1.5 1.5 0 0 0 1.5-1.5V7.621a1.5 1.5 0 0 0-.44-1.06l-4.12-4.122A1.5 1.5 0 0 0 11.378 2H4.5Zm2.25 8.5a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Zm0 3a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5ZM6.75 6a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5h-3.5Z" clip-rule="evenodd" />
                  </svg>
                  View Proforma Invoice
                </button>
                <hr class="my-1 border-gray-100">
                <button
                  (click)="convertToOrder(); actionsOpen.set(false)"
                  class="flex w-full items-center gap-2 px-4 py-2 text-sm text-green-700 hover:bg-green-50"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-green-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd" />
                  </svg>
                  Convert to Order
                </button>
                <button
                  (click)="cancelInquiry(); actionsOpen.set(false)"
                  class="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-700 hover:bg-red-50"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-red-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                  </svg>
                  Cancel Inquiry
                </button>
              </div>
            }
          </div>

          <!-- Settings dropdown -->
          <div class="relative">
            <button
              (click)="settingsOpen.set(!settingsOpen())"
              class="inline-flex items-center rounded-lg border border-gray-300 bg-white p-2 text-sm
                     text-gray-500 shadow-sm hover:bg-gray-50 hover:text-gray-700 transition-colors"
              title="Settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.993 6.993 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clip-rule="evenodd" />
              </svg>
            </button>

            @if (settingsOpen()) {
              <div class="fixed inset-0 z-40" (click)="settingsOpen.set(false)"></div>
              <div class="absolute right-0 z-50 mt-1 w-48 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
                <label class="block text-xs font-medium text-gray-500 mb-1">Currency</label>
                <select [ngModel]="order()?.currency ?? 'USD'" (ngModelChange)="onCurrencyChange($event); settingsOpen.set(false)"
                  class="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900
                         focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white">
                  @for (c of configuredCurrencies(); track c) {
                    <option [value]="c">{{ c }}</option>
                  }
                </select>
              </div>
            }
          </div>
        </div>
      </app-trading-detail-header>

      <app-trading-detail-meta-cards
        [clientName]="clientName()"
        [supplierName]="supplierName()"
        [vesselName]="vesselName()"
        [placeName]="portName()"
        [clientId]="order()?.clientId ?? ''"
        [supplierId]="order()?.supplierId ?? ''"
        [vesselId]="order()?.vesselId ?? ''"
        [placeId]="order()?.placeId ?? ''"
        [clientOptions]="clientDropdownOptions()"
        [supplierOptions]="supplierDropdownOptions()"
        [vesselOptions]="vesselDropdownOptions()"
        [placeOptions]="placeDropdownOptions()"
        [clientLoading]="clientSearchLoading()"
        [supplierLoading]="supplierSearchLoading()"
        [vesselLoading]="vesselSearchLoading()"
        [placeLoading]="placeSearchLoading()"
        [canEditClient]="true"
        [isReadonly]="false"
        [eta]="order()?.eta ?? null"
        [etd]="order()?.etd ?? null"
        [minDateTime]="minDateTime()"
        [etaMinDateTime]="etaMinDateTime()"
        [timezone]="placeTimezone()"
        [invoicingCompanyId]="order()?.invoicingCompanyId ?? ''"
        [invoicingCompanyName]="invoicingCompanyName()"
        [ownCompanies]="ownCompanies()"
        [responsibleUserId]="order()?.salesRepId ?? ''"
        [responsibleOptions]="responsibleUserOptions()"
        (clientSearch)="searchClients($event)"
        (clientChange)="onClientChange($event)"
        (supplierSearch)="searchSuppliers($event)"
        (supplierChange)="onSupplierChange($event)"
        (vesselSearch)="searchVessels($event)"
        (vesselChange)="onVesselChange($event)"
        (placeSearch)="searchPlaces($event)"
        (placeChange)="onPortChange($event)"
        (etaChange)="onEtaChange($event)"
        (etdChange)="onEtdChange($event)"
        (invoicingCompanyChange)="onInvoicingCompanyChange($event)"
        [bankAccountId]="order()?.bankAccountId ?? ''"
        [bankAccountOptions]="bankAccounts()"
        (bankAccountChange)="onBankAccountChange($event)"
        (responsibleChange)="onResponsibleUserChange($event)"
        [customerContactId]="order()?.customerContactId ?? ''"
        [supplierContactId]="order()?.supplierContactId ?? ''"
        [customerContactName]="customerContact()?.name ?? ''"
        [supplierContactName]="supplierContact()?.name ?? ''"
        [customerContactOptions]="customerContactDropdownOptions()"
        [supplierContactOptions]="supplierContactDropdownOptions()"
        (customerContactChange)="onCustomerContactChange($event)"
        (supplierContactChange)="onSupplierContactChange($event)"
      >
        <!-- Customer Payment (projected into client card) -->
        <div customerPayment>
          <p class="text-xs font-medium uppercase tracking-wider text-gray-400 mb-1.5">Payment</p>
          <div class="flex items-center gap-2">
            <select
              [ngModel]="order()?.customerPaymentTermType ?? ''"
              (ngModelChange)="onCustomerPaymentTermChange($event)"
              class="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                     focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
            >
              <option value="">Select</option>
              @for (opt of paymentTermOptions; track opt.value) {
                <option
                  [value]="opt.value"
                  [disabled]="opt.value === 'CREDIT' && !canUseCustomerCredit()"
                >
                  {{ opt.value === 'CREDIT' && !canUseCustomerCredit() ? 'Credit (no line)' : opt.label }}
                </option>
              }
            </select>
            @if (order()?.customerPaymentTermType === 'CREDIT') {
              <input
                type="number"
                min="0"
                [attr.max]="customerCreditSummary()?.maxDays ?? null"
                [ngModel]="order()?.customerCreditDays ?? ''"
                (ngModelChange)="onCustomerCreditDaysChange($event)"
                placeholder="Days"
                class="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm
                       focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            }
          </div>
          <div class="mt-2 text-xs text-gray-500">
            @if (customerCreditLoading()) {
              <span>Loading credit line...</span>
            } @else if (customerCreditSummary()) {
              <span>
                Available: {{ customerCreditSummary()!.available | number : '1.2-2' }}
                {{ customerCreditSummary()!.currency }} · Max {{ customerCreditSummary()!.maxDays }} days
              </span>
            } @else {
              <span>No credit line on file.</span>
            }
          </div>
          <!-- Note toggle -->
          @if (showCustomerPaymentNote()) {
            <div class="mt-2">
              <textarea
                rows="2"
                [ngModel]="order()?.customerNote ?? ''"
                (ngModelChange)="onCustomerNoteChange($event)"
                placeholder="Customer note for PDFs and emails"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700
                       focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              ></textarea>
              <button (click)="showCustomerPaymentNote.set(false)"
                class="mt-1 text-xs text-gray-400 hover:text-gray-600 transition-colors">Hide note</button>
            </div>
          } @else {
            <button (click)="showCustomerPaymentNote.set(true)"
              class="mt-2 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-brand-600 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 10.5a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1-.75-.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Z" />
              </svg>
              {{ order()?.customerNote ? 'Edit note' : 'Add note' }}
            </button>
          }
        </div>
        <!-- Supplier Payment (projected into supplier card) -->
        <div supplierPayment>
          <p class="text-xs font-medium uppercase tracking-wider text-gray-400 mb-1.5">Payment</p>
          <div class="flex items-center gap-2">
            <select
              [ngModel]="order()?.supplierPaymentTermType ?? ''"
              (ngModelChange)="onSupplierPaymentTermChange($event)"
              class="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                     focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
            >
              <option value="">Select</option>
              @for (opt of paymentTermOptions; track opt.value) {
                <option
                  [value]="opt.value"
                  [disabled]="opt.value === 'CREDIT' && !canUseSupplierCredit()"
                >
                  {{ opt.value === 'CREDIT' && !canUseSupplierCredit() ? 'Credit (no line)' : opt.label }}
                </option>
              }
            </select>
            @if (order()?.supplierPaymentTermType === 'CREDIT') {
              <input
                type="number"
                min="0"
                [attr.max]="supplierCreditSummary()?.maxDays ?? null"
                [ngModel]="order()?.supplierCreditDays ?? ''"
                (ngModelChange)="onSupplierCreditDaysChange($event)"
                placeholder="Days"
                class="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm
                       focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            }
          </div>
          <div class="mt-2 text-xs text-gray-500">
            @if (supplierCreditLoading()) {
              <span>Loading credit line...</span>
            } @else if (supplierCreditSummary()) {
              <span>
                Available: {{ supplierCreditSummary()!.available | number : '1.2-2' }}
                {{ supplierCreditSummary()!.currency }} · Max {{ supplierCreditSummary()!.maxDays }} days
              </span>
            } @else {
              <span>No credit line on file.</span>
            }
          </div>
          <!-- Note toggle -->
          @if (showSupplierPaymentNote()) {
            <div class="mt-2">
              <textarea
                rows="2"
                [ngModel]="order()?.supplierNote ?? ''"
                (ngModelChange)="onSupplierNoteChange($event)"
                placeholder="Supplier note"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700
                       focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              ></textarea>
              <button (click)="showSupplierPaymentNote.set(false)"
                class="mt-1 text-xs text-gray-400 hover:text-gray-600 transition-colors">Hide note</button>
            </div>
          } @else {
            <button (click)="showSupplierPaymentNote.set(true)"
              class="mt-2 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-brand-600 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 10.5a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1-.75-.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Z" />
              </svg>
              {{ order()?.supplierNote ? 'Edit note' : 'Add note' }}
            </button>
          }
        </div>
        <!-- T&C (projected into invoicing card) -->
        <div notesAndTerms>
          <p class="text-xs font-medium uppercase tracking-wider text-gray-400 mb-1.5">Place remark</p>
          @if (port()?.orderRemark) {
            <p
              class="mt-1 text-sm text-gray-700 whitespace-pre-line"
              [class.fueld-clamp-1]="!showPlaceRemarkFull()"
            >{{ port()?.orderRemark }}</p>
            <button
              type="button"
              (click)="showPlaceRemarkFull.set(!showPlaceRemarkFull())"
              class="mt-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >{{ showPlaceRemarkFull() ? 'Show less' : 'Show more' }}</button>
          } @else {
            <p class="mt-1 text-sm text-gray-700">-</p>
          }
          <p class="mt-2 text-[11px] text-gray-400">Edit in Places → Details</p>

          <div class="mt-4"></div>
          <p class="text-xs font-medium uppercase tracking-wider text-gray-400 mb-1.5">Customer terms</p>
          @if (customerTermsText()) {
            <p
              class="mt-1 text-sm text-gray-700 whitespace-pre-line"
              [class.fueld-clamp-1]="!showCustomerTermsFull()"
            >{{ customerTermsText() }}</p>
            <button
              type="button"
              (click)="showCustomerTermsFull.set(!showCustomerTermsFull())"
              class="mt-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >{{ showCustomerTermsFull() ? 'Show less' : 'Show more' }}</button>
          } @else {
            <p class="mt-1 text-sm text-gray-700">-</p>
          }

          <div class="mt-4"></div>
          <p class="text-xs font-medium uppercase tracking-wider text-gray-400 mb-1.5">Supplier terms</p>
          @if (supplierTermsText()) {
            <p
              class="mt-1 text-sm text-gray-700 whitespace-pre-line"
              [class.fueld-clamp-1]="!showSupplierTermsFull()"
            >{{ supplierTermsText() }}</p>
            <button
              type="button"
              (click)="showSupplierTermsFull.set(!showSupplierTermsFull())"
              class="mt-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >{{ showSupplierTermsFull() ? 'Show less' : 'Show more' }}</button>
          } @else {
            <p class="mt-1 text-sm text-gray-700">-</p>
          }

          <p class="mt-2 text-[11px] text-gray-400">Edit in Admin → Our Companies</p>
        </div>
      </app-trading-detail-meta-cards>

      <!-- ═══════════════════════════════════════════════════════════ -->
      <!--  Editable Items Grid                                       -->
      <!-- ═══════════════════════════════════════════════════════════ -->
      <app-order-items
        [items]="itemRows()"
        [readonly]="false"
        [allowDeliveredEdit]="false"
        [currency]="order()?.currency ?? 'USD'"
        [currencyOptionsInput]="currencyDropdownOptions()"
        (itemsChange)="onItemsChange($event)"
      />

      <!-- Comments -->
      <div class="mt-6">
        @if (order()?.id) {
          <div class="max-h-[520px] overflow-auto">
            <app-comments-card entityType="ORDER" [entityId]="order()!.id" />
          </div>
        }
      </div>
      <!-- Activity History (full width) -->
      @if (order()?.id) {
        <div class="mt-6">
          <app-activity-timeline entityType="order" [entityId]="order()!.id" />
        </div>
      }
    }

    <!-- ═══════════════════════════════════════════════════════════════ -->
    <!--  Send Offer to Customer Modal                                 -->
    <!-- ═══════════════════════════════════════════════════════════════ -->
    @if (showSendOfferModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div class="w-full max-w-lg rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true">
          <div class="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <h2 class="text-lg font-semibold text-gray-900">Send Offer to Customer</h2>
            <button (click)="showSendOfferModal.set(false)" class="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>
          <div class="space-y-4 px-6 py-5">
            <div>
              <label for="offer-to" class="block text-sm font-medium text-gray-700">To</label>
              <input id="offer-to" type="email" [(ngModel)]="offerEmail"
                placeholder="client@company.com"
                class="mt-1.5 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm
                       placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700">Subject</label>
              <input type="text" [(ngModel)]="offerSubject"
                class="mt-1.5 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm
                       focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700">Message</label>
              <textarea [(ngModel)]="offerBody" rows="5"
                class="mt-1.5 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm
                       placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"></textarea>
            </div>
            <div class="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
              <p class="text-xs text-blue-700">
                Sending this offer will update the inquiry status to <strong>OFFER</strong>.
              </p>
            </div>
          </div>
          <div class="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
            <button (click)="showSendOfferModal.set(false)"
              class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
              Cancel
            </button>
            <button (click)="sendOffer()"
              [disabled]="sendingOffer() || !offerEmail"
              class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold
                     text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
              @if (sendingOffer()) {
                <svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              }
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.154.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" />
              </svg>
              Send Offer
            </button>
          </div>
        </div>
      </div>
    }

    <!-- ═══════════════════════════════════════════════════════════════ -->
    <!--  Send Inquiry to Supplier Modal                               -->
    <!-- ═══════════════════════════════════════════════════════════════ -->
    @if (showSendInquiryModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div class="w-full max-w-lg rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true">
          <div class="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <h2 class="text-lg font-semibold text-gray-900">Send Inquiry to Supplier</h2>
            <button (click)="showSendInquiryModal.set(false)" class="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>
          <div class="space-y-4 px-6 py-5">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1.5">Supplier</label>
              <app-searchable-dropdown
                [options]="supplierDropdownOptions()"
                [selected]="inquirySupplierTarget"
                placeholder="Select supplier..."
                (selectionChange)="inquirySupplierTarget = $event"
              />
            </div>
            <div>
              <label for="inq-to" class="block text-sm font-medium text-gray-700">To (Email)</label>
              <input id="inq-to" type="email" [(ngModel)]="inquiryEmail"
                placeholder="supplier@company.com"
                class="mt-1.5 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm
                       placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700">Subject</label>
              <input type="text" [(ngModel)]="inquirySubject"
                class="mt-1.5 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm
                       focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700">Message</label>
              <textarea [(ngModel)]="inquiryBody" rows="5"
                class="mt-1.5 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm
                       placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"></textarea>
            </div>
          </div>
          <div class="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
            <button (click)="showSendInquiryModal.set(false)"
              class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
              Cancel
            </button>
            <button (click)="sendInquiryToSupplier()"
              [disabled]="sendingInquiry() || !inquiryEmail"
              class="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold
                     text-white shadow-sm transition-colors hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed">
              @if (sendingInquiry()) {
                <svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              }
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.154.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" />
              </svg>
              Send Inquiry
            </button>
          </div>
        </div>
      </div>
    }

    <!-- ═══════════════════════════════════════════════════════════════ -->
    <!--  Toast Notification                                           -->
    <!-- ═══════════════════════════════════════════════════════════════ -->
    @if (toast()) {
      <div
        class="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg transition-all"
        [class]="toast()!.type === 'success'
          ? 'border-green-200 bg-green-50 text-green-800'
          : 'border-red-200 bg-red-50 text-red-800'"
      >
        @if (toast()!.type === 'success') {
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd" />
          </svg>
        } @else {
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd" />
          </svg>
        }
        {{ toast()!.message }}
      </div>
    }

    <!-- PDF Preview Modal -->
    <app-pdf-preview-modal [waLinked]="waLinked()" [defaultPhone]="customerContact()?.phone ?? null" (sendWhatsApp)="onSendPdfWhatsApp($event)" />
  `,
  styles: [
    `
      .fueld-clamp-1 {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 1;
        overflow: hidden;
      }
    `,
  ],
})
export class InquiryDetailPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  // ─── Route param ─────────────────────────────────────────────────

  readonly inquiryId = toSignal(
    this.route.paramMap.pipe(map((p) => p.get('id') ?? '')),
    { initialValue: '' },
  );

  // ─── State ───────────────────────────────────────────────────────

  readonly pageLoading = signal(true);
  readonly order = signal<OrderDto | null>(null);
  readonly client = signal<CounterpartyDto | null>(null);
  readonly vessel = signal<VesselDto | null>(null);
  readonly port = signal<PlaceDto | null>(null);
  readonly suppliers = signal<CounterpartyDto[]>([]);
  readonly clients = signal<CounterpartyDto[]>([]);
  readonly vessels = signal<VesselDto[]>([]);
  readonly places = signal<PlaceDto[]>([]);
  readonly itemRows = signal<OrderItemRow[]>([]);
  readonly ownCompanies = signal<OwnCompanyDto[]>([]);

  readonly selectedOwnCompany = computed(() => {
    const id = this.order()?.invoicingCompanyId;
    if (!id) return null;
    return this.ownCompanies().find((c) => c.id === id) ?? null;
  });

  // ─── Terms UI (collapsed by default) ─────────────────────────────

  readonly showPlaceRemarkFull = signal(false);
  readonly showCustomerTermsFull = signal(false);
  readonly showSupplierTermsFull = signal(false);

  readonly customerTermsText = computed(() =>
    this.renderCompanyTerms(this.selectedOwnCompany()?.customerTerms, this.selectedOwnCompany()?.name) || '',
  );

  readonly supplierTermsText = computed(() =>
    this.renderCompanyTerms(this.selectedOwnCompany()?.supplierTerms, this.selectedOwnCompany()?.name) || '',
  );
  readonly bankAccounts = signal<BankAccountDto[]>([]);
  readonly teamUsers = signal<TeamUserOption[]>([]);
  readonly configuredCurrencies = signal<string[]>(['USD', 'EUR', 'DKK', 'AED']);
  readonly currencyDropdownOptions = computed(() =>
    this.configuredCurrencies().map((c) => ({ value: c, label: c })),
  );
  readonly saving = signal(false);
  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);
  readonly actionsOpen = signal(false);
  readonly settingsOpen = signal(false);

  /** Whether the user has linked WhatsApp in Settings */
  readonly waLinked = signal(false);

  readonly clientSearchLoading = signal(false);
  readonly vesselSearchLoading = signal(false);
  readonly placeSearchLoading = signal(false);
  readonly supplierSearchLoading = signal(false);
  readonly customerCreditLines = signal<CreditLineDto[]>([]);
  readonly customerCreditLoading = signal(false);
  readonly supplierCreditLines = signal<CreditLineDto[]>([]);
  readonly supplierCreditLoading = signal(false);
  readonly clientImportOptions = signal<DropdownOption[]>([]);
  readonly vesselImportOptions = signal<DropdownOption[]>([]);
  readonly placeImportOptions = signal<DropdownOption[]>([]);
  readonly customerContact = signal<CompanyContactDto | null>(null);
  readonly supplierContact = signal<CompanyContactDto | null>(null);
  readonly customerContacts = signal<CompanyContactDto[]>([]);
  readonly supplierContacts = signal<CompanyContactDto[]>([]);
  readonly noteTab = signal<'customer' | 'supplier'>('customer');
  readonly showCustomerPaymentNote = signal(false);
  readonly showSupplierPaymentNote = signal(false);

  // ─── Send Offer modal state ──────────────────────────────────────

  readonly showSendOfferModal = signal(false);
  readonly sendingOffer = signal(false);
  offerEmail = '';
  offerSubject = '';
  offerBody = '';

  // ─── Send Inquiry to Supplier modal state ────────────────────────

  readonly showSendInquiryModal = signal(false);
  readonly sendingInquiry = signal(false);
  inquiryEmail = '';
  inquirySubject = '';
  inquiryBody = '';
  inquirySupplierTarget = '';

  // ─── Computed ────────────────────────────────────────────────────

  readonly clientName = computed(() => this.client()?.name ?? '—');
  readonly supplierName = computed(() => {
    const id = this.order()?.supplierId;
    if (!id) return '—';
    return this.suppliers().find((s) => s.id === id)?.name ?? '—';
  });
  readonly vesselName = computed(() => this.vessel()?.name ?? '—');
  readonly portName = computed(() => this.port()?.name ?? '—');
  readonly subtitle = computed(
    () => `${this.vesselName()} · ${this.portName()} · ${this.clientName()}`,
  );
  readonly invoicingCompanyName = computed(() => {
    const id = this.order()?.invoicingCompanyId;
    if (!id) return '—';
    const co = this.ownCompanies().find((company) => company.id === id);
    return co?.name ?? '—';
  });

  readonly supplierDropdownOptions = computed<DropdownOption[]>(() =>
    this.suppliers().map((s) => ({ value: s.id, label: s.name })),
  );

  readonly clientDropdownOptions = computed<DropdownOption[]>(() =>
    [
      ...this.clients().map((c) => ({ value: c.id, label: c.name })),
      ...this.clientImportOptions(),
    ],
  );

  readonly vesselDropdownOptions = computed<DropdownOption[]>(() =>
    [
      ...this.vessels().map((v) => ({ value: v.id, label: v.name })),
      ...this.vesselImportOptions(),
    ],
  );

  readonly placeDropdownOptions = computed<DropdownOption[]>(() =>
    [
      ...this.places().map((p) => ({ value: p.id, label: p.name })),
      ...this.placeImportOptions(),
    ],
  );

  readonly responsibleUserOptions = computed<DropdownOption[]>(() =>
    this.teamUsers().map((u) => ({ value: u.id, label: u.name })),
  );

  readonly customerContactDropdownOptions = computed(() =>
    this.customerContacts().map((c) => ({
      value: c.id,
      label: c.name + (c.role ? ` (${c.role})` : ''),
    })),
  );

  readonly supplierContactDropdownOptions = computed(() =>
    this.supplierContacts().map((c) => ({
      value: c.id,
      label: c.name + (c.role ? ` (${c.role})` : ''),
    })),
  );

  readonly hasInvoicingCompany = computed(() => !!this.order()?.invoicingCompanyId);
  readonly isResponsibleUser = computed(() => {
    const currentUserId = this.auth.user()?.id ?? '';
    return !!currentUserId && this.order()?.salesRepId === currentUserId;
  });

  readonly placeTimezone = computed(() => this.port()?.timezone ?? 'UTC');
  readonly minDateTime = computed(() =>
    this.formatDateTimeForInput(new Date(), this.placeTimezone()),
  );
  readonly etaMinDateTime = computed(() => {
    const eta = this.order()?.eta;
    if (eta) return this.formatDateTimeForInput(new Date(eta), this.placeTimezone());
    return this.minDateTime();
  });

  readonly customerCreditSummary = computed(() => {
    const currency = this.order()?.currency ?? 'USD';
    const lines = this.customerCreditLines().filter((line) => line.currency === currency);
    if (!lines.length) return null;
    const available = lines.reduce((sum, line) => sum + (parseFloat(line.availableAmount) || 0), 0);
    const maxDays = Math.max(...lines.map((line) => line.periodDays));
    return { currency, available, maxDays };
  });

  readonly canUseCustomerCredit = computed(() => !!this.customerCreditSummary());

  readonly supplierCreditSummary = computed(() => {
    const currency = this.order()?.currency ?? 'USD';
    const lines = this.supplierCreditLines().filter((line) => line.currency === currency);
    if (!lines.length) return null;
    const available = lines.reduce((sum, line) => sum + (parseFloat(line.availableAmount) || 0), 0);
    const maxDays = Math.max(...lines.map((line) => line.periodDays));
    return { currency, available, maxDays };
  });

  readonly canUseSupplierCredit = computed(() => !!this.supplierCreditSummary());

  formatDateTimeForInput(date: Date, timeZone: string): string {
    const fixedOffset = this.parseFixedOffsetMinutes(timeZone);
    if (fixedOffset !== null) {
      const shifted = new Date(date.getTime() + fixedOffset * 60_000);
      const year = String(shifted.getUTCFullYear()).padStart(4, '0');
      const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
      const day = String(shifted.getUTCDate()).padStart(2, '0');
      const hour = String(shifted.getUTCHours()).padStart(2, '0');
      const minute = String(shifted.getUTCMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}T${hour}:${minute}`;
    }

    const safeTimeZone = this.normalizeTimeZone(timeZone);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: safeTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const map = new Map(parts.map((p) => [p.type, p.value]));
    const year = map.get('year') ?? '0000';
    const month = map.get('month') ?? '01';
    const day = map.get('day') ?? '01';
    const hour = map.get('hour') ?? '00';
    const minute = map.get('minute') ?? '00';
    return `${year}-${month}-${day}T${hour}:${minute}`;
  }

  formatDateTimeForEmail(value: string): string {
    const timeZone = this.placeTimezone();
    const formatted = this.formatDateTimeForInput(new Date(value), timeZone).replace('T', ' ');
    return `${formatted} ${timeZone}`;
  }

  private getTimeZoneOffset(date: Date, timeZone: string): number {
    const fixedOffset = this.parseFixedOffsetMinutes(timeZone);
    if (fixedOffset !== null) return fixedOffset;

    const safeTimeZone = this.normalizeTimeZone(timeZone);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: safeTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const map = new Map(parts.map((p) => [p.type, p.value]));
    const year = Number(map.get('year') ?? 0);
    const month = Number(map.get('month') ?? 1) - 1;
    const day = Number(map.get('day') ?? 1);
    const hour = Number(map.get('hour') ?? 0);
    const minute = Number(map.get('minute') ?? 0);
    const second = Number(map.get('second') ?? 0);
    const asUtc = Date.UTC(year, month, day, hour, minute, second);
    return (asUtc - date.getTime()) / 60000;
  }

  private toUtcIsoFromZonedInput(value: string, timeZone: string): string {
    const [datePart, timePart] = value.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);
    const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
    const offset = this.getTimeZoneOffset(new Date(utcGuess), timeZone);
    const utcTime = utcGuess - offset * 60_000;
    return new Date(utcTime).toISOString();
  }

  private normalizeTimeZone(timeZone: string): string {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
      return timeZone;
    } catch {
      return 'UTC';
    }
  }

  private parseFixedOffsetMinutes(timeZone: string): number | null {
    const match = timeZone.match(/([+-])\s*(\d{1,2})(?::(\d{2}))?/);
    if (!match) return null;

    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number(match[2]);
    const minutes = Number(match[3] ?? '0');
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;

    return sign * (hours * 60 + minutes);
  }

  // ─── Autosave ────────────────────────────────────────────────────

  readonly autoSaving = signal(false);
  readonly lastSaved = signal<Date | null>(null);
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private changeVersion = signal(0);

  constructor() {
    // Debounced autosave effect - reacts to changeVersion increments
    effect(() => {
      const version = this.changeVersion();
      if (version === 0) return; // Skip initial
      
      // Clear existing timer
      if (this.autoSaveTimer) {
        clearTimeout(this.autoSaveTimer);
      }
      
      // Set new debounced save
      this.autoSaveTimer = setTimeout(() => {
        this.performAutoSave();
      }, 1500); // 1.5s debounce
    });
  }

  // ─── Lifecycle ────────────────────────────────────────────────────

  ngOnInit(): void {
    this.loadData();
    this.checkWhatsAppLinked();
  }

  ngOnDestroy(): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }
  }

  // ─── Data loading ─────────────────────────────────────────────────

  /** Check if the current user has linked WhatsApp */
  private async checkWhatsAppLinked(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ linked: boolean; whatsappEnabled?: boolean }>>(`${API}/whatsapp/status`),
      );
      if (res.success && res.data?.linked && res.data?.whatsappEnabled !== false) {
        this.waLinked.set(true);
      }
    } catch {
      // Not linked — keep default false
    }
  }

  private async loadData(): Promise<void> {
    const id = this.inquiryId();
    if (!id) return;

    this.pageLoading.set(true);
    try {
      const [orderRes, ownRes] = await Promise.all([
        firstValueFrom(this.http.get<ApiResponse<any>>(`${API}/orders/${id}`)),
        firstValueFrom(this.http.get<ApiResponse<OwnCompanyDto[]>>(`${API}/companies/own`)),
      ]);

      if (orderRes.success && orderRes.data) {
        const d = orderRes.data;
        this.order.set({
          id: d.id,
          orderNumber: d.orderNumber ?? null,
          tenantId: d.tenantId,
          clientId: d.clientId,
          vesselId: d.vesselId,
          placeId: d.placeId,
          salesRepId: d.salesRepId,
          invoicingCompanyId: d.invoicingCompanyId,
          bankAccountId: d.bankAccountId ?? null,
          currency: d.currency ?? 'USD',
          status: d.status,
          eta: d.eta,
          etd: d.etd,
          customerPaymentTermType: d.customerPaymentTermType ?? null,
          customerCreditDays: d.customerCreditDays ?? null,
          customerNote: d.customerNote ?? null,
          customerContactId: d.customerContactId ?? null,
          supplierId: d.supplierId ?? null,
          supplierPaymentTermType: d.supplierPaymentTermType ?? null,
          supplierCreditDays: d.supplierCreditDays ?? null,
          supplierNote: d.supplierNote ?? null,
          supplierContactId: d.supplierContactId ?? null,
          termsAndConditions: d.termsAndConditions ?? null,
          lossReason: d.lossReason,
          closedAt: d.closedAt,
          deliveredAt: d.deliveredAt ?? null,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        });

        if (d.status !== OrderStatus.Inquiry && d.status !== OrderStatus.Offer) {
          this.pageLoading.set(false);
          void this.router.navigate(['/trading/orders', d.orderNumber ?? d.id]);
          return;
        }

        // Set contact person data
        if (d.customerContact) this.customerContact.set(d.customerContact);
        if (d.supplierContact) this.supplierContact.set(d.supplierContact);

        if (d.client) {
          this.client.set(d.client);
          this.clients.set([d.client]); // Seed dropdown so current selection shows its name
        }
        if (d.vessel) {
          this.vessel.set(d.vessel);
          this.vessels.set([d.vessel]);
        }
        if (d.place) {
          this.port.set(d.place);
          this.places.set([d.place]);
        }

        await this.loadCustomerCreditLines(d.clientId);
        await this.loadSupplierCreditLines(d.supplierId);
        await this.loadCompanyContacts('customer', d.clientId);
        if (d.supplierId) await this.loadCompanyContacts('supplier', d.supplierId);

        // Load suppliers from items or from API
        this.itemRows.set(
          (d.items ?? []).map((item: any) => ({
            id: item.id,
            productType: item.productType ?? '',
            description: item.description ?? '',
            quantity: parseFloat(item.quantity) || 0,
            quantityMin: item.quantityMin ? parseFloat(item.quantityMin) : null,
            quantityMax: item.quantityMax ? parseFloat(item.quantityMax) : null,
            unit: item.unit ?? 'MT',
            costPrice: parseFloat(item.costPrice) || 0,
            costCurrency: item.costCurrency ?? d.currency ?? 'USD',
            salesPrice: parseFloat(item.salesPrice) || 0,
            salesCurrency: item.salesCurrency ?? d.currency ?? 'USD',
            profit: parseFloat(item.profit) || 0,
            paymentTerms: item.paymentTerms ?? '',
            customerNote: item.customerNote ?? '',
          })),
        );

        // Load reference data lists
        await this.loadReferenceData();
      }

      if (ownRes.success) this.ownCompanies.set(ownRes.data);

      // Load bank accounts for the invoicing company
      const invoicingId = this.order()?.invoicingCompanyId;
      if (invoicingId) this.loadBankAccounts(invoicingId);

      // Auto-expand note fields if they already have content
      if (this.order()?.customerNote) this.showCustomerPaymentNote.set(true);
      if (this.order()?.supplierNote) this.showSupplierPaymentNote.set(true);
    } catch {
      this.showToast('error', 'Failed to load inquiry.');
    } finally {
      this.pageLoading.set(false);
    }
  }

  private async loadReferenceData(): Promise<void> {
    try {
      // Load initial suppliers list
      const [suppliersRes, usersRes, currenciesRes] = await Promise.all([
        firstValueFrom(
          this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
            `${API}/companies/local?type=SUPPLIER&limit=100`,
          ),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<TeamUserOption[]>>(`${API}/lloyds/users`),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<{ currencies: string[] }>>(`${API}/admin/settings/my-currencies`),
        ),
      ]);
      if (suppliersRes.success) this.suppliers.set(suppliersRes.data.companies);
      if (usersRes.success) this.teamUsers.set(usersRes.data ?? []);
      if (currenciesRes.success && currenciesRes.data.currencies.length) {
        this.configuredCurrencies.set(currenciesRes.data.currencies);
      }
    } catch {
      // silently ignore
    }
  }

  private async loadCustomerCreditLines(counterpartyId: string | null | undefined): Promise<void> {
    if (!counterpartyId) return;
    this.customerCreditLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ items: CreditLineDto[]; total: number }>>(
          `${API}/credit/lines?type=CUSTOMER&counterpartyId=${encodeURIComponent(counterpartyId)}&limit=50`,
        ),
      );
      if (res.success) {
        this.customerCreditLines.set(res.data.items ?? []);
      } else {
        this.customerCreditLines.set([]);
      }
    } catch {
      this.customerCreditLines.set([]);
    } finally {
      this.customerCreditLoading.set(false);
    }
  }

  private async loadSupplierCreditLines(counterpartyId: string | null | undefined): Promise<void> {
    if (!counterpartyId) return;
    this.supplierCreditLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ items: CreditLineDto[]; total: number }>>(
          `${API}/credit/lines?type=SUPPLIER&counterpartyId=${encodeURIComponent(counterpartyId)}&limit=50`,
        ),
      );
      if (res.success) {
        this.supplierCreditLines.set(res.data.items ?? []);
      } else {
        this.supplierCreditLines.set([]);
      }
    } catch {
      this.supplierCreditLines.set([]);
    } finally {
      this.supplierCreditLoading.set(false);
    }
  }

  readonly paymentTermOptions: DropdownOption[] = [
    { value: 'CREDIT', label: 'Credit' },
    { value: 'COD', label: 'Cash on Delivery' },
    { value: 'PREPAY', label: 'Cash in advance' },
  ];

  formatCustomerPaymentTerms(): string {
    const type = this.order()?.customerPaymentTermType;
    if (!type) return '-';
    if (type === 'CREDIT') {
      const days = this.order()?.customerCreditDays ?? 0;
      return `Credit ${days} days`;
    }
    if (type === 'COD') return 'Cash on Delivery';
    if (type === 'PREPAY') return 'Cash in advance';
    return type;
  }

  onCustomerPaymentTermChange(value: PaymentTermType | ''): void {
    if (value === 'CREDIT' && !this.canUseCustomerCredit()) {
      this.showToast('error', 'No customer credit line is available.');
      return;
    }
    this.order.update((o) => {
      if (!o) return o;
      const next = { ...o, customerPaymentTermType: value || null };
      if (value !== 'CREDIT') next.customerCreditDays = null;
      return next;
    });
    this.triggerAutosave();
  }

  onCustomerCreditDaysChange(value: number | string): void {
    const days = typeof value === 'string' ? Number(value) : value;
    const maxDays = this.customerCreditSummary()?.maxDays ?? null;
    const nextDays = Number.isFinite(days) ? days : null;
    if (maxDays !== null && nextDays !== null && nextDays > maxDays) {
      this.order.update((o) => (o ? { ...o, customerCreditDays: maxDays } : o));
      this.showToast('error', `Max credit is ${maxDays} days.`);
    } else {
      this.order.update((o) => (o ? { ...o, customerCreditDays: nextDays } : o));
    }
    this.triggerAutosave();
  }

  onSupplierPaymentTermChange(value: PaymentTermType | ''): void {
    if (value === 'CREDIT' && !this.canUseSupplierCredit()) {
      this.showToast('error', 'No supplier credit line is available.');
      return;
    }
    this.order.update((o) => {
      if (!o) return o;
      const next = { ...o, supplierPaymentTermType: value || null };
      if (value !== 'CREDIT') next.supplierCreditDays = null;
      return next;
    });
    this.triggerAutosave();
  }

  onSupplierCreditDaysChange(value: number | string): void {
    const days = typeof value === 'string' ? Number(value) : value;
    const maxDays = this.supplierCreditSummary()?.maxDays ?? null;
    const nextDays = Number.isFinite(days) ? days : null;
    if (maxDays !== null && nextDays !== null && nextDays > maxDays) {
      this.order.update((o) => (o ? { ...o, supplierCreditDays: maxDays } : o));
      this.showToast('error', `Max credit is ${maxDays} days.`);
    } else {
      this.order.update((o) => (o ? { ...o, supplierCreditDays: nextDays } : o));
    }
    this.triggerAutosave();
  }

  onSupplierNoteChange(value: string): void {
    this.order.update((o) => (o ? { ...o, supplierNote: value } : o));
    this.triggerAutosave();
  }

  onCustomerNoteChange(value: string): void {
    this.order.update((o) => (o ? { ...o, customerNote: value } : o));
    this.triggerAutosave();
  }

  // ─── Contact person handlers ─────────────────────────────────────

  async loadCompanyContacts(side: 'customer' | 'supplier', companyId: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CompanyContactDto[]>>(`${API}/companies/local/${companyId}/contacts`),
      );
      if (res.success) {
        if (side === 'customer') this.customerContacts.set(res.data ?? []);
        else this.supplierContacts.set(res.data ?? []);
      }
    } catch {
      // silently ignore
    }
  }

  onCustomerContactChange(contactId: string): void {
    this.order.update((o) => (o ? { ...o, customerContactId: contactId || null } : o));
    const contact = this.customerContacts().find((c) => c.id === contactId) ?? null;
    this.customerContact.set(contact);
    this.triggerAutosave();
  }

  onSupplierContactChange(contactId: string): void {
    this.order.update((o) => (o ? { ...o, supplierContactId: contactId || null } : o));
    const contact = this.supplierContacts().find((c) => c.id === contactId) ?? null;
    this.supplierContact.set(contact);
    this.triggerAutosave();
  }

  onTermsChange(value: string): void {
    this.order.update((o) => (o ? { ...o, termsAndConditions: value || null } : o));
    this.triggerAutosave();
  }

  onResponsibleUserChange(userId: string): void {
    this.order.update((o) => (o ? { ...o, salesRepId: userId || null } : o));
    this.triggerAutosave();
  }

  // ─── Typeahead search methods ────────────────────────────────────

  async searchClients(term: string): Promise<void> {
    this.clientSearchLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
          `${API}/companies/local?type=CLIENT&search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      const current = this.client();
      const localResults = res.success ? res.data.companies : [];
      const localMatches = current
        ? localResults.filter((c) => c.id !== current.id)
        : localResults;
      const hasLocalMatches = localMatches.length > 0;
      const mergedLocal = current && !localResults.find((c) => c.id === current.id)
        ? [current, ...localResults]
        : localResults;

      if (hasLocalMatches) {
        this.clients.set(mergedLocal);
        this.clientImportOptions.set([]);
      } else {
        this.clients.set(current ? [current] : []);
        this.clientImportOptions.set(await this.loadCompanyImportOptions(term));
      }
    } catch {
      this.clientImportOptions.set([]);
    } finally {
      this.clientSearchLoading.set(false);
    }
  }

  async searchVessels(term: string): Promise<void> {
    this.vesselSearchLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ vessels: VesselDto[]; total: number }>>(
          `${API}/vessels/local?search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      const current = this.vessel();
      const localResults = res.success ? res.data.vessels : [];
      const localMatches = current
        ? localResults.filter((v) => v.id !== current.id)
        : localResults;
      const hasLocalMatches = localMatches.length > 0;
      const mergedLocal = current && !localResults.find((v) => v.id === current.id)
        ? [current, ...localResults]
        : localResults;

      if (hasLocalMatches) {
        this.vessels.set(mergedLocal);
        this.vesselImportOptions.set([]);
      } else {
        this.vessels.set(current ? [current] : []);
        this.vesselImportOptions.set(await this.loadVesselImportOptions(term));
      }
    } catch {
      this.vesselImportOptions.set([]);
    } finally {
      this.vesselSearchLoading.set(false);
    }
  }

  async searchPlaces(term: string): Promise<void> {
    this.placeSearchLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ places: PlaceDto[]; total: number }>>(
          `${API}/lloyds/places/local?search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      const current = this.port();
      const localResults = res.success ? res.data.places : [];
      const localMatches = current
        ? localResults.filter((p) => p.id !== current.id)
        : localResults;
      const hasLocalMatches = localMatches.length > 0;
      const mergedLocal = current && !localResults.find((p) => p.id === current.id)
        ? [current, ...localResults]
        : localResults;

      if (hasLocalMatches) {
        this.places.set(mergedLocal);
        this.placeImportOptions.set([]);
      } else {
        this.places.set(current ? [current] : []);
        this.placeImportOptions.set(await this.loadPlaceImportOptions(term));
      }
    } catch {
      this.placeImportOptions.set([]);
    } finally {
      this.placeSearchLoading.set(false);
    }
  }

  async searchSuppliers(term: string): Promise<void> {
    this.supplierSearchLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
          `${API}/companies/local?type=SUPPLIER&search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      const currentId = this.order()?.supplierId ?? '';
      const localResults = res.success ? res.data.companies : [];
      const mergedLocal = currentId && !localResults.find((c) => c.id === currentId)
        ? [this.suppliers().find((s) => s.id === currentId) ?? null, ...localResults].filter(Boolean)
        : localResults;
      this.suppliers.set(mergedLocal as CounterpartyDto[]);
    } catch {
      // silently ignore
    } finally {
      this.supplierSearchLoading.set(false);
    }
  }

  // ─── Item grid events ────────────────────────────────────────────

  onItemsChange(items: OrderItemRow[]): void {
    this.itemRows.set(items);
    this.triggerAutosave();
  }

  onInvoicingCompanyChange(companyId: string): void {
    this.order.update((o) => (o ? { ...o, invoicingCompanyId: companyId || null, bankAccountId: null } : o));
    this.bankAccounts.set([]);
    if (companyId) this.loadBankAccounts(companyId);
    this.triggerAutosave();
  }

  onBankAccountChange(bankAccountId: string): void {
    this.order.update((o) => o ? { ...o, bankAccountId: bankAccountId || null } : o);
    this.triggerAutosave();
  }

  private async loadBankAccounts(companyId: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<BankAccountDto[]>>(
          `${API}/admin/settings/companies/${companyId}/bank-accounts`,
        ),
      );
      if (res.success) this.bankAccounts.set(res.data);
    } catch { /* silently ignore */ }
  }

  async onClientChange(clientId: string): Promise<void> {
    if (!clientId) return; // Don't allow clearing required field
    if (clientId.startsWith('seasearcher:')) {
      await this.importClientFromSeasearcher(clientId.replace('seasearcher:', ''));
      return;
    }
    this.order.update((o) => (o ? { ...o, clientId, customerContactId: null } : o));
    const clientData = this.clients().find((c) => c.id === clientId);
    this.client.set(clientData ?? null);
    this.customerContact.set(null);
    await this.loadCustomerCreditLines(clientId);
    void this.loadCompanyContacts('customer', clientId);
    this.triggerAutosave();
  }

  async onSupplierChange(supplierId: string): Promise<void> {
    if (!supplierId) return;
    this.order.update((o) => (o ? { ...o, supplierId, supplierContactId: null } : o));
    this.supplierContact.set(null);
    await this.loadSupplierCreditLines(supplierId);
    void this.loadCompanyContacts('supplier', supplierId);
    this.triggerAutosave();
  }

  async onVesselChange(vesselId: string): Promise<void> {
    if (!vesselId) return; // Don't allow clearing required field
    if (vesselId.startsWith('seasearcher:')) {
      await this.importVesselFromSeasearcher(vesselId.replace('seasearcher:', ''));
      return;
    }
    this.order.update((o) => (o ? { ...o, vesselId } : o));
    const vesselData = this.vessels().find((v) => v.id === vesselId);
    this.vessel.set(vesselData ?? null);
    this.triggerAutosave();
  }

  async onPortChange(placeId: string): Promise<void> {
    if (!placeId) return; // Don't allow clearing required field
    if (placeId.startsWith('lli:')) {
      await this.importPlaceFromLli(placeId.replace('lli:', ''));
      return;
    }
    this.order.update((o) => (o ? { ...o, placeId } : o));
    const placeData = this.places().find((p) => p.id === placeId);
    this.port.set(placeData ?? null);
    this.triggerAutosave();
  }

  private async loadCompanyImportOptions(term: string): Promise<DropdownOption[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CompanySearchResult[]>>(
          `${API}/companies/search?term=${encodeURIComponent(term)}`,
        ),
      );
      if (!res.success || !res.data) return [];
      return res.data
        .filter((r) => r.source === 'seasearcher' && r.seasearcherId)
        .map((r) => ({
          value: `seasearcher:${r.seasearcherId}`,
          label: `${r.name}${r.country ? ` (${r.country})` : ''}`,
          actionLabel: 'Import',
        }));
    } catch {
      return [];
    }
  }

  private async loadVesselImportOptions(term: string): Promise<DropdownOption[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<VesselSearchResult[]>>(
          `${API}/vessels/search?term=${encodeURIComponent(term)}`,
        ),
      );
      if (!res.success || !res.data) return [];
      return res.data
        .filter((r) => r.source === 'seasearcher' && r.seasearcherId)
        .map((r) => ({
          value: `seasearcher:${r.seasearcherId}`,
          label: `${r.name}${r.imo ? ` (IMO ${r.imo})` : ''}`,
          actionLabel: 'Import',
        }));
    } catch {
      return [];
    }
  }

  private async loadPlaceImportOptions(term: string): Promise<DropdownOption[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<LliSearchResult[]>>(
          `${API}/lloyds/places?name=${encodeURIComponent(term)}`,
        ),
      );
      if (!res.success || !res.data) return [];
      return res.data
        .filter((r) => r.source === 'lloyds' && r.lliPlaceId)
        .map((r) => ({
          value: `lli:${r.lliPlaceId}`,
          label: `${r.name}${r.country ? ` (${r.country})` : ''}`,
          actionLabel: 'Import',
        }));
    } catch {
      return [];
    }
  }

  private async importClientFromSeasearcher(seasearcherId: string): Promise<void> {
    this.clientSearchLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<CounterpartyDto>>(`${API}/companies/import`, { seasearcherId }),
      );
      if (res.success && res.data) {
        this.clients.set([res.data, ...this.clients().filter((c) => c.id !== res.data.id)]);
        this.clientImportOptions.set([]);
        this.order.update((o) => (o ? { ...o, clientId: res.data.id } : o));
        this.client.set(res.data);
        this.triggerAutosave();
      } else {
        this.showToast('error', res.message ?? 'Failed to import client.');
      }
    } catch {
      this.showToast('error', 'Failed to import client.');
    } finally {
      this.clientSearchLoading.set(false);
    }
  }

  private async importVesselFromSeasearcher(seasearcherId: string): Promise<void> {
    this.vesselSearchLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<VesselDto>>(`${API}/vessels/import`, { seasearcherId }),
      );
      if (res.success && res.data) {
        this.vessels.set([res.data, ...this.vessels().filter((v) => v.id !== res.data.id)]);
        this.vesselImportOptions.set([]);
        this.order.update((o) => (o ? { ...o, vesselId: res.data.id } : o));
        this.vessel.set(res.data);
        this.triggerAutosave();
      } else {
        this.showToast('error', res.message ?? 'Failed to import vessel.');
      }
    } catch {
      this.showToast('error', 'Failed to import vessel.');
    } finally {
      this.vesselSearchLoading.set(false);
    }
  }

  private async importPlaceFromLli(lliPlaceId: string): Promise<void> {
    this.placeSearchLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<PlaceDto>>(`${API}/lloyds/places/import`, { lliPlaceId }),
      );
      if (res.success && res.data) {
        this.places.set([res.data, ...this.places().filter((p) => p.id !== res.data.id)]);
        this.placeImportOptions.set([]);
        this.order.update((o) => (o ? { ...o, placeId: res.data.id } : o));
        this.port.set(res.data);
        this.triggerAutosave();
      } else {
        this.showToast('error', res.message ?? 'Failed to import place.');
      }
    } catch {
      this.showToast('error', 'Failed to import place.');
    } finally {
      this.placeSearchLoading.set(false);
    }
  }

  onEtaChange(eta: string): void {
    const timeZone = this.placeTimezone();
    const iso = eta ? this.toUtcIsoFromZonedInput(eta, timeZone) : null;
    this.order.update((o) => (o ? { ...o, eta: iso } : o));
    this.triggerAutosave();
  }

  onEtdChange(etd: string): void {
    const timeZone = this.placeTimezone();
    const iso = etd ? this.toUtcIsoFromZonedInput(etd, timeZone) : null;
    this.order.update((o) => (o ? { ...o, etd: iso } : o));
    this.triggerAutosave();
  }

  onCurrencyChange(currency: string): void {
    this.order.update((o) => (o ? { ...o, currency } : o));
    this.triggerAutosave();
  }

  private triggerAutosave(): void {
    this.changeVersion.update((v) => v + 1);
  }

  private async performAutoSave(): Promise<void> {
    const id = this.inquiryId();
    const o = this.order();
    if (!id || !o) return;

    this.autoSaving.set(true);
    try {
      // Save order data
      await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API}/orders/${id}`, {
          clientId: o.clientId,
          vesselId: o.vesselId,
          placeId: o.placeId,
          salesRepId: o.salesRepId ?? null,
          invoicingCompanyId: o.invoicingCompanyId,
          bankAccountId: o.bankAccountId ?? null,
          currency: o.currency,
          customerPaymentTermType: o.customerPaymentTermType ?? null,
          customerCreditDays: o.customerCreditDays ?? null,
          customerNote: o.customerNote ?? null,
          customerContactId: o.customerContactId ?? null,
          supplierId: o.supplierId ?? null,
          supplierPaymentTermType: o.supplierPaymentTermType ?? null,
          supplierCreditDays: o.supplierCreditDays ?? null,
          supplierNote: o.supplierNote ?? null,
          supplierContactId: o.supplierContactId ?? null,
          termsAndConditions: o.termsAndConditions ?? null,
          eta: o.eta,
          etd: o.etd,
        }),
      );

      // Save items
      const itemPayload = this.itemRows().map((r) => ({
        productType: r.productType,
        quantity: String(r.quantity),
        quantityMin: r.quantityMin != null ? String(r.quantityMin) : null,
        quantityMax: String(r.quantity),
        unit: r.unit,
        costPrice: r.costPrice ? String(r.costPrice) : null,
        costCurrency: r.costCurrency ?? o.currency,
        salesPrice: r.salesPrice ? String(r.salesPrice) : null,
        salesCurrency: r.salesCurrency ?? o.currency,
        paymentTerms: r.paymentTerms || null,
        customerNote: r.customerNote ?? null,
        description: r.description || null,
      }));

      await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API}/orders/${id}/items`, { items: itemPayload }),
      );

      await this.loadCustomerCreditLines(o.clientId);
      await this.loadSupplierCreditLines(o.supplierId);
      this.lastSaved.set(new Date());
    } catch {
      // Quietly fail - could show subtle error indicator
    } finally {
      this.autoSaving.set(false);
    }
  }

  // ─── Save ────────────────────────────────────────────────────────

  async save(): Promise<void> {
    const id = this.inquiryId();
    const o = this.order();
    if (!id || !o) return;

    this.saving.set(true);
    try {
      // Save order data
      await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API}/orders/${id}`, {
          invoicingCompanyId: o.invoicingCompanyId,
          bankAccountId: o.bankAccountId ?? null,
          salesRepId: o.salesRepId ?? null,
          customerPaymentTermType: o.customerPaymentTermType ?? null,
          customerCreditDays: o.customerCreditDays ?? null,
          customerNote: o.customerNote ?? null,
          customerContactId: o.customerContactId ?? null,
          supplierId: o.supplierId ?? null,
          supplierPaymentTermType: o.supplierPaymentTermType ?? null,
          supplierCreditDays: o.supplierCreditDays ?? null,
          supplierNote: o.supplierNote ?? null,
          supplierContactId: o.supplierContactId ?? null,
          termsAndConditions: o.termsAndConditions ?? null,
          eta: o.eta,
          etd: o.etd,
        }),
      );

      // Save items
      const itemPayload = this.itemRows().map((r) => ({
        productType: r.productType,
        quantity: String(r.quantity),
        quantityMin: r.quantityMin != null ? String(r.quantityMin) : null,
        quantityMax: String(r.quantity),
        unit: r.unit,
        costPrice: r.costPrice ? String(r.costPrice) : null,
        costCurrency: r.costCurrency ?? o.currency,
        salesPrice: r.salesPrice ? String(r.salesPrice) : null,
        salesCurrency: r.salesCurrency ?? o.currency,
        paymentTerms: r.paymentTerms || null,
        customerNote: r.customerNote ?? null,
        description: r.description || null,
      }));

      await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API}/orders/${id}/items`, { items: itemPayload }),
      );

      await this.loadCustomerCreditLines(o.clientId);
      await this.loadSupplierCreditLines(o.supplierId);
      this.showToast('success', 'Inquiry saved successfully.');
    } catch {
      this.showToast('error', 'Failed to save inquiry.');
    } finally {
      this.saving.set(false);
    }
  }

  // ─── Send Offer to Customer ──────────────────────────────────────

  openSendOfferModal(): void {
    this.offerEmail = this.customerContact()?.email?.trim() || this.client()?.headOfficeEmail?.trim() || '';
    this.offerSubject = `Bunker Offer — ${this.vesselName()} at ${this.portName()}`;
    const o = this.order();
    const items = this.itemRows();
    const currency = o?.currency ?? 'USD';
    const responsibleName = this.teamUsers().find((u) => u.id === o?.salesRepId)?.name
      ?? this.auth.user()?.name
      ?? '';
    let body = `Dear Customer,\n\nPlease find our offer for bunker supply to ${this.vesselName()} at ${this.portName()}.\n`;
    if (o?.eta) body += `\nETA: ${this.formatDateTimeForEmail(o.eta)}`;
    if (o?.etd) body += `\nETD: ${this.formatDateTimeForEmail(o.etd)}`;
    if (items.length) {
      body += `\n\nLine Items:\n`;
      items.forEach((item, i) => {
        const qty = item.quantityMin && item.quantityMax
          ? `${item.quantityMin}-${item.quantityMax}`
          : String(item.quantity);
        body += `${i + 1}. ${item.productType || 'Product'} — ${qty} ${item.unit} @ ${currency} ${item.salesPrice?.toFixed(2) ?? '0.00'}/${item.unit}\n`;
        if (item.description?.trim()) {
          body += `   Description: ${item.description.trim()}\n`;
        }
      });
    }
    body += `\nBest regards`;
    if (responsibleName.trim()) {
      body += `\n${responsibleName.trim()}`;
    }
    this.offerBody = body;
    this.showSendOfferModal.set(true);
  }

  async sendOffer(): Promise<void> {
    if (!this.offerEmail) return;
    const id = this.inquiryId();
    if (!id) return;
    if (!this.isResponsibleUser()) {
      this.showToast('error', 'Only the responsible user can send this offer.');
      return;
    }

    this.sendingOffer.set(true);
    try {
      // First save any pending changes
      await this.save();

      // Update status to OFFER
      await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API}/orders/${id}/status`, {
          status: 'OFFER',
        }),
      );

      this.order.update((o) => (o ? { ...o, status: OrderStatus.Offer } : o));
      this.showSendOfferModal.set(false);
      this.showToast('success', `Offer sent to ${this.offerEmail}. Status updated to OFFER.`);
    } catch {
      this.showToast('error', 'Failed to send offer.');
    } finally {
      this.sendingOffer.set(false);
    }
  }

  // ─── Send Inquiry to Supplier ────────────────────────────────────

  openSendInquiryModal(): void {
    this.inquiryEmail = '';
    this.inquirySupplierTarget = '';
    this.inquirySubject = `Bunker Inquiry — ${this.vesselName()} at ${this.portName()}`;
    const o = this.order();
    const items = this.itemRows();
    const currency = o?.currency ?? 'USD';
    let body = `Dear Supplier,\n\nWe would like to request a quote for bunker supply to ${this.vesselName()} at ${this.portName()}.\n`;
    if (o?.eta) body += `\nETA: ${this.formatDateTimeForEmail(o.eta)}`;
    if (o?.etd) body += `\nETD: ${this.formatDateTimeForEmail(o.etd)}`;
    if (items.length) {
      body += `\n\nProducts required:\n`;
      items.forEach((item, i) => {
        const qty = item.quantityMin && item.quantityMax
          ? `${item.quantityMin}-${item.quantityMax}`
          : String(item.quantity);
        body += `${i + 1}. ${item.productType || 'Product'} — ${qty} ${item.unit}\n`;
      });
    }
    body += `\nPlease advise on availability and pricing.\n\nBest regards`;
    this.inquiryBody = body;
    this.showSendInquiryModal.set(true);
  }

  async sendInquiryToSupplier(): Promise<void> {
    if (!this.inquiryEmail) return;
    if (!this.isResponsibleUser()) {
      this.showToast('error', 'Only the responsible user can send this inquiry.');
      return;
    }

    this.sendingInquiry.set(true);
    try {
      // Log the inquiry send as an activity (no status change for supplier inquiries)
      // In production this would also send an email via O365
      this.showSendInquiryModal.set(false);
      this.showToast('success', `Inquiry sent to supplier at ${this.inquiryEmail}.`);
    } catch {
      this.showToast('error', 'Failed to send inquiry.');
    } finally {
      this.sendingInquiry.set(false);
    }
  }

  // ─── Convert to Order ────────────────────────────────────────────

  async convertToOrder(): Promise<void> {
    const id = this.inquiryId();
    if (!id) return;

    try {
      // Save pending changes first
      await this.save();

      // Update status to CONFIRMED
      const res = await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API}/orders/${id}/status`, {
          status: 'CONFIRMED',
        }),
      );

      if (res.success) {
        this.showToast('success', 'Inquiry converted to order. Redirecting...');
        // Redirect to the order detail page
        setTimeout(() => {
          this.router.navigate(['/trading/orders', id]);
        }, 1000);
      } else {
        this.showToast('error', 'Failed to convert inquiry.');
      }
    } catch {
      this.showToast('error', 'Failed to convert inquiry.');
    }
  }

  // ─── Cancel Inquiry ──────────────────────────────────────────────

  async cancelInquiry(): Promise<void> {
    const id = this.inquiryId();
    if (!id) return;

    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API}/orders/${id}/status`, {
          status: 'CANCELLED',
        }),
      );

      if (res.success) {
        this.order.update((o) => (o ? { ...o, status: OrderStatus.Cancelled } : o));
        this.showToast('success', 'Inquiry cancelled.');
      }
    } catch {
      this.showToast('error', 'Failed to cancel inquiry.');
    }
  }

  renderCompanyTerms(template: string | null | undefined, companyName: string | null | undefined): string {
    const raw = (template ?? '').trim();
    if (!raw) return '';
    const name = (companyName ?? '').trim();
    if (!name) return raw;
    return raw.split('${companyName}').join(name);
  }

  // ─── PDF Preview ─────────────────────────────────────────────────

  readonly pdfModal = viewChild(PdfPreviewModalComponent);

  async viewOfferPdf(): Promise<void> {
    const id = this.inquiryId();
    if (!id) return;
    const modal = this.pdfModal();
    if (!modal) return;
    modal.showLoading('Offer');
    try {
      const blob = await firstValueFrom(
        this.http.get(`${API}/orders/${id}/offer/pdf`, { responseType: 'blob' }),
      );
      modal.setBlob(blob, `Offer_${this.order()?.orderNumber ?? id}.pdf`);
    } catch {
      modal.showError();
      this.showToast('error', 'Failed to generate offer PDF.');
    }
  }

  async viewProformaPdf(): Promise<void> {
    const id = this.inquiryId();
    if (!id) return;
    const modal = this.pdfModal();
    if (!modal) return;
    modal.showLoading('Proforma Invoice');
    try {
      const blob = await firstValueFrom(
        this.http.get(`${API}/orders/${id}/proforma/pdf`, { responseType: 'blob' }),
      );
      modal.setBlob(blob, `Proforma_${this.order()?.orderNumber ?? id}.pdf`);
    } catch {
      modal.showError();
      this.showToast('error', 'Failed to generate proforma invoice PDF.');
    }
  }

  // ─── WhatsApp send from PDF modal ───────────────────────────────

  async onSendPdfWhatsApp(ev: { phone: string; blob: Blob; fileName: string }): Promise<void> {
    try {
      const base64 = await this.blobToBase64(ev.blob);
      await firstValueFrom(
        this.http.post<ApiResponse<{ success: boolean }>>(`${API}/whatsapp/send`, {
          phone: ev.phone,
          message: `${ev.fileName} — Order ${this.order()?.orderNumber ?? ''}`,
          pdfBase64: base64,
          pdfFileName: ev.fileName,
        }),
      );
      this.pdfModal()?.waDone();
      this.showToast('success', `PDF sent via WhatsApp to ${ev.phone}`);
    } catch {
      this.pdfModal()?.waDone();
      this.showToast('error', 'Failed to send via WhatsApp. Is your device linked?');
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.includes(',') ? result.split(',')[1] : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ─── Toast ───────────────────────────────────────────────────────

  private showToast(type: 'success' | 'error', message: string): void {
    this.toast.set({ type, message });
    setTimeout(() => this.toast.set(null), 4000);
  }
}
