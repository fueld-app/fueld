import {
  Component, ChangeDetectionStrategy, input, signal, inject, OnChanges, SimpleChanges,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom, timeout } from 'rxjs';
import type {
  ApiResponse, CompanyContactDto, CompanyPlaceSupplyRuleDto, CompanyPlaceSupplyRulePlaceType,
  CompanyPlaceSupplyRuleApplySummaryDto, PortSupplierDto, SupplyPortDto,
} from '@fueld/types';
import { COUNTRIES } from '../../../../../../shared/data/countries';
import { flagFromIso3 } from '../../../../../../shared/utils/flags';
import { API } from '@app/core/config/api';

interface LocalPlaceOption {
  id: string;
  name: string;
  unlocode?: string | null;
  parentPlaceUnlocode?: string | null;
  country: string | null;
  source?: 'local' | 'lloyds';
  lliPlaceId?: string;
}

interface PlaceSupplyRuleForm {
  countryIso: string;
  placeTypes: CompanyPlaceSupplyRulePlaceType[];
  contactId: string | null;
  products: string[];
  note: string;
}

const SUPPLY_PORT_PRODUCT_OPTIONS = ['VLSFO', 'LSMGO', 'IFO380CST', 'MGO', 'LUBE'] as const;
const PLACE_RULE_TYPE_OPTIONS: Array<{ value: CompanyPlaceSupplyRulePlaceType; label: string }> = [
  { value: 'POR', label: 'Port' },
  { value: 'PSP', label: 'Sub Port' },
  { value: 'ANC', label: 'Anchorage' },
  { value: 'TER', label: 'Terminal' },
  { value: 'FIL', label: 'Hydrocarbon Field' },
];

@Component({
  selector: 'app-supply-ports-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: `
    <ng-container>
    <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm min-[900px]:order-11">
      <div class="border-b border-gray-100 dark:border-line px-5 py-3 flex items-center justify-between gap-3">
        <h2 class="text-sm font-semibold text-gray-700 dark:text-ink-dim">
          Supplies At
          @if (supplyPorts().length) {
            <span class="ml-1 inline-flex items-center rounded-full bg-gray-100 dark:bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:text-ink-dim">{{ supplyPorts().length }}</span>
          }
        </h2>
        <div class="flex items-center gap-2">
          <button type="button" (click)="openRulesModal()"
            class="rounded-md border border-gray-200 dark:border-line px-2 py-1 text-[11px] font-medium text-gray-600 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint transition-colors">Coverage rules</button>
          <button type="button" (click)="openAdd()"
            class="rounded-md bg-brand-50 dark:bg-brand-700/15 px-2 py-1 text-[11px] font-medium text-brand-700 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-500/20 transition-colors">+ Add place</button>
        </div>
      </div>

      @if (showAdd()) {
        <div class="border-b border-gray-100 dark:border-line px-5 py-4 bg-gray-50/50 dark:bg-surface-2">
          <div class="space-y-3">
            <div class="relative">
              @if (selectedPlace()) {
                <div class="flex items-center justify-between rounded-md border border-brand-300 bg-brand-50 dark:bg-brand-700/15 px-3 py-2 text-sm">
                  <div>
                    <span class="font-medium text-brand-800 dark:text-brand-300">{{ selectedPlace()!.name }}</span>
                    @if (selectedPlace()!.unlocode || selectedPlace()!.parentPlaceUnlocode) {
                      <div class="mt-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-brand-700/80">{{ (selectedPlace()!.unlocode ?? selectedPlace()!.parentPlaceUnlocode)!.replaceAll(' ', '') }}</div>
                    }
                    @if (selectedPlace()!.country) { <span class="ml-1 text-xs text-brand-700/80">{{ selectedPlace()!.country }}</span> }
                    @if (selectedPlace()!.source === 'lloyds') {
                      <span class="ml-2 inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400">Imported from Seasearcher</span>
                    }
                  </div>
                  @if (!editingId()) {
                    <button type="button" (click)="clearPlace()" class="ml-2 text-brand-400 hover:text-brand-600 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                      </svg>
                    </button>
                  }
                </div>
              } @else {
                <input
                  [ngModel]="placeSearch()"
                  (ngModelChange)="onPlaceSearch($event)"
                  placeholder="Search local place or import from Seasearcher..."
                  class="w-full rounded-md border border-gray-200 dark:border-line px-3 py-1.5 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                />
                @if (placeResults().length) {
                  <div class="absolute z-10 mt-1 w-full rounded-md border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-lg max-h-48 overflow-y-auto">
                    @for (place of placeResults(); track place.id) {
                      <button type="button" (click)="selectPlace(place)"
                        [disabled]="isImporting(place)"
                        class="w-full px-3 py-2 text-left text-sm hover:bg-brand-50 dark:hover:bg-brand-500/15 transition-colors flex items-center justify-between disabled:cursor-wait disabled:opacity-60">
                        <div class="min-w-0">
                          <div class="flex items-center gap-2">
                            <span class="font-medium text-gray-900 dark:text-ink">{{ place.name }}</span>
                            @if (place.source === 'lloyds') {
                              <span class="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400">Seasearcher</span>
                            }
                          </div>
                          @if (place.unlocode || place.parentPlaceUnlocode) {
                            <div class="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-500 dark:text-muted">{{ (place.unlocode ?? place.parentPlaceUnlocode)!.replaceAll(' ', '') }}</div>
                          }
                          @if (place.source === 'lloyds') {
                            <div class="text-[11px] text-gray-400 dark:text-muted">Import this place and add it as a supply port</div>
                          }
                        </div>
                        <div class="ml-3 flex shrink-0 items-center gap-2">
                          @if (place.country) { <span class="text-xs text-gray-400 dark:text-muted">{{ place.country }}</span> }
                          @if (isImporting(place)) {
                            <svg class="h-3.5 w-3.5 animate-spin text-gray-400 dark:text-muted" viewBox="0 0 24 24" fill="none">
                              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                            </svg>
                          }
                        </div>
                      </button>
                    }
                  </div>
                }
              }
            </div>

            <div>
              <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Contact Person</label>
              @if (contactsLoading()) {
                <div class="text-xs text-gray-400 dark:text-muted py-1">Loading contacts...</div>
              } @else if (contacts().length) {
                <select [ngModel]="portForm().contactId" (ngModelChange)="portForm.set({ ...portForm(), contactId: $event || null })"
                  class="w-full rounded-md border border-gray-200 dark:border-line px-3 py-1.5 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600">
                  <option [ngValue]="null">— None —</option>
                  @for (c of contacts(); track c.id) {
                    <option [ngValue]="c.id">{{ c.name }}{{ c.role ? " (" + c.role + ")" : "" }}</option>
                  }
                </select>
              } @else {
                <div class="text-xs text-gray-400 dark:text-muted py-1">No contacts on file</div>
              }
            </div>

            <div>
              <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Products</label>
              <div class="flex flex-wrap gap-1.5">
                @for (prod of productOptions; track prod) {
                  <button type="button" (click)="toggleProduct(prod)"
                    [class]="portForm().products.includes(prod)
                      ? 'rounded-full px-2.5 py-1 text-xs font-medium bg-brand-700 text-white ring-1 ring-brand-600 transition-colors'
                      : 'rounded-full px-2.5 py-1 text-xs font-medium bg-white dark:bg-surface text-gray-600 dark:text-ink-dim ring-1 ring-gray-300 dark:ring-line-strong hover:ring-brand-400 hover:text-brand-700 transition-colors'">
                    {{ prod }}
                  </button>
                }
              </div>
            </div>

            <textarea [ngModel]="portForm().note" (ngModelChange)="portForm.set({ ...portForm(), note: $event })"
              placeholder="Notes" rows="2"
              class="w-full rounded-md border border-gray-200 dark:border-line px-3 py-1.5 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600"></textarea>

            <div class="flex justify-end gap-2">
              <button type="button" (click)="cancelAdd()"
                class="rounded-md border border-gray-200 dark:border-line px-3 py-1 text-xs text-gray-600 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint transition-colors">Cancel</button>
              <button type="button" (click)="savePort()"
                [disabled]="savingPort() || !selectedPlace()"
                class="rounded-md bg-brand-700 px-3 py-1 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50 transition-colors">
                {{ savingPort() ? (editingId() ? 'Saving...' : 'Adding...') : (editingId() ? 'Save' : 'Add') }}
              </button>
            </div>
          </div>
        </div>
      }

      @if (loading()) {
        <div class="flex items-center justify-center py-6">
          <svg class="h-5 w-5 animate-spin text-gray-400 dark:text-muted" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else if (!supplyPorts().length) {
        <div class="px-5 py-6 text-center text-sm text-gray-400 dark:text-muted">No supply ports added for this company</div>
      } @else {
        <div class="divide-y divide-gray-50 max-h-[420px] overflow-y-auto pb-2">
          @for (sp of supplyPorts(); track sp.id) {
            <div class="px-5 py-3 text-sm hover:bg-gray-50/50 transition-colors dark:hover:bg-surface-tint">
              <div class="flex items-center justify-between">
                <div class="min-w-0">
                  <a [routerLink]="['/places', sp.placeId]" class="font-medium text-brand-700 dark:text-brand-400 hover:text-brand-900 hover:underline">{{ sp.placeName }}</a>
                  @if (sp.placeCode) { <div class="mt-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-gray-400 dark:text-muted">{{ sp.placeCode.replaceAll(' ', '') }}</div> }
                </div>
                <div class="ml-3 flex items-start gap-2">
                  @if (sp.placeCountry) {
                    <span class="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-muted whitespace-nowrap">
                      @if (placeFlag(sp.placeCountry)) { <span>{{ placeFlag(sp.placeCountry) }}</span> }
                      <span>{{ placeLabel(sp.placeCountry) }}</span>
                    </span>
                  }
                  <div class="flex items-center gap-0.5 shrink-0">
                    <button (click)="openEdit(sp)" class="rounded-md p-1 text-gray-400 dark:text-muted hover:text-brand-600 transition-colors" title="Edit">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" /></svg>
                    </button>
                    <button (click)="confirmDel(sp)" class="rounded-md p-1 text-gray-400 dark:text-muted hover:text-red-500 transition-colors" title="Delete">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>
                    </button>
                  </div>
                </div>
              </div>
              @if (sp.contactName) { <div class="mt-1 text-xs text-gray-500 dark:text-muted">Contact: {{ sp.contactName }}</div> }
              @if (sp.products.length) {
                <div class="flex flex-wrap gap-1 mt-1">
                  @for (prod of sp.products; track prod) {
                    <span class="inline-flex items-center rounded-full bg-brand-50 dark:bg-brand-700/15 px-2 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-400 ring-1 ring-brand-200 dark:ring-brand-500/30">{{ prod }}</span>
                  }
                </div>
              }
              @if (sp.note) { <p class="text-xs text-gray-400 dark:text-muted mt-0.5 italic">{{ sp.note }}</p> }
            </div>
          }
        </div>
      }
    </div>

    <!-- Delete supply port modal -->
    @if (deleteTarget()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="deleteTarget.set(null)">
        <div class="rounded-xl bg-white dark:bg-surface p-6 shadow-xl max-w-sm mx-4" (click)="$event.stopPropagation()">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-ink">Delete supply location?</h3>
          <p class="mt-2 text-sm text-gray-500 dark:text-muted">Remove <strong>{{ deleteTarget()!.placeName }}</strong> from this company's supply locations?</p>
          <div class="mt-4 flex justify-end gap-2">
            <button (click)="deleteTarget.set(null)" class="rounded-lg border border-gray-300 dark:border-line-strong px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint">Cancel</button>
            <button (click)="executeDel()" class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Delete</button>
          </div>
        </div>
      </div>
    }


    <!-- Coverage rules modal (inside ng-container to avoid parse issues) -->
    @if (showRules()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="closeRulesModal()">
        <div class="mx-4 flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white dark:bg-surface shadow-2xl" (click)="$event.stopPropagation()">
          <div class="flex items-start justify-between gap-4 border-b border-gray-100 dark:border-line px-6 py-4">
            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-ink">Place Coverage Rules</h3>
              <p class="mt-1 text-sm text-gray-500 dark:text-muted">Create rules to auto-add this supplier to matching places.</p>
            </div>
            <button type="button" (click)="closeRulesModal()" class="rounded-md p-2 text-gray-400 dark:text-muted hover:bg-gray-100 dark:hover:bg-surface-tint-strong hover:text-gray-600 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
              </svg>
            </button>
          </div>
          <div class="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.3fr)_360px]">
            <div class="min-h-0 overflow-y-auto border-b border-gray-100 dark:border-line lg:border-b-0 lg:border-r lg:border-gray-100">
              @if (rulesLoading()) {
                <div class="flex h-full min-h-[260px] items-center justify-center">
                  <svg class="h-5 w-5 animate-spin text-gray-400 dark:text-muted" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                </div>
              } @else if (!placeRules().length) {
                <div class="flex h-full min-h-[260px] items-center justify-center px-6 text-center text-sm text-gray-400 dark:text-muted">No coverage rules yet. Create one to auto-add this supplier to matching places.</div>
              } @else {
                <div class="divide-y divide-gray-100 dark:divide-line">
                  @for (rule of placeRules(); track rule.id) {
                    <div class="px-6 py-4">
                      <div class="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div class="min-w-0">
                          <div class="flex flex-wrap items-center gap-2">
                            @if (countryFlag(rule.countryIso)) {<span class="text-base">{{ countryFlag(rule.countryIso) }}</span>}
                            <span class="font-medium text-gray-900 dark:text-ink">{{ countryLabel(rule.countryIso) }}</span>
                            <span class="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-400 dark:text-muted">{{ rule.countryIso }}</span>
                          </div>
                          <div class="mt-2 flex flex-wrap gap-1.5">
                            @for (pt of rule.placeTypes; track pt) {
                              <span class="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400 ring-1 ring-blue-200 dark:ring-blue-500/30">{{ ruleTypeLabel(pt) }}</span>
                            }
                          </div>
                          @if (rule.contactName) {<div class="mt-2 text-xs text-gray-500 dark:text-muted">Contact: {{ rule.contactName }}</div>}
                          @if (rule.products.length) {
                            <div class="mt-2 flex flex-wrap gap-1.5">
                              @for (prod of rule.products; track prod) {
                                <span class="inline-flex items-center rounded-full bg-brand-50 dark:bg-brand-700/15 px-2 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-400 ring-1 ring-brand-200 dark:ring-brand-500/30">{{ prod }}</span>
                              }
                            </div>
                          }
                          @if (rule.note) {<p class="mt-2 text-xs italic text-gray-400 dark:text-muted">{{ rule.note }}</p>}
                        </div>
                        <div class="flex shrink-0 flex-wrap items-center gap-2 xl:justify-end">
                          <button type="button" (click)="editRule(rule)" class="rounded-md border border-gray-200 dark:border-line px-2.5 py-1 text-[11px] font-medium text-gray-600 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint transition-colors">Edit</button>
                          <button type="button" (click)="reapplyRule(rule)" [disabled]="reapplyingRuleId() === rule.id"
                            class="rounded-md border border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-700/15 px-2.5 py-1 text-[11px] font-medium text-brand-700 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-500/20 disabled:opacity-50 transition-colors">
                            {{ reapplyingRuleId() === rule.id ? "Applying..." : "Reapply" }}
                          </button>
                          <button type="button" (click)="deleteRule(rule)" class="rounded-md border border-red-200 dark:border-red-500/30 px-2.5 py-1 text-[11px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/15 transition-colors">Delete</button>
                        </div>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
            <div class="min-h-0 overflow-y-auto bg-gray-50/70 px-6 py-5 dark:bg-surface-2">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h4 class="text-sm font-semibold text-gray-800 dark:text-ink">{{ editingRuleId() ? "Edit Rule" : "New Rule" }}</h4>
                  <p class="mt-1 text-xs text-gray-500 dark:text-muted">Create applies immediately. Editing only affects future matches until you reapply.</p>
                </div>
                @if (editingRuleId()) {
                  <button type="button" (click)="resetRuleForm()" class="rounded-md border border-gray-200 dark:border-line px-2 py-1 text-[11px] font-medium text-gray-600 dark:text-ink-dim hover:bg-white transition-colors">Clear</button>
                }
              </div>
              <div class="mt-4 space-y-4">
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Country</label>
                  <select [ngModel]="ruleForm().countryIso" (ngModelChange)="ruleForm.set({ ...ruleForm(), countryIso: $event })"
                    class="w-full rounded-md border border-gray-200 dark:border-line bg-white dark:bg-surface px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600">
                    <option value="">Select country...</option>
                    @for (c of allCountries; track c.code) {
                      <option [value]="c.code">{{ c.name }} ({{ c.code }})</option>
                    }
                  </select>
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Place Types</label>
                  <div class="flex flex-wrap gap-1.5">
                    @for (opt of ruleTypeOptions; track opt.value) {
                      <button type="button" (click)="toggleRulePlaceType(opt.value)"
                        [class]="ruleForm().placeTypes.includes(opt.value) ? 'rounded-full px-2.5 py-1 text-xs font-medium bg-brand-700 text-white ring-1 ring-brand-600 transition-colors' : 'rounded-full px-2.5 py-1 text-xs font-medium bg-white dark:bg-surface text-gray-600 dark:text-ink-dim ring-1 ring-gray-300 dark:ring-line-strong hover:ring-brand-400 hover:text-brand-700 transition-colors'">
                        {{ opt.label }}
                      </button>
                    }
                  </div>
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Contact Person</label>
                  @if (contacts().length) {
                    <select [ngModel]="ruleForm().contactId" (ngModelChange)="ruleForm.set({ ...ruleForm(), contactId: $event || null })"
                      class="w-full rounded-md border border-gray-200 dark:border-line bg-white dark:bg-surface px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600">
                      <option [ngValue]="null">None</option>
                      @for (c of contacts(); track c.id) {
                        <option [ngValue]="c.id">{{ c.name }}{{ c.role ? " (" + c.role + ")" : "" }}</option>
                      }
                    </select>
                  } @else {
                    <div class="text-xs text-gray-400 dark:text-muted py-1">No contacts on file</div>
                  }
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Products</label>
                  <div class="flex flex-wrap gap-1.5">
                    @for (prod of productOptions; track prod) {
                      <button type="button" (click)="toggleRuleProduct(prod)"
                        [class]="ruleForm().products.includes(prod) ? 'rounded-full px-2.5 py-1 text-xs font-medium bg-brand-700 text-white ring-1 ring-brand-600 transition-colors' : 'rounded-full px-2.5 py-1 text-xs font-medium bg-white dark:bg-surface text-gray-600 dark:text-ink-dim ring-1 ring-gray-300 dark:ring-line-strong hover:ring-brand-400 hover:text-brand-700 transition-colors'">
                        {{ prod }}
                      </button>
                    }
                  </div>
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Note</label>
                  <textarea [ngModel]="ruleForm().note" (ngModelChange)="ruleForm.set({ ...ruleForm(), note: $event })"
                    rows="3" placeholder="Notes"
                    class="w-full rounded-md border border-gray-200 dark:border-line bg-white dark:bg-surface px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600"></textarea>
                </div>
                <div class="flex justify-end gap-2 pt-2">
                  <button type="button" (click)="closeRulesModal()" class="rounded-md border border-gray-200 dark:border-line px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-ink-dim hover:bg-white transition-colors">Close</button>
                  <button type="button" (click)="saveRule()"
                    [disabled]="savingRule() || !ruleForm().countryIso || !ruleForm().placeTypes.length"
                    class="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50 transition-colors">
                    {{ savingRule() ? "Saving..." : (editingRuleId() ? "Save Rule" : "Create Rule") }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    }

  </ng-container>
  `,
})
export class SupplyPortsCardComponent implements OnChanges {
  private readonly http = inject(HttpClient);

  readonly companyId = input.required<string>();
  readonly contacts = input<CompanyContactDto[]>([]);
  readonly contactsLoading = input<boolean>(false);

  readonly supplyPorts = signal<SupplyPortDto[]>([]);
  readonly loading = signal(false);

  readonly showAdd = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly selectedPlace = signal<LocalPlaceOption | null>(null);
  readonly placeSearch = signal('');
  readonly placeResults = signal<LocalPlaceOption[]>([]);
  readonly importingPlaceId = signal<string | null>(null);
  readonly portForm = signal<{ contactId: string | null; products: string[]; note: string }>({ contactId: null, products: [], note: '' });
  readonly savingPort = signal(false);
  readonly deleteTarget = signal<SupplyPortDto | null>(null);

  readonly placeRules = signal<CompanyPlaceSupplyRuleDto[]>([]);
  readonly rulesLoading = signal(false);
  readonly showRules = signal(false);
  readonly ruleForm = signal<PlaceSupplyRuleForm>({ countryIso: '', placeTypes: PLACE_RULE_TYPE_OPTIONS.map(o => o.value), contactId: null, products: [], note: '' });
  readonly editingRuleId = signal<string | null>(null);
  readonly savingRule = signal(false);
  readonly reapplyingRuleId = signal<string | null>(null);

  readonly productOptions = SUPPLY_PORT_PRODUCT_OPTIONS;
  readonly ruleTypeOptions = PLACE_RULE_TYPE_OPTIONS;
  readonly allCountries = COUNTRIES;

  private placeSearchTimeout: ReturnType<typeof setTimeout> | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['companyId']?.currentValue) {
      this.loadPorts();
    }
  }

  private async loadPorts(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<SupplyPortDto[]>>(`${API}/companies/local/${this.companyId()}/supply-ports`).pipe(timeout(8000)),
      );
      if (res.success && res.data) this.supplyPorts.set(res.data);
    } catch { /* ignore */ } finally { this.loading.set(false); }
  }

  openAdd(): void {
    this.editingId.set(null);
    this.showAdd.set(true);
    this.selectedPlace.set(null);
    this.placeSearch.set('');
    this.placeResults.set([]);
    this.portForm.set({ contactId: null, products: [], note: '' });
  }

  cancelAdd(): void {
    this.editingId.set(null);
    this.showAdd.set(false);
    this.selectedPlace.set(null);
    this.placeSearch.set('');
    this.placeResults.set([]);
    this.portForm.set({ contactId: null, products: [], note: '' });
  }

  openEdit(sp: SupplyPortDto): void {
    this.editingId.set(sp.id);
    this.showAdd.set(true);
    this.selectedPlace.set({ id: sp.placeId, name: sp.placeName, unlocode: sp.placeCode, country: sp.placeCountry });
    this.placeSearch.set('');
    this.placeResults.set([]);
    this.portForm.set({ contactId: sp.contactId, products: [...sp.products], note: sp.note ?? '' });
  }

  clearPlace(): void {
    this.selectedPlace.set(null);
    this.placeSearch.set('');
    this.placeResults.set([]);
    this.portForm.set({ ...this.portForm(), contactId: null });
  }

  onPlaceSearch(term: string): void {
    this.placeSearch.set(term);
    if (this.placeSearchTimeout) clearTimeout(this.placeSearchTimeout);
    if (term.trim().length < 2) { this.placeResults.set([]); return; }
    this.placeSearchTimeout = setTimeout(async () => {
      try {
        const res = await firstValueFrom(
          this.http.get<ApiResponse<{ places: LocalPlaceOption[] }>>(`${API}/lloyds/places/local?search=${encodeURIComponent(term)}&limit=15`),
        );
        const existingIds = new Set(this.supplyPorts().map(p => p.placeId));
        const local = res.success && res.data
          ? res.data.places.filter(p => !existingIds.has(p.id)).map(p => ({ ...p, source: 'local' as const }))
          : [];
        if (local.length) { this.placeResults.set(local); return; }
        const lliRes = await firstValueFrom(
          this.http.get<ApiResponse<LocalPlaceOption[]>>(`${API}/lloyds/places?name=${encodeURIComponent(term)}`),
        );
        this.placeResults.set(lliRes.success && lliRes.data ? lliRes.data.filter(p => p.source === 'lloyds' && !!p.lliPlaceId) : []);
      } catch { this.placeResults.set([]); }
    }, 250);
  }

  isImporting(place: LocalPlaceOption): boolean {
    return place.source === 'lloyds' && !!place.lliPlaceId && this.importingPlaceId() === place.lliPlaceId;
  }

  async selectPlace(place: LocalPlaceOption): Promise<void> {
    if (place.source === 'lloyds' && place.lliPlaceId) {
      this.importingPlaceId.set(place.lliPlaceId);
      try {
        const res = await firstValueFrom(this.http.post<ApiResponse<{ id: string; name: string }>>(`${API}/lloyds/places/import`, { lliPlaceId: place.lliPlaceId }));
        if (!res.success || !res.data) { return; }
        place = { id: res.data.id, name: res.data.name, unlocode: place.unlocode, country: place.country, source: 'lloyds', lliPlaceId: place.lliPlaceId };
      } catch { return; } finally { this.importingPlaceId.set(null); }
    }
    this.selectedPlace.set(place);
    this.placeSearch.set('');
    this.placeResults.set([]);
  }

  toggleProduct(prod: string): void {
    const cur = this.portForm().products;
    this.portForm.set({ ...this.portForm(), products: cur.includes(prod) ? cur.filter(p => p !== prod) : [...cur, prod] });
  }

  async savePort(): Promise<void> {
    const place = this.selectedPlace();
    if (!place) return;
    this.savingPort.set(true);
    try {
      const form = this.portForm();
      const payload = { contactId: form.contactId, products: form.products, note: form.note.trim() || undefined };
      const editId = this.editingId();
      if (editId) {
        await firstValueFrom(this.http.put(`${API}/lloyds/places/suppliers/${editId}`, payload));
      } else {
        await firstValueFrom(this.http.post(`${API}/lloyds/places/local/${place.id}/suppliers`, { companyId: this.companyId(), ...payload }));
      }
      this.cancelAdd();
      await this.loadPorts();
    } catch (err) { console.error('Failed to save supply port:', err); } finally { this.savingPort.set(false); }
  }

  confirmDel(sp: SupplyPortDto): void { this.deleteTarget.set(sp); }

  async executeDel(): Promise<void> {
    const t = this.deleteTarget();
    if (!t) return;
    try {
      await firstValueFrom(this.http.delete(`${API}/lloyds/places/suppliers/${t.id}`));
      if (this.editingId() === t.id) this.cancelAdd();
      this.deleteTarget.set(null);
      await this.loadPorts();
    } catch { /* ignore */ }
  }

  placeFlag(country: string): string {
    const normalized = country.trim().toUpperCase();
    const entry = COUNTRIES.find(c => c.code.toUpperCase() === normalized);
    return entry ? flagFromIso3(entry.code) : '';
  }

  placeLabel(country: string): string {
    const trimmed = country.trim();
    const normalized = trimmed.toUpperCase();
    const entry = COUNTRIES.find(c => c.code.toUpperCase() === normalized);
    return entry?.name ?? trimmed;
  }

  countryFlag(iso3: string): string { return flagFromIso3(iso3 ?? null); }

  countryLabel(iso3: string): string {
    const c = COUNTRIES.find(entry => entry.code.toUpperCase() === iso3.toUpperCase());
    return c?.name ?? iso3;
  }

  ruleTypeLabel(type: CompanyPlaceSupplyRulePlaceType): string {
    return PLACE_RULE_TYPE_OPTIONS.find(o => o.value === type)?.label ?? type;
  }

  openRulesModal(): void {
    this.showRules.set(true);
    this.resetRuleForm();
    this.loadRules();
  }

  closeRulesModal(): void {
    this.showRules.set(false);
    this.resetRuleForm();
  }

  resetRuleForm(): void {
    this.editingRuleId.set(null);
    this.ruleForm.set({ countryIso: '', placeTypes: PLACE_RULE_TYPE_OPTIONS.map(o => o.value), contactId: null, products: [], note: '' });
  }

  private async loadRules(): Promise<void> {
    this.rulesLoading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<CompanyPlaceSupplyRuleDto[]>>(`${API}/companies/local/${this.companyId()}/place-supply-rules`));
      this.placeRules.set(res.success ? (res.data ?? []) : []);
    } catch { this.placeRules.set([]); } finally { this.rulesLoading.set(false); }
  }

  editRule(rule: CompanyPlaceSupplyRuleDto): void {
    this.editingRuleId.set(rule.id);
    this.ruleForm.set({ countryIso: rule.countryIso, placeTypes: [...rule.placeTypes], contactId: rule.contactId, products: [...rule.products], note: rule.note ?? '' });
  }

  toggleRulePlaceType(type: CompanyPlaceSupplyRulePlaceType): void {
    const cur = this.ruleForm().placeTypes;
    this.ruleForm.set({ ...this.ruleForm(), placeTypes: cur.includes(type) ? cur.filter(t => t !== type) : [...cur, type] });
  }

  toggleRuleProduct(prod: string): void {
    const cur = this.ruleForm().products;
    this.ruleForm.set({ ...this.ruleForm(), products: cur.includes(prod) ? cur.filter(p => p !== prod) : [...cur, prod] });
  }

  async saveRule(): Promise<void> {
    const form = this.ruleForm();
    if (!form.countryIso || !form.placeTypes.length) return;
    this.savingRule.set(true);
    try {
      const payload = { countryIso: form.countryIso.trim().toUpperCase(), placeTypes: form.placeTypes, contactId: form.contactId, products: form.products, note: form.note.trim() || null };
      const editId = this.editingRuleId();
      if (editId) {
        await firstValueFrom(this.http.put(`${API}/companies/local/${this.companyId()}/place-supply-rules/${editId}`, payload));
      } else {
        await firstValueFrom(this.http.post(`${API}/companies/local/${this.companyId()}/place-supply-rules`, payload));
      }
      this.resetRuleForm();
      await this.loadRules();
    } catch { /* ignore */ } finally { this.savingRule.set(false); }
  }

  async reapplyRule(rule: CompanyPlaceSupplyRuleDto): Promise<void> {
    this.reapplyingRuleId.set(rule.id);
    try {
      await firstValueFrom(this.http.post(`${API}/companies/local/${this.companyId()}/place-supply-rules/${rule.id}/reapply`, {}));
      await this.loadRules();
    } catch { /* ignore */ } finally { this.reapplyingRuleId.set(null); }
  }

  async deleteRule(rule: CompanyPlaceSupplyRuleDto): Promise<void> {
    if (!confirm(`Delete coverage rule for ${this.countryLabel(rule.countryIso)}?`)) return;
    try {
      await firstValueFrom(this.http.delete(`${API}/companies/local/${this.companyId()}/place-supply-rules/${rule.id}`));
      if (this.editingRuleId() === rule.id) this.resetRuleForm();
      await this.loadRules();
    } catch { /* ignore */ }
  }
}
