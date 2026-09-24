import {
  Component, ChangeDetectionStrategy, input, signal, effect, inject, untracked,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, CreditLineDto } from '@fueld/types';
import { API } from '@app/core/config/api';

/**
 * Credit lines held for / by this company, on the company detail page.
 *
 * A company can appear on both sides of the credit book — the same counterparty
 * may be granted customer credit and also extended supplier credit — so both
 * types are fetched and shown, labelled, rather than picking one and hiding the
 * other. The credit team's whole reason for opening a company is usually to
 * check exactly this, and previously the figures only existed on the two credit
 * list pages, meaning a lookup by company name and a lookup by credit line were
 * two different navigation paths.
 *
 * Read-only on purpose: editing lives on the credit pages, which own the
 * create/edit modal and its validation. Duplicating that here would be a second
 * place for the broker-flag / currency rules to drift.
 */
@Component({
  selector: 'app-company-credit-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm">
      <div class="border-b border-gray-100 dark:border-line px-5 py-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <h2 class="text-sm font-semibold text-gray-700 dark:text-ink-dim">Credit Lines</h2>
          @if (lines().length) {
            <span class="inline-flex items-center rounded-full bg-gray-100 dark:bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:text-ink-dim">
              {{ lines().length }}
            </span>
          }
        </div>
        @if (lines().length) {
          <a
            [routerLink]="creditPageRoute()"
            class="text-[11px] font-medium text-brand-700 dark:text-brand-400 hover:underline"
          >Open credit page</a>
        }
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-8">
          <svg class="h-5 w-5 animate-spin text-gray-400 dark:text-muted" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else if (lines().length) {
        <div class="divide-y divide-gray-50 dark:divide-line">
          @for (line of lines(); track line.id) {
            <div class="px-5 py-4">
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                  [class]="line.type === 'CUSTOMER'
                    ? 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400'
                    : 'bg-purple-100 dark:bg-purple-500/15 text-purple-700 dark:text-purple-400'"
                >{{ line.type === 'CUSTOMER' ? 'Customer credit' : 'Supplier credit' }}</span>
                @if (line.isBrokerCreditLine) {
                  <span class="inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">Broker Credit</span>
                }
                @if (line.expires && isExpired(line.expires)) {
                  <span class="inline-flex items-center rounded-full bg-red-100 dark:bg-red-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700 dark:text-red-400">Expired</span>
                }
              </div>

              <div class="mt-3 grid grid-cols-3 gap-3 text-right">
                <div>
                  <p class="text-[10px] uppercase tracking-wide text-gray-400 dark:text-muted">Credit</p>
                  <p class="text-sm font-semibold tabular-nums text-gray-900 dark:text-ink">
                    {{ formatAmount(line.creditAmount, line.currency) }}
                  </p>
                </div>
                <div>
                  <p class="text-[10px] uppercase tracking-wide text-gray-400 dark:text-muted">Used</p>
                  <p
                    class="text-sm tabular-nums"
                    [class]="parseFloat(line.usedAmount) > 0 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-gray-400 dark:text-muted'"
                  >{{ formatAmount(line.usedAmount, line.currency) }}</p>
                </div>
                <div>
                  <p class="text-[10px] uppercase tracking-wide text-gray-400 dark:text-muted">Available</p>
                  <p
                    class="text-sm tabular-nums font-medium"
                    [class]="parseFloat(line.availableAmount) > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
                  >{{ formatAmount(line.availableAmount, line.currency) }}</p>
                </div>
              </div>

              <p class="mt-2 text-[11px] text-gray-400 dark:text-muted">
                {{ line.periodDays }} days
                @if (line.expires) { · expires {{ formatDate(line.expires) }} }
                @if (line.type === 'CUSTOMER' && line.performanceDays !== null) {
                  · {{ line.performanceDays }} days avg to pay
                }
              </p>
              @if (line.notes) {
                <p class="mt-1 text-[11px] whitespace-pre-line text-gray-500 dark:text-muted">{{ line.notes }}</p>
              }
            </div>
          }
        </div>
      } @else {
        <p class="px-5 py-6 text-sm text-gray-400 dark:text-muted">No credit line on file for this company.</p>
      }
    </div>
  `,
})
export class CompanyCreditCardComponent {
  private readonly http = inject(HttpClient);

  readonly companyId = input.required<string>();

  readonly lines = signal<CreditLineDto[]>([]);
  readonly loading = signal(true);

  constructor() {
    // Re-fetch whenever the company changes (same component instance is reused
    // when navigating between companies, so an input-based reload is required).
    effect(() => {
      const id = this.companyId();
      if (!id) return;
      untracked(() => void this.load(id));
    });
  }

  private async load(companyId: string): Promise<void> {
    this.loading.set(true);
    try {
      // One request per side, so the response labels are unambiguous even if a
      // company somehow holds both.
      const [customer, supplier] = await Promise.all([
        firstValueFrom(
          this.http.get<ApiResponse<{ items: CreditLineDto[]; total: number }>>(
            `${API}/credit/lines?type=CUSTOMER&counterpartyId=${encodeURIComponent(companyId)}&limit=50`,
          ),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<{ items: CreditLineDto[]; total: number }>>(
            `${API}/credit/lines?type=SUPPLIER&counterpartyId=${encodeURIComponent(companyId)}&limit=50`,
          ),
        ),
      ]);
      const rows = [
        ...(customer.success ? customer.data?.items ?? [] : []),
        ...(supplier.success ? supplier.data?.items ?? [] : []),
      ];
      // Customer lines first — the company page is reached most often to check
      // what a customer may owe, not what we may owe a supplier.
      rows.sort((a, b) => (a.type === b.type ? 0 : a.type === 'CUSTOMER' ? -1 : 1));
      this.lines.set(rows);
    } catch {
      // Non-critical on this page — the card simply stays empty.
      this.lines.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  /** The credit page for the type this company actually has lines on. */
  creditPageRoute(): string {
    return this.lines()[0]?.type === 'SUPPLIER' ? '/credit/suppliers' : '/credit/customers';
  }

  parseFloat = parseFloat;

  formatDate(dateStr: string): string {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  isExpired(dateStr: string): boolean {
    return new Date(dateStr) < new Date();
  }

  formatAmount(amount: string, currency: string): string {
    const num = parseFloat(amount);
    if (isNaN(num)) return `${currency} 0.00`;
    return `${currency} ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}
