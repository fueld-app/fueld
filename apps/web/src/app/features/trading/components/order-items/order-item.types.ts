/** Local mutable model for an order item row. */
export interface OrderItemRow {
  id: string;
  orderSupplierId?: string | null;
  productType: string;
  description: string;
  quantity: number;
  quantityMin: number | null;
  quantityMax: number | null;
  unit: string;
  costUnit: string;
  salesUnit: string;
  costConversionFactor: number;
  unitConversionFactor: number;
  costPrice: number;
  costCurrency: string;
  salesPrice: number;
  salesCurrency: string;
  profit: number;
  paymentTerms: string;
  customerNote?: string | null;
  deliveredQuantity?: number | null;
  // Formula pricing — cost side
  costPricingModel: PricingModel;
  costReferenceId?: string | null;
  costPlattsEntryId?: string | null;
  costReferenceName?: string | null;
  costPremium?: number | null;
  costBarging?: number | null;
  costBargingUnit?: string | null;
  costCreditDays?: number | null;
  costPriceFinalized?: boolean;
  // Formula pricing — sell side
  salesPricingModel: PricingModel;
  salesReferenceId?: string | null;
  salesPlattsEntryId?: string | null;
  salesReferenceName?: string | null;
  salesPremium?: number | null;
  salesBarging?: number | null;
  salesBargingUnit?: string | null;
  salesCreditDays?: number | null;
  salesPriceFinalized?: boolean;
  // Inventory linkage (optional; only relevant when an inventory-enabled warehouse applies)
  inventorySkuId?: string | null;
  warehouseId?: string | null;
  plannedInventoryAt?: string | null;
  // Tax
  taxRate?: number | null;
  taxAmount?: number | null;
}

import { PricingModel } from '@fueld/types';

/** Availability status for a given order item, keyed by row id. */
export interface OrderItemAvailability {
  ok: boolean;
  earliestAvailableAt: string | null;
  shortageQuantity: string | null;
  reason: string | null;
}

export interface OrderItemsEconomics {
  totalQuantity: number;
  totalCost: number;
  totalRevenue: number;
  totalGrossProfit: number;
  totalFinancingCost: number;
  financingCostPerMt: number | null;
  totalNetProfit: number;
  netMarginPct: number | null;
}
