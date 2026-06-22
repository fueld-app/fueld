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

import { Subscription } from 'rxjs';
import {
  SearchableDropdownComponent,
  type DropdownOption,
} from '../../../../shared/components/searchable-dropdown/searchable-dropdown.component';
import { WebSocketService } from '../../../../core/websocket/websocket.service';
import { OrderItemPricingComponent } from './order-item-pricing.component';
import { OrderItemInventoryBandComponent } from './order-item-inventory-band.component';

import {
  PricingModel,
  type PlattsSuggestionsResponseDto,
  ProductType,
} from '@fueld/types';
import type {
  OrderItemRow,
  OrderItemAvailability,
  OrderItemsEconomics,
} from './order-item.types';

@Component({
  selector: 'app-order-items',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, SearchableDropdownComponent, OrderItemPricingComponent, OrderItemInventoryBandComponent],
  template: `
    <div class="overflow-hidden rounded-2xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm">
      <!-- ═══════════════════════════════════════════════════════════ -->
      <!--  Shared header                                             -->
      <!-- ═══════════════════════════════════════════════════════════ -->
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 dark:border-line px-4 py-3">
        <div>
          <h3 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-700 dark:text-ink-dim">Line Items</h3>
          <p class="mt-1 text-xs text-gray-500 dark:text-muted">{{ rows().length }} item{{ rows().length === 1 ? '' : 's' }} in this {{ readonly() ? 'document' : 'deal' }}</p>
        </div>
        @if (!readonly()) {
          <button
            (click)="addRow()"
            class="inline-flex items-center gap-2 rounded-full border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-4 py-2 text-sm font-semibold text-gray-700 dark:text-ink-dim shadow-sm transition-colors hover:border-brand-300 hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
            </svg>
            New line item
          </button>
        }
      </div>

    <!-- ═════════════════════════════════════════════════════════════ -->
    <!--  Desktop Table (hidden on mobile)                            -->
    <!-- ═════════════════════════════════════════════════════════════ -->
    <div class="hidden overflow-x-auto md:block">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-gray-200 dark:border-line bg-gray-50/80 dark:bg-surface-2">
            <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim min-w-[140px]">Product</th>
            @if (showSupplierColumn()) {
              <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim min-w-[160px]">Supplier</th>
            }
            <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim min-w-[180px]">Description</th>
            <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim min-w-[120px]">Qty</th>
            @if (allowDeliveredEdit()) {
              <th class="px-4 py-3 text-right font-medium text-gray-600 dark:text-ink-dim min-w-[110px]">Del. Qty</th>
            }
            @if (canSeePrices()) {
              <th class="px-4 py-3 text-right font-medium text-gray-600 dark:text-ink-dim min-w-[180px]">Cost</th>
              <th class="px-4 py-3 text-right font-medium text-gray-600 dark:text-ink-dim min-w-[180px]">Sell</th>
              <th class="px-4 py-3 text-right font-medium text-gray-600 dark:text-ink-dim min-w-[120px]">Gross ({{ baseCurrency() }})</th>
              <th class="px-4 py-3 text-right font-medium text-gray-600 dark:text-ink-dim min-w-[120px]">Financing</th>
              <th class="px-4 py-3 text-right font-medium text-gray-600 dark:text-ink-dim min-w-[120px]">Net</th>
              <th class="px-4 py-3 text-right font-medium text-gray-600 dark:text-ink-dim min-w-[100px]">Tax</th>
            }
            @if (!readonly()) {
              <th class="w-0 p-0"></th>
            }
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100 dark:divide-line">
          @for (row of rows(); track row.id; let i = $index) {
            <tr class="group relative transition-colors hover:bg-gray-50/50 align-top dark:hover:bg-surface-tint">
              <!-- Product -->
              <td class="px-4 py-2">
                @if (readonly()) {
                  <span>{{ row.productType }}</span>
                } @else {
                  <app-searchable-dropdown
                    [options]="productOptions()"
                    [selected]="row.productType"
                    placeholder="Product..."
                    (selectionChange)="updateField(i, 'productType', $event)"
                  />
                }
              </td>

              @if (showSupplierColumn()) {
                <td class="px-4 py-2">
                  @if (readonly()) {
                    <span class="text-sm text-gray-700 dark:text-ink-dim">{{ supplierLabel(row.orderSupplierId) }}</span>
                  } @else {
                    <select
                      [ngModel]="row.orderSupplierId ?? ''"
                      (ngModelChange)="updateField(i, 'orderSupplierId', $event || null)"
                      class="fueld-select-no-chevron w-full appearance-none rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none bg-white dark:bg-surface"
                    >
                      <option value="">Select supplier</option>
                      @for (supplier of supplierOptions(); track supplier.value) {
                        <option [value]="supplier.value">{{ supplier.label }}</option>
                      }
                    </select>
                  }
                </td>
              }

              <!-- Description -->
              <td class="px-4 py-2">
                @if (readonly()) {
                  <span class="text-sm text-gray-700 dark:text-ink-dim">{{ row.description || '-' }}</span>
                } @else {
                  <input
                    type="text"
                    [ngModel]="row.description"
                    (ngModelChange)="updateField(i, 'description', $event)"
                    placeholder="e.g. local specs"
                    class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  />
                }
              </td>

              <!-- Qty -->
              <td class="px-4 py-2">
                @if (readonly()) {
                  <span class="block text-right tabular-nums">
                    @if (row.quantityMin != null && row.quantityMin !== row.quantity) {
                      {{ row.quantityMin | number:'1.0-3' }} – {{ row.quantity | number:'1.0-3' }}
                    } @else {
                      {{ row.quantity | number:'1.0-3' }}
                    }
                    {{ row.unit }}
                  </span>
                } @else {
                  <div class="flex items-center gap-1">
                    @if (spreadEnabled().has(row.id)) {
                      <input
                        type="number" step="0.001" min="0"
                        [ngModel]="row.quantityMin"
                        (ngModelChange)="updateQuantityMin(i, $event)"
                        placeholder="Min"
                        class="w-20 rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-right text-sm tabular-nums focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                      />
                      <span class="text-gray-400 dark:text-muted text-xs">–</span>
                    }
                    <input
                      type="number" step="0.001" min="0"
                      [ngModel]="row.quantity"
                      (ngModelChange)="updateQuantity(i, $event)"
                      [attr.min]="spreadEnabled().has(row.id) && row.quantityMin !== null ? row.quantityMin : 0"
                      placeholder="Qty"
                      class="w-20 rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-right text-sm tabular-nums focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    />
                    <span class="order-item-inline-select-wrap">
                      <select
                        [ngModel]="row.unit"
                        (ngModelChange)="updateField(i, 'unit', $event)"
                        class="order-item-inline-select cursor-pointer appearance-none bg-transparent border-0 p-0 text-xs text-gray-500 dark:text-muted hover:text-brand-600 focus:outline-none"
                      >
                        @for (u of unitOptions(); track u.value) {
                          <option [value]="u.value">{{ u.label }}</option>
                        }
                      </select>
                      <svg
                        class="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400 dark:text-muted"
                        xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
                      >
                        <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                      </svg>
                    </span>
                    <button
                      type="button"
                      (click)="toggleSpread(row.id, i)"
                      [class.text-brand-600]="spreadEnabled().has(row.id)"
                      [class.bg-brand-50]="spreadEnabled().has(row.id)"
                      [class.text-gray-400]="!spreadEnabled().has(row.id)"
                      class="rounded p-1 text-xs hover:bg-gray-100 dark:hover:bg-surface-tint-strong transition-colors"
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

              <!-- Delivered Qty -->
              @if (allowDeliveredEdit()) {
                <td class="px-4 py-2">
                  <input
                    type="number" step="0.001" min="0"
                    [ngModel]="row.deliveredQuantity ?? row.quantity"
                    (ngModelChange)="updateField(i, 'deliveredQuantity', parseDecimalInput($event))"
                    class="w-24 rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-right text-sm tabular-nums focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  />
                </td>
              }

              @if (canSeePrices()) {
              <!-- Cost (price + currency) -->
              <td class="px-4 py-2 align-top">
                <app-order-item-pricing
                  [row]="row"
                  side="cost"
                  [readonly]="readonly()"
                  [formulaPricingEnabled]="formulaPricingEnabled()"
                  [priceRefOptions]="priceRefOptions()"
                  [currencyOptions]="currencyOptions()"
                  [unitOptions]="unitOptions()"
                  [plattsMatches]="plattsMatches(row.id)"
                  [plattsEntryId]="row.costPlattsEntryId"
                  [decimalPrecision]="decimalPrecisionInput()"
                  (fieldChange)="onPricingFieldChange(i, 'cost', $event)"
                  (plattsSelect)="selectPlattsMatch(i, 'cost', $event)"
                />
              </td>

              <!-- Sell (price + currency + unit) -->
              <td class="px-4 py-2 align-top">
                <app-order-item-pricing
                  [row]="row"
                  side="sales"
                  [readonly]="readonly()"
                  [formulaPricingEnabled]="formulaPricingEnabled()"
                  [priceRefOptions]="priceRefOptions()"
                  [currencyOptions]="currencyOptions()"
                  [unitOptions]="unitOptions()"
                  [plattsMatches]="plattsMatches(row.id)"
                  [plattsEntryId]="row.salesPlattsEntryId"
                  [decimalPrecision]="decimalPrecisionInput()"
                  (fieldChange)="onPricingFieldChange(i, 'sales', $event)"
                  (plattsSelect)="selectPlattsMatch(i, 'sales', $event)"
                />
              </td>

              <!-- Gross Profit (auto-calculated) -->
              <td class="px-4 py-3 pt-4 text-right tabular-nums"
                [class.text-green-600]="!isFormulaUnfinalized(row) && profitForRow(row) > 0"
                [class.text-red-600]="!isFormulaUnfinalized(row) && profitForRow(row) < 0"
                [class.font-semibold]="!isFormulaUnfinalized(row) && profitForRow(row) !== 0"
              >
                @if (isFormulaUnfinalized(row)) {
                  <span class="italic text-amber-600 dark:text-amber-400 text-xs">TBD</span>
                } @else {
                  {{ profitForRow(row) | number:'1.2-2' }}
                }
              </td>

              <td class="px-4 py-3 pt-4 text-right tabular-nums text-amber-700 dark:text-amber-400">
                @if (isFormulaUnfinalized(row)) {
                  <span class="italic text-xs">TBD</span>
                } @else {
                  {{ financingCostForRow(row) | number:'1.2-2' }}
                }
              </td>

              <td class="px-4 py-3 pt-4 text-right tabular-nums"
                [class.text-green-600]="!isFormulaUnfinalized(row) && netProfitForRow(row) > 0"
                [class.text-red-600]="!isFormulaUnfinalized(row) && netProfitForRow(row) < 0"
                [class.font-semibold]="!isFormulaUnfinalized(row) && netProfitForRow(row) !== 0"
              >
                @if (isFormulaUnfinalized(row)) {
                  <span class="italic text-amber-600 dark:text-amber-400 text-xs">TBD</span>
                } @else {
                  {{ netProfitForRow(row) | number:'1.2-2' }}
                }
              </td>

              <!-- Tax -->
              <td class="px-4 py-3 pt-4 text-right tabular-nums"
                [class.text-green-600]="!isFormulaUnfinalized(row) && row.taxAmount != null && row.taxAmount > 0"
                [class.font-semibold]="!isFormulaUnfinalized(row) && row.taxAmount != null && row.taxAmount > 0"
              >
                @if (isFormulaUnfinalized(row)) {
                  <span class="italic text-amber-600 dark:text-amber-400 text-xs">TBD</span>
                } @else if (readonly()) {
                  @if (row.taxRate != null) {
                    <span class="text-xs text-gray-500 dark:text-muted">{{ row.taxRate | number:'1.2-2' }}%</span>
                    <div>{{ row.taxAmount ?? 0 | number:'1.2-2' }}</div>
                  } @else {
                    <span class="text-gray-400 dark:text-muted text-xs">—</span>
                  }
                } @else {
                  <select
                    [ngModel]="row.taxRate ?? ''"
                    (ngModelChange)="onTaxRateChange(i, $event)"
                    class="order-item-inline-select cursor-pointer appearance-none bg-transparent border-0 p-0 text-xs text-gray-700 dark:text-ink-dim hover:text-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600/20 rounded"
                  >
                    <option value="">None</option>
                    @for (rate of taxRatesInput(); track rate.id) {
                      <option [value]="rate.rate">{{ rate.name }} ({{ rate.rate | number:'1.2-2' }}%)</option>
                    }
                  </select>
                  @if (row.taxRate != null) {
                    <div class="text-xs text-gray-500 dark:text-muted">{{ row.taxAmount ?? 0 | number:'1.2-2' }}</div>
                  }
                }
              </td>
              }

              <!-- Delete -->
              @if (!readonly()) {
                <td class="relative w-0 p-0">
                  <button
                    (click)="removeRow(i)"
                    class="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-300 dark:text-muted opacity-0 transition-all hover:bg-red-50 dark:hover:bg-red-500/15 hover:text-red-500 group-hover:opacity-100"
                    aria-label="Remove item"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022 1.005 11.36A2.75 2.75 0 0 0 7.763 20h4.474a2.75 2.75 0 0 0 2.744-2.689l1.005-11.36.149.022a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </td>
              }
            </tr>

            <!-- Inventory band — only when warehouses exist for this order. -->
            @if (warehouseOptionsInput().length > 0) {
              <app-order-item-inventory-band
                [row]="row"
                [readonly]="readonly()"
                [warehouseOptions]="warehouseOptionsInput()"
                [inventorySkuOptions]="inventorySkuOptionsInput()"
                [availability]="availabilityByRowId()[row.id]"
                [colspan]="(readonly() ? 4 : 5) + (showSupplierColumn() ? 1 : 0) + (allowDeliveredEdit() ? 1 : 0) + (canSeePrices() ? 5 : 0)"
                (fieldChange)="onInventoryFieldChange(i, $event)"
              />
            }
          } @empty {
            <tr>
              <td [attr.colspan]="(readonly() ? 4 : 5) + (showSupplierColumn() ? 1 : 0) + (allowDeliveredEdit() ? 1 : 0) + (canSeePrices() ? 5 : 0)" class="px-4 py-12 text-center">
                <p class="text-sm text-gray-400 dark:text-muted">No line items yet.</p>
                @if (!readonly()) {
                  <button
                    (click)="addRow()"
                    class="mt-2 text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700"
                  >
                    + Add your first item
                  </button>
                }
              </td>
            </tr>
          }
        </tbody>
        <!-- Totals row (hidden for LIGHT users — no financial numbers) -->
        @if (rows().length > 0 && canSeePrices()) {
          <tfoot>
            <tr class="border-t-2 border-gray-200 dark:border-line bg-gray-50/50 font-semibold dark:bg-surface-2">
              <td class="px-4 py-3 text-right text-gray-600 dark:text-ink-dim">Totals</td>
              <td></td>
              <td></td>
              @if (allowDeliveredEdit()) {
                <td></td>
              }
              <td class="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-ink-dim">{{ totalCost() | number:'1.2-2' }} {{ baseCurrency() }}</td>
              <td class="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-ink-dim">{{ totalRevenue() | number:'1.2-2' }} {{ baseCurrency() }}</td>
              <td class="px-4 py-3 text-right tabular-nums"
                [class.text-green-600]="totalProfit() > 0"
                [class.text-red-600]="totalProfit() < 0"
              >
                {{ totalProfit() | number:'1.2-2' }} {{ baseCurrency() }}
              </td>
              <td class="px-4 py-3 text-right tabular-nums text-amber-700 dark:text-amber-400">
                {{ totalFinancingCost() | number:'1.2-2' }} {{ baseCurrency() }}
              </td>
              <td class="px-4 py-3 text-right tabular-nums"
                [class.text-green-600]="totalNetProfit() > 0"
                [class.text-red-600]="totalNetProfit() < 0"
              >
                {{ totalNetProfit() | number:'1.2-2' }} {{ baseCurrency() }}
              </td>
              @if (!readonly()) { <td class="w-0 p-0"></td> }
            </tr>
          </tfoot>
        }
      </table>
    </div>

    <!-- ═════════════════════════════════════════════════════════════ -->
    <!--  Mobile Cards (visible only on mobile)                       -->
    <!-- ═════════════════════════════════════════════════════════════ -->
    <div class="space-y-3 bg-gray-50/40 p-4 md:hidden dark:bg-surface-2">
      @for (row of rows(); track row.id; let i = $index) {
        <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-4 shadow-sm">
          <!-- Card header -->
          <div class="flex items-center justify-between mb-3">
            <span class="inline-flex items-center rounded-md bg-brand-50 dark:bg-brand-700/15 px-2 py-0.5 text-xs font-semibold text-brand-700 dark:text-brand-400">
              {{ row.productType || 'New Item' }}
            </span>
            @if (!readonly()) {
              <button
                (click)="removeRow(i)"
                class="rounded-md p-1 text-gray-400 dark:text-muted hover:bg-red-50 dark:hover:bg-red-500/15 hover:text-red-500"
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
              <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">Product</label>
              @if (readonly()) {
                <span class="text-sm">{{ row.productType }}</span>
              } @else {
                <app-searchable-dropdown
                  [options]="productOptions()"
                  [selected]="row.productType"
                  placeholder="Product..."
                  (selectionChange)="updateField(i, 'productType', $event)"
                />
              }
            </div>

            @if (showSupplierColumn()) {
              <div class="col-span-2">
                <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">Supplier</label>
                @if (readonly()) {
                  <span class="text-sm text-gray-700 dark:text-ink-dim">{{ supplierLabel(row.orderSupplierId) }}</span>
                } @else {
                  <select
                    [ngModel]="row.orderSupplierId ?? ''"
                    (ngModelChange)="updateField(i, 'orderSupplierId', $event || null)"
                    class="fueld-select-no-chevron w-full appearance-none rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none bg-white dark:bg-surface"
                  >
                    <option value="">Select supplier</option>
                    @for (supplier of supplierOptions(); track supplier.value) {
                      <option [value]="supplier.value">{{ supplier.label }}</option>
                    }
                  </select>
                }
              </div>
            }

            <!-- Description -->
            <div class="col-span-2">
              <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">Description</label>
              @if (readonly()) {
                <span class="text-sm text-gray-700 dark:text-ink-dim">{{ row.description || '-' }}</span>
              } @else {
                <input
                  type="text"
                  [ngModel]="row.description"
                  (ngModelChange)="updateField(i, 'description', $event)"
                  placeholder="e.g. local specs"
                  class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-1.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                />
              }
            </div>

            <!-- Qty -->
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">Quantity</label>
              @if (readonly()) {
                <span class="text-sm tabular-nums">
                  @if (row.quantityMin != null && row.quantityMin !== row.quantity) {
                    {{ row.quantityMin | number:'1.0-3' }} – {{ row.quantity | number:'1.0-3' }}
                  } @else {
                    {{ row.quantity | number:'1.0-3' }}
                  }
                  {{ row.unit }}
                </span>
              } @else {
                <div class="space-y-1">
                  @if (spreadEnabled().has(row.id)) {
                    <input type="number" step="0.001" min="0"
                      [ngModel]="row.quantityMin"
                      (ngModelChange)="updateQuantityMin(i, $event)"
                      placeholder="Min qty"
                      class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-1.5 text-sm tabular-nums focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    />
                  }
                  <div class="flex items-center gap-2">
                    <input type="number" step="0.001" min="0"
                      [ngModel]="row.quantity"
                      (ngModelChange)="updateQuantity(i, $event)"
                      [attr.min]="spreadEnabled().has(row.id) && row.quantityMin !== null ? row.quantityMin : 0"
                      placeholder="Qty"
                      class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-1.5 text-sm tabular-nums focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    />
                    <button
                      type="button"
                      (click)="toggleSpread(row.id, i)"
                      [class.text-brand-600]="spreadEnabled().has(row.id)"
                      [class.bg-brand-50]="spreadEnabled().has(row.id)"
                      [class.text-gray-400]="!spreadEnabled().has(row.id)"
                      class="shrink-0 rounded p-1 text-xs hover:bg-gray-100 dark:hover:bg-surface-tint-strong transition-colors"
                      [attr.title]="spreadEnabled().has(row.id) ? 'Remove min qty' : 'Add min qty spread'"
                    >
                      ±
                    </button>
                  </div>
                </div>
              }
            </div>

            <!-- Unit (base qty unit) -->
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">Unit</label>
              @if (readonly()) {
                <span class="text-sm text-gray-500 dark:text-muted">{{ row.unit }}</span>
              } @else {
                <select
                  [ngModel]="row.unit"
                  (ngModelChange)="updateField(i, 'unit', $event)"
                  class="fueld-select-no-chevron w-full appearance-none rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none bg-white dark:bg-surface"
                >
                  @for (u of unitOptions(); track u.value) {
                    <option [value]="u.value">{{ u.label }}</option>
                  }
                </select>
              }
            </div>

            <!-- Cost Unit -->
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">Cost Unit</label>
              @if (readonly()) {
                <span class="text-sm text-gray-500 dark:text-muted">{{ row.costUnit }}</span>
              } @else {
                <select
                  [ngModel]="row.costUnit"
                  (ngModelChange)="updateField(i, 'costUnit', $event)"
                  class="fueld-select-no-chevron w-full appearance-none rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none bg-white dark:bg-surface"
                >
                  @for (u of unitOptions(); track u.value) {
                    <option [value]="u.value">{{ u.label }}</option>
                  }
                </select>
              }
            </div>

            <!-- Sales Unit -->
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">Sales Unit</label>
              @if (readonly()) {
                <span class="text-sm text-gray-500 dark:text-muted">{{ row.salesUnit }}</span>
              } @else {
                <select
                  [ngModel]="row.salesUnit"
                  (ngModelChange)="updateField(i, 'salesUnit', $event)"
                  class="fueld-select-no-chevron w-full appearance-none rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none bg-white dark:bg-surface"
                >
                  @for (u of unitOptions(); track u.value) {
                    <option [value]="u.value">{{ u.label }}</option>
                  }
                </select>
              }
            </div>

            @if (canSeePrices()) {
            <!-- Cost -->
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">Cost</label>
              <app-order-item-pricing
                [row]="row"
                side="cost"
                [readonly]="readonly()"
                [formulaPricingEnabled]="formulaPricingEnabled()"
                [priceRefOptions]="priceRefOptions()"
                [currencyOptions]="currencyOptions()"
                [unitOptions]="unitOptions()"
                [plattsMatches]="plattsMatches(row.id)"
                [plattsEntryId]="row.costPlattsEntryId"
                [decimalPrecision]="decimalPrecisionInput()"
                (fieldChange)="onPricingFieldChange(i, 'cost', $event)"
                (plattsSelect)="selectPlattsMatch(i, 'cost', $event)"
              />
            </div>

            <!-- Sell -->
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">Sell</label>
              <app-order-item-pricing
                [row]="row"
                side="sales"
                [readonly]="readonly()"
                [formulaPricingEnabled]="formulaPricingEnabled()"
                [priceRefOptions]="priceRefOptions()"
                [currencyOptions]="currencyOptions()"
                [unitOptions]="unitOptions()"
                [plattsMatches]="plattsMatches(row.id)"
                [plattsEntryId]="row.salesPlattsEntryId"
                [decimalPrecision]="decimalPrecisionInput()"
                (fieldChange)="onPricingFieldChange(i, 'sales', $event)"
                (plattsSelect)="selectPlattsMatch(i, 'sales', $event)"
              />
            </div>

            <!-- Gross Profit -->
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">Gross Profit ({{ baseCurrency() }})</label>
              @if (isFormulaUnfinalized(row)) {
                <span class="text-xs italic text-amber-600 dark:text-amber-400">TBD</span>
              } @else {
                <span
                  class="text-sm font-semibold tabular-nums"
                  [class.text-green-600]="profitForRow(row) > 0"
                  [class.text-red-600]="profitForRow(row) < 0"
                >
                  {{ profitForRow(row) | number:'1.2-2' }}
                </span>
              }
            </div>

            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">Financing</label>
              @if (isFormulaUnfinalized(row)) {
                <span class="text-xs italic text-amber-700 dark:text-amber-400">TBD</span>
              } @else {
                <span class="text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                  {{ financingCostForRow(row) | number:'1.2-2' }}
                </span>
              }
            </div>

            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">Net Profit ({{ baseCurrency() }})</label>
              @if (isFormulaUnfinalized(row)) {
                <span class="text-xs italic text-amber-600 dark:text-amber-400">TBD</span>
              } @else {
                <span
                  class="text-sm font-semibold tabular-nums"
                  [class.text-green-600]="netProfitForRow(row) > 0"
                  [class.text-red-600]="netProfitForRow(row) < 0"
                >
                  {{ netProfitForRow(row) | number:'1.2-2' }}
                </span>
              }
            </div>
            }

            <!-- Tax (mobile) -->
            @if (canSeePrices()) {
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">Tax</label>
              @if (isFormulaUnfinalized(row)) {
                <span class="text-xs italic text-amber-600 dark:text-amber-400">TBD</span>
              } @else if (readonly()) {
                @if (row.taxRate != null) {
                  <span class="text-xs text-gray-500 dark:text-muted">{{ row.taxRate | number:'1.2-2' }}%</span>
                  <span class="block text-sm font-medium tabular-nums">{{ row.taxAmount ?? 0 | number:'1.2-2' }}</span>
                } @else {
                  <span class="text-gray-400 dark:text-muted text-xs">—</span>
                }
              } @else {
                <select
                  [ngModel]="row.taxRate ?? ''"
                  (ngModelChange)="onTaxRateChange(i, $event)"
                  class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-1.5 text-sm bg-white dark:bg-surface focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                >
                  <option value="">None</option>
                  @for (rate of taxRatesInput(); track rate.id) {
                    <option [value]="rate.rate">{{ rate.name }} ({{ rate.rate | number:'1.2-2' }}%)</option>
                  }
                </select>
                @if (row.taxRate != null) {
                  <span class="block text-xs text-gray-500 dark:text-muted mt-1">{{ row.taxAmount ?? 0 | number:'1.2-2' }} {{ baseCurrency() }}</span>
                }
              }
            </div>
            }

            <!-- Delivered Qty (mobile) -->
            @if (allowDeliveredEdit()) {
              <div>
                <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">Delivered Qty</label>
                <input type="number" step="0.001" min="0"
                  [ngModel]="row.deliveredQuantity ?? row.quantity"
                  (ngModelChange)="updateField(i, 'deliveredQuantity', parseDecimalInput($event))"
                  class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-1.5 text-sm tabular-nums focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                />
              </div>
            }

          </div>
        </div>
      } @empty {
        <div class="rounded-xl border-2 border-dashed border-gray-300 dark:border-line-strong bg-white dark:bg-surface p-8 text-center">
          <p class="text-sm text-gray-400 dark:text-muted">No line items yet.</p>
          @if (!readonly()) {
            <button (click)="addRow()" class="mt-2 text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700">
              + Add your first item
            </button>
          }
        </div>
      }

      <!-- Mobile totals bar -->
      @if (rows().length > 0 && canSeePrices()) {
        <div class="rounded-xl border border-gray-200 dark:border-line bg-gray-50 dark:bg-bg-2 p-4">
          <div class="flex items-center justify-between text-sm">
            <span class="font-medium text-gray-600 dark:text-ink-dim">Gross Profit</span>
            <span
              class="text-lg font-bold tabular-nums"
              [class.text-green-600]="totalProfit() > 0"
              [class.text-red-600]="totalProfit() < 0"
            >
              {{ totalProfit() | number:'1.2-2' }} {{ baseCurrency() }}
            </span>
          </div>
          <div class="mt-2 flex items-center justify-between text-sm text-amber-700 dark:text-amber-400">
            <span class="font-medium">Financing Cost</span>
            <span class="font-semibold tabular-nums">{{ totalFinancingCost() | number:'1.2-2' }} {{ baseCurrency() }}</span>
          </div>
          <div class="mt-2 flex items-center justify-between text-sm">
            <span class="font-medium text-gray-600 dark:text-ink-dim">Net Profit</span>
            <span
              class="text-lg font-bold tabular-nums"
              [class.text-green-600]="totalNetProfit() > 0"
              [class.text-red-600]="totalNetProfit() < 0"
            >
              {{ totalNetProfit() | number:'1.2-2' }} {{ baseCurrency() }}
            </span>
          </div>
          <div class="mt-2 flex items-center justify-between text-xs text-gray-500 dark:text-muted">
            <span>Financing / MT</span>
            <span class="tabular-nums">{{ (financingCostPerMt() ?? 0) | number:'1.2-2' }} {{ baseCurrency() }}</span>
          </div>
          <div class="mt-1 flex items-center justify-between text-xs text-gray-500 dark:text-muted">
            <span>Net Margin</span>
            <span class="tabular-nums">{{ (netMarginPct() ?? 0) | number:'1.2-2' }}%</span>
          </div>
          <div class="mt-1 flex items-center justify-between text-xs text-gray-400 dark:text-muted">
            <span>{{ rows().length }} item(s) · {{ totalQty() | number:'1.0-0' }} MT</span>
            <span>Rev {{ totalRevenue() | number:'1.2-2' }} {{ baseCurrency() }}</span>
          </div>
        </div>
      } @else if (rows().length > 0) {
        <div class="rounded-xl border border-gray-200 dark:border-line bg-gray-50 dark:bg-bg-2 p-4">
          <div class="flex items-center justify-between text-xs text-gray-400 dark:text-muted">
            <span>{{ rows().length }} item(s) · {{ totalQty() | number:'1.0-0' }} MT</span>
            <span class="text-sm font-medium text-gray-500 dark:text-muted">Quantities only</span>
          </div>
        </div>
      }
    </div>
    </div>
  `,
})
export class OrderItemsComponent implements OnInit, OnDestroy {
  readonly Number = Number;
  /** Items passed in from the order detail page. */
  readonly items = input<OrderItemRow[]>([]);
  readonly readonly = input(false);
  readonly allowDeliveredEdit = input(false);
  readonly canSeePrices = input(true);
  readonly currency = input('USD');
  readonly financingRateAnnual = input(0.08);
  readonly financingDays = input(0);
  readonly financingDayCountConvention = input(365);
  readonly productOptionsInput = input<DropdownOption[]>([]);
  readonly unitOptionsInput = input<DropdownOption[]>([]);
  readonly unitConversionsInput = input<{ productType?: string; fromUnit: string; toUnit: string; factor: number }[]>([]);
  readonly currencyOptionsInput = input<DropdownOption[]>([]);
  readonly supplierOptionsInput = input<DropdownOption[]>([]);
  readonly priceReferencesInput = input<{ id: string; name: string; code: string }[]>([]);
  readonly plattsSuggestionsInput = input<PlattsSuggestionsResponseDto['items']>([]);
  // Inventory pickers (optional; only rendered when warehouseOptionsInput is non-empty).
  readonly warehouseOptionsInput = input<DropdownOption[]>([]);
  readonly inventorySkuOptionsInput = input<DropdownOption[]>([]);
  readonly catalogItemsInput = input<{ name: string; description?: string; defaultUnit?: string; defaultCostPrice?: number; defaultSalesPrice?: number; defaultTaxRateId?: string }[]>([]);
  readonly defaultUnitInput = input<string>('MT');
  readonly taxRatesInput = input<{ id: string; name: string; rate: number }[]>([]);
  readonly decimalPrecisionInput = input<number>(5);
  /** Map of order-item row id → availability check result (controlled by parent). */
  readonly availabilityByRowId = input<Record<string, OrderItemAvailability>>({});
  readonly itemsChange = output<OrderItemRow[]>();
  readonly economicsChange = output<OrderItemsEconomics>();
  readonly displayCurrencyChange = output<string>();

  private readonly wsService = inject(WebSocketService);
  private fxSub: Subscription | null = null;
  private readonly fxRates = signal<Record<string, number>>({ USD: 1 });

  /** When every cost + sell currency on all rows is the same, show totals in
   *  that currency. Otherwise fall back to USD. */
  readonly baseCurrency = computed(() => {
    const r = this.rows();
    if (r.length === 0) return 'USD';
    const first = (r[0]!.costCurrency || 'USD').toUpperCase();
    const allMatch = r.every(
      (row) =>
        (row.costCurrency || 'USD').toUpperCase() === first &&
        (row.salesCurrency || 'USD').toUpperCase() === first,
    );
    return allMatch ? first : 'USD';
  });

  private static readonly DEFAULT_CURRENCIES: DropdownOption[] = [
    { value: 'USD', label: 'USD' },
    { value: 'EUR', label: 'EUR' },
    { value: 'DKK', label: 'DKK' },
    { value: 'AED', label: 'AED' },
  ];

  readonly currencyOptions = computed(() => {
    const input = this.currencyOptionsInput();
    return input.length > 0 ? input : OrderItemsComponent.DEFAULT_CURRENCIES;
  });

  /** Internal mutable signal, linked to the input. */
  readonly rows = linkedSignal(() =>
    this.items().map((item) => ({
      ...item,
      costCurrency: item.costCurrency || this.currency(),
      salesCurrency: item.salesCurrency || this.currency(),
      profit: item.profit ?? 0,
      costPricingModel: item.costPricingModel ?? PricingModel.Fixed,
      salesPricingModel: item.salesPricingModel ?? PricingModel.Fixed,
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
      const base = (data?.fxRates?.base ?? 'USD').toUpperCase();
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

    effect(() => {
      this.economicsChange.emit({
        totalQuantity: this.totalQty(),
        totalCost: this.totalCost(),
        totalRevenue: this.totalRevenue(),
        totalGrossProfit: this.totalProfit(),
        totalFinancingCost: this.totalFinancingCost(),
        financingCostPerMt: this.financingCostPerMt(),
        totalNetProfit: this.totalNetProfit(),
        netMarginPct: this.netMarginPct(),
      });
    });

    effect(() => {
      this.displayCurrencyChange.emit(this.baseCurrency());
    });
  }

  // ─── Dropdown options ────────────────────────────────────────────

  private static readonly DEFAULT_PRODUCTS: DropdownOption[] = Object.values(ProductType).map((v) => ({
    value: v,
    label: v,
  }));

  private static readonly DEFAULT_UNITS: DropdownOption[] = [
    { value: 'MT', label: 'MT' },
    { value: 'MTS', label: 'MTS' },
    { value: 'CBM', label: 'CBM' },
    { value: 'LT', label: 'LT' },
    { value: 'BBL', label: 'BBL' },
    { value: 'GAL', label: 'GAL' },
    { value: 'KG', label: 'KG' },
  ];

  readonly productOptions = computed(() => {
    const fromInput = this.productOptionsInput();
    return fromInput.length > 0 ? fromInput : OrderItemsComponent.DEFAULT_PRODUCTS;
  });

  readonly unitOptions = computed(() => {
    const fromInput = this.unitOptionsInput();
    const baseOptions = fromInput.length > 0 ? fromInput : OrderItemsComponent.DEFAULT_UNITS;
    const options = new Map(baseOptions.map((option) => [option.value, option] as const));

    for (const row of this.rows()) {
      for (const unit of [row.unit, row.costUnit, row.salesUnit]) {
        if (unit && !options.has(unit)) {
          options.set(unit, { value: unit, label: unit });
        }
      }
    }

    return [...options.values()];
  });

  readonly priceRefOptions = computed<DropdownOption[]>(() =>
    this.priceReferencesInput().map((r) => ({ value: r.id, label: r.name })),
  );

  readonly supplierOptions = computed(() => this.supplierOptionsInput());
  readonly showSupplierColumn = computed(() => this.supplierOptions().length > 1);

  readonly plattsSuggestionsByKey = computed(() =>
    new Map(this.plattsSuggestionsInput().map((item) => [item.key, item.matches] as const)),
  );

  /** Whether formula pricing is available (at least one price reference configured). */
  readonly formulaPricingEnabled = computed(() => this.priceReferencesInput().length > 0);
  // ─── Computed totals ─────────────────────────────────────────────

  readonly totalQty = computed(() =>
    this.rows().reduce((s, r) => s + this.effectiveQuantity(r), 0),
  );

  readonly totalCost = computed(() =>
    this.toDisplayCurrency(this.rows().reduce((s, r) => s + this.computeCostBase(r), 0)),
  );

  readonly totalRevenue = computed(() =>
    this.toDisplayCurrency(this.rows().reduce((s, r) => s + this.computeRevenueBase(r), 0)),
  );

  readonly totalProfit = computed(() =>
    this.rows().reduce((s, r) => s + this.profitForRow(r), 0),
  );

  readonly totalFinancingCost = computed(() =>
    this.rows().reduce((sum, row) => sum + this.financingCostForRow(row), 0),
  );

  readonly financingCostPerMt = computed(() => {
    const qty = this.totalQty();
    return qty > 0 ? this.totalFinancingCost() / qty : null;
  });

  readonly totalNetProfit = computed(() => this.totalProfit() - this.totalFinancingCost());

  readonly netMarginPct = computed(() => {
    const revenue = this.totalRevenue();
    return revenue > 0 ? (this.totalNetProfit() / revenue) * 100 : null;
  });

  readonly totalDeliveredQty = computed(() =>
    this.rows().reduce((s, r) => s + this.effectiveQuantity(r), 0),
  );

  // ─── Actions ─────────────────────────────────────────────────────

  addRow(): void {
    const defaultUnit = this.defaultUnitInput() || 'MT';
    const newRow: OrderItemRow = {
      id: crypto.randomUUID(),
      orderSupplierId: this.supplierOptions().length === 1 ? this.supplierOptions()[0]!.value : null,
      productType: '',
      description: '',
      quantity: 0,
      quantityMin: null,
      quantityMax: null,
      unit: defaultUnit,
      costUnit: defaultUnit,
      salesUnit: defaultUnit,
      costConversionFactor: 1,
      unitConversionFactor: 1,
      costPrice: 0,
      costCurrency: this.currency(),
      salesPrice: 0,
      salesCurrency: this.currency(),
      profit: 0,
      paymentTerms: '',
      customerNote: '',
      costPricingModel: PricingModel.Fixed,
      salesPricingModel: PricingModel.Fixed,
    };
    this.rows.update((prev) => [...prev, newRow]);
    this.emitChange();
  }

  removeRow(index: number): void {
    this.rows.update((prev) => prev.filter((_, i) => i !== index));
    this.emitChange();
  }

  /** Handle tax-rate dropdown change — stores the numeric rate and recalculates tax amount. */
  onTaxRateChange(index: number, value: string | number): void {
    const rate = value === '' || value == null ? null : Number(value);
    this.rows.update((prev) => {
      const updated = [...prev];
      const row = { ...updated[index]! };
      row.taxRate = rate;
      // Recalculate tax amount if we have a profit base
      const base = this.computeRevenueBase(row) - this.computeCostBase(row);
      row.taxAmount = rate != null ? +(base * rate).toFixed(2) : null;
      updated[index] = row;
      return updated;
    });
    this.emitChange();
  }

  updateField(index: number, field: keyof OrderItemRow, value: unknown): void {
    this.rows.update((prev) => {
      const updated = [...prev];
      const row = { ...updated[index]! };

      (row as Record<string, unknown>)[field] = value;

      if (field === 'productType') {
        row.costPlattsEntryId = null;
        row.salesPlattsEntryId = null;

        // Auto-populate from catalog when productType changes and fields are empty
        const catalog = this.catalogItemsInput();
        const match = catalog.find((c) => c.name === (value as string));
        if (match) {
          if (!row.description) row.description = match.description ?? '';
          if (row.unit === 'MT' || !row.unit) row.unit = match.defaultUnit ?? this.defaultUnitInput() ?? 'MT';
          if (row.costUnit === 'MT' || !row.costUnit) row.costUnit = match.defaultUnit ?? this.defaultUnitInput() ?? 'MT';
          if (row.salesUnit === 'MT' || !row.salesUnit) row.salesUnit = match.defaultUnit ?? this.defaultUnitInput() ?? 'MT';
          if (row.costPrice === 0) row.costPrice = match.defaultCostPrice ?? 0;
          if (row.salesPrice === 0) row.salesPrice = match.defaultSalesPrice ?? 0;
          if (match.defaultTaxRateId) {
            const rateConfig = this.taxRatesInput().find((r) => r.id === match.defaultTaxRateId);
            if (rateConfig) row.taxRate = rateConfig.rate;
          }
        }
      }
      if (field === 'costPricingModel' && value !== PricingModel.Formula && value !== 'FORMULA') {
        row.costPlattsEntryId = null;
      }
      if (field === 'salesPricingModel' && value !== PricingModel.Formula && value !== 'FORMULA') {
        row.salesPlattsEntryId = null;
      }

      // Auto-apply default conversion factor when unit, costUnit, salesUnit, or product changes
      if (field === 'unit' || field === 'salesUnit' || field === 'productType') {
        row.unitConversionFactor = this.lookupConversionFactor(row.productType, row.unit, row.salesUnit);
      }
      if (field === 'unit' || field === 'costUnit' || field === 'productType') {
        row.costConversionFactor = this.lookupConversionFactor(row.productType, row.unit, row.costUnit);
      }

      // Auto-recalculate profit using main quantity
      row.profit = this.profitForRow(row);
      updated[index] = row;
      return updated;
    });
    this.emitChange();
  }

  /** Handle field changes from the pricing child component. */
  onPricingFieldChange(index: number, side: 'cost' | 'sales', event: { field: string; value: unknown }): void {
    const prefix = side === 'cost' ? 'cost' : 'sales';
    const fieldMap: Record<string, keyof OrderItemRow> = {
      price: side === 'cost' ? 'costPrice' : 'salesPrice',
      currency: side === 'cost' ? 'costCurrency' : 'salesCurrency',
      unit: side === 'cost' ? 'costUnit' : 'salesUnit',
      referenceId: side === 'cost' ? 'costReferenceId' : 'salesReferenceId',
      premium: side === 'cost' ? 'costPremium' : 'salesPremium',
      barging: side === 'cost' ? 'costBarging' : 'salesBarging',
      pricingModel: side === 'cost' ? 'costPricingModel' : 'salesPricingModel',
      conversionFactor: side === 'cost' ? 'costConversionFactor' : 'unitConversionFactor',
      bargingUnit: side === 'cost' ? 'costBargingUnit' : 'salesBargingUnit',
      creditDays: side === 'cost' ? 'costCreditDays' : 'salesCreditDays',
    };
    const field = fieldMap[event.field];
    if (field) {
      this.updateField(index, field, event.value);
    }
  }

  /** Handle field changes from the inventory band child component. */
  onInventoryFieldChange(index: number, event: { field: string; value: unknown }): void {
    this.updateField(index, event.field as keyof OrderItemRow, event.value);
  }

  parseDecimalInput(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value !== 'string') return null;

    const normalized = value.trim().replace(/\s+/g, '').replace(',', '.');
    if (!normalized) return null;

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /** Format an ISO timestamp to a `YYYY-MM-DD` string (UTC day, matches the rest of the app). */
  formatDateInput(value: string | null | undefined): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }

  /** Convert a date input value to an ISO timestamp pinned to UTC noon (matches order ETA convention). */
  parseDateInput(value: string | null | undefined): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return new Date(`${trimmed}T12:00:00Z`).toISOString();
  }

  supplierLabel(orderSupplierId: string | null | undefined): string {
    if (!orderSupplierId) return 'Unassigned';
    return this.supplierOptions().find((supplier) => supplier.value === orderSupplierId)?.label ?? 'Unknown supplier';
  }

  /** Update the main quantity (used for calculations/invoicing) */
  /** Update the ordered quantity; economics will use delivered quantity when one has been entered. */
  updateQuantity(index: number, value: number): void {
    this.rows.update((prev) => {
      const updated = [...prev];
      const row = { ...updated[index]! };
      row.quantity = row.quantityMin !== null && value < row.quantityMin
        ? row.quantityMin
        : value;
      // Auto-recalculate economics using delivered quantity when available.
      row.profit = this.profitForRow(row);
      updated[index] = row;
      return updated;
    });
    this.emitChange();
  }

  updateQuantityMin(index: number, value: number | null): void {
    this.rows.update((prev) => {
      const updated = [...prev];
      const row = { ...updated[index]! };
      row.quantityMin = value;
      // If min exceeds qty, bump qty up
      if (value !== null && value > row.quantity) {
        row.quantity = value;
      }
      // Profit always uses main qty
      // Recalculate economics using delivered quantity when available.
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
    } else {
      this.rows.update((rows) => {
        const updated = [...rows];
        const row = { ...updated[index]! };
        updated[index] = { ...row, quantityMin: row.quantityMin ?? row.quantity };
        return updated;
      });
    }
    this.emitChange();
  }

  private emitChange(): void {
    this.itemsChange.emit(this.rows());
  }

  /** FX rate to convert a given currency to USD. */
  private getFxRate(currency: string): number {
    const code = (currency || 'USD').toUpperCase();
    if (code === 'USD') return 1;
    return this.fxRates()[code] ?? 1;
  }

  /** Converts a USD amount into the current display currency. */
  private toDisplayCurrency(usdAmount: number): number {
    const display = this.baseCurrency();
    if (display === 'USD') return usdAmount;
    const rate = this.getFxRate(display);
    return rate > 0 ? usdAmount / rate : usdAmount;
  }
  private effectiveQuantity(row: OrderItemRow): number {
    return row.deliveredQuantity != null ? row.deliveredQuantity : (row.quantity || 0);
  }

  private computeCostBase(row: OrderItemRow): number {
    const qty = this.effectiveQuantity(row);
    const factor = row.costConversionFactor || 1;
    return (row.costPrice || 0) * qty * factor * this.getFxRate(row.costCurrency);
  }

  private computeRevenueBase(row: OrderItemRow): number {
    const qty = this.effectiveQuantity(row);
    const factor = row.unitConversionFactor || 1;
    return (row.salesPrice || 0) * qty * factor * this.getFxRate(row.salesCurrency);
  }

  /** Label for conversion factor: "density" for mass↔volume, "conversion" otherwise. */
  conversionLabel(fromUnit: string, toUnit: string): string {
    const massUnits = new Set(['MT', 'MTS', 'KG']);
    const volumeUnits = new Set(['CBM', 'BBL', 'GAL', 'LT', 'LPS']);
    const fromMass = massUnits.has(fromUnit);
    const fromVol = volumeUnits.has(fromUnit);
    const toMass = massUnits.has(toUnit);
    const toVol = volumeUnits.has(toUnit);
    return (fromMass && toVol) || (fromVol && toMass) ? 'density' : 'conversion';
  }

  /** Look up a default conversion factor from admin settings (product-specific first, then generic fallback). */
  private lookupConversionFactor(productType: string, fromUnit: string, toUnit: string): number {
    if (fromUnit === toUnit) return 1;
    const conversions = this.unitConversionsInput();
    // Try product-specific match first
    const productMatch = productType
      ? conversions.find((c) => c.productType === productType && c.fromUnit === fromUnit && c.toUnit === toUnit)
      : undefined;
    if (productMatch) return productMatch.factor;
    // Fall back to generic (no product) match
    const genericMatch = conversions.find(
      (c) => !c.productType && c.fromUnit === fromUnit && c.toUnit === toUnit,
    );
    return genericMatch?.factor ?? 1;
  }

  financingCostForRow(row: OrderItemRow): number {
    if (this.isFormulaUnfinalized(row)) return 0;
    const dayCount = this.financingDayCountConvention() || 365;
    if (dayCount <= 0) return 0;
    return this.toDisplayCurrency(
      this.computeCostBase(row) * this.financingRateAnnual() * this.financingDays() / dayCount,
    );
  }

  profitForRow(row: OrderItemRow): number {
    if (this.isFormulaUnfinalized(row)) return 0;
    return this.toDisplayCurrency(this.computeRevenueBase(row) - this.computeCostBase(row));
  }

  netProfitForRow(row: OrderItemRow): number {
    if (this.isFormulaUnfinalized(row)) return 0;
    return this.profitForRow(row) - this.financingCostForRow(row);
  }

  /** True when either side is formula-priced but not yet finalized. */
  isFormulaUnfinalized(row: OrderItemRow): boolean {
    return (
      (row.costPricingModel === PricingModel.Formula && !row.costPriceFinalized) ||
      (row.salesPricingModel === PricingModel.Formula && !row.salesPriceFinalized)
    );
  }

  /** Get the display name for a price reference by ID. */
  priceRefName(refId: string | null | undefined): string {
    if (!refId) return '';
    const ref = this.priceReferencesInput().find((r) => r.id === refId);
    return ref ? ref.name : '';
  }

  plattsMatches(rowId: string): PlattsSuggestionsResponseDto['items'][number]['matches'] {
    return this.plattsSuggestionsByKey().get(rowId) ?? [];
  }

  selectPlattsMatch(index: number, side: 'cost' | 'sales', entryId: string): void {
    this.rows.update((prev) => {
      const updated = [...prev];
      const row = { ...updated[index]! };
      if (side === 'cost') {
        row.costPlattsEntryId = row.costPlattsEntryId === entryId ? null : entryId;
      } else {
        row.salesPlattsEntryId = row.salesPlattsEntryId === entryId ? null : entryId;
      }
      updated[index] = row;
      return updated;
    });
    this.emitChange();
  }

  isPlattsMatchSelected(row: OrderItemRow, side: 'cost' | 'sales', entryId: string): boolean {
    return side === 'cost' ? row.costPlattsEntryId === entryId : row.salesPlattsEntryId === entryId;
  }
}
