import { Component, ChangeDetectionStrategy, inject, AfterViewInit, OnDestroy, ElementRef, viewChild } from '@angular/core';
import { PlaceDetailStore } from '../../place-detail.store';

@Component({
  selector: 'app-place-map-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    @if (store.place()!.lat && store.place()!.long) {
      <div class="app-panel overflow-hidden flex flex-col"
           [class]="store.mapFullscreen() ? 'fixed inset-0 z-[70] rounded-none border-0 h-screen' : 'h-[420px]'">
        <div class="app-panel-header app-panel-header--sky justify-between px-5 py-3">
          <h2 class="text-sm font-semibold text-gray-700">
            Location
            @if (store.vesselsLoading()) {
              <span class="ml-2 inline-flex items-center gap-1 text-xs font-normal text-gray-400">
                <svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Loading vessels…
              </span>
            } @else if (store.nearbyVessels().length) {
              <span class="ml-2 text-xs font-normal text-gray-400">
                {{ store.nearbyVessels().length }} vessels nearby
              </span>
            }
          </h2>
          <div class="flex items-center gap-3">
            <span class="font-mono text-xs text-gray-400">{{ store.place()!.lat }}° N, {{ store.place()!.long }}° E</span>
            <button (click)="store.toggleMapFullscreen()"
              class="rounded-md p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              [title]="store.mapFullscreen() ? 'Exit fullscreen' : 'Fullscreen'">
              @if (store.mapFullscreen()) {
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
        <div class="flex-1 min-h-0" [class]="store.mapFullscreen() ? 'h-[calc(100dvh-49px)]' : ''" #mapContainer></div>
      </div>
    }
  `,
})
export class PlaceMapCardComponent implements AfterViewInit, OnDestroy {
  readonly store = inject(PlaceDetailStore);
  private readonly mapContainer = viewChild.required<ElementRef<HTMLDivElement>>('mapContainer');

  ngAfterViewInit(): void {
    this.store.setMapContainer(this.mapContainer().nativeElement);
  }

  ngOnDestroy(): void {
    this.store.setMapContainer(null);
  }
}
