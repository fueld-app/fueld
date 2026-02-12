import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  OnInit,
  OnDestroy,
  viewChild,
  ElementRef,
  effect,
  afterNextRender,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, Subscription, skip } from 'rxjs';
import { Title } from '@angular/platform-browser';
import type { VesselDto, CounterpartyDto, ApiResponse, VesselCompanyDto, VesselCompanyRole, CompanyContactDto } from '@fueld/types';
import * as L from 'leaflet/dist/leaflet-src.esm.js';
import { flagFromIso3 } from '../../../../shared/utils/flags';
import { WebSocketService } from '../../../../core/websocket/websocket.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { ActivityTimelineComponent } from '../../../../shared/components/activity-timeline/activity-timeline.component';
import { LastEditedBadgeComponent } from '../../../../shared/components/last-edited-badge/last-edited-badge.component';
import { CommentsCardComponent } from '../../../../shared/components/comments-card/comments-card.component';

interface OwnershipEntry {
  type: string;
  typeCode: string;
  companyId: string | null;
  companyName: string;
  from: string;
  to: string | null;
  currentIndicator: boolean;
  country: { code: string | null; name: string | null };
}

/** Group historical entries by month/year for timeline display */
interface TimelineGroup {
  label: string;          // e.g. "Jun 2024"
  sortKey: number;        // for sorting (timestamp)
  entries: OwnershipEntry[];
}

const ROLE_ORDER: Record<string, number> = {
  BO: 0, CO: 1, RO: 2, NO: 3, TM: 4, TP: 5, IM: 6,
};

const ROLE_BORDER_COLORS: Record<string, string> = {
  BO: 'border-l-blue-500',
  CO: 'border-l-emerald-500',
  RO: 'border-l-amber-500',
  NO: 'border-l-gray-400',
  TM: 'border-l-violet-500',
  TP: 'border-l-gray-400',
  IM: 'border-l-rose-500',
};

// ═══════════════════════════════════════════════════════════════════════
//  Vessel Detail Page — Info, enrichment, orders
// ═══════════════════════════════════════════════════════════════════════

import { API } from '@app/core/config/api';

interface CompanySearchResult {
  source: 'local' | 'seasearcher';
  localId?: string;
  seasearcherId?: string;
  name: string;
  country?: string | null;
}

interface CompanySearchResultOption {
  key: string;
  source: 'local' | 'seasearcher';
  id?: string;
  seasearcherId?: string;
  name: string;
  country?: string | null;
}

function metersPerPx(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

function vesselIcon(heading: number | null, loa: number | null, zoom: number, lat: number, sanctioned = false): L.DivIcon {
  const deg = heading ?? 0;
  const loaMeters = loa ?? 100;
  const mpp = metersPerPx(lat, zoom);
  const h = Math.round(Math.max(10, Math.min(loaMeters / mpp, 120)));
  const w = Math.round(h * 0.35);
  const fill = sanctioned ? '#ef4444' : loaMeters < 120 ? '#3b82f6' : loaMeters < 250 ? '#f97316' : '#ef4444';
  const stroke = sanctioned ? '#991b1b' : loaMeters < 120 ? '#1d4ed8' : loaMeters < 250 ? '#c2410c' : '#991b1b';
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
  selector: 'app-vessel-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, FormsModule, RouterLink, ActivityTimelineComponent, LastEditedBadgeComponent, CommentsCardComponent],
  styles: [`
    :host ::ng-deep .leaflet-container { font-family: inherit; }
  `],
  template: `
    @if (loading()) {
      <div class="flex items-center justify-center py-20">
        <svg class="h-8 w-8 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
      </div>
    } @else if (vessel()) {
      <!-- Back nav -->
      <button
        (click)="goBack()"
        class="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd" />
        </svg>
        Back to Vessels
      </button>

      <!-- Header -->
      <div class="mb-6">
        <div class="flex items-center gap-3 mb-1">
          @if (vesselFlag()) { <span class="text-2xl">{{ vesselFlag() }}</span> }
          <h1 class="text-2xl font-bold text-gray-900">{{ vessel()!.name }}</h1>
          @if (vessel()!.status) {
            <span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
              [class]="vessel()!.status === 'Live' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'">
              {{ vessel()!.status }}
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
            @if (vessel()!.seasearcherId) {
              <a
                [href]="'https://www.seasearcher.com/vessel/' + vessel()!.seasearcherId"
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
            @if (vessel()!.imo) { IMO {{ vessel()!.imo }} }
            @if (vessel()!.mmsi) { · MMSI {{ vessel()!.mmsi }} }
            @if (vessel()!.flag) { · {{ vessel()!.flag }} }
          </p>
          @if (vessel()!.lastSynced) {
            <span class="inline-flex items-center gap-1 text-xs text-gray-400" title="Last synced with Seasearcher">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
              </svg>
              Synced {{ vessel()!.lastSynced | date:'short' }}
            </span>
          }
        </div>
        <app-last-edited-badge entityType="vessel" [entityId]="vessel()!.id" />
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Left column -->
        <div class="lg:col-span-2 space-y-6">

          <!-- Vessel Info -->
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
              <h2 class="text-sm font-semibold text-gray-700">Vessel Information</h2>
              @if (!vessel()!.seasearcherId && !editing()) {
                <button
                  (click)="startEditing()"
                  class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                  </svg>
                  Edit
                </button>
              }
              @if (editing()) {
                <div class="flex items-center gap-2">
                  <button
                    (click)="cancelEditing()"
                    [disabled]="editSaving()"
                    class="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >Cancel</button>
                  <button
                    (click)="saveEditing()"
                    [disabled]="editSaving()"
                    class="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
                  >
                    @if (editSaving()) { Saving… } @else { Save }
                  </button>
                </div>
              }
            </div>
            <div class="p-5">
              <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
                <div>
                  <dt class="text-gray-500">Vessel Name</dt>
                  @if (editing()) {
                    <dd class="mt-0.5">
                      <input type="text" [value]="editName()" (input)="editName.set($any($event.target).value)"
                        class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                    </dd>
                  } @else {
                    <dd class="mt-0.5 font-medium text-gray-900">{{ vessel()!.name }}</dd>
                  }
                </div>
                <div>
                  <dt class="text-gray-500">IMO</dt>
                  @if (editing()) {
                    <dd class="mt-0.5">
                      <input type="text" [value]="editImo()" (input)="editImo.set($any($event.target).value)"
                        class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium font-mono text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                    </dd>
                  } @else {
                    <dd class="mt-0.5 font-medium text-gray-900 font-mono">{{ vessel()!.imo ?? '—' }}</dd>
                  }
                </div>
                <div>
                  <dt class="text-gray-500">MMSI</dt>
                  @if (editing()) {
                    <dd class="mt-0.5">
                      <input type="text" [value]="editMmsi()" (input)="editMmsi.set($any($event.target).value)"
                        class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium font-mono text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                    </dd>
                  } @else {
                    <dd class="mt-0.5 font-medium text-gray-900 font-mono">{{ vessel()!.mmsi ?? '—' }}</dd>
                  }
                </div>
                <div>
                  <dt class="text-gray-500">Flag</dt>
                  @if (editing()) {
                    <dd class="mt-0.5">
                      <input type="text" [value]="editFlag()" (input)="editFlag.set($any($event.target).value)"
                        class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                    </dd>
                  } @else {
                    <dd class="mt-0.5 font-medium text-gray-900">{{ vessel()!.flag ?? '—' }}</dd>
                  }
                </div>
                <div>
                  <dt class="text-gray-500">Type</dt>
                  @if (editing()) {
                    <dd class="mt-0.5">
                      <input type="text" [value]="editType()" (input)="editType.set($any($event.target).value)"
                        class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                    </dd>
                  } @else {
                    <dd class="mt-0.5 font-medium text-gray-900 capitalize">{{ vessel()!.type ?? '—' }}</dd>
                  }
                </div>
                <div>
                  <dt class="text-gray-500">Status</dt>
                  @if (editing()) {
                    <dd class="mt-0.5">
                      <input type="text" [value]="editStatus()" (input)="editStatus.set($any($event.target).value)"
                        class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                    </dd>
                  } @else {
                    <dd class="mt-0.5">
                      @if (vessel()!.status) {
                        <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                          [class]="vessel()!.status === 'Live' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'">
                          {{ vessel()!.status }}
                        </span>
                      } @else { — }
                    </dd>
                  }
                </div>
                <div>
                  <dt class="text-gray-500">Build Year</dt>
                  @if (editing()) {
                    <dd class="mt-0.5">
                      <input type="text" [value]="editBuildYear()" (input)="editBuildYear.set($any($event.target).value)"
                        class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                    </dd>
                  } @else {
                    <dd class="mt-0.5 font-medium text-gray-900">{{ vessel()!.buildYear ?? '—' }}</dd>
                  }
                </div>
                <div>
                  <dt class="text-gray-500">Builder</dt>
                  @if (editing()) {
                    <dd class="mt-0.5">
                      <input type="text" [value]="editBuilder()" (input)="editBuilder.set($any($event.target).value)"
                        class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                    </dd>
                  } @else {
                    <dd class="mt-0.5 font-medium">
                      @if (enrichment()?.['builderCompany']?.id) {
                        <button (click)="navigateToCompanyById(enrichment()!['builderCompany'].id)" class="text-blue-700 hover:text-blue-900 hover:underline transition-colors cursor-pointer">
                          @if (navigatingCompanyId() === enrichment()!['builderCompany'].id) {
                            <span class="inline-flex items-center gap-1"><svg class="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> {{ vessel()!.builder }}</span>
                          } @else {
                            {{ vessel()!.builder }}
                          }
                        </button>
                      } @else {
                        <span class="text-gray-900">{{ vessel()!.builder ?? '—' }}</span>
                      }
                    </dd>
                  }
                </div>
                <div>
                  <dt class="text-gray-500">Classification</dt>
                  @if (editing()) {
                    <dd class="mt-0.5">
                      <input type="text" [value]="editClassification()" (input)="editClassification.set($any($event.target).value)"
                        class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                    </dd>
                  } @else {
                    <dd class="mt-0.5 font-medium text-gray-900">{{ vessel()!.classificationSociety ?? '—' }}</dd>
                  }
                </div>
                <div>
                  <dt class="text-gray-500">Seasearcher ID</dt>
                  <dd class="mt-0.5 font-medium text-gray-900 font-mono">{{ vessel()!.seasearcherId ?? '—' }}</dd>
                </div>
              </dl>
            </div>
          </div>

          <!-- Dimensions -->
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div class="border-b border-gray-100 px-5 py-3">
              <h2 class="text-sm font-semibold text-gray-700">Dimensions & Tonnage</h2>
            </div>
            <div class="p-5">
              <dl class="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 text-sm">
                <div>
                  <dt class="text-gray-500">LOA</dt>
                  @if (editing()) {
                    <dd class="mt-0.5">
                      <div class="flex items-center gap-1">
                        <input type="text" [value]="editLoa()" (input)="editLoa.set($any($event.target).value)"
                          class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                        <span class="text-gray-400 text-xs">m</span>
                      </div>
                    </dd>
                  } @else {
                    <dd class="mt-0.5 font-medium text-gray-900">{{ vessel()!.loa ? vessel()!.loa + ' m' : '—' }}</dd>
                  }
                </div>
                <div>
                  <dt class="text-gray-500">Breadth</dt>
                  @if (editing()) {
                    <dd class="mt-0.5">
                      <div class="flex items-center gap-1">
                        <input type="text" [value]="editBreadth()" (input)="editBreadth.set($any($event.target).value)"
                          class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                        <span class="text-gray-400 text-xs">m</span>
                      </div>
                    </dd>
                  } @else {
                    <dd class="mt-0.5 font-medium text-gray-900">{{ vessel()!.breadth ? vessel()!.breadth + ' m' : '—' }}</dd>
                  }
                </div>
                <div>
                  <dt class="text-gray-500">Depth</dt>
                  @if (editing()) {
                    <dd class="mt-0.5">
                      <div class="flex items-center gap-1">
                        <input type="text" [value]="editDepth()" (input)="editDepth.set($any($event.target).value)"
                          class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                        <span class="text-gray-400 text-xs">m</span>
                      </div>
                    </dd>
                  } @else {
                    <dd class="mt-0.5 font-medium text-gray-900">{{ vessel()!.depth ? vessel()!.depth + ' m' : '—' }}</dd>
                  }
                </div>
                <div>
                  <dt class="text-gray-500">Draft</dt>
                  @if (editing()) {
                    <dd class="mt-0.5">
                      <div class="flex items-center gap-1">
                        <input type="text" [value]="editDraught()" (input)="editDraught.set($any($event.target).value)"
                          class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                        <span class="text-gray-400 text-xs">m</span>
                      </div>
                    </dd>
                  } @else {
                    <dd class="mt-0.5 font-medium text-gray-900">{{ vessel()!.draught ? vessel()!.draught + ' m' : '—' }}</dd>
                  }
                </div>
                <div>
                  <dt class="text-gray-500">DWT</dt>
                  @if (editing()) {
                    <dd class="mt-0.5">
                      <input type="text" [value]="editDwt()" (input)="editDwt.set($any($event.target).value)"
                        class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium font-mono text-xs text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                    </dd>
                  } @else {
                    <dd class="mt-0.5 font-medium text-gray-900 font-mono text-xs">{{ vessel()!.deadWeightTonnage ? vessel()!.deadWeightTonnage!.toLocaleString() : '—' }}</dd>
                  }
                </div>
                <div>
                  <dt class="text-gray-500">Gross Tonnage</dt>
                  @if (editing()) {
                    <dd class="mt-0.5">
                      <input type="text" [value]="editGrossTonnage()" (input)="editGrossTonnage.set($any($event.target).value)"
                        class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium font-mono text-xs text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                    </dd>
                  } @else {
                    <dd class="mt-0.5 font-medium text-gray-900 font-mono text-xs">{{ vessel()!.grossTonnage ? vessel()!.grossTonnage!.toLocaleString() : '—' }}</dd>
                  }
                </div>
              </dl>
            </div>
          </div>

          <!-- Orders -->
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
              <h2 class="text-sm font-semibold text-gray-700">Orders</h2>
              @if (vesselOrders().length) {
                <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">{{ vesselOrders().length }}</span>
              }
            </div>
            @if (ordersLoading()) {
              <div class="flex items-center justify-center py-8">
                <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              </div>
            } @else if (vesselOrders().length) {
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b border-gray-100 bg-gray-50/60">
                      <th class="px-5 py-2 text-left font-medium text-gray-500">Status</th>
                      <th class="px-5 py-2 text-left font-medium text-gray-500">Client</th>
                      <th class="px-5 py-2 text-left font-medium text-gray-500">Port</th>
                      <th class="px-5 py-2 text-left font-medium text-gray-500">ETA</th>
                      <th class="px-5 py-2 text-left font-medium text-gray-500">Created</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-50">
                    @for (o of vesselOrders(); track o.id) {
                      <tr class="hover:bg-gray-50/50 transition-colors cursor-pointer" (click)="goToOrder(o.id)">
                        <td class="px-5 py-2.5">
                          <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                            [class]="statusBadgeClass(o.status)">
                            {{ o.status }}
                          </span>
                        </td>
                        <td class="px-5 py-2.5 text-gray-900 font-medium">{{ o.clientName }}</td>
                        <td class="px-5 py-2.5 text-gray-600">{{ o.placeName }}</td>
                        <td class="px-5 py-2.5 text-gray-600">{{ o.eta ? (o.eta | date:'mediumDate') : '—' }}</td>
                        <td class="px-5 py-2.5 text-gray-600">{{ o.createdAt | date:'mediumDate' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <div class="px-5 py-6 text-center text-sm text-gray-400">No orders found for this vessel</div>
            }
          </div>

          <!-- Vessel Companies -->
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
              <h2 class="text-sm font-semibold text-gray-700">
                Companies
                @if (vesselCompanies().length) {
                  <span class="ml-1 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                    {{ vesselCompanies().length }}
                  </span>
                }
              </h2>
              <button (click)="openAddCompany()"
                class="rounded-md bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100 transition-colors">
                + Add
              </button>
            </div>

            @if (showAddCompany()) {
              <div class="border-b border-gray-100 px-5 py-4 bg-gray-50/50">
                <div class="space-y-2">
                  <!-- Company search (typeahead) -->
                  @if (!editingCompanyId()) {
                    <div class="relative">
                      @if (selectedCompany()) {
                        <div class="flex items-center justify-between rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5 text-sm">
                          <span class="font-medium text-brand-800">{{ selectedCompany()!.name }}</span>
                          <button (click)="clearSelectedCompany()"
                            class="ml-2 text-brand-400 hover:text-brand-600 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                            </svg>
                          </button>
                        </div>
                      } @else {
                        <input
                          [ngModel]="companySearch()"
                          (ngModelChange)="onCompanySearch($event)"
                          placeholder="Search company..."
                          class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                        />
                        @if (companySearchResults().length) {
                          <div class="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg max-h-48 overflow-y-auto">
                            @for (c of companySearchResults(); track c.key) {
                              <button (click)="selectCompany(c)"
                                class="w-full px-3 py-2 text-left text-sm hover:bg-brand-50 transition-colors flex items-center justify-between">
                                <span class="font-medium text-gray-900">{{ c.name }}</span>
                                @if (c.source === 'seasearcher') {
                                  <span class="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Import</span>
                                } @else if (c.country) {
                                  <span class="text-xs text-gray-400">{{ c.country }}</span>
                                }
                              </button>
                            }
                          </div>
                        }
                      }
                    </div>
                  }

                  <!-- Role selection -->
                  <div>
                    <label class="block text-xs font-medium text-gray-500 mb-1">Role</label>
                    <select
                      [ngModel]="companyForm().role"
                      (ngModelChange)="companyForm.set({ ...companyForm(), role: $event })"
                      class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                      @for (role of roleOptions; track role) {
                        <option [ngValue]="role">{{ formatRole(role) }}</option>
                      }
                    </select>
                  </div>

                  @if (!editingCompanyId() && selectedCompany() && selectedCompanyRoleExists()) {
                    <div class="text-[11px] text-amber-600">This company already has that role.</div>
                  }

                  <!-- Contact person (shown after company selected or when editing) -->
                  @if (selectedCompany() || editingCompanyId()) {
                    <div>
                      <label class="block text-xs font-medium text-gray-500 mb-1">Contact Person</label>
                      @if (companyContactsLoading()) {
                        <div class="text-xs text-gray-400 py-1">Loading contacts...</div>
                      } @else if (companyContacts().length) {
                        <select
                          [ngModel]="companyForm().contactId"
                          (ngModelChange)="companyForm.set({ ...companyForm(), contactId: $event || null })"
                          class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                          <option [ngValue]="null">— None —</option>
                          @for (ct of companyContacts(); track ct.id) {
                            <option [ngValue]="ct.id">{{ ct.name }}@if (ct.role) { ({{ ct.role }}) }</option>
                          }
                        </select>
                      } @else {
                        <div class="text-xs text-gray-400 py-1">No contacts on file</div>
                      }
                    </div>
                  }

                  <textarea
                    [ngModel]="companyForm().note"
                    (ngModelChange)="companyForm.set({ ...companyForm(), note: $event })"
                    placeholder="Notes"
                    rows="2"
                    class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  ></textarea>
                  <div class="flex justify-end gap-2">
                    <button (click)="cancelCompanyForm()"
                      class="rounded-md border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                      Cancel
                    </button>
                    <button (click)="saveVesselCompany()"
                      [disabled]="savingCompany() || (!editingCompanyId() && !selectedCompany())"
                      class="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors">
                      {{ editingCompanyId() ? 'Update' : 'Add' }}
                    </button>
                  </div>
                </div>
              </div>
            }

            @if (companiesLoading()) {
              <div class="flex items-center justify-center py-6">
                <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              </div>
            } @else if (!vesselCompanies().length && !showAddCompany()) {
              <div class="px-5 py-6 text-center text-sm text-gray-400">No companies added yet</div>
            } @else {
              <div class="divide-y divide-gray-50 max-h-[400px] overflow-y-auto">
                @for (vc of vesselCompanies(); track vc.id) {
                  <div class="px-5 py-3 text-sm hover:bg-gray-50/50 transition-colors group">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">{{ formatRole(vc.role) }}</span>
                        <a [routerLink]="['/companies', vc.companyId]" class="font-medium text-brand-700 hover:text-brand-900 hover:underline">{{ vc.companyName }}</a>
                      </div>
                      <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button (click)="openEditCompany(vc)"
                          class="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Edit">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                          </svg>
                        </button>
                        <button (click)="deleteVesselCompany(vc.id)"
                          class="rounded p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    @if (vc.contactName) {
                      <p class="text-xs text-gray-500 mt-0.5">{{ vc.contactName }}</p>
                    }
                    @if (vc.note) {
                      <p class="text-xs text-gray-400 mt-0.5 italic">{{ vc.note }}</p>
                    }
                    <p class="text-[10px] text-gray-400 mt-1">
                      Added by {{ vc.addedByName ?? 'Unknown' }} · {{ vc.createdAt | date:'mediumDate' }}
                    </p>
                  </div>
                }
              </div>
            }
          </div>
        </div>

        <!-- Right column — Enrichment from Seasearcher -->
        <div class="space-y-6">
          @if (enrichmentLoading()) {
            <div class="rounded-xl border border-gray-200 bg-white shadow-sm p-6 flex items-center justify-center">
              <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            </div>
          } @else if (enrichment()) {
            <!-- Latest Information -->
            @if (enrichment()!.latestInformation) {
              <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
                <div class="border-b border-gray-100 px-5 py-3">
                  <div class="flex items-center justify-between">
                    <h2 class="text-sm font-semibold text-gray-700">Latest Information</h2>
                    @if (positionAge()) {
                      <span class="text-xs text-gray-400">{{ positionAge() }}</span>
                    }
                  </div>
                  @if (positionTimestamp()) {
                    <p class="text-xs text-gray-400 mt-0.5">Last Updated: {{ formatDate(positionTimestamp()) }}</p>
                  }
                </div>
                <div class="p-5 text-sm">
                  <div class="grid grid-cols-2 gap-x-6 gap-y-3">
                    <!-- Region -->
                    @if (enrichment()!.latestInformation!['region']) {
                      <div>
                        <span class="text-gray-400 text-xs">Region</span>
                        <div class="font-medium text-gray-900 mt-0.5">{{ enrichment()!.latestInformation!['region'] }}</div>
                      </div>
                    }
                    <!-- Lat/Lng -->
                    @if (enrichment()!.latestInformation!.position) {
                      <div>
                        <span class="text-gray-400 text-xs">Lat/Lng</span>
                        <div class="font-medium text-gray-900 font-mono text-xs mt-0.5">
                          {{ enrichment()!.latestInformation!.position!['dms']?.lat ?? enrichment()!.latestInformation!.position!.lat?.toFixed(4) }}
                          <span class="text-blue-600 font-semibold ml-0.5">{{ enrichment()!.latestInformation!.position!['dms']?.latPosition }}</span>
                        </div>
                        <div class="font-medium text-gray-900 font-mono text-xs">
                          {{ enrichment()!.latestInformation!.position!['dms']?.lng ?? (enrichment()!.latestInformation!.position!.lng ?? enrichment()!.latestInformation!.position!.lon)?.toFixed(4) }}
                          <span class="text-blue-600 font-semibold ml-0.5">{{ enrichment()!.latestInformation!.position!['dms']?.lngPosition }}</span>
                        </div>
                      </div>
                    }
                    <!-- Nearest Place -->
                    @if (enrichment()!.latestInformation!['nearestPort']) {
                      <div>
                        <span class="text-gray-400 text-xs">Nearest Place</span>
                        <div class="mt-0.5">
                          @if (enrichment()!.latestInformation!['nearestPortCountry']?.code) {
                            <span class="mr-1">{{ flagFromCountryCode(enrichment()!.latestInformation!['nearestPortCountry'].code) }}</span>
                          }
                          @if (enrichment()!.latestInformation!['nearestPortId']) {
                            <button (click)="navigateToPlace('' + enrichment()!.latestInformation!['nearestPortId'])" class="font-medium text-blue-700 hover:text-blue-900 hover:underline transition-colors cursor-pointer">
                              @if (navigatingPlaceId() === '' + enrichment()!.latestInformation!['nearestPortId']) {
                                <span class="inline-flex items-center gap-1"><svg class="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> {{ enrichment()!.latestInformation!['nearestPort'] }}</span>
                              } @else {
                                {{ enrichment()!.latestInformation!['nearestPort'] }}
                              }
                            </button>
                          } @else {
                            <span class="font-medium text-blue-700">{{ enrichment()!.latestInformation!['nearestPort'] }}</span>
                          }
                          @if (enrichment()!.latestInformation!['nearestPortCountry']?.name) {
                            <span class="text-gray-500">, {{ enrichment()!.latestInformation!['nearestPortCountry'].name }}</span>
                          }
                        </div>
                        @if (enrichment()!.latestInformation!['distanceFromNearestPort'] != null) {
                          <div class="text-xs text-gray-400">{{ enrichment()!.latestInformation!['distanceFromNearestPort'].toFixed(1) }} nm</div>
                        }
                      </div>
                    }
                    <!-- Status -->
                    @if (enrichment()!.latestInformation!['status']) {
                      <div>
                        <span class="text-gray-400 text-xs">Status</span>
                        <div class="font-medium text-gray-900 mt-0.5 capitalize">{{ enrichment()!.latestInformation!['status'] }}</div>
                      </div>
                    }
                    <!-- Destination -->
                    @if (destinationInfo().name) {
                      <div>
                        <span class="text-gray-400 text-xs">Destination</span>
                        <div class="mt-0.5">
                          @if (destinationInfo().flag) {
                            <span class="mr-1">{{ destinationInfo().flag }}</span>
                          }
                          @if (destinationInfo().placeId) {
                            <button (click)="navigateToPlace(destinationInfo().placeId!)" class="font-medium text-blue-700 hover:text-blue-900 hover:underline transition-colors cursor-pointer">
                              @if (navigatingPlaceId() === destinationInfo().placeId) {
                                <span class="inline-flex items-center gap-1"><svg class="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> {{ destinationInfo().name }}</span>
                              } @else {
                                {{ destinationInfo().name }}
                              }
                            </button>
                          } @else {
                            <span class="font-medium text-blue-700">{{ destinationInfo().name }}</span>
                          }
                          @if (destinationInfo().country) {
                            <span class="text-gray-500">, {{ destinationInfo().country }}</span>
                          }
                        </div>
                      </div>
                    }
                    <!-- ETA -->
                    @if (destinationInfo().eta) {
                      <div>
                        <span class="text-gray-400 text-xs">ETA</span>
                        <div class="font-medium text-gray-900 mt-0.5">{{ formatDate(destinationInfo().eta!) }}</div>
                        <div class="text-xs text-blue-600">{{ etaRelative(destinationInfo().eta!) }}</div>
                      </div>
                    }
                    <!-- Voyage Origin -->
                    @if (enrichment()!.latestInformation!['voyageOrigin']?.name) {
                      <div>
                        <span class="text-gray-400 text-xs">Voyage Origin</span>
                        <div class="mt-0.5">
                          @if (enrichment()!.latestInformation!['voyageOriginCountry']?.code) {
                            <span class="mr-1">{{ flagFromCountryCode(enrichment()!.latestInformation!['voyageOriginCountry'].code) }}</span>
                          }
                          @if (enrichment()!.latestInformation!['voyageOrigin'].id) {
                            <button (click)="navigateToPlace(enrichment()!.latestInformation!['voyageOrigin'].id)" class="font-medium text-blue-700 hover:text-blue-900 hover:underline transition-colors cursor-pointer">
                              @if (navigatingPlaceId() === enrichment()!.latestInformation!['voyageOrigin'].id) {
                                <span class="inline-flex items-center gap-1"><svg class="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> {{ enrichment()!.latestInformation!['voyageOrigin'].name }}</span>
                              } @else {
                                {{ enrichment()!.latestInformation!['voyageOrigin'].name }}
                              }
                            </button>
                          } @else {
                            <span class="font-medium text-blue-700">{{ enrichment()!.latestInformation!['voyageOrigin'].name }}</span>
                          }
                          @if (enrichment()!.latestInformation!['voyageOriginCountry']?.name) {
                            <span class="text-gray-500">, {{ enrichment()!.latestInformation!['voyageOriginCountry'].name }}</span>
                          }
                        </div>
                        @if (enrichment()!.latestInformation!['distanceFromOrigin'] != null) {
                          <div class="text-xs text-gray-400">{{ enrichment()!.latestInformation!['distanceFromOrigin'].toFixed(1) }} nm</div>
                        }
                      </div>
                    }
                    <!-- Draught -->
                    @if (enrichment()!.latestInformation!.draught != null) {
                      <div>
                        <span class="text-gray-400 text-xs">Draught</span>
                        <div class="font-medium text-gray-900 mt-0.5">{{ enrichment()!.latestInformation!.draught }} m</div>
                      </div>
                    }
                    <!-- Speed -->
                    @if (enrichment()!.latestInformation!.aisSpeed != null) {
                      <div>
                        <span class="text-gray-400 text-xs">Speed</span>
                        <div class="font-medium text-gray-900 mt-0.5">{{ enrichment()!.latestInformation!.aisSpeed }} kn</div>
                      </div>
                    }
                    <!-- Heading -->
                    @if (enrichment()!.latestInformation!.trueHeading != null) {
                      <div>
                        <span class="text-gray-400 text-xs">Heading</span>
                        <div class="font-medium text-gray-900 mt-0.5">{{ enrichment()!.latestInformation!.trueHeading }}°</div>
                      </div>
                    }
                  </div>
                </div>
              </div>

              <!-- Position Map -->
              @if (enrichment()!.latestInformation!.position) {
                <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  <div class="border-b border-gray-100 px-5 py-3">
                    <h2 class="text-sm font-semibold text-gray-700">Current Position</h2>
                  </div>
                  <div #positionMapEl class="h-64 w-full"></div>
                </div>
              }
            }

            <!-- Sanctions -->
            @if (enrichment()!['isSanctioned']) {
              <div class="rounded-xl border border-red-200 bg-white shadow-sm">
                <div class="border-b border-red-100 px-5 py-3">
                  <h2 class="text-sm font-semibold text-red-700">⚠️ Sanctioned</h2>
                </div>
                <div class="px-5 py-4 text-sm text-red-600">
                  This vessel is flagged as sanctioned.
                </div>
              </div>
            }
          } @else if (vessel()!.seasearcherId) {
            <div class="rounded-xl border border-gray-200 bg-white shadow-sm p-5 text-center">
              <p class="text-sm text-gray-400">Enrichment data unavailable</p>
            </div>
          } @else {
            <div class="rounded-xl border border-gray-200 bg-white shadow-sm p-5 text-center">
              <p class="text-sm text-gray-400">Manually created — no enrichment data</p>
              <p class="text-xs text-gray-300 mt-1">Import from Seasearcher to get detailed vessel data</p>
            </div>
          }
        </div>
      </div>

      <!-- Vessel Ownership Timeline (full-width) -->
      @if (currentOwnership().length || ownershipTimeline().length) {
        <div class="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
          <div class="border-b border-gray-100 px-6 py-3 flex items-center justify-between">
            <h2 class="text-sm font-semibold text-gray-700">Vessel Ownership Timeline</h2>
            @if (ownershipLastReported()) {
              <span class="text-xs text-blue-600 font-medium">Last Reported {{ ownershipLastReported() }}</span>
            }
          </div>

          <!-- Current Ownership -->
          @if (currentOwnership().length) {
            <div class="px-6 pt-5 pb-3">
              <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Current Ownership</h3>
              <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
                @for (entry of currentOwnership(); track entry.typeCode + entry.companyId) {
                  <div class="rounded-lg border border-gray-200 bg-gray-50/50 p-3 border-l-4 {{ roleBorderClass(entry.typeCode) }} min-w-0">
                    <div class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{{ entry.type }}</div>
                    @if (entry.companyId) {
                      <button (click)="navigateToCompany(entry)" class="text-sm font-semibold text-blue-700 leading-snug break-words text-left hover:text-blue-900 hover:underline transition-colors cursor-pointer">
                        @if (navigatingCompanyId() === entry.companyId) {
                          <span class="inline-flex items-center gap-1"><svg class="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> {{ entry.companyName }}</span>
                        } @else {
                          {{ entry.companyName }}
                        }
                      </button>
                    } @else {
                      <div class="text-sm font-semibold text-gray-700 leading-snug break-words">{{ entry.companyName }}</div>
                    }
                    @if (entry.country.name) {
                      <div class="flex items-center gap-1.5 mt-2">
                        <span class="text-sm flex-shrink-0">{{ ownerFlag(entry) }}</span>
                        <span class="text-xs text-gray-600">{{ entry.country.name }}</span>
                      </div>
                    }
                    <div class="text-[10px] text-gray-400 mt-1">{{ ownerDateRange(entry) }}</div>
                  </div>
                }
              </div>
            </div>
          }

          <!-- Historical Ownership Changes -->
          @if (ownershipTimeline().length) {
            <div class="px-6 pt-4 pb-5 border-t border-gray-100">
              <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Historical Ownership Changes</h3>
              <div class="relative">
                <!-- Timeline line -->
                <div class="absolute left-[52px] top-0 bottom-0 w-px bg-gray-200"></div>

                @for (group of ownershipTimeline(); track group.label) {
                  <div class="relative flex gap-4 mb-5 last:mb-0">
                    <!-- Date label -->
                    <div class="w-[44px] flex-shrink-0 text-right pt-0.5">
                      <span class="text-xs font-semibold text-gray-500 leading-tight">{{ group.label }}</span>
                    </div>
                    <!-- Dot on timeline -->
                    <div class="flex-shrink-0 w-[17px] flex items-start justify-center pt-1.5 relative z-10">
                      <div class="w-2.5 h-2.5 rounded-full bg-gray-300 ring-2 ring-white"></div>
                    </div>
                    <!-- Cards row -->
                    <div class="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                      @for (entry of group.entries; track entry.typeCode + entry.companyId + entry.from) {
                        <div class="rounded-lg border border-gray-200 bg-white p-2.5 text-xs border-l-4 {{ roleBorderClass(entry.typeCode) }} min-w-0">
                          <div class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{{ entry.type }}</div>
                          @if (entry.companyId) {
                            <button (click)="navigateToCompany(entry)" class="text-xs font-semibold text-blue-700 mt-0.5 break-words text-left hover:text-blue-900 hover:underline transition-colors cursor-pointer">
                              @if (navigatingCompanyId() === entry.companyId) {
                                <span class="inline-flex items-center gap-1"><svg class="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> {{ entry.companyName }}</span>
                              } @else {
                                {{ entry.companyName }}
                              }
                            </button>
                          } @else {
                            <div class="text-xs font-semibold text-gray-700 mt-0.5 break-words">{{ entry.companyName }}</div>
                          }
                          @if (entry.country.name) {
                            <div class="flex items-center gap-1 mt-1">
                              <span class="text-xs flex-shrink-0">{{ ownerFlag(entry) }}</span>
                              <span class="text-[11px] text-gray-500">{{ entry.country.name }}</span>
                            </div>
                          }
                          <div class="text-[10px] text-gray-400 mt-0.5">{{ ownerDateRange(entry) }}</div>
                        </div>
                      }
                    </div>
                  </div>
                }
              </div>
            </div>
          }
        </div>
      }

      <!-- Movements / Port Calls -->
      @if (vessel()!.seasearcherId) {
        <div class="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
          <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
            <h2 class="text-sm font-semibold text-gray-700">Port Call History</h2>
            @if (movements().length) {
              <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">{{ movements().length }}</span>
            }
          </div>
          @if (movementsLoading()) {
            <div class="flex items-center justify-center py-8">
              <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            </div>
          } @else if (movements().length) {
            <div class="overflow-auto max-h-[500px]">
              <table class="w-full text-sm">
                <thead class="sticky top-0 z-10">
                  <tr class="border-b border-gray-100 bg-gray-50">
                    <th class="px-5 py-2 text-left font-medium text-gray-500">Port</th>
                    <th class="px-5 py-2 text-left font-medium text-gray-500">Country</th>
                    <th class="px-5 py-2 text-left font-medium text-gray-500">Arrived</th>
                    <th class="px-5 py-2 text-left font-medium text-gray-500">Departed</th>
                    <th class="px-5 py-2 text-left font-medium text-gray-500">Duration</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-50">
                  @for (m of movements(); track $index) {
                    <tr class="hover:bg-gray-50/50 transition-colors">
                      <td class="px-5 py-2.5 font-medium">
                        @if (m.placeId || m.place?.id) {
                          <button (click)="navigateToPlace(m.placeId ?? m.place.id)" class="text-blue-700 hover:text-blue-900 hover:underline transition-colors cursor-pointer text-left">
                            @if (navigatingPlaceId() === (m.placeId ?? m.place?.id)) {
                              <span class="inline-flex items-center gap-1"><svg class="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> {{ m.port ?? m.place?.name ?? '—' }}</span>
                            } @else {
                              {{ m.port ?? m.place?.name ?? '—' }}
                            }
                          </button>
                        } @else {
                          <span class="text-gray-900">{{ m.port ?? m.place?.name ?? '—' }}</span>
                        }
                      </td>
                      <td class="px-5 py-2.5 text-gray-600">
                        @if (movementFlag(m)) { {{ movementFlag(m) }} }
                        {{ m.countryName ?? m.place?.country?.name ?? '—' }}
                      </td>
                      <td class="px-5 py-2.5 text-gray-600">{{ m.from ? (m.from | date:'mediumDate') : '—' }}</td>
                      <td class="px-5 py-2.5 text-gray-600">{{ m.to ? (m.to | date:'mediumDate') : '—' }}</td>
                      <td class="px-5 py-2.5 text-gray-600">
                        @if (m.durationHumanized) {
                          {{ m.durationHumanized }}
                        } @else if (m.from && !m.to) {
                          <span class="text-green-600 text-xs font-medium">In port</span>
                        } @else { — }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <div class="px-5 py-6 text-center text-sm text-gray-400">No port call history found</div>
          }
        </div>
      }

      <!-- Activity History -->
      <div class="mt-6">
        <app-activity-timeline entityType="vessel" [entityId]="vessel()!.id" />
      </div>

      <!-- Comments -->
      <div class="mt-6">
        <app-comments-card entityType="vessel" [entityId]="vessel()!.id" />
      </div>

      <!-- Delete Confirmation -->
      @if (confirmDeleteOpen() && canDeleteEntity()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 class="text-lg font-semibold text-gray-900">Delete Vessel</h3>
            <p class="mt-2 text-sm text-gray-600">
              Are you sure you want to delete <strong>{{ vessel()!.name }}</strong>?
            </p>
            @if (deleteError()) {
              <p class="mt-2 text-sm text-red-600">{{ deleteError() }}</p>
            }
            <div class="mt-4 flex justify-end gap-3">
              <button (click)="confirmDeleteOpen.set(false)" class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button (click)="executeDelete()" [disabled]="deleting()" class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
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
    } @else {
      <div class="text-center py-20 text-gray-400">Vessel not found</div>
    }
  `,
})
export class VesselDetailPageComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly pageTitle = inject(Title);
  private readonly wsService = inject(WebSocketService);
  private readonly authService = inject(AuthService);

  readonly loading = signal(true);
  readonly canDeleteEntity = computed(() => this.authService.isAdmin());
  readonly vessel = signal<VesselDto | null>(null);
  readonly syncing = signal(false);

  // Enrichment
  readonly enrichment = signal<any>(null);
  readonly enrichmentLoading = signal(false);

  // Orders
  readonly vesselOrders = signal<any[]>([]);
  readonly ordersLoading = signal(false);

  // Movements
  readonly movements = signal<any[]>([]);
  readonly movementsLoading = signal(false);

  // Map
  readonly positionMapEl = viewChild<ElementRef<HTMLDivElement>>('positionMapEl');
  private positionMap: L.Map | null = null;
  private positionMapInitialized = false;
  private routeSub: Subscription | null = null;
  private syncSub: Subscription | null = null;

  // Editing
  readonly editing = signal(false);
  readonly editSaving = signal(false);
  readonly editName = signal('');
  readonly editImo = signal('');
  readonly editFlag = signal('');
  readonly editType = signal('');
  readonly editMmsi = signal('');
  readonly editStatus = signal('');
  readonly editBuildYear = signal<string>('');
  readonly editBuilder = signal('');
  readonly editClassification = signal('');
  readonly editLoa = signal('');
  readonly editBreadth = signal('');
  readonly editDepth = signal('');
  readonly editDraught = signal('');
  readonly editDwt = signal('');
  readonly editGrossTonnage = signal('');

  // Company navigation
  readonly navigatingCompanyId = signal<string | null>(null);

  // Place navigation
  readonly navigatingPlaceId = signal<string | null>(null);

  // Delete
  readonly confirmDeleteOpen = signal(false);
  readonly deleting = signal(false);
  readonly deleteError = signal('');
  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);

  // Vessel Companies
  readonly vesselCompanies = signal<VesselCompanyDto[]>([]);
  readonly companiesLoading = signal(false);
  readonly showAddCompany = signal(false);
  readonly companyForm = signal<{ companyId: string; role: VesselCompanyRole; contactId: string | null; note: string }>({ companyId: '', role: 'OWNER', contactId: null, note: '' });
  readonly editingCompanyId = signal<string | null>(null);
  readonly savingCompany = signal(false);
  readonly companySearch = signal('');
  readonly companySearchResults = signal<CompanySearchResultOption[]>([]);
  readonly selectedCompany = signal<{ id: string; name: string } | null>(null);
  private companySearchTimeout: ReturnType<typeof setTimeout> | null = null;
  readonly companyContacts = signal<CompanyContactDto[]>([]);
  readonly companyContactsLoading = signal(false);
  readonly roleOptions: VesselCompanyRole[] = ['OWNER', 'TIME_CHARTERER', 'OPERATOR', 'MANAGER'];

  // Flag emoji
  readonly vesselFlag = computed(() => {
    const v = this.vessel();
    if (!v) return '';
    return flagFromIso3(v.flagCode ?? null);
  });

  // Position timestamp
  readonly positionTimestamp = computed<string>(() => {
    const enr = this.enrichment();
    const ts = enr?.latestInformation?.position?.timeStamp ?? enr?.latestInformation?.lastUpdated;
    if (!ts) return '';
    // Parse — Seasearcher uses ISO or "dd/MM/yyyy HH:mm:ss (GMT)"
    let d: Date;
    if (typeof ts === 'string' && ts.includes('/')) {
      // "07/02/2026 19:44:31 (GMT)" → extract before " ("
      const clean = ts.replace(/\s*\(.*\)/, '');
      const [datePart, timePart] = clean.split(' ');
      const [day, month, year] = datePart.split('/');
      d = new Date(`${year}-${month}-${day}T${timePart}Z`);
    } else {
      d = new Date(ts + (ts.endsWith('Z') ? '' : 'Z'));
    }
    if (isNaN(d.getTime())) return '';
    return d.toISOString();
  });

  readonly positionAge = computed<string>(() => {
    const iso = this.positionTimestamp();
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return 'just now';
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ${hrs % 24}h ago`;
  });

  // Destination + ETA (best available from multiple Seasearcher fields)
  readonly destinationInfo = computed<{ name: string; country: string; flag: string; eta: string | null; placeId: string | null }>(() => {
    const enr = this.enrichment();
    if (!enr) return { name: '', country: '', flag: '', eta: null, placeId: null };

    // Primary: destination.place
    const dest = enr.destination;
    if (dest?.place?.name && dest.place.name !== 'UNKNOWN') {
      return {
        name: dest.place.name,
        country: dest.country?.name ?? '',
        flag: flagFromIso3(dest.country?.code ?? null),
        eta: dest.eta ?? enr.vesselProbableDestination?.eta ?? null,
        placeId: dest.place.id ?? enr.vesselProbableDestination?.placeId ?? null,
      };
    }

    // Fallback: vesselProbableDestination
    const vpd = enr.vesselProbableDestination;
    if (vpd?.destinationName) {
      return {
        name: vpd.destinationName,
        country: vpd.country?.name ?? '',
        flag: flagFromIso3(vpd.country?.code ?? vpd.countryCode ?? null),
        eta: vpd.eta ?? null,
        placeId: vpd.placeId ?? null,
      };
    }

    // Fallback: AIS destination
    const ais = enr.aisDestinationWithoutReportedEta;
    if (ais?.reportedDestinationPlace?.name) {
      return {
        name: ais.reportedDestinationPlace.name,
        country: ais.reportedDestinationPlace.country?.name ?? '',
        flag: flagFromIso3(ais.reportedDestinationPlace.country?.code ?? null),
        eta: ais.aisEta ?? null,
        placeId: ais.reportedDestinationPlace.id ?? null,
      };
    }

    // Fallback: latestInformation.destination (raw string)
    const liDest = enr.latestInformation?.destination;
    if (liDest) {
      return { name: liDest, country: '', flag: '', eta: null, placeId: null };
    }

    return { name: '', country: '', flag: '', eta: null, placeId: null };
  });

  // Ownership — current entries (cards)
  readonly currentOwnership = computed<OwnershipEntry[]>(() => {
    const enr = this.enrichment();
    if (!enr?.ownershipHistory) return [];
    const all: OwnershipEntry[] = enr.ownershipHistory;
    return all
      .filter((e: OwnershipEntry) => e.currentIndicator)
      .sort((a: OwnershipEntry, b: OwnershipEntry) => (ROLE_ORDER[a.typeCode] ?? 99) - (ROLE_ORDER[b.typeCode] ?? 99));
  });

  // Ownership — historical timeline (grouped by start-month)
  readonly ownershipTimeline = computed<TimelineGroup[]>(() => {
    const enr = this.enrichment();
    if (!enr?.ownershipHistory) return [];
    const all: OwnershipEntry[] = enr.ownershipHistory;
    const past = all.filter((e: OwnershipEntry) => !e.currentIndicator);

    // Group by the month/year the entry started
    const groups = new Map<string, TimelineGroup>();
    for (const entry of past) {
      const d = new Date(entry.from);
      const label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      const sortKey = d.getTime();
      if (!groups.has(label)) {
        groups.set(label, { label, sortKey, entries: [] });
      }
      groups.get(label)!.entries.push(entry);
    }

    // Sort groups newest-first, entries within each group by role order
    const sorted = [...groups.values()].sort((a, b) => b.sortKey - a.sortKey);
    for (const g of sorted) {
      g.entries.sort((a, b) => (ROLE_ORDER[a.typeCode] ?? 99) - (ROLE_ORDER[b.typeCode] ?? 99));
    }
    return sorted;
  });

  // Last reported date for ownership
  readonly ownershipLastReported = computed<string>(() => {
    const enr = this.enrichment();
    if (!enr?.ownershipHistory?.length) return '';
    const all: OwnershipEntry[] = enr.ownershipHistory;
    const current = all.filter((e: OwnershipEntry) => e.currentIndicator);
    if (!current.length) return '';
    const dates = current.map((e: OwnershipEntry) => new Date(e.from).getTime());
    const latest = new Date(Math.max(...dates));
    return latest.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  });

  constructor() {
    // React to map element appearing in the DOM
    effect(() => {
      const mapEl = this.positionMapEl();
      const enr = this.enrichment();
      if (mapEl && enr?.latestInformation?.position && !this.positionMapInitialized) {
        this.positionMapInitialized = true;
        // Defer to next tick so the DOM element has dimensions
        setTimeout(() => this.initPositionMap(), 0);
      }
    });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.loadVessel(id);

    // React to same-route navigation (e.g. clicking related vessel links)
    this.routeSub = this.route.paramMap.pipe(skip(1)).subscribe((params) => {
      const newId = params.get('id');
      if (newId) {
        this.resetState();
        this.loadVessel(newId);
      }
    });

    // Listen for auto-sync results pushed from the backend
    this.syncSub = this.wsService.on<VesselDto>('vessel-synced').subscribe((data) => {
      const current = this.vessel();
      if (current && data.id === current.id) {
        this.vessel.set(data);
        this.syncing.set(false);
      }
    });
  }

  private resetState(): void {
    if (this.positionMap) {
      this.positionMap.remove();
      this.positionMap = null;
    }
    this.positionMapInitialized = false;
    this.vessel.set(null);
    this.enrichment.set(null);
    this.loading.set(true);
    this.vesselOrders.set([]);
    this.movements.set([]);
    this.editing.set(false);
  }

  async loadVessel(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<VesselDto>>(`${API}/vessels/local/${id}`),
      );
      if (res.success && res.data) {
        this.vessel.set(res.data);
        this.pageTitle.setTitle(`Fueld | Vessels > ${res.data.name}`);
        this.wsService.sendPresence(this.router.url, this.pageTitle.getTitle());

        // Show syncing indicator — backend auto-syncs via WS presence
        if (res.data.seasearcherId) {
          this.syncing.set(true);
        }

        // Load enrichment + orders + movements + companies in parallel
        this.loadEnrichment(res.data.seasearcherId);
        this.loadOrders(id);
        this.loadMovements(res.data.seasearcherId);
        this.loadVesselCompanies(id);
      }
    } catch (err) {
      console.error('Failed to load vessel:', err);
    } finally {
      this.loading.set(false);
    }
  }

  async syncFromSeasearcher(): Promise<void> {
    const v = this.vessel();
    if (!v?.seasearcherId) return;

    this.syncing.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<VesselDto>>(`${API}/vessels/local/${v.id}/sync`, {}),
      );
      if (res.success && res.data) {
        this.vessel.set(res.data);
      }
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      this.syncing.set(false);
    }
  }

  async loadEnrichment(seasearcherId: string | null): Promise<void> {
    if (!seasearcherId) return;
    this.enrichmentLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<any>>(`${API}/vessels/enrichment/${seasearcherId}`),
      );
      if (res.success && res.data) {
        this.enrichment.set(res.data);
      }
    } catch {
      // Enrichment is optional
    } finally {
      this.enrichmentLoading.set(false);
    }
  }

  async loadOrders(vesselId: string): Promise<void> {
    this.ordersLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<any[]>>(`${API}/vessels/local/${vesselId}/orders`),
      );
      if (res.success && res.data) {
        this.vesselOrders.set(res.data);
      }
    } catch {
      // Orders are optional
    } finally {
      this.ordersLoading.set(false);
    }
  }

  async loadMovements(seasearcherId: string | null): Promise<void> {
    if (!seasearcherId) return;
    this.movementsLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<any[]>>(`${API}/vessels/movements/${seasearcherId}`),
      );
      if (res.success && res.data) {
        this.movements.set(res.data);
      }
    } catch {
      // Movements are optional
    } finally {
      this.movementsLoading.set(false);
    }
  }

  // ─── Map ─────────────────────────────────────────────────────────

  private initPositionMap(): void {
    const mapEl = this.positionMapEl();
    if (!mapEl) return;

    const pos = this.enrichment()?.latestInformation?.position;
    if (!pos) return;

    const lat = pos.lat;
    const lng = pos.lng ?? pos.lon;
    if (lat == null || lng == null) return;

    this.positionMap = L.map(mapEl.nativeElement, {
      zoomControl: true,
      attributionControl: false,
    }).setView([lat, lng], 8);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(this.positionMap);

    const heading = this.enrichment()?.latestInformation?.trueHeading;
    const speed = this.enrichment()?.latestInformation?.aisSpeed;
    const dest = this.enrichment()?.latestInformation?.destination;
    const isSanctioned = this.enrichment()?.isSanctioned === true;
    const loaVal = this.vessel()?.loa ?? null;

    // Create initial marker with dynamic vessel icon
    const zoom = this.positionMap.getZoom();
    const icon = vesselIcon(heading, loaVal, zoom, lat, isSanctioned);

    const vesselName = this.vessel()?.name ?? 'Vessel';
    let popupHtml = `<div style="font-family:system-ui;font-size:13px;min-width:140px"><strong>${vesselName}</strong>`;
    popupHtml += `<br><span style="color:#6b7280">Lat:</span> ${lat.toFixed(4)}`;
    popupHtml += `<br><span style="color:#6b7280">Lng:</span> ${lng.toFixed(4)}`;
    if (speed != null) popupHtml += `<br><span style="color:#6b7280">Speed:</span> ${speed} kn`;
    if (heading != null) popupHtml += `<br><span style="color:#6b7280">Heading:</span> ${heading}°`;
    if (dest) popupHtml += `<br><span style="color:#6b7280">Dest:</span> ${dest}`;
    popupHtml += '</div>';

    const marker = L.marker([lat, lng], { icon })
      .addTo(this.positionMap)
      .bindPopup(popupHtml);

    // Re-render marker on zoom change so size scales dynamically
    this.positionMap.on('zoomend', () => {
      const z = this.positionMap!.getZoom();
      marker.setIcon(vesselIcon(heading, loaVal, z, lat, isSanctioned));
    });
  }

  ngOnDestroy(): void {
    if (this.positionMap) {
      this.positionMap.remove();
      this.positionMap = null;
    }
    this.routeSub?.unsubscribe();
    this.syncSub?.unsubscribe();
  }

  getDurationDays(arrival: string, departure: string): string {
    const ms = new Date(departure).getTime() - new Date(arrival).getTime();
    const days = Math.round(ms / (1000 * 60 * 60 * 24));
    if (days === 0) return '< 1 day';
    return days === 1 ? '1 day' : `${days} days`;
  }

  movementFlag(m: any): string {
    const code = m.flag ?? m.place?.country?.code ?? null;
    return flagFromIso3(code);
  }

  flagFromCountryCode(code: string | null): string {
    return flagFromIso3(code);
  }

  formatDate(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  etaRelative(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const ms = d.getTime() - Date.now();
    if (ms < 0) return 'arrived';
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    const hrs = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days === 0 && hrs === 0) return 'arriving soon';
    if (days === 0) return `in ${hrs}h`;
    if (days === 1) return hrs > 0 ? `in 1 day ${hrs}h` : 'in 1 day';
    return `in ${days} days`;
  }

  ownerFlag(entry: OwnershipEntry): string {
    return flagFromIso3(entry.country.code ?? null);
  }

  ownerDateRange(entry: OwnershipEntry): string {
    const from = new Date(entry.from).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    if (!entry.to) return `From ${from} to present`;
    const to = new Date(entry.to).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    return `From ${from} to ${to}`;
  }

  async navigateToCompany(entry: OwnershipEntry): Promise<void> {
    if (!entry.companyId || this.navigatingCompanyId()) return;
    await this.navigateToCompanyById(entry.companyId);
  }

  async navigateToCompanyById(seasearcherId: string): Promise<void> {
    if (this.navigatingCompanyId()) return;
    this.navigatingCompanyId.set(seasearcherId);
    try {
      // Check if company already exists locally
      const lookup = await firstValueFrom(
        this.http.get<ApiResponse<CounterpartyDto>>(`${API}/companies/by-seasearcher/${seasearcherId}`),
      );
      if (lookup.success && lookup.data) {
        this.router.navigate(['/companies', lookup.data.id]);
        return;
      }
      // Import from Seasearcher
      const imported = await firstValueFrom(
        this.http.post<ApiResponse<CounterpartyDto>>(`${API}/companies/import`, { seasearcherId }),
      );
      if (imported.success && imported.data) {
        this.router.navigate(['/companies', imported.data.id]);
      }
    } catch (err) {
      console.error('Failed to navigate to company:', err);
    } finally {
      this.navigatingCompanyId.set(null);
    }
  }

  async navigateToPlace(lliPlaceId: string): Promise<void> {
    if (this.navigatingPlaceId()) return;
    this.navigatingPlaceId.set(lliPlaceId);
    try {
      // Check if place already exists locally
      const lookup = await firstValueFrom(
        this.http.get<ApiResponse<{ id: string }>>(`${API}/lloyds/places/by-lli/${lliPlaceId}`),
      );
      if (lookup.success && lookup.data) {
        this.router.navigate(['/places', lookup.data.id]);
        return;
      }
      // Import from Seasearcher
      const imported = await firstValueFrom(
        this.http.post<ApiResponse<{ id: string }>>(`${API}/lloyds/places/import`, { lliPlaceId }),
      );
      if (imported.success && imported.data) {
        this.router.navigate(['/places', imported.data.id]);
      }
    } catch (err) {
      console.error('Failed to navigate to place:', err);
    } finally {
      this.navigatingPlaceId.set(null);
    }
  }

  roleBorderClass(typeCode: string): string {
    return ROLE_BORDER_COLORS[typeCode] ?? 'border-l-gray-300';
  }

  // ─── Editing ───────────────────────────────────────────────────────
  startEditing(): void {
    const v = this.vessel()!;
    this.editName.set(v.name);
    this.editImo.set(v.imo ?? '');
    this.editFlag.set(v.flag ?? '');
    this.editType.set(v.type ?? '');
    this.editMmsi.set(v.mmsi ?? '');
    this.editStatus.set(v.status ?? '');
    this.editBuildYear.set(v.buildYear != null ? String(v.buildYear) : '');
    this.editBuilder.set(v.builder ?? '');
    this.editClassification.set(v.classificationSociety ?? '');
    this.editLoa.set(v.loa != null ? String(v.loa) : '');
    this.editBreadth.set(v.breadth != null ? String(v.breadth) : '');
    this.editDepth.set(v.depth != null ? String(v.depth) : '');
    this.editDraught.set(v.draught != null ? String(v.draught) : '');
    this.editDwt.set(v.deadWeightTonnage != null ? String(v.deadWeightTonnage) : '');
    this.editGrossTonnage.set(v.grossTonnage != null ? String(v.grossTonnage) : '');
    this.editing.set(true);
  }

  cancelEditing(): void {
    this.editing.set(false);
  }

  async saveEditing(): Promise<void> {
    const v = this.vessel()!;
    this.editSaving.set(true);
    try {
      const body: Record<string, unknown> = {};
      if (this.editName() !== v.name) body['name'] = this.editName();
      if (this.editImo() !== (v.imo ?? '')) body['imo'] = this.editImo() || undefined;
      if (this.editFlag() !== (v.flag ?? '')) body['flag'] = this.editFlag() || undefined;
      if (this.editType() !== (v.type ?? '')) body['type'] = this.editType() || undefined;
      if (this.editMmsi() !== (v.mmsi ?? '')) body['mmsi'] = this.editMmsi() || undefined;
      if (this.editStatus() !== (v.status ?? '')) body['status'] = this.editStatus() || undefined;
      if (this.editBuilder() !== (v.builder ?? '')) body['builder'] = this.editBuilder() || undefined;
      if (this.editClassification() !== (v.classificationSociety ?? '')) body['classificationSociety'] = this.editClassification() || undefined;

      // Numeric fields — parse to number or undefined
      const byStr = this.editBuildYear().trim();
      const byVal = byStr ? parseInt(byStr, 10) : undefined;
      if ((byVal ?? null) !== (v.buildYear ?? null)) body['buildYear'] = byVal;

      const loaStr = this.editLoa().trim();
      const loaVal = loaStr ? parseFloat(loaStr) : undefined;
      if ((loaVal ?? null) !== (v.loa ?? null)) body['loa'] = loaVal;

      const breadthStr = this.editBreadth().trim();
      const breadthVal = breadthStr ? parseFloat(breadthStr) : undefined;
      if ((breadthVal ?? null) !== (v.breadth ?? null)) body['breadth'] = breadthVal;

      const depthStr = this.editDepth().trim();
      const depthVal = depthStr ? parseFloat(depthStr) : undefined;
      if ((depthVal ?? null) !== (v.depth ?? null)) body['depth'] = depthVal;

      const draughtStr = this.editDraught().trim();
      const draughtVal = draughtStr ? parseFloat(draughtStr) : undefined;
      if ((draughtVal ?? null) !== (v.draught ?? null)) body['draught'] = draughtVal;

      const dwtStr = this.editDwt().trim();
      const dwtVal = dwtStr ? parseFloat(dwtStr) : undefined;
      if ((dwtVal ?? null) !== (v.deadWeightTonnage ?? null)) body['deadWeightTonnage'] = dwtVal;

      const gtStr = this.editGrossTonnage().trim();
      const gtVal = gtStr ? parseFloat(gtStr) : undefined;
      if ((gtVal ?? null) !== (v.grossTonnage ?? null)) body['grossTonnage'] = gtVal;

      if (Object.keys(body).length) {
        const res = await firstValueFrom(
          this.http.patch<ApiResponse<VesselDto>>(`${API}/vessels/local/${v.id}`, body),
        );
        if (res.success && res.data) {
          this.vessel.set(res.data);
        }
      }
      this.editing.set(false);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      this.editSaving.set(false);
    }
  }

  // ─── Delete ────────────────────────────────────────────────────────
  async executeDelete(): Promise<void> {
    if (!this.canDeleteEntity()) {
      this.deleteError.set('Only admins can delete vessels');
      return;
    }
    const v = this.vessel()!;
    this.deleting.set(true);
    try {
      const res = await firstValueFrom(
        this.http.delete<ApiResponse<{ id: string }>>(`${API}/vessels/local/${v.id}`),
      );
      if (res.success) {
        this.router.navigate(['/vessels']);
      } else {
        this.deleteError.set(res.message ?? 'Failed to delete');
      }
    } catch {
      this.deleteError.set('Failed to delete vessel');
    } finally {
      this.deleting.set(false);
    }
  }

  // ─── Navigation ────────────────────────────────────────────────────
  goBack(): void {
    this.router.navigate(['/vessels']);
  }

  goToOrder(orderId: string): void {
    this.router.navigate(['/trading/orders', orderId]);
  }

  // ─── Helpers ───────────────────────────────────────────────────────
  statusBadgeClass(status: string): string {
    switch (status) {
      case 'CONFIRMED': return 'bg-green-100 text-green-700';
      case 'DELIVERED': return 'bg-blue-100 text-blue-700';
      case 'INQUIRY': return 'bg-amber-100 text-amber-700';
      case 'CANCELLED': case 'LOST': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  }

  private showToast(type: 'success' | 'error', message: string): void {
    this.toast.set({ type, message });
    setTimeout(() => this.toast.set(null), 4000);
  }

  // ─── Vessel Companies ──────────────────────────────────────────────
  private async loadVesselCompanies(vesselId: string): Promise<void> {
    this.companiesLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<VesselCompanyDto[]>>(`${API}/vessels/local/${vesselId}/companies`),
      );
      if (res.success && res.data) {
        this.vesselCompanies.set(res.data);
      }
    } catch (err) {
      console.error('Failed to load vessel companies:', err);
    } finally {
      this.companiesLoading.set(false);
    }
  }

  openAddCompany(): void {
    this.companyForm.set({ companyId: '', role: 'OWNER', contactId: null, note: '' });
    this.editingCompanyId.set(null);
    this.selectedCompany.set(null);
    this.companySearch.set('');
    this.companySearchResults.set([]);
    this.companyContacts.set([]);
    this.showAddCompany.set(true);
  }

  openEditCompany(vc: VesselCompanyDto): void {
    this.companyForm.set({ companyId: vc.companyId, role: vc.role, contactId: vc.contactId ?? null, note: vc.note ?? '' });
    this.editingCompanyId.set(vc.id);
    this.selectedCompany.set(null);
    this.companySearch.set('');
    this.companySearchResults.set([]);
    this.loadCompanyContacts(vc.companyId);
    this.showAddCompany.set(true);
  }

  cancelCompanyForm(): void {
    this.showAddCompany.set(false);
    this.editingCompanyId.set(null);
    this.selectedCompany.set(null);
    this.companySearch.set('');
    this.companySearchResults.set([]);
    this.companyContacts.set([]);
  }

  onCompanySearch(term: string): void {
    this.companySearch.set(term);
    if (this.companySearchTimeout) clearTimeout(this.companySearchTimeout);
    if (term.length < 2) {
      this.companySearchResults.set([]);
      return;
    }
    this.companySearchTimeout = setTimeout(async () => {
      try {
        const res = await firstValueFrom(
          this.http.get<ApiResponse<{ companies: { id: string; name: string; country: string | null }[] }>>(`${API}/companies/local?search=${encodeURIComponent(term)}&limit=15`),
        );
        const localResults = res.success && res.data ? res.data.companies : [];

        if (localResults.length) {
          this.companySearchResults.set(
            localResults.map((c) => ({
              key: c.id,
              source: 'local',
              id: c.id,
              name: c.name,
              country: c.country,
            })),
          );
          return;
        }

        const importRes = await firstValueFrom(
          this.http.get<ApiResponse<CompanySearchResult[]>>(
            `${API}/companies/search?term=${encodeURIComponent(term)}`,
          ),
        );
        if (importRes.success && importRes.data) {
          this.companySearchResults.set(
            importRes.data
              .filter((r) => r.source === 'seasearcher' && r.seasearcherId)
              .map((r) => ({
                key: `seasearcher:${r.seasearcherId}`,
                source: 'seasearcher',
                seasearcherId: r.seasearcherId,
                name: r.name,
                country: r.country ?? null,
              })),
          );
        } else {
          this.companySearchResults.set([]);
        }
      } catch {
        this.companySearchResults.set([]);
      }
    }, 250);
  }

  async selectCompany(c: CompanySearchResultOption): Promise<void> {
    if (c.source === 'seasearcher' && c.seasearcherId) {
      await this.importCompanyFromSeasearcher(c.seasearcherId);
      return;
    }
    if (!c.id) return;
    this.selectedCompany.set({ id: c.id, name: c.name });
    this.companyForm.set({ ...this.companyForm(), companyId: c.id });
    this.companySearch.set('');
    this.companySearchResults.set([]);
    this.loadCompanyContacts(c.id);
  }

  private async importCompanyFromSeasearcher(seasearcherId: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<CounterpartyDto>>(`${API}/companies/import`, { seasearcherId }),
      );
      if (res.success && res.data) {
        this.selectedCompany.set({ id: res.data.id, name: res.data.name });
        this.companyForm.set({ ...this.companyForm(), companyId: res.data.id });
        this.companySearch.set('');
        this.companySearchResults.set([]);
        this.loadCompanyContacts(res.data.id);
      } else {
        console.error('Failed to import company:', res.message ?? 'Unknown error');
      }
    } catch {
      console.error('Failed to import company.');
    }
  }

  clearSelectedCompany(): void {
    this.selectedCompany.set(null);
    this.companyForm.set({ ...this.companyForm(), companyId: '', contactId: null });
    this.companySearch.set('');
    this.companyContacts.set([]);
  }

  selectedCompanyRoleExists(): boolean {
    const selected = this.selectedCompany();
    if (!selected) return false;
    const role = this.companyForm().role;
    return this.vesselCompanies().some((vc) => vc.companyId === selected.id && vc.role === role);
  }

  private async loadCompanyContacts(companyId: string): Promise<void> {
    this.companyContactsLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CompanyContactDto[]>>(`${API}/companies/local/${companyId}/contacts`),
      );
      if (res.success && res.data) {
        this.companyContacts.set(res.data);
      }
    } catch {
      this.companyContacts.set([]);
    } finally {
      this.companyContactsLoading.set(false);
    }
  }

  formatRole(role: VesselCompanyRole): string {
    switch (role) {
      case 'OWNER': return 'Owner';
      case 'TIME_CHARTERER': return 'Time Charterer';
      case 'OPERATOR': return 'Operator';
      case 'MANAGER': return 'Manager';
      default: return role;
    }
  }

  async saveVesselCompany(): Promise<void> {
    const v = this.vessel();
    if (!v) return;
    const form = this.companyForm();

    this.savingCompany.set(true);
    try {
      const editId = this.editingCompanyId();
      if (editId) {
        const res = await firstValueFrom(
          this.http.patch<ApiResponse<VesselCompanyDto>>(`${API}/vessels/local/${v.id}/companies/${editId}`, {
            role: form.role,
            contactId: form.contactId,
            note: form.note.trim() || undefined,
          }),
        );
        if (res && res.success === false) {
          this.showToast('error', res.message ?? 'Failed to update company role.');
          return;
        }
      } else {
        if (!form.companyId) return;
        const replaceExistingRole = this.selectedCompanyRoleExists()
          ? window.confirm('This role already exists for this vessel. Replace the existing one?')
          : false;
        if (this.selectedCompanyRoleExists() && !replaceExistingRole) {
          this.showToast('error', 'Role already exists for this vessel.');
          return;
        }
        const res = await firstValueFrom(
          this.http.post<ApiResponse<VesselCompanyDto>>(`${API}/vessels/local/${v.id}/companies`, {
            companyId: form.companyId,
            role: form.role,
            contactId: form.contactId,
            note: form.note.trim() || undefined,
            replaceExistingRole: replaceExistingRole || undefined,
          }),
        );
        if (res && res.success === false) {
          if ((res.message ?? '').includes('Role already exists for this vessel')) {
            const confirmReplace = window.confirm('This role already exists for this vessel. Replace the existing one?');
            if (confirmReplace) {
              const retry = await firstValueFrom(
                this.http.post<ApiResponse<VesselCompanyDto>>(`${API}/vessels/local/${v.id}/companies`, {
                  companyId: form.companyId,
                  role: form.role,
                  contactId: form.contactId,
                  note: form.note.trim() || undefined,
                  replaceExistingRole: true,
                }),
              );
              if (retry && retry.success === false) {
                this.showToast('error', retry.message ?? 'Failed to replace company role.');
                return;
              }
            } else {
              this.showToast('error', 'Role already exists for this vessel.');
              return;
            }
          } else {
            this.showToast('error', res.message ?? 'Failed to add company role.');
            return;
          }
        }
      }
      this.showAddCompany.set(false);
      this.editingCompanyId.set(null);
      this.selectedCompany.set(null);
      this.companyContacts.set([]);
      this.loadVesselCompanies(v.id);
    } catch (err) {
      console.error('Failed to save vessel company:', err);
      this.showToast('error', 'Failed to save company role.');
    } finally {
      this.savingCompany.set(false);
    }
  }

  async deleteVesselCompany(companyId: string): Promise<void> {
    const v = this.vessel();
    if (!v) return;
    try {
      await firstValueFrom(
        this.http.delete(`${API}/vessels/companies/${companyId}`),
      );
      this.loadVesselCompanies(v.id);
    } catch (err) {
      console.error('Failed to delete vessel company:', err);
    }
  }
}
