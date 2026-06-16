import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
import { skip } from 'rxjs/operators';
import { API } from '@app/core/config/api';
import { WebSocketService } from '@app/core/websocket/websocket.service';
import { AuthService } from '@app/core/auth/auth.service';
import { flagFromIso3 } from '@app/shared/utils/flags';
import type {
  VesselDto,
  CounterpartyDto,
  ApiResponse,
  VesselCompanyDto,
  VesselCompanyRole,
  VesselCompanyRoleOption,
  CompanyContactDto,
  RiskHitDto,
} from '@fueld/types';

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

interface VesselCreditImpact {
  companyId: string;
  companyName: string;
  hits: RiskHitDto[];
}

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

interface SeasearcherMatch {
  seasearcherId: string;
  name: string;
  imo: string | null;
  mmsi: string | null;
  flag: string | null;
  flagCode: string | null;
  type: string | null;
  status: string | null;
  dwt: number | null;
  grossTonnage: number | null;
  buildYear: number | null;
  isSanctioned: boolean;
  alreadyImportedByVesselId: string | null;
}

const SS_CODE_TO_ROLE: Record<string, string> = {
  RO: 'REGISTERED_OWNER',
  NO: 'NOMINAL_OWNER',
  BO: 'BENEFICIAL_OWNER',
  CO: 'COMMERCIAL_OPERATOR',
  TP: 'THIRD_PARTY_OPERATOR',
  TM: 'TECHNICAL_MANAGER',
  IM: 'ISM_MANAGER',
};

@Injectable()
export class VesselDetailStore {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly pageTitle = inject(Title);
  private readonly wsService = inject(WebSocketService);
  private readonly authService = inject(AuthService);

  // ─── Core State ───────────────────────────────────────────────────
  readonly loading = signal(true);
  readonly vessel = signal<VesselDto | null>(null);
  readonly syncing = signal(false);
  readonly creditEnforcementSaving = signal(false);
  readonly creditImpactLoading = signal(false);

  // Enrichment
  readonly enrichment = signal<any>(null);
  readonly enrichmentLoading = signal(false);

  // Orders
  readonly vesselOrders = signal<any[]>([]);
  readonly ordersLoading = signal(false);

  // Movements
  readonly movements = signal<any[]>([]);
  readonly movementsLoading = signal(false);

  // Tabs
  readonly vesselInfoTab = signal<'info' | 'dimensions'>('info');

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
  readonly editPhone = signal('');
  readonly editLoa = signal('');
  readonly editBreadth = signal('');
  readonly editDepth = signal('');
  readonly editDraught = signal('');
  readonly editDwt = signal('');
  readonly editGrossTonnage = signal('');

  readonly vesselTypes = signal<string[]>([]);

  // Navigation state
  readonly navigatingCompanyId = signal<string | null>(null);
  readonly navigatingPlaceId = signal<string | null>(null);

  // Seasearcher merge
  readonly seasearcherMatch = signal<SeasearcherMatch | null>(null);
  readonly showMergePrompt = signal(false);
  readonly merging = signal(false);

  // Delete
  readonly confirmDeleteOpen = signal(false);
  readonly deleting = signal(false);
  readonly deleteError = signal('');
  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);

  // Vessel Companies
  readonly vesselCompanies = signal<VesselCompanyDto[]>([]);
  readonly linkedCreditImpacts = signal<VesselCreditImpact[]>([]);
  readonly companiesLoading = signal(false);
  readonly showAddCompany = signal(false);
  readonly companyForm = signal<{
    companyId: string;
    role: VesselCompanyRole;
    contactId: string | null;
    note: string;
  }>({ companyId: '', role: 'REGISTERED_OWNER', contactId: null, note: '' });
  readonly editingCompanyId = signal<string | null>(null);
  readonly savingCompany = signal(false);
  readonly companySearch = signal('');
  readonly companySearchResults = signal<CompanySearchResultOption[]>([]);
  readonly selectedCompany = signal<{ id: string; name: string } | null>(null);
  private companySearchTimeout: ReturnType<typeof setTimeout> | null = null;
  readonly companyContacts = signal<CompanyContactDto[]>([]);
  readonly companyContactsLoading = signal(false);
  readonly addingNewContact = signal(false);
  readonly newContactName = signal('');
  readonly newContactRole = signal('');
  readonly newContactEmail = signal('');
  readonly newContactPhone = signal('');
  readonly creatingContact = signal(false);

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

  /** Track which note IDs are expanded */
  readonly expandedNotes = signal<Set<string>>(new Set());

  // ─── Computed ─────────────────────────────────────────────────────
  readonly canDeleteEntity = computed(() => this.authService.isAdmin());
  readonly canManageCreditEnforcementException = computed(() =>
    this.authService.isAdmin() || this.authService.isCreditManager(),
  );

  readonly vesselFlag = computed(() => {
    const v = this.vessel();
    if (!v) return '';
    return flagFromIso3(v.flagCode ?? null);
  });

  readonly isSanctionedVessel = computed(() => {
    const vessel = this.vessel();
    if (!vessel) return false;
    return vessel.sanctionStatus === 'SANCTIONED' || this.enrichment()?.isSanctioned === true;
  });

  readonly hasActiveSeizureImpact = computed(() =>
    this.linkedCreditImpacts().some((impact) =>
      impact.hits.some((hit) => hit.signalType === 'SEIZURE'),
    ),
  );

  readonly showCreditEnforcementException = computed(() => {
    const vessel = this.vessel();
    if (!vessel) return false;
    return (
      this.canManageCreditEnforcementException() &&
      (this.isSanctionedVessel() || vessel.ignoreForCreditEnforcement)
    );
  });

  readonly positionTimestamp = computed<string>(() => {
    const enr = this.enrichment();
    const ts = enr?.latestInformation?.position?.timeStamp ?? enr?.latestInformation?.lastUpdated;
    if (!ts) return '';
    let d: Date;
    if (typeof ts === 'string' && ts.includes('/')) {
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

  readonly destinationInfo = computed<{
    name: string;
    country: string;
    flag: string;
    eta: string | null;
    placeId: string | null;
  }>(() => {
    const enr = this.enrichment();
    if (!enr) return { name: '', country: '', flag: '', eta: null, placeId: null };

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

    const liDest = enr.latestInformation?.destination;
    if (liDest) {
      return { name: liDest, country: '', flag: '', eta: null, placeId: null };
    }

    return { name: '', country: '', flag: '', eta: null, placeId: null };
  });

  readonly seasearcherSuggestions = computed<OwnershipEntry[]>(() => {
    const enr = this.enrichment();
    if (!enr?.ownershipHistory) return [];
    const current = (enr.ownershipHistory as OwnershipEntry[]).filter(
      (e: OwnershipEntry) => e.currentIndicator,
    );
    const vcs = this.vesselCompanies();
    return current
      .filter((entry) => {
        const mappedRole = SS_CODE_TO_ROLE[entry.typeCode];
        if (!mappedRole) return true;
        return !vcs.some(
          (vc) => vc.role === mappedRole && vc.source === 'seasearcher',
        );
      })
      .sort(
        (a: OwnershipEntry, b: OwnershipEntry) =>
          (ROLE_ORDER[a.typeCode] ?? 99) - (ROLE_ORDER[b.typeCode] ?? 99),
      );
  });

  readonly selectedCompanyRoleExists = computed(() => {
    const role = this.companyForm().role;
    const editId = this.editingCompanyId();
    return this.vesselCompanies().some((vc) => vc.role === role && vc.id !== editId);
  });

  // WebSocket subscriptions
  private syncSub: Subscription | null = null;
  private routeSub: Subscription | null = null;

  constructor() {
    effect(() => {
      const v = this.vessel();
      if (v?.name) {
        this.pageTitle.setTitle(`Fueld | Vessels > ${v.name}`);
      }
    });
  }

  /** Subscribe to param changes for same-route navigation */
  initRouteSubscription(route: any): void {
    this.routeSub = route.paramMap.pipe(skip(1)).subscribe((params: any) => {
      const newId = params.get('id');
      if (newId) {
        this.resetState();
        this.loadVessel(newId);
      }
    });
  }

  /** Subscribe to WS sync events */
  initSyncSubscription(): void {
    this.syncSub = this.wsService.on<VesselDto>('vessel-synced').subscribe((data) => {
      const current = this.vessel();
      if (current && data.id === current.id) {
        this.vessel.set(data);
        this.syncing.set(false);
      }
    });
  }

  destroy(): void {
    this.routeSub?.unsubscribe();
    this.syncSub?.unsubscribe();
  }

  // ─── State Management ─────────────────────────────────────────────
  private resetState(): void {
    this.vessel.set(null);
    this.enrichment.set(null);
    this.vesselTypes.set([]);
    this.loading.set(true);
    this.linkedCreditImpacts.set([]);
    this.vesselOrders.set([]);
    this.movements.set([]);
    this.editing.set(false);
    this.confirmDeleteOpen.set(false);
    this.deleting.set(false);
    this.deleteError.set('');
    this.toast.set(null);
  }

  // ─── Data Loading ─────────────────────────────────────────────────
  async loadRoleOptions(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ roles: VesselCompanyRoleOption[] }>>(
          `${API}/admin/settings/vessel-company-roles/options`,
        ),
      );
      if (res.success && res.data?.roles?.length) {
        this.roleOptions.set(res.data.roles);
      }
    } catch {
      // Keep defaults
    }
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

        if (res.data.seasearcherId) {
          this.syncing.set(true);
        }

        // Load parallel data
        this.loadEnrichment(res.data.seasearcherId);
        this.loadOrders(id);
        this.loadMovements(res.data.seasearcherId);
        this.loadVesselCompanies(id);
        this.loadVesselRiskImpacts(id);
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

  async loadVesselTypes(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ vesselTypes: string[] }>>(
          `${API}/admin/settings/my-vessel-types`,
        ),
      );
      if (res.success && res.data) {
        this.vesselTypes.set(res.data.vesselTypes);
      }
    } catch (err) {
      console.error('Failed to load vessel types:', err);
    }
  }

  // ─── Editing ─────────────────────────────────────────────────────
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
    this.editPhone.set(v.phone ?? '');
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
      if (this.editBuilder() !== (v.builder ?? ''))
        body['builder'] = this.editBuilder() || undefined;
      if (this.editClassification() !== (v.classificationSociety ?? ''))
        body['classificationSociety'] = this.editClassification() || undefined;
      if (this.editPhone() !== (v.phone ?? '')) body['phone'] = this.editPhone() || undefined;

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
      if ((dwtVal ?? null) !== (v.deadWeightTonnage ?? null))
        body['deadWeightTonnage'] = dwtVal;

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

      const savedVessel = this.vessel()!;
      const currentImo = savedVessel.imo;
      if (currentImo && !savedVessel.seasearcherId) {
        this.checkSeasearcherByImo(currentImo);
      }
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      this.editSaving.set(false);
    }
  }

  async setIgnoreForCreditEnforcement(value: boolean): Promise<void> {
    const vessel = this.vessel();
    if (!vessel || this.creditEnforcementSaving()) return;
    if (!this.canManageCreditEnforcementException()) {
      this.showToast(
        'error',
        'Only admins and credit managers can change credit enforcement exceptions.',
      );
      return;
    }

    this.creditEnforcementSaving.set(true);
    try {
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<VesselDto>>(`${API}/vessels/local/${vessel.id}`, {
          ignoreForCreditEnforcement: value,
        }),
      );
      if (res.success && res.data) {
        this.vessel.set(res.data);
        this.showToast(
          'success',
          value
            ? 'Vessel will be ignored for company credit enforcement after the next monitoring re-check.'
            : 'Vessel credit enforcement exception removed.',
        );
        return;
      }
      this.showToast('error', res.message ?? 'Failed to update vessel credit enforcement exception.');
    } catch (err) {
      console.error('Failed to update vessel credit enforcement exception:', err);
      this.showToast('error', 'Failed to update vessel credit enforcement exception.');
    } finally {
      this.creditEnforcementSaving.set(false);
    }
  }

  // ─── Seasearcher IMO merge ───────────────────────────────────────
  private async checkSeasearcherByImo(imo: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<any>>(`${API}/vessels/seasearcher-lookup`, {
          params: { imo },
        }),
      );
      if (res.success && res.data && !res.data.alreadyImportedByVesselId) {
        this.seasearcherMatch.set(res.data);
        this.showMergePrompt.set(true);
      }
    } catch {
      // Best-effort
    }
  }

  async confirmMerge(): Promise<void> {
    const match = this.seasearcherMatch();
    const v = this.vessel();
    if (!match || !v) return;

    this.merging.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<VesselDto>>(`${API}/vessels/local/${v.id}/merge`, {
          seasearcherId: match.seasearcherId,
        }),
      );
      if (res.success && res.data) {
        this.vessel.set(res.data);
        this.showToast(
          'success',
          'Vessel merged with Seasearcher — data will now sync automatically',
        );
        this.loadEnrichment(res.data.seasearcherId);
        this.loadMovements(res.data.seasearcherId);
      }
    } catch (err: any) {
      const msg = err?.error?.message ?? 'Failed to merge with Seasearcher';
      this.showToast('error', msg);
    } finally {
      this.merging.set(false);
      this.showMergePrompt.set(false);
      this.seasearcherMatch.set(null);
    }
  }

  dismissMerge(): void {
    this.showMergePrompt.set(false);
    this.seasearcherMatch.set(null);
  }

  // ─── Delete ──────────────────────────────────────────────────────
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

  // ─── Navigation ──────────────────────────────────────────────────
  goBack(): void {
    this.router.navigate(['/vessels']);
  }

  goToOrder(orderId: string, status?: string): void {
    const baseRoute =
      status === 'INQUIRY' || status === 'OFFER'
        ? '/trading/inquiries'
        : status === 'PAID'
          ? '/trading/completed-orders'
          : status === 'CANCELLED'
            ? '/trading/cancelled-orders'
            : '/trading/orders';
    this.router.navigate([baseRoute, orderId]);
  }

  async navigateToPlace(lliPlaceId: string): Promise<void> {
    if (this.navigatingPlaceId()) return;
    this.navigatingPlaceId.set(lliPlaceId);
    try {
      const lookup = await firstValueFrom(
        this.http.get<ApiResponse<{ id: string }>>(
          `${API}/lloyds/places/by-lli/${lliPlaceId}`,
        ),
      );
      if (lookup.success && lookup.data) {
        this.router.navigate(['/places', lookup.data.id]);
        return;
      }
      const imported = await firstValueFrom(
        this.http.post<ApiResponse<{ id: string }>>(`${API}/lloyds/places/import`, {
          lliPlaceId,
        }),
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

  async navigateToCompanyById(seasearcherId: string): Promise<void> {
    if (this.navigatingCompanyId()) return;
    this.navigatingCompanyId.set(seasearcherId);
    try {
      const lookup = await firstValueFrom(
        this.http.get<ApiResponse<CounterpartyDto>>(
          `${API}/companies/by-seasearcher/${seasearcherId}`,
        ),
      );
      if (lookup.success && lookup.data) {
        this.router.navigate(['/companies', lookup.data.id]);
        return;
      }
      const imported = await firstValueFrom(
        this.http.post<ApiResponse<CounterpartyDto>>(`${API}/companies/import`, {
          seasearcherId,
        }),
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

  // ─── Vessel Companies ────────────────────────────────────────────
  private async loadVesselCompanies(vesselId: string): Promise<void> {
    this.companiesLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<VesselCompanyDto[]>>(
          `${API}/vessels/local/${vesselId}/companies`,
        ),
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

  private async loadVesselRiskImpacts(vesselId: string): Promise<void> {
    if (!vesselId) {
      this.linkedCreditImpacts.set([]);
      return;
    }
    this.creditImpactLoading.set(true);
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<VesselCreditImpact[]>>(
          `${API}/risk-monitoring/vessel/${vesselId}/impacts`,
        ),
      );
      this.linkedCreditImpacts.set(
        response.success && response.data ? response.data : [],
      );
    } finally {
      this.creditImpactLoading.set(false);
    }
  }

  seizureHitsForImpact(impact: VesselCreditImpact): RiskHitDto[] {
    return impact.hits.filter((hit) => hit.signalType === 'SEIZURE');
  }

  openAddCompany(): void {
    this.companyForm.set({
      companyId: '',
      role: 'REGISTERED_OWNER',
      contactId: null,
      note: '',
    });
    this.editingCompanyId.set(null);
    this.selectedCompany.set(null);
    this.companySearch.set('');
    this.companySearchResults.set([]);
    this.companyContacts.set([]);
    this.showAddCompany.set(true);
  }

  openEditCompany(vc: VesselCompanyDto): void {
    this.companyForm.set({
      companyId: vc.companyId,
      role: vc.role,
      contactId: vc.contactId ?? null,
      note: vc.note ?? '',
    });
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
          this.http.get<
            ApiResponse<{ companies: { id: string; name: string; country: string | null }[] }>
          >(`${API}/companies/local?search=${encodeURIComponent(term)}&limit=15`),
        );
        const localResults = res.success && res.data ? res.data.companies : [];
        if (localResults.length) {
          this.companySearchResults.set(
            localResults.map((c) => ({
              key: c.id,
              source: 'local' as const,
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
                source: 'seasearcher' as const,
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
        this.http.post<ApiResponse<CounterpartyDto>>(`${API}/companies/import`, {
          seasearcherId,
        }),
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

  private async loadCompanyContacts(companyId: string): Promise<void> {
    this.companyContactsLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CompanyContactDto[]>>(
          `${API}/companies/local/${companyId}/contacts`,
        ),
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

  cancelNewContact(): void {
    this.addingNewContact.set(false);
    this.newContactName.set('');
    this.newContactRole.set('');
    this.newContactEmail.set('');
    this.newContactPhone.set('');
  }

  async createNewContact(): Promise<void> {
    const companyId = this.selectedCompany()?.id ?? this.editingCompanyId();
    let resolvedCompanyId = companyId;
    if (this.editingCompanyId() && !this.selectedCompany()) {
      const vc = this.vesselCompanies().find((v) => v.id === this.editingCompanyId());
      resolvedCompanyId = vc?.companyId ?? null;
    }
    if (!resolvedCompanyId || !this.newContactName().trim()) return;

    this.creatingContact.set(true);
    try {
      const body: Record<string, string> = { name: this.newContactName().trim() };
      if (this.newContactRole().trim()) body['role'] = this.newContactRole().trim();
      if (this.newContactEmail().trim()) body['email'] = this.newContactEmail().trim();
      if (this.newContactPhone().trim()) body['phone'] = this.newContactPhone().trim();

      const res = await firstValueFrom(
        this.http.post<ApiResponse<CompanyContactDto>>(
          `${API}/companies/local/${resolvedCompanyId}/contacts`,
          body,
        ),
      );
      if (res.success && res.data) {
        await this.loadCompanyContacts(resolvedCompanyId);
        this.companyForm.set({ ...this.companyForm(), contactId: res.data.id });
        this.cancelNewContact();
      }
    } catch (err) {
      console.error('Failed to create contact:', err);
    } finally {
      this.creatingContact.set(false);
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
          this.http.patch<ApiResponse<VesselCompanyDto>>(
            `${API}/vessels/local/${v.id}/companies/${editId}`,
            {
              role: form.role,
              contactId: form.contactId,
              note: form.note.trim() || undefined,
            },
          ),
        );
        if (res && res.success === false) {
          this.showToast('error', res.message ?? 'Failed to update company role.');
          return;
        }
      } else {
        if (!form.companyId) return;
        const replaceExistingRole = this.selectedCompanyRoleExists()
          ? window.confirm(
              'This role already exists for this vessel. Replace the existing one?',
            )
          : false;
        if (this.selectedCompanyRoleExists() && !replaceExistingRole) {
          this.showToast('error', 'Role already exists for this vessel.');
          return;
        }
        const res = await firstValueFrom(
          this.http.post<ApiResponse<VesselCompanyDto>>(
            `${API}/vessels/local/${v.id}/companies`,
            {
              companyId: form.companyId,
              role: form.role,
              contactId: form.contactId,
              note: form.note.trim() || undefined,
              replaceExistingRole: replaceExistingRole || undefined,
            },
          ),
        );
        if (res && res.success === false) {
          if ((res.message ?? '').includes('Role already exists for this vessel')) {
            const confirmReplace = window.confirm(
              'This role already exists for this vessel. Replace the existing one?',
            );
            if (confirmReplace) {
              const retry = await firstValueFrom(
                this.http.post<ApiResponse<VesselCompanyDto>>(
                  `${API}/vessels/local/${v.id}/companies`,
                  {
                    companyId: form.companyId,
                    role: form.role,
                    contactId: form.contactId,
                    note: form.note.trim() || undefined,
                    replaceExistingRole: true,
                  },
                ),
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

  async deleteVesselCompany(
    companyAssocId: string,
    companyName?: string,
    role?: string,
  ): Promise<void> {
    const v = this.vessel();
    if (!v) return;
    const label = role
      ? `${this.formatRole(role as VesselCompanyRole)} association`
      : 'company association';
    const target = companyName ? ` with ${companyName}` : '';
    const confirmed = window.confirm(
      `Are you sure you want to delete the ${label}${target}?`,
    );
    if (!confirmed) return;
    try {
      await firstValueFrom(
        this.http.delete(`${API}/vessels/local/${v.id}/companies/${companyAssocId}`),
      );
      this.showToast('success', `Deleted ${label}${target}.`);
      this.loadVesselCompanies(v.id);
    } catch (err) {
      console.error('Failed to delete vessel company:', err);
      this.showToast('error', 'Failed to remove company association.');
    }
  }

  /** Import a Seasearcher ownership entry as a local vesselCompany link */
  async linkSeasearcherCompany(entry: OwnershipEntry): Promise<void> {
    const v = this.vessel();
    if (!v || !entry.companyId || this.navigatingCompanyId()) return;
    this.navigatingCompanyId.set(entry.companyId);
    try {
      let localCompanyId: string;
      const lookup = await firstValueFrom(
        this.http.get<ApiResponse<CounterpartyDto>>(
          `${API}/companies/by-seasearcher/${entry.companyId}`,
        ),
      );
      if (lookup.success && lookup.data) {
        localCompanyId = lookup.data.id;
      } else {
        const imported = await firstValueFrom(
          this.http.post<ApiResponse<CounterpartyDto>>(`${API}/companies/import`, {
            seasearcherId: entry.companyId,
          }),
        );
        if (!imported.success || !imported.data) {
          this.showToast('error', 'Failed to import company from Seasearcher.');
          return;
        }
        localCompanyId = imported.data.id;
      }

      const mappedRole = SS_CODE_TO_ROLE[entry.typeCode] || entry.typeCode;
      const res = await firstValueFrom(
        this.http.post<ApiResponse<VesselCompanyDto>>(
          `${API}/vessels/local/${v.id}/companies`,
          {
            companyId: localCompanyId,
            role: mappedRole,
            source: 'seasearcher',
            replaceExistingRole: true,
          },
        ),
      );
      if (res.success) {
        this.showToast(
          'success',
          `Linked ${entry.companyName} as ${this.formatRole(mappedRole)}`,
        );
        await this.loadVesselCompanies(v.id);
      } else {
        this.showToast('error', res.message ?? 'Failed to link company.');
      }
    } catch (err) {
      console.error('Failed to link Seasearcher company:', err);
      this.showToast('error', 'Failed to link company from Seasearcher.');
    } finally {
      this.navigatingCompanyId.set(null);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────
  formatRole(role: string): string {
    const found = this.roleOptions().find((r) => r.key === role);
    if (found) return found.label;
    return role
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/\B\w+/g, (w) => w.toLowerCase());
  }

  getRoleDescription(role: string): string {
    const found = this.roleOptions().find((r) => r.key === role);
    return found?.description ?? '';
  }

  getSeasearcherTypeDescription(typeCode: string): string {
    const mappedRole = SS_CODE_TO_ROLE[typeCode];
    if (!mappedRole) return '';
    return this.getRoleDescription(mappedRole);
  }

  toggleNote(id: string): void {
    const s = new Set(this.expandedNotes());
    if (s.has(id)) s.delete(id);
    else s.add(id);
    this.expandedNotes.set(s);
  }

  formatPhone(phone: string | null | undefined): string {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10)
      return '+1 ' + digits.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
    if (digits.length === 11 && digits.startsWith('1'))
      return '+1 ' + digits.slice(1).replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
    return phone;
  }

  statusBadgeClass(status: string): string {
    switch (status) {
      case 'CONFIRMED':
        return 'bg-green-100 text-green-700';
      case 'DELIVERED':
        return 'bg-blue-100 text-blue-700';
      case 'INQUIRY':
        return 'bg-amber-100 text-amber-700';
      case 'CANCELLED':
      case 'LOST':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-600';
    }
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
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  etaRelative(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const ms = d.getTime() - Date.now();
    if (ms < 0) return 'arrived';
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    const hrs = Math.floor(
      (ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
    );
    if (days === 0 && hrs === 0) return 'arriving soon';
    if (days === 0) return `in ${hrs}h`;
    if (days === 1) return hrs > 0 ? `in 1 day ${hrs}h` : 'in 1 day';
    return `in ${days} days`;
  }

  getDurationDays(arrival: string, departure: string): string {
    const ms = new Date(departure).getTime() - new Date(arrival).getTime();
    const days = Math.round(ms / (1000 * 60 * 60 * 24));
    if (days === 0) return '< 1 day';
    return days === 1 ? '1 day' : `${days} days`;
  }

  ownerFlag(entry: OwnershipEntry): string {
    return flagFromIso3(entry.country.code ?? null);
  }

  showToast(type: 'success' | 'error', message: string): void {
    this.toast.set({ type, message });
    setTimeout(() => this.toast.set(null), 4000);
  }
}

const ROLE_ORDER: Record<string, number> = {
  BO: 0, CO: 1, RO: 2, NO: 3, TM: 4, TP: 5, IM: 6,
};