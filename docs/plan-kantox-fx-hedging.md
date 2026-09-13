# Kantox Dynamic Hedging® integration — plan (Riviera Marine)

**Status**: Rev 3 — **⚠️ POST-CALL REVISION REQUIRED (09/09 kickoff)**
> Kantox described the target flow as **two entries per deal (gross Sell leg from the sales order + gross Buy leg from the purchase order, same value date) which Kantox nets per value-date bucket to hedge only the margin** — this differs from rule 1/2 below (single computed-margin Sell entry). Also changed: margin = whole oil margin (no financing-cost deduction); `entryRate` must be sent (with a 10% rejection rule at reception); hedge percent starts at ~10–20%, not 100; value dates get weekly rounding; negative amounts on both legs confirmed for cancellals.
> See `docs/kantox-call-2026-09-09-notes.md` for full call outcomes and open questions. **Do not implement rules 1–4 until the two-leg-netting flow is confirmed in writing with Clément (Kantox PM).**

**Prior status**: Rev 2 — revised after review panel (DeepSeek-V4-Flash + Kimi-K3 — Approve with changes, both; all P1 findings incorporated).
**Date**: 2026-09-03
**Source**: Kantox kickoff 01/09/2026 + "Guide Implementation - Riviera Marine.pptx" (email from Pierre Deyris, 02/09)
**Goal**: As soon as a deal is validated in Fueld, push the USD margin exposure to Kantox Dynamic Hedging®, which nets buy/sell orders and triggers FX hedges at BNPP (Cortex). Hedge is closed when the client payment is received. EUR value of the margin is secured from deal confirmation.

---

## 1. Scope & non-goals

### In scope (v1)
- Kantox API client (login token + exposure entries + position read)
- Push hedge entry when an order is **CONFIRMED** (deal validated)
- Close/amend entries when **customer payment received** or order amount/date changes
- Hedge status surfaced on the order page (Angular) via order-scoped endpoint
- Preprod testing against `kantox-preprod.com/api` (sandbox credentials already provided)
- Feature-gated per tenant (Riviera Marine only)

### Non-goals (v1)
- sFTP/CSV ingestion fallback (only if API path is blocked)
- Bank-fed payment reconciliation (EnableBanking) — v2
- Multi-currency hedging beyond USD→EUR (fields configurable, defaults fixed)
- Kantox webhooks (not offered — we poll position)

## 2. Business rules (numbered — these are the contract)

1. **Hedge target**: USD commercial margin per deal. `amount` = Σ USD netted margin × `marginHedgePercent`. **Formula (P1-6 resolved for implementation):** sum `orderItems.profit` where the item's sales leg is USD (`salesCurrency = 'USD'`), converted to USD at booking FX rate; multiply by `marginHedgePercent` (default 100). If an order has mixed-currency items, only USD-profit items are included in v1 (audit basis stored on the entry; cross-currency = v2). ⚠️ To confirm with Pierre/Marin at the weekly checkpoint — but this formula is now the implementation basis, not an open question.
2. **Direction**: entries are sent with `marketDirection: 'Sell'` (we sell USD margin forward). DB `direction` stores `'SELL'` 1:1 with `marketDirection` — **no inversion** (P2-8).
3. **entryRef** = unique per hedge entry row: `INITIAL` = `{orderId}`, `AMEND` = `{orderId}#A{n}`, `CANCEL` = `{orderId}#C{n}` (n = per-order sequence). ⚠️ Confirm with Marin whether Kantox dedups on `entryRef` (preprod test); either way these values are distinct so both dedup and non-dedup semantics are safe.
4. **valueDate** (estimated payment date, P2-6/K-P1-7): use `orders.dueDate` if set; else derive: if `customerPaymentTermType = 'CREDIT'` → `deliveredAt || eta` + `customerCreditDays` days; COD/PREPAY → `deliveredAt || eta` (flag for Pierre: confirm whether near-term COD/PREPAY deals should be hedged at all — default **yes** with buffer). Always add `paymentDateBufferDays` (default 7).
5. **Cancellation** = new entry with **negative amount** (same valueDate as original).
6. **Amount change** = delta entry (±).
7. **Date change** = CANCEL entry + new INITIAL-sequence entry (`{orderId}#R{n}`, re-issue kind `INITIAL` in DB terms via `kind='REISSUE'` so the partial unique index on raw INITIAL stays intact — see §4).
8. **FDDR daily limit** ~$200k/day margin coverage: if a day's confirmed hedge total exceeds `dailyHedgeLimitUsd` → **warn-and-proceed**: activity log entry + in-app banner on the order confirm flow (P2-14). Not a block.

## 3. Module layout

```
apps/api/src/modules/kantox/
  kantox.controller.ts      — GET /kantox/status (ADMIN+FINANCE), GET /kantox/hedges (ADMIN+FINANCE),
                              GET /orders/:id/hedge (order-scoped, FINANCE/ADMIN/TEAMLEAD)  [P2-10, P2-11]
                              POST /kantox/hedges/:id/retry (ADMIN), POST /kantox/test-connection (ADMIN)
  kantox.service.ts         — orchestration: events → entries, position sync, retry scheduler
  kantox.client.ts          — HTTP client (login token cache, request_entry, position)
  kantox.types.ts           — payload/response types
packages/types: KantoxHedgeDto, KantoxStatusDto, KantoxSettingsDto, KantoxHedgeEntryStatusDto [P2-9]
Migration: drizzle/0NNN_kantox_hedge_entries.sql (+ journal entry, + rollback SQL in header comment) [K-Missing]
```

### Config
Non-secret config in `TenantSettings.kantoxSettings`:
```ts
kantoxSettings?: {
  enabled?: boolean;                 // default false — Riviera Marine only
  apiBaseUrl?: string;               // default 'https://kantox-preprod.com/api' (prod: kantox.com/api)
  apiUser?: string;                  // 'rivieramarine.api@kantox.com'
  companyRef?: string;               // 'api_company_131804'
  hedgeCurrency?: string;            // default 'USD'
  hedgeCounterCurrency?: string;     // default 'EUR'
  marginHedgePercent?: number;       // default 100 (rule 1)
  paymentDateBufferDays?: number;    // default 7 (rule 4)
  dailyHedgeLimitUsd?: number;       // default 200000 (rule 8)
};
```
**Secret (`apiPassword`) stored in the existing `integrationCredentials` table** (`provider='kantox'`, `key='apiPassword'`), reusing `encrypt()` triple + `integrations.service.ts` helpers and the admin integrations UI. Never in TenantSettings JSONB, never in env vars. (P1-1, K-P0-3 — both reviewers.)

Feature flag checked on **read side too**: order card and `/orders/:id/hedge` return empty/hidden when disabled (K-Missing).

## 4. Database

```ts
export const kantoxHedgeEntryStatusEnum = pgEnum('kantox_hedge_entry_status', [
  'PENDING_SEND', 'SENDING', 'SENT', 'HEDGED', 'CLOSED', 'FAILED', 'CANCELLED',
]);
export const kantoxHedgeEntryKindEnum = pgEnum('kantox_hedge_entry_kind', [
  'INITIAL', 'AMEND', 'CANCEL', 'REISSUE',
]);
export const kantoxHedgeDirectionEnum = pgEnum('kantox_hedge_direction', ['BUY', 'SELL']);

export const kantoxHedgeEntries = pgTable('kantox_hedge_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  orderId: uuid('order_id').references(() => orders.id),
  orderItemId: uuid('order_item_id').references(() => orderItems.id), // nullable; set when amount is per-item [K-P1-4]
  direction: kantoxHedgeDirectionEnum('direction').notNull(),         // 'SELL' 1:1 with marketDirection
  amountUsd: numeric('amount_usd', { precision: 14, scale: 2 }).notNull(),
  amountBasisUsd: numeric('amount_basis_usd', { precision: 14, scale: 2 }), // gross USD margin before marginHedgePercent (audit) [K-P1-4]
  valueDate: date('value_date'),
  entryRef: text('entry_ref').notNull(),            // rule 3: orderId | orderId#A2 | #C1 | #R1
  kantoxEntryId: text('kantox_entry_id'),
  kind: kantoxHedgeEntryKindEnum('kind').notNull(),
  status: kantoxHedgeEntryStatusEnum('status').notNull().default('PENDING_SEND'),
  cancelledAmountUsd: numeric('cancelled_amount_usd', { precision: 14, scale: 2 }).notNull().default('0'),
    // running total already cancelled for the parent entry — close logic sends only the delta [K-P1-5]
  hedgedRate: numeric('hedged_rate', { precision: 14, scale: 6 }),  // nullable; best-effort from position sync (see below)
  errorMessage: text('error_message'),
  retryCount: integer('retry_count').notNull().default(0),
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),         // set on sync/transition [P2-12]
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
// Partial unique index — INITIAL only; AMEND/CANCEL/REISSUE are legitimately multi-row [P1-2, K-P0-1]
CREATE UNIQUE INDEX kantox_hedge_entries_initial_uniq
  ON kantox_hedge_entries (tenant_id, order_id) WHERE kind = 'INITIAL';
```

**`hedgedRate` semantics (P1-4 / K-P2-10)**: Kantox nets positions, so per-entry rates are likely unavailable from `GET position`. `hedgedRate` stays nullable on entries (filled when Kantox returns entry-level data), and the **order card displays the net position rate** from the position sync (denormalized `lastPositionRate` + `lastPositionSyncAt` cached per tenant in `kantoxSettings`-adjacent storage or computed from the position call). Do not promise per-entry rates in the UI.

### API call log (K-P2-13, auditability)
Append raw Kantox request/response pairs to the existing **activity log** (module `kantox`, entityType `kantox_hedge_entry`, raw JSON payload in metadata) — no new table; satisfies Kantox's "always consult raw responses" and gives preprod evidence for §8.

## 5. API client (`kantox.client.ts`)

- `POST /login` → token, valid **10 min**. In-memory cache with expiry-60s margin; **cache is per-process** — 4 VPS instances log in independently (4× logins/10-min window; accepted tradeoff at Riviera volume; revisit DB-backed token row if Kantox rate-limits logins) [P2-5, K-P1-6].
- On 401 mid-flight: re-login and **retry once**, then mark row `FAILED` [K-P1-6].
- Token in `X_AUTH_TOKEN` header. **Parameters in body, never URL.**
- Base URL from settings (preprod now, prod at go-live).
- Endpoint: `POST /companies/{companyRef}/dynamic_hedging/request_entry` — **single path shipped** (P2-13/K-P2-11); workflow-slide `POST dynamic_hedging/entry` discrepancy to be resolved in preprod testing before implementation merges; swap = one constant change.
- `GET dynamic_hedging/position` → net positions per pair/value-date bucket.

Payload (slide 10): `companyRef`, `entryRef`, `marketDirection` (`Sell`), `currency` (`USD`), `amount`, `counterCurrency` (`EUR`), `entryDate`, `valueDate` (`YYYY-MM-DD`), `entryRate`/`entryRatePair` empty, `notes` free text (`Fueld order {number} {kind}`).

## 6. Event hooks

| Fueld event | Action |
|---|---|
| Order → `CONFIRMED` | Gate: tenant enabled + USD margin > 0. Insert row `PENDING_SEND` **before** HTTP call (claim) → CAS `PENDING_SEND→SENDING` (atomic `UPDATE … WHERE status='PENDING_SEND'`, check rowcount) → `request_entry` → `SENT`. On error → `FAILED` + activity log. **Never blocks deal confirmation** [P1-3, K-P0-2]. Daily-limit check (rule 8) before send. |
| Cron retry (same `setInterval` loop) | Retries `FAILED` rows with **exponential backoff, max 5 attempts** (retryCount), and pushes stale `PENDING_SEND` >5 min rows, under the same CAS guard [K-P2-12]. |
| `customerPayments` row added | **USD-only** payments summed (`currency='USD'`) [P1-5]. Received total vs `cancelledAmountUsd` accumulator on the open entry → send negative entry **only for the delta** (prevents over-cancel on partial payments) [K-P1-5]. Fully covered → `CLOSED`. |
| Order amount changed post-confirmation | Detection point: extend `buildOrderUpdateActivityMetadata` diff in `updateOrder` (orders.service.ts:496) → emit AMEND delta entry [P2-7]. |
| Payment-relevant date changed | CANCEL entry + REISSUE entry (rule 7). |
| Order → `CANCELLED` **or `LOST`** | Cancel entry (negative amount) [P2-1]. |
| Position sync | `setInterval` 15 min, `startKantoxSync()` registered in `apps/api/src/index.ts` boot (no cron — P2-3/K-P1-8). Iterates **all tenants with `kantoxSettings.enabled`**, per-tenant try/catch so one tenant's Kantox outage can't block others [P2-4]. Kantox position is per-`companyRef` → tenant mapping is inherent (each tenant has its own companyRef/credentials) [K-Missing]. |

## 7. UI (Angular, apps/web)

- Order page: "FX Hedging" card via `GET /orders/:id/hedge` (order-scoped; returns entries + net position rate). Hidden when `kantoxSettings.enabled` is false. Roles: FINANCE/ADMIN (read), per role comments in `banking.controller.ts` convention.
- Admin → Settings: Kantox config block (non-secret fields editable; password managed in Admin → Integrations via the existing `integrationCredentials` UI). ADMIN-only.
- Hedging overview panel deferred to v1.1.

## 8. Tests (K-Missing)

- **Unit**: hedge amount computation (rule 1, mixed-currency items, marginHedgePercent), valueDate derivation (rule 4: dueDate / CREDIT / COD/PREPAY branches), close-delta math (partial payments, rule 5 + cancelledAmountUsd), entryRef sequencing.
- **Client**: recorded fixtures for `request_entry` / `position` / 401-retry-once.
- **Integration**: confirm→push idempotency (double-confirm rejected by partial unique index + CAS), retry/backoff, multi-tenant sync isolation.

## 9. Preprod test flow (before weekly checkpoint with Kantox)

1. Enable settings on Riviera Marine staging tenant (preprod credentials from the deck)
2. `POST /kantox/test-connection` → login roundtrip
3. Create test CONFIRMED order → verify `request_entry` payload + row SENT; **re-confirm to prove idempotency fence**
4. **Probe `entryRef` dedup semantics with Marin** + confirm exact endpoint path (`request_entry` vs `entry`)
5. Amend amount / change payment date → delta + cancel-and-replace entries visible in Kantox UI
6. Record test customer payment (partial then full) → verify delta negative entries + CLOSED
7. Position poll → net rate lands on order card
8. Kantox-side validation of entries (Marin confirms both sides)

## 10. Risks / open questions (post-revision)

- **Amount formula** (rule 1) is implementation-ready but needs Pierre/Marin sign-off at checkpoint
- **COD/PREPAY hedging** (rule 4) — confirm with Pierre
- **entryRef dedup semantics** — probed in preprod (rule 3 makes us safe either way)
- **Rate limits** on Kantox API — confirm docs; polling modest (15 min, single path)
- **Go-live**: production credentials + `companyRef` = config swap in settings + integrations; October 2026 target

## 11. Rollout

1. Phase 1 (this plan): API client + events + order card + tests — preprod verified
2. Phase 2: production cutover, weekly checkpoints with Kantox, go-live review October 2026
3. Phase 3 (optional): EnableBanking-fed payment events, sFTP fallback, hedging overview dashboard

---

## Appendix — review panel findings ledger

| Finding | Source | Resolution |
|---|---|---|
| P1-1 / K-P0-3 credentials → `integrationCredentials` | both | §3 Config |
| P1-2 / K-P0-1 partial unique index; multi-row AMEND/CANCEL | both | §4 |
| P1-3 / K-P0-2 insert-before-send + CAS; entryRef dedup | both | §6 hooks, rule 3 |
| P1-4 / K-P2-10 hedgedRate per-entry unreliable → net position display | both | §4 note |
| P1-5 / K-P1-5 USD-only payments + cancelledAmountUsd delta accumulator | both | §6, §4 |
| P1-6 / K-P1-4 amount formula + per-item basis | both | rule 1, §4 amountBasisUsd |
| P2-1 LOST status / P2-2 pgEnum / P2-3 setInterval / P2-4 multi-tenant loop / P2-5 token cache / P2-6 valueDate source / P2-7 change detection / P2-8 direction / P2-9 DTOs+migration / P2-10 order-scoped endpoint / P2-11 role gating / P2-12 updatedBy / P2-13 single endpoint / P2-14 warning channel | DeepSeek | §2, §4, §5, §6, §7 |
| K-P0-2 concurrency CAS | Kimi | §6 |
| K-P1-6 retry-once-then-FAIL | Kimi | §5 |
| K-P1-8 4× poller instances | Kimi | §6 (per-tenant loop; single-process per instance acceptable at volume) |
| K-P2-12 retry policy | Kimi | §6 |
| K-P2-13 raw response logging | Kimi | §4 (activity log) |
| K-Missing: tests / rollback / read-side flag / tenant isolation in poller | Kimi | §8, §4 (migration rollback header), §3, §6 |