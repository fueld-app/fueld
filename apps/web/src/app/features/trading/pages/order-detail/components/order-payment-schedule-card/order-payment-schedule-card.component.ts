import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { InvoiceDueBasis, OrderPaymentScheduleTrancheDto } from '@fueld/types';

/** A row being edited. `percent` is a string because it is a text input. */
interface DraftTranche {
  label: string;
  percent: string;
  dueBasis: InvoiceDueBasis;
  creditDays: string;
  fixedDueDate: string;
}

/**
 * Payment schedule editor (split payment terms).
 *
 * A deal paid "50% CIA and 50% at 21 dd" is two receivables with two due dates,
 * and the customer expects two invoices. Without this screen the only way to set
 * that up was an API call, so the feature was unusable by the trader who asked
 * for it.
 *
 * The percent total is shown continuously: the API refuses anything but 100%,
 * and a trader should see why before saving rather than after.
 */
@Component({
  selector: 'app-order-payment-schedule-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="rounded-xl border border-gray-200 dark:border-line p-4">
      <div class="flex items-center justify-between">
        <p class="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-muted">
          Payment schedule
        </p>
        @if (!locked()) {
          <button
            type="button"
            class="text-xs font-medium text-brand-600 hover:underline"
            (click)="startEditing()"
          >
            {{ editing() ? 'Cancel' : (hasSchedule() ? 'Edit' : 'Split into tranches') }}
          </button>
        }
      </div>

      @if (locked()) {
        <p class="mt-1 text-xs text-amber-600 dark:text-amber-400">
          Tranche invoices have been issued. Void them before changing the schedule.
        </p>
      }

      @if (error()) {
        <p class="mt-2 text-xs text-red-600 dark:text-red-400">{{ error() }}</p>
      }

      @if (editing()) {
        <!-- Editor -->
        @for (row of draft(); track $index) {
          <div class="mt-3 grid grid-cols-12 gap-2 items-end">
            <div class="col-span-4">
              <label class="block text-[10px] text-gray-400 dark:text-muted">Label</label>
              <input
                type="text"
                [ngModel]="row.label"
                (ngModelChange)="updateRow($index, { label: $event })"
                placeholder="Deposit"
                class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-sm bg-white dark:bg-surface"
              />
            </div>
            <div class="col-span-2">
              <label class="block text-[10px] text-gray-400 dark:text-muted">%</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.001"
                [ngModel]="row.percent"
                (ngModelChange)="updateRow($index, { percent: $event })"
                class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-right text-sm bg-white dark:bg-surface"
              />
            </div>
            <div class="col-span-4">
              <label class="block text-[10px] text-gray-400 dark:text-muted">Due</label>
              <select
                [ngModel]="row.dueBasis"
                (ngModelChange)="updateRow($index, { dueBasis: $event })"
                class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-sm bg-white dark:bg-surface"
              >
                @for (opt of dueBasisOptions; track opt.value) {
                  <option [value]="opt.value">{{ opt.label }}</option>
                }
              </select>
            </div>
            <div class="col-span-1">
              @if (row.dueBasis === 'FROM_DELIVERY') {
                <label class="block text-[10px] text-gray-400 dark:text-muted">Days</label>
                <input
                  type="number"
                  min="0"
                  [ngModel]="row.creditDays"
                  (ngModelChange)="updateRow($index, { creditDays: $event })"
                  class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-1 py-1.5 text-right text-sm bg-white dark:bg-surface"
                />
              }
              @if (row.dueBasis === 'FIXED_DATE') {
                <label class="block text-[10px] text-gray-400 dark:text-muted">Date</label>
                <input
                  type="date"
                  [ngModel]="row.fixedDueDate"
                  (ngModelChange)="updateRow($index, { fixedDueDate: $event })"
                  class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-1 py-1.5 text-sm bg-white dark:bg-surface"
                />
              }
            </div>
            <div class="col-span-1 flex justify-end">
              <button
                type="button"
                class="text-xs text-gray-400 hover:text-red-600"
                [disabled]="draft().length <= 1"
                (click)="removeRow($index)"
                title="Remove tranche"
              >✕</button>
            </div>
          </div>
        }

        <div class="mt-3 flex items-center justify-between">
          <button type="button" class="text-xs font-medium text-brand-600 hover:underline" (click)="addRow()">
            + Add tranche
          </button>
          <p
            class="text-xs"
            [class.text-red-600]="!totalsTo100()"
            [class.text-gray-500]="totalsTo100()"
          >
            Total {{ percentTotal() }}%
          </p>
        </div>

        <!-- Preview: what each tranche will actually bill and when -->
        <div class="mt-2 space-y-0.5">
          @for (p of preview(); track $index) {
            <p class="text-xs text-gray-500 dark:text-muted">
              {{ p.label || ('Tranche ' + (p.seq)) }} — {{ p.amount }} {{ currency() }}
              @if (p.dueDate) { <span>due {{ p.dueDate }}</span> }
            </p>
          }
        </div>

        <div class="mt-3 flex items-center gap-2">
          <button
            type="button"
            class="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            [disabled]="saving() || !totalsTo100()"
            (click)="save()"
          >{{ saving() ? 'Saving…' : 'Save schedule' }}</button>
          @if (hasSchedule()) {
            <button
              type="button"
              class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-ink-dim disabled:opacity-50"
              [disabled]="saving()"
              (click)="clear()"
            >Use a single invoice</button>
          }
        </div>
      } @else {
        <!-- Read-only summary -->
        @if (schedule().length === 0) {
          <p class="mt-1 text-sm text-gray-500 dark:text-muted">
            The whole deal is billed as one invoice on the order's payment terms.
          </p>
        } @else {
          <div class="mt-2 space-y-1">
            @for (t of schedule(); track t.id) {
              <div class="flex items-center justify-between text-sm">
                <span class="text-gray-700 dark:text-ink-dim">
                  {{ t.label || ('Tranche ' + t.seq) }}
                  <span class="text-gray-400 dark:text-muted">· {{ asPercent(t.percent) }}%</span>
                  @if (t.invoiceNumber) {
                    <span class="text-gray-400 dark:text-muted">· {{ t.invoiceNumber }}</span>
                  }
                </span>
                <span class="flex items-center gap-2">
                  <span class="text-gray-900 dark:text-ink">
                    {{ t.issuedAmount ?? t.amount }} {{ currency() }}
                    @if (t.issuedDueDate ?? t.dueDate; as due) {
                      <span class="text-gray-400 dark:text-muted">· {{ due }}</span>
                    }
                  </span>
                  @if (t.invoiceId) {
                    <button
                      type="button"
                      class="text-xs font-medium text-brand-600 hover:underline"
                      (click)="viewTrancheInvoice.emit(t)"
                      title="Download this tranche's invoice"
                    >Invoice</button>
                  }
                </span>
              </div>
            }
          </div>
        }
      }
    </div>
  `,
})
export class OrderPaymentScheduleCardComponent {
  readonly schedule = input<OrderPaymentScheduleTrancheDto[]>([]);
  readonly currency = input('USD');
  /** Set when tranche invoices exist: the schedule is frozen until they are voided. */
  readonly locked = input(false);
  readonly saving = input(false);
  /** The order's current lines total, so the preview can show real amounts. */
  readonly orderTotal = input(0);

  readonly saveSchedule = output<DraftTranche[]>();
  readonly clearSchedule = output<void>();
  /** Download/email one tranche's own invoice (split terms issue one each). */
  readonly viewTrancheInvoice = output<OrderPaymentScheduleTrancheDto>();

  readonly dueBasisOptions: { value: InvoiceDueBasis; label: string }[] = [
    { value: 'ON_ISSUE', label: 'On invoice (cash in advance)' },
    { value: 'FROM_DELIVERY', label: 'Delivery + days' },
    { value: 'FIXED_DATE', label: 'Fixed date' },
  ];

  readonly editing = signal(false);
  readonly draft = signal<DraftTranche[]>([]);
  readonly error = signal<string | null>(null);

  readonly hasSchedule = computed(() => this.schedule().length > 0);

  readonly percentTotal = computed(() =>
    this.draft().reduce((sum, row) => sum + (parseFloat(row.percent) || 0), 0),
  );

  /**
   * The API accepts a total within PERCENT_TOLERANCE (0.001) of 100. Match it
   * exactly: a looser check here would let the trader press Save on a schedule
   * the server then rejects, which reads as a broken button.
   */
  private static readonly PERCENT_TOLERANCE = 0.001;
  readonly totalsTo100 = computed(() => Math.abs(this.percentTotal() - 100) <= OrderPaymentScheduleCardComponent.PERCENT_TOLERANCE);

  /**
   * What each draft tranche will bill, computed the same way issuance does
   * (the last tranche absorbs rounding). Shown while editing so the trader sees
   * the split before saving rather than after.
   */
  readonly preview = computed(() => {
    const rows = this.draft();
    const total = this.orderTotal();
    if (total <= 0) return [];
    const percents = rows.map((r) => parseFloat(r.percent) || 0);
    return rows.map((row, index) => {
      const share = index === percents.length - 1
        ? Math.round(total * 100) / 100 - percents
            .slice(0, -1)
            .reduce((sum, pct) => sum + Math.round((total * pct) / 100 * 100) / 100, 0)
        : Math.round((total * percents[index]!) / 100 * 100) / 100;
      return {
        seq: index + 1,
        label: row.label,
        amount: share.toFixed(2),
        dueDate: null as string | null,
      };
    });
  });

  asPercent(percent: string): string {
    const n = parseFloat(percent);
    return Number.isFinite(n) ? String(n) : percent;
  }

  startEditing(): void {
    if (this.editing()) {
      this.editing.set(false);
      this.error.set(null);
      return;
    }
    const existing = this.schedule();
    this.draft.set(
      existing.length > 0
        ? existing.map((t) => ({
            label: t.label ?? '',
            percent: this.asPercent(t.percent),
            dueBasis: t.dueBasis,
            creditDays: t.creditDays == null ? '' : String(t.creditDays),
            fixedDueDate: t.fixedDueDate ?? '',
          }))
        : [
            { label: 'Deposit', percent: '50', dueBasis: 'ON_ISSUE', creditDays: '', fixedDueDate: '' },
            { label: 'Balance', percent: '50', dueBasis: 'FROM_DELIVERY', creditDays: '30', fixedDueDate: '' },
          ],
    );
    this.error.set(null);
    this.editing.set(true);
  }

  updateRow(index: number, patch: Partial<DraftTranche>): void {
    this.draft.update((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  addRow(): void {
    this.draft.update((rows) => [
      ...rows,
      { label: '', percent: '', dueBasis: 'FROM_DELIVERY', creditDays: '', fixedDueDate: '' },
    ]);
  }

  removeRow(index: number): void {
    this.draft.update((rows) => rows.filter((_, i) => i !== index));
  }

  save(): void {
    this.error.set(null);
    if (!this.totalsTo100()) {
      this.error.set(`Tranches must total 100% (currently ${this.percentTotal()}%).`);
      return;
    }
    const rows = this.draft();
    for (const row of rows) {
      if (row.dueBasis === 'FIXED_DATE' && !row.fixedDueDate) {
        this.error.set('Every fixed-date tranche needs a date.');
        return;
      }
      if (row.dueBasis === 'FROM_DELIVERY' && row.creditDays !== '' && (parseFloat(row.creditDays) || 0) < 0) {
        this.error.set('Credit days cannot be negative.');
        return;
      }
    }

    this.saveSchedule.emit(rows);
  }

  clear(): void {
    this.error.set(null);
    this.clearSchedule.emit();
  }

  /** Called by the parent when the API refused the save. */
  showError(message: string): void {
    this.error.set(message);
  }

  /** Called by the parent once a save succeeded. */
  finishEditing(): void {
    this.editing.set(false);
    this.error.set(null);
  }
}
