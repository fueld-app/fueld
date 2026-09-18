# Panel digest — kantox meeting prep 20260917-kantox-prep

## kimi-k3

# Review — Kantox meeting prep (17 Sep 2026)

## (a) COMPLETENESS — missing blockers/questions

### Missing 🔴 asks (add today)

1. **Post-execution cancel/amend semantics — the biggest unverified assumption.** V7 proved negative-amount cancels only on *un-executed* positions (the doc itself admits nothing ever executed). The entire close-on-payment design (plan §6) assumes negative entries work after BNPP executes the hedge. Post-execution, a "cancel" is presumably an offsetting trade with real spread/P&L cost. Kickoff #7 says cancels happen 2–7 days after confirmation — if execution is intraday/EOD, *every real cancel is post-execution*. Ask: can a hedged entry be netted down, at what cost, and does `amountAfterCancellations` still attribute correctly?
2. **Leg-sequencing / atomicity risk (two-leg flow).** Q4 confirms netting but not timing. If the gross Sell (SO) leg lands before its Buy (PO) counterpart and execution is threshold-triggered, an unpaired gross leg (full receivable, ~10× the margin) can cross `amountToTriggerCo` and get hedged gross. Ask: is there a pairing/netting window, or must legs arrive together? Do we co-submit client-side?
3. **Preprod execution simulation.** Nothing executed in sandbox → HEDGED/CLOSED transitions, `hedgedRate`/`executionRate` population, and post-execution cancels are all unverifiable. Ask Kantox to lower the trigger or force-execute a test bucket before UAT. Otherwise go-live is the first end-to-end test.
4. **Cancel↔original attribution (upgrade Q11 to 🔴).** V11 shows per-entry `amountAfterCancellations`, but cancels are position-level nets under a *different* entryRef. If attribution works via the 1-char ref convention, plan rule 3's `{orderId}#C{n}` scheme (3-char suffix) is non-compliant — this freezes the entryRef scheme, so it blocks code.

### Missing 🟠 asks

5. **Position end-of-life.** Q10 stops at `closed`. What happens at value_date to (i) an executed position (auto-settlement? any action required of us?) and (ii) an *un-executed sub-threshold bucket* — expires unhedged while Riviera believes it's hedged? Make (ii) explicit in Q2.
6. **Roll cost/policy — upgrade Q17 from 🟡.** Late payment is the norm in bunker (hence the buffer); roll-vs-cancel-and-reissue is a go-live policy Pierre must pick (kickoff §C). Not a code blocker, but cheap to answer today.
7. **Field semantics:** `hedgedRate` vs `executionRate` vs `counterValue` vs `deltaResult` — definitions needed for accounting (EUR countervalue booking) and for which rate the order card shows. Fold into Q3/Q10.
8. **Credential lifecycle (kickoff A12 was dropped):** SMS-delivered prod password — rotation/expiry? Re-delivery if the phone holder leaves? Lockout after N failed logins (4 instances × retry-once with a stale password could lock the API user)? Fold into Q14/Q8.
9. **Partial execution** — can a bucket execute partially (5,000 of 7,200)? Affects close-delta math and status mapping. Fold into Q2.

### Missing internal design items (not Kantox questions, but the doc should list them)

10. **Close-trigger too narrow.** Plan closes hedges on USD `customerPayments` only (P1-5). The USD exposure is extinguished by *any* settlement: EUR-denominated payment, receivable/payable offset, credit note, write-off. Refund/credit-note post-close needs a re-open path (positive delta). Add to the hooks table before "event hooks" is called buildable.
11. **Duplicate-ref 403 = success.** With V6 dedup confirmed, a retry getting "already has an entry with the same external_ref" must map to SENT + reconcile via GET entries — not FAILED, or the retry loop strands rows Kantox actually holds. Spec this in the client.
12. **Edge cases to confirm internally/with Pierre:** installment payment terms (single valueDate per leg breaks), overpayment (cap negative deltas at entry amount), COD/PREPAY payment arriving *before* the entry executes (close-delta fires on a non-existent hedge).

## (b) CORRECTNESS — over-confident conclusions

1. **§5.3 "state machine now verified against live behavior"** — over-confident. Verified: dedup, *pre-execution* cancels, deltas, 10% rejection. Unverified: everything post-execution. Mark the post-execution half provisional.
2. **§5.5 "per-entry `hedgedRate` IS available"** — the *field* exists (V11) but was only ever observed `null`. Whether Kantox populates it per-entry after a *netted* execution is unproven. Keep plan P1-4's nullable design + net-position fallback; don't promise per-entry rates in UI copy.
3. **Q10 "same entryRef — dedup says no"** — unsubstantiated. V6 tested dedup on *accepted* entries. A validation-*rejected* entry (10% rule) may never persist → ref may be reusable. Probe it pre-meeting (reject at 2.0, resend same ref at valid rate) instead of asserting.
4. **V9 "confirmed empirically"** — one-sided test (rate above spot only). Symmetric band and Buy-leg applicability untested. Cheap probes.
5. **⚠️ note "Nothing executed (correct behavior if so)"** — threshold is one of three explanations (EOD batch; preprod never executes; threshold). Don't assert cause in the meeting; Q2 is correctly open.
6. **Q8 "you use dynamic IPs, so no allowlist on our side — confirmed"** — ambiguous (whose IPs? Kantox never calls us, so inbound allowlisting is moot). Reword before the meeting.
7. **V8 "no minimum tenor"** — true for acceptance; a today-dated entry may behave differently at execution. Also note timezone (whose "today" — CET?) given Dubai submission times.
8. Nit: kickoff notes say checkpoint 16 Sep, prep doc says 17 Sep — align.

## (c) PRIORITIZATION — 6 hours out

Ten 🔴s won't land in one checkpoint. Re-tier by *blocks code* vs *blocks go-live* vs *email-able*:

**Must land in-meeting (blocks architecture/code):** Q4 (+ new leg-atomicity sub-question) · Q1 (+ API versioning/deprecation policy) · Q5 · new post-execution cancel question · ex-Q11 cancel-attribution rule · Q6/Q7 reframed as **decision asks with proposed defaults** (10% start, min-quantity basis, propose a rounding weekday) so Pierre signs off in-meeting rather than deliberating.

**Keep 🔴 but email-able if time runs out:** Q2 (blocks UAT, not code start), Q3 (buildable with observed enums), Q10. **Q9 → 🟠**: warn-and-proceed means FDDR blocks go-live policy, not implementation.

**Move up:** Q11 → 🔴 (see a4); Q17 → 🟠 (see a6).

**Convert to pre-meeting probes — don't spend meeting time on answerable-by-curl items** (you have sandbox access + 6 hours): rejected-entry ref reuse · symmetric 10% band · weekend/holiday value date (matters once weekly rounding lands on Good Friday) · entry submission during `recalculating_batch`.

**Demote:** Q13 (sandbox wipe) → email.

## (d) RISKS — "can build now" items that aren't actually unblocked

1. **"DB schema unchanged by any open question" is FALSE under two-leg netting.** The partial unique index `(tenant_id, order_id) WHERE kind='INITIAL'` assumes one INITIAL per order; two-leg has two — and kickoff #9 allows *multiple* PO legs per order, so even `(order, direction)` fails. Fix now (compatible with both Q4 outcomes): add a leg discriminator (`orderItemId` or `leg` seq) to the index and extend the entryRef scheme (`{orderId}#S` / `{orderId}#P{n}`). Otherwise you're migrating with live rows.
2. **"Event hooks" buildable** — plumbing (claim/CAS/retry) yes; payload builders no. Q4 decides 1-vs-2 entries, gross-vs-net, ref scheme; Q5/Q7 decide scaling/basis. The doc's footer contradicts §5: "Remaining before code-complete" omits Q4 — the structural one. Reword to "hook skeleton; payload builders blocked on Q4/Q5/Q7."
3. **State machine / order card** — per (b1)/(b2): post-execution transitions provisional; keep net-position fallback in UI.
4. **API client** — genuinely unblocked, but add the duplicate-403→SENT mapping (a11) and DD/MM/YYYY response parsing (Q12) to the spec first.
5. **Sync loop** — skeleton unblocked; reconciliation semantics undefined: handling of Kantox-side entries Fueld didn't create (manual UI entries by Riviera staff?) and drift between local `cancelledAmountUsd` and remote `amountAfterCancellations`. Define before calling reconciliation done.

## (e) VERDICT — READY-WITH-ADDITIONS

The probe round was high-value: auth, payload shape, dedup, pre-execution cancels, per-entry GET, and value-date-bucket netting are now evidence-based, and the tenant-flag topology allows safe parallel development. **Start today:** API client, schema (with the leg-aware index fix), state-machine skeleton, hook plumbing, sync skeleton. **Do not start:** amount/leg payload builders, entryRef generation, close-on-payment logic — blocked on Q4/Q5/Q7 + the post-execution cancel answer.

Concrete additions required:
1. Add the four 🔴 questions (a1–a4).
2. Fix the INITIAL unique index for multi-leg **now** — don't wait for Q4.
3. Correct the three over-confident claims (b1–b3).
4. Run the four cheap probes pre-meeting (§c).
5. Re-tier: Q11→🔴, Q17→🟠, Q9→🟠, Q13→email.
6. Add internal design items: non-USD/offset/credit-note close triggers, refund re-open path, duplicate-403→SENT mapping, over-cancel cap, drift reconciliation.
7. Reframe Q5/Q6/Q7 as decision asks with proposed defaults for in-meeting sign-off.

---

## glm-5.3

# Review — Kantox meeting-prep doc (17 Sep 2026)

Solid probe work; the V-series is credible and well-evidenced. But the doc misses two findings that its **own probes imply**, and the "can build now" list contradicts the plan's own stop-gate. Both must be in today's agenda.

---

## (a) COMPLETENESS — missing blockers

**A1 (🔴 — top of agenda): Late-payment close semantics.** V8 (past value dates rejected) + V13 (cancels must repeat the original value date) together imply: when a customer pays **after** the value date — the normal case the 7-day buffer only mitigates, and acute for COD/PREPAY — the close entry carries a **past date and will be rejected**. The headline promise ("hedge closed when payment received") is unverified for late payments. Ask: are negative/cancel entries exempt from the past-date check? If not: roll (cost — merge Q17 here), leave-to-settle, or spot unwind? This determines the entire payment-close logic.

**A2 (🔴): Cancelling already-executed entries.** No probe entry ever executed (5,000 threshold), yet in production payment-close always happens **after** execution. Unverified: can a negative entry offset a `hedged` entry? Economics (unwind cost/spread)? Does `amountAfterCancellations` apply post-execution?

**A3 (🔴): Two-leg edge cases missing from Q4.** Add: (c) PO not yet confirmed when the SO is — send the Sell leg alone (temporary over-hedge) or wait? (d) PO added/changed later — delta on the Buy leg? (e) **non-USD PO legs** (EUR supplier invoices are common in bunker trading — netting only works USD/USD; excluding them means hedging the full receivable, not the margin); (f) negative-margin deals (net is a Buy — hedge or skip?); (g) Buy-leg lifecycle — closes on *customer* payment (kickoff #7) or supplier payment? (h) `entryRate` per leg — SO vs PO booking rates differ, 10% band applies per entry.

**A4 (🟠): Credit notes / refunds on hedged deals.** No event hook, no question. Post-close payment reversal → re-open? Credit note reducing the invoice → delta entry?

**A5 (🟠): Payment currency ≠ USD.** Close logic is USD-only; a EUR payment on a USD-invoiced hedged deal extinguishes the receivable but not the hedge. Need a policy (exclude from close + alert?).

**A6 (🟠): Timezone & calendar.** "Past date" evaluated in which timezone? Patrick is Dubai (UTC+4), Kantox CET — a "today" value date sent late-day Dubai is tomorrow CET; near-term COD deals will hit this. Also: weekly-rounded value dates falling on TARGET/BNPP holidays — rejected or rolled? Bundle into Q6.

**A7 (🟠): Reconciliation & async failure.** Nothing asked about: EOD/statement export for finance sign-off (audit); async rejection (entry accepted, later rejected by BNPP — does status regress?); recommended drift-detection between Fueld and Kantox. Q16 covers pagination only.

**A8 (🟡): Ops/security gaps.** Support/incident channel + maintenance windows; prod credential rotation (kickoff A12's "phone holder changes" was dropped from Q14); kickoff #21 wants "real production-like data" in preprod — confirm sandbox isolation given client names will flow into `notes`; ensure auth headers/tokens are excluded from the raw activity-log payloads.

---

## (b) CORRECTNESS — over-confident conclusions

**B1: "DB schema — unchanged by any open question" (§5.2) is wrong.** If Q4 confirms two legs (kickoff strongly indicates it; the plan's own gate says don't implement rules 1–4 until written confirmation), the schema breaks: the partial unique index `(tenant_id, order_id) WHERE kind='INITIAL'` allows **one** INITIAL per order — two legs need two. entryRef rule 3 (`INITIAL={orderId}`) also breaks (kickoff: "two refs per deal"), and `amountBasisUsd` semantics change (gross legs, not margin).

**B2: "Per-entry hedgedRate IS available" (V11/§5.5) — schema yes, semantics unverified.** Nothing ever executed; `hedgedRate`/`executionRate`/`deltaResult` were never seen populated. "Order card displays per-entry rates" is over-claimed until one executed entry is observed — ask Marin to show a GET-entries response for an executed entry.

**B3: "Both `/entry` and `/request_entry` accept payloads" (V3) — verify against the envelope.** The doc's own note says validation errors return as HTTP 200 + error envelope. If "accepted" was judged by status code, one or both may actually have rejected. Re-check stored probe responses before the meeting; also confirm both create real entries (request-queue vs direct-write).

**B4: V7's cancel mechanism contradicts kickoff #8.** Probe: same direction + negative amount. Kickoff: "negative on both sides; Kantox hedges a **Buy** to cancel the Sell." Both may work, but they may book differently (`amountAfterCancellations` vs an offsetting position) — matters for reconciliation. Confirm which is canonical.

**B5: Q11 understates a conflict with plan rule 3.** `{orderId}#C1` is **not** a "1-char diff" of `{orderId}`. If the convention is hard, Fueld's entire ref scheme is invalid. Probe-able in 30 min pre-meeting: send a cancel with a suffix-style ref and check netting (V13 suggests it's date-based, so it should pass — verify).

**B6: Minor over-reaches.** V8 "no minimum tenor" — creation only; same-day *execution* unverified (fold into Q2). V14 "1–2 min lag" — single-session observation. V6 — does dedup persist after an entry is fully cancelled (ref reuse on un-cancel)? Add to Q10.

---

## (c) PRIORITIZATION

Ten 🔴 items won't survive a checkpoint call, and the biggest risks aren't on the list.

**Move UP to 🔴:** A1 (late-payment close), A2 (cancel-of-executed), Q11 (ref convention — cheap, schema-determining), A3 folded into Q4.

**Move DOWN:** Q6/Q7 → mostly Pierre's decisions (already in §3); the Kantox-facing residue is a 30-second confirm → 🟠. Q8 → 🟠 quick-fire (volume is trivial; 4 logins/10-min is the only real ask).

**Merge:** Q3+Q10 → one lifecycle item (enums, hedgedRate population, 10% band, retry semantics, dedup persistence). Q17 → into A1 (roll cost is the fallback if past-date cancels are rejected). Q9 stays 🔴 but is Piotr-dependent — flag as may-defer; warn-and-proceed design is contingent on it.

**Suggested 45-min agenda:** (1) A1+A2 close/lifecycle [10'] — (2) Q4+A3 two-leg, written confirm [10'] — (3) Q2 trigger rules [10'] — (4) Q5 percent mechanics [5'] — (5) quick-fire: Q1, Q11, Q12, Q13, Q8 [5'] — (6) Q14 timeline + A7 [5']. Route Piotr items explicitly (Q2, Q9, roll cost).

**Pre-meeting probes (~30 min):** suffix-ref cancel netting (B5); envelope re-verification of V3/V7/V10 (B3); request an executed-entry sample from Marin (B2).

---

## (d) RISKS — "can build now" items not actually unblocked

| §5 item | Verdict | Why |
|---|---|---|
| 1 API client | ✅ mostly | Transport/auth/error envelope unblocked. **Payload assembly is not**: Q5 (client- vs Kantox-side percent) and Q4 (leg shape) change what we send. |
| 2 DB schema | ❌ | B1 — index, entryRef scheme, amountBasisUsd are all two-leg-dependent. Building the migration now risks destructive rework. |
| 3 State machine | ⚠️ | Send/dedup/cancel/delta verified; HEDGED/CLOSED transitions never observed. Also: a 10%-rejected INITIAL retried under a new ref **collides with the INITIAL unique index** — needs REISSUE-kind handling, not designed. |
| 4 Event hooks | ❌ | The plan's own gate: "do not implement rules 1–4 until two-leg confirmed in writing" — Q4 still open. PO-side events absent from the hook table; two negative entries per close (one per leg) not designed; credit notes (A4) missing. |
| 5 Order card UI | ⚠️ | Shell + net-position display fine; per-entry rate display over-claimed (B2). |
| 6 Sync loop | ✅ | Fine; client-side filter by our entryRefs pending Q16. |

---

## (e) VERDICT

**READY-WITH-ADDITIONS** — start the transport layer today; hold the data model and event logic.

**Start now:** API client (login/token cache/`X_AUTH_TOKEN`/error envelope), activity-log plumbing, settings + `integrationCredentials` wiring, sync skeleton, order-card shell behind the tenant flag.

**Hold until:** (1) Q4 written confirmation + A3 → then revise schema (leg-aware index, two refs/order) and event hooks; (2) A1/A2 answers → then payment-close logic; (3) Q2 + Q5 → amount/percent logic; (4) Q11 → ref scheme.

**Concrete additions before the meeting:** add A1, A2, A3, A4, A6, A7 to the question list; run the B3/B5 probes; correct §5.2/§5.4 (schema and hooks are **not** unblocked); restructure the agenda per (c). Do not let the call end without A1/A2 asked — without them, the core business promise ("hedge closed when the client payment is received") is unproven for the late-payment case, which is the case that matters.

---

## deepseek-v4.1-flash

# Review — Kantox meeting prep (17 Sep 2026)

## (a) COMPLETENESS — critical missing blockers/questions

**Must add to 🔴 before production-grade integration:**

- **Reconciliation / source of truth.** No end-to-end reconciliation process. Need daily/periodic Fueld ↔ Kantox reconciliation across `entries`/`positions`; break handling; orphan, duplicate, missing, stale entries; manual adjustments; audit evidence. Q10/Q16 are not enough. Ask for historical export/API by date/status, pagination/filtering, mapping `positionRef`/`reference`/`entryRef`, and meaning of `amountAfterCancellations`, `deltaResult`, `counterValue`. Also BNPP Cortex trade confirmations/execution reports, fees, roll costs.
- **Payment/close edge cases.** Partial payments: are multiple negative entries against the same original allowed? Refunds/credit notes/rebates/claims/discounts on hedged deals: how to reduce/close/reopen? Payment currency vs hedge currency: plan assumes USD-only payments — what if customer pays EUR/other, over/underpays, or one payment covers multiple orders/invoices? Non-payment/default/late payment after value date: can we cancel/roll after value date, and at what cost? Order cancellation/LOST after execution or partial delivery? Re-opened orders?
- **Two-leg netting details.** Q4 asks written confirmation, but missing: currency of PO leg. If PO is EUR, USD two-leg netting breaks. Need sign convention for cancels/deltas on the Buy leg. Need `entryRate`/`entryRatePair` per leg and rate convention (USD/EUR vs EUR/USD). Need hedge-percent mechanics under two-leg: scale both gross legs or net? Need value-date alignment for multiple POs/SOs/partial shipments.
- **Error/retry semantics.** Full error catalog. Duplicate-ref response: does 403 return existing entry? How to reconcile timeout after Kantox processed? 10% rejection retry: new ref? Rate-limit 429/Retry-After? Auth/token expiry mid-batch? Server errors? Partial success?
- **Timezone/holiday/cutoff.** `value_date`/`entry_date` timezone. Weekend/holiday acceptance. Execution cutoff. Weekly rounding cutoff. Maximum tenor.
- **Security/audit/ops.** Credential rotation, SMS phone holder changes, API mailbox ownership, token revocation, MFA/IP allowlisting on Kantox side, TLS/cert requirements. Redaction of tokens/PII in raw logs. Notes-field PII. Immutable audit of settings changes, retries, manual overrides. Monitoring/alerting/runbook. Kill switch. Prod rollback/hypercare.

**Must add to 🟠:**

- API versioning/deprecation, production SLA/support escalation, UAT sign-off criteria.
- Credit limits/collateral/margin calls; FDDR hard cap vs guideline and bucket basis.
- `amountToTriggerCo` exact semantics: per position/bucket/company? Minimum entry amount? Aggregation across orders? What happens below threshold?
- Rate convention and spot source for the 10% band; can we query spot to pre-validate?

## (b) CORRECTNESS — over-confident/wrong probe conclusions

- **V11:** “per-entry data IS available” is over-confident. `hedgedRate` is null until executed; no executed entry was tested. Per-entry execution rate may not be reliable after netting. Need executed-entry probe.
- **V13:** Netting per value-date bucket was proven for one cancel without `value_date`. Over-confident that value date is the only bucket dimension. Need confirm currency pair, company, direction, position status, and two-leg inclusion. Also, “all positions net 0.00” may hide a dateless bucket.
- **V6:** Dedupe ON is proven, but duplicate-error behavior is not fully known: does 403 return the existing entry? How to reconcile a timeout? Scope per company/environment?
- **V7:** Negative cancel accepted, but sign convention for two-leg Buy leg is not proven. 1-char-diff ref success does not prove the 1-char rule is required.
- **V8:** “Today accepted — no minimum forward tenor” is over-confident from one sample. Need max tenor, weekend/holiday behavior, account/pair-specific rules.
- **V9:** 10% rejection confirmed, but boundary not tested; rate convention/spot source unclear; band adjustability unclear. 1.20 vs 1.146 is not near the boundary.
- **V14:** 1–2 min batch lag from one observation. Need max lag/SLA; 15 min polling may be insufficient for near-real-time order card.
- **V1/V2/V4/V5:** Likely correct for probed endpoints, but production-stable path and all endpoints are not confirmed. GET request formats/filters were not probed.
- **V12:** Position list “no params” may not hold at volume; need pagination/filtering.

## (c) PRIORITIZATION — for a meeting 6 hours away

- **Q4 must be #1, not Q4.** Two-leg netting written confirmation blocks amount logic, direction, entryRef, cancel/delta, and hedge percent.
- **Q2 and Q5** are correctly 🔴 but should be grouped with Q4 as the “amount/execution model” blocker.
- **Q17 roll/past-due policy must move from 🟡 to 🔴/🟠.** Late payments are normal in bunker trading; buffer + cancel-and-reissue may not work after value date or may cost.
- **Q16 GET entries filtering/pagination must move from 🟡 to 🟠/🔴.** Reconciliation at hundreds/month is not possible without it.
- **Q12 date format should include timezone and move to 🟠/🔴.** Wrong date/timezone can silently mis-net.
- **Q14 prod cutover** should include credential rotation/SMS holder changes; keep 🟠 for the meeting but add to prod checklist.
- **Q13/Q15** can stay 🟡.

## (d) RISKS — “can build now” is not actually unblocked

- **“Everything except final amount formula constants” is overstated.** If two-leg netting is unconfirmed, amount logic is a different module (leg extraction vs margin computation). Event hooks and state machine depend on Q4/Q5/Q7.
- **DB schema is NOT unchanged.** Two-leg needs `leg` (SO/PO), `counterCurrency`, `entryRate`, `entryRatePair`, `kantoxPositionRef`, `amountAfterCancellations`, `deltaResult`, `counterValue`, possibly `executionRate`. Current schema lacks these.
- **Entry lifecycle state machine:** two-leg cancel/delta sign, partial cancels, execution/close semantics are not verified.
- **Event hooks:** payment → close delta assumes USD-only payments and simple partials. Refunds/credit notes, non-USD payments, allocation, overpayment are not handled.
- **Order card UI:** per-entry `hedgedRate` is not proven for executed/netting cases; may need net-position fallback.
- **Sync loop:** pagination/filtering, rate limits, stale reads, and reconciliation breaks are not solved. Skeleton only.
- **“Value-date rounding is one config knob”** — rounding affects netting bucket and cancel/delta matching; must be consistent across all related entries.

## (e) VERDICT

**NOT-READY** for production-grade integration start.  
**READY-WITH-ADDITIONS** only for non-blocked scaffolding: API client skeleton, DB migration draft, feature flag, UI shell — behind tenant flag.

**Concrete additions needed before starting core integration:**

1. Get written confirmation of two-leg netting: leg currency, value-date alignment, sign convention for cancels/deltas, `entryRate`/`entryRatePair` per leg, hedge-percent mechanics.
2. Add missing 🔴 blockers: reconciliation/source of truth, payment currency/refunds/credit notes/partial payments, error catalog/retry semantics, timezone/holiday/cutoff, credential rotation/security, monitoring/rollback.
3. Move Q17, Q16, Q12/timezone up.
4. Correct over-confident probe conclusions: V11 per-entry rates, V13 netting granularity, V8 no min tenor, V9 10% boundary, V14 batch lag.
5. Update “can build now”: schema needs leg/rate/position fields; amount logic is not unblocked; event hooks depend on payment edge cases.

---

