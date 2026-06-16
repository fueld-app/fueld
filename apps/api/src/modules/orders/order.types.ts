// ═══════════════════════════════════════════════════════════════════════
//  Order Types — shared interfaces for orders service
// ═══════════════════════════════════════════════════════════════════════

export interface ListOrdersQuery {
  search?: string;
  statuses?: string[];
  salesRepId?: string;
  brokerId?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface CreateOrderInput {
  tenantId: string;
  clientId: string;
  vesselId: string;
  placeId: string;
  salesRepId?: string | null;
  invoicingCompanyId?: string | null;
  bankAccountId?: string | null;
  currency?: string;
  eta?: string | null;
  etd?: string | null;
  customerPaymentTermType?: 'CREDIT' | 'COD' | 'PREPAY' | null;
  customerCreditDays?: number | null;
  customerNote?: string | null;
  purchaseOrderNumber?: string | null;
  customerContactId?: string | null;
  supplierId?: string | null;
  supplierPaymentTermType?: 'CREDIT' | 'COD' | 'PREPAY' | null;
  supplierCreditDays?: number | null;
  supplierNote?: string | null;
  supplierContactId?: string | null;
  termsAndConditions?: string | null;
  placeRemark?: string | null;
  brokerId?: string | null;
  brokerContactId?: string | null;
  brokerGetsAll?: boolean;
  agentId?: string | null;
  agentContactId?: string | null;
  categoryKey?: string | null;
}

export interface UpdateOrderInput {
  clientId?: string;
  vesselId?: string;
  placeId?: string;
  salesRepId?: string | null;
  invoicingCompanyId?: string | null;
  bankAccountId?: string | null;
  currency?: string;
  status?: string;
  eta?: string | null;
  etd?: string | null;
  deliveredAt?: string | null;
  customerPaymentTermType?: 'CREDIT' | 'COD' | 'PREPAY' | null;
  customerCreditDays?: number | null;
  customerNote?: string | null;
  purchaseOrderNumber?: string | null;
  customerContactId?: string | null;
  supplierId?: string | null;
  supplierPaymentTermType?: 'CREDIT' | 'COD' | 'PREPAY' | null;
  supplierCreditDays?: number | null;
  supplierNote?: string | null;
  supplierContactId?: string | null;
  termsAndConditions?: string | null;
  placeRemark?: string | null;
  lossReason?: string | null;
  brokerId?: string | null;
  brokerContactId?: string | null;
  brokerGetsAll?: boolean;
  agentId?: string | null;
  agentContactId?: string | null;
  categoryKey?: string | null;
}

export interface SaveItemInput {
  id?: string;
  orderSupplierId?: string | null;
  productType: string;
  quantity: string;
  quantityMin?: string | null;
  quantityMax?: string | null;
  unit?: string;
  costUnit?: string;
  salesUnit?: string;
  costConversionFactor?: string | null;
  unitConversionFactor?: string | null;
  description?: string | null;
  costPrice?: string | null;
  costCurrency?: string | null;
  salesPrice?: string | null;
  salesCurrency?: string | null;
  paymentTerms?: string | null;
  customerNote?: string | null;
  deliveredQuantity?: string | null;
  costPricingModel?: string | null;
  costReferenceId?: string | null;
  costPlattsEntryId?: string | null;
  costPremium?: string | null;
  costBarging?: string | null;
  costBargingUnit?: string | null;
  costCreditDays?: number | null;
  costPriceFinalized?: boolean | null;
  salesPricingModel?: string | null;
  salesReferenceId?: string | null;
  salesPlattsEntryId?: string | null;
  salesPremium?: string | null;
  salesBarging?: string | null;
  salesBargingUnit?: string | null;
  salesCreditDays?: number | null;
  salesPriceFinalized?: boolean | null;
  taxRate?: string | null;
  inventorySkuId?: string | null;
  warehouseId?: string | null;
  plannedInventoryAt?: string | null;
}

export interface FinalizeItemPriceInput {
  side: 'cost' | 'sales';
  finalPrice: string;
}

export type OrderActivityValueResolver =
  | 'counterparty'
  | 'contact'
  | 'vessel'
  | 'place'
  | 'user'
  | 'bankAccount';

export interface OrderActivityChange {
  field: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
}

export interface OrderUpdateActivityMetadata {
  action: 'update_order_fields';
  changes: OrderActivityChange[];
}
