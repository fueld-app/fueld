import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, UnitSettingsDto, CurrencySettingsDto, UnitConversionSettingsDto } from '@fueld/types';

import { API } from '@app/core/config/api';
import { SettingsToastService } from './settings-toast.service';

@Component({
  selector: 'app-units-pricing-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="grid grid-cols-1 gap-6 min-[900px]:grid-cols-2 min-[1600px]:grid-cols-3">

      <!-- ════════════════════════════════════════════════════════ -->
      <!--  Unit Options                                           -->
      <!-- ════════════════════════════════════════════════════════ -->
      <div class="app-panel">
        <div class="app-panel-header app-panel-header--amber">
          <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--amber">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-600 dark:text-amber-400" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 2a.75.75 0 01.75.75v.258a33.186 33.186 0 016.668.83.75.75 0 01-.336 1.461 31.28 31.28 0 00-1.103-.232l1.702 7.545a.75.75 0 01-.387.832A4.981 4.981 0 0115 14c-.825 0-1.606-.2-2.294-.556a.75.75 0 01-.387-.832l1.77-7.849a31.743 31.743 0 00-3.339-.254v11.505a20.01 20.01 0 013.78.501.75.75 0 11-.339 1.462A18.558 18.558 0 0010 17.5c-1.442 0-2.845.165-4.191.477a.75.75 0 01-.338-1.462 20.01 20.01 0 013.779-.501V4.509c-1.129.026-2.243.112-3.34.254l1.771 7.85a.75.75 0 01-.387.83A4.981 4.981 0 015 14c-.825 0-1.606-.2-2.294-.556a.75.75 0 01-.387-.832l1.702-7.545c-.372.06-.742.126-1.103.232a.75.75 0 11-.336-1.462 33.186 33.186 0 016.668-.829V2.75A.75.75 0 0110 2zM5 12.662l-1.395-6.177C4.6 6.327 5.597 6.2 6 6.2c.404 0 1.4.127 2.395.285L5 12.662zm8.395-6.177L15 12.662l1.395-6.177C14.6 6.327 13.597 6.2 13.2 6.2c-.404 0-1.4.127-2.395.285z" clip-rule="evenodd" />
            </svg>
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Units</h3>
            <p class="text-xs text-gray-500 dark:text-muted">Configure which measurement units appear in order line item dropdowns.</p>
          </div>
        </div>

        <div class="app-panel-body space-y-3 flex-1 min-h-0 overflow-y-auto">
          @for (u of units(); track $index; let i = $index) {
            <div class="flex items-center gap-2">
              <div class="flex flex-col gap-0.5 shrink-0">
                <button (click)="moveUnitUp(i)" [disabled]="i === 0" class="text-gray-400 dark:text-muted hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move up">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" /></svg>
                </button>
                <button (click)="moveUnitDown(i)" [disabled]="i === units().length - 1" class="text-gray-400 dark:text-muted hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move down">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                </button>
              </div>
              <input
                type="text"
                [value]="u"
                (input)="updateUnit(i, $any($event.target).value)"
                      class="app-input-mono-uppercase flex-1"
              />
              <button
                (click)="removeUnit(i)"
                [disabled]="units().length <= 1"
                class="rounded-md p-1.5 text-gray-400 dark:text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/15 disabled:opacity-30 transition-colors shrink-0"
                title="Remove unit"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                </svg>
              </button>
            </div>
          }
          <button
            (click)="addUnit()"
            class="app-button-add"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
            </svg>
            Add Unit
          </button>

          <div class="flex items-center gap-3 pt-2">
            <button
              (click)="saveUnits()"
              [disabled]="unitsSaving()"
                      class="app-button-primary"
            >
              @if (unitsSaving()) { Saving… } @else { Save Units }
            </button>
            @if (unitsSaved()) {
              <span class="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                </svg>
                Saved
              </span>
            }
          </div>
        </div>
      </div>

      <!-- ════════════════════════════════════════════════════════ -->
      <!--  Unit Conversions                                       -->
      <!-- ════════════════════════════════════════════════════════ -->
      <div class="app-panel min-w-0">
        <div class="app-panel-header app-panel-header--amber">
          <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--amber">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-600 dark:text-amber-400" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.28a.75.75 0 00-.75.75v3.955a.75.75 0 001.5 0v-2.134l.312.312a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm.002-2.853a.75.75 0 00.743-.648 7 7 0 00-11.712 3.138.75.75 0 001.449.39 5.5 5.5 0 009.201-2.466l.312.311H13.01a.75.75 0 000 1.5h3.955a.75.75 0 00.75-.75V6.091a.75.75 0 00-1.5 0v2.134l-.312-.312a5.474 5.474 0 00-.59-.342z" clip-rule="evenodd" />
            </svg>
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Unit Conversions</h3>
            <p class="text-xs text-gray-500 dark:text-muted">Default density/conversion factors per product. Leave product blank for a generic fallback.</p>
          </div>
        </div>

        <div class="app-panel-body space-y-3 flex-1 min-h-0 overflow-y-auto">
          @for (conv of unitConversions(); track $index; let i = $index) {
            <div class="flex items-center gap-2 min-w-0">
              <input
                type="text"
                [value]="conv.productType ?? ''"
                (input)="updateUnitConversion(i, 'productType', $any($event.target).value)"
                placeholder="All products"
                class="min-w-0 flex-1 rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              />
              <input
                type="text"
                [value]="conv.fromUnit"
                (input)="updateUnitConversion(i, 'fromUnit', $any($event.target).value.toUpperCase())"
                placeholder="From"
                class="app-input-mono-uppercase min-w-0 w-16 shrink"
              />
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400 dark:text-muted shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clip-rule="evenodd" />
              </svg>
              <input
                type="text"
                [value]="conv.toUnit"
                (input)="updateUnitConversion(i, 'toUnit', $any($event.target).value.toUpperCase())"
                placeholder="To"
                class="app-input-mono-uppercase min-w-0 w-16 shrink"
              />
              <span class="text-xs text-gray-400 dark:text-muted">=</span>
              <input
                type="number" step="0.0001" min="0"
                [ngModel]="conv.factor"
                (ngModelChange)="updateUnitConversion(i, 'factor', +$event)"
                class="min-w-0 w-20 shrink rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-right text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              />
              <button
                (click)="removeUnitConversion(i)"
                class="rounded-md p-1.5 text-gray-400 dark:text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/15 transition-colors shrink-0"
                title="Remove conversion"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                </svg>
              </button>
            </div>
          }
          <button
            (click)="addUnitConversion()"
            class="app-button-add"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
            </svg>
            Add Conversion
          </button>

          <div class="flex items-center gap-3 pt-2">
            <button
              (click)="saveUnitConversions()"
              [disabled]="unitConversionsSaving()"
              class="app-button-primary"
            >
              @if (unitConversionsSaving()) { Saving… } @else { Save Conversions }
            </button>
            @if (unitConversionsSaved()) {
              <span class="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                </svg>
                Saved
              </span>
            }
          </div>
        </div>
      </div>

      <!-- ════════════════════════════════════════════════════════ -->
      <!--  Price References (formula pricing sources)             -->
      <!-- ════════════════════════════════════════════════════════ -->
      <div class="app-panel min-w-0">
        <div class="app-panel-header app-panel-header--violet">
          <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--violet">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-violet-600 dark:text-violet-400" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M12.577 4.878a.75.75 0 01.919-.53l4.78 1.281a.75.75 0 01.531.919l-1.281 4.78a.75.75 0 01-1.449-.387l.81-3.022a19.407 19.407 0 00-5.594 5.203.75.75 0 01-1.139.093L7 10.06l-4.72 4.72a.75.75 0 01-1.06-1.06l5.25-5.25a.75.75 0 011.06 0l3.074 3.073a20.923 20.923 0 015.545-4.931l-3.042-.815a.75.75 0 01-.53-.919z" clip-rule="evenodd" />
            </svg>
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Price References</h3>
            <p class="text-xs text-gray-500 dark:text-muted">Named pricing sources for formula-based pricing (e.g. Aramco OSP, Platts). Used when suppliers quote "posted price + premium".</p>
          </div>
        </div>

        <div class="app-panel-body space-y-3 flex-1 min-h-0 overflow-y-auto">
          @for (ref of priceRefs(); track ref.id; let i = $index) {
            <div class="flex items-center gap-2 min-w-0">
              <input
                type="text"
                [value]="ref.name"
                (input)="updatePriceRef(i, 'name', $any($event.target).value)"
                placeholder="Name (e.g. Aramco OSP)"
                class="min-w-0 flex-1 rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              />
              <input
                type="text"
                [value]="ref.code"
                (input)="updatePriceRef(i, 'code', $any($event.target).value.toUpperCase())"
                placeholder="Code"
                class="app-input-mono-uppercase min-w-0 w-28 shrink"
              />
              <input
                type="text"
                [value]="ref.description ?? ''"
                (input)="updatePriceRef(i, 'description', $any($event.target).value)"
                placeholder="Description (optional)"
                class="min-w-0 flex-1 rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              />
              <button
                (click)="removePriceRef(i)"
                class="rounded-md p-1.5 text-gray-400 dark:text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/15 transition-colors shrink-0"
                title="Remove price reference"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                </svg>
              </button>
            </div>
          }
          <button
            (click)="addPriceRef()"
            class="app-button-add"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
            </svg>
            Add Price Reference
          </button>

          <div class="flex items-center gap-3 pt-2">
            <button
              (click)="savePriceRefs()"
              [disabled]="priceRefsSaving()"
              class="app-button-primary"
            >
              @if (priceRefsSaving()) { Saving… } @else { Save Price References }
            </button>
            @if (priceRefsSaved()) {
              <span class="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                </svg>
                Saved
              </span>
            }
          </div>
        </div>
      </div>

      <!-- ════════════════════════════════════════════════════════ -->
      <!--  Currency Options                                       -->
      <!-- ════════════════════════════════════════════════════════ -->
      <div class="app-panel">
        <div class="app-panel-header app-panel-header--cyan">
          <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--cyan">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-cyan-600 dark:text-cyan-400" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.75 10.818v2.614A3.13 3.13 0 0011.888 13c.482-.315.612-.648.612-.875 0-.227-.13-.56-.612-.875a3.13 3.13 0 00-1.138-.432zM8.33 8.62c.053.055.115.11.184.164.208.16.46.284.736.363V6.603a2.45 2.45 0 00-.92.363c-.293.18-.42.403-.42.56 0 .159.127.382.42.56.08.05.164.092.25.128z" />
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-6a.75.75 0 01.75.75v.316a3.78 3.78 0 011.653.713c.426.33.744.74.925 1.2a.75.75 0 01-1.395.55 1.35 1.35 0 00-.447-.563 2.187 2.187 0 00-.736-.363V9.3c.514.082 1.006.234 1.438.467.669.36 1.115.86 1.115 1.608 0 .746-.446 1.245-1.115 1.607a3.78 3.78 0 01-1.438.467v.316a.75.75 0 01-1.5 0v-.316a3.78 3.78 0 01-1.653-.713 2.72 2.72 0 01-.925-1.2.75.75 0 011.395-.55c.12.3.272.492.447.563.243.098.5.163.736.363v-2.697a3.78 3.78 0 01-1.438-.467C5.446 8.87 5 8.37 5 7.625c0-.746.446-1.245 1.115-1.607a3.78 3.78 0 011.438-.467V5.25A.75.75 0 018.25 4.5h.08z" clip-rule="evenodd" />
            </svg>
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Currencies</h3>
            <p class="text-xs text-gray-500 dark:text-muted">Configure which currencies appear in order line item dropdowns and are tracked via Yahoo Finance.</p>
          </div>
        </div>

        <div class="app-panel-body space-y-3 flex-1 min-h-0 overflow-y-auto">
          @for (c of currencies(); track $index; let i = $index) {
            <div class="flex items-center gap-2">
              <div class="flex flex-col gap-0.5 shrink-0">
                <button (click)="moveCurrencyUp(i)" [disabled]="i === 0" class="text-gray-400 dark:text-muted hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move up">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" /></svg>
                </button>
                <button (click)="moveCurrencyDown(i)" [disabled]="i === currencies().length - 1" class="text-gray-400 dark:text-muted hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move down">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                </button>
              </div>
              <select
                [value]="c"
                (change)="updateCurrency(i, $any($event.target).value)"
                      class="app-input-mono flex-1 bg-white dark:bg-surface"
              >
                @for (opt of availableCurrencyOptions(); track opt.code) {
                  <option [value]="opt.code" [selected]="opt.code === c" [disabled]="opt.code !== c && currencies().includes(opt.code)">{{ opt.code }} — {{ opt.name }}</option>
                }
              </select>
              <button
                (click)="removeCurrency(i)"
                [disabled]="currencies().length <= 1"
                class="rounded-md p-1.5 text-gray-400 dark:text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/15 disabled:opacity-30 transition-colors shrink-0"
                title="Remove currency"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                </svg>
              </button>
            </div>
          }
          <button
            (click)="addCurrency()"
            class="app-button-add"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
            </svg>
            Add Currency
          </button>

          <div class="flex items-center gap-3 pt-2">
            <button
              (click)="saveCurrencies()"
              [disabled]="currenciesSaving()"
                      class="app-button-primary"
            >
              @if (currenciesSaving()) { Saving… } @else { Save Currencies }
            </button>
            @if (currenciesSaved()) {
              <span class="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                </svg>
                Saved
              </span>
            }
          </div>
        </div>
      </div>

    </div>

  `,
})
export class UnitsPricingSettingsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toastService = inject(SettingsToastService);

  // Units
  readonly units = signal<string[]>([]);
  readonly unitsSaving = signal(false);
  readonly unitsSaved = signal(false);

  // Unit Conversions
  readonly unitConversions = signal<{ productType?: string; fromUnit: string; toUnit: string; factor: number }[]>([]);
  readonly unitConversionsSaving = signal(false);
  readonly unitConversionsSaved = signal(false);

  // Price References
  readonly priceRefs = signal<{ id: string; name: string; code: string; description: string | null; _new?: boolean }[]>([]);
  readonly priceRefsSaving = signal(false);
  readonly priceRefsSaved = signal(false);

  // Currencies
  readonly currencies = signal<string[]>([]);
  readonly currenciesSaving = signal(false);
  readonly currenciesSaved = signal(false);

  // All ISO currencies available for selection
  readonly allCurrencies: { code: string; name: string }[] = [
    { code: 'USD', name: 'US Dollar' },
    { code: 'EUR', name: 'Euro' },
    { code: 'GBP', name: 'British Pound' },
    { code: 'DKK', name: 'Danish Krone' },
    { code: 'NOK', name: 'Norwegian Krone' },
    { code: 'SEK', name: 'Swedish Krona' },
    { code: 'CHF', name: 'Swiss Franc' },
    { code: 'AED', name: 'UAE Dirham' },
    { code: 'SAR', name: 'Saudi Riyal' },
    { code: 'QAR', name: 'Qatari Riyal' },
    { code: 'KWD', name: 'Kuwaiti Dinar' },
    { code: 'BHD', name: 'Bahraini Dinar' },
    { code: 'OMR', name: 'Omani Rial' },
    { code: 'SGD', name: 'Singapore Dollar' },
    { code: 'HKD', name: 'Hong Kong Dollar' },
    { code: 'JPY', name: 'Japanese Yen' },
    { code: 'CNY', name: 'Chinese Yuan' },
    { code: 'INR', name: 'Indian Rupee' },
    { code: 'KRW', name: 'South Korean Won' },
    { code: 'AUD', name: 'Australian Dollar' },
    { code: 'NZD', name: 'New Zealand Dollar' },
    { code: 'CAD', name: 'Canadian Dollar' },
    { code: 'BRL', name: 'Brazilian Real' },
    { code: 'MXN', name: 'Mexican Peso' },
    { code: 'ZAR', name: 'South African Rand' },
    { code: 'TRY', name: 'Turkish Lira' },
    { code: 'PLN', name: 'Polish Zloty' },
    { code: 'CZK', name: 'Czech Koruna' },
    { code: 'HUF', name: 'Hungarian Forint' },
    { code: 'RON', name: 'Romanian Leu' },
    { code: 'THB', name: 'Thai Baht' },
    { code: 'MYR', name: 'Malaysian Ringgit' },
    { code: 'IDR', name: 'Indonesian Rupiah' },
    { code: 'PHP', name: 'Philippine Peso' },
    { code: 'TWD', name: 'Taiwan Dollar' },
    { code: 'ILS', name: 'Israeli Shekel' },
    { code: 'EGP', name: 'Egyptian Pound' },
    { code: 'NGN', name: 'Nigerian Naira' },
    { code: 'KES', name: 'Kenyan Shilling' },
  ];

  readonly availableCurrencyOptions = computed(() => {
    // Return all currencies — disabled state handled in template
    return this.allCurrencies;
  });

  ngOnInit(): void {
    this.loadUnits();
    this.loadUnitConversions();
    this.loadPriceRefs();
    this.loadCurrencies();
  }

  // ─── Units ─────────────────────────────────────────────────────────

  private async loadUnits(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<UnitSettingsDto>>(`${API}/admin/settings/units`),
      );
      if (res.success) this.units.set(res.data.units);
    } catch {
      this.toastService.show('error', 'Failed to load units.');
    }
  }

  updateUnit(index: number, value: string): void {
    const updated = [...this.units()];
    updated[index] = value.toUpperCase();
    this.units.set(updated);
  }

  addUnit(): void {
    this.units.set([...this.units(), '']);
  }

  removeUnit(index: number): void {
    this.units.set(this.units().filter((_, i) => i !== index));
  }

  moveUnitUp(index: number): void {
    if (index <= 0) return;
    const updated = [...this.units()];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    this.units.set(updated);
  }

  moveUnitDown(index: number): void {
    const arr = this.units();
    if (index >= arr.length - 1) return;
    const updated = [...arr];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    this.units.set(updated);
  }

  async saveUnits(): Promise<void> {
    const valid = this.units().filter(u => u.trim());
    if (valid.length === 0) {
      this.toastService.show('error', 'At least one unit is required.');
      return;
    }
    this.unitsSaving.set(true);
    this.unitsSaved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<UnitSettingsDto>>(`${API}/admin/settings/units`, { units: valid }),
      );
      if (res.success) {
        this.units.set(res.data.units);
        this.unitsSaved.set(true);
        setTimeout(() => this.unitsSaved.set(false), 3000);
      } else {
        this.toastService.show('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.toastService.show('error', 'Failed to save units.');
    } finally {
      this.unitsSaving.set(false);
    }
  }

  // ─── Unit Conversions ──────────────────────────────────────────────

  private async loadUnitConversions(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<UnitConversionSettingsDto>>(`${API}/admin/settings/unit-conversions`),
      );
      if (res.success) this.unitConversions.set(res.data.conversions);
    } catch {
      this.toastService.show('error', 'Failed to load unit conversions.');
    }
  }

  updateUnitConversion(index: number, field: 'productType' | 'fromUnit' | 'toUnit' | 'factor', value: string | number): void {
    const updated = this.unitConversions().map((c, i) =>
      i === index ? { ...c, [field]: value } : c,
    );
    this.unitConversions.set(updated);
  }

  addUnitConversion(): void {
    this.unitConversions.set([...this.unitConversions(), { productType: '', fromUnit: '', toUnit: '', factor: 1 }]);
  }

  removeUnitConversion(index: number): void {
    this.unitConversions.set(this.unitConversions().filter((_, i) => i !== index));
  }

  async saveUnitConversions(): Promise<void> {
    const valid = this.unitConversions().filter(c => c.fromUnit.trim() && c.toUnit.trim() && c.factor > 0);
    this.unitConversionsSaving.set(true);
    this.unitConversionsSaved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<UnitConversionSettingsDto>>(`${API}/admin/settings/unit-conversions`, { conversions: valid }),
      );
      if (res.success) {
        this.unitConversions.set(res.data.conversions);
        this.unitConversionsSaved.set(true);
        setTimeout(() => this.unitConversionsSaved.set(false), 3000);
      } else {
        this.toastService.show('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.toastService.show('error', 'Failed to save unit conversions.');
    } finally {
      this.unitConversionsSaving.set(false);
    }
  }

  // ─── Price References ──────────────────────────────────────────────

  private async loadPriceRefs(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ references: { id: string; name: string; code: string; description: string | null }[] }>>(`${API}/admin/settings/price-references`),
      );
      if (res.success) this.priceRefs.set(res.data.references);
    } catch {
      this.toastService.show('error', 'Failed to load price references.');
    }
  }

  updatePriceRef(index: number, field: 'name' | 'code' | 'description', value: string): void {
    const updated = this.priceRefs().map((r, i) =>
      i === index ? { ...r, [field]: value } : r,
    );
    this.priceRefs.set(updated);
  }

  addPriceRef(): void {
    this.priceRefs.set([...this.priceRefs(), { id: crypto.randomUUID(), name: '', code: '', description: null, _new: true }]);
  }

  removePriceRef(index: number): void {
    const ref = this.priceRefs()[index];
    this.priceRefs.set(this.priceRefs().filter((_, i) => i !== index));
    // If it has a real ID (not new), delete from server
    if (ref && !ref._new) {
      firstValueFrom(
        this.http.delete<ApiResponse<null>>(`${API}/admin/settings/price-references/${ref.id}`),
      ).catch(() => this.toastService.show('error', 'Failed to delete price reference.'));
    }
  }

  async savePriceRefs(): Promise<void> {
    this.priceRefsSaving.set(true);
    this.priceRefsSaved.set(false);
    try {
      for (const ref of this.priceRefs()) {
        if (!ref.name.trim() || !ref.code.trim()) continue;
        if (ref._new) {
          await firstValueFrom(
            this.http.post<ApiResponse<unknown>>(`${API}/admin/settings/price-references`, {
              name: ref.name,
              code: ref.code,
              description: ref.description || null,
            }),
          );
        } else {
          await firstValueFrom(
            this.http.put<ApiResponse<unknown>>(`${API}/admin/settings/price-references/${ref.id}`, {
              name: ref.name,
              code: ref.code,
              description: ref.description || null,
            }),
          );
        }
      }
      // Reload to get server-assigned IDs
      await this.loadPriceRefs();
      this.priceRefsSaved.set(true);
      setTimeout(() => this.priceRefsSaved.set(false), 3000);
    } catch {
      this.toastService.show('error', 'Failed to save price references.');
    } finally {
      this.priceRefsSaving.set(false);
    }
  }

  // ─── Currencies ────────────────────────────────────────────────────

  private async loadCurrencies(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CurrencySettingsDto>>(`${API}/admin/settings/currencies`),
      );
      if (res.success) this.currencies.set(res.data.currencies);
    } catch {
      this.toastService.show('error', 'Failed to load currencies.');
    }
  }

  updateCurrency(index: number, value: string): void {
    const updated = [...this.currencies()];
    updated[index] = value;
    this.currencies.set(updated);
  }

  addCurrency(): void {
    const current = new Set(this.currencies());
    const next = this.allCurrencies.find(c => !current.has(c.code));
    this.currencies.set([...this.currencies(), next?.code ?? '']);
  }

  removeCurrency(index: number): void {
    this.currencies.set(this.currencies().filter((_, i) => i !== index));
  }

  moveCurrencyUp(index: number): void {
    if (index <= 0) return;
    const updated = [...this.currencies()];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    this.currencies.set(updated);
  }

  moveCurrencyDown(index: number): void {
    const arr = this.currencies();
    if (index >= arr.length - 1) return;
    const updated = [...arr];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    this.currencies.set(updated);
  }

  async saveCurrencies(): Promise<void> {
    const valid = this.currencies().filter(c => c.trim());
    if (valid.length === 0) {
      this.toastService.show('error', 'At least one currency is required.');
      return;
    }
    this.currenciesSaving.set(true);
    this.currenciesSaved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<CurrencySettingsDto>>(`${API}/admin/settings/currencies`, { currencies: valid }),
      );
      if (res.success) {
        this.currencies.set(res.data.currencies);
        this.currenciesSaved.set(true);
        setTimeout(() => this.currenciesSaved.set(false), 3000);
      } else {
        this.toastService.show('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.toastService.show('error', 'Failed to save currencies.');
    } finally {
      this.currenciesSaving.set(false);
    }
  }
}
