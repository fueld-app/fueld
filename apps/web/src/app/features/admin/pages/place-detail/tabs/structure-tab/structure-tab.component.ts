import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { PlaceDetailStore } from '../../place-detail.store';
import { PlaceHierarchyCardComponent } from '../../components/place-hierarchy-card/place-hierarchy-card.component';
import { PlaceFacilitiesCardComponent } from '../../components/place-facilities-card/place-facilities-card.component';

@Component({
  selector: 'app-place-structure-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlaceHierarchyCardComponent, PlaceFacilitiesCardComponent],
  template: `
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <app-place-hierarchy-card />
      <app-place-facilities-card />
    </div>
  `,
})
export class PlaceStructureTabComponent {
  readonly store = inject(PlaceDetailStore);
}
