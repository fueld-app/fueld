import { Service, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, CounterpartyDto, OrderSupplierDto } from '@fueld/types';
import { API_URL } from '@app/core/config/api';

@Service()
export class OrderSupplierService {
  private readonly http = inject(HttpClient);

  readonly orderSuppliers = signal<OrderSupplierDto[]>([]);
  readonly activeOrderSupplierId = signal<string | null>(null);

  readonly activeOrderSupplier = () => {
    const suppliers = this.orderSuppliers();
    const activeId = this.activeOrderSupplierId();
    return suppliers.find((s) => s.id === activeId)
      ?? suppliers.find((s) => s.isPrimary)
      ?? suppliers[0]
      ?? null;
  };

  /** Derived supplier data */
  readonly activeSupplierCompanyId = () => this.activeOrderSupplier()?.companyId ?? '';
  readonly activeSupplierContactId = () => this.activeOrderSupplier()?.contactId ?? '';
  readonly activeSupplierPaymentTermType = () => this.activeOrderSupplier()?.paymentTermType ?? null;
  readonly activeSupplierCreditDays = () => this.activeOrderSupplier()?.creditDays ?? null;
  readonly activeSupplierNote = () => this.activeOrderSupplier()?.note ?? null;
  readonly activeSupplierDeliveredAt = () => this.activeOrderSupplier()?.deliveredAt ?? null;

  readonly hasMultipleOrderSuppliers = () => this.orderSuppliers().length > 1;
  readonly orderSupplierTabs = () => this.orderSuppliers().map((supplier, index) => ({
    id: supplier.id,
    label: supplier.company?.name ?? `Supplier ${index + 1}`,
    isPrimary: supplier.isPrimary,
  }));

  readonly supplierName = () => this.activeOrderSupplier()?.company?.name ?? '—';

  isTemporaryOrderSupplierId(orderSupplierId: string | null | undefined): boolean {
    return typeof orderSupplierId === 'string' && orderSupplierId.startsWith('temp:');
  }

  selectTab(orderSupplierId: string): OrderSupplierDto | null {
    this.activeOrderSupplierId.set(orderSupplierId);
    return this.orderSuppliers().find((s) => s.id === orderSupplierId) ?? null;
  }

  async addTab(orderId: string, showToast: (type: 'success' | 'error', msg: string) => void): Promise<string | null> {
    if (this.orderSuppliers().some((s) => this.isTemporaryOrderSupplierId(s.id) && !s.companyId)) {
      showToast('error', 'Choose a supplier in the new tab before adding another one.');
      return null;
    }

    const tempId = `temp:${crypto.randomUUID()}`;
    const nextSortOrder = Math.max(-1, ...this.orderSuppliers().map((s) => s.sortOrder ?? -1)) + 1;

    this.orderSuppliers.update((suppliers) => [...suppliers, {
      id: tempId,
      orderId,
      companyId: '',
      contactId: null,
      paymentTermType: null,
      creditDays: null,
      note: null,
      sortOrder: nextSortOrder,
      isPrimary: false,
      deliveredAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      company: null,
      contact: null,
    }]);
    return tempId;
  }

  updateActiveSupplier(
    updater: (supplier: OrderSupplierDto) => OrderSupplierDto,
  ): { updatedSupplier: OrderSupplierDto | undefined } {
    const activeSupplierId = this.activeOrderSupplierId() ?? this.activeOrderSupplier()?.id ?? null;
    if (!activeSupplierId) return { updatedSupplier: undefined };

    if (!this.activeOrderSupplierId()) {
      this.activeOrderSupplierId.set(activeSupplierId);
    }

    let updated: OrderSupplierDto | undefined;
    this.orderSuppliers.update((suppliers) => suppliers.map((s) => {
      if (s.id !== activeSupplierId) return s;
      updated = updater(s);
      return updated;
    }));

    return { updatedSupplier: updated };
  }

  mergeKnownSuppliers(
    existingSuppliers: CounterpartyDto[],
    additionalSuppliers: Array<CounterpartyDto | null | undefined>,
  ): CounterpartyDto[] {
    const merged = new Map<string, CounterpartyDto>();
    for (const supplier of existingSuppliers) {
      if (supplier?.id) merged.set(supplier.id, supplier);
    }
    for (const supplier of additionalSuppliers) {
      if (supplier?.id) merged.set(supplier.id, supplier);
    }
    return [...merged.values()];
  }

  async syncRecords(orderId: string): Promise<void> {
    const suppliers = this.orderSuppliers();
    if (suppliers.length === 0) return;

    for (const supplier of suppliers) {
      if (!supplier.companyId) continue;

      const endpoint = this.isTemporaryOrderSupplierId(supplier.id)
        ? `${API_URL}/orders/${orderId}/suppliers`
        : `${API_URL}/orders/${orderId}/suppliers/${supplier.id}`;
      const request$ = this.isTemporaryOrderSupplierId(supplier.id)
        ? this.http.post<ApiResponse<OrderSupplierDto>>(endpoint, {
            companyId: supplier.companyId,
            contactId: supplier.contactId ?? null,
            paymentTermType: supplier.paymentTermType ?? null,
            creditDays: supplier.creditDays ?? null,
            note: supplier.note ?? null,
            deliveredAt: supplier.deliveredAt ?? null,
            isPrimary: supplier.isPrimary,
          })
        : this.http.put<ApiResponse<OrderSupplierDto>>(endpoint, {
            companyId: supplier.companyId,
            contactId: supplier.contactId ?? null,
            paymentTermType: supplier.paymentTermType ?? null,
            creditDays: supplier.creditDays ?? null,
            note: supplier.note ?? null,
            deliveredAt: supplier.deliveredAt ?? null,
            sortOrder: supplier.sortOrder,
            isPrimary: supplier.isPrimary,
          });

      const res = await firstValueFrom(request$);
      if (!res.success || !res.data) {
        throw new Error(res.message ?? 'Failed to save supplier details');
      }
    }
  }

  async reload(orderId: string, preferredCompanyId?: string | null): Promise<void> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<OrderSupplierDto[]>>(`${API_URL}/orders/${orderId}/suppliers`),
    );

    if (!res.success || !res.data) return;

    this.orderSuppliers.set(res.data);
    const currentActiveSupplierId = this.activeOrderSupplierId();
    const preferredSupplierId = (currentActiveSupplierId && res.data.some((s) => s.id === currentActiveSupplierId)
      ? currentActiveSupplierId
      : null)
      ?? res.data.find((s) => preferredCompanyId && s.companyId === preferredCompanyId)?.id
      ?? res.data.find((s) => s.isPrimary)?.id
      ?? res.data[0]?.id
      ?? null;
    this.activeOrderSupplierId.set(preferredSupplierId);
  }

  async clearActive(orderId: string, showToast: (type: 'success' | 'error', msg: string) => void): Promise<boolean> {
    const activeSupplier = this.activeOrderSupplier();
    if (!activeSupplier) return true;

    if (this.isTemporaryOrderSupplierId(activeSupplier.id)) {
      this.orderSuppliers.update((suppliers) => suppliers.filter((s) => s.id !== activeSupplier.id));
      return true;
    }

    try {
      const res = await firstValueFrom(
        this.http.delete<ApiResponse<{ id: string; isPrimary: boolean }>>(`${API_URL}/orders/${orderId}/suppliers/${activeSupplier.id}`),
      );

      if (!res.success) {
        showToast('error', res.message ?? 'Failed to remove supplier.');
        return false;
      }

      await this.reload(orderId);
      return true;
    } catch {
      showToast('error', 'Failed to remove supplier.');
      return false;
    }
  }
}