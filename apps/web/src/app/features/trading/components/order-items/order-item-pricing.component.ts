import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { PricingModel, type PlattsSuggestionsResponseDto } from '@fueld/types';
import {
  SearchableDropdownComponent,
  type DropdownOption,
} from '../../../../shared/components/searchable-dropdown/searchable-dropdown.component';
import type { OrderItemRow } from './order-item.types';

/** Side label for display. */
type PricingSide = 'cost' | 'sales';

@Component({
  selector: 'app-order-item-pricing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, SearchableDropdownComponent],
  template: `
    @if (readonly()) {
      <!-- ═══ READ-ONLY MODE ═══ -->
      @if (pricingModel() === 'FORMULA') {
        <div class="text-right text-xs space-y-0.5">
          <span class="inline-flex items-center rounded bg-violet-50 dark:bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-400">Dynamic</span>
          <div class="text-gray-700 dark:text-ink-dim">{{ row().salesReferenceName || row().costReferenceName || 'Ref' }}</div>
          @if (premium()) { <div class="text-gray-500 dark:text-muted">+ {{ premium() }} pmt</div> }
          @if (barging()) { <div class="text-gray-500 dark:text-muted">barging {{ barging() }} {{ bargingUnit() || 'l/s' }}</div> }
          @if (creditDays()) { <div class="text-gray-500 dark:text-muted">{{ creditDays() }} days</div> }
          @if (priceFinalized()) {
            <div class="font-medium text-gray-900 dark:text-ink">→ {{ price() | number:priceFormat() }} {{ currency() }}/{{ unit() }}</div>
          } @else {
            <div class="italic text-amber-600 dark:text-amber-400">price TBD</div>
          }
        </div>
      } @else {
        <span class="block text-right tabular-nums">{{ price() | number:priceFormat() }} {{ currency() }}/{{ unit() }}</span>
        @if (row().unit !== unit()) {
          <span class="block text-right text-xs text-gray-400 dark:text-muted">× {{ conversionFactor() | number:priceFormat() }} {{ row().unit }}/{{ unit() }}</span>
        }
      }
    } @else {
      <!-- ═══ EDIT MODE ═══ -->
      @if (side() === 'cost') {
        <!-- Cost side -->
        @if (pricingModel() === 'FORMULA') {
          <div class="space-y-1">
            <div class="flex items-center gap-1">
              <app-searchable-dropdown class="flex-1"
                [options]="priceRefOptions()"
                [selected]="refId() ?? ''"
                placeholder="Reference..."
                (selectionChange)="onChange('referenceId', $event)"
              />
              <span class="order-item-inline-select-wrap">
                <select [ngModel]="row().costCurrency"
                  (ngModelChange)="onChange('currency', $event)"
                  class="order-item-inline-select cursor-pointer appearance-none bg-transparent border-0 p-0 text-xs text-gray-500 dark:text-muted hover:text-brand-600 focus:outline-none"
                >
                  @for (c of currencyOptions(); track c.value) {
                    <option [value]="c.value">{{ c.label }}</option>
                  }
                </select>
                <svg class="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400 dark:text-muted"
                  xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                </svg>
              </span>
              <span class="text-gray-400 dark:text-muted text-xs shrink-0">/{{ row().costUnit }}</span>
            </div>
            @if (plattsMatches().length) {
              <div class="flex flex-wrap gap-1.5">
                @for (match of plattsMatches().slice(0, 2); track match.entryId) {
                  <button type="button"
                    (click)="selectPlatts(match.entryId)"
                    [class]="isPlattsSelected(match.entryId) ? 'rounded-full border border-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 px-2 py-1 text-left text-[10px] font-medium text-emerald-800 dark:text-emerald-300' : 'rounded-full border border-gray-200 dark:border-line bg-gray-50 dark:bg-bg-2 px-2 py-1 text-left text-[10px] font-medium text-gray-600 dark:text-ink-dim hover:border-brand-300 hover:text-brand-700'"
                  >
                    {{ match.priceRaw || 'Signal' }} {{ match.marketRegion || match.instrument || '' }}
                  </button>
                }
              </div>
            }
            <div class="flex items-center gap-1">
              <span class="text-[10px] text-gray-500 dark:text-muted shrink-0">+</span>
              <input type="number" step="0.01"
                [ngModel]="premium() ?? 0"
                (ngModelChange)="onChange('premium', +$event)"
                placeholder="Premium"
                class="w-20 rounded border border-gray-200 dark:border-line px-1.5 py-1 text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600/20"
              />
              <span class="text-[10px] text-gray-400 dark:text-muted shrink-0">/{{ row().costUnit }}</span>
              <span class="text-[10px] text-gray-500 dark:text-muted shrink-0">barg.</span>
              <input type="number" step="0.01"
                [ngModel]="barging() ?? 0"
                (ngModelChange)="onChange('barging', +$event)"
                class="w-16 rounded border border-gray-200 dark:border-line px-1.5 py-1 text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600/20"
              />
              <span class="text-[10px] text-gray-400 dark:text-muted shrink-0">l/s</span>
            </div>
          </div>
        } @else {
          <div class="flex items-center gap-1">
            <input type="number" step="0.01" min="0"
              [ngModel]="price()"
              (ngModelChange)="onChange('price', $event)"
              class="w-full min-w-[80px] rounded-lg border border-gray-300 dark:border-line-strong px-3 py-1.5 text-right text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            />
            <span class="order-item-inline-select-wrap">
              <select [ngModel]="row().costCurrency"
                (ngModelChange)="onChange('currency', $event)"
                class="order-item-inline-select cursor-pointer appearance-none bg-transparent border-0 p-0 text-xs text-gray-500 dark:text-muted hover:text-brand-600 focus:outline-none"
              >
                @for (c of currencyOptions(); track c.value) {
                  <option [value]="c.value">{{ c.label }}</option>
                }
              </select>
              <svg class="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400 dark:text-muted"
                xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
              </svg>
            </span>
            <span class="text-gray-400 dark:text-muted text-xs shrink-0">/</span>
            <span class="order-item-inline-select-wrap">
              <select [ngModel]="row().costUnit"
                (ngModelChange)="onChange('unit', $event)"
                class="order-item-inline-select cursor-pointer appearance-none bg-transparent border-0 p-0 text-xs text-gray-500 dark:text-muted hover:text-brand-600 focus:outline-none"
              >
                @for (u of unitOptions(); track u.value) {
                  <option [value]="u.value">{{ u.label }}</option>
                }
              </select>
              <svg class="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400 dark:text-muted"
                xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
              </svg>
            </span>
          </div>
          @if (row().unit !== row().costUnit) {
            <div class="mt-1 flex items-center gap-1 justify-end">
              <span class="text-[10px] text-gray-500 dark:text-muted">{{ conversionLabel(row().unit, row().costUnit) }}</span>
              <input type="number" step="0.0001" min="0"
                [ngModel]="row().costConversionFactor"
                (ngModelChange)="onChange('conversionFactor', +$event)"
                class="w-14 rounded border border-gray-200 dark:border-line px-1 py-0.5 text-right text-[10px] tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600/20"
              />
              <span class="text-[10px] text-gray-400 dark:text-muted">{{ row().unit }}/{{ row().costUnit }}</span>
            </div>
          }
        }
      } @else {
        <!-- Sales side -->
        @if (pricingModel() === 'FORMULA') {
          <div class="space-y-1">
            <div class="flex items-center gap-1">
              <app-searchable-dropdown class="flex-1"
                [options]="priceRefOptions()"
                [selected]="refId() ?? ''"
                placeholder="Reference..."
                (selectionChange)="onChange('referenceId', $event)"
              />
              <span class="order-item-inline-select-wrap">
                <select [ngModel]="row().salesCurrency"
                  (ngModelChange)="onChange('currency', $event)"
                  class="order-item-inline-select cursor-pointer appearance-none bg-transparent border-0 p-0 text-xs text-gray-500 dark:text-muted hover:text-brand-600 focus:outline-none"
                >
                  @for (c of currencyOptions(); track c.value) {
                    <option [value]="c.value">{{ c.label }}</option>
                  }
                </select>
                <svg class="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400 dark:text-muted"
                  xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                </svg>
              </span>
              <span class="text-gray-400 dark:text-muted text-xs shrink-0">/{{ row().salesUnit }}</span>
            </div>
            @if (plattsMatches().length) {
              <div class="flex flex-wrap gap-1.5">
                @for (match of plattsMatches().slice(0, 2); track match.entryId) {
                  <button type="button"
                    (click)="selectPlatts(match.entryId)"
                    [class]="isPlattsSelected(match.entryId) ? 'rounded-full border border-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 px-2 py-1 text-left text-[10px] font-medium text-emerald-800 dark:text-emerald-300' : 'rounded-full border border-gray-200 dark:border-line bg-gray-50 dark:bg-bg-2 px-2 py-1 text-left text-[10px] font-medium text-gray-600 dark:text-ink-dim hover:border-brand-300 hover:text-brand-700'"
                  >
                    {{ match.priceRaw || 'Signal' }} {{ match.marketRegion || match.instrument || '' }}
                  </button>
                }
              </div>
            }
            <div class="flex items-center gap-1">
              <span class="text-[10px] text-gray-500 dark:text-muted shrink-0">+</span>
              <input type="number" step="0.01"
                [ngModel]="premium() ?? 0"
                (ngModelChange)="onChange('premium', +$event)"
                placeholder="Premium"
                class="w-20 rounded border border-gray-200 dark:border-line px-1.5 py-1 text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600/20"
              />
              <span class="text-[10px] text-gray-400 dark:text-muted shrink-0">/{{ row().salesUnit }}</span>
              <span class="text-[10px] text-gray-500 dark:text-muted shrink-0">barg.</span>
              <input type="number" step="0.01"
                [ngModel]="barging() ?? 0"
                (ngModelChange)="onChange('barging', +$event)"
                class="w-16 rounded border border-gray-200 dark:border-line px-1.5 py-1 text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600/20"
              />
              <span class="text-[10px] text-gray-400 dark:text-muted shrink-0">l/s</span>
            </div>
          </div>
        } @else {
          <div class="flex items-center gap-1">
            <input type="number" step="0.01" min="0"
              [ngModel]="price()"
              (ngModelChange)="onChange('price', $event)"
              class="w-full min-w-[80px] rounded-lg border border-gray-300 dark:border-line-strong px-3 py-1.5 text-right text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            />
            <span class="order-item-inline-select-wrap">
              <select [ngModel]="row().salesCurrency"
                (ngModelChange)="onChange('currency', $event)"
                class="order-item-inline-select cursor-pointer appearance-none bg-transparent border-0 p-0 text-xs text-gray-500 dark:text-muted hover:text-brand-600 focus:outline-none"
              >
                @for (c of currencyOptions(); track c.value) {
                  <option [value]="c.value">{{ c.label }}</option>
                }
              </select>
              <svg class="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400 dark:text-muted"
                xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
              </svg>
            </span>
            <span class="text-gray-400 dark:text-muted text-xs shrink-0">/</span>
            <span class="order-item-inline-select-wrap">
              <select [ngModel]="row().salesUnit"
                (ngModelChange)="onChange('unit', $event)"
                class="order-item-inline-select cursor-pointer appearance-none bg-transparent border-0 p-0 text-xs text-gray-500 dark:text-muted hover:text-brand-600 focus:outline-none"
              >
                @for (u of unitOptions(); track u.value) {
                  <option [value]="u.value">{{ u.label }}</option>
                }
              </select>
              <svg class="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400 dark:text-muted"
                xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
              </svg>
            </span>
          </div>
          @if (row().unit !== row().salesUnit) {
            <div class="mt-1 flex items-center gap-1 justify-end">
              <span class="text-[10px] text-gray-500 dark:text-muted">{{ conversionLabel(row().unit, row().salesUnit) }}</span>
              <input type="number" step="0.0001" min="0"
                [ngModel]="row().unitConversionFactor"
                (ngModelChange)="onChange('unitConversionFactor', +$event)"
                class="w-14 rounded border border-gray-200 dark:border-line px-1 py-0.5 text-right text-[10px] tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600/20"
              />
              <span class="text-[10px] text-gray-400 dark:text-muted">{{ row().unit }}/{{ row().salesUnit }}</span>
            </div>
          }
        }
      }

      <!-- Pricing model toggle -->
      @if (formulaPricingEnabled()) {
        <div class="mt-1.5 flex gap-1">
          <button type="button"
            (click)="onChange('pricingModel', 'FIXED')"
            [class]="pricingModel() === 'FORMULA' ? 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 dark:bg-surface-3 text-gray-500 dark:text-muted hover:bg-gray-200' : 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-brand-100 dark:bg-brand-700/15 text-brand-700 dark:text-brand-400'"
          >Fixed</button>
          <button type="button"
            (click)="onChange('pricingModel', 'FORMULA')"
            [class]="pricingModel() === 'FORMULA' ? 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-400' : 'rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 dark:bg-surface-3 text-gray-500 dark:text-muted hover:bg-gray-200'"
          >Dynamic</button>
        </div>
      }
    }
  `,
})
export class OrderItemPricingComponent {
  readonly row = input.required<OrderItemRow>();
  readonly side = input.required<PricingSide>();
  readonly readonly = input(false);
  readonly formulaPricingEnabled = input(false);
  readonly priceRefOptions = input<DropdownOption[]>([]);
  readonly currencyOptions = input<DropdownOption[]>([]);
  readonly unitOptions = input<DropdownOption[]>([]);
  readonly plattsMatches = input<PlattsSuggestionsResponseDto['items'][number]['matches']>([]);
  readonly plattsEntryId = input<string | null | undefined>(null);
  readonly decimalPrecision = input<number>(5);

  readonly fieldChange = output<{ field: string; value: unknown }>();
  readonly plattsSelect = output<string>();

  /** Number pipe format string derived from the configurable precision (capped at 4 — sales_price is numeric(12,4)). */
  protected priceFormat = computed(() => `1.2-${Math.min(this.decimalPrecision(), 4)}`);

  /** Derive which pricing model is active based on side. */
  protected pricingModel = computed(() => {
    const row = this.row();
    return this.side() === 'cost' ? row.costPricingModel : row.salesPricingModel;
  });

  protected price = computed(() => {
    const row = this.row();
    return this.side() === 'cost' ? row.costPrice : row.salesPrice;
  });

  protected currency = computed(() => {
    const row = this.row();
    return this.side() === 'cost' ? row.costCurrency : row.salesCurrency;
  });

  protected unit = computed(() => {
    const row = this.row();
    return this.side() === 'cost' ? row.costUnit : row.salesUnit;
  });

  protected refId = computed(() => {
    const row = this.row();
    return this.side() === 'cost' ? row.costReferenceId : row.salesReferenceId;
  });

  protected premium = computed(() => {
    const row = this.row();
    return this.side() === 'cost' ? row.costPremium : row.salesPremium;
  });

  protected barging = computed(() => {
    const row = this.row();
    return this.side() === 'cost' ? row.costBarging : row.salesBarging;
  });

  protected bargingUnit = computed(() => {
    const row = this.row();
    return this.side() === 'cost' ? row.costBargingUnit : row.salesBargingUnit;
  });

  protected creditDays = computed(() => {
    const row = this.row();
    return this.side() === 'cost' ? row.costCreditDays : row.salesCreditDays;
  });

  protected priceFinalized = computed(() => {
    const row = this.row();
    return this.side() === 'cost' ? row.costPriceFinalized : row.salesPriceFinalized;
  });

  protected conversionFactor = computed(() => {
    const row = this.row();
    return this.side() === 'cost' ? row.costConversionFactor : row.unitConversionFactor;
  });

  protected onChange(field: string, value: unknown): void {
    this.fieldChange.emit({ field, value });
  }

  protected selectPlatts(entryId: string): void {
    this.plattsSelect.emit(entryId);
  }

  protected isPlattsSelected(entryId: string): boolean {
    return this.plattsEntryId() === entryId;
  }

  /** Label for conversion factor: "density" for mass↔volume, "conversion" otherwise. */
  protected conversionLabel(fromUnit: string, toUnit: string): string {
    const massUnits = new Set(['MT', 'MTS', 'KG']);
    const volumeUnits = new Set(['CBM', 'BBL', 'GAL', 'LT', 'LPS']);
    const fromMass = massUnits.has(fromUnit);
    const fromVol = volumeUnits.has(fromUnit);
    const toMass = massUnits.has(toUnit);
    const toVol = volumeUnits.has(toUnit);
    return (fromMass && toVol) || (fromVol && toMass) ? 'density' : 'conversion';
  }
}
