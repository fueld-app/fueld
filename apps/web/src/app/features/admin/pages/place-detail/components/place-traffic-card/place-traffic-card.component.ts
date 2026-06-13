import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { PlaceDetailStore } from '../../place-detail.store';

@Component({
  selector: 'app-place-traffic-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe],
  template: `
    <div class="app-panel lg:h-[449px] lg:flex lg:flex-col overflow-hidden">
      <div class="app-panel-header app-panel-header--blue justify-between px-5 py-3">
        <h2 class="text-sm font-semibold text-gray-700">
          @if (store.trafficTab() === 'arrivals') {
            Expected Arrivals
            @if (store.expectedArrivals().length) {
              <span class="ml-1 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                {{ store.expectedArrivals().length }}
              </span>
            }
          } @else {
            Nearby Vessels
            <span class="ml-1 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
              {{ store.nearbyVessels().length }}
            </span>
          }
        </h2>
        <div class="flex items-center gap-2">
          @if (store.trafficTab() === 'arrivals' && store.arrivalsLoading()) {
            <span class="inline-flex items-center gap-1 text-xs text-gray-400">
              <svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              Loading…
            </span>
          }
          <div class="flex gap-1">
            <button (click)="store.trafficTab.set('arrivals')"
              class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
              [class]="store.trafficTab() === 'arrivals' ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-gray-600'">
              Arrivals
            </button>
            <button (click)="store.trafficTab.set('nearby')"
              class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
              [class]="store.trafficTab() === 'nearby' ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-gray-600'">
              Nearby
            </button>
          </div>
        </div>
      </div>

      @if (store.trafficTab() === 'arrivals') {
        @if (!store.arrivalsLoading() && !store.expectedArrivals().length) {
          <div class="px-5 py-6 text-center text-sm text-gray-400">No expected arrivals in the next 7 days</div>
        } @else if (store.expectedArrivals().length) {
          <div class="divide-y divide-gray-50 max-h-[400px] overflow-y-auto">
            @for (a of store.expectedArrivals(); track a.id) {
              <div class="px-5 py-3 text-sm hover:bg-gray-50/50 transition-colors">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-1.5 min-w-0">
                    @if (a.flagCode) {
                      <span class="text-sm">{{ store.vesselFlag(a.flagCode) }}</span>
                    }
                    <button
                      (click)="store.navigateToVessel(a.id)"
                      [disabled]="store.navigatingVesselId() === a.id"
                      class="font-medium text-brand-600 hover:text-brand-800 hover:underline truncate text-left disabled:opacity-50"
                    >
                      @if (store.navigatingVesselId() === a.id) {
                        <svg class="inline h-3.5 w-3.5 animate-spin mr-1" viewBox="0 0 24 24" fill="none">
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                      }
                      {{ a.name }}
                    </button>
                  </div>
                  @if (a.eta) {
                    <span class="text-[10px] text-gray-500 whitespace-nowrap ml-2">
                      ETA {{ a.eta | date:'MMM d, HH:mm' }}
                    </span>
                  }
                </div>
                <div class="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                  @if (a.imo) { <span>IMO {{ a.imo }}</span> }
                  @if (a.vesselType) { <span>· {{ a.vesselType }}</span> }
                  @if (a.dwt) { <span>· {{ a.dwt | number:'1.0-0' }} DWT</span> }
                </div>
                @if (a.commercialOperator || a.lastPort) {
                  <div class="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                    @if (a.commercialOperator) { <span>Op: {{ a.commercialOperator }}</span> }
                    @if (a.lastPort) { <span>· From: {{ a.lastPort }}</span> }
                  </div>
                }
              </div>
            }
          </div>
        }
      } @else {
        @if (!store.nearbyVessels().length) {
          <div class="px-5 py-6 text-center text-sm text-gray-400">No nearby vessels</div>
        } @else {
          <div class="divide-y divide-gray-50 max-h-[400px] overflow-y-auto">
            @for (v of store.nearbyVessels(); track v.id) {
              <div class="px-5 py-3 text-sm hover:bg-gray-50/50 transition-colors">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-1.5 min-w-0">
                    @if (v.flagCode) {
                      <span class="text-sm">{{ store.vesselFlag(v.flagCode) }}</span>
                    }
                    <button
                      (click)="store.navigateToVessel(v.id)"
                      [disabled]="store.navigatingVesselId() === v.id"
                      class="font-medium text-brand-600 hover:text-brand-800 hover:underline truncate text-left disabled:opacity-50"
                    >
                      @if (store.navigatingVesselId() === v.id) {
                        <svg class="inline h-3.5 w-3.5 animate-spin mr-1" viewBox="0 0 24 24" fill="none">
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                      }
                      {{ v.name }}
                    </button>
                    @if (v.status) {
                      <span class="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                            [class]="v.status === 'stopped' || v.status === 'moored' ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'">
                        {{ v.status }}
                      </span>
                    }
                  </div>
                  <span class="text-[10px] text-gray-500 whitespace-nowrap ml-2">
                    @if (v.distance != null) { {{ v.distance | number:'1.1-1' }} nm }
                    @if (v.speed != null) { · {{ v.speed | number:'1.1-1' }} kn }
                    @if (v.heading != null) { · {{ v.heading }}° }
                  </span>
                </div>
                <div class="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                  @if (v.imo) { <span>IMO {{ v.imo }}</span> }
                  @if (v.vesselType) { <span>· {{ v.vesselType }}</span> }
                  @if (v.dwt) { <span>· {{ v.dwt | number:'1.0-0' }} DWT</span> }
                </div>
                @if (v.lengthOverall || v.breadth || v.draught) {
                  <div class="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                    @if (v.lengthOverall || v.breadth) {
                      <span>{{ v.lengthOverall ?? '?' }}m × {{ v.breadth ?? '?' }}m</span>
                    }
                    @if (v.draught) {
                      <span>· {{ v.draught | number:'1.1-1' }}m draft</span>
                    }
                  </div>
                }
              </div>
            }
          </div>
        }
      }
    </div>
  `,
})
export class PlaceTrafficCardComponent {
  readonly store = inject(PlaceDetailStore);
}
