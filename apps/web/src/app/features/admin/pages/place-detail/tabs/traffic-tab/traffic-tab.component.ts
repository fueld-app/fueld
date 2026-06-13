import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { PlaceDetailStore } from '../../place-detail.store';
import { PlaceTrafficCardComponent } from '../../components/place-traffic-card/place-traffic-card.component';

@Component({
  selector: 'app-place-traffic-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlaceTrafficCardComponent],
  template: `
    <div class="grid grid-cols-1 gap-4">
      <app-place-traffic-card />
    </div>
  `,
})
export class PlaceTrafficTabComponent {
  readonly store = inject(PlaceDetailStore);
}
