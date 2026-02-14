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
import type { VesselDto, ApiResponse } from '@fueld/types';
import { flagFromIso3 } from '../../../../shared/utils/flags';
import { PaginationComponent, SortHeaderComponent } from '../../../../shared/components';
import type { SortChangeEvent } from '../../../../shared/components';

// ═══════════════════════════════════════════════════════════════════════
//  Vessels Page — Browse, search, import from Seasearcher, create
// ═══════════════════════════════════════════════════════════════════════

import { API } from '@app/core/config/api';

interface VesselSearchResult {
  source: 'local' | 'seasearcher';
  localId?: string;
  seasearcherId?: string;
  name: string;
  imo?: string;
  mmsi?: string;
  flag?: string;
  flagCode?: string;
  type?: string;
  status?: string;
  dwt?: number;
  gt?: number;
  buildYear?: number;
  isSanctioned?: boolean;
}

@Component({
  selector: 'app-vessels-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PaginationComponent, SortHeaderComponent],
  template: `
    <div>
      <!-- Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Vessels</h1>
          <p class="mt-1 text-sm text-gray-500">
            Manage vessels. Import from Seasearcher or create manually.
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
            placeholder="Search vessels by name, IMO or MMSI…"
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
                      @if (r.imo) {
                        <span class="text-xs text-gray-400">IMO {{ r.imo }}</span>
                      }
                      @if (r.flag) {
                        <span class="text-xs text-gray-500">{{ flagEmoji(r.flagCode) }} {{ r.flag }}</span>
                      }
                      @if (r.type) {
                        <span class="text-xs text-gray-400 capitalize">{{ r.type }}</span>
                      }
                      @if (r.dwt) {
                        <span class="text-xs text-gray-400">{{ r.dwt.toLocaleString() }} DWT</span>
                      }
                    </div>
                  </div>
                  <div class="shrink-0">
                    @if (r.source === 'local') {
                      <span class="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Local</span>
                    } @else {
                      <button
                        (click)="importVessel(r.seasearcherId!, $event)"
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
                  No vessels found matching "{{ searchTerm() }}"
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
      </div>

      <!-- Click-away backdrop for dropdown -->
      @if (dropdownOpen()) {
        <div class="fixed inset-0 z-10" (click)="dropdownOpen.set(false)"></div>
      }

      <!-- Vessels table -->
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
              <tr class="border-b border-gray-100 bg-gray-50/60">
                <th app-sort-header field="name" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-5 py-3 text-left font-medium text-gray-500">Vessel</th>
                <th app-sort-header field="type" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-5 py-3 text-left font-medium text-gray-500">Type</th>
                <th app-sort-header field="flag" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-5 py-3 text-left font-medium text-gray-500">Flag</th>
                <th app-sort-header field="dwt" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-5 py-3 text-right font-medium text-gray-500">DWT</th>
                <th app-sort-header field="gt" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-5 py-3 text-right font-medium text-gray-500">GT</th>
                <th app-sort-header field="buildYear" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-5 py-3 text-left font-medium text-gray-500">Built</th>
                <th class="px-5 py-3 text-left font-medium text-gray-500">Source</th>
                <th class="px-5 py-3 text-right font-medium text-gray-500"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              @for (v of vessels(); track v.id) {
                <tr class="hover:bg-gray-50/50 transition-colors cursor-pointer" (click)="goToVessel(v.id)">
                  <td class="px-5 py-3">
                    <div class="font-medium text-gray-900">{{ v.name }}</div>
                    <div class="text-xs text-gray-400">
                      @if (v.imo) { IMO {{ v.imo }} }
                      @if (v.mmsi) { · MMSI {{ v.mmsi }} }
                    </div>
                  </td>
                  <td class="px-5 py-3 text-gray-600 capitalize">{{ v.type || '—' }}</td>
                  <td class="px-5 py-3 text-gray-600">{{ flagEmoji(v.flagCode) }} {{ v.flag || '—' }}</td>
                  <td class="px-5 py-3 text-right text-gray-600 font-mono text-xs">{{ v.deadWeightTonnage ? v.deadWeightTonnage.toLocaleString() : '—' }}</td>
                  <td class="px-5 py-3 text-right text-gray-600 font-mono text-xs">{{ v.grossTonnage ? v.grossTonnage.toLocaleString() : '—' }}</td>
                  <td class="px-5 py-3 text-gray-600">{{ v.buildYear ?? '—' }}</td>
                  <td class="px-5 py-3">
                    @if (v.seasearcherId) {
                      <span class="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">Seasearcher</span>
                    } @else {
                      <span class="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">Manual</span>
                    }
                  </td>
                  <td class="px-5 py-3 text-right">
                    <button
                      (click)="confirmDelete(v, $event)"
                      class="rounded p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
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
                  <td colspan="8" class="px-5 py-12 text-center text-gray-400">
                    No vessels yet. Use the search bar above to import from Seasearcher or create manually.
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

      <!-- Delete Confirmation Modal -->
      @if (deleteTarget()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 class="text-lg font-semibold text-gray-900">Delete Vessel</h3>
            <p class="mt-2 text-sm text-gray-600">
              Are you sure you want to delete <strong>{{ deleteTarget()!.name }}</strong>?
              This action cannot be undone.
            </p>
            @if (deleteError()) {
              <p class="mt-2 text-sm text-red-600">{{ deleteError() }}</p>
            }
            <div class="mt-4 flex justify-end gap-3">
              <button
                (click)="deleteTarget.set(null); deleteError.set('')"
                class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
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

      <!-- Create Modal -->
      @if (showCreateModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 class="text-lg font-semibold text-gray-900 mb-4">Create Vessel</h3>

            <div class="space-y-3">
              <!-- Name -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Vessel Name *</label>
                <input
                  type="text"
                  [ngModel]="createForm().name"
                  (ngModelChange)="updateCreateForm('name', $event)"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </div>

              <!-- IMO + MMSI row -->
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">IMO</label>
                  <input
                    type="text"
                    [ngModel]="createForm().imo"
                    (ngModelChange)="updateCreateForm('imo', $event)"
                    class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">MMSI</label>
                  <input
                    type="text"
                    [ngModel]="createForm().mmsi"
                    (ngModelChange)="updateCreateForm('mmsi', $event)"
                    class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  />
                </div>
              </div>

              <!-- Flag + Type row -->
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Flag</label>
                  <input
                    type="text"
                    [ngModel]="createForm().flag"
                    (ngModelChange)="updateCreateForm('flag', $event)"
                    class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <input
                    type="text"
                    [ngModel]="createForm().type"
                    (ngModelChange)="updateCreateForm('type', $event)"
                    class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  />
                </div>
              </div>
            </div>

            @if (createError()) {
              <p class="mt-3 text-sm text-red-600">{{ createError() }}</p>
            }

            <div class="mt-5 flex justify-end gap-3">
              <button
                (click)="showCreateModal.set(false)"
                class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >Cancel</button>
              <button
                (click)="createManually()"
                [disabled]="creating()"
                class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                @if (creating()) { Creating… } @else { Create }
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class VesselsPageComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly searchSubject = new Subject<string>();
  private readonly destroy$ = new Subject<void>();

  // ─── State ─────────────────────────────────────────────────────────
  readonly vessels = signal<VesselDto[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly currentPage = signal(1);
  readonly pageSize = 25;
  readonly totalPages = signal(1);
  readonly sortBy = signal('');
  readonly sortDir = signal<'asc' | 'desc'>('asc');

  // Search
  readonly searchTerm = signal('');
  readonly searchResults = signal<VesselSearchResult[]>([]);
  readonly searching = signal(false);
  readonly searchDone = signal(false);
  readonly dropdownOpen = signal(false);

  // Delete
  readonly deleteTarget = signal<VesselDto | null>(null);
  readonly deleteError = signal('');
  readonly deleting = signal(false);

  // Create
  readonly showCreateModal = signal(false);
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);
  readonly createForm = signal({
    name: '',
    imo: '',
    mmsi: '',
    flag: '',
    type: '',
  });

  ngOnInit(): void {
    // Restore page from URL query params
    const params = this.route.snapshot.queryParamMap;
    const page = Number(params.get('page'));
    if (page > 0) this.currentPage.set(page);

    this.loadVessels();

    this.searchSubject
      .pipe(
        debounceTime(300),
        tap(() => this.searching.set(true)),
        switchMap((term) => {
          if (term.length < 2) return of(null);
          return this.http
            .get<ApiResponse<VesselSearchResult[]>>(`${API}/vessels/search?term=${encodeURIComponent(term)}`)
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
  async loadVessels(): Promise<void> {
    this.loading.set(true);
    const params = new URLSearchParams();
    params.set('page', String(this.currentPage()));
    params.set('limit', String(this.pageSize));
    if (this.sortBy()) params.set('sortBy', this.sortBy());
    if (this.sortBy()) params.set('sortDir', this.sortDir());

    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ vessels: VesselDto[]; total: number }>>(`${API}/vessels/local?${params}`),
      );
      if (res.success && res.data) {
        this.vessels.set(res.data.vessels);
        this.total.set(res.data.total);
        this.totalPages.set(Math.max(1, Math.ceil(res.data.total / this.pageSize)));
      }
    } catch (err) {
      console.error('Failed to load vessels:', err);
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

  onTypeaheadClick(result: VesselSearchResult): void {
    if (result.source === 'local' && result.localId) {
      this.goToVessel(result.localId);
    }
  }

  async importVessel(seasearcherId: string, event: Event): Promise<void> {
    event.stopPropagation();
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<VesselDto>>(`${API}/vessels/import`, { seasearcherId }),
      );
      if (res.success && res.data) {
        this.dropdownOpen.set(false);
        this.searchTerm.set('');
        await this.loadVessels();
        this.goToVessel(res.data.id);
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
  goToVessel(id: string): void {
    this.router.navigate(['/vessels', id]);
  }

  changePage(page: number): void {
    this.currentPage.set(page);
    this.updateUrlParams();
    this.loadVessels();
  }

  private updateUrlParams(): void {
    const queryParams: Record<string, string | null> = {
      page: this.currentPage() > 1 ? String(this.currentPage()) : null,
      sortBy: this.sortBy() || null,
      sortDir: this.sortBy() ? this.sortDir() : null,
    };
    this.router.navigate([], { queryParams, queryParamsHandling: 'merge', replaceUrl: true });
  }

  onSort(event: SortChangeEvent): void {
    this.sortBy.set(event.field);
    this.sortDir.set(event.dir);
    this.currentPage.set(1);
    this.updateUrlParams();
    this.loadVessels();
  }

  // ─── Delete ────────────────────────────────────────────────────────
  confirmDelete(vessel: VesselDto, event: Event): void {
    event.stopPropagation();
    this.deleteTarget.set(vessel);
    this.deleteError.set('');
  }

  async executeDelete(): Promise<void> {
    const target = this.deleteTarget();
    if (!target) return;

    this.deleting.set(true);
    try {
      const res = await firstValueFrom(
        this.http.delete<ApiResponse<{ id: string }>>(`${API}/vessels/local/${target.id}`),
      );
      if (res.success) {
        this.deleteTarget.set(null);
        await this.loadVessels();
      } else {
        this.deleteError.set(res.message ?? 'Failed to delete');
      }
    } catch (err) {
      this.deleteError.set('Failed to delete vessel');
    } finally {
      this.deleting.set(false);
    }
  }

  // ─── Create ────────────────────────────────────────────────────────
  openCreateModal(): void {
    this.createForm.set({
      name: this.searchTerm(),
      imo: '',
      mmsi: '',
      flag: '',
      type: '',
    });
    this.createError.set(null);
    this.dropdownOpen.set(false);
    this.showCreateModal.set(true);
  }

  updateCreateForm(field: string, value: string): void {
    this.createForm.update((f) => ({ ...f, [field]: value }));
  }

  async createManually(): Promise<void> {
    const form = this.createForm();
    if (!form.name) {
      this.createError.set('Vessel name is required.');
      return;
    }

    this.creating.set(true);
    this.createError.set(null);
    try {
      const body: Record<string, unknown> = { name: form.name.trim() };
      if (form.imo) body['imo'] = form.imo.trim();
      if (form.mmsi) body['mmsi'] = form.mmsi.trim();
      if (form.flag) body['flag'] = form.flag.trim();
      if (form.type) body['type'] = form.type.trim();

      const res = await firstValueFrom(
        this.http.post<ApiResponse<VesselDto>>(`${API}/vessels/local`, body),
      );
      if (res.success && res.data) {
        this.showCreateModal.set(false);
        this.searchTerm.set('');
        this.searchResults.set([]);
        this.searchDone.set(false);
        await this.loadVessels();
        this.goToVessel(res.data.id);
      }
    } catch (err: any) {
      const message = err?.error?.message || 'Failed to create vessel';
      this.createError.set(message);
      console.error('Create failed:', err);
    } finally {
      this.creating.set(false);
    }
  }
}
