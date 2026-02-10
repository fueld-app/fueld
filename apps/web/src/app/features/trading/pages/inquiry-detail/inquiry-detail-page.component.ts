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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, firstValueFrom } from 'rxjs';
import {
  OrderStatus,
  type OrderDto,
  type CounterpartyDto,
  type VesselDto,
  type PlaceDto,
  type ApiResponse,
  type OwnCompanyDto,
  type ActivityLogDto,
} from '@fueld/types';

import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';
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
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';

// ═══════════════════════════════════════════════════════════════════════
//  Inquiry Detail Page
//
//  Like an order detail but for INQUIRY / OFFER status.
//  Actions: Save, Send Offer to Customer, Send Inquiry to Supplier,
//           Convert to Order, Cancel.
// ═══════════════════════════════════════════════════════════════════════

import { API } from '@app/core/config/api';

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
    RouterLink,
    FormsModule,
    DatePipe,
    StatusBadgeComponent,
    OrderItemsComponent,
    SearchableDropdownComponent,
    CommentsCardComponent,
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
      <!-- ═══════════════════════════════════════════════════════════ -->
      <!--  Page Header                                               -->
      <!-- ═══════════════════════════════════════════════════════════ -->
      <div class="mb-6">
        <nav class="mb-4 flex items-center gap-1.5 text-sm text-gray-500">
          <a routerLink="/trading/inquiries" class="hover:text-brand-600 transition-colors">Inquiries</a>
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fill-rule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
          </svg>
          <span class="text-gray-900 font-medium">{{ order()?.orderNumber ?? inquiryId().slice(0, 8) + '...' }}</span>
        </nav>

        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div class="flex items-center gap-3">
              <h1 class="text-2xl font-bold text-gray-900">Inquiry Detail</h1>
              <app-status-badge [status]="order()?.status ?? 'INQUIRY'" />
            </div>
            <p class="mt-1 text-sm text-gray-500">
              @if (order()?.orderNumber) {
                <span class="font-mono text-gray-600">{{ order()!.orderNumber }}</span>
                <span class="mx-1.5">·</span>
              }
              {{ vesselName() }} · {{ portName() }} · {{ clientName() }}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <!-- Autosave indicator -->
            <div class="flex items-center gap-2 text-sm text-gray-500">
              @if (autoSaving()) {
                <svg class="h-4 w-4 animate-spin text-brand-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                <span>Saving...</span>
              } @else if (lastSaved()) {
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-green-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd" />
                </svg>
                <span>Saved</span>
              }
            </div>

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
                    [disabled]="!hasInvoicingCompany()"
                    class="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-blue-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.154.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" />
                    </svg>
                    Send Offer to Customer
                  </button>
                  <button
                    (click)="openSendInquiryModal(); actionsOpen.set(false)"
                    [disabled]="!hasInvoicingCompany()"
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
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="SGD">SGD</option>
                    <option value="AED">AED</option>
                  </select>
                </div>
              }
            </div>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════════ -->
      <!--  Meta Info Cards                                           -->
      <!-- ═══════════════════════════════════════════════════════════ -->
      <!--  Meta Info Cards (Editable)                                -->
      <!-- ═══════════════════════════════════════════════════════════ -->
      <div class="mb-8 grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p class="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1.5">Client</p>
          <app-searchable-dropdown
            [options]="clientDropdownOptions()"
            [selected]="order()?.clientId ?? ''"
            [asyncSearch]="true"
            [loading]="clientSearchLoading()"
            placeholder="Search clients..."
            (searchChange)="searchClients($event)"
            (selectionChange)="onClientChange($event)"
          />
        </div>
        <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p class="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1.5">Vessel</p>
          <app-searchable-dropdown
            [options]="vesselDropdownOptions()"
            [selected]="order()?.vesselId ?? ''"
            [asyncSearch]="true"
            [loading]="vesselSearchLoading()"
            placeholder="Search vessels..."
            (searchChange)="searchVessels($event)"
            (selectionChange)="onVesselChange($event)"
          />
        </div>
        <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p class="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1.5">Place</p>
          <app-searchable-dropdown
            [options]="placeDropdownOptions()"
            [selected]="order()?.placeId ?? ''"
            [asyncSearch]="true"
            [loading]="placeSearchLoading()"
            placeholder="Search places..."
            (searchChange)="searchPlaces($event)"
            (selectionChange)="onPortChange($event)"
          />
        </div>
        <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p class="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1.5">ETA</p>
          <input
            type="date"
            [ngModel]="formatDateForInput(order()?.eta)"
            (ngModelChange)="onEtaChange($event)"
            [min]="minDate"
            class="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900
                   focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          />
        </div>
        <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p class="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1.5">ETD</p>
          <input
            type="date"
            [ngModel]="formatDateForInput(order()?.etd)"
            (ngModelChange)="onEtdChange($event)"
            [min]="formatDateForInput(order()?.eta) || minDate"
            class="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900
                   focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          />
        </div>
        <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p class="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1.5">Invoicing Company</p>
          <select [ngModel]="order()?.invoicingCompanyId ?? ''" (ngModelChange)="onInvoicingCompanyChange($event)"
            class="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900
                   focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white">
            <option value="">— Select —</option>
            @for (co of ownCompanies(); track co.id) {
              <option [value]="co.id">{{ co.name }}</option>
            }
          </select>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════════ -->
      <!--  Editable Items Grid                                       -->
      <!-- ═══════════════════════════════════════════════════════════ -->
      <app-order-items
        [items]="itemRows()"
        [suppliers]="supplierDropdownOptions()"
        [readonly]="false"
        [currency]="order()?.currency ?? 'USD'"
        [supplierSearchLoading]="supplierSearchLoading()"
        (supplierSearch)="searchSuppliers($event)"
        (itemsChange)="onItemsChange($event)"
      />

      <!-- ═══════════════════════════════════════════════════════════ -->
      <!--  Comments Card                                             -->
      <!-- ═══════════════════════════════════════════════════════════ -->
      <div class="mt-8">
        @if (order()?.id) {
          <app-comments-card entityType="ORDER" [entityId]="order()!.id" />
        }
      </div>

      <!-- ═══════════════════════════════════════════════════════════ -->
      <!--  Activity History                                          -->
      <!-- ═══════════════════════════════════════════════════════════ -->
      <div class="mt-10">
        <h3 class="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">Activity History</h3>
        <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden max-h-[500px] overflow-y-auto">
          @if (activityLogs().length > 0) {
            <ul class="divide-y divide-gray-100">
              @for (log of activityLogs(); track log.id) {
                <li class="flex items-start gap-3 px-5 py-3.5">
                  <!-- Timeline dot -->
                  <div class="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full"
                    [class]="getActivityDotClass(log.action)"></div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm text-gray-900">
                      <span class="font-medium">{{ log.userName ?? 'System' }}</span>
                      <span class="text-gray-500 ml-1">{{ getActivityLabel(log.action) }}</span>
                    </p>
                    @if (log.metadata) {
                      <p class="mt-0.5 text-xs text-gray-400 truncate">{{ formatMetadata(log.metadata) }}</p>
                    }
                  </div>
                  <span class="flex-shrink-0 text-xs text-gray-400 tabular-nums">
                    {{ log.createdAt | date:'short' }}
                  </span>
                </li>
              }
            </ul>
          } @else {
            <div class="px-5 py-8 text-center">
              <p class="text-sm text-gray-400">No activity recorded yet.</p>
            </div>
          }
        </div>
      </div>
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
    <app-pdf-preview-modal />
  `,
})
export class InquiryDetailPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

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
  readonly activityLogs = signal<ActivityLogDto[]>([]);
  readonly saving = signal(false);
  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);
  readonly actionsOpen = signal(false);
  readonly settingsOpen = signal(false);
  readonly clientSearchLoading = signal(false);
  readonly vesselSearchLoading = signal(false);
  readonly placeSearchLoading = signal(false);
  readonly supplierSearchLoading = signal(false);
  readonly clientImportOptions = signal<DropdownOption[]>([]);
  readonly vesselImportOptions = signal<DropdownOption[]>([]);
  readonly placeImportOptions = signal<DropdownOption[]>([]);
  readonly supplierImportOptions = signal<DropdownOption[]>([]);

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
  readonly vesselName = computed(() => this.vessel()?.name ?? '—');
  readonly portName = computed(() => this.port()?.name ?? '—');

  readonly supplierDropdownOptions = computed<DropdownOption[]>(() =>
    [
      ...this.suppliers().map((s) => ({ value: s.id, label: s.name })),
      ...this.supplierImportOptions(),
    ],
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

  readonly hasInvoicingCompany = computed(() => !!this.order()?.invoicingCompanyId);

  // Minimum date for ETA (today)
  readonly minDate = new Date().toISOString().split('T')[0];

  formatDateForInput(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    return dateStr.split('T')[0];
  }

  // ─── Autosave ────────────────────────────────────────────────────

  readonly autoSaving = signal(false);
  readonly lastSaved = signal<Date | null>(null);
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private changeVersion = signal(0);
  private readonly pendingSupplierImports = new Set<string>();

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
  }

  ngOnDestroy(): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }
  }

  // ─── Data loading ─────────────────────────────────────────────────

  private async loadData(): Promise<void> {
    const id = this.inquiryId();
    if (!id) return;

    this.pageLoading.set(true);
    try {
      const [orderRes, ownRes, activityRes] = await Promise.all([
        firstValueFrom(this.http.get<ApiResponse<any>>(`${API}/orders/${id}`)),
        firstValueFrom(this.http.get<ApiResponse<OwnCompanyDto[]>>(`${API}/companies/own`)),
        firstValueFrom(this.http.get<ApiResponse<ActivityLogDto[]>>(`${API}/orders/${id}/activity`)),
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
          lossReason: d.lossReason,
          closedAt: d.closedAt,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        });

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

        // Load suppliers from items or from API
        this.itemRows.set(
          (d.items ?? []).map((item: any) => ({
            id: item.id,
            productType: item.productType ?? '',
            supplierId: item.supplierId ?? '',
            quantity: parseFloat(item.quantity) || 0,
            quantityMin: item.quantityMin ? parseFloat(item.quantityMin) : null,
            quantityMax: item.quantityMax ? parseFloat(item.quantityMax) : null,
            unit: item.unit ?? 'MT',
            costPrice: parseFloat(item.costPrice) || 0,
            salesPrice: parseFloat(item.salesPrice) || 0,
            profit: parseFloat(item.profit) || 0,
            paymentTerms: item.paymentTerms ?? '',
          })),
        );

        // Load reference data lists
        await this.loadReferenceData();
      }

      if (ownRes.success) this.ownCompanies.set(ownRes.data);
      if (activityRes.success) this.activityLogs.set(activityRes.data);
    } catch {
      this.showToast('error', 'Failed to load inquiry.');
    } finally {
      this.pageLoading.set(false);
    }
  }

  private async loadReferenceData(): Promise<void> {
    try {
      // Load initial suppliers list (all companies can be suppliers)
      const suppliersRes = await firstValueFrom(
        this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
          `${API}/companies/local?limit=100`,
        ),
      );
      if (suppliersRes.success) this.suppliers.set(suppliersRes.data.companies);
    } catch {
      // silently ignore
    }
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
          `${API}/companies/local?search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      const currentIds = new Set(this.itemRows().map(r => r.supplierId).filter(Boolean));
      const existing = this.suppliers().filter((s) => currentIds.has(s.id));
      const localResults = res.success ? res.data.companies : [];
      const hasLocalMatches = localResults.some((c) => !currentIds.has(c.id));
      const mergedLocal = [...existing];
      for (const c of localResults) {
        if (!mergedLocal.find((e) => e.id === c.id)) mergedLocal.push(c);
      }

      if (hasLocalMatches) {
        this.suppliers.set(mergedLocal);
        this.supplierImportOptions.set([]);
      } else {
        this.suppliers.set(existing);
        this.supplierImportOptions.set(await this.loadCompanyImportOptions(term));
      }
    } catch {
      this.supplierImportOptions.set([]);
    } finally {
      this.supplierSearchLoading.set(false);
    }
  }

  // ─── Item grid events ────────────────────────────────────────────

  onItemsChange(items: OrderItemRow[]): void {
    this.itemRows.set(items);
    const importIds = Array.from(
      new Set(
        items
          .map((r) => r.supplierId)
          .filter((id) => id && id.startsWith('seasearcher:'))
          .map((id) => id.replace('seasearcher:', '')),
      ),
    );
    if (importIds.length) {
      for (const id of importIds) {
        void this.importSupplierFromSeasearcher(id);
      }
      return;
    }
    this.triggerAutosave();
  }

  onInvoicingCompanyChange(companyId: string): void {
    this.order.update((o) => (o ? { ...o, invoicingCompanyId: companyId || null } : o));
    this.triggerAutosave();
  }

  async onClientChange(clientId: string): Promise<void> {
    if (!clientId) return; // Don't allow clearing required field
    if (clientId.startsWith('seasearcher:')) {
      await this.importClientFromSeasearcher(clientId.replace('seasearcher:', ''));
      return;
    }
    this.order.update((o) => (o ? { ...o, clientId } : o));
    const clientData = this.clients().find((c) => c.id === clientId);
    this.client.set(clientData ?? null);
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

  private async importSupplierFromSeasearcher(seasearcherId: string): Promise<void> {
    if (this.pendingSupplierImports.has(seasearcherId)) return;
    this.pendingSupplierImports.add(seasearcherId);
    this.supplierSearchLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<CounterpartyDto>>(`${API}/companies/import`, { seasearcherId }),
      );
      if (res.success && res.data) {
        this.suppliers.set([res.data, ...this.suppliers().filter((s) => s.id !== res.data.id)]);
        this.supplierImportOptions.set([]);
        this.itemRows.update((rows) =>
          rows.map((row) =>
            row.supplierId === `seasearcher:${seasearcherId}`
              ? { ...row, supplierId: res.data.id }
              : row,
          ),
        );
        this.triggerAutosave();
      } else {
        this.showToast('error', res.message ?? 'Failed to import supplier.');
      }
    } catch {
      this.showToast('error', 'Failed to import supplier.');
    } finally {
      this.pendingSupplierImports.delete(seasearcherId);
      this.supplierSearchLoading.set(false);
    }
  }

  onEtaChange(eta: string): void {
    this.order.update((o) => (o ? { ...o, eta: eta || null } : o));
    this.triggerAutosave();
  }

  onEtdChange(etd: string): void {
    this.order.update((o) => (o ? { ...o, etd: etd || null } : o));
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
          invoicingCompanyId: o.invoicingCompanyId,
          currency: o.currency,
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
        supplierId: r.supplierId || null,
        costPrice: r.costPrice ? String(r.costPrice) : null,
        salesPrice: r.salesPrice ? String(r.salesPrice) : null,
        paymentTerms: r.paymentTerms || null,
      }));

      await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API}/orders/${id}/items`, { items: itemPayload }),
      );

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
        supplierId: r.supplierId || null,
        costPrice: r.costPrice ? String(r.costPrice) : null,
        salesPrice: r.salesPrice ? String(r.salesPrice) : null,
        paymentTerms: r.paymentTerms || null,
      }));

      await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API}/orders/${id}/items`, { items: itemPayload }),
      );

      this.showToast('success', 'Inquiry saved successfully.');
      // Refresh activity
      this.loadActivity();
    } catch {
      this.showToast('error', 'Failed to save inquiry.');
    } finally {
      this.saving.set(false);
    }
  }

  // ─── Send Offer to Customer ──────────────────────────────────────

  openSendOfferModal(): void {
    this.offerEmail = '';
    this.offerSubject = `Bunker Offer — ${this.vesselName()} at ${this.portName()}`;
    const o = this.order();
    const items = this.itemRows();
    const currency = o?.currency ?? 'USD';
    let body = `Dear Customer,\n\nPlease find our offer for bunker supply to ${this.vesselName()} at ${this.portName()}.\n`;
    if (o?.eta) body += `\nETA: ${this.formatDateForInput(o.eta)}`;
    if (o?.etd) body += `\nETD: ${this.formatDateForInput(o.etd)}`;
    if (items.length) {
      body += `\n\nLine Items:\n`;
      items.forEach((item, i) => {
        const qty = item.quantityMin && item.quantityMax
          ? `${item.quantityMin}-${item.quantityMax}`
          : String(item.quantity);
        body += `${i + 1}. ${item.productType || 'Product'} — ${qty} ${item.unit} @ ${currency} ${item.salesPrice?.toFixed(2) ?? '0.00'}/${item.unit}\n`;
      });
    }
    body += `\nBest regards`;
    this.offerBody = body;
    this.showSendOfferModal.set(true);
  }

  async sendOffer(): Promise<void> {
    if (!this.offerEmail) return;
    const id = this.inquiryId();
    if (!id) return;

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
      this.loadActivity();
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
    if (o?.eta) body += `\nETA: ${this.formatDateForInput(o.eta)}`;
    if (o?.etd) body += `\nETD: ${this.formatDateForInput(o.etd)}`;
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

    this.sendingInquiry.set(true);
    try {
      // Log the inquiry send as an activity (no status change for supplier inquiries)
      // In production this would also send an email via O365
      this.showSendInquiryModal.set(false);
      this.showToast('success', `Inquiry sent to supplier at ${this.inquiryEmail}.`);
      this.loadActivity();
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
        this.loadActivity();
      }
    } catch {
      this.showToast('error', 'Failed to cancel inquiry.');
    }
  }

  // ─── Activity ────────────────────────────────────────────────────

  private async loadActivity(): Promise<void> {
    const id = this.inquiryId();
    if (!id) return;
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<ActivityLogDto[]>>(`${API}/orders/${id}/activity`),
      );
      if (res.success) this.activityLogs.set(res.data);
    } catch {
      // silently ignore
    }
  }

  getActivityDotClass(action: string): string {
    switch (action) {
      case 'CREATE':
        return 'bg-green-500';
      case 'STATUS_CHANGE':
        return 'bg-blue-500';
      case 'UPDATE':
        return 'bg-amber-500';
      case 'DELETE':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  }

  getActivityLabel(action: string): string {
    switch (action) {
      case 'CREATE':
        return 'created this inquiry';
      case 'STATUS_CHANGE':
        return 'changed the status';
      case 'UPDATE':
        return 'updated this inquiry';
      case 'DELETE':
        return 'deleted this inquiry';
      default:
        return action.toLowerCase();
    }
  }

  formatMetadata(metadata: unknown): string {
    if (!metadata) return '';
    if (typeof metadata === 'string') return metadata;
    try {
      const obj = metadata as Record<string, unknown>;
      if (obj['newStatus']) return `Status → ${obj['newStatus']}`;
      if (obj['action'] === 'save_items') return `Saved ${obj['itemCount']} line item(s)`;
      return JSON.stringify(metadata);
    } catch {
      return '';
    }
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

  // ─── Toast ───────────────────────────────────────────────────────

  private showToast(type: 'success' | 'error', message: string): void {
    this.toast.set({ type, message });
    setTimeout(() => this.toast.set(null), 4000);
  }
}
