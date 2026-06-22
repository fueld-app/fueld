import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { API } from '@app/core/config/api';
import { WebSocketService } from '@app/core/websocket/websocket.service';
import { AuthService } from '@app/core/auth/auth.service';
import { RiskMonitoringService } from '@app/core/risk-monitoring/risk-monitoring.service';
import { COUNTRIES, countryLabel, countryFlagFromValue, countryFlagByIso3 } from '@app/shared/data/countries';
import type {
  ApiResponse,
  CounterpartyDto,
  CompanyContactDto,
  CompanyAttachmentDto,
  CompanyEmailDto,
  CompanyEmailType,
  CompanyChildSummaryDto,
  CompanyParentSummaryDto,
  CompanyGroupAggregateDto,
  CompanyPlaceSupplyRuleDto,
  CompanyPlaceSupplyRulePlaceType,
  OwnCompanyDto,
  PortSupplierDto,
  RiskHitDto,
  RiskOverrideDto,
  RiskSummaryDto,
  SupplyPortDto,
  VesselCompanyDto,
  VesselCompanyRole,
  VesselCompanyRoleOption,
  VesselDto,
} from '@fueld/types';

export type CompanyDetailTab = 'overview' | 'commercial' | 'fleet' | 'group' | 'risk';

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

interface SeizuresResponse {
  results: any[];
  totalMatches: number;
}

interface VesselSearchResult {
  source: 'local' | 'seasearcher';
  localId?: string;
  seasearcherId?: string;
  id?: string;
  name: string;
  imo?: string | null;
}

const SUPPLY_PORT_PRODUCT_OPTIONS = ['VLSFO', 'LSMGO', 'IFO380CST', 'MGO', 'LUBE'] as const;

const PLACE_SUPPLY_RULE_TYPE_OPTIONS: Array<{ value: CompanyPlaceSupplyRulePlaceType; label: string }> = [
  { value: 'POR', label: 'Port' },
  { value: 'PSP', label: 'Sub Port' },
  { value: 'ANC', label: 'Anchorage' },
  { value: 'TER', label: 'Terminal' },
  { value: 'FIL', label: 'Hydrocarbon Field' },
];

@Injectable()
export class CompanyDetailStore {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly pageTitle = inject(Title);
  private readonly wsService = inject(WebSocketService);
  private readonly authService = inject(AuthService);
  private readonly riskMonitoringService = inject(RiskMonitoringService);

  // Fleet map state (element ref lives in fleet-tab component)
  private fleetMap: any = null;
  private fleetMapInitialized = false;
  private vesselLayer: any = null;
  readonly fleetMapFullscreen = signal(false);

  // Timeouts
  private vesselSearchTimeout: ReturnType<typeof setTimeout> | null = null;
  private supplyPlaceSearchTimeout: ReturnType<typeof setTimeout> | null = null;
  private linkChildSearchTimeout: ReturnType<typeof setTimeout> | null = null;

  // Core state
  readonly loading = signal(true);
  readonly company = signal<CounterpartyDto | null>(null);
  readonly enrichment = signal<CompanyEnrichment | null>(null);
  readonly enrichmentLoading = signal(false);
  readonly companyOrders = signal<CompanyOrder[]>([]);
  readonly ordersLoading = signal(false);
  readonly syncing = signal(false);
  readonly deleting = signal(false);
  readonly deleteError = signal('');
  readonly typeSaving = signal(false);
  readonly teamUsers = signal<Array<{ id: string; name: string; email: string }>>([]);
  readonly responsibleUserId = signal<string | null>(null);
  readonly savingResponsible = signal(false);
  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);
  readonly editing = signal(false);
  readonly companyInfoTab = signal<'info' | 'headOffice' | 'offices' | 'terms' | 'emails'>('info');
  readonly countrySearchQuery = signal('');
  readonly showCountryDropdown = signal(false);
  readonly editCountry = signal('');
  readonly editCountryIso = signal('');
  readonly showCreditApplicationModal = signal(false);
  readonly companyVessels = signal<VesselCompanyDto[]>([]);
  readonly vesselsLoading = signal(false);
  readonly showAddVessel = signal(false);
  readonly vesselForm = signal<{ vesselId: string; role: VesselCompanyRole; contactId: string | null; note: string }>({
    vesselId: '',
    role: 'REGISTERED_OWNER',
    contactId: null,
    note: '',
  });
  readonly editingVesselAssocId = signal<string | null>(null);
  readonly savingVessel = signal(false);
  readonly vesselSearch = signal('');
  readonly vesselSearchResults = signal<Array<{ key: string; source: 'local' | 'seasearcher'; id?: string; seasearcherId?: string; name: string; imo?: string }>>([]);
  readonly selectedVessel = signal<{ id: string; name: string } | null>(null);
  readonly allTypes = signal<string[]>(['CLIENT', 'SUPPLIER', 'BROKER', 'AGENT']);
  readonly ownCompanies = signal<OwnCompanyDto[]>([]);
  readonly syncConflicts = signal<{ field: string; localValue: any; dismissed: boolean; seasearcherValue: any }[]>([]);
  readonly activeConflicts = computed(() => this.syncConflicts().filter((c) => !c.dismissed));
  readonly dismissedConflictsCount = computed(() => this.syncConflicts().filter((c) => c.dismissed).length);
  readonly dismissedConflictsList = computed(() => this.syncConflicts().filter((c) => c.dismissed));
  readonly parentCompany = signal<CompanyParentSummaryDto | null>(null);
  readonly groupAggregate = signal<CompanyGroupAggregateDto | null>(null);
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
  readonly sanctionsTab = signal<'risk' | 'sanctions' | 'seizures' | 'monitoring'>('monitoring');
  readonly riskSummary = signal<RiskSummaryDto | null>(null);
  readonly riskOverrides = signal<RiskOverrideDto[]>([]);
  readonly riskSummaryLoading = signal(false);
  readonly riskCheckRunning = signal(false);
  readonly overrideReason = signal('');
  readonly overrideRequesting = signal(false);
  readonly overrideDecisionLoadingId = signal<string | null>(null);
  readonly pendingRiskOverride = computed(() => this.riskOverrides().find((o) => o.status === 'PENDING') ?? null);
  readonly fleetRolesTab = signal<'fleet' | 'roles'>('fleet');
  readonly contacts = signal<CompanyContactDto[]>([]);
  readonly contactsLoading = signal(false);
  readonly showContactModal = signal(false);
  readonly editingContactId = signal<string | null>(null);
  readonly contactForm = signal({ name: '', role: '', phone: '', fax: '', email: '', notes: '' });
  readonly contactSaving = signal(false);
  readonly contactError = signal('');
  readonly deleteContactTarget = signal<CompanyContactDto | null>(null);
  readonly supplyPorts = signal<SupplyPortDto[]>([]);
  readonly supplyPortsLoading = signal(false);
  readonly showAddSupplyPort = signal(false);
  readonly editingSupplyPortId = signal<string | null>(null);
  readonly deleteSupplyPortTarget = signal<SupplyPortDto | null>(null);
  readonly supplyPlaceSearch = signal('');
  readonly supplyPlaceResults = signal<Array<{ id: string; name: string; unlocode?: string | null; parentPlaceUnlocode?: string | null; country: string | null; source?: 'local' | 'lloyds'; lliPlaceId?: string }>>([]);
  readonly selectedSupplyPlace = signal<{ id: string; name: string; unlocode?: string | null; parentPlaceUnlocode?: string | null; country: string | null } | null>(null);
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
  readonly placeSupplyRuleForm = signal<{ countryIso: string; placeTypes: CompanyPlaceSupplyRulePlaceType[]; contactId: string | null; products: string[]; note: string }>({
    countryIso: '',
    placeTypes: [],
    contactId: null,
    products: [],
    note: '',
  });
  readonly companyAttachments = signal<CompanyAttachmentDto[]>([]);
  readonly companyAttachmentsLoading = signal(false);
  readonly uploadingCompanyAttachment = signal(false);
  readonly deleteCompanyAttachmentTarget = signal<CompanyAttachmentDto | null>(null);
  readonly companyEmails = signal<CompanyEmailDto[]>([]);
  readonly emailsLoading = signal(false);
  readonly showAddEmail = signal(false);
  readonly emailForm = signal<{ emailType: CompanyEmailType; email: string; label: string; isPrimary: boolean }>({
    emailType: 'general',
    email: '',
    label: '',
    isPrimary: false,
  });
  readonly editingEmailId = signal<string | null>(null);
  readonly savingEmail = signal(false);
  readonly emailTypeOptions: CompanyEmailType[] = ['sales', 'invoice', 'inquiry', 'general'];
  readonly companyOffices = signal<CompanyOfficeDto[]>([]);
  readonly showAddOffice = signal(false);
  readonly savingOffice = signal(false);
  readonly officeForm = signal<{ city: string; country: string; address: string; phone: string; email: string }>({
    city: '',
    country: '',
    address: '',
    phone: '',
    email: '',
  });
  readonly editingOfficeId = signal<string | null>(null);
  readonly childCompanies = signal<CompanyChildSummaryDto[]>([]);
  readonly childrenLoading = signal(false);
  readonly linkChildSearch = signal('');
  readonly linkChildResults = signal<Array<{ id: string; name: string; country: string | null; parentId: string | null }>>([]);
  readonly linkingChildId = signal<string | null>(null);
  readonly showLinkChildModal = signal(false);
  readonly groupOrders = signal<(CompanyOrder & { clientName?: string })[]>([]);
  readonly groupOrdersLoading = signal(false);
  readonly groupOrdersMode = signal<'own' | 'group'>('own');
  readonly groupFleetMode = signal<'own' | 'group'>('own');
  readonly groupVessels = signal<GroupVesselRow[]>([]);
  readonly groupFleet = signal<GroupFleetResponse | null>(null);
  readonly groupFleetLoading = signal(false);
  readonly groupVesselsLoading = signal(false);
  readonly unlinkingChildId = signal<string | null>(null);
  readonly isParent = computed(() => this.childCompanies().length > 0);
  readonly isChild = computed(() => !!this.parentCompany());
  readonly segmentCategories = signal<Array<{ key: string; label: string; mode: 'multi' | 'single'; options: { key: string; label: string }[] }>>([]);
  readonly companySegments = signal<Record<string, string | string[]>>({});
  readonly segmentsSaving = signal(false);
  readonly navigatingCompanyId = signal<string | null>(null);
  readonly navigatingVesselId = signal<string | null>(null);
  readonly navigatingRiskHitId = signal<string | null>(null);
  readonly confirmDeleteVesselAssoc = signal<{ vesselId?: string | null; assocId: string; vesselName?: string | null; role?: string } | null>(null);
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
    return f.results.filter((v) => v.latestInformation?.position?.lat && v.latestInformation?.position?.lng);
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
  readonly ignoredCreditEnforcementVessels = computed(() =>
    this.companyVessels().filter((vesselCompany) => vesselCompany.ignoreForCreditEnforcement === true),
  );
  readonly canDeleteEntity = computed(
    () => this.authService.isAdmin() || this.authService.isCreditManager() || this.authService.isTeamLead(),
  );
  readonly canManageRiskOverrides = computed(() => this.authService.isAdmin() || this.authService.isCreditManager());
  readonly companyTypes = computed(() => {
    const c = this.company();
    if (!c) return [];
    return c.types?.length ? c.types : [c.type];
  });
  readonly companyFlag = computed(() => {
    const c = this.company();
    if (!c?.countryIso) return '';
    return countryFlagByIso3(c.countryIso);
  });
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
  readonly flatHierarchy = computed(() => {
    const h = this.hierarchy();
    if (!h?.companyHierarchy) return [];
    const nodes: HierarchyNode[] = [];
    const flatten = (node: HierarchyNode) => {
      nodes.push(node);
      if (node.companyHierarchy?.length) {
        for (const child of node.companyHierarchy) flatten(child);
      }
    };
    flatten(h.companyHierarchy);
    return nodes;
  });

  selectedCompanyAttachment: File | null = null;

  private syncSub = this.wsService.on<CounterpartyDto>('company-synced').subscribe((data) => {
    const current = this.company();
    if (current && data.id === current.id) {
      this.company.set(data);
      this.responsibleUserId.set(data.responsibleUserId ?? null);
      this.syncing.set(false);
      if (data.seasearcherId) {
        this.loadEnrichment(data.seasearcherId);
      }
      this.loadContacts(data.id);
    }
  });

  private conflictsSub = this.wsService
    .on<{ field: string; localValue: any; seasearcherValue: any; dismissed: boolean }[]>('company-sync-conflicts')
    .subscribe((conflicts) => {
      if (conflicts?.length) {
        this.syncConflicts.set(conflicts);
      }
    });

  constructor() {
    effect(() => {
      const c = this.company();
      if (c?.name) {
        this.pageTitle.setTitle(`${c.name} | Company`);
      }
    });
  }

  async loadCompany(id: string): Promise<void> {
    this.loading.set(true);
    this.sanctionsTab.set('monitoring');
    this.riskSummary.set(null);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<CounterpartyDto>>(`${API}/companies/local/${id}`));
      if (res.success && res.data) {
        this.resetState();
        const data = res.data;
        this.company.set(data);
        this.responsibleUserId.set(data.responsibleUserId ?? null);
        this.editCountry.set(data.country ?? '');
        this.editCountryIso.set(data.countryIso ?? '');
        this.countrySearchQuery.set(data.country ?? '');
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
        this.loadTeamUsers();
        this.loadRiskSummary();
        if (data.seasearcherId) {
          this.syncing.set(true);
          this.loadEnrichment(data.seasearcherId);
          this.loadFleet(data.seasearcherId);
          this.loadHierarchy(data.seasearcherId);
          this.loadSeizures(data.seasearcherId);
          this.loadSanctions(data.seasearcherId);
        }
      }
    } catch (err) {
      console.error('Failed to load company:', err);
    } finally {
      this.loading.set(false);
    }
  }

  private resetState(): void {
    this.company.set(null);
    this.enrichment.set(null);
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
    this.syncConflicts.set([]);
    this.parentCompany.set(null);
    this.groupAggregate.set(null);
    this.childCompanies.set([]);
    this.groupOrders.set([]);
    this.groupOrdersMode.set('own');
    this.companyEmails.set([]);
    this.companyOffices.set([]);
    this.riskOverrides.set([]);
    this.overrideReason.set('');
    this.overrideRequesting.set(false);
    this.overrideDecisionLoadingId.set(null);
    this.segmentCategories.set([]);
    this.companySegments.set({});
    this.segmentsSaving.set(false);
    this.navigatingCompanyId.set(null);
    this.navigatingVesselId.set(null);
    this.navigatingRiskHitId.set(null);
    this.deleteError.set('');
    this.deleting.set(false);
    this.typeSaving.set(false);
  }

  private resetCompanyAttachmentSelection(): void {
    this.selectedCompanyAttachment = null;
  }

  // ─── Data Loading ──────────────────────────────────────────────────
  async loadOrders(companyId: string): Promise<void> {
    this.ordersLoading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<CompanyOrder[]>>(`${API}/companies/local/${companyId}/orders`));
      if (res.success) this.companyOrders.set(res.data ?? []);
    } catch {
      // ignore
    } finally {
      this.ordersLoading.set(false);
    }
  }

  async loadCompanyVessels(companyId: string): Promise<void> {
    this.vesselsLoading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<VesselCompanyDto[]>>(`${API}/companies/local/${companyId}/vessels`));
      if (res.success) this.companyVessels.set(res.data ?? []);
    } catch (err) {
      console.error('Failed to load company vessels:', err);
    } finally {
      this.vesselsLoading.set(false);
    }
  }

  async loadContacts(companyId: string): Promise<void> {
    this.contactsLoading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<CompanyContactDto[]>>(`${API}/companies/local/${companyId}/contacts`));
      if (res.success) this.contacts.set(res.data ?? []);
    } catch {
      // ignore
    } finally {
      this.contactsLoading.set(false);
    }
  }

  async loadSupplyPorts(companyId: string): Promise<void> {
    this.supplyPortsLoading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<SupplyPortDto[]>>(`${API}/companies/local/${companyId}/supply-ports`));
      if (res.success && res.data) this.supplyPorts.set(res.data);
    } catch (err) {
      console.error('Failed to load supply ports:', err);
    } finally {
      this.supplyPortsLoading.set(false);
    }
  }

  async loadCompanyPlaceSupplyRules(companyId: string): Promise<void> {
    this.placeSupplyRulesLoading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<CompanyPlaceSupplyRuleDto[]>>(`${API}/companies/local/${companyId}/place-supply-rules`));
      if (res.success) this.placeSupplyRules.set(res.data ?? []);
    } catch (err) {
      console.error('Failed to load place supply rules:', err);
    } finally {
      this.placeSupplyRulesLoading.set(false);
    }
  }

  async loadCompanyAttachments(companyId: string): Promise<void> {
    this.companyAttachmentsLoading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<CompanyAttachmentDto[]>>(`${API}/companies/local/${companyId}/attachments`));
      if (res.success) this.companyAttachments.set(res.data ?? []);
    } catch (err) {
      console.error('Failed to load attachments:', err);
    } finally {
      this.companyAttachmentsLoading.set(false);
    }
  }

  async loadCompanyEmails(companyId: string): Promise<void> {
    this.emailsLoading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<CompanyEmailDto[]>>(`${API}/companies/local/${companyId}/emails`));
      if (res.success && res.data) this.companyEmails.set(res.data);
    } catch (err) {
      console.error('Failed to load emails:', err);
    } finally {
      this.emailsLoading.set(false);
    }
  }

  async loadCompanyOffices(companyId: string): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<CompanyOfficeDto[]>>(`${API}/companies/local/${companyId}/offices`));
      if (res.success && res.data) this.companyOffices.set(res.data);
    } catch (err) {
      console.error('Failed to load offices:', err);
    }
  }

  async onOfficeSave(form: { city: string; country: string; address: string; phone: string; email: string; editId?: string }): Promise<void> {
    const c = this.company();
    if (!c) return;
    this.savingOffice.set(true);
    try {
      const body = {
        city: form.city.trim(),
        country: form.country.trim() || null,
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
      };
      if (form.editId) {
        await firstValueFrom(this.http.patch(`${API}/companies/offices/${form.editId}`, body));
      } else {
        await firstValueFrom(this.http.post(`${API}/companies/local/${c.id}/offices`, body));
      }
      await this.loadCompanyOffices(c.id);
      this.showToast('success', form.editId ? 'Office updated' : 'Office added');
    } catch (err: any) {
      this.showToast('error', err?.error?.message ?? 'Failed to save office');
    } finally {
      this.savingOffice.set(false);
    }
  }

  async deleteCompanyOffice(officeId: string): Promise<void> {
    const c = this.company();
    if (!c) return;
    try {
      await firstValueFrom(this.http.delete(`${API}/companies/offices/${officeId}`));
      await this.loadCompanyOffices(c.id);
      this.showToast('success', 'Office deleted');
    } catch (err: any) {
      this.showToast('error', err?.error?.message ?? 'Failed to delete office');
    }
  }

  async onEmailSave(form: { emailType: CompanyEmailType; email: string; label: string; isPrimary: boolean; editId?: string }): Promise<void> {
    const c = this.company();
    if (!c) return;
    this.savingEmail.set(true);
    try {
      const body = {
        emailType: form.emailType,
        email: form.email.trim(),
        label: form.label.trim() || null,
        isPrimary: form.isPrimary,
      };
      if (form.editId) {
        await firstValueFrom(this.http.patch(`${API}/companies/emails/${form.editId}`, body));
      } else {
        await firstValueFrom(this.http.post(`${API}/companies/local/${c.id}/emails`, body));
      }
      await this.loadCompanyEmails(c.id);
      this.showToast('success', form.editId ? 'Email updated' : 'Email added');
    } catch (err: any) {
      this.showToast('error', err?.error?.message ?? 'Failed to save email');
    } finally {
      this.savingEmail.set(false);
    }
  }

  async deleteCompanyEmail(emailId: string): Promise<void> {
    const c = this.company();
    if (!c) return;
    try {
      await firstValueFrom(this.http.delete(`${API}/companies/emails/${emailId}`));
      await this.loadCompanyEmails(c.id);
      this.showToast('success', 'Email deleted');
    } catch (err: any) {
      this.showToast('error', err?.error?.message ?? 'Failed to delete email');
    }
  }

  async loadParentChildData(companyId: string): Promise<void> {
    this.childrenLoading.set(true);
    try {
      const parentRes = (await firstValueFrom(
        this.http.get<ApiResponse<CompanyParentSummaryDto>>(`${API}/companies/local/${companyId}/parent`),
      )) as ApiResponse<CompanyParentSummaryDto>;
      const childrenRes = (await firstValueFrom(
        this.http.get<ApiResponse<CompanyChildSummaryDto[]>>(`${API}/companies/local/${companyId}/children`),
      )) as ApiResponse<CompanyChildSummaryDto[]>;
      const aggregateRes = (await firstValueFrom(
        this.http.get<ApiResponse<CompanyGroupAggregateDto>>(`${API}/companies/local/${companyId}/group-aggregate`),
      )) as ApiResponse<CompanyGroupAggregateDto>;
      this.parentCompany.set(parentRes.success && parentRes.data ? parentRes.data : null);
      this.childCompanies.set(childrenRes.success && childrenRes.data ? childrenRes.data : []);
      this.groupAggregate.set(aggregateRes.success && aggregateRes.data ? aggregateRes.data : null);
    } catch (err) {
      console.error('Failed to load parent/child data:', err);
    } finally {
      this.childrenLoading.set(false);
    }
  }

  async loadOwnCompanies(): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<OwnCompanyDto[]>>(`${API}/companies/own`));
      if (res.success) this.ownCompanies.set(res.data ?? []);
    } catch (err) {
      console.error('Failed to load own companies:', err);
    }
  }

  async loadTeamUsers(): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<Array<{ id: string; name: string; email: string }>>>(`${API}/lloyds/users`));
      if (res.success && res.data) this.teamUsers.set(res.data);
    } catch (err) {
      console.error('Failed to load team users:', err);
    }
  }

  async loadEnrichment(seasearcherId: string): Promise<void> {
    this.enrichmentLoading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<CompanyEnrichment>>(`${API}/companies/enrichment/${seasearcherId}`));
      if (res.success) this.enrichment.set(res.data ?? null);
    } catch {
      // ignore
    } finally {
      this.enrichmentLoading.set(false);
    }
  }

  async loadFleet(seasearcherId: string): Promise<void> {
    this.fleetLoading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<FleetResponse>>(`${API}/companies/enrichment/${seasearcherId}/fleet`));
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
    const seasearcherIds = results.map((v) => (v.id ? String(v.id) : '')).filter(Boolean);
    const imos = results.map((v) => (v.imo ? String(v.imo) : '')).filter(Boolean);
    if (!seasearcherIds.length && !imos.length) {
      this.fleetMatchBySeasearcherId.set({});
      this.fleetMatchByImo.set({});
      return;
    }
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<VesselDto[]>>(`${API}/vessels/local/match`, { seasearcherIds, imos }),
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
      const res = await firstValueFrom(this.http.get<ApiResponse<HierarchyResponse>>(`${API}/companies/enrichment/${seasearcherId}/hierarchy`));
      if (res.success) this.hierarchy.set(res.data ?? null);
    } catch {
      // ignore
    }
  }

  async loadSeizures(seasearcherId: string): Promise<void> {
    this.seizuresLoading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<SeizuresResponse>>(`${API}/companies/enrichment/${seasearcherId}/seizures`));
      if (res.success) this.seizures.set(res.data ?? null);
    } catch {
      // ignore
    } finally {
      this.seizuresLoading.set(false);
    }
  }

  async loadSanctions(seasearcherId: string): Promise<void> {
    this.sanctionsLoading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<any[]>>(`${API}/companies/enrichment/${seasearcherId}/sanctions`));
      if (res.success) this.sanctions.set(res.data ?? null);
    } catch {
      // ignore
    } finally {
      this.sanctionsLoading.set(false);
    }
  }

  async loadRiskSummary(): Promise<void> {
    const id = this.company()?.id;
    if (!id) return;
    this.riskSummaryLoading.set(true);
    try {
      const [summary, overrides] = await Promise.all([
        this.riskMonitoringService.getSummary(id),
        this.riskMonitoringService.getOverrides(id),
      ]);
      this.riskSummary.set(summary);
      this.riskOverrides.set(overrides);
    } catch (err) {
      console.error('Failed to load risk summary:', err);
    } finally {
      this.riskSummaryLoading.set(false);
    }
  }

  async loadGroupOrders(): Promise<void> {
    const id = this.company()?.id;
    if (!id) return;
    this.groupOrdersLoading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<(CompanyOrder & { clientName?: string })[]>>(`${API}/companies/local/${id}/group-orders`));
      if (res.success) this.groupOrders.set(res.data ?? []);
    } catch {
      // ignore
    } finally {
      this.groupOrdersLoading.set(false);
    }
  }

  async loadGroupVessels(): Promise<void> {
    const id = this.company()?.id;
    if (!id) return;
    this.groupVesselsLoading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<GroupVesselRow[]>>(`${API}/companies/local/${id}/group-vessels`));
      if (res.success) this.groupVessels.set(res.data ?? []);
    } catch (err) {
      console.error('Failed to load group vessels:', err);
    } finally {
      this.groupVesselsLoading.set(false);
    }
  }

  async loadGroupFleet(): Promise<void> {
    const id = this.company()?.id;
    if (!id) return;
    this.groupFleetLoading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<GroupFleetResponse>>(`${API}/companies/local/${id}/group-fleet`));
      if (res.success && res.data) this.groupFleet.set(res.data);
    } catch (err) {
      console.error('Failed to load group fleet:', err);
    } finally {
      this.groupFleetLoading.set(false);
    }
  }

  async loadSegmentCategories(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<
          ApiResponse<{
            segmentCategories: Array<{ key: string; label: string; mode: 'multi' | 'single'; options: { key: string; label: string }[] }>;
          }>
        >(`${API}/admin/settings/segment-settings/options`),
      );
      if (res.success && res.data?.segmentCategories) this.segmentCategories.set(res.data.segmentCategories);
    } catch {
      // ignore
    }
  }

  async loadCompanySegments(companyId: string): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<Record<string, string | string[]>>>(`${API}/companies/local/${companyId}/segments`));
      if (res.success) this.companySegments.set(res.data ?? {});
    } catch (err) {
      console.error('Failed to load company segments:', err);
    }
  }

  // ─── Actions ───────────────────────────────────────────────────────

  goBack(): void {
    void this.router.navigate(['/companies']);
  }

  goToOrder(orderId: string): void {
    void this.router.navigate(['/orders', orderId]);
  }

  async navigateToCompany(seasearcherId: string): Promise<void> {
    this.navigatingCompanyId.set(seasearcherId);
    try {
      const existing = await firstValueFrom(
        this.http.get<ApiResponse<CounterpartyDto>>(`${API}/companies/by-seasearcher/${seasearcherId}`),
      ).catch(() => null);
      if (existing?.success && existing.data) {
        await this.router.navigate(['/companies', existing.data.id]);
        return;
      }
      const imported = await firstValueFrom(
        this.http.post<ApiResponse<CounterpartyDto>>(`${API}/companies/import`, { seasearcherId }),
      );
      if (imported?.success && imported.data) {
        await this.router.navigate(['/companies', imported.data.id]);
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
        await this.router.navigate(['/vessels', existing.data.id]);
        return;
      }
      const imported = await firstValueFrom(
        this.http.post<ApiResponse<VesselDto>>(`${API}/vessels/import`, { seasearcherId }),
      );
      if (imported?.success && imported.data) {
        await this.router.navigate(['/vessels', imported.data.id]);
      }
    } finally {
      this.navigatingVesselId.set(null);
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
        if (res.data.seasearcherId) this.loadEnrichment(res.data.seasearcherId);
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
        await this.router.navigate(['/companies']);
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
    if (current.includes(type) && current.length <= 1) return;
    const next = current.includes(type) ? current.filter((t) => t !== type) : [...current, type];
    this.typeSaving.set(true);
    try {
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<CounterpartyDto>>(`${API}/companies/local/${c.id}/types`, { types: next }),
      );
      if (res.success && res.data) this.company.set(res.data);
    } catch (err) {
      console.error('Failed to update types:', err);
    } finally {
      this.typeSaving.set(false);
    }
  }

  async onCompanyInfoSave(body: Record<string, any>): Promise<void> {
    const c = this.company();
    if (!c) return;
    try {
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<CounterpartyDto>>(`${API}/companies/local/${c.id}`, body),
      );
      if (res.success && res.data) this.company.set(res.data);
    } catch (err) {
      console.error('Failed to update company:', err);
    }
  }

  async onResponsibleUserChange(userId: string): Promise<void> {
    const c = this.company();
    if (!c || this.savingResponsible()) return;
    this.savingResponsible.set(true);
    try {
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<CounterpartyDto>>(`${API}/companies/local/${c.id}/responsible-user`, {
          userId: userId || null,
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

  onCountrySearch(value: string): void {
    this.countrySearchQuery.set(value);
    this.showCountryDropdown.set(true);
  }

  selectCountry(country: { code: string; name: string }): void {
    this.editCountry.set(country.name);
    this.editCountryIso.set(country.code);
    this.countrySearchQuery.set(country.name);
    this.showCountryDropdown.set(false);
  }

  onCreditApplicationSubmitted(): void {
    this.showCreditApplicationModal.set(false);
  }

  // ─── Fleet ─────────────────────────────────────────────────────────
  fleetRowKey(v: FleetVessel): string {
    if (v.id) return `sea:${v.id}`;
    if (v.imo) return `imo:${v.imo}`;
    return `name:${v.name}`;
  }

  fleetRoleFor(v: FleetVessel): VesselCompanyRole {
    return this.fleetRoleSelections()[this.fleetRowKey(v)] ?? 'REGISTERED_OWNER';
  }

  fleetEffectiveRole(v: FleetVessel): VesselCompanyRole {
    return this.company()?.seasearcherId ? 'REGISTERED_OWNER' : this.fleetRoleFor(v);
  }

  setFleetRoleFor(v: FleetVessel, role: VesselCompanyRole): void {
    this.fleetRoleSelections.set({ ...this.fleetRoleSelections(), [this.fleetRowKey(v)]: role });
  }

  onFleetRoleChange(v: FleetVessel, role: VesselCompanyRole): void {
    const matchedBySeasearcher = v.id && this.fleetMatchBySeasearcherId()[String(v.id)];
    if (matchedBySeasearcher && role !== 'REGISTERED_OWNER') {
      this.showToast('error', 'Auto-matched vessels must be Registered Owner.');
      this.setFleetRoleFor(v, 'REGISTERED_OWNER');
      void this.linkFleetVessel(v);
      return;
    }
    this.setFleetRoleFor(v, role);
    void this.linkFleetVessel(v);
  }

  fleetLocalMatch(v: FleetVessel): VesselDto | undefined {
    return (
      (v.id ? this.fleetMatchBySeasearcherId()[String(v.id)] : undefined) ??
      (v.imo ? this.fleetMatchByImo()[String(v.imo)] : undefined)
    );
  }

  fleetLinkedRoles(v: FleetVessel): VesselCompanyRole[] {
    const match = this.fleetLocalMatch(v);
    if (!match) return [];
    return Array.from(new Set(this.companyVessels().filter((vc) => vc.vesselId === match.id).map((vc) => vc.role)));
  }

  fleetRoleExists(v: FleetVessel): boolean {
    const match = this.fleetLocalMatch(v);
    if (!match) return false;
    return this.companyVessels().some((vc) => vc.vesselId === match.id && vc.role === this.fleetEffectiveRole(v));
  }

  fleetLinkLabel(v: FleetVessel): string {
    const match = this.fleetLocalMatch(v);
    const role = this.fleetEffectiveRole(v);
    if (match && this.companyVessels().some((vc) => vc.vesselId === match.id && vc.role === role)) {
      return this.company()?.seasearcherId ? 'Replace Reg. Owner' : 'Linked';
    }
    if (!match) return 'Import + Link';
    return this.companyVessels().some((vc) => vc.vesselId === match.id) ? 'Add Role' : 'Link';
  }

  async linkFleetVessel(v: FleetVessel): Promise<void> {
    const c = this.company();
    if (!c) return;
    const key = this.fleetRowKey(v);
    const role = this.fleetEffectiveRole(v);
    this.linkingFleetKey.set(key);
    try {
      const shouldReplace = this.company()?.seasearcherId && role === 'REGISTERED_OWNER';
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
          this.fleetMatchByImo.set({ ...this.fleetMatchByImo(), [importRes.data.imo]: importRes.data });
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
      await this.loadCompanyVessels(c.id);
      this.showToast(
        'success',
        shouldReplace
          ? `Replaced existing ${role.toLowerCase()} for vessel ${v.name ?? v.imo ?? ''}`
          : `Linked vessel ${v.name ?? v.imo ?? ''}`,
      );
    } catch (err) {
      console.error('Failed to link fleet vessel:', err);
      this.showToast('error', 'Failed to link vessel.');
    } finally {
      this.linkingFleetKey.set(null);
    }
  }

  async deleteCompanyVessel(vesselId: string | null | undefined, assocId: string): Promise<void> {
    const c = this.company();
    if (!c) return;
    try {
      const url = vesselId
        ? `${API}/vessels/local/${vesselId}/companies/${assocId}`
        : `${API}/vessels/companies/${assocId}`;
      const res = await firstValueFrom(this.http.delete<ApiResponse<any>>(url));
      if (res && res.success) {
        const d = res.data;
        this.showToast('success', `Removed ${d?.role ?? 'association'} — ${d?.companyName ?? 'company'}`);
      }
      await this.loadCompanyVessels(c.id);
    } catch (err) {
      console.error('Failed to delete vessel association:', err);
      this.showToast('error', 'Failed to remove vessel association.');
    }
  }

  executeDeleteVesselAssoc(): void {
    const target = this.confirmDeleteVesselAssoc();
    if (!target) return;
    void this.deleteCompanyVessel(target.vesselId, target.assocId);
    this.confirmDeleteVesselAssoc.set(null);
  }

  // ─── Risk ─────────────────────────────────────────────────────────
  onSanctionsTabChange(tab: string): void {
    const t = tab as 'risk' | 'sanctions' | 'seizures' | 'monitoring';
    this.sanctionsTab.set(t);
    if (t === 'monitoring') this.loadRiskSummary();
  }

  async runManualCheck(): Promise<void> {
    const c = this.company();
    if (!c || this.riskCheckRunning() || !this.canManageRiskOverrides()) return;
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
    if (!c || !this.canManageRiskOverrides()) return;
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
    if (this.overrideDecisionLoadingId() || this.hasVotedOnOverride(override) || !this.canManageRiskOverrides()) return;
    const promptMessage =
      decision === 'REJECTED'
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
        this.http.get<ApiResponse<VesselSearchResult[]>>(`${API}/vessels/search?term=${encodeURIComponent(vesselName)}`),
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
    return hit.title.slice(prefix.length).trim() || null;
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
    const exactLocal = results.find(
      (r) => r.source === 'local' && r.name.trim().toLowerCase() === normalizedTarget,
    );
    if (exactLocal) return exactLocal;
    const exactSea = results.find(
      (r) => r.source === 'seasearcher' && r.name.trim().toLowerCase() === normalizedTarget,
    );
    if (exactSea) return exactSea;
    return results.find((r) => r.source === 'local') ?? results.find((r) => r.source === 'seasearcher') ?? null;
  }

  // ─── Group ──────────────────────────────────────────────────────────
  async onLinkChildSearch(term: string): Promise<void> {
    this.linkChildSearch.set(term);
    if (this.linkChildSearchTimeout) clearTimeout(this.linkChildSearchTimeout);
    if (term.length < 2) {
      this.linkChildResults.set([]);
      return;
    }
    this.linkChildSearchTimeout = setTimeout(async () => {
      try {
        const res = (await firstValueFrom(
          this.http.get<ApiResponse<{ companies: Array<{ id: string; name: string; country: string | null; parentId: string | null }> }>>(
            `${API}/companies/local`,
            { params: { search: term, limit: '10' } },
          ),
        )) as ApiResponse<{ companies: Array<{ id: string; name: string; country: string | null; parentId: string | null }> }>;
        if (res.success && res.data?.companies) {
          const c = this.company();
          this.linkChildResults.set(
            res.data.companies.filter(
              (r: { id: string; name: string; country: string | null; parentId: string | null }) =>
                r.id !== c?.id && !r.parentId && !this.childCompanies().some((ch: CompanyChildSummaryDto) => ch.id === r.id),
            ),
          );
        }
      } catch {
        /* ignore */
      }
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

  toggleOrdersMode(): void {
    const next = this.groupOrdersMode() === 'own' ? 'group' : 'own';
    this.groupOrdersMode.set(next);
    if (next === 'group' && this.groupOrders().length === 0) this.loadGroupOrders();
  }

  toggleFleetMode(): void {
    const next = this.groupFleetMode() === 'own' ? 'group' : 'own';
    this.groupFleetMode.set(next);
    if (next === 'group' && this.groupVessels().length === 0) this.loadGroupVessels();
    if (next === 'group' && !this.groupFleet()) this.loadGroupFleet();
  }

  openGroupVessel(vessel: GroupVesselRow): void {
    if (vessel.localVesselId) {
      void this.router.navigate(['/vessels', vessel.localVesselId]);
      return;
    }
    if (vessel.seasearcherVesselId) {
      void this.navigateToVessel(vessel.seasearcherVesselId);
    }
  }

  // ─── Segments ───────────────────────────────────────────────────────
  onSegmentToggle(event: { catKey: string; optKey: string; mode: 'multi' | 'single' }): void {
    if (event.mode === 'multi') this.toggleSegment(event.catKey, event.optKey);
    else this.selectSingleSegment(event.catKey, event.optKey);
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
    if (arr.includes(optionKey)) arr = arr.filter((k) => k !== optionKey);
    else arr.push(optionKey);
    segments[categoryKey] = arr;
    this.companySegments.set(segments);
    void this.persistSegments(segments);
  }

  selectSingleSegment(categoryKey: string, optionKey: string): void {
    const segments = { ...this.companySegments() };
    segments[categoryKey] = segments[categoryKey] === optionKey ? '' : optionKey;
    this.companySegments.set(segments);
    void this.persistSegments(segments);
  }

  private async persistSegments(segments: Record<string, string | string[]>): Promise<void> {
    const id = this.company()?.id;
    if (!id) return;
    this.segmentsSaving.set(true);
    try {
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<any>>(`${API}/companies/local/${id}/segments`, { segments }),
      );
      if (!res.success) this.showToast('error', 'Failed to save segments');
    } catch {
      this.showToast('error', 'Failed to save segments');
    } finally {
      this.segmentsSaving.set(false);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────
  typeLabel(type: string): string {
    return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  }

  typeBadgeClass(type: string): string {
    switch (type) {
      case 'CLIENT':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400';
      case 'SUPPLIER':
        return 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400';
      case 'BROKER':
        return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-400';
      case 'AGENT':
        return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400';
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-400';
    }
  }

  countryFlag(iso3: string | null | undefined): string {
    return countryFlagByIso3(iso3 ?? null);
  }

  placeCountryFlag(value: string | null | undefined): string {
    return countryFlagFromValue(value);
  }

  placeCountryLabel(value: string | null | undefined): string {
    return countryLabel(value);
  }

  emptyPlaceSupplyRuleForm(): { countryIso: string; placeTypes: CompanyPlaceSupplyRulePlaceType[]; contactId: string | null; products: string[]; note: string } {
    return {
      countryIso: '',
      placeTypes: this.placeSupplyRulePlaceTypeOptions.map((option) => option.value),
      contactId: null,
      products: [],
      note: '',
    };
  }

  websiteUrl(): string {
    const w = this.company()?.website;
    if (!w) return '#';
    return w.startsWith('http') ? w : `https://${w}`;
  }

  statusBadge(status: string): string {
    switch (status) {
      case 'DRAFT':
        return 'bg-gray-100 text-gray-600 dark:bg-gray-500/15 dark:text-gray-400';
      case 'CONFIRMED':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400';
      case 'DELIVERED':
        return 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400';
      case 'INVOICED':
        return 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400';
      case 'CANCELLED':
        return 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400';
      default:
        return 'bg-gray-100 text-gray-600 dark:bg-gray-500/15 dark:text-gray-400';
    }
  }

  formatRole(role: string): string {
    return role
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/\B\w+/g, (w) => w.toLowerCase());
  }

  formatPhone(nums: Array<{ countryDialingCode: string; areaDialingCode: string; number: string }>): string {
    return nums.map((t) => `+${t.countryDialingCode} ${t.areaDialingCode} ${t.number}`.trim()).join(', ');
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  formatEmailType(type: CompanyEmailType): string {
    switch (type) {
      case 'sales':
        return 'Sales';
      case 'invoice':
        return 'Invoice';
      case 'inquiry':
        return 'Inquiry';
      case 'general':
        return 'General';
      default:
        return type.charAt(0).toUpperCase() + type.slice(1);
    }
  }

  emailTypeBadgeClass(type: CompanyEmailType): string {
    switch (type) {
      case 'sales':
        return 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400';
      case 'invoice':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400';
      case 'inquiry':
        return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400';
      case 'general':
        return 'bg-gray-100 text-gray-600 dark:bg-gray-500/15 dark:text-gray-400';
      default:
        return 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400';
    }
  }

  placeSupplyRulePlaceTypeLabel(type: CompanyPlaceSupplyRulePlaceType): string {
    return this.placeSupplyRulePlaceTypeOptions.find((option) => option.value === type)?.label ?? type;
  }

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

  showToast(type: 'success' | 'error', message: string): void {
    this.toast.set({ type, message });
    setTimeout(() => this.toast.set(null), 4000);
  }

  destroy(): void {
    this.syncSub.unsubscribe();
    this.conflictsSub.unsubscribe();
  }
}
