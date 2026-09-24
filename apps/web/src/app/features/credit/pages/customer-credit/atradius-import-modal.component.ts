import {
  Component,
  ChangeDetectionStrategy,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  SearchableDropdownComponent,
  type DropdownOption,
} from '@app/shared/components/searchable-dropdown/searchable-dropdown.component';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API } from '@app/core/config/api';
import type {
  AtradiusImportSummaryDto,
  AtradiusUnmatchedBuyerDto,
  ApiResponse,
} from '@fueld/types';

/**
 * Monthly Atradius policy export upload.
 * Flow: pick file → server parses → review summary + map unmatched buyers →
 * confirm (server already replaced the previous import at parse time; mapping
 * updates rows in place).
 */
@Component({
  selector: 'app-atradius-import-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SearchableDropdownComponent],
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" (click)="close.emit()">
      <div class="w-full max-w-2xl rounded-2xl bg-white dark:bg-surface shadow-xl" (click)="$event.stopPropagation()">
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-gray-100 dark:border-line px-6 py-4">
          <div>
            <h2 class="text-lg font-semibold text-gray-900 dark:text-ink">Upload Atradius file</h2>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-muted">
              Monthly policy export. Uploading replaces the previous cover data.
            </p>
          </div>
          <button (click)="close.emit()" class="rounded-md p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-ink-dim transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
          </button>
        </div>

        <!-- Body -->
        <div class="px-6 py-5">
          @if (!summary()) {
            <label
              class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 dark:border-line-strong px-6 py-10 text-center transition-colors hover:border-brand-500 dark:hover:border-brand-500"
              [class.opacity-50]="busy()"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-gray-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 9.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 7.414V13a1 1 0 11-2 0V7.414L8.707 9.707a1 1 0 01-1.414 0z" clip-rule="evenodd"/></svg>
              <span class="text-sm font-medium text-gray-700 dark:text-ink-dim">
                @if (fileName()) { {{ fileName() }} } @else { Choose the Excel file (.xlsx) }
              </span>
              <span class="text-xs text-gray-400">Columns F (buyer) and AE (coverage) are read automatically</span>
              <input type="file" accept=".xlsx,.xls" class="hidden" (change)="onFileSelected($event)" [disabled]="busy()" />
            </label>

            @if (busy()) {
              <div class="mt-4 flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-muted">
                <svg class="h-4 w-4 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                Parsing file...
              </div>
            }
            @if (error()) {
              <div class="mt-4 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-3 py-2 text-sm text-red-700 dark:text-red-400">{{ error() }}</div>
            }
          } @else {
            <!-- Summary -->
            <div class="grid grid-cols-3 gap-3">
              <div class="rounded-xl bg-gray-50 dark:bg-surface-2 px-4 py-3 text-center">
                <div class="text-2xl font-bold text-gray-900 dark:text-ink">{{ summary()!.rowCount }}</div>
                <div class="text-xs text-gray-500 dark:text-muted">buyer rows</div>
              </div>
              <div class="rounded-xl bg-green-50 dark:bg-green-500/10 px-4 py-3 text-center">
                <div class="text-2xl font-bold text-green-700 dark:text-green-400">{{ summary()!.matchedCount }}</div>
                <div class="text-xs text-gray-500 dark:text-muted">matched</div>
              </div>
              <div class="rounded-xl bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-center">
                <div class="text-2xl font-bold text-amber-700 dark:text-amber-400">{{ summary()!.unmatchedCount }}</div>
                <div class="text-xs text-gray-500 dark:text-muted">need mapping</div>
              </div>
            </div>
            @if (summary()!.replaced) {
              <p class="mt-3 text-xs text-gray-500 dark:text-muted">Previous import replaced.</p>
            }

            @if (unmatched().length > 0) {
              <h3 class="mt-5 text-sm font-semibold text-gray-900 dark:text-ink">Map unmatched buyers</h3>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-muted">
                Pick the Fueld client for each buyer. Mappings are remembered for future uploads.
              </p>
              @if (counterpartiesError()) {
                <div class="mt-2 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  {{ counterpartiesError() }}
                </div>
              }
              <div class="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
                @for (row of unmatched(); track row.id) {
                  <div class="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-line px-3 py-2">
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm font-medium text-gray-900 dark:text-ink">{{ row.buyerName }}</div>
                      <div class="text-xs text-gray-400">#{{ row.buyerNumber }} · {{ row.statusRaw }}</div>
                      @if (suggestions()[row.id]; as hint) {
                        <div class="text-xs text-gray-400">
                          name suggests
                          <button
                            type="button"
                            class="text-brand-600 hover:underline"
                            (click)="acceptSuggestion(row.id, hint.id)"
                          >{{ suggestedName(row.id) }}</button>
                        </div>
                      }
                    </div>
                    <div class="w-[240px] shrink-0">
                      <!-- Searchable typeahead, not a <select>: the client list runs
                           to hundreds and a native select cannot be searched, which
                           made mapping 141 buyers in a row impractical. Options are
                           fetched per search term; a broad term is still capped and
                           the row says so, so typing is what narrows it. -->
                      <app-searchable-dropdown
                        [options]="counterpartyOptions()"
                        [selected]="selections()[row.id] ?? ''"
                        [asyncSearch]="true"
                        [loading]="counterpartySearchLoading()"
                        [clearable]="true"
                        [minSearchLength]="1"
                        placeholder="— not a Fueld client —"
                        (searchChange)="onCounterpartySearch($event)"
                        (selectionChange)="setSelection(row.id, $event)"
                      />
                    </div>
                  </div>
                }
              </div>
            } @else {
              <p class="mt-5 text-sm text-green-700 dark:text-green-400">All buyers matched — nothing to map.</p>
            }

            @if (error()) {
              <div class="mt-3 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-3 py-2 text-sm text-red-700 dark:text-red-400">{{ error() }}</div>
            }
          }
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-end gap-2 border-t border-gray-100 dark:border-line px-6 py-4">
          <button (click)="close.emit()" class="rounded-lg border border-gray-300 dark:border-line-strong px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-2 transition-colors">
            @if (summary()) { Close } @else { Cancel }
          </button>
          @if (summary() && unmatched().length > 0) {
            <button
              (click)="saveMappings()"
              [disabled]="busy()"
              class="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-800 transition-colors disabled:opacity-50"
            >
              {{ busy() ? 'Saving...' : 'Save mappings' }}
            </button>
          }
        </div>
      </div>
    </div>
  `,
})
export class AtradiusImportModalComponent {
  readonly close = output<void>();
  readonly imported = output<void>();

  private readonly http = inject(HttpClient);

  readonly busy = signal(false);
  readonly error = signal('');
  readonly fileName = signal('');
  readonly summary = signal<AtradiusImportSummaryDto | null>(null);
  readonly unmatched = signal<AtradiusUnmatchedBuyerDto[]>([]);
  readonly selections = signal<Record<string, string>>({});
  /**
   * Server name-match suggestions by unmatched row id. Offered as a one-click hint
   * under each row, never applied on its own — the guess is often wrong between
   * differing spellings, and applying it silently puts cover on the wrong client.
   */
  readonly suggestions = signal<Record<string, { id: string; name: string }>>({});
  readonly counterpartyOptions = signal<DropdownOption[]>([]);
  readonly counterpartySearchLoading = signal(false);
  readonly counterpartiesError = signal('');
  /**
   * Options already resolved, so a dropdown keeps showing the name of a choice
   * made earlier even after the search term changes. Without this the selected
   * label would blank out as soon as the list was refiltered.
   */
  private readonly chosenLabels = new Map<string, string>();
  /** Monotonic token guarding against out-of-order search responses. */
  private searchSeq = 0;

  constructor() {
    // Seed with the unfiltered first page so a dropdown opened without typing
    // offers something immediately.
    void this.onCounterpartySearch('');
  }

  /**
   * Typeahead for the counterparty picker.
   *
   * `/companies/local` is PAGINATED — `{ companies, total }`, not a bare array —
   * and reading it as an array is what left the picker empty on Riviera. It has
   * also always been a capped list: 500 rows was a silent truncation for any
   * tenant with more clients, and an unmatchable client is one that can never be
   * mapped. Searching server-side means the options are never a truncated slice.
   */
  async onCounterpartySearch(term: string): Promise<void> {
    // Sequence token: ~150 pickers each fire a search (the component emits '' on
    // open) and keystrokes are debounced but not serialized, so a slow response
    // can land after a newer one and repopulate the list with the wrong options.
    // Only the newest response may write.
    const seq = ++this.searchSeq;
    this.counterpartySearchLoading.set(true);
    this.counterpartiesError.set('');
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ companies: Array<{ id: string; name: string }>; total: number }>>(
          `${API}/companies/local`,
          { params: { type: 'CLIENT', limit: '50', ...(term ? { search: term } : {}) } },
        ),
      );
      if (seq !== this.searchSeq) return; // a newer search superseded this one
      const list = res.data?.companies ?? [];
      // A broad or empty term still returns at most 50; say so rather than
      // pretending the list is complete. Typing narrows it, which is what the
      // search is for.
      const total = res.data?.total ?? list.length;
      if (total > list.length) {
        this.counterpartiesError.set(
          `Showing ${list.length} of ${total} clients — type part of the name to narrow the list.`,
        );
      }
      // Refresh cached labels from the server's own answer, so a client renamed
      // mid-session stops being offered under its old name.
      for (const cp of list) this.chosenLabels.set(cp.id, cp.name);
      const seen = new Set<string>();
      const options: DropdownOption[] = [];
      for (const cp of [...list, ...[...this.chosenLabels].map(([id, label]) => ({ id, name: label }))]) {
        if (seen.has(cp.id)) continue;
        seen.add(cp.id);
        options.push({ value: cp.id, label: cp.name });
      }
      this.counterpartyOptions.set(options);
      if (res.success && list.length === 0 && term) {
        this.counterpartiesError.set(`No Fueld client matches "${term}" — check the client list, or leave it unmapped.`);
      }
    } catch {
      if (seq === this.searchSeq) {
        this.counterpartiesError.set('Could not search the Fueld client list — mapping is unavailable. Reload the page to retry.');
      }
    } finally {
      // Only the latest call clears the spinner; an older one finishing late must
      // not hide the fact that a request is still in flight.
      if (seq === this.searchSeq) this.counterpartySearchLoading.set(false);
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.fileName.set(file.name);
    this.busy.set(true);
    this.error.set('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await firstValueFrom(
        this.http.post<ApiResponse<AtradiusImportSummaryDto>>(`${API}/atradius/import`, form),
      );
      if (!res.success || !res.data) throw new Error(res.message ?? 'Import failed');
      this.summary.set(res.data);
      this.unmatched.set(res.data.unmatched ?? []);
      // Deliberately NOT pre-filling from the server name-match suggestion.
      //
      // A suggestion is a guess between spellings that frequently disagree
      // (`GEFO GESELLSCHAFT FÜROELTRANSPORTE MBH` vs `GEFO Gesellschaft fur
      // Oeltransporte mbH`), and a wrong guess becomes a MANUAL mapping putting
      // one client's insured cover on another — silently, since Save applies
      // whatever is selected. It is offered as a one-click hint instead, so
      // accepting it is an act rather than an omission.
      this.selections.set({});
      // Keep the server's guesses for the one-click hint under each row.
      const hints: Record<string, { id: string; name: string }> = {};
      for (const row of res.data.unmatched ?? []) {
        if (row.suggestedCounterpartyId) {
          hints[row.id] = { id: row.suggestedCounterpartyId, name: row.buyerName };
        }
      }
      this.suggestions.set(hints);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Import failed');
    } finally {
      this.busy.set(false);
      input.value = '';
    }
  }

  /**
   * Accept the server's name-match suggestion. An explicit click, because the
   * guess is often wrong between differing spellings and applying it silently
   * would put cover on the wrong client.
   */
  acceptSuggestion(rowId: string, counterpartyId: string): void {
    this.setSelection(rowId, counterpartyId);
  }

  /** Label for the suggested counterparty, resolved from options or the cache. */
  suggestedName(rowId: string): string {
    const id = this.suggestions()[rowId]?.id;
    if (!id) return '';
    return this.counterpartyOptions().find((o) => o.value === id)?.label
      ?? this.chosenLabels.get(id)
      ?? 'suggested client';
  }

  setSelection(rowId: string, counterpartyId: string): void {
    this.selections.update((s) => ({ ...s, [rowId]: counterpartyId }));
    const label = this.counterpartyOptions().find((o) => o.value === counterpartyId)?.label;
    if (label) this.chosenLabels.set(counterpartyId, label);
    this.counterpartiesError.set('');
  }

  async saveMappings(): Promise<void> {
    // Guard re-entry: the button is disabled while busy, but a click landing in
    // the gap before the re-render would otherwise run the whole 150-PUT loop
    // twice.
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      for (const row of this.unmatched()) {
        const counterpartyId = this.selections()[row.id] || null;
        await firstValueFrom(
          this.http.put(`${API}/atradius/buyers/match`, {
            buyerNumber: row.buyerNumber,
            counterpartyId,
          }),
        );
      }
      this.imported.emit();
      this.close.emit();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to save mappings');
    } finally {
      this.busy.set(false);
    }
  }
}