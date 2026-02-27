import { Component, ChangeDetectionStrategy } from '@angular/core';
import { InquiriesListPageComponent } from '../inquiries-list/inquiries-list-page.component';

@Component({
  selector: 'app-cancelled-orders-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InquiriesListPageComponent],
  template: `
    <app-inquiries-list-page mode="cancelled-orders" />
  `,
})
export class CancelledOrdersListPageComponent {}
