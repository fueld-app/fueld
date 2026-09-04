import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { API } from '@app/core/config/api';
import { AuthService } from '@app/core/auth';

interface ApiResponse<T> { success: boolean; data: T; message?: string; }

interface CashTotal { currency: string; total_balance: string; account_count: number; }
interface CashAccount { aspsp_name: string; aspsp_country: string; status: string; last_synced_at: string | null; iban: string | null; account_name: string | null; balance: string; currency: string; account_id: string; }
interface BankTransaction {
  id: string;
  booking_date: string;
  value_date: string | null;
  amount: string;
  currency: string;
  credit_debit_indicator: string;
  debtor_name: string | null;
  debtor_account_iban: string | null;
  debtor_account_bban: string | null;
  debtor_agent: string | null;
  creditor_name: string | null;
  creditor_account_iban: string | null;
  creditor_account_bban: string | null;
  creditor_agent: string | null;
  remittance_info: string | null;
  remittance_info_structured: string | null;
  payment_reference: string | null;
  reference_number: string | null;
  reference_number_schema: string | null;
  bank_transaction_code: string | null;
  bank_transaction_code_description: string | null;
  balance_after_amount: string | null;
  balance_after_currency: string | null;
  entry_reference: string | null;
  status: string | null;
  transaction_date: string | null;
  additional_info: string | null;
  aspsp_name: string;
  account_id: string;
}

@Component({
  selector: 'app-cash-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, RouterLink],
  template: `
    <div class="space-y-6 pb-8">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">Cash &amp; Banking</h1>
          <p class="text-sm text-gray-500 dark:text-muted mt-1">Real-time balances across all connected banks</p>
        </div>
        <button type="button" (click)="syncNow()" [disabled]="syncing()"
          class="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-800 disabled:opacity-50">
          @if (syncing()) {
            <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            Syncing…
          } @else {
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            Sync now
          }
          </button>
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-20 text-gray-400">
          <svg class="animate-spin h-8 w-8" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>
      } @else if (error()) {
        <div class="rounded-lg bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-600 dark:text-red-400">{{ error() }}</div>
      } @else if (totals().length === 0 && accounts().length === 0) {
        <div class="text-center py-20">
          <svg class="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V4.5c0-.621.504-1.125 1.125-1.125h7.875c.621 0 1.125.504 1.125 1.125v8.25"/>
          </svg>
          <p class="mt-4 text-sm text-gray-500">No bank accounts connected yet.</p>
          @if (auth.isAdmin()) {
            <a routerLink="/banking-setup" class="mt-2 inline-block text-sm text-brand-600 hover:underline">
              Set up Enable Banking →
            </a>
          }
        </div>
      } @else {
        <!-- Total Cash on Hand -->
        @if (totals().length > 0) {
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            @for (t of totals(); track t.currency) {
              <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
                <div class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-muted">{{ t.currency }} Total</div>
                <div class="mt-2 text-3xl font-bold text-gray-900 dark:text-ink">
                  {{ t.total_balance | number:'1.2-2' }}
                  <span class="text-lg font-normal text-gray-400">{{ t.currency }}</span>
                </div>
                <div class="mt-1 text-xs text-gray-400">{{ t.account_count }} account(s)</div>
              </div>
            }
          </div>
        }

        <!-- Bank Accounts -->
        <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm overflow-hidden">
          <div class="px-5 py-3 border-b border-gray-200 dark:border-line">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim uppercase tracking-wider">Bank Accounts</h3>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200 dark:divide-line">
              <thead class="bg-gray-50 dark:bg-surface-dim">
                <tr>
                  <th class="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Bank</th>
                  <th class="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Account</th>
                  <th class="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">IBAN</th>
                  <th class="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Balance</th>
                  <th class="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Ccy</th>
                  <th class="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Last Synced</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-line">
                @for (a of accounts(); track a.account_id + a.currency) {
                  <tr class="cursor-pointer hover:bg-gray-50 dark:hover:bg-surface-dim" (click)="navigateToAccount(a)">
                    <td class="px-4 py-2 text-sm font-medium text-gray-900 dark:text-ink">{{ a.aspsp_name }}</td>
                    <td class="px-4 py-2 text-sm text-gray-600 dark:text-muted">{{ a.account_name || '—' }}</td>
                    <td class="px-4 py-2 text-sm text-gray-500 dark:text-muted font-mono">{{ a.iban || '—' }}</td>
                    <td class="px-4 py-2 text-sm font-semibold text-right" [class.text-green-600]="isPositive(a.balance)">{{ a.balance | number:'1.2-2' }}</td>
                    <td class="px-4 py-2 text-sm text-gray-600 dark:text-muted">{{ a.currency }}</td>
                    <td class="px-4 py-2 text-sm text-gray-400">{{ a.last_synced_at | date:'short' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>

        <!-- Recent Transactions -->
        <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm overflow-hidden">
          <div class="px-5 py-3 border-b border-gray-200 dark:border-line">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim uppercase tracking-wider">Recent Transactions</h3>
          </div>
          @if (transactions().length === 0) {
            <div class="px-5 py-8 text-center text-sm text-gray-400">No transactions synced yet.</div>
          } @else {
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200 dark:divide-line">
                <thead class="bg-gray-50 dark:bg-surface-dim">
                  <tr>
                    <th class="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Date</th>
                    <th class="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Bank</th>
                    <th class="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Account</th>
                    <th class="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Counterparty</th>
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
                      <td class="px-3 py-2 text-sm text-gray-600 dark:text-muted whitespace-nowrap">{{ t.aspsp_name }}</td>
                      <td class="px-3 py-2 text-sm text-gray-500 dark:text-muted font-mono text-xs">{{ getAccountIban(t.account_id) || t.account_id.slice(0, 8) + '…' }}</td>
                      <td class="px-3 py-2 text-sm text-gray-700 dark:text-ink">{{ t.creditor_name || t.debtor_name || t.additional_info || '—' }}</td>
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
          }
        </div>
      }
    </div>
  `,
})
export class CashPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly syncing = signal(false);
  readonly totals = signal<CashTotal[]>([]);
  readonly accounts = signal<CashAccount[]>([]);
  readonly transactions = signal<BankTransaction[]>([]);

  ngOnInit(): void {
    this.loadData();
  }

  async loadData(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await Promise.all([this.loadOverview(), this.loadTransactions()]);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Failed to load banking data');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadOverview(): Promise<void> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<{ totals: CashTotal[]; accounts: CashAccount[] }>>(`${API}/banking/overview`),
    );
    if (res.success && res.data) {
      this.totals.set(res.data.totals);
      this.accounts.set(res.data.accounts);
    }
  }

  private async loadTransactions(): Promise<void> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<{ transactions: BankTransaction[]; total: number; hasMore: boolean }>>(`${API}/banking/transactions?limit=50`),
    );
    if (res.success && res.data?.transactions) {
      this.transactions.set(res.data.transactions);
    } else {
      this.transactions.set([]);
    }
  }

  async syncNow(): Promise<void> {
    this.syncing.set(true);
    try {
      await firstValueFrom(this.http.post<ApiResponse<any>>(`${API}/banking/sync`, {}));
      await this.loadData();
    } catch (e: any) {
      this.error.set(e?.message ?? 'Sync failed');
    } finally {
      this.syncing.set(false);
    }
  }

  navigateToAccount(account: CashAccount): void {
    void this.router.navigate(['/cash', account.account_id]);
  }

  navigateToTransaction(t: BankTransaction): void {
    void this.router.navigate(['/cash', t.account_id, t.id]);
  }

  getAccountIban(accountId: string): string | null {
    const acc = this.accounts().find((a) => a.account_id === accountId);
    return acc?.iban ?? null;
  }

  isPositive(value: string | number): boolean {
    return Number(value) >= 0;
  }
}