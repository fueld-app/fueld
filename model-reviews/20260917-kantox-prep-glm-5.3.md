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