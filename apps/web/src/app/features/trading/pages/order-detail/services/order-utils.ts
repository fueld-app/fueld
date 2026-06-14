import type { OrderItemRow } from '../order-item.types';
import type { OrderSupplierDto } from '@fueld/types';

export function buildItemPayload(rows: OrderItemRow[], fillMissingDeliveredQuantity = false) {
  return rows.map((r) => {
    const deliveredQuantity = fillMissingDeliveredQuantity
      ? getEffectiveDeliveredQuantity(r)
      : r.deliveredQuantity;

    return {
      orderSupplierId: r.orderSupplierId ?? null,
      productType: r.productType,
      quantity: String(r.quantity),
      quantityMin: r.quantityMin != null ? String(r.quantityMin) : null,
      quantityMax: String(r.quantity),
      unit: r.unit, costUnit: r.costUnit, salesUnit: r.salesUnit,
      costConversionFactor: r.costConversionFactor != null ? String(r.costConversionFactor) : '1',
      unitConversionFactor: r.unitConversionFactor != null ? String(r.unitConversionFactor) : '1',
      description: r.description || null,
      costPrice: r.costPrice ? String(r.costPrice) : null,
      costCurrency: r.costCurrency, salesPrice: r.salesPrice ? String(r.salesPrice) : null,
      salesCurrency: r.salesCurrency, paymentTerms: r.paymentTerms || null,
      customerNote: r.customerNote ?? null,
      deliveredQuantity: deliveredQuantity != null ? String(deliveredQuantity) : null,
      costPricingModel: r.costPricingModel ?? 'FIXED',
      costReferenceId: r.costReferenceId ?? null,
      costPlattsEntryId: r.costPlattsEntryId ?? null,
      costPremium: r.costPremium != null ? String(r.costPremium) : null,
      costBarging: r.costBarging != null ? String(r.costBarging) : null,
      costBargingUnit: r.costBargingUnit ?? null,
      costCreditDays: r.costCreditDays ?? null,
      salesPricingModel: r.salesPricingModel ?? 'FIXED',
      salesReferenceId: r.salesReferenceId ?? null,
      salesPlattsEntryId: r.salesPlattsEntryId ?? null,
      salesPremium: r.salesPremium != null ? String(r.salesPremium) : null,
      salesBarging: r.salesBarging != null ? String(r.salesBarging) : null,
      salesBargingUnit: r.salesBargingUnit ?? null,
      salesCreditDays: r.salesCreditDays ?? null,
      inventorySkuId: r.inventorySkuId ?? null,
      warehouseId: r.warehouseId ?? null,
      plannedInventoryAt: r.plannedInventoryAt ?? null,
      taxRate: r.taxRate != null ? String(r.taxRate) : null,
    };
  });
}

function getEffectiveDeliveredQuantity(r: OrderItemRow): number | null {
  return r.deliveredQuantity != null ? r.deliveredQuantity : (r.quantity || 0);
}

export function formatPaymentTerms(type: string | null | undefined, days: number | null | undefined): string {
  if (!type) return '-';
  if (type === 'CREDIT') return `Credit ${days ?? 0} days`;
  if (type === 'COD') return 'Cash on Delivery';
  if (type === 'PREPAY') return 'Cash in advance';
  return type;
}

export function normalizeTerms(value: string | null | undefined): string {
  const trimmed = String(value ?? '').trim();
  return trimmed === '-' ? '' : trimmed;
}

export function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    SENT: 'bg-blue-100 text-blue-700',
    QUOTED: 'bg-green-100 text-green-700',
    DECLINED: 'bg-red-100 text-red-700',
  };
  return map[status] ?? 'bg-gray-100 text-gray-500';
}

export function fmtHistoryDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtHistoryDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function responseHoursLabel(hours: number): string {
  return hours >= 24 ? `${(hours / 24).toFixed(1)}d` : `${hours.toFixed(0)}h`;
}

export function quoteRateLabel(perf: { sentCount: number; quotedCount: number }): string {
  if (perf.sentCount <= 0 || perf.quotedCount <= 0) return '';
  return `${Math.round((perf.quotedCount / perf.sentCount) * 100)}% quote rate`;
}

export function avgResponseLabel(perf: { averageResponseHours: number | null; respondedCount: number }): string {
  if (perf.averageResponseHours == null || perf.respondedCount <= 0) return '';
  return perf.averageResponseHours >= 24
    ? `${Number((perf.averageResponseHours / 24).toFixed(1))}d avg reply`
    : `${Number(perf.averageResponseHours.toFixed(1))}h avg reply`;
}

export function deliverabilityLabel(perf: {
  deliverableCount: number; nonDeliverableCount: number; quotedCount: number;
}): string {
  if (perf.deliverableCount + perf.nonDeliverableCount <= 0) return '';
  const rate = perf.deliverableCount + perf.nonDeliverableCount > 0
    ? Math.round((perf.deliverableCount / (perf.deliverableCount + perf.nonDeliverableCount)) * 100)
    : 0;
  return `${rate}% deliverable (${perf.deliverableCount}/${perf.deliverableCount + perf.nonDeliverableCount})`;
}