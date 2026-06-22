import { Service, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, InventoryAvailabilityResultDto, OrderDto } from '@fueld/types';
import type { OrderItemRow, OrderItemAvailability } from '../../../components/order-items/order-item.types';
import { API_URL } from '@app/core/config/api';

@Service()
export class OrderInventoryService {
  private readonly http = inject(HttpClient);

  /** Live availability check results keyed by item row id. */
  readonly availabilityByRowId = signal<Record<string, OrderItemAvailability>>({});

  /** Debounce timers per row id for availability checks. */
  private readonly availabilityTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Schedule an availability check for each tracked line; debounced per row.
   * Call whenever itemRows change.
   */
  scheduleChecks(rows: OrderItemRow[], order: OrderDto | null): void {
    const trackedIds = new Set<string>();

    for (const row of rows) {
      if (!row.warehouseId || !row.inventorySkuId) continue;
      trackedIds.add(row.id);

      // Debounce 300ms per row to avoid hammering the API while editing quantity.
      const existing = this.availabilityTimers.get(row.id);
      if (existing) clearTimeout(existing);

      this.availabilityTimers.set(row.id, setTimeout(() => {
        this.availabilityTimers.delete(row.id);
        void this.runCheck(row.id, rows, order);
      }, 300));
    }

    // Drop stale entries for rows that are no longer tracked or were removed.
    this.availabilityByRowId.update((current) => {
      const next: Record<string, OrderItemAvailability> = {};
      for (const [rowId, value] of Object.entries(current)) {
        if (trackedIds.has(rowId)) next[rowId] = value;
      }
      return next;
    });
  }

  private async runCheck(
    rowId: string,
    rows: OrderItemRow[],
    order: OrderDto | null,
  ): Promise<void> {
    const row = rows.find((r) => r.id === rowId);
    if (!row || !row.warehouseId || !row.inventorySkuId) return;

    const quantity = row.quantity > 0 ? row.quantity : 0;
    if (quantity <= 0) {
      this.availabilityByRowId.update((m) => {
        const next = { ...m };
        delete next[rowId];
        return next;
      });
      return;
    }

    // Resolve the planned date — explicit field wins; otherwise fall back to ETA, then now.
    const neededAt = row.plannedInventoryAt
      ?? order?.eta
      ?? new Date().toISOString();

    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<InventoryAvailabilityResultDto>>(
          `${API_URL}/inventory/check-availability`,
          {
            warehouseId: row.warehouseId,
            skuId: row.inventorySkuId,
            quantity: String(quantity),
            unit: row.unit,
            neededAt,
          },
        ),
      );
      if (res.success) {
        this.availabilityByRowId.update((m) => ({ ...m, [rowId]: res.data }));
      }
    } catch {
      // Silent — availability is advisory; backend still enforces at confirmation.
    }
  }
}