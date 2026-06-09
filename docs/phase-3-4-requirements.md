# Phase 3 & 4 Requirements — Product Catalog Enhancement

## Overview

This document captures the requirements for **Phase 3 (Customer-specific Unit Defaults)** and **Phase 4 (Tax Rate Assignment)** of the product catalog feature. These phases build on the foundation laid in Phases 1 & 2 (catalog items, order categories, default unit, and simple tax system).

---

## Phase 3: Customer-specific Unit Defaults

### Problem Statement

Currently, when a user selects a product type in the order-items grid, the unit defaults to the tenant-wide `defaultUnit` (e.g. "MT"). However, some customers consistently order certain products in different units (e.g. a specific client always buys MGO in "L"). Users must manually change the unit every time, which is error-prone and slows down order entry.

### Goal

Allow admins to configure **per-customer, per-product default units** so that when a product is selected for a specific client, the unit auto-populates to the customer's preferred unit instead of the tenant default.

### Requirements

#### 3.1 Data Model

- Add a new JSONB field `customerUnitDefaults` to the `TenantSettings` interface.
- Structure:
  ```ts
  interface CustomerUnitDefault {
    customerId: string;      // counterparty ID
    productType: string;     // product name (matches catalog item name)
    defaultUnit: string;     // preferred unit for this customer+product
  }
  ```
- Stored in `tenants.settings.customerUnitDefaults` as an array.

#### 3.2 Backend API

- **GET** `/admin/settings/customer-unit-defaults` — returns `{ defaults: CustomerUnitDefault[] }`
- **PUT** `/admin/settings/customer-unit-defaults` — accepts `{ defaults: CustomerUnitDefault[] }`, validates that `customerId` and `productType` exist, and saves to tenant settings.
- Validation rules:
  - `customerId` must reference an existing counterparty with `type = 'CLIENT'`.
  - `productType` must exist in the tenant's `catalogItems`.
  - `defaultUnit` must exist in the tenant's `units` array.
  - Duplicate `(customerId, productType)` combinations are not allowed (last-write-wins or reject with error).

#### 3.3 Admin Settings UI

- Add a new panel "Customer Unit Defaults" to the admin settings page.
- UI components:
  - Dropdown to select a **Customer** (searchable, async).
  - Dropdown to select a **Product** (from catalog items).
  - Dropdown to select a **Unit** (from configured units).
  - "Add" button to create a new default.
  - Table listing all existing defaults with columns: Customer, Product, Unit, Actions (edit/delete).
  - Inline editing or modal for editing existing defaults.
- Save button persists the full array to the backend.

#### 3.4 Order Items Integration

- Modify `order-items.component.ts` `updateField()` logic for `productType`:
  - When `productType` changes, check if the current order has a `clientId`.
  - If `clientId` is present, look up `customerUnitDefaults` for a matching `(customerId, productType)`.
  - If a match exists, use that unit instead of the tenant-wide `defaultUnit`.
  - Fall back to tenant `defaultUnit` if no customer-specific default exists.
- The `customerUnitDefaults` must be loaded by the order-detail page and passed into `order-items` via a new input.

#### 3.5 Order Detail Page Changes

- Load `customerUnitDefaults` from `/admin/settings/customer-unit-defaults` in `loadReferenceData()`.
- Pass `customerUnitDefaults` into `<app-order-items>`.

#### 3.6 Migration

- No database migration needed (JSONB field in `tenants.settings`).

---

## Phase 4: Tax Rate Assignment

### Problem Statement

Currently, tax rates are configured globally in the admin settings, but there is no way to assign a specific tax rate to a product, customer, or order. Users must manually remember and apply the correct tax rate for each line item.

### Goal

Allow admins to assign default tax rates to **catalog items** and **customers**, and have the order-items grid automatically apply the correct tax rate when a product is selected.

### Requirements

#### 4.1 Data Model Extensions

- Extend `CatalogItemConfigDto` with an optional `defaultTaxRateId` field (already added in Phase 2).
- Add a new JSONB field `customerTaxRates` to `TenantSettings`:
  ```ts
  interface CustomerTaxRate {
    customerId: string;      // counterparty ID
    taxRateId: string;       // references a tax rate config
  }
  ```
- Stored in `tenants.settings.customerTaxRates` as an array.

#### 4.2 Backend API

- **GET** `/admin/settings/customer-tax-rates` — returns `{ rates: CustomerTaxRate[] }`
- **PUT** `/admin/settings/customer-tax-rates` — accepts `{ rates: CustomerTaxRate[] }`, validates and saves.
- Validation rules:
  - `customerId` must reference an existing counterparty with `type = 'CLIENT'`.
  - `taxRateId` must reference an existing tax rate in `taxRates`.
  - Duplicate `customerId` entries are not allowed.

#### 4.3 Admin Settings UI

- Add a new panel "Customer Tax Rates" to the admin settings page.
- UI components:
  - Dropdown to select a **Customer** (searchable, async).
  - Dropdown to select a **Tax Rate** (from configured tax rates).
  - "Add" button to create a new assignment.
  - Table listing all existing assignments with columns: Customer, Tax Rate, Actions (edit/delete).
- Save button persists the full array to the backend.

#### 4.4 Catalog Item Tax Rate Assignment

- In the admin "Product Catalog" panel (already built in Phase 2), add a **Tax Rate** dropdown to each catalog item row.
- The dropdown lists all configured tax rates.
- When a catalog item has a `defaultTaxRateId`, the order-items grid auto-applies that tax rate when the product is selected (already partially implemented in Phase 2).

#### 4.5 Order Items Integration

- Modify `order-items.component.ts` `updateField()` logic for `productType`:
  - When `productType` changes:
    1. Check the catalog item's `defaultTaxRateId`. If set, apply that tax rate.
    2. If no catalog default, check if the current order has a `clientId`.
    3. If `clientId` is present, look up `customerTaxRates` for a matching `customerId`.
    4. If a match exists, apply that tax rate.
    5. If no customer default either, leave `taxRate` null (no tax).
- The `customerTaxRates` must be loaded by the order-detail page and passed into `order-items` via a new input.

#### 4.6 Order Detail Page Changes

- Load `customerTaxRates` from `/admin/settings/customer-tax-rates` in `loadReferenceData()`.
- Pass `customerTaxRates` into `<app-order-items>`.

#### 4.7 Tax Display in Order Items

- The tax column (already added in Phase 2) shows:
  - Tax rate percentage (e.g. "25.00%") when a rate is set.
  - Computed tax amount (e.g. "1250.00") based on `salesPrice * quantity * taxRate`.
  - "—" when no tax rate is set.
- The tax amount is computed by the backend on save (already implemented in Phase 2).

#### 4.8 Migration

- No database migration needed (JSONB fields in `tenants.settings`).

---

## Open Questions / Decisions Needed

1. **Priority of defaults**: When both a catalog item tax rate and a customer tax rate exist, which takes precedence? (Current assumption: catalog item default wins over customer default.)
2. **UI for customer selection**: Should the customer dropdown in admin settings use the existing `SearchableDropdownComponent` with async search, or a simpler static list?
3. **Editing existing defaults**: Should edits be inline in the table, or via a modal?
4. **Validation on save**: Should the backend reject the entire save if one default is invalid, or silently drop invalid entries?
5. **Phase 4 scope**: Should tax rates also be assignable to **suppliers** (for purchase-side tax), or only customers (sales-side tax)?

---

## Dependencies

- Phases 1 & 2 must be deployed and stable before starting Phase 3 or 4.
- The `catalogItems` and `taxRates` settings must be populated before Phase 4 can be used effectively.

## Estimated Effort

- **Phase 3**: ~2-3 hours (backend API + admin UI + order-items wiring)
- **Phase 4**: ~2-3 hours (backend API + admin UI + catalog item tax dropdown + order-items wiring)
