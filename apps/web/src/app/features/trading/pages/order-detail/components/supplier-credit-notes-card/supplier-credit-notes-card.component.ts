import { Component, ChangeDetectionStrategy, input, output, computed } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import type { SupplierCreditNoteDto } from '@fueld/types';

/**
 * Supplier credit notes card (Phase 2 credit-note support).
 * Lists credits for the whole order across supplier legs. Expected credits
 * are informational; received credits reduce net profit (see P&L card).
 */
@Component({
  selector: 'app-supplier-credit-notes-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe],
  template: `
    <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm h-full">
      <div class="flex items-center justify-between gap-4">
        <div>
          <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim uppercase tracking-wider">Supplier Credit Notes</h3>
          <p class="mt-1 text-xs text-gray-500 dark:text-muted">
            Money back from suppliers
            @if (receivedTotal() > 0) {
              · Received: <strong class="text-emerald-600 dark:text-emerald-400">−{{ receivedTotal() | number:'1.2-2' }} {{ orderCurrency() }}</strong>
            }
            @if (expectedTotal() > 0) {
              · Expected: {{ expectedTotal() | number:'1.2-2' }} {{ orderCurrency() }}
            }
          </p>
        </div>
        @if (canEdit()) {
          <button
            type="button"
            (click)="addCredit.emit()"
            class="inline-flex items-center justify-center rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold
                   text-white shadow-sm transition-colors hover:bg-brand-800 disabled:opacity-50"
          >
            Add credit note
          </button>
        }
      </div>

      <div class="mt-4">
        @if (loading()) {
          <p class="text-sm text-gray-400 dark:text-muted">Loading credit notes…</p>
        } @else if (credits().length === 0) {
          <p class="text-sm text-gray-400 dark:text-muted">No supplier credit notes recorded.</p>
        } @else {
          <ul class="divide-y divide-gray-100 dark:divide-line">
            @for (credit of credits(); track credit.id) {
              <li class="flex items-start justify-between gap-4 py-3 text-sm">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-semibold text-gray-900 dark:text-ink">
                      −{{ credit.amount }} {{ credit.currency }}
                    </span>
                    <span
                      class="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                      [class]="statusBadgeClass(credit.status)"
                    >
                      {{ credit.status }}
                    </span>
                  </div>
                  <div class="mt-0.5 text-xs text-gray-500 dark:text-muted">
                    {{ credit.supplierName || 'Supplier' }}
                    @if (credit.supplierReference) { · ref {{ credit.supplierReference }} }
                    · {{ credit.creditDate | date : 'mediumDate' }}
                    · {{ reasonLabel(credit.reason) }}
                    @if (credit.currency !== orderCurrency() && credit.amountInOrderCurrency) {
                      · ≈ {{ credit.amountInOrderCurrency | number:'1.2-2' }} {{ orderCurrency() }}
                    }
                  </div>
                  @if (credit.note) {
                    <div class="mt-1 text-xs text-gray-600 dark:text-ink-dim whitespace-pre-line">{{ credit.note }}</div>
                  }
                </div>
                @if (canEdit() && credit.status !== 'CANCELLED') {
                  <div class="flex shrink-0 flex-col items-end gap-1">
                    @if (credit.status === 'EXPECTED') {
                      <button
                        type="button"
                        (click)="markReceived.emit(credit.id)"
                        class="text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                      >
                        Mark received
                      </button>
                    }
                    <button
                      type="button"
                      (click)="cancelCredit.emit(credit.id)"
                      class="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    >
                      Cancel
                    </button>
                  </div>
                }
              </li>
            }
          </ul>
        }
      </div>
    </div>
  `,
})
export class SupplierCreditNotesCardComponent {
  readonly credits = input<SupplierCreditNoteDto[]>([]);
  readonly orderCurrency = input('USD');
  readonly loading = input(false);
  readonly canEdit = input(false);

  readonly addCredit = output<void>();
  readonly markReceived = output<string>();
  readonly cancelCredit = output<string>();

  readonly receivedTotal = computed(() =>
    this.credits()
      .filter((c) => c.status === 'RECEIVED')
      .reduce((sum, c) => sum + (parseFloat(c.amountInOrderCurrency ?? c.amount) || 0), 0),
  );

  readonly expectedTotal = computed(() =>
    this.credits()
      .filter((c) => c.status === 'EXPECTED')
      .reduce((sum, c) => sum + (parseFloat(c.amountInOrderCurrency ?? c.amount) || 0), 0),
  );

  statusBadgeClass(status: string): string {
    switch (status) {
      case 'RECEIVED':
        return 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400';
      case 'CANCELLED':
        return 'bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-muted line-through';
      default:
        return 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400';
    }
  }

  reasonLabel(reason: string): string {
    return reason
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
}