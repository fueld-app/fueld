# Panel Review — Credit Note Support for Fueld

## Verdicts per phase

| Phase | Verdict | Key conditions |
|---|---|---|
| **Phase 1 — quick wins** | **Approve with changes** | Filter on an explicit marker, not inferred "no sell price". Drop the economics-panel rework from Phase 1 (do it once, in Phase 2). Apply to *all* customer-facing outputs, not just CONFIRMATION. |
| **Phase 2 — supplier credits as objects** | **Approve with changes** | Add optional line-level reference, define margin/settlement semantics explicitly, and put **data migration of existing fake lines in scope** — currently missing and non-optional. |
| **Phase 3 — customer credit notes + QBO** | **Approve with changes (defer)** | Sound design, wrong time. No reported customer-credit case exists; QBO credit mapping is significantly underestimated. Defer both; revisit on first real demand. |

---

## Concerns ranked by severity

**High**

1. **No remediation plan for existing corrupted data.** Allan's 480 MT negative line is a money adjustment masquerading as a physical quantity. It has polluted delivered-quantity totals, per-MT economics, margin math (his "my price is higher than my customer's" is a symptom of quantity/amount blending), and possibly tax and any downstream sync. Phase 1 hides the symptom; nothing in the plan repairs the data. Phase 2 must ship with an audited migration script per tenant DB, and a cross-tenant scan — he won't be the only one who's done this.

2. **Phase 1 filters on an inferred condition.** "Skip lines with no sell price" means a *legitimate* line missing its sell price due to data-entry error silently vanishes from a customer document — that's silent underbilling. NULL must also not be conflated with 0 (a genuine free-of-charge line should still render). Fix: filter on explicit `product_type = CREDIT_NOTE` or a dedicated `internal` flag, add save-time validation requiring sell price on customer-visible lines, and raise an internal warning for lines violating the invariant rather than skipping silently.

3. **Margin and settlement semantics are undefined.** (a) Should an *expected* credit improve net margin before money arrives? (b) Does a *received* credit reduce the payable on `order_suppliers.settlement`, or is netting manual? (c) What is commission calculated on — gross or net? Decide now: recommendation is net margin shows **received credits only**, expected credits shown separately as info; settlement netting stays manual; commission base documented explicitly. Without this you get double-counting between the adjustments block and settlement, and trader-comp disputes.

**Medium**

4. **Phase 3's QBO mapping is a bigger animal than "optional later" implies.** Vendor mapping doesn't exist yet (only Customer sync was built). Credit lines need item + tax-code mapping consistent with the original invoice or VAT filings skew. Multicurrency handling, CreditMemo/VendorCredit *application* semantics (create-vs-apply; never auto-apply silently — partial payments and overpayments turn it into refund workflows), sync lifecycle (only sync final-status credits), and void propagation are all non-trivial. Keep deferred — but make sure Phase 2's schema doesn't paint you into a corner (store `reason` and an optional line reference now).

5. **Two different "CN numbers" are being conflated.** Phase 2's number is *supplier-issued* (external string, no sequence, at most unique-per-supplier — suppliers' numbering is outside your control). Phase 3's is your own legal document sequence. Name the fields distinctly or this will bite.

6. **Per-tenant operations.** Four isolated VPS/Postgres stacks: schema migrations, version drift, backups before money-object changes, and rollout ordering (Phase 1 code must run safely before Phase 2 schema lands). Needs an explicit migration runbook.

7. **Quantity contamination beyond the PDF.** Ensure the fake line never fed delivery documents, quantity dashboards, or per-MT unit economics — and that new credit objects carry **no quantity** (optional informational quantity at most, never summed).

**Low**

8. **No recurrence guardrail.** After migration, block new negative-price / CREDIT_NOTE product lines in the UI, and tell Allan to stop. Otherwise the hack's population grows.

9. **Naming/UX collision** with the existing customer credit *limits* feature — label this clearly as "Supplier credit notes." Add minimal audit fields (createdBy, timestamps, void-not-delete) since these are money objects.

---

## Cheaper alternative recommended

**Build: Phase 1 (PDF fix only, explicit marker) + Phase 2 (as amended, including migration script + validation guardrail). Defer Phase 3 entirely.**

- ~1.5 dev-days instead of ~2.5+, and no double-building the economics panel (Phase 1's "adjustments block" against legacy lines is thrown away a day later — fold it into Phase 2).
- Customer credit notes: until real demand exists, issue them directly in QBO (CreditMemos already exist there) or with a document template. For a 4-tenant shop, credit notes are exceptions, not volume.
- Explicitly **reject the cheapest option** ("just fix the PDF, keep negative lines"): it entrenches corrupted economics, quantities, and tax data.

---

## Answers to the numbered questions

**1. Phasing right?** Directionally yes (cosmetic → data model → documents). Restructure: add an implicit **Phase 0** — cross-tenant data audit, migration plan, recurrence guardrail, and a message to Allan. Move legacy-line migration *into* Phase 2 as named scope. Fold the panel rework into Phase 2. Split Phase 3 into 3a (customer CN document) and 3b (QBO mapping), both deferred until demand.

**2. Leg vs order level, multiples, partial, allocation?** Supplier leg is correct — credits attach to a specific counterparty's settlement in a two-sided, multi-leg order. Yes to one-to-many credits per leg (short delivery + quality claim on one order is realistic). Keep credits **amount-based** — money is the truth; partial coverage (480 of 720 MT) is fine as an amount with optional reference quantity. Allocation: a single **nullable FK to an order line** covers the multi-grade case cheaply. Do *not* build a many-to-many allocation engine — a credit spanning lines just leaves the FK null with a note. Skip tax modelling on credits beyond an informational field; VAT lives in QBO.

**3. Currency mismatch?** Default the credit to the leg's invoice currency (supplier credits are almost always in invoice currency). Store amount + ISO currency + amount-in-order-currency with a **manually captured rate** prefilled from the order. No live FX feeds, no revaluation; realized FX gain/loss is QBO's job. Record the actual cash received at settlement if it differs.

**4. Margin split pitfalls?** Define formulas once, in one shared calculation path used by the panel *and* reports: gross = Σ sell − Σ product costs (commission/barging/fee lines stay in costs for both views); net = gross − Σ **received** supplier credits. Watch: expected credits inflating margin; double-counting with legacy lines during coexistence (migration must be atomic with the display switch); per-MT metrics using the true delivered quantity (720) as denominator; commission base explicitly defined before you change what "margin" shows; positive-stored amounts with display-level minus signs to avoid double-negative bugs.

**5. Phase 1 heuristic risks?** Real ones — see concern #2. Silent omission of a legitimately priced-intent line = underbilling. Mitigate: explicit marker, NULL ≠ 0, save-time validation, internal warning on invariant violation, and verify OFFER/PFI/INVOICE use consistent filtering so document types don't disagree.

**6. Numbering scope?** Internal customer credit notes: **tenant-wide sequential** (CN-YYYY-NNNN), assigned at issuance (not draft), void-instead-of-delete to keep sequences gapless for audit. Per-order numbering duplicates legal document numbers and breaks QBO DocNumber uniqueness — reject it. Map the number 1:1 to QBO `CreditMemo.DocNumber` (watch the 21-char limit). Supplier-issued CN numbers (Phase 2) are external strings — never sequenced, uniqueness not enforced globally.

**7. QBO traps?** (a) Vendor mapping must be built from scratch. (b) Item/tax-code mapping must mirror the original invoice or VAT reports skew — a generic credit item with the wrong tax code is a filing error. (c) Sync **creates** CreditMemo/VendorCredit; never auto-apply to invoices/bills — application is the accountant's call (partial payments and overpayments make auto-apply a refund workflow). (d) Sync only final-status credits — an "expected" credit in QBO is fake money in AR/AP. (e) One-way push Fueld→QBO, store QBO Id + SyncToken, idempotent retries, surfaced failure queue; two-way edit sync is a rabbit hole. (f) Multicurrency must be enabled and rates handled. All of this says: defer, but don't design Phase 2 in a way that blocks it.

**8. What to cut for 4 tenants?** QBO credit mapping (manual in QBO — volume is a handful per month), customer CN documents until first real case, the Phase 1 throwaway panel rework, allocation engine, auto-FX, attachments, approval workflows, any "claims lifecycle" ambitions, and per-tenant configurable reason lists. Keep: PDF fix, lean supplier-credit table, migration script, validation guardrail. Total ≈ 1.5 dev-days and Allan's USS JASON DUNHAM order becomes representable truthfully.