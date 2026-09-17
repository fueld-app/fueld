# Kantox meeting prep — preprod probe results + blocker list (17 Sep 2026)

> Prepared for the Kantox checkpoint (17 Sep 2026). Live API probes were run against
> the preprod sandbox on 17 Sep (read-mostly; 12 test entries created and fully
> netted back to zero — every position now nets 0.0 USD).
> Companion docs: `plan-kantox-fx-hedging.md` (Rev 3), `kantox-call-2026-09-09-notes.md`.

## 1. What we already verified live (evidence for Marin — no need to re-ask)

| # | Question from our list | Answer (verified in preprod 17/09) |
|---|---|---|
| V1 | Login endpoint + field names | `POST /api/login` with **`{"login": …, "password": …}`** (NOT user/email). Returns bearer token, `expires_in: 600`, `scopes: ["api"]`. |
| V2 | Auth header | `X_AUTH_TOKEN: <raw token>` ✅ (raw `AUTHORIZATION: <token>` also works; **`Bearer` prefix is rejected**) |
| 3 | Endpoint path (deck `POST dynamic_hedging/entry` vs our `/companies/{companyRef}/dynamic_hedging/request_entry`) | **Company-scoped path is the real API**: `/api/companies/{companyRef}/dynamic_hedging/entry` ✅ (bare `/api/dynamic_hedging/*` 404s). Both `/entry` and `/request_entry` accept payloads — we'll ship one, confirm which is canonical. |
| V4 | Payload field naming | **snake_case in requests**: `currency`, `counter_currency`, `market_direction`, `amount`, `entry_ref`, `value_date`, `entry_date`, `entry_rate`, `entry_rate_pair`, `notes` — the deck's camelCase (`marketDirection`, `valueDate`) is response-side only. |
| V5 | `market_direction` enum | **lowercase `sell` / `buy`** — the deck's `"Sell"` is rejected ("Market Direction isn't an option"). |
| V6 | **entryRef dedup semantics** (open item A4) | **Dedupe is ON**: re-sending an existing `entry_ref` (even with a different amount/direction) → `403 "This company already has an entry with the same external_ref …"`. Same-ref retries are safe; same-ref-amend is impossible — new ref per delta. |
| V7 | Cancellation mechanism (A8) | New entry, **same market_direction + negative amount**, new ref (we used 1-char-diff `PROBE-ONLZ` per the kickoff deck's `C-1234` convention) → accepted, nets down the position. |
| V8 | Value date minimum tenor (A7) | Past date → rejected (`"It cannot be a past date"`). **Today is accepted** — no minimum forward tenor. |
| V9 | entryRate 10% rejection rule | **Confirmed empirically**: `entry_rate: 2.0` vs spot ~1.146 → rejected with explicit message ("more than 10% away from the spot rate of the moment. This monitoring level ca[n be adjusted?]"). Within 10% (1.20) → accepted. |
| V10 | Delta modifications | Positive/negative delta entries accepted (rule 6 confirmed). |
| V11 | `GET entry` per-entry data (A3) | **`GET …/dynamic_hedging/entries` exists** ✅ — per-entry status, rates, `positionRef`. This resolves plan assumption P1-4/K-P2-10: per-entry data IS available. Response fields: `reference` (E-XXX), `entryRef` (ours), `amount`, `amountAfterCancellations`, `rate`, `ratePair`, `entryStatus`, `positionRef`, `hedgedRate` (null until executed), `executionRate`, `counterValue`, `deltaResult`, `notes`, `valueDate` (DD/MM/YYYY in responses). |
| V12 | Position endpoint | `GET …/dynamic_hedging/positions` (list, no params) + `GET …/dynamic_hedging/position?position_ref=PS-XXX`. Position fields: `weightedAverageRate`, `amount`, `positionStatus`, `amountToTriggerCo`, nested `entries[]`. |
| V13 | Netting granularity | **Netting is per value-date bucket** — a cancel entry **without** `value_date` lands in a dateless bucket and does NOT net against the dated original. **Cancels/deltas MUST repeat the original's `value_date`.** (Proven the hard way; silently mis-nets otherwise.) |
| V14 | Status enums (partial) | entry: `in_position`; position: `recalculating_batch` → `accumulating`. Updates are **batched (~1–2 min lag)** — position reads return stale values during recalc. |

| V15 | Rejected-entry ref reuse | After a 10% rejection, the **same `entry_ref` is reusable** (rejected entries don't persist) — retry-after-rejection keeps the ref; retry-after-timeout needs a new ref (dedup blocks). |
| V16 | 10% band symmetry | **Symmetric**: rate 1.0 vs spot ~1.146 (−12.7%) also rejected. |
| V17 | Our `{ref}#C1` suffix scheme | **Works and nets correctly** — `TEST-A` + `TEST-A#C1` netted to 0.0 in the 01/10 bucket. The kickoff deck's "1 character different" rule is NOT a hard requirement → our planned `{orderId}#C{n}` scheme is compliant. |
| V18 | Weekend value dates | Sat/Sun dates **accepted**; Kantox **rolls them to the next business day** (19–20/09 landed in the Mon 21/09 bucket). Cancels sent with the pre-roll date still net correctly — normalization happens entry-side. |
| V19 | Position recalc lag | Positions update via async batch (~1–2 min): reads return stale `amount` + `recalculating_batch` status after writes. Sync loop must tolerate lag. |

**Sandbox state after testing**
**Sandbox state after testing (final)**: all 5 positions net **0.00 USD** (22 test entries, cumulative amount 0 — includes two full cancel/correct cycles). Request: ask Kantox to archive/clear the `PROBE-*`/`TEST-*` entries before UAT.

**⚠️ Note**: `amountToTriggerCo: "5000.00 USD"` appeared on our position — possible **minimum execution threshold**. Nothing executed at our test amounts (correct behavior if so). Added as Q3 below.

## 2. Remaining blockers — need Kantox answers today

> Re-tiered after 3-model panel review (`model-reviews/20260917-kantox-prep-digest.md` — verdict: READY-WITH-ADDITIONS).
> Suggested 45-min agenda: (1) Q0+Q0b close/lifecycle [10'] (2) Q4 two-leg, written confirm [10'] (3) Q2 trigger rules [10'] (4) Q5 percent mechanics [5'] (5) quick-fire Q1/Q6/Q7/Q8 [10'] (6) prod path + ops [5']. Route Piotr items explicitly (Q0 roll cost, Q2, Q9).

### 🔴 Must land in the meeting (blocks architecture/code)

**Q0. Late-payment close semantics — THE most important question.** V8 (past value dates rejected on creation) + V13 (netting is per value-date bucket) imply: when a customer pays AFTER the value date (the normal case the 7-day buffer only mitigates), our close entry carries a past date → rejected? Ask: are negative/close entries exempt from the past-date check? If not: roll (cost — Piotr), leave-to-settle, or spot unwind? **The core promise "hedge closed when payment received" is unproven for the late-payment case — the case that matters most.**

**Q0b. Cancelling already-EXECUTED entries.** No probe entry ever executed (threshold), yet payment-close in production always happens post-execution. Can a negative entry offset a `hedged` entry? At what cost (unwind/spread)? Does `amountAfterCancellations` attribute correctly post-execution? If execution is EOD/intraday, every real cancel is post-execution.

**Q1. Canonical entry endpoint** — `/entry` and `/request_entry` both accept payloads. Which is the production-stable path? Any behavioral difference (async vs sync, response completeness)? Plus: API versioning/deprecation policy.

**Q2. Execution business rules — what actually triggers a hedge?** Positions sat in `accumulating` with `amountToTriggerCo: "5000.00 USD"` and never executed. Need Piotr's spec: threshold (min hedge batch?), execution timing, partial execution (5,000 of 7,200?), and what happens to an un-executed sub-threshold bucket at value date — expires unhedged while Riviera believes it's hedged? (Blocks UAT, not code start.)

**Q3. Status lifecycle & timing** — full `entryStatus`/`positionStatus` enums; what marks `hedged`; typical entry→execution lag; does a hedged entry always carry `hedgedRate`/`executionRate`; definitions of `counterValue`/`deltaResult`/`weightedAverageRate` (accounting + order-card display). **Request a sample `GET entries` response for an EXECUTED entry** — until then, per-entry `hedgedRate` is schema-present but semantically unproven (only ever observed null).

**Q4. Two-leg netting flow — written confirmation + edge cases** (Marin's email now reflects "SO and PO details will be sent automatically"). Confirm: (a) both legs carry the SO's expected-payment value date even when PO payment dates differ? (b) multiple PO legs net against one SO leg per bucket? (c) **leg sequencing/atomicity** — if the gross Sell lands before its Buy pair, does the unpaired gross leg (≈10× the margin) cross the execution threshold and hedge gross? Pairing window, or must we co-submit client-side? (d) PO added/changed after SO — delta on the Buy leg? (e) **non-USD PO legs** (EUR supplier invoices are common) — netting only works USD/USD; excluding them means hedging the gross receivable, not the margin! (f) negative-margin deals (net = Buy — hedge or skip?) (g) Buy-leg lifecycle closes on customer payment? (h) `entryRate` per leg (SO vs PO booking rates differ; 10% band applies per entry).

**Q5. Hedge percent ramp (10–20% → 100%) — decision ask with proposal.** Do we scale amounts client-side, or is percent a Kantox-side account setting? If client-side: scale BOTH legs or the net? Proposal: 10% start, client-side scaling of both legs, monthly step-up review with Pierre.

**Q6. Value-date rounding — decision ask with proposal.** Proposal: **weekly, round up to the next Monday** (verified: Kantox already rolls weekend dates to the next business day internally, so Friday-submission → Monday bucket is natural). Confirm cadence + client-side rounding.

**Q7. Amount basis — decision ask with proposal.** Floating quantities: propose **exact-at-invoice with delta amendments**, minimum-quantity basis for pre-invoice pushes, starting at 10–20% ratio. Confirm Pierre's pick.

**Q8. entryRef scheme sign-off** — `{orderId}` / `{orderId}#A{n}` / `{orderId}#C{n}` / `{orderId}#R{n}` verified working in preprod (`TEST-A` + `TEST-A#C1` netted to 0.0). Confirm Kantox reconciles cancel↔original purely by value-date bucket + amount (not ref convention), so our scheme is compliant.

### 🟠 Strongly wanted (email-able if time runs out)

**Q9. Reconciliation & ops** — daily Fueld↔Kantox reconciliation: `GET entries` pagination/filtering at volume (~hundreds/month), historical export by date/status, EOD statements for finance sign-off, async rejection (accepted → later rejected by BNPP — does status regress?), drift handling for Kantox-side manual entries, error catalog (429/Retry-After, mid-batch token expiry).
**Q10. FDDR ~$200k/day** — hard cap (reject/queue) or guideline? Bucketed on value date or entry date? Warn-and-proceed design stands until answered (go-live policy, not code).
**Q11. Rate limits** — 4 instances ⇒ ~4 logins/10-min window; `entries`+`positions` poll per tenant every 15 min. Within documented limits?
**Q12. Credential lifecycle** — prod password via SMS: rotation, re-delivery if phone holder changes, lockout policy (4 instances retrying with a stale password could lock the API user).
**Q13. Roll cost policy for past-due value dates** (Piotr) — pairs with Q0: if past-date closes are rejected, roll-vs-cancel-and-reissue is Pierre's go-live policy pick.

### 🟡 Email / later

`notes` max length; **sandbox wipe of our 22 `PROBE-*`/`TEST-*` entries before UAT** (all positions currently net 0.00); prod cutover logistics (generic API mailbox + SMS phone — Riviera to provide); UAT sign-off checklist; support/incident channel + maintenance windows; confirm notes-field PII expectations (client names flow into `notes`); we will redact tokens from our activity log.
## 3. What we need from Riviera/Pierre (parallel track)

1. **Value-date rounding choice** (Q6 input)
2. **Amount basis choice** (Q7 input)
3. **Starting hedge percent** (Q5 input — 10%? 20%?)
4. **Generic API mailbox + SMS-capable phone** for prod credentials
5. **COD/PREPAY deals** — hedge or exclude (we can configure per-tenant either way; default: include with buffer)

## 4. Deployment topology (decided, Patrick 17/09 — confirmed)

- Kantox settings are **per-tenant** (`TenantSettings.kantoxSettings`, default disabled) — already in the plan.
- **Sandbox/preprod credentials live ONLY on the staging instance** (`staging.fueld.app` tenant). No other tenant ever points at `kantox-preprod.com`.
- **Production credentials go to the Riviera Marine instance** (`riviera-marine.fueld.app`) when issued — flip is a settings change (base URL + companyRef + API credentials), zero code change.
- Implementation can start immediately behind the tenant flag; the staging tenant is the only one that can send entries (to the Kantox sandbox) until the Riviera prod cutover.
- Never mix: a tenant is either sandbox (`kantox-preprod.com`) or production (`kantox.com/api`) — the base URL is part of the tenant's settings, so an accidental cross-pointing is impossible by construction.

## 5. What we can build NOW (post-panel correction)

**Start today (genuinely unblocked):**
1. **API client** — login (`login` field!), token cache, `X_AUTH_TOKEN`, snake_case payloads, structured-error envelope (`{"status":"error","reason":N,"errorDetails":…}` — validation errors arrive as HTTP 200/403 + envelope; **never trust status codes, check the envelope**). Spec-in: duplicate-ref 403 must map to SENT + reconcile via GET entries (not FAILED); parse `DD/MM/YYYY` response dates; rejected-entry ref reuse (V15) vs timeout-unknown new-ref.
2. **DB schema — WITH the panel-required fix now**: two-leg netting means up to 2+ INITIAL rows per order (1 SO + N PO legs), so the planned partial unique index `(tenant_id, order_id) WHERE kind='INITIAL'` is wrong under both Q4 outcomes. Add a leg discriminator (`orderItemId`/leg seq) to the index and extend the entryRef scheme (`{orderId}#S` / `{orderId}#P{n}` fallback if Q8 sign-off demands it). Also add columns: `counter_currency`, `kantoxPositionRef`, `amountAfterCancellations` mirror, `executionRate`, `weightedAverageRate`.
3. **Settings/credentials wiring** — `TenantSettings.kantoxSettings` + `integrationCredentials` (apiPassword), admin UI block, feature flag checked on read side too.
4. **State-machine skeleton** — PENDING_SEND→SENDING→SENT→(FAILED/retry) verified live for the send path. **HEDGED/CLOSED transitions + all post-execution behavior are provisional** (never observed) — design so status mapping is one function.
5. **Sync-loop skeleton** — poll `entries` + `positions` per enabled tenant; tolerate ~1–2 min batch lag; client-side filter by our entryRefs (pending Q9 pagination answer for volume).
6. **Order-card shell** — behind tenant flag; show net-position rate with "indicative" label until an executed entry proves per-entry `hedgedRate` population (panel: don't promise per-entry rates in UI copy yet).

**HOLD until answered (panel + plan gate):**
- **Amount/leg payload builders, entryRef generation semantics, close-on-payment logic** — blocked on Q0/Q0b (close semantics), Q4 (leg shape/atomicity), Q5/Q7 (percent + basis). The plan's own stop-gate ("do not implement rules 1–4 until two-leg confirmed in writing") still stands.
- **Event hooks**: plumbing (claim/CAS/retry) buildable; the hooks table needs more rows regardless of Q4: close triggers beyond USD `customerPayments` (EUR payment, offset, credit note, write-off), refund/credit-note re-open path (positive delta), overpayment cap on negative deltas, installment terms (single valueDate per leg breaks), COD/PREPAY payment arriving before execution, reconciliation/drift for Kantox-side manual entries.

Remaining before code-complete: Q0/Q0b (close semantics), Q2 (trigger rules), Q4 (two-leg written confirm), Q5/Q6/Q7 (business decisions), prod credentials.
