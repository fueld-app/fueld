# Review

**Verdict: APPROVE-WITH-CONDITIONS** — the design direction on both gaps is right (table-level direction beats remembered filters; previewing skips beats post-hoc surprises), but three MUSTs in the receipt lifecycle must land before receipts go live. Production has zero rows, so fixing semantics now is free.

---

## MUST

**MUST-1 — `createSupplierReceipt` is a non-serialized check-then-act; a receipt can land permanently on a VOID invoice.**
`supplier-invoice-ledger.ts :: createSupplierReceipt` does SELECT invoice → (second SELECT in `assertReceiptCurrencyMatchesInvoice`) → INSERT → `recomputeSupplierInvoiceReceived`, each a separate statement, no transaction. If the void path completes between the status read and the INSERT, the receipt survives forever: void already ran its delete-by-invoice, `deriveSupplierInvoiceStatus` keeps status `VOID`, and `amount_received` silently shows money settled against a dead claim. Nothing ever cleans it up. The concurrent-receipt case is milder (last-writer stale `amount_received` self-heals on next read — acceptable only because recomputes are full re-sums, not deltas) but should not be relied on. Fix: single transaction wrapping validate+insert+recompute, taking `SELECT … FOR UPDATE` on the invoice row; the void path takes the same lock. Same treatment for `deleteSupplierReceipt` (delete + recompute in one tx).

**MUST-2 — Void deletes receipts: destruction of money-received history.**
The design statement and `deleteSupplierReceipt` both hard-delete rows recording actual cash movement, with no audit trail. Void-and-reissue loses the fact the supplier paid; the reissued invoice starts at 0 while the money is real, and there is no transfer path — the operator re-keys or fabricates. Refund case is worse: the correct record is "received $X against SINV-n, refunded", not "nothing ever happened". The NOT NULL FK does not require deletion — `ON DELETE CASCADE` only fires on physical row delete, and `deriveSupplierInvoiceStatus` already keeps a VOID invoice's status VOID regardless of amounts. Fix: retain receipts on void and surface them as "received against now-VOID invoice SINV-n"; add a refund/transfer semantic (method or reversal row) for the reissue flow. At absolute minimum, write an audit/ledger entry before any delete of a money record.

**MUST-3 — No tenant scoping in the ledger primitives.**
`createSupplierReceipt`, `deleteSupplierReceipt`, and `recomputeSupplierInvoiceReceived` filter by `eq(supplierInvoices.id, …)` / receipt id only and take no `tenantId`. If the route layer (not in payload) doesn't enforce tenancy, an operator holding a foreign invoice UUID records cash against another tenant's ledger — the receipt correctly lands in the victim's tenant (`tenantId` copied from the invoice), silently altering their books. These are money writes; don't trust callers. Pass `tenantId` in and AND it into every WHERE, belt-and-braces regardless of what routes do.

---

## SHOULD

- **S-1 — `0136_supplier_receipts.sql`: no `CHECK (amount > 0)`.** The app enforces it, but your own argument ("direction belongs in the table, not in a filter") extends here. Also now, while the table is empty, decide the reversal/refund representation — today the only negative is deletion (see MUST-2).
- **S-2 — `createSupplierReceipt`: no overpayment guard.** A receipt exceeding the outstanding balance silently flips the invoice to PAID with the over-collection buried in `amount_received`. At minimum flag it in the response/UI; consider a cap. One mistyped zero is all it takes.
- **S-3 — `createSupplierReceipt` + `assertReceiptCurrencyMatchesInvoice`: the invoice is fetched twice.** The second fetch is redundant (you already have `currency`) and widens the TOCTOU window. Pass the fetched currency in; keep the exported assert for route-level pre-validation. Also normalize currency before insert — a lowercase `'usd'` receipt sums correctly (upper-on-both in the SUM) but displays wrong.
- **S-4 — `listSuppliersWithSupplierCommission` rebuilds the full report while the report page also fetches the report.** 2× compute per page load, and the two payloads can contradict each other on the same screen. Merge: one endpoint returning report + preview, or derive candidates from the report DTO. Note this doesn't remove preview/execute drift — the POST rebuilds the report anyway — that's inherent and unchanged.
- **S-5 — `willSkip` carries order numbers but no amounts.** The amber block can't say how much isn't being billed; add per-order commission (plus currency for the FX bucket). And confirm nothing downstream — customer-side totals, the receivable pipeline — derives from the multi-supplier exclusion; if it does, customer commission is silently understated and this preview is the only warning. Pre-existing, but you now own the visibility story for it.
- **S-6 — Receipts accepted against DRAFT invoices.** `deriveSupplierInvoiceStatus` returns DRAFT early, so a fully-receipted draft shows DRAFT + full `amount_received` until issued. Works after issue, but decide deliberately: reject until SENT, or accept and document.
- **S-7 — `receivedAt` unvalidated.** `new Date(input.receivedAt)` on a bad string yields Invalid Date and a mid-flow DB/driver error. Validate in the route schema (not shown) or here.
- **S-8 — `0136`: unindexed FKs `order_supplier_id` / `order_id` (SET NULL).** Deleting a leg or order seq-scans `supplier_receipts`. Minor; add indexes if those deletes are ever bulk.
- **S-9 — `updated_at` on receipts is never maintained** (no trigger visible, no update path). Dead column today; harmless, but keep or drop deliberately.
- **S-10 — Read-that-writes is contained but note the edges.** `recomputeSupplierInvoiceReceived` on every read is deliberate and the write is guarded, which is fine — but a GET/PDF route takes a row lock when drift is detected and will fail outright on a read replica. Verify none of the three former filter-readers (`listSupplierPayments`, `updateOrderSupplierAmountPaid`, `getSupplierPaymentLedger`) ever joins `supplier_receipts`; the `order_supplier_id`-for-context column plus the warning comment is the right shape, keep it that way.

---

## Answers to your challenges

1. **Dropping the column is right.** Any reader summation of `supplier_payments` no longer needs to remember a filter. The only thing lost is expressing netting (commission settled by deducting from a fuel payable) — but that's representable as a receipt with `method='NETTED'` + note naming the payment, without touching the outbound ledger. Document that convention so operators don't improvise rows in `supplier_payments`. No disagreement.
2. **Void must not delete receipts** — MUST-2. The FK/NOT NULL doesn't compel it; keeping them is fully compatible with the status derivation.
3. **Real, not theoretical** — MUST-1. It's one interleaving away and, unlike the transient stale-sum case, the void-race outcome never self-heals.
4. **Acceptable short-term, merge soon** — S-4. The same-page disagreement is avoidable; the preview/execute disagreement isn't (and wasn't introduced here).
5. **Not enough** — S-5. Surface amounts; verify the customer-side pipeline doesn't inherit the exclusion.
6. **Audited:** no new path counts a receipt as a payment; the three outbound readers are back to unconditional and correctly so. The remaining coupling (context-only `order_supplier_id`) is flagged in the schema comment. The one deliberate read-that-writes is S-10.
7. **Covered above:** CHECK constraint (S-1), overpayment (S-2), DRAFT receipts (S-6), date validation (S-7), refund representation (MUST-2/S-1). Zero-amount invoices as PAID-by-definition and the half-cent epsilon are sound given whole-cent amounts.

## Disagreements

None with the column drop or the candidates shape. I disagree with the receipt lifecycle as specified (void-deletes / hard-delete) — MUST-2 — and with treating the void-vs-receipt race as ignorable — MUST-1. Land MUST-1, MUST-2, MUST-3; the SHOULDs can follow but S-5 (amounts in `willSkip`) is the one I'd hold gap 2 to, since an unquantified skip list only half-fixes "missing invoice looks like nothing owed".
