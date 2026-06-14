import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, CreditLineDto, BankAccountDto, OwnCompanyDto } from '@fueld/types';
import { PaymentTermType } from '@fueld/types';
import { API_URL } from '@app/core/config/api';
import { RiskMonitoringService } from '@app/core/risk-monitoring/risk-monitoring.service';

export interface CreditSummary {
  currency: string;
  available: number;
  maxDays: number;
}

@Injectable({ providedIn: 'root' })
export class OrderFinancialService {
  private readonly http = inject(HttpClient);
  private readonly riskService = inject(RiskMonitoringService);

  readonly customerCreditLines = signal<CreditLineDto[]>([]);
  readonly customerCreditLoading = signal(false);
  readonly customerCreditFrozen = signal(false);
  readonly supplierCreditLines = signal<CreditLineDto[]>([]);
  readonly supplierCreditLoading = signal(false);

  async loadCustomerCreditLines(counterpartyId: string | null | undefined): Promise<void> {
    if (!counterpartyId) return;
    this.customerCreditLoading.set(true);
    this.customerCreditFrozen.set(false);
    try {
      const [res, frozenRes] = await Promise.all([
        firstValueFrom(
          this.http.get<ApiResponse<{ items: CreditLineDto[]; total: number }>>(
            `${API_URL}/credit/lines?type=CUSTOMER&counterpartyId=${encodeURIComponent(counterpartyId)}&limit=50`,
          ),
        ),
        this.riskService.isFrozen(counterpartyId).catch(() => false),
      ]);
      if (res.success) {
        this.customerCreditLines.set(res.data.items ?? []);
      } else {
        this.customerCreditLines.set([]);
      }
      this.customerCreditFrozen.set(frozenRes);
    } catch {
      this.customerCreditLines.set([]);
    } finally {
      this.customerCreditLoading.set(false);
    }
  }

  async loadSupplierCreditLines(counterpartyId: string | null | undefined): Promise<void> {
    if (!counterpartyId) {
      this.supplierCreditLines.set([]);
      return;
    }
    this.supplierCreditLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ items: CreditLineDto[]; total: number }>>(
          `${API_URL}/credit/lines?type=SUPPLIER&counterpartyId=${encodeURIComponent(counterpartyId)}&limit=50`,
        ),
      );
      if (res.success) {
        this.supplierCreditLines.set(res.data.items ?? []);
      } else {
        this.supplierCreditLines.set([]);
      }
    } catch {
      this.supplierCreditLines.set([]);
    } finally {
      this.supplierCreditLoading.set(false);
    }
  }

  customerCreditSummary(currency: string): CreditSummary | null {
    const lines = this.customerCreditLines().filter((line) => line.currency === currency);
    if (!lines.length) return null;
    const available = lines.reduce((sum, line) => sum + (parseFloat(line.availableAmount) || 0), 0);
    const maxDays = Math.max(...lines.map((line) => line.periodDays));
    return { currency, available, maxDays };
  }

  supplierCreditSummary(currency: string): CreditSummary | null {
    const lines = this.supplierCreditLines().filter((line) => line.currency === currency);
    if (!lines.length) return null;
    const available = lines.reduce((sum, line) => sum + (parseFloat(line.availableAmount) || 0), 0);
    const maxDays = Math.max(...lines.map((line) => line.periodDays));
    return { currency, available, maxDays };
  }

  canUseCustomerCredit(currency: string, frozen: boolean): boolean {
    return !!this.customerCreditSummary(currency) && !frozen;
  }

  canUseSupplierCredit(currency: string): boolean {
    return !!this.supplierCreditSummary(currency);
  }

  async loadBankAccounts(companyId: string): Promise<BankAccountDto[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<BankAccountDto[]>>(
          `${API_URL}/admin/settings/companies/${companyId}/bank-accounts`,
        ),
      );
      if (res.success) return res.data ?? [];
    } catch {
      // silently ignore
    }
    return [];
  }

  applyPreferredInvoicingCompanySelection(
    companies: OwnCompanyDto[],
    currentCompanyId: string | null | undefined,
    order: { invoicingCompanyId?: string | null } | null,
    updateOrder: (updater: (o: any) => any) => void,
    triggerAutosave: () => void,
  ): string | null {
    const requestedId = this.resolveRequestedInvoicingCompanyId(
      currentCompanyId ?? order?.invoicingCompanyId,
      companies,
    );

    if (currentCompanyId === requestedId) {
      return requestedId;
    }

    if (companies.length === 0) {
      return currentCompanyId ?? null;
    }

    updateOrder((o: any) => (o ? { ...o, invoicingCompanyId: requestedId, bankAccountId: null } : o));
    triggerAutosave();
    return requestedId;
  }

  applyPreferredBankAccountSelection(
    bankAccountId: string | null | undefined,
    accounts: BankAccountDto[],
    order: { bankAccountId?: string | null; currency?: string | null } | null,
    updateOrder: (updater: (o: any) => any) => void,
    triggerAutosave: () => void,
  ): void {
    const preferredId = this.resolveRequestedBankAccountId(bankAccountId, accounts, order?.currency);

    if (order?.bankAccountId === preferredId) return;

    updateOrder((o: any) => (o ? { ...o, bankAccountId: preferredId } : o));
    triggerAutosave();
  }

  private getPreferredBankAccount(accounts: BankAccountDto[], currency?: string | null): BankAccountDto | null {
    if (accounts.length === 0) return null;

    const orderCurrency = this.normalizeCurrencyCode(currency);
    if (orderCurrency) {
      const currencyMatches = accounts.filter((a) => this.normalizeCurrencyCode(a.currency) === orderCurrency);
      if (currencyMatches.length > 0) {
        return currencyMatches.find((a) => a.isDefault) ?? currencyMatches[0];
      }
    }

    return accounts.find((a) => a.isDefault) ?? accounts[0] ?? null;
  }

  resolveRequestedInvoicingCompanyId(
    companyId: string | null | undefined,
    companies: OwnCompanyDto[],
  ): string | null {
    const normalizedId = (companyId ?? '').trim();

    if (normalizedId && companies.some((c) => c.id === normalizedId)) {
      return normalizedId;
    }

    if (companies.length === 0) {
      return normalizedId || null;
    }

    if (normalizedId && companies.some((c) => c.id === normalizedId)) {
      return normalizedId;
    }

    return companies[0]?.id ?? null;
  }

  resolveRequestedBankAccountId(
    bankAccountId: string | null | undefined,
    accounts: BankAccountDto[],
    currency?: string | null,
  ): string | null {
    const normalizedId = (bankAccountId ?? '').trim();

    if (normalizedId && accounts.some((a) => a.id === normalizedId)) {
      return normalizedId;
    }

    if (accounts.length === 0) {
      return null;
    }

    if (normalizedId && accounts.some((a) => a.id === normalizedId)) {
      return normalizedId;
    }

    return this.getPreferredBankAccount(accounts, currency)?.id ?? null;
  }

  private normalizeCurrencyCode(currency: string | null | undefined): string {
    return (currency ?? '').trim().toUpperCase();
  }
}