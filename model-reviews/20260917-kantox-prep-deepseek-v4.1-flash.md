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