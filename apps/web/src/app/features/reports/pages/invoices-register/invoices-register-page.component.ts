import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, InvoiceRegisterDto } from '@fueld/types';
import { API_URL } from '@app/core/config/api';

/**
 * Invoice register — every issued invoice, paid and unpaid.
 *
 * Exists because neither of the two nearby views answers "have we sent that bill,
 * and what is it called?": Reports → Invoice Aging shows only what is still owed
 * (an invoice with nothing outstanding is not collectible, so it has no bucket to
 * sit in), and Trading → Invoiced Orders lists ORDERS. A settled invoice had
 * nowhere to be found until this page.
 *
 * Opt-in per tenant; the API refuses with 403 when it is off, so the page shows
 * that rather than an empty table that looks like missing data.
 */
@Component({
  selector: 'app-invoices-register-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, FormsModule, RouterLink],
  template: `
    <div>
      <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">Invoices</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-muted">
            Every issued invoice — paid and unpaid — with the order it belongs to.
          </p>
        </div>
        <div class="flex items-end gap-3">
          <button (click)="exportXlsx()" [disabled]="loading() || !data()"
            class="rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-3 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint disabled:opacity-50">
            Export Excel
          </button>
          <button (click)="load()" [disabled]="loading()"
            class="rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-3 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint disabled:opacity-50">
            {{ loading() ? 'Loading…' : 'Refresh' }}
          </button>
        </div>
      </div>

      <!-- Filters -->
      <div class="mb-4 flex flex-wrap items-end gap-3">
        <label class="flex flex-col gap-1 text-xs text-gray-500 dark:text-muted">
          Search
          <input [(ngModel)]="search" (ngModelChange)="onFilterChange()" placeholder="invoice, order, customer, vessel"
            class="rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-3 py-1.5 text-sm text-gray-800 dark:text-ink" />
        </label>
        <label class="flex flex-col gap-1 text-xs text-gray-500 dark:text-muted">
          Status
          <select [(ngModel)]="status" (ngModelChange)="onFilterChange()"
            class="rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-3 py-1.5 text-sm text-gray-800 dark:text-ink">
            <option value="ALL">All</option>
            <option value="OPEN">Open (unpaid)</option>
            <option value="PAID">Paid</option>
            <option value="VOID">Voided</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-xs text-gray-500 dark:text-muted">
          Due from
          <input type="date" [(ngModel)]="from" (ngModelChange)="onFilterChange()"
            class="rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-3 py-1.5 text-sm text-gray-800 dark:text-ink" />
        </label>
        <label class="flex flex-col gap-1 text-xs text-gray-500 dark:text-muted">
          Due to
          <input type="date" [(ngModel)]="to" (ngModelChange)="onFilterChange()"
            class="rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-3 py-1.5 text-sm text-gray-800 dark:text-ink" />
        </label>
      </div>

      @if (notEnabled()) {
        <div class="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          The invoice register is not enabled for this account. Ask us to switch it on.
        </div>
      } @else if (error()) {
        <div class="rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {{ error() }}
        </div>
      } @else if (data(); as d) {
        <!-- Totals -->
        <div class="mb-4 grid gap-3 sm:grid-cols-4">
          @for (card of summaryCards(d); track card.label) {
            <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface px-4 py-3 shadow-sm">
              <div class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-muted">{{ card.label }}</div>
              <div class="mt-1 text-lg font-semibold text-gray-900 dark:text-ink">{{ card.value }}</div>
            </div>
          }
        </div>

        <div class="overflow-hidden rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 dark:bg-bg-2">
                <tr class="border-b border-gray-100 dark:border-line">
                  <th class="px-4 py-3 text-left font-medium text-gray-500 dark:text-muted">Invoice</th>
                  <th class="px-4 py-3 text-left font-medium text-gray-500 dark:text-muted">Order</th>
                  <th class="px-4 py-3 text-left font-medium text-gray-500 dark:text-muted">Customer</th>
                  <th class="px-4 py-3 text-left font-medium text-gray-500 dark:text-muted">Vessel</th>
                  <th class="px-4 py-3 text-left font-medium text-gray-500 dark:text-muted">Issued</th>
                  <th class="px-4 py-3 text-left font-medium text-gray-500 dark:text-muted">Due</th>
                  <th class="px-4 py-3 text-left font-medium text-gray-500 dark:text-muted">Status</th>
                  <th class="px-4 py-3 text-right font-medium text-gray-500 dark:text-muted">Amount</th>
                  <th class="px-4 py-3 text-right font-medium text-gray-500 dark:text-muted">Outstanding</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50 dark:divide-line">
                @for (row of d.rows; track row.invoiceId) {
                  <tr class="hover:bg-gray-50/50 dark:hover:bg-surface-tint" [class.opacity-60]="row.status === 'VOID'">
                    <td class="px-4 py-3">
                      <a [routerLink]="['/trading/orders', row.orderId]"
                        class="font-medium text-brand-700 dark:text-brand-400 hover:underline">{{ row.invoiceNumber }}</a>
                      @if (row.trancheLabel) {
                        <div class="text-xs text-gray-400 dark:text-muted">{{ row.trancheLabel }}</div>
                      }
                    </td>
                    <td class="px-4 py-3 text-gray-600 dark:text-ink-dim">{{ row.orderNumber ?? '—' }}</td>
                    <td class="px-4 py-3 text-gray-800 dark:text-ink">{{ row.clientName }}</td>
                    <td class="px-4 py-3 text-gray-600 dark:text-ink-dim">{{ row.vesselName }}</td>
                    <td class="px-4 py-3 text-gray-600 dark:text-ink-dim">{{ row.issuedAt | date: 'dd MMM yyyy' }}</td>
                    <td class="px-4 py-3 text-gray-600 dark:text-ink-dim">{{ row.dueDate | date: 'dd MMM yyyy' }}</td>
                    <td class="px-4 py-3">
                      <span class="rounded-full px-2 py-0.5 text-xs font-medium" [class]="statusClass(row.status)">
                        {{ statusLabel(row.status) }}
                      </span>
                    </td>
                    <td class="px-4 py-3 text-right text-gray-800 dark:text-ink">{{ row.amount | number: '1.2-2' }}</td>
                    <td class="px-4 py-3 text-right font-medium text-gray-900 dark:text-ink">
                      {{ row.outstandingAmount | number: '1.2-2' }}
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="9" class="px-4 py-8 text-center text-sm text-gray-500 dark:text-muted">
                      No invoices matched these filters.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      } @else if (loading()) {
        <div class="py-10 text-center text-sm text-gray-400 dark:text-muted">Loading…</div>
      }
    </div>
  `,
})
export class InvoicesRegisterPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly data = signal<InvoiceRegisterDto | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Distinct from an empty result: the feature is off for this tenant. */
  readonly notEnabled = signal(false);

  search = '';
  status = 'ALL';
  from = '';
  to = '';

  /** `undefined`, not `null`: clearTimeout's lib type rejects null even though it no-ops. */
  private debounce: ReturnType<typeof setTimeout> | undefined;

  readonly queryString = computed(() => {
    const params = new URLSearchParams();
    if (this.search.trim()) params.set('q', this.search.trim());
    if (this.status && this.status !== 'ALL') params.set('status', this.status);
    if (this.from) params.set('from', this.from);
    if (this.to) params.set('to', this.to);
    return params.toString();
  });

  ngOnInit(): void {
    void this.load();
  }

  /** Typing should not fire a request per keystroke. */
  onFilterChange(): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.load(), 250);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const qs = this.queryString();
      const res = await firstValueFrom(
        this.http.get<ApiResponse<InvoiceRegisterDto>>(`${API_URL}/reports/invoices${qs ? `?${qs}` : ''}`),
      );
      if (res.success && res.data) {
        this.data.set(res.data);
        this.notEnabled.set(false);
      } else {
        this.error.set(res.message ?? 'Failed to load invoices.');
      }
    } catch (err) {
      // 403 is the tenant gate, not a fault — say so plainly instead of showing
      // a red error for a feature that is simply switched off.
      const http = err as HttpErrorResponse;
      if (http?.status === 403) {
        this.notEnabled.set(true);
        this.data.set(null);
      } else {
        this.error.set('Failed to load invoices.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  exportXlsx(): void {
    const qs = this.queryString();
    // A plain navigation rather than an HTTP call: the endpoint sets
    // Content-Disposition, so the browser handles the download and the token
    // rides on the cookie the API already accepts.
    window.open(`${API_URL}/reports/invoices/export.xlsx${qs ? `?${qs}` : ''}`, '_blank');
  }

  summaryCards(d: InvoiceRegisterDto): Array<{ label: string; value: string }> {
    return [
      { label: 'Invoices', value: String(d.totals.invoices) },
      { label: 'Issued', value: this.money(d.totals.totalIssued) },
      { label: 'Paid', value: this.money(d.totals.totalPaid) },
      { label: 'Outstanding', value: this.money(d.totals.totalOutstanding) },
    ];
  }

  private money(value: string): string {
    return Number(value).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  statusLabel(status: string): string {
    return status === 'PARTIALLY_PAID' ? 'Part paid' : status.charAt(0) + status.slice(1).toLowerCase();
  }

  statusClass(status: string): string {
    if (status === 'PAID') return 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-400';
    if (status === 'VOID') return 'bg-gray-200 text-gray-600 dark:bg-surface-3 dark:text-muted';
    if (status === 'OVERDUE') return 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-400';
    if (status === 'PARTIALLY_PAID') return 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400';
    return 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-400';
  }
}
