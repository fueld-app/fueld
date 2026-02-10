import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';
import { DatePipe, DecimalPipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, OrderListRowDto } from '@fueld/types';
import { API } from '@app/core/config/api';

// ═══════════════════════════════════════════════════════════════════════
//  Orders List Page — Overview table of all orders
// ═══════════════════════════════════════════════════════════════════════

@Component({
  selector: 'app-orders-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusBadgeComponent, DatePipe, DecimalPipe],
  template: `
    <div>
      <!-- Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Orders</h1>
          <p class="mt-1 text-sm text-gray-500">Manage your bunker trading orders.</p>
        </div>
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-20">
          <svg class="h-8 w-8 animate-spin text-brand-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else {
        <!-- Desktop table -->
        <div class="hidden md:block overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200 bg-gray-50/80">
                <th class="px-4 py-3 text-left font-medium text-gray-600">Client</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600">Vessel</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600">Port</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th class="px-4 py-3 text-right font-medium text-gray-600">Value (USD)</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600">Created</th>
                <th class="px-4 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              @for (order of orders(); track order.id) {
                <tr class="transition-colors hover:bg-gray-50/50">
                  <td class="px-4 py-3 font-medium text-gray-900">{{ order.clientName }}</td>
                  <td class="px-4 py-3 text-gray-600">{{ order.vesselName }}</td>
                  <td class="px-4 py-3 text-gray-600">{{ order.placeName }}</td>
                  <td class="px-4 py-3">
                    <app-status-badge [status]="order.status" />
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums text-gray-900">
                    @if (order.totalValue > 0) {
                      {{ order.totalValue | number:'1.2-2' }}
                    } @else {
                      <span class="text-gray-400">—</span>
                    }
                  </td>
                  <td class="px-4 py-3 text-gray-500">{{ order.createdAt | date:'mediumDate' }}</td>
                  <td class="px-4 py-3">
                    <a
                      [routerLink]="['/trading/orders', order.orderNumber || order.id]"
                      class="rounded-md p-1 text-gray-400 hover:text-brand-600 transition-colors"
                      aria-label="View order"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fill-rule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                      </svg>
                    </a>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="7" class="px-4 py-12 text-center">
                    <p class="text-sm text-gray-400">No orders found.</p>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <!-- Mobile cards -->
        <div class="space-y-3 md:hidden">
          @for (order of orders(); track order.id) {
            <a
              [routerLink]="['/trading/orders', order.orderNumber || order.id]"
              class="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
            >
              <div class="flex items-center justify-between mb-2">
                <span class="font-semibold text-gray-900">{{ order.clientName }}</span>
                <app-status-badge [status]="order.status" />
              </div>
              <div class="grid grid-cols-2 gap-1 text-xs text-gray-500">
                <span>🚢 {{ order.vesselName }}</span>
                <span>🏗️ {{ order.placeName }}</span>
                <span>💰 {{ order.totalValue | number:'1.2-2' }} USD</span>
                <span>📅 {{ order.createdAt | date:'mediumDate' }}</span>
              </div>
            </a>
          } @empty {
            <div class="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
              No orders found.
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class OrdersListPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly orders = signal<OrderListRowDto[]>([]);
  readonly loading = signal(false);

  ngOnInit(): void {
    this.loadOrders();
  }

  private async loadOrders(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ items: OrderListRowDto[]; total: number }>>(
          `${API}/orders`,
        ),
      );
      if (res.success) this.orders.set(res.data.items ?? []);
    } finally {
      this.loading.set(false);
    }
  }
}
