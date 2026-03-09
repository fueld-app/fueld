import {
  Component,
  ChangeDetectionStrategy,
  signal,
  effect,
  inject,
  OnInit,
  OnDestroy,
  computed,
  input,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink, Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';
import { SearchableDropdownComponent, type DropdownOption } from '../../../../shared/components/searchable-dropdown/searchable-dropdown.component';
import { PaginationComponent, SortHeaderComponent } from '../../../../shared/components';
import type { SortChangeEvent } from '../../../../shared/components';
import type { ApiResponse, OrderListRowDto, CounterpartyDto, VesselDto, PlaceDto } from '@fueld/types';
import { DecimalPipe, DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';

// ═══════════════════════════════════════════════════════════════════════
//  Inquiries List Page — INQUIRY + OFFER status orders
// ═══════════════════════════════════════════════════════════════════════

import { API } from '@app/core/config/api';
import { NewInquiryModalService } from '@app/core/trading/new-inquiry-modal.service';

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
  selector: 'app-inquiries-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusBadgeComponent, FormsModule, DecimalPipe, DatePipe, SearchableDropdownComponent, PaginationComponent, SortHeaderComponent],
  template: `
    <div>
      <!-- Header -->
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900">{{ titleText() }}</h1>
        <p class="mt-1 text-sm text-gray-500">{{ subtitleText() }}</p>
      </div>

      <!-- Search bar -->
      <div class="mb-4">
        <input
          type="text"
          [ngModel]="searchTerm()"
          (ngModelChange)="onSearch($event)"
          [placeholder]="searchPlaceholder()"
          class="w-full max-w-md rounded-lg border border-gray-300 px-4 py-2.5 text-sm shadow-sm
                 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none
                 focus:ring-2 focus:ring-brand-500/20"
        />
      </div>

      <!-- Loading state -->
      @if (loading()) {
        <div class="flex items-center justify-center py-20">
          <svg class="h-8 w-8 animate-spin text-brand-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else {
        <!-- Desktop table -->
        <div class="hidden md:block overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200 bg-gray-50/80">
                <th app-sort-header field="orderNumber" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">No.</th>
                <th app-sort-header field="client" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">Client</th>
                <th app-sort-header field="vessel" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">Vessel</th>
                <th app-sort-header field="port" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">Port</th>
                <th app-sort-header field="status" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th app-sort-header field="responsible" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">Responsible</th>
                <th app-sort-header field="eta" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">ETA</th>
                <th class="px-4 py-3 text-right font-medium text-gray-600">Value</th>
                @if (isOrders()) {
                  <th class="px-4 py-3 text-right font-medium text-gray-600">Gross</th>
                  <th class="px-4 py-3 text-right font-medium text-gray-600">Financing</th>
                  <th class="px-4 py-3 text-right font-medium text-gray-600">Net</th>
                }
                <th app-sort-header field="createdAt" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">Created</th>
                <th class="px-4 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              @for (inq of inquiries(); track inq.id) {
                <tr class="transition-colors hover:bg-gray-50/50 cursor-pointer" (click)="goToDetail(inq.orderNumber || inq.id)">
                  <td class="px-4 py-3 font-mono text-xs text-gray-500">{{ inq.orderNumber ?? '—' }}</td>
                  <td class="px-4 py-3 font-medium text-gray-900">{{ inq.clientName }}</td>
                  <td class="px-4 py-3 text-gray-600">{{ inq.vesselName }}</td>
                  <td class="px-4 py-3 text-gray-600">{{ inq.placeName }}</td>
                  <td class="px-4 py-3">
                    <app-status-badge [status]="inq.status" />
                  </td>
                  <td class="px-4 py-3 text-gray-600">{{ inq.salesRepName || '—' }}</td>
                  <td class="px-4 py-3 text-gray-500">{{ inq.eta ? (inq.eta | date:'mediumDate') : '—' }}</td>
                  <td class="px-4 py-3 text-right tabular-nums text-gray-900">
                    @if (inq.totalValue > 0) {
                      {{ inq.totalValue | number:'1.2-2' }} {{ inq.displayCurrency || 'USD' }}
                    } @else {
                      <span class="text-gray-400">—</span>
                    }
                  </td>
                  @if (isOrders()) {
                    <td class="px-4 py-3 text-right tabular-nums" [class.text-green-600]="inq.totalProfit > 0" [class.text-red-600]="inq.totalProfit < 0">
                      @if (inq.totalValue > 0 || inq.totalProfit !== 0) {
                        {{ inq.totalProfit | number:'1.2-2' }} {{ inq.displayCurrency || 'USD' }}
                      } @else {
                        <span class="text-gray-400">—</span>
                      }
                    </td>
                    <td class="px-4 py-3 text-right tabular-nums text-amber-700">
                      @if (inq.totalValue > 0 || (inq.totalFinancingCost ?? 0) !== 0) {
                        {{ (inq.totalFinancingCost ?? 0) | number:'1.2-2' }} {{ inq.displayCurrency || 'USD' }}
                      } @else {
                        <span class="text-gray-400">—</span>
                      }
                    </td>
                    <td class="px-4 py-3 text-right tabular-nums" [class.text-green-600]="(inq.totalNetProfit ?? 0) > 0" [class.text-red-600]="(inq.totalNetProfit ?? 0) < 0">
                      @if (inq.totalValue > 0 || (inq.totalNetProfit ?? 0) !== 0) {
                        {{ (inq.totalNetProfit ?? 0) | number:'1.2-2' }} {{ inq.displayCurrency || 'USD' }}
                      } @else {
                        <span class="text-gray-400">—</span>
                      }
                    </td>
                  }
                  <td class="px-4 py-3 text-gray-500">{{ inq.createdAt | date:'mediumDate' }}</td>
                  <td class="px-4 py-3">
                    <a
                      [routerLink]="[baseRoute(), inq.orderNumber || inq.id]"
                      class="rounded-md p-1 text-gray-400 hover:text-brand-600 transition-colors"
                      [attr.aria-label]="isOrders() ? 'View order' : 'View inquiry'"
                      (click)="$event.stopPropagation()"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fill-rule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                      </svg>
                    </a>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td [attr.colspan]="isOrders() ? 13 : 10" class="px-4 py-12 text-center">
                    <p class="text-sm text-gray-400">{{ isOrders() ? 'No orders found.' : 'No inquiries found.' }}</p>
                    @if (!isOrders()) {
                      <button
                        (click)="showNewInquiryModal.set(true)"
                        class="mt-2 text-sm font-medium text-brand-600 hover:text-brand-700"
                      >
                        + Create your first inquiry
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <app-pagination
          [currentPage]="currentPage()"
          [totalItems]="totalItems()"
          [pageSize]="pageSize()"
          (pageChange)="goToPage($event)"
        />

        <!-- Mobile cards -->
        <div class="space-y-3 md:hidden">
          @for (inq of inquiries(); track inq.id) {
            <a
              [routerLink]="[baseRoute(), inq.orderNumber || inq.id]"
              class="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
            >
              <div class="flex items-center justify-between mb-2">
                <span class="font-semibold text-gray-900">{{ inq.clientName }}</span>
                <app-status-badge [status]="inq.status" />
              </div>
              @if (inq.orderNumber) {
                <p class="text-xs font-mono text-gray-400 mb-1">{{ inq.orderNumber }}</p>
              }
              <div class="grid grid-cols-2 gap-1 text-xs text-gray-500">
                <span>{{ inq.vesselName }}</span>
                <span>{{ inq.placeName }}</span>
                <span>ETA {{ inq.eta ? (inq.eta | date:'mediumDate') : '—' }}</span>
                <span>Resp {{ inq.salesRepName || '—' }}</span>
                <span>{{ inq.createdAt | date:'mediumDate' }}</span>
              </div>
              @if (isOrders()) {
                <div class="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs">
                  <div>
                    <p class="text-[11px] uppercase tracking-wide text-gray-500">Gross</p>
                    <p class="mt-1 font-semibold tabular-nums" [class.text-green-600]="inq.totalProfit > 0" [class.text-red-600]="inq.totalProfit < 0">
                      {{ inq.totalProfit | number:'1.2-2' }} {{ inq.displayCurrency || 'USD' }}
                    </p>
                  </div>
                  <div>
                    <p class="text-[11px] uppercase tracking-wide text-amber-700">Financing</p>
                    <p class="mt-1 font-semibold tabular-nums text-amber-700">
                      {{ (inq.totalFinancingCost ?? 0) | number:'1.2-2' }} {{ inq.displayCurrency || 'USD' }}
                    </p>
                  </div>
                  <div>
                    <p class="text-[11px] uppercase tracking-wide text-gray-500">Net</p>
                    <p class="mt-1 font-semibold tabular-nums" [class.text-green-600]="(inq.totalNetProfit ?? 0) > 0" [class.text-red-600]="(inq.totalNetProfit ?? 0) < 0">
                      {{ (inq.totalNetProfit ?? 0) | number:'1.2-2' }} {{ inq.displayCurrency || 'USD' }}
                    </p>
                  </div>
                  <div>
                    <p class="text-[11px] uppercase tracking-wide text-gray-500">Net Margin</p>
                    <p class="mt-1 font-semibold tabular-nums text-gray-700">
                      Net Margin {{ (inq.netMarginPct ?? 0) | number:'1.2-2' }}%
                    </p>
                  </div>
                </div>
              }
            </a>
          } @empty {
            <div class="rounded-xl border-2 border-dashed border-gray-300 bg-white p-8 text-center">
              <p class="text-sm text-gray-400">{{ isOrders() ? 'No orders yet.' : 'No inquiries yet.' }}</p>
              @if (!isOrders()) {
                <button
                  (click)="showNewInquiryModal.set(true)"
                  class="mt-2 text-sm font-medium text-brand-600 hover:text-brand-700"
                >
                  + Create your first inquiry
                </button>
              }
            </div>
          }
        </div>
      }
    </div>

    <!-- ═════════════════════════════════════════════════════════════ -->
    <!--  New Inquiry Modal                                           -->
    <!-- ═════════════════════════════════════════════════════════════ -->
    @if (showNewInquiryModal() && !isOrders()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div class="w-full max-w-lg rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true">
          <div class="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <h2 class="text-lg font-semibold text-gray-900">New Inquiry</h2>
            <button
              (click)="showNewInquiryModal.set(false)"
              class="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>

          <div class="space-y-4 px-6 py-5">
            <!-- Client -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1.5">Client</label>
              <app-searchable-dropdown
                [options]="clientOptions()"
                [selected]="newClientId()"
                [asyncSearch]="true"
                [loading]="clientSearchLoading()"
                placeholder="Search clients..."
                (searchChange)="searchClients($event)"
                (selectionChange)="onNewClientChange($event)"
              />
            </div>

            <!-- Vessel -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1.5">Vessel</label>
              <app-searchable-dropdown
                [options]="vesselOptions()"
                [selected]="newVesselId()"
                [asyncSearch]="true"
                [loading]="vesselSearchLoading()"
                placeholder="Search vessels..."
                (searchChange)="searchVessels($event)"
                (selectionChange)="onNewVesselChange($event)"
              />
            </div>

            <!-- Port -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1.5">Port</label>
              <app-searchable-dropdown
                [options]="placeOptions()"
                [selected]="newPlaceId()"
                [asyncSearch]="true"
                [loading]="placeSearchLoading()"
                placeholder="Search ports..."
                (searchChange)="searchPlaces($event)"
                (selectionChange)="onNewPlaceChange($event)"
              />
            </div>

            <!-- ETA/ETD date range -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label for="new-eta" class="block text-sm font-medium text-gray-700 mb-1.5">ETA</label>
                <input
                  id="new-eta"
                  type="date"
                  [min]="minDate"
                  [ngModel]="newEta()"
                  (ngModelChange)="onEtaChange($event)"
                  class="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm
                         focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
              <div>
                <label for="new-etd" class="block text-sm font-medium text-gray-700 mb-1.5">ETD <span class="text-gray-400 font-normal">(optional)</span></label>
                <input
                  id="new-etd"
                  type="date"
                  [min]="etdMinDate()"
                  [ngModel]="newEtd()"
                  (ngModelChange)="newEtd.set($event)"
                  class="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm
                         focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
            </div>
          </div>

          <div class="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
            <button
              (click)="showNewInquiryModal.set(false)"
              class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700
                     shadow-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              (click)="createInquiry()"
              [disabled]="creating() || !canCreateInquiry()"
              class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold
                     text-white shadow-sm transition-colors hover:bg-brand-700
                     disabled:opacity-50 disabled:cursor-not-allowed"
            >
              @if (creating()) {
                <svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              }
              Create Inquiry
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Toast -->
    @if (toast()) {
      <div
        class="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg"
        [class]="toast()!.type === 'success'
          ? 'border-green-200 bg-green-50 text-green-800'
          : 'border-red-200 bg-red-50 text-red-800'"
      >
        {{ toast()!.message }}
      </div>
    }
  `,
})
export class InquiriesListPageComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly newInquiryModal = inject(NewInquiryModalService);
  private queryParamSub?: Subscription;

  readonly mode = input<'inquiries' | 'active-orders' | 'completed-orders' | 'cancelled-orders' | undefined>('inquiries');
  readonly resolvedMode = computed(() => this.mode() ?? 'inquiries');

  readonly isOrders = computed(() => this.resolvedMode() !== 'inquiries');
  readonly isActiveOrders = computed(() => this.resolvedMode() === 'active-orders');
  readonly isCompletedOrders = computed(() => this.resolvedMode() === 'completed-orders');
  readonly isCancelledOrders = computed(() => this.resolvedMode() === 'cancelled-orders');
  readonly baseRoute = computed(() => (
    this.isActiveOrders()
      ? '/trading/orders'
      : this.isCompletedOrders()
        ? '/trading/completed-orders'
        : this.isCancelledOrders()
          ? '/trading/cancelled-orders'
          : '/trading/inquiries'
  ));
  readonly titleText = computed(() => (
    this.isActiveOrders()
      ? 'Active Orders'
      : this.isCompletedOrders()
        ? 'Completed Orders'
        : this.isCancelledOrders()
          ? 'Cancelled Orders'
        : 'Inquiries'
  ));
  readonly subtitleText = computed(() =>
    this.isActiveOrders()
      ? 'Orders waiting for delivery or payment.'
      : this.isCompletedOrders()
        ? 'Orders that are paid and delivered.'
        : this.isCancelledOrders()
          ? 'Orders that have been cancelled.'
        : 'Manage bunker inquiries and offers before confirmation.',
  );
  readonly searchPlaceholder = computed(() =>
    this.isOrders()
      ? 'Search by client, vessel or port...'
      : 'Search by client, vessel or port...',
  );

  // ─── State ───────────────────────────────────────────────────────

  readonly inquiries = signal<OrderListRowDto[]>([]);
  readonly loading = signal(false);
  readonly totalItems = signal(0);
  readonly currentPage = signal(1);
  readonly pageSize = signal(25);
  readonly searchTerm = signal('');
  readonly sortBy = signal('');
  readonly sortDir = signal<'asc' | 'desc'>('asc');
  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);

  // ─── New inquiry modal ────────────────────────────────────────────

  readonly showNewInquiryModal = signal(false);
  readonly creating = signal(false);
  readonly clients = signal<CounterpartyDto[]>([]);
  readonly vesselsList = signal<VesselDto[]>([]);
  readonly placesList = signal<PlaceDto[]>([]);
  readonly selectedClient = signal<CounterpartyDto | null>(null);
  readonly selectedVessel = signal<VesselDto | null>(null);
  readonly selectedPlace = signal<PlaceDto | null>(null);
  readonly clientSearchLoading = signal(false);
  readonly vesselSearchLoading = signal(false);
  readonly placeSearchLoading = signal(false);
  readonly clientImportOptions = signal<DropdownOption[]>([]);
  readonly vesselImportOptions = signal<DropdownOption[]>([]);
  readonly placeImportOptions = signal<DropdownOption[]>([]);

  readonly clientOptions = computed<DropdownOption[]>(() =>
    [
      ...this.clients().map((c) => ({ value: c.id, label: c.name })),
      ...this.clientImportOptions(),
    ],
  );
  readonly vesselOptions = computed<DropdownOption[]>(() =>
    [
      ...this.vesselsList().map((v) => ({ value: v.id, label: v.name })),
      ...this.vesselImportOptions(),
    ],
  );
  readonly placeOptions = computed<DropdownOption[]>(() =>
    [
      ...this.placesList().map((p) => ({ value: p.id, label: p.name })),
      ...this.placeImportOptions(),
    ],
  );

  readonly newClientId = signal('');
  readonly newVesselId = signal('');
  readonly newPlaceId = signal('');
  readonly newEta = signal('');
  readonly newEtd = signal('');

  /** Today's date in YYYY-MM-DD format for min attribute */
  readonly minDate = new Date().toISOString().split('T')[0];

  /** ETD min is ETA if set, otherwise today */
  readonly etdMinDate = computed(() => this.newEta() || this.minDate);

  readonly canCreateInquiry = computed(
    () => !!this.newClientId() && !!this.newVesselId() && !!this.newPlaceId(),
  );
  private lastHandledNewInquiryRequestId = 0;

  constructor() {
    effect(() => {
      const requestId = this.newInquiryModal.requestId();
      if (requestId > this.lastHandledNewInquiryRequestId) {
        this.showNewInquiryModal.set(true);
        this.lastHandledNewInquiryRequestId = requestId;
      }
    });
  }

  // ─── Lifecycle ────────────────────────────────────────────────────

  ngOnInit(): void {
    this.loadInquiries();
    if (!this.isOrders()) {
      this.loadDropdownData();

      // Auto-open modal when navigated with ?new=1 (e.g. from navbar button)
      this.queryParamSub = this.route.queryParamMap.subscribe((params) => {
        if (params.get('new') === '1') {
          this.showNewInquiryModal.set(true);
          this.router.navigate([], { queryParams: {}, replaceUrl: true });
        }
      });
    }
  }

  ngOnDestroy(): void {
    this.queryParamSub?.unsubscribe();
  }

  // ─── Data loading ─────────────────────────────────────────────────

  async loadInquiries(): Promise<void> {
    this.loading.set(true);
    try {
      const params = new URLSearchParams();
      if (this.isActiveOrders()) {
        params.set('statuses', 'CONFIRMED,DELIVERED,INVOICED');
      } else if (this.isCompletedOrders()) {
        params.set('statuses', 'PAID');
      } else if (this.isCancelledOrders()) {
        params.set('statuses', 'CANCELLED');
      } else {
        params.set('statuses', 'INQUIRY,OFFER');
      }
      params.set('page', String(this.currentPage()));
      params.set('limit', String(this.pageSize()));
      if (this.searchTerm()) params.set('search', this.searchTerm());
      if (this.sortBy()) params.set('sortBy', this.sortBy());
      if (this.sortBy()) params.set('sortDir', this.sortDir());

      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ items: OrderListRowDto[]; total: number }>>(
          `${API}/orders?${params.toString()}`,
        ),
      );
      if (res.success) {
        this.inquiries.set(res.data.items);
        this.totalItems.set(res.data.total);
      }
    } catch {
      this.showToast('error', 'Failed to load inquiries.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadDropdownData(): Promise<void> {
    try {
      const [clientsRes, vesselsRes, placesRes] = await Promise.all([
        firstValueFrom(this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(`${API}/companies/local?type=CLIENT&limit=500`)),
        firstValueFrom(this.http.get<ApiResponse<{ vessels: VesselDto[]; total: number }>>(`${API}/vessels/local?limit=500`)),
        firstValueFrom(this.http.get<ApiResponse<{ places: PlaceDto[]; total: number }>>(`${API}/lloyds/places/local?limit=500`)),
      ]);
      if (clientsRes.success) this.clients.set(clientsRes.data.companies);
      if (vesselsRes.success) this.vesselsList.set(vesselsRes.data.vessels);
      if (placesRes.success) this.placesList.set(placesRes.data.places);
    } catch {
      // silently ignore — dropdowns will be empty
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
      const current = this.selectedClient();
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
      const current = this.selectedVessel();
      const localResults = res.success ? res.data.vessels : [];
      const localMatches = current
        ? localResults.filter((v) => v.id !== current.id)
        : localResults;
      const hasLocalMatches = localMatches.length > 0;
      const mergedLocal = current && !localResults.find((v) => v.id === current.id)
        ? [current, ...localResults]
        : localResults;

      if (hasLocalMatches) {
        this.vesselsList.set(mergedLocal);
        this.vesselImportOptions.set([]);
      } else {
        this.vesselsList.set(current ? [current] : []);
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
      const current = this.selectedPlace();
      const localResults = res.success ? res.data.places : [];
      const localMatches = current
        ? localResults.filter((p) => p.id !== current.id)
        : localResults;
      const hasLocalMatches = localMatches.length > 0;
      const mergedLocal = current && !localResults.find((p) => p.id === current.id)
        ? [current, ...localResults]
        : localResults;

      if (hasLocalMatches) {
        this.placesList.set(mergedLocal);
        this.placeImportOptions.set([]);
      } else {
        this.placesList.set(current ? [current] : []);
        this.placeImportOptions.set(await this.loadPlaceImportOptions(term));
      }
    } catch {
      this.placeImportOptions.set([]);
    } finally {
      this.placeSearchLoading.set(false);
    }
  }

  async onNewClientChange(clientId: string): Promise<void> {
    if (!clientId) return;
    if (clientId.startsWith('seasearcher:')) {
      await this.importClientFromSeasearcher(clientId.replace('seasearcher:', ''));
      return;
    }
    const selected = this.clients().find((c) => c.id === clientId) ?? null;
    if (selected) this.selectedClient.set(selected);
    this.newClientId.set(clientId);
  }

  async onNewVesselChange(vesselId: string): Promise<void> {
    if (!vesselId) return;
    if (vesselId.startsWith('seasearcher:')) {
      await this.importVesselFromSeasearcher(vesselId.replace('seasearcher:', ''));
      return;
    }
    const selected = this.vesselsList().find((v) => v.id === vesselId) ?? null;
    if (selected) this.selectedVessel.set(selected);
    this.newVesselId.set(vesselId);
  }

  async onNewPlaceChange(placeId: string): Promise<void> {
    if (!placeId) return;
    if (placeId.startsWith('lli:')) {
      await this.importPlaceFromLli(placeId.replace('lli:', ''));
      return;
    }
    const selected = this.placesList().find((p) => p.id === placeId) ?? null;
    if (selected) this.selectedPlace.set(selected);
    this.newPlaceId.set(placeId);
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
        this.selectedClient.set(res.data);
        this.newClientId.set(res.data.id);
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
        this.vesselsList.set([res.data, ...this.vesselsList().filter((v) => v.id !== res.data.id)]);
        this.vesselImportOptions.set([]);
        this.selectedVessel.set(res.data);
        this.newVesselId.set(res.data.id);
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
        this.placesList.set([res.data, ...this.placesList().filter((p) => p.id !== res.data.id)]);
        this.placeImportOptions.set([]);
        this.selectedPlace.set(res.data);
        this.newPlaceId.set(res.data.id);
      } else {
        this.showToast('error', res.message ?? 'Failed to import place.');
      }
    } catch {
      this.showToast('error', 'Failed to import place.');
    } finally {
      this.placeSearchLoading.set(false);
    }
  }

  // ─── Actions ──────────────────────────────────────────────────────

  /** When ETA changes, clear ETD if it's now before the new ETA */
  onEtaChange(value: string): void {
    this.newEta.set(value);
    // If ETD is before new ETA, reset it
    if (this.newEtd() && value && this.newEtd() < value) {
      this.newEtd.set('');
    }
  }

  private searchTimeout: ReturnType<typeof setTimeout> | null = null;

  onSearch(term: string): void {
    this.searchTerm.set(term);
    if (this.searchTimeout) clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.currentPage.set(1);
      this.loadInquiries();
    }, 300);
  }

  goToPage(page: number): void {
    this.currentPage.set(page);
    this.loadInquiries();
  }

  onSort(event: SortChangeEvent): void {
    this.sortBy.set(event.field);
    this.sortDir.set(event.dir);
    this.currentPage.set(1);
    this.loadInquiries();
  }

  goToDetail(id: string): void {
    this.router.navigate([this.baseRoute(), id]);
  }

  async createInquiry(): Promise<void> {
    if (!this.canCreateInquiry()) return;
    this.creating.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<any>>(`${API}/orders`, {
          clientId: this.newClientId(),
          vesselId: this.newVesselId(),
          placeId: this.newPlaceId(),
          eta: this.newEta() || undefined,
          etd: this.newEtd() || undefined,
        }),
      );
      if (res.success) {
        this.showNewInquiryModal.set(false);
        this.newClientId.set('');
        this.newVesselId.set('');
        this.newPlaceId.set('');
        this.newEta.set('');
        this.newEtd.set('');
        this.selectedClient.set(null);
        this.selectedVessel.set(null);
        this.selectedPlace.set(null);
        this.clientImportOptions.set([]);
        this.vesselImportOptions.set([]);
        this.placeImportOptions.set([]);
        this.showToast('success', 'Inquiry created.');
        // Navigate to the new inquiry detail (prefer order number)
        this.router.navigate(['/trading/inquiries', res.data.orderNumber || res.data.id]);
      } else {
        this.showToast('error', res.message ?? 'Failed to create inquiry.');
      }
    } catch {
      this.showToast('error', 'Failed to create inquiry.');
    } finally {
      this.creating.set(false);
    }
  }

  // ─── Toast ─────────────────────────────────────────────────────────

  private showToast(type: 'success' | 'error', message: string): void {
    this.toast.set({ type, message });
    setTimeout(() => this.toast.set(null), 4000);
  }
}
