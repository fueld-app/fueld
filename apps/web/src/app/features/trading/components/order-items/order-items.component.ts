import {
  Component,
  ChangeDetectionStrategy,
  OnDestroy,
  OnInit,
  inject,
  input,
  output,
  signal,
  computed,
  linkedSignal,
  effect,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { ProductType, PaymentTerms } from '@fueld/types';
import { Subscription } from 'rxjs';
import {
  SearchableDropdownComponent,
  type DropdownOption,
} from '../../../../shared/components/searchable-dropdown/searchable-dropdown.component';
import { WebSocketService } from '../../../../core/websocket/websocket.service';

// ═══════════════════════════════════════════════════════════════════════
//  Order Items Grid — Desktop table / Mobile card layout
//
//  Uses linkedSignal for live profit calculation with FX conversion
// ═══════════════════════════════════════════════════════════════════════

/** Local mutable model for an order item row. */
export interface OrderItemRow {
  id: string;
  productType: string;
  supplierId: string;
  quantity: number;
  quantityMin: number | null;
  quantityMax: number | null;
  unit: string;
  costPrice: number;
  costCurrency: string;
  salesPrice: number;
  salesCurrency: string;
  profit: number;
  paymentTerms: string;
}

@Component({
  selector: 'app-order-items',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, SearchableDropdownComponent],
  template: `
    <!-- ═════════════════════════════════════════════════════════════ -->
    <!--  Add row button                                              -->
    <!-- ═════════════════════════════════════════════════════════════ -->
    <div class="mb-4 flex items-center justify-between">
      <h3 class="text-sm font-semibold text-gray-700 uppercase tracking-wider">
        Line Items
      </h3>
      @if (!readonly()) {
        <button
          (click)="addRow()"
          class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold
                 text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none
                 focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          Add Item
        </button>
      }
    </div>

    <!-- ═════════════════════════════════════════════════════════════ -->
    <!--  Desktop Table (hidden on mobile)                            -->
    <!-- ═════════════════════════════════════════════════════════════ -->
    <div class="hidden md:block overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-gray-200 bg-gray-50/80">
            <th class="px-4 py-3 text-left font-medium text-gray-600">#</th>
            <th class="px-4 py-3 text-left font-medium text-gray-600 min-w-[140px]">Product</th>
            <th class="px-4 py-3 text-left font-medium text-gray-600 min-w-[160px]">Supplier</th>
            <th class="px-4 py-3 text-right font-medium text-gray-600 min-w-[120px]">Qty</th>
            <th class="px-4 py-3 text-left font-medium text-gray-600 w-16">Unit</th>
            <th class="px-4 py-3 text-right font-medium text-gray-600 min-w-[140px]">Cost</th>
            <th class="px-4 py-3 text-right font-medium text-gray-600 min-w-[140px]">Sell</th>
            <th class="px-4 py-3 text-right font-medium text-gray-600 min-w-[120px]">Profit ({{ baseCurrency }})</th>
            @if (!readonly()) {
              <th class="px-4 py-3 w-12"></th>
            }
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          @for (row of rows(); track row.id; let i = $index) {
            <tr class="group transition-colors hover:bg-gray-50/50">
              <td class="px-4 py-3 text-gray-400 tabular-nums">{{ i + 1 }}</td>

              <!-- Product -->
              <td class="px-4 py-2">
                @if (readonly()) {
                  <span>{{ row.productType }}</span>
                } @else {
                  <app-searchable-dropdown
                    [options]="productOptions"
                    [selected]="row.productType"
                    placeholder="Product..."
                    (selectionChange)="updateField(i, 'productType', $event)"
                  />
                }
              </td>

              <!-- Supplier -->
              <td class="px-4 py-2">
                @if (readonly()) {
                  <span>{{ getSupplierLabel(row.supplierId) }}</span>
                } @else {
                  <app-searchable-dropdown
                    [options]="supplierOptions()"
                    [selected]="row.supplierId"
                    [asyncSearch]="true"
                    [loading]="supplierSearchLoading()"
                    placeholder="Supplier..."
                    [clearable]="true"
                    (searchChange)="supplierSearch.emit($event)"
                    (selectionChange)="updateField(i, 'supplierId', $event)"
                  />
                }
              </td>

              <!-- Qty -->
              <td class="px-4 py-2">
                @if (readonly()) {
                  <span class="block text-right tabular-nums">
                    @if (row.quantityMin != null && row.quantityMin !== row.quantity) {
                      {{ row.quantityMin | number:'1.0-0' }}–{{ row.quantity | number:'1.0-0' }}
                    } @else {
                      {{ row.quantity | number:'1.3-3' }}
                    }
                  </span>
                } @else {
                  <div class="flex items-center gap-1 justify-end">
                    @if (spreadEnabled().has(row.id)) {
                      <input
                        type="number" step="0.001" min="0"
                        [ngModel]="row.quantityMin ?? row.quantity"
                        (ngModelChange)="updateQuantityMin(i, $event)"
                        placeholder="Min"
                        class="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm tabular-nums
                               focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                      />
                      <span class="text-gray-400 text-xs">–</span>
                    }
                    <input
                      type="number" step="0.001" min="0"
                      [ngModel]="row.quantity"
                      (ngModelChange)="updateQuantity(i, $event)"
                      placeholder="Qty"
                      class="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm tabular-nums
                             focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                    <button
                      type="button"
                      (click)="toggleSpread(row.id, i)"
                      [class.text-brand-600]="spreadEnabled().has(row.id)"
                      [class.bg-brand-50]="spreadEnabled().has(row.id)"
                      [class.text-gray-400]="!spreadEnabled().has(row.id)"
                      class="rounded p-1 text-xs hover:bg-gray-100 transition-colors"
                      [attr.title]="spreadEnabled().has(row.id) ? 'Remove min qty' : 'Add min qty spread'"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M10.75 6.75a.75.75 0 0 0-1.5 0v2.5h-2.5a.75.75 0 0 0 0 1.5h2.5v2.5a.75.75 0 0 0 1.5 0v-2.5h2.5a.75.75 0 0 0 0-1.5h-2.5v-2.5Z" />
                        <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.536-9.146a.5.5 0 0 0-.707-.708L10 10.975 7.172 8.146a.5.5 0 1 0-.708.708L10 12.39l3.536-3.536Z" clip-rule="evenodd" />
                      </svg>
                    </button>
                  </div>
                }
              </td>

              <!-- Unit -->
              <td class="px-4 py-2">
                @if (readonly()) {
                  <span class="text-gray-500">{{ row.unit }}</span>
                } @else {
                  <select
                    [ngModel]="row.unit"
                    (ngModelChange)="updateField(i, 'unit', $event)"
                    class="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                           focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
                  >
                    @for (u of unitOptions; track u.value) {
                      <option [value]="u.value">{{ u.label }}</option>
                    }
                  </select>
                }
              </td>

              <!-- Cost -->
              <td class="px-4 py-2">
                @if (readonly()) {
                  <span class="block text-right tabular-nums">{{ row.costCurrency }} {{ row.costPrice | number:'1.2-4' }}</span>
                } @else {
                  <div class="flex items-center gap-2">
                    <input
                      type="number" step="0.01" min="0"
                      [ngModel]="row.costPrice"
                      (ngModelChange)="updateField(i, 'costPrice', $event)"
                      class="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-right text-sm tabular-nums
                             focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                    <select
                      [ngModel]="row.costCurrency"
                      (ngModelChange)="updateField(i, 'costCurrency', $event)"
                      class="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-xs text-gray-700
                             focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
                    >
                      @for (c of currencyOptions; track c.value) {
                        <option [value]="c.value">{{ c.label }}</option>
                      }
                    </select>
                  </div>
                }
              </td>

              <!-- Sell -->
              <td class="px-4 py-2">
                @if (readonly()) {
                  <span class="block text-right tabular-nums">{{ row.salesCurrency }} {{ row.salesPrice | number:'1.2-4' }}</span>
                } @else {
                  <div class="flex items-center gap-2">
                    <input
                      type="number" step="0.01" min="0"
                      [ngModel]="row.salesPrice"
                      (ngModelChange)="updateField(i, 'salesPrice', $event)"
                      class="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-right text-sm tabular-nums
                             focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                    <select
                      [ngModel]="row.salesCurrency"
                      (ngModelChange)="updateField(i, 'salesCurrency', $event)"
                      class="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-xs text-gray-700
                             focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
                    >
                      @for (c of currencyOptions; track c.value) {
                        <option [value]="c.value">{{ c.label }}</option>
                      }
                    </select>
                  </div>
                }
              </td>

              <!-- Profit (auto-calculated) -->
              <td class="px-4 py-3 text-right tabular-nums"
                [class.text-green-600]="profitForRow(row) > 0"
                [class.text-red-600]="profitForRow(row) < 0"
                [class.font-semibold]="profitForRow(row) !== 0"
              >
                {{ profitForRow(row) | number:'1.2-2' }}
              </td>

              <!-- Delete -->
              @if (!readonly()) {
                <td class="px-2 py-2">
                  <button
                    (click)="removeRow(i)"
                    class="rounded-md p-1 text-gray-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                    aria-label="Remove item"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022 1.005 11.36A2.75 2.75 0 0 0 7.763 20h4.474a2.75 2.75 0 0 0 2.744-2.689l1.005-11.36.149.022a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </td>
              }
            </tr>
          } @empty {
            <tr>
              <td [attr.colspan]="readonly() ? 8 : 9" class="px-4 py-12 text-center">
                <p class="text-sm text-gray-400">No line items yet.</p>
                @if (!readonly()) {
                  <button
                    (click)="addRow()"
                    class="mt-2 text-sm font-medium text-brand-600 hover:text-brand-700"
                  >
                    + Add your first item
                  </button>
                }
              </td>
            </tr>
          }
        </tbody>
        <!-- Totals row -->
        @if (rows().length > 0) {
          <tfoot>
            <tr class="border-t-2 border-gray-200 bg-gray-50/50 font-semibold">
              <td [attr.colspan]="3" class="px-4 py-3 text-right text-gray-600">Totals</td>
              <td class="px-4 py-3 text-right tabular-nums text-gray-900">{{ totalQty() | number:'1.3-3' }}</td>
              <td></td>
              <td class="px-4 py-3 text-right tabular-nums text-gray-600">{{ totalCost() | number:'1.2-2' }} {{ baseCurrency }}</td>
              <td class="px-4 py-3 text-right tabular-nums text-gray-600">{{ totalRevenue() | number:'1.2-2' }} {{ baseCurrency }}</td>
              <td class="px-4 py-3 text-right tabular-nums"
                [class.text-green-600]="totalProfit() > 0"
                [class.text-red-600]="totalProfit() < 0"
              >
                {{ totalProfit() | number:'1.2-2' }} {{ baseCurrency }}
              </td>
              @if (!readonly()) { <td></td> }
            </tr>
          </tfoot>
        }
      </table>
    </div>

    <!-- ═════════════════════════════════════════════════════════════ -->
    <!--  Mobile Cards (visible only on mobile)                       -->
    <!-- ═════════════════════════════════════════════════════════════ -->
    <div class="space-y-3 md:hidden">
      @for (row of rows(); track row.id; let i = $index) {
        <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <!-- Card header -->
          <div class="flex items-center justify-between mb-3">
            <span class="inline-flex items-center rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
              {{ row.productType || 'New Item' }}
            </span>
            @if (!readonly()) {
              <button
                (click)="removeRow(i)"
                class="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
                aria-label="Remove item"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
            }
          </div>

          <!-- Card fields -->
          <div class="grid grid-cols-2 gap-3">
            <!-- Product -->
            <div class="col-span-2">
              <label class="mb-1 block text-xs font-medium text-gray-500">Product</label>
              @if (readonly()) {
                <span class="text-sm">{{ row.productType }}</span>
              } @else {
                <app-searchable-dropdown
                  [options]="productOptions"
                  [selected]="row.productType"
                  placeholder="Product..."
                  (selectionChange)="updateField(i, 'productType', $event)"
                />
              }
            </div>

            <!-- Supplier -->
            <div class="col-span-2">
              <label class="mb-1 block text-xs font-medium text-gray-500">Supplier</label>
              @if (readonly()) {
                <span class="text-sm">{{ getSupplierLabel(row.supplierId) }}</span>
              } @else {
                <app-searchable-dropdown
                  [options]="supplierOptions()"
                  [selected]="row.supplierId"
                  [asyncSearch]="true"
                  [loading]="supplierSearchLoading()"
                  placeholder="Supplier..."
                  [clearable]="true"
                  (searchChange)="supplierSearch.emit($event)"
                  (selectionChange)="updateField(i, 'supplierId', $event)"
                />
              }
            </div>

            <!-- Qty -->
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500">Quantity</label>
              @if (readonly()) {
                <span class="text-sm tabular-nums">
                  @if (row.quantityMin != null && row.quantityMin !== row.quantity) {
                    {{ row.quantityMin | number:'1.0-0' }}–{{ row.quantity | number:'1.0-0' }}
                  } @else {
                    {{ row.quantity | number:'1.3-3' }}
                  }
                  {{ row.unit }}
                </span>
              } @else {
                <div class="space-y-1">
                  <div class="flex items-center gap-2">
                    <input type="number" step="0.001" min="0"
                      [ngModel]="row.quantity"
                      (ngModelChange)="updateQuantity(i, $event)"
                      placeholder="Qty"
                      class="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm tabular-nums
                             focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                    <button
                      type="button"
                      (click)="toggleSpread(row.id, i)"
                      [class.text-brand-600]="spreadEnabled().has(row.id)"
                      [class.bg-brand-50]="spreadEnabled().has(row.id)"
                      [class.text-gray-400]="!spreadEnabled().has(row.id)"
                      class="shrink-0 rounded p-1 text-xs hover:bg-gray-100 transition-colors"
                      [attr.title]="spreadEnabled().has(row.id) ? 'Remove min qty' : 'Add min qty spread'"
                    >
                      ±
                    </button>
                  </div>
                  @if (spreadEnabled().has(row.id)) {
                    <input type="number" step="0.001" min="0"
                      [ngModel]="row.quantityMin ?? row.quantity"
                      (ngModelChange)="updateQuantityMin(i, $event)"
                      placeholder="Min qty"
                      class="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm tabular-nums
                             focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  }
                </div>
              }
            </div>

            <!-- Unit -->
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500">Unit</label>
              @if (readonly()) {
                <span class="text-sm text-gray-500">{{ row.unit }}</span>
              } @else {
                <select
                  [ngModel]="row.unit"
                  (ngModelChange)="updateField(i, 'unit', $event)"
                  class="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                         focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
                >
                  @for (u of unitOptions; track u.value) {
                    <option [value]="u.value">{{ u.label }}</option>
                  }
                </select>
              }
            </div>

            <!-- Cost -->
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500">Cost</label>
              @if (readonly()) {
                <span class="text-sm tabular-nums">{{ row.costCurrency }} {{ row.costPrice | number:'1.2-4' }}</span>
              } @else {
                <div class="flex items-center gap-2">
                  <input type="number" step="0.01" min="0"
                    [ngModel]="row.costPrice"
                    (ngModelChange)="updateField(i, 'costPrice', $event)"
                    class="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm tabular-nums
                           focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                  <select
                    [ngModel]="row.costCurrency"
                    (ngModelChange)="updateField(i, 'costCurrency', $event)"
                    class="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-xs text-gray-700
                           focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
                  >
                    @for (c of currencyOptions; track c.value) {
                      <option [value]="c.value">{{ c.label }}</option>
                    }
                  </select>
                </div>
              }
            </div>

            <!-- Sell -->
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500">Sell</label>
              @if (readonly()) {
                <span class="text-sm tabular-nums">{{ row.salesCurrency }} {{ row.salesPrice | number:'1.2-4' }}</span>
              } @else {
                <div class="flex items-center gap-2">
                  <input type="number" step="0.01" min="0"
                    [ngModel]="row.salesPrice"
                    (ngModelChange)="updateField(i, 'salesPrice', $event)"
                    class="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm tabular-nums
                           focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                  <select
                    [ngModel]="row.salesCurrency"
                    (ngModelChange)="updateField(i, 'salesCurrency', $event)"
                    class="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-xs text-gray-700
                           focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
                  >
                    @for (c of currencyOptions; track c.value) {
                      <option [value]="c.value">{{ c.label }}</option>
                    }
                  </select>
                </div>
              }
            </div>

            <!-- Profit -->
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500">Profit ({{ baseCurrency }})</label>
              <span
                class="text-sm font-semibold tabular-nums"
                [class.text-green-600]="profitForRow(row) > 0"
                [class.text-red-600]="profitForRow(row) < 0"
              >
                {{ profitForRow(row) | number:'1.2-2' }}
              </span>
            </div>
          </div>
        </div>
      } @empty {
        <div class="rounded-xl border-2 border-dashed border-gray-300 bg-white p-8 text-center">
          <p class="text-sm text-gray-400">No line items yet.</p>
          @if (!readonly()) {
            <button (click)="addRow()" class="mt-2 text-sm font-medium text-brand-600 hover:text-brand-700">
              + Add your first item
            </button>
          }
        </div>
      }

      <!-- Mobile totals bar -->
      @if (rows().length > 0) {
        <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div class="flex items-center justify-between text-sm">
            <span class="font-medium text-gray-600">Total Profit</span>
            <span
              class="text-lg font-bold tabular-nums"
              [class.text-green-600]="totalProfit() > 0"
              [class.text-red-600]="totalProfit() < 0"
            >
              {{ totalProfit() | number:'1.2-2' }} {{ baseCurrency }}
            </span>
          </div>
          <div class="mt-1 flex items-center justify-between text-xs text-gray-400">
            <span>{{ rows().length }} item(s) · {{ totalQty() | number:'1.0-0' }} MT</span>
            <span>Rev {{ totalRevenue() | number:'1.2-2' }} {{ baseCurrency }}</span>
          </div>
        </div>
      }
    </div>
  `,
})
export class OrderItemsComponent implements OnInit, OnDestroy {
  /** Items passed in from the order detail page. */
  readonly items = input<OrderItemRow[]>([]);
  readonly suppliers = input<DropdownOption[]>([]);
  readonly readonly = input(false);
  readonly currency = input('USD');
  readonly supplierSearchLoading = input(false);
  readonly itemsChange = output<OrderItemRow[]>();
  readonly supplierSearch = output<string>();

  private readonly wsService = inject(WebSocketService);
  private fxSub: Subscription | null = null;
  readonly baseCurrency = 'USD';
  private readonly fxRates = signal<Record<string, number>>({ USD: 1 });

  readonly currencyOptions: DropdownOption[] = [
    { value: 'USD', label: 'USD' },
    { value: 'EUR', label: 'EUR' },
    { value: 'DKK', label: 'DKK' },
    { value: 'AED', label: 'AED' },
  ];

  /** Internal mutable signal, linked to the input. */
  readonly rows = linkedSignal(() =>
    this.items().map((item) => ({
      ...item,
      costCurrency: item.costCurrency || this.currency(),
      salesCurrency: item.salesCurrency || this.currency(),
      profit: this.profitForRow(item),
    })),
  );

  /** Track which row IDs have the min-qty spread enabled */
  readonly spreadEnabled = signal<Set<string>>(new Set());
  private spreadInitialized = false;

  ngOnInit(): void {
    this.fxSub = this.wsService.onRaw('prices').subscribe((msg) => {
      const data = msg.data as { fxRates?: { base?: string; rates?: Record<string, number> } } | undefined;
      const rates = data?.fxRates?.rates;
      if (!rates) return;
      const base = (data?.fxRates?.base ?? this.baseCurrency).toUpperCase();
      this.fxRates.set({ ...rates, [base]: 1 });
    });
  }

  ngOnDestroy(): void {
    this.fxSub?.unsubscribe();
  }

  constructor() {
    // Initialize spreadEnabled once from loaded items that already have quantityMin
    effect(() => {
      const items = this.items();
      if (this.spreadInitialized) return;
      const spreads = new Set<string>();
      for (const item of items) {
        if (item.quantityMin != null) spreads.add(item.id);
      }
      if (items.length > 0) {
        this.spreadInitialized = true;
        this.spreadEnabled.set(spreads);
      }
    });
  }

  // ─── Dropdown options ────────────────────────────────────────────

  readonly productOptions: DropdownOption[] = Object.values(ProductType).map((v) => ({
    value: v,
    label: v,
  }));

  readonly unitOptions: DropdownOption[] = [
    { value: 'MT', label: 'MT' },
    { value: 'CBM', label: 'CBM' },
    { value: 'LT', label: 'LT' },
    { value: 'BBL', label: 'BBL' },
    { value: 'GAL', label: 'GAL' },
    { value: 'KG', label: 'KG' },
  ];

  readonly supplierOptions = computed(() => this.suppliers());

  // ─── Computed totals ─────────────────────────────────────────────

  readonly totalQty = computed(() =>
    this.rows().reduce((s, r) => s + (r.quantity || 0), 0),
  );

  readonly totalCost = computed(() =>
    this.rows().reduce((s, r) => s + this.computeCostBase(r), 0),
  );

  readonly totalRevenue = computed(() =>
    this.rows().reduce((s, r) => s + this.computeRevenueBase(r), 0),
  );

  readonly totalProfit = computed(() =>
    this.rows().reduce((s, r) => s + this.profitForRow(r), 0),
  );

  // ─── Actions ─────────────────────────────────────────────────────

  getSupplierLabel(supplierId: string): string {
    return this.supplierOptions().find((o) => o.value === supplierId)?.label ?? (supplierId || '—');
  }

  addRow(): void {
    const newRow: OrderItemRow = {
      id: crypto.randomUUID(),
      productType: '',
      supplierId: '',
      quantity: 0,
      quantityMin: null,
      quantityMax: null,
      unit: 'MT',
      costPrice: 0,
      costCurrency: this.currency(),
      salesPrice: 0,
      salesCurrency: this.currency(),
      profit: 0,
      paymentTerms: '',
    };
    this.rows.update((prev) => [...prev, newRow]);
    this.emitChange();
  }

  removeRow(index: number): void {
    this.rows.update((prev) => prev.filter((_, i) => i !== index));
    this.emitChange();
  }

  updateField(index: number, field: keyof OrderItemRow, value: unknown): void {
    this.rows.update((prev) => {
      const updated = [...prev];
      const row = { ...updated[index]! };

      (row as Record<string, unknown>)[field] = value;

      // Auto-recalculate profit using main quantity
      row.profit = this.profitForRow(row);
      updated[index] = row;
      return updated;
    });
    this.emitChange();
  }

  /** Update the main quantity (used for calculations/invoicing) */
  updateQuantity(index: number, value: number): void {
    this.rows.update((prev) => {
      const updated = [...prev];
      const row = { ...updated[index]! };
      row.quantity = value;
      // If spread is active, ensure min doesn't exceed qty
      if (row.quantityMin !== null && row.quantityMin > value) {
        row.quantityMin = value;
      }
      row.profit = this.profitForRow(row);
      updated[index] = row;
      return updated;
    });
    this.emitChange();
  }

  updateQuantityMin(index: number, value: number): void {
    this.rows.update((prev) => {
      const updated = [...prev];
      const row = { ...updated[index]! };
      row.quantityMin = value;
      // If min exceeds qty, bump qty up
      if (value > row.quantity) {
        row.quantity = value;
      }
      // Profit always uses main qty
      row.profit = this.profitForRow(row);
      updated[index] = row;
      return updated;
    });
    this.emitChange();
  }

  /** Toggle the min-qty spread for a row */
  toggleSpread(rowId: string, index: number): void {
    const wasEnabled = this.spreadEnabled().has(rowId);
    const next = new Set(this.spreadEnabled());
    if (wasEnabled) {
      next.delete(rowId);
    } else {
      next.add(rowId);
    }
    this.spreadEnabled.set(next);

    // Clear quantityMin when disabling spread
    if (wasEnabled) {
      this.rows.update((rows) => {
        const updated = [...rows];
        updated[index] = { ...updated[index]!, quantityMin: null };
        return updated;
      });
    }
    this.emitChange();
  }

  private emitChange(): void {
    this.itemsChange.emit(this.rows());
  }

  private getFxRate(currency: string): number {
    const code = (currency || this.baseCurrency).toUpperCase();
    if (code === this.baseCurrency) return 1;
    return this.fxRates()[code] ?? 1;
  }

  private computeCostBase(row: OrderItemRow): number {
    const qty = row.quantity || 0;
    return (row.costPrice || 0) * qty * this.getFxRate(row.costCurrency);
  }

  private computeRevenueBase(row: OrderItemRow): number {
    const qty = row.quantity || 0;
    return (row.salesPrice || 0) * qty * this.getFxRate(row.salesCurrency);
  }

  profitForRow(row: OrderItemRow): number {
    return this.computeRevenueBase(row) - this.computeCostBase(row);
  }
}
