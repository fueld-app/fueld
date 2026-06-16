import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { VesselDto } from '@fueld/types';
import { LastEditedBadgeComponent } from '@app/shared/components/last-edited-badge/last-edited-badge.component';

@Component({
  selector: 'app-vessel-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, LastEditedBadgeComponent],
  template: `
    <button
      (click)="goBack.emit()"
      class="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd" />
      </svg>
      Back to Vessels
    </button>

    <div class="flex items-center gap-3 mb-1">
      @if (vesselFlag()) { <span class="text-2xl">{{ vesselFlag() }}</span> }
      <h1 class="text-2xl font-bold text-gray-900">{{ vessel().name }}</h1>
      @if (isSanctioned()) {
        <span class="inline-flex items-center rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
          Sanctioned
        </span>
      }
      @if (hasActiveSeizureImpact()) {
        <span class="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-700">
          Seized / Arrested
        </span>
      }
      @if (vessel().status) {
        <span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
          [class]="vessel().status === 'Live' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'">
          {{ vessel().status }}
        </span>
      }
      @if (syncing()) {
        <span class="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600">
          <svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          Syncing…
        </span>
      }
      <div class="ml-auto flex items-center gap-2">
        @if (vessel().seasearcherId) {
          <a
            [href]="'https://www.seasearcher.com/vessel/' + vessel().seasearcherId"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
              <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
            </svg>
            Seasearcher
          </a>
        }
        @if (canDelete()) {
          <button
            (click)="deleteClick.emit()"
            class="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            Delete
          </button>
        }
      </div>
    </div>
    <div class="flex items-center gap-3">
      <p class="text-sm text-gray-500">
        @if (vessel().imo) { IMO {{ vessel().imo }} }
        @if (vessel().mmsi) { · MMSI {{ vessel().mmsi }} }
        @if (vessel().flag) { · {{ vessel().flag }} }
      </p>
      @if (vessel().lastSynced) {
        <span class="inline-flex items-center gap-1 text-xs text-gray-400" title="Last synced with Seasearcher">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
          </svg>
          Synced {{ vessel().lastSynced | date:'short' }}
        </span>
      }
    </div>
    <app-last-edited-badge entityType="vessel" [entityId]="vessel().id" />
  `,
})
export class VesselHeaderComponent {
  readonly vessel = input.required<VesselDto>();
  readonly vesselFlag = input<string>();
  readonly isSanctioned = input(false);
  readonly hasActiveSeizureImpact = input(false);
  readonly syncing = input(false);
  readonly canDelete = input(false);

  readonly goBack = output();
  readonly deleteClick = output();
}