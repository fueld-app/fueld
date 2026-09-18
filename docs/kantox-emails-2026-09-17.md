# Pre-meeting emails — 17 Sep 2026 (send before the checkpoint)

> Two emails: (1) to Kantox — consolidated questions, nothing else needed verbally;
> (2) to Pierre — the three business decisions with recommended defaults.
> Both short on purpose. Each question is answerable with one line so they can
> reply inline before the call.

---

## Email 1 — to Clément + Marin (cc: Pierre)

**Subject: Kantox × Fueld — pre-read for today's checkpoint (6 questions + 3 proposals)**

Hi Clément, Marin,

Ahead of today's call — we've completed a first API integration pass against the preprod sandbox and wanted to share where we are, plus a short list of the only open items we need Kantox on. We tested live: authentication, entry submission, the entries/positions endpoints, dedup behaviour, cancellation, amendments, value-date handling and the entry-rate validation. Everything works as documented, and our sandbox positions are fully netted back to zero. We're ready to start building production integrations.

**The 5 questions we need answered today:**

1. **Close/cancel lifecycle after execution** — our plan closes a hedge when the customer payment arrives, which can be after the value date and/or after Kantox has executed. (a) When a customer pays *after* the value date, can we still send a negative/close entry for a past value date, or is it rejected like a new entry with a past date? If rejected, what do you recommend — roll (cost?), leave to settle, or unwind at spot? (b) Can an already-executed entry be offset with a negative entry, and at what cost?

2. **Two-leg flow — written confirmation + three edge cases.** Our understanding (per Marin's summary): for each deal we send the SO as a Sell entry and each PO as a Buy entry, same value date, and you net per bucket. Please confirm in writing, plus:
   a. If a PO supplier invoices in EUR (not USD), should that PO be excluded from the API (netting only works USD/USD)?
   b. If the Sell leg is sent before its paired Buy leg, is there a netting window before execution triggers — or must we submit both legs together?
   c. For a negative-margin deal (net exposure is a Buy), should we skip hedging that deal?

3. **Execution rules on the account** — our test positions showed "amountToTriggerCo: 5000.00 USD" and never executed (expected — test amounts). Can you share the business rules being configured (Piotr's side): execution threshold, timing (intraday/EOD), what happens to a sub-threshold bucket at value date, and whether partial execution is possible?

4. **Canonical endpoint** — both `POST …/dynamic_hedging/entry` and `…/request_entry` accept payloads in preprod. Which should we build on long-term?

5. **API ops (quick-fire)** — rate limits on login/entry/position calls (we run 4 server instances → ~4 logins per 10-min window, positions polled every 15 min)? Full `entryStatus`/`positionStatus` enums? Does `GET entries` support pagination/filtering?

**Three proposals for Pierre to approve (our recommended defaults — one-line confirmations appreciated):**

- **Hedge ratio:** start at **10%** of margin, step up monthly toward 100% as USD reserves build. Applied by us before sending.
- **Value-date rounding:** **weekly, round up to the next Monday** (we verified your platform rolls weekend dates to the next business day, so Friday submissions land cleanly in the Monday bucket).
- **Amount basis for floating quantities (300–350 MT style):** **exact amount at invoice** (delta entries for adjustments); pre-invoice pushes use the **minimum quantity**.

If you can confirm 1–4 in writing before or during the call, our implementation can complete this sprint. Best, Patrick

---

## Email 2 — to Pierre (cc: none)

**Subject: Kantox — 3 decisions to confirm today (30 seconds each)**

Pierre — ahead of the Kantox call, three decisions from our side with recommendations. If you're happy, just reply "agreed" and I'll present them as decided:

1. **Starting hedge ratio: 10% of margin**, stepping up monthly toward 100% as USD reserves build (Kantox's own recommendation for the first months).
2. **Value-date rounding: weekly, rounded up to Monday.** One BNPP settlement day per week keeps cash management simple; confirmed the platform handles weekend dates cleanly.
3. **Amount basis: exact amount at invoice**, with delta entries for quantity adjustments; before invoicing we hedge the minimum quantity, so we never over-hedge.

And two operational items we need from Riviera for the production cutover (only when you're ready — not blocking today):
- A **generic API mailbox** (e.g. `fx-api@rivieramarine.mc`) — Kantox needs it to issue production credentials.
- A **mobile number** for the production password (delivered by SMS).

Nothing else needed from you today. Patrick

---

## Sending notes

- Email 1 → `clement@kantox.com` (PM), `marin.demaisonrouge@kantox.com` (IM); cc `pierre@rivieramarine.mc`. Ask Clément to confirm the two-leg flow in writing — that's the written sign-off our plan requires.
- Email 2 → `pierre@rivieramarine.mc`.
- Both are structured so each question can be answered with one word/line — "spam-safe" per Patrick's instruction.
- Any answers received before the meeting get folded into the agenda; anything unanswered stays on the meeting list (`kantox-meeting-prep-2026-09-17.md` §2).