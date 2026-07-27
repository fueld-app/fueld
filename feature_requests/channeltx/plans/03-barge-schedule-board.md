# Feature 3: OPS Board / Barge Schedule

**Priority:** P3 · **Complexity:** Highest · **Effort:** XL (2–4 weeks) · **Dependencies:** Schema changes + new UI

## Request

Update the OPS Board to match their Barge Schedule spreadsheet. Line items need to be movable (drag-to-reorder by priority). The team is used to the spreadsheet format.

## Their Spreadsheet Structure (from the xlsx)

### Sections (by category)
| Section | Description |
|---------|-------------|
| CLEANINGS | Active barge cleaning jobs — columns: Barge #, Dock, MTY/LD, Prior Cargo, Next Cargo, Current Location, Status, Work Date, OT, Type of Cleaning/Orders, Req. 3rd Party Inspector, Priority/Comments |
| MAINTENANCE | Maintenance jobs — columns: Barge #, Dock, Prior/Current Cargo, Current Location/ETA, Status, ETC, Maintenance/Cleaning Orders, Req. 3rd Party Inspector, Comments |
| STEAMING | Barges underway — columns: Barge #, Dock, MTY/LD, Cargo, Target Temp, Current Location, Status, Discharge Dock, Comments |
| BARGE TO BARGE TRANSFER | Transfer operations — columns: Barge #, Dock, Sender/Receiver, Cargo, Current Location, Status, BTB Date, OT, Transfer Orders, Req. 3rd Party Inspector, Comments |
| COMPLETED / READY TO INVOICE | Finished jobs — same columns as CLEANINGS + invoice number/status |

### Additional sheets
| Sheet | Content |
|-------|---------|
| Dock Schedule | Dock #1/#2 assignments — ordered list of barges per dock |
| Move/Shift Boat | Inbound/outbound barge movement schedule |
| Teams | Team roster — Team 1/2/3 with Supervisor, Team Leader, Cleaning Techs, PICs |

### Color coding
- 🔴 Not Invoiced
- 🟡 Pending Docs/Hold
- 🟢 Invoiced

### Custom statuses
"IN-QUEUE-4", "IN-QUEUE-5", "IN PROGRESS", "COMPLETE/WAITING PAPERWORK", "INVOICE 1631 // SENT 5/22", etc.

## Existing Infrastructure

| Component | Location | Notes |
|-----------|----------|-------|
| Operations Board | `web/.../operations-board-page.component.ts` (274L) | Simple Kanban by order status (INQUIRY → PAID) |
| Order Model | `orders` table | `vesselId` (barge), `placeId` (dock/location), `status`, `deliveredAt`, `categoryKey`, `deliveryMethod` |
| Vessel Model | `vessels` table | `name`, `type`, `flag`, `imo` — represents barges |
| Order Categories | `TenantSettings.orderCategories` | Groups orders by business line |
| Order Item Reorder | `orderItems.sortOrder` | Proven drag-to-reorder pattern for line items |
| Comments | `entityComments` table | Comments on orders with follow-up dates |
| Attachments | `orderAttachments` table | Configurable attachment types |

## Gap

The existing board is a simple status-Kanban. ChannelTX needs:
1. **Category-based sections** (not status-based) — CLEANINGS, MAINTENANCE, STEAMING, etc.
2. **Custom columns** mapped to order/vessel/item fields (Prior Cargo, Next Cargo, MTY/LD, OT, etc.)
3. **Drag-to-reorder priority** within sections (needs new `boardSortOrder` field on orders)
4. **Barge-specific fields** not currently on the order model (Prior Cargo, Next Cargo, MTY/LD, OT number, 3rd Party Inspector flag)
5. **Custom statuses** with color coding (IN-QUEUE-4, IN PROGRESS, etc.)
6. Optional: dock scheduling, team roster, move/shift views

## Implementation

### Schema Changes
| Change | Table | Type | Notes |
|--------|-------|------|-------|
| `boardSortOrder` | `orders` | integer, nullable, default 0 | Priority ordering within board sections. Tenant-agnostic — only used when barge schedule board is enabled. |
| `customFields` (JSONB) | `orders` | jsonb, nullable | Flexible key-value store for barge-specific fields: `priorCargo`, `nextCargo`, `mtyLd`, `otNumber`, `requiresThirdPartyInspector`, `targetTemp`, `dischargeDock`, etc. Avoids adding many dedicated columns. |

Add Drizzle migration:
```sql
ALTER TABLE orders ADD COLUMN board_sort_order integer DEFAULT 0;
ALTER TABLE orders ADD COLUMN custom_fields jsonb DEFAULT '{}';
```

### Backend
1. Add API endpoints:
   - `GET /operations/barge-schedule` — returns orders grouped by section (category), sorted by `boardSortOrder`
   - `PATCH /operations/barge-schedule/reorder` — update `boardSortOrder` for multiple orders (drag-and-drop)
   - `PATCH /orders/:id/custom-fields` — update barge-specific custom fields
2. Add custom status validation — statuses must be in the tenant's `bargeScheduleBoard.customStatuses` list
3. Extend order list query to include `vessel.name`, `place.name`, `customFields`, latest comment, and invoice info

### Frontend
1. Create new `BargeScheduleBoardComponent` (separate from existing Operations Board):
   - **Section headers** — mapped to `orderCategories` (CLEANINGS, MAINTENANCE, etc.)
   - **Sortable rows** — drag-and-drop within sections using Angular CDK `cdkDrag`
   - **Custom columns** — configurable per tenant, rendered from `bargeScheduleBoard.columns`
   - **Color-coded status badges** — mapped from `bargeScheduleBoard.customStatuses`
   - **Inline editing** — click to edit custom fields (Prior Cargo, Next Cargo, etc.)
   - **Quick comment** — add comment directly from the board row
2. Route: `/operations/barge-schedule` (only accessible when `bargeScheduleBoard.enabled` is true)
3. Optional views:
   - **Dock Schedule** — drag barges to dock slots
   - **Team Roster** — view/edit team assignments
   - **Move/Shift** — inbound/outbound movement tracker

### Column Mapping

| Spreadsheet Column | FUELD Data Source | Notes |
|--------------------|-------------------|-------|
| Barge # | `vessel.name` | Already linked via `orders.vesselId` |
| Dock | `place.name` | Already linked via `orders.placeId` |
| MTY/LD | `customFields.mtyLd` or `deliveryMethod` | New custom field or reuse existing |
| Prior Cargo | `customFields.priorCargo` | Manual field or auto from previous order on vessel |
| Next Cargo | `customFields.nextCargo` | Manual field |
| Current Location | `customFields.currentLocation` or `place.name` | |
| Status | `orders.status` + custom statuses | Extended status mapping |
| Work Date | `orders.deliveredAt` or `orders.eta` | |
| OT | `orders.orderNumber` or `customFields.otNumber` | |
| Type of Cleaning/Orders | `orderItems.productType` + `description` | Concatenated line items |
| Req. 3rd Party Inspector | `customFields.requiresThirdPartyInspector` | Boolean |
| Priority / Comments | `entityComments` (latest) | Already exists |

### TenantSettings Flag

```typescript
bargeScheduleBoard?: {
  enabled: boolean;
  sections: {
    categoryKey: string;          // maps to orderCategories key
    label: string;
    statuses: string[];           // which statuses appear in this section
  }[];
  columns: string[];              // which columns to show (see mapping above)
  customStatuses?: {
    key: string;
    label: string;
    color: string;                // hex or tailwind class
  }[];
  enableDockScheduling?: boolean;
  enableTeamRoster?: boolean;
  enableMoveShift?: boolean;
};
```

## Questions for ChannelTX

- Your spreadsheet has sections (Cleanings, Maintenance, Steaming, Barge-to-Barge Transfer, Completed/Ready to Invoice). Should these map to order categories in the system, or should they be custom?
- What does "OT" column refer to (Order Type? OT number?)?
- "IN-QUEUE-4", "IN-QUEUE-5" — is this a priority queue? How should we handle the numbering?
- Should line items be draggable within sections only, or also between sections (e.g., drag from Cleanings to Completed)?
- Do you need the Dock Schedule (Dock #1/#2 assignments) and Team Roster views as well?
- The "Move/Shift Boat" sheet — should this be integrated into the board?
- Should "Prior Cargo" and "Next Cargo" be manual fields, or auto-populated from the previous/next order on that barge?
- What does "MTY/LD" mean exactly (empty/loaded)?