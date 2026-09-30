## Review

### Findings

**MUST** — `company.service.ts` (getSupplierPaymentLedger) is missing from the payload (Appendix A is empty). The core of Change A cannot be reviewed: the actual query, the `outstanding` computation, the VOID exclusion, and the per-currency emission are all unverifiable. Provide the code before approval.

**SHOULD** — Excluding receipts on VOID invoices from `totalReceived` may create a ledger hole. The test only asserts `totalReceived` is 0 after void, but does not cover the reissue lifecycle. If a receipt is recorded against an invoice that is later voided and the period is re-invoiced, the money received is not credited anywhere in the supplier position (the old receipt is excluded, and there is no shown mechanism to transfer or reverse it). The description argues that counting it would understate what we owe on a reissued invoice, but the opposite risk is that the supplier has paid us money that is now invisible in the ledger, overstating what we owe. Need a clear policy: either receipts on voided invoices are reversed (refunded) or they are transferred to the replacement invoice. As written, the ledger can be wrong after a void+reissue.  
Evidence: test `does not treat a receipt on a VOID invoice as a live credit` only checks `totalReceived` is 0 after void; no test for reissue.

**SHOULD** — `buildDocumentEmailSubject` in `documents/mail.service.ts` now makes `orderNumber`, `vesselName`, `portName` optional for all document types. For `INVOICE`, the branch:
```ts
if (params.documentType === 'INVOICE' && params.invoiceNumber) {
  return `Invoice ${params.invoiceNumber} — Bunker Delivery (${params.vesselName})`;
}
```
uses `params.vesselName` without a fallback. A caller could now omit `vesselName` (type allows it) and produce a subject containing the literal string `"undefined"`. The same risk exists in the generic fallback subject. This loosening was introduced to support `SUPPLIER_INVOICE`, but it weakens type safety for existing order-scoped callers. Consider keeping those fields required for order-scoped types (e.g. via a discriminated union) or adding runtime guards that throw/fallback when they are missing for types that need them.

**SHOULD** — The send route (`supplier-invoices.controller.ts`) allows `body.recipientEmails` to override the supplier’s resolved addresses with arbitrary emails. While this is an intentional operator override, there is no warning or logging when the override does not match any known email for the supplier. A mistyped override on a payable could send the invoice to the wrong party. Consider logging a warning or requiring confirmation when the override differs from the supplier’s on-file addresses.

### Observations (no action required)

- **`renderSupplierInvoicePdf` extraction** (`supplier-invoice-pdf.ts`) is semantically identical to the inlined original removed from the controller. The only difference is `bankDetails: invoice.bankDetails` passed directly instead of via an intermediate variable; no behavior change.
- **Tenant isolation** in the send route and PDF rendering appears correct: the invoice is fetched with `auth.tenantId`, the invoicing company is resolved by `id AND tenantId`, and `companyEmails` is queried by `counterpartyId` (which is globally unique). No cross-tenant leak identified.
- **Void check** before sending is present and returns 400, matching the PDF download route.
- **Email log** correctly handles nullable `orderId` via `options.orderId ?? null`.

### Verdict

**APPROVE-WITH-CONDITIONS**

Conditions:
1. Provide the missing `company.service.ts` ledger code for review.
2. Clarify and test the lifecycle of receipts on voided invoices (reversal or transfer to reissued invoice) to avoid an inaccurate supplier position.
3. Tighten the optional-field loosening in `buildDocumentEmailSubject` to prevent `"undefined"` in order-scoped subjects.