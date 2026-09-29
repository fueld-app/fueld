import {
  Component,
  ChangeDetectionStrategy,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import type { SupplierInvoiceDto } from '@fueld/types';
import { ToastService } from '@app/core/ui/toast.service';
import { StatusBadgeComponent } from '@app/shared/components/status-badge/status-badge.component';
import { DateFormatPipe } from '@app/shared/pipes/date-format.pipe';
import { SupplierInvoicesService } from './supplier-invoices.service';

/**
 * One supplier invoice: the header, the frozen lines it was issued with, the
 * payments booked against it, and the void action. Lines are a snapshot — a
 * later change to the order must not rewrite an issued document, so nothing
 * here is recomputed from the order.
 */
@Component({
  selector: 'app-supplier-invoice-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DateFormatPipe, DecimalPipe, RouterLink, StatusBadgeComponent],
  template: `
    <div>
      <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <a routerLink="/reports/supplier-invoices" class="text-sm font-medium text-brand-700 dark:text-brand-400 hover:underline">← Supplier Invoices</a>
          <div class="mt-2 flex flex-wrap items-center gap-3">
            <h1 class="font-mono text-2xl font-bold text-gray-900 dark:text-ink">{{ invoice()?.invoiceNumber ?? '—' }}</h1>
            @if (invoice(); as inv) {
              <app-status-badge [status]="inv.status" />
            }
          </div>
          <p class="mt-1 text-sm text-gray-500 dark:text-muted">
            Commission owed to us by {{ invoice()?.supplierName ?? '—' }}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button (click)="downloadPdf()" [disabled]="!canDownloadPdf() || downloading()"
            [title]="isVoid() ? 'A voided invoice is kept for audit only and cannot be downloaded' : 'Download PDF'"
            class="rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-40">
            {{ downloading() ? 'Downloading…' : 'Download PDF' }}
          </button>
          @if (invoice() && !isVoid()) {
            <button (click)="voidInvoice()" [disabled]="voiding()"
              class="rounded-lg border border-red-300 dark:border-red-500/40 px-4 py-2 text-sm font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50">
              {{ voiding() ? 'Voiding…' : 'Void Invoice' }}
            </button>
          }
        </div>
      </div>

      @if (error()) {
        <div class="mb-4 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {{ error() }}
        </div>
      }

      @if (isVoid()) {
        <div class="mb-4 rounded-xl border border-gray-300 dark:border-line-strong bg-gray-100 dark:bg-surface-2 px-4 py-3">
          <p class="text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-ink-dim">Voided</p>
          <p class="mt-1 text-sm text-gray-600 dark:text-ink-dim">
            This invoice was voided{{ invoice()?.voidedAt ? ' on ' + (invoice()!.voidedAt | dateFormat) : '' }} and is kept for audit only.
            The number is not reused — a replacement raises a new one.
          </p>
          @if (invoice()?.note) {
            <p class="mt-1 text-xs text-gray-500 dark:text-muted">{{ invoice()!.note }}</p>
          }
        </div>
      }

      @if (loading() && !invoice()) {
        <div class="flex items-center justify-center py-12">
          <svg class="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else if (invoice(); as inv) {
        <!-- Header -->
        <div class="mb-4 rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-4 shadow-sm">
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-muted">Period</p>
              <p class="mt-1 text-sm text-gray-900 dark:text-ink">{{ inv.periodFrom | dateFormat }} – {{ inv.periodTo | dateFormat }}</p>
            </div>
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-muted">Due date</p>
              <p class="mt-1 text-sm" [class]="inv.status === 'OVERDUE' ? 'font-semibold text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-ink'">
                {{ inv.dueDate | dateFormat }}
              </p>
            </div>
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-muted">Issued</p>
              <p class="mt-1 text-sm text-gray-900 dark:text-ink">{{ inv.issuedAt ? (inv.issuedAt | dateFormat) : '—' }}</p>
            </div>
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-muted">Created</p>
              <p class="mt-1 text-sm text-gray-900 dark:text-ink">{{ inv.createdAt | dateFormat }}</p>
            </div>
          </div>

          <div class="mt-4 grid gap-4 border-t border-gray-100 dark:border-line pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-muted">Amount</p>
              <p class="mt-1 text-lg font-bold text-gray-900 dark:text-ink">{{ inv.amount | number: '1.2-2' }} {{ inv.currency }}</p>
            </div>
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-muted">Received</p>
              <p class="mt-1 text-lg font-bold text-gray-900 dark:text-ink">{{ inv.amountReceived | number: '1.2-2' }}</p>
            </div>
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-muted">Outstanding</p>
              <p class="mt-1 text-lg font-bold" [class]="outstandingClass()">{{ inv.amountOutstanding | number: '1.2-2' }} {{ inv.currency }}</p>
            </div>
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-muted">Invoicing company</p>
              <p class="mt-1 text-sm text-gray-900 dark:text-ink">{{ inv.invoicingCompanyName ?? '—' }}</p>
              <p class="text-xs text-gray-500 dark:text-muted">{{ inv.hasBankDetails ? 'Remittance details attached' : 'No bank details' }}</p>
            </div>
          </div>
        </div>

        <!-- Frozen lines -->
        <div class="mb-4 overflow-x-auto rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm">
          <div class="border-b border-gray-100 dark:border-line bg-gray-50 dark:bg-surface-2 px-5 py-3">
            <h2 class="text-sm font-semibold text-gray-700 dark:text-ink-dim">Lines <span class="font-normal text-gray-400 dark:text-muted">(frozen at issue)</span></h2>
          </div>
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-100 dark:border-line">
                <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Order #</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Customer</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Vessel</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Place</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Product</th>
                <th class="px-4 py-2 text-right font-medium text-gray-500 dark:text-muted">Qty</th>
                <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Unit</th>
                <th class="px-4 py-2 text-right font-medium text-gray-500 dark:text-muted">Rate</th>
                <th class="px-4 py-2 text-right font-medium text-gray-500 dark:text-muted">Amount</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50 dark:divide-line">
              @for (line of inv.lines; track line.id) {
                <tr class="hover:bg-gray-50/50 dark:hover:bg-surface-tint">
                  <td class="px-4 py-2 font-mono text-xs text-gray-500 dark:text-muted">{{ line.orderNumber ?? '—' }}</td>
                  <td class="px-4 py-2 text-gray-900 dark:text-ink">{{ line.customerName ?? '—' }}</td>
                  <td class="px-4 py-2 text-gray-600 dark:text-ink-dim">{{ line.vesselName ?? '—' }}</td>
                  <td class="px-4 py-2 text-gray-600 dark:text-ink-dim">{{ line.placeName ?? '—' }}</td>
                  <td class="px-4 py-2 text-gray-600 dark:text-ink-dim">{{ line.productType ?? '—' }}</td>
                  <td class="px-4 py-2 text-right tabular-nums text-gray-600 dark:text-ink-dim">{{ formatQty(line.quantity) }}</td>
                  <td class="px-4 py-2 text-gray-600 dark:text-ink-dim">{{ line.unit ?? '—' }}</td>
                  <td class="px-4 py-2 text-right tabular-nums text-gray-600 dark:text-ink-dim">{{ line.rate ?? '—' }}</td>
                  <td class="px-4 py-2 text-right tabular-nums font-medium text-gray-900 dark:text-ink">
                    {{ line.amount | number: '1.2-2' }} {{ inv.currency }}
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="9" class="px-4 py-6 text-center text-sm text-gray-400 dark:text-muted">No lines on this invoice.</td></tr>
              }
            </tbody>
            <tfoot class="border-t border-gray-100 dark:border-line bg-gray-50/50 dark:bg-surface-2">
              <tr>
                <td colspan="8" class="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-muted">Total</td>
                <td class="px-4 py-2 text-right text-sm font-semibold text-gray-900 dark:text-ink">{{ inv.amount | number: '1.2-2' }} {{ inv.currency }}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <!-- Payments -->
        <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm">
          <div class="border-b border-gray-100 dark:border-line bg-gray-50 dark:bg-surface-2 px-5 py-3">
            <h2 class="text-sm font-semibold text-gray-700 dark:text-ink-dim">Payments</h2>
          </div>
          @if (inv.payments?.length) {
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-100 dark:border-line">
                  <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Date</th>
                  <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Method</th>
                  <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Note</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-500 dark:text-muted">Amount</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50 dark:divide-line">
                @for (payment of inv.payments; track payment.id) {
                  <tr class="hover:bg-gray-50/50 dark:hover:bg-surface-tint">
                    <td class="px-4 py-2 text-gray-600 dark:text-ink-dim">{{ payment.paidAt | dateFormat }}</td>
                    <td class="px-4 py-2 text-gray-600 dark:text-ink-dim">{{ payment.method ?? '—' }}</td>
                    <td class="px-4 py-2 text-gray-600 dark:text-ink-dim">{{ payment.note ?? '—' }}</td>
                    <td class="px-4 py-2 text-right tabular-nums font-medium text-gray-900 dark:text-ink">{{ payment.amount | number: '1.2-2' }} {{ inv.currency }}</td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <div class="px-5 py-6 text-center text-sm text-gray-400 dark:text-muted">No payments recorded against this invoice.</div>
          }
        </div>
      }
    </div>
  `,
})
export class SupplierInvoiceDetailPageComponent {
  private readonly api = inject(SupplierInvoicesService);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);

  private readonly invoiceId = toSignal(
    this.route.paramMap.pipe(map((p) => p.get('id') ?? '')),
    { initialValue: '' },
  );

  readonly invoice = signal<SupplierInvoiceDto | null>(null);
  readonly loading = signal(false);
  readonly downloading = signal(false);
  readonly voiding = signal(false);
  readonly error = signal<string | null>(null);

  readonly isVoid = computed(() => this.invoice()?.status === 'VOID');
  /** The API answers 400 for a voided invoice, so the action is disabled here. */
  readonly canDownloadPdf = computed(() => !!this.invoice() && !this.isVoid());

  readonly outstandingClass = computed(() => {
    const inv = this.invoice();
    if (!inv) return 'text-gray-900 dark:text-ink';
    if (inv.status === 'VOID') return 'text-gray-400 dark:text-muted line-through';
    if (inv.status === 'OVERDUE') return 'text-red-700 dark:text-red-400';
    if (parseFloat(inv.amountOutstanding) > 0) return 'text-amber-700 dark:text-amber-400';
    return 'text-emerald-700 dark:text-emerald-400';
  });

  constructor() {
    // Reading the id from a signal rather than ngOnInit: navigating straight from
    // one invoice to another reuses this component, so ngOnInit would not fire.
    effect(() => {
      const id = this.invoiceId();
      if (id) void this.load(id);
    });
  }

  async load(id: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const invoice = await this.api.get(id);
      if (!invoice) {
        this.error.set('Supplier invoice not found.');
        this.invoice.set(null);
        return;
      }
      this.invoice.set(invoice);
    } catch {
      this.error.set('Failed to load the supplier invoice.');
    } finally {
      this.loading.set(false);
    }
  }

  async downloadPdf(): Promise<void> {
    const inv = this.invoice();
    if (!inv || !this.canDownloadPdf() || this.downloading()) return;
    this.downloading.set(true);
    try {
      await this.api.downloadPdf(inv);
    } catch {
      this.toast.error('Failed to download the supplier invoice PDF.');
    } finally {
      this.downloading.set(false);
    }
  }

  async voidInvoice(): Promise<void> {
    const inv = this.invoice();
    if (!inv || this.isVoid() || this.voiding()) return;
    const reason = window.prompt(
      `Void supplier invoice ${inv.invoiceNumber}?\n\n` +
        'The number is not reused and the lines stay frozen for audit. ' +
        'The period becomes billable again, so a replacement can be raised.',
      '',
    );
    // prompt returns null on cancel; an empty reason is allowed (the API
    // accepts a null reason), so only cancellation aborts.
    if (reason === null) return;

    this.voiding.set(true);
    try {
      await this.api.voidInvoice(inv.id, reason.trim() || null);
      this.toast.success(`Supplier invoice ${inv.invoiceNumber} voided.`);
      await this.load(inv.id);
    } catch {
      this.toast.error('Failed to void the supplier invoice.');
    } finally {
      this.voiding.set(false);
    }
  }

  formatQty(value: string | null): string {
    if (value === null) return '—';
    const num = parseFloat(value);
    if (Number.isNaN(num)) return value;
    return num.toLocaleString('en-US', { maximumFractionDigits: 3 });
  }
}
