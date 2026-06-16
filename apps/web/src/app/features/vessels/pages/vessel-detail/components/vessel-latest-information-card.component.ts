import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { flagFromIso3 } from '@app/shared/utils/flags';

@Component({
  selector: 'app-vessel-latest-information-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:h-[449px] min-[900px]:flex min-[900px]:flex-col overflow-hidden">
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
      <div class="flex-1 min-h-0 overflow-y-auto p-5 text-sm">
        <div class="grid grid-cols-2 gap-x-6 gap-y-3">
          @if (enrichment()!.latestInformation!['region']) {
            <div>
              <span class="text-gray-400 text-xs">Region</span>
              <div class="font-medium text-gray-900 mt-0.5">{{ enrichment()!.latestInformation!['region'] }}</div>
            </div>
          }
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
          @if (enrichment()!.latestInformation!['nearestPort']) {
            <div>
              <span class="text-gray-400 text-xs">Nearest Place</span>
              <div class="mt-0.5">
                @if (enrichment()!.latestInformation!['nearestPortCountry']?.code) {
                  <span class="mr-1">{{ flagFromCountryCode(enrichment()!.latestInformation!['nearestPortCountry'].code) }}</span>
                }
                @if (enrichment()!.latestInformation!['nearestPortId']) {
                  <button (click)="navigateToPlace.emit('' + enrichment()!.latestInformation!['nearestPortId'])" class="font-medium text-blue-700 hover:text-blue-900 hover:underline transition-colors cursor-pointer">
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
          @if (enrichment()!.latestInformation!['status']) {
            <div>
              <span class="text-gray-400 text-xs">Status</span>
              <div class="font-medium text-gray-900 mt-0.5 capitalize">{{ enrichment()!.latestInformation!['status'] }}</div>
            </div>
          }
          @if (destinationInfo().name) {
            <div>
              <span class="text-gray-400 text-xs">Destination</span>
              <div class="mt-0.5">
                @if (destinationInfo().flag) {
                  <span class="mr-1">{{ destinationInfo().flag }}</span>
                }
                @if (destinationInfo().placeId) {
                  <button (click)="navigateToPlace.emit(destinationInfo().placeId!)" class="font-medium text-blue-700 hover:text-blue-900 hover:underline transition-colors cursor-pointer">
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
          @if (destinationInfo().eta) {
            <div>
              <span class="text-gray-400 text-xs">ETA</span>
              <div class="font-medium text-gray-900 mt-0.5">{{ formatDate(destinationInfo().eta!) }}</div>
              <div class="text-xs text-blue-600">{{ etaRelative(destinationInfo().eta!) }}</div>
            </div>
          }
          @if (enrichment()!.latestInformation!['voyageOrigin']?.name) {
            <div>
              <span class="text-gray-400 text-xs">Voyage Origin</span>
              <div class="mt-0.5">
                @if (enrichment()!.latestInformation!['voyageOriginCountry']?.code) {
                  <span class="mr-1">{{ flagFromCountryCode(enrichment()!.latestInformation!['voyageOriginCountry'].code) }}</span>
                }
                @if (enrichment()!.latestInformation!['voyageOrigin'].id) {
                  <button (click)="navigateToPlace.emit(enrichment()!.latestInformation!['voyageOrigin'].id)" class="font-medium text-blue-700 hover:text-blue-900 hover:underline transition-colors cursor-pointer">
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
          @if (enrichment()!.latestInformation!.draught != null) {
            <div>
              <span class="text-gray-400 text-xs">Draught</span>
              <div class="font-medium text-gray-900 mt-0.5">{{ enrichment()!.latestInformation!.draught }} m</div>
            </div>
          }
          @if (enrichment()!.latestInformation!.aisSpeed != null) {
            <div>
              <span class="text-gray-400 text-xs">Speed</span>
              <div class="font-medium text-gray-900 mt-0.5">{{ enrichment()!.latestInformation!.aisSpeed }} kn</div>
            </div>
          }
          @if (enrichment()!.latestInformation!.trueHeading != null) {
            <div>
              <span class="text-gray-400 text-xs">Heading</span>
              <div class="font-medium text-gray-900 mt-0.5">{{ enrichment()!.latestInformation!.trueHeading }}°</div>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class VesselLatestInformationCardComponent {
  readonly enrichment = input.required<any>();
  readonly positionTimestamp = input<string>('');
  readonly positionAge = input<string>('');
  readonly destinationInfo = input.required<{ name: string; country: string; flag: string; eta: string | null; placeId: string | null }>();
  readonly navigatingPlaceId = input<string | null>(null);
  readonly navigateToPlace = output<string>();

  flagFromCountryCode(code: string | null): string {
    if (!code) return '';
    // Simple flag emoji from iso3 — import from shared utils
    return code;
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
}