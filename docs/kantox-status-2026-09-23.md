# Kantox integration — current status (23 Sep 2026)

> ⚠️ **SUPERSEDED for the open-questions section.** Clément answered all nine questions on
> 29 Sep 2026 — see `kantox-emails-2026-09-30.md`. The "Open questions with Kantox" list and
> the `executionRate` / `entries[]` rows of "Known gaps" below are now resolved; the
> `mapKantoxStatus()` gap is CONFIRMED (Kantox's terminal status is `closed`, we never map it).

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
| ~~**Closure is invisible to our status mapper**~~ **FIXED 2026-09-30** | `mapKantoxStatus()` now maps Kantox's terminal `closed` → `CLOSED` (the enum member already existed). Confirmed by Clément 29/09 that `closed` means executed-and-settled with nothing left for Pierre — see `kantox-emails-2026-09-30.md`. The open counter on the order card now clears, and `findLateHedgeEntries()` no longer raises false late-payment flags on an executed hedge. The reconciler was also extracted to the pure `reconcileUpdates()` and made precision-aware: a `numeric(14,8)` column holding Kantox's 9-decimal rate was re-writing `hedged_rate` + `updated_at` on **every** 15-minute tick, and `executionRate: 0.0` (the client-requested execution path) could overwrite a real take-profit rate. |
| ~~Cancelled close vs executed close~~ **FIXED 2026-09-30** | `entryStatus` is `closed` for both, so a cancelled entry could never be told from an executed one. The discriminator is `executionReason` — populated on every executed entry, null on every open one (measured). A reasonless `closed` now maps to **`CANCELLED`**, which both `onOrderCancelledForKantox` and the payment-close filter already skip. This removes the last path by which a **naked negative close** could be sent against a hedge that never executed. Open question to Kantox (does cancellation really surface as `closed`?) is now verification, not a blocker. |
| ~~Remote-only entries are invisible~~ **FIXED 2026-09-30** | Nothing inserts a local row for a Kantox entry we did not push, so a platform-side roll (or a push that never landed) produced no leg, no payment planning, and no flag — the one silent failure mode. The sync tick now logs **`KANTOX_UNMATCHED_ENTRY`** for any remote `entryRef` with no local match, deduped on `entryRef\|valueDate`. Deliberately an alert, not an auto-insert (the local row needs deal context only the original push knows). 0 unmatched today. |
| `executionRate` never populates | **Explained 29/09.** Kantox returns `0.0` on entries executed by client request (`executionReason = execution_requested_by_client`); every `take_profit_rate` execution carries a real rate (565 → 1.1337, 556 → 1.1335, 513 → 1.1337). `0.0` is a not-populated field, not a zero: we never write it, and `hedgedRate` is the achieved rate of record. The order card's "per-entry rate never observed" caveat was wrong — per-entry `hedgedRate` IS populated — and has been corrected. |
| PO value dates ignore supplier due-date override | `TODO(supplier-due-date)` in `kantox.service.ts`: PO legs use the customer-anchored value date, not `order_suppliers.supplier_due_date`. |
| `orders.due_date` is a phantom input | Highest-priority source in `deriveValueDate()` with **zero writers** anywhere in `src`. |
| Late-payment flag has never fired | Built and deduped correctly, but **0 rows** — no open leg is past its value date yet. |

## Test state

**50 Kantox tests green** — `kantox.test.ts` (37), `kantox.hooks.test.ts` (3),
`kantox.controller.e2e.test.ts` (10). Note the 17/09 minutes still say 29.

## Next

- **Checkpoint: Thursday 1 Oct, 10:00–10:30 CEST (12:00 Dubai)** — and **weekly thereafter through
  Thursday 29 Oct** (Clément re-issued it as a recurring series on 23/09 08:00Z). Teams link plus
  a Barcelona room. Note Patrick is invited as **optional** (`OPT-PARTICIPANT`) — he is the
  technical implementer and the one who asked the open questions, so that may be worth correcting.
- ⚠️ **The recurring invite was delivered to Junk Mail** and had to be moved to the inbox manually.
  It is a clean message (DKIM/SPF/DMARC all pass, `RWL_MAILSPIKE_VERYGOOD`); it scored 5.30 purely
  on `RCPT_IN_SUBJECT (3.00) + HAS_GOOGLE_REDIR + URI_COUNT_ODD + MIME_BASE64_TEXT_BOGUS +
  PARTS_DIFFER`. Cause: Google Calendar echoes the guest address into the subject, so a
  `@fueld.app` string appears in `Subject` alongside `@kantox.com` — a textbook "recipient in
  subject" phishing signature. **Every recurring Kantox invite is likely to file to Junk by
  default**, and the Junk folder has no other false positives to learn from. Worth a rule.
- Pierre: value-date rounding re-raise once he has seen real flows (he answered 17/09 as
  "difficult to understand now the impact, changeable"). Everything else he asked for is answered.
- Pierre: generic API mailbox address still needed for prod credentials; SMS mobile provided
  (`+33 6 38 69 56 04`).

## Reply watch

No reply from Clément as of **2026-09-23 11:15Z**, ~2.5h after the 08:40Z send. Inbox checked
directly (not just reported): the only Kantox traffic is his 22/09 reply. Expect answers around the
1 Oct checkpoint; the two that block further work are `GET entries` support (our sync loop) and the
`closed`-status semantics (currently causing a wrong status in our DB).


## Documentation corrections made 23/09

- `kantox-minutes-2026-09-17.md` — next checkpoint, decisions 6/9/11/13, ops status B (Riviera
  enabled + real flows), Pierre section C12/14, Kantox asks D15–19, path-to-production.
- `kantox-emails-2026-09-17.md` — Clément's address corrected to `clement.sicart@kantox.com`
  (the earlier `clement@kantox.com` placeholder would not have reached him); Junior added to cc.
- This file + `kantox-emails-2026-09-23.md` created.
