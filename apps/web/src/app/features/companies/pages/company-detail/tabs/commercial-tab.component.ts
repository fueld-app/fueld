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
  styles: [':host { display: block }'],
  template: `
    @if (store.company(); as company) {
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
        [companyId]="company.id"
        [contacts]="store.contacts()"
        [contactsLoading]="store.contactsLoading()"
      />

      <app-files-card [companyId]="company.id" />

      @if (store.segmentCategories().length > 0) {
        <app-segments-card
          [categories]="store.segmentCategories()"
          [segments]="store.companySegments()"
          [saving]="store.segmentsSaving()"
          (toggle)="store.onSegmentToggle($event)"
        />
      }
    </div>
    } @else {
      <div class="flex items-center justify-center py-12">
        <svg class="h-6 w-6 animate-spin text-gray-400 dark:text-muted" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
      </div>
    }
  `,
})
export class CommercialTabComponent {
  readonly store = inject(CompanyDetailStore);
}
