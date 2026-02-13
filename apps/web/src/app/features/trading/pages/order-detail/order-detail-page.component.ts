import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  viewChild,
  OnInit,
  OnDestroy,
  effect,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DatePipe, DecimalPipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import {
  OrderStatus,
  PaymentTermType,
  type OrderDto,
  type CounterpartyDto,
  type VesselDto,
  type PlaceDto,
  type ApiResponse,
  type OwnCompanyDto,
  type OrderAttachmentDto,
  type CustomerPaymentDto,
  type CreditLineDto,
} from '@fueld/types';

import {
  OrderItemsComponent,
  type OrderItemRow,
} from '../../components/order-items/order-items.component';
import {
  HeaderActionsComponent,
  type HeaderAction,
} from '../../components/header-actions/header-actions.component';
import { SendEmailModalComponent } from '../../components/send-email-modal/send-email-modal.component';
import type { DropdownOption } from '../../../../shared/components/searchable-dropdown/searchable-dropdown.component';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { CommentsCardComponent } from '../../../../shared/components/comments-card/comments-card.component';
import { PdfPreviewModalComponent } from '../../../../shared/components/pdf-preview-modal/pdf-preview-modal.component';
import { ActivityTimelineComponent } from '../../../../shared/components/activity-timeline/activity-timeline.component';
import { TradingDetailHeaderComponent } from '../../components/detail-header/detail-header.component';
import { TradingDetailMetaCardsComponent } from '../../components/detail-meta-cards/detail-meta-cards.component';
import { AuthService } from '../../../../core/auth/auth.service';

// ═══════════════════════════════════════════════════════════════════════
//  Order Detail Page — Full order view with editable items grid
// ═══════════════════════════════════════════════════════════════════════

import { API_URL } from '@app/core/config/api';

interface TeamUserOption {
  id: string;
  name: string;
  email: string;
}

@Component({
  selector: 'app-order-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    DatePipe,
    DecimalPipe,
    OrderItemsComponent,
    HeaderActionsComponent,
    SendEmailModalComponent,
    CommentsCardComponent,
    ActivityTimelineComponent,
    PdfPreviewModalComponent,
    TradingDetailHeaderComponent,
    TradingDetailMetaCardsComponent,
  ],
  template: `
    <app-trading-detail-header
      title="Order Detail"
      breadcrumbLabel="Orders"
      breadcrumbLink="/trading/orders"
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
        <span class="text-gray-300">|</span>
        <span class="text-xs text-gray-500">Responsible:</span>
        <select
          [ngModel]="order()?.salesRepId ?? ''"
          (ngModelChange)="onResponsibleUserChange($event)"
          [disabled]="isReadonly()"
          class="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
        >
          <option value="">— None —</option>
          @for (u of teamUsers(); track u.id) {
            <option [value]="u.id">{{ u.name }}</option>
          }
        </select>
      </span>
      <div detail-actions class="flex items-center gap-3">
        <app-header-actions
          [orderId]="orderId()"
          [status]="order()?.status ?? null"
          (actionTriggered)="onAction($event)"
        />
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
      [canEditClient]="canEditClient()"
      [isReadonly]="isReadonly()"
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
      (responsibleChange)="onResponsibleUserChange($event)"
    >
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm h-full max-h-[260px]">
        <p class="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1.5">Customer Payment</p>
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
        }
      </div>
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm h-full max-h-[260px]">
        <p class="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1.5">Supplier Payment</p>
        @if (isReadonly()) {
          <p class="mt-1 text-sm font-semibold text-gray-900">{{ formatSupplierPaymentTerms() }}</p>
        } @else {
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
        }
      </div>
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm h-full max-h-[260px] overflow-auto">
        <div class="flex items-center gap-3 mb-1.5">
          <button
            (click)="noteTab.set('customer')"
            class="text-xs font-medium uppercase tracking-wider transition-colors"
            [class]="noteTab() === 'customer' ? 'text-brand-600' : 'text-gray-400 hover:text-gray-600'"
          >Customer Note</button>
          <button
            (click)="noteTab.set('supplier')"
            class="text-xs font-medium uppercase tracking-wider transition-colors"
            [class]="noteTab() === 'supplier' ? 'text-brand-600' : 'text-gray-400 hover:text-gray-600'"
          >Supplier Note</button>
        </div>
        @if (noteTab() === 'customer') {
          @if (isReadonly()) {
            <p class="mt-1 text-sm text-gray-700 whitespace-pre-line">{{ order()?.customerNote || '-' }}</p>
          } @else {
            <textarea
              rows="3"
              [ngModel]="order()?.customerNote ?? ''"
              (ngModelChange)="onCustomerNoteChange($event)"
              placeholder="Customer note to include in PDFs and emails"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700
                     focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            ></textarea>
          }
        } @else {
          @if (isReadonly()) {
            <p class="mt-1 text-sm text-gray-700 whitespace-pre-line">{{ order()?.supplierNote || '-' }}</p>
          } @else {
            <textarea
              rows="3"
              [ngModel]="order()?.supplierNote ?? ''"
              (ngModelChange)="onSupplierNoteChange($event)"
              placeholder="Supplier note"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700
                     focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            ></textarea>
          }
        }
      </div>
    </app-trading-detail-meta-cards>

    <!-- ═════════════════════════════════════════════════════════════ -->
    <!--  Editable Items Grid                                         -->
    <!-- ═════════════════════════════════════════════════════════════ -->
    <app-order-items
      [items]="itemRows()"
      [readonly]="isReadonly()"
      [allowDeliveredEdit]="allowDeliveredEdit()"
      [productOptionsInput]="configuredProducts()"
      [unitOptionsInput]="configuredUnits()"
      (itemsChange)="onItemsChange($event)"
    />

    <!-- Payments + Attachments + Comments + Activity (same row on desktop) -->
    @if (orderId() || order()?.id) {
      <div class="mt-6 grid grid-cols-1 gap-6 min-[900px]:grid-cols-2 min-[1600px]:grid-cols-4">
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
              <option value="BDR">BDR</option>
              <option value="OTHER">Other</option>
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
            <app-comments-card entityType="order" [entityId]="orderId()" />
          </div>
        }
        @if (order()?.id) {
          <div class="h-full max-h-[520px] overflow-auto">
            <app-activity-timeline entityType="order" [entityId]="order()!.id" />
          </div>
        }
      </div>
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
              <input
                type="text"
                [ngModel]="paymentCurrency()"
                (ngModelChange)="paymentCurrency.set($event)"
                class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 uppercase
                       focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label class="text-xs font-medium text-gray-500">Received at</label>
              <input
                type="datetime-local"
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

    <!-- Send Email Modal -->
    <app-send-email-modal
      [invoiceNumber]="invoiceNumber()"
      [vesselName]="vesselName()"
      [portName]="portName()"
      (sendEmail)="onSendEmail($event)"
    />

    <!-- PDF Preview Modal -->
    <app-pdf-preview-modal />
  `,
})
export class OrderDetailPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  readonly emailModal = viewChild(SendEmailModalComponent);
  readonly pdfModal = viewChild(PdfPreviewModalComponent);

  // ─── Route param ─────────────────────────────────────────────────

  readonly orderId = toSignal(
    this.route.paramMap.pipe(map((p) => p.get('id') ?? '')),
    { initialValue: '' },
  );

  // ─── State ───────────────────────────────────────────────────────

  readonly order = signal<OrderDto | null>(null);
  readonly client = signal<CounterpartyDto | null>(null);
  readonly vessel = signal<VesselDto | null>(null);
  readonly port = signal<PlaceDto | null>(null);
  readonly suppliers = signal<CounterpartyDto[]>([]);
  readonly clients = signal<CounterpartyDto[]>([]);
  readonly vessels = signal<VesselDto[]>([]);
  readonly places = signal<PlaceDto[]>([]);
  readonly itemRows = signal<OrderItemRow[]>([]);
  readonly saving = signal(false);
  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);
  readonly invoiceNumber = signal('');
  readonly ownCompanies = signal<OwnCompanyDto[]>([]);
  readonly teamUsers = signal<TeamUserOption[]>([]);
  readonly clientSearchLoading = signal(false);
  readonly supplierSearchLoading = signal(false);
  readonly vesselSearchLoading = signal(false);
  readonly placeSearchLoading = signal(false);
  readonly attachments = signal<OrderAttachmentDto[]>([]);
  readonly uploadingAttachment = signal(false);
  readonly attachmentType = signal<'BDR' | 'OTHER'>('OTHER');
  selectedAttachment: File | null = null;
  readonly payments = signal<CustomerPaymentDto[]>([]);
  readonly paymentsLoading = signal(false);
  readonly customerCreditLines = signal<CreditLineDto[]>([]);
  readonly customerCreditLoading = signal(false);
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
  readonly configuredProducts = signal<DropdownOption[]>([]);
  readonly configuredUnits = signal<DropdownOption[]>([]);

  // ─── Autosave ────────────────────────────────────────────────────

  readonly autoSaving = signal(false);
  readonly lastSaved = signal<Date | null>(null);
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private changeVersion = signal(0);

  // ─── Computed ────────────────────────────────────────────────────

  readonly clientName = computed(() => this.client()?.name ?? '—');
  readonly supplierName = computed(() => {
    const id = this.order()?.supplierId;
    if (!id) return '—';
    return this.suppliers().find((s) => s.id === id)?.name ?? '—';
  });
  readonly vesselName = computed(() => this.vessel()?.name ?? '—');
  readonly portName = computed(() => this.port()?.name ?? '—');
  readonly subtitle = computed(() => '');
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
    return status === OrderStatus.Delivered || status === OrderStatus.Invoiced;
  });

  readonly isPaidOrCancelled = computed(() => {
    const status = this.order()?.status;
    return status === OrderStatus.Paid || status === OrderStatus.Cancelled;
  });

  readonly canRecordPayment = computed(() => this.order()?.status !== OrderStatus.Cancelled);

  readonly canEditClient = computed(() => !this.isPaidOrCancelled());

  readonly isResponsibleUser = computed(() => {
    const currentUserId = this.auth.user()?.id ?? '';
    return !!currentUserId && this.order()?.salesRepId === currentUserId;
  });

  readonly supplierDropdownOptions = computed<DropdownOption[]>(() =>
    this.suppliers().map((s) => ({ value: s.id, label: s.name })),
  );

  readonly clientDropdownOptions = computed<DropdownOption[]>(() =>
    this.clients().map((c) => ({ value: c.id, label: c.name })),
  );

  readonly vesselDropdownOptions = computed<DropdownOption[]>(() =>
    this.vessels().map((v) => ({ value: v.id, label: v.name })),
  );

  readonly placeDropdownOptions = computed<DropdownOption[]>(() =>
    this.places().map((p) => ({ value: p.id, label: p.name })),
  );

  readonly responsibleUserOptions = computed<DropdownOption[]>(() =>
    this.teamUsers().map((u) => ({ value: u.id, label: u.name })),
  );

  readonly placeTimezone = computed(() => this.port()?.timezone ?? 'UTC');
  readonly minDateTime = computed(() =>
    this.formatDateTimeForInput(new Date(), this.placeTimezone()),
  );
  readonly etaMinDateTime = computed(() => {
    const eta = this.order()?.eta;
    if (eta) return this.formatDateTimeForInput(new Date(eta), this.placeTimezone());
    return this.minDateTime();
  });

  readonly paymentsTotal = computed(() =>
    this.payments().reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0),
  );

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
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
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
  }

  ngOnInit(): void {
    this.loadOrder();
  }

  ngOnDestroy(): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
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
          currency: d.currency ?? 'USD',
          status: d.status,
          eta: d.eta,
          etd: d.etd,
          customerPaymentTermType: d.customerPaymentTermType ?? null,
          customerCreditDays: d.customerCreditDays ?? null,
          customerNote: d.customerNote ?? null,
          supplierId: d.supplierId ?? null,
          supplierPaymentTermType: d.supplierPaymentTermType ?? null,
          supplierCreditDays: d.supplierCreditDays ?? null,
          supplierNote: d.supplierNote ?? null,
          lossReason: d.lossReason,
          closedAt: d.closedAt,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        });

        if (d.client) this.client.set(d.client);
        if (d.client) this.clients.set([d.client]);
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
            productType: item.productType ?? '',
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

        await this.loadCustomerCreditLines(d.clientId);
        await this.loadSupplierCreditLines(d.supplierId);
        await this.loadReferenceData();
      }

      if (ownRes.success) this.ownCompanies.set(ownRes.data);
      await this.loadAttachments();
      await this.loadPayments();
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
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ items: CreditLineDto[]; total: number }>>(
          `${API_URL}/credit/lines?type=CUSTOMER&counterpartyId=${encodeURIComponent(counterpartyId)}&limit=50`,
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
    this.paymentReceivedAt.set(this.formatDateTimeForInput(new Date(), this.placeTimezone()));
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
    const amount = this.paymentAmount().trim();
    if (!amount) {
      this.showToast('error', 'Amount is required.');
      return;
    }

    this.paymentSaving.set(true);
    try {
      const receivedAt = this.paymentReceivedAt();
      const receivedIso = receivedAt ? new Date(receivedAt).toISOString() : undefined;
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
      const [suppliersRes, usersRes, productsRes, unitsRes] = await Promise.all([
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
      ]);
      if (suppliersRes.success) this.suppliers.set(suppliersRes.data.companies);
      if (usersRes.success) this.teamUsers.set(usersRes.data ?? []);
      if (productsRes.success) this.configuredProducts.set(
        productsRes.data.products.map((p) => ({ value: p, label: p })),
      );
      if (unitsRes.success) this.configuredUnits.set(
        unitsRes.data.units.map((u) => ({ value: u, label: u })),
      );
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
    const type = this.order()?.supplierPaymentTermType;
    if (!type) return '-';
    if (type === 'CREDIT') {
      const days = this.order()?.supplierCreditDays ?? 0;
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

  onResponsibleUserChange(userId: string): void {
    this.order.update((o) => (o ? { ...o, salesRepId: userId || null } : o));
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
        if (this.attachmentType() === 'BDR') {
          const confirmDelivered = confirm('BDR uploaded. Mark order as delivered?');
          if (confirmDelivered) {
            await this.setOrderStatus(OrderStatus.Delivered);
            this.itemRows.update((rows) =>
              rows.map((row) => ({
                ...row,
                quantity: row.quantity,
              })),
            );
            this.triggerAutosave();
          }
        }
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
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
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

  // ─── Item grid events ────────────────────────────────────────────

  onItemsChange(items: OrderItemRow[]): void {
    this.itemRows.set(items);
    this.triggerAutosave();
  }

  onInvoicingCompanyChange(companyId: string): void {
    this.order.update((o) => o ? { ...o, invoicingCompanyId: companyId || null } : o);
    this.triggerAutosave();
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
    this.order.update((o) => (o ? { ...o, clientId } : o));
    const clientData = this.clients().find((c) => c.id === clientId);
    this.client.set(clientData ?? null);
    void this.loadCustomerCreditLines(clientId);
    this.triggerAutosave();
  }

  onSupplierChange(supplierId: string): void {
    if (!supplierId) return;
    this.order.update((o) => (o ? { ...o, supplierId } : o));
    void this.loadSupplierCreditLines(supplierId);
    this.triggerAutosave();
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
    this.order.update((o) => (o ? { ...o, placeId } : o));
    const placeData = this.places().find((p) => p.id === placeId);
    this.port.set(placeData ?? null);
    this.triggerAutosave();
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
          customerPaymentTermType: o.customerPaymentTermType ?? null,
          customerCreditDays: o.customerCreditDays ?? null,
          customerNote: o.customerNote ?? null,
          supplierId: o.supplierId ?? null,
          supplierPaymentTermType: o.supplierPaymentTermType ?? null,
          supplierCreditDays: o.supplierCreditDays ?? null,
          supplierNote: o.supplierNote ?? null,
          eta: o.eta,
          etd: o.etd,
        }),
      );

      const itemPayload = this.itemRows().map((r) => ({
        productType: r.productType,
        quantity: String(r.quantity),
        quantityMin: r.quantityMin != null ? String(r.quantityMin) : null,
        quantityMax: String(r.quantityMax ?? r.quantity),
        unit: r.unit,
        costPrice: r.costPrice ? String(r.costPrice) : null,
        costCurrency: r.costCurrency ?? o.currency,
        salesPrice: r.salesPrice ? String(r.salesPrice) : null,
        salesCurrency: r.salesCurrency ?? o.currency,
        paymentTerms: r.paymentTerms || null,
        customerNote: r.customerNote ?? null,
      }));

      await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}/items`, { items: itemPayload }),
      );
      await this.loadCustomerCreditLines(o.clientId);
      await this.loadSupplierCreditLines(o.supplierId);
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
        this.viewInvoicePdf();
        break;
      case 'view-offer':
        this.viewOfferPdf();
        break;
      case 'view-proforma':
        this.viewProformaPdf();
        break;
      case 'send-email':
        if (!this.isResponsibleUser()) {
          this.showToast('error', 'Only the responsible user can send this email.');
          break;
        }
        this.emailModal()?.show();
        break;
      case 'mark-paid':
        this.markPaid();
        break;
    }
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
          customerPaymentTermType: o.customerPaymentTermType ?? null,
          customerCreditDays: o.customerCreditDays ?? null,
          customerNote: o.customerNote ?? null,
          supplierId: o.supplierId ?? null,
          supplierPaymentTermType: o.supplierPaymentTermType ?? null,
          supplierCreditDays: o.supplierCreditDays ?? null,
          supplierNote: o.supplierNote ?? null,
          eta: o.eta,
          etd: o.etd,
        }),
      );

      const itemPayload = this.itemRows().map((r) => ({
        productType: r.productType,
        quantity: String(r.quantity),
        quantityMin: r.quantityMin != null ? String(r.quantityMin) : null,
        quantityMax: String(r.quantityMax ?? r.quantity),
        unit: r.unit,
        costPrice: r.costPrice ? String(r.costPrice) : null,
        costCurrency: r.costCurrency ?? o.currency,
        salesPrice: r.salesPrice ? String(r.salesPrice) : null,
        salesCurrency: r.salesCurrency ?? o.currency,
        paymentTerms: r.paymentTerms || null,
        customerNote: r.customerNote ?? null,
      }));

      await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}/items`, { items: itemPayload }),
      );
      await this.loadCustomerCreditLines(o.clientId);
      await this.loadSupplierCreditLines(o.supplierId);
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
    if (!this.canGenerateInvoice()) {
      this.showToast('error', 'Invoice can be generated after delivery.');
      return;
    }
    const modal = this.pdfModal();
    if (!modal) return;
    modal.showLoading('Invoice');
    try {
      const blob = await firstValueFrom(
        this.http.get(`${API_URL}/orders/${id}/invoice/pdf`, { responseType: 'blob' }),
      );
      modal.setBlob(blob, `Fueld_Invoice_${this.invoiceNumber()}.pdf`);
    } catch {
      modal.showError();
      this.showToast('error', 'Failed to generate invoice PDF.');
    }
  }

  private async viewOfferPdf(): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    const modal = this.pdfModal();
    if (!modal) return;
    modal.showLoading('Offer');
    try {
      const blob = await firstValueFrom(
        this.http.get(`${API_URL}/orders/${id}/offer/pdf`, { responseType: 'blob' }),
      );
      modal.setBlob(blob, `Confirmation_${this.order()?.orderNumber ?? id}.pdf`);
    } catch {
      modal.showError();
      this.showToast('error', 'Failed to generate offer PDF.');
    }
  }

  private async viewProformaPdf(): Promise<void> {
    const id = this.orderId();
    if (!id) return;
    const modal = this.pdfModal();
    if (!modal) return;
    modal.showLoading('Proforma Invoice');
    try {
      const blob = await firstValueFrom(
        this.http.get(`${API_URL}/orders/${id}/proforma/pdf`, { responseType: 'blob' }),
      );
      modal.setBlob(blob, `Nomination_${this.order()?.orderNumber ?? id}.pdf`);
    } catch {
      modal.showError();
      this.showToast('error', 'Failed to generate proforma invoice PDF.');
    }
  }

  onSendEmail(recipientEmail: string): void {
    const id = this.orderId();
    if (!id) return;
    if (!this.isResponsibleUser()) {
      this.emailModal()?.done();
      this.showToast('error', 'Only the responsible user can send this email.');
      return;
    }

    this.http
      .post<ApiResponse<{ success: boolean; message: string }>>(
        `${API_URL}/orders/${id}/invoice/send`,
        {
          recipientEmail,
          vesselName: this.vesselName(),
          portName: this.portName(),
          // In production, the O365 token would come from the auth layer
          accessToken: 'placeholder-o365-token',
        },
      )
      .subscribe({
        next: () => {
          this.emailModal()?.done();
          this.showToast('success', `Invoice sent to ${recipientEmail}`);
        },
        error: () => {
          this.emailModal()?.done();
          this.showToast('error', 'Failed to send email. Check O365 token.');
        },
      });
  }

  private markPaid(): void {
    if (this.order()?.status === OrderStatus.Paid) {
      this.showToast('error', 'Order is already marked as paid.');
      return;
    }
    this.openPaymentModal();
  }

  private canGenerateInvoice(): boolean {
    const status = this.order()?.status;
    return status === OrderStatus.Delivered
      || status === OrderStatus.Invoiced
      || status === OrderStatus.Paid;
  }

  // ─── Toast ───────────────────────────────────────────────────────

  private showToast(type: 'success' | 'error', message: string): void {
    this.toast.set({ type, message });
    setTimeout(() => this.toast.set(null), 4000);
  }
}
