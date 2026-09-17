import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { PlaceDetailStore } from '../../place-detail.store';
import { PlaceTrafficCardComponent } from '../../components/place-traffic-card/place-traffic-card.component';

@Component({
  selector: 'app-place-traffic-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlaceTrafficCardComponent],
  template: `
    @if (store.isManualPlace()) {
      <div class="app-panel px-5 py-10 text-center">
        <p class="text-sm font-medium text-gray-600 dark:text-ink-dim">Traffic data isn't available for this place</p>
        <p class="mt-1 text-sm text-gray-400 dark:text-muted">
          Expected arrivals and nearby vessels come from Seasearcher, and this place is a manual entry that isn't linked to Seasearcher.
        </p>
      </div>
    } @else {
      <div class="grid grid-cols-1 gap-4">
        <app-place-traffic-card />
      </div>
    }
  `,\n
})
export class PlaceTrafficTabComponent {
  readonly store = inject(PlaceDetailStore);
}
