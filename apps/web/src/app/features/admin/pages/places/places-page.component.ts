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
import type { PlaceDto, ApiResponse, CreatePlaceDto } from '@fueld/types';
import { COUNTRIES, SORTED_COUNTRIES } from '../../../../shared/data/countries';
import { AREAS } from '../../../../shared/data/areas';
import { PaginationComponent, SortHeaderComponent } from '../../../../shared/components';
import type { SortChangeEvent } from '../../../../shared/components';
import { flagFromIso3, flagFromUnlocode } from '../../../../shared/utils/flags';

// ═══════════════════════════════════════════════════════════════════════
//  Places Page — Browse local places + search & import from Lloyd's
// ═══════════════════════════════════════════════════════════════════════

import { API } from '@app/core/config/api';

interface LliSearchResult {
  source: 'local' | 'lloyds';
  localId?: string;
  lliPlaceId?: string;
  name: string;
  country: string;
  countryIso?: string;
  area?: string;
  type?: string;
  latitude?: number;
  longitude?: number;
  unlocode?: string;
  admiraltyChart?: string;
  parentPlaceName?: string;
}

const PLACE_TYPE_LABELS: Record<string, string> = {
  POR: 'Port',
  PSP: 'Sub Port',
  ANC: 'Anchorage',
  TER: 'Terminal',
  FIL: 'Hydrocarbon Field',
};

@Component({
  selector: 'app-places-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PaginationComponent, SortHeaderComponent],
  template: `
    <div>
      <!-- Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Places</h1>
          <p class="mt-1 text-sm text-gray-500">
            Manage ports, terminals, anchorages and other places.
          </p>
        </div>
      </div>

      <!-- Search + Import bar -->
      <div class="flex flex-col sm:flex-row gap-3 mb-4">
        <!-- Typeahead search (LLI + local) -->
        <div class="relative flex-1">
          <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <svg class="h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" />
            </svg>
          </div>
          <input
            type="text"
            [ngModel]="lliSearchTerm()"
            (ngModelChange)="onSearchInput($event)"
            (focus)="onSearchFocus()"
            placeholder="Search places to import or create (min. 2 characters)…"
            class="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm
                   focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          />
          @if (lliSearching()) {
            <div class="absolute inset-y-0 right-0 flex items-center pr-3">
              <svg class="h-4 w-4 animate-spin text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            </div>
          }

          <!-- Typeahead dropdown -->
          @if (lliDropdownOpen() && searchDone()) {
            <div class="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-80 overflow-y-auto">
              @for (r of lliResults(); track r.lliPlaceId ?? r.localId) {
                <div (click)="onTypeaheadClick(r)" class="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0 cursor-pointer">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-medium text-gray-900 truncate">{{ r.name }}</span>
                      @if (r.type) {
                        <span class="inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                              [class]="placeTypeBadgeClass(r.type)">
                          {{ placeTypeLabel(r.type) }}
                        </span>
                      }
                      @if (r.source === 'local') {
                        <span class="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                          Local
                        </span>
                      }
                    </div>
                    <div class="mt-0.5 text-xs text-gray-500 truncate">
                      {{ r.country }}
                      @if (r.unlocode) { · {{ r.unlocode }} }
                      @if (r.area) { · {{ r.area }} }
                    </div>
                  </div>
                  @if (r.source === 'lloyds' && r.lliPlaceId) {
                    <button
                      (click)="importPlace(r.lliPlaceId); $event.stopPropagation()"
                      [disabled]="importingId() === r.lliPlaceId"
                      class="shrink-0 rounded-md bg-green-600 px-3 py-1 text-xs font-semibold text-white
                             hover:bg-green-700 disabled:opacity-50 transition-colors"
                    >
                      {{ importingId() === r.lliPlaceId ? 'Importing…' : 'Import' }}
                    </button>
                  }
                </div>
              } @empty {
                <div class="px-3 py-4 text-center">
                  <p class="text-sm text-gray-500">No places found matching "{{ lliSearchTerm() }}"</p>
                  <button
                    (click)="openCreateModal(); $event.stopPropagation()"
                    class="mt-2 inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white
                           hover:bg-brand-700 transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" />
                    </svg>
                    Create "{{ lliSearchTerm() }}" manually
                  </button>
                </div>
              }
            </div>
          }
        </div>
        <select
          [(ngModel)]="localTypeFilter"
          (ngModelChange)="currentPage.set(1); loadPlaces(); updateUrlParams()"
          class="w-full sm:w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm
                 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
        >
          <option value="">All types</option>
          <option value="POR">Port</option>
          <option value="PSP">Sub Port</option>
          <option value="ANC">Anchorage</option>
          <option value="TER">Terminal</option>
          <option value="FIL">Hydrocarbon Field</option>
        </select>
        <select
          [ngModel]="filterResponsible()"
          (ngModelChange)="filterResponsible.set($event); currentPage.set(1); loadPlaces(); updateUrlParams()"
          class="w-full sm:w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm
                 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
        >
          <option value="">All Responsible</option>
          @for (u of users(); track u.id) {
            <option [value]="u.id">{{ u.name }}</option>
          }
        </select>
        <button
          (click)="loadPlaces()"
          class="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700
                 hover:bg-gray-200 transition-colors"
        >
          Refresh
        </button>
      </div>

      <!-- Click-away backdrop for dropdown -->
      @if (lliDropdownOpen()) {
        <div class="fixed inset-0 z-10" (click)="lliDropdownOpen.set(false)"></div>
      }

      <!-- Desktop table -->
      <div class="hidden md:block overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 bg-gray-50/80">
              <th app-sort-header field="name" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">Name</th>
              <th app-sort-header field="country" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">Country</th>
              <th app-sort-header field="placeType" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">Type</th>
              <th app-sort-header field="unlocode" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">UNLOCODE</th>
              <th app-sort-header field="area" [sortBy]="sortBy()" [sortDir]="sortDir()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600">Area</th>
              <th class="px-4 py-3 text-left font-medium text-gray-600">Source</th>
              <th class="px-4 py-3 text-center font-medium text-gray-600">Orders</th>
              <th class="px-4 py-3 text-right font-medium text-gray-600"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            @for (place of places(); track place.id) {
              <tr (click)="openPlace(place.id)" class="cursor-pointer transition-colors hover:bg-gray-50/50">
                <td class="px-4 py-3 font-medium text-brand-700 hover:underline">{{ place.name }}</td>
                <td class="px-4 py-3 text-gray-600">
                  <span class="mr-1.5">{{ countryFlag(place) }}</span>{{ place.country }}
                  @if (place.countryIso && place.countryIso !== place.country) {
                    <span class="ml-1 text-xs text-gray-400">({{ place.countryIso }})</span>
                  }
                </td>
                <td class="px-4 py-3">
                  @if (place.placeType) {
                    <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                          [class]="placeTypeBadgeClass(place.placeType)">
                      {{ placeTypeLabel(place.placeType) }}
                    </span>
                  }
                </td>
                <td class="px-4 py-3 text-gray-500 font-mono text-xs">{{ place.unlocode ?? '—' }}</td>
                <td class="px-4 py-3 text-gray-500">{{ place.area ?? '—' }}</td>
                <td class="px-4 py-3">
                  @if (place.lliPlaceId) {
                    <span class="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">Imported</span>
                  } @else {
                    <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">Manual</span>
                  }
                </td>
                <td class="px-4 py-3 text-center">
                  @if (place.orderCount) {
                    <span class="inline-flex items-center gap-1 text-xs">
                      <span class="font-medium text-gray-700">{{ place.orderCount }}</span>
                      @if (place.activeOrderCount) {
                        <span class="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">{{ place.activeOrderCount }} active</span>
                      }
                    </span>
                  } @else {
                    <span class="text-xs text-gray-300">—</span>
                  }
                </td>
                <td class="px-4 py-3 text-right">
                  <button
                    (click)="confirmDelete(place); $event.stopPropagation()"
                    class="rounded-md p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    title="Delete place"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="8" class="px-4 py-8 text-center text-sm text-gray-400 italic">
                  @if (loading()) {
                    Loading places…
                  } @else {
                    No places found. Import some from Lloyd's List Intelligence.
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <!-- Mobile cards -->
      <div class="space-y-3 md:hidden">
        @for (place of places(); track place.id) {
          <div (click)="openPlace(place.id)" class="cursor-pointer rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-brand-300 transition-colors">
            <div class="flex items-center justify-between mb-2">
              <span class="font-semibold text-gray-900">{{ place.name }}</span>
              @if (place.placeType) {
                <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                      [class]="placeTypeBadgeClass(place.placeType)">
                  {{ placeTypeLabel(place.placeType) }}
                </span>
              }
            </div>
            <div class="grid grid-cols-2 gap-1 text-xs text-gray-500">
              <span>{{ countryFlag(place) }} {{ place.country }}</span>
              <span>🏷️ {{ place.unlocode ?? '—' }}</span>
              <span>🌍 {{ place.area ?? '—' }}</span>
              <span>� {{ place.orderCount ?? 0 }} orders @if (place.activeOrderCount) { ({{ place.activeOrderCount }} active) }</span>
            </div>
          </div>
        } @empty {
          @if (!loading()) {
            <div class="text-center py-8 text-sm text-gray-400 italic">
              No places found.
            </div>
          }
        }
      </div>

      <!-- Pagination -->
      <app-pagination
        [currentPage]="currentPage()"
        [totalItems]="totalCount()"
        [pageSize]="pageSize"
        (pageChange)="goToPage($event)"
      />

      <!-- Import success toast -->
      @if (deleteTarget()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 class="text-lg font-semibold text-gray-900">Delete Place</h3>
            <p class="mt-2 text-sm text-gray-600">
              Are you sure you want to delete <strong>{{ deleteTarget()!.name }}</strong>?
              This cannot be undone.
            </p>
            @if (deleteError()) {
              <div class="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                {{ deleteError() }}
              </div>
            }
            <div class="mt-5 flex justify-end gap-3">
              <button
                (click)="deleteTarget.set(null)"
                class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                (click)="executeDelete()"
                [disabled]="deleting()"
                class="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {{ deleting() ? 'Deleting…' : 'Delete' }}
              </button>
            </div>
          </div>
        </div>
      }
      @if (importSuccess()) {
        <div class="fixed bottom-4 right-4 z-50 rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white shadow-lg
                    animate-in slide-in-from-bottom-2">
          ✓ Place imported successfully
        </div>
      }

      <!-- Create Place Modal -->
      @if (showCreateModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div class="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h3 class="text-lg font-semibold text-gray-900">Create Place</h3>
            <p class="mt-1 text-sm text-gray-500">Add a place manually that isn't in Lloyd's List Intelligence.</p>

            @if (createError()) {
              <div class="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                {{ createError() }}
              </div>
            }

            <form class="mt-4 space-y-4" (ngSubmit)="executeCreate()">
              <div class="grid grid-cols-2 gap-4">
                <div class="col-span-2 sm:col-span-1">
                  <label class="block text-sm font-medium text-gray-700">Name *</label>
                  <input type="text" [(ngModel)]="createForm.name" name="name" required
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
                </div>
                <div class="col-span-2 sm:col-span-1">
                  <label class="block text-sm font-medium text-gray-700">Country *</label>
                  <select [ngModel]="createForm.countryIso" (ngModelChange)="onCountryChange($event)" name="country" required
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white">
                    <option value="">Select country…</option>
                    @for (c of countries; track c.code) {
                      <option [value]="c.code">{{ c.name }}</option>
                    }
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700">Type</label>
                  <select [(ngModel)]="createForm.placeType" name="placeType"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white">
                    <option [ngValue]="undefined">—</option>
                    <option value="POR">Port</option>
                    <option value="PSP">Sub Port</option>
                    <option value="ANC">Anchorage</option>
                    <option value="TER">Terminal</option>
                    <option value="FIL">Hydrocarbon Field</option>
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700">UNLOCODE</label>
                  <input type="text" [(ngModel)]="createForm.unlocode" name="unlocode"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700">Latitude</label>
                  <input type="number" step="any" [(ngModel)]="createForm.lat" name="lat"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700">Longitude</label>
                  <input type="number" step="any" [(ngModel)]="createForm.long" name="long"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none" />
                </div>
                <div class="col-span-2">
                  <label class="block text-sm font-medium text-gray-700">Area</label>
                  <select [(ngModel)]="createForm.area" name="area"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white">
                    <option [ngValue]="undefined">—</option>
                    @for (a of areas; track a) {
                      <option [value]="a">{{ a }}</option>
                    }
                  </select>
                </div>
              </div>

              <div class="flex justify-end gap-3 pt-2">
                <button type="button" (click)="showCreateModal.set(false)"
                  class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button type="submit" [disabled]="creating()"
                  class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition-colors">
                  {{ creating() ? 'Creating…' : 'Create Place' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      }
    </div>
  `,
})
export class PlacesPageComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly searchSubject = new Subject<string>();
  private readonly destroy$ = new Subject<void>();

  // ─── Local places state ──────────────────────────────────────────
  readonly places = signal<PlaceDto[]>([]);
  readonly loading = signal(false);
  readonly totalCount = signal(0);
  readonly currentPage = signal(1);
  readonly pageSize = 25;
  localTypeFilter = '';
  readonly filterResponsible = signal('');
  readonly sortBy = signal('');
  readonly sortDir = signal<'asc' | 'desc'>('asc');
  readonly users = signal<{ id: string; name: string; email: string }[]>([]);

  // ─── LLI typeahead state ─────────────────────────────────────────
  readonly lliSearchTerm = signal('');
  readonly lliResults = signal<LliSearchResult[]>([]);
  readonly lliSearching = signal(false);
  readonly lliDropdownOpen = signal(false);
  readonly searchDone = signal(false);

  // ─── Import state ───────────────────────────────────────────────
  readonly importingId = signal<string | null>(null);
  readonly importSuccess = signal(false);

  // ─── Create state ───────────────────────────────────────────────
  readonly showCreateModal = signal(false);
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);
  createForm: CreatePlaceDto = { name: '', country: '' };
  readonly countries = SORTED_COUNTRIES;
  readonly areas = AREAS;

  // ─── Delete state ─────────────────────────────────────────────────
  readonly deleteTarget = signal<PlaceDto | null>(null);
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);

  ngOnInit(): void {
    // Restore page & filter from URL query params
    const params = this.route.snapshot.queryParamMap;
    const page = Number(params.get('page'));
    if (page > 0) this.currentPage.set(page);
    const type = params.get('type');
    if (type) this.localTypeFilter = type;
    const responsible = params.get('responsible');
    if (responsible) this.filterResponsible.set(responsible);
    const sortBy = params.get('sortBy');
    if (sortBy) this.sortBy.set(sortBy);
    const sortDir = params.get('sortDir') as 'asc' | 'desc';
    if (sortDir) this.sortDir.set(sortDir);

    this.loadPlaces();
    this.loadUsers();

    // Set up debounced typeahead
    this.searchSubject
      .pipe(
        takeUntil(this.destroy$),
        debounceTime(300),
        tap((term) => {
          if (term.length < 2) {
            this.lliResults.set([]);
            this.lliDropdownOpen.set(false);
            this.lliSearching.set(false);
            this.searchDone.set(false);
          }
        }),
        switchMap((term) => {
          if (term.length < 2) return of(null);
          this.lliSearching.set(true);
          return this.http
            .get<ApiResponse<LliSearchResult[]>>(
              `${API}/lloyds/places?name=${encodeURIComponent(term)}`,
            )
            .pipe(catchError(() => of({ success: true, data: [] } as ApiResponse<LliSearchResult[]>)));
        }),
      )
      .subscribe((res) => {
        if (!res) return; // cleared / too short
        this.lliSearching.set(false);
        this.searchDone.set(true);
        if (res.success && res.data) {
          this.lliResults.set(res.data);
          this.lliDropdownOpen.set(true);
        } else {
          this.lliResults.set([]);
          this.lliDropdownOpen.set(true);
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchInput(term: string): void {
    this.lliSearchTerm.set(term);
    // Immediately hide the dropdown and mark search as pending so the
    // "Create manually" button won't flash while debouncing / waiting
    // for local + Seasearcher results to come back.
    this.searchDone.set(false);
    this.lliDropdownOpen.set(false);
    this.searchSubject.next(term);
  }

  onSearchFocus(): void {
    if (this.searchDone() && this.lliSearchTerm().length >= 2) {
      this.lliDropdownOpen.set(true);
    }
  }

  // ─── Load local places ──────────────────────────────────────────

  async loadPlaces(): Promise<void> {
    this.loading.set(true);
    try {
      const params = new URLSearchParams();
      if (this.localTypeFilter) params.set('placeType', this.localTypeFilter);
      if (this.filterResponsible()) params.set('responsibleUserId', this.filterResponsible());
      if (this.sortBy()) params.set('sortBy', this.sortBy());
      if (this.sortBy()) params.set('sortDir', this.sortDir());
      params.set('page', String(this.currentPage()));
      params.set('limit', String(this.pageSize));

      const qs = params.toString();
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ places: PlaceDto[]; total: number }>>(`${API}/lloyds/places/local?${qs}`),
      );
      if (res.success && res.data) {
        this.places.set(res.data.places);
        this.totalCount.set(res.data.total);
      }
    } catch (err) {
      console.error('Failed to load places:', err);
    } finally {
      this.loading.set(false);
    }
  }

  // ─── Typeahead click ──────────────────────────────────────────

  onTypeaheadClick(r: LliSearchResult): void {
    if (r.source === 'local' && r.localId) {
      this.lliDropdownOpen.set(false);
      this.lliSearchTerm.set('');
      this.lliResults.set([]);
      this.searchDone.set(false);
      this.router.navigate(['/places', r.localId]);
    }
  }

  // ─── Import from LLI ──────────────────────────────────────────

  async importPlace(lliPlaceId: string): Promise<void> {
    this.importingId.set(lliPlaceId);
    try {
      await firstValueFrom(
        this.http.post<ApiResponse<PlaceDto>>(`${API}/lloyds/places/import`, { lliPlaceId }),
      );
      this.importSuccess.set(true);
      this.lliDropdownOpen.set(false);
      this.lliSearchTerm.set('');
      this.lliResults.set([]);
      setTimeout(() => this.importSuccess.set(false), 3000);
      // Refresh local list
      await this.loadPlaces();
    } catch (err) {
      console.error('Import failed:', err);
    } finally {
      this.importingId.set(null);
    }
  }

  // ─── Pagination ────────────────────────────────────────────────

  goToPage(page: number): void {
    this.currentPage.set(page);
    this.updateUrlParams();
    this.loadPlaces();
  }

  updateUrlParams(): void {
    const queryParams: Record<string, string | null> = {
      page: this.currentPage() > 1 ? String(this.currentPage()) : null,
      type: this.localTypeFilter || null,
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
    this.loadPlaces();
  }

  private async loadUsers(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ id: string; name: string; email: string }[]>>(`${API}/lloyds/users`),
      );
      if (res.success && res.data) this.users.set(res.data);
    } catch { /* ignore */ }
  }

  // ─── Delete place ─────────────────────────────────────────────────

  confirmDelete(place: PlaceDto): void {
    this.deleteError.set(null);
    this.deleteTarget.set(place);
  }

  async executeDelete(): Promise<void> {
    const target = this.deleteTarget();
    if (!target) return;

    this.deleting.set(true);
    this.deleteError.set(null);
    try {
      await firstValueFrom(
        this.http.delete<ApiResponse<{ id: string }>>(`${API}/lloyds/places/local/${target.id}`),
      );
      this.deleteTarget.set(null);
      await this.loadPlaces();
    } catch (err: any) {
      const message = err?.error?.message || 'Failed to delete place';
      this.deleteError.set(message);
      console.error('Delete failed:', err);
    } finally {
      this.deleting.set(false);
    }
  }

  // ─── Create place (manual) ──────────────────────────────────────

  openCreateModal(): void {
    this.createForm = {
      name: this.lliSearchTerm(),
      country: '',
      countryIso: '',
    };
    this.createError.set(null);
    this.lliDropdownOpen.set(false);
    this.showCreateModal.set(true);
  }

  onCountryChange(code: string): void {
    const c = COUNTRIES.find((x) => x.code === code);
    this.createForm.countryIso = code;
    this.createForm.country = c?.name ?? '';
  }

  async executeCreate(): Promise<void> {
    if (!this.createForm.name?.trim() || !this.createForm.country?.trim()) {
      this.createError.set('Name and country are required.');
      return;
    }
    this.creating.set(true);
    this.createError.set(null);
    try {
      const body: Record<string, unknown> = {
        name: this.createForm.name.trim(),
        country: this.createForm.country.trim(),
      };
      if (this.createForm.countryIso?.trim()) body['countryIso'] = this.createForm.countryIso.trim();
      if (this.createForm.placeType) body['placeType'] = this.createForm.placeType;
      if (this.createForm.unlocode?.trim()) body['unlocode'] = this.createForm.unlocode.trim();
      if (this.createForm.lat != null) body['lat'] = this.createForm.lat;
      if (this.createForm.long != null) body['long'] = this.createForm.long;
      if (this.createForm.area?.trim()) body['area'] = this.createForm.area.trim();

      await firstValueFrom(
        this.http.post<ApiResponse<PlaceDto>>(`${API}/lloyds/places/local`, body),
      );
      this.showCreateModal.set(false);
      this.lliSearchTerm.set('');
      this.lliResults.set([]);
      this.searchDone.set(false);
      await this.loadPlaces();
    } catch (err: any) {
      const message = err?.error?.message || 'Failed to create place';
      this.createError.set(message);
      console.error('Create failed:', err);
    } finally {
      this.creating.set(false);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────

  placeTypeLabel(type: string): string {
    return PLACE_TYPE_LABELS[type] ?? type;
  }

  placeTypeBadgeClass(type: string): string {
    switch (type) {
      case 'POR': return 'bg-blue-100 text-blue-800';
      case 'PSP': return 'bg-indigo-100 text-indigo-800';
      case 'ANC': return 'bg-amber-100 text-amber-800';
      case 'TER': return 'bg-emerald-100 text-emerald-800';
      case 'FIL': return 'bg-red-100 text-red-800';
      default:    return 'bg-gray-100 text-gray-800';
    }
  }

  /** Convert a 2-letter ISO country code to its flag emoji. */
  countryFlag(place: PlaceDto): string {
    return flagFromUnlocode(place.unlocode) || flagFromIso3(place.countryIso);
  }

  openPlace(id: string): void {
    this.router.navigate(['/places', id]);
  }
}
