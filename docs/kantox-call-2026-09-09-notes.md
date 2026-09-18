# Kantox kickoff — meeting notes (Tue 09 Sep 2026)

**Attendees**: Patrick (Fueld), Pierre Deyris (Riviera Marine — CFO side), Marin, Clément (new Kantox PM, taking over project management), + others on Kantox side.
**Next checkpoint**: **Thursday 16 Sep, 10:00 (Kantox/CET) / 12:00 (Patrick, Dubai)** — Kantox sends the invite.
**Technical channel**: technical questions → **Clément** (Marin for implementation-level). Slides from the call to be emailed by Kantox.

---

## ⚠️ Headline: the integration architecture may flip — confirm in writing

Kantox described the flow as: **for each deal, send BOTH order legs as separate entries — the sales order as a Sell and the purchase order as a Buy, with the same value date — and Kantox's system nets them per value-date bucket and hedges only the net (the commercial margin).**

This differs from our plan (Rev 2 rule 1), where **we** compute the margin and push one Sell entry for the margin amount. If Kantox nets gross legs:

- We send gross amounts (customer USD receivable + supplier USD payable), not computed margin
- The `marginHedgePercent` scaling question becomes unclear (see open questions)
- Our amount-computation module is replaced by a leg-extraction module
- `entryRef` needs two refs per deal (sales leg + purchase leg)

**Action: confirm with Clément by email before writing the amount logic.**

---

## Answers received

### Business rules

| # | Topic | Answer |
|---|---|---|
| 1 | **Hedge target** | Net commercial margin — confirmed. But via **netting of gross legs** (see headline). |
| 2 | **Margin basis** | **Whole oil margin — do NOT subtract financing costs** (the ~8% cost of capital is managed separately on Riviera's side, not in the hedge amount). |
| 3 | **When to hedge** | **At order creation/validation** — "that's when the risk happens", not at delivery. Matches our CONFIRMED trigger. |
| 4 | **Value date** | Expected customer payment receipt **+ buffer** (recommended because they don't auto-roll) — matches our `paymentDateBufferDays`. |
| 5 | **Weekly rounding** | Kantox recommends rounding value dates to **one settlement day per week** (avoids daily BNPP settlements and daily cash management). Pierre to confirm cash preference; Patrick: "we'll accommodate whatever the business prefers." **Decision pending: which weekday.** |
| 6 | **Late payment / past value date** | Hedge is **not auto-rolled**; it sits on BNPP's side. Can be rolled but with a **possible cost (BNPP decides)**. Hence their buffer recommendation. |
| 7 | **Cancellations** | Confirmed possible **2–7 days after deal confirmation**, before delivery; sales + purchase legs cancel back-to-back (fully connected). |
| 8 | **Cancellation mechanism** | ✅ **Negative amounts supported** — send the same API call with **negative amounts on BOTH the Sell and the Buy side**; Kantox hedges a Buy to cancel the Sell. |
| 9 | **Multiple suppliers per order** | Supported — logic unchanged; netting is per value date, any number of purchase legs against one sales leg. |
| 10 | **Modifications (floating quantity)** | Quantities can move between order and BDN/invoice (e.g. 300–350 MT, finalized on delivery). Kantox's preference (their words): **either send the exact amount at invoice time, or send the minimum amount** — "let's not overcomplicate this." Sending the minimum means any under-hedge leaves extra USD on Riviera's side (which Pierre actually wants). Adjustments = **delta entries, positive or negative**. |
| 11 | **Hedge percent** | Not 100% at start — Pierre: at the beginning convert ~10–20%, growing over ~6 months as USD cash reserves build. **Mechanics unclear: does the percent apply to the netted margin, or to scaling of legs? → confirm.** |
| 12 | **entryRate / entryRatePair** | ✅ **SEND THEM** — the booking rate at deal creation. Kantox compares entry rate vs spot at reception for pricing-risk analytics. |
| 13 | **10% rejection rule** ⚠️ | If the rate at Kantox reception differs **>10%** from our entry rate, the entry is **rejected**. Fine for us — we'll push on-the-fly as deals are confirmed (confirmed on the call, no batching). But: our client must **handle rejection responses**. |
| 14 | **Batching** | Not needed; on-the-fly confirmed ("we have clients that batch at 8 PM, but up to you"). |
| 15 | **Notes field** | Free text for reporting — client details, order context, etc. |
| 16 | **entryDate** | Optional; date the deal was created. |

### Platform / credentials

| # | Topic | Answer |
|---|---|---|
| 17 | **Data access** | Trade confirmations from BNPP Cortex come back to Kantox → available in **Power BI** or via API (**GET entry / GET position**). ⚠️ A **GET entry** endpoint was mentioned — this may give us per-entry data we assumed was unavailable (plan P1-4). **Confirm the exact GET endpoints.** |
| 18 | **Auth** | API user + password → token valid **10 minutes**. Transcript ambiguous on reuse ("valid for 10 minutes that you can reuse… regenerate every time that you want to do a query"). **Confirm: token reusable within 10-min window, re-login after expiry?** |
| 19 | **API docs location** | In the Kantox platform under **Help → API Documents** (use the preprod account they shared). |
| 20 | **Production credentials path** | Different URL for prod. Kantox needs from us: (a) a **generic API user email address** (not tied to a person), (b) a **phone number** — the prod password is delivered by SMS. |
| 21 | **Go-live process** | Test in preprod **with real production-like data** — explicitly requested ("direct prod information within our test environment") so Piotr (BNPP/Kantox business rules) can define the appropriate hedging rules. Once everything is confirmed → go live → Kantox sends new credentials + new company reference. |
| 22 | **Who to contact** | Technical → Clément (PM). Marin on implementation. Pierre stays involved. |

---

## Open items — sorted by owner

### A. For Kantox (technical — email to Clément / Marin)

1. **[BLOCKER] Two-leg netting confirmation** — is the intended flow (a) we send gross Sell + Buy legs and Kantox nets, or (b) we send one computed-margin entry? Headline question above. If (a): confirm both legs take the **same value date** (even though supplier payment dates differ from customer payment dates)?
2. **[BLOCKER] Endpoint path** — `POST /companies/{companyRef}/dynamic_hedging/request_entry` vs the deck's `POST dynamic_hedging/entry`. Which is correct, and does `companyRef` go in path, body, or both?
3. **GET entry / GET position** — exact endpoints, request/response shapes. Does GET entry expose **per-entry status and per-entry rate**? (Changes our `hedgedRate` design, plan P1-4.)
4. **entryRef dedup semantics** — same entryRef sent twice (network timeout): deduped or double-booked? Same entryRef with a different amount: rejected or updated in place? Affects our retry design.
5. **Token reuse** — the call was ambiguous: is the token reusable within the 10-minute window with re-login on expiry, or must we re-login for every call?
6. **Rate limits** — login / `request_entry` / `position` call limits. We run 4 server instances (worst case 4 logins per 10-min window) and plan a position poll every 15 min.
7. **Value date mechanics** — is a value date in the past or today accepted? Is there a minimum tenor?
8. **Roll mechanics + cost** — when a value date passes unpaid, what exactly happens on the BNPP side, and what does a roll cost vs a cancel-and-reissue? (Piotr?)
9. **FDDR limit mechanics** — the ~$200k/day: hard cap (reject/queue) or guideline? Bucketed on value date or entry date?
10. **Weekly rounding** — is rounding done on our side (we adjust value dates before sending), or does Kantox support a rounding rule per account?
11. **Partial hedge percent mechanics** — since you'll start below 100%: does the hedge percent scale the legs before sending, or the netted margin, or is it a Kantox-side setting per account? How should we express it in the payload?
12. **Prod password** — SMS to which number / what happens when the phone holder changes?

### B. For Riviera Marine (business decisions — Pierre, informed by A)

1. **Which orders to hedge** — include COD/PREPAY (near-term, value date ≈ delivery) or only CREDIT deals? Decide after Kantox answers A7/A8 (min tenor, roll cost).
2. **Initial hedge percent + ramp** — Pierre indicated ~10–20% initially, growing to 100% over ~6 months as USD reserves build. Confirm the starting number and the trigger for increasing it.
3. **Weekly settlement day** — Pierre was thinking; align with cash management (he wants to retain USD early on).
4. **Floating quantities: minimum vs exact-at-invoice** — Kantox's lean is exact-at-invoice or minimum (never maximum). It's Riviera's money — pick one. We can make it configurable.
5. **Payment date buffer** — 7 days default; is that right for Riviera's client late-payment history?
6. **Daily limit stance** — if Kantox says the FDDR limit is a hard cap, does Pierre want us to spread entries or accept queuing/rejection?
7. **Ops setup** — generic API user mailbox (e.g. `fx-api@rivieramarine.com`) and the SMS phone number for prod credentials.

### C. Hybrid — Kantox info first, Riviera decides after

- **Roll vs cancel-and-reissue policy** when payments slip (needs A8 cost info → Pierre picks the policy → we implement it)
- **COD/PREPAY inclusion** (needs A7 min tenor → decision B1)

### D. Fueld implementation notes (our side, no one to ask)

- Handle the **10% entry-rate rejection** response in the API client (mark FAILED + activity log, surface on order card)
- Keep `hedgeCodPrepay`, `marginHedgePercent`, `paymentDateBufferDays`, and the value-date rounding rule as **tenant config** so Riviera's business decisions stay reversible without code changes

---

## Impact on the Fueld implementation plan (`plan-kantox-fx-hedging.md`)

| Plan item | Status after call |
|---|---|
| Rule 1 (amount formula) | ⚠️ **Under revision** — pending two-leg-netting confirmation; margin = whole oil margin (no financing-cost deduction) is confirmed |
| Rule 2 (Sell only) | ⚠️ If two-leg: we also send a **Buy** leg per supplier order |
| Rule 3 (entryRef) | Needs extension for two legs per deal |
| Rule 4 (valueDate) | Confirmed: expected payment + buffer; **add weekly rounding step** (day TBD) |
| Rule 5 (negative cancel) | ✅ Confirmed — negative on **both** legs |
| Rule 6/7 (delta / cancel+reissue) | ✅ Confirmed in principle (deltas ±; date change → cancel + reissue) |
| Rule 8 (FDDR limit) | Still open |
| entryRate | **Changed**: now we send booking rate (was empty) + must handle 10% rejection |
| `marginHedgePercent` default | **Changed**: start ~10–20%, not 100 (mechanics TBD) |
| GET entry | New: per-entry data may exist — affects `hedgedRate` design (P1-4) |
| Prod credentials | New requirements: generic API email + SMS phone number; real-data preprod testing requested |