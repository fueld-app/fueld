import { Component, ChangeDetectionStrategy } from '@angular/core';
import { InquiriesListPageComponent } from '../inquiries-list/inquiries-list-page.component';

@Component({
  selector: 'app-lost-inquiries-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InquiriesListPageComponent],
  template: `
    <app-inquiries-list-page mode="lost-inquiries" />
  `,
})
export class LostInquiriesListPageComponent {}