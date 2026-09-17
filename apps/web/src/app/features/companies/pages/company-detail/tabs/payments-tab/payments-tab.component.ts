import { Component, ChangeDetectionStrategy, inject, signal, computed, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { API } from '@app/core/config/api';
import { CompanyDetailStore } from '../../company-detail.store';

interface ApiResponse<T> { success: boolean; data: T; message?: string; }

interface LedgerPayment {
  id: string;
  orderId: string | null;
  orderNumber: string | null;
  invoiceNumber?: string | null;
  orderSupplierId?: string | null;
  amount: string;
  currency: string;
  receivedAt?: string | null;
  paidAt?: string | null;
  method: string | null;
  note: string | null;
  createdAt: string;
}

interface LedgerTotal {
  currency: string;
  totalReceived?: string;
  totalPaid?: string;
  totalInvoiced?: string;
  totalCost?: string;
  outstanding: string;
  count: number;
}

interface LedgerResponse {
  payments: LedgerPayment[];
  totals: LedgerTotal[];
  pagination: { limit: number; offset: number; hasMore: boolean };
}

interface NetPosition {
  currency: string;
  receivablesOutstanding: number;
  payablesOutstanding: number;
  net: number; // positive = they owe you, negative = you owe them
}

@Component({
  selector: 'app-payments-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, RouterLink],
  styles: [':host { display: block }'],
  template: `
    <div class="space-y-6">
      @if (loading()) {
        <div class="flex items-center justify-center py-12 text-gray-400">
          <svg class="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <span class="ml-2">Loading ledger…</span>
        </div>
      } @else if (error()) {
        <div class="rounded-lg bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-600 dark:text-red-400">
          {{ error() }}
        </div>
      } @else {
        <!-- Net Position Summary -->
        @if (netPositions().length > 0) {
          <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim uppercase tracking-wider mb-3">Net Position</h3>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              @for (np of netPositions(); track np.currency) {
                <div class="border-l-4 pl-4" [class.border-blue-500]="np.net >= 0" [class.border-orange-500]="np.net < 0">
                  <div class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-muted">{{ np.currency }}</div>
                  <div class="mt-1 space-y-0.5 text-sm">
                    <div class="flex justify-between">
                      <span class="text-gray-500">They owe you</span>
                      <span class="font-medium">{{ np.receivablesOutstanding | number:'1.2-2' }}</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-gray-500">You owe them</span>
                      <span class="font-medium">{{ np.payablesOutstanding | number:'1.2-2' }}</span>
                    </div>
                    <div class="flex justify-between border-t border-gray-100 dark:border-line pt-0.5">
                      <span class="text-gray-500">Net</span>
                      <span class="font-bold" [class.text-blue-600]="np.net > 0" [class.text-orange-600]="np.net < 0" [class.text-gray-500]="np.net === 0">
                        {{ np.net | number:'1.2-2' }} {{ np.currency }}
                      </span>
                    </div>
                  </div>
                </div>
              }
            </div>
          </div>
        }

        <!-- Customer Payments (Receivables) -->
        <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm overflow-hidden">
          <div class="px-5 py-3 border-b border-gray-200 dark:border-line">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim uppercase tracking-wider">
              Customer Payments (Receivables)
            </h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-muted">
              Money received from this company
            </p>
          </div>

          @if (customerTotals().length > 0) {
            <div class="px-5 py-3 bg-gray-50 dark:bg-surface-dim border-b border-gray-200 dark:border-line">
              <div class="flex flex-wrap gap-4">
                @for (t of customerTotals(); track t.currency) {
                  <div class="text-sm">
                    <span class="font-semibold text-gray-600 dark:text-muted">{{ t.currency }}</span>
                    <span class="ml-2 text-gray-500">Received: {{ t.totalReceived | number:'1.2-2' }}</span>
                    <span class="ml-2 text-gray-500">Invoiced: {{ t.totalInvoiced | number:'1.2-2' }}</span>
                    <span class="ml-2 font-medium" [class.text-red-600]="isPositive(t.outstanding)" [class.text-green-600]="!isPositive(t.outstanding)">
                      Outstanding: {{ t.outstanding | number:'1.2-2' }}
                    </span>
                  </div>
                }
              </div>
            </div>
          }

          @if (customerPayments().length === 0) {
            <div class="px-5 py-8 text-center text-sm text-gray-400">
              No customer payments recorded yet.
            </div>
          } @else {
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200 dark:divide-line">
                <thead class="bg-gray-50 dark:bg-surface-dim">
                  <tr>
                    <th class="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Date</th>
                    <th class="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Order #</th>
                    <th class="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Invoice</th>
                    <th class="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Amount</th>
                    <th class="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Ccy</th>
                    <th class="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Method</th>
                    <th class="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Note</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-line">
                  @for (p of customerPayments(); track p.id) {
                    <tr class="hover:bg-gray-50 dark:hover:bg-surface-dim">
                      <td class="px-4 py-2 text-sm text-gray-600 dark:text-muted">{{ p.receivedAt | date:'mediumDate' }}</td>
                      <td class="px-4 py-2 text-sm">
                        @if (p.orderNumber) {
                          <a [routerLink]="['/trading', p.orderNumber]" class="text-brand-600 hover:underline">{{ p.orderNumber }}</a>
                        } @else { <span class="text-gray-400">—</span> }
                      </td>
                      <td class="px-4 py-2 text-sm text-gray-600 dark:text-muted">{{ p.invoiceNumber || '—' }}</td>
                      <td class="px-4 py-2 text-sm font-medium text-right">{{ p.amount | number:'1.2-2' }}</td>
                      <td class="px-4 py-2 text-sm text-gray-600 dark:text-muted">{{ p.currency }}</td>
                      <td class="px-4 py-2 text-sm text-gray-600 dark:text-muted">{{ p.method || '—' }}</td>
                      <td class="px-4 py-2 text-sm text-gray-500 dark:text-muted max-w-xs truncate">{{ p.note || '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (customerPagination().hasMore) {
              <div class="px-5 py-2 text-center border-t border-gray-200 dark:border-line">
                <button type="button" (click)="loadMoreCustomer()" class="text-sm text-brand-600 hover:underline">Load more</button>
              </div>
            }
          }
        </div>

        <!-- Supplier Payments (Payables) -->
        <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm overflow-hidden">
          <div class="px-5 py-3 border-b border-gray-200 dark:border-line">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim uppercase tracking-wider">
              Supplier Payments (Payables)
            </h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-muted">
              Money paid to this company
            </p>
          </div>

          @if (supplierTotals().length > 0) {
            <div class="px-5 py-3 bg-gray-50 dark:bg-surface-dim border-b border-gray-200 dark:border-line">
              <div class="flex flex-wrap gap-4">
                @for (t of supplierTotals(); track t.currency) {
                  <div class="text-sm">
                    <span class="font-semibold text-gray-600 dark:text-muted">{{ t.currency }}</span>
                    <span class="ml-2 text-gray-500">Paid: {{ t.totalPaid | number:'1.2-2' }}</span>
                    <span class="ml-2 text-gray-500">Cost: {{ t.totalCost | number:'1.2-2' }}</span>
                    <span class="ml-2 font-medium" [class.text-red-600]="isPositive(t.outstanding)" [class.text-green-600]="!isPositive(t.outstanding)">
                      Outstanding: {{ t.outstanding | number:'1.2-2' }}
                    </span>
                  </div>
                }
              </div>
            </div>
          }

          @if (supplierPayments().length === 0) {
            <div class="px-5 py-8 text-center text-sm text-gray-400">
              No supplier payments recorded yet.
            </div>
          } @else {
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200 dark:divide-line">
                <thead class="bg-gray-50 dark:bg-surface-dim">
                  <tr>
                    <th class="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Date</th>
                    <th class="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Order #</th>
                    <th class="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Amount</th>
                    <th class="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Ccy</th>
                    <th class="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Method</th>
                    <th class="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Note</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-line">
                  @for (p of supplierPayments(); track p.id) {
                    <tr class="hover:bg-gray-50 dark:hover:bg-surface-dim">
                      <td class="px-4 py-2 text-sm text-gray-600 dark:text-muted">{{ p.paidAt | date:'mediumDate' }}</td>
                      <td class="px-4 py-2 text-sm">
                        @if (p.orderNumber) {
                          <a [routerLink]="['/trading', p.orderNumber]" class="text-brand-600 hover:underline">{{ p.orderNumber }}</a>
                        } @else { <span class="text-gray-400">—</span> }
                      </td>
                      <td class="px-4 py-2 text-sm font-medium text-right">{{ p.amount | number:'1.2-2' }}</td>
                      <td class="px-4 py-2 text-sm text-gray-600 dark:text-muted">{{ p.currency }}</td>
                      <td class="px-4 py-2 text-sm text-gray-600 dark:text-muted">{{ p.method || '—' }}</td>
                      <td class="px-4 py-2 text-sm text-gray-500 dark:text-muted max-w-xs truncate">{{ p.note || '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (supplierPagination().hasMore) {
              <div class="px-5 py-2 text-center border-t border-gray-200 dark:border-line">
                <button type="button" (click)="loadMoreSupplier()" class="text-sm text-brand-600 hover:underline">Load more</button>
              </div>
            }
          }
        </div>
      }
    </div>
  `,
})
export class PaymentsTabComponent {
  private readonly http = inject(HttpClient);
  readonly store = inject(CompanyDetailStore);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // Customer (receivables) data
  readonly customerPayments = signal<LedgerPayment[]>([]);
  readonly customerTotals = signal<LedgerTotal[]>([]);
  readonly customerPagination = signal({ limit: 50, offset: 0, hasMore: false });

  // Supplier (payables) data
  readonly supplierPayments = signal<LedgerPayment[]>([]);
  readonly supplierTotals = signal<LedgerTotal[]>([]);
  readonly supplierPagination = signal({ limit: 50, offset: 0, hasMore: false });

  // Net position: merge currencies from both sides
  readonly netPositions = computed<NetPosition[]>(() => {
    const map = new Map<string, NetPosition>();

    for (const t of this.customerTotals()) {
      const receivables = Math.max(0, Number(t.outstanding));
      map.set(t.currency, { currency: t.currency, receivablesOutstanding: receivables, payablesOutstanding: 0, net: receivables });
    }

    for (const t of this.supplierTotals()) {
      const payables = Math.max(0, Number(t.outstanding));
      const existing = map.get(t.currency);
      if (existing) {
        existing.payablesOutstanding = payables;
        existing.net = existing.receivablesOutstanding - existing.payablesOutstanding;
      } else {
        map.set(t.currency, { currency: t.currency, receivablesOutstanding: 0, payablesOutstanding: payables, net: -payables });
      }
    }

    return Array.from(map.values()).sort((a, b) => b.net - a.net);
  });

  private customerOffset = 0;
  private supplierOffset = 0;

  // The router-outlet activates this tab before the company is loaded, so
  // load via effect() — fires as soon as store.company() becomes available.
  private loadedForCompanyId: string | null = null;
  private readonly loadOnCompany = effect(() => {
    const company = this.store.company();
    if (company && company.id !== this.loadedForCompanyId) {
      this.loadedForCompanyId = company.id;
      void this.loadBoth(true);
    }
  });

  async loadBoth(reset: boolean): Promise<void> {
    const company = this.store.company();
    if (!company) return;

    if (reset) {
      this.customerOffset = 0;
      this.supplierOffset = 0;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      await Promise.all([
        this.loadLedgerSide(company.id, 'customer', reset),
        this.loadLedgerSide(company.id, 'supplier', reset),
      ]);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Failed to load ledger');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadLedgerSide(companyId: string, side: 'customer' | 'supplier', reset: boolean): Promise<void> {
    const endpoint = side === 'customer' ? 'ledger/customer' : 'ledger/supplier';
    const offset = side === 'customer' ? this.customerOffset : this.supplierOffset;

    const res = await firstValueFrom(
      this.http.get<ApiResponse<LedgerResponse>>(
        `${API}/companies/local/${companyId}/${endpoint}?limit=50&offset=${offset}`,
      ),
    );

    if (!res.success || !res.data) return;

    if (side === 'customer') {
      if (reset) {
        this.customerPayments.set(res.data.payments);
      } else {
        this.customerPayments.update((prev) => [...prev, ...res.data!.payments]);
      }
      this.customerTotals.set(res.data.totals);
      this.customerPagination.set(res.data.pagination);
    } else {
      if (reset) {
        this.supplierPayments.set(res.data.payments);
      } else {
        this.supplierPayments.update((prev) => [...prev, ...res.data!.payments]);
      }
      this.supplierTotals.set(res.data.totals);
      this.supplierPagination.set(res.data.pagination);
    }
  }

  loadMoreCustomer(): void {
    this.customerOffset += 50;
    const company = this.store.company();
    if (company) this.loadLedgerSide(company.id, 'customer', false);
  }

  loadMoreSupplier(): void {
    this.supplierOffset += 50;
    const company = this.store.company();
    if (company) this.loadLedgerSide(company.id, 'supplier', false);
  }

  isPositive(value: string): boolean {
    return Number(value) > 0;
  }
}