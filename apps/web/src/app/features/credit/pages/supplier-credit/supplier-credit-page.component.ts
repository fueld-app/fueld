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
} from '@fueld/types';

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
  selector: 'app-supplier-credit-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PaginationComponent, SortHeaderComponent],
  template: `
    <div>
      <!-- Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Supplier Credit</h1>
          <p class="mt-1 text-sm text-gray-500">
            Credit terms with your suppliers. Used amount is auto-calculated from open orders.
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
                <th class="px-4 py-3 text-left font-medium text-gray-600">Supplier(s)</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600">Our Companies</th>
                <th app-sort-header field="expires" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">Expires</th>
                <th app-sort-header field="periodDays" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">Period</th>
                <th app-sort-header field="creditAmount" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-right font-medium text-gray-600">Credit</th>
                <th class="px-4 py-3 text-right font-medium text-gray-600">Used</th>
                <th class="px-4 py-3 text-right font-medium text-gray-600">Available</th>
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
                      } @empty {
                        <span class="text-gray-400">—</span>
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
                      <span class="text-gray-400">—</span>
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
                  <td colspan="9" class="px-4 py-8 text-center text-gray-400">
                    No supplier credit lines yet. Click "Add Credit Line" to create one.
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
      @if (showModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div class="rounded-xl bg-white p-6 shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" (click)="$event.stopPropagation()">
            <h3 class="text-lg font-semibold text-gray-900">{{ editingId() ? 'Edit' : 'Add' }} Supplier Credit Line</h3>

            @if (formError()) {
              <div class="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{{ formError() }}</div>
            }

            <div class="mt-4 space-y-4">
              <!-- Supplier search + multi-select -->
              <div>
                <label class="block text-sm font-medium text-gray-700">Supplier(s) *</label>
                <div class="relative mt-1">
                  <input type="text" [ngModel]="companySearch()" (ngModelChange)="onCompanySearch($event)"
                    (focus)="companyDropdownOpen.set(companySearchResults().length > 0)"
                    placeholder="Search suppliers to add..."
                    class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
                  @if (companyDropdownOpen() && companySearchResults().length) {
                    <div class="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-48 overflow-y-auto">
                      @for (c of companySearchResults(); track c.key) {
                        <button (click)="addCounterparty(c)" class="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                          </svg>
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
                @if (selectedCounterparties().length) {
                  <div class="mt-2 flex flex-wrap gap-1.5">
                    @for (co of selectedCounterparties(); track co.id) {
                      <span class="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                        {{ co.name }}
                        <button (click)="removeCounterparty(co.id)" class="text-blue-400 hover:text-blue-700">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                          </svg>
                        </button>
                      </span>
                    }
                  </div>
                }
              </div>

              @if (companyDropdownOpen()) {
                <div class="fixed inset-0 z-0" (click)="companyDropdownOpen.set(false)"></div>
              }

              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700">Credit Amount *</label>
                  <input type="number" step="0.01" [ngModel]="form().creditAmount" (ngModelChange)="updateForm('creditAmount', $event)"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                    placeholder="100000" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700">Currency *</label>
                  <select [ngModel]="form().currency" (ngModelChange)="updateForm('currency', $event)"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white">
                    @for (c of configuredCurrencies(); track c) {
                      <option [value]="c">{{ c }}</option>
                    }
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700">Expires</label>
                  <input type="date" [ngModel]="form().expires" (ngModelChange)="updateForm('expires', $event)"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700">Period (days) *</label>
                  <input type="number" [ngModel]="form().periodDays" (ngModelChange)="updateForm('periodDays', +$event)"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                    placeholder="30" />
                </div>
              </div>

              <!-- Own Companies multi-select -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Our Companies
                  <span class="text-xs text-gray-400 ml-1">(which of our entities does this credit apply to?)</span>
                </label>
                @if (ownCompanies().length === 0) {
                  <p class="text-sm text-gray-400">No own companies configured.</p>
                } @else {
                  <div class="space-y-1.5 max-h-36 overflow-y-auto">
                    @for (co of ownCompanies(); track co.id) {
                      <label class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox" [checked]="selectedOwnCompanyIds().has(co.id)"
                          (change)="toggleOwnCompany(co.id)"
                          class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                        <span class="text-sm text-gray-900">{{ co.name }}</span>
                        @if (co.country) {
                          <span class="text-xs text-gray-500">{{ co.country }}</span>
                        }
                      </label>
                    }
                  </div>
                }
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700">Notes</label>
                <textarea [ngModel]="form().notes" (ngModelChange)="updateForm('notes', $event)" rows="2"
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  placeholder="Optional notes..."></textarea>
              </div>
            </div>

            <div class="mt-5 flex justify-end gap-2">
              <button (click)="showModal.set(false)"
                class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button (click)="saveForm()" [disabled]="saving()"
                class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                @if (saving()) { Saving... } @else { {{ editingId() ? 'Update' : 'Create' }} }
              </button>
            </div>
          </div>
        </div>
      }

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
export class SupplierCreditPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly parseFloat = parseFloat;
  readonly pageSize = 25;

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
  readonly form = signal<{
    creditAmount: string;
    currency: string;
    expires: string;
    periodDays: number;
    notes: string;
  }>({ creditAmount: '', currency: 'USD', expires: '', periodDays: 30, notes: '' });

  // Counterparty multi-select
  readonly selectedCounterparties = signal<{ id: string; name: string }[]>([]);

  // Company search
  readonly companySearch = signal('');
  readonly companySearchResults = signal<CompanySearchResultOption[]>([]);
  readonly companyDropdownOpen = signal(false);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

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
        type: 'SUPPLIER',
        page: String(this.currentPage()),
        limit: String(this.pageSize),
      });
      if (this.sortBy()) { params.set('sortBy', this.sortBy()); params.set('sortDir', this.sortDir()); }
      const [res, ownRes, currenciesRes] = await Promise.all([
        firstValueFrom(
          this.http.get<ApiResponse<{ items: CreditLineDto[]; total: number }>>(`${API}/credit/lines?${params}`),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<OwnCompanyDto[]>>(`${API}/companies/own`),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<{ currencies: string[] }>>(`${API}/admin/settings/my-currencies`),
        ),
      ]);
      if (res.success && res.data) {
        this.creditLines.set(res.data.items);
        this.total.set(res.data.total);
      }
      if (ownRes.success) this.ownCompanies.set(ownRes.data);
      if (currenciesRes.success && currenciesRes.data.currencies.length) {
        this.configuredCurrencies.set(currenciesRes.data.currencies);
      }
    } catch (err) {
      console.error('Failed to load credit lines:', err);
    } finally {
      this.loading.set(false);
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
            `${API}/companies/local?search=${encodeURIComponent(term)}&limit=10&type=SUPPLIER`,
          ),
        );
        const primaryLocal = res.success
          ? res.data.companies.filter((c) => !selected.has(c.id))
          : [];
        if (primaryLocal.length) {
          this.companySearchResults.set(
            primaryLocal.map((c) => ({
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
                source: 'seasearcher',
                seasearcherId: r.seasearcherId,
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

  async addCounterparty(company: CompanySearchResultOption): Promise<void> {
    if (company.source === 'seasearcher' && company.seasearcherId) {
      await this.importCounterpartyFromSeasearcher(company.seasearcherId);
      return;
    }
    const id = company.id;
    if (!id) return;
    this.selectedCounterparties.update((list) => [...list, { id, name: company.name }]);
    this.companySearchResults.update((results) => results.filter((r) => r.key !== company.key));
    this.companySearch.set('');
  }

  private async importCounterpartyFromSeasearcher(seasearcherId: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<CounterpartyDto>>(`${API}/companies/import`, { seasearcherId }),
      );
      if (res.success && res.data) {
        this.selectedCounterparties.update((list) => [...list, { id: res.data.id, name: res.data.name }]);
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
    this.form.set({ creditAmount: '', currency: 'USD', expires: '', periodDays: 30, notes: '' });
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
      notes: line.notes ?? '',
    });
    this.selectedCounterparties.set(
      line.counterpartyIds.map((id, i) => ({ id, name: line.counterpartyNames[i] || id })),
    );
    this.selectedOwnCompanyIds.set(new Set(line.ownCompanyIds));
    this.companySearch.set('');
    this.companySearchResults.set([]);
    this.formError.set('');
    this.showModal.set(true);
  }

  updateForm(field: string, value: unknown): void {
    this.form.update((f) => ({ ...f, [field]: value }));
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
      this.formError.set('Please add at least one supplier.');
      return;
    }

    this.saving.set(true);
    this.formError.set('');

    try {
      const counterpartyIds = this.selectedCounterparties().map((c) => c.id);
      const ownCompanyIds = Array.from(this.selectedOwnCompanyIds());
      const creditAmount = String(f.creditAmount ?? '').trim();

      if (this.editingId()) {
        await firstValueFrom(
          this.http.patch<ApiResponse<CreditLineDto>>(`${API}/credit/lines/${this.editingId()}`, {
            creditAmount,
            currency: f.currency,
            expires: f.expires || null,
            periodDays: f.periodDays,
            notes: f.notes || null,
            counterpartyIds,
            ownCompanyIds,
          }),
        );
      } else {
        await firstValueFrom(
          this.http.post<ApiResponse<CreditLineDto>>(`${API}/credit/lines`, {
            counterpartyIds,
            type: 'SUPPLIER',
            creditAmount,
            currency: f.currency,
            expires: f.expires || undefined,
            periodDays: f.periodDays,
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

  formatAmount(amount: string, currency: string): string {
    const num = parseFloat(amount);
    if (isNaN(num)) return `${currency} 0.00`;
    return `${currency} ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  isExpired(dateStr: string): boolean {
    return new Date(dateStr) < new Date();
  }
}
