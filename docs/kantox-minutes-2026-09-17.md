# Kantox IT follow-up — minutes & production todolist (17 Sep 2026, 10:00 CEST)

> Attendees: Patrick (Fueld), Clément Sicart (PM), Marin (IM), Pierre (joined during call).
> Next checkpoint: **Thursday 1 Oct, 10:00 CEST (12:00 Dubai)** — rescheduled by Clément.
> The 23 Sep 09:30 CEST slot was superseded; the invite came through as "next week Thursday, 10am".
>
> **⚠️ Superseded in places — read `kantox-status-2026-09-23.md` for current ground truth.**
> Items corrected below: next checkpoint, decision 9 (Pierre answered), ops status
> (Riviera is ENABLED and pushing real entries), and the Kantox-side asks (reset +
> GET list both delivered 22/09).

## Decisions from the call

| # | Topic | Decision |
|---|---|---|
| 1 | **Late payment / past-due hedge** | Rolls are handled **manually by Pierre on the Kantox platform** (BNPP executes). NO data from us, NO Kantox cost — any cost is BNPP-side. We do NOT build roll automation; we flag late payments to Pierre instead. |
| 2 | **EUR-invoiced POs** | **Exclude** — only USD invoices/legs are sent. (Confirmed recommendation.) |
| 3 | **Sell-before-Buy sequencing** | **Out of scope** — edge case, can't think of real instances; revisit if a real need appears. |
| 4 | **Negative-margin deals (net Buy)** | We manage client-side: **never send a net-BUY position** — skip the deal (or net against same-date sells only). Kantox would otherwise auto-execute the opposite trade at maturity. Our over-cancel cap already enforces this. |
| 5 | **Execution floor** | **NO floor limit** — hedge from the first dollar of exposure. (Pierre to sanity-check; most deals >$20K.) |
| 6 | **Canonical endpoint** | **RESOLVED 22/09** — Clément: `POST /companies/{companyRef}/dynamic_hedging/entry`. That is the path we ship; the `/request_entry` variant is not our build target. Production uses the same path; prod credentials come at cutover. |
| 7 | **Hedge ratio mechanics — CHANGED** | `marginHedgePercent` is a **Kantox platform business rule, NOT client-side**. We send the **FULL exposure amount**; the platform hedges the % Pierre defines. No client-side scaling, no re-development when the ratio ramps. Kantox cannot tick/untick individual invoices — scope control (which orders to send) stays with us (USD-only filter). |
| 8 | **Amount basis — SIMPLIFIED** | Send **ONE amount: the minimum pre-invoice quantity amount**. No pre-invoice + exact-at-invoice delta flow ("start simple" — avoids noise from SO/PO timing gaps). Adjust later if cash management needs it. |
| 9 | **Value-date rounding** | **Pierre answered 17/09 07:22Z** (email "RE: Kantox — 3 decisions to confirm today"): *"Difficult to understand now the impact, I hope it could be change easily"* — i.e. not a considered choice, but explicitly changeable. **WEEKLY_MONDAY stays the live setting**; the config knob makes a later change a one-line flip. Re-raise at the 1 Oct checkpoint once he has seen real flows. |
| 10 | **Rate limits** | Only constraint: 10-min token re-login. No other rate limits. |
| 11 | **Webhooks** | None (as assumed) — GET calls only; **DELIVERED 22/09** by Clément: `dynamic_hedging/positions`, `/position`, `/orders`, `/batch_mode` — plus "available from the UI: HELP / API Docs / Dynamic Hedging". ⚠️ `GET …/dynamic_hedging/entries` is **not on his list** but is what our 15-min sync loop polls; it works, and we asked (23/09 email, Q2) for written confirmation that it is supported. |
| 12 | **Path to production** | Phase 2: **connect Riviera PRODUCTION to Kantox PREPROD** with real data for a few days/weeks (nothing is triggered; Pierre learns the platform; Kantox validates business rules with real flows). Sandbox will be **reset** just before we start. Once happy → production credentials + endpoints from Kantox → cutover. |
| 13 | **Next checkpoint** | ~~Wednesday 23 Sep, 9:30 CET~~ → **Thursday 1 Oct, 10:00 CEST (12:00 Dubai)**. Patrick missed the 23 Sep call (wrong time on his side); Clément confirmed afterwards that it went well with **no action points**. Apology + follow-up questions sent 23/09 08:40Z. |

## Production todolist

### A. Fueld — code (Patrick, this week)
1. ✅ Amount logic simplified (full exposure, platform-side ratio) — 5788f568
2. ✅ Scope filter: USD-only, EUR POs excluded, negative-margin skipped (a74d975e)
3. ✅ Event hooks wired: CONFIRMED → SO+PO push; payment → close delta; CANCELLED/LOST → negatives (a74d975e) — **fixed f33cfaf2**: the CONFIRMED hook was handed `settings=null` and silently resolved to "disabled", so no entry would ever have been pushed; it now reads the tenant's own settings. The push audit row used the non-UUID actor `'kantox-system'`, which the `activity_logs.user_id` FK rejected (and `logActivity` swallows) — system actions now log with `user_id = null`.
   - ✅ **Late-payment flag BUILT** (`0a645ae5`): `findLateHedgeEntries()` + a `KANTOX_LATE_PAYMENT` activity row on sync, deduped on (entry, value date), plus the order-card "value date passed" badge. Originally listed here as NOT built — it was built on 22/09. **0 rows emitted so far** because no open leg is past its value date yet.
4. ✅ Value-date rounding: WEEKLY_MONDAY default, config knob ready
5. ✅ Reconciliation sync loop live (15 min; polls `GET …/dynamic_hedging/entries` — see decision 11)
6. ✅ UI: order-card FX hedging block; admin Kantox settings form (`76b86d48`)
7. ✅ Tests: **50 green** (`kantox.test.ts` 37, `kantox.hooks.test.ts` 3, `kantox.controller.e2e.test.ts` 10) — was 29 here
8. ✅ Route fix: /orders/:id/hedge param conflict caught by blue-green startup gate (3359e5b9)

### B. Fueld — ops (Patrick)
8. ✅ Sandbox reset **CONFIRMED by Clément 22/09 10:33Z** — *"I confirm it has now been reset => you now start from a clean sheet"*. Verified independently 23/09: our 22 `PROBE-*`/`TEST-*` entries are gone from preprod.
9. ✅ Deployed — all 4 instances now on `517d2567` (was 3359e5b9 here), migration 0120 applied, blue-green verified.
10. ✅ Riviera tenant configured **and ENABLED**: `enabled=true`, preprod base URL, `rivieramarine.api@kantox.com`, `api_company_131804`, WEEKLY_MONDAY, `marginHedgePercent: 100`, buffer 7. The flip happened once Clément confirmed the reset (22/09) — so this was no longer `enabled=false`.
11. ✅ **Real Riviera orders ARE flowing.** Two deals pushed, both legs each, confirmed live in preprod 23/09:
    - `20260922-000564` — SO Sell 413,750 / PO Buy 411,500 USD, value date 09/11 → `PS-1QKY673VG`, **`closed`**, hedgedRate **1.144906585** (executed)
    - `20260922-000565` — SO Sell 144,540 / PO Buy 136,980 USD, value date 02/11 → `PS-6ZY41KHW3`, net 7,560 USD, `in_order`
    Note `20260831-000488` confirmed with 0 rows — correct: its only USD-sales line has no price, so exposure is 0 and the plan is skipped.

### C. Riviera / Pierre (parallel)
12. ✅ **Answered 17/09 07:22Z** — "1. Agree / 2. Difficult to understand now the impact, I hope it could be change easily / 3. Agree". So hedge ratio, rounding and amount basis are all answered; rounding is a *deferred* interest, not a pending decision (see decision 9).
13. ⬜ Review platform business rules with Kantox (hedge % ramp schedule, since scaling is now platform-side). Pierre is learning the platform during the preprod phase.
14. ✅ Prod-cutover ops **provided 17/09**: SMS mobile `+33 6 38 69 56 04`; generic API mailbox pending (Pierre asked for the address).

### D. Kantox (their side)
15. ✅ **GET endpoint list delivered 22/09** — positions, position, orders, batch_mode (see decision 11). `entries` still unlisted → asked again 23/09.
16. ✅ **Preprod reset DONE** — confirmed 22/09, verified 23/09.
17. ⬜ Send prod credentials + full endpoint paths at cutover. Entry path confirmed as `/dynamic_hedging/entry`.
18. ✅ Invite rescheduled — **Thu 1 Oct 10:00 CEST**.
19. ⬜ Open questions sent 23/09 (09 questions): status enums, `executionRate` 0.0 semantics, empty `entries[]` on positions, `amountToTriggerCo` floor, `orders`/`batch_mode` relevance, `entries` support, pagination/export, `entry_rate`.

## Path to production (agreed on the call)
1. ✅ Preprod testing with dummy entries (done — 17 Sep)
2. ✅ **Riviera production CONNECTED → Kantox preprod with real data** (22 Sep, after Clément's reset confirmation) — 2 deals pushed, 1 position already executed
3. ⬜ Run for a few days/weeks — Kantox + Pierre validate business behaviour with real flows
4. ⬜ Kantox sends production credentials + endpoint paths
5. ⬜ Settings flip on the Riviera tenant → live (October target intact)