import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SlicePipe } from '@angular/common';
import type { DropdownOption } from '../../../../shared/components/searchable-dropdown/searchable-dropdown.component';
import type { OrderItemRow, OrderItemAvailability } from './order-item.types';

@Component({
  selector: 'app-order-item-inventory-band',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SlicePipe],
  template: `
    <tr class="border-b border-gray-100 dark:border-line bg-emerald-50/30">
      <td [attr.colspan]="colspan()" class="px-4 py-2">
        <div class="flex flex-wrap items-end gap-3 text-xs">
          <span class="inline-flex items-center gap-1 rounded-full bg-emerald-100/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            Inventory
          </span>
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-muted">Warehouse</span>
            <select
              [ngModel]="row().warehouseId ?? ''"
              (ngModelChange)="onChange('warehouseId', $event || null)"
              [disabled]="readonly()"
              class="fueld-select-no-chevron appearance-none rounded-md border border-gray-300 dark:border-line-strong px-2 py-1 text-xs disabled:opacity-60"
            >
              <option value="">— Not tracked —</option>
              @for (w of warehouseOptions(); track w.value) {
                <option [value]="w.value">{{ w.label }}</option>
              }
            </select>
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-muted">SKU</span>
            <select
              [ngModel]="row().inventorySkuId ?? ''"
              (ngModelChange)="onChange('inventorySkuId', $event || null)"
              [disabled]="readonly() || !row().warehouseId"
              class="fueld-select-no-chevron appearance-none rounded-md border border-gray-300 dark:border-line-strong px-2 py-1 text-xs disabled:opacity-60"
            >
              <option value="">—</option>
              @for (s of inventorySkuOptions(); track s.value) {
                <option [value]="s.value">{{ s.label }}</option>
              }
            </select>
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-muted">Planned date</span>
            <input
              type="date"
              [ngModel]="formatDateInput(row().plannedInventoryAt)"
              (ngModelChange)="onChange('plannedInventoryAt', parseDateInput($event))"
              [disabled]="readonly() || !row().warehouseId"
              class="rounded-md border border-gray-300 dark:border-line-strong px-2 py-1 text-xs disabled:opacity-60"
            />
          </label>
          @if (availability(); as a) {
            @if (!a.ok) {
              <span class="ml-auto inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-400"
                [title]="a.reason ?? 'Insufficient stock'">
                Short {{ a.shortageQuantity }}
                @if (a.earliestAvailableAt) {
                  · earliest {{ a.earliestAvailableAt | slice:0:10 }}
                }
              </span>
            } @else if (row().warehouseId && row().inventorySkuId) {
              <span class="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                Available
              </span>
            }
          }
        </div>
      </td>
    </tr>
  `,
})
export class OrderItemInventoryBandComponent {
  readonly row = input.required<OrderItemRow>();
  readonly readonly = input(false);
  readonly warehouseOptions = input<DropdownOption[]>([]);
  readonly inventorySkuOptions = input<DropdownOption[]>([]);
  readonly availability = input<OrderItemAvailability | undefined>();
  readonly colspan = input(8);

  readonly fieldChange = output<{ field: string; value: unknown }>();

  protected onChange(field: string, value: unknown): void {
    this.fieldChange.emit({ field, value });
  }

  /** Format an ISO timestamp to a `YYYY-MM-DD` string (UTC day, matches the rest of the app). */
  protected formatDateInput(value: string | null | undefined): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }

  /** Convert a date input value to an ISO timestamp pinned to UTC noon (matches order ETA convention). */
  protected parseDateInput(value: string | null | undefined): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return new Date(`${trimmed}T12:00:00Z`).toISOString();
  }
}
