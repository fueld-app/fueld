import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { PlaceDetailStore } from '../../place-detail.store';

@Component({
  selector: 'app-place-facilities-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    <div class="app-panel h-[420px] flex flex-col">
      <div class="app-panel-header app-panel-header--blue px-5 py-3">
        <h2 class="text-sm font-semibold text-gray-700">Port Facilities</h2>
      </div>

      <div class="flex-1 overflow-y-auto">
        @if (store.facilitiesLoading()) {
          <div class="flex items-center justify-center py-8">
            <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          </div>
        } @else if (!store.facilities().length) {
          <div class="px-5 py-6 text-center text-sm text-gray-400">No facilities registered</div>
        } @else {
          <div class="divide-y divide-gray-50">
            @for (facility of store.facilities(); track facility.id) {
              <div class="px-5 py-3">
                <div class="flex items-center justify-between">
                  <span class="text-sm font-medium text-gray-800">{{ facility.label ?? facility.name }}</span>
                  @if (facility.category) {
                    <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                      {{ facility.category }}
                    </span>
                  }
                </div>
                @if (facility.text || facility.description) {
                  <p class="mt-1 text-xs text-gray-500">{{ facility.text || facility.description }}</p>
                }
                @if (facility.maxSize || facility.maxDwt || facility.capacity) {
                  <div class="mt-1.5 flex flex-wrap gap-2 text-[10px] text-gray-400">
                    @if (facility.maxSize) { <span>Max size: {{ facility.maxSize }}</span> }
                    @if (facility.maxDwt) { <span>Max DWT: {{ facility.maxDwt }}</span> }
                    @if (facility.capacity) { <span>Capacity: {{ facility.capacity }}</span> }
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class PlaceFacilitiesCardComponent {
  readonly store = inject(PlaceDetailStore);
}
