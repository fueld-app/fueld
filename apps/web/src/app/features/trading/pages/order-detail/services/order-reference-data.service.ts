import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, CounterpartyDto, WarehouseDto, InventorySkuDto, DeliveryDocumentationSettingsDto } from '@fueld/types';
import type { DropdownOption } from '../../../shared/components/searchable-dropdown/searchable-dropdown.component';
import { API_URL } from '../../core/config/api';

export interface TeamUserOption { id: string; name: string; email?: string }

@Injectable({ providedIn: 'root' })
export class OrderReferenceDataService {
  private readonly http = inject(HttpClient);

  readonly teamUsers = signal<TeamUserOption[]>([]);
  readonly configuredProducts = signal<DropdownOption[]>([]);
  readonly configuredUnits = signal<DropdownOption[]>([]);
  readonly configuredUnitConversions = signal<{ productType?: string; fromUnit: string; toUnit: string; factor: number }[]>([]);
  readonly configuredCurrencies = signal<DropdownOption[]>([]);
  readonly configuredPriceReferences = signal<{ id: string; name: string; code: string }[]>([]);
  readonly configuredAttachmentTypes = signal<string[]>(['BDR', 'OTHER']);
  readonly deliveryDocumentationSettings = signal<DeliveryDocumentationSettingsDto>({
    enabled: false,
    deliveryDocumentationTypes: [],
    portAuthorityEnabled: false,
  });
  readonly catalogItems = signal<{ name: string; description?: string; defaultUnit?: string; defaultCostPrice?: number; defaultSalesPrice?: number }[]>([]);
  readonly defaultUnit = signal<string>('MT');
  readonly orderCategories = signal<{ key: string; label: string }[]>([]);
  readonly taxRates = signal<{ id: string; name: string; rate: number }[]>([]);
  readonly inquiryCancelReasons = signal<string[]>([]);
  readonly allWarehouses = signal<WarehouseDto[]>([]);
  readonly inventorySkus = signal<InventorySkuDto[]>([]);

  /** Load all reference data in parallel. */
  async loadAll(currentSupplierId?: string, currentSupplier?: CounterpartyDto | null, existingSuppliers?: CounterpartyDto[]): Promise<void> {
    try {
      const [suppliersRes, usersRes, productsRes, catalogRes, defaultUnitRes, orderCategoriesRes, taxRatesRes, unitsRes, unitConversionsRes, currenciesRes, attachmentTypesRes, deliveryDocRes, cancelReasonsRes, priceRefsRes, warehousesRes, skusRes] = await Promise.all([
        firstValueFrom(this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(`${API_URL}/companies/local?type=SUPPLIER&limit=100`)),
        firstValueFrom(this.http.get<ApiResponse<TeamUserOption[]>>(`${API_URL}/lloyds/users`)),
        firstValueFrom(this.http.get<ApiResponse<{ products: string[] }>>(`${API_URL}/admin/settings/my-products`)),
        firstValueFrom(this.http.get<ApiResponse<{ items: any[] }>>(`${API_URL}/admin/settings/catalog`)),
        firstValueFrom(this.http.get<ApiResponse<{ defaultUnit: string }>>(`${API_URL}/admin/settings/default-unit`)),
        firstValueFrom(this.http.get<ApiResponse<{ categories: any[] }>>(`${API_URL}/admin/settings/order-categories`)),
        firstValueFrom(this.http.get<ApiResponse<{ rates: any[] }>>(`${API_URL}/admin/settings/tax-rates`)),
        firstValueFrom(this.http.get<ApiResponse<{ units: string[] }>>(`${API_URL}/admin/settings/my-units`)),
        firstValueFrom(this.http.get<ApiResponse<{ conversions: any[] }>>(`${API_URL}/admin/settings/my-unit-conversions`)),
        firstValueFrom(this.http.get<ApiResponse<{ currencies: string[] }>>(`${API_URL}/admin/settings/my-currencies`)),
        firstValueFrom(this.http.get<ApiResponse<{ attachmentTypes: string[] }>>(`${API_URL}/admin/settings/my-attachment-types`)),
        firstValueFrom(this.http.get<ApiResponse<DeliveryDocumentationSettingsDto>>(`${API_URL}/admin/settings/my-delivery-documentation`)),
        firstValueFrom(this.http.get<ApiResponse<{ reasons: string[] }>>(`${API_URL}/admin/settings/my-inquiry-cancel-reasons`)),
        firstValueFrom(this.http.get<ApiResponse<{ references: any[] }>>(`${API_URL}/admin/settings/my-price-references`)),
        firstValueFrom(this.http.get<ApiResponse<WarehouseDto[]>>(`${API_URL}/inventory/warehouses?activeOnly=true&inventoryEnabledOnly=true`)),
        firstValueFrom(this.http.get<ApiResponse<InventorySkuDto[]>>(`${API_URL}/inventory/skus`)),
      ]);

      if (usersRes.success) this.teamUsers.set(usersRes.data ?? []);
      if (productsRes.success) this.configuredProducts.set(productsRes.data.products.map((p: string) => ({ value: p, label: p })));
      if (catalogRes.success) this.catalogItems.set(catalogRes.data.items ?? []);
      if (defaultUnitRes.success) this.defaultUnit.set(defaultUnitRes.data.defaultUnit ?? 'MT');
      if (orderCategoriesRes.success) this.orderCategories.set(orderCategoriesRes.data.categories ?? []);
      if (taxRatesRes.success) this.taxRates.set(taxRatesRes.data.rates ?? []);
      if (unitsRes.success) this.configuredUnits.set(unitsRes.data.units.map((u: string) => ({ value: u, label: u })));
      if (unitConversionsRes.success) this.configuredUnitConversions.set(unitConversionsRes.data.conversions);
      if (currenciesRes.success) this.configuredCurrencies.set(currenciesRes.data.currencies.map((c: string) => ({ value: c, label: c })));
      if (attachmentTypesRes.success && attachmentTypesRes.data.attachmentTypes.length) this.configuredAttachmentTypes.set(attachmentTypesRes.data.attachmentTypes);
      if (deliveryDocRes.success) this.deliveryDocumentationSettings.set(deliveryDocRes.data);
      if (cancelReasonsRes.success) this.inquiryCancelReasons.set(cancelReasonsRes.data.reasons ?? []);
      if (priceRefsRes.success) this.configuredPriceReferences.set(priceRefsRes.data.references ?? []);
      if (warehousesRes.success) this.allWarehouses.set(warehousesRes.data ?? []);
      if (skusRes.success) this.inventorySkus.set(skusRes.data ?? []);
    } catch { /* silently ignore */ }
  }
}
