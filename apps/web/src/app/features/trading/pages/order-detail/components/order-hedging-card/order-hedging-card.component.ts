import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
} from '@angular/core';
import { DatePipe, DecimalPipe, LowerCasePipe } from '@angular/common';
import type { KantoxHedgeEntryDto, KantoxPositionDto } from '@fueld/types';

/**
 * Order-card FX Hedging block (Kantox Dynamic Hedging®).
 *
 * Read-only. Two things worth knowing before editing the copy:
 *
 *  - Kantox nets entries per value-date bucket, so the rate is a *bucket*
 *    weighted average, not a per-entry rate. It is labelled "indicative"
 *    because per-entry `hedgedRate` was never observed populated in preprod
 *    (the schema allows it; no executed entry has ever been returned to us).
 *  - Past-due open legs are shown as "Value date passed" rather than an
 *    error. Rolls are handled manually by Pierre on the Kantox platform —
 *    nothing here retries or amends.
 */
@Component({
  selector: 'app-order-hedging-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, LowerCasePipe],
  template: `
    <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm h-full max-h-[520px] flex flex-col">
      <div class="flex items-center justify-between gap-4">
        <div>
          <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim uppercase tracking-wider">FX Hedging</h3>
          <p class="mt-1 text-xs text-gray-500 dark:text-muted">
            @if (netRate() !== null) {
              Net position rate: {{ netRate() | number:'1.4-6' }} · indicative
            } @else {
              Dynamic Hedging® — USD margin cover
            }
          </p>
        </div>
        @if (openCount() > 0) {
          <span class="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 dark:bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-300">
            {{ openCount() }} open
          </span>
        }
      </div>

      <div class="mt-4 flex-1 overflow-auto">
        @if (loading()) {
          <p class="text-sm text-gray-400 dark:text-muted">Loading hedges...</p>
        } @else if (hedges().length === 0) {
          <p class="text-sm text-gray-400 dark:text-muted">
            No hedge entries yet. Entries are pushed automatically when an order is confirmed.
          </p>
        } @else {
          <ul class="divide-y divide-gray-100 dark:divide-line">
            @for (hedge of hedges(); track hedge.id) {
              <li class="flex items-start justify-between gap-4 py-3 text-sm">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-semibold text-gray-900 dark:text-ink">{{ hedge.amount | number:'1.2-2' }} {{ hedge.currency }}</span>
                    <span class="text-xs text-gray-500 dark:text-muted">{{ hedge.direction | lowercase }} · {{ hedge.leg }}</span>
                  </div>
                  <div class="mt-0.5 text-xs text-gray-500 dark:text-muted">
                    @if (hedge.valueDate) {
                      Value date {{ hedge.valueDate | date : 'mediumDate' }}
                      @if (isLate(hedge)) {
                        <span class="ml-1 font-semibold text-amber-700 dark:text-amber-400">· value date passed</span>
                      }
                    } @else {
                      No value date
                    }
                  </div>
                  @if (hedge.hedgedRate) {
                    <div class="mt-0.5 text-xs text-gray-600 dark:text-ink-dim">Hedged at {{ hedge.hedgedRate | number:'1.4-6' }}</div>
                  }
                  @if (hedge.errorMessage) {
                    <div class="mt-1 text-xs text-rose-600 dark:text-rose-400">{{ hedge.errorMessage }}</div>
                  }
                </div>
                <span [class]="statusClass(hedge.status)">{{ hedge.status }}</span>
              </li>
            }
          </ul>
        }
      </div>
    </div>
  `,
})
export class OrderHedgingCardComponent {
  readonly hedges = input<KantoxHedgeEntryDto[]>([]);
  readonly positions = input<KantoxPositionDto[]>([]);
  readonly loading = input(false);
  /** Injected for deterministic tests; defaults to the real current date. */
  readonly today = input<string>(new Date().toISOString().slice(0, 10));

  readonly openCount = computed(
    () => this.hedges().filter((h) => h.status === 'SENT' || h.status === 'HEDGED').length,
  );

  /** Amount-weighted net rate across value-date buckets.
   *
   *  Kantox weights each bucket's rate by its amount, so a plain mean of the
   *  buckets would misreport the blended rate whenever bucket sizes differ
   *  (e.g. 100k @ 0.92 + 1k @ 0.85 averages to 0.885, not the true 0.9197).
   *  Falls back to a plain mean only when no bucket reports an amount. */
  readonly netRate = computed(() => {
    const buckets = this.positions()
      .map((p) => ({
        rate: p.weightedAverageRate == null ? null : Number(p.weightedAverageRate),
        amount: p.amount == null ? null : Math.abs(Number(p.amount)),
      }))
      .filter(
        (b): b is { rate: number; amount: number | null } =>
          b.rate !== null && Number.isFinite(b.rate) && b.rate > 0,
      );
    if (buckets.length === 0) return null;

    const weighted = buckets.filter((b) => b.amount !== null && Number.isFinite(b.amount) && b.amount > 0);
    if (weighted.length === 0) {
      return buckets.reduce((sum, b) => sum + b.rate, 0) / buckets.length;
    }
    const totalAmount = weighted.reduce((sum, b) => sum + (b.amount as number), 0);
    return weighted.reduce((sum, b) => sum + b.rate * (b.amount as number), 0) / totalAmount;
  });

  /** Past-due with exposure still open. Mirrors the server's late-payment
   *  flag so the card and the activity log agree. */
  isLate(hedge: KantoxHedgeEntryDto): boolean {
    if (hedge.status !== 'SENT' && hedge.status !== 'HEDGED') return false;
    if (!hedge.valueDate) return false;
    if (hedge.valueDate >= this.today()) return false;
    return Number(hedge.amount) - Number(hedge.cancelledAmount) > 0;
  }

  statusClass(status: KantoxHedgeEntryDto['status']): string {
    const base = 'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold border';
    switch (status) {
      case 'HEDGED':
        return `${base} border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300`;
      case 'CLOSED':
        return `${base} border-gray-200 bg-gray-50 text-gray-600 dark:border-line dark:bg-bg-2 dark:text-ink-dim`;
      case 'FAILED':
        return `${base} border-rose-300 bg-rose-50 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300`;
      case 'CANCELLED':
        return `${base} border-gray-200 bg-gray-50 text-gray-500 dark:border-line dark:bg-bg-2 dark:text-muted`;
      default:
        return `${base} border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300`;
    }
  }
}
