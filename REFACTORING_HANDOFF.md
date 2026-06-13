# Fueld Refactoring — Handoff Notes

## Pattern: Extracting child components from monoliths

### Steps followed
1. Read the full component to understand structure
2. Identify self-contained sections (inventory band, pricing editor)
3. Create child component(s) with explicit `input()` / `output()`
4. Extract shared interfaces to a `*.types.ts` file to avoid circular deps
5. Update parent to use child components
6. Update all files that imported from the old location

### Rules established
- **Shared types** → `order-item.types.ts` (never import types from a `.component.ts`)
- **Child components** → same directory as parent, named `parent-child.component.ts`
- **Pricing component** (`app-order-item-pricing`) — reusable for cost/sell, accepts `side: 'cost' | 'sales'`
- **All components** use `ChangeDetectionStrategy.OnPush` + signals

### Completed
- `order-items.component.ts` (1,823 → 1,280 lines)
  - Extracted `order-item-pricing.component.ts` (386 lines)
  - Extracted `order-item-inventory-band.component.ts` (110 lines)
  - Extracted `order-item.types.ts`

### Next candidates (by size)
1. `send-inquiry-modal.component.ts` (1,762 lines)
2. `integrations-page.component.ts` (1,747 lines)
3. `order-detail-page.component.ts` (5,939 lines — defer until others are done)

### `/ship` command
- Installed globally at `~/.pi/agent/extensions/ship-command.ts`
- Also committed to repo at `.pi/extensions/ship-command.ts`
- Usage: `/ship` (auto-message) or `/ship Custom message here`
