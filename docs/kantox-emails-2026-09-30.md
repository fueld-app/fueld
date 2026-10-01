# Kantox — Clément's answers to the 23/09 questions (received 29 Sep 2026)

> Received 2026-09-29 15:18 CEST (13:18Z) from `clement.sicart@kantox.com`,
> Message-ID `<CAGDNxw9xzu+w3UBW-S-zPEOuzgugD+7DseYetng6_6jwJjvRgg@mail.gmail.com>`,
> In-Reply-To our 23/09 send `<da6d1454-…@fueld.app>`. Cc Junior, Pierre.
> All nine questions answered. Verified independently against the live preprod API
> (login as `rivieramarine.api@kantox.com`, company `api_company_131804`) on 2026-09-30.

## Answers

| # | Question | Clément's answer | Verified? |
|---|---|---|---|
| 1 | `/entry` canonical | (already confirmed 22/09) | yes — 20 entries created through it |
| 2 | Is `GET …/dynamic_hedging/entries` supported? | **"Yes absolutely"** | yes — returns all 20 of our entries |
| 3 | Are `/orders` and `/batch_mode` relevant? | **"You can ignore these calls which are not relevant to your setup"** | — |
| 4 | Status enums; does `closed` need Pierre? | `in_position` = still monitoring the conditional order (TP/SL set); once executed → **`closed`**. One further status: **`pending`** = Pierre must log in and execute manually (**"this will only happen in the beginning"**) | observed live: `closed`, `in_order`, `in_position`, `accumulating` |
| 5 | `executionRate` 0.0 vs `hedgedRate` | **"Do you still see it at 0.0 and could you send me a screenshot?"** | yes — see below; **0.0 correlates exactly with `executionReason = execution_requested_by_client`** |
| 6 | Positions return empty `entries[]` | **"Could you send me a screenshot?"** | yes — the key is **absent entirely**, not empty |
| 7 | `amountToTriggerCo` 1.00 EUR = no floor? | **"Correct, we hedge without threshold"** | yes — `"1.00 EUR"` on all Riviera positions |
| 8 | Do you still want `entry_rate`? | **"Very useful to receive for Analytics later if you are able to send it"** | — we have never sent it; `entry_rate` column is NULL on all 20 rows |
| 9 | Pagination / status filtering / export at volume | **"historical export is available and Get call supports hundreds of entries"** | — |

## Q5 — `executionRate = 0.0` is specific to the client-requested execution path

Live entries, correlated with `executionReason`:

| entryRef | entryStatus | executionReason | executionRate | hedgedRate | rate (booking) |
|---|---|---|---|---|---|
| `20260922-000564#S` | closed | **execution_requested_by_client** | **0.0** | 1.144906585 | 1.1461 |
| `20260922-000564#P1` | closed | **execution_requested_by_client** | **0.0** | 1.144906585 | 1.1461 |
| `20260922-000565#S` | closed | take_profit_rate | 1.1337 | 1.135953489 | 1.1452 |
| `20260921-000556#S` | closed | take_profit_rate | 1.1335 | 1.135040702 | 1.137 |
| `20260909-000513#S` | closed | take_profit_rate | 1.1337 | 1.135953489 | 1.1402 |

`PS-1QKY673VG` is `closed` with `executedTimeStamp 23/09/2026 07:47:28 UTC` — the trade
executed, so 0.0 is a not-populated field, not a real rate. **Every** take-profit execution
carries a real `executionRate`; the single client-requested execution does not. Root cause
is on Kantox's side; we use `hedgedRate` as the achieved rate of record.

## Q6 — positions carry no `entries` at all

`GET …/dynamic_hedging/positions` → 7 positions, **no `entries` key on any of them**.
Per-position keys received: `amount, amountToTriggerCo, conditionalOrderRef,
conditionalOrderStatus, counterAmount, counterCurrency, createdTimeStamp, currency,
deltaResult, executedTimeStamp, executionRate, expirationDate, expirationTime, hedgedRate,
marketDirection, orderRef, positionStatus, ratePair, reference, stopLossRate,
takeProfitRate, updatedTimeStamp, valueDate, weightedAverageRate`.

So per-entry attribution comes from `entries` only; position headers carry
`amount` / `weightedAverageRate` / `executionRate` / `hedgedRate` and nothing per-entry.

## Impact on our code — the two documented gaps now unblocked

1. **`mapKantoxStatus()` still maps only `hedg`/`execut` → `HEDGED`.** Kantox's actual
   terminal status is **`closed`**, which we drop on the floor, so all 20 rows remain `SENT`;
   `findLateHedgeEntries()` + the order card then raise **false late-payment flags to Pierre**
   once a value date passes on an already-closed hedge. `CLOSED` already exists in
   `kantox_hedge_entry_status`. Fix = map `closed` → `CLOSED` (and `in_position`/`in_order`/
   `accumulating` stay open).
2. **`entry_rate` / `entry_rate_pair` should now be sent** with the booking rate at deal
   creation; `KantoxEntryPayload.entryRate` is supported by the client but no caller sets it.
   Needs a source for the booking rate (the EUR/USD assumption the deal was priced on) — not
   currently stored per order.
3. Not a change: `executionRate` 0.0 must **not** overwrite / clear ours; `hedgedRate` is the
   achieved rate. Our reconcile already guards this (only writes when the row differs), but
   the order-card caveat ("indicative — per-entry rate never observed") is now out of date.

## Our reply (SENT 2026-09-30 06:05:10Z, replying into the same thread)

Sent as a reply to `<CAGDNxw9xzu+…@mail.gmail.com>`, To Clément, Cc Junior + Pierre.
Bodies: `tmp/kantox-reply-20260930.body.txt` (plain) and `.body.html` (with the two
evidence tables inline; rendered evidence sheet `tmp/kantox-evidence-20260930.html`).
SMTP accepted all 3 recipients (none rejected); copy filed to **Sent Items** (uid 25).
Content: the Q5/Q6 tables Clément asked for, the conclusion that 0.0 is
execution-path-specific, the reading that positions have no `entries`, confirmation of
items 3–9, and one new question — whether the two entries already pushed without
`entry_rate` (564, 565) are worth backfilling given `entryRef` dedup prevents re-sending.

### Body

```
Hi Clement,

Thank you for the detailed answers - all nine are now closed on our side. Two of them
you asked for evidence on, so here is what we see in the preprod responses.

Q5 - executionRate = 0.0

Entry 20260922-000564#S (and its #P1 pair): entryStatus "closed", executionReason
"execution_requested_by_client", executionRate 0.0, hedgedRate 1.144906585, rate (booking)
1.1461. The position PS-1QKY673VG is closed with executedTimeStamp 23/09/2026 07:47:28 UTC.

By contrast, entries executed via "take_profit_rate" all carry a real executionRate:
20260922-000565#S -> 1.1337, 20260921-000556#S -> 1.1335, 20260909-000513#S -> 1.1337.

So executionRate is populated for the take-profit executions and left at 0.0 for the
client-requested one. Since the position shows closed with an executedTimeStamp, 0.0 does
not read as a real traded rate to us - it looks like a field that is not populated on that
execution path. Could you confirm, and tell us which value we should report as the rate
actually achieved on 20260922-000564 (is it hedgedRate 1.144906585, or the booking rate
1.1461)?

Q6 - positions return no entries[]

GET /dynamic_hedging/positions returns 7 positions and none of them carries an "entries"
key at all (not merely an empty array). The per-position keys we receive are: amount,
amountToTriggerCo, conditionalOrderRef, conditionalOrderStatus, counterAmount,
counterCurrency, createdTimeStamp, currency, deltaResult, executedTimeStamp, executionRate,
expirationDate, expirationTime, hedgedRate, marketDirection, orderRef, positionStatus,
ratePair, reference, stopLossRate, takeProfitRate, updatedTimeStamp, valueDate,
weightedAverageRate.

So we currently take the header fields (amount, weightedAverageRate, executionRate,
hedgedRate) as the only attribution, and read per-entry detail from the entries endpoint
instead. Please confirm that is the right reading, or whether entries[] on positions should
be filling in.

The rendered tables (Q5 and Q6) are below as HTML, and the raw JSON is available on request.

Other points, briefly:

- /dynamic_hedging/orders and /batch_mode: understood, we ignore them.
- Statuses: we map "closed" to done and stop expecting any action from Pierre on it;
  "in_position" as still monitoring the conditional order; "pending" will be treated as
  pending manual execution by Pierre. Our reconciliation will no longer flag anything at
  "closed".
- amountToTriggerCo 1.00 EUR = no execution floor. Noted, we hedge from the first dollar as
  agreed on 17/09.
- entry_rate / entry_rate_pair: we will start sending the booking rate on every new entry
  from here. One question - two entries we already pushed (20260922-000564, 20260922-000565)
  went out without it. Is there any value in providing the booking rate for those separately
  for your analytics, given entryRef dedup means we cannot re-send them under the same ref?
- Pagination / historical export: noted, thank you. We will keep pulling the full list and
  filtering on our side for now, and come back to the export for finance sign-off later.

See you Thursday 1 October, 10:00 CEST.

Patrick
```

## Second email — to Pierre — SENT 2026-09-30 06:07Z

`Re: Kantox — value-date rounding, now with real dates` → `pierre@rivieramarine.mc`,
reply to his 17/09 message `<VE1PR01MB5789…@VE1PR01MB5789.eurprd01.prod.exchangelabs.com>`.
Message-ID `<6b44f739-…@fueld.app>`, filed to Sent Items.

The 17/09 minutes deferred value-date rounding because Pierre said he could not judge the
impact before real flows. There are now 11 hedges / 7 positions, so the email lists the ten
value dates actually sent — all Mondays, per `WEEKLY_MONDAY` — and asks only whether Monday
is the right settlement day for his cash (or whether to drop rounding). One-line setting if
he wants it changed.

### Body

```
Hi Pierre,

One item from our 17/09 exchange is now answerable with real numbers, so I'm bringing it back rather than leaving it open.

Value-date rounding. You said on 17/09 it was "difficult to understand the impact now, changeable" - that was before Riviera was running real flows. We now have 11 hedges and 7 positions in Kantox preprod, so here are the actual value dates we have sent:

  20260929-000583 -> 19/10/2026      20260922-000565 -> 02/11/2026
  20260921-000556 -> 26/10/2026      20260924-000577 -> 02/11/2026
  20260929-000595 -> 26/10/2026      20260929-000596 -> 02/11/2026
  20260909-000513 -> 02/11/2026      20260922-000564 -> 09/11/2026
                                     20260929-000593 -> 09/11/2026
                                     20260928-000581 -> 23/11/2026

All of them are Mondays. That is the current setting (WEEKLY_MONDAY) and it is doing what it was meant to do: one settlement day per week rather than a daily BNPP settlement.

The question is simply whether Monday is the right day for your cash. If you would rather anchor to a different weekday, or to the actual expected payment date without rounding, say the word and I will change it - it is a one-line setting on our side.

Patrick
```

## Checkpoint

Thursday **1 Oct 2026, 10:00–10:30 CEST** (12:00 Dubai), weekly thereafter through 29 Oct.
Patrick is invited **optional** (`OPT-PARTICIPANT`) — he is the technical implementer and the
one asking the questions; worth correcting. Recurring invites file to **Junk Mail** (see
`kantox-status-2026-09-23.md` for the cause).
