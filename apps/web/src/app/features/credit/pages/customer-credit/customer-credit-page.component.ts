import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PaginationComponent, SortHeaderComponent } from '../../../../shared/components';
import type { SortChangeEvent } from '../../../../shared/components';
import { firstValueFrom } from 'rxjs';
import type {
  CreditLineDto,
  CreateCreditLineDto,
  ApiResponse,
  CounterpartyDto,
  OwnCompanyDto,
  RiskOverrideDto,
  VesselCompanyDto,
} from '@fueld/types';

import { API } from '@app/core/config/api';
import { AuthService } from '@app/core/auth/auth.service';
import { RiskMonitoringService } from '@app/core/risk-monitoring/risk-monitoring.service';
import { CustomerCreditModalComponent } from './customer-credit-modal.component';
import { emptyCreditLineForm, type CreditLineForm, type CounterpartyOption } from './customer-credit.types';

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
  selector: 'app-customer-credit-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PaginationComponent, SortHeaderComponent, CustomerCreditModalComponent],
  template: `
    <div>
      <!-- Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Customer Credit</h1>
          <p class="mt-1 text-sm text-gray-500">
            Credit lines given to customers. Performance shows average days to pay.
          </p>
        </div>
        <button
          (click)="openCreateModal()"
          class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          Add Credit Line
        </button>
      </div>

      @if (canManageCreditOverrides() && (pendingOverrides().length || pendingOverridesLoading() || pendingOverridesError())) {
        <div class="mb-6 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-sky-50 shadow-sm">
          <div class="flex flex-col gap-3 border-b border-blue-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 class="text-sm font-semibold text-gray-900">Pending Credit Overrides</h2>
              <p class="mt-1 text-xs text-gray-600">Approve or reject frozen customer exceptions without leaving the credit queue.</p>
            </div>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 self-start rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-50"
              [disabled]="pendingOverridesLoading()"
              (click)="loadPendingOverrides()"
            >
              Refresh Queue
            </button>
          </div>

          <div class="px-5 py-4">
            @if (pendingOverridesLoading()) {
              <div class="flex items-center gap-2 text-sm text-gray-500">
                <svg class="h-4 w-4 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Loading pending overrides...
              </div>
            } @else if (pendingOverridesError()) {
              <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{{ pendingOverridesError() }}</div>
            } @else if (pendingOverrides().length) {
              <div class="space-y-3">
                @for (override of pendingOverrides(); track override.id) {
                  <div class="rounded-xl border border-blue-100 bg-white/80 px-4 py-4">
                    <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <a [routerLink]="['/companies', override.counterpartyId]" class="text-sm font-semibold text-blue-700 hover:text-blue-900 hover:underline">
                            {{ override.counterpartyName }}
                          </a>
                          <span class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 uppercase">
                            Pending
                          </span>
                        </div>
                        <p class="mt-1 text-xs text-gray-500">
                          Requested by {{ override.requestedByUserName }} on {{ formatDateTime(override.createdAt) }}
                        </p>
                        <p class="mt-2 text-sm text-gray-800">{{ override.reason }}</p>

                        @if (ignoredCreditEnforcementVesselsFor(override.counterpartyId).length) {
                          <div class="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2">
                            <p class="text-xs font-semibold uppercase tracking-wide text-sky-800">Ignored Vessel Credit Exceptions</p>
                            <p class="mt-1 text-xs text-sky-700">
                              Maritime-context hits tied to these linked vessels are excluded from credit enforcement for this customer.
                            </p>
                            <div class="mt-2 flex flex-wrap gap-2">
                              @for (vessel of ignoredCreditEnforcementVesselsFor(override.counterpartyId); track vessel.id) {
                                <span class="inline-flex items-center rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[11px] font-medium text-sky-800">
                                  {{ vessel.vesselName || vessel.vesselImo || 'Unknown vessel' }}
                                  @if (vessel.vesselImo) {
                                    <span class="ml-1 text-sky-600">IMO {{ vessel.vesselImo }}</span>
                                  }
                                </span>
                              }
                            </div>
                          </div>
                        }

                        @if (override.approvals.length) {
                          <div class="mt-3 flex flex-wrap gap-2">
                            @for (approval of override.approvals; track approval.id) {
                              <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium"
                                [class]="approval.decision === 'APPROVED' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'">
                                {{ approval.userName }}
                                <span>{{ approval.decision }}</span>
                              </span>
                            }
                          </div>
                        }
                      </div>

                      @if (canManageCreditOverrides()) {
                        <div class="flex items-center gap-2">
                          <button
                            type="button"
                            class="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-medium text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50"
                            [disabled]="pendingDecisionId() === override.id"
                            (click)="decidePendingOverride(override, 'APPROVED')"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            class="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                            [disabled]="pendingDecisionId() === override.id"
                            (click)="decidePendingOverride(override, 'REJECTED')"
                          >
                            Reject
                          </button>
                        </div>
                      }
                    </div>
                  </div>
                }
              </div>
            } @else {
              <p class="text-sm text-gray-500">No overrides are waiting for approval.</p>
            }
          </div>
        </div>
      }

      <!-- Table -->
      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <svg class="h-8 w-8 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else {
        <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200 bg-gray-50/80">
                <th app-sort-header field="updatedAt" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">Updated</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600">Customer(s)</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600">Our Companies</th>
                <th app-sort-header field="expires" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">Expires</th>
                <th app-sort-header field="periodDays" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">Period</th>
                <th app-sort-header field="creditAmount" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-right font-medium text-gray-600">Credit</th>
                <th class="px-4 py-3 text-right font-medium text-gray-600">Used</th>
                <th class="px-4 py-3 text-right font-medium text-gray-600">Available</th>
                <th class="px-4 py-3 text-center font-medium text-gray-600">Performance</th>
                <th class="px-4 py-3 text-center font-medium text-gray-600">From Delivery</th>
                <th class="px-4 py-3 text-center font-medium text-gray-600">Qualified</th>
                <th class="px-4 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              @for (line of creditLines(); track line.id) {
                <tr class="transition-colors hover:bg-gray-50/50">
                  <td class="px-4 py-3 text-gray-500 text-xs">{{ formatDate(line.updatedAt) }}</td>
                  <td class="px-4 py-3">
                    <div class="flex flex-wrap gap-1">
                      @for (name of line.counterpartyNames; track name; let i = $index) {
                        <a [routerLink]="['/companies', line.counterpartyIds[i]]"
                          class="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors">
                          {{ name }}
                        </a>
                        @if (frozenCounterpartyIds().has(line.counterpartyIds[i])) {
                          <span class="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700 uppercase">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg>
                            Frozen
                          </span>
                        }
                      } @empty {
                        <span class="text-gray-400">-</span>
                      }
                    </div>
                  </td>
                  <td class="px-4 py-3">
                    @if (line.ownCompanyNames.length) {
                      <div class="flex flex-wrap gap-1">
                        @for (name of line.ownCompanyNames; track name) {
                          <span class="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{{ name }}</span>
                        }
                      </div>
                    } @else {
                      <span class="text-gray-400">All</span>
                    }
                  </td>
                  <td class="px-4 py-3 text-gray-600">
                    @if (line.expires) {
                      <span [class]="isExpired(line.expires) ? 'text-red-600 font-medium' : ''">
                        {{ formatDate(line.expires) }}
                      </span>
                    } @else {
                      <span class="text-gray-400">-</span>
                    }
                  </td>
                  <td class="px-4 py-3 text-gray-600">{{ line.periodDays }} days</td>
                  <td class="px-4 py-3 text-right font-medium text-gray-900">{{ formatAmount(line.creditAmount, line.currency) }}</td>
                  <td class="px-4 py-3 text-right">
                    <span [class]="parseFloat(line.usedAmount) > 0 ? 'text-amber-600 font-medium' : 'text-gray-400'">
                      {{ formatAmount(line.usedAmount, line.currency) }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-right">
                    <span [class]="parseFloat(line.availableAmount) > 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'">
                      {{ formatAmount(line.availableAmount, line.currency) }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-center">
                    @if (line.performanceDays !== null) {
                      <span [class]="line.performanceDays! <= line.periodDays ? 'text-green-600 font-medium' : 'text-amber-600 font-medium'">
                        {{ line.performanceDays }} days
                      </span>
                    } @else {
                      <span class="text-gray-400">-</span>
                    }
                  </td>
                  <td class="px-4 py-3 text-center">
                    <button (click)="toggleFromDelivery(line)" class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
                      [class]="line.fromDelivery ? 'bg-brand-600' : 'bg-gray-300'">
                      <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                        [class]="line.fromDelivery ? 'translate-x-4' : 'translate-x-0.5'"></span>
                    </button>
                  </td>
                  <td class="px-4 py-3 text-center">
                    <button (click)="toggleQualified(line)" class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
                      [class]="line.qualified ? 'bg-brand-600' : 'bg-gray-300'">
                      <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                        [class]="line.qualified ? 'translate-x-4' : 'translate-x-0.5'"></span>
                    </button>
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-1">
                      <button (click)="openEditModal(line)" class="rounded-md p-1 text-gray-400 hover:text-brand-600 transition-colors" title="Edit">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" />
                          <path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" />
                        </svg>
                      </button>
                      <button (click)="confirmDelete(line)" class="rounded-md p-1 text-gray-400 hover:text-red-500 transition-colors" title="Delete">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="12" class="px-4 py-8 text-center text-gray-400">
                    No customer credit lines yet. Click "Add Credit Line" to create one.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <app-pagination
          [currentPage]="currentPage()"
          [totalItems]="total()"
          [pageSize]="pageSize"
          (pageChange)="changePage($event)"
        />
      }

      <!-- Create / Edit modal -->
      <app-customer-credit-modal
        [open]="showModal()"
        [editing]="!!editingId()"
        [saving]="saving()"
        [error]="formError()"
        [currencies]="configuredCurrencies()"
        [form]="form()"
        [companySearch]="companySearch()"
        [searchResults]="companySearchResults()"
        [selectedCounterparties]="selectedCounterparties()"
        [ownCompanies]="ownCompanies()"
        [selectedOwnCompanyIds]="selectedOwnCompanyIds()"
        (cancel)="showModal.set(false)"
        (save)="saveForm()"
        (companySearchChange)="onCompanySearch($event)"
        (selectCounterparty)="addCounterparty($event)"
        (removeCounterparty)="removeCounterparty($event)"
        (toggleOwnCompany)="toggleOwnCompany($event)"
        (formChange)="onCreditFormChange($event)"
      />

      <!-- Delete confirmation modal -->
      @if (deleteTarget()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="deleteTarget.set(null)">
          <div class="rounded-xl bg-white p-6 shadow-xl max-w-sm mx-4" (click)="$event.stopPropagation()">
            <h3 class="text-lg font-semibold text-gray-900">Delete credit line?</h3>
            <p class="mt-2 text-sm text-gray-500">
              Are you sure you want to delete the credit line for
              <strong>{{ deleteTarget()!.counterpartyNames.join(', ') }}</strong>?
            </p>
            <div class="mt-4 flex justify-end gap-2">
              <button (click)="deleteTarget.set(null)"
                class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button (click)="executeDelete()" [disabled]="deleting()"
                class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                @if (deleting()) { Deleting... } @else { Delete }
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class CustomerCreditPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly authService = inject(AuthService);
  private readonly riskService = inject(RiskMonitoringService);
  readonly parseFloat = parseFloat;
  readonly pageSize = 25;
  readonly canManageCreditOverrides = this.authService.canAccessCredit;

  // State
  readonly creditLines = signal<CreditLineDto[]>([]);
  readonly total = signal(0);
  readonly currentPage = signal(1);
  readonly loading = signal(true);
  readonly sortBy = signal('');
  readonly sortDir = signal<'asc' | 'desc'>('asc');

  // Own companies
  readonly ownCompanies = signal<OwnCompanyDto[]>([]);
  readonly selectedOwnCompanyIds = signal<Set<string>>(new Set());

  // Modal
  readonly showModal = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly saving = signal(false);
  readonly formError = signal('');
  readonly form = signal<CreditLineForm>({ creditAmount: '', currency: 'USD', expires: '', periodDays: 30, fromDelivery: false, qualified: false, notes: '' });

  // Counterparty multi-select
  readonly selectedCounterparties = signal<CounterpartyOption[]>([]);

  // Company search
  readonly companySearch = signal('');
  readonly companySearchResults = signal<CounterpartyOption[]>([]);
  readonly companyDropdownOpen = signal(false);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  // Frozen state
  readonly frozenCounterpartyIds = signal<Set<string>>(new Set());
  readonly pendingOverrides = signal<RiskOverrideDto[]>([]);
  readonly pendingOverridesLoading = signal(false);
  readonly pendingOverridesError = signal('');
  readonly pendingDecisionId = signal<string | null>(null);
  readonly pendingOverrideCompanyVessels = signal<Record<string, VesselCompanyDto[]>>({});

  // Delete
  readonly deleteTarget = signal<CreditLineDto | null>(null);
  readonly deleting = signal(false);

  // Configured currencies
  readonly configuredCurrencies = signal<string[]>(['USD', 'EUR', 'DKK', 'AED']);

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const page = Number(params.get('page'));
    if (page > 0) this.currentPage.set(page);
    this.loadData();
  }

  async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const params = new URLSearchParams({
        type: 'CUSTOMER',
        page: String(this.currentPage()),
        limit: String(this.pageSize),
      });
      if (this.sortBy()) { params.set('sortBy', this.sortBy()); params.set('sortDir', this.sortDir()); }
      const [res, ownRes, currenciesRes, pendingOverridesResult] = await Promise.all([
        firstValueFrom(
          this.http.get<ApiResponse<{ items: CreditLineDto[]; total: number }>>(`${API}/credit/lines?${params}`),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<OwnCompanyDto[]>>(`${API}/companies/own`),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<{ currencies: string[] }>>(`${API}/admin/settings/my-currencies`),
        ),
        this.canManageCreditOverrides() ? this.riskService.getPendingOverrides().catch(() => null) : Promise.resolve(null),
      ]);
      if (res.success && res.data) {
        this.creditLines.set(res.data.items);
        this.total.set(res.data.total);
        this.loadFrozenState(res.data.items);
      }
      if (ownRes.success) this.ownCompanies.set(ownRes.data);
      if (currenciesRes.success && currenciesRes.data.currencies.length) {
        this.configuredCurrencies.set(currenciesRes.data.currencies);
      }
      const pendingOverrides = resolvedPendingOverrides(pendingOverridesResult);
      this.pendingOverrides.set(pendingOverrides);
      await this.loadPendingOverrideCompanyVessels(pendingOverrides);
      this.pendingOverridesError.set('');
    } catch (err) {
      console.error('Failed to load credit lines:', err);
    } finally {
      this.loading.set(false);
    }
  }

  async loadPendingOverrides(): Promise<void> {
    if (!this.canManageCreditOverrides()) {
      this.pendingOverrides.set([]);
      this.pendingOverridesError.set('Only admins and credit managers can view pending overrides.');
      return;
    }
    this.pendingOverridesLoading.set(true);
    this.pendingOverridesError.set('');
    try {
      const overrides = await this.riskService.getPendingOverrides();
      this.pendingOverrides.set(overrides);
      await this.loadPendingOverrideCompanyVessels(overrides);
    } catch (err) {
      console.error('Failed to load pending overrides:', err);
      this.pendingOverridesError.set('Failed to load pending overrides.');
    } finally {
      this.pendingOverridesLoading.set(false);
    }
  }

  async decidePendingOverride(override: RiskOverrideDto, decision: 'APPROVED' | 'REJECTED'): Promise<void> {
    if (this.pendingDecisionId()) return;
    if (!this.canManageCreditOverrides()) {
      this.pendingOverridesError.set('Only admins and credit managers can decide overrides.');
      return;
    }

    const promptMessage = decision === 'REJECTED'
      ? 'Reason for rejecting this override:'
      : 'Optional comment for approving this override:';
    const comment = prompt(promptMessage) ?? undefined;
    if (decision === 'REJECTED' && !comment?.trim()) return;

    this.pendingDecisionId.set(override.id);
    this.pendingOverridesError.set('');
    try {
      const result = await this.riskService.decideOverride(
        override.id,
        decision,
        comment?.trim() || undefined,
      );
      if (!result) {
        this.pendingOverridesError.set('The override could not be updated. It may already have been decided.');
        return;
      }

      await this.loadData();
    } catch (err) {
      console.error('Failed to decide pending override:', err);
      this.pendingOverridesError.set('Failed to record override decision.');
    } finally {
      this.pendingDecisionId.set(null);
    }
  }

  changePage(page: number): void {
    this.currentPage.set(page);
    const queryParams: Record<string, string | null> = {
      page: page > 1 ? String(page) : null,
    };
    this.router.navigate([], { queryParams, queryParamsHandling: 'merge', replaceUrl: true });
    this.loadData();
  }

  onSort(event: SortChangeEvent): void {
    this.sortBy.set(event.field);
    this.sortDir.set(event.dir);
    this.currentPage.set(1);
    this.loadData();
  }

  // --- Company search ---
  onCompanySearch(term: string): void {
    this.companySearch.set(term);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (term.length < 2) {
      this.companySearchResults.set([]);
      this.companyDropdownOpen.set(false);
      return;
    }
    this.searchTimer = setTimeout(async () => {
      try {
        const selected = new Set(this.selectedCounterparties().map((c) => c.id));
        const res = await firstValueFrom(
          this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
            `${API}/companies/local?search=${encodeURIComponent(term)}&limit=10&type=CLIENT`,
          ),
        );
        const primaryLocal = res.success
          ? res.data.companies.filter((c) => !selected.has(c.id))
          : [];
        if (primaryLocal.length) {
          this.companySearchResults.set(
            primaryLocal.map((c) => ({
              key: c.id,
              source: 'local' as const,
              id: c.id,
              name: c.name,
              country: c.country ?? null,
            }) as CounterpartyOption),
          );
          this.companyDropdownOpen.set(true);
          return;
        }

        {
          const res2 = await firstValueFrom(
            this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
              `${API}/companies/local?search=${encodeURIComponent(term)}&limit=10`,
            ),
          );
          const fallbackLocal = res2.success
            ? res2.data.companies.filter((c) => !selected.has(c.id))
            : [];
          if (fallbackLocal.length) {
            this.companySearchResults.set(
              fallbackLocal.map((c) => ({
                key: c.id,
                source: 'local',
                id: c.id,
                name: c.name,
                country: c.country ?? null,
              })),
            );
            this.companyDropdownOpen.set(true);
            return;
          }
        }

        const importRes = await firstValueFrom(
          this.http.get<ApiResponse<CompanySearchResult[]>>(
            `${API}/companies/search?term=${encodeURIComponent(term)}`,
          ),
        );
        if (importRes.success && importRes.data) {
          this.companySearchResults.set(
            importRes.data
              .filter((r) => r.source === 'seasearcher' && r.seasearcherId)
              .map((r) => ({
                key: `seasearcher:${r.seasearcherId}`,
                source: 'seasearcher' as const,
                seasearcherId: r.seasearcherId,
                id: '',
                name: r.name,
                country: r.country ?? null,
              })),
          );
        } else {
          this.companySearchResults.set([]);
        }
        this.companyDropdownOpen.set(true);
      } catch {
        this.companySearchResults.set([]);
      }
    }, 300);
  }

  async addCounterparty(company: CounterpartyOption): Promise<void> {
    if (company.source === 'seasearcher' && company.seasearcherId) {
      await this.importCounterpartyFromSeasearcher(company.seasearcherId);
      return;
    }
    this.selectedCounterparties.update((list) => [...list, company]);
    this.companySearchResults.update((results) => results.filter((r) => r.key !== company.key));
    this.companySearch.set('');
  }

  private async importCounterpartyFromSeasearcher(seasearcherId: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<CounterpartyDto>>(`${API}/companies/import`, { seasearcherId }),
      );
      if (res.success && res.data) {
        this.selectedCounterparties.update((list) => [...list, { key: res.data.id, id: res.data.id, name: res.data.name, country: null, source: 'local' }]);
        this.companySearchResults.set([]);
        this.companySearch.set('');
      } else {
        this.formError.set(res.message ?? 'Failed to import company.');
      }
    } catch {
      this.formError.set('Failed to import company.');
    }
  }

  removeCounterparty(id: string): void {
    this.selectedCounterparties.update((list) => list.filter((c) => c.id !== id));
  }

  // --- Create / Edit ---
  openCreateModal(): void {
    this.editingId.set(null);
    this.form.set({ creditAmount: '', currency: 'USD', expires: '', periodDays: 30, fromDelivery: false, qualified: false, notes: '' });
    this.selectedCounterparties.set([]);
    this.selectedOwnCompanyIds.set(new Set());
    this.companySearch.set('');
    this.companySearchResults.set([]);
    this.formError.set('');
    this.showModal.set(true);
  }

  openEditModal(line: CreditLineDto): void {
    this.editingId.set(line.id);
    this.form.set({
      creditAmount: line.creditAmount,
      currency: line.currency,
      expires: line.expires ?? '',
      periodDays: line.periodDays,
      fromDelivery: line.fromDelivery,
      qualified: line.qualified,
      notes: line.notes ?? '',
    });
    this.selectedCounterparties.set(
      line.counterpartyIds.map((id, i) => ({ key: id, id, name: line.counterpartyNames[i] || id, country: null, source: 'local' as const })),
    );
    this.selectedOwnCompanyIds.set(new Set(line.ownCompanyIds));
    this.companySearch.set('');
    this.companySearchResults.set([]);
    this.formError.set('');
    this.showModal.set(true);
  }

  onCreditFormChange(partial: Partial<CreditLineForm>): void {
    const key = Object.keys(partial)[0] as keyof CreditLineForm;
    const value = partial[key];
    if (value !== undefined) {
      this.form.update((f) => ({ ...f, [key]: value }));
    }
  }

  toggleOwnCompany(companyId: string): void {
    this.selectedOwnCompanyIds.update((s) => {
      const next = new Set(s);
      if (next.has(companyId)) next.delete(companyId);
      else next.add(companyId);
      return next;
    });
  }

  async saveForm(): Promise<void> {
    const f = this.form();
    if (!f.creditAmount) {
      this.formError.set('Credit amount is required.');
      return;
    }
    if (!this.selectedCounterparties().length) {
      this.formError.set('Please add at least one customer.');
      return;
    }

    this.saving.set(true);
    this.formError.set('');

    try {
      const counterpartyIds = this.selectedCounterparties().map((c) => c.id).filter(Boolean) as string[];
      const ownCompanyIds = Array.from(this.selectedOwnCompanyIds());
      const creditAmount = String(f.creditAmount ?? '').trim();

      if (this.editingId()) {
        await firstValueFrom(
          this.http.patch<ApiResponse<CreditLineDto>>(`${API}/credit/lines/${this.editingId()}`, {
            creditAmount,
            currency: f.currency,
            expires: f.expires || null,
            periodDays: f.periodDays,
            fromDelivery: f.fromDelivery,
            qualified: f.qualified,
            notes: f.notes || null,
            counterpartyIds,
            ownCompanyIds,
          }),
        );
      } else {
        await firstValueFrom(
          this.http.post<ApiResponse<CreditLineDto>>(`${API}/credit/lines`, {
            counterpartyIds,
            type: 'CUSTOMER',
            creditAmount,
            currency: f.currency,
            expires: f.expires || undefined,
            periodDays: f.periodDays,
            fromDelivery: f.fromDelivery,
            qualified: f.qualified,
            notes: f.notes || undefined,
            ownCompanyIds: ownCompanyIds.length ? ownCompanyIds : undefined,
          } satisfies CreateCreditLineDto),
        );
      }
      this.showModal.set(false);
      await this.loadData();
    } catch (err) {
      this.formError.set('Failed to save credit line.');
      console.error(err);
    } finally {
      this.saving.set(false);
    }
  }

  // --- Toggle inline fields ---
  async toggleFromDelivery(line: CreditLineDto): Promise<void> {
    try {
      await firstValueFrom(
        this.http.patch<ApiResponse<CreditLineDto>>(`${API}/credit/lines/${line.id}`, {
          fromDelivery: !line.fromDelivery,
        }),
      );
      await this.loadData();
    } catch (err) {
      console.error('Toggle failed:', err);
    }
  }

  async toggleQualified(line: CreditLineDto): Promise<void> {
    try {
      await firstValueFrom(
        this.http.patch<ApiResponse<CreditLineDto>>(`${API}/credit/lines/${line.id}`, {
          qualified: !line.qualified,
        }),
      );
      await this.loadData();
    } catch (err) {
      console.error('Toggle failed:', err);
    }
  }

  // --- Delete ---
  confirmDelete(line: CreditLineDto): void {
    this.deleteTarget.set(line);
  }

  async executeDelete(): Promise<void> {
    const target = this.deleteTarget();
    if (!target) return;
    this.deleting.set(true);
    try {
      await firstValueFrom(
        this.http.delete<ApiResponse<{ id: string }>>(`${API}/credit/lines/${target.id}`),
      );
      this.deleteTarget.set(null);
      await this.loadData();
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      this.deleting.set(false);
    }
  }

  // --- Helpers ---
  formatDate(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  formatDateTime(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  ignoredCreditEnforcementVesselsFor(counterpartyId: string): VesselCompanyDto[] {
    return (this.pendingOverrideCompanyVessels()[counterpartyId] ?? [])
      .filter((vesselCompany) => vesselCompany.ignoreForCreditEnforcement === true);
  }

  formatAmount(amount: string, currency: string): string {
    const num = parseFloat(amount);
    if (isNaN(num)) return `${currency} 0.00`;
    return `${currency} ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  isExpired(dateStr: string): boolean {
    return new Date(dateStr) < new Date();
  }

  private async loadFrozenState(lines: CreditLineDto[]): Promise<void> {
    const ids = [...new Set(lines.flatMap((l) => l.counterpartyIds))];
    if (!ids.length) {
      this.frozenCounterpartyIds.set(new Set());
      return;
    }
    try {
      const frozen = await this.riskService.batchFrozen(ids);
      this.frozenCounterpartyIds.set(new Set(frozen));
    } catch {
      // Non-critical — leave empty
    }
  }

  private async loadPendingOverrideCompanyVessels(overrides: RiskOverrideDto[]): Promise<void> {
    const counterpartyIds = [...new Set(overrides.map((override) => override.counterpartyId).filter(Boolean))];
    if (!counterpartyIds.length) {
      this.pendingOverrideCompanyVessels.set({});
      return;
    }

    const results = await Promise.all(
      counterpartyIds.map(async (counterpartyId) => {
        try {
          const response = await firstValueFrom(
            this.http.get<ApiResponse<VesselCompanyDto[]>>(`${API}/companies/local/${counterpartyId}/vessels`),
          );
          return [counterpartyId, response.success && response.data ? response.data : []] as const;
        } catch {
          return [counterpartyId, []] as const;
        }
      }),
    );

    this.pendingOverrideCompanyVessels.set(Object.fromEntries(results));
  }
}

function resolvedPendingOverrides(result: RiskOverrideDto[] | null): RiskOverrideDto[] {
  return Array.isArray(result) ? result : [];
}
