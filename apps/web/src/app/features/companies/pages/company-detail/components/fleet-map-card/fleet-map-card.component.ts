import {
  Component, ChangeDetectionStrategy, input, output, signal, effect, viewChild, ElementRef, inject, OnDestroy,
} from '@angular/core';
import { ThemeService } from '@app/core/theme.service';
import { swapLeafletTileLayer } from '@app/shared/utils/leaflet-theme';

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
  hasSanctions: boolean;
  owners: Array<{ type: string; typeCode: string; companyId: string; companyName: string }>;
  destination?: { place?: { id: string; name: string }; country?: { code: string; name: string }; eta?: string } | null;
  latestInformation?: {
    position?: { lat: number; lng: number; timeStamp?: string };
    nearestPort?: string;
    trueHeading?: number;
    aisSpeed?: number;
  } | null;
}

interface GroupFleetVessel extends FleetVessel {
  companyName: string;
}

type L = any;

function vesselIcon(
  heading: number | null,
  loaMeters: number | null,
  zoom: number,
  lat: number,
  sanctioned: boolean,
): any {
  const deg = heading ?? 0;
  const metersPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  const loa = loaMeters ?? 200;
  const mpp = Math.max(metersPerPixel, 0.0001);
  const h = Math.round(Math.max(10, Math.min(loa / mpp, 120)));
  const w = Math.round(h * 0.35);
  const fill = sanctioned ? '#ef4444' : loa < 120 ? '#3b82f6' : loa < 250 ? '#f97316' : '#ef4444';
  const stroke = sanctioned ? '#991b1b' : loa < 120 ? '#1d4ed8' : loa < 250 ? '#c2410c' : '#991b1b';
  const svg = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <path d="M${w / 2},0 L${w},${h * 0.3} L${w},${h} L0,${h} L0,${h * 0.3} Z"
          fill="${fill}" stroke="${stroke}" stroke-width="0.8" stroke-linejoin="round"/>
    <line x1="${w / 2}" y1="${h * 0.15}" x2="${w / 2}" y2="${h * 0.65}"
          stroke="${stroke}" stroke-width="0.6" opacity="0.5"/>
  </svg>`;
  return (window as any).L?.divIcon({
    className: '',
    html: `<div style="transform:rotate(${deg}deg);width:${w}px;height:${h}px;filter:drop-shadow(0 1px 3px rgba(0,0,0,.35))">${svg}</div>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h / 2],
  });
}

@Component({
  selector: 'app-fleet-map-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (vessels().length || (mode() === 'group' && loading())) {
      <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm transition-all min-[900px]:order-[15]"
           [class.fleet-map-fullscreen]="fullscreen()">
        <div class="border-b border-gray-100 dark:border-line px-5 py-3 flex items-center justify-between"
             [class.hidden]="fullscreen()">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-semibold text-gray-700 dark:text-ink-dim">Fleet Map</h2>
            @if (mode() === 'group') {
              <span class="inline-flex items-center rounded-full bg-brand-50 dark:bg-brand-700/15 px-2 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-400">Group</span>
            }
            @if (totalMatches(); as totalMatches) {
              <span class="inline-flex items-center rounded-full bg-gray-100 dark:bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:text-ink-dim">{{ totalMatches }} vessels</span>
            }
            @if (limitNotice(); as notice) {
              <span class="inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                    [title]="'Showing first ' + notice.queried + ' of ' + notice.total + ' linked companies on the map'">
                {{ notice.queried }}/{{ notice.total }} companies
              </span>
            }
          </div>
          <button (click)="toggleFullscreen()"
            class="rounded-md p-1 text-gray-400 dark:text-muted hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-surface-tint-strong transition-colors" title="Fullscreen">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 01-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12zm-9 7a1 1 0 012 0v1.586l2.293-2.293a1 1 0 011.414 1.414L6.414 15H8a1 1 0 010 2H4a1 1 0 01-1-1v-4zm13 0a1 1 0 01.993.883L17 13v4a1 1 0 01-1 1h-4a1 1 0 010-2h1.586l-2.293-2.293a1 1 0 011.414-1.414L15 14.586V13a1 1 0 011-1z" />
            </svg>
          </button>
        </div>
        <div class="p-0 relative">
          @if (mode() === 'group' && loading()) {
            <div class="flex items-center justify-center" [style.height]="fullscreen() ? '100vh' : '400px'">
              <svg class="h-5 w-5 animate-spin text-gray-400 dark:text-muted" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            </div>
          } @else {
            <div #fleetMapEl class="fleet-map-container w-full rounded-b-xl" [style.height]="fullscreen() ? '100vh' : '400px'"></div>
          }
          @if (fullscreen()) {
            <button (click)="toggleFullscreen()"
              class="absolute top-3 right-3 z-[10000] rounded-lg bg-white dark:bg-surface px-3 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim shadow-md border border-gray-200 dark:border-line hover:bg-gray-50 dark:hover:bg-surface-tint transition-colors flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
              </svg>
              Exit Fullscreen
            </button>
          }
        </div>
      </div>
    }
  `,
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
  `],
})
export class FleetMapCardComponent implements OnDestroy {
  readonly vessels = input.required<(FleetVessel | GroupFleetVessel)[]>();
  readonly mode = input<'own' | 'group'>('own');
  readonly loading = input<boolean>(false);
  readonly totalMatches = input<number | null>(null);
  readonly limitNotice = input<{ queried: number; total: number; max: number } | null>(null);
  readonly navigateToVessel = output<string>();

  readonly fullscreen = signal(false);
  private readonly fleetMapEl = viewChild<ElementRef<HTMLDivElement>>('fleetMapEl');
  private fleetMap: L.Map | null = null;
  private fleetMapInitialized = false;
  private vesselLayer: L.LayerGroup | null = null;
  private readonly theme = inject(ThemeService);
  private tileLayer: any = null;

  constructor() {
    effect(() => {
      // Re-theme the base tiles when the app theme changes.
      this.theme.resolved();
      if (this.fleetMap) {
        const L = (window as any).L;
        this.tileLayer = swapLeafletTileLayer(L, this.fleetMap, this.tileLayer, this.theme.resolved());
      }
    });
    effect(() => {
      const el = this.fleetMapEl();
      const vessels = this.vessels();
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

  ngOnDestroy(): void {
    if (this.fleetMap) {
      this.fleetMap.remove();
      this.fleetMap = null;
    }
  }

  toggleFullscreen(): void {
    this.fullscreen.update((v) => !v);
    setTimeout(() => {
      if (this.fleetMap) {
        this.fleetMap.invalidateSize();
      }
    }, 50);
  }

  private async initFleetMap(): Promise<void> {
    const L = await this.loadLeaflet();
    const el = this.fleetMapEl()?.nativeElement;
    const vessels = this.vessels();
    if (!el || this.fleetMap || !vessels.length) return;

    this.fleetMap = L.map(el, { zoomControl: true, attributionControl: false }).setView([30, 0], 2);
    this.tileLayer = swapLeafletTileLayer(L, this.fleetMap, null, this.theme.resolved(), { maxZoom: 18, subdomains: 'abcd' });
    this.vesselLayer = L.layerGroup().addTo(this.fleetMap);

    this.fleetMap!.on('popupopen', (e: any) => {
      const container = e.popup.getElement();
      if (!container) return;
      const links = container.querySelectorAll('.vessel-nav-link');
      links.forEach((link: HTMLElement) => {
        link.addEventListener('click', (ev: Event) => {
          ev.preventDefault();
          const vesselId = (ev.currentTarget as HTMLElement).getAttribute('data-vessel-id');
          if (vesselId) this.navigateToVessel.emit(vesselId);
        });
      });
    });

    this.fleetMap!.on('zoomend', () => {
      this.addFleetVesselMarkers(this.vessels());
    });

    this.refreshFleetMap(vessels);
  }

  private refreshFleetMap(vessels: (FleetVessel | GroupFleetVessel)[]): void {
    if (!this.fleetMap || !this.vesselLayer) return;
    this.addFleetVesselMarkers(vessels);
    this.fitFleetMapToVessels(vessels);
    this.fleetMap.invalidateSize();
  }

  private fitFleetMapToVessels(vessels: (FleetVessel | GroupFleetVessel)[]): void {
    if (!this.fleetMap) return;
    const L = (window as any).L;
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

  private addFleetVesselMarkers(vessels: (FleetVessel | GroupFleetVessel)[]): void {
    if (!this.fleetMap || !this.vesselLayer) return;
    const L = (window as any).L;
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
        `<a href="javascript:void(0)" class="vessel-nav-link text-blue-600 dark:text-blue-400 hover:underline font-semibold" data-vessel-id="${v.id}">${v.name}</a>`,
        `IMO: ${v.imo}`,
        companyName ? `Company: ${companyName}` : null,
        v.type ? `Type: ${v.type}` : null,
        v.flag ? `Flag: ${v.flag.name}` : null,
        loa || breadth ? `Size: ${loa ?? '?'}m × ${breadth ?? '?'}m` : null,
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
      marker.bindPopup(`<div class="text-xs leading-relaxed">${popupLines.join('<br>')}</div>`, { closeButton: false, className: 'vessel-popup' });
      marker.addTo(this.vesselLayer);
    }
  }

  private async loadLeaflet(): Promise<any> {
    const w = window as any;
    if (w.L) return w.L;
    const mod: any = await import('leaflet');
    w.L = mod.default ?? mod;
    return w.L;
  }
}
