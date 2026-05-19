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
import { DecimalPipe, SlicePipe } from '@angular/common';
import { ProductType, PricingModel, type PlattsSuggestionsResponseDto } from '@fueld/types';
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
  orderSupplierId?: string | null;
  productType: string;
  description: string;
  quantity: number;
  quantityMin: number | null;
  quantityMax: number | null;
  unit: string;
  costUnit: string;
  salesUnit: string;
  costConversionFactor: number;
  unitConversionFactor: number;
  costPrice: number;
  costCurrency: string;
  salesPrice: number;
  salesCurrency: string;
  profit: number;
  paymentTerms: string;
  customerNote?: string | null;
  deliveredQuantity?: number | null;
  // Formula pricing — cost side
  costPricingModel: PricingModel;
  costReferenceId?: string | null;
  costPlattsEntryId?: string | null;
  costReferenceName?: string | null;
  costPremium?: number | null;
  costBarging?: number | null;
  costBargingUnit?: string | null;
  costCreditDays?: number | null;
  costPriceFinalized?: boolean;
  // Formula pricing — sell side
  salesPricingModel: PricingModel;
  salesReferenceId?: string | null;
  salesPlattsEntryId?: string | null;
  salesReferenceName?: string | null;
  salesPremium?: number | null;
  salesBarging?: number | null;
  salesBargingUnit?: string | null;
  salesCreditDays?: number | null;
  salesPriceFinalized?: boolean;
  // Inventory linkage (optional; only relevant when an inventory-enabled warehouse applies)
  inventorySkuId?: string | null;
  warehouseId?: string | null;
  plannedInventoryAt?: string | null;
}

/** Availability status for a given order item, keyed by row id. */
export interface OrderItemAvailability {
  ok: boolean;
  earliestAvailableAt: string | null;
  shortageQuantity: string | null;
  reason: string | null;
}

export interface OrderItemsEconomics {
  totalQuantity: number;
  totalCost: number;
  totalRevenue: number;
  totalGrossProfit: number;
  totalFinancingCost: number;
  financingCostPerMt: number | null;
  totalNetProfit: number;
  netMarginPct: number | null;
}

@Component({
  selector: 'app-order-items',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, SlicePipe, SearchableDropdownComponent],
  template: `
    <div class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <!-- ═══════════════════════════════════════════════════════════ -->
      <!--  Shared header                                             -->
      <!-- ═══════════════════════════════════════════════════════════ -->
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div>
          <h3 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-700">Line Items</h3>
          <p class="mt-1 text-xs text-gray-500">{{ rows().length }} item{{ rows().length === 1 ? '' : 's' }} in this {{ readonly() ? 'document' : 'deal' }}</p>
        </div>
        @if (!readonly()) {
          <button
            (click)="addRow()"
            class="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-semibold
                   text-gray-700 shadow-sm transition-colors hover:border-brand-300 hover:text-brand-700 focus:outline-none
                   focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
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
          <tr class="border-b border-gray-200 bg-gray-50/80">
            <th class="px-4 py-3 text-left font-medium text-gray-600 min-w-[140px]">Product</th>
            @if (showSupplierColumn()) {
              <th class="px-4 py-3 text-left font-medium text-gray-600 min-w-[160px]">Supplier</th>
            }
            <th class="px-4 py-3 text-left font-medium text-gray-600 min-w-[180px]">Description</th>
            <th class="px-4 py-3 text-left font-medium text-gray-600 min-w-[120px]">Qty</th>
            @if (allowDeliveredEdit()) {
              <th class="px-4 py-3 text-right font-medium text-gray-600 min-w-[110px]">Del. Qty</th>
            }
            <th class="px-4 py-3 text-right font-medium text-gray-600 min-w-[180px]">Cost</th>
            <th class="px-4 py-3 text-right font-medium text-gray-600 min-w-[180px]">Sell</th>
            <th class="px-4 py-3 text-right font-medium text-gray-600 min-w-[120px]">Gross ({{ baseCurrency() }})</th>
            <th class="px-4 py-3 text-right font-medium text-gray-600 min-w-[120px]">Financing</th>
            <th class="px-4 py-3 text-right font-medium text-gray-600 min-w-[120px]">Net</th>
            @if (!readonly()) {
              <th class="w-0 p-0"></th>
            }
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          @for (row of rows(); track row.id; let i = $index) {
            <tr class="group relative transition-colors hover:bg-gray-50/50 align-top">
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
                    <span class="text-sm text-gray-700">{{ supplierLabel(row.orderSupplierId) }}</span>
                  } @else {
                    <select
                      [ngModel]="row.orderSupplierId ?? ''"
                      (ngModelChange)="updateField(i, 'orderSupplierId', $event || null)"
                      class="fueld-select-no-chevron w-full appearance-none rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                             focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
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
                  <span class="text-sm text-gray-700">{{ row.description || '-' }}</span>
                } @else {
                  <input
                    type="text"
                    [ngModel]="row.description"
                    (ngModelChange)="updateField(i, 'description', $event)"
                    placeholder="e.g. local specs"
                    class="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm
                           focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
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
                        class="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm tabular-nums
                               focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                      />
                      <span class="text-gray-400 text-xs">–</span>
                    }
                    <input
                      type="number" step="0.001" min="0"
                      [ngModel]="row.quantity"
                      (ngModelChange)="updateQuantity(i, $event)"
                      [attr.min]="spreadEnabled().has(row.id) && row.quantityMin !== null ? row.quantityMin : 0"
                      placeholder="Qty"
                      class="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm tabular-nums
                             focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                    <span class="order-item-inline-select-wrap">
                      <select
                        [ngModel]="row.unit"
                        (ngModelChange)="updateField(i, 'unit', $event)"
                        class="order-item-inline-select cursor-pointer appearance-none bg-transparent border-0 p-0 text-xs text-gray-500
                               hover:text-brand-600 focus:outline-none"
                      >
                        @for (u of unitOptions(); track u.value) {
                          <option [value]="u.value">{{ u.label }}</option>
                        }
                      </select>
                      <svg
                        class="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400"
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

              <!-- Delivered Qty -->
              @if (allowDeliveredEdit()) {
                <td class="px-4 py-2">
                  <input
                    type="number" step="0.001" min="0"
                    [ngModel]="row.deliveredQuantity ?? row.quantity"
                    (ngModelChange)="updateField(i, 'deliveredQuantity', parseDecimalInput($event))"
                    class="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm tabular-nums
                           focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                </td>
              }

              <!-- Cost (price + currency) -->
              <td class="px-4 py-2 align-top">
                @if (readonly()) {
                  @if (row.costPricingModel === 'FORMULA') {
                    <div class="text-right text-xs space-y-0.5">
                      <span class="inline-flex items-center rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">Dynamic</span>
                      <div class="text-gray-700">{{ row.costReferenceName || 'Ref' }}</div>
                      @if (row.costPremium) { <div class="text-gray-500">+ {{ row.costPremium }} pmt</div> }
                      @if (row.costBarging) { <div class="text-gray-500">barging {{ row.costBarging }} {{ row.costBargingUnit || 'l/s' }}</div> }
                      @if (row.costCreditDays) { <div class="text-gray-500">{{ row.costCreditDays }} days</div> }
                      @if (row.costPriceFinalized) {
                        <div class="font-medium text-gray-900">→ {{ row.costPrice | number:'1.2-4' }} {{ row.costCurrency }}/{{ row.costUnit }}</div>
                      } @else {
                        <div class="italic text-amber-600">price TBD</div>
                      }
                    </div>
                  } @else {
                    <span class="block text-right tabular-nums">{{ row.costPrice | number:'1.2-4' }} {{ row.costCurrency }}/{{ row.costUnit }}</span>
                    @if (row.unit !== row.costUnit) {
                      <span class="block text-right text-xs text-gray-400">× {{ row.costConversionFactor | number:'1.2-4' }} {{ row.unit }}/{{ row.costUnit }}</span>
                    }
                  }
                } @else {
                  @if (row.costPricingModel === 'FORMULA') {
                    <div class="space-y-1">
                      <div class="flex items-center gap-1">
                        <app-searchable-dropdown class="flex-1"
                          [options]="priceRefOptions()"
                          [selected]="row.costReferenceId ?? ''"
                          placeholder="Reference..."
                          (selectionChange)="updateField(i, 'costReferenceId', $event)"
                        />
                        <span class="order-item-inline-select-wrap">
                          <select [ngModel]="row.costCurrency"
                            (ngModelChange)="updateField(i, 'costCurrency', $event)"
                            class="order-item-inline-select cursor-pointer appearance-none bg-transparent border-0 p-0 text-xs text-gray-500
                                   hover:text-brand-600 focus:outline-none"
                          >
                            @for (c of currencyOptions(); track c.value) {
                              <option [value]="c.value">{{ c.label }}</option>
                            }
                          </select>
                          <svg
                            class="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400"
                            xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
                          >
                            <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                          </svg>
                        </span>
                        <span class="text-gray-400 text-xs shrink-0">/{{ row.costUnit }}</span>
                      </div>
                        @if (plattsMatches(row.id).length) {
                          <div class="flex flex-wrap gap-1.5">
                            @for (match of plattsMatches(row.id).slice(0, 2); track match.entryId) {
                              <button
                                type="button"
                                (click)="selectPlattsMatch(i, 'cost', match.entryId)"
                                [class]="isPlattsMatchSelected(row, 'cost', match.entryId) ? 'rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-left text-[10px] font-medium text-emerald-800' : 'rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-left text-[10px] font-medium text-gray-600 hover:border-brand-300 hover:text-brand-700'"
                              >
                                {{ match.priceRaw || 'Signal' }} {{ match.marketRegion || match.instrument || '' }}
                              </button>
                            }
                          </div>
                        }
                      <div class="flex items-center gap-1">
                        <span class="text-[10px] text-gray-500 shrink-0">+</span>
                        <input type="number" step="0.01"
                          [ngModel]="row.costPremium ?? 0"
                          (ngModelChange)="updateField(i, 'costPremium', +$event)"
                          placeholder="Premium"
                          class="w-20 rounded border border-gray-200 px-1.5 py-1 text-xs tabular-nums
                                 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
                                 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                        />
                        <span class="text-[10px] text-gray-400 shrink-0">/{{ row.costUnit }}</span>
                        <span class="text-[10px] text-gray-500 shrink-0">barg.</span>
                        <input type="number" step="0.01"
                          [ngModel]="row.costBarging ?? 0"
                          (ngModelChange)="updateField(i, 'costBarging', +$event)"
                          class="w-16 rounded border border-gray-200 px-1.5 py-1 text-xs tabular-nums
                                 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
                                 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                        />
                        <span class="text-[10px] text-gray-400 shrink-0">l/s</span>
                      </div>
                    </div>
                  } @else {
                    <div class="flex items-center gap-1">
                      <input
                        type="number" step="0.01" min="0"
                        [ngModel]="row.costPrice"
                        (ngModelChange)="updateField(i, 'costPrice', $event)"
                        class="w-full min-w-[80px] rounded-lg border border-gray-300 px-3 py-1.5 text-right text-sm tabular-nums
                               [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
                               focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                      />
                      <span class="order-item-inline-select-wrap">
                        <select
                          [ngModel]="row.costCurrency"
                          (ngModelChange)="updateField(i, 'costCurrency', $event)"
                          class="order-item-inline-select cursor-pointer appearance-none bg-transparent border-0 p-0 text-xs text-gray-500
                                 hover:text-brand-600 focus:outline-none"
                        >
                          @for (c of currencyOptions(); track c.value) {
                            <option [value]="c.value">{{ c.label }}</option>
                          }
                        </select>
                        <svg
                          class="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400"
                          xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
                        >
                          <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                        </svg>
                      </span>
                      <span class="text-gray-400 text-xs shrink-0">/</span>
                      <span class="order-item-inline-select-wrap">
                        <select
                          [ngModel]="row.costUnit"
                          (ngModelChange)="updateField(i, 'costUnit', $event)"
                          class="order-item-inline-select cursor-pointer appearance-none bg-transparent border-0 p-0 text-xs text-gray-500
                                 hover:text-brand-600 focus:outline-none"
                        >
                          @for (u of unitOptions(); track u.value) {
                            <option [value]="u.value">{{ u.label }}</option>
                          }
                        </select>
                        <svg
                          class="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400"
                          xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
                        >
                          <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                        </svg>
                      </span>
                    </div>
                    @if (row.unit !== row.costUnit) {
                      <div class="mt-1 flex items-center gap-1 justify-end">
                        <span class="text-[10px] text-gray-500">{{ conversionLabel(row.unit, row.costUnit) }}</span>
                        <input
                          type="number" step="0.0001" min="0"
                          [ngModel]="row.costConversionFactor"
                          (ngModelChange)="updateField(i, 'costConversionFactor', +$event)"
                          class="w-14 rounded border border-gray-200 px-1 py-0.5 text-right text-[10px] tabular-nums
                                 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
                                 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                        />
                        <span class="text-[10px] text-gray-400">{{ row.unit }}/{{ row.costUnit }}</span>
                      </div>
                    }
                  }
                  <!-- Pricing model toggle -->
                  @if (formulaPricingEnabled()) {
                    <div class="mt-1.5 flex gap-1">
                      <button type="button"
                        (click)="updateField(i, 'costPricingModel', 'FIXED')"
                        [class]="row.costPricingModel === 'FORMULA' ? 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 hover:bg-gray-200' : 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-brand-100 text-brand-700'"
                      >Fixed</button>
                      <button type="button"
                        (click)="updateField(i, 'costPricingModel', 'FORMULA')"
                        [class]="row.costPricingModel === 'FORMULA' ? 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 text-violet-700' : 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 hover:bg-gray-200'"
                      >Dynamic</button>
                    </div>
                  }
                }
              </td>

              <!-- Sell (price + currency + unit) -->
              <td class="px-4 py-2 align-top">
                @if (readonly()) {
                  @if (row.salesPricingModel === 'FORMULA') {
                    <div class="text-right text-xs space-y-0.5">
                      <span class="inline-flex items-center rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">Dynamic</span>
                      <div class="text-gray-700">{{ row.salesReferenceName || 'Ref' }}</div>
                      @if (row.salesPremium) { <div class="text-gray-500">+ {{ row.salesPremium }} pmt</div> }
                      @if (row.salesBarging) { <div class="text-gray-500">barging {{ row.salesBarging }} {{ row.salesBargingUnit || 'l/s' }}</div> }
                      @if (row.salesCreditDays) { <div class="text-gray-500">{{ row.salesCreditDays }} days</div> }
                      @if (row.salesPriceFinalized) {
                        <div class="font-medium text-gray-900">→ {{ row.salesPrice | number:'1.2-4' }} {{ row.salesCurrency }}/{{ row.salesUnit }}</div>
                      } @else {
                        <div class="italic text-amber-600">price TBD</div>
                      }
                    </div>
                  } @else {
                    <span class="block text-right tabular-nums">{{ row.salesPrice | number:'1.2-4' }} {{ row.salesCurrency }}/{{ row.salesUnit }}</span>
                    @if (row.unit !== row.salesUnit) {
                      <span class="block text-right text-xs text-gray-400">× {{ row.unitConversionFactor | number:'1.2-4' }} {{ row.unit }}/{{ row.salesUnit }}</span>
                    }
                  }
                } @else {
                  @if (row.salesPricingModel === 'FORMULA') {
                    <div class="space-y-1">
                      <div class="flex items-center gap-1">
                        <app-searchable-dropdown class="flex-1"
                          [options]="priceRefOptions()"
                          [selected]="row.salesReferenceId ?? ''"
                          placeholder="Reference..."
                          (selectionChange)="updateField(i, 'salesReferenceId', $event)"
                        />
                        <span class="order-item-inline-select-wrap">
                          <select [ngModel]="row.salesCurrency"
                            (ngModelChange)="updateField(i, 'salesCurrency', $event)"
                            class="order-item-inline-select cursor-pointer appearance-none bg-transparent border-0 p-0 text-xs text-gray-500
                                   hover:text-brand-600 focus:outline-none"
                          >
                            @for (c of currencyOptions(); track c.value) {
                              <option [value]="c.value">{{ c.label }}</option>
                            }
                          </select>
                          <svg
                            class="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400"
                            xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
                          >
                            <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                          </svg>
                        </span>
                        <span class="text-gray-400 text-xs">/</span>
                        <span class="order-item-inline-select-wrap">
                          <select [ngModel]="row.salesUnit"
                            (ngModelChange)="updateField(i, 'salesUnit', $event)"
                            class="order-item-inline-select cursor-pointer appearance-none bg-transparent border-0 p-0 text-xs text-gray-500
                                   hover:text-brand-600 focus:outline-none"
                          >
                            @for (u of unitOptions(); track u.value) {
                              <option [value]="u.value">{{ u.label }}</option>
                            }
                          </select>
                          <svg
                            class="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400"
                            xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
                          >
                            <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                          </svg>
                        </span>
                      </div>
                        @if (plattsMatches(row.id).length) {
                          <div class="flex flex-wrap gap-1.5">
                            @for (match of plattsMatches(row.id).slice(0, 2); track match.entryId) {
                              <button
                                type="button"
                                (click)="selectPlattsMatch(i, 'sales', match.entryId)"
                                [class]="isPlattsMatchSelected(row, 'sales', match.entryId) ? 'rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-left text-[10px] font-medium text-emerald-800' : 'rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-left text-[10px] font-medium text-gray-600 hover:border-brand-300 hover:text-brand-700'"
                              >
                                {{ match.priceRaw || 'Signal' }} {{ match.marketRegion || match.instrument || '' }}
                              </button>
                            }
                          </div>
                        }
                      <div class="flex items-center gap-1">
                        <span class="text-[10px] text-gray-500 shrink-0">+</span>
                        <input type="number" step="0.01"
                          [ngModel]="row.salesPremium ?? 0"
                          (ngModelChange)="updateField(i, 'salesPremium', +$event)"
                          placeholder="Premium"
                          class="w-20 rounded border border-gray-200 px-1.5 py-1 text-xs tabular-nums
                                 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
                                 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                        />
                        <span class="text-[10px] text-gray-400 shrink-0">/{{ row.salesUnit }}</span>
                        <span class="text-[10px] text-gray-500 shrink-0">barg.</span>
                        <input type="number" step="0.01"
                          [ngModel]="row.salesBarging ?? 0"
                          (ngModelChange)="updateField(i, 'salesBarging', +$event)"
                          class="w-16 rounded border border-gray-200 px-1.5 py-1 text-xs tabular-nums
                                 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
                                 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                        />
                        <span class="text-[10px] text-gray-400 shrink-0">l/s</span>
                      </div>
                    </div>
                  } @else {
                    <div class="flex items-center gap-1">
                      <input
                        type="number" step="0.01" min="0"
                        [ngModel]="row.salesPrice"
                        (ngModelChange)="updateField(i, 'salesPrice', $event)"
                        class="w-full min-w-[80px] rounded-lg border border-gray-300 px-3 py-1.5 text-right text-sm tabular-nums
                               [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
                               focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                      />
                      <span class="order-item-inline-select-wrap">
                        <select
                          [ngModel]="row.salesCurrency"
                          (ngModelChange)="updateField(i, 'salesCurrency', $event)"
                          class="order-item-inline-select cursor-pointer appearance-none bg-transparent border-0 p-0 text-xs text-gray-500
                                 hover:text-brand-600 focus:outline-none"
                        >
                          @for (c of currencyOptions(); track c.value) {
                            <option [value]="c.value">{{ c.label }}</option>
                          }
                        </select>
                        <svg
                          class="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400"
                          xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
                        >
                          <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                        </svg>
                      </span>
                      <span class="text-gray-400 text-xs">/</span>
                      <span class="order-item-inline-select-wrap">
                        <select
                          [ngModel]="row.salesUnit"
                          (ngModelChange)="updateField(i, 'salesUnit', $event)"
                          class="order-item-inline-select cursor-pointer appearance-none bg-transparent border-0 p-0 text-xs text-gray-500
                                 hover:text-brand-600 focus:outline-none"
                        >
                          @for (u of unitOptions(); track u.value) {
                            <option [value]="u.value">{{ u.label }}</option>
                          }
                        </select>
                        <svg
                          class="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400"
                          xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
                        >
                          <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                        </svg>
                      </span>
                    </div>
                  }
                  <!-- Pricing model toggle + density -->
                  @if (formulaPricingEnabled() || row.unit !== row.salesUnit) {
                    <div class="mt-1.5 flex items-center gap-1 flex-wrap">
                      @if (formulaPricingEnabled()) {
                        <button type="button"
                          (click)="updateField(i, 'salesPricingModel', 'FIXED')"
                          [class]="row.salesPricingModel === 'FORMULA' ? 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 hover:bg-gray-200' : 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-brand-100 text-brand-700'"
                        >Fixed</button>
                        <button type="button"
                          (click)="updateField(i, 'salesPricingModel', 'FORMULA')"
                          [class]="row.salesPricingModel === 'FORMULA' ? 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 text-violet-700' : 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 hover:bg-gray-200'"
                        >Dynamic</button>
                      }
                      @if (row.unit !== row.salesUnit) {
                        <span class="text-[10px] text-gray-500 ml-auto">{{ conversionLabel(row.unit, row.salesUnit) }}</span>
                        <input
                          type="number" step="0.0001" min="0"
                          [ngModel]="row.unitConversionFactor"
                          (ngModelChange)="updateField(i, 'unitConversionFactor', +$event)"
                          class="w-14 rounded border border-gray-200 px-1 py-0.5 text-right text-[10px] tabular-nums
                                 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
                                 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                        />
                        <span class="text-[10px] text-gray-400">{{ row.unit }}/{{ row.salesUnit }}</span>
                      }
                    </div>
                  }
                }
              </td>

              <!-- Gross Profit (auto-calculated) -->
              <td class="px-4 py-3 pt-4 text-right tabular-nums"
                [class.text-green-600]="!isFormulaUnfinalized(row) && profitForRow(row) > 0"
                [class.text-red-600]="!isFormulaUnfinalized(row) && profitForRow(row) < 0"
                [class.font-semibold]="!isFormulaUnfinalized(row) && profitForRow(row) !== 0"
              >
                @if (isFormulaUnfinalized(row)) {
                  <span class="italic text-amber-600 text-xs">TBD</span>
                } @else {
                  {{ profitForRow(row) | number:'1.2-2' }}
                }
              </td>

              <td class="px-4 py-3 pt-4 text-right tabular-nums text-amber-700">
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
                  <span class="italic text-amber-600 text-xs">TBD</span>
                } @else {
                  {{ netProfitForRow(row) | number:'1.2-2' }}
                }
              </td>

              <!-- Delete -->
              @if (!readonly()) {
                <td class="relative w-0 p-0">
                  <button
                    (click)="removeRow(i)"
                    class="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                    aria-label="Remove item"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022 1.005 11.36A2.75 2.75 0 0 0 7.763 20h4.474a2.75 2.75 0 0 0 2.744-2.689l1.005-11.36.149.022a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </td>
              }
            </tr>

            <!-- Inventory band — only when warehouses exist for this order (e.g. own-company supplier with enabled warehouse). -->
            @if (warehouseOptionsInput().length > 0) {
              <tr class="border-b border-gray-100 bg-emerald-50/30">
                <td [attr.colspan]="(readonly() ? 9 : 10) + (allowDeliveredEdit() ? 1 : 0)" class="px-4 py-2">
                  <div class="flex flex-wrap items-end gap-3 text-xs">
                    <span class="inline-flex items-center gap-1 rounded-full bg-emerald-100/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                      Inventory
                    </span>
                    <label class="flex flex-col gap-0.5">
                      <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500">Warehouse</span>
                      <select
                        [ngModel]="row.warehouseId ?? ''"
                        (ngModelChange)="updateField(i, 'warehouseId', $event || null)"
                        [disabled]="readonly()"
                        class="fueld-select-no-chevron appearance-none rounded-md border border-gray-300 px-2 py-1 text-xs disabled:opacity-60"
                      >
                        <option value="">— Not tracked —</option>
                        @for (w of warehouseOptionsInput(); track w.value) {
                          <option [value]="w.value">{{ w.label }}</option>
                        }
                      </select>
                    </label>
                    <label class="flex flex-col gap-0.5">
                      <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500">SKU</span>
                      <select
                        [ngModel]="row.inventorySkuId ?? ''"
                        (ngModelChange)="updateField(i, 'inventorySkuId', $event || null)"
                        [disabled]="readonly() || !row.warehouseId"
                        class="fueld-select-no-chevron appearance-none rounded-md border border-gray-300 px-2 py-1 text-xs disabled:opacity-60"
                      >
                        <option value="">—</option>
                        @for (s of inventorySkuOptionsInput(); track s.value) {
                          <option [value]="s.value">{{ s.label }}</option>
                        }
                      </select>
                    </label>
                    <label class="flex flex-col gap-0.5">
                      <span class="text-[10px] font-medium uppercase tracking-wider text-gray-500">Planned date</span>
                      <input
                        type="date"
                        [ngModel]="formatDateInput(row.plannedInventoryAt)"
                        (ngModelChange)="updateField(i, 'plannedInventoryAt', parseDateInput($event))"
                        [disabled]="readonly() || !row.warehouseId"
                        class="rounded-md border border-gray-300 px-2 py-1 text-xs disabled:opacity-60"
                      />
                    </label>
                    @if (availabilityByRowId()[row.id]; as a) {
                      @if (!a.ok) {
                        <span class="ml-auto inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700"
                          [title]="a.reason ?? 'Insufficient stock'">
                          Short {{ a.shortageQuantity }}
                          @if (a.earliestAvailableAt) {
                            · earliest {{ a.earliestAvailableAt | slice:0:10 }}
                          }
                        </span>
                      } @else if (row.warehouseId && row.inventorySkuId) {
                        <span class="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          Available
                        </span>
                      }
                    }
                  </div>
                </td>
              </tr>
            }
          } @empty {
            <tr>
              <td [attr.colspan]="(readonly() ? 9 : 10) + (allowDeliveredEdit() ? 1 : 0)" class="px-4 py-12 text-center">
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
              <td class="px-4 py-3 text-right text-gray-600">Totals</td>
              <td></td>
              <td></td>
              @if (allowDeliveredEdit()) {
                <td></td>
              }
              <td class="px-4 py-3 text-right tabular-nums text-gray-600">{{ totalCost() | number:'1.2-2' }} {{ baseCurrency() }}</td>
              <td class="px-4 py-3 text-right tabular-nums text-gray-600">{{ totalRevenue() | number:'1.2-2' }} {{ baseCurrency() }}</td>
              <td class="px-4 py-3 text-right tabular-nums"
                [class.text-green-600]="totalProfit() > 0"
                [class.text-red-600]="totalProfit() < 0"
              >
                {{ totalProfit() | number:'1.2-2' }} {{ baseCurrency() }}
              </td>
              <td class="px-4 py-3 text-right tabular-nums text-amber-700">
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
    <div class="space-y-3 bg-gray-50/40 p-4 md:hidden">
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
                  [options]="productOptions()"
                  [selected]="row.productType"
                  placeholder="Product..."
                  (selectionChange)="updateField(i, 'productType', $event)"
                />
              }
            </div>

            @if (showSupplierColumn()) {
              <div class="col-span-2">
                <label class="mb-1 block text-xs font-medium text-gray-500">Supplier</label>
                @if (readonly()) {
                  <span class="text-sm text-gray-700">{{ supplierLabel(row.orderSupplierId) }}</span>
                } @else {
                  <select
                    [ngModel]="row.orderSupplierId ?? ''"
                    (ngModelChange)="updateField(i, 'orderSupplierId', $event || null)"
                    class="fueld-select-no-chevron w-full appearance-none rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                           focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
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
              <label class="mb-1 block text-xs font-medium text-gray-500">Description</label>
              @if (readonly()) {
                <span class="text-sm text-gray-700">{{ row.description || '-' }}</span>
              } @else {
                <input
                  type="text"
                  [ngModel]="row.description"
                  (ngModelChange)="updateField(i, 'description', $event)"
                  placeholder="e.g. local specs"
                  class="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm
                         focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              }
            </div>

            <!-- Qty -->
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500">Quantity</label>
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
                      class="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm tabular-nums
                             focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  }
                  <div class="flex items-center gap-2">
                    <input type="number" step="0.001" min="0"
                      [ngModel]="row.quantity"
                      (ngModelChange)="updateQuantity(i, $event)"
                      [attr.min]="spreadEnabled().has(row.id) && row.quantityMin !== null ? row.quantityMin : 0"
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
                </div>
              }
            </div>

            <!-- Unit (base qty unit) -->
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500">Unit</label>
              @if (readonly()) {
                <span class="text-sm text-gray-500">{{ row.unit }}</span>
              } @else {
                <select
                  [ngModel]="row.unit"
                  (ngModelChange)="updateField(i, 'unit', $event)"
                  class="fueld-select-no-chevron w-full appearance-none rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                         focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
                >
                  @for (u of unitOptions(); track u.value) {
                    <option [value]="u.value">{{ u.label }}</option>
                  }
                </select>
              }
            </div>

            <!-- Cost Unit -->
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500">Cost Unit</label>
              @if (readonly()) {
                <span class="text-sm text-gray-500">{{ row.costUnit }}</span>
              } @else {
                <select
                  [ngModel]="row.costUnit"
                  (ngModelChange)="updateField(i, 'costUnit', $event)"
                  class="fueld-select-no-chevron w-full appearance-none rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                         focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
                >
                  @for (u of unitOptions(); track u.value) {
                    <option [value]="u.value">{{ u.label }}</option>
                  }
                </select>
              }
            </div>

            <!-- Sales Unit -->
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500">Sales Unit</label>
              @if (readonly()) {
                <span class="text-sm text-gray-500">{{ row.salesUnit }}</span>
              } @else {
                <select
                  [ngModel]="row.salesUnit"
                  (ngModelChange)="updateField(i, 'salesUnit', $event)"
                  class="fueld-select-no-chevron w-full appearance-none rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                         focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
                >
                  @for (u of unitOptions(); track u.value) {
                    <option [value]="u.value">{{ u.label }}</option>
                  }
                </select>
              }
            </div>

            <!-- Cost -->
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500">Cost</label>
              @if (readonly()) {
                @if (row.costPricingModel === 'FORMULA') {
                  <div class="text-xs space-y-0.5">
                    <span class="inline-flex items-center rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">Dynamic</span>
                    <div class="text-gray-700">{{ row.costReferenceName || 'Ref' }}</div>
                    @if (row.costPremium) { <div class="text-gray-500">+ {{ row.costPremium }} pmt</div> }
                    @if (row.costBarging) { <div class="text-gray-500">barging {{ row.costBarging }} {{ row.costBargingUnit || 'l/s' }}</div> }
                    @if (row.costPriceFinalized) {
                      <div class="font-medium text-gray-900">→ {{ row.costPrice | number:'1.2-4' }} {{ row.costCurrency }}/{{ row.costUnit }}</div>
                    } @else {
                      <div class="italic text-amber-600">price TBD</div>
                    }
                  </div>
                } @else {
                  <span class="text-sm tabular-nums">{{ row.costPrice | number:'1.2-4' }} {{ row.costCurrency }}/{{ row.costUnit }}</span>
                }
              } @else {
                @if (formulaPricingEnabled()) {
                  <div class="mb-1.5 flex gap-1">
                    <button type="button" (click)="updateField(i, 'costPricingModel', 'FIXED')"
                      [class]="row.costPricingModel === 'FORMULA' ? 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500' : 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-brand-100 text-brand-700'"
                    >Fixed</button>
                    <button type="button" (click)="updateField(i, 'costPricingModel', 'FORMULA')"
                      [class]="row.costPricingModel === 'FORMULA' ? 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 text-violet-700' : 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500'"
                    >Dynamic</button>
                  </div>
                }
                @if (row.costPricingModel === 'FORMULA') {
                  <div class="space-y-1.5">
                    <app-searchable-dropdown [options]="priceRefOptions()" [selected]="row.costReferenceId ?? ''" placeholder="Reference..." (selectionChange)="updateField(i, 'costReferenceId', $event)" />
                    @if (plattsMatches(row.id).length) {
                      <div class="flex flex-wrap gap-1.5">
                        @for (match of plattsMatches(row.id).slice(0, 2); track match.entryId) {
                          <button
                            type="button"
                            (click)="selectPlattsMatch(i, 'cost', match.entryId)"
                            [class]="isPlattsMatchSelected(row, 'cost', match.entryId) ? 'rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-left text-[10px] font-medium text-emerald-800' : 'rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-left text-[10px] font-medium text-gray-600'"
                          >
                            {{ match.priceRaw || 'Signal' }} {{ match.marketRegion || match.instrument || '' }}
                          </button>
                        }
                      </div>
                    }
                    <input type="number" step="0.01" [ngModel]="row.costPremium ?? 0" (ngModelChange)="updateField(i, 'costPremium', +$event)" placeholder="Premium pmt"
                      class="w-full rounded border border-gray-200 px-2 py-1 text-xs tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20" />
                    <div class="flex gap-1">
                      <input type="number" step="0.01" [ngModel]="row.costBarging ?? 0" (ngModelChange)="updateField(i, 'costBarging', +$event)" placeholder="Barging"
                        class="w-full rounded border border-gray-200 px-2 py-1 text-xs tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20" />
                      <select [ngModel]="row.costBargingUnit ?? 'l/s'" (ngModelChange)="updateField(i, 'costBargingUnit', $event)"
                        class="fueld-select-no-chevron w-14 appearance-none rounded border border-gray-200 px-1 py-1 text-[10px] text-gray-600 focus:border-brand-500 outline-none bg-white">
                        <option value="l/s">l/s</option><option value="pmt">pmt</option>
                      </select>
                    </div>
                    <input type="number" step="1" min="0" [ngModel]="row.costCreditDays ?? 0" (ngModelChange)="updateField(i, 'costCreditDays', +$event)" placeholder="Credit days"
                      class="w-full rounded border border-gray-200 px-2 py-1 text-xs tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20" />
                  </div>
                } @else {
                  <div class="flex items-center gap-2">
                    <input type="number" step="0.01" min="0"
                      [ngModel]="row.costPrice"
                      (ngModelChange)="updateField(i, 'costPrice', $event)"
                      class="min-w-0 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm tabular-nums
                             [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
                             focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                    <select
                      [ngModel]="row.costCurrency"
                      (ngModelChange)="updateField(i, 'costCurrency', $event)"
                      class="fueld-select-no-chevron w-20 appearance-none rounded-lg border border-gray-300 px-2 py-1.5 text-xs text-gray-700
                             focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
                    >
                      @for (c of currencyOptions(); track c.value) {
                        <option [value]="c.value">{{ c.label }}</option>
                      }
                    </select>
                  </div>
                }
              }
            </div>

            <!-- Sell -->
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500">Sell</label>
              @if (readonly()) {
                @if (row.salesPricingModel === 'FORMULA') {
                  <div class="text-xs space-y-0.5">
                    <span class="inline-flex items-center rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">Dynamic</span>
                    <div class="text-gray-700">{{ row.salesReferenceName || 'Ref' }}</div>
                    @if (row.salesPremium) { <div class="text-gray-500">+ {{ row.salesPremium }} pmt</div> }
                    @if (row.salesBarging) { <div class="text-gray-500">barging {{ row.salesBarging }} {{ row.salesBargingUnit || 'l/s' }}</div> }
                    @if (row.salesPriceFinalized) {
                      <div class="font-medium text-gray-900">→ {{ row.salesPrice | number:'1.2-4' }} {{ row.salesCurrency }}/{{ row.salesUnit }}</div>
                    } @else {
                      <div class="italic text-amber-600">price TBD</div>
                    }
                  </div>
                } @else {
                  <span class="text-sm tabular-nums">{{ row.salesPrice | number:'1.2-4' }} {{ row.salesCurrency }}/{{ row.salesUnit }}</span>
                  @if (row.unit !== row.salesUnit) {
                    <span class="block text-xs text-gray-400">× {{ row.unitConversionFactor | number:'1.2-4' }} {{ row.unit }}/{{ row.salesUnit }}</span>
                  }
                }
              } @else {
                @if (formulaPricingEnabled()) {
                  <div class="mb-1.5 flex gap-1">
                    <button type="button" (click)="updateField(i, 'salesPricingModel', 'FIXED')"
                      [class]="row.salesPricingModel === 'FORMULA' ? 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500' : 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-brand-100 text-brand-700'"
                    >Fixed</button>
                    <button type="button" (click)="updateField(i, 'salesPricingModel', 'FORMULA')"
                      [class]="row.salesPricingModel === 'FORMULA' ? 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 text-violet-700' : 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500'"
                    >Dynamic</button>
                  </div>
                }
                @if (row.salesPricingModel === 'FORMULA') {
                  <div class="space-y-1.5">
                    <app-searchable-dropdown [options]="priceRefOptions()" [selected]="row.salesReferenceId ?? ''" placeholder="Reference..." (selectionChange)="updateField(i, 'salesReferenceId', $event)" />
                    @if (plattsMatches(row.id).length) {
                      <div class="flex flex-wrap gap-1.5">
                        @for (match of plattsMatches(row.id).slice(0, 2); track match.entryId) {
                          <button
                            type="button"
                            (click)="selectPlattsMatch(i, 'sales', match.entryId)"
                            [class]="isPlattsMatchSelected(row, 'sales', match.entryId) ? 'rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-left text-[10px] font-medium text-emerald-800' : 'rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-left text-[10px] font-medium text-gray-600'"
                          >
                            {{ match.priceRaw || 'Signal' }} {{ match.marketRegion || match.instrument || '' }}
                          </button>
                        }
                      </div>
                    }
                    <input type="number" step="0.01" [ngModel]="row.salesPremium ?? 0" (ngModelChange)="updateField(i, 'salesPremium', +$event)" placeholder="Premium pmt"
                      class="w-full rounded border border-gray-200 px-2 py-1 text-xs tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20" />
                    <div class="flex gap-1">
                      <input type="number" step="0.01" [ngModel]="row.salesBarging ?? 0" (ngModelChange)="updateField(i, 'salesBarging', +$event)" placeholder="Barging"
                        class="w-full rounded border border-gray-200 px-2 py-1 text-xs tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20" />
                      <select [ngModel]="row.salesBargingUnit ?? 'l/s'" (ngModelChange)="updateField(i, 'salesBargingUnit', $event)"
                        class="fueld-select-no-chevron w-14 appearance-none rounded border border-gray-200 px-1 py-1 text-[10px] text-gray-600 focus:border-brand-500 outline-none bg-white">
                        <option value="l/s">l/s</option><option value="pmt">pmt</option>
                      </select>
                    </div>
                    <input type="number" step="1" min="0" [ngModel]="row.salesCreditDays ?? 0" (ngModelChange)="updateField(i, 'salesCreditDays', +$event)" placeholder="Credit days"
                      class="w-full rounded border border-gray-200 px-2 py-1 text-xs tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20" />
                  </div>
                } @else {
                  <div class="flex items-center gap-2">
                    <input type="number" step="0.01" min="0"
                      [ngModel]="row.salesPrice"
                      (ngModelChange)="updateField(i, 'salesPrice', $event)"
                      class="min-w-0 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm tabular-nums
                             [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
                             focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                    <select
                      [ngModel]="row.salesCurrency"
                      (ngModelChange)="updateField(i, 'salesCurrency', $event)"
                      class="fueld-select-no-chevron w-20 appearance-none rounded-lg border border-gray-300 px-2 py-1.5 text-xs text-gray-700
                             focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
                    >
                      @for (c of currencyOptions(); track c.value) {
                        <option [value]="c.value">{{ c.label }}</option>
                      }
                    </select>
                  </div>
                  @if (row.unit !== row.salesUnit) {
                    <div class="mt-1 flex items-center gap-1 text-xs text-gray-500">
                      <span>{{ conversionLabel(row.unit, row.salesUnit) }}</span>
                      <input
                        type="number" step="0.0001" min="0"
                        [ngModel]="row.unitConversionFactor"
                        (ngModelChange)="updateField(i, 'unitConversionFactor', +$event)"
                        class="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-right text-xs tabular-nums
                               [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
                               focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                      />
                      <span class="text-gray-400">{{ row.unit }}/{{ row.salesUnit }}</span>
                    </div>
                  }
                }
              }
            </div>

            <!-- Gross Profit -->
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500">Gross Profit ({{ baseCurrency() }})</label>
              @if (isFormulaUnfinalized(row)) {
                <span class="text-xs italic text-amber-600">TBD</span>
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
              <label class="mb-1 block text-xs font-medium text-gray-500">Financing</label>
              @if (isFormulaUnfinalized(row)) {
                <span class="text-xs italic text-amber-700">TBD</span>
              } @else {
                <span class="text-sm font-semibold tabular-nums text-amber-700">
                  {{ financingCostForRow(row) | number:'1.2-2' }}
                </span>
              }
            </div>

            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500">Net Profit ({{ baseCurrency() }})</label>
              @if (isFormulaUnfinalized(row)) {
                <span class="text-xs italic text-amber-600">TBD</span>
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

            <!-- Delivered Qty (mobile) -->
            @if (allowDeliveredEdit()) {
              <div>
                <label class="mb-1 block text-xs font-medium text-gray-500">Delivered Qty</label>
                <input type="number" step="0.001" min="0"
                  [ngModel]="row.deliveredQuantity ?? row.quantity"
                  (ngModelChange)="updateField(i, 'deliveredQuantity', parseDecimalInput($event))"
                  class="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm tabular-nums
                         focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
            }

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
            <span class="font-medium text-gray-600">Gross Profit</span>
            <span
              class="text-lg font-bold tabular-nums"
              [class.text-green-600]="totalProfit() > 0"
              [class.text-red-600]="totalProfit() < 0"
            >
              {{ totalProfit() | number:'1.2-2' }} {{ baseCurrency() }}
            </span>
          </div>
          <div class="mt-2 flex items-center justify-between text-sm text-amber-700">
            <span class="font-medium">Financing Cost</span>
            <span class="font-semibold tabular-nums">{{ totalFinancingCost() | number:'1.2-2' }} {{ baseCurrency() }}</span>
          </div>
          <div class="mt-2 flex items-center justify-between text-sm">
            <span class="font-medium text-gray-600">Net Profit</span>
            <span
              class="text-lg font-bold tabular-nums"
              [class.text-green-600]="totalNetProfit() > 0"
              [class.text-red-600]="totalNetProfit() < 0"
            >
              {{ totalNetProfit() | number:'1.2-2' }} {{ baseCurrency() }}
            </span>
          </div>
          <div class="mt-2 flex items-center justify-between text-xs text-gray-500">
            <span>Financing / MT</span>
            <span class="tabular-nums">{{ (financingCostPerMt() ?? 0) | number:'1.2-2' }} {{ baseCurrency() }}</span>
          </div>
          <div class="mt-1 flex items-center justify-between text-xs text-gray-500">
            <span>Net Margin</span>
            <span class="tabular-nums">{{ (netMarginPct() ?? 0) | number:'1.2-2' }}%</span>
          </div>
          <div class="mt-1 flex items-center justify-between text-xs text-gray-400">
            <span>{{ rows().length }} item(s) · {{ totalQty() | number:'1.0-0' }} MT</span>
            <span>Rev {{ totalRevenue() | number:'1.2-2' }} {{ baseCurrency() }}</span>
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
    const newRow: OrderItemRow = {
      id: crypto.randomUUID(),
      orderSupplierId: this.supplierOptions().length === 1 ? this.supplierOptions()[0]!.value : null,
      productType: '',
      description: '',
      quantity: 0,
      quantityMin: null,
      quantityMax: null,
      unit: 'MT',
      costUnit: 'MT',
      salesUnit: 'MT',
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

  updateField(index: number, field: keyof OrderItemRow, value: unknown): void {
    this.rows.update((prev) => {
      const updated = [...prev];
      const row = { ...updated[index]! };

      (row as Record<string, unknown>)[field] = value;

      if (field === 'productType') {
        row.costPlattsEntryId = null;
        row.salesPlattsEntryId = null;
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
