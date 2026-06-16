import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'app-vessel-orders-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    @if (vesselOrders().length || ordersLoading()) {
      <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:h-[449px] min-[900px]:flex min-[900px]:flex-col overflow-hidden">
        <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-gray-700">Orders</h2>
          @if (vesselOrders().length) {
            <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">{{ vesselOrders().length }}</span>
          }
        </div>
        @if (ordersLoading()) {
          <div class="flex-1 flex items-center justify-center py-8">
            <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          </div>
        } @else {
          <div class="flex-1 min-h-0 overflow-auto">
            <table class="w-full text-sm">
              <thead class="sticky top-0 z-10">
                <tr class="border-b border-gray-100 bg-gray-50/60">
                  <th class="px-5 py-2 text-left font-medium text-gray-500">Status</th>
                  <th class="px-5 py-2 text-left font-medium text-gray-500">Client</th>
                  <th class="px-5 py-2 text-left font-medium text-gray-500">Port</th>
                  <th class="px-5 py-2 text-left font-medium text-gray-500">ETA</th>
                  <th class="px-5 py-2 text-left font-medium text-gray-500">Created</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                @for (o of vesselOrders(); track o.id) {
                  <tr class="hover:bg-gray-50/50 transition-colors cursor-pointer" (click)="goToOrder.emit({ orderId: o.id, status: o.status })">
                    <td class="px-5 py-2.5">
                      <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                        [class]="statusBadgeClass(o.status)">
                        {{ o.status }}
                      </span>
                    </td>
                    <td class="px-5 py-2.5 text-gray-900 font-medium">{{ o.clientName }}</td>
                    <td class="px-5 py-2.5 text-gray-600">{{ o.placeName }}</td>
                    <td class="px-5 py-2.5 text-gray-600">{{ o.eta ? (o.eta | date:'mediumDate') : '—' }}</td>
                    <td class="px-5 py-2.5 text-gray-600">{{ o.createdAt | date:'mediumDate' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    }
  `,
})
export class VesselOrdersCardComponent {
  readonly vesselOrders = input<any[]>([]);
  readonly ordersLoading = input(false);
  readonly goToOrder = output<{ orderId: string; status: string }>();

  statusBadgeClass(status: string): string {
    switch (status) {
      case 'CONFIRMED': return 'bg-green-100 text-green-700';
      case 'DELIVERED': return 'bg-blue-100 text-blue-700';
      case 'INQUIRY': return 'bg-amber-100 text-amber-700';
      case 'CANCELLED': case 'LOST': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  }
}