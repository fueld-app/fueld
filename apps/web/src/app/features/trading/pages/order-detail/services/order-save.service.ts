import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, OrderDto, OrderSupplierDto } from '@fueld/types';
import { API_URL } from '@app/core/config/api';

@Injectable({ providedIn: 'root' })
export class OrderSaveService {
  private readonly http = inject(HttpClient);

  readonly autoSaving = signal(false);
  readonly lastSaved = signal<Date | null>(null);
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private version = 0;

  triggerSave(isPaidOrCancelled: () => boolean): void {
    if (isPaidOrCancelled()) return;
    this.version++;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.perform(), 2000);
  }

  cancelTimer(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
  }

  isDirty(): boolean {
    return this.version > 0;
  }

  private async perform(): Promise<void> {
    // The actual save is orchestrated by the component since it owns the data
    this.version = 0;
  }

  async performSave(
    id: string,
    o: OrderDto,
    syncSuppliers: (id: string) => Promise<void>,
    showError: (msg: string) => void,
  ): Promise<void> {
    this.autoSaving.set(true);
    try {
      const orderRes = await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}`, {
          clientId: o.clientId, vesselId: o.vesselId, placeId: o.placeId,
          salesRepId: o.salesRepId ?? null, invoicingCompanyId: o.invoicingCompanyId,
          bankAccountId: o.bankAccountId ?? null, currency: o.currency,
          customerPaymentTermType: o.customerPaymentTermType ?? null,
          customerCreditDays: o.customerCreditDays ?? null,
          customerNote: o.customerNote ?? null,
          purchaseOrderNumber: o.purchaseOrderNumber ?? null,
          customerContactId: o.customerContactId ?? null,
          supplierId: o.supplierId ?? null,
          supplierPaymentTermType: o.supplierPaymentTermType ?? null,
          supplierCreditDays: o.supplierCreditDays ?? null,
          supplierNote: o.supplierNote ?? null,
          supplierContactId: o.supplierContactId ?? null,
          brokerId: o.brokerId ?? null, brokerContactId: o.brokerContactId ?? null,
          brokerGetsAll: o.brokerGetsAll ?? false,
          agentId: o.agentId ?? null, agentContactId: o.agentContactId ?? null,
          termsAndConditions: o.termsAndConditions ?? null,
          categoryKey: o.categoryKey ?? null, eta: o.eta, etd: o.etd,
          deliveredAt: o.deliveredAt ?? null,
        }),
      );
      if (!orderRes.success) { showError('Failed to save order.'); return; }
      await syncSuppliers(id);
      this.lastSaved.set(new Date());
    } catch { showError('Failed to save order.'); }
    finally { this.autoSaving.set(false); }
  }
}