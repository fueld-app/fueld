import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { PlaceDetailStore } from '../../place-detail.store';
import { PlaceHeaderComponent } from '../../components/place-header/place-header.component';
import { PlaceMapCardComponent } from '../../components/place-map-card/place-map-card.component';
import { PlaceInfoCardComponent } from '../../components/place-info-card/place-info-card.component';
import { PlaceTrafficCardComponent } from '../../components/place-traffic-card/place-traffic-card.component';

@Component({
  selector: 'app-place-overview-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PlaceHeaderComponent,
    PlaceMapCardComponent,
    PlaceInfoCardComponent,
    PlaceTrafficCardComponent,
  ],
  template: `
    <div class="space-y-4">
      <app-place-header />
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <app-place-map-card />
        <app-place-traffic-card />
      </div>
      <app-place-info-card />
    </div>
  `,
})
export class PlaceOverviewTabComponent {
  readonly store = inject(PlaceDetailStore);
}
