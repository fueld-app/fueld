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
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { FleetMapCardComponent } from './components/fleet-map-card/fleet-map-card.component';
import { FleetTableCardComponent } from './components/fleet-table-card/fleet-table-card.component';
import { firstValueFrom, Subscription, skip, timeout } from 'rxjs';
import { Title } from '@angular/platform-browser';
import * as L from 'leaflet/dist/leaflet-src.esm.js';
import type { ApiResponse, CompanyAttachmentDto, CompanyContactDto, CompanyEmailDto, CompanyEmailType, CompanyChildSummaryDto, CompanyParentSummaryDto, CompanyGroupAggregateDto, CompanyPlaceSupplyRuleApplySummaryDto, CompanyPlaceSupplyRuleDto, CompanyPlaceSupplyRulePlaceType, CounterpartyDto, PortSupplierDto, RiskHitDto, RiskOverrideDto, SupplyPortDto, VesselCompanyDto, VesselCompanyRole, VesselCompanyRoleOption, VesselDto, OwnCompanyDto } from '@fueld/types';
import { flagFromIso3 } from '../../../../shared/utils/flags';

interface CompanyOfficeDto {
  id: string;
  counterpartyId: string;
  city: string;
  country: string | null;
  countryCode: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  source: string;
  seasearcherOfficeId: number | null;
}
import { COUNTRIES, type Country } from '../../../../shared/data/countries';
import { WebSocketService } from '../../../../core/websocket/websocket.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { ActivityTimelineComponent } from '../../../../shared/components/activity-timeline/activity-timeline.component';
import { CommentsCardComponent } from '../../../../shared/components/comments-card/comments-card.component';
import { CreditApplicationModalComponent } from '../../../credit/components/credit-application-modal.component';
import { RiskMonitoringService } from '../../../../core/risk-monitoring/risk-monitoring.service';
import { CompanyHeaderComponent } from './components/company-header/company-header.component';
import { CompanyInfoCardComponent } from './components/company-info-card/company-info-card.component';
import { ContactsCardComponent } from './components/contacts-card/contacts-card.component';
import { SupplyPortsCardComponent } from './components/supply-ports-card/supply-ports-card.component';
import { FilesCardComponent } from './components/files-card/files-card.component';
import { SegmentsCardComponent } from './components/segments-card/segments-card.component';
import { GroupStructureCardComponent } from './components/group-structure-card/group-structure-card.component';
import { OrdersCardComponent } from './components/orders-card/orders-card.component';
import { RegistrationCardComponent } from './components/registration-card/registration-card.component';
import { NameHistoryCardComponent } from './components/name-history-card/name-history-card.component';
import { RiskComplianceCardComponent } from './components/risk-compliance-card/risk-compliance-card.component';
import type { RiskSummaryDto } from '@fueld/types';
import { API } from '@app/core/config/api';

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

interface LocalPlaceOption {
  id: string;
  name: string;
  unlocode?: string | null;
  parentPlaceUnlocode?: string | null;
  country: string | null;
  source?: 'local' | 'lloyds';
  lliPlaceId?: string;
}

interface SupplyPlaceSearchResult {
  source: 'local' | 'lloyds';
  localId?: string;
  lliPlaceId?: string;
  name: string;
  unlocode?: string | null;
  parentPlaceUnlocode?: string | null;
  country?: string | null;
}

const SUPPLY_PORT_PRODUCT_OPTIONS = ['VLSFO', 'LSMGO', 'IFO380CST', 'MGO', 'LUBE'] as const;

interface PlaceSupplyRuleForm {
  countryIso: string;
  placeTypes: CompanyPlaceSupplyRulePlaceType[];
  contactId: string | null;
  products: string[];
  note: string;
}

const PLACE_SUPPLY_RULE_TYPE_OPTIONS: Array<{ value: CompanyPlaceSupplyRulePlaceType; label: string }> = [
  { value: 'POR', label: 'Port' },
  { value: 'PSP', label: 'Sub Port' },
  { value: 'ANC', label: 'Anchorage' },
  { value: 'TER', label: 'Terminal' },
  { value: 'FIL', label: 'Hydrocarbon Field' },
];

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

interface GroupFleetVessel extends FleetVessel {
  companyId: string;
  companyName: string;
}

interface GroupFleetResponse {
  results: GroupFleetVessel[];
  totalMatches: number;
  queriedCompanyCount: number;
  totalCompanyCount: number;
  truncated: boolean;
  maxCompanies: number;
}

interface GroupVesselRow {
  id: string;
  vesselId: string;
  localVesselId: string | null;
  seasearcherVesselId: string | null;
  vesselName: string;
  vesselImo: string | null;
  companyName: string;
  role: string;
  source: string | null;
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
  imports: [
    FormsModule,
    ActivityTimelineComponent, CommentsCardComponent, CreditApplicationModalComponent,
    CompanyHeaderComponent, CompanyInfoCardComponent,
    FleetMapCardComponent,
    FleetTableCardComponent,
    ContactsCardComponent,
    SupplyPortsCardComponent,
    FilesCardComponent,
    SegmentsCardComponent,
    GroupStructureCardComponent,
    OrdersCardComponent,
    RegistrationCardComponent,
    NameHistoryCardComponent,
    RiskComplianceCardComponent,
  ],
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
        max-height: 449px;
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
        <app-company-header
          [company]="company()!"
          [companyFlag]="companyFlag()"
          [companyTypes]="companyTypes()"
          [riskSummary]="riskSummary()"
          [syncing]="syncing()"
          [canDeleteEntity]="canDeleteEntity()"
          [teamUsers]="teamUsers()"
          [responsibleUserId]="responsibleUserId()"
          [savingResponsible]="savingResponsible()"
          [parentCompany]="parentCompany()"
          [groupAggregate]="groupAggregate()"
          [unlinkingChildId]="unlinkingChildId()"
          (responsibleUserChange)="onResponsibleUserChange($event)"
          (deleteClick)="deleteError.set(''); confirmDeleteOpen.set(true)"
          (monitoringClick)="sanctionsTab.set('monitoring')"
          (syncClick)="syncFromSeasearcher()"
          (seasearcherClick)="syncFromSeasearcher()"
          (unlinkParentClick)="removeOwnParent()"
        />

        <div class="company-card-grid grid grid-cols-1 gap-6 min-[900px]:grid-cols-2 min-[1600px]:grid-cols-3 min-[2000px]:grid-cols-4">
          <!-- Left column -->
          <div class="contents">

            <app-company-info-card
              class="min-[900px]:order-1"
              [company]="company()!"
              [enrichment]="enrichment()"
              [syncConflicts]="syncConflicts()"
              [ownCompanies]="ownCompanies()"
              [allTypes]="allTypes()"
              [companyTypes]="companyTypes()"
              [companyOffices]="companyOffices()"
              [companyEmails]="companyEmails()"
              [emailsLoading]="emailsLoading()"
              (companyChange)="onCompanyInfoSave($event)"
              (typeToggle)="onTypeToggle($event)"
              (conflictAccept)="acceptSeasearcherValue($event)"
              (conflictDismiss)="dismissConflict($event.field, $event.seasearcherValue)"
              (officeSave)="onOfficeSave($event)"
              (officeDelete)="deleteCompanyOffice($event)"
              (emailSave)="onEmailSave($event)"
              (emailDelete)="deleteCompanyEmail($event)"
              (requestCredit)="showCreditApplicationModal.set(true)"
            />

            <!-- Contacts -->
            <app-contacts-card
              [contacts]="contacts()"
              [contactsLoading]="contactsLoading()"
              [companyId]="company()!.id"
              (mutated)="loadContacts(company()!.id)"
            />

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

            <!-- Fake original contacts opening tag removed -->
            <!-- Supplies At wrapped in component -->
            <app-supply-ports-card
              [companyId]="company()!.id"
              [contacts]="contacts()"
              [contactsLoading]="contactsLoading()"
            />

            <!-- app-files-card replaces inline file upload/list -->
            <app-files-card [companyId]="company()!.id" />

            <!-- Segments card -->
            @if (segmentCategories().length > 0) {
              <app-segments-card
                [categories]="segmentCategories()"
                [segments]="companySegments()"
                [saving]="segmentsSaving()"
                (toggle)="onSegmentToggle($event)"
              />
            }

            <!-- Group structure card -->
            <app-group-structure-card
              [company]="company()!"
              [childCompanies]="childCompanies()"
              [parentCompany]="parentCompany()"
              [isParent]="isParent()"
              [isChild]="isChild()"
              [linkingChildId]="linkingChildId()"
              [unlinkingChildId]="unlinkingChildId()"
              [linkChildResults]="linkChildResults()"
              (linkChildRequest)="linkChild($event)"
              (unlinkChild)="unlinkChild($event)"
              (linkSearchChange)="onLinkChildSearch($event)"
            />

            <!-- Orders card -->
            <app-orders-card
              [ownOrders]="companyOrders()"
              [groupOrders]="groupOrders()"
              [ordersLoading]="ordersLoading()"
              [groupOrdersLoading]="groupOrdersLoading()"
              [mode]="groupOrdersMode()"
              [isParent]="isParent()"
              (modeToggle)="toggleOrdersMode()"
              (orderClick)="goToOrder($event.id, $event.status)"
            />

            <!-- Fleet Map card -->
            <app-fleet-map-card
              [vessels]="fleetVesselsWithPosition()"
              [mode]="groupFleetMode()"
              [loading]="groupFleetLoading()"
              [totalMatches]="activeFleetTotalMatches()"
              [limitNotice]="groupFleetLimitNotice()"
              (navigateToVessel)="navigateToVessel($event)"
            />

            <!-- Fleet Table card -->
            <app-fleet-table-card
              [companyId]="company()!.id"
              [isParent]="isParent()"
              [contacts]="contacts()"
              [contactsLoading]="contactsLoading()"
              [mode]="groupFleetMode()"
              [fleet]="fleet()"
              [fleetLoading]="fleetLoading()"
              [vesselsLoading]="vesselsLoading()"
              [groupVessels]="groupVessels()"
              [groupVesselsLoading]="groupVesselsLoading()"
              [companyVessels]="companyVessels()"
              [fleetMatchBySeasearcherId]="fleetMatchBySeasearcherId()"
              [fleetMatchByImo]="fleetMatchByImo()"
              [fleetRoleSelections]="fleetRoleSelections()"
              [linkingFleetKey]="linkingFleetKey()"
              [totalMatches]="activeFleetTotalMatches()"
              [limitNotice]="groupFleetLimitNotice()"
              [navigatingVesselId]="navigatingVesselId()"
              (modeToggle)="toggleFleetMode()"
              (mutated)="loadCompanyVessels(company()!.id)"
              (fleetRoleChange)="onFleetRoleChange($event.vessel, $event.role)"
              (navigateToVessel)="navigateToVessel($event)"
              (openGroupVessel)="openGroupVessel($event)"
              (deleteVesselAssoc)="confirmDeleteVesselAssoc.set($event)"
            />
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


              <!-- Registration + Ownership card -->
              <app-registration-card
                [enrichment]="enrichment()"
                [hierarchy]="hierarchy()"
                [seasearcherId]="company()!.seasearcherId"
                [navigatingCompanyId]="navigatingCompanyId()"
                (navigateToCompany)="navigateToCompany($event)"
              />

              <!-- Name History card -->
              @if (enrichment()!.companyNameHistory.length) {
                <app-name-history-card [entries]="enrichment()!.companyNameHistory" />
              }

              <!-- Risk & Compliance card -->
              <app-risk-compliance-card
                [tab]="sanctionsTab()"
                [enrichment]="enrichment()"
                [seasearcherId]="company()!.seasearcherId"
                [riskSummary]="riskSummary()"
                [riskSummaryLoading]="riskSummaryLoading()"
                [riskCheckRunning]="riskCheckRunning()"
                [overrideRequesting]="overrideRequesting()"
                [overrideDecisionLoading]="!!overrideDecisionLoadingId()"
                [pendingOverride]="pendingRiskOverride()"
                [canManageRiskOverrides]="canManageRiskOverrides()"
                [hasVotedOnOverride]="pendingRiskOverride() ? hasVotedOnOverride(pendingRiskOverride()!) : false"
                [ignoredCreditVessels]="ignoredCreditEnforcementVessels()"
                [navigatingRiskHitId]="navigatingRiskHitId()"
                [sanctions]="sanctions()"
                [sanctionsLoading]="sanctionsLoading()"
                [seizures]="seizures()"
                [seizuresLoading]="seizuresLoading()"
                (tabChange)="onSanctionsTabChange($event)"
                (runCheck)="runManualCheck()"
                (requestOverride)="requestOverride()"
                (decideOverride)="decideOverride($event.override, $event.decision)"
                (openRiskHitVessel)="openRiskHitVessel($event)"
              />

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

      <!-- Credit Application Modal -->
      @if (company()) {
        <app-credit-application-modal
          [open]="showCreditApplicationModal()"
          [counterpartyId]="company()!.id"
          [counterpartyName]="company()!.name"
          [defaultType]="company()!.types.includes('CLIENT') ? 'CUSTOMER' : 'SUPPLIER'"
          (closed)="showCreditApplicationModal.set(false)"
          (submitted)="onCreditApplicationSubmitted()"
        />
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
  readonly canDeleteEntity = computed(() =>
    this.authService.isAdmin() || this.authService.isCreditManager() || this.authService.isTeamLead(),
  );
  readonly canManageRiskOverrides = computed(() =>
    this.authService.isAdmin() || this.authService.isCreditManager(),
  );
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
  readonly editing = signal(false);
  readonly companyInfoTab = signal<'info' | 'headOffice' | 'offices' | 'terms' | 'emails'>('info');
  readonly countrySearchQuery = signal('');
  readonly showCountryDropdown = signal(false);
  readonly editCountry = signal('');
  readonly editCountryIso = signal('');

  // Credit application
  readonly showCreditApplicationModal = signal(false);

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

  readonly allTypes = signal<string[]>(['CLIENT', 'SUPPLIER', 'BROKER', 'AGENT']);

  readonly ignoredCreditEnforcementVessels = computed(() =>
    this.companyVessels().filter((vesselCompany) => vesselCompany.ignoreForCreditEnforcement === true),
  );
  // Own companies (for preferred invoicing company selector)
  readonly ownCompanies = signal<OwnCompanyDto[]>([]);

  // Sync conflict state
  readonly syncConflicts = signal<{ field: string; localValue: any; seasearcherValue: any; dismissed: boolean }[]>([]);
  readonly activeConflicts = computed(() => this.syncConflicts().filter((c) => !c.dismissed));
  readonly dismissedConflictsCount = computed(() => this.syncConflicts().filter(c => c.dismissed).length);
  readonly dismissedConflictsList = computed(() => this.syncConflicts().filter(c => c.dismissed));

  // Parent/child hierarchy state
  readonly parentCompany = signal<CompanyParentSummaryDto | null>(null);
  readonly groupAggregate = signal<CompanyGroupAggregateDto | null>(null);
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
  readonly registrationTab = signal<'registration' | 'ownership'>('ownership');
  readonly sanctionsTab = signal<'risk' | 'sanctions' | 'seizures' | 'monitoring'>('monitoring');
  readonly riskMonitoringService = inject(RiskMonitoringService);
  readonly riskSummary = signal<RiskSummaryDto | null>(null);
  readonly riskOverrides = signal<RiskOverrideDto[]>([]);
  readonly riskSummaryLoading = signal(false);
  readonly riskCheckRunning = signal(false);
  readonly overrideReason = signal('');
  readonly overrideRequesting = signal(false);
  readonly overrideDecisionLoadingId = signal<string | null>(null);
  readonly pendingRiskOverride = computed(() => this.riskOverrides().find((override) => override.status === 'PENDING') ?? null);
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
  readonly countries = COUNTRIES;

  // Supply ports
  readonly supplyPorts = signal<SupplyPortDto[]>([]);
  readonly supplyPortsLoading = signal(false);
  readonly showAddSupplyPort = signal(false);
  readonly editingSupplyPortId = signal<string | null>(null);
  readonly deleteSupplyPortTarget = signal<SupplyPortDto | null>(null);
  readonly supplyPlaceSearch = signal('');
  readonly supplyPlaceResults = signal<LocalPlaceOption[]>([]);
  readonly selectedSupplyPlace = signal<LocalPlaceOption | null>(null);
  readonly supplyPortForm = signal<{ placeId: string; contactId: string | null; products: string[]; note: string }>({
    placeId: '',
    contactId: null,
    products: [],
    note: '',
  });
  readonly savingSupplyPort = signal(false);
  readonly importingSupplyPlaceId = signal<string | null>(null);
  readonly supplyPortProductOptions = SUPPLY_PORT_PRODUCT_OPTIONS;
  readonly placeSupplyRules = signal<CompanyPlaceSupplyRuleDto[]>([]);
  readonly placeSupplyRulesLoading = signal(false);
  readonly showPlaceSupplyRulesModal = signal(false);
  readonly editingPlaceSupplyRuleId = signal<string | null>(null);
  readonly savingPlaceSupplyRule = signal(false);
  readonly reapplyingPlaceSupplyRuleId = signal<string | null>(null);
  readonly placeSupplyRulePlaceTypeOptions = PLACE_SUPPLY_RULE_TYPE_OPTIONS;
  readonly placeSupplyRuleForm = signal<PlaceSupplyRuleForm>(this.emptyPlaceSupplyRuleForm());
  private supplyPlaceSearchTimeout: ReturnType<typeof setTimeout> | null = null;

  // Company Attachments
  readonly companyAttachments = signal<CompanyAttachmentDto[]>([]);
  readonly companyAttachmentsLoading = signal(false);
  readonly uploadingCompanyAttachment = signal(false);
  readonly deleteCompanyAttachmentTarget = signal<CompanyAttachmentDto | null>(null);
  readonly companyAttachmentInputEl = viewChild<ElementRef<HTMLInputElement>>('companyAttachmentInput');
  selectedCompanyAttachment: File | null = null;

  // Company Emails
  readonly companyEmails = signal<CompanyEmailDto[]>([]);
  readonly emailsLoading = signal(false);
  readonly showAddEmail = signal(false);
  readonly emailForm = signal<{ emailType: CompanyEmailType; email: string; label: string; isPrimary: boolean }>({ emailType: 'general', email: '', label: '', isPrimary: false });
  readonly editingEmailId = signal<string | null>(null);
  readonly savingEmail = signal(false);
  readonly emailTypeOptions: CompanyEmailType[] = ['sales', 'invoice', 'inquiry', 'general'];

  // Company Offices
  readonly companyOffices = signal<CompanyOfficeDto[]>([]);
  readonly showAddOffice = signal(false);
  readonly officeForm = signal<{ city: string; country: string; address: string; phone: string; email: string }>({ city: '', country: '', address: '', phone: '', email: '' });
  readonly editingOfficeId = signal<string | null>(null);

  // Parent/child hierarchy and group orders
  readonly childCompanies = signal<CompanyChildSummaryDto[]>([]);
  readonly childrenLoading = signal(false);
  readonly linkChildSearch = signal('');
  readonly linkChildResults = signal<{ id: string; name: string; country: string | null; parentId: string | null }[]>([]);
  readonly linkingChildId = signal<string | null>(null);
  readonly showLinkChildModal = signal(false);
  readonly groupOrders = signal<(CompanyOrder & { clientName?: string })[]>([]);
  readonly groupOrdersLoading = signal(false);
  readonly groupOrdersMode = signal<'own' | 'group'>('own');

  // Group fleet
  readonly groupFleetMode = signal<'own' | 'group'>('own');
  readonly groupVessels = signal<GroupVesselRow[]>([]);
  readonly groupFleet = signal<GroupFleetResponse | null>(null);
  readonly groupFleetLoading = signal(false);
  readonly groupVesselsLoading = signal(false);
  readonly unlinkingChildId = signal<string | null>(null);
  private linkChildSearchTimeout: ReturnType<typeof setTimeout> | null = null;
  readonly isParent = computed(() => this.childCompanies().length > 0);
  readonly isChild = computed(() => !!this.parentCompany());

  // Company segmentation
  readonly segmentCategories = signal<{ key: string; label: string; mode: 'multi' | 'single'; options: { key: string; label: string }[] }[]>([]);
  readonly companySegments = signal<Record<string, string | string[]>>({});
  readonly segmentsSaving = signal(false);

  // Fleet map
  readonly fleetMapEl = viewChild<ElementRef<HTMLDivElement>>('fleetMapEl');
  private fleetMap: L.Map | null = null;
  private fleetMapInitialized = false;
  private routeSub: Subscription | null = null;
  private syncSub: Subscription | null = null;
  private conflictsSub: Subscription | null = null;
  private vesselLayer: L.LayerGroup | null = null;
  readonly fleetMapFullscreen = signal(false);

  // Navigation
  readonly navigatingCompanyId = signal<string | null>(null);
  readonly navigatingVesselId = signal<string | null>(null);
  readonly navigatingRiskHitId = signal<string | null>(null);

  readonly activeFleetData = computed(() => {
    if (this.groupFleetMode() === 'group' && this.isParent()) {
      return this.groupFleet();
    }
    return this.fleet();
  });

  readonly activeFleetTotalMatches = computed(() => this.activeFleetData()?.totalMatches ?? null);

  readonly groupFleetLimitNotice = computed(() => {
    if (this.groupFleetMode() !== 'group') return null;
    const groupFleet = this.groupFleet();
    if (!groupFleet?.truncated) return null;
    return {
      queried: groupFleet.queriedCompanyCount,
      total: groupFleet.totalCompanyCount,
      max: groupFleet.maxCompanies,
    };
  });

  readonly fleetVesselsWithPosition = computed(() => {
    const f = this.activeFleetData();
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
      if (!vessels.length) {
        if (this.vesselLayer) this.vesselLayer.clearLayers();
        if (this.fleetMap) {
          this.fleetMap.remove();
          this.fleetMap = null;
        }
        this.vesselLayer = null;
        this.fleetMapInitialized = false;
        return;
      }
      if (!this.fleetMapInitialized && vessels.length && el) {
        this.fleetMapInitialized = true;
        setTimeout(() => this.initFleetMap(), 50);
        return;
      }
      if (this.fleetMap) {
        this.refreshFleetMap(vessels);
      }
    });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.loadUsers();
    this.loadRoleOptions();
    this.loadCompanyTypes();
    this.loadSegmentCategories();
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

    // Listen for sync conflicts (fields user manually overrode that differ on SeaSearcher)
    this.conflictsSub = this.wsService.on<{ field: string; localValue: any; seasearcherValue: any; dismissed: boolean }[]>('company-sync-conflicts').subscribe((conflicts) => {
      if (conflicts?.length) {
        this.syncConflicts.set(conflicts);
      }
    });
  }

  private loadUsers(): void {
    // Keep current user selection support even when user lookup is unavailable.
    this.teamUsers.set([]);
  }

  private loadRoleOptions(): void {
    // Role options are initialized as defaults in state.
  }

  private loadCompanyTypes(): void {
    // Company types are initialized as defaults in state.
  }

  onCreditApplicationSubmitted(): void {
    this.showCreditApplicationModal.set(false);
  }

  goToOrder(orderId: string, _status: string): void {
    this.router.navigate(['/orders', orderId]);
  }

  onSegmentToggle(event: { catKey: string; optKey: string; mode: 'multi' | 'single' }): void {
    if (event.mode === 'multi') {
      this.toggleSegment(event.catKey, event.optKey);
    } else {
      this.selectSingleSegment(event.catKey, event.optKey);
    }
  }

  onSanctionsTabChange(tab: string): void {
    const t = tab as 'risk' | 'sanctions' | 'seizures' | 'monitoring';
    this.sanctionsTab.set(t);
    if (t === 'monitoring') this.loadRiskSummary();
  }

  ngOnDestroy(): void {
    if (this.fleetMap) {
      this.fleetMap.remove();
      this.fleetMap = null;
    }
    if (this.supplyPlaceSearchTimeout) clearTimeout(this.supplyPlaceSearchTimeout);
    this.routeSub?.unsubscribe();
    this.syncSub?.unsubscribe();
    this.conflictsSub?.unsubscribe();
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
    this.groupFleet.set(null);
    this.groupFleetLoading.set(false);
    this.groupVessels.set([]);
    this.groupVesselsLoading.set(false);
    this.groupFleetMode.set('own');
    this.fleetMatchBySeasearcherId.set({});
    this.fleetMatchByImo.set({});
    this.fleetRoleSelections.set({});
    this.linkingFleetKey.set(null);
    this.hierarchy.set(null);
    this.seizures.set(null);
    this.sanctions.set(null);
    this.contacts.set([]);
    this.supplyPorts.set([]);
    this.companyAttachments.set([]);
    this.showAddSupplyPort.set(false);
    this.selectedSupplyPlace.set(null);
    this.supplyPlaceSearch.set('');
    this.supplyPlaceResults.set([]);
    this.supplyPortForm.set({ placeId: '', contactId: null, products: [], note: '' });
    this.deleteCompanyAttachmentTarget.set(null);
    this.resetCompanyAttachmentSelection();
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
    this.sanctionsTab.set('monitoring');
    this.riskSummary.set(null);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CounterpartyDto>>(`${API}/companies/local/${id}`),
      );
      if (res.success && res.data) {
        this.showAddVessel.set(false);
        this.editingVesselAssocId.set(null);
        this.selectedVessel.set(null);
        this.vesselSearch.set('');
        this.vesselSearchResults.set([]);
        this.company.set(res.data);
        this.pageTitle.setTitle(`${res.data.name} | Company`);

        this.responsibleUserId.set(res.data.responsibleUserId ?? null);
        this.editCountry.set(res.data.country ?? '');
        this.editCountryIso.set(res.data.countryIso ?? '');
        this.countrySearchQuery.set(res.data.country ?? '');

        this.loadOrders(id);
        this.loadCompanyVessels(id);
        this.loadContacts(id);
        this.loadSupplyPorts(id);
        this.loadCompanyPlaceSupplyRules(id);
        this.loadCompanyAttachments(id);
        this.loadCompanyEmails(id);
        this.loadCompanyOffices(id);
        this.loadParentChildData(id);
        this.loadOwnCompanies();
        this.loadRiskSummary();
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
  async loadCompanyVessels(companyId: string): Promise<void> {
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
        if (this.groupFleetMode() === 'own') {
          this.refreshFleetMap(this.fleetVesselsWithPosition());
        }
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

    this.refreshFleetMap(vessels);
  }

  private refreshFleetMap(vessels: Array<FleetVessel | GroupFleetVessel>): void {
    if (!this.fleetMap || !this.vesselLayer) return;
    this.addFleetVesselMarkers(vessels);
    this.fitFleetMapToVessels(vessels);
    this.fleetMap.invalidateSize();
  }

  private fitFleetMapToVessels(vessels: Array<FleetVessel | GroupFleetVessel>): void {
    if (!this.fleetMap) return;
    const bounds = L.latLngBounds([]);
    for (const v of vessels) {
      const pos = v.latestInformation?.position;
      if (!pos?.lat || !pos?.lng) continue;
      bounds.extend(L.latLng(pos.lat, pos.lng));
    }
    if (bounds.isValid()) {
      this.fleetMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 6 });
    }
  }

  private addFleetVesselMarkers(vessels: Array<FleetVessel | GroupFleetVessel>): void {
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
      const companyName = 'companyName' in v ? v.companyName : null;

      const popupLines = [
        `<a href="javascript:void(0)" class="vessel-nav-link text-blue-600 hover:underline font-semibold" data-vessel-id="${v.id}">${v.name}</a>`,
        `IMO: ${v.imo}`,
        companyName ? `Company: ${companyName}` : null,
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
      this.deleteError.set('Only admins, credit managers and team leads can delete companies');
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
    } catch (err: any) {
      const msg = err?.error?.message ?? err?.message ?? 'Failed to delete company';
      this.deleteError.set(msg);
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

  onTypeToggle(type: string): Promise<void> {
    return this.toggleType(type);
  }

  async onCompanyInfoSave(body: Record<string, any>): Promise<void> {
    const c = this.company();
    if (!c) return;

    try {
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<CounterpartyDto>>(`${API}/companies/local/${c.id}`, body),
      );
      if (res.success && res.data) {
        this.company.set(res.data);
      }
    } catch (err) {
      console.error('Failed to update company:', err);
    }
  }

  async onResponsibleUserChange(userId: string): Promise<void> {
    const c = this.company();
    if (!c || this.savingResponsible()) return;

    this.savingResponsible.set(true);
    try {
      const nextUserId = userId || null;
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<CounterpartyDto>>(`${API}/companies/local/${c.id}`, {
          responsibleUserId: nextUserId,
        }),
      );
      if (res.success && res.data) {
        this.company.set(res.data);
        this.responsibleUserId.set(res.data.responsibleUserId ?? null);
      }
    } catch (err) {
      console.error('Failed to update responsible user:', err);
    } finally {
      this.savingResponsible.set(false);
    }
  }

  goBack(): void {
    this.router.navigate(['/companies']);
  }

  readonly fieldLabels: Record<string, string> = {
    name: 'Company Name',
    country: 'Country',
    countryIso: 'Country Code',
    yearFormed: 'Year Formed',
    fleetSize: 'Fleet Size',
    headOfficeAddress: 'Address',
    headOfficePhone: 'Phone',
    headOfficeEmail: 'Email',
    website: 'Website',
    companyImo: 'Company IMO',
    companyRoles: 'Company Roles',
  };

  dismissConflicts(): void {
    for (const conflict of this.activeConflicts()) {
      this.dismissConflict(conflict.field, conflict.seasearcherValue);
    }
  }

  async acceptSeasearcherValue(field: string): Promise<void> {
    const c = this.company();
    if (!c) return;
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<CounterpartyDto>>(`${API}/companies/local/${c.id}/accept-seasearcher`, { field }),
      );
      if (res.success && res.data) {
        this.company.set(res.data);
        this.syncConflicts.update((conflicts) => conflicts.filter((cf) => cf.field !== field));
      }
    } catch (err) {
      console.error('Failed to accept SeaSearcher value:', err);
    }
  }

  async dismissConflict(field: string, seasearcherValue: any): Promise<void> {
    const c = this.company();
    if (!c) return;
    this.syncConflicts.update((conflicts) =>
      conflicts.map((cf) => (cf.field === field ? { ...cf, dismissed: true } : cf)),
    );
    try {
      await firstValueFrom(
        this.http.post<ApiResponse<any>>(`${API}/companies/local/${c.id}/keep-mine`, { field, seasearcherValue }),
      );
    } catch (err) {
      console.error('Failed to persist keep-mine:', err);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────
  typeLabel(type: string): string {
    return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  }

  typeBadgeClass(type: string): string {
    switch (type) {
      case 'CLIENT': return 'bg-blue-100 text-blue-700';
      case 'SUPPLIER': return 'bg-green-100 text-green-700';
      case 'BROKER': return 'bg-cyan-100 text-cyan-700';
      case 'AGENT': return 'bg-indigo-100 text-indigo-700';
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

  placeCountryFlag(value: string | null | undefined): string {
    if (!value) return '';
    const normalized = value.trim().toUpperCase();
    const country = COUNTRIES.find((entry) => entry.code.toUpperCase() === normalized);
    return country ? flagFromIso3(country.code) : '';
  }

  placeCountryLabel(value: string | null | undefined): string {
    if (!value) return '';
    const trimmed = value.trim();
    const normalized = trimmed.toUpperCase();
    const country = COUNTRIES.find((entry) => entry.code.toUpperCase() === normalized);
    return country?.name ?? trimmed;
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
    } finally {
      this.navigatingVesselId.set(null);
    }
  }

  canNavigateToRiskHitVessel(hit: RiskHitDto): boolean {
    return !!this.extractVesselNameFromRiskHit(hit);
  }

  async openRiskHitVessel(hit: RiskHitDto): Promise<void> {
    const vesselName = this.extractVesselNameFromRiskHit(hit);
    if (!vesselName) return;

    this.navigatingRiskHitId.set(hit.id);
    try {
      const linked = this.findLinkedVesselByName(vesselName);
      if (linked?.vesselId) {
        await this.router.navigate(['/vessels', linked.vesselId]);
        return;
      }

      const search = await firstValueFrom(
        this.http.get<ApiResponse<VesselSearchResult[]>>(
          `${API}/vessels/search?term=${encodeURIComponent(vesselName)}`,
        ),
      ).catch(() => null);

      const match = this.pickBestRiskHitVesselMatch(vesselName, search?.success ? (search.data ?? []) : []);
      if (!match) {
        this.showToast('error', `Could not find a vessel match for ${vesselName}.`);
        return;
      }

      if (match.source === 'local' && match.localId) {
        await this.router.navigate(['/vessels', match.localId]);
        return;
      }

      if (match.source === 'seasearcher' && match.seasearcherId) {
        await this.navigateToVessel(match.seasearcherId);
        return;
      }

      this.showToast('error', `Could not open a vessel record for ${vesselName}.`);
    } catch (err) {
      console.error('Failed to open vessel from risk hit:', err);
      this.showToast('error', 'Failed to open vessel details.');
    } finally {
      this.navigatingRiskHitId.set(null);
    }
  }

  private extractVesselNameFromRiskHit(hit: RiskHitDto): string | null {
    if (hit.signalType !== 'SEIZURE') return null;
    const prefix = 'Vessel seizure:';
    if (!hit.title.startsWith(prefix)) return null;
    const vesselName = hit.title.slice(prefix.length).trim();
    return vesselName || null;
  }

  private findLinkedVesselByName(vesselName: string): VesselCompanyDto | undefined {
    const normalizedTarget = vesselName.trim().toLowerCase();
    return this.companyVessels().find((vessel) => {
      const byName = vessel.vesselName?.trim().toLowerCase() === normalizedTarget;
      const byImo = vessel.vesselImo?.trim() === vesselName.trim();
      return byName || byImo;
    });
  }

  private pickBestRiskHitVesselMatch(vesselName: string, results: VesselSearchResult[]): VesselSearchResult | null {
    if (!results.length) return null;

    const normalizedTarget = vesselName.trim().toLowerCase();
    const exactLocal = results.find((result) => result.source === 'local' && result.name.trim().toLowerCase() === normalizedTarget);
    if (exactLocal) return exactLocal;

    const exactSeasearcher = results.find((result) => result.source === 'seasearcher' && result.name.trim().toLowerCase() === normalizedTarget);
    if (exactSeasearcher) return exactSeasearcher;

    const local = results.find((result) => result.source === 'local');
    if (local) return local;

    return results.find((result) => result.source === 'seasearcher') ?? null;
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
  private async loadSupplyPorts(companyId: string, options: { silent?: boolean } = {}): Promise<void> {
    if (!options.silent) {
      this.supplyPortsLoading.set(true);
    }
    try {
      const res = await firstValueFrom(
        this.http
          .get<ApiResponse<SupplyPortDto[]>>(`${API}/companies/local/${companyId}/supply-ports`)
          .pipe(timeout(8000)),
      );
      if (res.success && res.data) {
        this.supplyPorts.set(res.data);
      }
    } catch (err) {
      console.error('Failed to load supply ports:', err);
    } finally {
      if (!options.silent) {
        this.supplyPortsLoading.set(false);
      }
    }
  }

  private emptyPlaceSupplyRuleForm(): PlaceSupplyRuleForm {
    return {
      countryIso: '',
      placeTypes: this.placeSupplyRulePlaceTypeOptions.map((option) => option.value),
      contactId: null,
      products: [],
      note: '',
    };
  }

  resetPlaceSupplyRuleForm(): void {
    this.editingPlaceSupplyRuleId.set(null);
    this.placeSupplyRuleForm.set(this.emptyPlaceSupplyRuleForm());
  }

  private async loadCompanyPlaceSupplyRules(companyId: string): Promise<void> {
    this.placeSupplyRulesLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CompanyPlaceSupplyRuleDto[]>>(`${API}/companies/local/${companyId}/place-supply-rules`),
      );
      if (res.success) {
        this.placeSupplyRules.set(res.data ?? []);
      } else {
        this.placeSupplyRules.set([]);
      }
    } catch (err) {
      console.error('Failed to load place supply rules:', err);
      this.placeSupplyRules.set([]);
    } finally {
      this.placeSupplyRulesLoading.set(false);
    }
  }

  openPlaceSupplyRulesModal(): void {
    this.showPlaceSupplyRulesModal.set(true);
    this.resetPlaceSupplyRuleForm();
  }

  closePlaceSupplyRulesModal(): void {
    this.showPlaceSupplyRulesModal.set(false);
    this.resetPlaceSupplyRuleForm();
  }

  openEditPlaceSupplyRule(rule: CompanyPlaceSupplyRuleDto): void {
    this.showPlaceSupplyRulesModal.set(true);
    this.editingPlaceSupplyRuleId.set(rule.id);
    this.placeSupplyRuleForm.set({
      countryIso: rule.countryIso,
      placeTypes: [...rule.placeTypes],
      contactId: rule.contactId,
      products: [...rule.products],
      note: rule.note ?? '',
    });
  }

  togglePlaceSupplyRulePlaceType(type: CompanyPlaceSupplyRulePlaceType): void {
    const current = this.placeSupplyRuleForm().placeTypes;
    const next = current.includes(type)
      ? current.filter((value) => value !== type)
      : [...current, type];
    this.placeSupplyRuleForm.set({ ...this.placeSupplyRuleForm(), placeTypes: next });
  }

  togglePlaceSupplyRuleProduct(product: string): void {
    const current = this.placeSupplyRuleForm().products;
    const next = current.includes(product)
      ? current.filter((value) => value !== product)
      : [...current, product];
    this.placeSupplyRuleForm.set({ ...this.placeSupplyRuleForm(), products: next });
  }

  placeSupplyRulePlaceTypeLabel(type: CompanyPlaceSupplyRulePlaceType): string {
    return this.placeSupplyRulePlaceTypeOptions.find((option) => option.value === type)?.label ?? type;
  }

  async savePlaceSupplyRule(): Promise<void> {
    const companyId = this.company()?.id;
    const form = this.placeSupplyRuleForm();
    if (!companyId) return;

    if (!form.countryIso.trim() || !form.placeTypes.length) {
      this.showToast('error', 'Country and at least one place type are required.');
      return;
    }

    this.savingPlaceSupplyRule.set(true);
    try {
      const payload = {
        countryIso: form.countryIso.trim().toUpperCase(),
        placeTypes: form.placeTypes,
        contactId: form.contactId ?? null,
        products: form.products,
        note: form.note.trim() || null,
      };
      const editingRuleId = this.editingPlaceSupplyRuleId();

      if (editingRuleId) {
        const res = await firstValueFrom(
          this.http.put<ApiResponse<CompanyPlaceSupplyRuleDto>>(`${API}/companies/local/${companyId}/place-supply-rules/${editingRuleId}`, payload),
        );

        if (!res.success) {
          this.showToast('error', res.message ?? 'Failed to update place supply rule.');
          return;
        }

        this.showToast('success', 'Updated coverage rule.');
      } else {
        const res = await firstValueFrom(
          this.http.post<ApiResponse<CompanyPlaceSupplyRuleApplySummaryDto>>(`${API}/companies/local/${companyId}/place-supply-rules`, payload),
        );

        if (!res.success || !res.data) {
          this.showToast('error', res.message ?? 'Failed to create place supply rule.');
          return;
        }

        const placeLabel = res.data.matchedPlaceCount === 1 ? 'place' : 'places';
        this.showToast('success', `Rule applied to ${res.data.matchedPlaceCount} ${placeLabel}; created ${res.data.created}.`);
      }

      this.resetPlaceSupplyRuleForm();
      void this.loadCompanyPlaceSupplyRules(companyId);
    } catch (err) {
      console.error('Failed to save place supply rule:', err);
      this.showToast('error', 'Failed to save place supply rule.');
    } finally {
      this.savingPlaceSupplyRule.set(false);
    }
  }

  async reapplyPlaceSupplyRule(rule: CompanyPlaceSupplyRuleDto): Promise<void> {
    const companyId = this.company()?.id;
    if (!companyId) return;

    this.reapplyingPlaceSupplyRuleId.set(rule.id);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<CompanyPlaceSupplyRuleApplySummaryDto>>(`${API}/companies/local/${companyId}/place-supply-rules/${rule.id}/reapply`, {}),
      );

      if (!res.success || !res.data) {
        this.showToast('error', res.message ?? 'Failed to reapply place supply rule.');
        return;
      }

      this.showToast('success', `Reapplied rule: ${res.data.created} created, ${res.data.updated} updated, ${res.data.skipped} skipped.`);
      void this.loadCompanyPlaceSupplyRules(companyId);
    } catch (err) {
      console.error('Failed to reapply place supply rule:', err);
      this.showToast('error', 'Failed to reapply place supply rule.');
    } finally {
      this.reapplyingPlaceSupplyRuleId.set(null);
    }
  }

  async deletePlaceSupplyRule(rule: CompanyPlaceSupplyRuleDto): Promise<void> {
    const companyId = this.company()?.id;
    if (!companyId) return;

    if (!confirm(`Delete the coverage rule for ${this.placeCountryLabel(rule.countryIso)}?`)) {
      return;
    }

    try {
      const res = await firstValueFrom(
        this.http.delete<ApiResponse<{ id: string } | CompanyPlaceSupplyRuleDto>>(`${API}/companies/local/${companyId}/place-supply-rules/${rule.id}`),
      );

      if (!res.success) {
        this.showToast('error', res.message ?? 'Failed to delete place supply rule.');
        return;
      }

      if (this.editingPlaceSupplyRuleId() === rule.id) {
        this.resetPlaceSupplyRuleForm();
      }
      this.showToast('success', 'Deleted coverage rule.');
      void this.loadCompanyPlaceSupplyRules(companyId);
    } catch (err) {
      console.error('Failed to delete place supply rule:', err);
      this.showToast('error', 'Failed to delete place supply rule.');
    }
  }

  private mergeSavedSupplyPort(selectedPlace: LocalPlaceOption, saved: PortSupplierDto, form: { contactId: string | null; products: string[]; note: string }): void {
    const nextSupplyPort: SupplyPortDto = {
      id: saved.id,
      placeId: saved.placeId,
      placeName: selectedPlace.name,
      placeCode: selectedPlace.unlocode ?? selectedPlace.parentPlaceUnlocode ?? null,
      placeCountry: selectedPlace.country ?? null,
      contactId: saved.contactId ?? form.contactId,
      contactName: saved.contactName ?? this.contacts().find((contact) => contact.id === (saved.contactId ?? form.contactId))?.name ?? null,
      products: saved.products ?? [...form.products],
      note: saved.note ?? (form.note.trim() || null),
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    };

    this.supplyPorts.update((current) => {
      const remaining = current.filter((port) => port.id !== nextSupplyPort.id);
      return [...remaining, nextSupplyPort].sort((left, right) => left.placeName.localeCompare(right.placeName));
    });
  }

  openAddSupplyPort(): void {
    this.editingSupplyPortId.set(null);
    this.deleteSupplyPortTarget.set(null);
    this.showAddSupplyPort.set(true);
    this.selectedSupplyPlace.set(null);
    this.supplyPlaceSearch.set('');
    this.supplyPlaceResults.set([]);
    this.supplyPortForm.set({ placeId: '', contactId: null, products: [], note: '' });
  }

  cancelAddSupplyPort(): void {
    this.editingSupplyPortId.set(null);
    this.showAddSupplyPort.set(false);
    this.selectedSupplyPlace.set(null);
    this.supplyPlaceSearch.set('');
    this.supplyPlaceResults.set([]);
    this.supplyPortForm.set({ placeId: '', contactId: null, products: [], note: '' });
  }
  
  openEditSupplyPort(supplyPort: SupplyPortDto): void {
    this.editingSupplyPortId.set(supplyPort.id);
    this.deleteSupplyPortTarget.set(null);
    this.showAddSupplyPort.set(true);
    this.selectedSupplyPlace.set({
      id: supplyPort.placeId,
      name: supplyPort.placeName,
      unlocode: supplyPort.placeCode,
      country: supplyPort.placeCountry,
    });
    this.supplyPlaceSearch.set('');
    this.supplyPlaceResults.set([]);
    this.supplyPortForm.set({
      placeId: supplyPort.placeId,
      contactId: supplyPort.contactId,
      products: [...supplyPort.products],
      note: supplyPort.note ?? '',
    });
  }
  
  confirmDeleteSupplyPort(supplyPort: SupplyPortDto): void {
    this.deleteSupplyPortTarget.set(supplyPort);
  }
  
  async executeDeleteSupplyPort(): Promise<void> {
    const target = this.deleteSupplyPortTarget();
    const companyId = this.company()?.id;
    if (!target || !companyId) return;
  
    try {
      const res = await firstValueFrom(
        this.http.delete<ApiResponse<{ id: string }>>(`${API}/lloyds/places/suppliers/${target.id}`),
      );
      if (!res.success) {
        this.showToast('error', res.message ?? 'Failed to delete supply location.');
        return;
      }
      if (this.editingSupplyPortId() === target.id) {
        this.cancelAddSupplyPort();
      }
      this.deleteSupplyPortTarget.set(null);
      this.showToast('success', `Removed ${target.placeName} from supply locations.`);
      await this.loadSupplyPorts(companyId);
    } catch (err) {
      console.error('Failed to delete supply location:', err);
      this.showToast('error', 'Failed to delete supply location.');
    }
  }

  onSupplyPlaceSearch(term: string): void {
    this.supplyPlaceSearch.set(term);
    if (this.supplyPlaceSearchTimeout) clearTimeout(this.supplyPlaceSearchTimeout);
    if (term.trim().length < 2) {
      this.supplyPlaceResults.set([]);
      return;
    }

    this.supplyPlaceSearchTimeout = setTimeout(async () => {
      try {
        const res = await firstValueFrom(
          this.http.get<ApiResponse<{ places: LocalPlaceOption[]; total: number }>>(
            `${API}/lloyds/places/local?search=${encodeURIComponent(term)}&limit=15`,
          ),
        );
        const existingPlaceIds = new Set(this.supplyPorts().map((port) => port.placeId));
        const localResults = res.success && res.data
          ? res.data.places
              .filter((place) => !existingPlaceIds.has(place.id))
              .map((place) => ({ ...place, source: 'local' as const }))
          : [];

        if (localResults.length > 0) {
          this.supplyPlaceResults.set(localResults);
          return;
        }

        const lliRes = await firstValueFrom(
          this.http.get<ApiResponse<SupplyPlaceSearchResult[]>>(
            `${API}/lloyds/places?name=${encodeURIComponent(term)}`,
          ),
        );

        this.supplyPlaceResults.set(
          lliRes.success && lliRes.data
            ? lliRes.data
                .filter((place) => place.source === 'lloyds' && !!place.lliPlaceId)
                .map((place) => ({
                  id: `lli:${place.lliPlaceId}`,
                  name: place.name,
                  unlocode: place.unlocode ?? null,
                  country: place.country ?? null,
                  source: 'lloyds' as const,
                  lliPlaceId: place.lliPlaceId,
                }))
            : [],
        );
      } catch {
        this.supplyPlaceResults.set([]);
      }
    }, 250);
  }

  async selectSupplyPlace(place: LocalPlaceOption): Promise<void> {
    if (place.source === 'lloyds' && place.lliPlaceId) {
      this.importingSupplyPlaceId.set(place.lliPlaceId);
      try {
        const res = await firstValueFrom(
          this.http.post<ApiResponse<{ id: string; name: string }>>(`${API}/lloyds/places/import`, { lliPlaceId: place.lliPlaceId }),
        );
        if (!res.success || !res.data) {
          this.showToast('error', res.message ?? 'Failed to import place from Seasearcher.');
          return;
        }

        place = {
          id: res.data.id,
          name: res.data.name,
          unlocode: place.unlocode ?? null,
          country: place.country,
          source: 'lloyds',
          lliPlaceId: place.lliPlaceId,
        };
      } catch {
        this.showToast('error', 'Failed to import place from Seasearcher.');
        return;
      } finally {
        this.importingSupplyPlaceId.set(null);
      }
    }

    this.selectedSupplyPlace.set(place);
    this.supplyPlaceSearch.set('');
    this.supplyPlaceResults.set([]);
    this.supplyPortForm.set({ ...this.supplyPortForm(), placeId: place.id });
  }

  clearSelectedSupplyPlace(): void {
    this.selectedSupplyPlace.set(null);
    this.supplyPlaceSearch.set('');
    this.supplyPlaceResults.set([]);
    this.supplyPortForm.set({ ...this.supplyPortForm(), placeId: '' });
  }

  toggleSupplyPortProduct(product: string): void {
    const current = this.supplyPortForm().products;
    const next = current.includes(product)
      ? current.filter((value) => value !== product)
      : [...current, product];
    this.supplyPortForm.set({ ...this.supplyPortForm(), products: next });
  }

  isImportingSupplyPlace(place: LocalPlaceOption): boolean {
    return place.source === 'lloyds'
      && Boolean(place.lliPlaceId)
      && this.importingSupplyPlaceId() === place.lliPlaceId;
  }

  async saveSupplyPort(): Promise<void> {
    const companyId = this.company()?.id;
    const selectedPlace = this.selectedSupplyPlace();
    const form = this.supplyPortForm();
    if (!companyId || !selectedPlace || !form.placeId) return;

    this.savingSupplyPort.set(true);
    try {
      const editingSupplyPortId = this.editingSupplyPortId();
      const payload = {
        contactId: form.contactId ?? null,
        products: form.products,
        note: form.note.trim() || undefined,
      };
      const res = editingSupplyPortId
        ? await firstValueFrom(
            this.http.put<ApiResponse<PortSupplierDto>>(`${API}/lloyds/places/suppliers/${editingSupplyPortId}`, payload),
          )
        : await firstValueFrom(
            this.http.post<ApiResponse<PortSupplierDto>>(`${API}/lloyds/places/local/${form.placeId}/suppliers`, {
              companyId,
              ...payload,
            }),
          );

      if (!res.success) {
        this.showToast('error', res.message ?? `Failed to ${editingSupplyPortId ? 'update' : 'add'} supply port.`);
        return;
      }

      this.showToast('success', editingSupplyPortId
        ? `Updated ${selectedPlace.name} supply location.`
        : `Added ${selectedPlace.name} to supply ports.`);
      if (res.data) {
        this.mergeSavedSupplyPort(selectedPlace, res.data, form);
      }
      this.cancelAddSupplyPort();
      void this.loadSupplyPorts(companyId, { silent: true });
    } catch (err) {
      console.error('Failed to save supply port:', err);
      this.showToast('error', 'Failed to save supply port.');
    } finally {
      this.savingSupplyPort.set(false);
    }
  }

  // ─── Company Attachments ─────────────────────────────────────────
  private async loadCompanyAttachments(companyId: string): Promise<void> {
    this.companyAttachmentsLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CompanyAttachmentDto[]>>(`${API}/companies/local/${companyId}/attachments`),
      );
      if (res.success) {
        this.companyAttachments.set(res.data ?? []);
      } else {
        this.companyAttachments.set([]);
      }
    } catch (err) {
      console.error('Failed to load company attachments:', err);
      this.companyAttachments.set([]);
    } finally {
      this.companyAttachmentsLoading.set(false);
    }
  }

  onCompanyAttachmentSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedCompanyAttachment = input.files?.[0] ?? null;
  }

  private resetCompanyAttachmentSelection(): void {
    this.selectedCompanyAttachment = null;
    const input = this.companyAttachmentInputEl()?.nativeElement;
    if (input) input.value = '';
  }

  async uploadCompanyAttachment(): Promise<void> {
    const companyId = this.company()?.id;
    if (!companyId || !this.selectedCompanyAttachment) return;

    this.uploadingCompanyAttachment.set(true);
    try {
      const form = new FormData();
      form.append('file', this.selectedCompanyAttachment);
      const res = await firstValueFrom(
        this.http.post<ApiResponse<CompanyAttachmentDto>>(`${API}/companies/local/${companyId}/attachments`, form),
      );

      if (!res.success || !res.data) {
        this.showToast('error', res.message ?? 'Failed to upload file.');
        return;
      }

      this.companyAttachments.update((prev) => [res.data!, ...prev]);
      this.resetCompanyAttachmentSelection();
      this.showToast('success', `Uploaded ${res.data.fileName}.`);
    } catch (err: any) {
      console.error('Failed to upload company attachment:', err);
      this.showToast('error', err?.error?.message ?? 'Failed to upload file.');
    } finally {
      this.uploadingCompanyAttachment.set(false);
    }
  }

  openCompanyAttachment(attachment: CompanyAttachmentDto): void {
    const url = attachment.filePath.startsWith('http')
      ? attachment.filePath
      : `${API}${attachment.filePath}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  confirmDeleteCompanyAttachment(attachment: CompanyAttachmentDto): void {
    this.deleteCompanyAttachmentTarget.set(attachment);
  }

  async executeDeleteCompanyAttachment(): Promise<void> {
    const target = this.deleteCompanyAttachmentTarget();
    if (!target) return;

    try {
      const res = await firstValueFrom(
        this.http.delete<ApiResponse<{ id: string }>>(`${API}/companies/attachments/${target.id}`),
      );
      if (!res.success) {
        this.showToast('error', res.message ?? 'Failed to delete file.');
        return;
      }

      this.companyAttachments.update((items) => items.filter((attachment) => attachment.id !== target.id));
      this.deleteCompanyAttachmentTarget.set(null);
      this.showToast('success', `Deleted ${target.fileName}.`);
    } catch (err) {
      console.error('Failed to delete company attachment:', err);
      this.showToast('error', 'Failed to delete file.');
    }
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

  async onEmailSave(payload: { emailType: CompanyEmailType; email: string; label: string; isPrimary: boolean; editId?: string }): Promise<void> {
    const c = this.company();
    if (!c) return;
    try {
      if (payload.editId) {
        await firstValueFrom(
          this.http.patch(`${API}/companies/emails/${payload.editId}`, {
            emailType: payload.emailType,
            email: payload.email.trim(),
            label: payload.label.trim() || undefined,
            isPrimary: payload.isPrimary,
          }),
        );
      } else {
        await firstValueFrom(
          this.http.post(`${API}/companies/local/${c.id}/emails`, {
            emailType: payload.emailType,
            email: payload.email.trim(),
            label: payload.label.trim() || undefined,
            isPrimary: payload.isPrimary,
          }),
        );
      }
      this.loadCompanyEmails(c.id);
    } catch (err) {
      console.error('Failed to save company email:', err);
    }
  }

  // ─── Offices CRUD ────────────────────────────────────────────────────

  private async loadCompanyOffices(companyId: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CompanyOfficeDto[]>>(`${API}/companies/local/${companyId}/offices`),
      );
      if (res.success && res.data) {
        this.companyOffices.set(res.data);
      }
    } catch (err) {
      console.error('Failed to load company offices:', err);
    }
  }

  async onOfficeSave(payload: { city: string; country: string; address: string; phone: string; email: string; editId?: string }): Promise<void> {
    const c = this.company();
    if (!c) return;
    try {
      if (payload.editId) {
        await firstValueFrom(
          this.http.patch(`${API}/companies/offices/${payload.editId}`, {
            city: payload.city.trim(),
            country: payload.country.trim() || undefined,
            address: payload.address.trim() || undefined,
            phone: payload.phone.trim() || undefined,
            email: payload.email.trim() || undefined,
          }),
        );
      } else {
        await firstValueFrom(
          this.http.post(`${API}/companies/local/${c.id}/offices`, {
            city: payload.city.trim(),
            country: payload.country.trim() || undefined,
            address: payload.address.trim() || undefined,
            phone: payload.phone.trim() || undefined,
            email: payload.email.trim() || undefined,
          }),
        );
      }
      this.loadCompanyOffices(c.id);
    } catch (err) {
      console.error('Failed to save company office:', err);
    }
  }

  async deleteCompanyOffice(officeId: string): Promise<void> {
    const c = this.company();
    if (!c) return;
    try {
      await firstValueFrom(
        this.http.delete(`${API}/companies/offices/${officeId}`),
      );
      this.loadCompanyOffices(c.id);
    } catch (err) {
      console.error('Failed to delete company office:', err);
    }
  }

  async loadRiskSummary(): Promise<void> {
    const c = this.company();
    if (!c) return;
    this.riskSummaryLoading.set(true);
    try {
      const [summary, overrides] = await Promise.all([
        this.riskMonitoringService.getSummary(c.id),
        this.riskMonitoringService.getOverrides(c.id),
      ]);
      this.riskSummary.set(summary);
      this.riskOverrides.set(overrides);
    } catch (err) {
      console.error('Failed to load risk summary:', err);
    } finally {
      this.riskSummaryLoading.set(false);
    }
  }

  async runManualCheck(): Promise<void> {
    const c = this.company();
    if (!c || this.riskCheckRunning()) return;
    if (!this.canManageRiskOverrides()) {
      this.showToast('error', 'Only admins and credit managers can run monitoring actions.');
      return;
    }
    this.riskCheckRunning.set(true);
    try {
      const summary = await this.riskMonitoringService.triggerCheck(c.id);
      if (summary) {
        this.riskSummary.set(summary);
        this.showToast('success', summary.isFrozen ? 'Check complete — risk signals found' : 'Check complete — all clear');
      }
    } catch (err) {
      console.error('Failed to run manual check:', err);
      this.showToast('error', 'Risk check failed');
    } finally {
      this.riskCheckRunning.set(false);
    }
  }

  async requestOverride(): Promise<void> {
    const c = this.company();
    if (!c) return;
    if (!this.canManageRiskOverrides()) {
      this.showToast('error', 'Only admins and credit managers can request credit overrides.');
      return;
    }
    const reason = prompt('Reason for requesting a credit override:');
    if (!reason?.trim()) return;
    this.overrideRequesting.set(true);
    try {
      const override = await this.riskMonitoringService.requestOverride(c.id, reason.trim());
      this.showToast('success', override?.status === 'APPROVED' ? 'Override activated' : 'Override requested — awaiting approval');
      await this.loadRiskSummary();
    } catch (err) {
      console.error('Failed to request override:', err);
      this.showToast('error', 'Failed to request override');
    } finally {
      this.overrideRequesting.set(false);
    }
  }

  hasVotedOnOverride(override: RiskOverrideDto): boolean {
    const userId = this.authService.user()?.id;
    if (!userId) return false;
    return override.approvals.some((approval) => approval.userId === userId);
  }

  async decideOverride(override: RiskOverrideDto, decision: 'APPROVED' | 'REJECTED'): Promise<void> {
    if (this.overrideDecisionLoadingId() || this.hasVotedOnOverride(override)) return;
    if (!this.canManageRiskOverrides()) {
      this.showToast('error', 'Only admins and credit managers can decide credit overrides.');
      return;
    }

    const promptMessage = decision === 'REJECTED'
      ? 'Reason for rejecting this override:'
      : 'Optional comment for approving this override:';
    const comment = prompt(promptMessage) ?? undefined;
    if (decision === 'REJECTED' && !comment?.trim()) return;

    this.overrideDecisionLoadingId.set(override.id);
    try {
      const result = await this.riskMonitoringService.decideOverride(
        override.id,
        decision,
        comment?.trim() || undefined,
      );
      if (!result) {
        this.showToast('error', 'Override decision could not be recorded');
        return;
      }

      this.showToast(
        'success',
        result.status === 'APPROVED'
          ? 'Override approved and activated'
          : decision === 'REJECTED'
            ? 'Override rejected'
            : 'Override approval recorded',
      );
      await this.loadRiskSummary();
    } catch (err) {
      console.error('Failed to decide override:', err);
      this.showToast('error', 'Failed to record override decision');
    } finally {
      this.overrideDecisionLoadingId.set(null);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PARENT / CHILD HIERARCHY
  // ═══════════════════════════════════════════════════════════════════

  private async loadParentChildData(companyId: string): Promise<void> {
    this.childrenLoading.set(true);
    try {
      const [childRes, parentRes] = await Promise.all([
        firstValueFrom(this.http.get<ApiResponse<CompanyChildSummaryDto[]>>(`${API}/companies/local/${companyId}/children`)),
        firstValueFrom(this.http.get<ApiResponse<CompanyParentSummaryDto>>(`${API}/companies/local/${companyId}/parent`)),
      ]);
      this.childCompanies.set(childRes.success && childRes.data ? childRes.data : []);
      this.parentCompany.set(parentRes.success && parentRes.data ? parentRes.data : null);
      // If this is a parent with children, load aggregate
      if (this.childCompanies().length > 0) {
        this.loadGroupAggregate(companyId);
      }
    } catch {
      // ignore
    } finally {
      this.childrenLoading.set(false);
    }
  }

  private async loadGroupAggregate(companyId: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CompanyGroupAggregateDto>>(`${API}/companies/local/${companyId}/group-aggregate`),
      );
      if (res.success && res.data) {
        this.groupAggregate.set(res.data);
      }
    } catch {
      // ignore
    }
  }

  private async loadOwnCompanies(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<OwnCompanyDto[]>>(`${API}/companies/own`),
      );
      if (res.success && res.data) {
        this.ownCompanies.set(res.data);
      }
    } catch {
      // ignore
    }
  }

  async loadGroupOrders(): Promise<void> {
    const c = this.company();
    if (!c) return;
    this.groupOrdersLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<(CompanyOrder & { clientName?: string })[]>>(`${API}/companies/local/${c.id}/group-orders`),
      );
      if (res.success && res.data) {
        this.groupOrders.set(res.data);
      }
    } catch {
      // ignore
    } finally {
      this.groupOrdersLoading.set(false);
    }
  }

  toggleOrdersMode(): void {
    const next = this.groupOrdersMode() === 'own' ? 'group' : 'own';
    this.groupOrdersMode.set(next);
    if (next === 'group' && this.groupOrders().length === 0) {
      this.loadGroupOrders();
    }
  }

  async onLinkChildSearch(term: string): Promise<void> {
    this.linkChildSearch.set(term);
    if (this.linkChildSearchTimeout) clearTimeout(this.linkChildSearchTimeout);
    if (term.length < 2) { this.linkChildResults.set([]); return; }
    this.linkChildSearchTimeout = setTimeout(async () => {
      try {
        const res = await firstValueFrom(
          this.http.get<ApiResponse<{ companies: { id: string; name: string; country: string | null; parentId: string | null }[] }>>(`${API}/companies/local`, { params: { search: term, limit: '10' } }),
        );
        if (res.success && res.data?.companies) {
          const c = this.company();
          // Filter out self, existing children, and companies that already have a parent or have children of their own
          this.linkChildResults.set(
            res.data.companies.filter(
              (r) => r.id !== c?.id && !r.parentId && !this.childCompanies().some((ch) => ch.id === r.id),
            ),
          );
        }
      } catch { /* ignore */ }
    }, 300);
  }

  async linkChild(childId: string): Promise<void> {
    this.linkingChildId.set(childId);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<any>>(`${API}/companies/local/${childId}/set-parent`, { parentId: this.company()!.id }),
      );
      if (res.success) {
        this.showToast('success', 'Company linked as child');
        this.showLinkChildModal.set(false);
        this.linkChildSearch.set('');
        this.linkChildResults.set([]);
        await this.loadParentChildData(this.company()!.id);
      } else {
        this.showToast('error', res.message ?? 'Failed to link');
      }
    } catch (err: any) {
      this.showToast('error', err?.error?.message ?? 'Failed to link');
    } finally {
      this.linkingChildId.set(null);
    }
  }

  async unlinkChild(childId: string): Promise<void> {
    this.unlinkingChildId.set(childId);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<any>>(`${API}/companies/local/${childId}/remove-parent`, {}),
      );
      if (res.success) {
        this.showToast('success', 'Company unlinked');
        await this.loadParentChildData(this.company()!.id);
      } else {
        this.showToast('error', res.message ?? 'Failed to unlink');
      }
    } catch {
      this.showToast('error', 'Failed to unlink');
    } finally {
      this.unlinkingChildId.set(null);
    }
  }

  async removeOwnParent(): Promise<void> {
    const c = this.company();
    if (!c) return;
    this.unlinkingChildId.set(c.id);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<any>>(`${API}/companies/local/${c.id}/remove-parent`, {}),
      );
      if (res.success) {
        this.showToast('success', 'Unlinked from parent');
        this.parentCompany.set(null);
      } else {
        this.showToast('error', res.message ?? 'Failed to unlink');
      }
    } catch {
      this.showToast('error', 'Failed to unlink');
    } finally {
      this.unlinkingChildId.set(null);
    }
  }

  async loadGroupVessels(): Promise<void> {
    const c = this.company();
    if (!c) return;
    this.groupVesselsLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<GroupVesselRow[]>>(`${API}/companies/local/${c.id}/group-vessels`),
      );
      if (res.success) {
        this.groupVessels.set(res.data);
      }
    } catch {
      this.showToast('error', 'Failed to load group vessels');
    } finally {
      this.groupVesselsLoading.set(false);
    }
  }

  async loadGroupFleet(): Promise<void> {
    const c = this.company();
    if (!c) return;
    this.groupFleetLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<GroupFleetResponse>>(`${API}/companies/local/${c.id}/group-fleet`),
      );
      if (res.success && res.data) {
        this.groupFleet.set(res.data);
        if (this.groupFleetMode() === 'group') {
          this.refreshFleetMap(this.fleetVesselsWithPosition());
        }
      }
    } catch {
      this.showToast('error', 'Failed to load group fleet map');
    } finally {
      this.groupFleetLoading.set(false);
    }
  }

  toggleFleetMode(): void {
    const next = this.groupFleetMode() === 'own' ? 'group' : 'own';
    this.groupFleetMode.set(next);
    if (next === 'group' && this.groupVessels().length === 0) {
      this.loadGroupVessels();
    }
    if (next === 'group' && !this.groupFleet()) {
      this.loadGroupFleet();
      return;
    }
    this.refreshFleetMap(this.fleetVesselsWithPosition());
  }

  openGroupVessel(vessel: GroupVesselRow): void {
    if (vessel.localVesselId) {
      this.router.navigate(['/vessels', vessel.localVesselId]);
      return;
    }
    if (vessel.seasearcherVesselId) {
      this.navigateToVessel(vessel.seasearcherVesselId);
    }
  }

  // ─── Company Segmentation ─────────────────────────────────────────

  private async loadSegmentCategories(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ segmentCategories: { key: string; label: string; mode: 'multi' | 'single'; options: { key: string; label: string }[] }[] }>>(`${API}/admin/settings/segment-settings/options`),
      );
      if (res.success && res.data?.segmentCategories) {
        this.segmentCategories.set(res.data.segmentCategories);
      }
    } catch {
      // Segment categories not available — hide the card
    }
  }

  getSegmentValue(categoryKey: string): string | string[] | undefined {
    return this.companySegments()[categoryKey];
  }

  isSegmentSelected(categoryKey: string, optionKey: string): boolean {
    const val = this.companySegments()[categoryKey];
    if (Array.isArray(val)) return val.includes(optionKey);
    return val === optionKey;
  }

  toggleSegment(categoryKey: string, optionKey: string): void {
    const segments = { ...this.companySegments() };
    const current = segments[categoryKey];
    let arr = Array.isArray(current) ? [...current] : current ? [current] : [];
    if (arr.includes(optionKey)) {
      arr = arr.filter(k => k !== optionKey);
    } else {
      arr.push(optionKey);
    }
    segments[categoryKey] = arr;
    this.companySegments.set(segments);
    this.persistSegments(segments);
  }

  selectSingleSegment(categoryKey: string, optionKey: string): void {
    const segments = { ...this.companySegments() };
    segments[categoryKey] = segments[categoryKey] === optionKey ? '' : optionKey;
    this.companySegments.set(segments);
    this.persistSegments(segments);
  }

  private async persistSegments(segments: Record<string, string | string[]>): Promise<void> {
    const id = this.company()?.id;
    if (!id) return;
    this.segmentsSaving.set(true);
    try {
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<any>>(`${API}/companies/local/${id}/segments`, { segments }),
      );
      if (!res.success) {
        this.showToast('error', 'Failed to save segments');
      }
    } catch {
      this.showToast('error', 'Failed to save segments');
    } finally {
      this.segmentsSaving.set(false);
    }
  }
}
