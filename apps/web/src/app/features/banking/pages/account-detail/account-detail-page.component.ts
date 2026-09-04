import { Component, ChangeDetectionStrategy, inject, signal, OnInit, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { API } from '@app/core/config/api';

interface ApiResponse<T> { success: boolean; data: T; message?: string; }

interface AccountDetail {
  aspsp_name: string;
  aspsp_country: string;
  iban: string | null;
  account_name: string | null;
  balance: string;
  currency: string;
  account_id: string;
  status: string;
  last_synced_at: string | null;
}

interface BankTransaction {
  id: string;
  booking_date: string;
  amount: string;
  currency: string;
  credit_debit_indicator: string;
  debtor_name: string | null;
  creditor_name: string | null;
  debtor_account_iban: string | null;
  creditor_account_iban: string | null;
  debtor_account_bban: string | null;
  creditor_account_bban: string | null;
  remittance_info: string | null;
  remittance_info_structured: string | null;
  payment_reference: string | null;
  reference_number: string | null;
  balance_after_amount: string | null;
  entry_reference: string | null;
  additional_info: string | null;
  bank_transaction_code: string | null;
}

@Component({
  selector: 'app-account-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, RouterLink, FormsModule],
  template: `
    <div class="space-y-6 pb-8">
      <a [routerLink]="['/cash']" class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-muted dark:hover:text-ink">
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
        </svg>
        Back to Cash Dashboard
      </a>

      @if (loading()) {
        <div class="flex items-center justify-center py-20 text-gray-400">
          <svg class="animate-spin h-8 w-8" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>
      } @else if (error()) {
        <div class="rounded-lg bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-600 dark:text-red-400">{{ error() }}</div>
      } @else if (account()) {
        @let acc = account()!;

        <!-- Account header -->
        <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
          <div class="flex items-start justify-between">
            <div>
              <div class="text-xs font-semibold uppercase tracking-wider text-gray-500">{{ acc.aspsp_name }}</div>
              <h1 class="mt-1 text-2xl font-bold text-gray-900 dark:text-ink">{{ acc.account_name || acc.iban || 'Bank Account' }}</h1>
              @if (acc.iban) {
                <p class="mt-1 font-mono text-sm text-gray-500">{{ acc.iban }}</p>
              }
            </div>
            <div class="text-right">
              <div class="text-3xl font-bold text-gray-900 dark:text-ink" [class.text-green-600]="isPositive(acc.balance)">
                {{ acc.balance | number:'1.2-2' }}
              </div>
              <div class="text-sm text-gray-400">{{ acc.currency }}</div>
            </div>
          </div>
        </div>

        <!-- Transactions -->
        <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm overflow-hidden">
          <div class="px-5 py-3 border-b border-gray-200 dark:border-line flex items-center justify-between flex-wrap gap-3">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim uppercase tracking-wider">Transactions</h3>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xs text-gray-400">Filter:</span>
              <input type="date" [ngModel]="dateFrom()" (ngModelChange)="dateFrom.set($event)"
                class="rounded-lg border border-gray-300 dark:border-line px-2 py-1 text-xs dark:bg-surface" placeholder="From" />
              <span class="text-xs text-gray-400">→</span>
              <input type="date" [ngModel]="dateTo()" (ngModelChange)="dateTo.set($event)"
                class="rounded-lg border border-gray-300 dark:border-line px-2 py-1 text-xs dark:bg-surface" placeholder="To" />
              <button type="button" (click)="applyDateFilter()"
                class="px-2 py-1 text-xs rounded-lg bg-brand-700 text-white hover:bg-brand-800">Apply</button>
              @if (dateFrom() || dateTo()) {
                <button type="button" (click)="clearDateFilter()"
                  class="px-2 py-1 text-xs text-gray-500 hover:text-gray-700">Clear</button>
              }
              <span class="text-xs text-gray-400 ml-2">Showing {{ txnStart() }}–{{ txnEnd() }} of {{ txnTotal() }}</span>
            </div>
          </div>

          @if (transactions().length === 0) {
            <div class="px-5 py-8 text-center text-sm text-gray-400">No transactions for this account.</div>
          } @else {
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200 dark:divide-line">
                <thead class="bg-gray-50 dark:bg-surface-dim">
                  <tr>
                    <th class="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Date</th>
                    <th class="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Counterparty</th>
                    <th class="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Account</th>
                    <th class="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Amount</th>
                    <th class="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Ccy</th>
                    <th class="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Balance</th>
                    <th class="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Reference</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-line">
                  @for (t of transactions(); track t.id) {
                    <tr class="cursor-pointer hover:bg-gray-50 dark:hover:bg-surface-dim" (click)="navigateToTransaction(t)">
                      <td class="px-3 py-2 text-sm text-gray-600 dark:text-muted whitespace-nowrap">{{ t.booking_date | date:'mediumDate' }}</td>
                      <td class="px-3 py-2 text-sm text-gray-700 dark:text-ink">{{ t.creditor_name || t.debtor_name || t.additional_info || '—' }}</td>
                      <td class="px-3 py-2 text-sm text-gray-500 dark:text-muted font-mono text-xs">{{ t.creditor_account_iban || t.debtor_account_iban || t.creditor_account_bban || t.debtor_account_bban || '—' }}</td>
                      <td class="px-3 py-2 text-sm font-medium text-right whitespace-nowrap"
                        [class.text-green-600]="t.credit_debit_indicator === 'credit' || t.credit_debit_indicator === 'CRDT'"
                        [class.text-red-600]="t.credit_debit_indicator === 'debit' || t.credit_debit_indicator === 'DBIT'">
                        {{ (t.credit_debit_indicator === 'credit' || t.credit_debit_indicator === 'CRDT') ? '+' : '-' }}{{ t.amount | number:'1.2-2' }}
                      </td>
                      <td class="px-3 py-2 text-sm text-gray-600 dark:text-muted">{{ t.currency }}</td>
                      <td class="px-3 py-2 text-sm text-gray-500 dark:text-muted text-right whitespace-nowrap">{{ t.balance_after_amount ? (t.balance_after_amount | number:'1.2-2') : '—' }}</td>
                      <td class="px-3 py-2 text-sm text-gray-500 dark:text-muted max-w-xs truncate">{{ t.remittance_info || t.remittance_info_structured || t.reference_number || t.payment_reference || '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <!-- Pagination -->
            <div class="px-5 py-3 border-t border-gray-200 dark:border-line flex items-center justify-between flex-wrap gap-3">
              <div class="flex items-center gap-2">
                <span class="text-xs text-gray-400">Page size:</span>
                <select [ngModel]="txnPageSize()" (ngModelChange)="changePageSize($event)"
                  class="rounded-lg border border-gray-300 dark:border-line px-2 py-1 text-xs dark:bg-surface">
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
                <span class="text-xs text-gray-400">per page</span>
              </div>

              <div class="flex items-center gap-1">
                <button type="button" (click)="goToPage(1)" [disabled]="txnPage() === 1"
                  class="px-2 py-1 text-xs rounded border border-gray-300 dark:border-line disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-surface-dim">«</button>
                <button type="button" (click)="goToPage(txnPage() - 1)" [disabled]="txnPage() === 1"
                  class="px-2 py-1 text-xs rounded border border-gray-300 dark:border-line disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-surface-dim">‹</button>

                @for (p of pageNumbers(); track p) {
                  @if (p === -1) {
                    <span class="px-1 text-xs text-gray-400">…</span>
                  } @else {
                    <button type="button" (click)="goToPage(p)"
                      class="px-2.5 py-1 text-xs rounded border"
                      [class.bg-brand-700]="p === txnPage()" [class.text-white]="p === txnPage()" [class.border-brand-700]="p === txnPage()"
                      [class.border-gray-300]="p !== txnPage()" [class.dark:border-line]="p !== txnPage()"
                      [class.hover.bg-gray-50]="p !== txnPage()">{{ p }}</button>
                  }
                }

                <button type="button" (click)="goToPage(txnPage() + 1)" [disabled]="txnPage() === totalPages()"
                  class="px-2 py-1 text-xs rounded border border-gray-300 dark:border-line disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-surface-dim">›</button>
                <button type="button" (click)="goToPage(totalPages())" [disabled]="txnPage() === totalPages()"
                  class="px-2 py-1 text-xs rounded border border-gray-300 dark:border-line disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-surface-dim">»</button>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class AccountDetailPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly accountId = signal('');
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly account = signal<AccountDetail | null>(null);
  readonly transactions = signal<BankTransaction[]>([]);

  // Pagination
  readonly txnPage = signal(1);
  readonly txnPageSize = signal(50);
  readonly txnTotal = signal(0);
  readonly txnHasMore = signal(false);

  // Date filter
  readonly dateFrom = signal('');
  readonly dateTo = signal('');

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.txnTotal() / this.txnPageSize())));
  readonly txnStart = computed(() => this.txnTotal() === 0 ? 0 : (this.txnPage() - 1) * this.txnPageSize() + 1);
  readonly txnEnd = computed(() => Math.min(this.txnPage() * this.txnPageSize(), this.txnTotal()));

  // Page number buttons (show max 7 pages with ellipsis)
  readonly pageNumbers = computed(() => {
    const total = this.totalPages();
    const current = this.txnPage();
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages: number[] = [];
    pages.push(1);
    if (current > 3) pages.push(-1); // ellipsis
    for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
      pages.push(i);
    }
    if (current < total - 2) pages.push(-1); // ellipsis
    pages.push(total);
    return pages;
  });

  ngOnInit(): void {
    const accountId = this.route.snapshot.paramMap.get('accountId');
    this.accountId.set(accountId ?? '');
    if (accountId) {
      this.loadData(accountId);
    }
  }

  async loadData(accountId: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await Promise.all([this.loadAccount(accountId), this.loadTransactions(accountId)]);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Failed to load account data');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadAccount(accountId: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<{ accounts: AccountDetail[] }>>(`${API}/banking/overview`),
    );
    if (res.success && res.data) {
      const acc = res.data.accounts.find((a) => a.account_id === accountId);
      if (acc) {
        this.account.set(acc);
      } else {
        this.error.set('Account not found');
      }
    }
  }

  async loadTransactions(accountId: string): Promise<void> {
    const offset = (this.txnPage() - 1) * this.txnPageSize();
    const limit = this.txnPageSize();
    let url = `${API}/banking/transactions?accountId=${accountId}&limit=${limit}&offset=${offset}`;
    if (this.dateFrom()) url += `&dateFrom=${this.dateFrom()}`;
    if (this.dateTo()) url += `&dateTo=${this.dateTo()}`;
    const res = await firstValueFrom(
      this.http.get<ApiResponse<{ transactions: BankTransaction[]; total: number; hasMore: boolean }>>(url),
    );
    if (res.success && res.data) {
      this.transactions.set(res.data.transactions);
      this.txnTotal.set(res.data.total);
      this.txnHasMore.set(res.data.hasMore);
    }
  }

  applyDateFilter(): void {
    this.txnPage.set(1);
    this.loadTransactions(this.accountId());
  }

  clearDateFilter(): void {
    this.dateFrom.set('');
    this.dateTo.set('');
    this.txnPage.set(1);
    this.loadTransactions(this.accountId());
  }

  goToPage(page: number): void {
    const clamped = Math.max(1, Math.min(page, this.totalPages()));
    if (clamped === this.txnPage()) return;
    this.txnPage.set(clamped);
    this.loadTransactions(this.accountId());
  }

  changePageSize(size: string | number): void {
    this.txnPageSize.set(Number(size));
    this.txnPage.set(1);
    this.loadTransactions(this.accountId());
  }

  isPositive(value: string | number): boolean {
    return Number(value) >= 0;
  }

  navigateToTransaction(t: BankTransaction): void {
    void this.router.navigate(['/cash', this.accountId(), t.id]);
  }
}