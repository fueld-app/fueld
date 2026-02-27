import { Component, ChangeDetectionStrategy } from '@angular/core';
import { InquiriesListPageComponent } from '../inquiries-list/inquiries-list-page.component';

@Component({
  selector: 'app-completed-orders-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InquiriesListPageComponent],
  template: `
    <app-inquiries-list-page mode="completed-orders" />
  `,
})
export class CompletedOrdersListPageComponent {}
