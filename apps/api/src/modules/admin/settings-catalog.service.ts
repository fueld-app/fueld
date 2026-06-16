// ═══════════════════════════════════════════════════════════════════════
//  Settings Catalog Service — products, units, currencies, references
// ═══════════════════════════════════════════════════════════════════════

import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { tenants, priceReferences, type TenantSettings } from '../../db/schema';

async function getTenantSettingsRow() {
  const [tenant] = await db.select({ id: tenants.id, settings: tenants.settings }).from(tenants).limit(1);
  const settings = (tenant?.settings ?? {}) as TenantSettings;
  return { tenantId: tenant?.id ?? '', settings, rawTenant: tenant };
}

async function updateTenantField<T>(key: string, value: T): Promise<T> {
  const { tenantId, settings } = await getTenantSettingsRow();
  await db.update(tenants).set({ settings: { ...settings, [key]: value }, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
  return value;
}

// ─── Products ──────────────────────────────────────────────────────

export async function getProductSettings(): Promise<{ products: string[] }> {
  const { settings } = await getTenantSettingsRow();
  return { products: settings.productTypes ?? [] };
}

export async function updateProductSettings(products: string[]): Promise<{ products: string[] }> {
  return { products: await updateTenantField('productTypes', products) };
}

// ─── Units ─────────────────────────────────────────────────────────

export async function getUnitSettings(): Promise<{ units: string[] }> {
  const { settings } = await getTenantSettingsRow();
  return { units: settings.unitTypes ?? [] };
}

export async function updateUnitSettings(units: string[]): Promise<{ units: string[] }> {
  return { units: await updateTenantField('unitTypes', units) };
}

export interface UnitConversion {
  fromUnit: string;
  toUnit: string;
  factor: string;
}

export async function getUnitConversionSettings(): Promise<{ conversions: UnitConversion[] }> {
  const { settings } = await getTenantSettingsRow();
  return { conversions: settings.unitConversions ?? [] };
}

export async function updateUnitConversionSettings(conversions: UnitConversion[]): Promise<{ conversions: UnitConversion[] }> {
  return { conversions: await updateTenantField('unitConversions', conversions) };
}

// ─── Currencies ────────────────────────────────────────────────────

export async function getCurrencySettings(): Promise<{ currencies: string[] }> {
  const { settings } = await getTenantSettingsRow();
  return { currencies: settings.currencies ?? [] };
}

export async function updateCurrencySettings(currencies: string[]): Promise<{ currencies: string[] }> {
  return { currencies: await updateTenantField('currencies', currencies) };
}

// ─── Company Types ─────────────────────────────────────────────────

export async function getCompanyTypeSettings(): Promise<{ companyTypes: string[] }> {
  const { settings } = await getTenantSettingsRow();
  return { companyTypes: settings.companyTypes ?? [] };
}

export async function updateCompanyTypeSettings(companyTypes: string[]): Promise<{ companyTypes: string[] }> {
  return { companyTypes: await updateTenantField('companyTypes', companyTypes) };
}

// ─── Price References ──────────────────────────────────────────────

export async function listPriceReferences() {
  return db.select().from(priceReferences).orderBy(priceReferences.name);
}

export async function createPriceReference(input: { name: string; code: string; description?: string | null }) {
  const [created] = await db.insert(priceReferences).values({ name: input.name, code: input.code, description: input.description ?? null }).returning();
  return created;
}

export async function updatePriceReference(id: string, input: { name?: string; code?: string; description?: string | null }) {
  const [updated] = await db.update(priceReferences).set({ ...input, updatedAt: new Date() }).where(eq(priceReferences.id, id)).returning();
  if (!updated) throw new Error('Price reference not found');
  return updated;
}

export async function deletePriceReference(id: string) {
  await db.delete(priceReferences).where(eq(priceReferences.id, id));
}

// ─── Segments ──────────────────────────────────────────────────────

export type SegmentCategory = {
  key: string;
  label: string;
  mode: 'multi' | 'single';
  options: { key: string; label: string }[];
};

export async function getSegmentSettings(): Promise<{ segmentCategories: SegmentCategory[] }> {
  const { settings } = await getTenantSettingsRow();
  return { segmentCategories: settings.segmentCategories ?? [] };
}

export async function updateSegmentSettings(segmentCategories: SegmentCategory[]): Promise<{ segmentCategories: SegmentCategory[] }> {
  return { segmentCategories: await updateTenantField('segmentCategories', segmentCategories) };
}

// ─── Catalog ───────────────────────────────────────────────────────

export interface CatalogItemConfig {
  sku: string;
  name: string;
  productType: string;
  unit: string;
  description?: string;
  category?: string;
  defaultCostPrice?: string;
  defaultSalesPrice?: string;
  isActive: boolean;
}

export async function getCatalogSettings(): Promise<{ items: CatalogItemConfig[] }> {
  const { settings } = await getTenantSettingsRow();
  return { items: settings.catalogItems ?? [] };
}

export async function updateCatalogSettings(items: CatalogItemConfig[]): Promise<{ items: CatalogItemConfig[] }> {
  return { items: await updateTenantField('catalogItems', items) };
}

// ─── Order Categories ──────────────────────────────────────────────

export interface OrderCategoryConfig {
  key: string;
  label: string;
}

export async function getOrderCategorySettings(): Promise<{ categories: OrderCategoryConfig[] }> {
  const { settings } = await getTenantSettingsRow();
  return { categories: settings.orderCategories ?? [] };
}

export async function updateOrderCategorySettings(categories: OrderCategoryConfig[]): Promise<{ categories: OrderCategoryConfig[] }> {
  return { categories: await updateTenantField('orderCategories', categories) };
}

// ─── Default Unit ──────────────────────────────────────────────────

export async function getDefaultUnitSettings(): Promise<{ defaultUnit: string }> {
  const { settings } = await getTenantSettingsRow();
  return { defaultUnit: settings.defaultUnit ?? 'MT' };
}

export async function updateDefaultUnitSettings(defaultUnit: string): Promise<{ defaultUnit: string }> {
  return { defaultUnit: await updateTenantField('defaultUnit', defaultUnit) };
}

// ─── Tax Rates ─────────────────────────────────────────────────────

export interface TaxRateConfig {
  name: string;
  rate: string;
  isDefault?: boolean;
}

export async function getTaxRateSettings(): Promise<{ rates: TaxRateConfig[] }> {
  const { settings } = await getTenantSettingsRow();
  return { rates: settings.taxRates ?? [] };
}

export async function updateTaxRateSettings(rates: TaxRateConfig[]): Promise<{ rates: TaxRateConfig[] }> {
  return { rates: await updateTenantField('taxRates', rates) };
}
