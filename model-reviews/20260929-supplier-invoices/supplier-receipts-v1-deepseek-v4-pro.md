Verdict: **NO-GO**

The table split is directionally correct, but the receipt write path is not yet safe for a money ledger: no lock/overpay guard, void deletion does not match the normal status-update void model, `recomputeSupplierInvoiceReceived` clears `OVERDUE`, and `deleteSupplierReceipt` is not tenant-scoped.

---

## MUST

### 1. `createSupplierReceipt` is a TOCTOU write with no overpay protection
`apps/api/src/modules/orders/supplier-invoice-ledger.ts :: createSupplierReceipt`

- Invoice is selected once, then `assertReceiptCurrencyMatchesInvoice` selects it again.
- No `SELECT ... FOR UPDATE`, no transaction, no advisory lock.
- No check that `amount <= invoice.amount - invoice.amountReceived`.

Two concurrent receipts can both pass the status/currency checks and both insert. A void racing a receipt can also insert after the void status is checked. `recomputeSupplierInvoiceReceived` then simply marks the invoice PAID when the sum reaches/exceeds amount.

For a money ledger this must be serialized on the invoice row and must reject overpayment, or explicitly record/surface overpayment.

### 2. Void does not actually delete receipts if void is a status update
`apps/api/drizzle/0136_supplier_receipts.sql :: supplier_receipts.supplier_invoice_id ON DELETE CASCADE`

The change description says “void DELETES the invoice’s receipts,” but the cascade only fires on `DELETE` of the `supplier_invoices` row. The candidates query already filters `supplierInvoices.status NOT IN ('VOID')`, which implies voided invoices remain as rows with `status = 'VOID'`.

If void is implemented as a status update, receipts are **not** deleted and remain attached to a voided invoice. If deletion is the intended behavior, it must be done explicitly in the void service and followed by recomputation. If receipts should survive for audit, the NOT NULL/cascade design is wrong.

Either way, the stated lifecycle is not implemented by the schema alone.

### 3. `recomputeSupplierInvoiceReceived` clears `OVERDUE`
`apps/api/src/modules/orders/supplier-invoice-ledger.ts :: recomputeSupplierInvoiceReceived`

It calls `deriveSupplierInvoiceStatus(..., 0)`, so `daysOverdue` is always `0`.

A partial receipt on an already `OVERDUE` invoice therefore becomes `PARTIALLY_PAID`, and `storedStatus` writes that back. This contradicts the comment in `deriveSupplierInvoiceStatus`:

> Overdue outranks partially paid: this is the flag that says "chase it".

`recomputeSupplierInvoiceReceived` should preserve `OVERDUE` when the invoice is still overdue, or the caller must compute overdue status separately and not overwrite it here.

### 4. `deleteSupplierReceipt` is not tenant-scoped
`apps/api/src/modules/orders/supplier-invoice-ledger.ts :: deleteSupplierReceipt`

It selects and deletes by `receiptId` only. In a multi-tenant system, any caller who can guess/obtain a receipt UUID can delete another tenant’s receipt.

The function should accept `tenantId` and filter both the select and delete.

### 5. Zero-value invoices can receive receipts and derive an invalid status
`apps/api/src/modules/orders/supplier-invoice-ledger.ts :: deriveSupplierInvoiceStatus` and `createSupplierReceipt`

`createSupplierReceipt` only checks `amount > 0`; it does not reject receipts against an invoice with `amount <= 0`.

`deriveSupplierInvoiceStatus` then returns `PARTIALLY_PAID` for a zero-amount invoice with a positive receipt:

```ts
if (amount <= 0 && received <= 0) return 'PAID';
return received > 0 ? 'PARTIALLY_PAID' : 'SENT';
```

That is internally inconsistent: a zero-value invoice is “settled by definition,” but recording a receipt makes it partially paid. Either reject receipts on zero/negative invoices or treat them as PAID.

---

## SHOULD

### 6. Amount rounding is silent
`apps/api/src/modules/orders/supplier-invoice-ledger.ts :: createSupplierReceipt`

`Number(input.amount).toFixed(2)` silently rounds amounts with more than two decimals. For money input, reject more than two decimals or round using explicit decimal/cents arithmetic.

### 7. `order_supplier_id` / `order_id` are never populated on receipt creation
`apps/api/drizzle/0136_supplier_receipts.sql` defines both columns for context/reporting, but `createSupplierReceipt` inserts neither.

If the invoice has a known supplier leg/order, the receipt should carry that link; otherwise the columns are dead or only populated out-of-band.

### 8. Candidates endpoint recomputes the whole report again
`apps/api/src/modules/orders/supplier-invoice.service.ts :: listSuppliersWithSupplierCommission`

The report page calls both the report endpoint and `/candidates`, each of which calls `buildSupplierCommissionReport`. Two full builds per page load can disagree if data changes between calls.

Prefer one of:
- return candidates as part of the report response, or
- accept the already-built report figures into the candidates endpoint.

### 9. `willSkip` may understate customer-side totals
`apps/api/src/modules/orders/supplier-invoice.service.ts :: listSuppliersWithSupplierCommission`

Deals with multiple supplier legs are excluded from the entire report. If the UI also shows customer-side commission totals, those excluded orders silently disappear from that total. The skip list should carry the excluded amounts or the UI should not present a total that omits them.

### 10. `recomputeSupplierInvoiceReceived` on reads is a read-that-writes
`apps/api/src/modules/orders/supplier-invoice-ledger.ts :: recomputeSupplierInvoiceReceived`

The comment says it runs on every read and self-heals. Even with the conditional update, GETs can still take row locks and write when the cached amount/status is stale. This is exactly the read/write side-effect class called out in the review. It should not run on GETs; use a derived read projection or a background reconciliation job instead.

---

## Answers to specific challenges

1. **Dropping the column** — correct. Direction as a table property is safer than filtering. No reader loses a legitimate link because receipts did not exist yet and outbound payments should not settle supplier invoices.
2. **Void deletes receipts** — as implemented, it does not delete on status void. For audit, receipts should generally outlive a voided invoice as reversed/unapplied facts, not be cascade-deleted.
3. **Concurrency** — real. Must lock the invoice row.
4. **Double report build** — not acceptable for a financial summary page; use one source.
5. **Skip list** — insufficient if customer totals are shown; include amounts.
6. **Reintroduced class of bug** — `recomputeSupplierInvoiceReceived` is a read-that-writes; `createSupplierReceipt` has TOCTOU; zero-value status inconsistency.
7. **Missed money-ledger issues** — overpay not prevented, tenant scoping on delete, rounding, and `OVERDUE` being cleared by recompute.
