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
  effect,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, Subscription, skip } from 'rxjs';
import { Title } from '@angular/platform-browser';
import * as L from 'leaflet/dist/leaflet-src.esm.js';
import type { ApiResponse, CompanyContactDto, CompanyEmailDto, CompanyEmailType, CounterpartyDto, SupplyPortDto, VesselCompanyDto, VesselCompanyRole, VesselCompanyRoleOption, VesselDto } from '@fueld/types';
import { flagFromIso3 } from '../../../../shared/utils/flags';
import { COUNTRIES, type Country } from '../../../../shared/data/countries';
import { WebSocketService } from '../../../../core/websocket/websocket.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { ActivityTimelineComponent } from '../../../../shared/components/activity-timeline/activity-timeline.component';
import { LastEditedBadgeComponent } from '../../../../shared/components/last-edited-badge/last-edited-badge.component';
import { CommentsCardComponent } from '../../../../shared/components/comments-card/comments-card.component';
import { API } from '@app/core/config/api';

const TYPE_LABELS: Record<string, string> = {
  CLIENT: 'Client',
  SUPPLIER: 'Supplier',
  BARGE: 'Barge',
};

const ALL_TYPES = ['CLIENT', 'SUPPLIER', 'BARGE'] as const;

interface CompanyEnrichment {
  id: string;
  companyImo: string;
  companyName: string;
  shortname: string;
  countryOfAllegiance: string;
  yearFormed: number | null;
  country: { code: string; name: string };
  headOffice: {
    officeId: number;
    country: string;
    town: string;
    countryCode: string;
    addressLine1: string;
    addressLine2: string;
    addressLine3: string;
    addressLine4: string;
    postCode1: string;
    telephoneNumbers: Array<{
      countryDialingCode: string;
      areaDialingCode: string;
      number: string;
    }>;
    faxNumbers?: Array<{
      countryDialingCode: string;
      areaDialingCode: string;
      number: string;
    }>;
    emailAddress: string | null;
    webAddress: string | null;
    personnel?: Array<{
      name: string;
      jobTitle: string;
    }>;
  } | null;
  offices: Array<{
    officeId: number;
    country: string;
    town: string;
    countryCode: string;
    addressLine1: string;
    telephoneNumbers?: Array<{
      countryDialingCode: string;
      areaDialingCode: string;
      number: string;
    }>;
    faxNumbers?: Array<{
      countryDialingCode: string;
      areaDialingCode: string;
      number: string;
    }>;
    emailAddress?: string | null;
    webAddress?: string | null;
    personnel?: Array<{
      name: string;
      jobTitle: string;
    }>;
  }>;
  companyRoles: string[];
  companyFleetStats: {
    totalFleetSize: number;
    mostFrequentVesselType: string;
    fleetStatsBreakdown: Array<{
      key: string;
      vesselCount: number;
      totalGrossTonnage: number;
      totalDwt: number;
    }>;
  } | null;
  isSanctioned: boolean;
  showSanctionedBadge: boolean;
  hasVesselsSanctions: boolean;
  lastUpdated: string;
  companyRegistration: {
    localName: string | null;
    registryName: string | null;
    incorporationDate: string | null;
    registrationNumbers: Array<{ value: string | null; typeDescription: string | null }>;
  } | null;
  counterpartyRiskReportMetadata: {
    ratingDate: string;
    creditOpinion: string;
    overallPerformance: { text: string; textAbbreviation: string } | null;
    overallRating: { text: string } | null;
    paymentPerformance: { text: string } | null;
  } | null;
  companyNameHistory: Array<{ name: string; fromDate: string }>;
  builtVesselsCount: number;
  tier: number;
}

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

interface VesselSearchResultOption {
  key: string;
  source: 'local' | 'seasearcher';
  id?: string;
  seasearcherId?: string;
  name: string;
  imo?: string;
}

interface CompanyOrder {
  id: string;
  status: string;
  eta: string | null;
  etd: string | null;
  createdAt: string;
  updatedAt: string;
  vesselName: string;
  vesselImo: string | null;
  placeName: string;
  placeCountry: string;
  salesRepId: string | null;
}

interface UserOption {
  id: string;
  name: string;
  email: string;
}

interface FleetVessel {
  id: string;
  imo: string;
  name: string;
  type: string;
  status: string;
  flag: { code: string; name: string } | null;
  grossTonnage: number | null;
  deadWeightTonnage: number | null;
  buildYear: number | null;
  lengthOverall: string | null;
  breadthExtreme: string | null;
  draught: string | null;
  destination: { place: { id: string; name: string }; country: { code: string; name: string }; eta: string } | null;
  owners: Array<{ type: string; typeCode: string; companyId: string; companyName: string }>;
  hasSanctions: boolean;
  latestInformation?: {
    position?: { lat: number; lng: number; timeStamp?: string };
    nearestPort?: string;
    region?: string;
    trueHeading?: number;
    aisSpeed?: number;
  } | null;
}

interface FleetResponse {
  results: FleetVessel[];
  totalMatches: number;
}

interface HierarchyNode {
  level: number;
  companyId: string;
  companyName: string;
  commercialOperator: number;
  registered: number;
  technicalManager: number;
  thirdPartyOperator: number;
  beneficialOwner: number;
  nominalOwner: number;
  ismManager: number;
  companyHierarchy: HierarchyNode[];
  active: boolean;
  isSanctioned: boolean;
  showSanctionedBadge: boolean;
}

interface HierarchyResponse {
  companyId: string;
  companyHierarchy: HierarchyNode;
}

interface SeizureRecord {
  vesselName: string;
  imo: string;
  flagCode: string;
  port: string;
  country: string;
  seizureDate: string;
  releaseDate: string | null;
  reason: string | null;
}

interface SeizuresResponse {
  results: any[];
  totalMatches: number;
}

interface SanctionRecord {
  sanctionSource: string;
  sanctionType: string;
  listedDate: string;
  delistedDate: string | null;
  details: string | null;
}

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
function vesselIcon(heading: number | null, loa: number | null, zoom: number, lat: number, sanctioned = false): L.DivIcon {
  const deg = heading ?? 0;
  const loaMeters = loa ?? 100;
  const mpp = metersPerPx(lat, zoom);

  // Convert LOA to pixels, with min 10px and max 120px
  const h = Math.round(Math.max(10, Math.min(loaMeters / mpp, 120)));
  const w = Math.round(h * 0.35);

  // Sanctioned = red, otherwise colour by real size: small=blue, medium=orange, large=red
  const fill = sanctioned ? '#ef4444' : loaMeters < 120 ? '#3b82f6' : loaMeters < 250 ? '#f97316' : '#ef4444';
  const stroke = sanctioned ? '#991b1b' : loaMeters < 120 ? '#1d4ed8' : loaMeters < 250 ? '#c2410c' : '#991b1b';

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
  selector: 'app-company-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, FormsModule, RouterLink, ActivityTimelineComponent, LastEditedBadgeComponent, CommentsCardComponent],
  styles: [`
    :host ::ng-deep .leaflet-container { font-family: inherit; }
    .fleet-map-fullscreen {
      position: fixed !important;
      inset: 0 !important;
      z-index: 9999 !important;
      width: 100vw !important;
      height: 100vh !important;
      border-radius: 0 !important;
      border: none !important;
    }
    .fleet-map-fullscreen .fleet-map-container {
      border-radius: 0 !important;
    }
    @media (min-width: 900px) {
      .company-card-grid > div > .rounded-xl,
      .company-card-grid > div > app-comments-card {
        height: 449px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
    }
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
        Back to Companies
      </button>

      @if (loading()) {
        <div class="flex items-center justify-center py-20">
          <svg class="h-6 w-6 animate-spin text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else if (company()) {
        <!-- Header -->
        <div class="mb-6">
          <div class="flex items-center gap-3 mb-1">
            @if (companyFlag()) { <span class="text-2xl">{{ companyFlag() }}</span> }
            <h1 class="text-2xl font-bold text-gray-900">{{ company()!.name }}</h1>
            @for (t of companyTypes(); track t) {
              <span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
                [class]="typeBadgeClass(t)">
                {{ typeLabel(t) }}
              </span>
            }
            @if (company()!.isSanctioned) {
              <span class="inline-flex items-center rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
                ⚠️ Sanctioned
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
              @if (company()!.seasearcherId) {
                <a
                  [href]="'https://www.seasearcher.com/company/' + company()!.seasearcherId"
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
              @if (canDeleteEntity()) {
                <button
                  (click)="confirmDeleteOpen.set(true)"
                  class="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
                >
                  Delete
                </button>
              }
            </div>
          </div>
          <div class="flex items-center gap-3">
            <p class="text-sm text-gray-500">
              {{ company()!.country ?? 'No country' }}
              @if (company()!.countryIso) { ({{ company()!.countryIso }}) }
              @if (company()!.yearFormed) { &middot; Founded {{ company()!.yearFormed }} }
            </p>
            @if (company()!.lastSynced) {
              <span class="inline-flex items-center gap-1 text-xs text-gray-400" title="Last synced with Seasearcher">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
                </svg>
                Synced {{ company()!.lastSynced | date:'short' }}
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
          </div>
          <app-last-edited-badge entityType="company" [entityId]="company()!.id" />
        </div>

        <div class="company-card-grid grid grid-cols-1 gap-6 min-[900px]:grid-cols-2 min-[1600px]:grid-cols-3 min-[2000px]:grid-cols-4">
          <!-- Left column -->
          <div class="contents">

            <!-- Company Info + Head Office -->
            <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:order-1 flex flex-col overflow-hidden">
              <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                <h2 class="text-sm font-semibold text-gray-700">Company Information</h2>
                <div class="flex items-center gap-2">
                  @if (!company()!.seasearcherId && !editing()) {
                    <button
                      (click)="startEditing()"
                      class="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                      </svg>
                      Edit
                    </button>
                  }
                  @if (editing()) {
                    <button
                      (click)="cancelEditing()"
                      class="rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-50 transition-colors"
                    >Cancel</button>
                    <button
                      (click)="saveEditing()"
                      [disabled]="editSaving()"
                      class="rounded-md bg-brand-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
                    >
                      @if (editSaving()) { Saving… } @else { Save }
                    </button>
                  }
                  <div class="flex gap-1">
                  <button
                    type="button"
                    class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                    [class]="companyInfoTab() === 'info' ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-gray-600'"
                    (click)="companyInfoTab.set('info')"
                  >
                    Company Info
                  </button>
                  <button
                    type="button"
                    class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                    [class]="companyInfoTab() === 'headOffice' ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-gray-600'"
                    (click)="companyInfoTab.set('headOffice')"
                  >
                    Head Office
                  </button>
                </div>
                </div>
              </div>
              <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4 text-sm">
                @if (companyInfoTab() === 'info') {
                  <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
                    <div>
                      <dt class="text-gray-500">Company Name</dt>
                      @if (editing()) {
                        <dd class="mt-0.5">
                          <input
                            type="text"
                            [value]="editName()"
                            (input)="editName.set($any($event.target).value)"
                            class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100"
                          />
                        </dd>
                      } @else {
                        <dd class="mt-0.5 font-medium text-gray-900">{{ company()!.name }}</dd>
                      }
                    </div>
                    <div>
                      <dt class="text-gray-500">Type</dt>
                      <dd class="mt-0.5 flex flex-wrap gap-1.5">
                        @for (t of allTypes; track t) {
                          <button
                            (click)="toggleType(t)"
                            [disabled]="typeSaving()"
                            class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-all cursor-pointer"
                            [class]="companyTypes().includes(t)
                              ? typeBadgeClass(t)
                              : 'bg-gray-50 text-gray-400 border border-dashed border-gray-300 hover:border-gray-400 hover:text-gray-500'"
                          >
                            {{ typeLabel(t) }}
                          </button>
                        }
                        @if (typeSaving()) {
                          <svg class="h-4 w-4 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                          </svg>
                        }
                      </dd>
                    </div>
                    <div>
                      <dt class="text-gray-500">Country</dt>
                      @if (editing()) {
                        <dd class="mt-0.5 relative">
                          <div class="flex items-center gap-2">
                            @if (editCountryIso()) {
                              <span class="text-lg">{{ countryFlag(editCountryIso()) }}</span>
                            }
                            <input
                              type="text"
                              [value]="countrySearchQuery()"
                              (input)="onCountrySearch($any($event.target).value)"
                              (focus)="showCountryDropdown.set(true)"
                              placeholder="Search country…"
                              class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100"
                            />
                          </div>
                          @if (showCountryDropdown() && filteredCountries().length) {
                            <div class="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                              @for (c of filteredCountries(); track c.code) {
                                <button
                                  type="button"
                                  (mousedown)="selectCountry(c)"
                                  class="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 transition-colors"
                                >
                                  <span>{{ countryFlag(c.code) }}</span>
                                  <span class="font-medium text-gray-900">{{ c.name }}</span>
                                  <span class="ml-auto text-xs text-gray-400 font-mono">{{ c.code }}</span>
                                </button>
                              }
                            </div>
                          }
                        </dd>
                      } @else {
                        <dd class="mt-0.5 font-medium text-gray-900">
                          @if (company()!.countryIso) {
                            <span class="mr-1">{{ countryFlag(company()!.countryIso) }}</span>
                          }
                          {{ company()!.country ?? '—' }}
                        </dd>
                      }
                    </div>
                    <div>
                      <dt class="text-gray-500">Country Code</dt>
                      <dd class="mt-0.5 font-medium text-gray-900 font-mono">
                        @if (editing()) {
                          {{ editCountryIso() || '—' }}
                        } @else {
                          {{ company()!.countryIso ?? '—' }}
                        }
                      </dd>
                    </div>
                    <div>
                      <dt class="text-gray-500">Year Formed</dt>
                      <dd class="mt-0.5 font-medium text-gray-900">{{ company()!.yearFormed ?? '—' }}</dd>
                    </div>
                    <div>
                      <dt class="text-gray-500">Fleet Size</dt>
                      <dd class="mt-0.5 font-medium text-gray-900">{{ company()!.fleetSize ?? '—' }}</dd>
                    </div>
                    <div>
                      <dt class="text-gray-500">Credit Limit</dt>
                      <dd class="mt-0.5 font-medium text-gray-900">\${{ company()!.creditLimit }}</dd>
                    </div>
                    <div>
                      <dt class="text-gray-500">Seasearcher ID</dt>
                      <dd class="mt-0.5 font-medium text-gray-900">{{ company()!.seasearcherId ?? '—' }}</dd>
                    </div>
                    <div>
                      <dt class="text-gray-500">Sanctioned</dt>
                      <dd class="mt-0.5">
                        @if (company()!.isSanctioned) {
                          <span class="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Yes</span>
                        } @else {
                          <span class="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">No</span>
                        }
                      </dd>
                    </div>
                  </dl>
                } @else {
                  <div class="space-y-4">
                    @if (
                      company()!.headOfficeAddress ||
                      company()!.headOfficePhone ||
                      company()!.headOfficeEmail ||
                      company()!.website ||
                      enrichment()?.headOffice?.faxNumbers?.length
                    ) {
                      <dl class="grid grid-cols-1 gap-y-3 text-sm">
                        @if (company()!.headOfficeAddress) {
                          <div>
                            <dt class="text-gray-500">Address</dt>
                            <dd class="mt-0.5 font-medium text-gray-900">{{ company()!.headOfficeAddress }}</dd>
                          </div>
                        }
                        @if (company()!.headOfficePhone) {
                          <div>
                            <dt class="text-gray-500">Phone</dt>
                            <dd class="mt-0.5 font-medium text-gray-900">{{ company()!.headOfficePhone }}</dd>
                          </div>
                        }
                        @if (company()!.headOfficeEmail) {
                          <div>
                            <dt class="text-gray-500">Email</dt>
                            <dd class="mt-0.5">
                              <a [href]="'mailto:' + company()!.headOfficeEmail" class="font-medium text-brand-600 hover:text-brand-800">
                                {{ company()!.headOfficeEmail }}
                              </a>
                            </dd>
                          </div>
                        }
                        @if (company()!.website) {
                          <div>
                            <dt class="text-gray-500">Website</dt>
                            <dd class="mt-0.5">
                              <a [href]="websiteUrl()" target="_blank" rel="noopener noreferrer" class="font-medium text-brand-600 hover:text-brand-800">
                                {{ company()!.website }}
                              </a>
                            </dd>
                          </div>
                        }
                        @if (enrichment()?.headOffice?.faxNumbers?.length) {
                          <div>
                            <dt class="text-gray-500">Fax</dt>
                            <dd class="mt-0.5 font-medium text-gray-900">{{ formatPhone(enrichment()!.headOffice!.faxNumbers!) }}</dd>
                          </div>
                        }
                      </dl>
                    }
                    @if (enrichment()?.headOffice?.personnel?.length) {
                      <div class="border-t border-gray-100 px-5 py-4">
                        <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Contact Persons</h3>
                        <div class="space-y-2">
                          @for (c of enrichment()!.headOffice!.personnel!; track c.name) {
                            <div class="flex items-center gap-3">
                              <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
                                {{ c.name.charAt(0) }}
                              </div>
                              <div>
                                <span class="text-sm font-medium text-gray-900">{{ c.name }}</span>
                                @if (c.jobTitle) {
                                  <span class="ml-1.5 text-xs text-gray-500">{{ c.jobTitle }}</span>
                                }
                              </div>
                            </div>
                          }
                        </div>
                      </div>
                    }
                    @if (
                      !company()!.headOfficeAddress &&
                      !company()!.headOfficePhone &&
                      !company()!.headOfficeEmail &&
                      !company()!.website &&
                      !enrichment()?.headOffice?.faxNumbers?.length &&
                      !enrichment()?.headOffice?.personnel?.length
                    ) {
                      <div class="text-xs text-gray-500 text-center">Head office data unavailable</div>
                    }
                  </div>
                }
              </div>
            </div>

            <!-- Contacts -->
            <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:order-5">
              <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <h2 class="text-sm font-semibold text-gray-700">Contacts</h2>
                  @if (contacts().length) {
                    <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                      {{ contacts().length }}
                    </span>
                  }
                </div>
                <button
                  (click)="openAddContact()"
                  class="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                  </svg>
                  Add Contact
                </button>
              </div>
              @if (contactsLoading()) {
                <div class="flex items-center justify-center py-8">
                  <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                </div>
              } @else if (contacts().length) {
                <div class="divide-y divide-gray-50">
                  @for (c of contacts(); track c.id) {
                    <div class="px-5 py-3 flex items-start justify-between group">
                      <div class="flex items-start gap-3 min-w-0">
                        <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                          [class]="c.source === 'seasearcher' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'">
                          {{ c.name.charAt(0) }}
                        </div>
                        <div class="min-w-0">
                          <div class="flex items-center gap-2">
                            <span class="text-sm font-medium text-gray-900">{{ c.name }}</span>
                            @if (c.role) {
                              <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                                {{ c.role }}
                              </span>
                            }
                            @if (c.source === 'seasearcher') {
                              <span class="inline-flex items-center rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
                                LLI
                              </span>
                            }
                          </div>
                          <div class="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
                            @if (c.phone) {
                              <span class="inline-flex items-center gap-1">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                                </svg>
                                {{ c.phone }}
                              </span>
                            }
                            @if (c.fax) {
                              <span class="inline-flex items-center gap-1">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                  <path fill-rule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a2 2 0 002 2h6a2 2 0 002-2v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm0 8H7v4h6v-4z" clip-rule="evenodd" />
                                </svg>
                                {{ c.fax }}
                              </span>
                            }
                            @if (c.email) {
                              <a [href]="'mailto:' + c.email" class="inline-flex items-center gap-1 text-brand-600 hover:text-brand-800">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                                  <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                                </svg>
                                {{ c.email }}
                              </a>
                            }
                          </div>
                          @if (c.notes) {
                            <p class="mt-1 text-xs text-gray-400 italic">{{ c.notes }}</p>
                          }
                        </div>
                      </div>
                      <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                        <button (click)="openEditContact(c)" class="rounded-md p-1 text-gray-400 hover:text-brand-600 transition-colors" title="Edit">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" />
                            <path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" />
                          </svg>
                        </button>
                        @if (c.source !== 'seasearcher') {
                          <button (click)="confirmDeleteContact(c)" class="rounded-md p-1 text-gray-400 hover:text-red-500 transition-colors" title="Delete">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                            </svg>
                          </button>
                        }
                      </div>
                    </div>
                  }
                </div>
              } @else {
                <div class="px-5 py-6 text-center text-sm text-gray-400">
                  No contacts yet. Click "Add Contact" to add one.
                </div>
              }
            </div>

            <!-- Contact Modal -->
            @if (showContactModal()) {
              <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="showContactModal.set(false)">
                <div class="rounded-xl bg-white p-6 shadow-xl w-full max-w-md mx-4" (click)="$event.stopPropagation()">
                  <h3 class="text-lg font-semibold text-gray-900">{{ editingContactId() ? 'Edit' : 'Add' }} Contact</h3>

                  @if (contactError()) {
                    <div class="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{{ contactError() }}</div>
                  }

                  <div class="mt-4 space-y-3">
                    <div>
                      <label class="block text-sm font-medium text-gray-700">Name *</label>
                      <input type="text" [ngModel]="contactForm().name" (ngModelChange)="updateContactField('name', $event)"
                        class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                        placeholder="e.g. John Smith" />
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700">Role / Job Title</label>
                      <input type="text" [ngModel]="contactForm().role" (ngModelChange)="updateContactField('role', $event)"
                        class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                        placeholder="e.g. Bunker Manager" />
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                      <div>
                        <label class="block text-sm font-medium text-gray-700">Phone</label>
                        <input type="text" [ngModel]="contactForm().phone" (ngModelChange)="updateContactField('phone', $event)"
                          class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                          placeholder="+1 905 467 7357" />
                      </div>
                      <div>
                        <label class="block text-sm font-medium text-gray-700">Fax</label>
                        <input type="text" [ngModel]="contactForm().fax" (ngModelChange)="updateContactField('fax', $event)"
                          class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                          placeholder="+1 905 467 7358" />
                      </div>
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700">Email</label>
                      <input type="email" [ngModel]="contactForm().email" (ngModelChange)="updateContactField('email', $event)"
                        class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                        placeholder="john@example.com" />
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700">Notes</label>
                      <textarea [ngModel]="contactForm().notes" (ngModelChange)="updateContactField('notes', $event)"
                        class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                        rows="2" placeholder="Any additional notes..."></textarea>
                    </div>
                  </div>

                  <div class="mt-5 flex justify-end gap-2">
                    <button (click)="showContactModal.set(false)"
                      class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                    <button (click)="saveContact()" [disabled]="contactSaving()"
                      class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                      @if (contactSaving()) { Saving… } @else { {{ editingContactId() ? 'Update' : 'Add' }} }
                    </button>
                  </div>
                </div>
              </div>
            }

            <!-- Delete Contact Confirmation -->
            @if (deleteContactTarget()) {
              <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="deleteContactTarget.set(null)">
                <div class="rounded-xl bg-white p-6 shadow-xl max-w-sm mx-4" (click)="$event.stopPropagation()">
                  <h3 class="text-lg font-semibold text-gray-900">Delete contact?</h3>
                  <p class="mt-2 text-sm text-gray-500">
                    Are you sure you want to delete <strong>{{ deleteContactTarget()!.name }}</strong>?
                  </p>
                  <div class="mt-4 flex justify-end gap-2">
                    <button (click)="deleteContactTarget.set(null)"
                      class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                    <button (click)="executeDeleteContact()"
                      class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Delete</button>
                  </div>
                </div>
              </div>
            }

            <!-- Delete Vessel Association Confirmation -->
            @if (confirmDeleteVesselAssoc()) {
              <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="confirmDeleteVesselAssoc.set(null)">
                <div class="rounded-xl bg-white p-6 shadow-xl max-w-sm mx-4" (click)="$event.stopPropagation()">
                  <h3 class="text-lg font-semibold text-gray-900">Remove vessel association?</h3>
                  <p class="mt-2 text-sm text-gray-500">
                    Are you sure you want to remove the <strong>{{ confirmDeleteVesselAssoc()!.role }}</strong> association for
                    <strong>{{ confirmDeleteVesselAssoc()!.vesselName ?? 'this vessel' }}</strong>?
                  </p>
                  <div class="mt-4 flex justify-end gap-2">
                    <button (click)="confirmDeleteVesselAssoc.set(null)"
                      class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                    <button (click)="executeDeleteVesselAssoc()"
                      class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Remove</button>
                  </div>
                </div>
              </div>
            }

            <!-- Company Emails -->
            <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:order-7">
              <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                <h2 class="text-sm font-semibold text-gray-700">
                  Emails
                  @if (companyEmails().length) {
                    <span class="ml-1 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                      {{ companyEmails().length }}
                    </span>
                  }
                </h2>
                <button (click)="openAddEmail()"
                  class="rounded-md bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100 transition-colors">
                  + Add
                </button>
              </div>

              @if (showAddEmail()) {
                <div class="border-b border-gray-100 px-5 py-4 bg-gray-50/50">
                  <div class="space-y-2">
                    <div class="grid grid-cols-2 gap-2">
                      <div>
                        <label class="block text-xs font-medium text-gray-500 mb-1">Type</label>
                        <select
                          [ngModel]="emailForm().emailType"
                          (ngModelChange)="emailForm.set({ ...emailForm(), emailType: $event })"
                          class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                          @for (type of emailTypeOptions; track type) {
                            <option [ngValue]="type">{{ formatEmailType(type) }}</option>
                          }
                        </select>
                      </div>
                      <div>
                        <label class="block text-xs font-medium text-gray-500 mb-1">Label (optional)</label>
                        <input
                          [ngModel]="emailForm().label"
                          (ngModelChange)="emailForm.set({ ...emailForm(), label: $event })"
                          placeholder="e.g. Main office"
                          class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-gray-500 mb-1">Email Address</label>
                      <input
                        type="email"
                        [ngModel]="emailForm().email"
                        (ngModelChange)="emailForm.set({ ...emailForm(), email: $event })"
                        placeholder="email@example.com"
                        class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        [ngModel]="emailForm().isPrimary"
                        (ngModelChange)="emailForm.set({ ...emailForm(), isPrimary: $event })"
                        class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span class="text-xs text-gray-600">Set as primary for this type</span>
                    </label>
                    <div class="flex justify-end gap-2">
                      <button (click)="cancelEmailForm()"
                        class="rounded-md border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                        Cancel
                      </button>
                      <button (click)="saveCompanyEmail()"
                        [disabled]="savingEmail() || !emailForm().email.trim()"
                        class="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors">
                        {{ editingEmailId() ? 'Update' : 'Add' }}
                      </button>
                    </div>
                  </div>
                </div>
              }

              @if (emailsLoading()) {
                <div class="flex items-center justify-center py-6">
                  <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                </div>
              } @else if (!companyEmails().length && !showAddEmail()) {
                <div class="px-5 py-6 text-center text-sm text-gray-400">No emails added yet</div>
              } @else {
                <div class="divide-y divide-gray-50 max-h-[300px] overflow-y-auto">
                  @for (e of companyEmails(); track e.id) {
                    <div class="px-5 py-3 text-sm hover:bg-gray-50/50 transition-colors group">
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                          <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                            [class]="emailTypeBadgeClass(e.emailType)">
                            {{ formatEmailType(e.emailType) }}
                          </span>
                          <a [href]="'mailto:' + e.email" class="font-medium text-brand-700 hover:text-brand-900 hover:underline">{{ e.email }}</a>
                          @if (e.isPrimary) {
                            <span class="inline-flex items-center rounded-full bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-600">Primary</span>
                          }
                        </div>
                        <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button (click)="openEditEmail(e)"
                            class="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Edit">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                            </svg>
                          </button>
                          <button (click)="deleteCompanyEmail(e.id)"
                            class="rounded p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      @if (e.label) {
                        <p class="text-xs text-gray-500 mt-0.5">{{ e.label }}</p>
                      }
                      <p class="text-[10px] text-gray-400 mt-1">
                        Added by {{ e.addedByName ?? 'Unknown' }} · {{ e.createdAt | date:'mediumDate' }}
                      </p>
                    </div>
                  }
                </div>
              }
            </div>

            <!-- Supplies At (ports where this company is a supplier) -->
            @if (supplyPortsLoading() || supplyPorts().length) {
              <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:order-11">
                <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                  <h2 class="text-sm font-semibold text-gray-700">
                    Supplies At
                    @if (supplyPorts().length) {
                      <span class="ml-1 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                        {{ supplyPorts().length }}
                      </span>
                    }
                  </h2>
                </div>
                @if (supplyPortsLoading()) {
                  <div class="flex items-center justify-center py-6">
                    <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                  </div>
                } @else {
                  <div class="divide-y divide-gray-50 max-h-[300px] overflow-y-auto">
                    @for (sp of supplyPorts(); track sp.id) {
                      <div class="px-5 py-3 text-sm hover:bg-gray-50/50 transition-colors">
                        <div class="flex items-center justify-between">
                          <a [routerLink]="['/places', sp.placeId]" class="font-medium text-brand-700 hover:text-brand-900 hover:underline">{{ sp.placeName }}</a>
                          @if (sp.placeCountry) {
                            <span class="text-xs text-gray-400">{{ sp.placeCountry }}</span>
                          }
                        </div>
                        @if (sp.products && sp.products.length) {
                          <div class="flex flex-wrap gap-1 mt-1">
                            @for (prod of sp.products; track prod) {
                              <span class="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700 ring-1 ring-brand-200">{{ prod }}</span>
                            }
                          </div>
                        }
                        @if (sp.note) {
                          <p class="text-xs text-gray-400 mt-0.5 italic">{{ sp.note }}</p>
                        }
                      </div>
                    }
                  </div>
                }
              </div>
            }

            <!-- Orders -->
            <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:order-[13]">
              <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                <h2 class="text-sm font-semibold text-gray-700">Orders</h2>
                @if (companyOrders().length) {
                  <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                    {{ companyOrders().length }}
                  </span>
                }
              </div>
              @if (ordersLoading()) {
                <div class="flex items-center justify-center py-8">
                  <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                </div>
              } @else if (companyOrders().length) {
                <div class="overflow-x-auto">
                  <table class="w-full text-sm">
                    <thead>
                      <tr class="border-b border-gray-100 bg-gray-50/60">
                        <th class="px-5 py-2 text-left font-medium text-gray-500">Vessel</th>
                        <th class="px-5 py-2 text-left font-medium text-gray-500">Place</th>
                        <th class="px-5 py-2 text-left font-medium text-gray-500">Status</th>
                        <th class="px-5 py-2 text-left font-medium text-gray-500">Created</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-50">
                      @for (order of companyOrders(); track order.id) {
                        <tr class="hover:bg-gray-50/50 cursor-pointer transition-colors" (click)="goToOrder(order.id)">
                          <td class="px-5 py-2.5">
                            <span class="font-medium text-gray-900">{{ order.vesselName }}</span>
                            @if (order.vesselImo) {
                              <span class="ml-1 text-xs text-gray-400">{{ order.vesselImo }}</span>
                            }
                          </td>
                          <td class="px-5 py-2.5 text-gray-600">
                            {{ order.placeName }}
                            @if (order.placeCountry) {
                              <span class="text-xs text-gray-400 ml-1">{{ order.placeCountry }}</span>
                            }
                          </td>
                          <td class="px-5 py-2.5">
                            <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                              [class]="statusBadge(order.status)">
                              {{ order.status }}
                            </span>
                          </td>
                          <td class="px-5 py-2.5 text-gray-500">{{ order.createdAt | date:'mediumDate' }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              } @else {
                <div class="px-5 py-6 text-center text-sm text-gray-400">No orders found for this company</div>
              }
            </div>

            <!-- Fleet Map -->
            @if (fleetVesselsWithPosition().length) {
              <div class="rounded-xl border border-gray-200 bg-white shadow-sm transition-all min-[900px]:order-[15]"
                   [class.fleet-map-fullscreen]="fleetMapFullscreen()">
                <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between"
                     [class.hidden]="fleetMapFullscreen()">
                  <h2 class="text-sm font-semibold text-gray-700">Fleet Map</h2>
                  <button
                    (click)="toggleFleetMapFullscreen()"
                    class="rounded-md p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                    title="Fullscreen"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 01-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12zm-9 7a1 1 0 012 0v1.586l2.293-2.293a1 1 0 011.414 1.414L6.414 15H8a1 1 0 010 2H4a1 1 0 01-1-1v-4zm13 0a1 1 0 01.993.883L17 13v4a1 1 0 01-1 1h-4a1 1 0 010-2h1.586l-2.293-2.293a1 1 0 011.414-1.414L15 14.586V13a1 1 0 011-1z" />
                    </svg>
                  </button>
                </div>
                <div class="p-0 relative">
                  <div #fleetMapEl class="fleet-map-container w-full rounded-b-xl"
                       [style.height]="fleetMapFullscreen() ? '100vh' : '400px'"></div>
                  @if (fleetMapFullscreen()) {
                    <button
                      (click)="toggleFleetMapFullscreen()"
                      class="absolute top-3 right-3 z-[10000] rounded-lg bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-md border border-gray-200 hover:bg-gray-50 transition-colors flex items-center gap-1.5"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                      </svg>
                      Exit Fullscreen
                    </button>
                  }
                </div>
              </div>
            }

            <!-- Fleet (Seasearcher + Manual) -->
            <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:order-[17] min-[900px]:col-span-2">
              <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                <h2 class="text-sm font-semibold text-gray-700">Fleet</h2>
                <div class="flex items-center gap-2">
                  @if (fleet()) {
                    <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                      {{ fleet()!.totalMatches }} vessels
                    </span>
                  }
                  <button (click)="openAddVessel()"
                    class="rounded-md bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100 transition-colors">
                    + Add manual
                  </button>
                </div>
              </div>

              @if (showAddVessel()) {
                <div class="border-b border-gray-100 px-5 py-4 bg-gray-50/50">
                  <div class="space-y-2">
                    @if (!editingVesselAssocId()) {
                      <div class="relative">
                        @if (selectedVessel()) {
                          <div class="flex items-center justify-between rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5 text-sm">
                            <span class="font-medium text-brand-800">{{ selectedVessel()!.name }}</span>
                            <button (click)="clearSelectedVessel()"
                              class="ml-2 text-brand-400 hover:text-brand-600 transition-colors">
                              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                              </svg>
                            </button>
                          </div>
                        } @else {
                          <input
                            [ngModel]="vesselSearch()"
                            (ngModelChange)="onVesselSearch($event)"
                            placeholder="Search vessel..."
                            class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                          />
                          @if (vesselSearchResults().length) {
                            <div class="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg max-h-48 overflow-y-auto">
                              @for (v of vesselSearchResults(); track v.key) {
                                <button (click)="selectVessel(v)"
                                  class="w-full px-3 py-2 text-left text-sm hover:bg-brand-50 transition-colors flex items-center justify-between">
                                  <span class="font-medium text-gray-900">{{ v.name }}</span>
                                  @if (v.source === 'seasearcher') {
                                    <span class="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Import</span>
                                  } @else if (v.imo) {
                                    <span class="text-xs text-gray-400">IMO {{ v.imo }}</span>
                                  }
                                </button>
                              }
                            </div>
                          }
                        }
                      </div>
                    }

                    <div>
                      <label class="block text-xs font-medium text-gray-500 mb-1">Role</label>
                      <select
                        [ngModel]="vesselForm().role"
                        (ngModelChange)="vesselForm.set({ ...vesselForm(), role: $event })"
                        class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                        @for (grp of roleGroups(); track grp.group) {
                          <optgroup [label]="grp.group">
                            @for (role of grp.roles; track role.key) {
                              <option [ngValue]="role.key">{{ role.label }}</option>
                            }
                          </optgroup>
                        }
                      </select>
                    </div>

                    @if (!editingVesselAssocId() && selectedVessel() && selectedVesselRoleExists()) {
                      <div class="text-[11px] text-amber-600">This vessel already has that role.</div>
                    }

                    <div>
                      <label class="block text-xs font-medium text-gray-500 mb-1">Contact Person</label>
                      @if (contactsLoading()) {
                        <div class="text-xs text-gray-400 py-1">Loading contacts...</div>
                      } @else if (contacts().length) {
                        <select
                          [ngModel]="vesselForm().contactId"
                          (ngModelChange)="vesselForm.set({ ...vesselForm(), contactId: $event || null })"
                          class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                          <option [ngValue]="null">— None —</option>
                          @for (ct of contacts(); track ct.id) {
                            <option [ngValue]="ct.id">{{ ct.name }}@if (ct.role) { ({{ ct.role }}) }</option>
                          }
                        </select>
                      } @else {
                        <div class="text-xs text-gray-400 py-1">No contacts on file</div>
                      }
                    </div>

                    <textarea
                      [ngModel]="vesselForm().note"
                      (ngModelChange)="vesselForm.set({ ...vesselForm(), note: $event })"
                      placeholder="Notes"
                      rows="2"
                      class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    ></textarea>
                    <div class="flex justify-end gap-2">
                      <button (click)="cancelVesselForm()"
                        class="rounded-md border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                        Cancel
                      </button>
                      <button (click)="saveCompanyVessel()"
                        [disabled]="savingVessel() || (!editingVesselAssocId() && !selectedVessel())"
                        class="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors">
                        {{ editingVesselAssocId() ? 'Update' : 'Add' }}
                      </button>
                    </div>
                  </div>
                </div>
              }

              @if (fleetLoading() || vesselsLoading()) {
                <div class="flex items-center justify-center py-8">
                  <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                </div>
              } @else if ((fleet()?.results?.length || manualFleetRows().length)) {
                <div class="overflow-auto max-h-[500px]">
                  <table class="w-full text-sm">
                    <thead class="sticky top-0 z-10">
                      <tr class="border-b border-gray-100 bg-gray-50">
                        <th class="px-5 py-2 text-left font-medium text-gray-500">Vessel</th>
                        <th class="px-5 py-2 text-left font-medium text-gray-500">Type</th>
                        <th class="px-5 py-2 text-left font-medium text-gray-500">Flag</th>
                        <th class="px-5 py-2 text-right font-medium text-gray-500">DWT</th>
                        <th class="px-5 py-2 text-right font-medium text-gray-500">GT</th>
                        <th class="px-5 py-2 text-left font-medium text-gray-500">Built</th>
                        <th class="px-5 py-2 text-left font-medium text-gray-500">Destination</th>
                        <th class="px-5 py-2 text-left font-medium text-gray-500">Status</th>
                        <th class="px-5 py-2 text-left font-medium text-gray-500">Link</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-50">
                      @if (fleet()?.results?.length) {
                        @for (v of fleet()!.results; track v.id) {
                          <tr class="hover:bg-gray-50/50 transition-colors">
                            <td class="px-5 py-2.5">
                              <button
                                (click)="navigateToVessel(v.id); $event.stopPropagation()"
                                [disabled]="navigatingVesselId() === v.id"
                                class="font-medium text-brand-600 hover:text-brand-800 hover:underline text-left disabled:opacity-50"
                              >
                                @if (navigatingVesselId() === v.id) {
                                  <svg class="inline h-3 w-3 animate-spin mr-0.5" viewBox="0 0 24 24" fill="none">
                                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                  </svg>
                                }
                                {{ v.name }}
                              </button>
                              <span class="ml-1 text-xs text-gray-400">{{ v.imo }}</span>
                              @if (v.hasSanctions) {
                                <span class="ml-1 text-xs text-red-600">⚠️</span>
                              }
                              @if (fleetLinkedRoles(v).length) {
                                <div class="mt-1 flex flex-wrap gap-1">
                                  @for (role of fleetLinkedRoles(v); track role) {
                                    <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">{{ formatRole(role) }}</span>
                                  }
                                </div>
                              }
                            </td>
                            <td class="px-5 py-2.5 text-gray-600 capitalize">{{ v.type || '—' }}</td>
                            <td class="px-5 py-2.5 text-gray-600">{{ v.flag?.name ?? '—' }}</td>
                            <td class="px-5 py-2.5 text-right text-gray-600 font-mono text-xs">{{ v.deadWeightTonnage ? v.deadWeightTonnage.toLocaleString() : '—' }}</td>
                            <td class="px-5 py-2.5 text-right text-gray-600 font-mono text-xs">{{ v.grossTonnage ? v.grossTonnage.toLocaleString() : '—' }}</td>
                            <td class="px-5 py-2.5 text-gray-600">{{ v.buildYear ?? '—' }}</td>
                            <td class="px-5 py-2.5 text-gray-600">
                              @if (v.destination?.place) {
                                {{ v.destination!.place!.name }}
                              } @else {
                                —
                              }
                            </td>
                            <td class="px-5 py-2.5">
                              <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                                [class]="v.status === 'Live' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'">
                                {{ v.status }}
                              </span>
                            </td>
                            <td class="px-5 py-2.5">
                              <div class="flex items-center gap-2">
                                @if (isFleetAutoMatch(v)) {
                                  <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">Registered Owner</span>
                                  <span class="ml-2 inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">Auto</span>
                                } @else {
                                  <select
                                    [ngModel]="fleetRoleFor(v)"
                                    (ngModelChange)="onFleetRoleChange(v, $event)"
                                    class="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                                    @for (grp of roleGroups(); track grp.group) {
                                      <optgroup [label]="grp.group">
                                        @for (role of grp.roles; track role.key) {
                                          <option [ngValue]="role.key">{{ role.label }}</option>
                                        }
                                      </optgroup>
                                    }
                                  </select>
                                  <span class="text-[11px] text-gray-400">
                                    @if (linkingFleetKey() === fleetRowKey(v)) {
                                      Linking…
                                    } @else {
                                      {{ fleetLinkLabel(v) }}
                                    }
                                  </span>
                                }
                              </div>
                            </td>
                          </tr>
                        }
                      }
                      @for (vc of manualFleetRows(); track vc.id) {
                        <tr class="hover:bg-gray-50/50 transition-colors">
                          <td class="px-5 py-2.5">
                            <a [routerLink]="['/vessels', vc.vesselId]" class="font-medium text-brand-700 hover:text-brand-900 hover:underline">
                              {{ vc.vesselName ?? 'Unknown vessel' }}
                            </a>
                            @if (vc.vesselImo) {
                              <span class="ml-1 text-xs text-gray-400">{{ vc.vesselImo }}</span>
                            }
                            <div class="mt-1 flex flex-wrap gap-1">
                              <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">{{ formatRole(vc.role) }}</span>
                              <span class="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">Manual</span>
                            </div>
                          </td>
                          <td class="px-5 py-2.5 text-gray-600">—</td>
                          <td class="px-5 py-2.5 text-gray-600">—</td>
                          <td class="px-5 py-2.5 text-right text-gray-600 font-mono text-xs">—</td>
                          <td class="px-5 py-2.5 text-right text-gray-600 font-mono text-xs">—</td>
                          <td class="px-5 py-2.5 text-gray-600">—</td>
                          <td class="px-5 py-2.5 text-gray-600">—</td>
                          <td class="px-5 py-2.5">
                            <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">Manual</span>
                          </td>
                          <td class="px-5 py-2.5">
                            <div class="flex items-center gap-1">
                              <button (click)="openEditVessel(vc)"
                                class="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Edit">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                </svg>
                              </button>
                              <button (click)="confirmDeleteVesselAssoc.set({ vesselId: vc.vesselId, assocId: vc.id, vesselName: vc.vesselName, role: vc.role })"
                                class="rounded p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete Association">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                  <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              } @else {
                <div class="px-5 py-6 text-center text-sm text-gray-400">No vessels added yet</div>
              }
            </div>
          </div>

          <!-- Right column — Enrichment from Seasearcher -->
          <div class="contents">
            <!-- Comments -->
            <app-comments-card entityType="company" [entityId]="company()!.id" class="block min-[900px]:order-4" />

            @if (enrichmentLoading()) {
              <div class="rounded-xl border border-gray-200 bg-white shadow-sm p-6 flex items-center justify-center min-[900px]:order-2">
                <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              </div>
            } @else if (enrichment()) {


              <!-- Fleet Stats & Company Roles -->
              @if (enrichment()!.companyFleetStats || company()!.companyRoles?.length) {
                <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:order-6 flex flex-col overflow-hidden">
                  <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                    <h2 class="text-sm font-semibold text-gray-700">Fleet & Roles</h2>
                    <div class="flex gap-1">
                      <button
                        type="button"
                        class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                        [class]="fleetRolesTab() === 'fleet' ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-gray-600'"
                        (click)="fleetRolesTab.set('fleet')"
                      >
                        Fleet Statistics
                      </button>
                      <button
                        type="button"
                        class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                        [class]="fleetRolesTab() === 'roles' ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-gray-600'"
                        (click)="fleetRolesTab.set('roles')"
                      >
                        Company Roles
                      </button>
                    </div>
                  </div>
                  <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3 text-sm">
                    @if (fleetRolesTab() === 'fleet') {
                      @if (enrichment()!.companyFleetStats) {
                        <div class="space-y-3">
                          <div class="flex justify-between">
                            <span class="text-gray-500">Total Fleet</span>
                            <span class="font-medium text-gray-900">{{ enrichment()!.companyFleetStats!.totalFleetSize }} vessels</span>
                          </div>
                          <div class="flex justify-between">
                            <span class="text-gray-500">Most Common Type</span>
                            <span class="font-medium text-gray-900">{{ enrichment()!.companyFleetStats!.mostFrequentVesselType }}</span>
                          </div>
                          @if (enrichment()!.companyFleetStats!.fleetStatsBreakdown.length) {
                            <div class="pt-2 border-t border-gray-100">
                              <span class="text-xs font-medium text-gray-500 uppercase tracking-wide">Breakdown</span>
                              <div class="mt-2 space-y-2">
                                @for (stat of enrichment()!.companyFleetStats!.fleetStatsBreakdown; track stat.key) {
                                  <div class="flex justify-between text-xs">
                                    <span class="text-gray-600">{{ stat.key }}</span>
                                    <span class="text-gray-900 font-medium">{{ stat.vesselCount }}</span>
                                  </div>
                                }
                              </div>
                            </div>
                          }
                        </div>
                      } @else {
                        <div class="text-xs text-gray-500 text-center">Fleet statistics unavailable</div>
                      }
                    } @else {
                      @if (company()!.companyRoles?.length) {
                        <div class="flex flex-wrap gap-2">
                          @for (role of company()!.companyRoles!; track role) {
                            <span class="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
                              {{ role }}
                            </span>
                          }
                        </div>
                      } @else {
                        <div class="text-xs text-gray-500 text-center">Company roles unavailable</div>
                      }
                    }
                  </div>
                </div>
              }

              <!-- Registration + Ownership -->
              <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:order-8 flex flex-col overflow-hidden">
                <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                  <h2 class="text-sm font-semibold text-gray-700">Registration & Ownership</h2>
                  <div class="flex gap-1">
                    <button
                      type="button"
                      class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                      [class]="registrationTab() === 'registration' ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-gray-600'"
                      (click)="registrationTab.set('registration')"
                    >
                      Registration
                    </button>
                    <button
                      type="button"
                      class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                      [class]="registrationTab() === 'ownership' ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-gray-600'"
                      (click)="registrationTab.set('ownership')"
                    >
                      Ownership Structure
                    </button>
                  </div>
                </div>
                <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3 text-sm">
                  @if (registrationTab() === 'registration') {
                    @if (enrichment()!.companyRegistration) {
                      <div class="space-y-2">
                        @if (enrichment()!.companyRegistration!.localName) {
                          <div class="flex justify-between">
                            <span class="text-gray-500">Local Name</span>
                            <span class="font-medium text-gray-900">{{ enrichment()!.companyRegistration!.localName }}</span>
                          </div>
                        }
                        @if (enrichment()!.companyRegistration!.registryName) {
                          <div class="flex justify-between">
                            <span class="text-gray-500">Registry</span>
                            <span class="font-medium text-gray-900">{{ enrichment()!.companyRegistration!.registryName }}</span>
                          </div>
                        }
                        @if (enrichment()!.companyRegistration!.incorporationDate) {
                          <div class="flex justify-between">
                            <span class="text-gray-500">Incorporated</span>
                            <span class="font-medium text-gray-900">{{ enrichment()!.companyRegistration!.incorporationDate | date:'mediumDate' }}</span>
                          </div>
                        }
                        @for (reg of enrichment()!.companyRegistration!.registrationNumbers; track $index) {
                          @if (reg.value) {
                            <div class="flex justify-between">
                              <span class="text-gray-500">{{ reg.typeDescription ?? 'Reg #' }}</span>
                              <span class="font-medium text-gray-900 font-mono text-xs">{{ reg.value }}</span>
                            </div>
                          }
                        }
                      </div>
                    } @else {
                      <div class="text-xs text-gray-500 text-center">Registration data unavailable</div>
                    }
                  } @else {
                    @if (hierarchy()) {
                      <div class="p-5 max-h-[500px] overflow-y-auto">
                        @if (flatHierarchy().length) {
                          <div class="space-y-1">
                            @for (node of flatHierarchy(); track $index) {
                              <div class="flex items-center gap-2 text-sm" [style.padding-left.px]="(node.level - 1) * 20">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-gray-300 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                  @if (node.level === 1) {
                                    <path fill-rule="evenodd" d="M4.083 9h1.946c.089-1.546.383-2.97.837-4.118A6.004 6.004 0 004.083 9zM10 2a8 8 0 100 16 8 8 0 000-16zm0 2c-.076 0-.232.032-.465.262-.238.234-.497.623-.737 1.182-.389.907-.673 2.142-.766 3.556h3.936c-.093-1.414-.377-2.649-.766-3.556-.24-.56-.5-.948-.737-1.182C10.232 4.032 10.076 4 10 4zm3.971 5c-.089-1.546-.383-2.97-.837-4.118A6.004 6.004 0 0115.917 9h-1.946zm-2.003 2H8.032c.093 1.414.377 2.649.766 3.556.24.56.5.948.737 1.182.233.23.389.262.465.262.076 0 .232-.032.465-.262.238-.234.497-.623.737-1.182.389-.907.673-2.142.766-3.556zm1.166 4.118c.454-1.147.748-2.572.837-4.118h1.946a6.004 6.004 0 01-2.783 4.118zm-6.268 0C6.412 13.97 6.118 12.546 6.029 11H4.083a6.004 6.004 0 002.783 4.118z" clip-rule="evenodd" />
                                  } @else {
                                    <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clip-rule="evenodd" />
                                  }
                                </svg>
                                @if (node.companyId === company()!.seasearcherId) {
                                  <span class="font-medium text-brand-600">{{ node.companyName }}</span>
                                } @else {
                                  <button
                                    (click)="navigateToCompany(node.companyId)"
                                    [disabled]="navigatingCompanyId() === node.companyId"
                                    class="font-medium text-gray-900 hover:text-brand-600 hover:underline text-left disabled:opacity-50"
                                  >
                                    @if (navigatingCompanyId() === node.companyId) {
                                      <svg class="inline h-3 w-3 animate-spin mr-0.5" viewBox="0 0 24 24" fill="none">
                                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                      </svg>
                                    }
                                    {{ node.companyName }}
                                  </button>
                                }
                                @if (node.isSanctioned) {
                                  <span class="text-xs text-red-600">⚠️</span>
                                }
                                @if (!node.active) {
                                  <span class="text-xs text-gray-400">(inactive)</span>
                                }
                                <span class="text-xs text-gray-400 ml-auto">
                                  {{ hierarchyRoles(node) }}
                                </span>
                              </div>
                            }
                          </div>
                        } @else {
                          <p class="text-sm text-gray-400 text-center">No hierarchy data</p>
                        }
                      </div>
                    } @else {
                      <div class="text-xs text-gray-500 text-center">Ownership data unavailable</div>
                    }
                  }
                </div>
              </div>

              <!-- Offices -->
              @if (enrichment()!.offices.length > 1) {
                <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:order-10">
                  <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                    <h2 class="text-sm font-semibold text-gray-700">Offices</h2>
                    <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                      {{ enrichment()!.offices.length }}
                    </span>
                  </div>
                  <div class="divide-y divide-gray-50">
                    @for (office of enrichment()!.offices; track office.officeId) {
                      <div class="px-5 py-3 text-sm">
                        <span class="font-medium text-gray-900">{{ office.town }}</span>
                        <span class="text-gray-400 ml-1">{{ office.country }}</span>
                        @if (office.addressLine1) {
                          <p class="text-xs text-gray-500 mt-0.5">{{ office.addressLine1 }}</p>
                        }
                      </div>
                    }
                  </div>
                </div>
              }

              <!-- Name History -->
              @if (enrichment()!.companyNameHistory.length) {
                <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:order-12">
                  <div class="border-b border-gray-100 px-5 py-3">
                    <h2 class="text-sm font-semibold text-gray-700">Name History</h2>
                  </div>
                  <div class="divide-y divide-gray-50">
                    @for (entry of enrichment()!.companyNameHistory; track $index) {
                      <div class="px-5 py-2.5 flex justify-between text-sm">
                        <span class="text-gray-900">{{ entry.name }}</span>
                        <span class="text-xs text-gray-400">{{ entry.fromDate | date:'mediumDate' }}</span>
                      </div>
                    }
                  </div>
                </div>
              }

              <!-- Counterparty Risk + Sanctions + Seizures -->
              <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:order-2 flex flex-col overflow-hidden">
                <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                  <h2 class="text-sm font-semibold text-gray-700">Risk & Compliance</h2>
                  <div class="flex gap-1">
                    @if (enrichment()!.counterpartyRiskReportMetadata) {
                      <button
                        type="button"
                        class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                        [class]="sanctionsTab() === 'risk' ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-gray-600'"
                        (click)="sanctionsTab.set('risk')"
                      >
                        Counterparty Risk
                      </button>
                    }
                    <button
                      type="button"
                      class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                      [class]="sanctionsTab() === 'sanctions' ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-gray-600'"
                      (click)="sanctionsTab.set('sanctions')"
                    >
                      Sanctions
                    </button>
                    <button
                      type="button"
                      class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                      [class]="sanctionsTab() === 'seizures' ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-gray-600'"
                      (click)="sanctionsTab.set('seizures')"
                    >
                      Seizures / Arrests
                    </button>
                  </div>
                </div>
                <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3 text-sm">
                  @if (sanctionsTab() === 'risk') {
                    @if (enrichment()!.counterpartyRiskReportMetadata) {
                      <div class="space-y-3">
                        <div class="flex justify-between">
                          <span class="text-gray-500">Overall Rating</span>
                          <span class="font-medium text-gray-900">{{ enrichment()!.counterpartyRiskReportMetadata!.overallRating?.text ?? '—' }}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-gray-500">Overall Performance</span>
                          <span class="font-medium text-gray-900">{{ enrichment()!.counterpartyRiskReportMetadata!.overallPerformance?.text ?? '—' }}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-gray-500">Payment Performance</span>
                          <span class="font-medium text-gray-900">{{ enrichment()!.counterpartyRiskReportMetadata!.paymentPerformance?.text ?? '—' }}</span>
                        </div>
                        @if (enrichment()!.counterpartyRiskReportMetadata!.creditOpinion) {
                          <div>
                            <span class="text-gray-500">Credit Opinion</span>
                            <p class="mt-1 text-gray-700">{{ enrichment()!.counterpartyRiskReportMetadata!.creditOpinion }}</p>
                          </div>
                        }
                        <div class="text-xs text-gray-400">
                          Rated {{ enrichment()!.counterpartyRiskReportMetadata!.ratingDate | date:'mediumDate' }}
                        </div>
                        <a
                          [href]="'https://www.seasearcher.com/company/' + company()!.seasearcherId + '/counterparty-risk-report'"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-brand-600" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                            <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                          </svg>
                          View Full Report
                        </a>
                      </div>
                    }
                  } @else if (sanctionsTab() === 'sanctions') {
                    @if (sanctionsLoading()) {
                      <div class="flex items-center justify-center py-6">
                        <svg class="h-4 w-4 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                      </div>
                    } @else if (sanctions()?.length) {
                      <div class="divide-y divide-gray-50">
                        @for (s of sanctions()!; track $index) {
                          <div class="px-5 py-3 text-sm">
                            <div class="flex items-center gap-2">
                              <span class="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                                {{ s.sanctionSource ?? s.source ?? 'Sanction' }}
                              </span>
                              @if (s.listedDate ?? s.startDate) {
                                <span class="text-xs text-gray-400">{{ (s.listedDate ?? s.startDate) | date:'mediumDate' }}</span>
                              }
                            </div>
                            @if (s.sanctionType ?? s.type ?? s.description) {
                              <p class="mt-1 text-xs text-gray-600">{{ s.sanctionType ?? s.type ?? s.description }}</p>
                            }
                          </div>
                        }
                      </div>
                    } @else {
                      <div class="px-5 py-5 text-center">
                        <span class="inline-flex items-center rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
                          No sanctions on record
                        </span>
                      </div>
                    }
                  } @else {
                    @if (seizuresLoading()) {
                      <div class="flex items-center justify-center py-6">
                        <svg class="h-4 w-4 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                      </div>
                    } @else if (seizures()?.results?.length) {
                      <div class="divide-y divide-gray-50">
                        @for (s of seizures()!.results; track $index) {
                          <div class="px-5 py-3 text-sm">
                            <div class="flex items-center justify-between">
                              <span class="font-medium text-gray-900">{{ s.vesselName ?? s.name ?? 'Unknown vessel' }}</span>
                              @if (s.imo) {
                                <span class="text-xs text-gray-400 font-mono">{{ s.imo }}</span>
                              }
                            </div>
                            <div class="flex items-center gap-2 mt-1 text-xs text-gray-500">
                              @if (s.port ?? s.location) {
                                <span>{{ s.port ?? s.location }}</span>
                              }
                              @if (s.seizureDate ?? s.date) {
                                <span>&middot; {{ (s.seizureDate ?? s.date) | date:'mediumDate' }}</span>
                              }
                              @if (s.releaseDate) {
                                <span>&middot; Released {{ s.releaseDate | date:'mediumDate' }}</span>
                              }
                            </div>
                          </div>
                        }
                      </div>
                    } @else {
                      <div class="px-5 py-5 text-center">
                        <span class="inline-flex items-center rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
                          No seizures on record
                        </span>
                      </div>
                    }
                  }
                </div>
              </div>

            } @else if (company()!.seasearcherId) {
              <div class="rounded-xl border border-gray-200 bg-white shadow-sm p-5 text-center min-[900px]:order-2">
                <p class="text-sm text-gray-400">Enrichment data unavailable</p>
              </div>
            } @else {
              <div class="rounded-xl border border-gray-200 bg-white shadow-sm p-5 text-center min-[900px]:order-2">
                <p class="text-sm text-gray-400">Manually created — no enrichment data</p>
                <p class="text-xs text-gray-300 mt-1">Import from Seasearcher to get detailed company data</p>
              </div>
            }
          </div>
        </div>

        <!-- Activity History -->
        <div class="mt-6">
          <app-activity-timeline entityType="company" [entityId]="company()!.id" />
        </div>


      } @else {
        <div class="text-center py-20 text-gray-400">Company not found</div>
      }

      <!-- Delete confirmation modal -->
      @if (confirmDeleteOpen() && canDeleteEntity()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="confirmDeleteOpen.set(false)">
          <div class="rounded-xl bg-white p-6 shadow-xl max-w-sm mx-4" (click)="$event.stopPropagation()">
            <h3 class="text-lg font-semibold text-gray-900">Delete company?</h3>
            <p class="mt-2 text-sm text-gray-500">
              Are you sure you want to delete <strong>{{ company()!.name }}</strong>?
              This cannot be undone.
            </p>
            @if (deleteError()) {
              <p class="mt-2 text-sm text-red-600">{{ deleteError() }}</p>
            }
            <div class="mt-4 flex justify-end gap-2">
              <button
                (click)="confirmDeleteOpen.set(false)"
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

      @if (toast()) {
        <div
          class="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg transition-all"
          [class]="toast()!.type === 'success'
            ? 'border-green-200 bg-green-50 text-green-800'
            : 'border-red-200 bg-red-50 text-red-800'"
        >
          @if (toast()!.type === 'success') {
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd" />
            </svg>
          } @else {
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd" />
            </svg>
          }
          {{ toast()!.message }}
        </div>
      }
    </div>
  `,
})
export class CompanyDetailPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly pageTitle = inject(Title);
  private readonly wsService = inject(WebSocketService);
  private readonly authService = inject(AuthService);

  // ─── State ──────────────────────────────────────────────────────────
  readonly loading = signal(true);
  readonly canDeleteEntity = computed(() => this.authService.isAdmin());
  readonly company = signal<CounterpartyDto | null>(null);
  readonly enrichment = signal<CompanyEnrichment | null>(null);
  readonly enrichmentLoading = signal(false);
  readonly companyOrders = signal<CompanyOrder[]>([]);
  readonly ordersLoading = signal(false);
  readonly syncing = signal(false);
  readonly confirmDeleteOpen = signal(false);
  readonly confirmDeleteVesselAssoc = signal<{ vesselId?: string | null; assocId: string; vesselName?: string | null; role?: string } | null>(null);
  readonly deleting = signal(false);
  readonly deleteError = signal('');
  readonly typeSaving = signal(false);
  readonly teamUsers = signal<UserOption[]>([]);
  readonly responsibleUserId = signal<string | null>(null);
  readonly savingResponsible = signal(false);
  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);

  // Company Vessels
  readonly companyVessels = signal<VesselCompanyDto[]>([]);
  readonly vesselsLoading = signal(false);
  readonly showAddVessel = signal(false);
  readonly vesselForm = signal<{ vesselId: string; role: VesselCompanyRole; contactId: string | null; note: string }>({ vesselId: '', role: 'REGISTERED_OWNER', contactId: null, note: '' });
  readonly editingVesselAssocId = signal<string | null>(null);
  readonly savingVessel = signal(false);
  readonly vesselSearch = signal('');
  readonly vesselSearchResults = signal<VesselSearchResultOption[]>([]);
  readonly selectedVessel = signal<{ id: string; name: string } | null>(null);
  private vesselSearchTimeout: ReturnType<typeof setTimeout> | null = null;
  readonly roleOptions = signal<VesselCompanyRoleOption[]>([
    { key: 'REGISTERED_OWNER', label: 'Registered Owner', group: 'Legal & Financial' },
    { key: 'NOMINAL_OWNER', label: 'Nominal Owner', group: 'Legal & Financial' },
    { key: 'BENEFICIAL_OWNER', label: 'Beneficial Owner', group: 'Legal & Financial' },
    { key: 'GROUP_BENEFICIAL_OWNER', label: 'Group Beneficial Owner', group: 'Legal & Financial' },
    { key: 'COMMERCIAL_OPERATOR', label: 'Commercial Operator', group: 'Operational & Commercial' },
    { key: 'THIRD_PARTY_OPERATOR', label: 'Third-Party Operator', group: 'Operational & Commercial' },
    { key: 'DISPONENT_OWNER', label: 'Disponent Owner', group: 'Operational & Commercial' },
    { key: 'BAREBOAT_CHARTERER', label: 'Bareboat Charterer', group: 'Operational & Commercial' },
    { key: 'TECHNICAL_MANAGER', label: 'Technical Manager', group: 'Technical & Safety' },
    { key: 'ISM_MANAGER', label: 'ISM Manager', group: 'Technical & Safety' },
    { key: 'SHIP_MANAGER', label: 'Ship Manager', group: 'Technical & Safety' },
  ]);

  readonly roleGroups = computed(() => {
    const opts = this.roleOptions();
    const groups = new Map<string, VesselCompanyRoleOption[]>();
    for (const opt of opts) {
      const g = opt.group || 'Other';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(opt);
    }
    return [...groups.entries()].map(([group, roles]) => ({ group, roles }));
  });

  readonly allTypes = ALL_TYPES;

  // Inline editing state
  readonly editing = signal(false);
  readonly editSaving = signal(false);
  readonly editName = signal('');
  readonly editCountry = signal('');
  readonly editCountryIso = signal('');

  // Country typeahead
  readonly countrySearchQuery = signal('');
  readonly showCountryDropdown = signal(false);
  readonly filteredCountries = computed(() => {
    const q = this.countrySearchQuery().toLowerCase().trim();
    if (!q) return COUNTRIES.slice(0, 20);
    return COUNTRIES.filter(c =>
      c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    ).slice(0, 20);
  });
  // New data signals
  readonly fleet = signal<FleetResponse | null>(null);
  readonly fleetLoading = signal(false);
  readonly fleetMatchBySeasearcherId = signal<Record<string, VesselDto>>({});
  readonly fleetMatchByImo = signal<Record<string, VesselDto>>({});
  readonly fleetRoleSelections = signal<Record<string, VesselCompanyRole>>({});
  readonly linkingFleetKey = signal<string | null>(null);
  readonly hierarchy = signal<HierarchyResponse | null>(null);
  readonly seizures = signal<SeizuresResponse | null>(null);
  readonly seizuresLoading = signal(false);
  readonly sanctions = signal<any[] | null>(null);
  readonly sanctionsLoading = signal(false);
  readonly registrationTab = signal<'registration' | 'ownership'>('registration');
  readonly sanctionsTab = signal<'risk' | 'sanctions' | 'seizures'>('risk');
  readonly companyInfoTab = signal<'info' | 'headOffice'>('info');
  readonly fleetRolesTab = signal<'fleet' | 'roles'>('fleet');

  // Contacts
  readonly contacts = signal<CompanyContactDto[]>([]);
  readonly contactsLoading = signal(false);
  readonly showContactModal = signal(false);
  readonly editingContactId = signal<string | null>(null);
  readonly contactForm = signal({ name: '', role: '', phone: '', fax: '', email: '', notes: '' });
  readonly contactSaving = signal(false);
  readonly contactError = signal('');
  readonly deleteContactTarget = signal<CompanyContactDto | null>(null);

  // Supply ports
  readonly supplyPorts = signal<SupplyPortDto[]>([]);
  readonly supplyPortsLoading = signal(false);

  // Company Emails
  readonly companyEmails = signal<CompanyEmailDto[]>([]);
  readonly emailsLoading = signal(false);
  readonly showAddEmail = signal(false);
  readonly emailForm = signal<{ emailType: CompanyEmailType; email: string; label: string; isPrimary: boolean }>({ emailType: 'general', email: '', label: '', isPrimary: false });
  readonly editingEmailId = signal<string | null>(null);
  readonly savingEmail = signal(false);
  readonly emailTypeOptions: CompanyEmailType[] = ['sales', 'invoice', 'inquiry', 'general'];

  // Fleet map
  readonly fleetMapEl = viewChild<ElementRef<HTMLDivElement>>('fleetMapEl');
  private fleetMap: L.Map | null = null;
  private fleetMapInitialized = false;
  private routeSub: Subscription | null = null;
  private syncSub: Subscription | null = null;
  private vesselLayer: L.LayerGroup | null = null;
  readonly fleetMapFullscreen = signal(false);

  // Navigation
  readonly navigatingCompanyId = signal<string | null>(null);
  readonly navigatingVesselId = signal<string | null>(null);

  readonly fleetVesselsWithPosition = computed(() => {
    const f = this.fleet();
    if (!f?.results) return [];
    return f.results.filter(v => v.latestInformation?.position?.lat && v.latestInformation?.position?.lng);
  });

  readonly manualFleetRows = computed(() => {
    const fleetResults = this.fleet()?.results ?? [];
    const matchedIds = new Set(
      fleetResults
        .map((v) => this.fleetLocalMatch(v)?.id)
        .filter((id): id is string => Boolean(id)),
    );
    return this.companyVessels().filter((vc) => !matchedIds.has(vc.vesselId));
  });

  constructor() {
    effect(() => {
      const el = this.fleetMapEl();
      const vessels = this.fleetVesselsWithPosition();
      if (!this.fleetMapInitialized && vessels.length && el) {
        this.fleetMapInitialized = true;
        setTimeout(() => this.initFleetMap(), 50);
      }
    });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.loadUsers();
    this.loadRoleOptions();
    if (id) this.loadCompany(id);

    // React to same-route navigation (e.g. clicking related company links)
    this.routeSub = this.route.paramMap.pipe(skip(1)).subscribe((params) => {
      const newId = params.get('id');
      if (newId) {
        this.resetState();
        this.loadCompany(newId);
      }
    });

    // Listen for auto-sync results pushed from the backend
    this.syncSub = this.wsService.on<CounterpartyDto>('company-synced').subscribe((data) => {
      const current = this.company();
      if (current && data.id === current.id) {
        this.company.set(data);
        this.responsibleUserId.set(data.responsibleUserId ?? null);
        this.syncing.set(false);
        // Refresh enrichment & contacts after sync
        if (data.seasearcherId) {
          this.loadEnrichment(data.seasearcherId);
        }
        this.loadContacts(data.id);
      }
    });
  }

  ngOnDestroy(): void {
    if (this.fleetMap) {
      this.fleetMap.remove();
      this.fleetMap = null;
    }
    this.routeSub?.unsubscribe();
    this.syncSub?.unsubscribe();
  }

  private resetState(): void {
    if (this.fleetMap) {
      this.fleetMap.remove();
      this.fleetMap = null;
    }
    this.fleetMapInitialized = false;
    this.company.set(null);
    this.enrichment.set(null);
    this.loading.set(true);
    this.companyOrders.set([]);
    this.companyVessels.set([]);
    this.fleet.set(null);
    this.fleetMatchBySeasearcherId.set({});
    this.fleetMatchByImo.set({});
    this.fleetRoleSelections.set({});
    this.linkingFleetKey.set(null);
    this.hierarchy.set(null);
    this.seizures.set(null);
    this.sanctions.set(null);
    this.contacts.set([]);
    this.editing.set(false);
    this.showAddVessel.set(false);
    this.editingVesselAssocId.set(null);
    this.selectedVessel.set(null);
    this.vesselSearch.set('');
    this.vesselSearchResults.set([]);
    this.companyInfoTab.set('info');
    this.fleetRolesTab.set('fleet');
  }

  // ─── Data Loading ──────────────────────────────────────────────────
  async loadCompany(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CounterpartyDto>>(`${API}/companies/local/${id}`),
      );
      if (res.success && res.data) {
        this.company.set(res.data);
        this.responsibleUserId.set(res.data.responsibleUserId ?? null);
        this.pageTitle.setTitle(`Fueld | Companies > ${res.data.name}`);
        this.wsService.sendPresence(this.router.url, this.pageTitle.getTitle());
        // Load orders & enrichment in parallel
        this.loadOrders(id);
        this.loadCompanyVessels(id);
        this.loadContacts(id);
        this.loadSupplyPorts(id);
        this.loadCompanyEmails(id);
        if (res.data.seasearcherId) {
          // Show syncing indicator — backend auto-syncs via WS presence
          this.syncing.set(true);
          this.loadEnrichment(res.data.seasearcherId);
          this.loadFleet(res.data.seasearcherId);
          this.loadHierarchy(res.data.seasearcherId);
          this.loadSeizures(res.data.seasearcherId);
          this.loadSanctions(res.data.seasearcherId);
        }
      }
    } catch (err) {
      console.error('Failed to load company:', err);
    } finally {
      this.loading.set(false);
    }
  }

  async loadOrders(companyId: string): Promise<void> {
    this.ordersLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CompanyOrder[]>>(`${API}/companies/local/${companyId}/orders`),
      );
      if (res.success && res.data) {
        this.companyOrders.set(res.data);
      }
    } catch {
      // ignore
    } finally {
      this.ordersLoading.set(false);
    }
  }

  // ─── Company Vessels ─────────────────────────────────────────────
  private async loadCompanyVessels(companyId: string): Promise<void> {
    this.vesselsLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<VesselCompanyDto[]>>(`${API}/companies/local/${companyId}/vessels`),
      );
      if (res.success && res.data) {
        this.companyVessels.set(res.data);
      }
    } catch (err) {
      console.error('Failed to load company vessels:', err);
    } finally {
      this.vesselsLoading.set(false);
    }
  }

  openAddVessel(): void {
    this.vesselForm.set({ vesselId: '', role: 'REGISTERED_OWNER', contactId: null, note: '' });
    this.editingVesselAssocId.set(null);
    this.selectedVessel.set(null);
    this.vesselSearch.set('');
    this.vesselSearchResults.set([]);
    this.showAddVessel.set(true);
  }

  openEditVessel(vc: VesselCompanyDto): void {
    this.vesselForm.set({ vesselId: vc.vesselId, role: vc.role, contactId: vc.contactId ?? null, note: vc.note ?? '' });
    this.editingVesselAssocId.set(vc.id);
    this.selectedVessel.set(null);
    this.vesselSearch.set('');
    this.vesselSearchResults.set([]);
    this.showAddVessel.set(true);
  }

  cancelVesselForm(): void {
    this.showAddVessel.set(false);
    this.editingVesselAssocId.set(null);
    this.selectedVessel.set(null);
    this.vesselSearch.set('');
    this.vesselSearchResults.set([]);
  }

  onVesselSearch(term: string): void {
    this.vesselSearch.set(term);
    if (this.vesselSearchTimeout) clearTimeout(this.vesselSearchTimeout);
    if (term.length < 2) {
      this.vesselSearchResults.set([]);
      return;
    }
    this.vesselSearchTimeout = setTimeout(async () => {
      try {
        const res = await firstValueFrom(
          this.http.get<ApiResponse<{ vessels: VesselDto[]; total: number }>>(
            `${API}/vessels/local?search=${encodeURIComponent(term)}&limit=15`,
          ),
        );
        const localResults = res.success && res.data ? res.data.vessels : [];

        if (localResults.length) {
          this.vesselSearchResults.set(
            localResults.map((v) => ({
              key: v.id,
              source: 'local',
              id: v.id,
              name: v.name,
              imo: v.imo ?? undefined,
            })),
          );
          return;
        }

        const importRes = await firstValueFrom(
          this.http.get<ApiResponse<VesselSearchResult[]>>(
            `${API}/vessels/search?term=${encodeURIComponent(term)}`,
          ),
        );
        if (importRes.success && importRes.data) {
          this.vesselSearchResults.set(
            importRes.data
              .filter((r) => r.source === 'seasearcher' && r.seasearcherId)
              .map((r) => ({
                key: `seasearcher:${r.seasearcherId}`,
                source: 'seasearcher',
                seasearcherId: r.seasearcherId,
                name: r.name,
                imo: r.imo ?? undefined,
              })),
          );
        } else {
          this.vesselSearchResults.set([]);
        }
      } catch {
        this.vesselSearchResults.set([]);
      }
    }, 250);
  }

  async selectVessel(v: VesselSearchResultOption): Promise<void> {
    if (v.source === 'seasearcher' && v.seasearcherId) {
      await this.importVesselFromSeasearcher(v.seasearcherId);
      return;
    }
    if (!v.id) return;
    this.selectedVessel.set({ id: v.id, name: v.name });
    this.vesselForm.set({ ...this.vesselForm(), vesselId: v.id });
    this.vesselSearch.set('');
    this.vesselSearchResults.set([]);
  }

  private async importVesselFromSeasearcher(seasearcherId: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<VesselDto>>(`${API}/vessels/import`, { seasearcherId }),
      );
      if (res.success && res.data) {
        this.selectedVessel.set({ id: res.data.id, name: res.data.name });
        this.vesselForm.set({ ...this.vesselForm(), vesselId: res.data.id });
        this.vesselSearch.set('');
        this.vesselSearchResults.set([]);
      } else {
        console.error('Failed to import vessel:', res.message ?? 'Unknown error');
      }
    } catch {
      console.error('Failed to import vessel.');
    }
  }

  clearSelectedVessel(): void {
    this.selectedVessel.set(null);
    this.vesselForm.set({ ...this.vesselForm(), vesselId: '' });
    this.vesselSearch.set('');
  }

  async saveCompanyVessel(): Promise<void> {
    const c = this.company();
    if (!c) return;
    const form = this.vesselForm();

    this.savingVessel.set(true);
    try {
      const editId = this.editingVesselAssocId();
      if (editId) {
        const res = await firstValueFrom(
          this.http.patch<ApiResponse<VesselCompanyDto>>(`${API}/vessels/local/${form.vesselId}/companies/${editId}`, {
            role: form.role,
            contactId: form.contactId,
            note: form.note.trim() || undefined,
          }),
        );
        if (res && res.success === false) {
          this.showToast('error', res.message ?? 'Failed to update vessel role.');
          return;
        }
        this.showToast('success', 'Updated vessel role.');
      } else {
        if (!form.vesselId) return;
        const replaceExistingRole = this.selectedVesselRoleExists()
          ? window.confirm('This role already exists for this vessel. Replace the existing one?')
          : false;
        if (this.selectedVesselRoleExists() && !replaceExistingRole) {
          this.showToast('error', 'Role already exists for this vessel.');
          return;
        }
        const res = await firstValueFrom(
          this.http.post<ApiResponse<VesselCompanyDto>>(`${API}/vessels/local/${form.vesselId}/companies`, {
            companyId: c.id,
            role: form.role,
            contactId: form.contactId,
            note: form.note.trim() || undefined,
            replaceExistingRole: replaceExistingRole || undefined,
          }),
        );
        if (res && res.success === false) {
          this.showToast('error', res.message ?? 'Failed to add vessel role.');
          return;
        }
        if (replaceExistingRole) {
          this.showToast('success', `Replaced existing ${form.role.toLowerCase()} for vessel`);
        } else {
          this.showToast('success', `Added ${form.role.toLowerCase()} for vessel`);
        }
      }
      this.showAddVessel.set(false);
      this.editingVesselAssocId.set(null);
      this.selectedVessel.set(null);
      this.loadCompanyVessels(c.id);
      if (this.fleet()?.results?.length) {
        this.loadFleetLocalMatches(this.fleet()!.results);
      }
    } catch (err) {
      console.error('Failed to save company vessel:', err);
      this.showToast('error', 'Failed to save vessel role.');
    } finally {
      this.savingVessel.set(false);
    }
  }

  async deleteCompanyVessel(vesselId: string | null | undefined, assocId: string): Promise<void> {
    const c = this.company();
    if (!c) return;
    if (!vesselId) {
      // association references no local vessel — delete by assoc only
      try {
        const res = await firstValueFrom(this.http.delete<ApiResponse<any>>(`${API}/vessels/companies/${assocId}`));
        if (res && res.success) {
          const d = res.data;
          this.showToast('success', `Removed ${d?.role ?? 'association'} — ${d?.companyName ?? 'company'}`);
        }
        this.loadCompanyVessels(c.id);
        if (this.fleet()?.results?.length) {
          this.loadFleetLocalMatches(this.fleet()!.results);
        }
        return;
      } catch (err) {
        console.error('Failed to delete vessel association (assoc-only):', err);
        this.showToast('error', 'Failed to remove vessel association.');
        return;
      }
    }

    try {
      const res = await firstValueFrom(this.http.delete<ApiResponse<any>>(`${API}/vessels/local/${vesselId}/companies/${assocId}`));
      if (res && res.success) {
        const d = res.data;
        this.showToast('success', `Removed ${d?.role ?? 'association'} — ${d?.companyName ?? 'company'}`);
      }
      this.loadCompanyVessels(c.id);
      if (this.fleet()?.results?.length) {
        this.loadFleetLocalMatches(this.fleet()!.results);
      }
    } catch (err) {
      console.error('Failed to delete vessel association:', err);
      this.showToast('error', 'Failed to remove vessel association.');
    }
  }

  async executeDeleteVesselAssoc(): Promise<void> {
    const target = this.confirmDeleteVesselAssoc();
    if (!target) return;
    await this.deleteCompanyVessel(target.vesselId, target.assocId);
    this.confirmDeleteVesselAssoc.set(null);
  }

  async loadEnrichment(seasearcherId: string): Promise<void> {
    this.enrichmentLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CompanyEnrichment>>(`${API}/companies/enrichment/${seasearcherId}`),
      );
      if (res.success && res.data) {
        this.enrichment.set(res.data);
      }
    } catch {
      // ignore — enrichment is optional
    } finally {
      this.enrichmentLoading.set(false);
    }
  }

  async loadFleet(seasearcherId: string): Promise<void> {
    this.fleetLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<FleetResponse>>(`${API}/companies/enrichment/${seasearcherId}/fleet`),
      );
      if (res.success && res.data) {
        this.fleet.set(res.data);
        this.loadFleetLocalMatches(res.data.results);
      }
    } catch {
      // ignore
    } finally {
      this.fleetLoading.set(false);
    }
  }

  private async loadFleetLocalMatches(results: FleetVessel[]): Promise<void> {
    const seasearcherIds = results
      .map((v) => (v.id ? String(v.id) : ''))
      .filter(Boolean);
    const imos = results
      .map((v) => (v.imo ? String(v.imo) : ''))
      .filter(Boolean);

    if (!seasearcherIds.length && !imos.length) {
      this.fleetMatchBySeasearcherId.set({});
      this.fleetMatchByImo.set({});
      return;
    }

    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<VesselDto[]>>(`${API}/vessels/local/match`, {
          seasearcherIds,
          imos,
        }),
      );
      if (res.success && res.data) {
        const bySeasearcherId: Record<string, VesselDto> = {};
        const byImo: Record<string, VesselDto> = {};
        res.data.forEach((v) => {
          if (v.seasearcherId) bySeasearcherId[v.seasearcherId] = v;
          if (v.imo) byImo[v.imo] = v;
        });
        this.fleetMatchBySeasearcherId.set(bySeasearcherId);
        this.fleetMatchByImo.set(byImo);
      } else {
        this.fleetMatchBySeasearcherId.set({});
        this.fleetMatchByImo.set({});
      }
    } catch {
      this.fleetMatchBySeasearcherId.set({});
      this.fleetMatchByImo.set({});
    }
  }

  async loadHierarchy(seasearcherId: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<HierarchyResponse>>(`${API}/companies/enrichment/${seasearcherId}/hierarchy`),
      );
      if (res.success && res.data) {
        this.hierarchy.set(res.data);
      }
    } catch {
      // ignore
    }
  }

  async loadSeizures(seasearcherId: string): Promise<void> {
    this.seizuresLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<SeizuresResponse>>(`${API}/companies/enrichment/${seasearcherId}/seizures`),
      );
      if (res.success && res.data) {
        this.seizures.set(res.data);
      }
    } catch {
      // ignore
    } finally {
      this.seizuresLoading.set(false);
    }
  }

  async loadSanctions(seasearcherId: string): Promise<void> {
    this.sanctionsLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<any[]>>(`${API}/companies/enrichment/${seasearcherId}/sanctions`),
      );
      if (res.success && res.data) {
        this.sanctions.set(res.data);
      }
    } catch {
      // ignore
    } finally {
      this.sanctionsLoading.set(false);
    }
  }

  private showToast(type: 'success' | 'error', message: string): void {
    this.toast.set({ type, message });
    setTimeout(() => this.toast.set(null), 4000);
  }

  // ─── Actions ───────────────────────────────────────────────────────

  toggleFleetMapFullscreen(): void {
    this.fleetMapFullscreen.update(v => !v);
    // Invalidate map size after the DOM transition
    setTimeout(() => {
      if (this.fleetMap) {
        this.fleetMap.invalidateSize();
      }
    }, 50);
  }

  fleetRowKey(v: FleetVessel): string {
    if (v.id) return `sea:${v.id}`;
    if (v.imo) return `imo:${v.imo}`;
    return `name:${v.name}`;
  }

  fleetRoleFor(v: FleetVessel): VesselCompanyRole {
    const key = this.fleetRowKey(v);
    return this.fleetRoleSelections()[key] ?? 'REGISTERED_OWNER';
  }

  isFleetAutoMatch(v: FleetVessel): boolean {
    return Boolean(this.company()?.seasearcherId);
  }

  fleetEffectiveRole(v: FleetVessel): VesselCompanyRole {
    return this.isFleetAutoMatch(v) ? 'REGISTERED_OWNER' : this.fleetRoleFor(v);
  }

  setFleetRoleFor(v: FleetVessel, role: VesselCompanyRole): void {
    const key = this.fleetRowKey(v);
    this.fleetRoleSelections.set({
      ...this.fleetRoleSelections(),
      [key]: role,
    });
  }

  onFleetRoleChange(v: FleetVessel, role: VesselCompanyRole): void {
    const matchedBySeasearcher = v.id && this.fleetMatchBySeasearcherId()[String(v.id)];
    if (matchedBySeasearcher && role !== 'REGISTERED_OWNER') {
      this.showToast('error', 'Auto-matched vessels must be Registered Owner.');
      this.setFleetRoleFor(v, 'REGISTERED_OWNER');
      this.linkFleetVessel(v);
      return;
    }
    this.setFleetRoleFor(v, role);
    this.linkFleetVessel(v);
  }

  fleetLocalMatch(v: FleetVessel): VesselDto | null {
    if (v.id) {
      const bySea = this.fleetMatchBySeasearcherId()[String(v.id)];
      if (bySea) return bySea;
    }
    if (v.imo) {
      const byImo = this.fleetMatchByImo()[String(v.imo)];
      if (byImo) return byImo;
    }
    return null;
  }

  fleetLinkedRoles(v: FleetVessel): VesselCompanyRole[] {
    const match = this.fleetLocalMatch(v);
    if (!match) return [];
    const roles = this.companyVessels()
      .filter((vc) => vc.vesselId === match.id)
      .map((vc) => vc.role);
    return Array.from(new Set(roles));
  }

  fleetRoleExists(v: FleetVessel): boolean {
    const match = this.fleetLocalMatch(v);
    if (!match) return false;
    const role = this.fleetEffectiveRole(v);
    return this.companyVessels().some((vc) => vc.vesselId === match.id && vc.role === role);
  }

  fleetLinkLabel(v: FleetVessel): string {
    const match = this.fleetLocalMatch(v);
    const role = this.fleetEffectiveRole(v);
    if (match && this.companyVessels().some((vc) => vc.vesselId === match.id && vc.role === role)) {
      return this.isFleetAutoMatch(v) ? 'Replace Reg. Owner' : 'Linked';
    }
    if (!match) return 'Import + Link';
    const hasRole = this.companyVessels().some((vc) => vc.vesselId === match.id);
    return hasRole ? 'Add Role' : 'Link';
  }

  async linkFleetVessel(v: FleetVessel): Promise<void> {
    const c = this.company();
    if (!c) return;

    const key = this.fleetRowKey(v);
    const role = this.fleetEffectiveRole(v);
    this.linkingFleetKey.set(key);

    try {
      const shouldReplace = this.isFleetAutoMatch(v) && role === 'REGISTERED_OWNER';
      if (this.fleetRoleExists(v) && !shouldReplace) {
        this.showToast('error', 'Role already exists for this vessel.');
        return;
      }
      let vesselId = this.fleetLocalMatch(v)?.id;

      if (!vesselId) {
        if (!v.id) return;
        const importRes = await firstValueFrom(
          this.http.post<ApiResponse<VesselDto>>(`${API}/vessels/import`, { seasearcherId: String(v.id) }),
        );
        if (!importRes.success || !importRes.data) {
          this.showToast('error', importRes.message ?? 'Failed to import vessel.');
          return;
        }
        vesselId = importRes.data.id;
        this.fleetMatchBySeasearcherId.set({
          ...this.fleetMatchBySeasearcherId(),
          [importRes.data.seasearcherId ?? String(v.id)]: importRes.data,
        });
        if (importRes.data.imo) {
          this.fleetMatchByImo.set({
            ...this.fleetMatchByImo(),
            [importRes.data.imo]: importRes.data,
          });
        }
      }

      const res = await firstValueFrom(
        this.http.post<ApiResponse<VesselCompanyDto>>(`${API}/vessels/local/${vesselId}/companies`, {
          companyId: c.id,
          role,
          replaceExistingRole: shouldReplace || undefined,
        }),
      );
      if (res && res.success === false) {
        if ((res.message ?? '').includes('Role already exists for this vessel') && shouldReplace) {
          const retry = await firstValueFrom(
            this.http.post<ApiResponse<VesselCompanyDto>>(`${API}/vessels/local/${vesselId}/companies`, {
              companyId: c.id,
              role,
              replaceExistingRole: true,
            }),
          );
          if (retry && retry.success === false) {
            this.showToast('error', retry.message ?? 'Failed to replace vessel role.');
            return;
          }
          this.showToast('success', `Replaced existing ${role.toLowerCase()} for vessel ${v.name ?? v.imo ?? ''}`);
        } else {
          this.showToast('error', res.message ?? 'Failed to link vessel.');
          return;
        }
        return;
      }
      this.loadCompanyVessels(c.id);
      if (shouldReplace) {
        this.showToast('success', `Replaced existing ${role.toLowerCase()} for vessel ${v.name ?? v.imo ?? ''}`);
      } else {
        this.showToast('success', `Linked vessel ${v.name ?? v.imo ?? ''}`);
      }
    } catch (err) {
      console.error('Failed to link fleet vessel:', err);
      this.showToast('error', 'Failed to link vessel.');
    } finally {
      this.linkingFleetKey.set(null);
    }
  }

  selectedVesselRoleExists(): boolean {
    const selected = this.selectedVessel();
    if (!selected) return false;
    const role = this.vesselForm().role;
    return this.companyVessels().some((vc) => vc.vesselId === selected.id && vc.role === role);
  }

  private initFleetMap(): void {
    const el = this.fleetMapEl()?.nativeElement;
    if (!el || this.fleetMap) return;

    const vessels = this.fleetVesselsWithPosition();
    if (!vessels.length) return;

    this.fleetMap = L.map(el, {
      zoomControl: true,
      attributionControl: false,
    }).setView([30, 0], 2);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
      subdomains: 'abcd',
    }).addTo(this.fleetMap);

    this.vesselLayer = L.layerGroup().addTo(this.fleetMap);

    // Handle clicks on vessel name links inside popups
    this.fleetMap.on('popupopen', (e: any) => {
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
    this.fleetMap.on('zoomend', () => {
      this.addFleetVesselMarkers(this.fleetVesselsWithPosition());
    });

    this.addFleetVesselMarkers(vessels);

    // Fit bounds
    const bounds = L.latLngBounds([]);
    for (const v of vessels) {
      const pos = v.latestInformation!.position!;
      bounds.extend(L.latLng(pos.lat, pos.lng));
    }
    if (bounds.isValid()) {
      this.fleetMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 6 });
    }
  }

  private addFleetVesselMarkers(vessels: FleetVessel[]): void {
    if (!this.fleetMap || !this.vesselLayer) return;

    this.vesselLayer.clearLayers();
    const zoom = this.fleetMap.getZoom();

    for (const v of vessels) {
      const pos = v.latestInformation?.position;
      if (!pos?.lat || !pos?.lng) continue;

      const loa = v.lengthOverall ? parseFloat(v.lengthOverall) : null;
      const heading = v.latestInformation?.trueHeading ?? null;

      const marker = L.marker([pos.lat, pos.lng], {
        icon: vesselIcon(heading, loa, zoom, pos.lat, v.hasSanctions),
      });

      const breadth = v.breadthExtreme ? parseFloat(v.breadthExtreme) : null;
      const draught = v.draught ? parseFloat(v.draught) : null;
      const speed = v.latestInformation?.aisSpeed ?? null;

      const popupLines = [
        `<a href="javascript:void(0)" class="vessel-nav-link text-blue-600 hover:underline font-semibold" data-vessel-id="${v.id}">${v.name}</a>`,
        `IMO: ${v.imo}`,
        v.type ? `Type: ${v.type}` : null,
        v.flag ? `Flag: ${v.flag.name}` : null,
        loa || breadth
          ? `Size: ${loa ?? '?'}m × ${breadth ?? '?'}m`
          : null,
        v.deadWeightTonnage ? `DWT: ${v.deadWeightTonnage.toLocaleString()}` : null,
        v.grossTonnage ? `GT: ${v.grossTonnage.toLocaleString()}` : null,
        draught != null ? `Draft: ${draught.toFixed(1)}m` : null,
        speed != null ? `Speed: ${speed.toFixed(1)} kn` : null,
        heading != null ? `Heading: ${heading}°` : null,
        v.buildYear ? `Built: ${v.buildYear}` : null,
        v.status ? `Status: ${v.status}` : null,
        v.destination?.place ? `Dest: ${v.destination.place.name}` : null,
        v.latestInformation?.nearestPort ? `Near: ${v.latestInformation.nearestPort}` : null,
        v.hasSanctions ? `<span style="color:#dc2626;font-weight:600">⚠️ Sanctioned</span>` : null,
      ].filter(Boolean);

      marker.bindPopup(
        `<div class="text-xs leading-relaxed">${popupLines.join('<br>')}</div>`,
        { closeButton: false, className: 'vessel-popup' },
      );

      marker.addTo(this.vesselLayer);
    }
  }

  async syncFromSeasearcher(): Promise<void> {
    const c = this.company();
    if (!c) return;

    this.syncing.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<CounterpartyDto>>(`${API}/companies/local/${c.id}/sync`, {}),
      );
      if (res.success && res.data) {
        this.company.set(res.data);
        // Refresh enrichment & contacts after sync
        if (res.data.seasearcherId) {
          this.loadEnrichment(res.data.seasearcherId);
        }
        this.loadContacts(res.data.id);
      }
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      this.syncing.set(false);
    }
  }

  async executeDelete(): Promise<void> {
    if (!this.canDeleteEntity()) {
      this.deleteError.set('Only admins can delete companies');
      return;
    }
    const c = this.company();
    if (!c) return;

    this.deleting.set(true);
    try {
      const res = await firstValueFrom(
        this.http.delete<ApiResponse<{ id: string }>>(`${API}/companies/local/${c.id}`),
      );
      if (res.success) {
        this.router.navigate(['/companies']);
      } else {
        this.deleteError.set(res.message ?? 'Failed to delete');
      }
    } catch {
      this.deleteError.set('Failed to delete company');
    } finally {
      this.deleting.set(false);
    }
  }

  async toggleType(type: string): Promise<void> {
    const c = this.company();
    if (!c || this.typeSaving()) return;

    const current = this.companyTypes();
    let next: string[];
    if (current.includes(type)) {
      // Don't allow removing the last type
      if (current.length <= 1) return;
      next = current.filter(t => t !== type);
    } else {
      next = [...current, type];
    }

    this.typeSaving.set(true);
    try {
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<CounterpartyDto>>(`${API}/companies/local/${c.id}/types`, { types: next }),
      );
      if (res.success && res.data) {
        this.company.set(res.data);
      }
    } catch (err) {
      console.error('Failed to update types:', err);
    } finally {
      this.typeSaving.set(false);
    }
  }

  startEditing(): void {
    const c = this.company();
    if (!c) return;
    this.editName.set(c.name);
    this.editCountry.set(c.country ?? '');
    this.editCountryIso.set(c.countryIso ?? '');
    this.countrySearchQuery.set(c.country ?? '');
    this.showCountryDropdown.set(false);
    this.editing.set(true);
  }

  cancelEditing(): void {
    this.editing.set(false);
    this.showCountryDropdown.set(false);
  }

  async saveEditing(): Promise<void> {
    const c = this.company();
    if (!c) return;

    this.editSaving.set(true);
    try {
      const body: Record<string, string | null> = {};
      if (this.editName() !== c.name) body['name'] = this.editName();
      if (this.editCountry() !== (c.country ?? '')) body['country'] = this.editCountry() || null;
      if (this.editCountryIso() !== (c.countryIso ?? '')) body['countryIso'] = this.editCountryIso() || null;

      if (Object.keys(body).length === 0) {
        this.editing.set(false);
        return;
      }

      const res = await firstValueFrom(
        this.http.patch<ApiResponse<CounterpartyDto>>(`${API}/companies/local/${c.id}`, body),
      );
      if (res.success && res.data) {
        this.company.set(res.data);
      }
      this.editing.set(false);
    } catch (err) {
      console.error('Failed to update company:', err);
    } finally {
      this.editSaving.set(false);
    }
  }

  goToOrder(orderId: string): void {
    this.router.navigate(['/trading/orders', orderId]);
  }

  goBack(): void {
    this.router.navigate(['/companies']);
  }

  // ─── Helpers ───────────────────────────────────────────────────────
  typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }

  typeBadgeClass(type: string): string {
    switch (type) {
      case 'CLIENT': return 'bg-blue-100 text-blue-700';
      case 'SUPPLIER': return 'bg-green-100 text-green-700';
      case 'BARGE': return 'bg-amber-100 text-amber-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  }

  readonly companyTypes = computed(() => {
    const c = this.company();
    if (!c) return [];
    return c.types?.length ? c.types : [c.type];
  });

  readonly companyFlag = computed(() => {
    const c = this.company();
    if (!c?.countryIso) return '';
    return flagFromIso3(c.countryIso);
  });

  countryFlag(iso3: string | null | undefined): string {
    return flagFromIso3(iso3 ?? null);
  }

  onCountrySearch(value: string): void {
    this.countrySearchQuery.set(value);
    this.showCountryDropdown.set(true);
  }

  selectCountry(country: Country): void {
    this.editCountry.set(country.name);
    this.editCountryIso.set(country.code);
    this.countrySearchQuery.set(country.name);
    this.showCountryDropdown.set(false);
  }

  // ─── Entity navigation ──────────────────────────────────────────────

  async navigateToCompany(seasearcherId: string): Promise<void> {
    this.navigatingCompanyId.set(seasearcherId);
    try {
      const existing = await firstValueFrom(
        this.http.get<ApiResponse<CounterpartyDto>>(`${API}/companies/by-seasearcher/${seasearcherId}`),
      ).catch(() => null);

      if (existing?.success && existing.data) {
        this.router.navigate(['/companies', existing.data.id]);
        return;
      }

      const imported = await firstValueFrom(
        this.http.post<ApiResponse<CounterpartyDto>>(`${API}/companies/import`, { seasearcherId }),
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

  readonly flatHierarchy = computed(() => {
    const h = this.hierarchy();
    if (!h?.companyHierarchy) return [];
    const nodes: HierarchyNode[] = [];
    const flatten = (node: HierarchyNode) => {
      nodes.push(node);
      if (node.companyHierarchy?.length) {
        for (const child of node.companyHierarchy) {
          flatten(child);
        }
      }
    };
    flatten(h.companyHierarchy);
    return nodes;
  });

  hierarchyRoles(node: HierarchyNode): string {
    const roles: string[] = [];
    if (node.beneficialOwner > 0) roles.push(`BO: ${node.beneficialOwner}`);
    if (node.commercialOperator > 0) roles.push(`CO: ${node.commercialOperator}`);
    if (node.thirdPartyOperator > 0) roles.push(`TP: ${node.thirdPartyOperator}`);
    if (node.technicalManager > 0) roles.push(`TM: ${node.technicalManager}`);
    if (node.registered > 0) roles.push(`RO: ${node.registered}`);
    if (node.nominalOwner > 0) roles.push(`NO: ${node.nominalOwner}`);
    if (node.ismManager > 0) roles.push(`ISM: ${node.ismManager}`);
    return roles.join(', ');
  }

  websiteUrl(): string {
    const w = this.company()?.website;
    if (!w) return '#';
    return w.startsWith('http') ? w : `https://${w}`;
  }

  statusBadge(status: string): string {
    switch (status) {
      case 'DRAFT': return 'bg-gray-100 text-gray-600';
      case 'CONFIRMED': return 'bg-blue-100 text-blue-700';
      case 'DELIVERED': return 'bg-green-100 text-green-700';
      case 'INVOICED': return 'bg-purple-100 text-purple-700';
      case 'CANCELLED': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  }

  formatRole(role: string): string {
    const found = this.roleOptions().find(r => r.key === role);
    if (found) return found.label;
    // Fallback: convert KEY_NAME to Title Case
    return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\B\w+/g, w => w.toLowerCase());
  }

  // ─── Contacts ───────────────────────────────────────────────────────

  async loadContacts(companyId: string): Promise<void> {
    this.contactsLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CompanyContactDto[]>>(`${API}/companies/local/${companyId}/contacts`),
      );
      if (res.success) this.contacts.set(res.data);
    } catch {
      // ignore
    } finally {
      this.contactsLoading.set(false);
    }
  }

  openAddContact(): void {
    this.editingContactId.set(null);
    this.contactForm.set({ name: '', role: '', phone: '', fax: '', email: '', notes: '' });
    this.contactError.set('');
    this.showContactModal.set(true);
  }

  updateContactField(field: string, value: string): void {
    this.contactForm.update((f) => ({ ...f, [field]: value }));
  }

  openEditContact(c: CompanyContactDto): void {
    this.editingContactId.set(c.id);
    this.contactForm.set({
      name: c.name,
      role: c.role ?? '',
      phone: c.phone ?? '',
      fax: c.fax ?? '',
      email: c.email ?? '',
      notes: c.notes ?? '',
    });
    this.contactError.set('');
    this.showContactModal.set(true);
  }

  async saveContact(): Promise<void> {
    const form = this.contactForm();
    if (!form.name.trim()) {
      this.contactError.set('Name is required.');
      return;
    }
    this.contactSaving.set(true);
    this.contactError.set('');
    try {
      const companyId = this.company()!.id;
      const body = {
        name: form.name.trim(),
        role: form.role.trim() || undefined,
        phone: form.phone.trim() || undefined,
        fax: form.fax.trim() || undefined,
        email: form.email.trim() || undefined,
        notes: form.notes.trim() || undefined,
      };
      if (this.editingContactId()) {
        await firstValueFrom(
          this.http.patch(`${API}/companies/contacts/${this.editingContactId()}`, body),
        );
      } else {
        await firstValueFrom(
          this.http.post(`${API}/companies/local/${companyId}/contacts`, body),
        );
      }
      this.showContactModal.set(false);
      await this.loadContacts(companyId);
    } catch {
      this.contactError.set('Failed to save contact.');
    } finally {
      this.contactSaving.set(false);
    }
  }

  confirmDeleteContact(c: CompanyContactDto): void {
    this.deleteContactTarget.set(c);
  }

  async executeDeleteContact(): Promise<void> {
    const target = this.deleteContactTarget();
    if (!target) return;
    try {
      await firstValueFrom(
        this.http.delete(`${API}/companies/contacts/${target.id}`),
      );
      this.deleteContactTarget.set(null);
      await this.loadContacts(this.company()!.id);
    } catch {
      console.error('Failed to delete contact');
    }
  }

  formatPhone(nums: Array<{ countryDialingCode: string; areaDialingCode: string; number: string }>): string {
    return nums.map(t => `+${t.countryDialingCode} ${t.areaDialingCode} ${t.number}`.trim()).join(', ');
  }

  // ─── Supply Ports ─────────────────────────────────────────────────
  private async loadSupplyPorts(companyId: string): Promise<void> {
    this.supplyPortsLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<SupplyPortDto[]>>(`${API}/companies/local/${companyId}/supply-ports`),
      );
      if (res.success && res.data) {
        this.supplyPorts.set(res.data);
      }
    } catch (err) {
      console.error('Failed to load supply ports:', err);
    } finally {
      this.supplyPortsLoading.set(false);
    }
  }

  // ─── Company Emails ───────────────────────────────────────────────
  private async loadCompanyEmails(companyId: string): Promise<void> {
    this.emailsLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CompanyEmailDto[]>>(`${API}/companies/local/${companyId}/emails`),
      );
      if (res.success && res.data) {
        this.companyEmails.set(res.data);
      }
    } catch (err) {
      console.error('Failed to load company emails:', err);
    } finally {
      this.emailsLoading.set(false);
    }
  }

  openAddEmail(): void {
    this.emailForm.set({ emailType: 'general', email: '', label: '', isPrimary: false });
    this.editingEmailId.set(null);
    this.showAddEmail.set(true);
  }

  openEditEmail(e: CompanyEmailDto): void {
    this.emailForm.set({ emailType: e.emailType, email: e.email, label: e.label ?? '', isPrimary: e.isPrimary });
    this.editingEmailId.set(e.id);
    this.showAddEmail.set(true);
  }

  cancelEmailForm(): void {
    this.showAddEmail.set(false);
    this.editingEmailId.set(null);
  }

  formatEmailType(type: CompanyEmailType): string {
    switch (type) {
      case 'sales': return 'Sales';
      case 'invoice': return 'Invoice';
      case 'inquiry': return 'Inquiry';
      case 'general': return 'General';
      default: return type.charAt(0).toUpperCase() + type.slice(1);
    }
  }

  emailTypeBadgeClass(type: CompanyEmailType): string {
    switch (type) {
      case 'sales': return 'bg-green-100 text-green-700';
      case 'invoice': return 'bg-blue-100 text-blue-700';
      case 'inquiry': return 'bg-amber-100 text-amber-700';
      case 'general': return 'bg-gray-100 text-gray-600';
      default: return 'bg-purple-100 text-purple-700';
    }
  }

  async saveCompanyEmail(): Promise<void> {
    const c = this.company();
    if (!c) return;
    const form = this.emailForm();
    if (!form.email.trim()) return;

    this.savingEmail.set(true);
    try {
      const editId = this.editingEmailId();
      if (editId) {
        await firstValueFrom(
          this.http.patch(`${API}/companies/emails/${editId}`, {
            emailType: form.emailType,
            email: form.email.trim(),
            label: form.label.trim() || undefined,
            isPrimary: form.isPrimary,
          }),
        );
      } else {
        await firstValueFrom(
          this.http.post(`${API}/companies/local/${c.id}/emails`, {
            emailType: form.emailType,
            email: form.email.trim(),
            label: form.label.trim() || undefined,
            isPrimary: form.isPrimary,
          }),
        );
      }
      this.showAddEmail.set(false);
      this.editingEmailId.set(null);
      this.loadCompanyEmails(c.id);
    } catch (err) {
      console.error('Failed to save company email:', err);
    } finally {
      this.savingEmail.set(false);
    }
  }

  async deleteCompanyEmail(emailId: string): Promise<void> {
    const c = this.company();
    if (!c) return;
    try {
      await firstValueFrom(
        this.http.delete(`${API}/companies/emails/${emailId}`),
      );
      this.loadCompanyEmails(c.id);
    } catch (err) {
      console.error('Failed to delete company email:', err);
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

  private async loadRoleOptions(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ roles: VesselCompanyRoleOption[] }>>(`${API}/admin/settings/vessel-company-roles/options`),
      );
      if (res.success && res.data?.roles?.length) {
        this.roleOptions.set(res.data.roles);
      }
    } catch {
      // Keep defaults if fetch fails
    }
  }

  async onResponsibleUserChange(userId: string): Promise<void> {
    const c = this.company();
    if (!c) return;

    this.savingResponsible.set(true);
    try {
      await firstValueFrom(
        this.http.patch(`${API}/companies/local/${c.id}/responsible-user`, {
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
