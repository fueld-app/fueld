# Review — Supplier ledger receipts (A) + supplier invoice email (B)

## Verdict (up front)

**APPROVE-WITH-CONDITIONS.** Change B is approvable as-is: the extraction is faithful, tenant isolation holds, void is blocked, tests cover the load-bearing paths. Change A's *design* is sound and its invariants are tested, but **the implementation hunk is missing from the payload** (Appendix A is an empty code block), so I cannot verify the code that scrutiny items 1–2 actually ask about. Approval of A is conditional on that hunk.

---

## MUST

**MUST-1 — Appendix A is empty; the Change A implementation is unreviewable.**
The payload claims "the full source of every changed hunk (appendices)", but `Appendix A — company.service.ts (getSupplierPaymentLedger, new section)` contains nothing. Everything I'm told to scrutinise hardest lives in that function and is unverifiable:

- the VOID filter mechanism (live join on `supplier_invoices.status` at read time vs. a denormalised flag — these diverge on void→reissue sequences);
- the claim "A receipt in a currency with no fuel cost at all is still emitted, or the money would vanish from the page" — no code, **and no test** (see SHOULD-2);
- `receivedCount` computation;
- tenant scoping of the receipts join (via `supplier_invoices` → tenant, or direct on `supplier_receipts.counterpartyId`);
- negative `outstanding` (receipt > fuel cost) and any downstream consumer of `outstanding` (ageing, payment suggestions) whose behaviour silently changes.

Appendix F gives behavioural evidence the happy paths work, but not the edges. **Condition of approval:** supply the `getSupplierPaymentLedger` diff and confirm the four points above.

## SHOULD

**SHOULD-1 — Void-excluded receipts become invisible cash with no re-link path (scrutiny #2).**
The exclusion is the *right* call — counting the old receipt would double-net against the reissued invoice's payment, so "counting it would understate what we owe on a reissued invoice" is coherent. But the flip side is real: cash the supplier actually sent against a later-voided claim now appears **nowhere in the position**, and the receipts endpoint "blocks them on a voided invoice" (existing test name), so the operator cannot re-attach it. The correction workflow (record the carried-over payment as a fresh receipt on the reissued invoice) is implicit only. Document it, or surface a "receipts excluded (voided invoice)" figure in the ledger totals so the money isn't silently gone.

**SHOULD-2 — Claimed ledger behaviours are untested.**
Appendix F covers netting and void-exclusion. It does not cover: receipt in a currency with zero fuel cost (the exact "money would vanish" case the context claims is handled), `receivedCount`, or negative `outstanding`. Add tests, especially the receipt-only-currency row.

**SHOULD-3 — Appendix E may admit `SUPPLIER_INVOICE` on the order-scoped email route.**
`documents.controller.ts` adds `SUPPLIER_INVOICE: 'Supplier Invoice'` to the map under the comment `// Determine recipient based on document type`. That entry is almost certainly compile-forced by the widened `DocumentEmailType` union — but if `POST /orders/:id/email` validates `documentType` against the union, a client can now send `documentType: 'SUPPLIER_INVOICE'` on an order: recipient falls through to the order's **client** (the wrong party for a commission claim on a supplier), and the subject renders via `return `Invoice ${params.invoiceNumber ?? ''}${period}`.trim()` → `"Invoice"`. Confirm the route 400s on `SUPPLIER_INVOICE`; the guard must be explicit, not incidental.

**SHOULD-4 — Blanket-optional email params weaken the contract (scrutiny #5).**
No regression for *existing* callers: the old required types forced them to pass `vesselName`/`portName`/`orderNumber`, and the new conditional rows only omit when absent — so an offer/invoice email today renders identically. But interpolation is unguarded where it matters: `return `Invoice ${params.invoiceNumber} — Bunker Delivery (${params.vesselName})`;` and BUNKER_BOOKING's `intro: `Bunkers have been booked for <strong>${params.vesselName}</strong> at <strong>${params.portName}</strong>.`` will print `undefined` for the first future caller that omits them. Prefer a discriminated union (order-shaped fields required for order-scoped types) over blanket-optional.

**SHOULD-5 — Raw date interpolation in the email.**
`dueDate: invoice.dueDate` and `const periodLabel = `${invoice.periodFrom} – ${invoice.periodTo}`` are interpolated unformatted into the HTML (`${params.dueDate}`). The PDF path formats via `getDateFormatSettings`; the email path doesn't. If those DTO fields are `Date`s, the recipient sees `2026-10-15T00:00:00.000Z`. Verify they're strings, or format them.

**SHOULD-6 — `email_log` has no real link to the supplier invoice.**
`orderId: options.orderId ?? null` is fine, but a supplier-invoice send is now logged with no order and no `supplierInvoiceId` — the only traceability is the invoice number inside the subject string. "Show all emails sent for this invoice" becomes subject parsing. Consider a nullable `supplier_invoice_id` (or a meta field).

**SHOULD-7 — Dead code carried into the extraction (scrutiny #4).**
`const settings = (tenant?.settings ?? {}) as TenantSettings;` in `renderSupplierInvoicePdf` is never used — it was dead in the inlined original too. Drop it (and the `TenantSettings` import if it becomes unused).

**SHOULD-8 — Send-route test gaps.**
No cross-tenant test (tenant B's invoice id → 404 on `/send`) and no test that an explicit `recipientEmails` override is honoured verbatim. Both are cheap insurance on a payable-sending endpoint.

---

## Scrutiny answers, tersely

1. **Netting receivable against payable in one figure:** defensible. This is a "net position with this supplier" page and bunker brokerage settles net; the invariant that actually matters — receipts never enter `totalPaid` — is explicitly asserted (`expect(Number(totalAfter.totalPaid)).toBe(Number(totalBefore.totalPaid))`). Conditions: negative `outstanding` must render sensibly, and downstream consumers of `outstanding` must be audited (folded into MUST-1).
2. **VOID exclusion:** no double-count on reissue — it *prevents* one. The hole is the opposite: a possible invisible credit (SHOULD-1).
3. **Wrong party / isolation:** clean. `getSupplierInvoice(params.id, auth.tenantId)` is tenant-scoped; the counterparty is resolved `and(eq(counterparties.id, ...), eq(counterparties.tenantId, tenantId))`; `companyEmails` is joined by `invoice.supplierId`, a PK from a tenant-scoped invoice, so no cross-tenant address can be picked up. Void is checked before render. Branding is tenant-scoped. No leak found.
4. **Extraction fidelity:** semantically identical — same tenant select, same id+tenant company lookup, same footer fields, `invoice.bankDetails` passed directly (was a local alias), same filename sanitisation, same `as never` cast. Only delta is the dead `settings` (SHOULD-7).
5. **Optional loosening:** no existing-caller regression (see SHOULD-4); risk is prospective only.

## Disagreement with the approach

None material. Both load-bearing decisions — receipts move position but never `totalPaid`, and a separate period-scoped send route rather than overloading `/orders/:id/email` — are correct. My only structural objections are the missing re-link story for void-carried receipts (SHOULD-1) and blanket-optional over a discriminated union (SHOULD-4).

**Verdict: APPROVE-WITH-CONDITIONS** — B approved; A approved once the actual `getSupplierPaymentLedger` hunk is supplied and matches the described semantics (receipts excluded from `totalPaid`, VOID exclusion at read time, receipt-only currency rows emitted, tenant-scoped joins, negative-outstanding handling confirmed). SHOULDs to be addressed or explicitly waived.