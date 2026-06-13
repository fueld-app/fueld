import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlaceDetailStore } from '../../place-detail.store';

@Component({
  selector: 'app-place-remark-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="app-panel">
      <div class="app-panel-header app-panel-header--blue justify-between px-5 py-3">
        <h2 class="text-sm font-semibold text-gray-700">Default Order Remark</h2>
        @if (!store.editingOrderRemark()) {
          <button
            (click)="store.startEditOrderRemark()"
            class="text-xs text-brand-600 hover:text-brand-800"
          >
            Edit
          </button>
        }
      </div>

      <div class="px-5 py-4">
        @if (store.editingOrderRemark()) {
          <textarea
            [ngModel]="store.orderRemarkDraft()"
            (ngModelChange)="store.orderRemarkDraft.set($event)"
            rows="4"
            class="app-input w-full text-sm"
            placeholder="Default remark shown on new orders for this place…"
          ></textarea>
          @if (store.orderRemarkError()) {
            <p class="mt-2 text-xs text-red-600">{{ store.orderRemarkError() }}</p>
          }
          @if (store.orderRemarkSaved()) {
            <p class="mt-2 text-xs text-emerald-600">Saved.</p>
          }
          <div class="mt-3 flex items-center justify-end gap-2">
            <button
              (click)="store.cancelOrderRemarkEdit()"
              class="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              (click)="store.saveOrderRemark()"
              [disabled]="store.savingOrderRemark()"
              class="app-button-primary text-xs"
            >
              @if (store.savingOrderRemark()) {
                <svg class="inline h-3.5 w-3.5 animate-spin mr-1" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              }
              Save
            </button>
          </div>
        } @else {
          @if (store.place()?.orderRemark) {
            <p class="whitespace-pre-wrap text-sm text-gray-700">{{ store.place()?.orderRemark }}</p>
          } @else {
            <p class="text-sm italic text-gray-400">No default remark configured</p>
          }
        }
      </div>
    </div>
  `,
})
export class PlaceRemarkCardComponent {
  readonly store = inject(PlaceDetailStore);
}
