import type { OrderItemRow } from '../../../components/order-items/order-item.types';
import type { OrderSupplierDto } from '@fueld/types';

export function buildItemPayload(rows: OrderItemRow[], fillMissingDeliveredQuantity = false): Record<string, string | null>[] {
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
      costCreditDays: r.costCreditDays != null ? String(r.costCreditDays) : null,
      salesPricingModel: r.salesPricingModel ?? 'FIXED',
      salesReferenceId: r.salesReferenceId ?? null,
      salesPlattsEntryId: r.salesPlattsEntryId ?? null,
      salesPremium: r.salesPremium != null ? String(r.salesPremium) : null,
      salesBarging: r.salesBarging != null ? String(r.salesBarging) : null,
      salesBargingUnit: r.salesBargingUnit ?? null,
      salesCreditDays: r.salesCreditDays != null ? String(r.salesCreditDays) : null,
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

// ─── Timezone / Date formatting ───────────────────────────────────

export function normalizeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

export function parseFixedOffsetMinutes(timeZone: string): number | null {
  const match = timeZone.match(/([+-])\s*(\d{1,2})(?::(\d{2}))?/);
  if (!match) return null;

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? '0');
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;

  return sign * (hours * 60 + minutes);
}

export function getTimeZoneOffset(date: Date, timeZone: string): number {
  const fixedOffset = parseFixedOffsetMinutes(timeZone);
  if (fixedOffset !== null) return fixedOffset;

  const safeTimeZone = normalizeTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map = new Map(parts.map((p) => [p.type, p.value]));
  const year = Number(map.get('year') ?? 0);
  const month = Number(map.get('month') ?? 1) - 1;
  const day = Number(map.get('day') ?? 1);
  const hour = Number(map.get('hour') ?? 0);
  const minute = Number(map.get('minute') ?? 0);
  const second = Number(map.get('second') ?? 0);
  const asUtc = Date.UTC(year, month, day, hour, minute, second);
  return (asUtc - date.getTime()) / 60000;
}

export function toUtcIsoFromZonedInput(value: string, timeZone: string): string {
  const [datePart, timePart] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = getTimeZoneOffset(new Date(utcGuess), timeZone);
  const utcTime = utcGuess - offset * 60_000;
  return new Date(utcTime).toISOString();
}

export function formatDateTimeForInput(date: Date, timeZone: string): string {
  const fixedOffset = parseFixedOffsetMinutes(timeZone);
  if (fixedOffset !== null) {
    const shifted = new Date(date.getTime() + fixedOffset * 60_000);
    const year = String(shifted.getUTCFullYear()).padStart(4, '0');
    const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const day = String(shifted.getUTCDate()).padStart(2, '0');
    const hour = String(shifted.getUTCHours()).padStart(2, '0');
    const minute = String(shifted.getUTCMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:${minute}`;
  }

  const safeTimeZone = normalizeTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map = new Map(parts.map((p) => [p.type, p.value]));
  const year = map.get('year') ?? '0000';
  const month = map.get('month') ?? '01';
  const day = map.get('day') ?? '01';
  const hour = map.get('hour') ?? '00';
  const minute = map.get('minute') ?? '00';
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function formatDateForInput(date: Date, timeZone: string): string {
  return formatDateTimeForInput(date, timeZone).split('T')[0] ?? '';
}

export function formatStoredDateOnlyLabel(iso: string | null): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatStoredDateOnlyForInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatFileSize(size: number): string {
  if (!size) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / Math.pow(1024, idx);
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function parseDecimalValue(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') return null;

  const normalized = value.trim().replace(/\s+/g, '').replace(',', '.');
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatDateTimeInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function toIsoFromDateTimeInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeCurrencyCode(currency: string | null | undefined): string {
  return (currency ?? '').trim().toUpperCase();
}