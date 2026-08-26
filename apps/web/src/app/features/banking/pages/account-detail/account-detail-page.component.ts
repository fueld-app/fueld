import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
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
  imports: [DatePipe, DecimalPipe, RouterLink],
  template: `
    <div class="space-y-6 pb-8">
      <!-- Back link -->
      <a routerLink="/cash" class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-muted dark:hover:text-ink">
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
        <!-- Account header -->
        <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
          <div class="flex items-start justify-between">
            <div>
              <div class="text-xs font-semibold uppercase tracking-wider text-gray-500">{{ account()!.aspsp_name }}</div>
              <h1 class="mt-1 text-2xl font-bold text-gray-900 dark:text-ink">{{ account()!.account_name || account()!.iban || 'Bank Account' }}</h1>
              @if (account()!.iban) {
                <p class="mt-1 font-mono text-sm text-gray-500">{{ account()!.iban }}</p>
              }
            </div>
            <div class="text-right">
              <div class="text-3xl font-bold text-gray-900 dark:text-ink" [class.text-green-600]="isPositive(account()!.balance)">
                {{ account()!.balance | number:'1.2-2' }}
              </div>
              <div class="text-sm text-gray-400">{{ account()!.currency }}</div>
            </div>
          </div>
        </div>

        <!-- Transactions -->
        <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm overflow-hidden">
          <div class="px-5 py-3 border-b border-gray-200 dark:border-line">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim uppercase tracking-wider">Transactions</h3>
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
                    <th class="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Entry Ref</th>
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
                      <td class="px-3 py-2 text-xs text-gray-400 font-mono max-w-[200px] truncate">{{ t.entry_reference || '—' }}</td>
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
export class AccountDetailPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly accountId = signal('');
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly account = signal<AccountDetail | null>(null);
  readonly transactions = signal<BankTransaction[]>([]);

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

  private async loadTransactions(accountId: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<BankTransaction[]>>(`${API}/banking/transactions?accountId=${accountId}&limit=200`),
    );
    if (res.success && res.data) {
      this.transactions.set(res.data);
    }
  }

  isPositive(value: string | number): boolean {
    return Number(value) >= 0;
  }

  navigateToTransaction(t: BankTransaction): void {
    void this.router.navigate(['/cash', this.accountId(), t.id]);
  }
}