import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import type { PlattsSuggestionsResponseDto } from '@fueld/types';

export interface PlattsSuggestionViewModel {
  key: string;
  productType: string;
  description: string | null;
  matches: PlattsSuggestionsResponseDto['items'][number]['matches'];
}

@Component({
  selector: 'app-order-platts-signals',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold uppercase tracking-wider text-gray-700">Platts Signals</h3>
          <p class="mt-1 text-xs text-gray-500">
            Canonical Platts matches for the current line items.
            @if (meta(); as m) {
              <span>
                Using {{ m.matchedPublicationDate ?? m.requestedPublicationDate }}
                @if (m.usedFallbackReport) {
                  <span>(closest available canonical report)</span>
                }
              </span>
            }
          </p>
        </div>
        <div class="flex items-center gap-2">
          @if (meta()?.reportTitle && meta()?.reportId) {
            <button
              type="button"
              (click)="openReport.emit(meta()!.reportId!)"
              class="inline-flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:border-brand-300 hover:text-brand-700"
            >
              Open source report
            </button>
          }
          <button
            type="button"
            (click)="refresh.emit()"
            [disabled]="loading()"
            class="inline-flex items-center rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ loading() ? 'Refreshing...' : 'Refresh signals' }}
          </button>
        </div>
      </div>

      @if (error(); as err) {
        <div class="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {{ err }}
        </div>
      } @else if (loading() && !items().length) {
        <div class="mt-4 text-sm text-gray-500">Loading Platts matches...</div>
      } @else if (!items().length) {
        <div class="mt-4 text-sm text-gray-500">No Platts suggestions available for the current items yet.</div>
      } @else {
        <div class="mt-4 grid min-h-0 flex-1 gap-3 overflow-y-auto pr-1">
          @for (item of items(); track item.key) {
            <div class="rounded-xl border border-gray-200 p-4">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="text-sm font-semibold text-gray-900">{{ item.productType }}</div>
                  @if (item.description) {
                    <div class="mt-1 text-xs text-gray-500">{{ item.description }}</div>
                  }
                </div>
                <div class="text-[11px] uppercase tracking-wide text-gray-400">{{ item.matches.length }} match{{ item.matches.length === 1 ? '' : 'es' }}</div>
              </div>

              @if (!item.matches.length) {
                <div class="mt-3 text-sm text-gray-500">No canonical Platts entries matched this line item.</div>
              } @else {
                <div class="mt-3 space-y-2">
                  @for (match of item.matches; track match.entryId) {
                    <button
                      type="button"
                      (click)="openReport.emit(match.reportId)"
                      class="block w-full rounded-lg border border-gray-200 px-3 py-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                        <span class="font-semibold text-gray-700">{{ match.company || 'Market' }}</span>
                        @if (match.action) {
                          <span>{{ match.action }}</span>
                        }
                        @if (match.counterparty) {
                          <span>vs {{ match.counterparty }}</span>
                        }
                        @if (match.priceRaw) {
                          <span>{{ match.priceRaw }}</span>
                        }
                        @if (match.quantityRaw) {
                          <span>{{ match.quantityRaw }}</span>
                        }
                      </div>
                      <div class="mt-1 text-sm text-gray-800">{{ match.rawText }}</div>
                      <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                        @if (match.instrument) {
                          <span>{{ match.instrument }}</span>
                        }
                        @if (match.windowLabel) {
                          <span>{{ match.windowLabel }}</span>
                        }
                        @if (match.marketRegion) {
                          <span>{{ match.marketRegion }}</span>
                        }
                        <span>score {{ match.score }}</span>
                      </div>
                    </button>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class OrderPlattsSignalsComponent {
  readonly items = input<PlattsSuggestionViewModel[]>([]);
  readonly meta = input<PlattsSuggestionsResponseDto | null>(null);
  readonly loading = input(false);
  readonly error = input<string | null>(null);

  readonly refresh = output<void>();
  readonly openReport = output<string>();
}
