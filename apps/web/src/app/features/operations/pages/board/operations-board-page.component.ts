import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  computed,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';
import { SearchableDropdownComponent, type DropdownOption } from '../../../../shared/components/searchable-dropdown/searchable-dropdown.component';
import type { ApiResponse, OrderListRowDto } from '@fueld/types';
import { OrderStatus } from '@fueld/types';
import { DatePipe } from '@angular/common';
import { DateLabelPipe } from '../../../../shared/pipes/date-format.pipe';
import { API } from '@app/core/config/api';
import { AuthService } from '@app/core/auth/auth.service';

interface TeamUserOption {
  id: string;
  name: string;
  email: string;
}

@Component({
  selector: 'app-operations-board-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusBadgeComponent, FormsModule, SearchableDropdownComponent, DatePipe, DateLabelPipe],
  template: `
    <div class="h-full flex flex-col">
      <!-- Header -->
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">Operations Board</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-muted">Track active orders by delivery status.</p>
        </div>
        <div class="flex flex-wrap items-end gap-3">
          <input
            type="text"
            [ngModel]="searchTerm()"
            (ngModelChange)="onSearch($event)"
            placeholder="Search by client, vessel or port..."
            class="w-64 rounded-lg border border-gray-300 dark:border-line-strong px-4 py-2.5 text-sm shadow-sm placeholder:text-gray-400 dark:placeholder:text-muted focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          />
          <div class="w-56">
            <app-searchable-dropdown
              placeholder="Filter by responsible…"
              [options]="responsibleOptions()"
              [selected]="filterResponsibleId()"
              [clearable]="true"
              (selectionChange)="onResponsibleFilterChange($event)"
            />
          </div>
        </div>
      </div>

      <!-- Loading -->
      @if (loading()) {
        <div class="flex flex-1 items-center justify-center">
          <svg class="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else {
        <!-- Kanban Board -->
        <div class="flex flex-1 gap-4 overflow-x-auto pb-2">
          @for (column of columns(); track column.status) {
            <div class="flex w-80 min-w-[20rem] flex-col rounded-xl border border-gray-200 dark:border-line bg-gray-50/50">
              <!-- Column header -->
              <div class="flex items-center justify-between border-b border-gray-200 dark:border-line px-4 py-3">
                <div class="flex items-center gap-2">
                  <span class="inline-flex h-2.5 w-2.5 rounded-full" [class]="columnDotClass(column.status)"></span>
                  <h2 class="text-sm font-semibold text-gray-700 dark:text-ink-dim">{{ column.label }}</h2>
                </div>
                <span class="rounded-full bg-gray-100 dark:bg-surface-3 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-ink-dim">
                  {{ column.orders.length }}
                </span>
              </div>

              <!-- Cards -->
              <div class="flex-1 space-y-3 overflow-y-auto p-3">
                @for (order of column.orders; track order.id) {
                  <a
                    [routerLink]="['/trading/orders', order.orderNumber || order.id]"
                    class="block rounded-lg border border-gray-200 dark:border-line bg-white dark:bg-surface p-4 shadow-sm transition-all hover:shadow-md hover:border-brand-300"
                  >
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <p class="text-xs font-mono text-gray-400 dark:text-muted">{{ order.orderNumber ?? '—' }}</p>
                        <p class="mt-0.5 truncate text-sm font-semibold text-gray-900 dark:text-ink">{{ order.clientName }}</p>
                      </div>
                      <app-status-badge [status]="order.status" />
                    </div>

                    <div class="mt-3 space-y-1.5 text-xs text-gray-500 dark:text-muted">
                      <div class="flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-muted" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path d="M4 19h16M5 19l1-9h12l1 9M8 10V7a1 1 0 011-1h6a1 1 0 011 1v3M12 6V3" />
                        </svg>
                        <span class="truncate">{{ order.vesselName }}</span>
                      </div>
                      <div class="flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-muted" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path fill-rule="evenodd" d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 00.281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 10 3 9c0 3.492 1.698 5.988 3.355 7.615.829.8 1.654 1.381 2.274 1.765.311.193.57.337.757.433.09.047.17.088.242.12.047.02.09.038.124.052l.018.008.006.003zM6 9a2 2 0 114 0 2 2 0 01-4 0z" clip-rule="evenodd" />
                        </svg>
                        <span class="truncate">{{ order.placeName }}</span>
                      </div>
                      <div class="flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-muted" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clip-rule="evenodd" />
                        </svg>
                        <span>ETA {{ order.eta ? (order.eta | dateLabel) : '—' }}</span>
                      </div>
                      <div class="flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-muted" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd" />
                        </svg>
                        <span>{{ order.salesRepName || '—' }}</span>
                      </div>
                    </div>
                  </a>
                } @empty {
                  <div class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 dark:border-line py-8">
                    <p class="text-sm text-gray-400 dark:text-muted">No orders</p>
                  </div>
                }
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class OperationsBoardPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  readonly auth = inject(AuthService);

  readonly loading = signal(false);
  readonly orders = signal<OrderListRowDto[]>([]);
  readonly searchTerm = signal('');
  readonly filterResponsibleId = signal('');
  readonly teamUsers = signal<TeamUserOption[]>([]);

  readonly responsibleOptions = computed<DropdownOption[]>(() =>
    this.teamUsers().map((user) => ({ value: user.id, label: user.name })),
  );

  readonly filteredOrders = computed(() => {
    let result = this.orders();
    const search = this.searchTerm().trim().toLowerCase();
    if (search) {
      result = result.filter(
        (o) =>
          o.clientName.toLowerCase().includes(search) ||
          o.vesselName.toLowerCase().includes(search) ||
          o.placeName.toLowerCase().includes(search) ||
          (o.orderNumber ?? '').toLowerCase().includes(search),
      );
    }
    const responsibleId = this.filterResponsibleId();
    if (responsibleId) {
      result = result.filter((o) => o.salesRepName === this.teamUsers().find((u) => u.id === responsibleId)?.name);
    }
    return result;
  });

  readonly columns = computed(() => {
    const all = this.filteredOrders();
    return [
      {
        status: OrderStatus.Confirmed,
        label: 'Confirmed',
        orders: all.filter((o) => o.status === OrderStatus.Confirmed),
      },
      {
        status: OrderStatus.Delivered,
        label: 'Delivered',
        orders: all.filter((o) => o.status === OrderStatus.Delivered),
      },
      {
        status: OrderStatus.Invoiced,
        label: 'Invoiced',
        orders: all.filter((o) => o.status === OrderStatus.Invoiced),
      },
    ];
  });

  ngOnInit(): void {
    void this.loadOrders();
    void this.loadTeamUsers();
  }

  async loadOrders(): Promise<void> {
    this.loading.set(true);
    try {
      const params = new URLSearchParams();
      params.set('statuses', 'CONFIRMED,DELIVERED,INVOICED');
      params.set('page', '1');
      params.set('limit', '200');

      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ items: OrderListRowDto[]; total: number }>>(
          `${API}/orders?${params.toString()}`,
        ),
      );
      if (res.success) {
        this.orders.set(res.data.items);
      }
    } catch {
      // silently ignore
    } finally {
      this.loading.set(false);
    }
  }

  async loadTeamUsers(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<TeamUserOption[]>>(`${API}/lloyds/users`),
      );
      if (res.success) {
        this.teamUsers.set(res.data ?? []);
      }
    } catch {
      // silently ignore
    }
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
  }

  onResponsibleFilterChange(userId: string | null): void {
    this.filterResponsibleId.set(userId ?? '');
  }

  columnDotClass(status: OrderStatus): string {
    switch (status) {
      case OrderStatus.Confirmed:
        return 'bg-blue-500';
      case OrderStatus.Delivered:
        return 'bg-emerald-500';
      case OrderStatus.Invoiced:
        return 'bg-amber-500';
      default:
        return 'bg-gray-400';
    }
  }
}