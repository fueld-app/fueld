import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { PlaceDetailStore } from '../../place-detail.store';
import { PlaceTrafficCardComponent } from '../../components/place-traffic-card/place-traffic-card.component';
import { PlaceHierarchyCardComponent } from '../../components/place-hierarchy-card/place-hierarchy-card.component';
import { PlaceFacilitiesCardComponent } from '../../components/place-facilities-card/place-facilities-card.component';

@Component({
  selector: 'app-place-traffic-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PlaceTrafficCardComponent,
    PlaceHierarchyCardComponent,
    PlaceFacilitiesCardComponent,
  ],
  template: `
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-4">
      <div class="lg:col-span-2">
        <app-place-traffic-card />
      </div>
      <div class="space-y-4">
        <app-place-hierarchy-card />
        <app-place-facilities-card />
      </div>
    </div>
  `,
})
export class PlaceTrafficTabComponent {
  readonly store = inject(PlaceDetailStore);
}
