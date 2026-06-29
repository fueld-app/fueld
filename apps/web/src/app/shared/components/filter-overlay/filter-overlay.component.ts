import {
  Component,
  ChangeDetectionStrategy,
  signal,
  input,
  output,
  computed,
  HostListener,
  effect,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SearchableDropdownComponent, type DropdownOption } from '../searchable-dropdown/searchable-dropdown.component';

// ═══════════════════════════════════════════════════════════════════════
//  Filter Overlay — Config-driven, reusable toggleable filter panel
// ═══════════════════════════════════════════════════════════════════════

/** Generic filter state — a map of key→value strings plus a labels map for display. */
export interface FilterState {
  labels: Record<string, string>;
  [key: string]: any;
}

export const EMPTY_FILTERS: FilterState = { labels: {} };

/** Field definition that the parent passes to configure the overlay. */
export interface FilterFieldDef {
  key: string;
  label: string;
  type: 'dropdown' | 'date-range';
  /** Static options for type='dropdown' — parent provides pre-loaded list. */
  options?: DropdownOption[];
  /** Async search function for type='dropdown' — parent provides. */
  searchFn?: (term: string) => Promise<DropdownOption[]>;
}

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
          <path fill-rule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm3.5 2a.75.75 0 000 1.5h7a.75.75 0 000-1.5h-7zM6 10.5A.75.75 0 016.75 10h4.5a.75.75 0 010 1.5h-4.5A.75.75 0 016 10.5z" clip-rule="evenodd" />
        </svg>
        Filters
        @if (activeCount() > 0) {
          <span class="inline-flex items-center justify-center rounded-full bg-brand-600 text-white text-[10px] font-bold min-w-[18px] h-[18px] px-1">{{ activeCount() }}</span>
        }
      </button>

      <!-- Overlay panel -->
      @if (isOpen()) {
        <div class="fixed inset-0 z-40" (click)="close()"></div>
        <div
          class="absolute right-0 z-50 mt-2 w-[calc(100vw-2rem)] max-w-[480px] rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-xl overflow-hidden"
          (keydown.escape)="close()"
        >
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
            <!-- Dropdown fields -->
            @if (dropdownFields().length > 0) {
              <div class="grid grid-cols-2 gap-3">
                @for (field of dropdownFields(); track field.key) {
                  <div>
                    <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-muted">{{ field.label }}</label>
                    <app-searchable-dropdown
                      [placeholder]="'Filter by ' + field.label + '…'"
                      [options]="getOptions(field)()"
                      [selected]="draft()[field.key] ?? ''"
                      [selectedLabel]="draft().labels[field.key] || ''"
                      [loading]="getLoading(field.key)()"
                      [asyncSearch]="!!field.searchFn"
                      [clearable]="true"
                      [minSearchLength]="1"
                      (searchChange)="onAsyncSearch(field, $event)"
                      (selectionChange)="onFieldChange(field.key, $event)"
                    />
                  </div>
                }
              </div>
            }

            <!-- Date range fields -->
            @for (field of dateRangeFields(); track field.key) {
              <div>
                <div class="mb-1 text-xs font-medium text-gray-500 dark:text-muted">{{ field.label }} range</div>
                <div class="grid grid-cols-2 gap-3">
                  <div class="relative">
                    <input
                      type="date"
                      [ngModel]="draft()[field.key + 'From'] || ''"
                      (ngModelChange)="onFieldChange(field.key + 'From', $event)"
                      class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm dark:bg-surface dark:text-ink"
                    />
                    @if (draft()[field.key + 'From']) {
                      <button
                        type="button"
                        (click)="onFieldChange(field.key + 'From', '')"
                        class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-ink-dim"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/>
                        </svg>
                      </button>
                    }
                  </div>
                  <div class="relative">
                    <input
                      type="date"
                      [ngModel]="draft()[field.key + 'To'] || ''"
                      (ngModelChange)="onFieldChange(field.key + 'To', $event)"
                      class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm dark:bg-surface dark:text-ink"
                    />
                    @if (draft()[field.key + 'To']) {
                      <button
                        type="button"
                        (click)="onFieldChange(field.key + 'To', '')"
                        class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-ink-dim"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/>
                        </svg>
                      </button>
                    }
                  </div>
                </div>
              </div>
            }
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-between border-t border-gray-200 dark:border-line px-4 py-3">
            <div class="flex items-center gap-3">
              <button
                type="button"
                (click)="clearAll()"
                class="text-sm font-medium text-gray-600 dark:text-ink-dim hover:text-gray-900 dark:hover:text-ink"
              >
                Clear all
              </button>
              @if (resultCount() !== null) {
                <span class="text-xs text-gray-500 dark:text-muted">
                  @if (resultCount() === -1) { … } @else { {{ resultCount() }} results match }
                </span>
              }
            </div>
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
                [disabled]="applying()"
                class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                @if (applying()) {
                  <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  Applying…
                } @else {
                  Apply
                }
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class FilterOverlayComponent {
  /** Current applied filter state */
  readonly filters = input<FilterState>(EMPTY_FILTERS);
  /** Field definitions — parent configures which fields to show */
  readonly fields = input<FilterFieldDef[]>([]);
  /** Optional count function — parent provides. Returns total matching results. */
  readonly countFn = input<((filters: FilterState) => Promise<number>) | null>(null);
  /** Loading state from parent — disables Apply button while fetching results. */
  readonly applying = input(false);
  /** Emitted when user clicks Apply */
  readonly filtersChange = output<FilterState>();

  readonly isOpen = signal(false);
  readonly draft = signal<FilterState>(EMPTY_FILTERS);

  // Per-field async search state
  readonly asyncOptions = signal<Record<string, DropdownOption[]>>({});
  readonly asyncLoading = signal<Record<string, boolean>>({});

  // Result count: null = no countFn, -1 = loading, >=0 = result count
  readonly resultCount = signal<number | null>(null);
  private countAbort: AbortController | null = null;
  private countTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly dropdownFields = computed(() => this.fields().filter((f) => f.type === 'dropdown'));
  readonly dateRangeFields = computed(() => this.fields().filter((f) => f.type === 'date-range'));

  readonly activeCount = computed(() => {
    const f = this.filters();
    let count = 0;
    for (const [key, val] of Object.entries(f)) {
      if (key === 'labels') continue;
      if (typeof val === 'string' && val?.trim()) count++;
    }
    return count;
  });

  constructor() {
    // Recompute result count when draft changes (debounced)
    effect(() => {
      const d = this.draft();
      const fn = this.countFn();
      if (!fn || !this.isOpen()) return;
      // Suppress count when no filters are active
      if (!this.hasActiveFilters(d)) {
        this.resultCount.set(null);
        return;
      }
      // Debounce
      if (this.countTimeout) clearTimeout(this.countTimeout);
      this.countTimeout = setTimeout(() => {
        this.fetchCount(fn, d);
      }, 500);
    });
  }

  /** Checks if any non-labels values in the state are non-empty strings. */
  private hasActiveFilters(state: FilterState): boolean {
    for (const [key, val] of Object.entries(state)) {
      if (key === 'labels') continue;
      if (typeof val === 'string' && val.trim()) return true;
    }
    return false;
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.isOpen()) this.close();
  }

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
    // Reset async search state
    this.asyncOptions.set({});
    this.asyncLoading.set({});
    this.latestSearchTerms = {};
    // Cancel any pending count request
    if (this.countAbort) {
      this.countAbort.abort();
      this.countAbort = null;
    }
    if (this.countTimeout) {
      clearTimeout(this.countTimeout);
      this.countTimeout = null;
    }
    this.resultCount.set(null);
  }

  apply(): void {
    this.filtersChange.emit(this.draft());
    this.isOpen.set(false);
  }

  clearAll(): void {
    this.draft.set({ labels: {} });
  }

  onFieldChange(key: string, value: string): void {
    this.draft.update((d) => {
      const next = { ...d, [key]: value ?? '' } as FilterState;
      if (value) {
        // Resolve label from field options or async options
        const field = this.fields().find((f) => f.key === key);
        let opts: DropdownOption[] = [];
        if (field?.options) opts = field.options;
        else if (field?.searchFn) opts = this.asyncOptions()[key] ?? [];
        const match = opts.find((o) => o.value === value);
        if (match) next.labels = { ...d.labels, [key]: match.label };
      } else {
        const { [key]: _removed, ...restLabels } = d.labels;
        next.labels = restLabels;
      }
      return next;
    });
  }

  getOptions(field: FilterFieldDef): ReturnType<typeof signal<DropdownOption[]>> {
    if (field.options) return signal(field.options);
    return signal(this.asyncOptions()[field.key] ?? []);
  }

  getLoading(key: string): ReturnType<typeof signal<boolean>> {
    return signal(this.asyncLoading()[key] ?? false);
  }

  private searchTimeouts: Record<string, ReturnType<typeof setTimeout> | null> = {};
  private latestSearchTerms: Record<string, string> = {};

  async onAsyncSearch(field: FilterFieldDef, term: string): Promise<void> {
    const key = field.key;
    if (this.searchTimeouts[key]) clearTimeout(this.searchTimeouts[key]!);
    // Set loading immediately so the dropdown shows a spinner instead of "No results"
    // during the debounce window before doSearch fires.
    this.asyncLoading.update((s) => ({ ...s, [key]: true }));
    this.searchTimeouts[key] = setTimeout(() => this.doSearch(field, term), 300);
  }

  private async doSearch(field: FilterFieldDef, term: string): Promise<void> {
    if (!field.searchFn) return;
    const key = field.key;
    this.latestSearchTerms[key] = term;
    this.asyncLoading.update((s) => ({ ...s, [key]: true }));
    try {
      const opts = await field.searchFn(term);
      // Only apply results if this is still the latest search for this field
      if (this.latestSearchTerms[key] !== term) return;
      this.asyncOptions.update((s) => ({ ...s, [key]: opts }));
    } catch { /* ignore */ } finally {
      if (this.latestSearchTerms[key] === term) {
        this.asyncLoading.update((s) => ({ ...s, [key]: false }));
      }
    }
  }

  private async fetchCount(fn: (filters: FilterState) => Promise<number>, filters: FilterState): Promise<void> {
    // Cancel previous in-flight
    if (this.countAbort) this.countAbort.abort();
    this.countAbort = new AbortController();
    const signal = this.countAbort.signal;
    this.resultCount.set(-1); // loading
    try {
      const count = await fn(filters);
      if (!signal.aborted) this.resultCount.set(count);
    } catch {
      if (!signal.aborted) this.resultCount.set(null);
    }
  }
}