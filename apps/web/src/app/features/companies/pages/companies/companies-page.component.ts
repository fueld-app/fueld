import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, Subject, of } from 'rxjs';
import { debounceTime, switchMap, tap, catchError, takeUntil } from 'rxjs/operators';
import type { CounterpartyDto, ApiResponse } from '@fueld/types';
import { COUNTRIES } from '../../../../shared/data/countries';
import { flagFromIso3 } from '../../../../shared/utils/flags';
import { PaginationComponent, SortHeaderComponent } from '../../../../shared/components';
import type { SortChangeEvent } from '../../../../shared/components';

// ═══════════════════════════════════════════════════════════════════════
//  Companies Page — Browse, search, import from Seasearcher, create
// ═══════════════════════════════════════════════════════════════════════

import { API } from '@app/core/config/api';

interface CompanySearchResult {
  source: 'local' | 'seasearcher';
  localId?: string;
  seasearcherId?: string;
  name: string;
  companyImo?: string;
  country?: string;
  countryCode?: string;
  yearFormed?: number | null;
  fleetSize?: number;
  isSanctioned?: boolean;
}

@Component({
  selector: 'app-companies-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PaginationComponent, SortHeaderComponent],
  template: `
    <div>
      <!-- Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Companies</h1>
          <p class="mt-1 text-sm text-gray-500">
            Manage clients, suppliers and barges.
            Import from Seasearcher or create manually.
          </p>
        </div>
      </div>

      <!-- Search + Import bar -->
      <div class="flex flex-col sm:flex-row gap-3 mb-4">
        <!-- Typeahead search -->
        <div class="relative flex-1">
          <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <svg class="h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" />
            </svg>
          </div>
          <input
            type="text"
            [ngModel]="searchTerm()"
            (ngModelChange)="onSearchInput($event)"
            (focus)="onSearchFocus()"
            placeholder="Search companies to import or create (min. 2 characters)…"
            class="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm
                   focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          />
          @if (searching()) {
            <div class="absolute inset-y-0 right-0 flex items-center pr-3">
              <svg class="h-4 w-4 animate-spin text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            </div>
          }

          <!-- Typeahead dropdown -->
          @if (dropdownOpen() && searchDone()) {
            <div class="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-80 overflow-y-auto">
              @for (r of searchResults(); track r.seasearcherId ?? r.localId) {
                <div (click)="onTypeaheadClick(r)" class="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0 cursor-pointer">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-medium text-gray-900 truncate">{{ r.name }}</span>
                      @if (r.isSanctioned) {
                        <span class="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Sanctioned</span>
                      }
                    </div>
                    <div class="flex items-center gap-2 mt-0.5">
                      @if (r.country) {
                        <span class="text-xs text-gray-500">{{ flagEmoji(r.countryCode) }} {{ r.country }}</span>
                      }
                      @if (r.companyImo) {
                        <span class="text-xs text-gray-400">IMO {{ r.companyImo }}</span>
                      }
                      @if (r.fleetSize) {
                        <span class="text-xs text-gray-400">Fleet: {{ r.fleetSize }}</span>
                      }
                    </div>
                  </div>
                  <div class="shrink-0">
                    @if (r.source === 'local') {
                      <span class="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Local</span>
                    } @else {
                      <button
                        (click)="importCompany(r.seasearcherId!, $event)"
                        class="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd" />
                        </svg>
                        Import
                      </button>
                    }
                  </div>
                </div>
              }

              @if (!searchResults().length) {
                <div class="px-3 py-3 text-center text-sm text-gray-500">
                  No companies found matching "{{ searchTerm() }}"
                </div>
              }

              <!-- Always show create manually option -->
              <div class="border-t border-gray-100 px-3 py-2.5">
                <button
                  (click)="openCreateModal(); $event.stopPropagation()"
                  class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" />
                  </svg>
                  Create "{{ searchTerm() }}" manually
                </button>
              </div>
            </div>
          }

        </div>

        <!-- Filter by type -->
        <select
          [ngModel]="filterType()"
          (ngModelChange)="filterType.set($event); currentPage.set(1); loadCompanies(); updateUrlParams()"
          class="rounded-lg border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
        >
          <option value="">All Types</option>
          <option value="CLIENT">Client</option>
          <option value="SUPPLIER">Supplier</option>
          <option value="BARGE">Barge</option>
        </select>

        <!-- Filter by responsible -->
        <select
          [ngModel]="filterResponsible()"
          (ngModelChange)="filterResponsible.set($event); currentPage.set(1); loadCompanies(); updateUrlParams()"
          class="rounded-lg border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
        >
          <option value="">All Responsible</option>
          @for (u of users(); track u.id) {
            <option [value]="u.id">{{ u.name }}</option>
          }
        </select>
      </div>

      <!-- Click-away backdrop for dropdown -->
      @if (dropdownOpen()) {
        <div class="fixed inset-0 z-10" (click)="dropdownOpen.set(false)"></div>
      }

      <!-- Companies table -->
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
                <th app-sort-header field="name" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                <th app-sort-header field="type" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                <th app-sort-header field="country" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">Country</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600">Sanctioned</th>
                <th app-sort-header field="creditLimit" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-right font-medium text-gray-600">Credit Limit</th>
                <th class="px-4 py-3 text-center font-medium text-gray-600">Contacts</th>
                <th app-sort-header field="responsible" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">Responsible</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600">Source</th>
                <th class="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              @for (company of companies(); track company.id) {
                <tr class="transition-colors hover:bg-gray-50/50 cursor-pointer" (click)="goToCompany(company.id)">
                  <td class="px-4 py-3">
                    <span class="font-medium text-gray-900">{{ company.name }}</span>
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex flex-wrap gap-1">
                      @for (t of (company.types.length ? company.types : [company.type]); track t) {
                        <span class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                          [class]="typeBadgeClass(t)">
                          {{ typeLabel(t) }}
                        </span>
                      }
                    </div>
                  </td>
                  <td class="px-4 py-3 text-gray-600">
                    {{ flagEmoji(company.countryIso) }} {{ company.country ?? '—' }}
                    @if (company.countryIso && company.countryIso !== company.country) {
                      <span class="text-gray-400 text-xs ml-1">({{ company.countryIso }})</span>
                    }
                  </td>
                  <td class="px-4 py-3">
                    @if (company.isSanctioned) {
                      <span class="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
                        </svg>
                        Yes
                      </span>
                    } @else {
                      <span class="text-xs text-gray-400">No</span>
                    }
                  </td>
                  <td class="px-4 py-3 text-right text-gray-700 font-medium tabular-nums">
                    @if (company.creditLimit && +company.creditLimit > 0) {
                      {{ formatCreditLimit(+company.creditLimit) }}
                    } @else {
                      <span class="text-gray-400">—</span>
                    }
                  </td>
                  <td class="px-4 py-3 text-center text-gray-600">
                    {{ company.contactsCount ?? 0 }}
                  </td>
                  <td class="px-4 py-3 text-sm text-gray-600">
                    {{ company.responsibleUserName ?? '—' }}
                  </td>
                  <td class="px-4 py-3">
                    @if (company.seasearcherId) {
                      <span class="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">Imported</span>
                    } @else {
                      <span class="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Manual</span>
                    }
                  </td>
                  <td class="px-4 py-3">
                    <button
                      (click)="confirmDelete(company, $event)"
                      class="rounded-md p-1 text-gray-400 hover:text-red-500 transition-colors"
                      title="Delete"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                      </svg>
                    </button>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="9" class="px-4 py-8 text-center text-gray-400">No companies found</td>
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

      <!-- Delete confirmation modal -->
      @if (deleteTarget()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="deleteTarget.set(null)">
          <div class="rounded-xl bg-white p-6 shadow-xl max-w-sm mx-4" (click)="$event.stopPropagation()">
            <h3 class="text-lg font-semibold text-gray-900">Delete company?</h3>
            <p class="mt-2 text-sm text-gray-500">
              Are you sure you want to delete <strong>{{ deleteTarget()!.name }}</strong>?
              This cannot be undone.
            </p>
            @if (deleteError()) {
              <p class="mt-2 text-sm text-red-600">{{ deleteError() }}</p>
            }
            <div class="mt-4 flex justify-end gap-2">
              <button
                (click)="deleteTarget.set(null); deleteError.set('')"
                class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >Cancel</button>
              <button
                (click)="executeDelete()"
                [disabled]="deleting()"
                class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                @if (deleting()) { Deleting… } @else { Delete }
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Create manually modal -->
      @if (showCreateModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="showCreateModal.set(false)">
          <div class="rounded-xl bg-white p-6 shadow-xl w-full max-w-lg mx-4" (click)="$event.stopPropagation()">
            <h3 class="text-lg font-semibold text-gray-900">Create Company</h3>
            <p class="mt-1 text-sm text-gray-500">Add a company manually that isn't in Seasearcher.</p>

            @if (createError()) {
              <div class="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                {{ createError() }}
              </div>
            }

            <div class="mt-4 space-y-4">
              <div class="grid grid-cols-2 gap-4">
                <div class="col-span-2">
                  <label class="block text-sm font-medium text-gray-700">Name *</label>
                  <input type="text" [ngModel]="createForm().name" (ngModelChange)="updateCreateForm('name', $event)"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                    placeholder="Company name" />
                </div>
                <div class="col-span-2">
                  <label class="block text-sm font-medium text-gray-700 mb-1">Type(s) *</label>
                  <div class="flex flex-wrap gap-3">
                    @for (opt of typeOptions; track opt.value) {
                      <label class="inline-flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" [checked]="createForm().types.includes(opt.value)"
                          (change)="toggleType(opt.value)"
                          class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                        <span class="text-sm text-gray-700">{{ opt.label }}</span>
                      </label>
                    }
                  </div>
                </div>
                <div class="col-span-2 sm:col-span-1">
                  <label class="block text-sm font-medium text-gray-700">Country</label>
                  <select [ngModel]="createForm().countryIso" (ngModelChange)="onCountryChange($event)"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white">
                    <option value="">Select country…</option>
                    @for (c of countries; track c.code) {
                      <option [value]="c.code">{{ c.name }}</option>
                    }
                  </select>
                </div>
              </div>
            </div>

            <div class="mt-5 flex justify-end gap-2">
              <button
                (click)="showCreateModal.set(false)"
                class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >Cancel</button>
              <button
                (click)="createManually()"
                [disabled]="!createForm().name || !createForm().types.length || creating()"
                class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                @if (creating()) { Creating… } @else { Create Company }
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class CompaniesPageComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy$ = new Subject<void>();
  private readonly searchSubject = new Subject<string>();

  readonly pageSize = 25;

  // ─── State ──────────────────────────────────────────────────────────
  readonly companies = signal<CounterpartyDto[]>([]);
  readonly total = signal(0);
  readonly currentPage = signal(1);
  readonly loading = signal(true);
  readonly filterType = signal('');
  readonly filterResponsible = signal('');
  readonly sortBy = signal('');
  readonly sortDir = signal<'asc' | 'desc'>('asc');
  readonly users = signal<{ id: string; name: string; email: string }[]>([]);

  // Search / typeahead
  readonly searchTerm = signal('');
  readonly searchResults = signal<CompanySearchResult[]>([]);
  readonly searching = signal(false);
  readonly searchDone = signal(false);
  readonly dropdownOpen = signal(false);


  // Delete
  readonly deleteTarget = signal<CounterpartyDto | null>(null);
  readonly deleting = signal(false);
  readonly deleteError = signal('');

  // Create
  readonly showCreateModal = signal(false);
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);
  readonly createForm = signal<{ name: string; types: string[]; country: string; countryIso: string }>({
    name: '',
    types: ['CLIENT'],
    country: '',
    countryIso: '',
  });
  readonly countries = COUNTRIES;
  readonly typeOptions = [
    { value: 'CLIENT', label: 'Client' },
    { value: 'SUPPLIER', label: 'Supplier' },
    { value: 'BARGE', label: 'Barge' },
  ];

  ngOnInit(): void {
    // Restore page & filter from URL query params
    const params = this.route.snapshot.queryParamMap;
    const page = Number(params.get('page'));
    if (page > 0) this.currentPage.set(page);
    const type = params.get('type');
    if (type) this.filterType.set(type);
    const responsible = params.get('responsible');
    if (responsible) this.filterResponsible.set(responsible);
    const sortBy = params.get('sortBy');
    if (sortBy) this.sortBy.set(sortBy);
    const sortDir = params.get('sortDir') as 'asc' | 'desc';
    if (sortDir) this.sortDir.set(sortDir);

    this.loadCompanies();
    this.loadUsers();

    // Debounced search
    this.searchSubject
      .pipe(
        debounceTime(300),
        tap(() => this.searching.set(true)),
        switchMap((term) => {
          if (term.length < 2) return of(null);
          return this.http
            .get<ApiResponse<CompanySearchResult[]>>(`${API}/companies/search?term=${encodeURIComponent(term)}`)
            .pipe(catchError(() => of(null)));
        }),
        takeUntil(this.destroy$),
      )
      .subscribe((res) => {
        this.searching.set(false);
        if (res && res.success && res.data) {
          this.searchResults.set(res.data);
          this.searchDone.set(true);
          this.dropdownOpen.set(true);
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ─── Data loading ──────────────────────────────────────────────────
  async loadCompanies(): Promise<void> {
    this.loading.set(true);
    const params = new URLSearchParams();
    params.set('page', String(this.currentPage()));
    params.set('limit', String(this.pageSize));
    if (this.filterType()) params.set('type', this.filterType());
    if (this.filterResponsible()) params.set('responsibleUserId', this.filterResponsible());
    if (this.sortBy()) params.set('sortBy', this.sortBy());
    if (this.sortBy()) params.set('sortDir', this.sortDir());

    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(`${API}/companies/local?${params}`),
      );
      if (res.success && res.data) {
        this.companies.set(res.data.companies);
        this.total.set(res.data.total);
      }
    } catch (err) {
      console.error('Failed to load companies:', err);
    } finally {
      this.loading.set(false);
    }
  }

  // ─── Search ────────────────────────────────────────────────────────
  onSearchInput(term: string): void {
    this.searchTerm.set(term);
    this.searchDone.set(false);
    this.dropdownOpen.set(false);
    if (term.length >= 2) {
      this.searchSubject.next(term);
    } else {
      this.searchResults.set([]);
    }
  }

  onSearchFocus(): void {
    if (this.searchResults().length && this.searchDone()) {
      this.dropdownOpen.set(true);
    }
  }

  onTypeaheadClick(result: CompanySearchResult): void {
    if (result.source === 'local' && result.localId) {
      this.goToCompany(result.localId);
    }
    // For seasearcher results, import is handled by the button
  }

  async importCompany(seasearcherId: string, event: Event): Promise<void> {
    event.stopPropagation();
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<CounterpartyDto>>(`${API}/companies/import`, { seasearcherId }),
      );
      if (res.success && res.data) {
        this.dropdownOpen.set(false);
        this.searchTerm.set('');
        await this.loadCompanies();
        this.goToCompany(res.data.id);
      }
    } catch (err) {
      console.error('Import failed:', err);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────
  flagEmoji(code?: string | null): string {
    return code ? flagFromIso3(code) : '';
  }

  // ─── Navigation ────────────────────────────────────────────────────
  goToCompany(id: string): void {
    this.router.navigate(['/companies', id]);
  }

  changePage(page: number): void {
    this.currentPage.set(page);
    this.updateUrlParams();
    this.loadCompanies();
  }

  updateUrlParams(): void {
    const queryParams: Record<string, string | null> = {
      page: this.currentPage() > 1 ? String(this.currentPage()) : null,
      type: this.filterType() || null,
      responsible: this.filterResponsible() || null,
      sortBy: this.sortBy() || null,
      sortDir: this.sortBy() ? this.sortDir() : null,
    };
    this.router.navigate([], { queryParams, queryParamsHandling: 'merge', replaceUrl: true });
  }

  // ─── Sorting ────────────────────────────────────────────────────
  onSort(event: SortChangeEvent): void {
    this.sortBy.set(event.field);
    this.sortDir.set(event.dir);
    this.currentPage.set(1);
    this.updateUrlParams();
    this.loadCompanies();
  }

  private async loadUsers(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ id: string; name: string; email: string }[]>>(`${API}/lloyds/users`),
      );
      if (res.success && res.data) this.users.set(res.data);
    } catch { /* ignore */ }
  }

  // ─── Delete ────────────────────────────────────────────────────────
  confirmDelete(company: CounterpartyDto, event: Event): void {
    event.stopPropagation();
    this.deleteTarget.set(company);
    this.deleteError.set('');
  }

  async executeDelete(): Promise<void> {
    const target = this.deleteTarget();
    if (!target) return;

    this.deleting.set(true);
    try {
      const res = await firstValueFrom(
        this.http.delete<ApiResponse<{ id: string }>>(`${API}/companies/local/${target.id}`),
      );
      if (res.success) {
        this.deleteTarget.set(null);
        await this.loadCompanies();
      } else {
        this.deleteError.set(res.message ?? 'Failed to delete');
      }
    } catch (err) {
      this.deleteError.set('Failed to delete company');
    } finally {
      this.deleting.set(false);
    }
  }

  // ─── Create ────────────────────────────────────────────────────────
  openCreateModal(): void {
    this.createForm.set({
      name: this.searchTerm(),
      types: ['CLIENT'],
      country: '',
      countryIso: '',
    });
    this.createError.set(null);
    this.dropdownOpen.set(false);
    this.showCreateModal.set(true);
  }

  updateCreateForm(field: string, value: string): void {
    this.createForm.update((f) => ({ ...f, [field]: value }));
  }

  toggleType(type: string): void {
    this.createForm.update((f) => {
      const types = f.types.includes(type)
        ? f.types.filter((t) => t !== type)
        : [...f.types, type];
      return { ...f, types };
    });
  }

  onCountryChange(code: string): void {
    const c = COUNTRIES.find((x) => x.code === code);
    this.createForm.update((f) => ({
      ...f,
      countryIso: code,
      country: c?.name ?? '',
    }));
  }

  async createManually(): Promise<void> {
    const form = this.createForm();
    if (!form.name || !form.types.length) {
      this.createError.set('Name and at least one type are required.');
      return;
    }

    this.creating.set(true);
    this.createError.set(null);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        types: form.types,
      };
      if (form.country) body['country'] = form.country;
      if (form.countryIso) body['countryIso'] = form.countryIso;

      const res = await firstValueFrom(
        this.http.post<ApiResponse<CounterpartyDto>>(`${API}/companies/local`, body),
      );
      if (res.success && res.data) {
        this.showCreateModal.set(false);
        this.searchTerm.set('');
        this.searchResults.set([]);
        this.searchDone.set(false);
        await this.loadCompanies();
        this.goToCompany(res.data.id);
      }
    } catch (err: any) {
      const message = err?.error?.message || 'Failed to create company';
      this.createError.set(message);
      console.error('Create failed:', err);
    } finally {
      this.creating.set(false);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────
  typeLabel(type: string): string {
    return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  }

  typeBadgeClass(type: string): string {
    switch (type) {
      case 'CLIENT': return 'bg-blue-100 text-blue-700';
      case 'SUPPLIER': return 'bg-green-100 text-green-700';
      case 'BARGE': return 'bg-amber-100 text-amber-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  }

  formatCreditLimit(amount: number): string {
    if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
    if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
    return `$${amount.toFixed(0)}`;
  }
}
