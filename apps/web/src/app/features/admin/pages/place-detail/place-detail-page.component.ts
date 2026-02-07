import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
  OnDestroy,
  ElementRef,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { PlaceDto, ApiResponse } from '@fueld/types';
import * as L from 'leaflet';

// ═══════════════════════════════════════════════════════════════════════
//  Place Detail Page — GeoJSON map, hierarchy tree, parent link
// ═══════════════════════════════════════════════════════════════════════

const API = 'http://localhost:3000';

const PLACE_TYPE_LABELS: Record<string, string> = {
  POR: 'Port',
  PSP: 'Sub Port',
  ANC: 'Anchorage',
  TER: 'Terminal',
  FIL: 'Hydrocarbon Field',
};

interface HierarchyNode {
  id: string;
  name: string;
  type: string;
  category: string;
  children: HierarchyNode[];
}

interface PlaceEnrichment {
  geoJsonObject: unknown | null;
  hierarchy: HierarchyNode[];
  parentPlaceId: string | null;
  parentPlaceName: string | null;
  childrenData: { type: string; count: number }[];
}

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

const CATEGORY_ICONS: Record<string, string> = {
  TERMINAL: '🏭',
  ANCHORAGE: '⚓',
  BERTH: '🔗',
};

@Component({
  selector: 'app-place-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  styles: [`
    :host ::ng-deep .leaflet-container { font-family: inherit; }
  `],
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
            @if (place()!.area) { &middot; {{ place()!.area }} }
            @if (place()!.subRegion) { &middot; {{ place()!.subRegion }} }
          </p>
          <!-- Parent place link -->
          @if (parentPlaceName()) {
            <p class="mt-1 text-sm text-gray-500">
              Parent:
              @if (parentLocalId()) {
                <a [routerLink]="['/places', parentLocalId()]"
                   class="text-brand-600 hover:text-brand-800 font-medium hover:underline">
                  {{ parentPlaceName() }}
                </a>
              } @else {
                <span class="font-medium text-gray-700">{{ parentPlaceName() }}</span>
                <span class="text-xs text-gray-400 ml-1">(not imported)</span>
              }
            </p>
          }
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Left column: map + info -->
          <div class="lg:col-span-2 space-y-6">

            <!-- Map -->
            @if (place()!.lat && place()!.long) {
              <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                  <h2 class="text-sm font-semibold text-gray-700">Location</h2>
                  <span class="font-mono text-xs text-gray-400">{{ place()!.lat }}° N, {{ place()!.long }}° E</span>
                </div>
                <div class="h-[400px]" #mapContainer></div>
              </div>
            }

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
                    <dt class="text-gray-500">Seasearcher ID</dt>
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
                </dl>
              </div>
            </div>

            <!-- Hierarchy -->
            @if (enrichment()?.hierarchy?.length) {
              <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
                <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                  <h2 class="text-sm font-semibold text-gray-700">Terminals &amp; Berths</h2>
                  @if (enrichment()!.childrenData.length) {
                    <div class="flex gap-2">
                      @for (c of enrichment()!.childrenData; track c.type) {
                        <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                          {{ c.count }} {{ c.type }}{{ c.count > 1 ? 's' : '' }}
                        </span>
                      }
                    </div>
                  }
                </div>
                <div class="p-5">
                  <div class="space-y-1">
                    @for (node of enrichment()!.hierarchy; track node.id) {
                      <!-- Terminal / top-level child -->
                      <div>
                        <button
                          (click)="toggleNode(node.id)"
                          class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition-colors"
                        >
                          <span class="text-base">{{ categoryIcon(node.category) }}</span>
                          @if (node.children.length) {
                            <svg class="h-3.5 w-3.5 text-gray-400 transition-transform"
                                 [class.rotate-90]="expandedNodes().has(node.id)"
                                 xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                              <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />
                            </svg>
                          } @else {
                            <span class="w-3.5"></span>
                          }
                          <span>{{ node.name }}</span>
                          <span class="ml-auto text-xs text-gray-400">{{ node.type }}</span>
                          @if (node.children.length) {
                            <span class="text-[10px] text-gray-400">({{ node.children.length }})</span>
                          }
                        </button>
                        <!-- Berths (collapsible) -->
                        @if (node.children.length && expandedNodes().has(node.id)) {
                          <div class="ml-10 border-l border-gray-100 pl-3 space-y-0.5 mb-1">
                            @for (child of node.children; track child.id) {
                              <div class="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-600">
                                <span class="text-xs">{{ categoryIcon(child.category) }}</span>
                                <span>{{ child.name }}</span>
                                <span class="ml-auto text-[10px] text-gray-400">{{ child.type }}</span>
                              </div>
                            }
                          </div>
                        }
                      </div>
                    }
                  </div>
                </div>
              </div>
            }
          </div>

          <!-- Right column: identifiers -->
          <div class="space-y-6">
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

            <!-- Children summary -->
            @if (enrichment()?.childrenData?.length) {
              <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
                <div class="border-b border-gray-100 px-5 py-3">
                  <h2 class="text-sm font-semibold text-gray-700">Children Summary</h2>
                </div>
                <div class="divide-y divide-gray-50">
                  @for (c of enrichment()!.childrenData; track c.type) {
                    <div class="flex items-center justify-between px-5 py-2.5 text-sm">
                      <span class="text-gray-600">{{ c.type }}s</span>
                      <span class="font-semibold text-gray-900">{{ c.count }}</span>
                    </div>
                  }
                </div>
              </div>
            }
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
export class PlaceDetailPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);

  readonly mapContainer = viewChild<ElementRef<HTMLDivElement>>('mapContainer');

  readonly place = signal<PlaceDto | null>(null);
  readonly enrichment = signal<PlaceEnrichment | null>(null);
  readonly loading = signal(true);
  readonly parentLocalId = signal<string | null>(null);
  readonly parentPlaceName = signal<string | null>(null);
  readonly expandedNodes = signal<Set<string>>(new Set());

  private map: L.Map | null = null;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadPlace(id);
    } else {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  async loadPlace(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<PlaceDto>>(`${API}/lloyds/places/local/${id}`),
      );
      if (res.success && res.data) {
        this.place.set(res.data);

        // Use parentPlaceName from our local record as initial value
        if (res.data.parentPlaceName) {
          this.parentPlaceName.set(res.data.parentPlaceName);
        }

        // Load enrichment from Seasearcher if we have a Seasearcher ID
        if (res.data.lliPlaceId) {
          this.loadEnrichment(res.data.lliPlaceId);
        }
      }
    } catch (err) {
      console.error('Failed to load place:', err);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadEnrichment(seasearcherId: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<PlaceEnrichment>>(`${API}/lloyds/places/enrichment/${seasearcherId}`),
      );
      if (res.success && res.data) {
        this.enrichment.set(res.data);

        // Overwrite parentPlaceName from enrichment (more authoritative)
        if (res.data.parentPlaceName) {
          this.parentPlaceName.set(res.data.parentPlaceName);
        }

        // If there's a parent place, try to find its local ID for deep linking
        if (res.data.parentPlaceId) {
          this.resolveParentLocalId(res.data.parentPlaceId);
        }
      }
    } catch (err) {
      console.error('Failed to load enrichment:', err);
    } finally {
      // Init map regardless (with or without GeoJSON)
      setTimeout(() => this.initMap(), 0);
    }
  }

  private async resolveParentLocalId(seasearcherParentId: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<PlaceDto>>(`${API}/lloyds/places/by-lli/${seasearcherParentId}`),
      );
      if (res.success && res.data) {
        this.parentLocalId.set(res.data.id);
      }
    } catch {
      // Parent link just won't be clickable — that's fine
    }
  }

  private initMap(): void {
    const p = this.place();
    const el = this.mapContainer()?.nativeElement;
    if (!p?.lat || !p?.long || !el) return;
    if (this.map) return; // Already initialised

    // Fix Leaflet default icon paths (webpack/Angular issue)
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });

    this.map = L.map(el, {
      center: [p.lat, p.long],
      zoom: 13,
      scrollWheelZoom: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      maxZoom: 19,
    }).addTo(this.map);

    const enrichment = this.enrichment();
    if (enrichment?.geoJsonObject) {
      // Render GeoJSON polygon
      const geoLayer = L.geoJSON(enrichment.geoJsonObject as any, {
        style: {
          color: '#3b82f6',
          weight: 2,
          fillColor: '#3b82f6',
          fillOpacity: 0.15,
        },
      }).addTo(this.map);

      // Fit map to polygon bounds
      this.map.fitBounds(geoLayer.getBounds(), { padding: [30, 30] });
    } else {
      // Fallback: just place a marker
      L.marker([p.lat, p.long]).addTo(this.map);
    }
  }

  goBack(): void {
    this.router.navigate(['/places']);
  }

  toggleNode(nodeId: string): void {
    const current = new Set(this.expandedNodes());
    if (current.has(nodeId)) {
      current.delete(nodeId);
    } else {
      current.add(nodeId);
    }
    this.expandedNodes.set(current);
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

  categoryIcon(category: string): string {
    return CATEGORY_ICONS[category] ?? '📍';
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
