# REVIEW — Supplier ledger receipts + supplier-invoice send

## Process note (blocking for a full review)

**Appendix A is empty.** The `getSupplierPaymentLedger` change — the load-bearing half of this round — is not in the payload. I can review Change A only through its tests (Appendix F) and stated semantics. The e2e tests exercise the real endpoint, so *behaviour* is verified for the tested paths; what I cannot verify is the query itself: tenant scoping of the receipts join, how the VOID exclusion is expressed, and the receipt-only-currency emission. See MUST-1.

---

## Findings

### MUST-1 — Verify the ledger query's tenant scoping and VOID join (unreviewable as submitted)
`company.service.ts / getSupplierPaymentLedger` — no source provided. The receipts side must (a) scope to the tenant (via `supplier_invoices` or the counterparty), and (b) exclude VOID-invoice receipts in a way that does not drop a whole currency row when a currency has *only* voided receipts. The tests cover "voided receipt excluded" (`expect(Number(total?.totalReceived ?? 0)).toBe(0)`) but not cross-tenant leakage or the void-only-currency edge. Condition of approval: produce the diff or confirm (a) and (b).

### SHOULD-1 — Optional-field loosening creates a silent "undefined" path in order-scoped emails
`mail.service.ts / buildDocumentEmailSubject` — the signature now has `vesselName?: string`, but the order-scoped branches interpolate unguarded:

```ts
return `Invoice ${params.invoiceNumber} — Bunker Delivery (${params.vesselName})`;
...
return `${labels[params.documentType]} — ${params.orderNumber} — ${params.vesselName}, ${params.portName}`;
```

Same in `buildDocumentEmailHtml` intros, e.g. BUNKER_BOOKING: `` `Bunkers have been booked for <strong>${params.vesselName}</strong>…` ``. Previously an omission was a **compile error**; now it renders "undefined" in a customer-facing subject/body. The table rows were guarded (`${params.vesselName ? … : ''}`) but the subjects and intros were not. Fix: a discriminated union (`{ documentType: 'SUPPLIER_INVOICE'; … } | { documentType: <order-scoped>; vesselName: string; portName: string; orderNumber: string }`), or null-guard every interpolation. The new test only asserts `not.toContain('undefined')` for the SUPPLIER_INVOICE path.

### SHOULD-2 — Voided-receipt exclusion strands real cash; reissue + repay double-counts
The design ("a voided claim is not a live credit") is correct at void time, but no reallocation path is shown. Scenario: supplier pays 250 against SINV-1 → SINV-1 voided → SINV-2 issued for the period → supplier pays SINV-2. We now hold 500 for 250 of legitimate claims; the ledger shows only the SINV-2 receipt, and the first 250 is permanently invisible in the position (`totalReceived` excludes it, rows "kept for audit" only). The cash did not vanish — our liability to refund/reapply did. Either allow re-linking a receipt to the reissued invoice, or surface voided receipts as a separate "unapplied / refundable" figure. As shipped, the position is wrong in the supplier's favour after a reissue-and-repay, and there is no UI surface that ever shows the stranded money.

### SHOULD-3 — Test gaps
- No cross-tenant test for `POST /supplier-invoices/:id/send` (tenant B's token against tenant A's invoice id → 404). This is the tenant-isolation assertion for scrutiny item 3 and it is currently only implied by `getSupplierInvoice(params.id, auth.tenantId)`.
- No test for the recipient-override path (`body.recipientEmails`).
- No ledger test for a receipt in a currency with no fuel cost (the "or the money would vanish from the page" case) and no assertion on `receivedCount`.

### SHOULD-4 — `email_log` has no queryable link to the supplier invoice
`logEmail` now writes `orderId: options.orderId ?? null`, and nothing else identifies the invoice — the number survives only inside the subject string. You cannot answer "was SINV-2026-004 sent, to whom, when" without a LIKE on subject. Add a nullable `supplierInvoiceId` (or generic `documentId`) to `email_log`.

### SHOULD-5 — Nits
- `supplier-invoice-pdf.ts`: `const settings = (tenant?.settings ?? {}) as TenantSettings;` is dead (it was also dead in the inlined original — parity preserved, but don't carry it forward).
- Send route: `message: err instanceof Error ? err.message : 'Failed to send invoice'` leaks internal error text on 500.

---

## Scrutiny questions, answered

1. **`outstanding = cost − paid − received`**: defensible, and I agree with it — *because* `totalReceived` is emitted as a separate per-currency field and `totalPaid` is untouched, so the UI can decompose the net. As a single "position with this supplier" number, netting their commission debt against our fuel payable is the honest figure. The direction discipline (receipts never enter `totalPaid`) is correct and tested (`expect(Number(totalAfter.totalPaid)).toBe(Number(totalBefore.totalPaid))`).
2. **VOID exclusion**: right at void time, opens a hole at reissue time — see SHOULD-2.
3. **Send route isolation**: invoice fetch is tenant-scoped; recipient resolution keys off `invoice.supplierId` (a UUID, so no cross-tenant collision despite no explicit tenant filter on `companyEmails`); branding is resolved by `tenantId` and counterparty-by-id-AND-tenant in the renderer; VOID is refused before render. Clean — but see SHOULD-3 for the missing proof.
4. **PDF extraction**: semantically identical. Checked line-by-line against the removed block: same tenant/company queries, same fallback chain (`invoice.invoicingCompanyName ?? company?.name ?? tenant?.name ?? ''`), same accent default `'#0f766e'`, same filename sanitisation, same headers. The only delta is `const bankDetails = invoice.bankDetails` inlined to `bankDetails: invoice.bankDetails` — no semantic change. Download and send now cannot drift; good.
5. **Builder loosening**: existing callers compile unchanged, but the safety moved from compile-time to nothing — SHOULD-1.

## Disagreement

Only SHOULD-2 rises to approach-level: excluding voided receipts from the position is presented as settled, but without a re-link/refund/unapplied-credit path it strands cash and misstates the position after reissue-and-repay. Everything else I concur with, including the separate-ledger decision and the netting.

## Verdict

**APPROVE-WITH-CONDITIONS** — condition: MUST-1 (produce the `getSupplierPaymentLedger` diff or confirm tenant scoping + VOID-join semantics; Appendix A was empty). SHOULD-1 through SHOULD-5 are non-blocking but should land before the next round relies on the loosened email builders.