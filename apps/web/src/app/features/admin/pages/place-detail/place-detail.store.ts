import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
import { API } from '@app/core/config/api';
import { WebSocketService } from '@app/core/websocket/websocket.service';
import { AuthService } from '@app/core/auth/auth.service';
import { flagFromIso3, flagFromUnlocode } from '@app/shared/utils/flags';
import type {
  ApiResponse,
  PlaceDto,
  PortSupplierDto,
  ExpectedArrivalDto,
  CompanyContactDto,
  CounterpartyDto,
  VesselDto,
} from '@fueld/types';
import * as L from 'leaflet/dist/leaflet-src.esm.js';

export type PlaceDetailTab = 'overview' | 'traffic' | 'structure' | 'commercial';

interface PlaceEnrichment {
  geoJsonObject: unknown | null;
  hierarchy: HierarchyNode[];
  parentPlaceId: string | null;
  parentPlaceName: string | null;
  childrenData: { type: string; count: number }[];
  children: ChildPlace[];
}

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

interface PlaceOrder {
  id: string;
  reference: string | null;
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
  name?: string;
  category?: string;
  description?: string;
  maxSize?: string | number | null;
  maxDwt?: string | number | null;
  capacity?: string | number | null;
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

interface PlaceEditForm {
  name: string;
  country: string;
  countryIso: string;
  area: string;
  subRegion: string;
  placeType: string;
  timezone: string;
  unlocode: string;
  admiraltyChart: string;
  lat: number | null;
  long: number | null;
  parentPlaceId: string;
  parentPlaceName: string;
}

interface PlaceSupplierForm {
  companyId: string;
  contactId: string | null;
  products: string[];
  note: string;
}

interface UserOption {
  id: string;
  name: string;
  email: string;
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

const PRODUCT_OPTIONS = ['VLSFO', 'LSMGO', 'IFO380CST', 'MGO', 'LUBE'] as const;

const PLACE_TYPE_LABELS: Record<string, string> = {
  POR: 'Port',
  PSP: 'Sub Port',
  ANC: 'Anchorage',
  TER: 'Terminal',
  FIL: 'Hydrocarbon Field',
};

const CATEGORY_ICONS: Record<string, string> = {
  TERMINAL: '🏭',
  ANCHORAGE: '⚓',
  BERTH: '🔗',
};

const CHILD_TYPE_ICONS: Record<string, string> = {
  POR: '🏗️',
  PSP: '🚢',
  TER: '🏭',
  ANC: '⚓',
  FIL: '🛢️',
};

const FACILITY_ICONS: Record<number, string> = {
  1: '🏛️', 2: '📋', 3: '🔒', 4: '📜', 5: '📄', 6: '🚢',
  7: '⚓', 8: '🧭', 9: '📻', 10: '🏥', 11: '🏥', 12: '🛃',
  13: '📏', 14: '🔗', 15: '🏗️', 16: '📦', 17: '👥', 18: '📥',
  19: '⛽', 20: '💧', 21: '🚤', 22: '🔧', 23: '🛒', 24: '🚢',
  25: '📦', 26: '🔎', 27: '🏥', 28: '✈️', 29: '🚂', 30: '🏗️',
  31: '🏢', 32: '♻️',
};

const COMMON_TIMEZONES: string[] = [
  'UTC', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Copenhagen',
  'Europe/Oslo', 'Europe/Stockholm', 'Europe/Helsinki', 'Europe/Athens',
  'Europe/Istanbul', 'Europe/Moscow', 'Africa/Cairo', 'Africa/Lagos',
  'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Muscat', 'Asia/Karachi',
  'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Singapore',
  'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Seoul', 'Asia/Tokyo',
  'Australia/Perth', 'Australia/Sydney', 'Pacific/Auckland',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Anchorage', 'America/Sao_Paulo', 'America/Buenos_Aires',
  'America/Panama', 'America/Houston',
];

function metersPerPx(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

function vesselIcon(heading: number | null, loa: number | null, zoom: number, lat: number): L.DivIcon {
  const deg = heading ?? 0;
  const loaMeters = loa ?? 100;
  const mpp = metersPerPx(lat, zoom);
  const h = Math.round(Math.max(10, Math.min(loaMeters / mpp, 120)));
  const w = Math.round(h * 0.35);
  const fill = loaMeters < 120 ? '#3b82f6' : loaMeters < 250 ? '#f97316' : '#ef4444';
  const stroke = loaMeters < 120 ? '#1d4ed8' : loaMeters < 250 ? '#c2410c' : '#991b1b';
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

@Injectable()
export class PlaceDetailStore {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly pageTitle = inject(Title);
  private readonly wsService = inject(WebSocketService);
  private readonly authService = inject(AuthService);

  // Core state
  readonly place = signal<PlaceDto | null>(null);
  readonly loading = signal(true);
  readonly enrichment = signal<PlaceEnrichment | null>(null);
  readonly canDeleteEntity = computed(() => this.authService.isAdmin());
  readonly syncing = signal(false);

  // Parent / hierarchy
  readonly parentLocalId = signal<string | null>(null);
  readonly parentPlaceName = signal<string | null>(null);
  readonly expandedNodes = signal<Set<string>>(new Set());
  readonly terminals = computed(() => this.enrichment()?.hierarchy?.filter((n) => n.category !== 'ANCHORAGE') ?? []);
  readonly anchorages = computed(() => this.enrichment()?.hierarchy?.filter((n) => n.category === 'ANCHORAGE') ?? []);

  // Map + traffic
  readonly nearbyVessels = signal<NearbyVessel[]>([]);
  readonly vesselsLoading = signal(false);
  readonly expectedArrivals = signal<ExpectedArrivalDto[]>([]);
  readonly arrivalsLoading = signal(false);
  readonly trafficTab = signal<'arrivals' | 'nearby'>('arrivals');
  readonly mapFullscreen = signal(false);

  // Facilities
  readonly facilities = signal<PortFacility[]>([]);
  readonly facilityCompanies = signal<FacilityCompanyGroup[]>([]);
  readonly facilitiesLoading = signal(false);
  readonly facilitiesTab = signal<'info' | 'companies'>('info');

  // Orders
  readonly placeOrders = signal<PlaceOrder[]>([]);
  readonly ordersLoading = signal(false);

  // Suppliers
  readonly portSuppliers = signal<PortSupplierDto[]>([]);
  readonly suppliersLoading = signal(false);
  readonly showAddSupplier = signal(false);
  readonly supplierForm = signal<{ companyId: string; contactId: string | null; products: string[]; note: string }>({
    companyId: '',
    contactId: null,
    products: [],
    note: '',
  });
  readonly editingSupplierId = signal<string | null>(null);
  readonly savingSupplier = signal(false);
  readonly supplierCompanySearch = signal('');
  readonly supplierCompanyResults = signal<CompanySearchResultOption[]>([]);
  readonly selectedSupplierCompany = signal<{ id: string; name: string } | null>(null);
  readonly supplierContacts = signal<CompanyContactDto[]>([]);
  readonly supplierContactsLoading = signal(false);
  readonly productOptions = PRODUCT_OPTIONS;

  // Place edit
  readonly editingPlace = signal(false);
  readonly savingPlace = signal(false);
  readonly placeForm = signal<PlaceEditForm>({
    name: '',
    country: '',
    countryIso: '',
    area: '',
    subRegion: '',
    placeType: '',
    timezone: '',
    unlocode: '',
    admiraltyChart: '',
    lat: null,
    long: null,
    parentPlaceId: '',
    parentPlaceName: '',
  });

  // Responsible user
  readonly teamUsers = signal<UserOption[]>([]);
  readonly responsibleUserId = signal<string | null>(null);
  readonly savingResponsible = signal(false);

  // Order remark
  readonly editingOrderRemark = signal(false);
  readonly orderRemarkDraft = signal('');
  readonly savingOrderRemark = signal(false);
  readonly orderRemarkError = signal('');
  readonly orderRemarkSaved = signal(false);

  // Local time
  readonly localTime = signal<string>('');

  // Navigation spinners
  readonly navigatingParentId = signal<boolean>(false);
  readonly navigatingChildId = signal<string | null>(null);
  readonly navigatingVesselId = signal<string | null>(null);
  readonly navigatingCompanyId = signal<string | null>(null);

  // Delete
  readonly showDeleteModal = signal(false);
  readonly deletingPlace = signal(false);
  readonly deleteError = signal('');

  // Helpers
  readonly isManualPlace = computed(() => !this.place()?.lliPlaceId);
  readonly placeTypeOptions = Object.entries(PLACE_TYPE_LABELS).map(([value, label]) => ({ value, label }));
  readonly countryFlag = computed(() => {
    const p = this.place();
    if (!p) return '';
    return flagFromUnlocode(p.unlocode) || flagFromIso3(p.countryIso);
  });

  // Map refs (managed by store; components render containers)
  private map: L.Map | null = null;
  private vesselLayer: L.LayerGroup | null = null;
  private mapContainer: HTMLElement | null = null;
  private wsSubs: Subscription[] = [];
  private vesselRefreshInterval: ReturnType<typeof setInterval> | null = null;
  private localTimeInterval: ReturnType<typeof setInterval> | null = null;
  private supplierSearchTimeout: ReturnType<typeof setTimeout> | null = null;
  private currentLliPlaceId: string | null = null;

  constructor() {
    effect(() => {
      const p = this.place();
      if (p?.name) {
        this.pageTitle.setTitle(`Fueld | Places > ${p.name}`);
      }
    });

    // Retry map init whenever container or place/enrichment becomes available
    effect(() => {
      const p = this.place();
      const enrichment = this.enrichment();
      const container = this.mapContainer;
      console.log('[PlaceDetailStore] map effect triggered:', { hasPlace: !!p, lat: p?.lat, long: p?.long, hasContainer: !!container, hasMap: !!this.map });
      if (!p?.lat || !p?.long || !container || this.map) return;
      // Poll until the container has a non-zero size, then init the map
      let attempts = 0;
      const maxAttempts = 120; // ~2s at 60fps
      const tryInit = () => {
        if (!this.mapContainer || this.map) return;
        const rect = this.mapContainer.getBoundingClientRect();
        attempts++;
        console.log(`[PlaceDetailStore] init attempt ${attempts}:`, rect.width, rect.height);
        if (rect.width === 0 || rect.height === 0) {
          if (attempts < maxAttempts) {
            requestAnimationFrame(tryInit);
          } else {
            console.warn('[PlaceDetailStore] gave up waiting for container size');
          }
          return;
        }
        this.initMap();
        // Leaflet needs a resize after the container becomes visible/sized
        requestAnimationFrame(() => this.map?.invalidateSize());
      };
      requestAnimationFrame(tryInit);
    });
  }

  async loadPlace(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<PlaceDto>>(`${API}/lloyds/places/local/${id}`),
      );
      if (res.success && res.data) {
        this.resetState();
        const data = res.data;
        this.place.set(data);
        this.wsService.sendPresence(this.router.url, this.pageTitle.getTitle());
        this.responsibleUserId.set(data.responsibleUserId ?? null);
        this.orderRemarkDraft.set(data.orderRemark ?? '');
        this.orderRemarkError.set('');
        this.orderRemarkSaved.set(false);
        this.loadOrders(data.id);
        this.loadSuppliers(data.id);
        this.loadUsers();
        this.startLocalTime(data.timezone);
        if (data.parentPlaceName) {
          this.parentPlaceName.set(data.parentPlaceName);
        }
        if (data.lliPlaceId) {
          this.loadEnrichment(data.lliPlaceId);
          this.loadFacilities(data.lliPlaceId);
          this.loadExpectedArrivals(data.lliPlaceId);
          this.requestViaWebSocket(data.lliPlaceId);
        }
      }
    } catch (err) {
      console.error('Failed to load place:', err);
    } finally {
      this.loading.set(false);
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
    this.arrivalsLoading.set(false);
    this.trafficTab.set('arrivals');
    this.localTime.set('');
    this.responsibleUserId.set(null);
    this.orderRemarkDraft.set('');
    this.savingOrderRemark.set(false);
    this.orderRemarkError.set('');
    this.orderRemarkSaved.set(false);
    this.showAddSupplier.set(false);
    this.editingSupplierId.set(null);
    this.editingPlace.set(false);
    this.savingPlace.set(false);
    this.mapFullscreen.set(false);
    this.selectedSupplierCompany.set(null);
    this.supplierCompanySearch.set('');
    this.supplierCompanyResults.set([]);
    this.supplierContacts.set([]);
    this.navigatingParentId.set(false);
    this.navigatingChildId.set(null);
    this.navigatingVesselId.set(null);
    this.navigatingCompanyId.set(null);
    this.showDeleteModal.set(false);
    this.deletingPlace.set(false);
    this.deleteError.set('');
  }

  destroy(): void {
    this.cleanupResources();
  }

  private cleanupResources(): void {
    this.map?.remove();
    this.map = null;
    this.mapContainer = null;
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
    if (this.supplierSearchTimeout) {
      clearTimeout(this.supplierSearchTimeout);
      this.supplierSearchTimeout = null;
    }
  }

  // ─── Enrichment ────────────────────────────────────────────────────

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

  // ─── WebSocket ─────────────────────────────────────────────────────

  private requestViaWebSocket(lliPlaceId: string): void {
    this.vesselsLoading.set(true);
    this.syncing.set(true);

    this.wsSubs.push(
      this.wsService.on<NearbyVessel[]>('nearby-vessels').subscribe((vessels) => {
        this.nearbyVessels.set(vessels);
        this.vesselsLoading.set(false);
        this.addVesselMarkers(vessels);
        if (!this.vesselRefreshInterval && this.currentLliPlaceId) {
          this.vesselRefreshInterval = setInterval(() => {
            if (this.currentLliPlaceId) {
              this.wsService.send({ type: 'vessel-positions', placeId: this.currentLliPlaceId });
            }
          }, 30_000);
        }
      }),
    );

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

    this.wsSubs.push(
      this.wsService.on<PlaceDto>('place-synced').subscribe((updated) => {
        this.place.set(updated);
        this.syncing.set(false);
      }),
    );

    this.wsSubs.push(
      this.wsService.onRaw('sync-error').subscribe((msg) => {
        console.warn('[WS] Sync error:', (msg as any).message);
        this.syncing.set(false);
      }),
    );

    this.wsSubs.push(
      this.wsService.onRaw('error').subscribe((msg) => {
        const payload = msg as any;
        console.error('[WS] Error:', payload.message ?? payload.error ?? 'Unknown error', payload);
        this.vesselsLoading.set(false);
        this.syncing.set(false);
      }),
    );

    this.currentLliPlaceId = lliPlaceId;
    this.wsService.send({ type: 'nearby-vessels', placeId: lliPlaceId });
    this.wsService.send({ type: 'sync-place', placeId: this.place()!.id });
  }

  // ─── Map ─────────────────────────────────────────────────────────

  setMapContainer(el: HTMLElement | null): void {
    console.log('[PlaceDetailStore] setMapContainer:', el);
    this.mapContainer = el;
    if (!el) {
      this.map?.remove();
      this.map = null;
      this.vesselLayer = null;
    }
  }

  private initMap(): void {
    const p = this.place();
    const el = this.mapContainer;
    console.log('[PlaceDetailStore] initMap called:', { hasPlace: !!p, lat: p?.lat, long: p?.long, hasEl: !!el, hasMap: !!this.map });
    if (!p?.lat || !p?.long || !el) return;
    if (this.map) return;

    // Ensure the container has a non-zero size before Leaflet measures it
    const rect = el.getBoundingClientRect();
    console.log('[PlaceDetailStore] initMap container rect:', rect.width, rect.height);
    if (rect.width === 0 || rect.height === 0) return;

    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });

    console.log('[PlaceDetailStore] creating Leaflet map at', p.lat, p.long);
    this.map = L.map(el, {
      center: [p.lat, p.long],
      zoom: 13,
      scrollWheelZoom: true,
    });
    console.log('[PlaceDetailStore] Leaflet map created:', !!this.map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 20,
      subdomains: 'abcd',
    }).addTo(this.map);

    this.vesselLayer = L.layerGroup().addTo(this.map);

    this.map.on('popupopen', (e: any) => {
      const container = e.popup.getElement();
      if (!container) return;
      const links = container.querySelectorAll('.vessel-nav-link');
      links.forEach((link: HTMLElement) => {
        link.addEventListener('click', (ev: Event) => {
          ev.preventDefault();
          const vesselId = (ev.currentTarget as HTMLElement).getAttribute('data-vessel-id');
          if (vesselId) void this.navigateToVessel(vesselId);
        });
      });
    });

    this.map.on('zoomend', () => {
      if (this.nearbyVessels().length) {
        this.addVesselMarkers(this.nearbyVessels());
      }
    });

    const enrichment = this.enrichment();
    if (enrichment?.geoJsonObject) {
      const geoLayer = L.geoJSON(enrichment.geoJsonObject as any, {
        style: { color: '#3b82f6', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.15 },
      }).addTo(this.map);
      this.map.fitBounds(geoLayer.getBounds(), { padding: [30, 30] });
    } else {
      L.marker([p.lat, p.long]).addTo(this.map);
    }

    if (enrichment?.children?.length) {
      const childColors: Record<string, string> = { PSP: '#6366f1', TER: '#10b981', ANC: '#f59e0b' };
      for (const child of enrichment.children) {
        if (child.geoJsonObject) {
          const color = childColors[child.typeCode] ?? '#8b5cf6';
          L.geoJSON(child.geoJsonObject as any, {
            style: { color, weight: 1.5, fillColor: color, fillOpacity: 0.1, dashArray: '4 4' },
          })
            .bindPopup(`<div class="text-xs leading-relaxed"><strong>${child.name}</strong><br>${child.type}</div>`, { closeButton: false })
            .addTo(this.map);
        } else if (child.lat && child.lng) {
          const color = childColors[child.typeCode] ?? '#8b5cf6';
          L.circleMarker([child.lat, child.lng], { radius: 5, color, fillColor: color, fillOpacity: 0.6, weight: 1.5 })
            .bindPopup(`<div class="text-xs leading-relaxed"><strong>${child.name}</strong><br>${child.type}</div>`, { closeButton: false })
            .addTo(this.map);
        }
      }
    }

    if (this.nearbyVessels().length) {
      this.addVesselMarkers(this.nearbyVessels());
    }
  }

  private addVesselMarkers(vessels: NearbyVessel[]): void {
    if (!this.map || !this.vesselLayer) return;
    this.vesselLayer.clearLayers();
    for (const v of vessels) {
      if (!v.lat || !v.lng) continue;
      const zoom = this.map.getZoom();
      const marker = L.marker([v.lat, v.lng], {
        icon: vesselIcon(v.heading, v.lengthOverall, zoom, v.lat),
      });
      const popupLines = [
        `<a href="javascript:void(0)" class="vessel-nav-link text-blue-600 hover:underline font-semibold" data-vessel-id="${v.id}">${v.name}</a>`,
        v.imo ? `IMO: ${v.imo}` : null,
        v.vesselType ? `Type: ${v.vesselType}` : null,
        v.flag ? `Flag: ${v.flag}` : null,
        v.lengthOverall || v.breadth ? `Size: ${v.lengthOverall ?? '?'}m × ${v.breadth ?? '?'}m` : null,
        v.dwt ? `DWT: ${v.dwt.toLocaleString()}` : null,
        v.draught != null ? `Draft: ${v.draught.toFixed(1)}m` : null,
        v.speed != null ? `Speed: ${v.speed.toFixed(1)} kn` : null,
        v.heading != null ? `Heading: ${v.heading}°` : null,
        v.distance != null ? `Distance: ${v.distance.toFixed(1)} nm` : null,
      ].filter(Boolean);
      marker.bindPopup(`<div class="text-xs leading-relaxed">${popupLines.join('<br>')}</div>`, { closeButton: false, className: 'vessel-popup' });
      marker.addTo(this.vesselLayer);
    }
  }

  toggleMapFullscreen(): void {
    this.mapFullscreen.update((v) => !v);
    setTimeout(() => this.map?.invalidateSize(), 50);
  }

  // ─── Orders ────────────────────────────────────────────────────────

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

  orderDetailRoute(status?: string):
    | '/trading/orders'
    | '/trading/inquiries'
    | '/trading/completed-orders'
    | '/trading/cancelled-orders' {
    if (status === 'INQUIRY' || status === 'OFFER') return '/trading/inquiries';
    if (status === 'PAID') return '/trading/completed-orders';
    if (status === 'CANCELLED') return '/trading/cancelled-orders';
    return '/trading/orders';
  }

  orderStatusClass(status: string): string {
    switch (status) {
      case 'INQUIRY':
        return 'bg-blue-50 text-blue-700';
      case 'OFFER':
        return 'bg-violet-50 text-violet-700';
      case 'CONFIRMED':
        return 'bg-emerald-50 text-emerald-700';
      case 'DELIVERED':
        return 'bg-teal-50 text-teal-700';
      case 'INVOICED':
        return 'bg-amber-50 text-amber-700';
      case 'PAID':
        return 'bg-green-50 text-green-700';
      case 'CANCELLED':
        return 'bg-red-50 text-red-700';
      default:
        return 'bg-gray-50 text-gray-700';
    }
  }

  // ─── Facilities ──────────────────────────────────────────────────

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
    return FACILITY_ICONS[type] ?? '📋';
  }

  // ─── Suppliers ─────────────────────────────────────────────────────

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
          this.http.get<ApiResponse<{ companies: { id: string; name: string; country: string | null }[] }>>(
            `${API}/companies/local?search=${encodeURIComponent(term)}&limit=15`,
          ),
        );
        const existingIds = new Set(this.portSuppliers().map((s) => s.companyId));
        const localResults = res.success && res.data ? res.data.companies.filter((c) => !existingIds.has(c.id)) : [];

        if (localResults.length) {
          this.supplierCompanyResults.set(
            localResults.map((c) => ({ key: c.id, source: 'local' as const, id: c.id, name: c.name, country: c.country })),
          );
          return;
        }

        const importRes = await firstValueFrom(
          this.http.get<ApiResponse<CompanySearchResult[]>>(`${API}/companies/search?term=${encodeURIComponent(term)}`),
        );
        if (importRes.success && importRes.data) {
          this.supplierCompanyResults.set(
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
          this.supplierCompanyResults.set([]);
        }
      } catch {
        this.supplierCompanyResults.set([]);
      }
    }, 250);
  }

  async selectSupplierCompany(c: CompanySearchResultOption): Promise<void> {
    if (c.source === 'seasearcher' && c.seasearcherId) {
      await this.importSupplierCompanyFromSeasearcher(c.seasearcherId);
      return;
    }
    if (!c.id) return;
    this.selectedSupplierCompany.set({ id: c.id, name: c.name });
    this.supplierForm.set({ ...this.supplierForm(), companyId: c.id });
    this.supplierCompanySearch.set('');
    this.supplierCompanyResults.set([]);
    this.loadSupplierContacts(c.id);
  }

  private async importSupplierCompanyFromSeasearcher(seasearcherId: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<CounterpartyDto>>(`${API}/companies/import`, { seasearcherId }),
      );
      if (res.success && res.data) {
        this.selectedSupplierCompany.set({ id: res.data.id, name: res.data.name });
        this.supplierForm.set({ ...this.supplierForm(), companyId: res.data.id });
        this.supplierCompanySearch.set('');
        this.supplierCompanyResults.set([]);
        this.loadSupplierContacts(res.data.id);
      } else {
        console.error('Failed to import company:', res.message ?? 'Unknown error');
      }
    } catch {
      console.error('Failed to import company.');
    }
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
    const next = current.includes(prod) ? current.filter((p) => p !== prod) : [...current, prod];
    this.supplierForm.set({ ...this.supplierForm(), products: next });
  }

  updateSupplierForm<K extends keyof PlaceSupplierForm>(key: K, value: PlaceSupplierForm[K]): void {
    this.supplierForm.set({ ...this.supplierForm(), [key]: value });
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
      await firstValueFrom(this.http.delete(`${API}/lloyds/places/suppliers/${supplierId}`));
      this.loadSuppliers(p.id);
    } catch (err) {
      console.error('Failed to delete supplier:', err);
    }
  }

  // ─── Expected Arrivals ─────────────────────────────────────────────

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

  // ─── Place Edit ────────────────────────────────────────────────────

  startEditPlace(): void {
    const current = this.place();
    if (!current) return;
    this.placeForm.set({
      name: current.name ?? '',
      country: current.country ?? '',
      countryIso: current.countryIso ?? '',
      area: current.area ?? '',
      subRegion: current.subRegion ?? '',
      placeType: current.placeType ?? '',
      timezone: current.timezone ?? '',
      unlocode: current.unlocode ?? '',
      admiraltyChart: current.admiraltyChart ?? '',
      lat: current.lat ?? null,
      long: current.long ?? null,
      parentPlaceId: current.parentPlaceId ?? '',
      parentPlaceName: current.parentPlaceName ?? '',
    });
    this.editingPlace.set(true);
  }

  cancelEditPlace(): void {
    this.editingPlace.set(false);
  }

  updatePlaceForm<K extends keyof PlaceEditForm>(key: K, value: PlaceEditForm[K]): void {
    this.placeForm.set({ ...this.placeForm(), [key]: value });
  }

  onLatChange(value: number | string): void {
    const numeric = typeof value === 'string' ? Number(value) : value;
    this.updatePlaceForm('lat', Number.isFinite(numeric) ? numeric : null);
  }

  onLongChange(value: number | string): void {
    const numeric = typeof value === 'string' ? Number(value) : value;
    this.updatePlaceForm('long', Number.isFinite(numeric) ? numeric : null);
  }

  async savePlaceEdits(): Promise<void> {
    const current = this.place();
    if (!current) return;
    const form = this.placeForm();
    this.savingPlace.set(true);
    try {
      const payload = {
        name: form.name.trim(),
        country: form.country.trim(),
        countryIso: form.countryIso.trim() || null,
        area: form.area.trim() || null,
        subRegion: form.subRegion.trim() || null,
        placeType: form.placeType || null,
        timezone: form.timezone.trim() || null,
        unlocode: form.unlocode.trim() || null,
        admiraltyChart: form.admiraltyChart.trim() || null,
        lat: form.lat,
        long: form.long,
        parentPlaceId: form.parentPlaceId.trim() || null,
        parentPlaceName: form.parentPlaceName.trim() || null,
      };
      const res = await firstValueFrom(
        this.http.put<ApiResponse<PlaceDto>>(`${API}/lloyds/places/local/${current.id}`, payload),
      );
      if (res.success && res.data) {
        this.place.set(res.data);
        this.startLocalTime(res.data.timezone);
        this.editingPlace.set(false);
      }
    } catch (err) {
      console.error('Failed to update place:', err);
    } finally {
      this.savingPlace.set(false);
    }
  }

  // ─── Order Remark ──────────────────────────────────────────────────

  startEditOrderRemark(): void {
    this.editingOrderRemark.set(true);
    this.orderRemarkSaved.set(false);
    this.orderRemarkError.set('');
  }

  cancelOrderRemarkEdit(): void {
    this.editingOrderRemark.set(false);
    this.orderRemarkError.set('');
    this.orderRemarkSaved.set(false);
  }

  async saveOrderRemark(): Promise<void> {
    const current = this.place();
    if (!current || this.savingOrderRemark()) return;
    this.savingOrderRemark.set(true);
    this.orderRemarkError.set('');
    this.orderRemarkSaved.set(false);
    try {
      const payload = { orderRemark: this.orderRemarkDraft().trim() || null };
      const res = await firstValueFrom(
        this.http.put<ApiResponse<PlaceDto>>(`${API}/lloyds/places/local/${current.id}/order-remark`, payload),
      );
      if (!res.success || !res.data) {
        this.orderRemarkError.set(res.message || 'Failed to save remark');
        return;
      }
      this.place.set(res.data);
      this.orderRemarkDraft.set(res.data.orderRemark ?? '');
      this.editingOrderRemark.set(false);
      this.orderRemarkSaved.set(true);
      setTimeout(() => this.orderRemarkSaved.set(false), 1500);
    } catch (err: any) {
      const msg = err?.error?.message || err?.error?.error || 'Failed to save remark';
      this.orderRemarkError.set(msg);
    } finally {
      this.savingOrderRemark.set(false);
    }
  }

  // ─── Responsible User ──────────────────────────────────────────────

  private async loadUsers(): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<UserOption[]>>(`${API}/lloyds/users`));
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
        this.http.patch(`${API}/lloyds/places/local/${p.id}/responsible-user`, { userId: userId || null }),
      );
      this.responsibleUserId.set(userId || null);
    } catch (err) {
      console.error('Failed to update responsible user:', err);
    } finally {
      this.savingResponsible.set(false);
    }
  }

  // ─── Delete ────────────────────────────────────────────────────────

  confirmDeletePlace(): void {
    if (!this.canDeleteEntity()) return;
    this.deleteError.set('');
    this.showDeleteModal.set(true);
  }

  async executeDeletePlace(): Promise<void> {
    if (!this.canDeleteEntity()) return;
    const p = this.place();
    if (!p) return;
    this.deletingPlace.set(true);
    try {
      await firstValueFrom(this.http.delete<ApiResponse<{ id: string }>>(`${API}/lloyds/places/local/${p.id}`));
      this.showDeleteModal.set(false);
      await this.router.navigate(['/places']);
    } catch (err: any) {
      this.deleteError.set(err?.error?.message || 'Failed to delete place.');
    } finally {
      this.deletingPlace.set(false);
    }
  }

  // ─── Navigation ────────────────────────────────────────────────────

  async navigateToParent(): Promise<void> {
    const parentSeasearcherId = this.enrichment()?.parentPlaceId;
    if (!parentSeasearcherId) return;
    this.navigatingParentId.set(true);
    try {
      const existing = await firstValueFrom(
        this.http.get<ApiResponse<PlaceDto>>(`${API}/lloyds/places/by-lli/${parentSeasearcherId}`),
      ).catch(() => null);
      if (existing?.success && existing.data) {
        await this.router.navigate(['/places', existing.data.id]);
        return;
      }
      const imported = await firstValueFrom(
        this.http.post<ApiResponse<PlaceDto>>(`${API}/lloyds/places/import`, { lliPlaceId: parentSeasearcherId }),
      );
      if (imported?.success && imported.data) {
        await this.router.navigate(['/places', imported.data.id]);
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
      const existing = await firstValueFrom(
        this.http.get<ApiResponse<PlaceDto>>(`${API}/lloyds/places/by-lli/${seasearcherId}`),
      ).catch(() => null);
      if (existing?.success && existing.data) {
        await this.router.navigate(['/places', existing.data.id]);
        return;
      }
      const imported = await firstValueFrom(
        this.http.post<ApiResponse<PlaceDto>>(`${API}/lloyds/places/import`, { lliPlaceId: seasearcherId }),
      );
      if (imported?.success && imported.data) {
        await this.router.navigate(['/places', imported.data.id]);
      }
    } catch (err) {
      console.error('Failed to navigate to child place:', err);
    } finally {
      this.navigatingChildId.set(null);
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
    } catch (err) {
      console.error('Failed to navigate to vessel:', err);
    } finally {
      this.navigatingVesselId.set(null);
    }
  }

  async navigateToCompany(companyName: string): Promise<void> {
    this.navigatingCompanyId.set(companyName);
    try {
      const imported = await firstValueFrom(
        this.http.post<ApiResponse<CounterpartyDto>>(`${API}/companies/import-by-name`, { companyName }),
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

  goBack(): void {
    void this.router.navigate(['/places']);
  }

  // ─── Hierarchy helpers ─────────────────────────────────────────────

  toggleNode(nodeId: string): void {
    const current = new Set(this.expandedNodes());
    if (current.has(nodeId)) {
      current.delete(nodeId);
    } else {
      current.add(nodeId);
    }
    this.expandedNodes.set(current);
  }

  categoryIcon(category: string): string {
    return CATEGORY_ICONS[category] ?? '📍';
  }

  childTypeIcon(typeCode: string): string {
    return CHILD_TYPE_ICONS[typeCode] ?? '📍';
  }

  placeTypeLabel(type: string): string {
    return PLACE_TYPE_LABELS[type] ?? type;
  }

  placeTypeBadgeClass(type: string): string {
    switch (type) {
      case 'POR':
        return 'bg-blue-100 text-blue-800';
      case 'PSP':
        return 'bg-indigo-100 text-indigo-800';
      case 'ANC':
        return 'bg-amber-100 text-amber-800';
      case 'TER':
        return 'bg-emerald-100 text-emerald-800';
      case 'FIL':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }

  vesselFlag(code: string): string {
    return flagFromIso3(code);
  }

  // ─── Local Time ────────────────────────────────────────────────────

  private startLocalTime(timezone: string | null): void {
    if (this.localTimeInterval) {
      clearInterval(this.localTimeInterval);
      this.localTimeInterval = null;
    }
    if (!timezone) {
      this.localTime.set('');
      return;
    }
    if (this.isValidIanaTimezone(timezone)) {
      const tick = () => {
        const now = new Date();
        const formatted = new Intl.DateTimeFormat('en-GB', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }).format(now);
        this.localTime.set(formatted);
      };
      tick();
      this.localTimeInterval = setInterval(tick, 1000);
      return;
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

  isValidIanaTimezone(tz: string): boolean {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }

  readonly commonTimezones = COMMON_TIMEZONES;

  private parseTimezoneOffset(tz: string | null): number | null {
    if (!tz) return null;
    const match = tz.match(/([+-])\s*(\d{1,2})(?::(\d{2}))?/);
    if (!match) {
      if (/^(GMT|UTC)$/i.test(tz.trim())) return 0;
      return null;
    }
    const sign = match[1] === '+' ? 1 : -1;
    const hours = parseInt(match[2], 10);
    const minutes = match[3] ? parseInt(match[3], 10) : 0;
    return sign * (hours * 60 + minutes);
  }
}
