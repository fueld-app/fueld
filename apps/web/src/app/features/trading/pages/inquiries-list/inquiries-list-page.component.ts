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
import { ColumnPickerComponent, type ColumnOption } from '../../../../shared/components/column-picker/column-picker.component';
import type { SortChangeEvent } from '../../../../shared/components';
import type { ApiResponse, CounterpartyDto, OrderListRowDto, UserUiPreferences } from '@fueld/types';
import { InquiriesListNewInquiryModalComponent } from './inquiries-list-new-inquiry-modal.component';
import type { TeamUserOption } from './inquiries-list.types';
import { DecimalPipe, DatePipe } from '@angular/common';
import { DateLabelPipe } from '../../../../shared/pipes/date-format.pipe';
import { DateFormatService } from '@app/core/services/date-format.service';
import { firstValueFrom } from 'rxjs';

// ═══════════════════════════════════════════════════════════════════════
//  Inquiries List Page — INQUIRY + OFFER status orders
// ═══════════════════════════════════════════════════════════════════════

import { API } from '@app/core/config/api';
import { AuthService } from '@app/core/auth/auth.service';
import { UserPreferencesService } from '@app/core/services/user-preferences.service';
import { NewInquiryModalService } from '@app/core/trading/new-inquiry-modal.service';

// TeamUserOption is defined in inquiries-list.types.ts

@Component({
  selector: 'app-inquiries-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusBadgeComponent, FormsModule, DecimalPipe, DatePipe, DateLabelPipe, SearchableDropdownComponent, PaginationComponent, SortHeaderComponent, ColumnPickerComponent, InquiriesListNewInquiryModalComponent],
  template: `
    <div>
      <!-- Header -->
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900">{{ titleText() }}</h1>
        <p class="mt-1 text-sm text-gray-500">{{ subtitleText() }}</p>
      </div>

      <!-- Search bar -->
      <div class="mb-4 flex flex-wrap items-end gap-3">
        <input
          type="text"
          [ngModel]="searchTerm()"
          (ngModelChange)="onSearch($event)"
          [placeholder]="searchPlaceholder()"
          class="w-full max-w-md rounded-lg border border-gray-300 px-4 py-2.5 text-sm shadow-sm
                 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none
                 focus:ring-2 focus:ring-brand-500/20"
        />
        <div class="w-56">
          <label class="mb-1 block text-xs font-medium text-gray-500">Broker</label>
          <app-searchable-dropdown
            placeholder="Filter by broker…"
            [options]="brokerFilterOptions()"
            [selected]="filterBrokerId()"
            [loading]="brokerFilterLoading()"
            [asyncSearch]="true"
            [clearable]="true"
            (searchChange)="searchBrokerFilter($event)"
            (selectionChange)="onBrokerFilterChange($event)"
          />
        </div>
        <div class="w-56">
          <label class="mb-1 block text-xs font-medium text-gray-500">Responsible</label>
          <app-searchable-dropdown
            placeholder="Filter by responsible…"
            [options]="responsibleFilterOptions()"
            [selected]="filterResponsibleId()"
            [clearable]="true"
            (selectionChange)="onResponsibleFilterChange($event)"
          />
        </div>
        <div class="ml-auto">
          <app-column-picker
            [columns]="allColumnOptions()"
            [visible]="visibleColumnFields()"
            [order]="columnOrder()"
            (visibleChange)="onColumnVisibilityChange($event)"
            (orderChange)="onColumnOrderChange($event)"
          />
        </div>
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
                @for (col of visibleColumns(); track col.field) {
                  @if (col.sortable) {
                    <th app-sort-header [field]="col.field" [sortBy]="activeSortBy()" [sortDir]="activeSortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">{{ col.label }}</th>
                  } @else {
                    <th class="px-4 py-3 text-left font-medium text-gray-600">{{ col.label }}</th>
                  }
                }
                <th class="px-4 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              @for (inq of inquiries(); track inq.id) {
                <tr class="transition-colors hover:bg-gray-50/50 cursor-pointer" (click)="goToDetail(inq.orderNumber || inq.id)">
                  @for (col of visibleColumns(); track col.field) {
                    @switch (col.field) {
                      @case ('orderNumber') {
                        <td class="px-4 py-3 font-mono text-xs text-gray-500">{{ inq.orderNumber ?? '—' }}</td>
                      }
                      @case ('client') {
                        <td class="px-4 py-3 font-medium text-gray-900">{{ inq.clientName }}</td>
                      }
                      @case ('vessel') {
                        <td class="px-4 py-3 text-gray-600">{{ inq.vesselName }}</td>
                      }
                      @case ('port') {
                        <td class="px-4 py-3 text-gray-600">{{ inq.placeName }}</td>
                      }
                      @case ('status') {
                        <td class="px-4 py-3">
                          <app-status-badge [status]="inq.status" />
                        </td>
                      }
                      @case ('responsible') {
                        <td class="px-4 py-3 text-gray-600">{{ inq.salesRepName || '—' }}</td>
                      }
                      @case ('invoicingCompany') {
                        <td class="px-4 py-3 text-gray-600">{{ inq.invoicingCompanyName || '—' }}</td>
                      }
                      @case ('eta') {
                        <td class="px-4 py-3 text-gray-500">{{ inq.eta ? (inq.eta | dateLabel) : '—' }}</td>
                      }
                      @case ('dueDate') {
                        <td class="px-4 py-3 text-gray-500">{{ inq.dueDate ? (inq.dueDate | dateLabel) : '—' }}</td>
                      }
                      @case ('value') {
                        <td class="px-4 py-3 text-right tabular-nums text-gray-900">
                          @if (inq.totalValue > 0) {
                            {{ inq.totalValue | number:'1.2-2' }} {{ inq.displayCurrency || 'USD' }}
                          } @else {
                            <span class="text-gray-400">—</span>
                          }
                        </td>
                      }
                      @case ('gross') {
                        <td class="px-4 py-3 text-right tabular-nums" [class.text-green-600]="inq.totalProfit > 0" [class.text-red-600]="inq.totalProfit < 0">
                          @if (inq.totalValue > 0 || inq.totalProfit !== 0) {
                            {{ inq.totalProfit | number:'1.2-2' }} {{ inq.displayCurrency || 'USD' }}
                          } @else {
                            <span class="text-gray-400">—</span>
                          }
                        </td>
                      }
                      @case ('financing') {
                        <td class="px-4 py-3 text-right tabular-nums text-amber-700">
                          @if (inq.totalValue > 0 || (inq.totalFinancingCost ?? 0) !== 0) {
                            {{ (inq.totalFinancingCost ?? 0) | number:'1.2-2' }} {{ inq.displayCurrency || 'USD' }}
                          } @else {
                            <span class="text-gray-400">—</span>
                          }
                        </td>
                      }
                      @case ('net') {
                        <td class="px-4 py-3 text-right tabular-nums" [class.text-green-600]="(inq.totalNetProfit ?? 0) > 0" [class.text-red-600]="(inq.totalNetProfit ?? 0) < 0">
                          @if (inq.totalValue > 0 || (inq.totalNetProfit ?? 0) !== 0) {
                            {{ (inq.totalNetProfit ?? 0) | number:'1.2-2' }} {{ inq.displayCurrency || 'USD' }}
                          } @else {
                            <span class="text-gray-400">—</span>
                          }
                        </td>
                      }
                      @case ('createdAt') {
                        <td class="px-4 py-3 text-gray-500">{{ inq.createdAt | dateLabel }}</td>
                      }
                    }
                  }
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
                  <td [attr.colspan]="visibleColumns().length + 1" class="px-4 py-12 text-center">
                    <p class="text-sm text-gray-400">{{ isOrders() ? 'No orders found.' : 'No inquiries found.' }}</p>
                    @if (!isOrders()) {
        <button
                        (click)="openNewInquiryModal()"
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
                <span>ETA {{ inq.eta ? (inq.eta | dateLabel) : '—' }}</span>
                <span>Resp {{ inq.salesRepName || '—' }}</span>
                <span>{{ inq.createdAt | dateLabel }}</span>
              </div>
              @if (isOrders() && auth.canSeePrices()) {
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
                    (click)="openNewInquiryModal()"
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
    @if (!isOrders()) {
      <app-inquiries-list-new-inquiry-modal
        [open]="newInquiryModalOpen()"
        [responsibleOptions]="responsibleFilterOptions()"
        (close)="onNewInquiryModalClose()"
        (created)="onNewInquiryCreated()"
      />
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
  readonly auth = inject(AuthService);
  private readonly newInquiryModal = inject(NewInquiryModalService);
  private queryParamSub?: Subscription;

  readonly mode = input<'inquiries' | 'active-orders' | 'delivered-orders' | 'completed-orders' | 'cancelled-orders' | undefined>('inquiries');
  readonly resolvedMode = computed(() => this.mode() ?? 'inquiries');

  readonly isOrders = computed(() => this.resolvedMode() !== 'inquiries');
  readonly isActiveOrders = computed(() => this.resolvedMode() === 'active-orders');
  readonly isDeliveredOrders = computed(() => this.resolvedMode() === 'delivered-orders');
  readonly isCompletedOrders = computed(() => this.resolvedMode() === 'completed-orders');
  readonly isCancelledOrders = computed(() => this.resolvedMode() === 'cancelled-orders');
  readonly baseRoute = computed(() => (
    this.isActiveOrders()
      ? '/trading/orders'
      : this.isDeliveredOrders()
        ? '/trading/delivered-orders'
        : this.isCompletedOrders()
          ? '/trading/completed-orders'
          : this.isCancelledOrders()
            ? '/trading/cancelled-orders'
            : '/trading/inquiries'
  ));
  readonly titleText = computed(() => (
    this.isActiveOrders()
      ? 'Active Orders'
      : this.isDeliveredOrders()
        ? 'Delivered Orders'
        : this.isCompletedOrders()
          ? 'Completed Orders'
          : this.isCancelledOrders()
            ? 'Cancelled Orders'
        : 'Inquiries'
  ));
  readonly subtitleText = computed(() =>
    this.isActiveOrders()
      ? 'Orders waiting for delivery or payment.'
      : this.isDeliveredOrders()
        ? 'Orders that have been delivered but not yet invoiced or paid.'
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
  readonly defaultSortBy = computed(() => this.isOrders() ? 'eta' : 'createdAt');
  readonly defaultSortDir = computed<'asc' | 'desc'>(() => 'desc');
  readonly activeSortBy = computed(() => this.sortBy() || this.defaultSortBy());
  readonly activeSortDir = computed<'asc' | 'desc'>(() => this.sortBy() ? this.sortDir() : this.defaultSortDir());
  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);

  // ─── Column configuration ─────────────────────────────────────────
  private readonly userPrefs = inject(UserPreferencesService);
  private readonly dateFormatSvc = inject(DateFormatService);

  readonly allColumnOptions = computed<ColumnOption[]>(() => {
    const base: ColumnOption[] = [
      { field: 'orderNumber', label: 'No.' },
      { field: 'client', label: 'Client' },
      { field: 'vessel', label: 'Vessel' },
      { field: 'port', label: 'Port' },
      { field: 'status', label: 'Status' },
      { field: 'responsible', label: 'Responsible' },
      { field: 'invoicingCompany', label: 'Invoicing' },
      { field: 'eta', label: 'ETA' },
      { field: 'dueDate', label: 'Due Date' },
      { field: 'createdAt', label: 'Created' },
    ];
    if (this.auth.canSeePrices()) {
      base.push({ field: 'value', label: 'Value' });
    }
    if (this.isOrders() && this.auth.canSeePrices()) {
      base.push(
        { field: 'gross', label: 'Gross' },
        { field: 'financing', label: 'Financing' },
        { field: 'net', label: 'Net' },
      );
    }
    return base;
  });

  readonly defaultVisibleColumns = computed<string[]>(() => {
    const base = ['orderNumber', 'client', 'vessel', 'port', 'status', 'responsible', 'eta', 'createdAt'];
    if (this.isDeliveredOrders() || this.isCompletedOrders()) {
      base.splice(base.indexOf('eta') + 1, 0, 'dueDate');
    }
    if (this.auth.canSeePrices()) {
      base.push('value');
    }
    if (this.isOrders() && this.auth.canSeePrices()) {
      base.push('gross', 'financing', 'net');
    }
    return base;
  });

  readonly defaultColumnOrder = computed<string[]>(() =>
    this.allColumnOptions().map((c) => c.field),
  );

  readonly columnConfig = computed(() => {
    const prefs = this.userPrefs.preferences();
    const mode = this.resolvedMode();
    const key = `orderList_${mode}` as keyof UserUiPreferences;
    return (prefs[key] as { visible?: string[]; order?: string[] } | undefined) ?? {};
  });

  readonly visibleColumnFields = computed(() =>
    this.columnConfig().visible ?? this.defaultVisibleColumns(),
  );

  readonly columnOrder = computed(() =>
    this.columnConfig().order ?? this.defaultColumnOrder(),
  );

  readonly visibleColumns = computed(() => {
    const orderMap = new Map(this.columnOrder().map((f, i) => [f, i]));
    return this.allColumnOptions()
      .filter((c) => this.visibleColumnFields().includes(c.field))
      .sort((a, b) => (orderMap.get(a.field) ?? 0) - (orderMap.get(b.field) ?? 0));
  });

  onColumnVisibilityChange(visible: string[]): void {
    const mode = this.resolvedMode();
    this.userPrefs.patch({
      [`orderList_${mode}`]: {
        visible,
        order: this.columnOrder(),
      },
    } as Partial<UserUiPreferences>);
  }

  onColumnOrderChange(order: string[]): void {
    const mode = this.resolvedMode();
    this.userPrefs.patch({
      [`orderList_${mode}`]: {
        visible: this.visibleColumnFields(),
        order,
      },
    } as Partial<UserUiPreferences>);
  }

  // ─── Broker filter ────────────────────────────────────────────────
  readonly filterBrokerId = signal('');
  readonly brokerFilterOptions = signal<DropdownOption[]>([]);
  readonly brokerFilterLoading = signal(false);
  readonly filterResponsibleId = signal('');
  readonly teamUsers = signal<TeamUserOption[]>([]);
  readonly responsibleFilterOptions = computed<DropdownOption[]>(() =>
    this.teamUsers().map((user) => ({ value: user.id, label: user.name })),
  );

  // ─── New inquiry modal ────────────────────────────────────────────

  readonly showNewInquiryModal = signal(false);

  readonly newInquiryModalOpen = computed(() => this.showNewInquiryModal());

  /** Open the modal (called from template empty-state button or external service) */
  openNewInquiryModal(): void {
    this.showNewInquiryModal.set(true);
  }

  onNewInquiryModalClose(): void {
    this.showNewInquiryModal.set(false);
  }

  onNewInquiryCreated(): void {
    this.showNewInquiryModal.set(false);
    this.showToast('success', 'Inquiry created.');
  }
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
    void this.loadResponsibleUsers();
    void this.userPrefs.load();
    void this.dateFormatSvc.load();
    if (!this.isOrders()) {
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
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = null;
    }
  }

  // ─── Data loading ─────────────────────────────────────────────────

  async loadInquiries(): Promise<void> {
    this.loading.set(true);
    try {
      const params = new URLSearchParams();
      if (this.isActiveOrders()) {
        params.set('statuses', 'CONFIRMED,INVOICED');
      } else if (this.isDeliveredOrders()) {
        params.set('statuses', 'DELIVERED');
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
      if (this.filterBrokerId()) params.set('brokerId', this.filterBrokerId());
      if (this.filterResponsibleId()) params.set('salesRepId', this.filterResponsibleId());
      if (this.activeSortBy()) params.set('sortBy', this.activeSortBy());
      if (this.activeSortBy()) params.set('sortDir', this.activeSortDir());

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

  private async loadResponsibleUsers(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<TeamUserOption[]>>(`${API}/lloyds/users`),
      );
      if (res.success) {
        this.teamUsers.set(Array.isArray(res.data) ? res.data : []);
      }
    } catch {
      this.teamUsers.set([]);
    }
  }

  // ─── Actions ──────────────────────────────────────────────────────

  private searchTimeout: ReturnType<typeof setTimeout> | null = null;

  onSearch(term: string): void {
    this.searchTerm.set(term);
    if (this.searchTimeout) clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.currentPage.set(1);
      this.loadInquiries();
    }, 300);
  }

  async searchBrokerFilter(term: string): Promise<void> {
    this.brokerFilterLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
          `${API}/companies/local?type=BROKER&search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      if (res.success) {
        this.brokerFilterOptions.set(
          res.data.companies.map((c) => ({ value: c.id, label: c.name })),
        );
      }
    } catch { /* ignore */ } finally {
      this.brokerFilterLoading.set(false);
    }
  }

  onBrokerFilterChange(value: string): void {
    this.filterBrokerId.set(value ?? '');
    this.currentPage.set(1);
    this.loadInquiries();
  }

  onResponsibleFilterChange(value: string): void {
    this.filterResponsibleId.set(value ?? '');
    this.currentPage.set(1);
    this.loadInquiries();
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

  // ─── Toast ─────────────────────────────────────────────────────────

  private showToast(type: 'success' | 'error', message: string): void {
    this.toast.set({ type, message });
    setTimeout(() => this.toast.set(null), 4000);
  }
}
