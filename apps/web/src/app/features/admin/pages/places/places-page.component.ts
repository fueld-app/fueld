import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, tap, filter, catchError } from 'rxjs/operators';
import type { PlaceDto, ApiResponse } from '@fueld/types';

// ═══════════════════════════════════════════════════════════════════════
//  Places Page — Browse local places + search & import from Lloyd's
// ═══════════════════════════════════════════════════════════════════════

const API = 'http://localhost:3000';

type PlaceType = 'POR' | 'PSP' | 'ANC' | 'TER' | 'FIL';

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
            (focus)="lliDropdownOpen.set(lliResults().length > 0)"
            placeholder="Search places to import (min. 2 characters)…"
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
          @if (lliDropdownOpen() && lliResults().length > 0) {
            <div class="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-80 overflow-y-auto">
              @for (r of lliResults(); track r.lliPlaceId ?? r.localId) {
                <div class="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
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
              }
            </div>
          }
        </div>
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

      <!-- Click-away backdrop for dropdown -->
      @if (lliDropdownOpen()) {
        <div class="fixed inset-0 z-10" (click)="lliDropdownOpen.set(false)"></div>
      }

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
              <tr (click)="openPlace(place.id)" class="cursor-pointer transition-colors hover:bg-gray-50/50">
                <td class="px-4 py-3 font-medium text-brand-700 hover:underline">{{ place.name }}</td>
                <td class="px-4 py-3 text-gray-600">
                  <span class="mr-1.5">{{ countryFlag(place) }}</span>{{ place.country }}
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
export class PlacesPageComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly searchSubject = new Subject<string>();
  private readonly destroy$ = new Subject<void>();

  // ─── Local places state ──────────────────────────────────────────
  readonly places = signal<PlaceDto[]>([]);
  readonly loading = signal(false);
  readonly totalCount = signal(0);
  readonly currentPage = signal(1);
  readonly pageSize = 25;
  localTypeFilter = '';

  // ─── LLI typeahead state ─────────────────────────────────────────
  readonly lliSearchTerm = signal('');
  readonly lliResults = signal<LliSearchResult[]>([]);
  readonly lliSearching = signal(false);
  readonly lliDropdownOpen = signal(false);

  // ─── Import state ───────────────────────────────────────────────
  readonly importingId = signal<string | null>(null);
  readonly importSuccess = signal(false);

  ngOnInit(): void {
    this.loadPlaces();

    // Set up debounced typeahead
    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        tap((term) => {
          if (term.length < 2) {
            this.lliResults.set([]);
            this.lliDropdownOpen.set(false);
            this.lliSearching.set(false);
          }
        }),
        filter((term) => term.length >= 2),
        tap(() => this.lliSearching.set(true)),
        switchMap((term) =>
          this.http
            .get<ApiResponse<LliSearchResult[]>>(
              `${API}/lloyds/places?name=${encodeURIComponent(term)}`,
            )
            .pipe(catchError(() => [{ success: true, data: [] } as ApiResponse<LliSearchResult[]>])),
        ),
      )
      .subscribe((res) => {
        this.lliSearching.set(false);
        if (res.success && res.data) {
          this.lliResults.set(res.data);
          this.lliDropdownOpen.set(res.data.length > 0);
        } else {
          this.lliResults.set([]);
          this.lliDropdownOpen.set(false);
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchInput(term: string): void {
    this.lliSearchTerm.set(term);
    this.searchSubject.next(term);
    if (term.length >= 2) {
      this.lliSearching.set(true);
    }
  }

  // ─── Load local places ──────────────────────────────────────────

  async loadPlaces(): Promise<void> {
    this.loading.set(true);
    try {
      const params = new URLSearchParams();
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

  /** Convert a 2-letter ISO country code to its flag emoji. */
  countryFlag(place: PlaceDto): string {
    // Try to get the 2-letter code from UNLOCODE (first 2 chars)
    let iso2 = place.unlocode?.replace(/\s/g, '').substring(0, 2).toUpperCase();

    // Fallback: map ISO-3 to ISO-2 for common maritime countries
    if (!iso2 && place.countryIso) {
      iso2 = ISO3_TO_ISO2[place.countryIso.toUpperCase()];
    }

    if (!iso2 || iso2.length !== 2) return '';

    // Regional indicator symbols: A = U+1F1E6, B = U+1F1E7, …
    const [a, b] = [...iso2].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65);
    return String.fromCodePoint(a, b);
  }

  openPlace(id: string): void {
    this.router.navigate(['/places', id]);
  }

  min(a: number, b: number): number {
    return Math.min(a, b);
  }
}

// Compact ISO 3166-1 alpha-3 → alpha-2 map (maritime-relevant countries)
const ISO3_TO_ISO2: Record<string, string> = {
  ABW:'AW',AFG:'AF',AGO:'AO',ALB:'AL',AND:'AD',ARE:'AE',ARG:'AR',ARM:'AM',
  AUS:'AU',AUT:'AT',AZE:'AZ',BFA:'BF',BGD:'BD',BGR:'BG',BHR:'BH',BHS:'BS',
  BIH:'BA',BLR:'BY',BLZ:'BZ',BMU:'BM',BOL:'BO',BRA:'BR',BRB:'BB',BRN:'BN',
  BTN:'BT',BWA:'BW',CAF:'CF',CAN:'CA',CHE:'CH',CHL:'CL',CHN:'CN',CIV:'CI',
  CMR:'CM',COD:'CD',COG:'CG',COL:'CO',COM:'KM',CPV:'CV',CRI:'CR',CUB:'CU',
  CUW:'CW',CYM:'KY',CYP:'CY',CZE:'CZ',DEU:'DE',DJI:'DJ',DMA:'DM',DNK:'DK',
  DOM:'DO',DZA:'DZ',ECU:'EC',EGY:'EG',ERI:'ER',ESP:'ES',EST:'EE',ETH:'ET',
  FIN:'FI',FJI:'FJ',FRA:'FR',GAB:'GA',GBR:'GB',GEO:'GE',GHA:'GH',GIB:'GI',
  GIN:'GN',GMB:'GM',GNB:'GW',GNQ:'GQ',GRC:'GR',GRD:'GD',GTM:'GT',GUY:'GY',
  HKG:'HK',HND:'HN',HRV:'HR',HTI:'HT',HUN:'HU',IDN:'ID',IND:'IN',IRL:'IE',
  IRN:'IR',IRQ:'IQ',ISL:'IS',ISR:'IL',ITA:'IT',JAM:'JA',JOR:'JO',JPN:'JP',
  KAZ:'KZ',KEN:'KE',KGZ:'KG',KHM:'KH',KIR:'KI',KNA:'KN',KOR:'KR',KWT:'KW',
  LAO:'LA',LBN:'LB',LBR:'LR',LBY:'LY',LCA:'LC',LIE:'LI',LKA:'LK',LSO:'LS',
  LTU:'LT',LUX:'LU',LVA:'LV',MAR:'MA',MCO:'MC',MDA:'MD',MDG:'MG',MDV:'MV',
  MEX:'MX',MHL:'MH',MKD:'MK',MLI:'ML',MLT:'MT',MMR:'MM',MNE:'ME',MNG:'MN',
  MOZ:'MZ',MRT:'MR',MUS:'MU',MWI:'MW',MYS:'MY',NAM:'NA',NER:'NE',NGA:'NG',
  NIC:'NI',NLD:'NL',NOR:'NO',NPL:'NP',NRU:'NR',NZL:'NZ',OMN:'OM',PAK:'PK',
  PAN:'PA',PER:'PE',PHL:'PH',PLW:'PW',PNG:'PG',POL:'PL',PRI:'PR',PRK:'KP',
  PRT:'PT',PRY:'PY',QAT:'QA',ROU:'RO',RUS:'RU',RWA:'RW',SAU:'SA',SDN:'SD',
  SEN:'SN',SGP:'SG',SLB:'SB',SLE:'SL',SLV:'SV',SMR:'SM',SOM:'SO',SRB:'RS',
  SSD:'SS',STP:'ST',SUR:'SR',SVK:'SK',SVN:'SI',SWE:'SE',SWZ:'SZ',SYC:'SC',
  SYR:'SY',TCA:'TC',TCD:'TD',TGO:'TG',THA:'TH',TJK:'TJ',TKM:'TM',TLS:'TL',
  TON:'TO',TTO:'TT',TUN:'TN',TUR:'TR',TUV:'TV',TWN:'TW',TZA:'TZ',UGA:'UG',
  UKR:'UA',URY:'UY',USA:'US',UZB:'UZ',VCT:'VC',VEN:'VE',VGB:'VG',VIR:'VI',
  VNM:'VN',VUT:'VU',WSM:'WS',YEM:'YE',ZAF:'ZA',ZMB:'ZM',ZWE:'ZW',
};
