import {
  Component,
  ChangeDetectionStrategy,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';

// ═══════════════════════════════════════════════════════════════════════
//  Orders List Page — Overview table of all orders
// ═══════════════════════════════════════════════════════════════════════

interface OrderRow {
  id: string;
  client: string;
  vessel: string;
  port: string;
  status: string;
  totalValue: string;
  createdAt: string;
}

@Component({
  selector: 'app-orders-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusBadgeComponent],
  template: `
    <div>
      <!-- Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Orders</h1>
          <p class="mt-1 text-sm text-gray-500">Manage your bunker trading orders.</p>
        </div>
      </div>

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
                <td class="px-4 py-3 font-medium text-gray-900">{{ order.client }}</td>
                <td class="px-4 py-3 text-gray-600">{{ order.vessel }}</td>
                <td class="px-4 py-3 text-gray-600">{{ order.port }}</td>
                <td class="px-4 py-3">
                  <app-status-badge [status]="order.status" />
                </td>
                <td class="px-4 py-3 text-right tabular-nums text-gray-900">{{ order.totalValue }}</td>
                <td class="px-4 py-3 text-gray-500">{{ order.createdAt }}</td>
                <td class="px-4 py-3">
                  <a
                    [routerLink]="['/trading/orders', order.id]"
                    class="rounded-md p-1 text-gray-400 hover:text-brand-600 transition-colors"
                    aria-label="View order"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fill-rule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                    </svg>
                  </a>
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
            [routerLink]="['/trading/orders', order.id]"
            class="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
          >
            <div class="flex items-center justify-between mb-2">
              <span class="font-semibold text-gray-900">{{ order.client }}</span>
              <app-status-badge [status]="order.status" />
            </div>
            <div class="grid grid-cols-2 gap-1 text-xs text-gray-500">
              <span>🚢 {{ order.vessel }}</span>
              <span>🏗️ {{ order.port }}</span>
              <span>💰 {{ order.totalValue }} USD</span>
              <span>📅 {{ order.createdAt }}</span>
            </div>
          </a>
        }
      </div>
    </div>
  `,
})
export class OrdersListPageComponent {
  readonly orders = signal<OrderRow[]>([
    { id: 'ord-001', client: 'Pacific Shipping Co.', vessel: 'MV Nordic Star', port: 'Rotterdam', status: 'CONFIRMED', totalValue: '318,250.00', createdAt: '2026-02-01' },
    { id: 'ord-002', client: 'Maersk Line', vessel: 'MV Emma', port: 'Singapore', status: 'INQUIRY', totalValue: '—', createdAt: '2026-02-03' },
    { id: 'ord-003', client: 'CMA CGM', vessel: 'MV Antoine', port: 'Fujairah', status: 'DELIVERED', totalValue: '142,800.00', createdAt: '2026-01-28' },
    { id: 'ord-004', client: 'Hapag-Lloyd', vessel: 'MV Berlin Express', port: 'Houston', status: 'INVOICED', totalValue: '95,450.00', createdAt: '2026-01-20' },
    { id: 'ord-005', client: 'MSC', vessel: 'MSC Fantasia', port: 'Antwerp', status: 'PAID', totalValue: '278,900.00', createdAt: '2026-01-15' },
    { id: 'ord-006', client: 'Evergreen', vessel: 'Ever Given', port: 'Kaohsiung', status: 'CANCELLED', totalValue: '0.00', createdAt: '2026-01-10' },
  ]);
}
