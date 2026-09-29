# Review — supplier-invoice gaps round 3

The architecture call on Gap 1 (separate receipts table, drop the column) is right, and Gap 2's candidates endpoint is a real improvement. Three findings block merge; none are large.

## Findings

**MUST-1 — Tenancy is not enforced anywhere in `supplier-invoice-ledger.ts`.**
Every function in the module queries by bare ID with no `tenantId` predicate: `createSupplierReceipt` selects the invoice unscoped and then *derives* the tenant from the row it found; `deleteSupplierReceipt`, `assertReceiptCurrencyMatchesInvoice`, and `recomputeSupplierInvoiceReceived` are the same. The tenant decision is made by the DB row, not the caller. The module header explicitly advertises it as reusable primitives for multiple callers — that is exactly the shape where a future caller passes a user-supplied `invoiceId` and settles or deletes across tenants. Contrast `listSuppliersWithSupplierCommission`, which scopes by `tenantId` correctly. Fix: every function takes `tenantId` and predicates on it. (If routes currently pre-resolve in-tenant, that guarantee is invisible in this payload and non-structural.)

**MUST-2 — Void deleting receipts destroys the record of cash received. I disagree with this design choice.**
A receipt is a fact about money that arrived; voiding the claim doesn't un-receive it. Voided-then-reissued is the killer case: the reissued invoice shows `amount_received = 0` while the bank shows the credit — the operator re-duns a supplier who already paid, or re-records a receipt and now two rows describe one bank credit. The FK (NOT NULL + CASCADE) only forces deletion if the invoice *row* is deleted; since `deriveSupplierInvoiceStatus` and the create path both handle `status === 'VOID'`, the row persists — so deleting receipts on void is an application choice, not a constraint. Better: retain the receipts on the VOID row (retention is inert — derive short-circuits to VOID, `alreadyInvoiced` excludes VOID), and ensure every outstanding-balance computation excludes VOID invoices so retained receipts can't offset live debt. If deletion is kept at all, it must require explicit confirmation when receipts exist and leave an audit record. Same concern, smaller: `deleteSupplierReceipt` is a silent hard-delete of a money row — at minimum log it.

**MUST-3 — Receipt-vs-void race: check-then-act with no transaction or lock.**
`createSupplierReceipt` does SELECT (status check) → second SELECT (`assertReceiptCurrencyMatchesInvoice` re-fetches a row it already had) → INSERT → recompute, with no `db.transaction` and no `FOR UPDATE`. Interleave a void between the first SELECT and the INSERT: the receipt lands on a VOID invoice — the exact state the design says cannot exist ("a voided invoice is not a claim"). Receipt-vs-receipt races are benign (recompute re-derives from rows, so it converges), but receipt-vs-void is not. Fix: one transaction, `SELECT ... FOR UPDATE` on the invoice row, validate currency from the already-fetched row (which also removes the redundant second query). The void path needs the same lock.

**SHOULD-1 — Overpayment is silently accepted.** Nothing rejects `amount > outstanding` (question 7: confirmed). Invoice goes PAID with `amount_received > amount` and no signal, no credit representation, and nothing stops two concurrent partial receipts jointly exceeding the balance. Decide the policy: hard-reject with the outstanding figure in the error, or allow-with-warning and surface the overpaid delta.

**SHOULD-2 — Canonicalize money invariants in the DB.** Add `CHECK (amount > 0)` to `supplier_receipts` (the app guard covers only the app) and store currency normalized (uppercase) on insert. Note: the "guard and sum cannot disagree" claim is not quite true — the guard `.trim()`s, the sum's `upper()` does not, so a padded invoice currency passes the guard and is dropped from the sum. Storing canonical upper on both sides makes every future reader safe without remembering `upper()` — the same "one forgotten filter" class the migration is dedicated to killing.

**SHOULD-3 — `willSkip` should quantify the money, and the customer-side question needs an answer.** Order numbers without amounts let $200k of unbilled commission hide behind three ordinals. Add per-reason (ideally per-order) commission totals and an "excluded this period: $X" figure. Separately: if the multi-leg exclusion also suppresses these deals from customer-side commission totals, that is money billed to no one — the amber block is necessary but not sufficient; verify and file the follow-up.

**SHOULD-4 — Candidates implementation details.** Double report build per page load is acceptable for an advisory endpoint, but note the two calls can disagree with the report rendered beside them; simplest fix is passing the report's figures or merging skip info into the report response. Also: `new Map(existing.map(...))` collapses multiple non-VOID invoices per supplier to one number (store a count/list), and the query includes `DRAFT` in `alreadyInvoiced` — confirm drafts can't exist for a period or exclude them.

**SHOULD-5 — `recomputeSupplierInvoiceReceived` is a read path that writes.** The change-guard makes it idempotent, but a drifted invoice still makes a GET (including the PDF route) take a row lock and UPDATE a money row — breaking read-only assumptions (replicas, auditing). Prefer: all readers use `deriveSupplierInvoiceStatus` on the amounts and the write-back lives only in mutation paths. Minor: the `OVERDUE → 'SENT'` mapping in the stored status is dead code since `daysOverdue` is hardcoded 0.

## Answers to your seven

1. **Drop is right.** Outbound payments have no legitimate reference to a supplier invoice; the only conceivable future need (outbound settlement/refund of an invoice) isn't a feature and would deserve its own link. Crucially, DROP converts the bug class from silent (forgotten filter → wrong number) to loud (query on missing column → error).
2. **No — see MUST-2.** The FK doesn't force this; the app chose it, and it's the wrong choice for received cash.
3. **Real but narrow — see MUST-3.** Only the void race matters; receipt-vs-receipt converges because recompute is a full re-derive. Transaction + row lock, plus the redundant second SELECT should go.
4. **Acceptable as-is (SHOULD-4)** — figures are recomputed at issue time anyway, so candidates is advisory; don't let it block.
5. **Skip list alone understates it (SHOULD-3).** Amounts at stake, and verify the customer-side impact.
6. **Clean on direction.** No reader of `supplier_payments` shown touches receipts; `order_supplier_id`/`order_id` on receipts are context-only and commented as such. The one read-that-writes is the recompute (SHOULD-5) — guarded, but still a GET that can UPDATE.
7. **Rounding/epsilon are consistent; negative/zero guarded in the app only (SHOULD-2); overpayment unpoliced (SHOULD-1); VOID guarded but racy (MUST-3); settling a DRAFT invoice is allowed** — confirm that's intended.

## Not verifiable from this payload

Receipt routes (authz, validation, tenancy), the three reader reversions in `orders.service.ts`/`company.service.ts`, the void flow itself, `db/schema` parity with migration 0136, and the FE. Appendix A is not the full changed code — the tenancy and void findings may already be handled there, but I can only review what's shown.

## Verdict

**APPROVE-WITH-CONDITIONS** — merge blocked on MUST-1 (tenancy predicates), MUST-2 (stop destroying receipt history on void), MUST-3 (transaction + row lock on the receipt/void paths). All three are small, and "zero production invoices" is the cheap time to fix ledger invariants, not the excuse to defer them. SHOULDs may follow.
