import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { PlaceDto, ApiResponse } from '@fueld/types';

// ═══════════════════════════════════════════════════════════════════════
//  Places Page — Browse local places + search & import from Lloyd's
// ═══════════════════════════════════════════════════════════════════════

const API = 'http://localhost:3000';

type PlaceType = 'POR' | 'PSP' | 'ANC' | 'TER' | 'FIL';

interface LliSearchResult {
  lliPlaceId: number;
  name: string;
  country: string;
  area: string | null;
  unlocode: string | null;
  placeType: string | null;
  admiraltyChart: string | null;
  principalFacilities: string | null;
  portAuthorityName: string | null;
  parentPlaceName: string | null;
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
  imports: [FormsModule],
  template: `
    <div>
      <!-- Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Places</h1>
          <p class="mt-1 text-sm text-gray-500">
            Manage ports, terminals, anchorages and other places.
            Import from Lloyd's List Intelligence.
          </p>
        </div>
        <button
          (click)="showLliSearch.set(!showLliSearch())"
          class="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm
                 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2"
          [class]="showLliSearch()
            ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-400'
            : 'bg-brand-600 text-white hover:bg-brand-700 focus:ring-brand-500'"
        >
          @if (!showLliSearch()) {
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" />
            </svg>
            Search Lloyd's
          } @else {
            Close Search
          }
        </button>
      </div>

      <!-- LLI Search Panel -->
      @if (showLliSearch()) {
        <div class="mb-6 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
          <h2 class="text-sm font-semibold text-blue-900 mb-3">Search Lloyd's List Intelligence</h2>
          <div class="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              type="text"
              [(ngModel)]="lliSearchName"
              placeholder="Place name…"
              class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm
                     focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              (keydown.enter)="searchLli()"
            />
            <input
              type="text"
              [(ngModel)]="lliSearchCountry"
              placeholder="Country code…"
              class="w-full sm:w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm
                     focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              (keydown.enter)="searchLli()"
            />
            <select
              [(ngModel)]="lliSearchType"
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
            <button
              (click)="searchLli()"
              [disabled]="lliSearching()"
              class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white
                     hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {{ lliSearching() ? 'Searching…' : 'Search' }}
            </button>
          </div>

          <!-- LLI Results -->
          @if (lliResults().length > 0) {
            <div class="overflow-x-auto rounded-lg border border-blue-200 bg-white">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-blue-100 bg-blue-50/60">
                    <th class="px-3 py-2 text-left font-medium text-blue-800">Name</th>
                    <th class="px-3 py-2 text-left font-medium text-blue-800">Country</th>
                    <th class="px-3 py-2 text-left font-medium text-blue-800">Type</th>
                    <th class="px-3 py-2 text-left font-medium text-blue-800">UNLOCODE</th>
                    <th class="px-3 py-2 text-left font-medium text-blue-800">Parent</th>
                    <th class="px-3 py-2 w-24"></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-blue-50">
                  @for (r of lliResults(); track r.lliPlaceId) {
                    <tr class="hover:bg-blue-50/30 transition-colors">
                      <td class="px-3 py-2 font-medium text-gray-900">{{ r.name }}</td>
                      <td class="px-3 py-2 text-gray-600">{{ r.country }}</td>
                      <td class="px-3 py-2">
                        @if (r.placeType) {
                          <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                                [class]="placeTypeBadgeClass(r.placeType)">
                            {{ placeTypeLabel(r.placeType) }}
                          </span>
                        }
                      </td>
                      <td class="px-3 py-2 text-gray-500 font-mono text-xs">{{ r.unlocode ?? '—' }}</td>
                      <td class="px-3 py-2 text-gray-500 text-xs">{{ r.parentPlaceName ?? '—' }}</td>
                      <td class="px-3 py-2">
                        <button
                          (click)="importPlace(r.lliPlaceId)"
                          [disabled]="importingId() === r.lliPlaceId"
                          class="rounded-md bg-green-600 px-3 py-1 text-xs font-semibold text-white
                                 hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          {{ importingId() === r.lliPlaceId ? 'Importing…' : 'Import' }}
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else if (lliSearched() && !lliSearching()) {
            <p class="text-sm text-gray-500 italic">No results found.</p>
          }
        </div>
      }

      <!-- Local Places Search -->
      <div class="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="text"
          [(ngModel)]="localSearch"
          placeholder="Search local places…"
          class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm
                 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          (keydown.enter)="loadPlaces()"
        />
        <select
          [(ngModel)]="localTypeFilter"
          (ngModelChange)="loadPlaces()"
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
        <button
          (click)="loadPlaces()"
          class="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700
                 hover:bg-gray-200 transition-colors"
        >
          Refresh
        </button>
      </div>

      <!-- Desktop table -->
      <div class="hidden md:block overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 bg-gray-50/80">
              <th class="px-4 py-3 text-left font-medium text-gray-600">Name</th>
              <th class="px-4 py-3 text-left font-medium text-gray-600">Country</th>
              <th class="px-4 py-3 text-left font-medium text-gray-600">Type</th>
              <th class="px-4 py-3 text-left font-medium text-gray-600">UNLOCODE</th>
              <th class="px-4 py-3 text-left font-medium text-gray-600">Area</th>
              <th class="px-4 py-3 text-left font-medium text-gray-600">LLI ID</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            @for (place of places(); track place.id) {
              <tr class="transition-colors hover:bg-gray-50/50">
                <td class="px-4 py-3 font-medium text-gray-900">{{ place.name }}</td>
                <td class="px-4 py-3 text-gray-600">{{ place.country }}
                  @if (place.countryIso) {
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
                <td class="px-4 py-3 text-gray-400 text-xs">{{ place.lliPlaceId ?? '—' }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="px-4 py-8 text-center text-sm text-gray-400 italic">
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
          <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
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
              <span>📍 {{ place.country }}</span>
              <span>🏷️ {{ place.unlocode ?? '—' }}</span>
              <span>🌍 {{ place.area ?? '—' }}</span>
              <span>🔗 LLI {{ place.lliPlaceId ?? '—' }}</span>
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
      @if (totalCount() > pageSize) {
        <div class="mt-4 flex items-center justify-between text-sm text-gray-600">
          <span>Showing {{ (currentPage() - 1) * pageSize + 1 }}–{{ min(currentPage() * pageSize, totalCount()) }} of {{ totalCount() }}</span>
          <div class="flex gap-2">
            <button
              (click)="goToPage(currentPage() - 1)"
              [disabled]="currentPage() <= 1"
              class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50
                     disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              (click)="goToPage(currentPage() + 1)"
              [disabled]="currentPage() * pageSize >= totalCount()"
              class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50
                     disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      }

      <!-- Import success toast -->
      @if (importSuccess()) {
        <div class="fixed bottom-4 right-4 z-50 rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white shadow-lg
                    animate-in slide-in-from-bottom-2">
          ✓ Place imported successfully
        </div>
      }
    </div>
  `,
})
export class PlacesPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  // ─── Local places state ──────────────────────────────────────────
  readonly places = signal<PlaceDto[]>([]);
  readonly loading = signal(false);
  readonly totalCount = signal(0);
  readonly currentPage = signal(1);
  readonly pageSize = 25;
  localSearch = '';
  localTypeFilter = '';

  // ─── LLI search state ───────────────────────────────────────────
  readonly showLliSearch = signal(false);
  readonly lliResults = signal<LliSearchResult[]>([]);
  readonly lliSearching = signal(false);
  readonly lliSearched = signal(false);
  lliSearchName = '';
  lliSearchCountry = '';
  lliSearchType = '';

  // ─── Import state ───────────────────────────────────────────────
  readonly importingId = signal<number | null>(null);
  readonly importSuccess = signal(false);

  ngOnInit(): void {
    this.loadPlaces();
  }

  // ─── Load local places ──────────────────────────────────────────

  async loadPlaces(): Promise<void> {
    this.loading.set(true);
    try {
      const params = new URLSearchParams();
      if (this.localSearch) params.set('search', this.localSearch);
      if (this.localTypeFilter) params.set('placeType', this.localTypeFilter);
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

  // ─── Search LLI ────────────────────────────────────────────────

  async searchLli(): Promise<void> {
    if (!this.lliSearchName && !this.lliSearchCountry) return;

    this.lliSearching.set(true);
    this.lliSearched.set(false);
    try {
      const params = new URLSearchParams();
      if (this.lliSearchName) params.set('name', this.lliSearchName);
      if (this.lliSearchCountry) params.set('country', this.lliSearchCountry);
      if (this.lliSearchType) params.set('placeType', this.lliSearchType);

      const qs = params.toString();
      const res = await firstValueFrom(
        this.http.get<ApiResponse<LliSearchResult[]>>(`${API}/lloyds/places?${qs}`),
      );
      if (res.success && res.data) {
        this.lliResults.set(res.data);
      }
    } catch (err) {
      console.error('LLI search failed:', err);
    } finally {
      this.lliSearching.set(false);
      this.lliSearched.set(true);
    }
  }

  // ─── Import from LLI ──────────────────────────────────────────

  async importPlace(lliPlaceId: number): Promise<void> {
    this.importingId.set(lliPlaceId);
    try {
      await firstValueFrom(
        this.http.post<ApiResponse<PlaceDto>>(`${API}/lloyds/places/import`, { lliPlaceId }),
      );
      this.importSuccess.set(true);
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
    this.loadPlaces();
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

  min(a: number, b: number): number {
    return Math.min(a, b);
  }
}
