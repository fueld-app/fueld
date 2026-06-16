// ═══════════════════════════════════════════════════════════════════════
//  Settings Catalog Controller — Products, units, currencies, catalog
//
//  All endpoints under /admin/settings.
//  Admin-only unless marked otherwise.
// ═══════════════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import {
  getProductSettings,
  updateProductSettings,
  getUnitSettings,
  updateUnitSettings,
  getUnitConversionSettings,
  updateUnitConversionSettings,
  getCurrencySettings,
  updateCurrencySettings,
  getCompanyTypeSettings,
  updateCompanyTypeSettings,
  getAttachmentTypeSettings,
  updateAttachmentTypeSettings,
  getVesselTypeSettings,
  updateVesselTypeSettings,
  getCatalogSettings,
  updateCatalogSettings,
  getOrderCategorySettings,
  updateOrderCategorySettings,
  getDefaultUnitSettings,
  updateDefaultUnitSettings,
  getTaxRateSettings,
  updateTaxRateSettings,
  getRoleDashboardSettings,
  updateRoleDashboardSettings,
  getSegmentSettings,
  updateSegmentSettings,
  listPriceReferences,
  createPriceReference,
  updatePriceReference,
  deletePriceReference,
} from './settings.service';
import { reloadCurrencies } from '../prices/price.service';
import type { ApiResponse } from '@fueld/types';

function requireAdmin(auth: { role: string } | undefined) {
  if (!auth || auth.role !== 'ADMIN') {
    throw new Error('Admin access required');
  }
}

export const settingsCatalogController = new Elysia()
  .use(authGuard)

  // ─── Public: any authenticated user can fetch segment categories ───
  .get('/segment-settings/options', async ({ auth }) => {
    try {
      if (!auth) throw new Error('Authentication required');
      const data = await getSegmentSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get segment categories (any user)' },
  })

  // ── Tenant product & unit options (any authenticated user) ──────
  .get('/my-products', async () => {
    try {
      const data = await getProductSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get product options for current tenant' },
  })

  .get('/my-units', async () => {
    try {
      const data = await getUnitSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get unit options for current tenant' },
  })

  .get('/my-unit-conversions', async () => {
    try {
      const data = await getUnitConversionSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get unit conversion defaults for current tenant' },
  })

  .get('/my-price-references', async () => {
    try {
      const references = await listPriceReferences();
      return { success: true, data: { references } } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get price reference sources for current tenant' },
  })

  .get('/my-currencies', async () => {
    try {
      const data = await getCurrencySettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get currency options for current tenant' },
  })

  .get('/my-company-types', async () => {
    try {
      const data = await getCompanyTypeSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get company type options for current tenant' },
  })

  .get('/my-attachment-types', async () => {
    try {
      const data = await getAttachmentTypeSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get attachment type options for current tenant' },
  })

  .get('/my-vessel-types', async () => {
    try {
      const data = await getVesselTypeSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get vessel type options for current tenant' },
  })

  // ═════════════════════════════════════════════════════════════════
  //  PRODUCT SETTINGS
  // ═════════════════════════════════════════════════════════════════

  .get('/products', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getProductSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get configurable product options' },
  })

  .put('/products', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateProductSettings(body.products);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      products: t.Array(t.String({ minLength: 1 })),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update configurable product options' },
  })

  // ═════════════════════════════════════════════════════════════════
  //  UNIT SETTINGS
  // ═════════════════════════════════════════════════════════════════

  .get('/units', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getUnitSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get configurable unit options' },
  })

  .put('/units', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateUnitSettings(body.units);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      units: t.Array(t.String({ minLength: 1 })),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update configurable unit options' },
  })

  // ═════════════════════════════════════════════════════════════════
  //  UNIT CONVERSION SETTINGS
  // ═════════════════════════════════════════════════════════════════

  .get('/unit-conversions', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getUnitConversionSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get unit conversion defaults' },
  })

  .put('/unit-conversions', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateUnitConversionSettings(body.conversions);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      conversions: t.Array(t.Object({
        productType: t.Optional(t.String()),
        fromUnit: t.String({ minLength: 1 }),
        toUnit: t.String({ minLength: 1 }),
        factor: t.Number({ minimum: 0 }),
      })),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update unit conversion defaults' },
  })

  // ═════════════════════════════════════════════════════════════════
  //  CURRENCY SETTINGS
  // ═════════════════════════════════════════════════════════════════

  .get('/currencies', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getCurrencySettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get configurable currency options' },
  })

  .put('/currencies', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateCurrencySettings(body.currencies);
      reloadCurrencies().catch(err => console.warn('[Settings] Failed to reload currencies:', err));
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      currencies: t.Array(t.String({ minLength: 1 })),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update configurable currency options' },
  })

  // ═════════════════════════════════════════════════════════════════
  //  CATALOG SETTINGS
  // ═════════════════════════════════════════════════════════════════

  .get('/catalog', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getCatalogSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get product catalog settings' },
  })

  .put('/catalog', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateCatalogSettings(body.items);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      items: t.Array(t.Object({
        id: t.String(),
        name: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        defaultUnit: t.Optional(t.String()),
        defaultCostPrice: t.Optional(t.Number()),
        defaultSalesPrice: t.Optional(t.Number()),
        defaultTaxRateId: t.Optional(t.String()),
        categoryKey: t.Optional(t.String()),
      })),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update product catalog settings' },
  })

  // ═════════════════════════════════════════════════════════════════
  //  ORDER CATEGORY SETTINGS
  // ═════════════════════════════════════════════════════════════════

  .get('/order-categories', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getOrderCategorySettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get order category settings' },
  })

  .put('/order-categories', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateOrderCategorySettings(body.categories);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      categories: t.Array(t.Object({
        key: t.String({ minLength: 1 }),
        label: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        defaultUnit: t.Optional(t.String()),
      })),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update order category settings' },
  })

  // ═════════════════════════════════════════════════════════════════
  //  DEFAULT UNIT SETTINGS
  // ═════════════════════════════════════════════════════════════════

  .get('/default-unit', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getDefaultUnitSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get default unit setting' },
  })

  .put('/default-unit', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateDefaultUnitSettings(body.defaultUnit);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      defaultUnit: t.String({ minLength: 1 }),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update default unit setting' },
  })

  // ═════════════════════════════════════════════════════════════════
  //  TAX RATE SETTINGS
  // ═════════════════════════════════════════════════════════════════

  .get('/tax-rates', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getTaxRateSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get tax rate settings' },
  })

  .put('/tax-rates', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateTaxRateSettings(body.rates);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      rates: t.Array(t.Object({
        id: t.String(),
        name: t.String({ minLength: 1 }),
        rate: t.Number({ minimum: 0, maximum: 1 }),
        productType: t.Optional(t.String()),
      })),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update tax rate settings' },
  })

  // ═════════════════════════════════════════════════════════════════
  //  ROLE DASHBOARD SETTINGS
  // ═════════════════════════════════════════════════════════════════

  .get('/role-dashboards', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getRoleDashboardSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get role dashboard settings' },
  })

  .put('/role-dashboards', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateRoleDashboardSettings(body.dashboards as Record<string, string>);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      dashboards: t.Record(t.String(), t.String()),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update role dashboard settings' },
  })

  // ═════════════════════════════════════════════════════════════════
  //  COMPANY TYPE SETTINGS
  // ═════════════════════════════════════════════════════════════════

  .get('/company-types', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getCompanyTypeSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get configurable company type options' },
  })

  .put('/company-types', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateCompanyTypeSettings(body.companyTypes);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      companyTypes: t.Array(t.String({ minLength: 1 })),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update configurable company type options' },
  })

  // ═════════════════════════════════════════════════════════════════
  //  ATTACHMENT TYPE SETTINGS
  // ═════════════════════════════════════════════════════════════════

  .get('/attachment-types', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getAttachmentTypeSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get configurable attachment type options' },
  })

  .put('/attachment-types', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateAttachmentTypeSettings(body.attachmentTypes);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      attachmentTypes: t.Array(t.String({ minLength: 1 })),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update configurable attachment type options' },
  })

  .get('/vessel-types', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getVesselTypeSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get configurable vessel type options' },
  })

  .put('/vessel-types', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateVesselTypeSettings(body.vesselTypes);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      vesselTypes: t.Array(t.String({ minLength: 1 })),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update configurable vessel type options' },
  })

  // ═════════════════════════════════════════════════════════════════
  //  PRICE REFERENCES (formula pricing sources)
  // ═════════════════════════════════════════════════════════════════

  .get('/price-references', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const references = await listPriceReferences();
      return { success: true, data: { references } } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'List price reference sources' },
  })

  .post('/price-references', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const ref = await createPriceReference(body);
      return { success: true, data: ref } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      code: t.String({ minLength: 1 }),
      description: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Create a price reference source' },
  })

  .put('/price-references/:id', async ({ auth, params, body }) => {
    try {
      requireAdmin(auth);
      const ref = await updatePriceReference(params.id, body);
      return { success: true, data: ref } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      name: t.Optional(t.String({ minLength: 1 })),
      code: t.Optional(t.String({ minLength: 1 })),
      description: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update a price reference source' },
  })

  .delete('/price-references/:id', async ({ auth, params }) => {
    try {
      requireAdmin(auth);
      await deletePriceReference(params.id);
      return { success: true, data: null } satisfies ApiResponse<null>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Admin Settings'], summary: 'Delete a price reference source' },
  })

  // ═════════════════════════════════════════════════════════════════
  //  SEGMENT SETTINGS (Admin)
  // ═════════════════════════════════════════════════════════════════

  .get('/segment-settings', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getSegmentSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get segment categories (admin)' },
  })

  .put('/segment-settings', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateSegmentSettings(body.segmentCategories);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      segmentCategories: t.Array(t.Object({
        key: t.String({ minLength: 1 }),
        label: t.String({ minLength: 1 }),
        mode: t.Union([t.Literal('multi'), t.Literal('single')]),
        options: t.Array(t.Object({
          key: t.String({ minLength: 1 }),
          label: t.String({ minLength: 1 }),
          description: t.Optional(t.String()),
        })),
      })),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update segment categories (admin)' },
  });
