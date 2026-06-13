import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { PlaceDetailStore } from '../../place-detail.store';

@Component({
  selector: 'app-place-hierarchy-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    <div class="app-panel h-[420px] flex flex-col">
      <div class="app-panel-header app-panel-header--blue px-5 py-3">
        <h2 class="text-sm font-semibold text-gray-700">Terminals & Anchorages</h2>
      </div>

      <div class="flex-1 overflow-y-auto">
        @if (!store.terminals().length && !store.anchorages().length) {
          <div class="px-5 py-6 text-center text-sm text-gray-400">No terminals or anchorages registered</div>
        } @else {
          <div class="divide-y divide-gray-50">
          @for (item of store.terminals(); track item.id) {
            <div class="px-5 py-3">
              <div class="flex items-center justify-between">
                <button
                  (click)="store.navigateToChildPlace(item.id)"
                  class="text-sm font-medium text-brand-600 hover:text-brand-800 hover:underline text-left"
                >
                  {{ item.name }}
                </button>
                @if (item.type) {
                  <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                    {{ item.type }}
                  </span>
                }
              </div>
              @if (item.children.length) {
                <div class="mt-2 space-y-1.5 border-l-2 border-gray-100 pl-3">
                  @for (child of item.children; track child.id) {
                    <div class="flex items-center justify-between">
                      <button
                        (click)="store.navigateToChildPlace(child.id)"
                        class="text-xs text-gray-600 hover:text-brand-600 hover:underline text-left"
                      >
                        {{ child.name }}
                      </button>
                      @if (child.type) {
                        <span class="inline-flex items-center rounded-full bg-gray-50 px-1.5 py-0.5 text-[9px] font-medium text-gray-500">
                          {{ child.type }}
                        </span>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          }
          @for (item of store.anchorages(); track item.id) {
            <div class="px-5 py-3">
              <div class="flex items-center justify-between">
                <button
                  (click)="store.navigateToChildPlace(item.id)"
                  class="text-sm font-medium text-brand-600 hover:text-brand-800 hover:underline text-left"
                >
                  {{ item.name }}
                </button>
                @if (item.type) {
                  <span class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    {{ item.type }}
                  </span>
                }
              </div>
            </div>
          }
        </div>
      }
    </div>
  </div>
  `,
})
export class PlaceHierarchyCardComponent {
  readonly store = inject(PlaceDetailStore);
}
