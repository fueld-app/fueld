# Feature 5: Automatic Service Report PDF

**Priority:** P3 · **Complexity:** Medium · **Effort:** L (1–2 weeks) · **Dependencies:** Feature 6 (photos)

## Request

Auto-generate the final PDF report for service projects. Currently a human preps them (takes forever). They believe all info is in the system already.

## Example Report Structure (from EMS363 PDF)

```
BARGE STRIPPING SERVICE REPORT
├── Header: Barge name, Location, Date, Prior cargo
├── Index (always the same)
│   ├── Scope of the service
│   ├── Pictures of the tasks performed
│   └── Vapor Tightness Test Certificate
├── Scope of the Service
│   ├── Barge, Service start/end date+time, Location
│   ├── Services performed (list with prepopulated descriptions)
│   │   ├── Equipment mobilization (air compressor, stripping kit, fuel surcharge)
│   │   ├── Tank Stripping & Cleaning (stripping, vapor control)
│   │   ├── Pressure & Line testing
│   │   ├── Completion & Certification
│   │   └── Additional services & equipment
├── Pictures of the Tasks Performed
│   ├── BEFORE photos
│   ├── Tank Security Seals photos
│   └── (AFTER photos)
└── Vapor Tightness Test Certificate
    └── Attached documentation (BDR, DOI, BIR, MSR, Test Certificates)
```

## Existing Infrastructure

| Component | Location | Notes |
|-----------|----------|-------|
| Document Service | `modules/documents/document.service.ts` (3189L) | PDF generation via pdfmake for invoices, offers, proformas, broker confirmations |
| Document Revisions | `documentRevisions` table | Immutable PDF artifacts with verification refs, SHA256, fingerprints |
| Document Types | `documentTypeEnum` | Current types: invoice, offer, proforma, broker_confirmation, nomination |
| Order Data | `orders` table | `vesselId` (barge), `placeId` (location), `deliveredAt` (service date), `eta`, `etd` |
| Vessel Data | `vessels` table | `name`, `type`, `flag`, `imo` — barge details |
| Order Items | `orderItems` table | `productType` (service type), `description` — scope of services |
| Order Attachments | `orderAttachments` table | BDR, DOI, BIR, MSR, Test Certificates, Photos (after Feature 6) |
| Comments | `entityComments` table | Operational notes |
| PDF Verification | `buildVerificationRef()` | Existing verification URL system for document authenticity |

## Gap

No "Service Report" document type exists. The report has a custom structure with:
- Photo sections (depends on Feature 6)
- Equipment lists with prepopulated descriptions
- Certificate attachments
- Prior cargo tracking
- Configurable sections per service type

## Implementation

### Backend
1. Add `DocumentType: 'SERVICE_REPORT'` to the document type enum:
   ```sql
   ALTER TYPE document_type ADD VALUE 'SERVICE_REPORT';
   ```
2. Create `buildServiceReportDocument()` function in `document.service.ts`:
   - **Header section**: Barge name (`vessel.name`), location (`place.name`), date (`order.deliveredAt`), prior cargo (`customFields.priorCargo` or previous order)
   - **Index page**: Configurable list of sections
   - **Scope of Service**: Service start/end (`order.eta`/`order.deliveredAt`), location, services performed (from `orderItems` with template-based descriptions), equipment used (from configurable list)
   - **Pictures**: `orderAttachments` of type "PHOTO" — embedded as images in the PDF, grouped by category (BEFORE, AFTER, TANK_SEAL)
   - **Certificates**: `orderAttachments` of types BDR, DOI, etc. — listed with links or appended
3. Add description template system:
   - `TenantSettings.serviceReportSettings.descriptionTemplates` maps `productType` → prepopulated description text
   - When generating the report, each `orderItem.productType` looks up its template and renders the full description
4. Add `generateServiceReportPdfBuffer(orderId)` following the existing `generateInvoicePdfBuffer()` pattern
5. Store as immutable `documentRevision` with verification ref
6. Add auto-generation hook: if `autoGenerateOnDelivery` is enabled, generate the report when order status changes to DELIVERED

### Frontend
1. Add "Generate Service Report" button on order detail page (visible only when `serviceReportSettings.enabled` and order has service category)
2. Add service report preview modal (reuse existing PDF viewer)
3. Add template configuration UI in admin settings:
   - Section configuration (add/remove/reorder sections)
   - Description templates per service/product type
   - Photo category configuration
4. Show generated reports in the order's document history

### Template Configuration

```typescript
// Example description templates
{
  "STRIP_LIQUID_FREE": "Stripping of residual cargo to ensure tanks are liquid-free.",
  "VTC": "Required use of Vapor Control to minimize VOC emissions to acceptable TCEQ level based on prior cargo.",
  "PRESSURE_LINE_TEST": "Conducted integrity tests to confirm cargo tank sealing efficiency and prevent vapor leaks.",
  "COMPLETION_CERT": "The service was completed in accordance with standard operational and safety procedures."
}
```

### Schema Changes

| Change | Type | Notes |
|--------|------|-------|
| `SERVICE_REPORT` | Add to `documentTypeEnum` | New document type |
| `customFields.priorCargo` | Via orders `customFields` JSONB (from Feature 3) | Or dedicated column |

### TenantSettings Flag

```typescript
serviceReportSettings?: {
  enabled: boolean;
  sections: {
    key: string;
    label: string;
    type: 'SCOPE' | 'PHOTOS' | 'CERTIFICATES' | 'CUSTOM';
    itemTypes?: string[];        // which attachment types to include
  }[];
  descriptionTemplates?: {
    productType: string;
    description: string;
  }[];
  autoGenerateOnDelivery?: boolean;
  includePhotos?: boolean;
  includeCertificates?: boolean;
  priorCargoSource?: 'previous_order' | 'manual_field';
};
```

## Questions for ChannelTX

- Are the report sections (Scope of Service, Pictures, Vapor Tightness Test Certificate) standard for all reports, or do they vary by service type?
- The "List Selections with prepopulated descriptions" — should these be configurable templates per service type?
- Should photos be embedded directly in the PDF, or linked from OneDrive?
- Should attached documents (BDR, DOI, Test Certificates) be appended to the report PDF?
- Should the report auto-generate when an order is marked Delivered, or be generated on-demand with a button?
- Where does "Prior Cargo" come from — the previous order on the same barge, or a manual field?