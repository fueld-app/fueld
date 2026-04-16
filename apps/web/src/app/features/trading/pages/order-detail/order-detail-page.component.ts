import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  viewChild,
  OnInit,
  OnDestroy,
  AfterViewInit,
  effect,
  ElementRef,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, type HttpResponse } from '@angular/common/http';
import { DatePipe, DecimalPipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import {
  OrderStatus,
  PaymentTermType,
  PricingModel,
  type OrderDto,
  type CounterpartyDto,
  type VesselDto,
  type PlaceDto,
  type ApiResponse,
  type OwnCompanyDto,
  type OrderAttachmentDto,
  type CustomerPaymentDto,
  type CreditLineDto,
  type CompanyContactDto,
  type BankAccountDto,
  type PlattsSuggestionsResponseDto,
  type OrderSupplierDto,
  type SupplierNominationSummaryDto,
} from '@fueld/types';

import {
  OrderItemsComponent,
  type OrderItemRow,
  type OrderItemsEconomics,
} from '../../components/order-items/order-items.component';
import { OrderFinancingSummaryComponent } from '../../components/order-financing-summary/order-financing-summary.component';
import {
  HeaderActionsComponent,
  type HeaderAction,
} from '../../components/header-actions/header-actions.component';
import { SendEmailModalComponent, type SendEmailPayload, type DocumentEmailType, type SendWhatsAppPayload, type SendEmailAttachmentOption } from '../../components/send-email-modal/send-email-modal.component';
import { SendInquiryModalComponent, type SendInquiryPayload, type SendInquiryWhatsAppPayload } from '../../components/send-inquiry-modal/send-inquiry-modal.component';
import type { DropdownOption } from '../../../../shared/components/searchable-dropdown/searchable-dropdown.component';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { CommentsCardComponent } from '../../../../shared/components/comments-card/comments-card.component';
import { PdfPreviewModalComponent } from '../../../../shared/components/pdf-preview-modal/pdf-preview-modal.component';
import { ActivityTimelineComponent } from '../../../../shared/components/activity-timeline/activity-timeline.component';
import { EmailHistoryCardComponent } from '../../../../shared/components/email-history-card/email-history-card.component';
import { TradingDetailHeaderComponent } from '../../components/detail-header/detail-header.component';
import { TradingDetailMetaCardsComponent } from '../../components/detail-meta-cards/detail-meta-cards.component';
import { AuthService } from '../../../../core/auth/auth.service';
import { CreditApplicationModalComponent } from '../../../credit/components/credit-application-modal.component';

// ═══════════════════════════════════════════════════════════════════════
//  Order Detail Page — Full order view with editable items grid
// ═══════════════════════════════════════════════════════════════════════

import { API_URL, toAbsoluteUrl } from '@app/core/config/api';
import { RiskMonitoringService } from '@app/core/risk-monitoring/risk-monitoring.service';

interface TeamUserOption {
  id: string;
  name: string;
  email: string;
}

interface InquirySupplierPerformance {
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
}

interface InquirySupplierComparisonRow {
  portSupplierId: string;
  supplierId: string;
  supplierName: string;
  contactId: string | null;
  contactName: string | null;
  phone?: string | null;
  products: string[];
  note: string | null;
  email: string | null;
  inquiryStatus: string | null;
  inquirySentAt: string | null;
  performance: InquirySupplierPerformance;
}

interface SupplierInquiryReplyItem {
  orderItemId: string;
  productType: string;
  quantity: string;
  unit: string;
  description: string | null;
  price: string | null;
  currency: string;
  note: string | null;
}

interface SupplierInquiryReplyRow {
  id: string;
  supplierId: string;
  supplierName: string;
  contactId: string | null;
  contactName: string | null;
  email: string;
  status: 'SENT' | 'QUOTED' | 'DECLINED' | 'NO_REPLY';
  sentAt: string | null;
  responseDeadlineAt: string | null;
  reminderSentAt: string | null;
  reminderCount: number;
  respondedAt: string | null;
  quotedAt: string | null;
  canDeliver: boolean | null;
  declineReason: string | null;
  quoteValidUntil: string | null;
  deliveryWindow: string | null;
  supplierPaymentTerms: string | null;
  supplierComment: string | null;
  responseHours: number | null;
  quoteLineCount: number;
  items: SupplierInquiryReplyItem[];
}

interface InquiryQuoteMatrixCell {
  supplierInquiryId: string;
  supplierId: string;
  supplierName: string;
  status: SupplierInquiryReplyRow['status'];
  price: string | null;
  currency: string;
  note: string | null;
  responseHours: number | null;
  isSelectedSupplier: boolean;
}

interface InquiryQuoteMatrixRow {
  orderItemId: string;
  productType: string;
  quantity: string;
  quantityMin: string | null;
  unit: string;
  description: string | null;
  cells: InquiryQuoteMatrixCell[];
}

interface InquiryReplyRecommendation {
  bestOverall: boolean;
  lowestComparable: boolean;
  mostComplete: boolean;
  fastest: boolean;
  score: number;
}

interface PlattsSuggestionViewModel {
  key: string;
  productType: PlattsSuggestionsResponseDto['items'][number]['productType'];
  description: string | null;
  matches: PlattsSuggestionsResponseDto['items'][number]['matches'];
}

@Component({
  selector: 'app-order-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    DatePipe,
    DecimalPipe,
    OrderItemsComponent,
    OrderFinancingSummaryComponent,
    HeaderActionsComponent,
    SendEmailModalComponent,
    SendInquiryModalComponent,
    CommentsCardComponent,
    ActivityTimelineComponent,
    EmailHistoryCardComponent,
    PdfPreviewModalComponent,
    TradingDetailHeaderComponent,
    TradingDetailMetaCardsComponent,
    CreditApplicationModalComponent,
  ],
  template: `
    <app-trading-detail-header
      [title]="isInquiryContext() ? 'Inquiry Detail' : 'Order Detail'"
      [breadcrumbLabel]="isInquiryContext() ? 'Inquiries' : 'Orders'"
      [breadcrumbLink]="isInquiryContext() ? '/trading/inquiries' : '/trading/orders'"
      [entityNumber]="order()?.orderNumber ?? null"
      [fallbackId]="orderId()"
      [status]="order()?.status ?? 'INQUIRY'"
      [subtitle]="subtitle()"
      [showSave]="false"
      [showAutosave]="true"
      [autoSaving]="autoSaving()"
      [lastSaved]="lastSaved()"
    >
      <span subtitle-extra class="flex items-center gap-2">
        <span class="text-xs text-gray-500">Responsible:</span>
        <select
          [ngModel]="order()?.salesRepId ?? ''"
          (ngModelChange)="onResponsibleUserChange($event)"
          class="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        >
          <option value="">— None —</option>
          @for (u of teamUsers(); track u.id) {
            <option [value]="u.id">{{ u.name }}</option>
          }
        </select>
      </span>
      <div detail-actions class="flex flex-wrap items-center gap-2">
        <app-header-actions
          [orderId]="orderId()"
          [status]="order()?.status ?? null"
          [hasInvoicingCompany]="hasInvoicingCompany()"
          [hasSupplier]="hasSupplier()"
          [hasBankAccount]="hasBankAccount()"
          [hasLineItems]="hasLineItems()"
          [hasEnoughPayments]="hasEnoughPaymentsForMarkPaid()"
          (actionTriggered)="onAction($event)"
        />
        <div class="relative">
          <button
            (click)="toggleSettings($event)"
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
            <div
              [style.top.px]="settingsDropdownTop()"
              [style.left.px]="settingsDropdownLeft()"
              class="fixed z-50 w-48 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
              <label class="mb-1 block text-xs font-medium text-gray-500">Currency</label>
              <select
                [ngModel]="order()?.currency ?? 'USD'"
                (ngModelChange)="onCurrencyChange($event); settingsOpen.set(false)"
                class="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900
                       outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              >
                @for (c of configuredCurrencies(); track c.value) {
                  <option [value]="c.value">{{ c.label }}</option>
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
      [supplierId]="activeSupplierCompanyId()"
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
      [canEditClient]="canEditClient()"
      [isReadonly]="isReadonly()"
      [eta]="order()?.eta ?? null"
      [etd]="order()?.etd ?? null"
      [etaMinDateTime]="etaMinDateTime()"
      [timezone]="placeTimezone()"
      [invoicingCompanyId]="order()?.invoicingCompanyId ?? ''"
      [invoicingCompanyName]="invoicingCompanyName()"
      [ownCompanies]="ownCompanies()"
      [allowBankAccountEdit]="allowBankAccountEdit()"
      [responsibleUserId]="order()?.salesRepId ?? ''"
      [responsibleOptions]="responsibleUserOptions()"
      (clientSearch)="searchClients($event)"
      (clientChange)="onClientChange($event)"
      (supplierSearch)="searchSuppliers($event)"
      (supplierChange)="onActiveSupplierCompanyChange($event)"
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
      [supplierContactId]="activeSupplierContactId()"
      [customerContactName]="customerContact()?.name ?? ''"
      [supplierContactName]="activeSupplierContactName()"
      [customerContactOptions]="customerContactDropdownOptions()"
      [supplierContactOptions]="supplierContactDropdownOptions()"
      (customerContactChange)="onCustomerContactChange($event)"
      (supplierContactChange)="onActiveSupplierContactChange($event)"
      [brokerId]="order()?.brokerId ?? ''"
      [brokerName]="brokerName()"
      [brokerOptions]="brokerDropdownOptions()"
      [brokerLoading]="brokerSearchLoading()"
      [brokerContactId]="order()?.brokerContactId ?? ''"
      [brokerContactName]="brokerContact()?.name ?? ''"
      [brokerContactOptions]="brokerContactDropdownOptions()"
      [brokerGetsAll]="order()?.brokerGetsAll ?? false"
      [agentId]="order()?.agentId ?? ''"
      [agentName]="agentName()"
      [agentOptions]="agentDropdownOptions()"
      [agentLoading]="agentSearchLoading()"
      [agentContactId]="order()?.agentContactId ?? ''"
      [agentContactName]="agentContact()?.name ?? ''"
      [agentContactOptions]="agentContactDropdownOptions()"
      (brokerSearch)="searchBrokers($event)"
      (brokerChange)="onBrokerChange($event)"
      (brokerContactChange)="onBrokerContactChange($event)"
      (brokerGetsAllChange)="onBrokerGetsAllChange($event)"
      (agentSearch)="searchAgents($event)"
      (agentChange)="onAgentChange($event)"
      (agentContactChange)="onAgentContactChange($event)"
    >
      <div supplierHeaderTabs>
        @if (orderSupplierTabs().length > 0) {
          <div class="grid min-w-0 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <div class="scrollbar-none min-w-0 flex-1 overflow-x-auto">
              <div class="flex min-w-max items-center gap-1">
                @for (supplierTab of orderSupplierTabs(); track supplierTab.id) {
                  <button
                    type="button"
                    (click)="selectOrderSupplierTab(supplierTab.id)"
                    [attr.aria-selected]="activeOrderSupplierId() === supplierTab.id"
                    class="inline-flex min-w-0 items-center gap-2 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                    [class]="activeOrderSupplierId() === supplierTab.id
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'"
                  >
                    <span class="max-w-[9rem] truncate">{{ supplierTab.label }}</span>
                  </button>
                }
              </div>
            </div>
            @if (!isReadonly() && activeOrderSupplier()) {
              <button
                type="button"
                (click)="addSupplierTab()"
                class="inline-flex shrink-0 items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 transition-colors hover:bg-brand-100"
              >
                + Add
              </button>
            }
          </div>
        }
      </div>
      <!-- Customer Payment (projected into client card) -->
      <div customerPayment>
        <p class="text-xs font-medium uppercase tracking-wider text-gray-400 mb-1.5">Payment</p>
        @if (isReadonly()) {
          <p class="mt-1 text-sm font-semibold text-gray-900">{{ formatCustomerPaymentTerms() }}</p>
        } @else {
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
                  [disabled]="(opt.value === 'CREDIT' && !canUseCustomerCredit())"
                >
                  {{ opt.value === 'CREDIT' && !canUseCustomerCredit() ? (customerCreditFrozen() ? 'Credit (frozen)' : 'Credit (no line)') : opt.label }}
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
              @if (customerCreditFrozen()) {
                <span class="text-red-600 font-medium">Credit frozen — risk monitoring hit</span>
              } @else {
                <span>
                  Available: {{ customerCreditSummary()!.available | number : '1.2-2' }}
                  {{ customerCreditSummary()!.currency }} · Max {{ customerCreditSummary()!.maxDays }} days
                </span>
              }
              @if (!isReadonly()) {
                <button (click)="showCreditApplicationModal.set(true)"
                  class="ml-2 text-xs text-brand-600 hover:text-brand-700 underline">Request Increase</button>
              }
            } @else {
              <span>No credit line on file.</span>
              @if (!isReadonly()) {
                <button (click)="showCreditApplicationModal.set(true)"
                  class="ml-1 text-xs text-brand-600 hover:text-brand-700 underline">Request Credit</button>
              }
            }
          </div>
        }
        <!-- Note toggle -->
        @if (!isReadonly()) {
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
        } @else if (order()?.customerNote) {
          <p class="mt-2 text-xs text-gray-500 whitespace-pre-line">{{ order()?.customerNote }}</p>
        }
      </div>
      <!-- Supplier Payment (projected into supplier card) -->
      <div supplierPayment>
        <p class="text-xs font-medium uppercase tracking-wider text-gray-400 mb-1.5">Payment</p>
        @if (isReadonly()) {
          <p class="mt-1 text-sm font-semibold text-gray-900">{{ formatSupplierPaymentTerms() }}</p>
        } @else {
          <div class="flex items-center gap-2">
            <select
              [ngModel]="activeSupplierPaymentTermType() ?? ''"
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
            @if (activeSupplierPaymentTermType() === 'CREDIT') {
              <input
                type="number"
                min="0"
                [attr.max]="supplierCreditSummary()?.maxDays ?? null"
                [ngModel]="activeSupplierCreditDays() ?? ''"
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
        }
        <!-- Note toggle -->
        @if (!isReadonly()) {
          @if (showSupplierPaymentNote()) {
            <div class="mt-2">
              <textarea
                rows="2"
                [ngModel]="activeSupplierNote() ?? ''"
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
              {{ activeSupplierNote() ? 'Edit note' : 'Add note' }}
            </button>
          }
        } @else if (activeSupplierNote()) {
          <p class="mt-2 text-xs text-gray-500 whitespace-pre-line">{{ activeSupplierNote() }}</p>
        }
      </div>
      <!-- Notes + T&C (projected into invoicing card) -->
      <div notesAndTerms>
        <p class="text-xs font-medium uppercase tracking-wider text-gray-400 mb-1.5">Place remark</p>
        @if (!isPaidOrCancelled()) {
          <textarea
            rows="3"
            class="mt-1 block w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:bg-white"
            placeholder="Remark to include on order documents"
            [ngModel]="order()?.placeRemark ?? ''"
            (ngModelChange)="onPlaceRemarkChange($event)"
          ></textarea>
        } @else if (order()?.placeRemark) {
          <p
            class="mt-1 text-sm text-gray-700 whitespace-pre-line"
            [class.fueld-clamp-1]="!showPlaceRemarkFull()"
          >{{ order()?.placeRemark }}</p>
          <button
            type="button"
            (click)="showPlaceRemarkFull.set(!showPlaceRemarkFull())"
            class="mt-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >{{ showPlaceRemarkFull() ? 'Show less' : 'Show more' }}</button>
        } @else {
          <p class="mt-1 text-sm text-gray-700">-</p>
        }

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

    @if (isInquiryContext()) {
      <div class="mt-4 grid gap-4 lg:grid-cols-2 lg:items-stretch">
        <div class="flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-emerald-50 shadow-sm lg:order-1">
        <div class="border-b border-slate-200/70 px-5 py-4">
          <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Inquiry intelligence</div>
              <h3 class="mt-1 text-base font-semibold text-slate-900">Supplier Comparison Context</h3>
              <p class="mt-1 text-sm text-slate-500">Delivery history and quote hit-rate for suppliers at this port.</p>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <span class="inline-flex items-center rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 font-medium text-slate-600">
                {{ rankedInquirySuppliers().length }} supplier{{ rankedInquirySuppliers().length === 1 ? '' : 's' }} ranked
              </span>
              @if (selectedSupplierComparison()) {
                <span class="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
                  Reviewing {{ selectedSupplierComparison()!.supplierName }}
                </span>
              }
            </div>
          </div>
        </div>

        @if (inquirySupplierContextLoading()) {
          <div class="px-5 py-5 text-sm text-slate-400">Loading supplier comparison context...</div>
        } @else if (rankedInquirySuppliers().length === 0) {
          <div class="px-5 py-5 text-sm text-slate-400">No supplier history available for this inquiry yet.</div>
        } @else {
          <div class="grid gap-3 px-5 py-5 lg:grid-cols-2">
            @for (supplier of rankedInquirySuppliers(); track supplier.supplierId) {
              <div
                class="rounded-2xl border px-4 py-3 shadow-sm transition-all"
                [class.border-emerald-300]="selectedSupplierComparison()?.supplierId === supplier.supplierId"
                [class.bg-emerald-50/80]="selectedSupplierComparison()?.supplierId === supplier.supplierId"
                [class.border-slate-200]="selectedSupplierComparison()?.supplierId !== supplier.supplierId"
                [class.bg-white]="selectedSupplierComparison()?.supplierId !== supplier.supplierId"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="truncate text-sm font-semibold text-slate-900">{{ supplier.supplierName }}</span>
                      @if (isTopInquirySupplier(supplier)) {
                        <span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Best history here</span>
                      }
                      @if (selectedSupplierComparison()?.supplierId === supplier.supplierId) {
                        <span class="inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Selected</span>
                      }
                    </div>
                    @if (supplier.products.length) {
                      <div class="mt-1 flex flex-wrap gap-1">
                        @for (product of supplier.products; track product) {
                          <span class="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{{ product }}</span>
                        }
                      </div>
                    }
                  </div>
                  @if (supplier.inquiryStatus) {
                    <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                      [class]="statusBadgeClass(supplier.inquiryStatus)">
                      {{ supplier.inquiryStatus }}
                    </span>
                  }
                </div>

                <div class="mt-3 flex flex-wrap gap-1.5">
                  @if (supplier.performance.deliveredCountOverall > 0) {
                    <span class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">{{ supplier.performance.deliveredCountOverall }} delivered</span>
                  }
                  @if (supplier.performance.deliveredCountAtPlace > 0) {
                    <span class="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 ring-1 ring-blue-200">{{ supplier.performance.deliveredCountAtPlace }} at this place</span>
                  }
                  @if (quoteRateLabel(supplier.performance)) {
                    <span class="inline-flex items-center rounded-full bg-fuchsia-50 px-2 py-0.5 text-[10px] font-medium text-fuchsia-700 ring-1 ring-fuchsia-200">{{ quoteRateLabel(supplier.performance) }}</span>
                  }
                  @if (averageResponseLabel(supplier.performance)) {
                    <span class="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">{{ averageResponseLabel(supplier.performance) }}</span>
                  }
                  @if (deliverabilityLabel(supplier.performance)) {
                    <span class="inline-flex items-center rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-700 ring-1 ring-teal-200">{{ deliverabilityLabel(supplier.performance) }}</span>
                  }
                  @if (supplierPerformanceSummary(supplier.performance)) {
                    <span class="inline-flex items-center rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200">{{ supplierPerformanceSummary(supplier.performance) }}</span>
                  }
                </div>

                @if (supplier.inquirySentAt) {
                  <div class="mt-3 border-t border-slate-200/70 pt-2 text-[11px] text-slate-400">Inquiry sent {{ formatHistoryDate(supplier.inquirySentAt) }}</div>
                }

                @if (!isReadonly()) {
                  <div class="mt-3 flex justify-end">
                    <button
                      type="button"
                      (click)="applyComparisonSupplier(supplier)"
                      [disabled]="selectedSupplierComparison()?.supplierId === supplier.supplierId"
                      class="inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                      [class.bg-brand-600]="selectedSupplierComparison()?.supplierId !== supplier.supplierId"
                      [class.text-white]="selectedSupplierComparison()?.supplierId !== supplier.supplierId"
                      [class.hover:bg-brand-700]="selectedSupplierComparison()?.supplierId !== supplier.supplierId"
                      [class.bg-slate-100]="selectedSupplierComparison()?.supplierId === supplier.supplierId"
                      [class.text-slate-500]="selectedSupplierComparison()?.supplierId === supplier.supplierId"
                    >
                      {{ selectedSupplierComparison()?.supplierId === supplier.supplierId ? 'Selected supplier' : 'Set as supplier' }}
                    </button>
                  </div>
                }
              </div>
            }
          </div>
        }
        </div>

      @if (sortedInquiryReplies().length > 0) {
        <div class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm lg:order-3 lg:col-span-2">
          <div class="border-b border-slate-200 px-5 py-4">
          <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Line comparison</div>
              <h3 class="mt-1 text-base font-semibold text-slate-900">Quote Matrix</h3>
              <p class="mt-1 text-sm text-slate-500">Compare all supplier responses by line item in one grid.</p>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <span class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-600">
                {{ sortedInquiryReplies().length }} repl{{ sortedInquiryReplies().length === 1 ? 'y' : 'ies' }}
              </span>
              <span class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-600">
                {{ inquiryQuoteMatrixRows().length }} line{{ inquiryQuoteMatrixRows().length === 1 ? '' : 's' }}
              </span>
            </div>
          </div>
          </div>

          <div class="overflow-x-auto px-5 py-4">
            <table class="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th class="sticky left-0 z-10 min-w-64 border-b border-slate-200 bg-white px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Line item</th>
                  @for (reply of sortedInquiryReplies(); track reply.id) {
                    <th class="min-w-52 border-b border-slate-200 px-4 py-3 text-left align-top"
                      [class.bg-slate-50]="order()?.supplierId === reply.supplierId">
                      <div class="flex items-center gap-2">
                        <span class="font-semibold text-slate-900">{{ reply.supplierName }}</span>
                        @if (order()?.supplierId === reply.supplierId) {
                          <span class="inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Selected</span>
                        }
                      </div>
                      <div class="mt-2 flex flex-wrap gap-1.5">
                        @if (inquiryReplyRecommendation(reply.id)?.bestOverall) {
                          <span class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200">Best overall</span>
                        }
                        @if (inquiryReplyRecommendation(reply.id)?.lowestComparable) {
                          <span class="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 ring-1 ring-sky-200">Lowest total</span>
                        }
                        @if (inquiryReplyRecommendation(reply.id)?.mostComplete) {
                          <span class="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 ring-1 ring-violet-200">Most complete</span>
                        }
                        @if (inquiryReplyRecommendation(reply.id)?.fastest) {
                          <span class="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-amber-200">Fastest</span>
                        }
                      </div>
                      <div class="mt-1 text-[11px] text-slate-500">{{ inquiryReplySummary(reply) }}</div>
                      <div class="mt-1 text-[11px] text-slate-400">Score {{ inquiryReplyRecommendation(reply.id)?.score ?? 0 | number : '1.0-1' }}</div>
                      @if (reply.responseHours !== null) {
                        <div class="mt-1 text-[11px] text-slate-400">{{ responseHoursLabel(reply.responseHours) }} response</div>
                      }
                    </th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (matrixRow of inquiryQuoteMatrixRows(); track matrixRow.orderItemId) {
                  <tr>
                    <td class="sticky left-0 z-10 border-b border-slate-100 bg-white px-4 py-3 align-top">
                      <div class="font-semibold text-slate-900">{{ matrixRow.productType }}</div>
                      <div class="mt-1 text-xs text-slate-500">{{ formatQty(matrixRow.quantity, matrixRow.quantityMin) }} {{ matrixRow.unit }}@if (matrixRow.description) { · {{ matrixRow.description }} }</div>
                    </td>
                    @for (cell of matrixRow.cells; track cell.supplierInquiryId) {
                      <td class="border-b border-slate-100 px-4 py-3 align-top"
                        [class.bg-slate-50]="cell.isSelectedSupplier">
                        @if (cell.price !== null) {
                          <div class="font-semibold text-slate-900">{{ cell.price }} {{ cell.currency }}</div>
                          @if (cell.note) {
                            <div class="mt-1 text-xs text-slate-500">{{ cell.note }}</div>
                          }
                        } @else {
                          <div class="font-medium text-slate-500">{{ cell.note || inquiryQuoteMatrixCellLabel(cell.status) }}</div>
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

        <div class="flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm lg:order-2">
        <div class="border-b border-slate-200 px-5 py-4">
          <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Manual capture</div>
              <h3 class="mt-1 text-base font-semibold text-slate-900">Supplier Replies</h3>
              <p class="mt-1 text-sm text-slate-500">Record manual supplier replies and line-item quotes so future ranking reflects actual responsiveness.</p>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <span class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-600">
                {{ sortedInquiryReplies().length }} supplier{{ sortedInquiryReplies().length === 1 ? '' : 's' }} contacted
              </span>
            </div>
          </div>
        </div>

        @if (inquiryRepliesLoading()) {
          <div class="px-5 py-5 text-sm text-slate-400">Loading supplier replies...</div>
        } @else if (sortedInquiryReplies().length === 0) {
          <div class="px-5 py-5 text-sm text-slate-400">No supplier inquiries have been sent yet.</div>
        } @else {
          <div class="flex-1 space-y-3 px-5 py-5">
            @for (reply of sortedInquiryReplies(); track reply.id) {
              <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/50 p-4 shadow-sm">
                <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="text-sm font-semibold text-slate-900">{{ reply.supplierName }}</span>
                      <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium" [class]="statusBadgeClass(reply.status)">{{ reply.status }}</span>
                      @if (order()?.supplierId === reply.supplierId) {
                        <span class="inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Selected supplier</span>
                      }
                    </div>
                    <div class="mt-1 text-xs text-slate-500">
                      {{ reply.email }}
                      @if (reply.contactName) {
                        <span> • {{ reply.contactName }}</span>
                      }
                    </div>
                    @if (reply.sentAt) {
                      <div class="mt-1 text-[11px] text-slate-400">Sent {{ formatHistoryDateTime(reply.sentAt) }}</div>
                    }
                    @if (reply.responseDeadlineAt) {
                      <div class="mt-1 text-[11px] text-slate-400">Reply by {{ formatHistoryDateTime(reply.responseDeadlineAt) }}</div>
                    }
                  </div>

                  <div class="flex flex-wrap items-center gap-2">
                    @if (reply.responseHours !== null) {
                      <span class="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">{{ responseHoursLabel(reply.responseHours) }} response</span>
                    }
                    @if (reply.canDeliver === true) {
                      <span class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">Can deliver</span>
                    }
                    @if (reply.canDeliver === false) {
                      <span class="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700 ring-1 ring-rose-200">Cannot deliver</span>
                    }
                    @if (reply.reminderSentAt) {
                      <span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200">Reminder sent</span>
                    }
                    @if (!isReadonly()) {
                      <button
                        type="button"
                        (click)="isEditingInquiryReply(reply) ? cancelInquiryReplyEditor() : openInquiryReplyEditor(reply)"
                        class="inline-flex items-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
                      >
                        {{ isEditingInquiryReply(reply) ? 'Close editor' : 'Record reply' }}
                      </button>
                    }
                  </div>
                </div>

                <div class="mt-3 rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  {{ inquiryReplySummary(reply) }}
                </div>

                @if (reply.status === 'QUOTED' && !isEditingInquiryReply(reply) && (reply.deliveryWindow || reply.supplierPaymentTerms || reply.quoteValidUntil || reply.supplierComment)) {
                  <div class="mt-3 grid gap-2 md:grid-cols-2">
                    @if (reply.deliveryWindow) {
                      <div class="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600"><span class="font-medium text-slate-900">Delivery window:</span> {{ reply.deliveryWindow }}</div>
                    }
                    @if (reply.supplierPaymentTerms) {
                      <div class="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600"><span class="font-medium text-slate-900">Payment terms:</span> {{ reply.supplierPaymentTerms }}</div>
                    }
                    @if (reply.quoteValidUntil) {
                      <div class="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600"><span class="font-medium text-slate-900">Valid until:</span> {{ formatHistoryDateTime(reply.quoteValidUntil) }}</div>
                    }
                    @if (reply.supplierComment) {
                      <div class="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 md:col-span-2"><span class="font-medium text-slate-900">Comment:</span> {{ reply.supplierComment }}</div>
                    }
                  </div>
                }

                @if (reply.status === 'QUOTED' && !isEditingInquiryReply(reply)) {
                  <div class="mt-3 grid gap-2 md:grid-cols-2">
                    @for (item of reply.items; track item.orderItemId) {
                        <div class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm">
                        <div class="font-medium text-slate-900">{{ item.productType }}</div>
                        <div class="mt-1 text-xs text-slate-500">{{ formatQty(item.quantity) }} {{ item.unit }}@if (item.description) { · {{ item.description }} }</div>
                        <div class="mt-2 text-sm font-semibold text-slate-900">{{ item.price || '—' }}@if (item.price) { {{ item.currency }} }</div>
                        @if (item.note) {
                          <div class="mt-1 text-xs text-slate-500">{{ item.note }}</div>
                        }
                      </div>
                    }
                  </div>
                }

                @if (isEditingInquiryReply(reply)) {
                  <div class="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Reply status</div>
                    <div class="mt-3 flex flex-wrap gap-2">
                      @for (status of inquiryReplyStatuses; track status) {
                        <button
                          type="button"
                          (click)="setInquiryReplyStatus(status)"
                          class="rounded-full px-3 py-1.5 text-xs font-semibold transition-colors"
                          [class.bg-slate-900]="inquiryReplyStatus() === status"
                          [class.text-white]="inquiryReplyStatus() === status"
                          [class.bg-white]="inquiryReplyStatus() !== status"
                          [class.text-slate-600]="inquiryReplyStatus() !== status"
                          [class.ring-1]="inquiryReplyStatus() !== status"
                          [class.ring-slate-200]="inquiryReplyStatus() !== status"
                        >
                          {{ status === 'SENT' ? 'Awaiting' : status === 'NO_REPLY' ? 'No reply' : status }}
                        </button>
                      }
                    </div>

                    @if (inquiryReplyStatus() === 'QUOTED' || inquiryReplyStatus() === 'DECLINED') {
                      <div class="mt-4">
                        <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Responded at</label>
                        <input
                          type="datetime-local"
                          [ngModel]="inquiryReplyRespondedAt()"
                          (ngModelChange)="inquiryReplyRespondedAt.set($event)"
                          class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 md:w-72"
                        />
                      </div>
                    }

                    @if (inquiryReplyStatus() === 'QUOTED') {
                      <div class="mt-4 grid gap-3 md:grid-cols-2">
                        @for (item of reply.items; track item.orderItemId) {
                          <div class="rounded-xl border border-slate-200 bg-white p-3">
                            <div class="text-sm font-semibold text-slate-900">{{ item.productType }}</div>
                            <div class="mt-1 text-xs text-slate-500">{{ formatQty(item.quantity) }} {{ item.unit }}@if (item.description) { · {{ item.description }} }</div>
                            <label class="mt-3 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Price ({{ item.currency }})</label>
                            <input
                              type="number"
                              min="0"
                              step="0.0001"
                              [ngModel]="inquiryReplyPrices()[item.orderItemId] || ''"
                              (ngModelChange)="setInquiryReplyPrice(item.orderItemId, $event)"
                              class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-right text-sm text-slate-900
                                     [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
                                     focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                            />
                            <label class="mt-3 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Line note</label>
                            <textarea
                              rows="2"
                              [ngModel]="inquiryReplyNotes()[item.orderItemId] || ''"
                              (ngModelChange)="setInquiryReplyNote(item.orderItemId, $event)"
                              class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                              placeholder="Optional note or skip reason"
                            ></textarea>
                          </div>
                        }
                      </div>

                      <div class="mt-4 grid gap-3 md:grid-cols-2">
                        <div>
                          <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Quote valid until</label>
                          <input
                            type="datetime-local"
                            [ngModel]="inquiryReplyQuoteValidUntil()"
                            (ngModelChange)="inquiryReplyQuoteValidUntil.set($event)"
                            class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                          />
                        </div>
                        <div>
                          <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Delivery window</label>
                          <input
                            type="text"
                            [ngModel]="inquiryReplyDeliveryWindow()"
                            (ngModelChange)="inquiryReplyDeliveryWindow.set($event)"
                            class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                          />
                        </div>
                        <div>
                          <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Payment terms</label>
                          <input
                            type="text"
                            [ngModel]="inquiryReplySupplierPaymentTerms()"
                            (ngModelChange)="inquiryReplySupplierPaymentTerms.set($event)"
                            class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                          />
                        </div>
                        <div class="md:col-span-2">
                          <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Comment</label>
                          <textarea
                            rows="3"
                            [ngModel]="inquiryReplySupplierComment()"
                            (ngModelChange)="inquiryReplySupplierComment.set($event)"
                            class="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                          ></textarea>
                        </div>
                      </div>
                    }

                    @if (inquiryReplyStatus() === 'DECLINED') {
                      <div class="mt-4">
                        <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Decline reason</label>
                        <textarea
                          rows="3"
                          [ngModel]="inquiryReplyDeclineReason()"
                          (ngModelChange)="inquiryReplyDeclineReason.set($event)"
                          class="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                          placeholder="Why could the supplier not deliver?"
                        ></textarea>
                      </div>
                    }

                    <div class="mt-4 flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        (click)="cancelInquiryReplyEditor()"
                        class="inline-flex items-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
                      >Cancel</button>
                      <button
                        type="button"
                        (click)="saveInquiryReply(reply)"
                        [disabled]="inquiryRepliesSavingId() === reply.id || !canSaveInquiryReply(reply)"
                        class="inline-flex items-center rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {{ inquiryRepliesSavingId() === reply.id ? 'Saving...' : 'Save reply' }}
                      </button>
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>
      </div>
    }

    <!-- ═════════════════════════════════════════════════════════════ -->
    <!--  Editable Items Grid                                         -->
    <!-- ═════════════════════════════════════════════════════════════ -->
    <app-order-items
      class="mt-4 block"
      [items]="itemRows()"
      [readonly]="isReadonly()"
      [allowDeliveredEdit]="allowDeliveredEdit()"
      [supplierOptionsInput]="itemSupplierOptions()"
      [financingRateAnnual]="financingRateAnnual()"
      [financingDays]="financingDays()"
      [financingDayCountConvention]="financingDayCountConvention()"
      [productOptionsInput]="configuredProducts()"
      [unitOptionsInput]="configuredUnits()"
      [unitConversionsInput]="configuredUnitConversions()"
      [currencyOptionsInput]="configuredCurrencies()"
      [priceReferencesInput]="configuredPriceReferences()"
      [plattsSuggestionsInput]="plattsSuggestionItems()"
      (itemsChange)="onItemsChange($event)"
      (economicsChange)="onItemEconomicsChange($event)"
      (displayCurrencyChange)="itemDisplayCurrency.set($event)"
    />

    <!-- ═════════════════════════════════════════════════════════════ -->
    <!--  Financing Summary + Platts Signals (side-by-side on desktop) -->
    <!-- ═════════════════════════════════════════════════════════════ -->
    <div class="mt-4 grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
      <div #financingSummaryContainer class="block">
        <app-order-financing-summary
          class="block"
          [baseCurrency]="itemDisplayCurrency()"
          [financingRateAnnual]="financingRateAnnual()"
          [financingDays]="financingDays()"
          [financingDayCountConvention]="financingDayCountConvention()"
          [economics]="itemEconomics()"
        />
      </div>

    <div
      class="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
      [style.max-height.px]="plattsSignalsMaxHeight()"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold uppercase tracking-wider text-gray-700">Platts Signals</h3>
          <p class="mt-1 text-xs text-gray-500">
            Canonical Platts matches for the current line items.
            @if (plattsSuggestionsMeta()) {
              <span>
                Using {{ plattsSuggestionsMeta()!.matchedPublicationDate ?? plattsSuggestionsMeta()!.requestedPublicationDate }}
                @if (plattsSuggestionsMeta()!.usedFallbackReport) {
                  <span>(closest available canonical report)</span>
                }
              </span>
            }
          </p>
        </div>
        <div class="flex items-center gap-2">
          @if (plattsSuggestionsMeta()?.reportTitle && plattsSuggestionsMeta()?.reportId) {
            <button
              type="button"
              (click)="openPlattsReport(plattsSuggestionsMeta()!.reportId!)"
              class="inline-flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:border-brand-300 hover:text-brand-700"
            >
              Open source report
            </button>
          }
          <button
            type="button"
            (click)="loadPlattsSuggestions()"
            [disabled]="plattsSuggestionsLoading()"
            class="inline-flex items-center rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ plattsSuggestionsLoading() ? 'Refreshing...' : 'Refresh signals' }}
          </button>
        </div>
      </div>

      @if (plattsSuggestionsError()) {
        <div class="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {{ plattsSuggestionsError() }}
        </div>
      } @else if (plattsSuggestionsLoading() && !plattsSuggestionItems().length) {
        <div class="mt-4 text-sm text-gray-500">Loading Platts matches...</div>
      } @else if (!plattsSuggestionItems().length) {
        <div class="mt-4 text-sm text-gray-500">No Platts suggestions available for the current items yet.</div>
      } @else {
        <div class="mt-4 grid min-h-0 flex-1 gap-3 overflow-y-auto pr-1">
          @for (item of plattsSuggestionItems(); track item.key) {
            <div class="rounded-xl border border-gray-200 p-4">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="text-sm font-semibold text-gray-900">{{ item.productType }}</div>
                  @if (item.description) {
                    <div class="mt-1 text-xs text-gray-500">{{ item.description }}</div>
                  }
                </div>
                <div class="text-[11px] uppercase tracking-wide text-gray-400">{{ item.matches.length }} match{{ item.matches.length === 1 ? '' : 'es' }}</div>
              </div>

              @if (!item.matches.length) {
                <div class="mt-3 text-sm text-gray-500">No canonical Platts entries matched this line item.</div>
              } @else {
                <div class="mt-3 space-y-2">
                  @for (match of item.matches; track match.entryId) {
                    <button
                      type="button"
                      (click)="openPlattsReport(match.reportId)"
                      class="block w-full rounded-lg border border-gray-200 px-3 py-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                        <span class="font-semibold text-gray-700">{{ match.company || 'Market' }}</span>
                        @if (match.action) {
                          <span>{{ match.action }}</span>
                        }
                        @if (match.counterparty) {
                          <span>vs {{ match.counterparty }}</span>
                        }
                        @if (match.priceRaw) {
                          <span>{{ match.priceRaw }}</span>
                        }
                        @if (match.quantityRaw) {
                          <span>{{ match.quantityRaw }}</span>
                        }
                      </div>
                      <div class="mt-1 text-sm text-gray-800">{{ match.rawText }}</div>
                      <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                        @if (match.instrument) {
                          <span>{{ match.instrument }}</span>
                        }
                        @if (match.windowLabel) {
                          <span>{{ match.windowLabel }}</span>
                        }
                        @if (match.marketRegion) {
                          <span>{{ match.marketRegion }}</span>
                        }
                        <span>score {{ match.score }}</span>
                      </div>
                    </button>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
    </div>

    <!-- Delivery + Payments + Attachments + Comments -->
    @if (allowDeliveredEdit() || orderId() || order()?.id) {
      <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        @if (allowDeliveredEdit()) {
          <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm h-full max-h-[520px] flex flex-col">
            <h3 class="text-sm font-semibold text-gray-700 uppercase tracking-wider">Delivery Details</h3>
            <div class="mt-3">
              <label class="mb-1 block text-xs font-medium text-gray-500">
                Delivered At
                @if (hasMultipleOrderSuppliers() && activeOrderSupplier()) {
                  <span class="text-gray-400">for {{ activeOrderSupplier()!.company?.name ?? 'selected supplier' }}</span>
                }
                @if (placeTimezoneAbbr()) {
                  <span class="text-gray-400">({{ placeTimezoneAbbr() }})</span>
                }
              </label>
              <input
                type="date"
                [ngModel]="deliveredAtLocal()"
                (ngModelChange)="onDeliveredAtChange($event)"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                       focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <p class="mt-3 text-xs text-gray-400">
              Delivered quantities can be edited in the items grid above.
              The final invoice will use delivered quantities.
            </p>
            @if (supplierNomination()) {
              <div class="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900">
                <div class="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Supplier submission</div>
                <div class="mt-2 space-y-2">
                  <div>
                    <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700/80">Status</div>
                    <div class="mt-1 font-semibold">{{ supplierNomination()!.status }}</div>
                  </div>
                  @if (supplierNomination()!.deliveryCompletedAt) {
                    <div>
                      <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700/80">Supplier exact delivery time</div>
                      <div class="mt-1 font-semibold">{{ supplierNomination()!.deliveryCompletedAt | date : 'medium' }}</div>
                    </div>
                  }
                  @if (activeSupplierDeliveredAt()) {
                    <div>
                      <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700/80">Internal delivered date</div>
                      <div class="mt-1 font-semibold">{{ formatStoredDateOnlyLabel(activeSupplierDeliveredAt()) }}</div>
                    </div>
                  }
                  @if (supplierNominationDateMismatch()) {
                    <div class="rounded-lg border border-amber-300 bg-white/80 px-3 py-2 text-xs text-amber-800">
                      Supplier-submitted delivery date differs from the internal delivered date.
                    </div>
                  }
                  @if (supplierNomination()!.supplierReference) {
                    <div>
                      <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700/80">Supplier reference</div>
                      <div class="mt-1">{{ supplierNomination()!.supplierReference }}</div>
                    </div>
                  }
                  @if (supplierNomination()!.attachments.length > 0) {
                    <div>
                      <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700/80">BDRs uploaded</div>
                      <div class="mt-1 font-semibold">{{ supplierNomination()!.attachments.length }}</div>
                    </div>
                  }
                  @if (supplierNomination()!.supplierComment) {
                    <div>
                      <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700/80">Comment</div>
                      <div class="mt-1 whitespace-pre-line">{{ supplierNomination()!.supplierComment }}</div>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        }
        @if (orderId() || order()?.id) {
        <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm h-full max-h-[520px] flex flex-col">
          <div class="flex items-center justify-between gap-4">
            <div>
              <h3 class="text-sm font-semibold text-gray-700 uppercase tracking-wider">Payments</h3>
              <p class="mt-1 text-xs text-gray-500">Total paid: {{ paymentsTotal() | number : '1.2-2' }} {{ order()?.currency ?? 'USD' }}</p>
            </div>
            <button
              type="button"
              (click)="openPaymentModal()"
              [disabled]="!canRecordPayment()"
              class="inline-flex items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold
                     text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              Add payment
            </button>
          </div>
          <div class="mt-4 flex-1 overflow-auto">
            @if (paymentsLoading()) {
              <p class="text-sm text-gray-400">Loading payments...</p>
            } @else if (payments().length === 0) {
              <p class="text-sm text-gray-400">No payments recorded yet.</p>
            } @else {
              <ul class="divide-y divide-gray-100">
                @for (payment of payments(); track payment.id) {
                  <li class="flex items-start justify-between gap-4 py-3 text-sm">
                    <div>
                      <div class="font-semibold text-gray-900">
                        {{ payment.amount }} {{ payment.currency }}
                      </div>
                      <div class="mt-0.5 text-xs text-gray-500">
                        {{ payment.receivedAt | date : 'mediumDate' }}
                        @if (payment.method) { · {{ payment.method }} }
                      </div>
                      @if (payment.note) {
                        <div class="mt-1 text-xs text-gray-600 whitespace-pre-line">{{ payment.note }}</div>
                      }
                    </div>
                    <div class="text-xs text-gray-400">{{ payment.createdAt | date : 'short' }}</div>
                  </li>
                }
              </ul>
            }
          </div>
        </div>
        <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm h-full max-h-[520px] flex flex-col">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-gray-700 uppercase tracking-wider">Attachments</h3>
          </div>
          <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <select
              [ngModel]="attachmentType()"
              (ngModelChange)="attachmentType.set($event)"
              class="w-full sm:w-40 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                     focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
            >
              @for (type of configuredAttachmentTypes(); track type) {
                <option [value]="type">{{ type }}</option>
              }
            </select>
            <input
              type="file"
              (change)="onAttachmentSelected($event)"
              accept="application/pdf,image/*"
              class="w-full text-sm text-gray-600 file:mr-4 file:rounded-lg file:border-0 file:bg-gray-100
                     file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
            />
            <button
              type="button"
              (click)="uploadAttachment()"
              [disabled]="uploadingAttachment() || !selectedAttachment"
              class="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold
                     text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              Upload
            </button>
          </div>
          <div class="mt-4 flex-1 overflow-auto">
            @if (attachments().length === 0) {
              <p class="text-sm text-gray-400">No attachments yet.</p>
            } @else {
              <ul class="divide-y divide-gray-100">
                @for (att of attachments(); track att.id) {
                  <li class="flex items-center justify-between py-2 text-sm">
                    <div class="flex items-center gap-2">
                      <span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">{{ att.type }}</span>
                      <button
                        type="button"
                        (click)="openAttachment(att)"
                        class="text-left text-brand-600 hover:underline"
                      >
                        {{ att.fileName }}
                      </button>
                    </div>
                    <span class="text-xs text-gray-400">{{ formatFileSize(att.fileSize) }}</span>
                  </li>
                }
              </ul>
            }
          </div>
        </div>
        @if (orderId()) {
          <div class="h-full max-h-[520px] overflow-auto">
            <app-comments-card entityType="order" [entityId]="orderId()" [enableFollowUp]="false" />
          </div>
        }
        }
      </div>
      @if (order()?.id) {
        <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <app-email-history-card [orderId]="order()!.id" />
          <app-activity-timeline entityType="order" [entityId]="order()!.id" />
        </div>
      }
    }

    <!-- Toast notification -->
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

    @if (paymentModalOpen()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div class="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold text-gray-900">Record payment</h3>
            <button
              type="button"
              (click)="closePaymentModal()"
              class="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
          <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label class="text-xs font-medium text-gray-500">Amount</label>
              <input
                type="number"
                min="0"
                [ngModel]="paymentAmount()"
                (ngModelChange)="paymentAmount.set($event)"
                class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700
                       focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label class="text-xs font-medium text-gray-500">Currency</label>
              <select
                [ngModel]="paymentCurrency()"
                (ngModelChange)="paymentCurrency.set($event)"
                class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 uppercase
                       focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 bg-white"
              >
                @for (c of configuredCurrencies(); track c.value) {
                  <option [value]="c.value">{{ c.label }}</option>
                }
              </select>
            </div>
            <div>
              <label class="text-xs font-medium text-gray-500">Received at</label>
              <input
                type="date"
                [ngModel]="paymentReceivedAt()"
                (ngModelChange)="paymentReceivedAt.set($event)"
                class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700
                       focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label class="text-xs font-medium text-gray-500">Method</label>
              <input
                type="text"
                [ngModel]="paymentMethod()"
                (ngModelChange)="paymentMethod.set($event)"
                placeholder="Wire, ACH, card"
                class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700
                       focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>
          <div class="mt-3">
            <label class="text-xs font-medium text-gray-500">Note</label>
            <textarea
              rows="3"
              [ngModel]="paymentNote()"
              (ngModelChange)="paymentNote.set($event)"
              class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700
                     focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            ></textarea>
          </div>
          <div class="mt-5 flex items-center justify-end gap-3">
            <button
              type="button"
              (click)="closePaymentModal()"
              class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              (click)="submitPayment()"
              [disabled]="paymentSaving()"
              class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white
                     shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              Record payment
            </button>
          </div>
        </div>
      </div>
    }

    @if (showConvertToOrderModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold text-gray-900">Convert to Order?</h3>
            <button
              type="button"
              (click)="closeConvertToOrderModal()"
              class="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
          <p class="mt-3 text-sm text-gray-600">
            This will change the status from inquiry to confirmed order.
          </p>
          <div class="mt-5 flex items-center justify-end gap-3">
            <button
              type="button"
              (click)="closeConvertToOrderModal()"
              class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              (click)="confirmConvertToOrder()"
              [disabled]="convertingToOrder()"
              class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              Confirm Convert
            </button>
          </div>
        </div>
      </div>
    }

    @if (showCancelInquiryModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold text-gray-900">Cancel {{ cancellationTargetLabel() }}</h3>
            <button
              type="button"
              (click)="closeCancelInquiryModal()"
              class="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
          <p class="mt-3 text-sm text-gray-600">
            Select a reason for cancelling this {{ cancellationTargetLabel() }}.
          </p>
          <div class="mt-4">
            <label class="text-xs font-medium text-gray-500">Cancellation reason</label>
            <select
              [ngModel]="selectedInquiryCancelReason()"
              (ngModelChange)="selectedInquiryCancelReason.set($event)"
              class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700
                     focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 bg-white"
            >
              @for (reason of availableInquiryCancelReasons(); track reason) {
                <option [value]="reason">{{ reason }}</option>
              }
            </select>
          </div>
          @if (selectedInquiryCancelReason() === 'Other') {
            <div class="mt-3">
              <label class="text-xs font-medium text-gray-500">Please specify</label>
              <textarea
                [ngModel]="cancelReasonOtherDetail()"
                (ngModelChange)="cancelReasonOtherDetail.set($event)"
                placeholder="e.g. Adani is exclusive at Mundra - direct with client"
                rows="3"
                class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700
                       focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              ></textarea>
            </div>
          }
          <div class="mt-5 flex items-center justify-end gap-3">
            <button
              type="button"
              (click)="closeCancelInquiryModal()"
              class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              (click)="confirmCancelInquiry()"
              [disabled]="cancellingInquiry()"
              class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              Confirm Cancel
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Place Remark Change Prompt -->
    @if (showPlaceRemarkPrompt()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold text-gray-900">Update place remark?</h3>
            <button
              type="button"
              (click)="dismissPlaceRemarkPrompt()"
              class="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
          <p class="mt-3 text-sm text-gray-600">
            The new place has a different default remark. Would you like to update the order's place remark to match?
          </p>
          @if (pendingPlaceRemark()) {
            <div class="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 whitespace-pre-line max-h-32 overflow-y-auto">
              {{ pendingPlaceRemark() }}
            </div>
          } @else {
            <p class="mt-3 text-sm text-gray-400 italic">The new place has no default remark.</p>
          }
          <div class="mt-5 flex items-center justify-end gap-3">
            <button
              type="button"
              (click)="dismissPlaceRemarkPrompt()"
              class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600"
            >
              Keep current
            </button>
            <button
              type="button"
              (click)="applyNewPlaceRemark()"
              class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              {{ pendingPlaceRemark() ? 'Use new remark' : 'Clear remark' }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Send Email Modal -->
    <app-send-email-modal
      [documentType]="emailDocumentType()"
      [senderName]="auth.userName()"
      [senderEmail]="auth.userEmail()"
      [pdfFileName]="emailPdfFileName()"
      [orderId]="orderId()"
      [nominationOrderSupplierId]="nominationOrderSupplierId()"
      [extraAttachments]="invoiceEmailAttachmentOptions()"
      [waLinked]="waLinked()"
      [defaultPhone]="emailModalDefaultPhone()"
      (sendEmail)="onSendEmail($event)"
      (sendWhatsApp)="onSendInvoiceWhatsApp($event)"
    />

    <!-- Send Inquiry Modal -->
    <app-send-inquiry-modal
      [orderId]="orderId()"
      [senderName]="auth.userName()"
      [companyName]="invoicingCompanyName()"
      [placeId]="order()?.placeId ?? ''"
      [portName]="port()?.name ?? ''"
      [waLinked]="waLinked()"
      [vesselName]="vesselName()"
      [vesselImo]="vessel()?.imo ?? null"
      [eta]="order()?.eta ?? null"
      [etd]="order()?.etd ?? null"
      [items]="inquiryItems()"
      (sendInquiry)="onSendInquiry($event)"
      (sendWhatsAppInquiry)="onSendInquiryWhatsApp($event)"
    />

    <!-- PDF Preview Modal -->
    <app-pdf-preview-modal [waLinked]="waLinked()" [defaultPhone]="customerContact()?.phone ?? null" (sendWhatsApp)="onSendPdfWhatsApp($event)" />

    <!-- Credit Application Modal -->
    @if (order()?.clientId) {
      <app-credit-application-modal
        [open]="showCreditApplicationModal()"
        [counterpartyId]="order()!.clientId"
        [counterpartyName]="clientName()"
        [orderId]="order()!.id"
        defaultType="CUSTOMER"
        (closed)="showCreditApplicationModal.set(false)"
        (submitted)="onCreditApplicationSubmitted()"
      />
    }
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
export class OrderDetailPageComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  protected readonly auth = inject(AuthService);
  private readonly riskService = inject(RiskMonitoringService);

  readonly emailModal = viewChild(SendEmailModalComponent);
  readonly pdfModal = viewChild(PdfPreviewModalComponent);
  readonly inquiryModal = viewChild(SendInquiryModalComponent);
  readonly financingSummaryContainer = viewChild<ElementRef<HTMLElement>>('financingSummaryContainer');

  // ─── Email compose state ─────────────────────────────────────────

  /** Which document type is currently being composed for email */
  readonly emailDocumentType = signal<DocumentEmailType>('INVOICE');
  /** Display name for the PDF attachment in the compose modal */
  readonly emailPdfFileName = signal('');

  // ─── Route param ─────────────────────────────────────────────────

  readonly orderId = toSignal(
    this.route.paramMap.pipe(map((p) => p.get('id') ?? '')),
    { initialValue: '' },
  );

  // ─── State ───────────────────────────────────────────────────────

  readonly order = signal<OrderDto | null>(null);
  readonly client = signal<CounterpartyDto | null>(null);
  readonly supplier = signal<CounterpartyDto | null>(null);
  readonly agent = signal<CounterpartyDto | null>(null);
  readonly vessel = signal<VesselDto | null>(null);
  readonly port = signal<PlaceDto | null>(null);
  readonly suppliers = signal<CounterpartyDto[]>([]);
  readonly agents = signal<CounterpartyDto[]>([]);
  readonly clients = signal<CounterpartyDto[]>([]);
  readonly vessels = signal<VesselDto[]>([]);
  readonly places = signal<PlaceDto[]>([]);
  readonly itemRows = signal<OrderItemRow[]>([]);
  readonly inquiryItems = computed(() =>
    this.itemRows().map((r) => ({ productType: r.productType, quantity: r.quantity, quantityMin: r.quantityMin, unit: r.costUnit ?? r.unit })),
  );
  readonly itemEconomics = signal<OrderItemsEconomics>({
    totalQuantity: 0,
    totalCost: 0,
    totalRevenue: 0,
    totalGrossProfit: 0,
    totalFinancingCost: 0,
    financingCostPerMt: null,
    totalNetProfit: 0,
    netMarginPct: null,
  });
  readonly itemDisplayCurrency = signal('USD');
  readonly saving = signal(false);
  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);
  readonly invoiceNumber = signal('');
  readonly ownCompanies = signal<OwnCompanyDto[]>([]);

  readonly selectedOwnCompany = computed(() => {
    const id = this.order()?.invoicingCompanyId;
    if (!id) return null;
    return this.ownCompanies().find((c) => c.id === id) ?? null;
  });
  readonly bankAccounts = signal<BankAccountDto[]>([]);
  readonly teamUsers = signal<TeamUserOption[]>([]);
  readonly clientSearchLoading = signal(false);
  readonly supplierSearchLoading = signal(false);
  readonly agentSearchLoading = signal(false);
  readonly vesselSearchLoading = signal(false);
  readonly placeSearchLoading = signal(false);
  readonly attachments = signal<OrderAttachmentDto[]>([]);
  readonly supplierNomination = signal<SupplierNominationSummaryDto | null>(null);
  readonly orderSuppliers = signal<OrderSupplierDto[]>([]);
  readonly activeOrderSupplierId = signal<string | null>(null);
  readonly uploadingAttachment = signal(false);
  readonly attachmentType = signal('OTHER');
  selectedAttachment: File | null = null;
  readonly payments = signal<CustomerPaymentDto[]>([]);
  readonly paymentsLoading = signal(false);
  readonly customerCreditLines = signal<CreditLineDto[]>([]);
  readonly customerCreditLoading = signal(false);
  readonly customerCreditFrozen = signal(false);
  readonly supplierCreditLines = signal<CreditLineDto[]>([]);
  readonly supplierCreditLoading = signal(false);
  readonly paymentModalOpen = signal(false);
  readonly paymentSaving = signal(false);
  readonly paymentAmount = signal('');
  readonly paymentCurrency = signal('USD');
  readonly paymentReceivedAt = signal('');
  readonly paymentMethod = signal('');
  readonly paymentNote = signal('');
  readonly noteTab = signal<'customer' | 'supplier'>('customer');
  readonly showCustomerPaymentNote = signal(false);
  readonly showSupplierPaymentNote = signal(false);
  readonly settingsOpen = signal(false);
  readonly settingsDropdownTop = signal(0);
  readonly settingsDropdownLeft = signal(0);
  readonly showConvertToOrderModal = signal(false);
  readonly showCancelInquiryModal = signal(false);
  readonly convertingToOrder = signal(false);
  readonly cancellingInquiry = signal(false);
  readonly inquiryCancelReasons = signal<string[]>([]);
  readonly selectedInquiryCancelReason = signal('');
  readonly cancelReasonOtherDetail = signal('');
  readonly availableInquiryCancelReasons = computed(() =>
    this.inquiryCancelReasons().map((reason) => reason.trim()).filter(Boolean),
  );
  readonly cancellationTargetLabel = computed(() => {
    const status = this.order()?.status;
    return status === OrderStatus.Inquiry || status === OrderStatus.Offer ? 'inquiry' : 'order';
  });
  readonly configuredProducts = signal<DropdownOption[]>([]);
  readonly configuredUnits = signal<DropdownOption[]>([]);
  readonly configuredUnitConversions = signal<{ productType?: string; fromUnit: string; toUnit: string; factor: number }[]>([]);
  readonly configuredCurrencies = signal<DropdownOption[]>([]);
  readonly configuredPriceReferences = signal<{ id: string; name: string; code: string }[]>([]);
  readonly configuredAttachmentTypes = signal<string[]>(['BDR', 'OTHER']);
  readonly plattsSuggestions = signal<PlattsSuggestionsResponseDto | null>(null);
  readonly plattsSuggestionsLoading = signal(false);
  readonly plattsSuggestionsError = signal<string | null>(null);
  readonly plattsSignalsMaxHeight = signal<number | null>(null);

  /** Whether the user has linked WhatsApp in Settings */
  readonly waLinked = signal(false);
  readonly inquirySupplierContextLoading = signal(false);
  readonly inquirySupplierContext = signal<InquirySupplierComparisonRow[]>([]);
  readonly inquiryRepliesLoading = signal(false);
  readonly inquiryRepliesSavingId = signal<string | null>(null);
  readonly inquiryReplies = signal<SupplierInquiryReplyRow[]>([]);
  readonly editingInquiryReplyId = signal<string | null>(null);
  readonly inquiryReplyStatuses = ['SENT', 'QUOTED', 'DECLINED', 'NO_REPLY'] as const;
  readonly inquiryReplyStatus = signal<'SENT' | 'QUOTED' | 'DECLINED' | 'NO_REPLY'>('SENT');
  readonly inquiryReplyRespondedAt = signal('');
  readonly inquiryReplyDeclineReason = signal('');
  readonly inquiryReplyPrices = signal<Record<string, string>>({});
  readonly inquiryReplyNotes = signal<Record<string, string>>({});
  readonly inquiryReplyQuoteValidUntil = signal('');
  readonly inquiryReplyDeliveryWindow = signal('');
  readonly inquiryReplySupplierPaymentTerms = signal('');
  readonly inquiryReplySupplierComment = signal('');

  // ─── Terms UI (collapsed by default) ─────────────────────────────

  readonly showPlaceRemarkFull = signal(false);
  readonly showPlaceRemarkPrompt = signal(false);
  readonly pendingPlaceRemark = signal<string | null>(null);
  readonly showCustomerTermsFull = signal(false);
  readonly showSupplierTermsFull = signal(false);

  readonly customerTermsText = computed(() =>
    this.renderCompanyTerms(this.selectedOwnCompany()?.customerTerms, 'customer') || '',
  );

  readonly supplierTermsText = computed(() =>
    this.renderCompanyTerms(this.selectedOwnCompany()?.supplierTerms, 'supplier') || '',
  );

  // ─── Contact persons ─────────────────────────────────────────────

  readonly customerContact = signal<CompanyContactDto | null>(null);
  readonly supplierContact = signal<CompanyContactDto | null>(null);
  readonly brokerContact = signal<CompanyContactDto | null>(null);
  readonly agentContact = signal<CompanyContactDto | null>(null);
  readonly customerContacts = signal<CompanyContactDto[]>([]);
  readonly supplierContacts = signal<CompanyContactDto[]>([]);
  readonly brokerContacts = signal<CompanyContactDto[]>([]);
  readonly agentContacts = signal<CompanyContactDto[]>([]);

  // ─── Broker search ──────────────────────────────────────────────

  readonly brokers = signal<CounterpartyDto[]>([]);
  readonly brokerSearchLoading = signal(false);

  // ─── Autosave ────────────────────────────────────────────────────

  readonly autoSaving = signal(false);
  readonly lastSaved = signal<Date | null>(null);
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private plattsSuggestionTimer: ReturnType<typeof setTimeout> | null = null;
  private financingSummaryResizeObserver: ResizeObserver | null = null;
  private changeVersion = signal(0);
  private readonly handleWindowResize = () => this.syncPlattsSignalsHeight();

  // ─── Computed ────────────────────────────────────────────────────

  readonly clientName = computed(() => this.client()?.name ?? '—');
  readonly activeOrderSupplier = computed(() => {
    const suppliers = this.orderSuppliers();
    const activeId = this.activeOrderSupplierId();
    return suppliers.find((supplier) => supplier.id === activeId)
      ?? suppliers.find((supplier) => supplier.isPrimary)
      ?? suppliers[0]
      ?? null;
  });
  readonly hasMultipleOrderSuppliers = computed(() => this.orderSuppliers().length > 1);
  readonly supplierName = computed(() => {
    return this.activeOrderSupplier()?.company?.name
      ?? this.supplier()?.name
      ?? '—';
  });
  readonly activeSupplierCompanyId = computed(() => this.activeOrderSupplier()?.companyId ?? this.order()?.supplierId ?? '');
  readonly activeSupplierContactId = computed(() => this.activeOrderSupplier()?.contactId ?? this.order()?.supplierContactId ?? '');
  readonly activeSupplierContactName = computed(() => this.activeOrderSupplier()?.contact?.name ?? this.supplierContact()?.name ?? '');
  readonly activeSupplierPaymentTermType = computed(() => this.activeOrderSupplier()?.paymentTermType ?? this.order()?.supplierPaymentTermType ?? null);
  readonly activeSupplierCreditDays = computed(() => this.activeOrderSupplier()?.creditDays ?? this.order()?.supplierCreditDays ?? null);
  readonly activeSupplierNote = computed(() => this.activeOrderSupplier()?.note ?? this.order()?.supplierNote ?? null);
  readonly activeSupplierDeliveredAt = computed(() => this.activeOrderSupplier()?.deliveredAt ?? this.order()?.deliveredAt ?? null);
  readonly nominationOrderSupplierId = computed(() => {
    const activeSupplier = this.activeOrderSupplier();
    return this.emailDocumentType() === 'NOMINATION' ? (activeSupplier ? activeSupplier.id : null) : null;
  });
  readonly emailModalDefaultPhone = computed(() => {
    if (this.emailDocumentType() === 'NOMINATION') {
      return this.activeOrderSupplier()?.contact?.phone
        ?? this.supplierContact()?.phone
        ?? null;
    }

    if (this.order()?.brokerGetsAll && this.brokerContact()?.phone) {
      return this.brokerContact()?.phone ?? null;
    }

    return this.customerContact()?.phone ?? null;
  });
  readonly orderSupplierTabs = computed(() => this.orderSuppliers().map((supplier, index) => ({
    id: supplier.id,
    label: supplier.company?.name ?? `Supplier ${index + 1}`,
    isPrimary: supplier.isPrimary,
  })));
  readonly brokerName = computed(() => {
    const id = this.order()?.brokerId;
    if (!id) return '—';
    return this.brokers().find((b) => b.id === id)?.name ?? '—';
  });
  readonly agentName = computed(() => {
    const id = this.order()?.agentId;
    if (!id) return '—';
    return this.agent()?.name ?? this.agents().find((a) => a.id === id)?.name ?? '—';
  });
  readonly vesselName = computed(() => this.vessel()?.name ?? '—');
  readonly portName = computed(() => this.port()?.name ?? '—');
  readonly subtitle = computed(() => '');
  readonly isInquiryContext = computed(() => {
    const status = this.order()?.status;
    return status === OrderStatus.Inquiry || status === OrderStatus.Offer;
  });
  readonly invoicingCompanyName = computed(() => {
    const id = this.order()?.invoicingCompanyId;
    if (!id) return '—';
    const co = this.ownCompanies().find((c) => c.id === id);
    return co?.name ?? '—';
  });

  readonly isReadonly = computed(() => {
    const status = this.order()?.status;
    return status === OrderStatus.Delivered
      || status === OrderStatus.Invoiced
      || status === OrderStatus.Paid
      || status === OrderStatus.Cancelled;
  });

  readonly allowDeliveredEdit = computed(() => {
    const status = this.order()?.status;
    return status === OrderStatus.Confirmed
      || status === OrderStatus.Delivered
      || status === OrderStatus.Invoiced;
  });

  readonly allowBankAccountEdit = computed(() => {
    const status = this.order()?.status;
    return status === OrderStatus.Delivered || status === OrderStatus.Invoiced;
  });

  readonly deliveredAtLocal = computed(() => {
    const iso = this.activeSupplierDeliveredAt();
    if (!iso) return '';
    return this.formatStoredDateOnlyForInput(iso);
  });

  readonly deliveredQtyComplete = computed(() =>
    this.itemRows().length > 0
    && this.itemRows().every((row) => this.getEffectiveDeliveredQuantity(row) !== null),
  );
  readonly supplierNominationDateMismatch = computed(() => {
    const internalDate = this.activeSupplierDeliveredAt()?.slice(0, 10) ?? null;
    const supplierDate = this.supplierNomination()?.deliveryCompletedAt?.slice(0, 10) ?? null;
    return !!internalDate && !!supplierDate && internalDate !== supplierDate;
  });

  readonly hasBdrAttachment = computed(() =>
    this.attachments().some((att) => (att.type ?? '').toUpperCase() === 'BDR'),
  );
  readonly invoiceEmailAttachmentOptions = computed<SendEmailAttachmentOption[]>(() =>
    this.attachments()
      .filter((att) => (att.type ?? '').toUpperCase() === 'BDR')
      .map((att) => ({
        id: att.id,
        fileName: att.fileName,
        label: `BDR uploaded ${new Date(att.createdAt).toLocaleDateString('en-GB')}`,
      })),
  );

  readonly isPaidOrCancelled = computed(() => {
    const status = this.order()?.status;
    return status === OrderStatus.Paid || status === OrderStatus.Cancelled;
  });

  readonly plattsSuggestionsMeta = computed(() => this.plattsSuggestions());
  readonly plattsSuggestionItems = computed<PlattsSuggestionViewModel[]>(() => this.plattsSuggestions()?.items ?? []);

  readonly canRecordPayment = computed(() => this.order()?.status !== OrderStatus.Cancelled);

  readonly canEditClient = computed(() => !this.isPaidOrCancelled());
  readonly hasInvoicingCompany = computed(() => !!this.order()?.invoicingCompanyId);
  readonly hasSupplier = computed(() => this.orderSuppliers().length > 0 || !!this.order()?.supplierId);
  readonly itemSupplierOptions = computed<DropdownOption[]>(() =>
    this.orderSuppliers().map((supplier, index) => ({
      value: supplier.id,
      label: supplier.company?.name ?? `Supplier ${index + 1}`,
    })),
  );
  readonly hasBankAccount = computed(() => !!this.order()?.bankAccountId);
  readonly hasEta = computed(() => !!this.order()?.eta);
  readonly hasLineItems = computed(() => this.itemRows().length > 0);

  readonly isResponsibleUser = computed(() => {
    const currentUserId = this.auth.user()?.id ?? '';
    return !!currentUserId && this.order()?.salesRepId === currentUserId;
  });

  readonly supplierDropdownOptions = computed<DropdownOption[]>(() => {
    const activeSupplierId = this.activeOrderSupplier()?.id ?? null;
    const selectedCompanyIds = new Set(
      this.orderSuppliers()
        .filter((supplier) => supplier.id !== activeSupplierId)
        .map((supplier) => supplier.companyId)
        .filter((companyId) => !!companyId),
    );

    return this.suppliers()
      .filter((supplier) => !selectedCompanyIds.has(supplier.id))
      .map((supplier) => ({ value: supplier.id, label: supplier.name }));
  });

  readonly clientDropdownOptions = computed<DropdownOption[]>(() =>
    this.clients().map((c) => ({ value: c.id, label: c.name })),
  );

  readonly vesselDropdownOptions = computed<DropdownOption[]>(() =>
    this.vessels().map((v) => ({ value: v.id, label: v.name })),
  );

  readonly placeDropdownOptions = computed<DropdownOption[]>(() =>
    this.places().map((p) => ({
      value: p.id,
      label: p.unlocode ? `${p.name} (${p.unlocode.replace(/\s+/g, '')})` : p.name,
    })),
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

  readonly brokerDropdownOptions = computed<DropdownOption[]>(() =>
    this.brokers().map((b) => ({ value: b.id, label: b.name })),
  );

  readonly agentDropdownOptions = computed<DropdownOption[]>(() =>
    this.agents().map((a) => ({ value: a.id, label: a.name })),
  );

  readonly brokerContactDropdownOptions = computed(() =>
    this.brokerContacts().map((c) => ({
      value: c.id,
      label: c.name + (c.role ? ` (${c.role})` : ''),
    })),
  );

  readonly agentContactDropdownOptions = computed(() =>
    this.agentContacts().map((c) => ({
      value: c.id,
      label: c.name + (c.role ? ` (${c.role})` : ''),
    })),
  );

  readonly placeTimezone = computed(() => this.port()?.timezone ?? 'UTC');
  readonly placeTimezoneAbbr = computed(() => {
    const tz = this.placeTimezone();
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        timeZoneName: 'short',
      }).formatToParts(new Date());
      return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz;
    } catch {
      return tz;
    }
  });
  readonly etaMinDateTime = computed(() => {
    const eta = this.order()?.eta;
    if (!eta) return '';
    return this.formatStoredDateOnlyForInput(eta);
  });

  readonly paymentsTotal = computed(() =>
    this.payments().reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0),
  );

  readonly totalDueForMarkPaid = computed(() =>
    this.itemRows().reduce((sum, item) => {
      const qty = Number(item.deliveredQuantity ?? item.quantity ?? 0);
      const unitPrice = Number(item.salesPrice ?? 0);
      return sum + qty * unitPrice;
    }, 0),
  );

  readonly hasEnoughPaymentsForMarkPaid = computed(() => {
    const due = this.totalDueForMarkPaid();
    if (due <= 0) return false;
    return this.paymentsTotal() >= due;
  });

  readonly customerCreditSummary = computed(() => {
    const currency = this.order()?.currency ?? 'USD';
    const lines = this.customerCreditLines().filter((line) => line.currency === currency);
    if (!lines.length) return null;
    const available = lines.reduce((sum, line) => sum + (parseFloat(line.availableAmount) || 0), 0);
    const maxDays = Math.max(...lines.map((line) => line.periodDays));
    return { currency, available, maxDays };
  });

  readonly canUseCustomerCredit = computed(() => !!this.customerCreditSummary() && !this.customerCreditFrozen());

  readonly supplierCreditSummary = computed(() => {
    const currency = this.order()?.currency ?? 'USD';
    const lines = this.supplierCreditLines().filter((line) => line.currency === currency);
    if (!lines.length) return null;
    const available = lines.reduce((sum, line) => sum + (parseFloat(line.availableAmount) || 0), 0);
    const maxDays = Math.max(...lines.map((line) => line.periodDays));
    return { currency, available, maxDays };
  });

  readonly canUseSupplierCredit = computed(() => !!this.supplierCreditSummary());

  readonly financingRateAnnual = computed(() => this.order()?.financingRateAnnual ?? 0.08);
  readonly financingDayCountConvention = computed(() => this.order()?.financingDayCountConvention ?? 365);
  readonly financingDays = computed(() => {
    const customerDays = this.order()?.customerPaymentTermType === 'CREDIT'
      ? Math.max(0, this.order()?.customerCreditDays ?? 0)
      : 0;
    const supplierDays = this.order()?.supplierPaymentTermType === 'CREDIT'
      ? Math.max(0, this.order()?.supplierCreditDays ?? 0)
      : 0;
    return Math.max(customerDays - supplierDays, 0);
  });

  readonly rankedInquirySuppliers = computed(() =>
    [...this.inquirySupplierContext()].sort((left, right) => this.compareInquirySupplierPerformance(left, right)).slice(0, 6),
  );

  readonly selectedSupplierComparison = computed(() => {
    const supplierId = this.order()?.supplierId ?? null;
    if (supplierId) {
      return this.inquirySupplierContext().find((row) => row.supplierId === supplierId) ?? null;
    }
    return this.rankedInquirySuppliers()[0] ?? null;
  });

  readonly sortedInquiryReplies = computed(() => {
    const selectedSupplierId = this.order()?.supplierId ?? null;
    return [...this.inquiryReplies()].sort((left, right) => {
      const selectedDiff = Number(right.supplierId === selectedSupplierId) - Number(left.supplierId === selectedSupplierId);
      if (selectedDiff !== 0) return selectedDiff;
      const rightSentAt = right.sentAt ? Date.parse(right.sentAt) : 0;
      const leftSentAt = left.sentAt ? Date.parse(left.sentAt) : 0;
      return rightSentAt - leftSentAt;
    });
  });

  readonly inquiryQuoteMatrixRows = computed<InquiryQuoteMatrixRow[]>(() => {
    const replies = this.sortedInquiryReplies();
    if (replies.length === 0) return [];

    const itemOrder = this.itemRows().map((item) => item.id);
    const replyItemMap = new Map<string, Map<string, SupplierInquiryReplyItem>>(
      replies.map((reply) => [
        reply.id,
        new Map(reply.items.map((item) => [item.orderItemId, item])),
      ]),
    );
    const fallbackItems = replies.flatMap((reply) => reply.items);
    const orderItemIds = itemOrder.length > 0
      ? itemOrder
      : Array.from(new Set(fallbackItems.map((item) => item.orderItemId)));
    const selectedSupplierId = this.order()?.supplierId ?? null;
    const defaultCurrency = this.order()?.currency ?? 'USD';

    return orderItemIds.map((orderItemId) => {
      const localItem = this.itemRows().find((item) => item.id === orderItemId);
      const fallbackItem = fallbackItems.find((item) => item.orderItemId === orderItemId) ?? null;

      return {
        orderItemId,
        productType: fallbackItem?.productType ?? localItem?.productType ?? '',
        quantity: fallbackItem?.quantity ?? String(localItem?.quantity ?? ''),
        quantityMin: localItem?.quantityMin != null ? String(localItem.quantityMin) : null,
        unit: fallbackItem?.unit ?? localItem?.unit ?? '',
        description: fallbackItem?.description ?? localItem?.description ?? null,
        cells: replies.map((reply) => {
          const replyItem = replyItemMap.get(reply.id)?.get(orderItemId) ?? null;
          return {
            supplierInquiryId: reply.id,
            supplierId: reply.supplierId,
            supplierName: reply.supplierName,
            status: reply.status,
            price: replyItem?.price ?? null,
            currency: replyItem?.currency ?? fallbackItem?.currency ?? defaultCurrency,
            note: replyItem?.note ?? null,
            responseHours: reply.responseHours,
            isSelectedSupplier: selectedSupplierId === reply.supplierId,
          };
        }),
      };
    });
  });

  readonly inquiryReplyRecommendations = computed(() => {
    const replies = this.sortedInquiryReplies();
    const recommendations = new Map<string, InquiryReplyRecommendation>();
    if (replies.length === 0) return recommendations;

    const totals = replies.map((reply) => ({
      id: reply.id,
      lineCount: reply.quoteLineCount,
      total: reply.items.reduce((sum, item) => sum + Number(item.price ?? 0), 0),
      responseHours: reply.responseHours,
    }));

    const maxLineCount = Math.max(...totals.map((entry) => entry.lineCount), 0);
    const minComparableTotal = Math.min(...totals.filter((entry) => entry.lineCount > 0).map((entry) => entry.total), Number.POSITIVE_INFINITY);
    const minResponseHours = Math.min(...totals.filter((entry) => entry.responseHours != null).map((entry) => entry.responseHours as number), Number.POSITIVE_INFINITY);

    const scored = totals.map((entry) => {
      const responseScore = entry.responseHours == null ? 0 : Math.max(0, 48 - Math.min(48, entry.responseHours));
      const totalScore = Number.isFinite(minComparableTotal) && entry.lineCount > 0
        ? Math.max(0, minComparableTotal === 0 ? 10 : (minComparableTotal / Math.max(entry.total, minComparableTotal)) * 10)
        : 0;
      return {
        ...entry,
        score: Number((entry.lineCount * 10 + responseScore + totalScore).toFixed(1)),
      };
    });

    const bestScore = Math.max(...scored.map((entry) => entry.score), 0);

    for (const entry of scored) {
      recommendations.set(entry.id, {
        bestOverall: entry.score === bestScore && bestScore > 0,
        lowestComparable: Number.isFinite(minComparableTotal) && entry.lineCount > 0 && entry.total === minComparableTotal,
        mostComplete: entry.lineCount > 0 && entry.lineCount === maxLineCount,
        fastest: Number.isFinite(minResponseHours) && entry.responseHours === minResponseHours,
        score: entry.score,
      });
    }

    return recommendations;
  });

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

  formatDateForInput(date: Date, timeZone: string): string {
    return this.formatDateTimeForInput(date, timeZone).split('T')[0] ?? '';
  }

  formatStoredDateOnlyLabel(iso: string | null): string {
    if (!iso) return '-';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date);
  }

  private formatStoredDateOnlyForInput(iso: string | null): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const year = String(date.getUTCFullYear()).padStart(4, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  constructor() {
    effect(() => {
      const version = this.changeVersion();
      if (version === 0) return;

      if (this.autoSaveTimer) {
        clearTimeout(this.autoSaveTimer);
      }

      this.autoSaveTimer = setTimeout(() => {
        this.performAutoSave();
      }, 1500);
    });

    effect(() => {
      const orderId = this.orderId();
      const activeSupplier = this.activeOrderSupplier();
      if (!orderId || !activeSupplier) return;
      void this.loadSupplierCreditLines(activeSupplier.companyId);
      void this.loadCompanyContacts('supplier', activeSupplier.companyId);
      void this.loadSupplierNominationSummary();
    });
  }

  ngOnInit(): void {
    this.loadOrder();
    this.checkWhatsAppLinked();
  }

  ngAfterViewInit(): void {
    const container = this.financingSummaryContainer()?.nativeElement;
    if (!container) return;

    this.financingSummaryResizeObserver = new ResizeObserver(() => {
      this.syncPlattsSignalsHeight();
    });
    this.financingSummaryResizeObserver.observe(container);
    window.addEventListener('resize', this.handleWindowResize);
    this.syncPlattsSignalsHeight();
  }

  ngOnDestroy(): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }
    if (this.plattsSuggestionTimer) {
      clearTimeout(this.plattsSuggestionTimer);
    }
    this.financingSummaryResizeObserver?.disconnect();
    this.financingSummaryResizeObserver = null;
    window.removeEventListener('resize', this.handleWindowResize);
  }

  private syncPlattsSignalsHeight(): void {
    const container = this.financingSummaryContainer()?.nativeElement;
    if (!container) return;

    if (!window.matchMedia('(min-width: 1024px)').matches) {
      this.plattsSignalsMaxHeight.set(null);
      return;
    }

    this.plattsSignalsMaxHeight.set(Math.ceil(container.getBoundingClientRect().height));
  }

  private detailBaseRouteForStatus(status: string):
    '/trading/orders'
    | '/trading/inquiries'
    | '/trading/completed-orders'
    | '/trading/cancelled-orders' {
    if (status === OrderStatus.Inquiry || status === OrderStatus.Offer) {
      return '/trading/inquiries';
    }
    if (status === OrderStatus.Paid) {
      return '/trading/completed-orders';
    }
    if (status === OrderStatus.Cancelled) {
      return '/trading/cancelled-orders';
    }
    return '/trading/orders';
  }

  private async normalizeDetailRoute(status: string, routeId: string): Promise<void> {
    const currentPath = this.router.url.split('?')[0]?.split('#')[0] ?? '';
    const expectedBase = this.detailBaseRouteForStatus(status);
    const isOnOrdersPath = currentPath.startsWith('/trading/orders/');
    const isOnInquiriesPath = currentPath.startsWith('/trading/inquiries/');
    const isOnCompletedPath = currentPath.startsWith('/trading/completed-orders/');
    const isOnCancelledPath = currentPath.startsWith('/trading/cancelled-orders/');

    const isAlreadyOnExpectedPath =
      (expectedBase === '/trading/orders' && isOnOrdersPath)
      || (expectedBase === '/trading/inquiries' && isOnInquiriesPath)
      || (expectedBase === '/trading/completed-orders' && isOnCompletedPath)
      || (expectedBase === '/trading/cancelled-orders' && isOnCancelledPath);

    if (!isAlreadyOnExpectedPath) {
      await this.router.navigate([expectedBase, routeId], {
        replaceUrl: true,
        queryParamsHandling: 'preserve',
      });
    }
  }

  private async loadOrder(): Promise<void> {
    const id = this.orderId();
    if (!id) return;

    try {
      const [orderRes, ownRes] = await Promise.all([
        firstValueFrom(this.http.get<ApiResponse<any>>(`${API_URL}/orders/${id}`)),
        firstValueFrom(this.http.get<ApiResponse<OwnCompanyDto[]>>(`${API_URL}/companies/own`)),
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
          brokerId: d.brokerId ?? null,
          brokerContactId: d.brokerContactId ?? null,
          brokerGetsAll: d.brokerGetsAll ?? false,
          agentId: d.agentId ?? null,
          agentContactId: d.agentContactId ?? null,
          termsAndConditions: d.termsAndConditions ?? null,
          lossReason: d.lossReason,
          financingRateAnnual: d.financingRateAnnual ?? 0.08,
          financingDayCountConvention: d.financingDayCountConvention ?? 365,
          financingDays: d.financingDays ?? 0,
          totalFinancingCost: d.totalFinancingCost ?? '0.0000',
          financingCostPerMt: d.financingCostPerMt ?? null,
          totalNetProfit: d.totalNetProfit ?? '0.0000',
          netMarginPct: d.netMarginPct ?? null,
          closedAt: d.closedAt,
          deliveredAt: d.deliveredAt ?? null,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        });

        await this.normalizeDetailRoute(d.status, id);

        if (d.customerContact) this.customerContact.set(d.customerContact);
        if (d.supplierContact) this.supplierContact.set(d.supplierContact);
        if (d.brokerContact) this.brokerContact.set(d.brokerContact);
        if (d.agentContact) this.agentContact.set(d.agentContact);
        if (d.broker) this.brokers.set([d.broker]);
        this.agent.set(d.agent ?? null);
        if (d.agent) this.agents.set([d.agent]);

        if (d.client) this.client.set(d.client);
        if (d.client) this.clients.set([d.client]);
        this.supplier.set(d.supplier ?? null);
        if (d.supplier) this.suppliers.set([d.supplier]);
        this.orderSuppliers.set(d.orderSuppliers ?? []);
        this.activeOrderSupplierId.set(
          d.orderSuppliers?.find((supplier: OrderSupplierDto) => supplier.isPrimary)?.id
            ?? d.orderSuppliers?.[0]?.id
            ?? null,
        );
        if (d.vessel) {
          this.vessel.set(d.vessel);
          this.vessels.set([d.vessel]);
        }
        if (d.place) {
          this.port.set(d.place);
          this.places.set([d.place]);
        }

        this.itemRows.set(
          (d.items ?? []).map((item: any) => ({
            id: item.id,
            orderSupplierId: item.orderSupplierId ?? null,
            productType: item.productType ?? '',
            description: item.description ?? '',
            quantity: parseFloat(item.quantity) || 0,
            quantityMin: item.quantityMin ? parseFloat(item.quantityMin) : null,
            quantityMax: item.quantityMax ? parseFloat(item.quantityMax) : null,
            unit: item.unit ?? 'MT',
            costUnit: item.costUnit ?? item.unit ?? 'MT',
            salesUnit: item.salesUnit ?? item.unit ?? 'MT',
            costConversionFactor: parseFloat(item.costConversionFactor) || 1,
            unitConversionFactor: parseFloat(item.unitConversionFactor) || 1,
            costPrice: parseFloat(item.costPrice) || 0,
            costCurrency: item.costCurrency ?? d.currency ?? 'USD',
            salesPrice: parseFloat(item.salesPrice) || 0,
            salesCurrency: item.salesCurrency ?? d.currency ?? 'USD',
            profit: parseFloat(item.profit) || 0,
            paymentTerms: item.paymentTerms ?? '',
            customerNote: item.customerNote ?? '',
            deliveredQuantity: item.deliveredQuantity != null ? parseFloat(item.deliveredQuantity) : null,
            // Formula pricing
            costPricingModel: item.costPricingModel ?? PricingModel.Fixed,
            costReferenceId: item.costReferenceId ?? null,
            costPlattsEntryId: item.costPlattsEntryId ?? null,
            costReferenceName: item.costReferenceName ?? null,
            costPremium: item.costPremium != null ? parseFloat(item.costPremium) : null,
            costBarging: item.costBarging != null ? parseFloat(item.costBarging) : null,
            costBargingUnit: item.costBargingUnit ?? null,
            costCreditDays: item.costCreditDays ?? null,
            costPriceFinalized: item.costPriceFinalized ?? false,
            salesPricingModel: item.salesPricingModel ?? PricingModel.Fixed,
            salesReferenceId: item.salesReferenceId ?? null,
            salesPlattsEntryId: item.salesPlattsEntryId ?? null,
            salesReferenceName: item.salesReferenceName ?? null,
            salesPremium: item.salesPremium != null ? parseFloat(item.salesPremium) : null,
            salesBarging: item.salesBarging != null ? parseFloat(item.salesBarging) : null,
            salesBargingUnit: item.salesBargingUnit ?? null,
            salesCreditDays: item.salesCreditDays ?? null,
            salesPriceFinalized: item.salesPriceFinalized ?? false,
          })),
        );

        await this.loadCustomerCreditLines(d.clientId);
        await this.loadSupplierCreditLines(this.activeOrderSupplier()?.companyId ?? d.supplierId);
        await this.loadReferenceData();
        await this.loadPlattsSuggestions();
        await this.loadCompanyContacts('customer', d.clientId);
        if (this.activeOrderSupplier()?.companyId ?? d.supplierId) {
          await this.loadCompanyContacts('supplier', this.activeOrderSupplier()?.companyId ?? d.supplierId);
        }
        if (d.brokerId) await this.loadCompanyContacts('broker', d.brokerId);
        if (d.agentId) await this.loadCompanyContacts('agent', d.agentId);
        await Promise.all([
          this.loadInquirySupplierContext(),
          this.loadInquiryReplies(),
        ]);
      }

      let invoicingId = this.order()?.invoicingCompanyId ?? null;
      if (ownRes.success) {
        this.ownCompanies.set(ownRes.data);
        invoicingId = this.applyPreferredInvoicingCompanySelection(ownRes.data);
      }

      if (invoicingId) {
        await this.loadBankAccounts(invoicingId, { autoSelect: true });
      } else {
        this.bankAccounts.set([]);
      }

      if (this.order()?.customerNote) this.showCustomerPaymentNote.set(true);
      if (this.order()?.supplierNote) this.showSupplierPaymentNote.set(true);

      await this.loadAttachments();
      await this.loadPayments();
      await this.loadSupplierNominationSummary();
    } catch {
      this.showToast('error', 'Failed to load order.');
    }
  }

  private async loadAttachments(): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<OrderAttachmentDto[]>>(`${API_URL}/orders/${id}/attachments`),
      );
      if (res.success) this.attachments.set(res.data ?? []);
    } catch {
      this.attachments.set([]);
    }
  }

  private async loadSupplierNominationSummary(): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    const activeSupplierId = this.hasMultipleOrderSuppliers() ? this.activeOrderSupplier()?.id : null;
    const query = activeSupplierId ? `?orderSupplierId=${encodeURIComponent(activeSupplierId)}` : '';
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<SupplierNominationSummaryDto | null>>(`${API_URL}/orders/${id}/nomination-response${query}`),
      );
      this.supplierNomination.set(res.success ? (res.data ?? null) : null);
    } catch {
      this.supplierNomination.set(null);
    }
  }

  private async loadInquirySupplierContext(): Promise<void> {
    const id = this.orderId();
    if (!id || !this.isInquiryContext()) {
      this.inquirySupplierContext.set([]);
      return;
    }

    this.inquirySupplierContextLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<InquirySupplierComparisonRow[]>>(`${API_URL}/orders/${id}/inquiry/suppliers`),
      );
      if (res.success) {
        this.inquirySupplierContext.set(res.data ?? []);
      } else {
        this.inquirySupplierContext.set([]);
      }
    } catch {
      this.inquirySupplierContext.set([]);
    } finally {
      this.inquirySupplierContextLoading.set(false);
    }
  }

  private async loadInquiryReplies(): Promise<void> {
    const id = this.orderId();
    if (!id || !this.isInquiryContext()) {
      this.inquiryReplies.set([]);
      return;
    }

    this.inquiryRepliesLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<SupplierInquiryReplyRow[]>>(`${API_URL}/orders/${id}/inquiry/sent`),
      );
      if (res.success) {
        this.inquiryReplies.set(res.data ?? []);
      } else {
        this.inquiryReplies.set([]);
      }
    } catch {
      this.inquiryReplies.set([]);
    } finally {
      this.inquiryRepliesLoading.set(false);
    }
  }

  private async loadPayments(): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    this.paymentsLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CustomerPaymentDto[]>>(`${API_URL}/orders/${id}/payments`),
      );
      if (res.success) this.payments.set(res.data ?? []);
    } catch {
      this.payments.set([]);
    } finally {
      this.paymentsLoading.set(false);
    }
  }

  private async loadCustomerCreditLines(counterpartyId: string | null | undefined): Promise<void> {
    if (!counterpartyId) return;
    this.customerCreditLoading.set(true);
    this.customerCreditFrozen.set(false);
    try {
      const [res, frozenRes] = await Promise.all([
        firstValueFrom(
          this.http.get<ApiResponse<{ items: CreditLineDto[]; total: number }>>(
            `${API_URL}/credit/lines?type=CUSTOMER&counterpartyId=${encodeURIComponent(counterpartyId)}&limit=50`,
          ),
        ),
        this.riskService.isFrozen(counterpartyId).catch(() => false),
      ]);
      if (res.success) {
        this.customerCreditLines.set(res.data.items ?? []);
      } else {
        this.customerCreditLines.set([]);
      }
      this.customerCreditFrozen.set(frozenRes);
    } catch {
      this.customerCreditLines.set([]);
    } finally {
      this.customerCreditLoading.set(false);
    }
  }

  private async loadSupplierCreditLines(counterpartyId: string | null | undefined): Promise<void> {
    if (!counterpartyId) {
      this.supplierCreditLines.set([]);
      return;
    }
    this.supplierCreditLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ items: CreditLineDto[]; total: number }>>(
          `${API_URL}/credit/lines?type=SUPPLIER&counterpartyId=${encodeURIComponent(counterpartyId)}&limit=50`,
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

  async openAttachment(att: OrderAttachmentDto): Promise<void> {
    const modal = this.pdfModal();
    if (!modal) return;
    modal.showLoading(att.fileName || 'Attachment');
    try {
      const url = att.filePath.startsWith('http')
        ? att.filePath
        : `${API_URL}${att.filePath}`;
      const blob = await firstValueFrom(
        this.http.get(url, { responseType: 'blob' }),
      );
      modal.setBlob(blob, att.fileName || 'attachment');
    } catch {
      modal.showError();
      this.showToast('error', 'Failed to load attachment.');
    }
  }

  openPaymentModal(): void {
    const currency = this.order()?.currency ?? 'USD';
    this.paymentAmount.set('');
    this.paymentCurrency.set(currency);
    this.paymentReceivedAt.set(this.formatDateForInput(new Date(), this.placeTimezone()));
    this.paymentMethod.set('');
    this.paymentNote.set('');
    this.paymentModalOpen.set(true);
  }

  closePaymentModal(): void {
    this.paymentModalOpen.set(false);
  }

  async submitPayment(): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    const amountValue = this.paymentAmount();
    const amount = (typeof amountValue === 'string' ? amountValue : String(amountValue ?? '')).trim();
    if (!amount) {
      this.showToast('error', 'Amount is required.');
      return;
    }

    this.paymentSaving.set(true);
    try {
      const receivedDate = this.paymentReceivedAt();
      const receivedIso = receivedDate ? new Date(`${receivedDate}T12:00:00`).toISOString() : undefined;
      const currency = this.paymentCurrency().trim() || (this.order()?.currency ?? 'USD');
      const res = await firstValueFrom(
        this.http.post<ApiResponse<CustomerPaymentDto>>(`${API_URL}/orders/${id}/payments`, {
          amount,
          currency,
          receivedAt: receivedIso,
          method: this.paymentMethod() || null,
          note: this.paymentNote() || null,
        }),
      );
      if (res.success) {
        await this.loadPayments();
        this.closePaymentModal();
        await this.setOrderStatus(OrderStatus.Paid);
        this.showToast('success', 'Payment recorded. Order marked as paid.');
      } else {
        this.showToast('error', res.message ?? 'Failed to record payment.');
      }
    } catch {
      this.showToast('error', 'Failed to record payment.');
    } finally {
      this.paymentSaving.set(false);
    }
  }

  private async loadReferenceData(): Promise<void> {
    try {
      const [suppliersRes, usersRes, productsRes, unitsRes, unitConversionsRes, currenciesRes, attachmentTypesRes, cancelReasonsRes, priceRefsRes] = await Promise.all([
        firstValueFrom(
          this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
            `${API_URL}/companies/local?type=SUPPLIER&limit=100`,
          ),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<TeamUserOption[]>>(`${API_URL}/lloyds/users`),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<{ products: string[] }>>(`${API_URL}/admin/settings/my-products`),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<{ units: string[] }>>(`${API_URL}/admin/settings/my-units`),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<{ conversions: { fromUnit: string; toUnit: string; factor: number }[] }>>(`${API_URL}/admin/settings/my-unit-conversions`),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<{ currencies: string[] }>>(`${API_URL}/admin/settings/my-currencies`),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<{ attachmentTypes: string[] }>>(`${API_URL}/admin/settings/my-attachment-types`),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<{ reasons: string[] }>>(`${API_URL}/admin/settings/my-inquiry-cancel-reasons`),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<{ references: { id: string; name: string; code: string }[] }>>(`${API_URL}/admin/settings/my-price-references`),
        ),
      ]);
      if (suppliersRes.success) {
        const currentSupplierId = this.order()?.supplierId ?? '';
        const currentSupplier = currentSupplierId
          ? this.supplier() ?? this.suppliers().find((supplier) => supplier.id === currentSupplierId) ?? null
          : null;
        const mergedSuppliers = currentSupplier && !suppliersRes.data.companies.find((supplier) => supplier.id === currentSupplierId)
          ? [currentSupplier, ...suppliersRes.data.companies]
          : suppliersRes.data.companies;
        this.suppliers.set(mergedSuppliers);
      }
      if (usersRes.success) this.teamUsers.set(usersRes.data ?? []);
      if (productsRes.success) this.configuredProducts.set(
        productsRes.data.products.map((p) => ({ value: p, label: p })),
      );
      if (unitsRes.success) this.configuredUnits.set(
        unitsRes.data.units.map((u) => ({ value: u, label: u })),
      );
      if (unitConversionsRes.success) this.configuredUnitConversions.set(unitConversionsRes.data.conversions);
      if (currenciesRes.success) this.configuredCurrencies.set(
        currenciesRes.data.currencies.map((c) => ({ value: c, label: c })),
      );
      if (attachmentTypesRes.success && attachmentTypesRes.data.attachmentTypes.length) {
        this.configuredAttachmentTypes.set(attachmentTypesRes.data.attachmentTypes);
        if (!attachmentTypesRes.data.attachmentTypes.includes(this.attachmentType())) {
          this.attachmentType.set(attachmentTypesRes.data.attachmentTypes[0]!);
        }
      }
      if (cancelReasonsRes.success) {
        this.inquiryCancelReasons.set(cancelReasonsRes.data.reasons ?? []);
      }
      if (priceRefsRes.success) {
        this.configuredPriceReferences.set(priceRefsRes.data.references ?? []);
      }
    } catch {
      // silently ignore
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

  formatSupplierPaymentTerms(): string {
    const type = this.activeSupplierPaymentTermType();
    if (!type) return '-';
    if (type === 'CREDIT') {
      const days = this.activeSupplierCreditDays() ?? 0;
      return `Credit ${days} days`;
    }
    if (type === 'COD') return 'Cash on Delivery';
    if (type === 'PREPAY') return 'Cash in advance';
    return type;
  }

  onCustomerPaymentTermChange(value: PaymentTermType | ''): void {
    if (value === 'CREDIT' && this.customerCreditFrozen()) {
      this.showToast('error', 'Customer credit is frozen due to risk monitoring.');
      return;
    }
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

  renderCompanyTerms(template: string | null | undefined, context: 'customer' | 'supplier'): string {
    const raw = (template ?? '').trim();
    if (!raw) return '';

    const documentName = this.isInquiryContext() ? 'Offer' : 'Confirmation';
    const replacements: Record<string, string> = {
      companyName: (this.selectedOwnCompany()?.name ?? '').trim(),
      documentName,
      offerOrConfirmation: documentName,
      paymentTerms: this.normalizeTermsReplacement(
        context === 'customer' ? this.formatCustomerPaymentTerms() : this.formatSupplierPaymentTerms(),
      ),
      customerNote: this.normalizeTermsReplacement(this.order()?.customerNote ?? ''),
      supplierNote: this.normalizeTermsReplacement(this.order()?.supplierNote ?? ''),
      invoiceNumber: this.normalizeTermsReplacement(this.invoiceNumber()),
      orderNumber: this.normalizeTermsReplacement(this.order()?.orderNumber ?? ''),
      vesselName: this.normalizeTermsReplacement(this.vessel()?.name ?? ''),
      portName: this.normalizeTermsReplacement(this.port()?.name ?? ''),
    };

    let rendered = raw;
    for (const [key, value] of Object.entries(replacements)) {
      rendered = rendered.replace(new RegExp(`\\$\\{${key}\\}|\\{\\{${key}\\}\\}`, 'g'), value);
    }

    return rendered;
  }

  private normalizeTermsReplacement(value: string | null | undefined): string {
    const trimmed = String(value ?? '').trim();
    return trimmed === '-' ? '' : trimmed;
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
    if (this.orderSuppliers().length === 0) {
      this.order.update((order) => order
        ? {
            ...order,
            supplierPaymentTermType: value || null,
            supplierCreditDays: value === 'CREDIT' ? order.supplierCreditDays ?? null : null,
          }
        : order);
      this.triggerAutosave();
      return;
    }
    this.updateActiveOrderSupplier((supplier) => ({
      ...supplier,
      paymentTermType: value || null,
      creditDays: value === 'CREDIT' ? supplier.creditDays ?? null : null,
    }));
    this.triggerAutosave();
  }

  onSupplierCreditDaysChange(value: number | string): void {
    const days = typeof value === 'string' ? Number(value) : value;
    const maxDays = this.supplierCreditSummary()?.maxDays ?? null;
    const nextDays = Number.isFinite(days) ? days : null;
    if (this.orderSuppliers().length === 0) {
      if (maxDays !== null && nextDays !== null && nextDays > maxDays) {
        this.order.update((order) => order ? { ...order, supplierCreditDays: maxDays } : order);
        this.showToast('error', `Max credit is ${maxDays} days.`);
      } else {
        this.order.update((order) => order ? { ...order, supplierCreditDays: nextDays } : order);
      }
      this.triggerAutosave();
      return;
    }
    if (maxDays !== null && nextDays !== null && nextDays > maxDays) {
      this.updateActiveOrderSupplier((supplier) => ({ ...supplier, creditDays: maxDays }));
      this.showToast('error', `Max credit is ${maxDays} days.`);
    } else {
      this.updateActiveOrderSupplier((supplier) => ({ ...supplier, creditDays: nextDays }));
    }
    this.triggerAutosave();
  }

  onSupplierNoteChange(value: string): void {
    if (this.orderSuppliers().length === 0) {
      this.order.update((order) => order ? { ...order, supplierNote: value } : order);
      this.triggerAutosave();
      return;
    }
    this.updateActiveOrderSupplier((supplier) => ({ ...supplier, note: value }));
    this.triggerAutosave();
  }

  onCustomerNoteChange(value: string): void {
    this.order.update((o) => (o ? { ...o, customerNote: value } : o));
    this.triggerAutosave();
  }

  onResponsibleUserChange(userId: string): void {
    this.order.update((o) => (o ? { ...o, salesRepId: userId || null } : o));
    this.triggerAutosave();
  }

  // ─── Contact person handlers ─────────────────────────────────────

  async loadCompanyContacts(side: 'customer' | 'supplier' | 'broker' | 'agent', companyId: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CompanyContactDto[]>>(`${API_URL}/companies/local/${companyId}/contacts`),
      );
      if (res.success) {
        if (side === 'customer') this.customerContacts.set(res.data ?? []);
        else if (side === 'supplier') this.supplierContacts.set(res.data ?? []);
        else if (side === 'broker') this.brokerContacts.set(res.data ?? []);
        else this.agentContacts.set(res.data ?? []);
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

  onActiveSupplierContactChange(contactId: string): void {
    if (this.orderSuppliers().length === 0) {
      this.order.update((order) => order ? { ...order, supplierContactId: contactId || null } : order);
      const contact = this.supplierContacts().find((c) => c.id === contactId) ?? null;
      this.supplierContact.set(contact);
      this.triggerAutosave();
      return;
    }
    this.updateActiveOrderSupplier((supplier) => ({ ...supplier, contactId: contactId || null }));
    const contact = this.supplierContacts().find((c) => c.id === contactId) ?? null;
    this.supplierContact.set(contact);
    this.triggerAutosave();
  }

  onAgentContactChange(contactId: string): void {
    this.order.update((o) => (o ? { ...o, agentContactId: contactId || null } : o));
    const contact = this.agentContacts().find((c) => c.id === contactId) ?? null;
    this.agentContact.set(contact);
    this.triggerAutosave();
  }

  // ─── Broker handlers ─────────────────────────────────────────────

  async searchBrokers(term: string): Promise<void> {
    this.brokerSearchLoading.set(true);
    try {
      let res = await firstValueFrom(
        this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
          `${API_URL}/companies/local?type=BROKER&search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      let localResults = res.success ? res.data.companies : [];
      if (localResults.length === 0 && term.trim()) {
        res = await firstValueFrom(
          this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
            `${API_URL}/companies/local?search=${encodeURIComponent(term)}&limit=20`,
          ),
        );
        localResults = res.success ? res.data.companies : [];
      }
      const currentId = this.order()?.brokerId ?? '';
      const mergedLocal = currentId && !localResults.find((c) => c.id === currentId)
        ? [this.brokers().find((b) => b.id === currentId) ?? null, ...localResults].filter(Boolean)
        : localResults;
      this.brokers.set(mergedLocal as CounterpartyDto[]);
    } catch {
      // silently ignore
    } finally {
      this.brokerSearchLoading.set(false);
    }
  }

  onBrokerChange(brokerId: string): void {
    if (!brokerId) {
      // Clearing broker — also clear contact and toggle
      this.order.update((o) => (o ? { ...o, brokerId: null, brokerContactId: null, brokerGetsAll: false } : o));
      this.brokerContact.set(null);
      this.brokerContacts.set([]);
      this.triggerAutosave();
      return;
    }
    this.order.update((o) => (o ? { ...o, brokerId, brokerContactId: null } : o));
    this.brokerContact.set(null);
    void this.loadCompanyContacts('broker', brokerId);
    this.triggerAutosave();
  }

  onBrokerContactChange(contactId: string): void {
    this.order.update((o) => (o ? { ...o, brokerContactId: contactId || null } : o));
    const contact = this.brokerContacts().find((c) => c.id === contactId) ?? null;
    this.brokerContact.set(contact);
    this.triggerAutosave();
  }

  onBrokerGetsAllChange(value: boolean): void {
    this.order.update((o) => (o ? { ...o, brokerGetsAll: value } : o));
    this.triggerAutosave();
  }

  async searchAgents(term: string): Promise<void> {
    this.agentSearchLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
          `${API_URL}/companies/local?search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      const localResults = res.success ? res.data.companies : [];
      const currentId = this.order()?.agentId ?? '';
      const currentAgent = currentId
        ? this.agent() ?? this.agents().find((company) => company.id === currentId) ?? null
        : null;
      const mergedLocal = currentId && !localResults.find((company) => company.id === currentId)
        ? [currentAgent, ...localResults].filter(Boolean)
        : localResults;
      this.agents.set(mergedLocal as CounterpartyDto[]);
    } catch {
      // silently ignore
    } finally {
      this.agentSearchLoading.set(false);
    }
  }

  onAgentChange(agentId: string): void {
    if (!agentId) {
      this.order.update((o) => (o ? { ...o, agentId: null, agentContactId: null } : o));
      this.agent.set(null);
      this.agentContact.set(null);
      this.agentContacts.set([]);
      this.triggerAutosave();
      return;
    }

    this.order.update((o) => (o ? { ...o, agentId, agentContactId: null } : o));
    const agentData = this.agents().find((company) => company.id === agentId)
      ?? (this.agent()?.id === agentId ? this.agent() : null);
    this.agent.set(agentData ?? null);
    this.agentContact.set(null);
    void this.loadCompanyContacts('agent', agentId);
    this.triggerAutosave();
  }

  onTermsChange(value: string): void {
    this.order.update((o) => (o ? { ...o, termsAndConditions: value || null } : o));
    this.triggerAutosave();
  }

  onAttachmentSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedAttachment = input.files?.[0] ?? null;
  }

  async uploadAttachment(): Promise<void> {
    const id = this.orderId();
    if (!id || !this.selectedAttachment) return;
    this.uploadingAttachment.set(true);
    try {
      const form = new FormData();
      form.append('file', this.selectedAttachment);
      form.append('type', this.attachmentType());
      const res = await firstValueFrom(
        this.http.post<ApiResponse<OrderAttachmentDto>>(`${API_URL}/orders/${id}/attachments`, form),
      );
      if (res.success && res.data) {
        this.attachments.update((prev) => [res.data, ...prev]);
        this.selectedAttachment = null;
      }
    } catch {
      this.showToast('error', 'Failed to upload attachment.');
    } finally {
      this.uploadingAttachment.set(false);
    }
  }

  private async setOrderStatus(status: OrderStatus): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}/status`, { status }),
      );
      if (res.success) {
        this.order.update((o) => (o ? { ...o, status } : o));
      }
    } catch {
      this.showToast('error', 'Failed to update order status.');
    }
  }

  formatFileSize(size: number): string {
    if (!size) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const idx = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
    const value = size / Math.pow(1024, idx);
    return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
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

  private parseDecimalValue(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value !== 'string') return null;

    const normalized = value.trim().replace(/\s+/g, '').replace(',', '.');
    if (!normalized) return null;

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private getEffectiveDeliveredQuantity(row: OrderItemRow): number | null {
    const deliveredQuantity = this.parseDecimalValue(row.deliveredQuantity);
    if (deliveredQuantity !== null) return deliveredQuantity;
    return this.parseDecimalValue(row.quantity);
  }

  private buildItemPayload(rows: OrderItemRow[], options?: { fillMissingDeliveredQuantity?: boolean }) {
    const fillMissingDeliveredQuantity = options?.fillMissingDeliveredQuantity ?? false;

    return rows.map((r) => {
      const deliveredQuantity = fillMissingDeliveredQuantity
        ? this.getEffectiveDeliveredQuantity(r)
        : this.parseDecimalValue(r.deliveredQuantity);

      return {
        orderSupplierId: r.orderSupplierId ?? null,
        productType: r.productType,
        quantity: String(r.quantity),
        quantityMin: r.quantityMin != null ? String(r.quantityMin) : null,
        quantityMax: String(r.quantity),
        unit: r.unit,
        costUnit: r.costUnit,
        salesUnit: r.salesUnit,
        costConversionFactor: r.costConversionFactor != null ? String(r.costConversionFactor) : '1',
        unitConversionFactor: r.unitConversionFactor != null ? String(r.unitConversionFactor) : '1',
        description: r.description || null,
        costPrice: r.costPrice ? String(r.costPrice) : null,
        costCurrency: r.costCurrency,
        salesPrice: r.salesPrice ? String(r.salesPrice) : null,
        salesCurrency: r.salesCurrency,
        paymentTerms: r.paymentTerms || null,
        customerNote: r.customerNote ?? null,
        deliveredQuantity: deliveredQuantity != null ? String(deliveredQuantity) : null,
        costPricingModel: r.costPricingModel ?? 'FIXED',
        costReferenceId: r.costReferenceId ?? null,
        costPlattsEntryId: r.costPlattsEntryId ?? null,
        costPremium: r.costPremium != null ? String(r.costPremium) : null,
        costBarging: r.costBarging != null ? String(r.costBarging) : null,
        costBargingUnit: r.costBargingUnit ?? null,
        costCreditDays: r.costCreditDays ?? null,
        salesPricingModel: r.salesPricingModel ?? 'FIXED',
        salesReferenceId: r.salesReferenceId ?? null,
        salesPlattsEntryId: r.salesPlattsEntryId ?? null,
        salesPremium: r.salesPremium != null ? String(r.salesPremium) : null,
        salesBarging: r.salesBarging != null ? String(r.salesBarging) : null,
        salesBargingUnit: r.salesBargingUnit ?? null,
        salesCreditDays: r.salesCreditDays ?? null,
      };
    });
  }

  private async syncOrderSupplierRecords(orderId: string): Promise<void> {
    const suppliers = this.orderSuppliers();
    if (suppliers.length === 0) {
      const order = this.order();
      if (order?.supplierId) {
        await this.reloadOrderSuppliers(orderId);
      }
      return;
    }

    const preferredCompanyId = this.activeOrderSupplier()?.companyId ?? null;
    for (const supplier of suppliers) {
      if (!supplier.companyId) continue;

      const endpoint = this.isTemporaryOrderSupplierId(supplier.id)
        ? `${API_URL}/orders/${orderId}/suppliers`
        : `${API_URL}/orders/${orderId}/suppliers/${supplier.id}`;
      const request$ = this.isTemporaryOrderSupplierId(supplier.id)
        ? this.http.post<ApiResponse<OrderSupplierDto>>(endpoint, {
            companyId: supplier.companyId,
            contactId: supplier.contactId ?? null,
            paymentTermType: supplier.paymentTermType ?? null,
            creditDays: supplier.creditDays ?? null,
            note: supplier.note ?? null,
            deliveredAt: supplier.deliveredAt ?? null,
            isPrimary: supplier.isPrimary,
          })
        : this.http.put<ApiResponse<OrderSupplierDto>>(endpoint, {
            companyId: supplier.companyId,
            contactId: supplier.contactId ?? null,
            paymentTermType: supplier.paymentTermType ?? null,
            creditDays: supplier.creditDays ?? null,
            note: supplier.note ?? null,
            deliveredAt: supplier.deliveredAt ?? null,
            sortOrder: supplier.sortOrder,
            isPrimary: supplier.isPrimary,
          });

      const res = await firstValueFrom(request$);

      if (!res.success || !res.data) {
        throw new Error(res.message ?? 'Failed to save supplier details');
      }
    }

    await this.reloadOrderSuppliers(orderId, preferredCompanyId);
  }

  private async reloadOrderSuppliers(orderId: string, preferredCompanyId?: string | null): Promise<void> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<OrderSupplierDto[]>>(`${API_URL}/orders/${orderId}/suppliers`),
    );

    if (!res.success || !res.data) return;

    this.orderSuppliers.set(res.data);
    const currentActiveSupplierId = this.activeOrderSupplierId();
    const preferredSupplierId = (currentActiveSupplierId && res.data.some((supplier) => supplier.id === currentActiveSupplierId)
      ? currentActiveSupplierId
      : null)
      ?? res.data.find((supplier) => preferredCompanyId && supplier.companyId === preferredCompanyId)?.id
      ?? res.data.find((supplier) => supplier.isPrimary)?.id
      ?? res.data[0]?.id
      ?? null;
    this.activeOrderSupplierId.set(preferredSupplierId);
  }

  private isTemporaryOrderSupplierId(orderSupplierId: string | null | undefined): boolean {
    return typeof orderSupplierId === 'string' && orderSupplierId.startsWith('temp:');
  }

  private async clearActiveSupplierSelection(): Promise<void> {
    if (this.orderSuppliers().length === 0) {
      this.order.update((order) => order
        ? {
            ...order,
            supplierId: null,
            supplierContactId: null,
            supplierPaymentTermType: null,
            supplierCreditDays: null,
            supplierNote: null,
            deliveredAt: null,
          }
        : order);
      this.supplier.set(null);
      this.supplierContact.set(null);
      this.supplierContacts.set([]);
      this.supplierCreditLines.set([]);
      this.triggerAutosave();
      return;
    }

    const activeSupplier = this.activeOrderSupplier();
    if (!activeSupplier) return;

    if (this.isTemporaryOrderSupplierId(activeSupplier.id)) {
      this.orderSuppliers.update((suppliers) => suppliers.filter((supplier) => supplier.id !== activeSupplier.id));
      const nextActive = this.activeOrderSupplier();
      this.activeOrderSupplierId.set(nextActive?.id ?? null);
      this.supplier.set(nextActive?.company ?? null);
      this.supplierContact.set(nextActive?.contact ?? null);
      await this.loadSupplierCreditLines(nextActive?.companyId ?? null);
      if (nextActive?.companyId) {
        await this.loadCompanyContacts('supplier', nextActive.companyId);
      } else {
        this.supplierContacts.set([]);
      }
      return;
    }

    const orderId = this.orderId();
    if (!orderId) return;

    try {
      const res = await firstValueFrom(
        this.http.delete<ApiResponse<{ id: string; isPrimary: boolean }>>(`${API_URL}/orders/${orderId}/suppliers/${activeSupplier.id}`),
      );

      if (!res.success) {
        this.showToast('error', res.message ?? 'Failed to remove supplier.');
        return;
      }

      await this.reloadOrderSuppliers(orderId);

      const nextActive = this.activeOrderSupplier();
      const latestDeliveredAt = this.orderSuppliers()
        .map((supplier) => supplier.deliveredAt)
        .filter((value): value is string => !!value)
        .sort()
        .at(-1) ?? null;
      this.order.update((order) => order
        ? {
            ...order,
            supplierId: nextActive?.companyId ?? null,
            supplierContactId: nextActive?.contactId ?? null,
            supplierPaymentTermType: nextActive?.paymentTermType ?? null,
            supplierCreditDays: nextActive?.creditDays ?? null,
            supplierNote: nextActive?.note ?? null,
            deliveredAt: latestDeliveredAt,
          }
        : order);
      this.supplier.set(nextActive?.company ?? null);
      this.supplierContact.set(nextActive?.contact ?? null);
      await this.loadSupplierCreditLines(nextActive?.companyId ?? null);
      if (nextActive?.companyId) {
        await this.loadCompanyContacts('supplier', nextActive.companyId);
      } else {
        this.supplierContacts.set([]);
      }
    } catch {
      this.showToast('error', 'Failed to remove supplier.');
    }
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

  // ─── Item grid events ────────────────────────────────────────────

  onItemsChange(items: OrderItemRow[]): void {
    this.itemRows.set(items);
    this.queuePlattsSuggestionsLoad();
    this.triggerAutosave();
  }

  async loadPlattsSuggestions(): Promise<void> {
    const items = this.itemRows()
      .filter((item) => item.productType)
      .map((item) => ({
        key: item.id,
        productType: item.productType,
        description: item.description?.trim() || null,
      }));

    if (items.length === 0) {
      this.plattsSuggestions.set(null);
      this.plattsSuggestionsError.set(null);
      return;
    }

    const publicationDate = (this.order()?.eta ?? new Date().toISOString()).slice(0, 10);
    this.plattsSuggestionsLoading.set(true);
    this.plattsSuggestionsError.set(null);

    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<PlattsSuggestionsResponseDto>>(`${API_URL}/platts/suggestions`, {
          publicationDate,
          items,
          limitPerItem: 3,
        }),
      );

      if (res.success) {
        this.plattsSuggestions.set(res.data);
      } else {
        this.plattsSuggestions.set(null);
        this.plattsSuggestionsError.set(res.message || 'Failed to load Platts signals.');
      }
    } catch {
      this.plattsSuggestions.set(null);
      this.plattsSuggestionsError.set('Failed to load Platts signals.');
    } finally {
      this.plattsSuggestionsLoading.set(false);
    }
  }

  openPlattsReport(reportId: string): void {
    void this.router.navigate(['/resources/platts', reportId]);
  }

  private queuePlattsSuggestionsLoad(): void {
    if (this.plattsSuggestionTimer) clearTimeout(this.plattsSuggestionTimer);
    this.plattsSuggestionTimer = setTimeout(() => {
      void this.loadPlattsSuggestions();
    }, 250);
  }

  onInvoicingCompanyChange(companyId: string): void {
    const nextCompanyId = this.resolveRequestedInvoicingCompanyId(companyId);
    const currentCompanyId = this.order()?.invoicingCompanyId ?? null;

    if (currentCompanyId === nextCompanyId) {
      return;
    }

    this.order.update((o) => o ? { ...o, invoicingCompanyId: nextCompanyId, bankAccountId: null } : o);
    this.bankAccounts.set([]);
    if (nextCompanyId) void this.loadBankAccounts(nextCompanyId, { autoSelect: true });
    this.triggerAutosave();
  }

  onBankAccountChange(bankAccountId: string): void {
    const nextBankAccountId = this.resolveRequestedBankAccountId(bankAccountId, this.bankAccounts());
    const currentBankAccountId = this.order()?.bankAccountId ?? null;

    if (currentBankAccountId === nextBankAccountId) {
      return;
    }

    this.order.update((o) => o ? { ...o, bankAccountId: nextBankAccountId } : o);
    this.triggerAutosave();
  }

  private async loadBankAccounts(companyId: string, options?: { autoSelect?: boolean }): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<BankAccountDto[]>>(
          `${API_URL}/admin/settings/companies/${companyId}/bank-accounts`,
        ),
      );
      if (res.success) {
        this.bankAccounts.set(res.data);
        if (options?.autoSelect) {
          this.applyPreferredBankAccountSelection(res.data);
        }
      }
    } catch { /* silently ignore */ }
  }

  private applyPreferredInvoicingCompanySelection(companies: OwnCompanyDto[]): string | null {
    const nextCompanyId = this.resolveRequestedInvoicingCompanyId(this.order()?.invoicingCompanyId);
    const currentCompanyId = this.order()?.invoicingCompanyId ?? null;

    if (currentCompanyId === nextCompanyId) {
      return nextCompanyId;
    }

    if (companies.length === 0) {
      return currentCompanyId;
    }

    this.order.update((order) => (order
      ? { ...order, invoicingCompanyId: nextCompanyId, bankAccountId: null }
      : order));
    this.triggerAutosave();
    return nextCompanyId;
  }

  private applyPreferredBankAccountSelection(accounts: BankAccountDto[]): void {
    const preferredBankAccountId = this.resolveRequestedBankAccountId(this.order()?.bankAccountId, accounts);

    if (this.order()?.bankAccountId === preferredBankAccountId) {
      return;
    }

    this.order.update((order) => (order ? { ...order, bankAccountId: preferredBankAccountId } : order));
    this.triggerAutosave();
  }

  private getPreferredBankAccount(accounts: BankAccountDto[]): BankAccountDto | null {
    if (accounts.length === 0) return null;

    const orderCurrency = this.normalizeCurrencyCode(this.order()?.currency);
    if (orderCurrency) {
      const currencyMatches = accounts.filter((account) => this.normalizeCurrencyCode(account.currency) === orderCurrency);
      if (currencyMatches.length > 0) {
        return currencyMatches.find((account) => account.isDefault) ?? currencyMatches[0];
      }
    }

    return accounts.find((account) => account.isDefault) ?? accounts[0] ?? null;
  }

  private resolveRequestedInvoicingCompanyId(companyId: string | null | undefined): string | null {
    const normalizedCompanyId = (companyId ?? '').trim();
    const companies = this.ownCompanies();

    if (normalizedCompanyId && companies.some((company) => company.id === normalizedCompanyId)) {
      return normalizedCompanyId;
    }

    if (companies.length === 0) {
      return normalizedCompanyId || null;
    }

    const currentCompanyId = this.order()?.invoicingCompanyId ?? null;
    if (currentCompanyId && companies.some((company) => company.id === currentCompanyId)) {
      return currentCompanyId;
    }

    return companies[0]?.id ?? null;
  }

  private resolveRequestedBankAccountId(
    bankAccountId: string | null | undefined,
    accounts: BankAccountDto[],
  ): string | null {
    const normalizedBankAccountId = (bankAccountId ?? '').trim();

    if (normalizedBankAccountId && accounts.some((account) => account.id === normalizedBankAccountId)) {
      return normalizedBankAccountId;
    }

    if (accounts.length === 0) {
      return null;
    }

    const currentBankAccountId = this.order()?.bankAccountId ?? null;
    if (currentBankAccountId && accounts.some((account) => account.id === currentBankAccountId)) {
      return currentBankAccountId;
    }

    return this.getPreferredBankAccount(accounts)?.id ?? null;
  }

  private normalizeCurrencyCode(currency: string | null | undefined): string {
    return (currency ?? '').trim().toUpperCase();
  }

  async searchClients(term: string): Promise<void> {
    this.clientSearchLoading.set(true);
    try {
      let res = await firstValueFrom(
        this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
          `${API_URL}/companies/local?type=CLIENT&search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      let localResults = res.success ? res.data.companies : [];
      // Fallback: if no results with type filter, retry without type
      if (localResults.length === 0 && term.trim()) {
        res = await firstValueFrom(
          this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
            `${API_URL}/companies/local?search=${encodeURIComponent(term)}&limit=20`,
          ),
        );
        localResults = res.success ? res.data.companies : [];
      }
      const current = this.client();
      const mergedLocal = current && !localResults.find((c) => c.id === current.id)
        ? [current, ...localResults]
        : localResults;
      this.clients.set(mergedLocal);
    } catch {
      // silently ignore
    } finally {
      this.clientSearchLoading.set(false);
    }
  }

  async searchSuppliers(term: string): Promise<void> {
    this.supplierSearchLoading.set(true);
    try {
      let res = await firstValueFrom(
        this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
          `${API_URL}/companies/local?type=SUPPLIER&search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      let localResults = res.success ? res.data.companies : [];
      // Fallback: if no results with type filter, retry without type
      if (localResults.length === 0 && term.trim()) {
        res = await firstValueFrom(
          this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
            `${API_URL}/companies/local?search=${encodeURIComponent(term)}&limit=20`,
          ),
        );
        localResults = res.success ? res.data.companies : [];
      }
      const currentId = this.order()?.supplierId ?? '';
      const currentSupplier = currentId
        ? this.supplier() ?? this.suppliers().find((supplier) => supplier.id === currentId) ?? null
        : null;
      const mergedLocal = currentId && !localResults.find((c) => c.id === currentId)
        ? [currentSupplier, ...localResults].filter(Boolean)
        : localResults;
      this.suppliers.set(mergedLocal as CounterpartyDto[]);
    } catch {
      // silently ignore
    } finally {
      this.supplierSearchLoading.set(false);
    }
  }

  async searchVessels(term: string): Promise<void> {
    this.vesselSearchLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ vessels: VesselDto[]; total: number }>>(
          `${API_URL}/vessels/local?search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      const current = this.vessel();
      const localResults = res.success ? res.data.vessels : [];
      const mergedLocal = current && !localResults.find((v) => v.id === current.id)
        ? [current, ...localResults]
        : localResults;
      this.vessels.set(mergedLocal);
    } catch {
      // silently ignore
    } finally {
      this.vesselSearchLoading.set(false);
    }
  }

  async searchPlaces(term: string): Promise<void> {
    this.placeSearchLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ places: PlaceDto[]; total: number }>>(
          `${API_URL}/lloyds/places/local?search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      const current = this.port();
      const localResults = res.success ? res.data.places : [];
      const mergedLocal = current && !localResults.find((p) => p.id === current.id)
        ? [current, ...localResults]
        : localResults;
      this.places.set(mergedLocal);
    } catch {
      // silently ignore
    } finally {
      this.placeSearchLoading.set(false);
    }
  }

  onClientChange(clientId: string): void {
    if (!clientId) return;
    this.order.update((o) => (o ? { ...o, clientId, customerContactId: null } : o));
    const clientData = this.clients().find((c) => c.id === clientId);
    this.client.set(clientData ?? null);
    this.customerContact.set(null);
    void this.loadCustomerCreditLines(clientId);
    void this.loadCompanyContacts('customer', clientId);
    this.triggerAutosave();
  }

  onActiveSupplierCompanyChange(supplierId: string): void {
    if (!supplierId) {
      void this.clearActiveSupplierSelection();
      return;
    }
    const supplierData = this.suppliers().find((supplier) => supplier.id === supplierId)
      ?? (this.supplier()?.id === supplierId ? this.supplier() : null);
    if (this.orderSuppliers().length === 0) {
      this.order.update((order) => order
        ? {
            ...order,
            supplierId,
            supplierContactId: null,
          }
        : order);
      this.supplier.set(supplierData ?? null);
      this.supplierContact.set(null);
      void this.loadSupplierCreditLines(supplierId);
      void this.loadCompanyContacts('supplier', supplierId);
      this.triggerAutosave();
      return;
    }
    this.updateActiveOrderSupplier((supplier) => ({
      ...supplier,
      companyId: supplierId,
      contactId: null,
      company: this.suppliers().find((item) => item.id === supplierId) ?? this.supplier() ?? null,
      contact: null,
    }));
    this.supplier.set(supplierData ?? null);
    this.supplierContact.set(null);
    void this.loadSupplierCreditLines(supplierId);
    void this.loadCompanyContacts('supplier', supplierId);
    this.triggerAutosave();
  }

  applyComparisonSupplier(row: InquirySupplierComparisonRow): void {
    this.onActiveSupplierCompanyChange(row.supplierId);
    this.showToast('success', `Selected ${row.supplierName} as supplier.`);
  }

  selectOrderSupplierTab(orderSupplierId: string): void {
    this.activeOrderSupplierId.set(orderSupplierId);
    const supplier = this.orderSuppliers().find((item) => item.id === orderSupplierId) ?? null;
    this.supplier.set(supplier?.company ?? null);
    this.supplierContact.set(supplier?.contact ?? null);
  }

  async addSupplierTab(): Promise<void> {
    const activeSupplier = this.activeOrderSupplier();
    if (this.orderSuppliers().some((supplier) => this.isTemporaryOrderSupplierId(supplier.id) && !supplier.companyId)) {
      this.showToast('error', 'Choose a supplier in the new tab before adding another one.');
      return;
    }

    const tempId = `temp:${crypto.randomUUID()}`;
    const nextSortOrder = Math.max(-1, ...this.orderSuppliers().map((supplier) => supplier.sortOrder ?? -1)) + 1;
    const orderId = this.orderId() ?? activeSupplier?.orderId ?? '';

    this.orderSuppliers.update((suppliers) => [...suppliers, {
      id: tempId,
      orderId,
      companyId: '',
      contactId: null,
      paymentTermType: null,
      creditDays: null,
      note: null,
      sortOrder: nextSortOrder,
      isPrimary: false,
      deliveredAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      company: null,
      contact: null,
    }]);
    this.selectOrderSupplierTab(tempId);
  }

  private updateActiveOrderSupplier(
    updater: (supplier: OrderSupplierDto) => OrderSupplierDto,
  ): void {
    const resolvedActiveSupplier = this.activeOrderSupplier();
    const activeSupplierId = this.activeOrderSupplierId() ?? resolvedActiveSupplier?.id ?? null;
    if (!activeSupplierId) return;
    if (!this.activeOrderSupplierId()) {
      this.activeOrderSupplierId.set(activeSupplierId);
    }

    let nextSupplier: OrderSupplierDto | undefined;
    this.orderSuppliers.update((suppliers) => suppliers.map((supplier) => {
      if (supplier.id !== activeSupplierId) return supplier;
      nextSupplier = updater(supplier);
      return nextSupplier;
    }));

    if (!nextSupplier) return;
    const updatedSupplier = nextSupplier;

    this.supplier.set(updatedSupplier.company ?? null);
    this.supplierContact.set(updatedSupplier.contact ?? null);

    if (updatedSupplier.isPrimary) {
      this.order.update((order) => order
        ? {
            ...order,
            supplierId: updatedSupplier.companyId,
            supplierContactId: updatedSupplier.contactId ?? null,
            supplierPaymentTermType: updatedSupplier.paymentTermType ?? null,
            supplierCreditDays: updatedSupplier.creditDays ?? null,
            supplierNote: updatedSupplier.note ?? null,
            deliveredAt: updatedSupplier.deliveredAt ?? order.deliveredAt ?? null,
          }
        : order);
    }

    const latestDeliveredAt = this.orderSuppliers()
      .map((supplier) => supplier.deliveredAt ?? null)
      .filter((value): value is string => !!value)
      .sort()
      .at(-1) ?? null;

    this.order.update((order) => order ? { ...order, deliveredAt: latestDeliveredAt ?? order.deliveredAt ?? null } : order);
  }

  openInquiryReplyEditor(row: SupplierInquiryReplyRow): void {
    this.editingInquiryReplyId.set(row.id);
    this.inquiryReplyStatus.set(row.status);
    this.inquiryReplyRespondedAt.set(this.formatDateTimeInput(row.respondedAt));
    this.inquiryReplyDeclineReason.set(row.declineReason ?? '');
    this.inquiryReplyPrices.set(
      Object.fromEntries(row.items.map((item) => [item.orderItemId, item.price ?? ''])),
    );
    this.inquiryReplyNotes.set(
      Object.fromEntries(row.items.map((item) => [item.orderItemId, item.note ?? ''])),
    );
    this.inquiryReplyQuoteValidUntil.set(this.formatDateTimeInput(row.quoteValidUntil));
    this.inquiryReplyDeliveryWindow.set(row.deliveryWindow ?? '');
    this.inquiryReplySupplierPaymentTerms.set(row.supplierPaymentTerms ?? '');
    this.inquiryReplySupplierComment.set(row.supplierComment ?? '');
  }

  cancelInquiryReplyEditor(): void {
    this.editingInquiryReplyId.set(null);
    this.inquiryReplyStatus.set('SENT');
    this.inquiryReplyRespondedAt.set('');
    this.inquiryReplyDeclineReason.set('');
    this.inquiryReplyPrices.set({});
    this.inquiryReplyNotes.set({});
    this.inquiryReplyQuoteValidUntil.set('');
    this.inquiryReplyDeliveryWindow.set('');
    this.inquiryReplySupplierPaymentTerms.set('');
    this.inquiryReplySupplierComment.set('');
  }

  isEditingInquiryReply(row: SupplierInquiryReplyRow): boolean {
    return this.editingInquiryReplyId() === row.id;
  }

  setInquiryReplyStatus(status: 'SENT' | 'QUOTED' | 'DECLINED' | 'NO_REPLY'): void {
    this.inquiryReplyStatus.set(status);
    if (status === 'SENT' || status === 'NO_REPLY') {
      this.inquiryReplyRespondedAt.set('');
      this.inquiryReplyDeclineReason.set('');
    }
    if (status !== 'DECLINED') {
      this.inquiryReplyDeclineReason.set('');
    }
  }

  setInquiryReplyPrice(orderItemId: string, value: string): void {
    this.inquiryReplyPrices.update((current) => ({ ...current, [orderItemId]: String(value ?? '') }));
  }

  setInquiryReplyNote(orderItemId: string, value: string): void {
    this.inquiryReplyNotes.update((current) => ({ ...current, [orderItemId]: String(value ?? '') }));
  }

  canSaveInquiryReply(row: SupplierInquiryReplyRow): boolean {
    const status = this.inquiryReplyStatus();
    if (status === 'QUOTED') {
      return !!this.inquiryReplyRespondedAt()
        && row.items.some((item) => String(this.inquiryReplyPrices()[item.orderItemId] ?? '').trim().length > 0);
    }
    if (status === 'DECLINED') {
      return !!this.inquiryReplyRespondedAt() && this.inquiryReplyDeclineReason().trim().length > 0;
    }
    return true;
  }

  async saveInquiryReply(row: SupplierInquiryReplyRow): Promise<void> {
    const id = this.orderId();
    if (!id) return;

    this.inquiryRepliesSavingId.set(row.id);
    try {
      const status = this.inquiryReplyStatus();
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<{ updated: boolean }>>(`${API_URL}/orders/${id}/inquiry/sent/${row.id}`, {
          status,
          respondedAt: status === 'QUOTED' || status === 'DECLINED'
            ? this.toIsoFromDateTimeInput(this.inquiryReplyRespondedAt())
            : null,
          declineReason: status === 'DECLINED' ? this.inquiryReplyDeclineReason().trim() : null,
          quoteValidUntil: status === 'QUOTED' ? this.toIsoFromDateTimeInput(this.inquiryReplyQuoteValidUntil()) : null,
          deliveryWindow: status === 'QUOTED' ? this.inquiryReplyDeliveryWindow().trim() : null,
          supplierPaymentTerms: status === 'QUOTED' ? this.inquiryReplySupplierPaymentTerms().trim() : null,
          supplierComment: status === 'QUOTED' ? this.inquiryReplySupplierComment().trim() : null,
          items: status === 'QUOTED'
            ? row.items.map((item) => ({
              orderItemId: item.orderItemId,
              price: String(this.inquiryReplyPrices()[item.orderItemId] ?? '').trim() || null,
              note: String(this.inquiryReplyNotes()[item.orderItemId] ?? '').trim() || null,
            }))
            : [],
        }),
      );
      if (!res.success) {
        this.showToast('error', res.message ?? 'Failed to save supplier reply.');
        return;
      }

      await Promise.all([
        this.loadInquiryReplies(),
        this.loadInquirySupplierContext(),
      ]);
      this.cancelInquiryReplyEditor();
      this.showToast('success', `Updated supplier reply for ${row.supplierName}.`);
    } catch {
      this.showToast('error', 'Failed to save supplier reply.');
    } finally {
      this.inquiryRepliesSavingId.set(null);
    }
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

  formatHistoryDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  formatHistoryDateTime(iso: string): string {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  quoteRateLabel(performance: InquirySupplierPerformance): string {
    if (performance.sentCount <= 0 || performance.quotedCount <= 0) return '';
    return `${Math.round((performance.quotedCount / performance.sentCount) * 100)}% quote rate`;
  }

  averageResponseLabel(performance: InquirySupplierPerformance): string {
    if (performance.averageResponseHours == null || performance.respondedCount <= 0) return '';
    if (performance.averageResponseHours >= 24) {
      return `${Number((performance.averageResponseHours / 24).toFixed(1))}d avg reply`;
    }
    return `${Number(performance.averageResponseHours.toFixed(1))}h avg reply`;
  }

  deliverabilityLabel(performance: InquirySupplierPerformance): string {
    const responseCount = performance.deliverableCount + performance.nonDeliverableCount;
    if (responseCount <= 0) return '';
    return `${Math.round((performance.deliverableCount / responseCount) * 100)}% deliverable`;
  }

  inquiryReplySummary(row: SupplierInquiryReplyRow): string {
    if (row.status === 'QUOTED' && row.quoteLineCount > 0) {
      const totalLines = row.items.length;
      return `${row.quoteLineCount}/${totalLines} line${totalLines === 1 ? '' : 's'} quoted`;
    }
    if (row.status === 'DECLINED' && row.declineReason) {
      return row.declineReason;
    }
    if (row.status === 'NO_REPLY') {
      return 'Marked as no reply';
    }
    return 'Awaiting supplier response';
  }

  inquiryQuoteMatrixCellLabel(status: SupplierInquiryReplyRow['status']): string {
    if (status === 'DECLINED') return 'Declined';
    if (status === 'NO_REPLY') return 'No reply';
    return 'Awaiting reply';
  }

  inquiryReplyRecommendation(inquiryId: string): InquiryReplyRecommendation | null {
    return this.inquiryReplyRecommendations().get(inquiryId) ?? null;
  }

  responseHoursLabel(hours: number | null): string {
    if (hours == null) return '';
    if (hours >= 24) {
      return `${Number((hours / 24).toFixed(1))} days`;
    }
    return `${Number(hours.toFixed(1))} hours`;
  }

  /** Strip trailing zeros from a numeric string, show min-max spread if applicable. */
  formatQty(qty: string | null, qtyMin?: string | null): string {
    const fmt = (v: string) => {
      const n = parseFloat(v);
      return isNaN(n) ? v : n.toString();
    };
    if (!qty) return '';
    const max = fmt(qty);
    const min = qtyMin ? fmt(qtyMin) : '';
    return min && min !== max ? `${min} - ${max}` : max;
  }

  supplierPerformanceSummary(performance: InquirySupplierPerformance): string {
    if (performance.lastDeliveredAtPlace) {
      return `Last here ${this.formatHistoryDate(performance.lastDeliveredAtPlace)}`;
    }
    if (performance.lastDeliveredAtOverall) {
      return `Last served ${this.formatHistoryDate(performance.lastDeliveredAtOverall)}`;
    }
    if (performance.noReplyCount > 0) {
      return `${performance.noReplyCount} no reply`;
    }
    if (performance.declinedCount > 0) {
      return `${performance.declinedCount} declined`;
    }
    return '';
  }

  isTopInquirySupplier(row: InquirySupplierComparisonRow): boolean {
    const topRow = this.rankedInquirySuppliers()[0];
    return !!topRow && topRow.supplierId === row.supplierId && this.inquirySupplierScore(row.performance) > 0;
  }

  private compareInquirySupplierPerformance(left: InquirySupplierComparisonRow, right: InquirySupplierComparisonRow): number {
    const scoreDiff = this.inquirySupplierScore(right.performance) - this.inquirySupplierScore(left.performance);
    if (scoreDiff !== 0) return scoreDiff;
    return left.supplierName.localeCompare(right.supplierName);
  }

  private inquirySupplierScore(performance: InquirySupplierPerformance): number {
    const quoteRate = performance.sentCount > 0 ? performance.quotedCount / performance.sentCount : 0;
    const deliverabilityRate = performance.deliverableCount + performance.nonDeliverableCount > 0
      ? performance.deliverableCount / (performance.deliverableCount + performance.nonDeliverableCount)
      : 0;
    const responseBonus = performance.averageResponseHours == null
      ? 0
      : Math.max(0, 72 - Math.min(72, performance.averageResponseHours)) * 5;
    const lastAtPlace = performance.lastDeliveredAtPlace ? Date.parse(performance.lastDeliveredAtPlace) : 0;
    const lastOverall = performance.lastDeliveredAtOverall ? Date.parse(performance.lastDeliveredAtOverall) : 0;
    return performance.deliveredCountAtPlace * 1000
      + performance.deliveredCountOverall * 100
      + Math.round(quoteRate * 100) * 10
      + Math.round(deliverabilityRate * 100) * 8
      + Math.round(responseBonus)
      + Math.floor(lastAtPlace / 86400000)
      + Math.floor(lastOverall / 86400000 / 10);
  }

  private formatDateTimeInput(iso: string | null): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const year = String(date.getFullYear()).padStart(4, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  private toIsoFromDateTimeInput(value: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  onVesselChange(vesselId: string): void {
    if (!vesselId) return;
    this.order.update((o) => (o ? { ...o, vesselId } : o));
    const vesselData = this.vessels().find((v) => v.id === vesselId);
    this.vessel.set(vesselData ?? null);
    this.triggerAutosave();
  }

  onPortChange(placeId: string): void {
    if (!placeId) return;
    const previousRemark = this.order()?.placeRemark ?? null;
    this.order.update((o) => (o ? { ...o, placeId } : o));
    const placeData = this.places().find((p) => p.id === placeId);
    this.port.set(placeData ?? null);
    this.triggerAutosave();

    // Prompt user if the new place has a different default remark
    const newDefault = placeData?.orderRemark ?? null;
    if ((newDefault ?? '') !== (previousRemark ?? '')) {
      this.pendingPlaceRemark.set(newDefault);
      this.showPlaceRemarkPrompt.set(true);
    }
  }

  onPlaceRemarkChange(value: string): void {
    this.order.update((o) => (o ? { ...o, placeRemark: value || null } : o));
    this.triggerAutosave();
  }

  applyNewPlaceRemark(): void {
    const remark = this.pendingPlaceRemark();
    this.order.update((o) => (o ? { ...o, placeRemark: remark } : o));
    this.showPlaceRemarkPrompt.set(false);
    this.pendingPlaceRemark.set(null);
    this.triggerAutosave();
  }

  dismissPlaceRemarkPrompt(): void {
    this.showPlaceRemarkPrompt.set(false);
    this.pendingPlaceRemark.set(null);
  }

  onEtaChange(eta: string): void {
    const iso = eta ? `${eta}T12:00:00.000Z` : null;
    this.order.update((o) => (o ? { ...o, eta: iso } : o));
    this.queuePlattsSuggestionsLoad();
    this.triggerAutosave();
  }

  onEtdChange(etd: string): void {
    const iso = etd ? `${etd}T12:00:00.000Z` : null;
    this.order.update((o) => (o ? { ...o, etd: iso } : o));
    this.triggerAutosave();
  }

  onDeliveredAtChange(value: string): void {
    const iso = value ? `${value}T12:00:00.000Z` : null;
    if (this.orderSuppliers().length === 0) {
      this.order.update((order) => order ? { ...order, deliveredAt: iso } : order);
      this.triggerAutosave();
      return;
    }
    this.updateActiveOrderSupplier((supplier) => ({ ...supplier, deliveredAt: iso }));
    this.triggerAutosave();
  }

  onItemEconomicsChange(economics: OrderItemsEconomics): void {
    this.itemEconomics.set(economics);
  }

  onCurrencyChange(currency: string): void {
    this.order.update((o) => (o ? { ...o, currency } : o));
    if (this.bankAccounts().length > 0) {
      this.applyPreferredBankAccountSelection(this.bankAccounts());
    } else {
      const invoicingCompanyId = this.order()?.invoicingCompanyId;
      if (invoicingCompanyId) {
        void this.loadBankAccounts(invoicingCompanyId, { autoSelect: true });
      }
    }
    this.triggerAutosave();
  }

  toggleSettings(event: MouseEvent): void {
    if (!this.settingsOpen()) {
      const btn = event.currentTarget as HTMLElement;
      const rect = btn.getBoundingClientRect();
      this.settingsDropdownTop.set(rect.bottom + 4);
      this.settingsDropdownLeft.set(Math.max(0, rect.right - 192)); // 192px = w-48
    }
    this.settingsOpen.set(!this.settingsOpen());
  }

  private triggerAutosave(): void {
    if (this.isPaidOrCancelled()) return;
    this.changeVersion.update((v) => v + 1);
  }

  private async performAutoSave(): Promise<void> {
    const id = this.orderId();
    const o = this.order();
    if (!id || !o || this.isPaidOrCancelled()) return;

    this.autoSaving.set(true);
    try {
      await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}`, {
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
          brokerId: o.brokerId ?? null,
          brokerContactId: o.brokerContactId ?? null,
          brokerGetsAll: o.brokerGetsAll ?? false,
          agentId: o.agentId ?? null,
          agentContactId: o.agentContactId ?? null,
          termsAndConditions: o.termsAndConditions ?? null,
          eta: o.eta,
          etd: o.etd,
          deliveredAt: o.deliveredAt ?? null,
        }),
      );

      const itemPayload = this.buildItemPayload(this.itemRows()).map((item) => ({
        ...item,
        costCurrency: item.costCurrency ?? o.currency,
        salesCurrency: item.salesCurrency ?? o.currency,
      }));

      await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}/items`, { items: itemPayload }),
      );
      await this.syncOrderSupplierRecords(id);
      await this.loadCustomerCreditLines(o.clientId);
      await this.loadSupplierCreditLines(this.activeOrderSupplier()?.companyId ?? o.supplierId);
      this.lastSaved.set(new Date());
    } catch {
      // Quietly fail - manual save still available
    } finally {
      this.autoSaving.set(false);
    }
  }

  // ─── Actions ─────────────────────────────────────────────────────

  onAction(action: HeaderAction): void {
    switch (action) {
      case 'generate-invoice':
        if (!this.hasLineItems()) {
          this.showToast('error', 'Add at least one line item before viewing Invoice/Proforma.');
          break;
        }
        if (!this.hasBankAccount()) {
          this.showToast('error', 'Select a bank account before viewing Invoice/Proforma.');
          break;
        }
        this.viewInvoicePdf();
        break;
      case 'view-offer':
        if (!this.hasLineItems()) {
          this.showToast('error', 'Add at least one line item before generating Confirmation PDF.');
          break;
        }
        if (!this.hasInvoicingCompany()) {
          this.showToast('error', 'Select an invoicing company before generating Confirmation PDF.');
          break;
        }
        if (!this.hasEta()) {
          this.showToast('error', 'Set an ETA before generating Confirmation PDF.');
          break;
        }
        this.viewOfferPdf();
        break;
      case 'view-proforma':
        if (!this.hasLineItems()) {
          this.showToast('error', 'Add at least one line item before generating Nomination PDF.');
          break;
        }
        if (!this.hasSupplier()) {
          this.showToast('error', 'Select a supplier before generating Nomination PDF.');
          break;
        }
        if (!this.hasInvoicingCompany()) {
          this.showToast('error', 'Select an invoicing company before generating Nomination PDF.');
          break;
        }
        if (!this.hasEta()) {
          this.showToast('error', 'Set an ETA before generating Nomination PDF.');
          break;
        }
        this.viewProformaPdf();
        break;
      case 'convert-to-order':
        this.openConvertToOrderModal();
        break;
      case 'cancel-inquiry':
        this.openCancelInquiryModal();
        break;
      case 'cancel-order':
        this.openCancelInquiryModal();
        break;
      case 'send-email':
        if (!this.isResponsibleUser()) {
          this.showToast('error', 'Only the responsible user can send this email.');
          break;
        }
        this.openSendEmailModal('INVOICE');
        break;
      case 'send-offer':
        if (!this.hasEta()) { this.showToast('error', 'Set an ETA before sending.'); break; }
        this.openSendEmailModal('OFFER');
        break;
      case 'send-confirmation':
        if (!this.hasEta()) { this.showToast('error', 'Set an ETA before sending.'); break; }
        this.openSendEmailModal('CONFIRMATION');
        break;
      case 'send-nomination':
        if (!this.hasEta()) { this.showToast('error', 'Set an ETA before sending.'); break; }
        this.openSendEmailModal('NOMINATION');
        break;
      case 'send-proforma':
        if (!this.hasEta()) { this.showToast('error', 'Set an ETA before sending.'); break; }
        this.openSendEmailModal('PROFORMA');
        break;
      case 'send-invoice':
        this.openSendEmailModal('INVOICE');
        break;
      case 'send-inquiry':
        this.openSendInquiryModal();
        break;
      case 'mark-paid':
        this.markPaid();
        break;
      case 'mark-delivered':
        this.markDelivered();
        break;
    }
  }

  openConvertToOrderModal(): void {
    if (!this.hasLineItems()) {
      this.showToast('error', 'Add at least one line item before converting to order.');
      return;
    }
    this.showConvertToOrderModal.set(true);
  }

  closeConvertToOrderModal(): void {
    this.showConvertToOrderModal.set(false);
  }

  openCancelInquiryModal(): void {
    const status = this.order()?.status;
    const canCancel =
      status === OrderStatus.Inquiry
      || status === OrderStatus.Offer
      || status === OrderStatus.Confirmed
      || status === OrderStatus.Delivered
      || status === OrderStatus.Invoiced;
    if (!canCancel) {
      this.showToast('error', 'This record cannot be cancelled from this action.');
      return;
    }

    const reasons = this.availableInquiryCancelReasons();
    if (!reasons.length) {
      this.showToast('error', 'No cancellation reasons configured. Please ask admin to configure reasons in Settings.');
      return;
    }

    this.selectedInquiryCancelReason.set(reasons[0]!);
    this.cancelReasonOtherDetail.set('');
    this.showCancelInquiryModal.set(true);
  }

  closeCancelInquiryModal(): void {
    if (this.cancellingInquiry()) return;
    this.showCancelInquiryModal.set(false);
  }

  async confirmConvertToOrder(): Promise<void> {
    if (this.convertingToOrder()) return;
    const id = this.orderId();
    if (!id) return;
    if (!this.hasLineItems()) {
      this.showToast('error', 'Add at least one line item before converting to order.');
      return;
    }

    this.convertingToOrder.set(true);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}/status`, { status: 'CONFIRMED' }),
      );
      if (res.success) {
        this.order.update((o) => (o ? { ...o, status: OrderStatus.Confirmed } : o));
        this.closeConvertToOrderModal();
        this.showToast('success', 'Inquiry converted to order.');
        await this.router.navigate(['/trading/orders', id]);
      } else {
        this.showToast('error', res.message ?? 'Failed to convert inquiry.');
      }
    } catch {
      this.showToast('error', 'Failed to convert inquiry.');
    } finally {
      this.convertingToOrder.set(false);
    }
  }

  async confirmCancelInquiry(): Promise<void> {
    const id = this.orderId();
    if (!id) return;

    const status = this.order()?.status;
    const isInquiry = status === OrderStatus.Inquiry || status === OrderStatus.Offer;
    const canCancel = isInquiry || status === OrderStatus.Confirmed || status === OrderStatus.Delivered || status === OrderStatus.Invoiced;
    if (!canCancel) {
      this.showToast('error', 'This record cannot be cancelled from this action.');
      return;
    }

    const reason = this.selectedInquiryCancelReason().trim();
    if (!reason) {
      this.showToast('error', 'Select a cancellation reason.');
      return;
    }

    let lossReason = reason;
    if (reason === 'Other') {
      const detail = this.cancelReasonOtherDetail().trim();
      if (!detail) {
        this.showToast('error', 'Please specify a reason.');
        return;
      }
      lossReason = `Other: ${detail}`;
    }

    this.cancellingInquiry.set(true);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}/status`, {
          status: 'CANCELLED',
          lossReason,
        }),
      );
      if (res.success) {
        this.order.update((o) => (o ? { ...o, status: OrderStatus.Cancelled, lossReason } : o));
        const updatedOrder = this.order();
        if (updatedOrder?.clientId) {
          await this.loadCustomerCreditLines(updatedOrder.clientId);
        }
        await this.loadSupplierCreditLines(this.activeOrderSupplier()?.companyId ?? updatedOrder?.supplierId);
        this.showCancelInquiryModal.set(false);
        this.showToast('success', `${isInquiry ? 'Inquiry' : 'Order'} cancelled.`);
        await this.normalizeDetailRoute(OrderStatus.Cancelled, id);
      } else {
        this.showToast('error', res.message ?? `Failed to cancel ${isInquiry ? 'inquiry' : 'order'}.`);
      }
    } catch {
      this.showToast('error', `Failed to cancel ${isInquiry ? 'inquiry' : 'order'}.`);
    } finally {
      this.cancellingInquiry.set(false);
    }
  }

  private async markDelivered(): Promise<void> {
    const status = this.order()?.status;
    const id = this.orderId();
    if (status !== OrderStatus.Confirmed) {
      this.showToast('error', 'Only confirmed orders can be marked as delivered.');
      return;
    }
    if (!id) return;
    if (!this.hasLineItems()) {
      this.showToast('error', 'Add at least one line item before marking delivered.');
      return;
    }
    if (!this.order()?.deliveredAt) {
      this.showToast('error', 'Enter delivered date before marking delivered.');
      return;
    }
    if (!this.deliveredQtyComplete()) {
      this.showToast('error', 'Enter delivered quantity for every line item before marking delivered.');
      return;
    }
    if (!this.hasBdrAttachment()) {
      this.showToast('error', 'Upload a BDR attachment before marking delivered.');
      return;
    }

    const normalizedRows = this.itemRows().map((row) => ({
      ...row,
      deliveredQuantity: this.getEffectiveDeliveredQuantity(row),
    }));

    try {
      await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}/items`, {
          items: this.buildItemPayload(normalizedRows, { fillMissingDeliveredQuantity: true }),
        }),
      );
      this.itemRows.set(normalizedRows);
    } catch {
      this.showToast('error', 'Failed to save delivered quantities.');
      return;
    }

    await this.setOrderStatus(OrderStatus.Delivered);
  }

  async saveOrder(): Promise<void> {
    const id = this.orderId();
    const o = this.order();
    if (!id || !o) return;

    this.saving.set(true);
    try {
      await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}`, {
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
          brokerId: o.brokerId ?? null,
          brokerContactId: o.brokerContactId ?? null,
          brokerGetsAll: o.brokerGetsAll ?? false,
          agentId: o.agentId ?? null,
          agentContactId: o.agentContactId ?? null,
          termsAndConditions: o.termsAndConditions ?? null,
          eta: o.eta,
          etd: o.etd,
          deliveredAt: o.deliveredAt ?? null,
        }),
      );

      const itemPayload = this.buildItemPayload(this.itemRows()).map((item) => ({
        ...item,
        costCurrency: item.costCurrency ?? o.currency,
        salesCurrency: item.salesCurrency ?? o.currency,
      }));

      await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}/items`, { items: itemPayload }),
      );
      await this.syncOrderSupplierRecords(id);
      await this.loadCustomerCreditLines(o.clientId);
      await this.loadSupplierCreditLines(this.activeOrderSupplier()?.companyId ?? o.supplierId);
      this.showToast('success', 'Order saved successfully.');
    } catch {
      this.showToast('error', 'Failed to save order.');
    } finally {
      this.saving.set(false);
    }
  }

  private async viewInvoicePdf(): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    if (!this.hasLineItems()) {
      this.showToast('error', 'Add at least one line item before viewing Invoice/Proforma.');
      return;
    }
    if (!this.hasBankAccount()) {
      this.showToast('error', 'Select a bank account before viewing Invoice/Proforma.');
      return;
    }
    const status = this.order()?.status;
    const isFinalInvoice = status === OrderStatus.Delivered
      || status === OrderStatus.Invoiced
      || status === OrderStatus.Paid;
    const documentTitle = isFinalInvoice ? 'Invoice' : 'Proforma Invoice';
    const endpoint = isFinalInvoice
      ? `${API_URL}/orders/${id}/invoice/pdf`
      : `${API_URL}/orders/${id}/proforma/pdf`;
    const fileName = isFinalInvoice
      ? `Fueld_Invoice_${this.invoiceNumber()}.pdf`
      : `Proforma_Invoice_${this.order()?.orderNumber ?? id}.pdf`;
    const modal = this.pdfModal();
    if (!modal) return;
    modal.showLoading(documentTitle);
    try {
      const res = await firstValueFrom(
        this.http.get(endpoint, { responseType: 'blob', observe: 'response' }),
      );
      const blob = res.body;
      if (!blob) throw new Error('Missing PDF body');
      modal.setBlob(
        blob,
        fileName,
        this.buildVerifyUrlFromResponse(res),
      );
    } catch {
      modal.showError();
      this.showToast('error', `Failed to generate ${documentTitle.toLowerCase()} PDF.`);
    }
  }

  private async viewOfferPdf(): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    const isInquiry = this.isInquiryContext();
    const documentName = isInquiry ? 'Offer' : 'Confirmation';
    if (!this.hasLineItems()) {
      this.showToast('error', `Add at least one line item before generating ${documentName} PDF.`);
      return;
    }
    if (!this.hasInvoicingCompany()) {
      this.showToast('error', `Select an invoicing company before generating ${documentName} PDF.`);
      return;
    }
    const modal = this.pdfModal();
    if (!modal) return;
    modal.showLoading(documentName);
    try {
      const res = await firstValueFrom(
        this.http.get(`${API_URL}/orders/${id}/offer/pdf`, { responseType: 'blob', observe: 'response' }),
      );
      const blob = res.body;
      if (!blob) throw new Error('Missing PDF body');
      modal.setBlob(blob, `${documentName}_${this.order()?.orderNumber ?? id}.pdf`, this.buildVerifyUrlFromResponse(res));
    } catch {
      modal.showError();
      this.showToast('error', `Failed to generate ${documentName.toLowerCase()} PDF.`);
    }
  }

  private async viewProformaPdf(): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    if (!this.hasLineItems()) {
      this.showToast('error', 'Add at least one line item before generating Nomination PDF.');
      return;
    }
    if (!this.hasSupplier()) {
      this.showToast('error', 'Select a supplier before generating Nomination PDF.');
      return;
    }
    if (!this.hasInvoicingCompany()) {
      this.showToast('error', 'Select an invoicing company before generating Nomination PDF.');
      return;
    }
    const modal = this.pdfModal();
    if (!modal) return;
    modal.showLoading('Nomination');
    const supplierQuery = this.hasMultipleOrderSuppliers() && this.activeOrderSupplier()?.id
      ? `?orderSupplierId=${encodeURIComponent(this.activeOrderSupplier()!.id)}`
      : '';
    try {
      const res = await firstValueFrom(
        this.http.get(`${API_URL}/orders/${id}/nomination/pdf${supplierQuery}`, { responseType: 'blob', observe: 'response' }),
      );
      const blob = res.body;
      if (!blob) throw new Error('Missing PDF body');
      modal.setBlob(blob, `Nomination_${this.order()?.orderNumber ?? id}.pdf`, this.buildVerifyUrlFromResponse(res));
    } catch {
      modal.showError();
      this.showToast('error', 'Failed to generate nomination PDF.');
    }
  }

  private buildVerifyUrlFromResponse(res: HttpResponse<Blob>): string | null {
    const token = res.headers.get('X-Document-Verify-Token')?.trim();
    return token ? toAbsoluteUrl(`${API_URL}/verify/token/${token}`) : null;
  }

  // ── Open compose modal for any document type ───────────────────

  openSendInquiryModal(): void {
    if (!this.hasLineItems()) {
      this.showToast('error', 'Add at least one line item before sending inquiries.');
      return;
    }
    if (!this.hasEta()) {
      this.showToast('error', 'Set an ETA before sending inquiries.');
      return;
    }
    this.inquiryModal()?.show();
  }

  onSendInquiry(payload: SendInquiryPayload): void {
    const id = this.orderId();
    if (!id) return;

    this.http
      .post<{ success: boolean; message: string; data: Array<{ recipientId: string; recipientName: string; email: string; success: boolean; error?: string }> }>(
        `${API_URL}/orders/${id}/inquiry/send`,
        {
          suppliers: payload.suppliers,
          recipientEmails: payload.recipientEmails,
          subject: payload.subject,
          htmlBody: payload.htmlBody,
          eta: payload.eta ?? null,
          etd: payload.etd ?? null,
          responseDeadlineAt: payload.responseDeadlineAt,
        },
      )
      .subscribe({
        next: (res) => {
          this.inquiryModal()?.done();
          if (res.success) {
            const successCount = res.data?.filter((r: any) => r.success).length ?? 0;
            const total = res.data?.length ?? 0;
            this.showToast('success', `Inquiry sent to ${successCount}/${total} recipients`);
            if (successCount > 0) {
              void Promise.all([
                this.loadInquiryReplies(),
                this.loadInquirySupplierContext(),
              ]);
              this.inquiryModal()?.close();
            }
          } else {
            this.showToast('error', res.message || 'Failed to send inquiries');
          }
        },
        error: () => {
          this.inquiryModal()?.done();
          this.showToast('error', 'Failed to send inquiry emails. Check SMTP settings in Admin.');
        },
      });
  }

  async onSendInquiryWhatsApp(payload: SendInquiryWhatsAppPayload): Promise<void> {
    const id = this.orderId();
    if (!id || payload.recipients.length === 0) return;

    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<Array<{ success: boolean }>>>(`${API_URL}/orders/${id}/inquiry/send-whatsapp`, {
          recipients: payload.recipients,
          subject: payload.subject,
          eta: payload.eta ?? null,
          etd: payload.etd ?? null,
          responseDeadlineAt: payload.responseDeadlineAt ?? null,
        }),
      );
      this.inquiryModal()?.waDone();

      if (!res.success) {
        this.showToast('error', res.message || 'Failed to send inquiry via WhatsApp. Is your device linked?');
        return;
      }

      const successCount = res.data?.filter((result: any) => result.success).length ?? 0;

      if (successCount > 0) {
        this.showToast('success', `Inquiry sent via WhatsApp to ${successCount}/${payload.recipients.length} recipients`);
        this.inquiryModal()?.close();
        void Promise.all([
          this.loadInquiryReplies(),
          this.loadInquirySupplierContext(),
        ]);
        return;
      }

      this.showToast('error', 'Failed to send inquiry via WhatsApp. Is your device linked?');
    } catch {
      this.inquiryModal()?.waDone();
      this.showToast('error', 'Failed to send inquiry via WhatsApp. Is your device linked?');
    }
  }

  openSendEmailModal(docType: DocumentEmailType): void {
    const id = this.orderId();
    if (!id) return;

    this.emailDocumentType.set(docType);
    const orderSupplierId = docType === 'NOMINATION' ? this.activeOrderSupplier()?.id ?? null : null;

    // Fetch pre-filled email defaults from the API
    this.http
      .post<ApiResponse<{
        recipientEmail: string;
        recipientName: string;
        ccEmails: string[];
        bccEmails: string[];
        defaultCcEmails: Array<{ email: string; label: string | null }>;
        defaultBccEmails: Array<{ email: string; label: string | null }>;
        subject: string;
        htmlBody: string;
        senderName: string;
        senderEmail: string;
      }>>(`${API_URL}/orders/${id}/email-defaults`, { documentType: docType, orderSupplierId })
      .subscribe({
        next: (res) => {
          if (!res.success || !res.data) {
            this.showToast('error', 'Failed to load email defaults.');
            return;
          }
          const d = res.data;
          this.emailPdfFileName.set(`${docType}_${this.order()?.orderNumber ?? id.slice(0, 8)}.pdf`);

          // Open the compose modal with the pre-filled data
          this.emailModal()?.showWith({
            recipientEmail: d.recipientEmail,
            ccEmails: d.ccEmails,
            bccEmails: d.bccEmails ?? [],
            defaultCcEmails: d.defaultCcEmails ?? [],
            defaultBccEmails: d.defaultBccEmails ?? [],
            subject: d.subject,
            htmlBody: d.htmlBody,
          });
        },
        error: () => {
          this.showToast('error', 'Failed to load email defaults.');
        },
      });
  }

  onSendEmail(payload: SendEmailPayload): void {
    const id = this.orderId();
    if (!id) return;

    this.http
      .post<ApiResponse<{ success: boolean; message: string; channel: string; pdfFileName: string }>>(
        `${API_URL}/orders/${id}/send-email`,
        {
          documentType: payload.documentType,
          orderSupplierId: payload.orderSupplierId ?? null,
          recipientEmail: payload.recipientEmail,
          ccEmails: payload.ccEmails,
          bccEmails: payload.bccEmails,
          subject: payload.subject,
          htmlBody: payload.htmlBody,
          attachmentIds: payload.attachmentIds,
        },
      )
      .subscribe({
        next: (res) => {
          this.emailModal()?.done();
          const channel = res.data?.channel === 'GRAPH' ? 'via Outlook' : 'via email';
          this.showToast('success', `${payload.documentType} sent to ${payload.recipientEmail} ${channel}`);
        },
        error: () => {
          this.emailModal()?.done();
          this.showToast('error', 'Failed to send email. Please check that SMTP is configured in Admin → Settings → Integrations.');
        },
      });
  }

  // ─── WhatsApp send handlers ──────────────────────────────────────

  /** Check if the current user has linked WhatsApp */
  private async checkWhatsAppLinked(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ linked: boolean; whatsappEnabled?: boolean }>>(`${API_URL}/whatsapp/status`),
      );
      if (res.success && res.data?.linked && res.data?.whatsappEnabled !== false) {
        this.waLinked.set(true);
      }
    } catch {
      // Not linked — keep default false
    }
  }

  /** Send document PDF via WhatsApp from the email modal */
  async onSendInvoiceWhatsApp(payload: SendWhatsAppPayload): Promise<void> {
    const id = this.orderId();
    if (!id) return;

    const pdfEndpoints: Record<DocumentEmailType, string> = {
      OFFER: 'offer',
      CONFIRMATION: 'offer',
      NOMINATION: 'nomination',
      PROFORMA: 'proforma',
      INVOICE: 'invoice',
    };
    const docLabels: Record<DocumentEmailType, string> = {
      OFFER: 'Offer',
      CONFIRMATION: 'Confirmation',
      NOMINATION: 'Nomination',
      PROFORMA: 'Proforma Invoice',
      INVOICE: 'Invoice',
    };

    try {
      const nominationQuery = payload.documentType === 'NOMINATION' && this.activeOrderSupplier()?.id
        ? `?orderSupplierId=${encodeURIComponent(this.activeOrderSupplier()!.id)}`
        : '';
      const blob = await firstValueFrom(
        this.http.get(`${API_URL}/orders/${id}/${pdfEndpoints[payload.documentType]}/pdf${nominationQuery}`, { responseType: 'blob' }),
      );
      const base64 = await this.blobToBase64(blob);
      const orderNum = this.order()?.orderNumber ?? id;
      const label = docLabels[payload.documentType];
      const fileName = `${label.replace(/\s+/g, '_')}_${orderNum}.pdf`;

      await firstValueFrom(
        this.http.post<ApiResponse<{ success: boolean }>>(`${API_URL}/whatsapp/send`, {
          phone: payload.phone,
          message: payload.bodyText || `${label} — ${orderNum}`,
          pdfBase64: base64,
          pdfFileName: fileName,
        }),
      );
      this.emailModal()?.waDone();
      this.showToast('success', `${label} sent via WhatsApp to ${payload.phone}`);
    } catch {
      this.emailModal()?.waDone();
      this.showToast('error', 'Failed to send via WhatsApp. Is your device linked?');
    }
  }

  /** Send an already-loaded PDF via WhatsApp from the PDF preview modal */
  async onSendPdfWhatsApp(ev: { phone: string; blob: Blob; fileName: string }): Promise<void> {
    try {
      const base64 = await this.blobToBase64(ev.blob);
      await firstValueFrom(
        this.http.post<ApiResponse<{ success: boolean }>>(`${API_URL}/whatsapp/send`, {
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
        // strip the data:…;base64, prefix
        resolve(result.split(',')[1] ?? result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  private markPaid(): void {
    if (this.order()?.status === OrderStatus.Paid) {
      this.showToast('error', 'Order is already marked as paid.');
      return;
    }
    if (!this.hasEnoughPaymentsForMarkPaid()) {
      this.showToast('error', 'Add payments equal to the total due before marking as paid.');
      this.openPaymentModal();
      return;
    }
    this.openPaymentModal();
  }

  // ─── Credit Application ──────────────────────────────────────────

  readonly showCreditApplicationModal = signal(false);

  onCreditApplicationSubmitted(): void {
    // Reload credit lines after application is submitted
    this.loadCustomerCreditLines(this.order()?.clientId);
  }

  // ─── Toast ───────────────────────────────────────────────────────

  private showToast(type: 'success' | 'error', message: string): void {
    this.toast.set({ type, message });
    setTimeout(() => this.toast.set(null), 4000);
  }
}
