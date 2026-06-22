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
import { COUNTRIES, SORTED_COUNTRIES } from '../../../../shared/data/countries';
import { flagFromIso3 } from '../../../../shared/utils/flags';
import { PaginationComponent, SortHeaderComponent } from '../../../../shared/components';
import type { SortChangeEvent } from '../../../../shared/components';
import { RiskMonitoringService } from '@app/core/risk-monitoring/risk-monitoring.service';
import { CompaniesCreateModalComponent } from './companies-create-modal.component';
import { CompaniesDeleteModalComponent } from './companies-delete-modal.component';

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
  imports: [FormsModule, PaginationComponent, SortHeaderComponent, CompaniesCreateModalComponent, CompaniesDeleteModalComponent],
  template: `
    <div>
      <!-- Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">Companies</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-muted">
            Manage clients, suppliers, brokers and agents.
            Import from Seasearcher or create manually.
          </p>
        </div>
      </div>

      <!-- Search + Import bar -->
      <div class="flex flex-col sm:flex-row gap-3 mb-4">
        <!-- Typeahead search -->
        <div class="relative flex-1">
          <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <svg class="h-4 w-4 text-gray-400 dark:text-muted" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" />
            </svg>
          </div>
          <input
            type="text"
            [ngModel]="searchTerm()"
            (ngModelChange)="onSearchInput($event)"
            (focus)="onSearchFocus()"
            placeholder="Search companies to import or create (min. 2 characters)…"
            class="w-full rounded-lg border border-gray-300 dark:border-line-strong py-2 pl-9 pr-3 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
          />
          @if (searching()) {
            <div class="absolute inset-y-0 right-0 flex items-center pr-3">
              <svg class="h-4 w-4 animate-spin text-gray-400 dark:text-muted" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            </div>
          }

          <!-- Typeahead dropdown -->
          @if (dropdownOpen() && searchDone()) {
            <div class="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-lg max-h-80 overflow-y-auto">
              @for (r of searchResults(); track r.seasearcherId ?? r.localId) {
                <div (click)="onTypeaheadClick(r)" class="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-surface-tint transition-colors border-b border-gray-50 last:border-0 cursor-pointer">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-medium text-gray-900 dark:text-ink truncate">{{ r.name }}</span>
                      @if (r.isSanctioned) {
                        <span class="inline-flex rounded-full bg-red-100 dark:bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">Sanctioned</span>
                      }
                    </div>
                    <div class="flex items-center gap-2 mt-0.5">
                      @if (r.country) {
                        <span class="text-xs text-gray-500 dark:text-muted">{{ flagEmoji(r.countryCode) }} {{ r.country }}</span>
                      }
                      @if (r.companyImo) {
                        <span class="text-xs text-gray-400 dark:text-muted">IMO {{ r.companyImo }}</span>
                      }
                      @if (r.fleetSize) {
                        <span class="text-xs text-gray-400 dark:text-muted">Fleet: {{ r.fleetSize }}</span>
                      }
                    </div>
                  </div>
                  <div class="shrink-0">
                    @if (r.source === 'local') {
                      <span class="inline-flex rounded-full bg-green-100 dark:bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">Local</span>
                    } @else {
                      <button
                        (click)="importCompany(r.seasearcherId!, $event)"
                        class="inline-flex items-center gap-1 rounded-md bg-brand-50 dark:bg-brand-700/15 px-2 py-1 text-xs font-medium text-brand-700 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-500/20 transition-colors"
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
                <div class="px-3 py-3 text-center text-sm text-gray-500 dark:text-muted">
                  No companies found matching "{{ searchTerm() }}"
                </div>
              }

              <!-- Always show create manually option -->
              <div class="border-t border-gray-100 dark:border-line px-3 py-2.5">
                <button
                  (click)="openCreateModal(); $event.stopPropagation()"
                  class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-brand-700 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-500/15 transition-colors"
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
          class="rounded-lg border border-gray-300 dark:border-line-strong py-2 pl-3 pr-8 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
        >
          <option value="">All Types</option>
          @for (type of availableTypes(); track type) {
            <option [value]="type">{{ typeLabel(type) }}</option>
          }
        </select>

        <!-- Filter by responsible -->
        <select
          [ngModel]="filterResponsible()"
          (ngModelChange)="filterResponsible.set($event); currentPage.set(1); loadCompanies(); updateUrlParams()"
          class="rounded-lg border border-gray-300 dark:border-line-strong py-2 pl-3 pr-8 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
        >
          <option value="">All Responsible</option>
          @for (u of users(); track u.id) {
            <option [value]="u.id">{{ u.name }}</option>
          }
        </select>

        <!-- Filter by country -->
        <select
          [ngModel]="filterCountry()"
          (ngModelChange)="filterCountry.set($event); currentPage.set(1); loadCompanies(); updateUrlParams()"
          class="rounded-lg border border-gray-300 dark:border-line-strong py-2 pl-3 pr-8 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
        >
          <option value="">All Countries</option>
          @for (c of countries; track c.code) {
            <option [value]="c.name">{{ flagEmoji(c.code) }} {{ c.name }}</option>
          }
        </select>

        <!-- Filter by segment -->
        @if (segmentCategories().length > 0) {
          <select
            [ngModel]="filterSegment()"
            (ngModelChange)="filterSegment.set($event); currentPage.set(1); loadCompanies(); updateUrlParams()"
            class="rounded-lg border border-gray-300 dark:border-line-strong py-2 pl-3 pr-8 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
          >
            <option value="">All Segments</option>
            @for (cat of segmentCategories(); track cat.key) {
              @for (opt of cat.options; track opt.key) {
                <option [value]="cat.key + ':' + opt.key">{{ cat.label }}: {{ opt.label }}</option>
              }
            }
          </select>
        }
      </div>

      <!-- Click-away backdrop for dropdown -->
      @if (dropdownOpen()) {
        <div class="fixed inset-0 z-10" (click)="dropdownOpen.set(false)"></div>
      }

      <!-- Companies table -->
      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <svg class="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else {
        <div class="overflow-x-auto rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200 dark:border-line bg-gray-50/80 dark:bg-surface-2">
                <th app-sort-header field="name" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">Name</th>
                <th app-sort-header field="type" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">Type</th>
                <th app-sort-header field="country" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">Country</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">Sanctioned</th>
                <th app-sort-header field="creditLimit" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-right font-medium text-gray-600 dark:text-ink-dim">Credit Limit</th>
                <th class="px-4 py-3 text-center font-medium text-gray-600 dark:text-ink-dim">Contacts</th>
                <th app-sort-header field="responsible" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">Responsible</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">Source</th>
                <th class="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-line">
              @for (company of companies(); track company.id) {
                <tr class="transition-colors hover:bg-gray-50/50 cursor-pointer dark:hover:bg-surface-tint" (click)="goToCompany(company.id)">
                  <td class="px-4 py-3">
                    <span class="font-medium text-gray-900 dark:text-ink">{{ company.name }}</span>
                    @if (company.parentName) {
                      <span class="ml-1.5 inline-flex items-center rounded-full bg-indigo-50 dark:bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-600 dark:text-indigo-400">
                        Child of {{ company.parentName }}
                      </span>
                    }
                    @if (isCompanyFrozen(company.id)) {
                      <div class="mt-1">
                        <span class="inline-flex items-center gap-1 rounded-full border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-400">
                          <span class="inline-flex h-1.5 w-1.5 rounded-full bg-red-500"></span>
                          Credit Frozen
                        </span>
                      </div>
                    }
                    @if (getSegmentBadges(company).length > 0) {
                      <div class="flex flex-wrap gap-1 mt-0.5">
                        @for (badge of getSegmentBadges(company); track badge) {
                          <span class="inline-flex items-center rounded-full bg-violet-50 dark:bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-400">{{ badge }}</span>
                        }
                      </div>
                    }
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
                  <td class="px-4 py-3 text-gray-600 dark:text-ink-dim">
                    {{ flagEmoji(company.countryIso) }} {{ company.country ?? '—' }}
                    @if (company.countryIso && company.countryIso !== company.country) {
                      <span class="text-gray-400 dark:text-muted text-xs ml-1">({{ company.countryIso }})</span>
                    }
                  </td>
                  <td class="px-4 py-3">
                    @if (company.isSanctioned) {
                      <span class="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
                        </svg>
                        Yes
                      </span>
                    } @else {
                      <span class="text-xs text-gray-400 dark:text-muted">No</span>
                    }
                  </td>
                  <td class="px-4 py-3 text-right text-gray-700 dark:text-ink-dim font-medium tabular-nums">
                    @if (company.creditLimit && +company.creditLimit > 0) {
                      {{ formatCreditLimit(+company.creditLimit) }}
                    } @else {
                      <span class="text-gray-400 dark:text-muted">—</span>
                    }
                  </td>
                  <td class="px-4 py-3 text-center text-gray-600 dark:text-ink-dim">
                    {{ company.contactsCount ?? 0 }}
                  </td>
                  <td class="px-4 py-3 text-sm text-gray-600 dark:text-ink-dim">
                    {{ company.responsibleUserName ?? '—' }}
                  </td>
                  <td class="px-4 py-3">
                    @if (company.seasearcherId) {
                      <span class="inline-flex rounded-full bg-blue-50 dark:bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400">Imported</span>
                    } @else {
                      <span class="inline-flex rounded-full bg-gray-100 dark:bg-surface-3 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-ink-dim">Manual</span>
                    }
                  </td>
                  <td class="px-4 py-3">
                    <button
                      (click)="confirmDelete(company, $event)"
                      class="rounded-md p-1 text-gray-400 dark:text-muted hover:text-red-500 transition-colors"
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
                  <td colspan="9" class="px-4 py-8 text-center text-gray-400 dark:text-muted">No companies found</td>
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
      <app-companies-delete-modal
        [open]="!!deleteTarget()"
        [companyName]="deleteTarget()?.name ?? ''"
        [deleting]="deleting()"
        [error]="deleteError()"
        (cancel)="deleteTarget.set(null); deleteError.set('')"
        (confirm)="executeDelete()"
      />

      <!-- Create manually modal -->
      <!-- Create Company Modal -->
      <app-companies-create-modal
        [open]="showCreateModal()"
        [creating]="creating()"
        [error]="createError()"
        [form]="createForm()"
        [typeOptions]="typeOptions()"
        [countries]="countries"
        (cancel)="showCreateModal.set(false)"
        (save)="createManually()"
        (toggleType)="toggleType($event)"
        (countryChange)="onCountryChange($event)"
        (formChange)="onCreateFormChange($event)"
      />
    </div>
  `,
})
export class CompaniesPageComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly riskMonitoringService = inject(RiskMonitoringService);
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
  readonly filterCountry = signal('');
  readonly filterSegment = signal(''); // format: "categoryKey:optionKey"
  readonly sortBy = signal('');
  readonly sortDir = signal<'asc' | 'desc'>('asc');
  readonly users = signal<{ id: string; name: string; email: string }[]>([]);
  readonly segmentCategories = signal<{ key: string; label: string; mode: 'multi' | 'single'; options: { key: string; label: string }[] }[]>([]);
  readonly frozenCompanyIds = signal<Set<string>>(new Set());

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
  readonly countries = SORTED_COUNTRIES;
  readonly availableTypes = signal<string[]>(['CLIENT', 'SUPPLIER', 'BROKER', 'AGENT']);
  readonly typeOptions = () => this.availableTypes().map((type) => ({ value: type, label: this.typeLabel(type) }));

  ngOnInit(): void {
    // Restore page & filter from URL query params
    const params = this.route.snapshot.queryParamMap;
    const page = Number(params.get('page'));
    if (page > 0) this.currentPage.set(page);
    const type = params.get('type');
    if (type) this.filterType.set(type);
    const responsible = params.get('responsible');
    if (responsible) this.filterResponsible.set(responsible);
    const country = params.get('country');
    if (country) this.filterCountry.set(country);
    const sortBy = params.get('sortBy');
    if (sortBy) this.sortBy.set(sortBy);
    const sortDir = params.get('sortDir') as 'asc' | 'desc';
    if (sortDir) this.sortDir.set(sortDir);
    const segment = params.get('segment');
    if (segment) this.filterSegment.set(segment);

    this.loadCompanies();
    this.loadCompanyTypes();
    this.loadUsers();
    this.loadSegmentCategories();

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
    if (this.filterCountry()) params.set('country', this.filterCountry());
    if (this.filterSegment()) params.set('segment', this.filterSegment());
    if (this.sortBy()) params.set('sortBy', this.sortBy());
    if (this.sortBy()) params.set('sortDir', this.sortDir());

    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(`${API}/companies/local?${params}`),
      );
      if (res.success && res.data) {
        this.companies.set(res.data.companies);
        this.total.set(res.data.total);
        await this.loadFrozenStates(res.data.companies);
      }
    } catch (err) {
      console.error('Failed to load companies:', err);
      this.frozenCompanyIds.set(new Set());
    } finally {
      this.loading.set(false);
    }
  }

  private async loadFrozenStates(companies: CounterpartyDto[]): Promise<void> {
    const ids = companies.map((company) => company.id);
    if (!ids.length) {
      this.frozenCompanyIds.set(new Set());
      return;
    }

    try {
      const frozen = await this.riskMonitoringService.batchFrozen(ids);
      this.frozenCompanyIds.set(new Set(frozen));
    } catch {
      this.frozenCompanyIds.set(new Set());
    }
  }

  isCompanyFrozen(companyId: string): boolean {
    return this.frozenCompanyIds().has(companyId);
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
      country: this.filterCountry() || null,
      segment: this.filterSegment() || null,
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

  private async loadCompanyTypes(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ companyTypes: string[] }>>(`${API}/admin/settings/my-company-types`),
      );
      if (res.success && res.data?.companyTypes?.length) {
        this.availableTypes.set(res.data.companyTypes);
      }
    } catch {
      // Keep defaults if fetch fails
    }
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
    } catch (err: any) {
      const msg = err?.error?.message ?? err?.message ?? 'Failed to delete company';
      this.deleteError.set(msg);
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

  onCreateFormChange(partial: Partial<{ name: string; types: string[]; country: string; countryIso: string }>): void {
    this.createForm.update((f) => ({ ...f, ...partial }));
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
      case 'CLIENT': return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400';
      case 'SUPPLIER': return 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400';
      case 'BROKER': return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-400';
      case 'AGENT': return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400';
      default: return 'bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-400';
    }
  }

  formatCreditLimit(amount: number): string {
    if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
    if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
    return `$${amount.toFixed(0)}`;
  }

  // ─── Segments ──────────────────────────────────────────────────────

  private async loadSegmentCategories(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ segmentCategories: { key: string; label: string; mode: 'multi' | 'single'; options: { key: string; label: string }[] }[] }>>(`${API}/admin/settings/segment-settings/options`),
      );
      if (res.success && res.data?.segmentCategories) {
        this.segmentCategories.set(res.data.segmentCategories);
      }
    } catch {
      // Segment categories not available
    }
  }

  getSegmentBadges(company: any): string[] {
    const segs = company.segments as Record<string, string | string[]> | null | undefined;
    if (!segs) return [];
    const cats = this.segmentCategories();
    const badges: string[] = [];
    for (const cat of cats) {
      const val = segs[cat.key];
      if (!val) continue;
      const keys = Array.isArray(val) ? val : [val];
      for (const k of keys) {
        if (!k) continue;
        const opt = cat.options.find(o => o.key === k);
        badges.push(opt ? opt.label : k);
      }
    }
    return badges;
  }
}
