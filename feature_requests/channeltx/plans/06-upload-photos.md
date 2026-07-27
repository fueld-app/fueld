# Feature 6: Upload Photos

**Priority:** P1 · **Complexity:** Low · **Effort:** S (1–3 days) · **Dependencies:** None

## Request

Upload photos to orders. Currently using OneDrive links in comments for access to photos.

## Existing Infrastructure

| Component | Location | Notes |
|-----------|----------|-------|
| Order Attachments | `orderAttachments` table | `type`, `fileName`, `filePath`, `mimeType`, `fileSize`, `uploadedBy` |
| Attachment Types | `TenantSettings.attachmentTypes` | Already configurable per tenant — defaults to `['BDR', 'OTHER']` |
| Upload Endpoint | `orders.controller.ts` | File upload with type validation against configured `attachmentTypes` |
| Image Support | `companies.controller.ts` | Already allows image uploads (png, jpg, jpeg, gif, webp) for company logos |
| Comments | `entityComments` table | Currently used as workaround — pasting OneDrive links |

## Gap

No dedicated "PHOTO" attachment type. No photo gallery view on the order detail page. The infrastructure is already there — this is mostly configuration + a new frontend component.

## Implementation

### Configuration (no code change needed)
1. Add "PHOTO" to ChannelTX's `attachmentTypes` in TenantSettings:
   ```json
   "attachmentTypes": ["BDR", "OTHER", "PHOTO"]
   ```
   This immediately enables photo uploads through the existing attachment upload endpoint.

### Backend
1. Add optional photo sub-types/categories — extend `orderAttachments` with a nullable `category` field (e.g., "BEFORE", "AFTER", "TANK_SEAL"):
   ```sql
   ALTER TABLE order_attachments ADD COLUMN category text;
   ```
2. Update the attachment upload endpoint to accept an optional `category` parameter
3. Add a `GET /orders/:id/photos` endpoint that returns only image attachments (filter by `mimeType` starting with `image/`)

### Frontend
1. Add a **Photo Gallery** component on the order detail page:
   - Grid view of all image attachments
   - Lightbox/modal viewer for full-size photos
   - Category badges (BEFORE, AFTER, TANK_SEAL)
   - Upload button with category selector
2. Show photo gallery only when `photoGallerySettings.enabled` is true
3. Photos are then available for:
   - Feature 5 (Service Report PDF) — embedded in the report
   - Feature 3 (Barge Schedule Board) — thumbnail preview on board rows

### Schema Changes

| Change | Table | Type | Notes |
|--------|-------|------|-------|
| `category` | `orderAttachments` | text, nullable | Photo category (BEFORE, AFTER, TANK_SEAL, OTHER). Nullable — only used for photos. |

### TenantSettings Flag

```typescript
photoGallerySettings?: {
  enabled: boolean;
  photoCategories?: string[];    // e.g., ['BEFORE', 'AFTER', 'TANK_SEAL', 'OTHER']
  maxFileSizeMb?: number;        // default 10
};
```

## Questions for ChannelTX

- Should photos be categorized (e.g., Before, After, Tank Seals, Other)?
- Should photos be viewable in a gallery within the order page?
- Should uploaded photos be embedded in the Service Report PDF (ties into Feature 5)?
- Any file size limits or format restrictions we should know about?