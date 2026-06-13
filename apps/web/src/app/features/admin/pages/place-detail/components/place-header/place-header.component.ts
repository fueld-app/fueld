import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlaceDetailStore } from '../../place-detail.store';

@Component({
  selector: 'app-place-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, FormsModule],
  template: `
    <div class="mb-6">
      <div class="flex items-center gap-3 mb-1">
        <span class="text-3xl">{{ store.countryFlag() }}</span>
        <h1 class="text-2xl font-bold text-gray-900">{{ store.place()!.name }}</h1>
        @if (store.place()!.placeType) {
          <span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
                [class]="store.placeTypeBadgeClass(store.place()!.placeType!)">
            {{ store.placeTypeLabel(store.place()!.placeType!) }}
          </span>
        }
        @if (store.syncing()) {
          <span class="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600">
            <svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            Syncing…
          </span>
        }
        <div class="ml-auto flex items-center gap-2">
          @if (store.place()!.lliPlaceId) {
            <a
              [href]="'https://www.seasearcher.com/place/' + store.place()!.lliPlaceId"
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
          @if (store.canDeleteEntity()) {
            <button
              (click)="store.confirmDeletePlace()"
              class="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              Delete
            </button>
          }
        </div>
      </div>

      <div class="flex items-center gap-3">
        <p class="hidden md:block text-sm text-gray-500">
          {{ store.place()!.country }}
          @if (store.place()!.countryIso && store.place()!.countryIso !== store.place()!.country) { ({{ store.place()!.countryIso }}) }
          @if (store.place()!.area) { · {{ store.place()!.area }} }
          @if (store.place()!.subRegion) { · {{ store.place()!.subRegion }} }
        </p>
        @if (store.localTime()) {
          <span class="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-mono font-medium text-gray-700" title="Local time at port">
            🕐 {{ store.localTime() }}
          </span>
        }
        @if (store.place()!.lliLastUpdated) {
          <span class="inline-flex items-center gap-1 text-xs text-gray-400" title="Last synced with Seasearcher">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
            </svg>
            Synced {{ store.place()!.lliLastUpdated | date:'short' }}
          </span>
        }
        <span class="text-gray-300">|</span>
        <span class="text-xs text-gray-500">Responsible:</span>
        <select
          [ngModel]="store.responsibleUserId() ?? ''"
          (ngModelChange)="store.onResponsibleUserChange($event)"
          [disabled]="store.savingResponsible()"
          class="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
        >
          <option value="">— None —</option>
          @for (u of store.teamUsers(); track u.id) {
            <option [value]="u.id">{{ u.name }}</option>
          }
        </select>
        @if (store.savingResponsible()) {
          <svg class="h-3.5 w-3.5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        }
      </div>

      @if (store.parentPlaceName()) {
        <p class="mt-1 text-sm text-gray-500">
          Parent:
          @if (store.parentLocalId()) {
            <a [routerLink]="['/places', store.parentLocalId()]"
               class="text-brand-600 hover:text-brand-800 font-medium hover:underline">
              {{ store.parentPlaceName() }}
            </a>
          } @else {
            <button (click)="store.navigateToParent()"
                    [disabled]="store.navigatingParentId()"
                    class="text-brand-600 hover:text-brand-800 font-medium hover:underline disabled:opacity-50 inline-flex items-center gap-1">
              @if (store.navigatingParentId()) {
                <svg class="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              }
              {{ store.parentPlaceName() }}
            </button>
          }
        </p>
      }
    </div>
  `,
})
export class PlaceHeaderComponent {
  readonly store: PlaceDetailStore = inject(PlaceDetailStore);
}
