# Kantox integration — current status (23 Sep 2026)

> Ground truth as of 2026-09-23, replacing the stale sections of
> `kantox-minutes-2026-09-17.md`. Every claim below was verified against the
> live preprod API, the Riviera production database, or the mailbox — not carried
> forward from earlier notes.

## Where we are

**Live on real data.** Riviera Marine's production orders are flowing into Kantox
**preprod**; nothing is triggered for real until the production cutover. Two deals
pushed, one position already executed.

| Deal | Legs | Net | Kantox position | Status |
|---|---|---|---|---|
| `20260922-000564` | SO Sell 413,750 / PO Buy 411,500 USD | 2,250 | `PS-1QKY673VG` | **`closed`** — hedgedRate **1.144906585** |
| `20260922-000565` | SO Sell 144,540 / PO Buy 136,980 USD | 7,560 | `PS-6ZY41KHW3` | `in_order`, wavg 1.1461 |

Value dates 09/11 and 02/11 respectively. Both legs share the value date, confirming
two-leg netting per bucket end-to-end. `20260922-000564` is the **first real FX
execution** this integration has produced.

Our 4 hedge rows are `SENT` in the DB with real Kantox entry IDs (`E-…`) and position
refs (`PS-…`); 2 `KANTOX_PUSH` activity rows, `user_id = null` (the corrected audit path).

## Deployment

- **All 4 instances on `517d2567`** (staging, riviera-marine, channeltx, moxie) — includes all Kantox code.
- Migration `0120_kantox_hedge_entries` applied.
- Riviera tenant settings live: `enabled=true`, `https://kantox-preprod.com/api`,
  `rivieramarine.api@kantox.com`, `api_company_131804`, `WEEKLY_MONDAY`,
  `marginHedgePercent: 100`, `paymentDateBufferDays: 7`, `amountBasis: MINIMUM`, `hedgeCodPrepay: true`.
- **Credential vault coherent**: all 19 `integration_credentials` rows decrypt under the explicit
  `CREDENTIALS_ENCRYPTION_KEY`; the `DATABASE_URL`-derived fallback decrypts none of them. This
  confirms `17b54e77` closed the silent-fallback path — Riviera previously ran with credentials
  keyed to a non-reproducible derivation.

## Confirmed by Kantox (22 Sep, Clément Sicart)

- **Reset: DONE** — "you now start from a clean sheet"; our 22 `PROBE-*`/`TEST-*` entries verified gone.
- **Canonical push path**: `POST /companies/{companyRef}/dynamic_hedging/entry`.
- **GET list**: `dynamic_hedging/positions`, `/position`, `/orders`, `/batch_mode`;
  also in the UI at HELP / API Docs / Dynamic Hedging.

## Open questions with Kantox (email sent 23/09 08:40Z)

1. Is `GET …/dynamic_hedging/entries` officially supported? It is **not** on their list but is
   what our 15-minute sync loop depends on; if it were withdrawn, reconciliation breaks silently.
2. Full `entryStatus` / `positionStatus` enums; does `closed` require any manual action by Pierre?
3. `hedgedRate` populated but `executionRate` = 0.0 — which is the achieved rate?
4. Positions return an empty `entries[]` while header fields are populated — will per-entry
   attribution populate, or is position-level the only reliable figure?
5. `amountToTriggerCo` now **1.00 EUR** (was 5,000.00 USD on the test company) — confirm no execution floor.
6. Are `/dynamic_hedging/orders` and `/batch_mode` relevant to us, or conditional-orders only?
7. Pagination / date-status filtering / historical export for finance sign-off at volume.
8. Do they still want `entry_rate` / `entry_rate_pair`? We have never sent it.

## Known gaps in our code

| Gap | Detail |
|---|---|
| **Closure is invisible to our status mapper** | `mapKantoxStatus()` (`kantox.service.ts:699`) maps only `hedg`/`execut` → `HEDGED`. Kantox also returns **`closed`** and **`in_order`**. `20260922-000564#S` is `closed` at Kantox but still `SENT` in our DB (`hedged_rate` synced, status not). Effects: the order card's open counter never clears, and once value date 09/11 passes, `findLateHedgeEntries()` + the card's `isLate()` will raise **false late-payment flags to Pierre** on an already-closed hedge. |
| `executionRate` never populates | Kantox returns `0.0`, so the column stays empty. `hedgedRate` **is** populated, so the order card's "indicative — per-entry rate never observed" caveat is now out of date. |
| PO value dates ignore supplier due-date override | `TODO(supplier-due-date)` in `kantox.service.ts`: PO legs use the customer-anchored value date, not `order_suppliers.supplier_due_date`. |
| `orders.due_date` is a phantom input | Highest-priority source in `deriveValueDate()` with **zero writers** anywhere in `src`. |
| Late-payment flag has never fired | Built and deduped correctly, but **0 rows** — no open leg is past its value date yet. |

## Test state

**50 Kantox tests green** — `kantox.test.ts` (37), `kantox.hooks.test.ts` (3),
`kantox.controller.e2e.test.ts` (10). Note the 17/09 minutes still say 29.

## Next

- **Checkpoint: Thursday 1 Oct, 10:00 CEST (12:00 Dubai)** — rescheduled; the 23 Sep 09:30 CEST
  slot was superseded. Patrick missed the 23 Sep call (wrong time); Clément reported via Pierre
  that it went well with **no action points**.
- Pierre: value-date rounding re-raise once he has seen real flows (he answered 17/09 as
  "difficult to understand now the impact, changeable"). Everything else he asked for is answered.
- Pierre: generic API mailbox address still needed for prod credentials; SMS mobile provided
  (`+33 6 38 69 56 04`).

## Documentation corrections made 23/09

- `kantox-minutes-2026-09-17.md` — next checkpoint, decisions 6/9/11/13, ops status B (Riviera
  enabled + real flows), Pierre section C12/14, Kantox asks D15–19, path-to-production.
- `kantox-emails-2026-09-17.md` — Clément's address corrected to `clement.sicart@kantox.com`
  (the earlier `clement@kantox.com` placeholder would not have reached him); Junior added to cc.
- This file + `kantox-emails-2026-09-23.md` created.
