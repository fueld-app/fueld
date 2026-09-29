# Round 2 Verification Review — Supplier Invoices

## 1. Attack-list verdicts

### Claim 1 — M2 idempotency/number-burn: **CLOSED** (with two residuals)

Trace:

- Issue path: `db.transaction(tx)` → `pg_advisory_xact_lock(hashtext('supplier-invoices:'+tenantId))` on `tx` → per-supplier pre-check `SELECT … WHERE source_key = …` on `tx` → `allocateSupplierInvoiceNumber(tenantId, now, tx)` → insert with `onConflictDoNothing({target: sourceKey})`.
- Two concurrent POSTs: caller B blocks on the advisory lock until A commits, then B's pre-check runs with a fresh READ COMMITTED snapshot and **sees A's committed row** → `alreadyInvoiced`, no allocation. Both passing the pre-check is not reachable via app code.
- Failure after allocation (line insert throws): whole tx rolls back → sequence increment rolls back → **no gap**. The original M2 defect is removed, not moved.

**Residual (accepted, SHOULD note):** the `if (!inserted)` defensive branch still burns a committed number (allocation commits when the loop `continue`s). Reachable only via an out-of-band insert racing under the lock — the app has no other writer of `supplier_invoices` — so acceptable, but the comment in `allocateSupplierInvoiceNumber` ("rolls the sequence back with the insert") is only true on rollback, not on the conflict branch.

**Residual (SHOULD, see F-5):** `executor` defaults to `db`.

**Report built outside the lock:** fine. Idempotency derives from `source_key` + lock + unique index; the report only feeds snapshot values. A stale report cannot double-bill.

### Claim 2 — Void lock: **REAL**

`voidSupplierInvoice`: lock acquired on `tx`, all reads/updates (`supplier_invoices` void, `supplier_payments` unlink) on the same `tx`. `pg_advisory_xact_lock` cannot be released before commit, and the key expression is byte-identical to the issue path's → concurrent issue serializes behind void, and vice versa. Early `return` on missing/already-VOID just commits an empty tx — harmless. The earlier "lock in a separate transaction" failure mode is gone. **Verified.**

Intended reissue flow confirmed: void commits with `source_key: null` → a blocked issuer's pre-check then passes → new number from the series. Number reuse impossible (`tenant_number_unique` + series monotonicity).

### Claim 3 — List vs detail divergence: **CAN DISAGREE — introduced defect (F-3)**

The list re-derives `amountReceived` from the batched payments read, which has **no currency filter**:

```ts
payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0)
```

The detail figure comes from `recomputeSupplierInvoiceReceived`, which filters `currency = invoice.currency`. Through app code the link throw makes a mismatched link un-creatable, so for app-written data they agree (and the list now self-heals like S7 wanted). But for an out-of-band link — the exact scenario S7's self-heal was built for — the detail excludes the mismatched receipt and the list **includes** it: list shows PAID, detail shows outstanding, the M4 presentation bug survives on the list route. Regression-in-principle, not hypothetical.

### Claim 4 — M4 throw placement: **HALF-APPLIED STATE — MUST (F-1)**

`applySupplierPaymentToInvoice` performs every write on module-level `db`. It therefore **cannot join** a caller transaction even if `createSupplierPayment` opened one. Per the stated call order (insert payment → apply), on a currency mismatch:

1. payment row is already persisted (insert committed),
2. apply throws before linking,
3. API surfaces an error for an operation that partially succeeded.

An operator who retries doubles the receipt; the strapped payment also floats unallocated. The throw itself is correct; its **placement after the side effect, outside any shared transaction**, converts a silent mis-settlement into an error-plus-phantom-receipt on a money ledger — retry-inviting, i.e. worse-shaped than the original in the failure case. The check (or the whole create+link) must move before the insert, or apply must take an `executor` like the M2 fix just established.

### Claim 5 — `bank_details` JSON / classic layout / nulls: **VERIFIED for classic; sleek internals not in payload**

- Classic: `remittanceLines()` labels `IBAN …`, `SWIFT/BIC …`, `Currency …` individually and filters empties — the index-shift defect (M3) is gone at the source, not just repositioned. Null-only-object edge produces an empty `REMITTANCE` header block (cosmetic nit, F-9). `accountName` is dropped when identical (trimmed, **case-sensitive**) to `beneficiary`.
- Sleek: the mapping passes named fields (`iban`, `swift`, `bankName`, `beneficiary`) straight through; rendering null-handling lives in `buildSleekDocument`, which is not in Appendix A. No index-based splitting remains at this layer. Acceptable given Moxie uses the default (classic) layout.

### Claim 6 — `executor` typing: **satisfied; but the default is a trap (F-5)**

Drizzle's transaction handle exposes `insert`/`select` with the same generic signatures, so `tx` structurally satisfies `Pick<typeof db, 'insert' | 'select'>` (and the deployed build typechecks). There is no silent runtime fallback **in current code** — the single caller passes `tx`. But `executor = db` as a default means the *next* caller who forgets the argument silently reinstates the exact bug M2 fixed, with no type error. After fixing this once, leaving the footgun loaded is a choice; make the parameter required.

### Claim 7 — still-open items

- **(a) Confirmed open.** `supplier_payments` is now both payout and receipt ledger; migration 0135 documents the receipt direction (`ADD COLUMN supplier_invoice_id … "Money received FROM a supplier settles…"` — that sentence is in the function of a comment), which mitigates but does not resolve the directional ambiguity. SHOULD.
- **(b) Confirmed open, partially worse than stated.** Post-insert, multi-leg and other-currency orders surface only in the **POST result** `skipped[]`. `listSuppliersWithSupplierCommission` (the `/candidates` picker) maps only `report.bySupplier` — so before issuing, the UI gives **no signal** that orders will be skipped, and a missing invoice can read as "nothing owed" exactly as the invariant forbids. SHOULD: surface skip reasons in candidates.
- **(c) Confirmed open.** No concurrency e2e exists anywhere in the payload; the e2e change mentioned is the settlement-path assertion only. The advisory-lock serialization (claims 1–2) is verified by reasoning from source, not by test. SHOULD: two parallel POSTs, assert one `created`, one `alreadyInvoiced`, one number consumed.
- **(d) Confirmed open by absence.** `createCommissionOrdersFromReport` is untouched by this payload; nothing addresses the "N deliveries" note. Not re-verifiable beyond that.

---

## 2. Findings

**F-1 — MUST — M4 throw leaves a persisted, unlinked payment.** `supplier-invoice-ledger.ts :: applySupplierPaymentToInvoice` — all writes on `db`; called from `createSupplierPayment` *after* the insert. Mismatch ⇒ error response + committed receipt. Fix: perform the currency comparison in `createSupplierPayment` **before** inserting, or wrap insert+link in one transaction and thread an `executor` through `applySupplierPaymentToInvoice` (the M2 pattern already exists in this diff).

**F-2 — MUST — the two halves of the M4 fix disagree on case.** The link guard compares `(paymentCurrency ?? '').toUpperCase() !== (invoiceCurrency ?? '').toUpperCase()`; the settle sum filters `eq(supplierPayments.currency, invoiceCurrency currency)` — **raw, case-sensitive**. A payment stored with lowercase currency passes the guard, links successfully, and is then **silently excluded** from the sum — the precise silent-failure mode the throw was added to eliminate. Normalize in one place (store uppercase, or `upper()` both sides of the sum). Exploitability depends on entry validation not visible in the payload; that uncertainty is why it's a MUST, not a SHOULD.

**F-3 — SHOULD — list reintroduces the currency-less sum.** `supplier-invoice.service.ts :: listSupplierInvoices` — add `currency` to the batched payments projection and filter per `row.currency` in the reduce; otherwise list and detail diverge on out-of-band links (claim 3).

**F-4 — SHOULD — list ordering is now nondeterministic.** The first query orders ids `desc(createdAt)`; the second (`headers`, `inArray(id, ids)`) has **no `ORDER BY`** and `headers.map` sets the response order. Previous implementation read rows in id order. Add `orderBy(desc(createdAt))` to the headers query — which also makes the first id-only query redundant.

**F-5 — SHOULD — `allocateSupplierInvoiceNumber` defaults `executor = db`.** Any future caller omitting it silently buys back M2's gap-per-retry. Make the parameter required; remove the default.

**F-6 — SHOULD — S7's self-heal writes on every read.** `getSupplierInvoice` → `recomputeSupplierInvoiceReceived` runs unconditionally: invoice select + currency select + aggregate + `UPDATE … updatedAt = now()` on **every GET**, including the PDF route and foreign-tenant 404 probes (the recompute runs *before* `invoiceBelongsToTenant`, so any authenticated user can trigger a write on another tenant's row — benign values, but a cross-tenant write side effect and row lock on a read path; also breaks read-replica routing). Make the UPDATE conditional on a changed value, and reorder tenancy check before recompute. The two header selects in recompute should also be one query.

**F-7 — SHOULD — S1 residual: the create path still resolves the issuer without tenant scoping.** In `createSupplierInvoicesFromReport`, the invoicing company is fetched `WHERE id = invoicingCompanyId` (no `tenantId` term) and its bank account by `counterpartyId = invoicingCompanyId`; a corrupted/cross-tenant `preferredInvoicingCompanyId` would snapshot another tenant's name + bank details onto an issued document. The PDF read path was fixed to `id AND tenantId`; the write path that freezes the snapshot was not. Add the tenant predicate and fall back to the tenant default on violation.

**F-8 — SHOULD — `/candidates` masks the reversed-range error and the skip reasons.** `from > to` throws only in the create path; candidates silently returns empty for a reversed range (reads as "nothing owed") and omits multi-leg/other-currency skips entirely (claim 7b).

**F-9 — cosmetic nits.** (i) `Number.isFinite(settings.supplierInvoiceTermsDays)` is `false` for a numeric string (`"45"`), silently using 30 — coerce before the check. (ii) All-null `bank_details` object ⇒ empty `REMITTANCE` header in the classic layout; gate the block on `remittanceLines().length`. (iii) `accountName !== beneficiary` dedupe is case-sensitive. (iv) `updatedAt` churn makes the comment "One aggregate is cheap next to the lines + payments reads" inaccurate (it's ~4 queries + a write).

---

## 3. Round-1 fix verification summary

| Fix | Verdict |
|---|---|
| M1 per-tenant number uniqueness | ✔ migration + series consistent |
| M2 idempotency/number burn | ✔ closed; residual F-5 |
| M3 structured bank details | ✔ at snapshot + classic render; sleek renderer out of payload |
| M4 currency-safe settlement | **Partially** — sum filtered ✔, throw ✔, but F-1, F-2, F-3 |
| M5 admin enforcement | ✔ both POST routes 403 |
| S1 issuer resolution | ✔ PDF path; F-7 write path residual |
| S3 flag gating on reads | ✔ |
| S4 `order_id` traceability | ✔ at consumption (`orderId: line.orderId ?? null`); DTO/report side not in payload |
| S7 self-healing read | ✔ with F-6 cost |
| S9 batched list | ✔ with F-3, F-4 |
| Void under lock | ✔ real (claim 2) |
| Terms days / reversed range / e2e path | ✔ with F-8 nits |

## 4. Verdict

**APPROVE-WITH-CONDITIONS** — conditions gating: **F-1 and F-2** (both in the receipt-linking path, both small and local; F-3 should land with F-2 to make the three currency comparisons one rule).

Every round-1 MUST is either closed or improved, the two "did you actually fix it" traces (M2, void lock) hold up under adversarial reading, and no fix moved a defect somewhere invisible — but the M4 fix, as placed, converts a money error into a durable phantom receipt plus an error message, and its own guard and sum disagree about what counts as the same currency. On a financial ledger that merits blocking closure of this round, not a redesign: F-1 and F-2 are each a few lines, and the rest of the changeset is sound.
