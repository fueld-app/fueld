import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  OnInit,
  OnDestroy,
  ElementRef,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, Subscription, skip } from 'rxjs';
import { Title } from '@angular/platform-browser';
import type { PlaceDto, VesselDto, CounterpartyDto, ApiResponse, PortSupplierDto, ExpectedArrivalDto, CompanyContactDto } from '@fueld/types';
import * as L from 'leaflet/dist/leaflet-src.esm.js';
import { WebSocketService } from '../../../../core/websocket/websocket.service';
import { ActivityTimelineComponent } from '../../../../shared/components/activity-timeline/activity-timeline.component';
import { LastEditedBadgeComponent } from '../../../../shared/components/last-edited-badge/last-edited-badge.component';
import { CommentsCardComponent } from '../../../../shared/components/comments-card/comments-card.component';

// ═══════════════════════════════════════════════════════════════════════
//  Place Detail Page — GeoJSON map, hierarchy tree, parent link,
//  nearby vessels via WebSocket
// ═══════════════════════════════════════════════════════════════════════

import { API } from '@app/core/config/api';

const PRODUCT_OPTIONS = ['VLSFO', 'LSMGO', 'IFO380', 'MGO', 'LUBE'] as const;

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

interface ChildPlace {
  id: string;
  name: string;
  type: string;
  typeCode: string;
  category: string;
  lat: number | null;
  lng: number | null;
  geoJsonObject: unknown | null;
  childrenData: { type: string; count: number }[];
}

interface PlaceEnrichment {
  geoJsonObject: unknown | null;
  hierarchy: HierarchyNode[];
  parentPlaceId: string | null;
  parentPlaceName: string | null;
  childrenData: { type: string; count: number }[];
  children: ChildPlace[];
}

interface NearbyVessel {
  id: string;
  name: string;
  imo: string | null;
  mmsi: string | null;
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  lengthOverall: number | null;
  breadth: number | null;
  draught: number | null;
  dwt: number | null;
  grossTonnage: number | null;
  buildYear: number | null;
  vesselType: string | null;
  flag: string | null;
  flagCode: string | null;
  distance: number | null;
  status: string | null;
}

interface PlaceOrder {
  id: string;
  status: string;
  eta: string | null;
  etd: string | null;
  createdAt: string;
  updatedAt: string;
  clientName: string;
  vesselName: string;
  vesselImo: string | null;
  salesRepId: string | null;
}

interface PortFacility {
  id: string;
  type: number;
  label: string;
  text: string;
  editDate: string;
}

interface FacilityCompany {
  id: string;
  name: string;
  sector: string;
  address: string;
  town: string;
  country: string;
  telephone: string | null;
  fax: string | null;
  email: string | null;
  website: string | null;
}

interface FacilityCompanyGroup {
  type: number;
  label: string;
  companies: FacilityCompany[];
}

interface UserOption {
  id: string;
  name: string;
  email: string;
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

/**
 * Meters per pixel at a given latitude and zoom level.
 * Standard Web Mercator formula.
 */
function metersPerPx(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

/**
 * Ship-shaped SVG marker scaled to real-world vessel size.
 * LOA (meters) is converted to pixels using the map's current zoom & lat.
 * A minimum pixel size keeps small/zoomed-out vessels visible.
 */
function vesselIcon(heading: number | null, loa: number | null, zoom: number, lat: number): L.DivIcon {
  const deg = heading ?? 0;
  const loaMeters = loa ?? 100;
  const mpp = metersPerPx(lat, zoom);

  // Convert LOA to pixels, with min 10px and max 120px
  const h = Math.round(Math.max(10, Math.min(loaMeters / mpp, 120)));
  const w = Math.round(h * 0.35);

  // Colours by real size: small=blue, medium=orange, large=red
  const fill = loaMeters < 120 ? '#3b82f6' : loaMeters < 250 ? '#f97316' : '#ef4444';
  const stroke = loaMeters < 120 ? '#1d4ed8' : loaMeters < 250 ? '#c2410c' : '#991b1b';

  // Top-down vessel SVG: pointed bow at top, flat stern at bottom
  const svg = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <path d="M${w / 2},0 L${w},${h * 0.3} L${w},${h} L0,${h} L0,${h * 0.3} Z"
          fill="${fill}" stroke="${stroke}" stroke-width="0.8" stroke-linejoin="round"/>
    <line x1="${w / 2}" y1="${h * 0.15}" x2="${w / 2}" y2="${h * 0.65}"
          stroke="${stroke}" stroke-width="0.6" opacity="0.5"/>
  </svg>`;

  return L.divIcon({
    className: '',
    html: `<div style="transform:rotate(${deg}deg);width:${w}px;height:${h}px;filter:drop-shadow(0 1px 3px rgba(0,0,0,.35))">${svg}</div>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h / 2],
  });
}

@Component({
  selector: 'app-place-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DecimalPipe, DatePipe, FormsModule, ActivityTimelineComponent, LastEditedBadgeComponent, CommentsCardComponent],
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
            @if (syncing()) {
              <span class="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600">
                <svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Syncing…
              </span>
            }
            <div class="ml-auto flex items-center gap-2">
              @if (place()!.lliPlaceId) {
                <a
                  [href]="'https://www.seasearcher.com/place/' + place()!.lliPlaceId"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                    <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                  </svg>
                  Seasearcher
                </a>
              }
              <button
                (click)="confirmDeletePlace()"
                class="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <p class="hidden md:block text-sm text-gray-500">
              {{ place()!.country }}
              @if (place()!.countryIso && place()!.countryIso !== place()!.country) { ({{ place()!.countryIso }}) }
              @if (place()!.area) { &middot; {{ place()!.area }} }
              @if (place()!.subRegion) { &middot; {{ place()!.subRegion }} }
            </p>
            @if (localTime()) {
              <span class="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-mono font-medium text-gray-700" title="Local time at port">
                🕐 {{ localTime() }}
              </span>
            }
            @if (place()!.lliLastUpdated) {
              <span class="inline-flex items-center gap-1 text-xs text-gray-400" title="Last synced with Seasearcher">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
                </svg>
                Synced {{ place()!.lliLastUpdated | date:'short' }}
              </span>
            }
            <span class="text-gray-300">|</span>
            <span class="text-xs text-gray-500">Responsible:</span>
            <select
              [ngModel]="responsibleUserId() ?? ''"
              (ngModelChange)="onResponsibleUserChange($event)"
              [disabled]="savingResponsible()"
              class="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
            >
              <option value="">— None —</option>
              @for (u of teamUsers(); track u.id) {
                <option [value]="u.id">{{ u.name }}</option>
              }
            </select>
            @if (savingResponsible()) {
              <svg class="h-3.5 w-3.5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            }
            <div class="hidden lg:block ml-auto">
              <app-last-edited-badge entityType="place" [entityId]="place()!.id" />
            </div>
          </div>
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
                <button (click)="navigateToParent()"
                        [disabled]="navigatingParentId()"
                        class="text-brand-600 hover:text-brand-800 font-medium hover:underline disabled:opacity-50 inline-flex items-center gap-1">
                  @if (navigatingParentId()) {
                    <svg class="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  }
                  {{ parentPlaceName() }}
                </button>
              }
            </p>
          }
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Left column: map + info -->
          <div class="lg:col-span-2 space-y-6">

            <!-- Map -->
            @if (place()!.lat && place()!.long) {
              <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
                   [class]="mapFullscreen() ? 'fixed inset-0 z-50 rounded-none border-0' : ''">
                <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                  <h2 class="text-sm font-semibold text-gray-700">
                    Location
                    @if (vesselsLoading()) {
                      <span class="ml-2 inline-flex items-center gap-1 text-xs font-normal text-gray-400">
                        <svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                        Loading vessels…
                      </span>
                    } @else if (nearbyVessels().length) {
                      <span class="ml-2 text-xs font-normal text-gray-400">
                        {{ nearbyVessels().length }} vessels nearby
                      </span>
                    }
                  </h2>
                  <div class="flex items-center gap-3">
                    <span class="font-mono text-xs text-gray-400">{{ place()!.lat }}° N, {{ place()!.long }}° E</span>
                    <button (click)="toggleMapFullscreen()"
                      class="rounded-md p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                      [title]="mapFullscreen() ? 'Exit fullscreen' : 'Fullscreen'">
                      @if (mapFullscreen()) {
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 01-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12zm-9 7a1 1 0 012 0v1.586l2.293-2.293a1 1 0 111.414 1.414L5.414 15H7a1 1 0 010 2H3a1 1 0 01-1-1v-4zm13.707.293a1 1 0 010 1.414L14.414 15H16a1 1 0 010 2h-4a1 1 0 01-1-1v-4a1 1 0 012 0v1.586l2.293-2.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                        </svg>
                      } @else {
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H5v3a1 1 0 01-2 0V4zm12-1a1 1 0 011 1v3a1 1 0 01-2 0V5h-3a1 1 0 010-2h4zM3 16a1 1 0 001 1h4a1 1 0 000-2H5v-3a1 1 0 00-2 0v4zm14 0a1 1 0 01-1 1h-4a1 1 0 010-2h3v-3a1 1 0 012 0v4z" clip-rule="evenodd" />
                        </svg>
                      }
                    </button>
                  </div>
                </div>
                <div [class]="mapFullscreen() ? 'h-[calc(100vh-49px)]' : 'h-[400px]'" #mapContainer></div>
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
                </dl>
              </div>
            </div>

            <!-- Terminals -->
            @if (terminals().length) {
              <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
                <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                  <h2 class="text-sm font-semibold text-gray-700">
                    🏭 Terminals
                  </h2>
                  <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                    {{ terminals().length }}
                  </span>
                </div>
                <div class="p-5">
                  <div class="space-y-1">
                    @for (node of terminals(); track node.id) {
                      <div>
                        <button
                          (click)="toggleNode(node.id)"
                          class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition-colors"
                        >
                          <span class="text-base">🏭</span>
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

            <!-- Anchorages -->
            @if (anchorages().length) {
              <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
                <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                  <h2 class="text-sm font-semibold text-gray-700">
                    ⚓ Anchorages
                  </h2>
                  <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                    {{ anchorages().length }}
                  </span>
                </div>
                <div class="divide-y divide-gray-50">
                  @for (node of anchorages(); track node.id) {
                    <div class="px-5 py-3 text-sm hover:bg-gray-50/50 transition-colors">
                      <div class="flex items-center gap-2">
                        <span class="text-base">⚓</span>
                        <button
                          (click)="navigateToChildPlace(node.id)"
                          [disabled]="navigatingChildId() === node.id"
                          class="font-medium text-brand-600 hover:text-brand-800 hover:underline text-left disabled:opacity-50"
                        >
                          @if (navigatingChildId() === node.id) {
                            <svg class="inline h-3.5 w-3.5 animate-spin mr-1" viewBox="0 0 24 24" fill="none">
                              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                            </svg>
                          }
                          {{ node.name }}
                        </button>
                        <span class="ml-auto text-xs text-gray-400">{{ node.type }}</span>
                      </div>
                    </div>
                  }
                </div>
              </div>
            }

            <!-- Facilities (from Seasearcher) -->
            @if (place()!.lliPlaceId) {
              <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
                <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                  <h2 class="text-sm font-semibold text-gray-700">
                    Port Facilities
                    @if (facilitiesLoading()) {
                      <span class="ml-2 inline-flex items-center gap-1 text-xs font-normal text-gray-400">
                        <svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                        Loading…
                      </span>
                    }
                  </h2>
                  <!-- Tab switches -->
                  <div class="flex gap-1">
                    <button (click)="facilitiesTab.set('info')"
                      class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                      [class]="facilitiesTab() === 'info' ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-gray-600'">
                      Info
                    </button>
                    <button (click)="facilitiesTab.set('companies')"
                      class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                      [class]="facilitiesTab() === 'companies' ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-gray-600'">
                      Companies
                    </button>
                  </div>
                </div>

                @if (facilitiesTab() === 'info') {
                  @if (!facilities().length && !facilitiesLoading()) {
                    <div class="px-5 py-6 text-center text-sm text-gray-400">No facility data available</div>
                  } @else {
                    <div class="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
                      @for (f of facilities(); track f.id) {
                        <div class="px-5 py-3">
                          <div class="flex items-center gap-2 mb-1">
                            <span class="text-xs">{{ facilityIcon(f.type) }}</span>
                            <h4 class="text-xs font-semibold text-gray-700">{{ f.label }}</h4>
                          </div>
                          <p class="text-xs text-gray-600 leading-relaxed whitespace-pre-line">{{ f.text }}</p>
                        </div>
                      }
                    </div>
                  }
                } @else {
                  @if (!facilityCompanies().length && !facilitiesLoading()) {
                    <div class="px-5 py-6 text-center text-sm text-gray-400">No company data available</div>
                  } @else {
                    <div class="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
                      @for (group of facilityCompanies(); track group.type) {
                        <div class="px-5 py-3">
                          <h4 class="text-xs font-semibold text-gray-700 mb-2">{{ group.label }}</h4>
                          <div class="space-y-2">
                            @for (co of group.companies; track co.name) {
                              <div class="rounded-lg bg-gray-50 px-3 py-2">
                                <button
                                  (click)="navigateToCompany(co.name)"
                                  [disabled]="navigatingCompanyId() === co.name"
                                  class="text-xs font-medium text-brand-600 hover:text-brand-800 hover:underline text-left disabled:opacity-50"
                                >
                                  @if (navigatingCompanyId() === co.name) {
                                    <svg class="inline h-3 w-3 animate-spin mr-1" viewBox="0 0 24 24" fill="none">
                                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                    </svg>
                                  }
                                  {{ co.name }}
                                </button>
                                @if (co.address || co.town) {
                                  <p class="text-[10px] text-gray-500 mt-0.5">
                                    {{ co.address }}@if (co.town) {, {{ co.town }}}@if (co.country) {, {{ co.country }}}
                                  </p>
                                }
                                <div class="flex items-center gap-3 mt-1 text-[10px]">
                                  @if (co.telephone) {
                                    <span class="text-gray-500">📞 {{ co.telephone }}</span>
                                  }
                                  @if (co.email) {
                                    <a [href]="'mailto:' + co.email" class="text-brand-600 hover:underline">{{ co.email }}</a>
                                  }
                                  @if (co.website) {
                                    <a [href]="co.website.startsWith('http') ? co.website : 'https://' + co.website"
                                       target="_blank" rel="noopener" class="text-brand-600 hover:underline">🌐 Website</a>
                                  }
                                </div>
                              </div>
                            }
                          </div>
                        </div>
                      }
                    </div>
                  }
                }
              </div>
            }
          </div>

          <!-- Right column -->
          <div class="space-y-6">
            <!-- Children summary -->
            @if (enrichment()?.childrenData?.length) {
              <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
                <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                  <h2 class="text-sm font-semibold text-gray-700">Children Summary</h2>
                  <div class="flex gap-1.5">
                    @for (c of enrichment()!.childrenData; track c.type) {
                      <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                        {{ c.count }} {{ c.type }}{{ c.count !== 1 ? 's' : '' }}
                      </span>
                    }
                  </div>
                </div>

                @if (enrichment()!.children.length) {
                  <div class="divide-y divide-gray-50 max-h-[400px] overflow-y-auto">
                    @for (child of enrichment()!.children; track child.id) {
                      <div class="px-5 py-3 text-sm hover:bg-gray-50/50 transition-colors">
                        <div class="flex items-center gap-2">
                          <span class="text-base">{{ childTypeIcon(child.typeCode) }}</span>
                          <button
                            (click)="navigateToChildPlace(child.id)"
                            [disabled]="navigatingChildId() === child.id"
                            class="font-medium text-brand-600 hover:text-brand-800 hover:underline text-left disabled:opacity-50"
                          >
                            @if (navigatingChildId() === child.id) {
                              <svg class="inline h-3.5 w-3.5 animate-spin mr-1" viewBox="0 0 24 24" fill="none">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                              </svg>
                            }
                            {{ child.name }}
                          </button>
                          <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                                [class]="placeTypeBadgeClass(child.typeCode)">
                            {{ child.type }}
                          </span>
                          @if (child.childrenData.length) {
                            <div class="ml-auto flex gap-1">
                              @for (cd of child.childrenData; track cd.type) {
                                <span class="text-[10px] text-gray-400">
                                  {{ cd.count }} {{ cd.type }}{{ cd.count !== 1 ? 's' : '' }}
                                </span>
                              }
                            </div>
                          }
                        </div>
                      </div>
                    }
                  </div>
                } @else {
                  <div class="divide-y divide-gray-50">
                    @for (c of enrichment()!.childrenData; track c.type) {
                      <div class="flex items-center justify-between px-5 py-2.5 text-sm">
                        <span class="text-gray-600">{{ c.type }}s</span>
                        <span class="font-semibold text-gray-900">{{ c.count }}</span>
                      </div>
                    }
                  </div>
                }
              </div>
            }

            <!-- Orders at this place -->
            <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                <h2 class="text-sm font-semibold text-gray-700">Orders</h2>
                @if (placeOrders().length) {
                  <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                    {{ placeOrders().length }}
                  </span>
                }
              </div>
              @if (ordersLoading()) {
                <div class="flex items-center justify-center py-6">
                  <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                </div>
              } @else if (!placeOrders().length) {
                <div class="px-5 py-6 text-center text-sm text-gray-400">No orders at this place</div>
              } @else {
                <div class="divide-y divide-gray-50 max-h-[320px] overflow-y-auto">
                  @for (o of placeOrders(); track o.id) {
                    <div class="px-5 py-3 text-sm hover:bg-gray-50/50 transition-colors">
                      <div class="flex items-center justify-between">
                        <span class="font-medium text-gray-900 truncate">{{ o.vesselName }}</span>
                        <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              [class]="orderStatusClass(o.status)">
                          {{ o.status }}
                        </span>
                      </div>
                      <div class="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                        <span>{{ o.clientName }}</span>
                        @if (o.vesselImo) {
                          <span class="text-gray-300">&middot;</span>
                          <span class="font-mono text-gray-400">IMO {{ o.vesselImo }}</span>
                        }
                      </div>
                      @if (o.eta || o.etd) {
                        <div class="flex items-center gap-3 mt-1 text-[10px] text-gray-400">
                          @if (o.eta) { <span>ETA {{ o.eta | date:'mediumDate' }}</span> }
                          @if (o.etd) { <span>ETD {{ o.etd | date:'mediumDate' }}</span> }
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            </div>

            <!-- Nearby vessels list -->
            @if (nearbyVessels().length) {
              <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
                <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                  <h2 class="text-sm font-semibold text-gray-700">
                    Nearby Vessels
                    <span class="ml-1 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                      {{ nearbyVessels().length }}
                    </span>
                  </h2>
                </div>
                <div class="divide-y divide-gray-50 max-h-[400px] overflow-y-auto">
                  @for (v of nearbyVessels(); track v.id) {
                    <div class="px-5 py-3 text-sm hover:bg-gray-50/50 transition-colors">
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-1.5 min-w-0">
                          @if (v.flagCode) {
                            <span class="text-sm">{{ vesselFlag(v.flagCode) }}</span>
                          }
                          <button
                            (click)="navigateToVessel(v.id)"
                            [disabled]="navigatingVesselId() === v.id"
                            class="font-medium text-brand-600 hover:text-brand-800 hover:underline truncate text-left disabled:opacity-50"
                          >
                            @if (navigatingVesselId() === v.id) {
                              <svg class="inline h-3.5 w-3.5 animate-spin mr-1" viewBox="0 0 24 24" fill="none">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                              </svg>
                            }
                            {{ v.name }}
                          </button>
                          @if (v.status) {
                            <span class="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                                  [class]="v.status === 'stopped' || v.status === 'moored' ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'">
                              {{ v.status }}
                            </span>
                          }
                        </div>
                        <span class="text-[10px] text-gray-500 whitespace-nowrap ml-2">
                          @if (v.distance != null) { {{ v.distance | number:'1.1-1' }} nm }
                          @if (v.speed != null) { · {{ v.speed | number:'1.1-1' }} kn }
                          @if (v.heading != null) { · {{ v.heading }}° }
                        </span>
                      </div>
                      <div class="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                        @if (v.imo) { <span>IMO {{ v.imo }}</span> }
                        @if (v.vesselType) { <span>&middot; {{ v.vesselType }}</span> }
                        @if (v.dwt) { <span>&middot; {{ v.dwt | number:'1.0-0' }} DWT</span> }
                      </div>
                      @if (v.lengthOverall || v.breadth || v.draught) {
                        <div class="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                          @if (v.lengthOverall || v.breadth) {
                            <span>{{ v.lengthOverall ?? '?' }}m × {{ v.breadth ?? '?' }}m</span>
                          }
                          @if (v.draught) {
                            <span>&middot; {{ v.draught | number:'1.1-1' }}m draft</span>
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
              </div>
            }

            <!-- Port Suppliers -->
            <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                <h2 class="text-sm font-semibold text-gray-700">
                  Port Suppliers
                  @if (portSuppliers().length) {
                    <span class="ml-1 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                      {{ portSuppliers().length }}
                    </span>
                  }
                </h2>
                <button (click)="openAddSupplier()"
                  class="rounded-md bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100 transition-colors">
                  + Add
                </button>
              </div>

              @if (showAddSupplier()) {
                <div class="border-b border-gray-100 px-5 py-4 bg-gray-50/50">
                  <div class="space-y-2">
                    <!-- Company search (typeahead) -->
                    @if (!editingSupplierId()) {
                      <div class="relative">
                        @if (selectedSupplierCompany()) {
                          <div class="flex items-center justify-between rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5 text-sm">
                            <span class="font-medium text-brand-800">{{ selectedSupplierCompany()!.name }}</span>
                            <button (click)="clearSupplierCompany()"
                              class="ml-2 text-brand-400 hover:text-brand-600 transition-colors">
                              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                              </svg>
                            </button>
                          </div>
                        } @else {
                          <input
                            [ngModel]="supplierCompanySearch()"
                            (ngModelChange)="onSupplierCompanySearch($event)"
                            placeholder="Search company..."
                            class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                          />
                          @if (supplierCompanyResults().length) {
                            <div class="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg max-h-48 overflow-y-auto">
                              @for (c of supplierCompanyResults(); track c.id) {
                                <button (click)="selectSupplierCompany(c)"
                                  class="w-full px-3 py-2 text-left text-sm hover:bg-brand-50 transition-colors flex items-center justify-between">
                                  <span class="font-medium text-gray-900">{{ c.name }}</span>
                                  @if (c.country) {
                                    <span class="text-xs text-gray-400">{{ c.country }}</span>
                                  }
                                </button>
                              }
                            </div>
                          }
                        }
                      </div>
                    }
                    <!-- Contact person (shown after company selected or when editing) -->
                    @if (selectedSupplierCompany() || editingSupplierId()) {
                      <div>
                        <label class="block text-xs font-medium text-gray-500 mb-1">Contact Person</label>
                        @if (supplierContactsLoading()) {
                          <div class="text-xs text-gray-400 py-1">Loading contacts...</div>
                        } @else if (supplierContacts().length) {
                          <select
                            [ngModel]="supplierForm().contactId"
                            (ngModelChange)="supplierForm.set({ ...supplierForm(), contactId: $event || null })"
                            class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                            <option [ngValue]="null">— None —</option>
                            @for (ct of supplierContacts(); track ct.id) {
                              <option [ngValue]="ct.id">{{ ct.name }}@if (ct.role) { ({{ ct.role }}) }</option>
                            }
                          </select>
                        } @else {
                          <div class="text-xs text-gray-400 py-1">No contacts on file</div>
                        }
                      </div>
                    }

                    <!-- Products (tag selection) -->
                    <div>
                      <label class="block text-xs font-medium text-gray-500 mb-1">Products</label>
                      <div class="flex flex-wrap gap-1.5">
                        @for (prod of productOptions; track prod) {
                          <button (click)="toggleProduct(prod)"
                            [class]="supplierForm().products.includes(prod)
                              ? 'rounded-full px-2.5 py-1 text-xs font-medium bg-brand-600 text-white ring-1 ring-brand-600 transition-colors'
                              : 'rounded-full px-2.5 py-1 text-xs font-medium bg-white text-gray-600 ring-1 ring-gray-300 hover:ring-brand-400 hover:text-brand-700 transition-colors'">
                            {{ prod }}
                          </button>
                        }
                      </div>
                    </div>

                    <textarea
                      [ngModel]="supplierForm().note"
                      (ngModelChange)="supplierForm.set({ ...supplierForm(), note: $event })"
                      placeholder="Notes"
                      rows="2"
                      class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    ></textarea>
                    <div class="flex justify-end gap-2">
                      <button (click)="cancelSupplierForm()"
                        class="rounded-md border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                        Cancel
                      </button>
                      <button (click)="saveSupplier()"
                        [disabled]="savingSupplier() || (!editingSupplierId() && !selectedSupplierCompany())"
                        class="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors">
                        {{ editingSupplierId() ? 'Update' : 'Add' }}
                      </button>
                    </div>
                  </div>
                </div>
              }

              @if (suppliersLoading()) {
                <div class="flex items-center justify-center py-6">
                  <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                </div>
              } @else if (!portSuppliers().length && !showAddSupplier()) {
                <div class="px-5 py-6 text-center text-sm text-gray-400">No suppliers added yet</div>
              } @else {
                <div class="divide-y divide-gray-50 max-h-[400px] overflow-y-auto">
                  @for (s of portSuppliers(); track s.id) {
                    <div class="px-5 py-3 text-sm hover:bg-gray-50/50 transition-colors group">
                      <div class="flex items-center justify-between">
                        <a [routerLink]="['/companies', s.companyId]" class="font-medium text-brand-700 hover:text-brand-900 hover:underline">{{ s.companyName }}</a>
                        <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button (click)="openEditSupplier(s)"
                            class="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Edit">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                            </svg>
                          </button>
                          <button (click)="deleteSupplier(s.id)"
                            class="rounded p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      @if (s.contactName) {
                        <p class="text-xs text-gray-500 mt-0.5">{{ s.contactName }}</p>
                      }
                      @if (s.products && s.products.length) {
                        <div class="flex flex-wrap gap-1 mt-1">
                          @for (prod of s.products; track prod) {
                            <span class="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700 ring-1 ring-brand-200">{{ prod }}</span>
                          }
                        </div>
                      }
                      @if (s.note) {
                        <p class="text-xs text-gray-400 mt-0.5 italic">{{ s.note }}</p>
                      }
                      <p class="text-[10px] text-gray-400 mt-1">
                        Added by {{ s.addedByName ?? 'Unknown' }} · {{ s.createdAt | date:'mediumDate' }}
                      </p>
                    </div>
                  }
                </div>
              }
            </div>

            <!-- Expected Arrivals -->
            <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                <h2 class="text-sm font-semibold text-gray-700">
                  Expected Arrivals
                  @if (expectedArrivals().length) {
                    <span class="ml-1 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                      {{ expectedArrivals().length }}
                    </span>
                  }
                </h2>
                @if (arrivalsLoading()) {
                  <span class="inline-flex items-center gap-1 text-xs text-gray-400">
                    <svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    Loading…
                  </span>
                }
              </div>
              @if (!arrivalsLoading() && !expectedArrivals().length) {
                <div class="px-5 py-6 text-center text-sm text-gray-400">No expected arrivals in the next 7 days</div>
              } @else if (expectedArrivals().length) {
                <div class="divide-y divide-gray-50 max-h-[400px] overflow-y-auto">
                  @for (a of expectedArrivals(); track a.id) {
                    <div class="px-5 py-3 text-sm hover:bg-gray-50/50 transition-colors">
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-1.5 min-w-0">
                          @if (a.flagCode) {
                            <span class="text-sm">{{ vesselFlag(a.flagCode) }}</span>
                          }
                          <button
                            (click)="navigateToVessel(a.id)"
                            [disabled]="navigatingVesselId() === a.id"
                            class="font-medium text-brand-600 hover:text-brand-800 hover:underline truncate text-left disabled:opacity-50"
                          >
                            @if (navigatingVesselId() === a.id) {
                              <svg class="inline h-3.5 w-3.5 animate-spin mr-1" viewBox="0 0 24 24" fill="none">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                              </svg>
                            }
                            {{ a.name }}
                          </button>
                        </div>
                        @if (a.eta) {
                          <span class="text-[10px] text-gray-500 whitespace-nowrap ml-2">
                            ETA {{ a.eta | date:'MMM d, HH:mm' }}
                          </span>
                        }
                      </div>
                      <div class="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                        @if (a.imo) { <span>IMO {{ a.imo }}</span> }
                        @if (a.vesselType) { <span>&middot; {{ a.vesselType }}</span> }
                        @if (a.dwt) { <span>&middot; {{ a.dwt | number:'1.0-0' }} DWT</span> }
                      </div>
                      @if (a.commercialOperator || a.lastPort) {
                        <div class="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                          @if (a.commercialOperator) { <span>Op: {{ a.commercialOperator }}</span> }
                          @if (a.lastPort) { <span>&middot; From: {{ a.lastPort }}</span> }
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            </div>

          </div>
        </div>
      } @else {
        <div class="text-center py-20">
          <h2 class="text-lg font-semibold text-gray-900">Place not found</h2>
          <p class="mt-1 text-sm text-gray-500">The place you're looking for doesn't exist or has been removed.</p>
        </div>
      }

      <!-- Activity History -->
      @if (place()) {
        <div class="mt-6">
          <app-activity-timeline entityType="place" [entityId]="place()!.id" />
        </div>
      }

      <!-- Comments -->
      @if (place()) {
        <div class="mt-6">
          <app-comments-card entityType="place" [entityId]="place()!.id" />
        </div>
      }

      <!-- Delete confirmation modal -->
      @if (showDeleteModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 class="text-lg font-semibold text-gray-900">Delete Place</h3>
            <p class="mt-2 text-sm text-gray-600">
              Are you sure you want to delete <strong>{{ place()!.name }}</strong>?
              This cannot be undone.
            </p>
            <div class="mt-5 flex justify-end gap-3">
              <button
                (click)="showDeleteModal.set(false)"
                class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                (click)="executeDeletePlace()"
                [disabled]="deletingPlace()"
                class="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {{ deletingPlace() ? 'Deleting…' : 'Delete' }}
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class PlaceDetailPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly wsService = inject(WebSocketService);
  private readonly pageTitle = inject(Title);

  readonly mapContainer = viewChild<ElementRef<HTMLDivElement>>('mapContainer');

  readonly place = signal<PlaceDto | null>(null);
  readonly enrichment = signal<PlaceEnrichment | null>(null);
  readonly loading = signal(true);
  readonly parentLocalId = signal<string | null>(null);
  readonly parentPlaceName = signal<string | null>(null);
  readonly expandedNodes = signal<Set<string>>(new Set());
  readonly nearbyVessels = signal<NearbyVessel[]>([]);
  readonly vesselsLoading = signal(false);
  readonly syncing = signal(false);
  readonly showDeleteModal = signal(false);
  readonly deletingPlace = signal(false);
  readonly mapFullscreen = signal(false);

  // Parent place navigation
  readonly navigatingParentId = signal<boolean>(false);

  // Child place navigation
  readonly navigatingChildId = signal<string | null>(null);

  // Vessel navigation
  readonly navigatingVesselId = signal<string | null>(null);

  // Company navigation
  readonly navigatingCompanyId = signal<string | null>(null);

  // Orders at this place
  readonly placeOrders = signal<PlaceOrder[]>([]);
  readonly ordersLoading = signal(false);

  // Facilities
  readonly facilities = signal<PortFacility[]>([]);
  readonly facilityCompanies = signal<FacilityCompanyGroup[]>([]);
  readonly facilitiesLoading = signal(false);
  readonly facilitiesTab = signal<'info' | 'companies'>('info');

  // Local time
  readonly localTime = signal<string>('');
  private localTimeInterval: ReturnType<typeof setInterval> | null = null;

  // Port suppliers
  readonly portSuppliers = signal<PortSupplierDto[]>([]);
  readonly suppliersLoading = signal(false);
  readonly showAddSupplier = signal(false);
  readonly supplierForm = signal<{ companyId: string; contactId: string | null; products: string[]; note: string }>({ companyId: '', contactId: null, products: [], note: '' });
  readonly editingSupplierId = signal<string | null>(null);
  readonly savingSupplier = signal(false);
  readonly supplierCompanySearch = signal('');
  readonly supplierCompanyResults = signal<{ id: string; name: string; country: string | null }[]>([]);
  readonly selectedSupplierCompany = signal<{ id: string; name: string } | null>(null);
  private supplierSearchTimeout: ReturnType<typeof setTimeout> | null = null;
  readonly supplierContacts = signal<CompanyContactDto[]>([]);
  readonly supplierContactsLoading = signal(false);
  readonly productOptions = PRODUCT_OPTIONS;

  // Expected arrivals
  readonly expectedArrivals = signal<ExpectedArrivalDto[]>([]);
  readonly arrivalsLoading = signal(false);

  // Responsible user
  readonly teamUsers = signal<UserOption[]>([]);
  readonly responsibleUserId = signal<string | null>(null);
  readonly savingResponsible = signal(false);

  // Grouped hierarchy — terminals vs anchorages
  readonly terminals = computed(() =>
    this.enrichment()?.hierarchy?.filter((n) => n.category !== 'ANCHORAGE') ?? [],
  );
  readonly anchorages = computed(() =>
    this.enrichment()?.hierarchy?.filter((n) => n.category === 'ANCHORAGE') ?? [],
  );

  private map: L.Map | null = null;
  private vesselLayer: L.LayerGroup | null = null;
  private wsSubs: Subscription[] = [];
  private vesselRefreshInterval: ReturnType<typeof setInterval> | null = null;
  private currentLliPlaceId: string | null = null;
  private routeSub: Subscription | null = null;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadPlace(id);
    } else {
      this.loading.set(false);
    }

    // React to same-route navigation (e.g. clicking parent/child place links)
    this.routeSub = this.route.paramMap.pipe(skip(1)).subscribe((params) => {
      const newId = params.get('id');
      if (newId) {
        this.resetState();
        this.loadPlace(newId);
      }
    });
  }

  ngOnDestroy(): void {
    this.cleanupResources();
    this.routeSub?.unsubscribe();
  }

  private cleanupResources(): void {
    this.map?.remove();
    this.map = null;
    this.wsSubs.forEach((s) => s.unsubscribe());
    this.wsSubs = [];
    if (this.vesselRefreshInterval) {
      clearInterval(this.vesselRefreshInterval);
      this.vesselRefreshInterval = null;
    }
    if (this.localTimeInterval) {
      clearInterval(this.localTimeInterval);
      this.localTimeInterval = null;
    }
  }

  private resetState(): void {
    this.cleanupResources();
    this.place.set(null);
    this.enrichment.set(null);
    this.loading.set(true);
    this.parentLocalId.set(null);
    this.parentPlaceName.set(null);
    this.expandedNodes.set(new Set());
    this.nearbyVessels.set([]);
    this.vesselsLoading.set(false);
    this.syncing.set(false);
    this.placeOrders.set([]);
    this.ordersLoading.set(false);
    this.facilities.set([]);
    this.facilityCompanies.set([]);
    this.facilitiesLoading.set(false);
    this.facilitiesTab.set('info');
    this.currentLliPlaceId = null;
    this.portSuppliers.set([]);
    this.expectedArrivals.set([]);
    this.localTime.set('');
    this.responsibleUserId.set(null);
    this.showAddSupplier.set(false);
    this.editingSupplierId.set(null);
  }

  async loadPlace(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<PlaceDto>>(`${API}/lloyds/places/local/${id}`),
      );
      if (res.success && res.data) {
        this.place.set(res.data);
        this.pageTitle.setTitle(`Fueld | Places > ${res.data.name}`);
        this.wsService.sendPresence(this.router.url, this.pageTitle.getTitle());

        // Responsible user
        this.responsibleUserId.set(res.data.responsibleUserId ?? null);

        // Load orders for this place
        this.loadOrders(res.data.id);

        // Load port suppliers
        this.loadSuppliers(res.data.id);

        // Load active users for dropdown
        this.loadUsers();

        // Start ticking local time
        this.startLocalTime(res.data.timezone);

        if (res.data.parentPlaceName) {
          this.parentPlaceName.set(res.data.parentPlaceName);
        }

        if (res.data.lliPlaceId) {
          this.loadEnrichment(res.data.lliPlaceId);
          this.loadFacilities(res.data.lliPlaceId);
          this.loadExpectedArrivals(res.data.lliPlaceId);
          // Request nearby vessels + sync via persistent WebSocket
          this.requestViaWebSocket(res.data.lliPlaceId);
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

        if (res.data.parentPlaceName) {
          this.parentPlaceName.set(res.data.parentPlaceName);
        }

        if (res.data.parentPlaceId) {
          this.resolveParentLocalId(res.data.parentPlaceId);
        }
      }
    } catch (err) {
      console.error('Failed to load enrichment:', err);
    } finally {
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
      // Parent link just won't be clickable
    }
  }

  // ─── WebSocket: nearby vessels + place sync ──────────────────────────

  private requestViaWebSocket(lliPlaceId: string): void {
    this.vesselsLoading.set(true);
    this.syncing.set(true);

    // Subscribe to nearby-vessels response (full data, once)
    this.wsSubs.push(
      this.wsService.on<NearbyVessel[]>('nearby-vessels').subscribe((vessels) => {
        this.nearbyVessels.set(vessels);
        this.vesselsLoading.set(false);
        this.addVesselMarkers(vessels);

        // Start 30s position polling after initial data arrives
        if (!this.vesselRefreshInterval && this.currentLliPlaceId) {
          this.vesselRefreshInterval = setInterval(() => {
            if (this.currentLliPlaceId) {
              this.wsService.send({ type: 'vessel-positions', placeId: this.currentLliPlaceId });
            }
          }, 30_000);
        }
      }),
    );

    // Subscribe to vessel-positions response (position + heading only)
    this.wsSubs.push(
      this.wsService.on<{ id: string; lat: number; lng: number; heading?: number | null }[]>('vessel-positions').subscribe((positions) => {
        const current = this.nearbyVessels();
        if (!current.length) return;
        const posMap = new Map(positions.map((p) => [p.id, p]));
        const updated = current.map((v) => {
          const pos = posMap.get(v.id);
          if (!pos) return v;
          return { ...v, lat: pos.lat, lng: pos.lng, ...(pos.heading != null ? { heading: pos.heading } : {}) };
        });
        this.nearbyVessels.set(updated);
        this.addVesselMarkers(updated);
      }),
    );

    // Subscribe to place-synced response
    this.wsSubs.push(
      this.wsService.on<PlaceDto>('place-synced').subscribe((updated) => {
        this.place.set(updated);
        this.syncing.set(false);
      }),
    );

    // Subscribe to sync-error
    this.wsSubs.push(
      this.wsService.onRaw('sync-error').subscribe((msg) => {
        console.warn('[WS] Sync error:', msg.message);
        this.syncing.set(false);
      }),
    );

    // Subscribe to generic errors
    this.wsSubs.push(
      this.wsService.onRaw('error').subscribe((msg) => {
        console.error('[WS] Error:', msg.message);
        this.vesselsLoading.set(false);
        this.syncing.set(false);
      }),
    );

    // Send requests via the persistent WS
    this.currentLliPlaceId = lliPlaceId;
    this.wsService.send({ type: 'nearby-vessels', placeId: lliPlaceId });
    this.wsService.send({ type: 'sync-place', placeId: this.place()!.id });
  }

  // ─── Map ─────────────────────────────────────────────────────────────

  private initMap(): void {
    const p = this.place();
    const el = this.mapContainer()?.nativeElement;
    if (!p?.lat || !p?.long || !el) return;
    if (this.map) return;

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

    // CartoDB Voyager — always English labels
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 20,
      subdomains: 'abcd',
    }).addTo(this.map);

    this.vesselLayer = L.layerGroup().addTo(this.map);

    // Handle clicks on vessel name links inside popups
    this.map.on('popupopen', (e: any) => {
      const container = e.popup.getElement();
      if (!container) return;
      const links = container.querySelectorAll('.vessel-nav-link');
      links.forEach((link: HTMLElement) => {
        link.addEventListener('click', (ev: Event) => {
          ev.preventDefault();
          const vesselId = (ev.currentTarget as HTMLElement).getAttribute('data-vessel-id');
          if (vesselId) this.navigateToVessel(vesselId);
        });
      });
    });

    // Re-render vessel markers on zoom so they scale to real-world size
    this.map.on('zoomend', () => {
      if (this.nearbyVessels().length) {
        this.addVesselMarkers(this.nearbyVessels());
      }
    });

    const enrichment = this.enrichment();
    if (enrichment?.geoJsonObject) {
      const geoLayer = L.geoJSON(enrichment.geoJsonObject as any, {
        style: {
          color: '#3b82f6',
          weight: 2,
          fillColor: '#3b82f6',
          fillOpacity: 0.15,
        },
      }).addTo(this.map);
      this.map.fitBounds(geoLayer.getBounds(), { padding: [30, 30] });
    } else {
      L.marker([p.lat, p.long]).addTo(this.map);
    }

    // Add children (subport) GeoJSON polygons
    if (enrichment?.children?.length) {
      const childColors: Record<string, string> = {
        PSP: '#6366f1', // indigo for sub ports
        TER: '#10b981', // emerald for terminals
        ANC: '#f59e0b', // amber for anchorages
      };

      for (const child of enrichment.children) {
        if (child.geoJsonObject) {
          const color = childColors[child.typeCode] ?? '#8b5cf6';
          L.geoJSON(child.geoJsonObject as any, {
            style: {
              color,
              weight: 1.5,
              fillColor: color,
              fillOpacity: 0.1,
              dashArray: '4 4',
            },
          })
            .bindPopup(
              `<div class="text-xs leading-relaxed"><strong>${child.name}</strong><br>${child.type}</div>`,
              { closeButton: false },
            )
            .addTo(this.map);
        } else if (child.lat && child.lng) {
          // Marker fallback for children without GeoJSON
          const color = childColors[child.typeCode] ?? '#8b5cf6';
          L.circleMarker([child.lat, child.lng], {
            radius: 5,
            color,
            fillColor: color,
            fillOpacity: 0.6,
            weight: 1.5,
          })
            .bindPopup(
              `<div class="text-xs leading-relaxed"><strong>${child.name}</strong><br>${child.type}</div>`,
              { closeButton: false },
            )
            .addTo(this.map);
        }
      }
    }

    // If vessels already arrived before the map initialised
    if (this.nearbyVessels().length) {
      this.addVesselMarkers(this.nearbyVessels());
    }
  }

  private addVesselMarkers(vessels: NearbyVessel[]): void {
    if (!this.map || !this.vesselLayer) return;

    this.vesselLayer.clearLayers();

    for (const v of vessels) {
      if (!v.lat || !v.lng) continue;

      const zoom = this.map!.getZoom();
      const marker = L.marker([v.lat, v.lng], {
        icon: vesselIcon(v.heading, v.lengthOverall, zoom, v.lat),
      });

      const popupLines = [
        `<a href="javascript:void(0)" class="vessel-nav-link text-blue-600 hover:underline font-semibold" data-vessel-id="${v.id}">${v.name}</a>`,
        v.imo ? `IMO: ${v.imo}` : null,
        v.vesselType ? `Type: ${v.vesselType}` : null,
        v.flag ? `Flag: ${v.flag}` : null,
        v.lengthOverall || v.breadth
          ? `Size: ${v.lengthOverall ?? '?'}m × ${v.breadth ?? '?'}m`
          : null,
        v.dwt ? `DWT: ${v.dwt.toLocaleString()}` : null,
        v.draught != null ? `Draft: ${v.draught.toFixed(1)}m` : null,
        v.speed != null ? `Speed: ${v.speed.toFixed(1)} kn` : null,
        v.heading != null ? `Heading: ${v.heading}°` : null,
        v.distance != null ? `Distance: ${v.distance.toFixed(1)} nm` : null,
      ].filter(Boolean);

      marker.bindPopup(
        `<div class="text-xs leading-relaxed">${popupLines.join('<br>')}</div>`,
        { closeButton: false, className: 'vessel-popup' },
      );

      marker.addTo(this.vesselLayer);
    }
  }

  // ─── Orders for this place ────────────────────────────────────────────

  private async loadOrders(placeId: string): Promise<void> {
    this.ordersLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<PlaceOrder[]>>(`${API}/lloyds/places/local/${placeId}/orders`),
      );
      if (res.success && res.data) {
        this.placeOrders.set(res.data);
      }
    } catch (err) {
      console.error('Failed to load orders:', err);
    } finally {
      this.ordersLoading.set(false);
    }
  }

  orderStatusClass(status: string): string {
    switch (status) {
      case 'INQUIRY':   return 'bg-blue-50 text-blue-700';
      case 'OFFER':     return 'bg-violet-50 text-violet-700';
      case 'CONFIRMED': return 'bg-emerald-50 text-emerald-700';
      case 'DELIVERED':  return 'bg-teal-50 text-teal-700';
      case 'INVOICED':  return 'bg-amber-50 text-amber-700';
      case 'PAID':      return 'bg-green-50 text-green-700';
      case 'CANCELLED': return 'bg-red-50 text-red-700';
      default:          return 'bg-gray-50 text-gray-700';
    }
  }

  // ─── Port Facilities ──────────────────────────────────────────────────

  private async loadFacilities(seasearcherId: string): Promise<void> {
    this.facilitiesLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ facilities: PortFacility[]; companies: FacilityCompanyGroup[] }>>(
          `${API}/lloyds/places/facilities/${seasearcherId}`,
        ),
      );
      if (res.success && res.data) {
        this.facilities.set(res.data.facilities);
        this.facilityCompanies.set(res.data.companies);
      }
    } catch (err) {
      console.error('Failed to load facilities:', err);
    } finally {
      this.facilitiesLoading.set(false);
    }
  }

  facilityIcon(type: number): string {
    const icons: Record<number, string> = {
      1: '🏛️', 2: '📋', 3: '🔒', 4: '📜', 5: '📄', 6: '🚢',
      7: '⚓', 8: '🧭', 9: '📻', 10: '🏥', 11: '🏥', 12: '🛃',
      13: '📏', 14: '🔗', 15: '🏗️', 16: '📦', 17: '👥', 18: '📥',
      19: '⛽', 20: '💧', 21: '🚤', 22: '🔧', 23: '🛒', 24: '🚢',
      25: '📦', 26: '🔎', 27: '🏥', 28: '✈️', 29: '🚂', 30: '🏗️',
      31: '🏢', 32: '♻️',
    };
    return icons[type] ?? '📋';
  }

  // ─── Map fullscreen ──────────────────────────────────────────────────

  toggleMapFullscreen(): void {
    this.mapFullscreen.update((v) => !v);
    // Leaflet needs invalidateSize after container resize
    setTimeout(() => this.map?.invalidateSize(), 50);
  }

  // ─── Delete place ─────────────────────────────────────────────────────

  confirmDeletePlace(): void {
    this.showDeleteModal.set(true);
  }

  async executeDeletePlace(): Promise<void> {
    const p = this.place();
    if (!p) return;

    this.deletingPlace.set(true);
    try {
      await firstValueFrom(
        this.http.delete<ApiResponse<{ id: string }>>(`${API}/lloyds/places/local/${p.id}`),
      );
      this.showDeleteModal.set(false);
      this.router.navigate(['/places']);
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      this.deletingPlace.set(false);
    }
  }

  // ─── Navigation & helpers ────────────────────────────────────────────

  async navigateToParent(): Promise<void> {
    const parentSeasearcherId = this.enrichment()?.parentPlaceId;
    if (!parentSeasearcherId) return;

    this.navigatingParentId.set(true);
    try {
      // Check if parent place already exists locally
      const existing = await firstValueFrom(
        this.http.get<ApiResponse<PlaceDto>>(`${API}/lloyds/places/by-lli/${parentSeasearcherId}`),
      ).catch(() => null);

      if (existing?.success && existing.data) {
        this.router.navigate(['/places', existing.data.id]);
        return;
      }

      // Import from Seasearcher
      const imported = await firstValueFrom(
        this.http.post<ApiResponse<PlaceDto>>(`${API}/lloyds/places/import`, { lliPlaceId: parentSeasearcherId }),
      );
      if (imported?.success && imported.data) {
        this.router.navigate(['/places', imported.data.id]);
      }
    } catch (err) {
      console.error('Failed to navigate to parent place:', err);
    } finally {
      this.navigatingParentId.set(false);
    }
  }

  async navigateToChildPlace(seasearcherId: string): Promise<void> {
    this.navigatingChildId.set(seasearcherId);
    try {
      // Check if child place already exists locally
      const existing = await firstValueFrom(
        this.http.get<ApiResponse<PlaceDto>>(`${API}/lloyds/places/by-lli/${seasearcherId}`),
      ).catch(() => null);

      if (existing?.success && existing.data) {
        this.router.navigate(['/places', existing.data.id]);
        return;
      }

      // Import from Seasearcher
      const imported = await firstValueFrom(
        this.http.post<ApiResponse<PlaceDto>>(`${API}/lloyds/places/import`, { lliPlaceId: seasearcherId }),
      );
      if (imported?.success && imported.data) {
        this.router.navigate(['/places', imported.data.id]);
      }
    } catch (err) {
      console.error('Failed to navigate to child place:', err);
    } finally {
      this.navigatingChildId.set(null);
    }
  }

  childTypeIcon(typeCode: string): string {
    switch (typeCode) {
      case 'POR': return '🏗️';
      case 'PSP': return '🚢';
      case 'TER': return '🏭';
      case 'ANC': return '⚓';
      case 'FIL': return '🛢️';
      default:    return '📍';
    }
  }

  async navigateToVessel(seasearcherId: string): Promise<void> {
    this.navigatingVesselId.set(seasearcherId);
    try {
      const existing = await firstValueFrom(
        this.http.get<ApiResponse<VesselDto>>(`${API}/vessels/by-seasearcher/${seasearcherId}`),
      ).catch(() => null);

      if (existing?.success && existing.data) {
        this.router.navigate(['/vessels', existing.data.id]);
        return;
      }

      const imported = await firstValueFrom(
        this.http.post<ApiResponse<VesselDto>>(`${API}/vessels/import`, { seasearcherId }),
      );
      if (imported?.success && imported.data) {
        this.router.navigate(['/vessels', imported.data.id]);
      }
    } catch (err) {
      console.error('Failed to navigate to vessel:', err);
    } finally {
      this.navigatingVesselId.set(null);
    }
  }

  async navigateToCompany(companyName: string): Promise<void> {
    this.navigatingCompanyId.set(companyName);
    try {
      // Import by name (searches Seasearcher, imports first match)
      const imported = await firstValueFrom(
        this.http.post<ApiResponse<CounterpartyDto>>(`${API}/companies/import-by-name`, { companyName }),
      );
      if (imported?.success && imported.data) {
        this.router.navigate(['/companies', imported.data.id]);
      }
    } catch (err) {
      console.error('Failed to navigate to company:', err);
    } finally {
      this.navigatingCompanyId.set(null);
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

  /** Convert ISO 3166-1 alpha-3 flag code to emoji flag. */
  vesselFlag(code: string): string {
    const iso2 = ISO3_TO_ISO2[code.toUpperCase()];
    if (!iso2 || iso2.length !== 2) return '';
    const [a, b] = [...iso2].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65);
    return String.fromCodePoint(a, b);
  }

  // ─── Local Time ───────────────────────────────────────────────────────

  private startLocalTime(timezone: string | null): void {
    if (this.localTimeInterval) {
      clearInterval(this.localTimeInterval);
      this.localTimeInterval = null;
    }

    const offsetMinutes = this.parseTimezoneOffset(timezone);
    if (offsetMinutes === null) {
      this.localTime.set('');
      return;
    }

    const tick = () => {
      const now = new Date();
      const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
      const local = new Date(utcMs + offsetMinutes * 60_000);
      const hh = String(local.getHours()).padStart(2, '0');
      const mm = String(local.getMinutes()).padStart(2, '0');
      const ss = String(local.getSeconds()).padStart(2, '0');
      this.localTime.set(`${hh}:${mm}:${ss}`);
    };

    tick();
    this.localTimeInterval = setInterval(tick, 1000);
  }

  private parseTimezoneOffset(tz: string | null): number | null {
    if (!tz) return null;
    // Handles strings like "GMT +04H", "GMT -05:30H", "GMT", "GMT +0", "UTC +3"
    const match = tz.match(/([+-])\s*(\d{1,2})(?::(\d{2}))?/);
    if (!match) {
      // Could be just "GMT" / "UTC" → offset 0
      if (/^(GMT|UTC)$/i.test(tz.trim())) return 0;
      return null;
    }
    const sign = match[1] === '+' ? 1 : -1;
    const hours = parseInt(match[2], 10);
    const minutes = match[3] ? parseInt(match[3], 10) : 0;
    return sign * (hours * 60 + minutes);
  }

  // ─── Port Suppliers ───────────────────────────────────────────────────

  private async loadSuppliers(placeId: string): Promise<void> {
    this.suppliersLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<PortSupplierDto[]>>(`${API}/lloyds/places/local/${placeId}/suppliers`),
      );
      if (res.success && res.data) {
        this.portSuppliers.set(res.data);
      }
    } catch (err) {
      console.error('Failed to load suppliers:', err);
    } finally {
      this.suppliersLoading.set(false);
    }
  }

  openAddSupplier(): void {
    this.supplierForm.set({ companyId: '', contactId: null, products: [], note: '' });
    this.editingSupplierId.set(null);
    this.selectedSupplierCompany.set(null);
    this.supplierCompanySearch.set('');
    this.supplierCompanyResults.set([]);
    this.supplierContacts.set([]);
    this.showAddSupplier.set(true);
  }

  openEditSupplier(s: PortSupplierDto): void {
    this.supplierForm.set({ companyId: s.companyId, contactId: s.contactId ?? null, products: s.products ?? [], note: s.note ?? '' });
    this.editingSupplierId.set(s.id);
    this.selectedSupplierCompany.set(null);
    this.supplierCompanySearch.set('');
    this.supplierCompanyResults.set([]);
    this.loadSupplierContacts(s.companyId);
    this.showAddSupplier.set(true);
  }

  cancelSupplierForm(): void {
    this.showAddSupplier.set(false);
    this.editingSupplierId.set(null);
    this.selectedSupplierCompany.set(null);
    this.supplierCompanySearch.set('');
    this.supplierCompanyResults.set([]);
    this.supplierContacts.set([]);
  }

  onSupplierCompanySearch(term: string): void {
    this.supplierCompanySearch.set(term);
    if (this.supplierSearchTimeout) clearTimeout(this.supplierSearchTimeout);
    if (term.length < 2) {
      this.supplierCompanyResults.set([]);
      return;
    }
    this.supplierSearchTimeout = setTimeout(async () => {
      try {
        const res = await firstValueFrom(
          this.http.get<ApiResponse<{ companies: { id: string; name: string; country: string | null }[] }>>(`${API}/companies/local?search=${encodeURIComponent(term)}&limit=15`),
        );
        if (res.success && res.data) {
          // filter out companies already added as suppliers
          const existingIds = new Set(this.portSuppliers().map(function(s) { return s.companyId; }));
          this.supplierCompanyResults.set(res.data.companies.filter(function(c) { return !existingIds.has(c.id); }));
        }
      } catch {
        this.supplierCompanyResults.set([]);
      }
    }, 250);
  }

  selectSupplierCompany(c: { id: string; name: string }): void {
    this.selectedSupplierCompany.set(c);
    this.supplierForm.set({ ...this.supplierForm(), companyId: c.id });
    this.supplierCompanySearch.set('');
    this.supplierCompanyResults.set([]);
    this.loadSupplierContacts(c.id);
  }

  clearSupplierCompany(): void {
    this.selectedSupplierCompany.set(null);
    this.supplierForm.set({ ...this.supplierForm(), companyId: '', contactId: null });
    this.supplierCompanySearch.set('');
    this.supplierContacts.set([]);
  }

  private async loadSupplierContacts(companyId: string): Promise<void> {
    this.supplierContactsLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CompanyContactDto[]>>(`${API}/companies/local/${companyId}/contacts`),
      );
      if (res.success && res.data) {
        this.supplierContacts.set(res.data);
      }
    } catch {
      this.supplierContacts.set([]);
    } finally {
      this.supplierContactsLoading.set(false);
    }
  }

  toggleProduct(prod: string): void {
    const current = this.supplierForm().products;
    const next = current.includes(prod)
      ? current.filter(function(p) { return p !== prod; })
      : [...current, prod];
    this.supplierForm.set({ ...this.supplierForm(), products: next });
  }

  async saveSupplier(): Promise<void> {
    const p = this.place();
    if (!p) return;
    const form = this.supplierForm();

    this.savingSupplier.set(true);
    try {
      const editId = this.editingSupplierId();
      if (editId) {
        await firstValueFrom(
          this.http.put(`${API}/lloyds/places/suppliers/${editId}`, {
            contactId: form.contactId,
            products: form.products,
            note: form.note.trim() || undefined,
          }),
        );
      } else {
        if (!form.companyId) return;
        await firstValueFrom(
          this.http.post(`${API}/lloyds/places/local/${p.id}/suppliers`, {
            companyId: form.companyId,
            contactId: form.contactId,
            products: form.products,
            note: form.note.trim() || undefined,
          }),
        );
      }
      this.showAddSupplier.set(false);
      this.editingSupplierId.set(null);
      this.selectedSupplierCompany.set(null);
      this.supplierContacts.set([]);
      this.loadSuppliers(p.id);
    } catch (err) {
      console.error('Failed to save supplier:', err);
    } finally {
      this.savingSupplier.set(false);
    }
  }

  async deleteSupplier(supplierId: string): Promise<void> {
    const p = this.place();
    if (!p) return;
    try {
      await firstValueFrom(
        this.http.delete(`${API}/lloyds/places/suppliers/${supplierId}`),
      );
      this.loadSuppliers(p.id);
    } catch (err) {
      console.error('Failed to delete supplier:', err);
    }
  }

  // ─── Expected Arrivals ────────────────────────────────────────────────

  private async loadExpectedArrivals(seasearcherId: string): Promise<void> {
    this.arrivalsLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<ExpectedArrivalDto[]>>(`${API}/lloyds/places/arrivals/${seasearcherId}`),
      );
      if (res.success && res.data) {
        this.expectedArrivals.set(res.data);
      }
    } catch (err) {
      console.error('Failed to load expected arrivals:', err);
    } finally {
      this.arrivalsLoading.set(false);
    }
  }

  // ─── Responsible User ─────────────────────────────────────────────────

  private async loadUsers(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<UserOption[]>>(`${API}/lloyds/users`),
      );
      if (res.success && res.data) {
        this.teamUsers.set(res.data);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  }

  async onResponsibleUserChange(userId: string): Promise<void> {
    const p = this.place();
    if (!p) return;

    this.savingResponsible.set(true);
    try {
      await firstValueFrom(
        this.http.patch(`${API}/lloyds/places/local/${p.id}/responsible-user`, {
          userId: userId || null,
        }),
      );
      this.responsibleUserId.set(userId || null);
    } catch (err) {
      console.error('Failed to update responsible user:', err);
    } finally {
      this.savingResponsible.set(false);
    }
  }
}
