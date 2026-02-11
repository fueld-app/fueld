import { Component, ChangeDetectionStrategy } from '@angular/core';
import { InquiriesListPageComponent } from '../inquiries-list/inquiries-list-page.component';

// ═══════════════════════════════════════════════════════════════════════
//  Orders List Page — Overview table of all orders
// ═══════════════════════════════════════════════════════════════════════

@Component({
  selector: 'app-orders-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InquiriesListPageComponent],
  template: `
    <app-inquiries-list-page mode="orders" />
  `,
})
export class OrdersListPageComponent {}
