import { Component, ChangeDetectionStrategy, input, signal, effect, viewChild, ElementRef, afterNextRender } from '@angular/core';
import type { VesselDto } from '@fueld/types';
import * as L from 'leaflet/dist/leaflet-src.esm.js';

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
  selector: 'app-vessel-position-map-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host ::ng-deep .leaflet-container { font-family: inherit; }
  `],
  template: `
    <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col"
         [class]="mapFullscreen() ? 'fixed inset-0 z-[70] rounded-none border-0 h-screen' : 'min-[900px]:h-[449px]'">
      <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-gray-700">Current Position</h2>
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
      <div [class]="mapFullscreen() ? 'h-[calc(100dvh-49px)]' : 'flex-1'" #positionMapEl></div>
    </div>
  `,
})
export class VesselPositionMapCardComponent {
  readonly vessel = input.required<VesselDto>();
  readonly enrichment = input<any>(null);

  readonly mapFullscreen = signal(false);
  readonly positionMapEl = viewChild<ElementRef<HTMLDivElement>>('positionMapEl');
  private positionMap: L.Map | null = null;
  private positionMapInitialized = false;

  constructor() {
    effect(() => {
      const mapEl = this.positionMapEl();
      const enr = this.enrichment();
      if (mapEl && enr?.latestInformation?.position && !this.positionMapInitialized) {
        this.positionMapInitialized = true;
        setTimeout(() => this.initPositionMap(), 0);
      }
    });
  }

  toggleMapFullscreen(): void {
    this.mapFullscreen.update((v) => !v);
    setTimeout(() => this.positionMap?.invalidateSize(), 50);
  }

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

    this.positionMap.on('zoomend', () => {
      const z = this.positionMap!.getZoom();
      marker.setIcon(vesselIcon(heading, loaVal, z, lat, isSanctioned));
    });
  }

  destroy(): void {
    if (this.positionMap) {
      this.positionMap.remove();
      this.positionMap = null;
    }
  }
}