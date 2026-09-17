import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { PlaceDetailStore } from '../../place-detail.store';
import { PlaceMapCardComponent } from '../../components/place-map-card/place-map-card.component';
import { PlaceInfoCardComponent } from '../../components/place-info-card/place-info-card.component';

@Component({
  selector: 'app-place-overview-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PlaceMapCardComponent,
    PlaceInfoCardComponent,
  ],
  template: `
    <div class="space-y-4">
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <app-place-info-card />
        <app-place-map-card />
      </div>
    </div>
  `,
})
export class PlaceOverviewTabComponent {
  readonly store = inject(PlaceDetailStore);
}