import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { flagFromIso3 } from '@app/shared/utils/flags';
import { DateLabelPipe } from '@app/shared/pipes/date-format.pipe';

@Component({
  selector: 'app-vessel-port-call-history-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DateLabelPipe, DatePipe],
  template: `
    <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:h-[449px] min-[900px]:flex min-[900px]:flex-col overflow-hidden">
      <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-gray-700">Port Call History</h2>
        @if (movements().length) {
          <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">{{ movements().length }}</span>
        }
      </div>
      @if (movementsLoading()) {
        <div class="flex items-center justify-center py-8">
          <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else if (movements().length) {
        <div class="overflow-auto min-[900px]:flex-1">
          <table class="w-full text-sm">
            <thead class="sticky top-0 z-10">
              <tr class="border-b border-gray-100 bg-gray-50">
                <th class="px-5 py-2 text-left font-medium text-gray-500">Port</th>
                <th class="px-5 py-2 text-left font-medium text-gray-500">Country</th>
                <th class="px-5 py-2 text-left font-medium text-gray-500">Arrived</th>
                <th class="px-5 py-2 text-left font-medium text-gray-500">Departed</th>
                <th class="px-5 py-2 text-left font-medium text-gray-500">Duration</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              @for (m of movements(); track $index) {
                <tr class="hover:bg-gray-50/50 transition-colors">
                  <td class="px-5 py-2.5 font-medium">
                    @if (m.placeId || m.place?.id) {
                      <button (click)="navigateToPlace.emit(m.placeId ?? m.place.id)" class="text-blue-700 hover:text-blue-900 hover:underline transition-colors cursor-pointer text-left">
                        @if (navigatingPlaceId() === (m.placeId ?? m.place?.id)) {
                          <span class="inline-flex items-center gap-1"><svg class="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> {{ m.port ?? m.place?.name ?? '—' }}</span>
                        } @else {
                          {{ m.port ?? m.place?.name ?? '—' }}
                        }
                      </button>
                    } @else {
                      <span class="text-gray-900">{{ m.port ?? m.place?.name ?? '—' }}</span>
                    }
                  </td>
                  <td class="px-5 py-2.5 text-gray-600">{{ movementFlag(m) }} {{ m.countryName ?? m.place?.country?.name ?? '—' }}</td>
                  <td class="px-5 py-2.5 text-gray-600">{{ m.from ? (m.from | dateLabel) : '—' }}</td>
                  <td class="px-5 py-2.5 text-gray-600">{{ m.to ? (m.to | dateLabel) : '—' }}</td>
                  <td class="px-5 py-2.5 text-gray-600">
                    @if (m.durationHumanized) {
                      {{ m.durationHumanized }}
                    } @else if (m.from && !m.to) {
                      <span class="text-green-600 text-xs font-medium">In port</span>
                    } @else { — }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="px-5 py-6 text-center text-sm text-gray-400">No port call history found</div>
      }
    </div>
  `,
})
export class VesselPortCallHistoryCardComponent {
  readonly movements = input<any[]>([]);
  readonly movementsLoading = input(false);
  readonly navigatingPlaceId = input<string | null>(null);
  readonly navigateToPlace = output<string>();

  movementFlag(m: any): string {
    const code = m.flag ?? m.place?.country?.code ?? null;
    return flagFromIso3(code);
  }
}