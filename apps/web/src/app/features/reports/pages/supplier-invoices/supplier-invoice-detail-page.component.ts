import {
  Component,
  ChangeDetectionStrategy,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
  imports: [DateFormatPipe, DecimalPipe, FormsModule, RouterLink, StatusBadgeComponent],
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
          @if (invoice()?.sentAt) {
            <p class="mt-1 text-xs text-gray-400 dark:text-muted">
              Sent {{ invoice()!.sentAt | dateFormat }} to {{ invoice()!.sentTo }}
            </p>
          }
        </div>
        <div class="flex flex-wrap gap-2">
          <button (click)="downloadPdf()" [disabled]="!canDownloadPdf() || downloading()"
            [title]="isVoid() ? 'A voided invoice is kept for audit only and cannot be downloaded' : 'Download PDF'"
            class="rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-40">
            {{ downloading() ? 'Downloading…' : 'Download PDF' }}
          </button>
          @if (invoice() && !isVoid()) {
            <button (click)="openSendModal()" [disabled]="sending()"
              class="rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-40">
              {{ sending() ? 'Sending…' : 'Send' }}
            </button>
          }
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
            <h2 class="text-sm font-semibold text-gray-700 dark:text-ink-dim">Receipts from the supplier</h2>
          </div>
          @if (inv.receipts?.length) {
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-100 dark:border-line">
                  <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Date</th>
                  <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Method</th>
                  <th class="px-4 py-2 text-left font-medium text-gray-500 dark:text-muted">Note</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-500 dark:text-muted">Amount</th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50 dark:divide-line">
                @for (receipt of inv.receipts; track receipt.id) {
                  <tr class="hover:bg-gray-50/50 dark:hover:bg-surface-tint">
                    <td class="px-4 py-2 text-gray-600 dark:text-ink-dim">{{ receipt.receivedAt | dateFormat }}</td>
                    <td class="px-4 py-2 text-gray-600 dark:text-ink-dim">{{ receipt.method ?? '—' }}</td>
                    <td class="px-4 py-2 text-gray-600 dark:text-ink-dim">{{ receipt.note ?? '—' }}</td>
                    <td class="px-4 py-2 text-right tabular-nums font-medium text-gray-900 dark:text-ink">{{ receipt.amount | number: '1.2-2' }} {{ inv.currency }}</td>
                    <td class="px-4 py-2 text-right">
                      <button (click)="removeReceipt(receipt.id)" [disabled]="busy() || inv.status === 'VOID'"
                        class="text-xs text-red-600 hover:text-red-700 disabled:opacity-40">Remove</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <div class="px-5 py-6 text-center text-sm text-gray-400 dark:text-muted">No receipts recorded against this invoice.</div>
          }

          @if (inv.status !== 'VOID' && parseFloat(inv.amountOutstanding) > 0) {
            <div class="border-t border-gray-100 dark:border-line px-5 py-4">
              <h3 class="text-xs font-semibold text-gray-500 dark:text-muted mb-2">Record a receipt</h3>
              <div class="flex flex-wrap items-end gap-2">
                <div>
                  <label class="block text-xs text-gray-500 dark:text-muted mb-1">Amount</label>
                  <input type="number" step="0.01" min="0" [ngModel]="receiptAmount()" (ngModelChange)="receiptAmount.set($any($event))"
                    class="w-28 rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-right text-sm tabular-nums" />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 dark:text-muted mb-1">Method</label>
                  <input type="text" [ngModel]="receiptMethod()" (ngModelChange)="receiptMethod.set($any($event))" placeholder="Bank transfer"
                    class="w-40 rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-sm" />
                </div>
                <button (click)="addReceipt()" [disabled]="busy() || !receiptAmount()"
                  class="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                  Add receipt
                </button>
                <p class="text-xs text-gray-400 dark:text-muted">In {{ inv.currency }} — a receipt in another currency is refused.</p>
              </div>
            </div>
          }
        </div>
      }
    </div>

    @if (sendModalOpen()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div class="mx-4 w-full max-w-lg rounded-xl bg-white dark:bg-surface p-6 shadow-xl">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-ink">Send invoice {{ invoice()?.invoiceNumber ?? '' }}</h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-muted">Commission owed to us by {{ invoice()?.supplierName ?? '—' }}.</p>

          <form class="mt-4 space-y-4" (ngSubmit)="send()">
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-ink-dim">To</label>
              <input type="text" name="sendTo" [ngModel]="sendTo()" (ngModelChange)="sendTo.set($any($event))"
                placeholder="billing@supplier.com"
                class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm" />
              <p class="mt-1 text-xs text-gray-400 dark:text-muted">
                Leave blank to use the supplier's billing address on file. Separate multiple addresses with commas.
              </p>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-ink-dim">CC</label>
              <input type="text" name="sendCc" [ngModel]="sendCc()" (ngModelChange)="sendCc.set($any($event))"
                placeholder="optional"
                class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-ink-dim">Subject</label>
              <input type="text" name="sendSubject" [ngModel]="sendSubject()" (ngModelChange)="sendSubject.set($any($event))"
                placeholder="optional"
                class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm" />
              <p class="mt-1 text-xs text-gray-400 dark:text-muted">Leave blank to use the default subject.</p>
            </div>
            <p class="text-xs text-gray-400 dark:text-muted">
              The invoice PDF ({{ invoice()?.invoiceNumber ?? '' }}) is attached automatically.
            </p>

            @if (sendValidationError()) {
              <div class="rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                {{ sendValidationError() }}
              </div>
            }
            @if (sendError()) {
              <div class="rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                {{ sendError() }}
              </div>
            }
            @if (sendSuccess()) {
              <div class="rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/15 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
                {{ sendSuccess() }}
              </div>
            }
            @if (sendWarning()) {
              <div class="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                {{ sendWarning() }}
              </div>
            }

            <div class="flex justify-end gap-2 pt-2">
              <button type="button" (click)="closeSendModal()" [disabled]="sending()"
                class="rounded-lg border border-gray-300 dark:border-line-strong px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint disabled:opacity-50">
                Close
              </button>
              <button type="submit" [disabled]="sending()"
                class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {{ sending() ? 'Sending…' : 'Send' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    }
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
  readonly busy = signal(false);
  readonly receiptAmount = signal('');
  readonly receiptMethod = signal('');
  readonly error = signal<string | null>(null);

  // Send modal. `sending` is separate from `busy` so a receipt form's state does
  // not disable the dialog, and the dialog's in-flight state does not lock the page.
  readonly sendModalOpen = signal(false);
  readonly sending = signal(false);
  readonly sendTo = signal('');
  readonly sendCc = signal('');
  readonly sendSubject = signal('');
  readonly sendValidationError = signal<string | null>(null);
  readonly sendError = signal<string | null>(null);
  readonly sendSuccess = signal<string | null>(null);
  readonly sendWarning = signal<string | null>(null);

  readonly isVoid = computed(() => this.invoice()?.status === 'VOID');

  /** Money received from the supplier against this invoice. */
  async addReceipt(): Promise<void> {
    const invoice = this.invoice();
    if (!invoice || this.busy()) return;
    this.busy.set(true);
    try {
      const updated = await this.api.addReceipt(invoice.id, {
        amount: this.receiptAmount(),
        currency: invoice.currency,
        method: this.receiptMethod() || null,
      });
      if (updated) {
        this.invoice.set(updated);
        this.receiptAmount.set('');
        this.receiptMethod.set('');
        this.toast.success('Receipt recorded');
      }
    } catch (err) {
      // A currency mismatch or a voided invoice is a user-fixable state, and the
      // API's message says which.
      this.toast.error(err instanceof Error ? err.message : 'Could not record the receipt');
    } finally {
      this.busy.set(false);
    }
  }

  async removeReceipt(receiptId: string): Promise<void> {
    const invoice = this.invoice();
    if (!invoice || this.busy()) return;
    this.busy.set(true);
    try {
      const updated = await this.api.deleteReceipt(invoice.id, receiptId);
      if (updated) this.invoice.set(updated);
    } catch {
      this.toast.error('Could not remove the receipt');
    } finally {
      this.busy.set(false);
    }
  }

  /** Exposed for the template's outstanding check. */
  parseFloat(value: string): number {
    return Number.parseFloat(value) || 0;
  }
  /** The API answers 400 for a voided invoice, so the action is disabled here. */
  readonly canDownloadPdf = computed(() => !!this.invoice() && !this.isVoid());

  openSendModal(): void {
    this.sendTo.set('');
    this.sendCc.set('');
    this.sendSubject.set('');
    this.sendValidationError.set(null);
    this.sendError.set(null);
    this.sendSuccess.set(null);
    this.sendWarning.set(null);
    this.sendModalOpen.set(true);
  }

  closeSendModal(): void {
    if (this.sending()) return;
    this.sendModalOpen.set(false);
  }

  /** Splits a comma/semicolon-separated list; blank entries are dropped, not sent. */
  private static parseAddressList(raw: string): string[] {
    return raw
      .split(/[,;]/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }

  async send(): Promise<void> {
    const inv = this.invoice();
    if (!inv || this.sending() || this.isVoid()) return;

    const recipients = SupplierInvoiceDetailPageComponent.parseAddressList(this.sendTo());
    const ccs = SupplierInvoiceDetailPageComponent.parseAddressList(this.sendCc());
    const invalid = [...recipients, ...ccs].find((addr) => !addr.includes('@'));
    if (invalid) {
      this.sendValidationError.set(`“${invalid}” is not a valid email address.`);
      this.sendSuccess.set(null);
      this.sendWarning.set(null);
      this.sendError.set(null);
      return;
    }

    this.sendValidationError.set(null);
    this.sendError.set(null);
    this.sendSuccess.set(null);
    this.sendWarning.set(null);
    this.sending.set(true);
    try {
      const res = await this.api.send(inv.id, {
        recipientEmails: recipients.length ? recipients : undefined,
        ccEmails: ccs.length ? ccs : undefined,
        subject: this.sendSubject().trim() || undefined,
      });

      if (res.success && res.data) {
        const via = res.data.channel === 'GRAPH' ? 'Microsoft 365' : res.data.channel;
        this.sendSuccess.set(`Sent to ${res.data.sentTo.join(', ')} via ${via}.`);
        if (res.tokenExpiredWarning) this.sendWarning.set(res.tokenExpiredWarning);
        // The API stamps the send (sentAt / sentTo) on the invoice, so refetch:
        // the header line then shows the server's timestamp and the recipients it
        // actually resolved (a blank To means the billing address on file).
        // Sending does not otherwise change the invoice; the success box stays.
        try {
          const refreshed = await this.api.get(inv.id);
          if (refreshed) this.invoice.set(refreshed);
        } catch {
          // The send succeeded; a failed refresh must not be reported as one.
        }
      } else {
        this.sendError.set(res.message || 'Failed to send invoice');
        if (res.tokenExpiredWarning) this.sendWarning.set(res.tokenExpiredWarning);
      }
    } catch (err) {
      // The API answers 400 with a message naming the supplier when there is no
      // address on file — surface it verbatim.
      this.sendError.set(apiMessage(err) || 'Failed to send invoice');
    } finally {
      this.sending.set(false);
    }
  }

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

/** The API's `message` on an error body (HttpErrorResponse) or an Error's text. */
function apiMessage(err: unknown): string | null {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === 'object' && 'error' in err) {
    const body: unknown = err.error;
    if (body && typeof body === 'object' && 'message' in body) {
      const message: unknown = body.message;
      if (typeof message === 'string' && message.trim()) return message;
    }
  }
  return null;
}
