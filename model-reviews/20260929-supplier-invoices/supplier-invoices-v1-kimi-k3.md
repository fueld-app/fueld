# Panel Review — Supplier Invoices

**Verdict: APPROVE-WITH-CONDITIONS.** The architecture is right, the snapshot discipline is right, and the verification is credible. The MUSTs below are all small, targeted fixes — none require redesign. Details first, then answers to the eight challenges.

---

## MUST

**M1 — `invoice_number` is globally unique across tenants** — `0135_supplier_invoices.sql`:
`invoice_number text NOT NULL UNIQUE` with a per-tenant counter and a per-tenant template. Two tenants on the default template both allocate seq 1 → second tenant's first insert is `SINV-2026-0001` → unique violation → 500. Mitigated today only because the feature is flag-gated and presumably only Moxie has it. Fix while no data exists: `UNIQUE (tenant_id, invoice_number)`, and drop the global one.

**M2 — Idempotent retries burn invoice numbers** — `supplier-invoice.service.ts`, `createSupplierInvoicesFromReport`: `allocateSupplierInvoiceNumber(tenantId, now)` is called *before* the `onConflictDoNothing` insert, and on `db` outside the advisory-lock transaction. Consequences:
- Every repeat call (double click, retry) increments the sequence for every already-invoiced supplier, then discards the number. The idempotency e2e checks `created.length === 0` but not the sequence, so this is unverified.
- A rollback after allocation leaves a permanent gap.

For a Danish tenant, unexplained gaps in an issued invoice series are an audit problem. Fix: inside the lock, `SELECT` by `source_key` first → `alreadyInvoiced` without allocating; only allocate for rows you will insert, and run the allocation on `tx` so rollbacks release the number. Keep `onConflictDoNothing` as the safety net.

**M3 — SLEEK remittance block is parsed positionally from a conditionally-built string** — The writer (`createSupplierInvoicesFromReport`) builds `bankDetailsSnapshot` with `[beneficiary, accountName-if-different, bankName, IBAN, SWIFT, currency].filter(Boolean)`, so line count varies. The PDF route then hard-codes `bankLines[2]` = bankName, `[3]` = IBAN, `[4]` = SWIFT. If the account holder name differs from the beneficiary, or `bankName`/`swiftBic` is null, everything shifts by one and the SLEEK layout (the default — the exercised one) prints, e.g., "Nordea" as the IBAN. The verified render only passed because the real data happened to hit every branch. Fix: parse by prefix (`startsWith('IBAN ')`) or — better — store the snapshot as JSON. This contradicts an internal invariant elsewhere in the same file: the snapshot is frozen precisely because it is positionally opaque, then it gets positionally decoded.

**M4 — Settlement sums receipts with no currency check** — `supplier-invoice-ledger.ts`, `recomputeSupplierInvoiceReceived`: `SUM(supplierPayments.amount)` over all rows linked to the invoice, regardless of `supplierPayments.currency`. A EUR receipt recorded against a USD invoice inflates `amount_received` and can auto-flip the invoice to PAID. Constrain at link time (`applySupplierPaymentToInvoice` or the orders route must reject mismatched currency) and/or filter by invoice currency in the sum.

**M5 — "Admin only" is claimed in the route doc and enforced nowhere visible** — `.post('/')` (and `/void`) in `supplier-invoices.controller.ts` check the tenant flag but no role. Either `authGuard` enforces admin for all mutations (in which case say so), or this is a money-creating endpoint open to any authenticated user of the tenant. Enforce `auth.role === 'ADMIN'` or drop the claim from the summary.

---

## SHOULD

**S1 — Issuer company resolved by name at PDF time, though the id was stored.** `supplier-invoices.controller.ts`: `.where(eq(counterparties.name, invoice.invoicingCompanyName))`. A rename, or two own-companies sharing a name, resolves to the wrong row (or none). `invoicing_company_id` exists in the schema — expose it on the DTO and use it. This also addresses challenge #4: logo/accent live is defensible; **VAT number and address are not** — they are fiscal-identity fields on a tax document, and you already freeze the bank block on the same page. Freeze `issuer` identity (address, VAT) at issue.

**S2 — Guarantee the document foots.** Invoice `amount = supplier.totalCommission` (report sum), lines carry their own amounts. If the report sums floats and Postgres rounds each `numeric(14,2)` insert independently, printed lines can differ from the printed total by a cent on some data. Set the invoice amount as `SUM` of the rounded line amounts at insert, and consider integer-cent arithmetic over `parseFloat`/`toFixed` throughout the read path.

**S3 — `assertSupplierInvoicesEnabled` is missing on `GET /:id` and `GET /:id/pdf`.** The design text says *every* route 404s when the flag is off; the detail/PDF routes don't check. Arguably correct for auditability (a tenant that later disables broker deals should still read historical documents) — but then the stated invariant and the e2e gating test (which only covers list/candidates/create) should say so explicitly. Reconcile code and claim.

**S4 — Dead/decorative columns.** Migration adds `bank_account_id` (never written by the service) and `supplier_invoice_lines.order_id` (explicitly inserted as `null`, despite the migration comment "Kept for traceability only … ON DELETE SET NULL"). Populate them if the report exposes the ids, or drop them. The comment/code mismatch will confuse the next reader.

**S5 — `supplier_payments` as the settlement vehicle needs a direction story (challenge #2).** The e2e inserts receipts with `orderSupplierId` + `orderId`, i.e. a receipt for money *in* must be parked on an arbitrary order *leg* of a money-*out* table, and any report summing `supplier_payments` as outbound cash now reads receipts as payouts — the exact contamination the invoice split was built to prevent. Given `invoices` earned its own table for this reason, receipts deserve the same treatment (`direction` column or `supplier_receipts`). At minimum: verify no outbound-payment reader sums this table unfiltered; make `order_id`/`order_supplier_id` nullable for receipts so operators don't fabricate legs. Related test smell: the settlement e2e guards its only API-path assertion with `if (viaApi.status === 200)` — make it unconditional, or admit the route doesn't settle.

**S6 — `dueDate` = period end + 30 is invented (challenge #5).** Fine as a default for launch, but put `termsDays` (or an explicit `dueDate`) in the POST body or tenant settings now, before Moxie discovers a supplier with 14-day terms. Also validate `from <= to` on the date inputs.

**S7 — Stale-cache class (challenge #7).** Reads serve `amount_received` from the cache; only writes through the ledger helpers refresh it. Any out-of-band payment edit (support SQL, a future bulk tool) leaves a stale figure with no self-heal. Either recompute on detail read (cheap, one SUM) or wrap every payment write path in the helper and assert it in review. Also: `applySupplierPaymentToInvoice` and `recomputeSupplierInvoiceReceived` run on ambient `db`; if the caller is mid-transaction they should accept `tx`.

**S8 — Sequence never resets at year rollover, while the template embeds `{YYYY}`.** `SINV-2027-0043` continues from 2026's 42. Unique, but many accountants expect per-year restart. Confirm intended; if not, key `supplier_invoice_number_sequences` on `(tenant_id, year)`.

**S9 — Smaller items.**
- Suppliers with *negative* period totals are skipped with reason `'no commission in the period'` — mislabeled; a clawback is not "no commission".
- List route is unbounded and N+1 (`rows.map(getSupplierInvoice)` — 3 queries per row); `getSupplierInvoicesByIds` exists, does the same thing, and is unused. Pick one, batch the reads.
- No PDF for VOID (400) is fine, but the voided DTO still shows `amount_received` while its payments have been detached — the audit view then contradicts itself cosmetically.
- Void/reissue is sound (see Q3), but there is no e2e for concurrent issue (two parallel POSTs) — the advisory-lock claim is currently verified only by reasoning. One `Promise.all` test would pin it.
- Classic layout branch: as stated, unexercised. Its remittance block prints lines verbatim so it's immune to M3; still worth one snapshot render test.
- `invoiceBelongsToTenant` selects `bankDetailsSnapshot` it never reads.

---

## Answers to the eight challenges

1. **Separate table vs payer column** — agree, and it's the strongest part of the design. All four customer readers infer payer from `orders.client_id` with no party column to key off; a nullable payer would be a filter someone forgets, in four places. Duplicated status semantics is the cheaper cost. No disagreement.
2. **`supplier_payments` home** — weakest point; see S5. Same contamination logic you used for `invoices` applies here. Fixable without touching the invoice design.
3. **Void releasing `source_key`** — sound. Concurrent re-issues serialize on the per-tenant advisory lock, and the plain unique index covers any path that bypasses it; a void racing an issue is resolved by the index (the inserter blocks on the in-flight update, then either conflicts → clean "already invoiced" or proceeds). No double-bill path found. The real cost is M2's number burning, not double billing.
4. **Live issuer branding** — split the difference: logo/accent fine live; VAT/address/registration should be frozen, as the bank block already is (S1).
5. **Due date** — acceptable default, make it an input (S6).
6. **Multi-leg exclusion** — correctly no-money in the data, but operationally this commission is *never* invoiced and recovery depends on a human reading `skipped`. Acceptable for launch; needs a tracked follow-up and visible surfacing in the UI.
7. **Cache vs payments** — the disagreement path exists and is described in S7.
8. **Missed items** — M1 (cross-tenant number collision), M4 (currency in the settlement sum), S2 (does the document always foot?), and the conditional API assertion in the settlement e2e are the ones not already on your list.

---

## Conditions for approval

Fix M1–M4 before commit (all are small, and M1/M3 get harder with live data); resolve M5 by verifying or enforcing; S5 needs at least the verification half. Everything else is follow-up-safe.

**APPROVE-WITH-CONDITIONS.**
