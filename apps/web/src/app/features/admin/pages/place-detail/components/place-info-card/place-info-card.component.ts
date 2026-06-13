import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlaceDetailStore } from '../../place-detail.store';

@Component({
  selector: 'app-place-info-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="app-panel h-[420px] flex flex-col">
      <div class="app-panel-header app-panel-header--brand justify-between px-5 py-3">
        <div class="flex items-center gap-2">
          <h2 class="text-sm font-semibold text-gray-700">General Information</h2>
          @if (store.isManualPlace()) {
            <span class="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">Manual</span>
          }
        </div>
        @if (store.isManualPlace()) {
          <div class="flex items-center gap-2">
            @if (!store.editingPlace()) {
              <button
                (click)="store.startEditPlace()"
                class="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Edit
              </button>
            } @else {
              <button
                (click)="store.savePlaceEdits()"
                [disabled]="store.savingPlace()"
                class="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {{ store.savingPlace() ? 'Saving…' : 'Save' }}
              </button>
              <button
                (click)="store.cancelEditPlace()"
                [disabled]="store.savingPlace()"
                class="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
            }
          </div>
        }
      </div>
      <div class="app-panel-body flex-1 overflow-y-auto">
        @if (!store.editingPlace()) {
          <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div>
              <dt class="text-gray-500">UNLOCODE</dt>
              <dd class="mt-0.5 font-medium text-gray-900 font-mono">{{ store.place()!.unlocode ?? '—' }}</dd>
            </div>
            <div>
              <dt class="text-gray-500">Area</dt>
              <dd class="mt-0.5 font-medium text-gray-900">{{ store.place()!.area ?? '—' }}</dd>
            </div>
            <div>
              <dt class="text-gray-500">Sub Region</dt>
              <dd class="mt-0.5 font-medium text-gray-900">{{ store.place()!.subRegion ?? '—' }}</dd>
            </div>
            <div>
              <dt class="text-gray-500">Timezone</dt>
              <dd class="mt-0.5 font-medium text-gray-900">{{ store.place()!.timezone ?? '—' }}</dd>
              @if (store.place()!.timezone && !store.isValidIanaTimezone(store.place()!.timezone!)) {
                <dd class="mt-0.5 text-xs text-amber-600">⚠ Not a valid IANA timezone — dates may display incorrectly</dd>
              }
            </div>
          </dl>
        } @else {
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <label class="space-y-1">
              <span class="text-gray-500">Name</span>
              <input
                [ngModel]="store.placeForm().name"
                (ngModelChange)="store.updatePlaceForm('name', $event)"
                class="app-input w-full text-gray-700"
              />
            </label>
            <label class="space-y-1">
              <span class="text-gray-500">Country</span>
              <input
                [ngModel]="store.placeForm().country"
                (ngModelChange)="store.updatePlaceForm('country', $event)"
                class="app-input w-full text-gray-700"
              />
            </label>
            <label class="space-y-1">
              <span class="text-gray-500">Country ISO</span>
              <input
                [ngModel]="store.placeForm().countryIso"
                (ngModelChange)="store.updatePlaceForm('countryIso', $event)"
                class="app-input w-full text-gray-700"
              />
            </label>
            <label class="space-y-1">
              <span class="text-gray-500">Place Type</span>
              <select
                [ngModel]="store.placeForm().placeType"
                (ngModelChange)="store.updatePlaceForm('placeType', $event)"
                class="app-input w-full text-gray-700"
              >
                <option value="">Select</option>
                @for (opt of store.placeTypeOptions; track opt.value) {
                  <option [value]="opt.value">{{ opt.label }}</option>
                }
              </select>
            </label>
            <label class="space-y-1">
              <span class="text-gray-500">Area</span>
              <input
                [ngModel]="store.placeForm().area"
                (ngModelChange)="store.updatePlaceForm('area', $event)"
                class="app-input w-full text-gray-700"
              />
            </label>
            <label class="space-y-1">
              <span class="text-gray-500">Sub Region</span>
              <input
                [ngModel]="store.placeForm().subRegion"
                (ngModelChange)="store.updatePlaceForm('subRegion', $event)"
                class="app-input w-full text-gray-700"
              />
            </label>
            <label class="space-y-1">
              <span class="text-gray-500">Timezone</span>
              <input
                [ngModel]="store.placeForm().timezone"
                (ngModelChange)="store.updatePlaceForm('timezone', $event)"
                placeholder="e.g. Asia/Dubai, Europe/London"
                list="iana-timezones"
                class="app-input w-full text-gray-700"
              />
              <datalist id="iana-timezones">
                @for (tz of store.commonTimezones; track tz) {
                  <option [value]="tz">{{ tz }}</option>
                }
              </datalist>
              @if (store.placeForm().timezone && !store.isValidIanaTimezone(store.placeForm().timezone)) {
                <span class="text-xs text-amber-600">⚠ Not a recognized IANA timezone</span>
              }
            </label>
            <label class="space-y-1">
              <span class="text-gray-500">UNLOCODE</span>
              <input
                [ngModel]="store.placeForm().unlocode"
                (ngModelChange)="store.updatePlaceForm('unlocode', $event)"
                class="app-input-mono w-full text-gray-700"
              />
            </label>
            <label class="space-y-1">
              <span class="text-gray-500">Admiralty Chart</span>
              <input
                [ngModel]="store.placeForm().admiraltyChart"
                (ngModelChange)="store.updatePlaceForm('admiraltyChart', $event)"
                class="app-input w-full text-gray-700"
              />
            </label>
            <label class="space-y-1">
              <span class="text-gray-500">Latitude</span>
              <input
                type="number"
                step="0.000001"
                [ngModel]="store.placeForm().lat"
                (ngModelChange)="store.onLatChange($event)"
                class="app-input w-full text-gray-700"
              />
            </label>
            <label class="space-y-1">
              <span class="text-gray-500">Longitude</span>
              <input
                type="number"
                step="0.000001"
                [ngModel]="store.placeForm().long"
                (ngModelChange)="store.onLongChange($event)"
                class="app-input w-full text-gray-700"
              />
            </label>
          </div>
        }
      </div>
    </div>
  `,
})
export class PlaceInfoCardComponent {
  readonly store = inject(PlaceDetailStore);
}
