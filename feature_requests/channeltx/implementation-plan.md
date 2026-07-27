# ChannelTX Feature Requests — Implementation Plan

## Overview

ChannelTX has submitted 7 feature requests via `feature_requests/channeltx/reports/`. This plan analyzes each request against the existing FUELD codebase, proposes a per-tenant-gated implementation approach, and identifies clarifying questions that ChannelTX must answer before implementation begins.

**Core principle:** Every feature will be gated behind a new `TenantSettings` flag (following the existing `brokerDeals.enabled` / `whatsappEnabled` / `portDocumentationSettings.enabled` pattern). All flags default to `off`, meaning **zero impact on other tenants**. Each feature can be independently enabled for ChannelTX (and any other tenant that requests it later).

## Deliverables

- [`plans/00-priority-index.md`](plans/00-priority-index.md) — Priority ranking, phase plan, effort estimates
- [`plans/01-sales-reporting.md`](plans/01-sales-reporting.md) — Sales reporting by product (P1)
- [`plans/02-comments-digest.md`](plans/02-comments-digest.md) — Daily comments rundown email (P2)
- [`plans/03-barge-schedule-board.md`](plans/03-barge-schedule-board.md) — OPS board / barge schedule (P3)
- [`plans/04-quickbooks-integration.md`](plans/04-quickbooks-integration.md) — QuickBooks sync (P2)
- [`plans/05-service-report-pdf.md`](plans/05-service-report-pdf.md) — Auto service report PDF (P3)
- [`plans/06-upload-photos.md`](plans/06-upload-photos.md) — Photo uploads (P1)
- [`plans/07-daily-pricing-email.md`](plans/07-daily-pricing-email.md) — Daily fuel dock pricing email (P2)
- [`whatsapp-questions.md`](whatsapp-questions.md) — Clarifying questions formatted as WhatsApp message

## System Context

FUELD is a multi-tenant SaaS platform (Angular frontend + NestJS API + PostgreSQL/Drizzle ORM).

### Key existing infrastructure

| Infrastructure | Location | Relevance |
|---|---|---|
| **TenantSettings JSONB** | `tenants.settings` (schema.ts:431) | Per-tenant feature gating via typed JSONB column. Existing flags: `brokerDeals`, `whatsappEnabled`, `creditApplicationSettings`, `portDocumentationSettings`, `reportsSettings`, `orderCategories`, `attachmentTypes`, etc. |
| **Reports Service** | `modules/reports/reports.service.ts` (2525L) | Margin analysis, trader performance, invoice aging, pipeline summary. Has XLSX/CSV export. Has **scheduled report delivery** via hourly cron (`runDueReportSchedules` / `startReportsScheduleJob`). |
| **Mail Service** | `modules/documents/mail.service.ts` (773L) | Document emails via Microsoft Graph or SMTP. Email templates, CC/BCC rules. |
| **QuickBooks Service** | `modules/quickbooks/quickbooks.service.ts` (843L) | OAuth, customer sync (`findOrCreateQBCustomer`), invoice sync (`createQBInvoice`, `syncInvoiceToQuickBooks`). Per-tenant credentials. |
| **WhatsApp Service** | `modules/whatsapp/whatsapp.service.ts` (707L) | Group messaging, templated notifications, per-tenant notification rules. |
| **Comments Service** | `modules/comments/comments.service.ts` (135L) | Entity-level comments with follow-up dates. Supports comments on orders, places, companies, vessels. |
| **Activity Service** | `modules/activity/activity.service.ts` (491L) | Activity logs tracking all CRUD operations with metadata. |
| **Document/PDF Service** | `modules/documents/document.service.ts` (3189L) | PDF generation via pdfmake for invoices, offers, proformas, broker confirmations. Immutable `documentRevisions` for PDF artifacts. |
| **Operations Board** | `web/.../operations-board-page.component.ts` (274L) | Existing Kanban board showing orders by status (INQUIRY → PAID). |
| **Price Service** | `modules/prices/price.service.ts` (849L) | Commodity prices, FX rates, Platts reports. |
| **Order Attachments** | `orderAttachments` table | Configurable attachment types per tenant. Upload endpoint exists. |
| **Order Data Model** | `orders` + `orderItems` tables | Orders have `vesselId` (barge), `placeId` (dock), `status`, `deliveredAt`, `deliveryMethod`, `categoryKey`. Items have `productType` (text), `quantity`, `unit`, `salesPrice`, `costPrice`, `sortOrder`, `description`. |

### Key data model facts

- `orderItems.productType` is a **text field** (not enum-constrained) — can hold any product/service name
- `orderStatusEnum`: `INQUIRY → OFFER → CONFIRMED → DELIVERED → INVOICED → PAID` (+ `CANCELLED`, `LOST`)
- `TenantSettings.orderCategories` groups orders by business line
- `TenantSettings.attachmentTypes` is configurable per tenant

## Priority Summary

| Priority | Feature | Complexity | Effort | Leverage |
|----------|---------|------------|--------|----------|
| **P1** | 6. Upload Photos | Low | S | High — mostly config + gallery UI |
| **P1** | 1. Sales Reporting by Product | Low | S | High — extends existing reports |
| **P2** | 2. Comments Digest Email | Low-Med | M | Medium — reuses scheduling + email |
| **P2** | 7. Daily Pricing Email | Low-Med | M | Medium — reuses scheduling + email |
| **P2** | 4. QuickBooks Integration | Medium | M | High — extends existing QB service |
| **P3** | 5. Auto Service Report PDF | Medium | L | Medium — new document type + templates |
| **P3** | 3. OPS Board / Barge Schedule | **Highest** | XL | Low-Med — mostly new UI + fields |

## Phase Plan

```
Phase 1 — Quick wins (parallel, no dependencies)
  ├── P1: Feature 6 — Upload Photos
  └── P1: Feature 1 — Sales Reporting

Phase 2 — Medium features (can overlap)
  ├── P2: Feature 2 — Comments Digest Email
  ├── P2: Feature 7 — Daily Pricing Email
  └── P2: Feature 4 — QuickBooks Integration

Phase 3 — Complex features (sequential due to dependency)
  ├── P3: Feature 5 — Service Report PDF  (needs Feature 6 first)
  └── P3: Feature 3 — Barge Schedule Board  (largest, independent)
```

## Schema Changes Summary

| Change | Table | Type | Impact | Feature |
|---|---|---|---|---|
| `boardSortOrder` | `orders` | integer, nullable, default 0 | New column — only used when barge schedule board enabled | #3 |
| `customFields` (JSONB) | `orders` | jsonb, nullable | Flexible barge-specific fields (priorCargo, nextCargo, mtyLd, etc.) | #3, #5 |
| `category` | `orderAttachments` | text, nullable | Photo category (BEFORE, AFTER, TANK_SEAL) | #6 |
| `SERVICE_REPORT` | `documentTypeEnum` | enum addition | New document type | #5 |

All schema changes are **additive** (new nullable columns, new enum values) — no breaking changes for existing tenants.

## TenantSettings Flags Summary

All flags are optional, default to `off`/`undefined`, and are scoped to `tenants.settings` JSONB:

```typescript
// New flags to add to TenantSettings interface
throughputReport?: { enabled: boolean; defaultUnit?: string; groupByCategory?: boolean };
commentsDigest?: { enabled: boolean; hourUtc: number; recipientRoles: string[]; extraEmails?: string[]; includeActivityLog?: boolean; entityTypes?: string[] };
bargeScheduleBoard?: { enabled: boolean; sections: {...}[]; columns: string[]; customStatuses?: {...}[]; enableDockScheduling?: boolean; enableTeamRoster?: boolean; enableMoveShift?: boolean };
quickbooksSettings?: { autoSyncInvoices: boolean; syncProducts: boolean; syncPricing: boolean; notifyEmail?: string };
serviceReportSettings?: { enabled: boolean; sections: {...}[]; descriptionTemplates?: {...}[]; autoGenerateOnDelivery?: boolean; includePhotos?: boolean; includeCertificates?: boolean; priorCargoSource?: 'previous_order' | 'manual_field' };
photoGallerySettings?: { enabled: boolean; photoCategories?: string[]; maxFileSizeMb?: number };
dailyPricingEmail?: { enabled: boolean; placeId: string; hourUtc: number; recipientEmails: string[]; lookbackHours?: number; includeProducts?: string[] };
```

**Enabling for ChannelTX:** Set each flag in ChannelTX's tenant record. No other tenant is affected.

## Open Questions

See [`whatsapp-questions.md`](whatsapp-questions.md) for the formatted WhatsApp message with clarifying questions for ChannelTX. Answers are needed before implementation of each feature.