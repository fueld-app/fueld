import {
  Component,
  ChangeDetectionStrategy,
  signal,
  input,
  output,
  inject,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SearchableDropdownComponent, type DropdownOption } from '../searchable-dropdown/searchable-dropdown.component';
import { API } from '@app/core/config/api';
import type { ApiResponse } from '@fueld/types';

// ═══════════════════════════════════════════════════════════════════════
//  Filter Overlay — Toggleable filter panel with searchable dropdowns
// ═══════════════════════════════════════════════════════════════════════

export interface FilterState {
  clientId: string;
  vesselId: string;
  placeId: string;
  salesRepId: string;
  brokerId: string;
  invoicingCompanyId: string;
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_FILTERS: FilterState = {
  clientId: '',
  vesselId: '',
  placeId: '',
  salesRepId: '',
  brokerId: '',
  invoicingCompanyId: '',
  dateFrom: '',
  dateTo: '',
};

export interface FilterFieldConfig {
  key: keyof FilterState;
  label: string;
  options: 'async-client' | 'async-vessel' | 'async-place' | 'async-broker' | 'async-invoicing' | 'static-responsible';
}

const FIELD_CONFIGS: FilterFieldConfig[] = [
  { key: 'clientId', label: 'Client', options: 'async-client' },
  { key: 'vesselId', label: 'Vessel', options: 'async-vessel' },
  { key: 'placeId', label: 'Port', options: 'async-place' },
  { key: 'salesRepId', label: 'Responsible', options: 'static-responsible' },
  { key: 'brokerId', label: 'Broker', options: 'async-broker' },
  { key: 'invoicingCompanyId', label: 'Invoicing Company', options: 'async-invoicing' },
];

@Component({
  selector: 'app-filter-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SearchableDropdownComponent],
  template: `
    <div class="relative" #container>
      <!-- Trigger button -->
      <button
        type="button"
        (click)="toggle()"
        class="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M3.232 4.565a.75.75 0 01.99-.243l4.372 2.193a.75.75 0 01-.746 1.304L3.5 5.496v7.95l4.117-2.482a.75.75 0 01.766 1.273L3.5 15.496v.004a.75.75 0 01-1.5 0v-11a.75.75 0 01.232-.435zM15.232 4.565a.75.75 0 01.99-.243l4.372 2.193a.75.75 0 01-.746 1.304L15.5 5.496v7.95l4.117-2.482a.75.75 0 01.766 1.273L15.5 15.496v.004a.75.75 0 01-1.5 0v-11a.75.75 0 01.232-.435z" clip-rule="evenodd" />
          <path d="M10 3a.75.75 0 01.75.75v12.5a.75.75 0 01-1.5 0V3.75A.75.75 0 0110 3z" />
        </svg>
        Filters
        @if (activeCount() > 0) {
          <span class="inline-flex items-center justify-center rounded-full bg-brand-600 text-white text-[10px] font-bold min-w-[18px] h-[18px] px-1">{{ activeCount() }}</span>
        }
      </button>

      <!-- Overlay panel -->
      @if (isOpen()) {
        <div class="fixed inset-0 z-40" (click)="close()"></div>
        <div class="absolute right-0 z-50 mt-2 w-[480px] rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-xl overflow-hidden">
          <!-- Header -->
          <div class="flex items-center justify-between border-b border-gray-200 dark:border-line px-4 py-3">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Filters</h3>
            <button type="button" (click)="close()" class="text-gray-400 hover:text-gray-600 dark:hover:text-ink-dim">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/>
              </svg>
            </button>
          </div>

          <!-- Filter fields -->
          <div class="max-h-[60vh] overflow-y-auto px-4 py-4 space-y-4">
            <div class="grid grid-cols-2 gap-3">
              @for (field of fieldConfigs; track field.key) {
                <div>
                  <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">{{ field.label }}</label>
                  <app-searchable-dropdown
                    [placeholder]="'Filter by ' + field.label + '…'"
                    [options]="getOptions(field.key)()"
                    [selected]="draft()[field.key]"
                    [loading]="getLoading(field.key)()"
                    [asyncSearch]="field.options !== 'static-responsible'"
                    [clearable]="true"
                    (searchChange)="onAsyncSearch(field.key, $event)"
                    (selectionChange)="onFieldChange(field.key, $event)"
                  />
                </div>
              }
            </div>

            <!-- Date range -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">ETA from</label>
                <input
                  type="date"
                  [ngModel]="draft().dateFrom || ''"
                  (ngModelChange)="onFieldChange('dateFrom', $event)"
                  class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm dark:bg-surface dark:text-ink"
                />
              </div>
              <div>
                <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">ETA to</label>
                <input
                  type="date"
                  [ngModel]="draft().dateTo || ''"
                  (ngModelChange)="onFieldChange('dateTo', $event)"
                  class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm dark:bg-surface dark:text-ink"
                />
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-between border-t border-gray-200 dark:border-line px-4 py-3">
            <button
              type="button"
              (click)="clearAll()"
              class="text-sm font-medium text-gray-600 dark:text-ink-dim hover:text-gray-900 dark:hover:text-ink"
            >
              Clear all
            </button>
            <div class="flex gap-2">
              <button
                type="button"
                (click)="close()"
                class="rounded-lg border border-gray-300 dark:border-line-strong px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint"
              >
                Cancel
              </button>
              <button
                type="button"
                (click)="apply()"
                class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class FilterOverlayComponent {
  private readonly http = inject(HttpClient);

  /** Current filter state (applied) */
  readonly filters = input<FilterState>(EMPTY_FILTERS);
  /** Responsible users options (static, provided by parent) */
  readonly responsibleOptions = input<DropdownOption[]>([]);
  /** Emitted when user clicks Apply */
  readonly filtersChange = output<FilterState>();

  readonly isOpen = signal(false);
  readonly draft = signal<FilterState>(EMPTY_FILTERS);

  // Async search options per field
  readonly clientOptions = signal<DropdownOption[]>([]);
  readonly clientLoading = signal(false);
  readonly vesselOptions = signal<DropdownOption[]>([]);
  readonly vesselLoading = signal(false);
  readonly placeOptions = signal<DropdownOption[]>([]);
  readonly placeLoading = signal(false);
  readonly brokerOptions = signal<DropdownOption[]>([]);
  readonly brokerLoading = signal(false);
  readonly invoicingOptions = signal<DropdownOption[]>([]);
  readonly invoicingLoading = signal(false);

  readonly fieldConfigs: FilterFieldConfig[] = FIELD_CONFIGS;

  readonly activeCount = computed(() => {
    const f = this.filters();
    return Object.values(f).filter((v) => v && v.trim()).length;
  });

  toggle(): void {
    if (this.isOpen()) {
      this.close();
    } else {
      this.draft.set({ ...this.filters() });
      this.isOpen.set(true);
    }
  }

  close(): void {
    this.isOpen.set(false);
  }

  apply(): void {
    this.filtersChange.emit(this.draft());
    this.isOpen.set(false);
  }

  clearAll(): void {
    this.draft.set({ ...EMPTY_FILTERS });
  }

  onFieldChange(key: keyof FilterState, value: string): void {
    this.draft.update((d) => ({ ...d, [key]: value ?? '' }));
  }

  getOptions(key: keyof FilterState): ReturnType<typeof signal<DropdownOption[]>> {
    switch (key) {
      case 'clientId': return this.clientOptions;
      case 'vesselId': return this.vesselOptions;
      case 'placeId': return this.placeOptions;
      case 'brokerId': return this.brokerOptions;
      case 'invoicingCompanyId': return this.invoicingOptions;
      case 'salesRepId': return signal(this.responsibleOptions());
      default: return signal([]);
    }
  }

  getLoading(key: keyof FilterState): ReturnType<typeof signal<boolean>> {
    switch (key) {
      case 'clientId': return this.clientLoading;
      case 'vesselId': return this.vesselLoading;
      case 'placeId': return this.placeLoading;
      case 'brokerId': return this.brokerLoading;
      case 'invoicingCompanyId': return this.invoicingLoading;
      default: return signal(false);
    }
  }

  private searchTimeouts: Record<string, ReturnType<typeof setTimeout> | null> = {};

  async onAsyncSearch(key: keyof FilterState, term: string): Promise<void> {
    const timerKey = String(key);
    if (this.searchTimeouts[timerKey]) clearTimeout(this.searchTimeouts[timerKey]!);
    this.searchTimeouts[timerKey] = setTimeout(() => this.doSearch(key, term), 300);
  }

  private async doSearch(key: keyof FilterState, term: string): Promise<void> {
    try {
      switch (key) {
        case 'clientId': {
          this.clientLoading.set(true);
          const res = await firstValueFrom(
            this.http.get<ApiResponse<{ companies: Array<{ id: string; name: string }> }>>(
              `${API}/companies/local?type=CLIENT&search=${encodeURIComponent(term)}&limit=20`,
            ),
          );
          if (res.success) this.clientOptions.set(res.data.companies.map((c) => ({ value: c.id, label: c.name })));
          this.clientLoading.set(false);
          break;
        }
        case 'vesselId': {
          this.vesselLoading.set(true);
          const res = await firstValueFrom(
            this.http.get<ApiResponse<{ items: Array<{ id: string; name: string }> }>>(
              `${API}/vessels?search=${encodeURIComponent(term)}&limit=20`,
            ),
          );
          if (res.success && res.data?.items) this.vesselOptions.set(res.data.items.map((v) => ({ value: v.id, label: v.name })));
          this.vesselLoading.set(false);
          break;
        }
        case 'placeId': {
          this.placeLoading.set(true);
          const res = await firstValueFrom(
            this.http.get<ApiResponse<{ items: Array<{ id: string; name: string }> }>>(
              `${API}/places?search=${encodeURIComponent(term)}&limit=20`,
            ),
          );
          if (res.success && res.data?.items) this.placeOptions.set(res.data.items.map((p) => ({ value: p.id, label: p.name })));
          this.placeLoading.set(false);
          break;
        }
        case 'brokerId': {
          this.brokerLoading.set(true);
          const res = await firstValueFrom(
            this.http.get<ApiResponse<{ companies: Array<{ id: string; name: string }> }>>(
              `${API}/companies/local?type=BROKER&search=${encodeURIComponent(term)}&limit=20`,
            ),
          );
          if (res.success) this.brokerOptions.set(res.data.companies.map((c) => ({ value: c.id, label: c.name })));
          this.brokerLoading.set(false);
          break;
        }
        case 'invoicingCompanyId': {
          this.invoicingLoading.set(true);
          const res = await firstValueFrom(
            this.http.get<ApiResponse<Array<{ id: string; name: string }>>>(
              `${API}/admin/settings/own-companies`,
            ),
          );
          if (res.success && Array.isArray(res.data)) {
            this.invoicingOptions.set(res.data
              .filter((c) => !term || c.name.toLowerCase().includes(term.toLowerCase()))
              .map((c) => ({ value: c.id, label: c.name })));
          }
          this.invoicingLoading.set(false);
          break;
        }
      }
    } catch { /* ignore search errors */ }
  }
}
