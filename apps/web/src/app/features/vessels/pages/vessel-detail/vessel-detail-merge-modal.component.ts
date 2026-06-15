import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';

@Component({
  selector: 'app-vessel-detail-merge-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
          <div class="flex items-center gap-3 mb-4">
            <div class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-gray-900">Seasearcher Match Found</h3>
          </div>
          <p class="text-sm text-gray-600 mb-4">
            A vessel matching IMO <strong>{{ match().imo }}</strong> was found in Seasearcher.
            Would you like to link this vessel to sync data automatically?
          </p>
          <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 mb-4">
            <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <span class="text-gray-500">Name</span>
                <div class="font-medium text-gray-900">{{ match().name }}</div>
              </div>
              @if (match().type) {
                <div>
                  <span class="text-gray-500">Type</span>
                  <div class="font-medium text-gray-900">{{ match().type }}</div>
                </div>
              }
              @if (match().flag) {
                <div>
                  <span class="text-gray-500">Flag</span>
                  <div class="font-medium text-gray-900">{{ match().flag }}</div>
                </div>
              }
              @if (match().dwt != null) {
                <div>
                  <span class="text-gray-500">DWT</span>
                  <div class="font-medium text-gray-900">{{ match().dwt | number }}</div>
                </div>
              }
              @if (match().grossTonnage != null) {
                <div>
                  <span class="text-gray-500">Gross Tonnage</span>
                  <div class="font-medium text-gray-900">{{ match().grossTonnage | number }}</div>
                </div>
              }
              @if (match().buildYear != null) {
                <div>
                  <span class="text-gray-500">Build Year</span>
                  <div class="font-medium text-gray-900">{{ match().buildYear }}</div>
                </div>
              }
            </div>
          </div>
          <p class="text-xs text-gray-500 mb-4">
            Company associations, orders and comments will be preserved. Vessel details will be updated from Seasearcher.
          </p>
          <div class="flex justify-end gap-3">
            <button (click)="dismiss.emit()" class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Dismiss
            </button>
            <button (click)="confirm.emit()" [disabled]="merging()" class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {{ merging() ? 'Merging…' : 'Merge & Sync' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class VesselDetailMergeModalComponent {
  readonly open = input(false);
  readonly merging = input(false);
  readonly match = input.required<{
    seasearcherId: string;
    name: string;
    imo: string | null;
    type: string | null;
    flag: string | null;
    dwt: number | null;
    grossTonnage: number | null;
    buildYear: number | null;
  }>();
  readonly dismiss = output<void>();
  readonly confirm = output<void>();
}