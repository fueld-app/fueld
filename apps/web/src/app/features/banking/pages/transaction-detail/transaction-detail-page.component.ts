import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { API } from '@app/core/config/api';

interface ApiResponse<T> { success: boolean; data: T; message?: string; }

interface Transaction {
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
  debtor_organisation_id: string | null;
  creditor_name: string | null;
  creditor_account_iban: string | null;
  creditor_account_bban: string | null;
  creditor_agent: string | null;
  creditor_organisation_id: string | null;
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
  exchange_rate: string | null;
  merchant_category_code: string | null;
  note: string | null;
  aspsp_name: string;
  account_id: string;
}

@Component({
  selector: 'app-transaction-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, RouterLink],
  template: `
    <div class="space-y-6 pb-8">
      <a [routerLink]="['/cash', accountId()]" class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-muted dark:hover:text-ink">
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
        </svg>
        Back to Account
      </a>

      @if (loading()) {
        <div class="flex items-center justify-center py-20 text-gray-400">
          <svg class="animate-spin h-8 w-8" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>
      } @else if (!txn()) {
        <div class="rounded-lg bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-600 dark:text-red-400">Transaction not found.</div>
      } @else {
        @let t = txn()!;

        <!-- Header -->
        <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
          <div class="flex items-start justify-between">
            <div>
              <div class="text-xs font-semibold uppercase tracking-wider text-gray-500">{{ t.aspsp_name }}</div>
              <h1 class="mt-1 text-2xl font-bold text-gray-900 dark:text-ink">
                {{ (t.credit_debit_indicator === 'CRDT' || t.credit_debit_indicator === 'credit') ? '+' : '-' }}{{ t.amount | number:'1.2-2' }}
                <span class="text-lg font-normal text-gray-400">{{ t.currency }}</span>
              </h1>
              <p class="mt-1 text-sm text-gray-500">{{ t.booking_date | date:'fullDate' }}</p>
            </div>
            <div class="text-right">
              <div class="text-xs font-semibold uppercase tracking-wider text-gray-500">Balance After</div>
              <div class="mt-1 text-xl font-bold text-gray-900 dark:text-ink">{{ t.balance_after_amount ? (t.balance_after_amount | number:'1.2-2') : '—' }}</div>
              <div class="text-sm text-gray-400">{{ t.balance_after_currency || t.currency }}</div>
            </div>
          </div>
        </div>

        <!-- Details Grid -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <!-- Transaction Info -->
          <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
            <h3 class="mb-3 text-sm font-semibold text-gray-700 dark:text-ink-dim uppercase tracking-wider">Transaction Info</h3>
            <dl class="space-y-2">
              <div class="flex justify-between">
                <dt class="text-sm text-gray-500">Booking Date</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-ink">{{ t.booking_date | date:'mediumDate' }}</dd>
              </div>
              @if (t.value_date) {
                <div class="flex justify-between">
                  <dt class="text-sm text-gray-500">Value Date</dt>
                  <dd class="text-sm font-medium text-gray-900 dark:text-ink">{{ t.value_date | date:'mediumDate' }}</dd>
                </div>
              }
              @if (t.transaction_date) {
                <div class="flex justify-between">
                  <dt class="text-sm text-gray-500">Transaction Date</dt>
                  <dd class="text-sm font-medium text-gray-900 dark:text-ink">{{ t.transaction_date | date:'mediumDate' }}</dd>
                </div>
              }
              <div class="flex justify-between">
                <dt class="text-sm text-gray-500">Status</dt>
                <dd class="text-sm font-medium text-gray-900 dark:text-ink">{{ t.status || '—' }}</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-sm text-gray-500">Type</dt>
                <dd class="text-sm font-medium" [class.text-green-600]="t.credit_debit_indicator === 'CRDT' || t.credit_debit_indicator === 'credit'" [class.text-red-600]="t.credit_debit_indicator === 'DBIT' || t.credit_debit_indicator === 'debit'">
                  {{ (t.credit_debit_indicator === 'CRDT' || t.credit_debit_indicator === 'credit') ? 'Credit (Incoming)' : 'Debit (Outgoing)' }}
                </dd>
              </div>
              @if (t.bank_transaction_code) {
                <div class="flex justify-between">
                  <dt class="text-sm text-gray-500">Bank Transaction Code</dt>
                  <dd class="text-sm font-medium font-mono text-gray-900 dark:text-ink">{{ t.bank_transaction_code }}</dd>
                </div>
              }
              @if (t.bank_transaction_code_description) {
                <div class="flex justify-between">
                  <dt class="text-sm text-gray-500">Code Description</dt>
                  <dd class="text-sm font-medium text-gray-900 dark:text-ink">{{ t.bank_transaction_code_description }}</dd>
                </div>
              }
              @if (t.merchant_category_code) {
                <div class="flex justify-between">
                  <dt class="text-sm text-gray-500">MCC</dt>
                  <dd class="text-sm font-medium text-gray-900 dark:text-ink">{{ t.merchant_category_code }}</dd>
                </div>
              }
            </dl>
          </div>

          <!-- Counterparty -->
          <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
            <h3 class="mb-3 text-sm font-semibold text-gray-700 dark:text-ink-dim uppercase tracking-wider">Counterparty</h3>
            <dl class="space-y-2">
              @if (t.debtor_name) {
                <div class="flex justify-between">
                  <dt class="text-sm text-gray-500">Debtor (Sender)</dt>
                  <dd class="text-sm font-medium text-gray-900 dark:text-ink">{{ t.debtor_name }}</dd>
                </div>
              }
              @if (t.debtor_account_iban) {
                <div class="flex justify-between">
                  <dt class="text-sm text-gray-500">Debtor IBAN</dt>
                  <dd class="text-sm font-mono text-gray-900 dark:text-ink">{{ t.debtor_account_iban }}</dd>
                </div>
              }
              @if (t.debtor_account_bban) {
                <div class="flex justify-between">
                  <dt class="text-sm text-gray-500">Debtor BBAN</dt>
                  <dd class="text-sm font-mono text-gray-900 dark:text-ink">{{ t.debtor_account_bban }}</dd>
                </div>
              }
              @if (t.debtor_agent) {
                <div class="flex justify-between">
                  <dt class="text-sm text-gray-500">Debtor Bank BIC</dt>
                  <dd class="text-sm font-mono text-gray-900 dark:text-ink">{{ t.debtor_agent }}</dd>
                </div>
              }
              @if (t.creditor_name) {
                <div class="flex justify-between">
                  <dt class="text-sm text-gray-500">Creditor (Receiver)</dt>
                  <dd class="text-sm font-medium text-gray-900 dark:text-ink">{{ t.creditor_name }}</dd>
                </div>
              }
              @if (t.creditor_account_iban) {
                <div class="flex justify-between">
                  <dt class="text-sm text-gray-500">Creditor IBAN</dt>
                  <dd class="text-sm font-mono text-gray-900 dark:text-ink">{{ t.creditor_account_iban }}</dd>
                </div>
              }
              @if (t.creditor_account_bban) {
                <div class="flex justify-between">
                  <dt class="text-sm text-gray-500">Creditor BBAN</dt>
                  <dd class="text-sm font-mono text-gray-900 dark:text-ink">{{ t.creditor_account_bban }}</dd>
                </div>
              }
              @if (t.creditor_agent) {
                <div class="flex justify-between">
                  <dt class="text-sm text-gray-500">Creditor Bank BIC</dt>
                  <dd class="text-sm font-mono text-gray-900 dark:text-ink">{{ t.creditor_agent }}</dd>
                </div>
              }
              @if (!t.debtor_name && !t.creditor_name) {
                <dd class="text-sm text-gray-400">No counterparty information available for this transaction.</dd>
              }
            </dl>
          </div>

          <!-- Reference Info -->
          <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
            <h3 class="mb-3 text-sm font-semibold text-gray-700 dark:text-ink-dim uppercase tracking-wider">Reference Info</h3>
            <dl class="space-y-2">
              @if (t.remittance_info) {
                <div>
                  <dt class="text-sm text-gray-500">Remittance Information</dt>
                  <dd class="mt-0.5 text-sm text-gray-900 dark:text-ink whitespace-pre-wrap break-words">{{ t.remittance_info }}</dd>
                </div>
              }
              @if (t.remittance_info_structured) {
                <div>
                  <dt class="text-sm text-gray-500">Structured Remittance</dt>
                  <dd class="mt-0.5 text-sm text-gray-900 dark:text-ink">{{ t.remittance_info_structured }}</dd>
                </div>
              }
              @if (t.payment_reference) {
                <div class="flex justify-between">
                  <dt class="text-sm text-gray-500">Payment Reference</dt>
                  <dd class="text-sm font-medium text-gray-900 dark:text-ink">{{ t.payment_reference }}</dd>
                </div>
              }
              @if (t.reference_number) {
                <div class="flex justify-between">
                  <dt class="text-sm text-gray-500">Reference Number</dt>
                  <dd class="text-sm font-medium text-gray-900 dark:text-ink">{{ t.reference_number }}</dd>
                </div>
              }
              @if (t.entry_reference) {
                <div class="flex justify-between">
                  <dt class="text-sm text-gray-500">Entry Reference</dt>
                  <dd class="text-sm font-mono text-xs text-gray-900 dark:text-ink">{{ t.entry_reference }}</dd>
                </div>
              }
              @if (t.additional_info) {
                <div class="flex justify-between">
                  <dt class="text-sm text-gray-500">Additional Info</dt>
                  <dd class="text-sm text-gray-900 dark:text-ink">{{ t.additional_info }}</dd>
                </div>
              }
              @if (t.note) {
                <div class="flex justify-between">
                  <dt class="text-sm text-gray-500">Note</dt>
                  <dd class="text-sm text-gray-900 dark:text-ink">{{ t.note }}</dd>
                </div>
              }
              @if (!t.remittance_info && !t.payment_reference && !t.reference_number && !t.entry_reference) {
                <dd class="text-sm text-gray-400">No reference information available.</dd>
              }
            </dl>
          </div>

          <!-- Balance & Exchange -->
          <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
            <h3 class="mb-3 text-sm font-semibold text-gray-700 dark:text-ink-dim uppercase tracking-wider">Balance &amp; Exchange</h3>
            <dl class="space-y-2">
              <div class="flex justify-between">
                <dt class="text-sm text-gray-500">Amount</dt>
                <dd class="text-sm font-bold text-gray-900 dark:text-ink">{{ t.amount | number:'1.2-2' }} {{ t.currency }}</dd>
              </div>
              @if (t.balance_after_amount) {
                <div class="flex justify-between">
                  <dt class="text-sm text-gray-500">Balance After</dt>
                  <dd class="text-sm font-bold text-gray-900 dark:text-ink">{{ t.balance_after_amount | number:'1.2-2' }} {{ t.balance_after_currency || t.currency }}</dd>
                </div>
              }
              @if (t.exchange_rate) {
                <div class="flex justify-between">
                  <dt class="text-sm text-gray-500">Exchange Rate</dt>
                  <dd class="text-sm font-mono text-gray-900 dark:text-ink">{{ t.exchange_rate }}</dd>
                </div>
              }
            </dl>
          </div>
        </div>
      }
    </div>
  `,
})
export class TransactionDetailPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(true);
  readonly accountId = signal('');
  readonly txn = signal<Transaction | null>(null);

  ngOnInit(): void {
    const accountId = this.route.snapshot.paramMap.get('accountId');
    const txnId = this.route.snapshot.paramMap.get('txnId');
    this.accountId.set(accountId ?? '');
    if (accountId && txnId) {
      this.loadTransaction(accountId, txnId);
    }
  }

  async loadTransaction(accountId: string, txnId: string): Promise<void> {
    this.loading.set(true);
    try {
      // First load from DB
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ transactions: Transaction[] }>>(`${API}/banking/transactions?accountId=${accountId}&limit=1000`),
      );
      if (res.success && res.data) {
        const found = res.data.transactions.find((t) => t.id === txnId) ?? null;
        this.txn.set(found);
      }
    } catch (e: any) {
      console.error('Failed to load transaction', e);
    } finally {
      this.loading.set(false);
    }

    // Then try to enrich from Enable Banking API (updates DB + shows richer data)
    try {
      const enrichRes = await firstValueFrom(
        this.http.post<ApiResponse<{ enriched: boolean }>>(`${API}/banking/transactions/${txnId}/enrich`, {}),
      );
      if (enrichRes.success && enrichRes.data?.enriched) {
        // Reload the enriched transaction from DB
        const res2 = await firstValueFrom(
          this.http.get<ApiResponse<{ transactions: Transaction[] }>>(`${API}/banking/transactions?accountId=${accountId}&limit=1000`),
        );
        if (res2.success && res2.data) {
          const enriched = res2.data.transactions.find((t) => t.id === txnId) ?? null;
          if (enriched) this.txn.set(enriched);
        }
      }
    } catch (e: any) {
      // Enrichment failed (session expired, etc.) — show what we have from the list
      console.warn('Enrichment failed:', e.message);
    }
  }
}