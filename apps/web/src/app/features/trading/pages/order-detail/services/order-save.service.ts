import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, OrderDto } from '@fueld/types';
import type { OrderItemRow } from '../../../components/order-items/order-item.types';
import { API_URL } from '@app/core/config/api';

@Injectable({ providedIn: 'root' })
export class OrderSaveService {
  private readonly http = inject(HttpClient);

  // ─── Autosave state ────────────────────────────────────────────

  readonly autoSaving = signal(false);
  readonly saving = signal(false);
  readonly lastSaved = signal<Date | null>(null);
  readonly changeVersion = signal(0);
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Draft tracking ────────────────────────────────────────────

  readonly draftItemIds = signal<Set<string>>(new Set());

  isIncompleteDraftItem(
    row: OrderItemRow,
    hasMultipleOrderSuppliers: () => boolean,
  ): boolean {
    if (!this.draftItemIds().has(row.id)) return false;
    if (!row.productType?.trim()) return true;
    return !this.hasResolvedItemSupplierSelection(row, hasMultipleOrderSuppliers);
  }

  getAutoSaveRows(
    rows: OrderItemRow[],
    hasMultipleOrderSuppliers: () => boolean,
  ): OrderItemRow[] {
    return rows.filter((row) => !this.isIncompleteDraftItem(row, hasMultipleOrderSuppliers));
  }

  hasIncompleteDraftItems(
    rows: OrderItemRow[],
    hasMultipleOrderSuppliers: () => boolean,
  ): boolean {
    return rows.some((row) => this.isIncompleteDraftItem(row, hasMultipleOrderSuppliers));
  }

  clearSavedDraftItemIds(rows: OrderItemRow[]): void {
    if (rows.length === 0) return;
    const savedIds = new Set(rows.map((row) => row.id));
    this.draftItemIds.update((current) => {
      if (current.size === 0) return current;
      const next = new Set(current);
      let changed = false;
      for (const id of savedIds) {
        if (next.delete(id)) changed = true;
      }
      return changed ? next : current;
    });
  }

  /** Track new rows as drafts during normalizeIncomingItemRows. */
  trackNewDraftItems(
    normalizedItems: OrderItemRow[],
    previousIds: Set<string>,
  ): void {
    this.draftItemIds.update((current) => {
      const nextIds = new Set(normalizedItems.map((item) => item.id));
      const next = new Set([...current].filter((id) => nextIds.has(id)));
      for (const item of normalizedItems) {
        if (!previousIds.has(item.id)) {
          next.add(item.id);
        }
      }
      return next;
    });
  }

  // ─── Autosave scheduling ───────────────────────────────────────

  triggerSave(isPaidOrCancelled: () => boolean): void {
    if (isPaidOrCancelled()) return;
    this.changeVersion.update((v) => v + 1);
  }

  scheduleAutoSave(
    onSave: () => Promise<void>,
    delayMs = 1500,
  ): void {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(async () => {
      await onSave();
    }, delayMs);
  }

  cancelAutoSave(): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  // ─── Full order save (used by auto-save and manual save) ────────

  async saveOrder(
    id: string,
    o: OrderDto,
    options: {
      itemRows: () => OrderItemRow[];
      hasMultipleOrderSuppliers: () => boolean;
      buildItemPayload: (rows: OrderItemRow[], opts?: { fillMissingDeliveredQuantity?: boolean }) => Record<string, string | null>[];
      syncSupplierRecords: (orderId: string) => Promise<void>;
      clearSavedDraftIds: (rows: OrderItemRow[]) => void;
      loadCustomerCreditLines: (clientId: string) => Promise<void>;
      loadSupplierCreditLines: (supplierCompanyId?: string | null) => Promise<void>;
      activeSupplierCompanyId: () => string | null;
    },
    onError?: (msg: string) => void,
  ): Promise<boolean> {
    const rows = options.itemRows();
    const autoSaveRows = this.getAutoSaveRows(rows, options.hasMultipleOrderSuppliers);

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
      if (!orderRes.success) { onError?.('Failed to save order.'); return false; }

      await options.syncSupplierRecords(id);

      const itemPayload = options.buildItemPayload(autoSaveRows).map((item: Record<string, string | null>) => ({
        ...item,
        costCurrency: item['costCurrency'] ?? o.currency,
        salesCurrency: item['salesCurrency'] ?? o.currency,
      }));

      const itemsRes = await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}/items`, { items: itemPayload }),
      );
      if (!itemsRes.success) { onError?.('Failed to save items.'); return false; }

      options.clearSavedDraftIds(autoSaveRows);
      await options.loadCustomerCreditLines(o.clientId);
      await options.loadSupplierCreditLines(options.activeSupplierCompanyId() ?? o.supplierId);
      return true;
    } catch {
      onError?.('Failed to save order.');
      return false;
    }
  }

  /** Check whether a row has a resolved supplier selection. */
  private hasResolvedItemSupplierSelection(
    row: OrderItemRow,
    hasMultipleOrderSuppliers: () => boolean,
  ): boolean {
    if (!hasMultipleOrderSuppliers()) return true;
    if (!row.orderSupplierId) return false;
    if (!row.orderSupplierId.startsWith('temp:')) return true;
    return false;
  }
}