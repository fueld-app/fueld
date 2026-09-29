Verdict: **NO-GO** — blocking MUSTs below.

---

## Round-1 fix verification

| Fix | Status |
|---|---|
| **M1** tenant-scoped invoice number | PASS. `UNIQUE (tenant_id, invoice_number)` is present in migration. |
| **M2** pre-check before allocation, allocation on `tx` | PASS for all app-writer paths. Residual backstop burn noted in SHOULD. |
| **M3** `bank_details jsonb` + named PDF fields | PASS. `remittanceLines()` labels fields explicitly; no positional shift. |
| **M4** currency filter in recompute | PARTIAL. Recompute filters `supplierPayments.currency = invoice.currency` correctly. Throw correctness depends on caller transaction — MUST verify `createSupplierPayment`. |
| **M5** admin role check | PASS. Both `POST /` and `POST /:id/void` return 403 for non-ADMIN. |
| **S1** issuer resolved by id + tenant | PASS in PDF path. Creation still resolves issuer name unscoped — SHOULD. |
| **S3** detail/PDF gate on flag | PASS. Both routes call `assertSupplierInvoicesEnabled`. |
| **S4** `orderId` threaded | PASS. `toLineDto` and insert now carry `orderId`. |
| **S7** detail self-heals received | PARTIAL. It does recompute, but introduced cross-tenant write on detail/PDF — MUST. |
| **S9** batched list | PARTIAL. N+1 fixed, but ordering and currency consistency regressed — MUST. |
| Void lock | PASS. `pg_advisory_xact_lock` is held inside `db.transaction` across the work and released at commit. |

---

## Blocking MUSTs

### MUST 1 — Detail/PDF routes cause an unauthorized cross-tenant write

`GET /:id` and `GET /:id/pdf` call:

```ts
const invoice = await getSupplierInvoice(params.id);
```

**before** `invoiceBelongsToTenant(...)`. `getSupplierInvoice` starts with:

```ts
await recomputeSupplierInvoiceReceived(id);
```

`recomputeSupplierInvoiceReceived` performs an `UPDATE supplier_invoices ...` on whatever id was supplied. A user from tenant A can therefore cause writes to tenant B’s invoice by guessing/obtaining a valid UUID, even though the response is later 404ed.

This is a direct consequence of the S7 fix landing in a function called before tenancy is checked.

Fix: move `invoiceBelongsToTenant(params.id, auth.tenantId)` before `getSupplierInvoice`, or give `getSupplierInvoice` a `tenantId` parameter and filter internally.

---

### MUST 2 — Batched list lost the `createdAt DESC` ordering

`listSupplierInvoices` first selects ids:

```ts
.orderBy(desc(supplierInvoices.createdAt))
```

Then it loads headers:

```ts
db.select().from(supplierInvoices).where(inArray(supplierInvoices.id, ids))
```

with **no `orderBy`**. The returned header order is therefore unspecified. The list route can return rows in arbitrary order, not newest-first.

Fix: add `.orderBy(desc(supplierInvoices.createdAt))` to the headers query, or reorder `headers` to match `ids`.

---

### MUST 3 — List and detail can disagree on `amountReceived`

Detail path now filters receipts by currency:

```ts
eq(supplierPayments.currency, invoiceCurrency?.currency ?? '')
```

List path does not:

```ts
const received = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
```

The list payment select also omits `currency`, so it cannot apply the same filter. Any mismatched-currency payment linked out-of-band will inflate the list figure while the detail figure excludes it.

This violates the comment in `listSupplierInvoices` claiming the list shows the same figure a detail read would.

Fix: select `currency` in the batched payment query and sum only `p.currency === row.currency`, or reuse a batched recompute.

---

### MUST 4 — M4 throw correctness depends on `createSupplierPayment` transactionality

`applySupplierPaymentToInvoice` throws on a currency mismatch **after** the payment row has already been inserted by the caller. It does not run in its own transaction.

- If `createSupplierPayment` wraps the insert + `applySupplierPaymentToInvoice` in one `db.transaction`, the throw rolls back the payment insert — correct.
- If it does not, the payment row remains committed, the invoice is not recomputed, and the operator gets a half-applied state.

`createSupplierPayment` is not in the supplied source, so this cannot be confirmed from the payload.

Fix: verify the caller is transactional; if not, make `applySupplierPaymentToInvoice` transactional or prevalidate the currency before inserting the payment.

---

## SHOULD fixes

### SHOULD 1 — Residual M2 number burn on `onConflictDoNothing` fallback

`createSupplierInvoicesFromReport` allocates the number **before** the insert:

```ts
const invoiceNumber = await allocateSupplierInvoiceNumber(tenantId, now, tx);
const [inserted] = await tx.insert(supplierInvoices)...onConflictDoNothing...
```

If `inserted` is undefined because the unique backstop fires, the function continues and the transaction commits. The sequence increment was already made inside the same transaction, so a number is burned.

The advisory lock makes this path unreachable for normal app writers, but it is not a fully closed hole against any non-lock writer.

Fix: make conflict throw to roll back the sequence, or allocate only after a successful insert.

---

### SHOULD 2 — Creation issuer lookup still unscoped

In `createSupplierInvoicesFromReport`:

```ts
const [company] = invoicingCompanyId
  ? await tx.select({ name: counterparties.name })
      .from(counterparties)
      .where(eq(counterparties.id, invoicingCompanyId))
      .limit(1)
  : [];
```

No `tenantId` predicate. The PDF path is fixed, but the name snapshotted at issue can still come from another tenant if `preferredInvoicingCompanyId` points cross-tenant.

Fix: add `eq(counterparties.tenantId, tenantId)`.

---

### SHOULD 3 — Sleek remittance block omits `currency`

`remittanceLines()` prints:

```ts
bank.currency?.trim() ? `Currency ${bank.currency.trim()}` : ''
```

The classic layout uses this. The sleek branch passes a `bank` object to `buildSleekDocument` but does not include `currency`. If the sleek layout prints bank fields, currency is missing.

---

### SHOULD 4 — Negative `supplierInvoiceTermsDays` accepted

```ts
const termsDays = Number.isFinite(settings.supplierInvoiceTermsDays)
  ? Number(settings.supplierInvoiceTermsDays)
  : 30;
```

No `>= 0` check. A negative value creates a due date before the period end.

---

## Claim responses

1. **Does M2 actually close the hole?**  
   Yes for all API writers. The pre-check is inside the advisory lock, and allocation is on `tx`, so idempotent retries do not burn numbers. The `onConflictDoNothing` fallback is the only residual burn path, and it is unreachable while all writers take the lock.

2. **Is the current void lock real?**  
   Yes. The lock is acquired inside `db.transaction`, all void work happens inside that transaction, and release occurs at commit. The route-level tenancy pre-check outside the lock can 404 an in-flight not-yet-visible invoice, but that is not harmful.

3. **Did the batched list rewrite change any observable figure?**  
   Yes. It can disagree with detail when mismatched-currency payments exist, because list sums without the currency filter. It also lost ordering. This is a regression/inconsistency.

4. **M4 throw half-applied?**  
   Conditional. Correct if `createSupplierPayment` is transactional; half-applied if not. Must verify.

5. **Is `bank_details` JSON change safe?**  
   Yes for both layouts. `remittanceLines()` handles nulls without positional shifting. Minor: sleek omits currency.

6. **Executor type satisfied?**  
   Likely yes. The code is deployed and TypeScript would reject a mismatched `tx`. The default `db` is only used when the caller omits the executor; the create path passes `tx`, so no silent fallback there.

7. **Still-open items**  
   - **(a) `supplier_payments` directional ambiguity** — confirmed. The migration itself acknowledges the table now holds both money-out and money-in links.
   - **(b) multi-supplier-leg deals produce no invoice** — confirmed. They appear only as `skipped` with `supplierId: ''`.
   - **(c) no concurrency e2e** — confirmed. No test proves two parallel POSTs serialize correctly.
   - **(d) “N deliveries” vs line count note** — not in this changeset; likely still open.
