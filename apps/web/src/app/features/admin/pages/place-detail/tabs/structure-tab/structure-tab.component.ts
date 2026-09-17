import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { PlaceDetailStore } from '../../place-detail.store';
import { PlaceHierarchyCardComponent } from '../../components/place-hierarchy-card/place-hierarchy-card.component';
import { PlaceFacilitiesCardComponent } from '../../components/place-facilities-card/place-facilities-card.component';

@Component({
  selector: 'app-place-structure-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlaceHierarchyCardComponent, PlaceFacilitiesCardComponent],
  template: `
    @if (store.isManualPlace()) {
      <div class="app-panel px-5 py-10 text-center">
        <p class="text-sm font-medium text-gray-600 dark:text-ink-dim">Structure data isn't available for this place</p>
        <p class="mt-1 text-sm text-gray-400 dark:text-muted">
          Terminals, anchorages and port facilities come from Seasearcher, and this place is a manual entry that isn't linked to Seasearcher.
        </p>
      </div>
    } @else {
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <app-place-hierarchy-card />
        <app-place-facilities-card />
      </div>
    }
  `,
})
export class PlaceStructureTabComponent {
  readonly store = inject(PlaceDetailStore);
}
