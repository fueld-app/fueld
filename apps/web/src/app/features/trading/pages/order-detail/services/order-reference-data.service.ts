import { Service, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, CounterpartyDto, WarehouseDto, InventorySkuDto, DeliveryDocumentationSettingsDto } from '@fueld/types';
import type { DropdownOption } from '@app/shared/components/searchable-dropdown/searchable-dropdown.component';
import { API_URL } from '@app/core/config/api';

export interface TeamUserOption { id: string; name: string; email?: string }

@Service()
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
    requireDeliveryDocumentation: false,
    deliveryDocumentationTypes: [],
  });
  readonly catalogItems = signal<{ name: string; description?: string; defaultUnit?: string; defaultCostPrice?: number; defaultSalesPrice?: number }[]>([]);
  readonly defaultUnit = signal<string>('MT');
  readonly orderCategories = signal<{ key: string; label: string }[]>([]);
  readonly taxRates = signal<{ id: string; name: string; rate: number }[]>([]);
  readonly costSalesDecimalPrecision = signal<number>(5);
  readonly inquiryCancelReasons = signal<string[]>([]);
  readonly allWarehouses = signal<WarehouseDto[]>([]);
  readonly inventorySkus = signal<InventorySkuDto[]>([]);

  private _eagerLoaded = false;
  private _lazyLoaded = false;

  /** Load reference data needed immediately for page render. Skips API if already cached. */
  async loadEager(): Promise<void> {
    if (this._eagerLoaded) return;
    this._eagerLoaded = true;
    try {
      const [usersRes, productsRes, unitsRes, currenciesRes, categoriesRes, attachmentTypesRes, deliveryDocRes] = await Promise.all([
        firstValueFrom(this.http.get<ApiResponse<TeamUserOption[]>>(`${API_URL}/lloyds/users`)),
        firstValueFrom(this.http.get<ApiResponse<{ products: string[] }>>(`${API_URL}/admin/settings/my-products`)),
        firstValueFrom(this.http.get<ApiResponse<{ units: string[] }>>(`${API_URL}/admin/settings/my-units`)),
        firstValueFrom(this.http.get<ApiResponse<{ currencies: string[] }>>(`${API_URL}/admin/settings/my-currencies`)),
        firstValueFrom(this.http.get<ApiResponse<{ categories: any[] }>>(`${API_URL}/admin/settings/order-categories`)),
        firstValueFrom(this.http.get<ApiResponse<{ attachmentTypes: string[] }>>(`${API_URL}/admin/settings/my-attachment-types`)),
        firstValueFrom(this.http.get<ApiResponse<DeliveryDocumentationSettingsDto>>(`${API_URL}/admin/settings/my-delivery-documentation`)),
      ]);

      if (usersRes.success) this.teamUsers.set(usersRes.data ?? []);
      if (productsRes.success) this.configuredProducts.set(productsRes.data.products.map((p: string) => ({ value: p, label: p })));
      if (unitsRes.success) this.configuredUnits.set(unitsRes.data.units.map((u: string) => ({ value: u, label: u })));
      if (currenciesRes.success) this.configuredCurrencies.set(currenciesRes.data.currencies.map((c: string) => ({ value: c, label: c })));
      if (categoriesRes.success) this.orderCategories.set(categoriesRes.data.categories ?? []);
      if (attachmentTypesRes.success && attachmentTypesRes.data.attachmentTypes.length) this.configuredAttachmentTypes.set(attachmentTypesRes.data.attachmentTypes);
      if (deliveryDocRes.success) this.deliveryDocumentationSettings.set(deliveryDocRes.data);
    } catch { /* silently ignore */ }
  }

  /** Load remaining reference data. Skips API if already cached. */
  async loadLazy(): Promise<void> {
    if (this._lazyLoaded) return;
    this._lazyLoaded = true;
    try {
      const [catalogRes, defaultUnitRes, taxRatesRes, unitConversionsRes, cancelReasonsRes, priceRefsRes, warehousesRes, skusRes, precisionRes] = await Promise.all([
        firstValueFrom(this.http.get<ApiResponse<{ items: any[] }>>(`${API_URL}/admin/settings/catalog`)),
        firstValueFrom(this.http.get<ApiResponse<{ defaultUnit: string }>>(`${API_URL}/admin/settings/default-unit`)),
        firstValueFrom(this.http.get<ApiResponse<{ rates: any[] }>>(`${API_URL}/admin/settings/tax-rates`)),
        firstValueFrom(this.http.get<ApiResponse<{ conversions: any[] }>>(`${API_URL}/admin/settings/my-unit-conversions`)),
        firstValueFrom(this.http.get<ApiResponse<{ reasons: string[] }>>(`${API_URL}/admin/settings/my-inquiry-cancel-reasons`)),
        firstValueFrom(this.http.get<ApiResponse<{ references: any[] }>>(`${API_URL}/admin/settings/my-price-references`)),
        firstValueFrom(this.http.get<ApiResponse<WarehouseDto[]>>(`${API_URL}/inventory/warehouses?activeOnly=true&inventoryEnabledOnly=true`)),
        firstValueFrom(this.http.get<ApiResponse<InventorySkuDto[]>>(`${API_URL}/inventory/skus`)),
        firstValueFrom(this.http.get<ApiResponse<{ precision: number }>>(`${API_URL}/admin/settings/my-cost-sales-precision`)),
      ]);

      if (catalogRes.success) this.catalogItems.set(catalogRes.data.items ?? []);
      if (defaultUnitRes.success) this.defaultUnit.set(defaultUnitRes.data.defaultUnit ?? 'MT');
      if (taxRatesRes.success) this.taxRates.set(taxRatesRes.data.rates ?? []);
      if (unitConversionsRes.success) this.configuredUnitConversions.set(unitConversionsRes.data.conversions);
      if (cancelReasonsRes.success) this.inquiryCancelReasons.set(cancelReasonsRes.data.reasons ?? []);
      if (priceRefsRes.success) this.configuredPriceReferences.set(priceRefsRes.data.references ?? []);
      if (warehousesRes.success) this.allWarehouses.set(warehousesRes.data ?? []);
      if (skusRes.success) this.inventorySkus.set(skusRes.data ?? []);
      if (precisionRes.success) this.costSalesDecimalPrecision.set(precisionRes.data.precision ?? 5);
    } catch { /* silently ignore */ }
  }

  /** Load all reference data (backward compat). */
  async loadAll(currentSupplierId?: string, currentSupplier?: CounterpartyDto | null, existingSuppliers?: CounterpartyDto[]): Promise<void> {
    await Promise.all([this.loadEager(), this.loadLazy()]);
  }

  /** Reset cache (e.g. after settings update). */
  invalidateCache(): void {
    this._eagerLoaded = false;
    this._lazyLoaded = false;
  }
}