VERDICT: **APPROVE-WITH-CONDITIONS**

The separate-ledger/snapshot design is sound and the invariants are mostly enforced. But there are two cross-tenant correctness/security defects and one stale-cache defect that must be fixed before this is merged.

## Blocking findings

### MUST — `invoice_number` is globally unique, but the sequence is per tenant
`0135_supplier_invoices.sql`:
```sql
invoice_number text NOT NULL UNIQUE
```
`supplier_invoice_number_sequences` has `tenant_id` as primary key and the default template is `SINV-{YYYY}-{SEQ:4}`. Two tenants will both generate `SINV-2026-0001`, and the second insert fails with a unique violation.
Change the unique index to `(tenant_id, invoice_number)` or make the sequence global. This also means `allocateSupplierInvoiceNumber` must return a tenant-scoped number if numbers are allowed to duplicate across tenants.

### MUST — detail and PDF routes are not gated on broker-deals
`supplier-invoices.controller.ts`:
- `GET /supplier-invoices/:id`
- `GET /supplier-invoices/:id/pdf`

Neither calls `assertSupplierInvoicesEnabled`, while list/candidates/create/void do. A tenant with broker deals disabled can still read existing supplier invoices by id if the row belongs to that tenant. This directly contradicts the stated “every route 404s when brokerDeals.enabled is false” invariant.

Add the gate to both routes before returning data/PDF.

### MUST — issuer branding lookup is by unqualified name, allowing cross-tenant leakage
`supplier-invoices.controller.ts` PDF route:
```ts
.from(counterparties)
.where(eq(counterparties.name, invoice.invoicingCompanyName))
```
`counterparties.name` is not tenant-scoped. A counterparty in another tenant with the same name can satisfy this query and leak its logo/address/VAT/brand color into the PDF. Also, because `invoicingCompanyName` is frozen at issue, renaming the issuer company makes the live lookup fail entirely.

Use `supplier_invoices.invoicing_company_id` (currently not returned in the DTO) to resolve the issuer by primary key and tenant, falling back to name only when the id is null. Add `invoicingCompanyId` to `SupplierInvoiceDto`/`getSupplierInvoice`.

### MUST — settlement cache can serve stale figures
`getSupplierInvoice` reads `row.amountReceived` directly and derives status from it. It does **not** recompute from `supplier_payments`. `recomputeSupplierInvoiceReceived` is only called by `applySupplierPaymentToInvoice` and by manual e2e calls.

Any payment inserted/deleted directly, or through a future route that forgets `applySupplierPaymentToInvoice`, leaves the cache wrong and the invoice detail/list shows a stale `amountReceived`/`amountOutstanding`. The design text claims “recompute on read paths,” but the code does not do that.

Options:
- Recompute in `getSupplierInvoice` before returning (simplest; list already does N+1 reads), or
- Drop the `amount_received` cache and compute it from `supplier_payments` in the same query, or
- Add a DB trigger / enforce all writes through `applySupplierPaymentToInvoice`.

At minimum add a regression test that deletes a payment and then calls the detail API without manual recompute.

## Should-fix findings

### SHOULD — `supplier_invoice_lines.order_id` is always inserted as `null`
`supplier-invoice.service.ts`:
```ts
orderId: null,
```
The schema comment says it is “kept for traceability,” but the code never populates it. If the report DTO includes an order id, capture it. The FK has `ON DELETE SET NULL`, so this remains safe.

### SHOULD — `supplier_payments` mixes money-in and money-out
The table is otherwise money paid out to suppliers. Adding a `supplier_invoice_id` for receipts from suppliers makes direction ambiguous to future readers/report writers. A separate `supplier_receipts` or `supplier_invoice_payments` table would be cleaner. Not blocking, but worth resolving now before reports sum this table.

### SHOULD — void does not take the advisory lock
`voidSupplierInvoice` releases `source_key` without acquiring `pg_advisory_xact_lock`. A concurrent create can conflict with the old key and report `alreadyInvoiced`, requiring a retry after void commits. No double bill is possible, but the race is a poor UX. Take the same advisory lock in void.

### SHOULD — bank snapshot parsing is index-fragile
`bankDetailsSnapshot` is split by newline and the SLEEK layout assumes indexes 0/2/3/4. If `bank.bankName` is null, `filter(Boolean)` shifts the IBAN/SWIFT lines and the PDF mislabels them. Store the snapshot as structured JSON or use labelled lines.

### SHOULD — due date is invented
`dueDate = periodTo + 30 days` is not from Moxie. Make it tenant-configurable or expose it in the create UI before first real use.

### SHOULD — e2e settlement test masks API link coverage
The test wraps the API payment call in `if (viaApi.status === 200)`, so if the route does not accept `supplierInvoiceId`, the test still passes. Assert the route exists and the invoice updates without manual recompute.

## Specific challenge answers

1. **Separate table vs payer column:** Separate table is correct. The customer readers are the source of truth for receivables; a payer column would be a latent misbooking risk. Duplicating status derivation is a reasonable cost.
2. **`supplier_payments` as settlement vehicle:** Functionally workable, but directionally ambiguous. Prefer a separate table eventually.
3. **Void releasing `source_key`:** No double active invoice. Advisory lock serializes issues; void racing issue causes a failed create rather than a double bill.
4. **Issuer branding live vs frozen:** Reasonable in principle, but the implementation freezes the issuer name while live-resolving other branding by name. This creates the rename failure above. Resolve by `invoicing_company_id`.
5. **Due date:** Should be configurable before relying on it.
6. **Multi-leg exclusion:** Correctly not silent; `skipped` reports the order number. Acceptable.
7. **Stale `amount_received`:** Yes, as detailed above.
8. **Other money-safety:** Global invoice number uniqueness is the main one. Currency is excluded rather than converted; acceptable if documented. Rounding foots for the tested multi-line cases, but add a test for line-level cent rounding with odd rates.
