import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import type { SupplierInvoiceDto } from '@fueld/types';
import { ToastService } from '@app/core/ui/toast.service';
import { StatusBadgeComponent } from '@app/shared/components/status-badge/status-badge.component';
import { DateLabelPipe } from '@app/shared/pipes/date-format.pipe';
import { SupplierInvoicesService } from './supplier-invoices.service';

/**
 * Supplier invoices — money owed TO us BY a supplier, raised from the supplier
 * commission report. The API orders them newest first.
 */
@Component({
  selector: 'app-supplier-invoices-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DateLabelPipe, DecimalPipe, RouterLink, StatusBadgeComponent],
  template: `
    <div>
      <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">Supplier Invoices</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-muted">
            Commission funded by suppliers on broker deals, invoiced per supplier and period. Raised from the Supplier Commission report.
          </p>
        </div>
        <div class="flex items-end gap-3">
          <label class="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-ink-dim">
            <input type="checkbox" [checked]="includeVoid()" (change)="onIncludeVoidChange($event)"
              class="rounded border-gray-300 dark:border-line-strong" />
            Include voided
          </label>
          <button (click)="load()" [disabled]="loading()"
            class="rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-3 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint disabled:opacity-50">
            {{ loading() ? 'Loading…' : 'Refresh' }}
          </button>
        </div>
      </div>

      @if (error()) {
        <div class="mb-4 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {{ error() }}
        </div>
      }

      @if (loading() && invoices().length === 0) {
        <div class="flex items-center justify-center py-12">
          <svg class="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else if (invoices().length === 0) {
        <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface py-12 text-center text-sm text-gray-400 dark:text-muted">
          No supplier invoices{{ includeVoid() ? '' : ' (voided ones are hidden — tick “Include voided” to see them)' }}.
          <div class="mt-2">
            <a routerLink="/reports/supplier-commission" class="font-medium text-brand-700 dark:text-brand-400 hover:underline">Raise them from the Supplier Commission report</a>
          </div>
        </div>
      } @else {
        <div class="overflow-x-auto rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200 dark:border-line bg-gray-50/80 dark:bg-surface-2">
                <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">Invoice #</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">Supplier</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">Period</th>
                <th class="px-4 py-3 text-right font-medium text-gray-600 dark:text-ink-dim">Amount</th>
                <th class="px-4 py-3 text-right font-medium text-gray-600 dark:text-ink-dim">Received</th>
                <th class="px-4 py-3 text-right font-medium text-gray-600 dark:text-ink-dim">Outstanding</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">Status</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">Due</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">Created</th>
                <th class="px-4 py-3 w-32"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-line">
              @for (inv of invoices(); track inv.id) {
                <tr class="cursor-pointer transition-colors hover:bg-gray-50/50 dark:hover:bg-surface-tint"
                  [class.opacity-60]="inv.status === 'VOID'"
                  (click)="openDetail(inv)">
                  <td class="px-4 py-3">
                    <a [routerLink]="['/reports/supplier-invoices', inv.id]" (click)="$event.stopPropagation()"
                      class="font-mono text-xs font-medium text-brand-700 dark:text-brand-400 hover:underline">{{ inv.invoiceNumber }}</a>
                  </td>
                  <td class="px-4 py-3 text-gray-900 dark:text-ink">{{ inv.supplierName }}</td>
                  <td class="px-4 py-3 text-xs text-gray-600 dark:text-ink-dim">
                    {{ inv.periodFrom | dateLabel }} – {{ inv.periodTo | dateLabel }}
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums text-gray-900 dark:text-ink">
                    {{ inv.amount | number: '1.2-2' }} {{ inv.currency }}
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-ink-dim">{{ inv.amountReceived | number: '1.2-2' }}</td>
                  <td class="px-4 py-3 text-right tabular-nums" [class]="outstandingClass(inv)">
                    {{ inv.amountOutstanding | number: '1.2-2' }}
                  </td>
                  <td class="px-4 py-3">
                    <app-status-badge [status]="inv.status" />
                  </td>
                  <td class="px-4 py-3 text-xs"
                    [class]="inv.status === 'OVERDUE' ? 'font-medium text-red-700 dark:text-red-400' : 'text-gray-600 dark:text-ink-dim'">
                    {{ inv.dueDate | dateLabel }}
                  </td>
                  <td class="px-4 py-3 text-xs text-gray-500 dark:text-muted">{{ inv.createdAt | dateLabel }}</td>
                  <td class="px-4 py-3 text-right">
                    <button type="button" (click)="downloadPdf(inv, $event)" [disabled]="inv.status === 'VOID' || downloadingId() === inv.id"
                      [title]="inv.status === 'VOID' ? 'A voided invoice cannot be downloaded' : 'Download PDF'"
                      class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-40">
                      {{ downloadingId() === inv.id ? 'Downloading…' : 'Download PDF' }}
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="mt-2 text-xs text-gray-400 dark:text-muted">{{ invoices().length }} invoice(s)</p>
      }
    </div>
  `,
})
export class SupplierInvoicesListPageComponent implements OnInit {
  private readonly api = inject(SupplierInvoicesService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly invoices = signal<SupplierInvoiceDto[]>([]);
  readonly loading = signal(false);
  readonly includeVoid = signal(false);
  readonly error = signal<string | null>(null);
  readonly downloadingId = signal<string | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.invoices.set(await this.api.list({ includeVoid: this.includeVoid() }));
    } catch {
      this.error.set('Failed to load supplier invoices.');
    } finally {
      this.loading.set(false);
    }
  }

  onIncludeVoidChange(event: Event): void {
    this.includeVoid.set((event.target as HTMLInputElement).checked);
    void this.load();
  }

  openDetail(inv: SupplierInvoiceDto): void {
    void this.router.navigate(['/reports/supplier-invoices', inv.id]);
  }

  async downloadPdf(inv: SupplierInvoiceDto, event: Event): Promise<void> {
    event.stopPropagation();
    if (inv.status === 'VOID' || this.downloadingId()) return;
    this.downloadingId.set(inv.id);
    try {
      await this.api.downloadPdf(inv);
    } catch {
      this.toast.error('Failed to download the supplier invoice PDF.');
    } finally {
      this.downloadingId.set(null);
    }
  }

  /**
   * OVERDUE (red) and a merely unpaid balance (amber) must not read alike: the
   * reader acts on one and waits on the other.
   */
  outstandingClass(inv: SupplierInvoiceDto): string {
    if (inv.status === 'VOID') return 'text-gray-400 dark:text-muted line-through';
    if (inv.status === 'OVERDUE') return 'font-semibold text-red-700 dark:text-red-400';
    if (parseFloat(inv.amountOutstanding) > 0) return 'font-medium text-amber-700 dark:text-amber-400';
    return 'text-gray-600 dark:text-ink-dim';
  }
}
