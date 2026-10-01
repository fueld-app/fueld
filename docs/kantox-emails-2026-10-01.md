# Kantox — Clément's reply, 1 Oct 2026 (received 15:55 CEST)

> From `clement.sicart@kantox.com`, Message-ID `<CAGDNxw_OH7FYi11HXcaSextgfC0-rRQd+WxooQOw9rN-a5EmTw@mail.gmail.com>`,
> in reply to our 30/09 send. Cc Junior, Pierre. He had the 1 Oct call with Pierre
> (Patrick absent, as notified).

## A. Value-date rounding — DECIDED, needs implementing

> "Pierre agrees to round up Value Dates to the last opening date of the month. This
> means that any invoices with due date in October should have a rounded VD to 30/10.
> => Let us know when this is applied so we can monitor"

This **supersedes `WEEKLY_MONDAY`** for Riviera. Note the existing `MONTHLY` rounding
mode in `deriveValueDate` moves to the **1st of the NEXT month**, which is not what
Pierre asked for — he wants the **last opening day of the CURRENT month**. So this is a
new rounding mode, not a setting flip.

## B. Sell without buy invoice — REAL, unexplained on our side

> "We see a case with 2 Sell invoices with the same VD, however no Buy invoice. Meaning
> we are hedging the whole exposure: Those are 20260930-000599#S & 20260930-000598#S"

Verified in production. Order `20260930-000598`:

```
09-30 09:43  UPDATE {"action":"save_items","itemCount":1}
09-30 09:44  STATUS_CHANGE {"newStatus":"CONFIRMED"}
09-30 09:44  KANTOX_PUSH {"entryCount":1,"orderNumber":"20260930-000598","plannedCount":1}
```

**Only ONE entry was planned and pushed** — the SO SELL of 88,500. No PO BUY. Our row
`20260930-000598#S` (SO, SELL, 88,500, USD) has no `#P1` sibling, while every other
hedged order has both legs.

`buildHedgePlan` guards each side by currency: the SO leg requires
`salesCurrency === 'USD'`, the PO leg requires `costCurrency === 'USD'`. For only the SO
to be produced, the item must have had **`salesCurrency = USD` and `costCurrency ≠ USD`
(EUR)** at CONFIRM — i.e. the sell settles in USD but the cost is in EUR. The buy side
therefore contributes no exposure to net, and we hedge the **full gross USD sell**.

Both orders have since been edited to EUR/EUR (10-01 07:56 activity), so the stored items
no longer show the USD sell that was hedged. The push log is the evidence of the state at
CONFIRM.

**This is a genuine hedging-design question, not a Kantox defect.** Hedging gross instead
of margin on a mixed-currency deal is the exact case Kantox flagged earlier (17/09 Q4e:
"non-USD PO legs — netting only works USD/USD"). It needs a decision, not a patch.

## C. 0 USD netted amount — benign, but worth explaining

> "We see invoices cancelling each other, giving us a 0 USD to monitor
> (20260908-000510#P1 & 20260908-000510#S). Is it expected and what use case is it?"

Verified: both legs are **1,540,336.00 USD**, equal and opposite → net 0, so nothing is
actually hedged. The order is EUR/EUR today with `sales_price (1427.94) == cost_price
(1427.94)` — a **zero-margin deal**. At push time the same equality held, so the SO and
PO legs were identical in size. It is expected behaviour given
`amountBasis = MINIMUM` on a zero-margin USD deal: we push both gross legs and they net
to nothing. Harmless (no exposure is created) but it costs two Kantox entries per
zero-margin deal, and it surprised them.

## Answers to our two questions

**1. CANCELLED vs EXECUTED — answered, and it invalidates our heuristic.**

> "An entry cannot be Closed without being executed. It can be cancelled before being
> executed. If it has been executed (closed) status the only way to cancel it is to send
> a new entry with inverted sign/amount. As we apply a control on duplicated external
> reference, we recommend to apply a suffixed as XXX_C to keep traceability of the
> initial invoice number"

Consequences:
- A `closed` entry has **always executed**. There is no "cancelled close" in Kantox's
  model — cancellation happens *before* execution and is signalled by an **inverted
  entry we send**, not by a status.
- Therefore `executionReason == null` on a `closed` entry does **not** mean cancelled.
  Our discriminator (deployed 2026-09-30) would, in that case, mark an **executed** hedge
  `CANCELLED` — suppressing its late-payment flag and its payment close. It is correct
  for all 20 live entries today (every executed one carries a reason), but the inference
  is now known to be unsound in principle.
- Their recommended cancel convention is a **`XXX_C` suffix** — note our closes already
  use `…C{n}` (`20260922-000564#SC1`), which is close enough to honour the intent, but
  worth aligning explicitly.
- "Cannot be closed without being executed" also means **our existing over-cancel guard
  is protecting the right thing**: sending a close against an executed hedge is exactly
  what they say must be done with an inverted entry, and we already skip CLOSED rows.

**2. ROLLS — answered, and it partially refutes our assumption.**

> "An entry that is rolled keep the same entryRef, the only difference is the new VD."

A roll does **not** create a new `entryRef`. So:
- Our `KANTOX_UNMATCHED_ENTRY` alert is **not** catching rolls (there is nothing new to
  catch) — its actual value is catching an entry we never pushed at all, which remains
  worth having.
- **A roll changes the value date without changing the ref, and we do not currently
  reconcile `value_date` at all.** `reconcileUpdates` writes `status`, `hedgedRate`,
  `executionRate` — never the value date. So after a roll our stored VD is stale, and
  late-payment flags key off the wrong date. That is a real gap this answer exposes.

## 3. executionRate 0.0

> "Will investigate this one"

Open on their side.

## Follow-ups this creates

| # | Item | Owner |
|---|---|---|
| A | Implement month-end value-date rounding; flip Riviera; tell Clément when live | us |
| A | Confirm "last **opening** date" (business day) vs calendar last day — 30/10 is a Friday, so not yet discriminating | Kantox/Pierre |
| B | Decide mixed-currency hedge behaviour (hedge gross sell vs skip vs hedge the USD-equivalent margin) | Pierre |
| C | Decide whether to suppress zero-net hedge pairs (equal-and-opposite legs) | us/Pierre |
| 1 | Re-examine the `executionReason` discriminator — `null` on a closed entry must NOT imply cancelled | us |
| 1 | Align close-ref suffix with their `XXX_C` convention | us |
| 2 | Reconcile `value_date` from Kantox (rolls change it in place) | us |
| 2 | Keep the unmatched-entry alert (still catches never-pushed entries) | done |

## Actioned in code (2026-10-01) — DEPLOYED

Deployed to staging-adjacent production instances at 17:53–17:56 UTC, all verified healthy
with the new option present in the served frontend. Deploy note: built from a detached
worktree on prod's base `2207632f` with only this batch applied, because the shared repo had
accumulated 9 unrelated `documents`/invoice commits from another session in the meantime —
none of which touch these files, and none of which were shipped by this deploy. The batch is
uncommitted, so `build-info.json` correctly reports the base sha `2207632f`; the served
frontend carrying `MONTH_END` (`chunk-cYIC21I7.js`) is the proof it is live.

| Instance | sha (base) | slot | health | MONTH_END served |
|---|---|---|---|---|
| riviera-marine | 2207632f | blue | 200 | yes |
| channeltx | 2207632f | blue | 200 | yes |
| moxie | 2207632f | blue | 200 | yes |
| staging | d892ab50 | green | 200 | no — deliberately NOT deployed (another session owns it) |

Built and verified (125 tests pass, API + web `tsc` clean).

1. **Discriminator corrected.** `mapKantoxStatus` no longer infers cancelled from a
   missing `executionReason` — every `closed` is `CLOSED`, per Clément's "an entry cannot
   be Closed without being executed". A reasonless `closed` now logs a warning instead.
   This retires the unsound inference deployed on 2026-09-30.
2. **`value_date` reconciled.** `reconcileUpdates` now writes the value date when Kantox's
   differs (DD/MM/YYYY → ISO), which is the only signal a roll produces. Only written from
   a parseable remote date, so a malformed one cannot blank a good local date.
3. **`MONTH_END` rounding mode added** — last calendar day of the current month. Widened in
   the schema union, shared DTO, controller validation, and the admin dropdown (the old
   `MONTHLY` relabelled "Monthly (1st of next month)" so the two cannot be confused).
   `deriveValueDate`'s `rounding` type now derives from the schema rather than repeating
   the union. **Limitation:** this is the CALENDAR month end, not "last opening date" —
   the function is pure and has no holiday calendar; the two coincide for Pierre's own
   October example. Confirm with Kantox/Pierre before treating it as business-day-aware.

## Emails sent 2026-10-01

- **To Pierre** (Cc Clément, Junior), `Kantox — two cases Clement raised with you on the
  call`, Message-ID `<7277e0b4-306c-45b5-a739-2903379d14e8@fueld.app>`, Sent Items uid 28.
  Explains findings B and C with the exact figures, sets out the three options for B with a
  recommendation, proposes suppressing zero-margin pairs for C, and flags the roll/date fix.

