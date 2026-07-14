import { Component, ChangeDetectionStrategy } from '@angular/core';
import { InquiriesListPageComponent } from '../inquiries-list/inquiries-list-page.component';

@Component({
  selector: 'app-broker-deals-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InquiriesListPageComponent],
  template: `
    <app-inquiries-list-page mode="broker-deals" />
  `,
})
export class BrokerDealsListPageComponent {}