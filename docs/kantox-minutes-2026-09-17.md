# Kantox IT follow-up — minutes & production todolist (17 Sep 2026, 10:00 CEST)

> Attendees: Patrick (Fueld), Clément Sicart (PM), Marin (IM), Pierre (joined during call).
> Next checkpoint: **Wednesday 23 Sep, 9:30 CET (11:30 Dubai)** — invite from Clément.
> Thursday is a bank holiday (FR).

## Decisions from the call

| # | Topic | Decision |
|---|---|---|
| 1 | **Late payment / past-due hedge** | Rolls are handled **manually by Pierre on the Kantox platform** (BNPP executes). NO data from us, NO Kantox cost — any cost is BNPP-side. We do NOT build roll automation; we flag late payments to Pierre instead. |
| 2 | **EUR-invoiced POs** | **Exclude** — only USD invoices/legs are sent. (Confirmed recommendation.) |
| 3 | **Sell-before-Buy sequencing** | **Out of scope** — edge case, can't think of real instances; revisit if a real need appears. |
| 4 | **Negative-margin deals (net Buy)** | We manage client-side: **never send a net-BUY position** — skip the deal (or net against same-date sells only). Kantox would otherwise auto-execute the opposite trade at maturity. Our over-cancel cap already enforces this. |
| 5 | **Execution floor** | **NO floor limit** — hedge from the first dollar of exposure. (Pierre to sanity-check; most deals >$20K.) |
| 6 | **Canonical endpoint** | Same for production as preprod; Kantox sends full paths + prod credentials at cutover. |
| 7 | **Hedge ratio mechanics — CHANGED** | `marginHedgePercent` is a **Kantox platform business rule, NOT client-side**. We send the **FULL exposure amount**; the platform hedges the % Pierre defines. No client-side scaling, no re-development when the ratio ramps. Kantox cannot tick/untick individual invoices — scope control (which orders to send) stays with us (USD-only filter). |
| 8 | **Amount basis — SIMPLIFIED** | Send **ONE amount: the minimum pre-invoice quantity amount**. No pre-invoice + exact-at-invoice delta flow ("start simple" — avoids noise from SO/PO timing gaps). Adjust later if cash management needs it. |
| 9 | **Value-date rounding** | **Pierre decides after discussing with top management** (weekly / twice-monthly / monthly all on the table; Kantox neutral, weekly = faster USD conversion). Our WEEKLY_MONDAY default stands until Pierre says otherwise (config knob ready). |
| 10 | **Rate limits** | Only constraint: 10-min token re-login. No other rate limits. |
| 11 | **Webhooks** | None (as assumed) — GET calls only; **Kantox to send us the list of GET endpoints** for tracking (sales invoice ref → order ref → hedged rate). |
| 12 | **Path to production** | Phase 2: **connect Riviera PRODUCTION to Kantox PREPROD** with real data for a few days/weeks (nothing is triggered; Pierre learns the platform; Kantox validates business rules with real flows). Sandbox will be **reset** just before we start. Once happy → production credentials + endpoints from Kantox → cutover. |
| 13 | **Next checkpoint** | **Wednesday 23 Sep, 9:30 CET (11:30 Dubai)** — Clément sends invite. Thursday is a bank holiday. |

## Production todolist

### A. Fueld — code (Patrick, this week)
1. ✅ Amount logic simplified (full exposure, platform-side ratio) — 5788f568
2. ✅ Scope filter: USD-only, EUR POs excluded, negative-margin skipped (a74d975e)
3. ✅ Event hooks wired: CONFIRMED → SO+PO push; payment → close delta; CANCELLED/LOST → negatives (a74d975e) — **fixed f33cfaf2**: the CONFIRMED hook was handed `settings=null` and silently resolved to "disabled", so no entry would ever have been pushed; it now reads the tenant's own settings. The push audit row used the non-UUID actor `'kantox-system'`, which the `activity_logs.user_id` FK rejected (and `logActivity` swallows) — system actions now log with `user_id = null`.
   - ⚠️ **Late-payment flag NOT built** (previously listed here as done — it is not). Decision 1 says Pierre rolls manually on the Kantox platform and we "flag late payments to him"; no code exists for that. Small piece: on sync, when an open SELL leg's `valueDate` has passed, surface it (activity log entry + order-card badge) so Pierre has something to act on. Blocked on nothing — build alongside the UI item below.
4. ✅ Value-date rounding: WEEKLY_MONDAY default, config knob ready
5. ✅ Reconciliation sync loop live (15 min; will extend when Kantox sends the GET list)
6. ⬜ UI: order-card FX hedging block; admin Kantox settings form
7. ✅ Tests: 29 green (client contract, scope filter, two-leg plan, close-delta math, + 3 DB-backed hook tests pinning the `settings=null` and audit-actor defects)
8. ✅ Route fix: /orders/:id/hedge param conflict caught by blue-green startup gate (3359e5b9)

### B. Fueld — ops (Patrick, before Wednesday)
8. ✅ Sandbox reset requested (email to Clément 17/09, cc Marin+Pierre) — awaiting confirmation
9. ✅ Deployed to all 4 instances (sha 3359e5b9, migration 0120 applied, blue-green verified)
10. ✅ Riviera tenant configured: kantoxSettings (preprod base URL, apiUser, companyRef) + encrypted apiPassword in integration_credentials — **enabled=false until Clément confirms the sandbox reset**, then flip enabled=true
11. ⬜ After reset confirm + enable: real Riviera orders flow → verify entries in Kantox preprod UI with Marin

### C. Riviera / Pierre (parallel)
12. Decide **value-date rounding** with top management (weekly / 2×month / monthly) → one-line answer flips our config.
13. Review platform business rules with Kantox (hedge % ramp schedule, since scaling is now platform-side).
14. (Later, for prod cutover) generic API mailbox + SMS number.

### D. Kantox (their side)
15. Send the **list of GET endpoints** for data retrieval/tracking.
16. **Reset preprod** before production-data phase.
17. Send prod credentials + full endpoint paths at cutover.
18. Wednesday invite (Wed 23 Sep, 9:30 CET).

## Path to production (agreed on the call)
1. ✅ Preprod testing with dummy entries (done — 17 Sep)
2. **Connect Riviera production → Kantox preprod** with real data (this week, after reset + deploy)
3. Run for a few days/weeks — Kantox + Pierre validate business behaviour with real flows
4. Kantox sends production credentials + endpoint paths
5. Settings flip on the Riviera tenant → live (October target intact)