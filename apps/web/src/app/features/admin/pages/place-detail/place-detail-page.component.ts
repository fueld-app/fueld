import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { PlaceDto, ApiResponse } from '@fueld/types';

// ═══════════════════════════════════════════════════════════════════════
//  Place Detail Page — Full view of a single place
// ═══════════════════════════════════════════════════════════════════════

const API = 'http://localhost:3000';

const PLACE_TYPE_LABELS: Record<string, string> = {
  POR: 'Port',
  PSP: 'Sub Port',
  ANC: 'Anchorage',
  TER: 'Terminal',
  FIL: 'Hydrocarbon Field',
};

// Compact ISO 3166-1 alpha-3 → alpha-2 map (maritime-relevant)
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

@Component({
  selector: 'app-place-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      <!-- Back link -->
      <button
        (click)="goBack()"
        class="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd" />
        </svg>
        Back to Places
      </button>

      @if (loading()) {
        <div class="flex items-center justify-center py-20">
          <svg class="h-6 w-6 animate-spin text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else if (place()) {
        <!-- Header -->
        <div class="mb-6">
          <div class="flex items-center gap-3 mb-1">
            <span class="text-3xl">{{ countryFlag() }}</span>
            <h1 class="text-2xl font-bold text-gray-900">{{ place()!.name }}</h1>
            @if (place()!.placeType) {
              <span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
                    [class]="placeTypeBadgeClass(place()!.placeType!)">
                {{ placeTypeLabel(place()!.placeType!) }}
              </span>
            }
          </div>
          <p class="text-sm text-gray-500">
            {{ place()!.country }}
            @if (place()!.countryIso) { ({{ place()!.countryIso }}) }
            @if (place()!.area) { · {{ place()!.area }} }
            @if (place()!.subRegion) { · {{ place()!.subRegion }} }
          </p>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Left column: info cards -->
          <div class="lg:col-span-2 space-y-6">

            <!-- General info -->
            <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div class="border-b border-gray-100 px-5 py-3">
                <h2 class="text-sm font-semibold text-gray-700">General Information</h2>
              </div>
              <div class="p-5">
                <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
                  <div>
                    <dt class="text-gray-500">UNLOCODE</dt>
                    <dd class="mt-0.5 font-medium text-gray-900 font-mono">{{ place()!.unlocode ?? '—' }}</dd>
                  </div>
                  <div>
                    <dt class="text-gray-500">LLI Place ID</dt>
                    <dd class="mt-0.5 font-medium text-gray-900">{{ place()!.lliPlaceId ?? '—' }}</dd>
                  </div>
                  <div>
                    <dt class="text-gray-500">Area</dt>
                    <dd class="mt-0.5 font-medium text-gray-900">{{ place()!.area ?? '—' }}</dd>
                  </div>
                  <div>
                    <dt class="text-gray-500">Sub Region</dt>
                    <dd class="mt-0.5 font-medium text-gray-900">{{ place()!.subRegion ?? '—' }}</dd>
                  </div>
                  <div>
                    <dt class="text-gray-500">Timezone</dt>
                    <dd class="mt-0.5 font-medium text-gray-900">{{ place()!.timezone ?? '—' }}</dd>
                  </div>
                  <div>
                    <dt class="text-gray-500">Admiralty Chart</dt>
                    <dd class="mt-0.5 font-medium text-gray-900">{{ place()!.admiraltyChart ?? '—' }}</dd>
                  </div>
                  @if (place()!.portAuthorityName) {
                    <div class="sm:col-span-2">
                      <dt class="text-gray-500">Port Authority</dt>
                      <dd class="mt-0.5 font-medium text-gray-900">{{ place()!.portAuthorityName }}</dd>
                    </div>
                  }
                  @if (place()!.parentPlaceName) {
                    <div class="sm:col-span-2">
                      <dt class="text-gray-500">Parent Place</dt>
                      <dd class="mt-0.5 font-medium text-gray-900">{{ place()!.parentPlaceName }}</dd>
                    </div>
                  }
                </dl>
              </div>
            </div>

            <!-- Principal Facilities -->
            @if (place()!.principalFacilities && place()!.principalFacilities!.length > 0) {
              <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
                <div class="border-b border-gray-100 px-5 py-3">
                  <h2 class="text-sm font-semibold text-gray-700">Principal Facilities</h2>
                </div>
                <div class="p-5">
                  <div class="flex flex-wrap gap-2">
                    @for (f of place()!.principalFacilities!; track f) {
                      <span class="inline-flex items-center rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                        {{ f }}
                      </span>
                    }
                  </div>
                </div>
              </div>
            }
          </div>

          <!-- Right column: map + coordinates -->
          <div class="space-y-6">
            <!-- Map -->
            @if (place()!.lat && place()!.long) {
              <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div class="border-b border-gray-100 px-5 py-3">
                  <h2 class="text-sm font-semibold text-gray-700">Location</h2>
                </div>
                <div class="aspect-[4/3] bg-gray-100">
                  <iframe
                    [src]="mapUrl()"
                    class="h-full w-full border-0"
                    loading="lazy"
                    referrerpolicy="no-referrer-when-downgrade"
                    allowfullscreen
                  ></iframe>
                </div>
                <div class="px-5 py-3 text-xs text-gray-500">
                  <span class="font-mono">{{ place()!.lat }}° N, {{ place()!.long }}° E</span>
                </div>
              </div>
            }

            <!-- Quick stats card -->
            <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div class="border-b border-gray-100 px-5 py-3">
                <h2 class="text-sm font-semibold text-gray-700">Identifiers</h2>
              </div>
              <div class="divide-y divide-gray-50">
                <div class="flex items-center justify-between px-5 py-2.5 text-sm">
                  <span class="text-gray-500">Internal ID</span>
                  <span class="font-mono text-xs text-gray-400">{{ place()!.id }}</span>
                </div>
                @if (place()!.lliPlaceId) {
                  <div class="flex items-center justify-between px-5 py-2.5 text-sm">
                    <span class="text-gray-500">Seasearcher ID</span>
                    <span class="font-medium text-gray-900">{{ place()!.lliPlaceId }}</span>
                  </div>
                }
                @if (place()!.unlocode) {
                  <div class="flex items-center justify-between px-5 py-2.5 text-sm">
                    <span class="text-gray-500">UNLOCODE</span>
                    <span class="font-mono font-medium text-gray-900">{{ place()!.unlocode }}</span>
                  </div>
                }
              </div>
            </div>
          </div>
        </div>
      } @else {
        <div class="text-center py-20">
          <h2 class="text-lg font-semibold text-gray-900">Place not found</h2>
          <p class="mt-1 text-sm text-gray-500">The place you're looking for doesn't exist or has been removed.</p>
        </div>
      }
    </div>
  `,
})
export class PlaceDetailPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);

  readonly place = signal<PlaceDto | null>(null);
  readonly loading = signal(true);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadPlace(id);
    } else {
      this.loading.set(false);
    }
  }

  async loadPlace(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<PlaceDto>>(`${API}/lloyds/places/local/${id}`),
      );
      if (res.success && res.data) {
        this.place.set(res.data);
      }
    } catch (err) {
      console.error('Failed to load place:', err);
    } finally {
      this.loading.set(false);
    }
  }

  goBack(): void {
    this.router.navigate(['/admin/places']);
  }

  countryFlag(): string {
    const p = this.place();
    if (!p) return '';
    let iso2 = p.unlocode?.replace(/\s/g, '').substring(0, 2).toUpperCase();
    if (!iso2 && p.countryIso) {
      iso2 = ISO3_TO_ISO2[p.countryIso.toUpperCase()];
    }
    if (!iso2 || iso2.length !== 2) return '';
    const [a, b] = [...iso2].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65);
    return String.fromCodePoint(a, b);
  }

  mapUrl(): string {
    const p = this.place();
    if (!p?.lat || !p?.long) return '';
    return `https://www.openstreetmap.org/export/embed.html?bbox=${p.long - 0.05},${p.lat - 0.03},${p.long + 0.05},${p.lat + 0.03}&layer=mapnik&marker=${p.lat},${p.long}`;
  }

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
}
