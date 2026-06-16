// ═══════════════════════════════════════════════════════════════════════
//  Order Items Service — CRUD for order line items
// ═══════════════════════════════════════════════════════════════════════

import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { orderItems, orders } from '../../db/schema';
import { calculateGrossProfitBase } from './order-financing';
import type { SaveItemInput, FinalizeItemPriceInput } from './order.types';

// ─── Save Order Items (upsert strategy) ─────────────────────────────

export async function saveOrderItems(orderId: string, items: SaveItemInput[]) {
  const [orderRow] = await db
    .select({ currency: orders.currency })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  const orderCurrency = orderRow?.currency ?? 'USD';

  // Look up supplier records for this order
  const { orderSuppliers } = await import('../../db/schema');
  const supplierRows = await db
    .select({ id: orderSuppliers.id })
    .from(orderSuppliers)
    .where(eq(orderSuppliers.orderId, orderId));
  const supplierIds = new Set(supplierRows.map((row) => row.id));
  const defaultOrderSupplierId = supplierRows.length === 1 ? supplierRows[0]!.id : null;

  const values = items.map((item) => {
    const orderSupplierId = item.orderSupplierId ?? defaultOrderSupplierId;
    if (orderSupplierId && !supplierIds.has(orderSupplierId)) {
      throw new Error('Order item supplier must belong to the same order');
    }
    if (!orderSupplierId && supplierRows.length > 1) {
      throw new Error('Each order item must specify a supplier when an order has multiple suppliers');
    }

    const costCurrency = (item.costCurrency ?? orderCurrency).toUpperCase();
    const salesCurrency = (item.salesCurrency ?? orderCurrency).toUpperCase();
    const profit = calculateGrossProfitBase({
      quantity: item.quantity,
      costPrice: item.costPrice,
      costCurrency,
      costConversionFactor: item.costConversionFactor,
      salesPrice: item.salesPrice,
      salesCurrency,
      unitConversionFactor: item.unitConversionFactor,
    });

    let taxAmount: string | null = null;
    if (item.taxRate != null && item.salesPrice != null) {
      const rate = parseFloat(item.taxRate);
      const price = parseFloat(item.salesPrice);
      const qty = parseFloat(item.quantity);
      if (Number.isFinite(rate) && Number.isFinite(price) && Number.isFinite(qty)) {
        taxAmount = (price * qty * rate).toFixed(2);
      }
    }

    return {
      orderId,
      orderSupplierId: orderSupplierId ?? null,
      productType: item.productType as any,
      quantity: item.quantity,
      quantityMin: item.quantityMin ?? null,
      quantityMax: item.quantityMax ?? null,
      unit: item.unit ?? 'MT',
      costUnit: item.costUnit ?? item.unit ?? 'MT',
      salesUnit: item.salesUnit ?? item.unit ?? 'MT',
      costConversionFactor: item.costConversionFactor ?? '1',
      unitConversionFactor: item.unitConversionFactor ?? '1',
      description: item.description ?? null,
      costPrice: item.costPrice ?? null,
      costCurrency,
      salesPrice: item.salesPrice ?? null,
      salesCurrency,
      profit: profit.toFixed(4),
      paymentTerms: (item.paymentTerms as any) ?? null,
      customerNote: item.customerNote ?? null,
      deliveredQuantity: item.deliveredQuantity ?? null,
      costPricingModel: (item.costPricingModel as any) ?? 'FIXED',
      costReferenceId: item.costReferenceId ?? null,
      costPlattsEntryId: item.costPlattsEntryId ?? null,
      costPremium: item.costPremium ?? null,
      costBarging: item.costBarging ?? null,
      costBargingUnit: item.costBargingUnit ?? null,
      costCreditDays: item.costCreditDays ?? null,
      costPriceFinalized: item.costPriceFinalized ?? false,
      salesPricingModel: (item.salesPricingModel as any) ?? 'FIXED',
      salesReferenceId: item.salesReferenceId ?? null,
      salesPlattsEntryId: item.salesPlattsEntryId ?? null,
      salesPremium: item.salesPremium ?? null,
      salesBarging: item.salesBarging ?? null,
      salesBargingUnit: item.salesBargingUnit ?? null,
      salesCreditDays: item.salesCreditDays ?? null,
      salesPriceFinalized: item.salesPriceFinalized ?? false,
      taxRate: item.taxRate ?? null,
      taxAmount,
      inventorySkuId: item.inventorySkuId ?? null,
      warehouseId: item.warehouseId ?? null,
      plannedInventoryAt: item.plannedInventoryAt ? new Date(item.plannedInventoryAt) : null,
    };
  });

  return db.transaction(async (tx) => {
    await tx.delete(orderItems).where(eq(orderItems.orderId, orderId));
    if (values.length === 0) return [];
    return tx.insert(orderItems).values(values).returning();
  });
}

// ─── Finalize Formula Price ────────────────────────────────────────

export async function finalizeItemPrice(
  orderId: string,
  itemId: string,
  input: FinalizeItemPriceInput,
) {
  const [item] = await db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)))
    .limit(1);

  if (!item) throw new Error('Order item not found');

  const setData: Record<string, unknown> = { updatedAt: new Date() };

  if (input.side === 'cost') {
    if (item.costPricingModel !== 'FORMULA') throw new Error('Cost pricing model is not FORMULA');
    setData.costPrice = input.finalPrice;
    setData.costPriceFinalized = true;
  } else {
    if (item.salesPricingModel !== 'FORMULA') throw new Error('Sales pricing model is not FORMULA');
    setData.salesPrice = input.finalPrice;
    setData.salesPriceFinalized = true;
  }

  const costPrice = input.side === 'cost' ? input.finalPrice : item.costPrice;
  const salesPrice = input.side === 'sales' ? input.finalPrice : item.salesPrice;

  if (costPrice && salesPrice) {
    const profit = calculateGrossProfitBase({
      quantity: item.quantity,
      costPrice,
      costCurrency: item.costCurrency,
      costConversionFactor: item.costConversionFactor,
      salesPrice,
      salesCurrency: item.salesCurrency,
      unitConversionFactor: item.unitConversionFactor,
    });
    setData.profit = profit.toFixed(4);
  }

  const [updated] = await db
    .update(orderItems)
    .set(setData)
    .where(eq(orderItems.id, itemId))
    .returning();

  return updated;
}
