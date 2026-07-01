import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { DateLabelPipe } from '@app/shared/pipes/date-format.pipe';

interface CompanyOrder {
  id: string;
  status: string;
  eta: string | null;
  etd: string | null;
  createdAt: string;
  updatedAt: string;
  vesselName: string;
  vesselImo: string | null;
  placeName: string;
  placeCountry: string;
  salesRepId: string | null;
  clientName?: string;
}

@Component({
  selector: 'app-orders-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DateLabelPipe],
  template: `
    <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm min-[900px]:order-[13]">
      <div class="border-b border-gray-100 dark:border-line px-5 py-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <h2 class="text-sm font-semibold text-gray-700 dark:text-ink-dim">Orders</h2>
          @if (isParent()) {
            <div class="flex gap-1">
              <button (click)="modeToggle.emit()"
                class="rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors"
                [class]="mode() === 'own' ? 'bg-brand-50 dark:bg-brand-700/15 text-brand-700 dark:text-brand-400' : 'text-gray-400 dark:text-muted hover:text-gray-600'">Own</button>
              <button (click)="modeToggle.emit()"
                class="rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors"
                [class]="mode() === 'group' ? 'bg-brand-50 dark:bg-brand-700/15 text-brand-700 dark:text-brand-400' : 'text-gray-400 dark:text-muted hover:text-gray-600'">Group</button>
            </div>
          }
        </div>
        @if (activeOrders().length) {
          <span class="inline-flex items-center rounded-full bg-gray-100 dark:bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:text-ink-dim">{{ activeOrders().length }}</span>
        }
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-8">
          <svg class="h-5 w-5 animate-spin text-gray-400 dark:text-muted" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else if (activeOrders().length) {
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-100 dark:border-line bg-gray-50/60 dark:bg-surface-2">
                @if (mode() === 'group') {
                  <th class="px-5 py-2 text-left font-medium text-gray-500 dark:text-muted">Client</th>
                }
                <th class="px-5 py-2 text-left font-medium text-gray-500 dark:text-muted">Vessel</th>
                <th class="px-5 py-2 text-left font-medium text-gray-500 dark:text-muted">Place</th>
                <th class="px-5 py-2 text-left font-medium text-gray-500 dark:text-muted">Status</th>
                <th class="px-5 py-2 text-left font-medium text-gray-500 dark:text-muted">Created</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              @for (order of activeOrders(); track order.id) {
                <tr class="hover:bg-gray-50/50 cursor-pointer transition-colors dark:hover:bg-surface-tint" (click)="orderClick.emit({ id: order.id, status: order.status })">
                  @if (mode() === 'group') {
                    <td class="px-5 py-2.5 text-gray-700 dark:text-ink-dim">{{ order.clientName || '—' }}</td>
                  }
                  <td class="px-5 py-2.5">
                    <span class="font-medium text-gray-900 dark:text-ink">{{ order.vesselName }}</span>
                    @if (order.vesselImo) { <span class="ml-1 text-xs text-gray-400 dark:text-muted">{{ order.vesselImo }}</span> }
                  </td>
                  <td class="px-5 py-2.5 text-gray-600 dark:text-ink-dim">
                    {{ order.placeName }}
                    @if (order.placeCountry) { <span class="text-xs text-gray-400 dark:text-muted ml-1">{{ order.placeCountry }}</span> }
                  </td>
                  <td class="px-5 py-2.5">
                    <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                      [class]="statusBadge(order.status)">{{ order.status }}</span>
                  </td>
                  <td class="px-5 py-2.5 text-gray-500 dark:text-muted">{{ order.createdAt | dateLabel }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="px-5 py-6 text-center text-sm text-gray-400 dark:text-muted">
          {{ mode() === 'group' ? 'No group orders found' : 'No orders found for this company' }}
        </div>
      }
    </div>
  `,
})
export class OrdersCardComponent {
  readonly ownOrders = input<CompanyOrder[]>([]);
  readonly groupOrders = input<(CompanyOrder & { clientName?: string })[]>([]);
  readonly ordersLoading = input<boolean>(false);
  readonly groupOrdersLoading = input<boolean>(false);
  readonly mode = input<'own' | 'group'>('own');
  readonly isParent = input<boolean>(false);

  readonly modeToggle = output<void>();
  readonly orderClick = output<{ id: string; status: string }>();

  get activeOrders(): () => CompanyOrder[] {
    return () => this.mode() === 'group' ? this.groupOrders() : this.ownOrders();
  }

  get loading(): () => boolean {
    return () => this.mode() === 'group' ? this.groupOrdersLoading() : this.ordersLoading();
  }

  statusBadge(status: string): string {
    switch (status) {
      case 'DRAFT': return 'bg-gray-100 text-gray-600 dark:bg-gray-500/15 dark:text-gray-400';
      case 'CONFIRMED': return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400';
      case 'DELIVERED': return 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400';
      case 'INVOICED': return 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400';
      case 'CANCELLED': case 'LOST': return 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400';
      default: return 'bg-gray-100 text-gray-600 dark:bg-gray-500/15 dark:text-gray-400';
    }
  }
}
