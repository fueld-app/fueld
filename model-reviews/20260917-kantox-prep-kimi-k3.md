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