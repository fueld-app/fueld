import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CompanyDetailStore } from '../company-detail.store';
import { OrdersCardComponent } from '../components/orders-card/orders-card.component';
import { SupplyPortsCardComponent } from '../components/supply-ports-card/supply-ports-card.component';
import { FilesCardComponent } from '../components/files-card/files-card.component';
import { SegmentsCardComponent } from '../components/segments-card/segments-card.component';

@Component({
  selector: 'app-commercial-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    OrdersCardComponent,
    SupplyPortsCardComponent,
    FilesCardComponent,
    SegmentsCardComponent,
  ],
  template: `
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <app-orders-card
        [ownOrders]="store.companyOrders()"
        [groupOrders]="store.groupOrders()"
        [ordersLoading]="store.ordersLoading()"
        [groupOrdersLoading]="store.groupOrdersLoading()"
        [mode]="store.groupOrdersMode()"
        [isParent]="store.isParent()"
        (modeToggle)="store.toggleOrdersMode()"
        (orderClick)="store.goToOrder($event.id)"
      />

      <app-supply-ports-card
        [companyId]="store.company()!.id"
        [contacts]="store.contacts()"
        [contactsLoading]="store.contactsLoading()"
      />

      <app-files-card [companyId]="store.company()!.id" />

      @if (store.segmentCategories().length > 0) {
        <app-segments-card
          [categories]="store.segmentCategories()"
          [segments]="store.companySegments()"
          [saving]="store.segmentsSaving()"
          (toggle)="store.onSegmentToggle($event)"
        />
      }
    </div>
  `,
})
export class CommercialTabComponent {
  readonly store = inject(CompanyDetailStore);
}
