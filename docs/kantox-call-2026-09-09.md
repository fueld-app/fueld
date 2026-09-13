# Kantox call prep — elaborated questions + script (Wed 09 Sep 2026)

> Companion to `docs/plan-kantox-fx-hedging.md` (Rev 2). Meeting with Pierre Deyris / Marin (Kantox), 09 Sep 2026.
> Attendees should also bring: preprod credentials, the entryRef scheme, and this doc.

## The 30-second alignment statement (open with this)

> "Thanks for the deck, Pierre — it got us moving quickly. Let me confirm our understanding before we dive in: **when a deal is validated in Fueld, we push the USD commercial margin to Dynamic Hedging as a Sell entry. Kantox nets buy/sell orders and triggers the FX hedge at BNPP/Cortex. When the customer payment comes in, we close the exposure. That locks the EUR value of our margin from deal confirmation onward. USD→EUR only, for the Riviera Marine entity, go-live targeted October. Is that the right frame?"

This does three things: proves we did the homework, catches any misunderstanding *before* it costs implementation time, and anchors every question that follows.

**Status line to deliver right after**: "The integration plan is reviewed and approved on our side. We have your preprod credentials, and we're ready to start integration testing this week. The questions below are the last blockers before we start."

---

## Part 1 — Business contract questions (rule sign-offs)

### Q1. Hedge amount formula — get explicit sign-off

**Context**: The single most consequential decision. We hedge the **commercial margin per deal**, not the gross deal value. Our implementation basis: *sum the netted profit of order items whose sales leg is USD, convert to USD at the booking FX rate, multiply by a configurable `marginHedgePercent` (default 100%)*. Mixed-currency orders: only USD items in v1.

**Ask (exact wording)**:
> "Rule 1 for us: the amount we push is the **USD commercial margin** of the deal — netted profit on USD-sales items, converted at our booking rate — not the gross deal value. Can you confirm that's the intended use of Dynamic Hedging for this setup, and that margin (vs. gross) was what the kickoff had in mind?"

**Why it matters**: If they expect gross exposure or a different basis, the entire amount-computation module changes. It's a one-day change *now*, a data-migration headache after go-live.

**Good answer**: "Yes, margin is the target — that's the typical Dynamic Hedging use case."
**Red flag**: "You should hedge full deal value" or vague "depends" — then ask what their other clients in fuel/bunkering push and follow up in writing.

**Follow-up worth asking**: "Does Kantox have a preferred FX rate source for the entry, or is our booking rate fine? We currently leave `entryRate`/`entryRatePair` empty."

---

### Q2. COD / PREPAY deals — hedge or exclude?

**Context**: Our value date logic: `dueDate` if set; otherwise CREDIT → delivery/ETA + credit days; **COD/PREPAY → delivery/ETA date**, plus a 7-day payment buffer on everything. So a COD deal confirmed today can have a value date ~days away.

**Ask**:
> "For near-term deals — cash-on-delivery or prepay, where payment lands within days — should we hedge at all? Our default is yes, with a buffer. But we'd like your view: is a 3–7 day forward on a margin amount worth the hedge cost and admin, or do your other clients skip sub-tenor exposures?"

**Why it matters**: Determines whether ~a chunk of deals generate entries. Also the edge case: **"And what if the derived value date is today or in the past when we send the entry — is that accepted, or does Kantox need a minimum tenor?"**

**Good answer**: A clear include/exclude rule + minimum tenor, e.g. "value dates under X days are fine / exclude them."
**Fallback**: We make it a per-tenant config boolean (`hedgeCodPrepay`) — decision becomes reversible.

---

### Q3. FDDR daily limit ($200k/day) — hard cap or guidance?

**Context**: From the kickoff: roughly $200k/day of margin coverage. Our design is **warn-and-proceed**: if a day's confirmed total exceeds it, we log and show a banner but never block the deal or the hedge push.

**Ask**:
> "The ~$200k per day margin figure — is that a hard limit on your side, or a sizing guideline? Concretely: if we push $350k of margin confirmed on one day, does the platform reject, queue, or execute? And is the bucket keyed on **value date** or **entry date**? That changes how carefully we need to derive our value dates."

**Why it matters**: If it's keyed on value date, our 7-day buffer and credit-term derivation directly influence whether we trip the limit — we may need to spread entries across buckets. If it's a hard cap, warn-and-proceed becomes block-and-alert.

**Good answer**: "Guideline — you won't be rejected; the limit refers to hedge execution sizing per value-date bucket."
**Red flag**: "It rejects" — then we need a queuing strategy on our side before go-live.

---

### Q4. What happens when the value date passes without payment?

**Context**: We close the hedge when the customer payment is recorded. But customers are late. The hedge at BNPP is sitting there with a value date in the past.

**Ask**:
> "If the payment date slips and the value date passes, what happens to the hedge on your side — does it roll automatically, or should we proactively send a cancel-and-reissue pair with the new expected date? And is there a cost difference between letting it roll vs. amending?"

**Why it matters**: This defines our "stale hedge" handling. Currently our plan only reacts to explicit date changes in Fueld — it has no **late-payment detector**. If Kantox auto-rolls, we do nothing. If not, we need a cron check comparing open entries against overdue payments.

**Good answer**: "The position rolls/settles into spot; no action needed" — or "send a cancel + new entry, here's the cost."
**Follow-up if they roll**: "Then when we do close late, is the negative entry still matched against the original bucket or the current one?"

---

## Part 2 — API / technical questions (implementation blockers)

### Q5. Endpoint path — resolve the deck discrepancy

**Context**: Their deck (slide 10) shows `POST dynamic_hedging/entry`. Our plan is built on `POST /companies/{companyRef}/dynamic_hedging/request_entry`. One of these is right; it's a one-constant change for us, but we want the truth.

**Ask**:
> "Quick but blocking one: the deck shows `POST dynamic_hedging/entry`, but our working assumption from the kickoff is `request_entry` under the company path: `POST /companies/{companyRef}/dynamic_hedging/request_entry`. Which is the production path — and is `companyRef` a path parameter, a body field, or both?"

*(Slide 10's payload also includes `companyRef` in the body — so ask "both?" explicitly.)*

**Why it matters**: Wrong path = every preprod test fails with a confusing 404/405 and we burn a week thinking our auth is broken.

**Good answer**: Exact path + whether companyRef goes in body, path, or both + the preprod base URL confirmation (`https://kantox-preprod.com/api`).

---

### Q6. entryRef dedup semantics — our idempotency contract

**Context**: We generate deterministic entry refs: `{orderId}` for the initial entry, `{orderId}#A{n}` for amount amendments, `#C{n}` for cancels, `#R{n}` for date-based reissues. Our retry logic resends the **same entryRef** if a request timed out and we don't know if Kantox received it.

**Ask**:
> "Two related questions. First: if we send the **same entryRef twice** — say a network timeout where we can't tell if you received the first — do you deduplicate, or do we get two entries? Second: if we send the same entryRef with a **different amount**, do you reject it or update in place? We want to design our retries around the real behavior, and we can prove both cases in preprod this week if Marin can watch the entries."

**Why it matters**: This is the difference between "safe to retry on timeout" and "must never resend, ever." Our DB has a unique index per order for INITIAL entries, but wire-level idempotency is on Kantox's side.

**Good answer**: "We dedupe on entryRef" (idempotent — retries are free) or "no dedup, use unique refs per attempt" (we then append an attempt counter).
**Red flag**: "We'll have to check" — then make it preprod probe #1 this week.

---

### Q7. Negative amounts / partial closes — confirm the cancellation mechanism

**Context**: Plan: cancellation = **a new entry with a negative amount, same value date**. Partial payments = small negative deltas (we track cumulative cancelled amounts so we never over-cancel).

**Ask**:
> "We plan to close exposures with **negative-amount entries** — same currency, same value date, Sell direction. Confirm that's supported? Or should a partial close flip to a **Buy** direction with a positive amount? And is there no dedicated cancel/delete endpoint? Also: we may send several small negative deltas over weeks as partial payments arrive — any issue with multiple deltas instead of one consolidated close?"

**Why it matters**: If negative amounts aren't supported, the direction logic inverts and our whole close state machine needs rework. The partial-delta question matters because payment schedules in this industry are chunky.

**Good answer**: "Negative amounts are fine" or "use Buy + positive" — either is workable; we just need the truth.

---

### Q8. Per-entry rates vs net position — what can we honestly display?

**Context**: `GET dynamic_hedging/position` returns **netted** positions per currency pair / value-date bucket. We want to show a hedged rate on the order card in Fueld, but if we can only get netted buckets, per-order rates may be impossible.

**Ask**:
> "From the position endpoint we see the netted position and rate per bucket. Is there any way to get **rate data at entry level** — an entries list, or the individual deal references we can reconcile? If not, we'll display the net position rate per value-date bucket on our order pages. Is that netted rate a volume-weighted average **including your hedge execution at BNPP**, i.e., the actual effective rate our margin is hedged at?"

**Why it matters**: The answer defines the UI promise. If the net rate includes their execution slippage, it's the honest number to show our traders. If it's a mid-market snapshot, we need to label it as indicative.

**Good answer**: Either "here's an entries endpoint" or "net position rate is the real executed average — safe to display."
**Fallback**: We show net position rate with a "netted, indicative" label and disclaim it.

---

### Q9. Rate limits & the 10-minute token

**Context**: Token from `POST /login` is valid 10 minutes. We cache it per server process — **we run 4 API instances**, so worst case 4 logins per 10-minute window at Riviera's volume. We also poll the position endpoint every 15 minutes per instance.

**Ask**:
> "Two operational questions. One: your login token lasts 10 minutes and we run four server instances, so up to four logins per 10-minute window. Is that within your rate limits, or should we persist one shared token centrally? Two: what are the documented rate limits on `request_entry` and `position` — call counts per minute or per day — so we can size our polling? We currently plan a position poll every 15 minutes."

**Why it matters**: If logins are rate-limited, our per-process cache silently breaks under load and hedges fail to send (we'd get 401/429 loops). Also worth asking: **"Is there a token/session endpoint limit per user or per IP?"**

**Good answer**: Documented limits ("you're fine at that volume") or "here's the rate limit doc."
**Red flag**: "We don't publish limits" — then ask for a safe ceiling in writing.

---

### Q10. Auth conventions — quick confirmations

**Ask (rapid-fire, expect yeses)**:
> "Confirming three details: the token goes in the **`X_AUTH_TOKEN` header** (with underscores, as in the guide); **parameters go in the body, never the URL**; and what's the preprod password expiry policy — will the sandbox credentials rotate, and if so how do we get new ones? And is there any IP allowlist we should give you for our servers?"

**Why the IP question matters**: If preprod (or prod) has IP allowlisting and our 4 VPS instances aren't listed, everything fails mysteriously. Cheap to ask, expensive to debug.

---

## Part 3 — Timeline & process

### Q11. Go-live path to production

**Ask**:
> "We're targeting October for production. What does the path look like on your side? Specifically: when do we get production credentials and the production `companyRef` — is it the same API user or a new one? Is there a certification or UAT checklist you require before we cut over? And is the cutover literally a base-URL and credentials swap on our side, or are there preprod-only behaviors we should know about?"

**Follow-up**: "And on the BNPP/Cortex side — is there anything **we** need to arrange with the bank, or is that entirely within your rails?"

**Why it matters**: October is ~4 weeks away. If there's a two-week Kantox-side sign-off process, it needs to start now, not in October.

---

### Q12. Preprod validation workflow

**Ask**:
> "We'll be pushing test entries into preprod this week — likely Friday. Practically: can **you see our entries in your Kantox UI in real time**, and who on your side validates them? Marin? What evidence do you want from us — should we send payload dumps, or do you prefer to check on your side? And can you reset/clean the sandbox between test rounds so our amended/cancelled test noise doesn't pollute the view? Finally — how fast can we get feedback on a test batch, same day?"

**Why it matters**: Sets the feedback loop speed. If validation takes 3 days per round, the October date needs renegotiating or a dedicated contact.

---

### Q13. Webhooks — confirm the polling assumption

**Ask**:
> "Our understanding is Dynamic Hedging doesn't offer webhooks, so we poll the position endpoint every 15 minutes to learn execution status. Confirm that's still the case — and if so, is there any way to query **per-entry status** (did our specific entry get hedged? at what rate?) rather than only the netted position? And how long after we push an entry does it typically appear in the position data?"

**Why it matters**: Our `HEDGED` status transition depends on this. If there's no per-entry status, "hedged" becomes a tenant-level inference, and the order card can only ever say "submitted + net position."

---

### Q14. Checkpoint cadence & contacts

**Ask**:
> "Last one — logistics. Can we hold a weekly checkpoint until go-live? Same attendees — you, Marin, me? And for blocking technical questions mid-week, what's the best channel — direct to Marin, or through you? Also: could you confirm in writing the answers from today, or is a follow-up email from me summarizing decisions okay?"

**Pro move**: Say "**I'll send a summary email with the decisions after the call — corrections welcome within 24h.**" That makes the call's outcomes durable without asking them to write anything.

---

## Part 4 — The call script (timed, 30–45 min)

| Time | Segment |
|---|---|
| 0:00–0:01 | Greeting, agenda in one breath |
| 0:01–0:03 | Alignment statement + status ("plan approved, testing this week") |
| 0:03–0:13 | Part 1: business rules — **Q1 → Q2 → Q3 → Q4** |
| 0:13–0:28 | Part 2: technical — **Q5 → Q6 → Q7 → Q8 → Q9 → Q10** |
| 0:28–0:35 | Part 3: **Q11 → Q12 → Q13 → Q14** |
| 0:35–0:40 | Wrap: recap decisions, action items, confirm summary email |
| | *Buffer for their questions — they'll have some* |

**Opening lines**:
> "Thanks Pierre. I've got about 40 minutes of material and I'd like to leave time for anything on your side — so I'll move quickly through three blocks: the business rules we need sign-off on, a handful of API details, then the go-live path. Does that work?"

**Lines to have in your back pocket**:

- If an answer is vague: *"Understood — can I treat that as the working assumption and confirm it in my follow-up email, or is it worth checking with someone before then?"*
- If they ask what we've built: *"The full design is done and internally reviewed — API client, entry lifecycle, retry and failure handling, and the order-page UI. Nothing hard-coded to preprod; production is a credential swap. The only code we haven't written is the code these answers unblock."*
- If they push scope (sFTP, webhooks, multi-currency): *"Deliberately out of v1 — we sequenced the API path first and kept those as fallbacks. Happy to revisit at go-live review."*
- If time runs short: drop Q4, Q13, Q14 (all resolvable by email) — never drop **Q1, Q2, Q5, Q6, Q11**.

**Wrap-up script**:
> "To recap what I heard — [decisions]. On our side: we start preprod testing this week, including the dedup and negative-amount probes, and we'll share the evidence. I'll send a written summary of today's decisions within 24 hours — correct me if I've misheard anything. Next checkpoint same time next week?"

**Bring to the call**: the preprod credentials (test a login before the call if there's time — instant credibility), the entryRef scheme, and this doc.

**After the call**: send the decision summary email, update `docs/plan-kantox-fx-hedging.md` §10 with the answers, and unblock implementation.

---

## Priority view (if time is short)

| Priority | Questions | Why |
|---|---|---|
| 🔴 Never drop | Q1, Q2, Q5, Q6, Q11 | Business sign-off + API blockers + go-live path |
| 🟠 Strongly want | Q3, Q4, Q7, Q8 | Shape state machine / UI promise |
| 🟡 Can be email | Q9, Q10, Q12, Q13, Q14 | Operational, resolvable async |