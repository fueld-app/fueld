**Verdict up front: NO-GO** — one MUST, and it is Change A's load-bearing decision. Change B is sound; everything else is SHOULD-level.

---

## MUST

**MUST-1 — `company.service.ts :: getSupplierPaymentLedger`: `outstanding = cost − paid − received` is neither the payable nor the net position. It is wrong at the terminal state of every commission invoice.**

The code: `outstanding: (t.outstanding - totalReceived).toFixed(2)`. The docblock claims the figure is "the difference" between "we owe this supplier cost-minus-paid for fuel" and "they owe us the receipts." But what they owe us is the commission **balance** K − R (K = non-void `supplier_invoices.amount`); the code subtracts R — the *settlement* of that receivable — while K appears nowhere in the ledger. Using this PR's own test numbers (Appendix G: 100 MT × cost 100 → C = 10,000; 100 × 10 commission → K = 1,000; receipt 250):

- **Fully paid invoice (R = K = 1,000 — the end state of every invoice):** payable reading says 10,000; net-position reading (C−P)−(K−R) also says 10,000. The code says **9,000**. The fuel payable is understated by the entire commission; an operator settling "the position" underpays the supplier by 1,000.
- **Partial (R = 250):** payable = 10,000, true net = 9,250 (they still owe 750), code = 9,750. Error = K − 2R, sign-flipping at R = K/2 — the signature of a quantity that is nothing in particular.
- **Prepayment branch:** `if (entry.totalCost === 0 && entry.totalPaid > 0) entry.outstanding = -entry.totalPaid;` then the map yields −P − R. A 250 receipt against a 100 prepayment shows "they owe us 350" when the truth is 100: their remittance *increases* the apparent amount they owe us. That is the direction confusion `supplier_receipts` was split out to prevent, surviving at the position level. Same defect in the receipt-only branch: `outstanding: (-Number(r.totalReceived)).toFixed(2)`.

Fix — pick one:
- (a) Don't net: `outstanding` stays C − P; receipts are reported-only (`totalReceived`, `unappliedReceipts`). My preferred conservative default for a *payments* ledger.
- (b) Net the receivable balance: aggregate non-void `supplierInvoices.amount` per currency (the join already exists in `receivedByCurrency`) and compute (C − P) − (K − R).

Both keep the VOID handling coherent (K and R exclude VOID symmetrically; unapplied stays visible). The e2e test locks in the wrong invariant — `expect(Number(totalAfter.outstanding)).toBe(Number(totalBefore.outstanding) - 250);` — and must change with the fix. To be explicit: keeping receipts out of `totalPaid` is **right** and well-tested; the MUST is only the netting.

## SHOULD

1. **`unappliedReceipts` has no exit state** (`company.service.ts`). The docblock says "held, pending reissue or refund" — but there is no reapply/refund/move mechanism. After void → reissue, the only way to apply the cash is recording a *new* receipt on the reissued invoice; the void-attached row is never cleared, so the same cash then appears in both `totalReceived` and `unappliedReceipts`, and the figure can only grow. Add a re-parent/apply action or document the manual reconciliation.
2. **No send↔invoice linkage** (`mail.service.ts :: logEmail`). `orderId: options.orderId ?? null` and no supplier-invoice id anywhere in `email_log` — you cannot show "sent" on the invoice or find never-sent payables, which is the loss mode the route exists to prevent ("a payable silently unsent is a loss"). Add `supplier_invoice_id` to `email_log`, or `sentAt`/`sentTo` on `supplier_invoices`.
3. **`err.message` on 500** (`supplier-invoices.controller.ts :: /:id/send`): `message: err instanceof Error ? err.message : 'Failed to send invoice'`. Transporter errors can echo SMTP host/user/envelope internals. Whitelist the known actionable text (match `/SMTP is not configured/`) and genericize the rest; `console.error` already carries detail. Also: `renderSupplierInvoicePdf` is outside the try/catch, so render failures produce a raw 500 while send failures produce JSON — unify.
4. **Test gaps:** no byte-equality assertion between the sent attachment and `GET /supplier-invoices/:id/pdf` (the "cannot drift" rationale is currently untested); the receipt-only-currency branch is untested; no `dateFrom`/`dateTo` test for receipts.
5. **Recipient determinism** (`/:id/send`): `? [preferred[0]!.email]` after sorting only by `isPrimary`, with no `ORDER BY` on the `companyEmails` query — which of several equally-ranked addresses wins a payable is unspecified. Add a stable secondary sort. (Sending to only the top address is deliberate per the comment; fine.)
6. **`ne(supplierInvoices.status, 'VOID')`**: if `status` is nullable, NULL rows drop out of *both* `totalReceived` and `unappliedReceipts` — money vanishing, the exact bug class this change fixes. Verify NOT NULL or use `or(isNull(...), ne(...))`.
7. **Appendix E** adds `SUPPLIER_INVOICE: 'Supplier Invoice'` to the order-scoped documents controller's map — verify that route's accepted `documentType` enum excludes it, else an operator can send a customer a "Supplier Invoice"-labeled order email. Likewise, only VOID is blocked from `/send`; if a DRAFT-ish status exists, decide its sendability.
8. Minor: `periodLabel` prints raw ISO dates in the subject — use tenant `dateFormat`. Filtered views still mix all-time `totalCost` with windowed flows (pre-existing for `paid`; receipts inherit it). Stale docblock in `supplier-invoice-pdf.ts` ("and the email that carries it" — no email code in that file).

## Answers to the five scrutiny questions

1. Receipts should be reported without moving `outstanding`, or the net must use K − R. Netting per se is defensible for a position figure; netting the *settlement* while omitting the *claim* is not (MUST-1).
2. `unappliedReceipts` closes the visibility hole, and leaving it outside the date filters is correct (stock, not flow). It opens the stale/double-visibility issue (SHOULD 1).
3. `/send` isolation is sound: `getSupplierInvoice(params.id, auth.tenantId)`, a cross-tenant 404 test, recipient keyed from the frozen `invoice.supplierId`, VOID blocked, feature flag first. The `companyEmails` query lacks an explicit tenant predicate but is keyed by a tenant-bound id — acceptable, and the comment documents it.
4. The extraction is semantics-preserving. I compared field-by-field: tenant name, company by id+tenant, dateFormat/branding/accent, footer args, `invoice.bankDetails`, filename sanitization — identical; the only delta is dropping the dead `settings` select. ✓
5. No existing caller can regress: `?? ''` only substitutes where the old code printed "undefined"; conditional rows only omit when absent; `orderId ?? null` only nulls for the new caller; the PORT_DOCUMENTATION early return is preserved. Residual (accepted tradeoff, noted): a future order-scoped caller omitting fields gets silent punctuation subjects.

## Disagreements

- **The netting (MUST-1).** The docblock's own words — "the difference" — describe option (b); the code does not compute the difference. I would also accept (a) outright.
- **`err.message` on 500.** The precedent argument is fair, but a whitelist is cheap and the leak is real. Not blocking.

**Verdict: NO-GO** — solely on MUST-1: a payable figure that understates by the full commission for every fully-settled supplier, and inverts direction in the prepayment branch, is a real-loss bug, not a labeling choice. It is one formula + one test away from approval; Change B is in mergeable shape with the SHOULDs.