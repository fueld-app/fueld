# Feature 4: QuickBooks Integration

**Priority:** P2 · **Complexity:** Medium · **Effort:** M (3–7 days) · **Dependencies:** Existing QB OAuth

## Request

Sync products/services and pricing between FUELD and QuickBooks. Currently: orders processed in FUELD → invoice sent to backoffice (Kathy@channeltx.com) → manually input into QB → sent out from there.

## Existing Infrastructure

| Component | Location | Notes |
|-----------|----------|-------|
| QuickBooks Service | `modules/quickbooks/quickbooks.service.ts` (843L) | OAuth flow, customer sync, invoice creation/sync — already functional |
| QB OAuth | `generateAuthUrl`, `handleOAuthCallback`, `refreshAccessToken` | Per-tenant credential storage in `integrationCredentials` |
| QB Customer Sync | `findOrCreateQBCustomer()` | Maps FUELD counterparty → QB customer |
| QB Invoice Sync | `createQBInvoice()`, `syncInvoiceToQuickBooks()` | Pushes FUELD invoice → QB invoice (one-way) |
| QB Frontend | `quickbooks-integration-card.component.ts` (356L) | Integration settings UI in admin integrations page |
| Product Catalog | `TenantSettings.catalogItems` | Configurable product/service catalog with default pricing |
| Order Items | `orderItems` table | `productType`, `salesPrice`, `description` — maps to QB line items |

## Gap

The existing QB integration creates invoices in QB from FUELD invoices (one-way, manual trigger). ChannelTX wants:
1. **Product/service sync** — FUELD catalog ↔ QB Items/Services
2. **Pricing sync** — keep sales prices aligned
3. **Automatic invoice push** — auto-sync on invoice creation (currently requires manual button click)

## Implementation

### Backend
1. Add `syncProductsToQuickBooks()` function to `quickbooks.service.ts`:
   - Read `catalogItems` from TenantSettings
   - For each catalog item, create or update a QB Item/Service via QB API (`POST /v3/company/{realmId}/item`)
   - Store mapping: FUELD `catalogItem.id` → QB Item ID in `integrationCredentials` (e.g., key `qb_item_{catalogItemId}`)
2. Add `syncProductPricing()` function:
   - Update QB item rate from `catalogItems.defaultSalesPrice`
   - Called during product sync or independently
3. Add auto-sync option:
   - Hook into invoice creation flow — when a FUELD invoice is created/finalized, automatically call `syncInvoiceToQuickBooks()` if `autoSyncInvoices` is enabled
   - Optionally send notification email to configured address (e.g., Kathy) when sync completes
4. Add product mapping endpoint:
   - `POST /quickbooks/sync-products` — trigger product sync
   - `GET /quickbooks/product-mappings` — list current FUELD → QB item mappings
5. Handle QB item creation for `orderItems.productType` values not in the catalog — auto-create QB items for new product types

### Frontend
1. Extend `quickbooks-integration-card.component.ts`:
   - Add "Sync Products" button
   - Add toggle for auto-sync invoices
   - Add toggle for product/pricing sync
   - Add notification email field
   - Show sync status (last synced, pending items)
2. Add product mapping view — table showing FUELD product → QB item mapping

### Schema Changes
**None** — uses existing `integrationCredentials` table for storing QB item mappings (key-value pairs per tenant).

### TenantSettings Flag

```typescript
quickbooksSettings?: {
  autoSyncInvoices: boolean;      // auto-push invoices to QB on creation
  syncProducts: boolean;          // sync product catalog to QB items
  syncPricing: boolean;           // sync sales prices to QB item rates
  notifyEmail?: string;           // email (e.g., Kathy) when invoice is synced
};
```

## Questions for ChannelTX

- Are you using QuickBooks Online or QuickBooks Desktop?
- Should products/services be auto-created in QuickBooks from the FUELD catalog, or mapped to existing QuickBooks items?
- Should invoice sync happen automatically when an invoice is created in FUELD, or should it be a manual button click?
- Should Kathy (backoffice@channeltx.com) still receive an email notification when an invoice is pushed to QB?