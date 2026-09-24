import {
  Component,
  ChangeDetectionStrategy,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API } from '@app/core/config/api';
import type {
  AtradiusImportSummaryDto,
  AtradiusUnmatchedBuyerDto,
  ApiResponse,
} from '@fueld/types';

interface CompanySearchResult {
  source: 'local' | 'seasearcher';
  localId?: string;
  seasearcherId?: string;
  name: string;
  country?: string | null;
}

/**
 * Monthly Atradius policy export upload.
 * Flow: pick file → server parses → review summary + map unmatched buyers →
 * confirm (server already replaced the previous import at parse time; mapping
 * updates rows in place).
 */
@Component({
  selector: 'app-atradius-import-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
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
                    </div>
                    <select
                      class="max-w-[220px] rounded-md border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-2 py-1.5 text-xs text-gray-700 dark:text-ink-dim"
                      [ngModel]="selections()[row.id] ?? row.suggestedCounterpartyId ?? ''"
                      (ngModelChange)="setSelection(row.id, $event)"
                    >
                      <option value="">— not a Fueld client —</option>
                      @for (cp of counterparties(); track cp.id) {
                        <option [value]="cp.id">{{ cp.name }}</option>
                      }
                    </select>
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
  readonly counterparties = signal<Array<{ id: string; name: string }>>([]);
  readonly counterpartiesError = signal('');

  constructor() {
    void this.loadCounterparties();
  }

  /**
   * Load the Fueld clients the unmatched buyers can be mapped to.
   *
   * `/companies/local` is a PAGINATED list — its payload is `{ companies, total }`,
   * not a bare array. Reading it as an array left the dropdown with nothing to
   * render (the exact "empty select" reported on Riviera), so the shape is now
   * matched and a failure is surfaced instead of swallowed: an empty mapping box
   * with no explanation is worse than an error message.
   */
  private async loadCounterparties(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ companies: Array<{ id: string; name: string }>; total: number }>>(
          `${API}/companies/local`,
          { params: { type: 'CLIENT', limit: '500' } },
        ),
      );
      const list = res.data?.companies ?? [];
      this.counterparties.set(list);
      if (res.success && list.length === 0) {
        this.counterpartiesError.set('No Fueld clients were returned — check the client list before mapping.');
      }
    } catch {
      this.counterpartiesError.set('Could not load the Fueld client list — mapping is unavailable. Reload the page to retry.');
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
      const selections: Record<string, string> = {};
      for (const row of res.data.unmatched ?? []) {
        if (row.suggestedCounterpartyId) selections[row.id] = row.suggestedCounterpartyId;
      }
      this.selections.set(selections);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Import failed');
    } finally {
      this.busy.set(false);
      input.value = '';
    }
  }

  setSelection(rowId: string, counterpartyId: string): void {
    this.selections.update((s) => ({ ...s, [rowId]: counterpartyId }));
  }

  async saveMappings(): Promise<void> {
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