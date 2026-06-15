# Fueld Refactoring — Handoff Notes

## Pattern: Extracting child components from monoliths

### Steps followed
1. Read the full component to understand structure
2. Identify self-contained sections (inventory band, pricing editor, new-inquiry modal)
3. Create child component(s) with explicit `input()` / `output()`
4. Extract shared interfaces to a `*.types.ts` file to avoid circular deps
5. Update parent to use child components
6. Update all files that imported from the old location

### Rules established
- **Shared types** → `*.types.ts` (never import types from a `.component.ts`)
- **Child components** → same directory as parent, named `parent-child.component.ts`
- **Pricing component** (`app-order-item-pricing`) — reusable for cost/sell, accepts `side: 'cost' | 'sales'`
- **All components** use `ChangeDetectionStrategy.OnPush` + signals

### Completed
- `order-items.component.ts` (1,823 → 1,280 lines)
  - Extracted `order-item-pricing.component.ts` (386 lines)
  - Extracted `order-item-inventory-band.component.ts` (110 lines)
  - Extracted `order-item.types.ts`
- `send-inquiry-modal.component.ts` (1,762 → 1,682 lines)
  - Extracted `inquiry-body-editor.component.ts` (114 lines)
  - Extracted `inquiry-deadline-picker.component.ts` (82 lines)
- `integrations-page.component.ts` (1,747 → **106 lines**, -94%)
  - Replaced 6 inline cards with pre-existing extracted components
- `order-detail-page.component.ts` (5,939 → **2,505 lines**)
  - Extracted 12 child components + 17 services
- `inquiries-list-page.component.ts` (1,196 → **668 lines**, -528, -44%)
  - Extracted `inquiries-list-new-inquiry-modal.component.ts` (579 lines)
  - Fully self-contained modal with search/import/credit/creation logic
  - Modal loads its own initial data via `loadInitialData()`

### Remaining candidates (by size)
| # | Component | Lines | Status |
|---|---|---|---|
| 1 | `dashboard-page.component.ts` | 1,007 | Next up |
| 2 | `our-companies-page.component.ts` | 1,014 | |
| 3 | `customer-credit-page.component.ts` | 1,013 | |
| 4 | `two-factor-setup-page.component.ts` | 1,051 | |
| 5 | `llm-page.component.ts` | 1,155 | Already has store |
| 6 | `company-info-card.component.ts` | 1,116 | Already a card |
| 7 | `documents-settings-page.component.ts` | 950 | |

### CI Verification
- Local: `bun run typecheck` + `bun run test` + `bun run build`
- CI: GitHub Actions `.github/workflows/test.yml` (web-unit, web-typecheck, web-build)

### `/ship` command
- Installed globally at `~/.pi/agent/extensions/ship-command.ts`
- Also committed to repo at `.pi/extensions/ship-command.ts`
- Usage: `/ship` (auto-message) or `/ship Custom message here`