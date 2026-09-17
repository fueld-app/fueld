# Kantox checkpoint — live meeting notes (17 Sep 2026)

> Cheat sheet for the call. Emails already sent to Marin + Pierre with the
> same content — if they read them, open on the answers, not the questions.
> Full evidence: `kantox-meeting-prep-2026-09-17.md` §1 (V1–V19).

## Opening (30 sec)

"We completed a full live integration pass in your preprod sandbox this
morning — auth, entry submission, entries/positions endpoints, dedup,
cancellations, amendments, value-date handling, the 10% entry-rate rule.
All works as documented. Our sandbox is netted back to zero. We're already
building the integration. What's left is in this email you should have."

## 🔴 Must land today (blocks our code)

### 1. Close/cancel lifecycle — the big one
- **Customer pays AFTER value date** (normal case): can we send a negative
  close entry for a past date, or is it rejected like a new entry?
  - If rejected → roll (cost? Piotr) / leave-to-settle / spot unwind?
- **Cancelling an already-EXECUTED entry** — offset with negative entry?
  At what cost (unwind/spread)? Does `amountAfterCancellations` still work?
- ⚠️ Do not leave without an answer — our entire close-on-payment design
  depends on it. This is Q0/Q0b.

### 2. Two-leg flow — get the WRITTEN confirm
- SO = Sell, PO(s) = Buy, same value date, you net per bucket → confirm.
- Edge cases to land:
  - EUR-invoiced PO → exclude from API? (netting only works USD/USD)
  - Sell sent before its Buy pair — netting window before execution
    triggers, or must both legs arrive together? (unpaired gross leg ≈10×
    the margin could trigger a gross hedge!)
  - Negative-margin deal (net = Buy) → skip hedging?
  - Multiple POs against one SO — confirmed verbally 09/09, want it writing.

### 3. Execution business rules (Piotr)
- `amountToTriggerCo: 5000 USD` — is that the minimum hedge batch?
- Execution timing: intraday / EOD / bucket close?
- Sub-threshold bucket at value date → expires unhedged? (Riviera thinks
  it's hedged but isn't)
- Partial execution possible (5,000 of 7,200)?
- Ask: can they lower the threshold in preprod so we can observe a real
  execution + `hedgedRate` population before UAT?

### 4. Canonical endpoint
- `/entry` and `/request_entry` both work in preprod — which is the
  production-stable path? Any difference (async vs sync)?

### 5. Decision sign-offs (proposals already emailed — get yes/no)
- Hedge ratio: **10% start**, ramp monthly → 100%, scaled by us before sending
- Value-date rounding: **weekly, round up to Monday**, client-side
- Amount basis: **exact-at-invoice**, minimum-quantity basis pre-invoice,
  delta entries for adjustments

### 6. Quick-fire (one-liners)
- Rate limits: 4 instances → ~4 logins/10-min; entries+positions poll
  every 15 min/tantum — OK?
- Full `entryStatus` / `positionStatus` enums? (observed: `in_position`,
  `accumulating`, `recalculating_batch`)
- `GET entries` pagination/filtering at volume?
- Sandbox: can you wipe our 22 `PROBE-*`/`TEST-*` entries before UAT?

## Route to Piotr (not today's decision, but flag)
- FDDR ~$200k/day: hard cap (reject/queue) or guideline? Value-date or
  entry-date bucketed?
- Roll cost for past-due value dates (feeds the Q0 fallback choice)

## From Pierre (separate email sent — expect "agreed")
1. Hedge ratio 10% start ✓?
2. Weekly-Monday rounding ✓?
3. Exact-at-invoice amount basis ✓?
Plus ops asks (not blocking): generic API mailbox, SMS number for prod
password.

## ⚠️ Don't say (panel corrections — over-claims to avoid)
- Don't assert WHY nothing executed in our tests (threshold is one of
  three explanations — it's a question, not a finding)
- Don't promise per-entry rates on the order card — `hedgedRate` field
  exists but was never observed populated; keep net-position fallback
- Don't claim the state machine is "verified" — only the pre-execution
  half is; post-execution is exactly what we're asking about
- Netting bucket dimensions: we proved value-date matters; don't assume
  it's the ONLY key (currency pair/direction/company likely too)

## Leverage points to land
- We probed 22 test entries live and netted everything back to 0.00 —
  we're a serious integration partner, not a questionnaire
- The 10% rejection rule caught our off-market test rate with a clear
  error message — their validation works, we handle it
- Our entryRef scheme (`{orderNumber}#S|#P1|#SC1`…) netted correctly —
  ask them to confirm it's compliant so we can freeze it
- Every question has a proposed default — silence or "we'll check" still
  leaves us buildable (defaults become working assumptions in writing)

## Ask for before hanging up
1. Written two-leg confirmation (email from Clément suffices)
2. Answers to Q0/Q0b (close semantics) — even provisional
3. Executed-entry sample from GET entries (any past entry from their UI
   demo account) — proves `hedgedRate` population
4. Next checkpoint + Piotr intro for the business-rules items