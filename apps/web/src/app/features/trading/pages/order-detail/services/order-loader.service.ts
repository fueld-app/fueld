import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, OrderDto, OwnCompanyDto, OrderSupplierDto, CounterpartyDto } from '@fueld/types';
import { PricingModel } from '@fueld/types';
import { API_URL } from '@app/core/config/api';
import type { OrderItemRow } from '../../../components/order-items/order-item.types';

export interface OrderLoadResult {
  order: OrderDto | null;
  ownCompanies: OwnCompanyDto[];
  customerContact: any;
  supplierContact: any;
  brokerContact: any;
  agentContact: any;
  client: CounterpartyDto | null;
  supplier: CounterpartyDto | null;
  vessel: any;
  port: any;
  orderSuppliers: OrderSupplierDto[];
  items: OrderItemRow[];
  broker: any;
  agent: any;
}

@Injectable({ providedIn: 'root' })
export class OrderLoaderService {
  private readonly http = inject(HttpClient);

  async load(id: string): Promise<OrderLoadResult> {
    const [orderRes, ownRes] = await Promise.all([
      firstValueFrom(this.http.get<ApiResponse<any>>(`${API_URL}/orders/${id}`)),
      firstValueFrom(this.http.get<ApiResponse<OwnCompanyDto[]>>(`${API_URL}/companies/own`)),
    ]);

    const result: OrderLoadResult = {
      order: null, ownCompanies: [], customerContact: null, supplierContact: null,
      brokerContact: null, agentContact: null, client: null, supplier: null,
      vessel: null, port: null, orderSuppliers: [], items: [], broker: null, agent: null,
    };

    if (!orderRes.success || !orderRes.data) return result;

    const d = orderRes.data;
    result.customerContact = d.customerContact ?? null;
    result.supplierContact = d.supplierContact ?? null;
    result.brokerContact = d.brokerContact ?? null;
    result.agentContact = d.agentContact ?? null;
    result.broker = d.broker ?? null;
    result.agent = d.agent ?? null;
    result.client = d.client ?? null;
    result.supplier = d.supplier ?? null;
    result.vessel = d.vessel ?? null;
    result.port = d.place ?? null;
    result.orderSuppliers = d.orderSuppliers ?? [];

    result.order = {
      id: d.id, orderNumber: d.orderNumber ?? null, tenantId: d.tenantId,
      clientId: d.clientId, vesselId: d.vesselId, placeId: d.placeId,
      salesRepId: d.salesRepId, invoicingCompanyId: d.invoicingCompanyId,
      bankAccountId: d.bankAccountId ?? null, currency: d.currency ?? 'USD',
      status: d.status, eta: d.eta, etd: d.etd,
      customerPaymentTermType: d.customerPaymentTermType ?? null,
      customerCreditDays: d.customerCreditDays ?? null, customerNote: d.customerNote ?? null,
      purchaseOrderNumber: d.purchaseOrderNumber ?? null,
      customerContactId: d.customerContactId ?? null, supplierId: d.supplierId ?? null,
      supplierPaymentTermType: d.supplierPaymentTermType ?? null,
      supplierCreditDays: d.supplierCreditDays ?? null, supplierNote: d.supplierNote ?? null,
      supplierContactId: d.supplierContactId ?? null, brokerId: d.brokerId ?? null,
      brokerContactId: d.brokerContactId ?? null, brokerGetsAll: d.brokerGetsAll ?? false,
      agentId: d.agentId ?? null, agentContactId: d.agentContactId ?? null,
      termsAndConditions: d.termsAndConditions ?? null, lossReason: d.lossReason,
      financingRateAnnual: d.financingRateAnnual ?? 0.08,
      financingDayCountConvention: d.financingDayCountConvention ?? 365,
      financingDays: d.financingDays ?? 0,
      totalFinancingCost: d.totalFinancingCost ?? '0.0000',
      financingCostPerMt: d.financingCostPerMt ?? null,
      totalNetProfit: d.totalNetProfit ?? '0.0000',
      netMarginPct: d.netMarginPct ?? null, categoryKey: d.categoryKey ?? null,
      closedAt: d.closedAt, deliveredAt: d.deliveredAt ?? null,
      createdAt: d.createdAt, updatedAt: d.updatedAt,
    };

    result.items = (d.items ?? []).map((item: any) => ({
      id: item.id, orderSupplierId: item.orderSupplierId ?? null,
      productType: item.productType ?? '', description: item.description ?? '',
      quantity: parseFloat(item.quantity) || 0,
      quantityMin: item.quantityMin ? parseFloat(item.quantityMin) : null,
      quantityMax: item.quantityMax ? parseFloat(item.quantityMax) : null,
      unit: item.unit ?? 'MT', costUnit: item.costUnit ?? item.unit ?? 'MT',
      salesUnit: item.salesUnit ?? item.unit ?? 'MT',
      costConversionFactor: parseFloat(item.costConversionFactor) || 1,
      unitConversionFactor: parseFloat(item.unitConversionFactor) || 1,
      costPrice: parseFloat(item.costPrice) || 0,
      costCurrency: item.costCurrency ?? d.currency ?? 'USD',
      salesPrice: parseFloat(item.salesPrice) || 0,
      salesCurrency: item.salesCurrency ?? d.currency ?? 'USD',
      profit: parseFloat(item.profit) || 0, paymentTerms: item.paymentTerms ?? '',
      customerNote: item.customerNote ?? '',
      deliveredQuantity: item.deliveredQuantity != null ? parseFloat(item.deliveredQuantity) : null,
      costPricingModel: item.costPricingModel ?? PricingModel.Fixed,
      costReferenceId: item.costReferenceId ?? null,
      costPlattsEntryId: item.costPlattsEntryId ?? null,
      costReferenceName: item.costReferenceName ?? null,
      costPremium: item.costPremium != null ? parseFloat(item.costPremium) : null,
      costBarging: item.costBarging != null ? parseFloat(item.costBarging) : null,
      costBargingUnit: item.costBargingUnit ?? null, costCreditDays: item.costCreditDays ?? null,
      costPriceFinalized: item.costPriceFinalized ?? false,
      salesPricingModel: item.salesPricingModel ?? PricingModel.Fixed,
      salesReferenceId: item.salesReferenceId ?? null,
      salesPlattsEntryId: item.salesPlattsEntryId ?? null,
      salesReferenceName: item.salesReferenceName ?? null,
      salesPremium: item.salesPremium != null ? parseFloat(item.salesPremium) : null,
      salesBarging: item.salesBarging != null ? parseFloat(item.salesBarging) : null,
      salesBargingUnit: item.salesBargingUnit ?? null, salesCreditDays: item.salesCreditDays ?? null,
      salesPriceFinalized: item.salesPriceFinalized ?? false,
      inventorySkuId: item.inventorySkuId ?? null, warehouseId: item.warehouseId ?? null,
      plannedInventoryAt: item.plannedInventoryAt ?? null,
      taxRate: item.taxRate != null ? parseFloat(item.taxRate) : null,
      taxAmount: item.taxAmount != null ? parseFloat(item.taxAmount) : null,
    }));

    if (ownRes.success) result.ownCompanies = ownRes.data;
    return result;
  }
}