import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { PlaceDetailStore } from '../../place-detail.store';
import { PlaceSuppliersCardComponent } from '../../components/place-suppliers-card/place-suppliers-card.component';
import { PlaceOrdersCardComponent } from '../../components/place-orders-card/place-orders-card.component';
import { PlaceRemarkCardComponent } from '../../components/place-remark-card/place-remark-card.component';

@Component({
  selector: 'app-place-commercial-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PlaceSuppliersCardComponent,
    PlaceOrdersCardComponent,
    PlaceRemarkCardComponent,
  ],
  template: `
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div class="space-y-4 lg:col-span-2">
        <app-place-orders-card />
        <app-place-remark-card />
      </div>
      <div class="lg:col-span-1">
        <app-place-suppliers-card />
      </div>
    </div>
  `,
})
export class PlaceCommercialTabComponent {
  readonly store = inject(PlaceDetailStore);
}
