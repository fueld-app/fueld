import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { PlaceDetailStore } from '../../place-detail.store';

@Component({
  selector: 'app-place-orders-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe],
  template: `
    <div class="app-panel h-[420px] flex flex-col">
      <div class="app-panel-header app-panel-header--blue justify-between px-5 py-3">
        <h2 class="text-sm font-semibold text-gray-700">Orders
          @if (store.placeOrders().length) {
            <span class="ml-1 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
              {{ store.placeOrders().length }}
            </span>
          }
        </h2>
        <a
          [routerLink]="['/orders/new']"
          [queryParams]="{ placeId: store.place()?.id }"
          class="app-button-add text-[11px]"
        >
          New order
        </a>
      </div>

      <div class="flex-1 overflow-y-auto">
        @if (store.ordersLoading()) {
          <div class="px-5 py-6 text-center text-sm text-gray-400">Loading orders…</div>
        } @else if (!store.placeOrders().length) {
          <div class="px-5 py-6 text-center text-sm text-gray-400">No orders for this place</div>
        } @else {
          <div class="divide-y divide-gray-50">
            @for (order of store.placeOrders(); track order.id) {
              <a
                [routerLink]="['/orders', order.id]"
                class="block px-5 py-3 hover:bg-gray-50/50 transition-colors"
              >
                <div class="flex items-center justify-between">
                  <span class="text-sm font-medium text-brand-600">{{ order.reference ?? 'Order #' + order.id }}</span>
                  @if (order.status) {
                    <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                          [class]="store.orderStatusClass(order.status)">
                      {{ order.status }}
                    </span>
                  }
                </div>
                <div class="mt-1 flex items-center gap-2 text-[10px] text-gray-400">
                  @if (order.vesselName) { <span>{{ order.vesselName }}</span> }
                  @if (order.eta) { <span>· ETA {{ order.eta | date:'MMM d, HH:mm' }}</span> }
                </div>
              </a>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class PlaceOrdersCardComponent {
  readonly store = inject(PlaceDetailStore);
}
