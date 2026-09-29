Let me work through this carefully. This is a round-2 verification review. I have the full current source in Appendix A. I need to:

1. Verify each fix (M1-M5, S1-S9, and the extras)
2. Hunt for bugs introduced by the fixes
3. Confirm/refute the "still open" claims (7 items)
4. Give a verdict

Let me go claim by claim, since the author explicitly asked me to attack those claims.

---

**Claim 1: Does the M2 fix actually close the hole?**

The flow in `createSupplierInvoicesFromReport`:
- Report built OUTSIDE the lock (explicitly noted).
- Then `db.transaction` opens, takes `pg_advisory_xact_lock(hashtext('supplier-invoices:tenantId'))`.
- Inside the lock loop: for each supplier with positive commission, check `source_key` via `tx.select`. If present → `alreadyInvoiced`, continue (no allocation).
- If not present, allocate number on `tx`, insert with `onConflictDoNothing({ target: sourceKey })`, handle `!inserted` fallback.

Number burning analysis:
- The pre-check inside the lock prevents allocation on retries. Good.
- But: what if the insert fails for a reason *other* than the source_key conflict? E.g., the new `supplier_invoices_tenant_number_unique` (tenant_id, invoice_number) — if two tenants... no wait, same tenant here. Within the same tenant, allocation is serialized by the advisory lock, so the sequence gives unique numbers within the tenant. Actually wait — is the allocation unique per tenant? `supplier_invoice_number_sequences` is keyed by tenant_id (PK), and the upsert increments last_seq. Within the advisory lock, only one issuer at a time per tenant, so numbers can't collide... unless the sequence row was somehow reset or the number was manually inserted. Edge case: a tenant could have existing invoices with numbers not from the sequence (e.g., restored data), and the sequence could mint a colliding number → the insert fails on `tenant_number_unique` → transaction rolls back → allocation rolled back too (since it's on `tx`). So no number burned, but the whole transaction fails including all *other* suppliers already created in the loop. Hmm, that's a bulk-failure mode: one bad supplier aborts the entire batch, and the numbers allocated for previously-created suppliers in the same transaction also roll back (fine, no gaps), but the invoices created for them roll back too. So a partial-batch behavior: everything rolls back, the operator sees an error. Is that a regression? It existed before presumably. Not a fix-introduced bug per se.

Wait — actually there's a subtle issue with the number burning question: the advisory lock is taken per tenant. `allocateSupplierInvoiceNumber` does an upsert on the sequence table. Since it's on `tx` now, a rollback undoes the increment. Good.

But here's a real hole: **the void path**. `voidSupplierInvoice` sets `sourceKey: null`. The unique index is a plain (non-partial) unique index on `source_key`. Postgres treats NULLs as distinct, so voiding releases the key. Then reissuing creates a NEW invoice with the same source_key — fine. But the *number*: the sequence continues from where it was, so the reissued invoice gets a new number. Fine, documented.

Now the race question: "is there any path where a number is still burned, or where two callers could both pass the pre-check?"

Two callers both pass the pre-check: both callers take the advisory lock (per-tenant, `pg_advisory_xact_lock` — transaction-scoped, so held until commit). Caller A holds the lock, does pre-check, inserts, commits → lock released. Caller B then acquires the lock, does its pre-check, sees A's row (committed, since A committed before B's check ran... wait, is that guaranteed?).

Hmm. Isolation levels. If the DB runs at READ COMMITTED (default), B's SELECT after acquiring the lock will see A's committed row. Yes — under READ COMMITTED, each statement sees a fresh snapshot, so B sees A's commit. Under REPEATABLE READ, B's transaction snapshot is taken at its first statement — which is the `pg_advisory_xact_lock` execute, i.e., *before* A commits? No wait — B blocks on the lock. When does B's snapshot get taken? In Postgres, under REPEATABLE READ, the snapshot is taken at the first query of the transaction, which here is the `SELECT pg_advisory_xact_lock(...)` statement itself. So B's snapshot is taken when it executes the lock statement — which blocks until A commits. Actually, does the snapshot get taken before or after the lock wait completes? The statement begins, takes its snapshot, then blocks on the advisory lock. Hmm — actually, for `pg_advisory_xact_lock`, the function is executed as part of the statement. The snapshot for a SELECT statement is acquired when the statement starts executing. If B's snapshot is taken before it blocks on the lock, then under REPEATABLE READ, after A commits and B proceeds, B's pre-check SELECT would NOT see A's row → both pass the pre-check → B tries to insert → the plain unique index on source_key → `onConflictDoNothing({ target: sourceKey })` catches it → `!inserted` → falls to the "already invoiced" branch which re-selects by source_key... under REPEATABLE READ, that re-select also wouldn't see A's row (same snapshot!) → `existing?.invoiceNumber ?? null` → pushes `invoiceNumber: null` into `alreadyInvoiced`. The operator sees "already invoiced" with a null number. Not a correctness disaster (no double billing — the conflict target saves it), but a cosmetic wrong answer.

BUT: the more critical question is what the default isolation level is. Most Node Postgres apps run READ COMMITTED (default). Under READ COMMITTED, B's statements each take fresh snapshots, so after acquiring the lock, B sees A's committed row. The pre-check works.

Also: what about the allocation racing? Under READ COMMITTED with the advisory lock held, only one allocator per tenant at a time. Fine.

Is there a path where a number is still burned? Consider: pre-check passes, number allocated on `tx`, then insert succeeds, lines insert succeeds, loop continues to next supplier. Suppose supplier #2's insert fails (e.g., data issue) → whole transaction throws → rollback → numbers for #1 and #2 roll back. No burn. Good.

What about the `!inserted` path? Number was allocated on `tx` before the insert attempted `onConflictDoNothing`. If the insert conflicts, `inserted` is undefined, and we `continue` — but the allocation already incremented the sequence **inside the transaction**, and the transaction is NOT rolled back; it continues and eventually commits. So in the conflict path, a number IS burned (allocated but never used) — the sequence increments and commits even though no invoice bears that number.

Wait, when can the conflict path trigger given the pre-check just passed under the lock? Only under REPEATABLE READ (stale snapshot) or if something else inserts outside the lock path — e.g., a human-created invoice with the same source_key? The comment says "every human-created invoice (source_key NULL)". Or... the void race: void sets sourceKey null, doesn't insert. Hmm. Actually another path: **the advisory lock is per-tenant keyed `supplier-invoices:${tenantId}`** — both issue and void take the same lock. So concurrent issue+issue serialize. The conflict path is essentially defensive under READ COMMITTED. But if the DB is REPEATABLE READ, this burns a number per retry. Is that likely? The claim says "verify the current version actually holds it" — the codebase default is presumably READ COMMITTED unless they set otherwise. I can't verify the pool config from the payload. I should flag this as a SHOULD-level note: the `!inserted` path leaves a burned number because the allocation isn't rolled back in that path; but the pre-check makes that path unreachable under READ COMMITTED. Actually wait — I should double check: does `onConflictDoNothing` + no conflict → `inserted` present; conflict → empty array → `inserted` undefined. Yes.

Hmm, but also there's a subtle one: the pre-check selects `where eq(supplierInvoices.sourceKey, sourceKey)` — no tenant filter! `sourceKey` embeds tenantId in the string (`${tenantId}:supplier-invoice:...`), so tenant scoping is baked into the key. OK fine.

One more: the report is built outside the lock. So two concurrent callers both build the report, then serialize on the lock. First creates; second's pre-check (inside lock, fresh statement) sees the row → alreadyInvoiced. No burn. Good. The report-outside-lock is fine for idempotency since the check is inside.

But — void racing issue: issue builds report outside lock, then enters lock; void takes lock. If void runs first (void of a *previous* period invoice?), irrelevant. The specific race in the comment: "the issuer reads 'no invoice for this key', the void commits" — with the pre-check inside the lock, the issuer's read is inside the lock, so this race is closed for issue-vs-void on the same key... Let's trace: invoice X exists for key K. Issue call starts, builds report, waits on lock. Void of X: takes lock, sets sourceKey null, commits, releases. Issue proceeds: pre-check for K → not found (released) → creates new invoice for K. That's the *intended* behavior (void makes the period billable again). Alternatively issue wins the lock first: pre-check finds X (still has key) → alreadyInvoiced → done. Then void runs. Operator must re-click. Deterministic either way. Good — the void lock genuinely makes ordering deterministic.

So Claim 1: the fix closes the hole under READ COMMITTED. The residual number-burn path is the `!inserted` fallback, which only triggers on a conflict that the pre-check should have caught — i.e., under serializable/repeatable-read isolation or if a row with that source_key is inserted by a non-standard path. Worth a SHOULD note. Actually, let me reconsider whether to make this a MUST. The pre-check + lock + onConflictDoNothing is belt-and-braces; the burn in the unreachable path is theoretical. SHOULD.

Also — one more path: **exceptions thrown between allocation and insert**? Allocation happens, then `dueDate` computed (pure), then insert. If insert throws (e.g., tenant_number_unique collision), tx rolls back → allocation rolled back. No burn. If the *lines* insert throws, same. OK.

And: allocation happens per supplier inside the loop — but note it's allocated even for suppliers whose insert later succeeds, obviously fine.

**Claim 2: Is the current void lock real?**

```js
await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(...))`);
  ... all the work ...
});
```

`pg_advisory_xact_lock` is transaction-scoped: acquired at that statement, released automatically at transaction end (commit or rollback). Since it's taken inside the `db.transaction` callback and all subsequent statements in the callback run on `tx` (same connection, same transaction), the lock is held across the work. The earlier broken version presumably took the lock in a separate transaction that closed before the work. Current version: correct. The tenantId for the lock is read *before* the transaction (the `[tenant]` select on `db`), but that's just the lock key material — reading the tenant_id outside the lock is fine since tenant_id of a row is immutable.

Wait — one thing: the initial select reads from `db` (no lock), gets tenantId. Then the transaction takes the per-tenant lock. All fine. And the `if (!row || row.status === 'VOID') return;` inside — returns from the callback, transaction commits (no-op). Fine.

Concurrency: an issue for the same tenant holds the same advisory lock (same hashtext key string `supplier-invoices:${tenantId}`), so void and issue serialize. ✓.

One nit: `voidSupplierInvoice` doesn't re-check tenancy inside, but the controller's `invoiceBelongsToTenant` check happens before calling. There's a TOCTOU between the controller's check and the void, but since the row can't change tenants, that's fine. Also `voidSupplierInvoice` itself doesn't guard "already VOID" → returns getSupplierInvoice which shows VOID. Fine.

Another nit: the void releases payments by setting `supplierInvoiceId: null` — but does NOT recompute anything on... well, the invoice is VOID so received doesn't matter. But the payments' amounts still exist as rows; they were "money received from a supplier" — now unlinked. The comment says "a settled invoice would strand its money" — hmm, actually unlinking means the payment rows persist but point at nothing. Is that right? The alternative (keeping them linked) would strand them against a voided invoice. Either way the money's location is ambiguous — that ties into still-open (a). Not a fix bug.

Actually wait — one potential bug introduced: void sets `sourceKey: null` and the unique index is a **plain** unique index, not partial. Postgres unique indexes treat NULLs as distinct, so multiple voided rows all have NULL source_key — fine, no conflict. The migration comment explicitly addresses this. ✓.

But — the migration comment says the plain index is used because Drizzle's `onConflictDoNothing` drops `targetWhere` and a partial index can't be inferred. That's accurate for Drizzle's behavior. And `onConflictDoNothing({ target: supplierInvoices.sourceKey })` emits `ON CONFLICT (source_key) DO NOTHING` which the plain unique index satisfies. ✓.

**Claim 3: Did the batched list rewrite change any observable figure?**

List computes `received = payments.reduce(...parseFloat(p.amount)...)` — **no currency filter**! The detail path (`getSupplierInvoice`) reads `amount_received` refreshed by `recomputeSupplierInvoiceReceived`, which filters `eq(supplierPayments.currency, invoiceCurrency)`.

So the list re-introduces exactly the M4 defect in a new location: a EUR receipt linked to a USD invoice inflates the list's `amountReceived` (and possibly flips derived status to PARTIALLY_PAID/PAID in the list) while the detail shows the filtered figure. List and detail can now disagree. This is a bug introduced by the S9 fix. The list should filter payments by `eq(supplierPayments.currency, row.currency)` inside the map — it has `row.currency` available. This is a MUST: it reintroduces the M4 class of defect (cross-currency inflation) in the list read path. Severity: the M4 throw in `applySupplierPaymentToInvoice` prevents *new* mismatches from being linked through the app path, but existing/bulk/SQL-linked mismatches and — more importantly — the list doesn't respect the invariant that recompute enforces. Actually wait — can a mismatched payment even be linked now? `applySupplierPaymentToInvoice` throws on mismatch. But: (1) payments linked before this fix deployed (production already deployed at bb842a3a — hmm, actually the fixes landed *before* deployment; "Already deployed to production after round 1's fixes landed"). (2) out-of-band SQL links — the S7 comment explicitly acknowledges out-of-band writes as a supported scenario (that's why getSupplierInvoice self-heals). So the list disagrees with the detail exactly in the scenario the module says it supports. Also `recomputeSupplierInvoiceReceived` is the definition; the list should match it.

Also — subtle: list sums `parseFloat(p.amount)` in JS float arithmetic; recompute sums in SQL `numeric(14,2)`. Rounding drift for many payments is possible (float addition of cents), minor. The bigger issue is currency.

Additionally: the list includes VOID invoices only when `includeVoid` — fine. And `deriveSupplierInvoiceStatus` in the list passes `amountReceived: received.toFixed(2)` — the derived status in the list is computed from the just-summed received, which again diverges from stored. If a stale stored `amountReceived` exists (out-of-band edit), list shows fresh, detail shows... detail self-heals first (recompute runs before read), so both are fresh. OK so the *self-heal* consistency: detail recomputes (and persists), list computes transiently. The figures agree *unless* currency mixing. So the primary regression is the currency filter omission. MUST.

Wait, let me double-check the list's payments query — `db.select({...}).from(supplierPayments).where(inArray(supplierPayments.supplierInvoiceId, ids))` — no currency column selected, no filter. And then `received = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0)`. Confirmed. MUST: filter by currency per invoice (or join against header currency). Also note `supplierPayments.supplierInvoiceId` is nullable — they guard `if (!p.supplierInvoiceId) continue;` in the grouping loop. ✓.

Also there's a subtlety about `paymentsByInvoice` typing: `typeof allPayments` includes supplierInvoiceId — fine.

Another observable change: list's derived status uses `received` fresh; previously (N+1 version) presumably used stored `amount_received` via getSupplierInvoice per row... actually round 1 said "three queries per row" — probably it called getSupplierInvoice per row, which did NOT recompute then (S7 said only the ledger helper refreshed the cache). So old list showed stale stored values; new list shows fresh values. That part is arguably a fix (self-healing), except for the currency hole. So: partially a fix, but with a reintroduced M4-class defect. Verdict on claim 3: **yes, list and detail can disagree; it's both — a fix for staleness, a regression for currency.**

Also: `amountOutstanding = Math.max(0, amount - received)` in the list uses unfiltered received — same hole.

**Claim 4: M4's throw — half-applied state?**

`applySupplierPaymentToInvoice(paymentId, invoiceId)` — called from `createSupplierPayment` *after* the payment row is inserted. Let me look at what I can infer: orders.service records supplier payments; the ledger module is imported there. The flow presumably: insert payment row → applySupplierPaymentToInvoice(paymentId, invoiceId). If it throws on mismatch:
- The payment row already exists (inserted before the call). If `createSupplierPayment` runs inside a transaction and the throw propagates → whole thing rolls back → payment not created. If it's NOT inside a transaction → payment row persists, unlinked (its `supplierInvoiceId` remains whatever it was — null presumably), and the caller gets a 500. The payment (money received from supplier) is recorded but not applied to any invoice. Operator retries with correct linkage.

Is a throw correct? The alternative (silently skip linking) would hide the error. The throw makes the mismatch visible. The half-applied state: payment exists, invoice link not set. Since the link is the only thing being changed in this function (before the throw, no mutation has happened — the throw occurs *before* the `update`), the payment is fully recorded and simply unlinked. That's arguably correct: the receipt is real, it just can't settle this invoice. The operator can relink later (after conversion — though "no conversion of non-USD commission" is claimed, so a mismatched payment just can't settle that invoice at all).

But I can't see `createSupplierPayment` — it's not in Appendix A. The claim says "It is called from createSupplierPayment after the payment row is already inserted." So the question is whether the throw leaves a half-applied state. From the code in Appendix A: `applySupplierPaymentToInvoice` throws *before* any mutation (the update to `supplierPayments.supplierInvoiceId` happens after the check). So the invariant "link and received amount never drift apart" holds — no partial mutation within this function. Whether the caller's insert rolls back depends on caller transactionality, which I can't verify. I should note: (1) within the function, no partial state; (2) recommend the caller either wrap insert+apply in one transaction or catch the mismatch and return a 4xx with the payment still recorded (since the receipt is real). Also note: the throw happens only when `invoiceId` is non-null — clearing a link never mismatches. ✓.

One more thing about the mismatch check: it joins `supplierPayments` with `supplierInvoices` on the passed `invoiceId` — but it selects from supplierPayments where id = paymentId, inner join invoices. If payment doesn't exist, `mismatch` undefined → skipped — but payment was fetched above, so fine. Case-insensitive comparison via toUpperCase — fine. Empty-string currency: `(paymentCurrency ?? '')` — if both empty, `'' === ''` passes and the link is allowed. Edge case: a payment with no currency linked to an invoice with no currency — both NOT NULL per... `supplier_payments.currency` — not shown in this migration, but the existing table; `currency text NOT NULL` on supplier_invoices. Probably fine.

Hmm, actually there's a subtle issue: in `recomputeSupplierInvoiceReceived`, the currency filter is `eq(supplierPayments.currency, invoiceCurrency?.currency ?? '')` — if invoice currency somehow empty, filter is `currency = ''` → sums nothing → received 0. Safe direction. Fine.

And a real nit in recompute: it does TWO selects for the invoice (first `id, status, amount`, then separately `currency`). That's a redundant query — minor inefficiency, could be one select. SHOULD-nit. Also `recomputeSupplierInvoiceReceived` is called by `getSupplierInvoice` on EVERY read — a write on every GET. Under concurrent reads this is write-amplification and a potential lock contention point, but it's idempotent. Also `updatedAt` gets bumped on every read → any `ON UPDATE` triggers/audit logging would fire on reads. Minor. Also — status rewrite: `status: nextStatus === 'OVERDUE' ? 'SENT' : nextStatus` — stored status never becomes OVERDUE, derive on read handles it. But note: recompute passes `daysOverdue = 0` — so stored status will never be OVERDUE (intended per comment) and never re-derives OVERDUE — the read path derives OVERDUE from dueDate. ✓ consistent.

Wait, but there's an interesting interplay: `getSupplierInvoice` recomputes first (writes), then reads. The recompute uses `daysOverdue = 0`, so an invoice that is stored as PARTIALLY_PAID but is overdue gets recomputed: received>0, amount not met, daysOverdue=0 → PARTIALLY_PAID → stored stays. Then the read derives with real daysOverdue → OVERDUE. Fine.

But there's one more: recompute derives status from `invoice.status` — if stored status is 'DRAFT', derive returns DRAFT. When is DRAFT used? Insert sets 'SENT' directly. OK.

**Claim 5: bank_details JSON for classic layout + remittanceLines null combos.**

Classic layout: `...(input.bankDetails ? [{ stack: ['REMITTANCE', ...remittanceLines(...)] }] : [])`. Named fields, no positional indexing. ✓ M3 closed for both layouts.

`remittanceLines`:
- `beneficiary` — if null → `''` → filtered out. If beneficiary is null but accountName exists: prints accountName alone (no label). Fine, it's a name line.
- Wait — `bank.beneficiary?.trim() ?? ''` — if beneficiary is null, `''`; filtered. If it's whitespace, `''`, filtered. ✓.
- `accountName && accountName !== beneficiary ? accountName : ''` — dedupe. ✓.
- bankName: unlabeled line. IBAN labeled "IBAN x", SWIFT labeled, "Currency x", branchAddress unlabeled. No positional parsing. ✓.
- Misleading line combos: if iban null but swift present → prints only "SWIFT/BIC ..." — fine. If ALL fields null except beneficiary → just the beneficiary name under "REMITTANCE" — slightly odd but not misleading (a beneficiary name alone isn't wrong info). If bank exists but everything null → `bankDetails` object is created whenever `bank` row found, with all-null fields possible → remittance shows just beneficiary (company name). Not misleading. Edge: `beneficiary` is `company?.name ?? tenant?.name ?? null` — could be a *different* company name than the invoicing company? company is looked up by `invoicingCompanyId` — same one. tenant name fallback — fine.

Hmm, one possible issue: in the SLEEK layout, `bank.beneficiary ?? ''` — fine. And `accountName: null` is passed for sleek (it takes `accountName: null` at the input level — wait, the sleek input has `accountName: null` as a separate top-level field and `bank.accountName` is never passed to sleek. The bank block for sleek passes beneficiary, bankName, iban, swift, branchAddress — no accountName. So the sleek layout loses the account name when it differs from beneficiary. Minor — SHOULD-nit, arguably deliberate ("the document can decide whether to print it twice").

The DTO: `SupplierInvoiceBankDetailsDto` — has beneficiary, accountName, bankName, iban, swift, currency, branchAddress. Service builds `SupplierInvoiceBankDetails` from schema type. Both should match — I can't see @fueld/types but the service constructs the same fields. Assume consistent.

**Claim 6: `executor: Pick<typeof db, 'insert' | 'select'>` — transaction compat.**

Drizzle's transaction handle (`tx`) is typically the same `PgDatabase` type shape (it's constructed from the same driver, `tx` has insert/select/etc.), so structurally a `Pick<typeof db, 'insert'|'select'>` is satisfied by the tx handle. Drizzle's `db.transaction(cb)` gives a `PgTransaction` which extends the same base — `.insert` and `.select` exist with compatible signatures. Yes, structurally satisfied. Could it silently fall back to `db`? Only if a caller omits the arg — default `= db`. Call sites: `allocateSupplierInvoiceNumber(tenantId, now, tx)` in create path — passes tx. ✓. Any other call sites? In Appendix A only one call. If elsewhere (not shown) calls it without executor, it uses db — that's the documented default for non-transactional use. Risk: TypeScript structural typing — `db.insert` on the root vs tx — signatures identical. The real risk would be runtime: if `tx` insert executes within the transaction — yes, same connection. ✓ Real fix.

One subtle Drizzle nit: `onConflictDoUpdate` on the sequence with `updatedAt: new Date()` — fine.

But wait — the deeper question: **does the allocation-upsert inside the advisory lock risk deadlock with the void?** Both take the advisory lock first, so serialized. ✓.

Another possible introduced bug: **`allocateSupplierInvoiceNumber` default param placement** — `now = new Date(), executor = db` — call passes `(tenantId, now, tx)` — positionally correct.

**Now the still-open items (Claim 7):**

(a) `supplier_payments` directional ambiguity: `supplier_payments` is "money we paid out" (paying suppliers for fuel) and now also receipts (suppliers paying us commission). The migration adds `supplier_invoice_id` to the same table. Directionally, a payment TO a supplier and a receipt FROM a supplier have opposite signs/meanings in the same table; presumably distinguished only by whether `supplier_invoice_id` is set (or by some `direction`/`type` column not shown). Confirmed still open — nothing in Appendix A disambiguates beyond the FK. Any report summing `supplier_payments` as outflow would now include commission receipts. This is a design-level ambiguity, still open. Confirmed. SHOULD (design debt, documented).

Actually — worse: void sets `supplierInvoiceId: null` on payments, which makes a commission receipt *indistinguishable* from a fuel payment. The comment even says payments "must not keep pointing at a voided document" — but nulling the link destroys the receipt's identity. The note on the voided invoice records the released sourceKey, but the payment rows lose their anchor. Hmm — is that "stranding the money" in the other direction? The original concern was the money being stuck against a voided invoice; the fix unlinks, which makes the payment a floating row. Since the payment's *supplier* is still known (supplier_payments presumably has counterparty/direction), the operator can relink to the reissued invoice. But there's no trace on the payment of which invoice it originally settled. Minor traceability loss — SHOULD note.

(b) multi-supplier-leg deals: report refuses to attribute; `result.skipped` gets entries with `supplierId: ''`, `supplierName: '—'` for `attributedToMultipleSuppliers`. Confirmed: no invoice, reported as skipped only. Is the skip visible enough? It's in the response of POST /. Confirmed still open (behaviorally intended, surfaced). The empty `supplierId` string is a bit gross in the DTO but functional.

(c) no concurrency e2e: Appendix A has no test files. Confirmed still open. Given the advisory lock + pre-check + onConflict belt-and-braces, the runtime is defended in depth, but the e2e proof is absent. SHOULD.

(d) `createCommissionOrdersFromReport` "N deliveries" note while counting lines: not in Appendix A (it's the customer-side service). Can't verify from payload — but the header comment in supplier-invoice.service says it mirrors that function. Since the fix list never claimed to fix it, presumably still open. I should state: not addressed in this diff; cannot confirm from the provided source, but nothing in the round-2 changes touches it → still open. Actually the supplier side writes `${supplier.lineCount} line(s)` — correctly says lines. The customer side is out of scope of Appendix A. Mark as un-verify-able but presumably still open (fix list doesn't mention it).

**Other bugs introduced by fixes — hunt more:**

1. **M5 role gate on POST / and void — what role does `auth.role` hold?** `auth.role !== 'ADMIN'` — if the auth guard's role enum is e.g. 'SUPERADMIN' or roles are 'admin' lowercase, this would lock out everyone (or the wrong people). Can't verify from payload — the authGuard isn't shown. Risk: if a legitimate superuser role exists that isn't exactly 'ADMIN', they're 403'd. SHOULD-flag: verify the role vocabulary. Also GET routes remain non-admin — reading supplier invoices is allowed to any authenticated user of the tenant. That matches "admin only" claims only for create/void, which is what M5 said. ✓.

2. **`getSupplierInvoice` is not tenant-scoped.** It selects by id with no tenant filter. The controller gates tenancy via `invoiceBelongsToTenant` — OK for those routes. But `voidSupplierInvoice` internally calls `getSupplierInvoice(id)` after its own tenant lookup — fine. But `getSupplierInvoice` as an exported function is an injection risk if called elsewhere without the tenant check — currently only the controller uses it (which checks). Also — TOCTOU between `invoiceBelongsToTenant` and `getSupplierInvoice` — immutable tenant, fine. Not a new bug.

3. **`getSupplierInvoice` performs a WRITE (recompute) on the read path — and it's called by the PDF route and detail route.** A read-only-role user triggers writes. Also: recompute's write happens on `db` outside any advisory lock — two concurrent reads both recompute → last write wins, idempotent, benign. But: **the recompute write could race with the void's payment-unlinking**: void unlinks payments (supplierInvoiceId: null) inside its transaction; concurrent getSupplierInvoice recompute reads payments... if recompute's sum runs while void holds the lock, recompute doesn't take the advisory lock — it just does plain selects/updates. The update `set amountReceived = received` where received was computed possibly *before* void's unlink committed → stale write AFTER void commits → voided invoice gets amountReceived refreshed to the pre-void sum. Does that matter? Invoice is VOID; derive returns VOID regardless of amounts. And a subsequent recompute (on next read) sums 0 (payments unlinked) → heals. Benign. But there's a nastier race: recompute's UPDATE doesn't check `status` — it can overwrite status of... it derives from the read status. If void commits between recompute's read and write, recompute writes status='SENT' (or PAID) over 'VOID'? Let's see: recompute read row (status SENT), void commits (status VOID, sourceKey null, payments unlinked), recompute computes nextStatus from stale read: SENT + received sum (computed when? recompute sums payments AFTER reading the invoice row — the sum query runs after void may have committed → sum = 0 → nextStatus SENT) → UPDATE sets status='SENT' over the just-committed 'VOID'! **That un-voids the invoice!** Wait, really? The update: `.set({ amountReceived: received, status: nextStatus === 'OVERDUE' ? 'SENT' : nextStatus })`. If recompute's first read happened before the void commit (status='SENT'), then payment sum after void commit = 0, nextStatus = 'SENT' (received 0, amount>0 → not PAID, daysOverdue 0 → 'SENT'), and the UPDATE overwrites status='VOID' with 'SENT'. The invoice is un-voided! voidedAt stays set, sourceKey stays null, but status flips back to SENT → it reappears in lists (includeVoid=false excludes only status VOID), PDF route would render it again!

Is this race plausible? getSupplierInvoice's recompute is not inside any transaction or lock: read invoice (t0), read currency (t1), sum payments (t2), update (t3). Void's transaction commits between t1 and t3 → overwrites VOID. Window is milliseconds; but getSupplierInvoice is called BY voidSupplierInvoice itself right after — no, that's after commit, sequential. The race needs a *concurrent* read from another request (e.g., someone has the invoice open, detail auto-refreshes) exactly while an admin voids. Plausible but narrow. Is this NEW? recompute existed in round 1 (the ledger helper existed; S7 said the cache existed refreshed by the ledger helper). The NEW thing is S7's fix calling recompute on every read — that widens the race surface (reads now write). Before, recompute ran only on payment-link writes, which couldn't interleave with a void commit in this pattern as easily... actually they could: applySupplierPaymentToInvoice on another invoice — no, different invoice id. The recompute-on-read substantially increases frequency of unprotected read-modify-write on the invoice row. I'd call this a MUST or strong SHOULD: make recompute's UPDATE conditional (`where status != 'VOID'`) or re-read status in the UPDATE, or take the advisory lock, or derive status in the UPDATE from current row. Simplest robust fix: add `.where(and(eq(id), notInArray(status, ['VOID'])))` or better: only write if changed, and include `WHERE` guarding. Or run recompute inside a transaction with a row lock (`FOR UPDATE`). I'll mark MUST (data-integrity: void can be silently undone) — well, how severe? It requires a concurrent read during the void's commit window; the voided invoice flipping to SENT re-exposes it in lists and allows PDF rendering. That's a genuine integrity defect introduced/widened by the S7 fix. MUST.

Hmm wait, let me double check the sequence in recompute: first select (invoice row: id, status, amount) — then second select (currency) — then sum — then derive — then update. The void: update supplierInvoices set status VOID; update payments set null; commit. For the corruption: recompute's invoice select must precede void's commit, and recompute's update must follow void's commit. Since void's writes are fast and recompute has 3 queries between, the window is realistic under concurrent load. Yes. Also the payments sum in recompute may or may not see the unlink depending on ordering; either way the status overwrite is the killer.

Also the same race exists between recompute and ANY status transition (e.g., another payment linking that recomputes → both compute and write; last-writer-wins on amountReceived — both derived from payment sums, self-healing next read; only VOID transitions are destructive since VOID is a terminal state set by a different mechanism).

I'll write this up as the headline introduced bug: "S7's read-path recompute performs an unlocked read-modify-write that can overwrite a concurrent VOID with SENT/PAID."

Also `getSupplierInvoice` recomputes even when the invoice doesn't exist — recompute no-ops. ✓. And recomputes for VOID invoices: derive('VOID') → status stays VOID, update writes status VOID + amountReceived (sum of unlinked = 0) — benign but still a write per read. Fine.

4. **List route `includeVoid` query parsing**: `query.includeVoid === 'true'` — string compare; any other value ('1', 'TRUE') → false. Minor, matches t.String schema. Fine.

5. **`listSuppliersWithSupplierCommission`**: matches existing invoices by (tenant, periodFrom, periodTo, not VOID) — doesn't filter currency... fine, invoice numbers per supplier. If a supplier was invoiced then voided, `alreadyInvoiced: null` → billable again. ✓ consistent with void semantics. Note: it doesn't filter by supplierId in the notInArray status... it selects all invoices for the period and maps by supplierId — if the same supplier has TWO invoices for the same period (possible? source_key is released on void, so void+reissue → two rows same period, one VOID one SENT; map keys by supplierId → last wins, both have same number? No — different numbers, map holds the later row's number). Edge OK.

6. **`createSupplierInvoicesFromReport` — `invoicingCompanyId` resolution**: S1 fix is in the PDF route (resolve by id AND tenant). But at ISSUE time, the issuer lookup: `counterparties.preferredInvoicingCompanyId` fetched by `eq(counterparties.id, supplier.supplierId)` — **no tenant filter on this lookup!** `supplier.supplierId` comes from the report, which is tenant-scoped presumably, so the id is a tenant-owned counterparty — fine. Then `fallbackCompany` is tenant-scoped (`isOwnCompany`) ✓. Then `[company]` lookup by `eq(counterparties.id, invoicingCompanyId)` — **no tenant scoping!** If `preferredInvoicingCompanyId` on a supplier points at another tenant's company (possible? FK-wise counterparties.id is global; the preferred id is set by... unknown validation), the invoice snapshots another tenant's company name and bank account (`bankAccounts.counterpartyId = invoicingCompanyId`, isDefault). The S1 fix addressed the PDF *render* path (logo/address/VAT via live lookup scoped by tenant) but the issue-time snapshot lookup by bare id remains unscoped. However, at PDF render time the live lookup IS tenant-scoped, so the leak at render is closed; the *snapshot* (invoicingCompanyName, bankDetails) is frozen from the unscoped issue-time lookup. Hmm — is the snapshot actually cross-tenant reachable? `preferredInvoicingCompanyId` is a column on counterparties; whether the app validates it belongs to the same tenant is not visible. The bank account lookup: `eq(bankAccounts.counterpartyId, invoicingCompanyId)` — if invoicingCompanyId is another tenant's company, we snapshot THEIR bank account onto OUR invoice and print THEIR IBAN for remittance. That's a money-routing risk, worse than a logo! Round 1 flagged S1 as the render path; the fix claims "Resolves by the stored invoicing_company_id AND tenantId" — true for the render path, but the issue-time resolution (where bank details actually come from!) is by bare id. Should be: scope the issue-time company/bank lookups by tenant too (`and(eq(id), eq(tenantId, tenantId))`), and validate `preferredInvoicingCompanyId` tenant match. Given the PDF fix is scoped but the *snapshot* source isn't, this is a genuine remaining hole. MUST? The severity: it requires a counterparty whose preferredInvoicingCompanyId points cross-tenant — a data condition, not attacker-controllable via this route necessarily. I'd mark MUST (add tenant filter) since it's a one-line fix and the failure mode is printing a foreign IBAN on a payment demand. Hmm, but is it plausible the FK/validation already guarantees same-tenant? Not visible. I'll mark it MUST with the caveat, or strong SHOULD. Let me decide: The round-1 S1 concern was exactly "another tenant's same-named company could supply its logo/address/VAT". The fix closed render; issue-time lookup by id is not name-based, so cross-tenant requires a dangling preferred id. But the fallback company IS scoped. And the `company` lookup by bare id is only used if invoicingCompanyId non-null, which comes from either supplier's preferred (unvalidated) or scoped fallback. So the exposure hinges on preferredInvoicingCompanyId validation elsewhere. I'll mark SHOULD (MUST if preferred id isn't validated at write time — recommend the one-line tenant scope regardless). Actually, for a payment document (IBAN printing), I lean MUST: defense in depth, trivially cheap. Let me call it MUST — "add eq(counterparties.tenantId, tenantId) to the issue-time company and bank account lookups (or validate preferred id's tenant at set time); the render-path scoping alone doesn't protect the snapshot."

Hmm, wait — also the bank account lookup has no tenant scoping at all: `bankAccounts.counterpartyId = invoicingCompanyId AND isDefault`. bankAccounts may or may not have tenant_id. Scoping the counterparty id by tenant covers it.

7. **`onConflictDoNothing({ target: sourceKey })`** — with plain unique index, `ON CONFLICT (source_key) DO NOTHING` — Postgres infers the plain unique index. ✓ (migration comment documents why not partial). But — plain unique index on a nullable column: multiple NULLs OK (distinct). ✓. However — `ON CONFLICT (source_key)` will also swallow conflicts... only on source_key. The tenant_number_unique is a second unique index — a conflict on (tenant_id, invoice_number) would NOT be caught by `onConflictDoNothing target sourceKey` → raw 42P07-style unique violation error → whole tx rollback → 500. When could number collide within tenant? Sequence is per-tenant and allocation is under the advisory lock, so only if sequence resets below max existing (manual restore) or numbers inserted by hand. Defensive concern, minor. SHOULD-nit at most.

8. **Due-date computation**: `new Date(`${to}T00:00:00Z`)` + termsDays → slice(0,10). `to` validated as `^\d{4}-\d{2}-\d{2}$` by the controller schema. ✓. `settings.supplierInvoiceTermsDays` — `Number.isFinite(settings.supplierInvoiceTermsDays)` — if settings JSON has it as a string ("30"), Number.isFinite("30") is false → default 30. If stored as number ✓. Type `TenantSettings` presumably `supplierInvoiceTermsDays?: number`. OK. Negative values allowed (e.g., -5 → due before period end) — no clamp; minor. Zero → due = period end. Fine.

9. **`daysOverdue` parse**: `new Date(`${dueDate}T23:59:59.999Z`)` — due date end-of-day UTC. Fine.

10. **Controller PDF route**: `return buffer;` after setting Content-Length — fine. `createPdfBuffer(docDefinition as never)` — the classic branch returns an object with `footer: input.footer` — pdfmake expects `footer: (page, count) => content`. ✓ shape.

11. **PDF VOID gate**: `if (invoice.status === 'VOID')` — but `getSupplierInvoice` derives status via deriveSupplierInvoiceStatus — stored status VOID → derived VOID ✓. But the race from #3: if the void got overwritten by a recompute (the bug above), the PDF would render a voided invoice. Consequence of bug #3.

12. **`assertSupplierInvoicesEnabled` on all routes**: S3 — candidates ✓, POST / ✓, GET / ✓, GET /:id ✓, /pdf ✓, void ✓. All six routes gated. ✓.

13. **`invoiceBelongsToTenant`**: added; checks tenant_id directly on supplier_invoices ✓ (better than the comment in GET /:id which claims "comparing through its supplier company's tenant" — the comment is stale relative to the implementation, which uses supplier_invoices.tenantId directly. The comment above the GET /:id check says "enforced by comparing the invoice's tenant through its supplier company's tenant" — but invoiceBelongsToTenant selects supplierInvoices.tenantId. Stale comment — SHOULD-nit.) Also: GET /:id calls `getSupplierInvoice` BEFORE the tenant check — so the invoice data (lines/payments) is loaded and the recompute write happens even for a foreign tenant's id, then 404. Information isn't leaked (404 body), but the recompute write on a foreign tenant's invoice is a side effect — cross-tenant write triggered by an unauthorized read. Combined with #3's race this is more surface. Minor, but worth noting: do the tenant check first, or make getSupplierInvoice tenant-scoped. SHOULD. Also the double lookup (getSupplierInvoice then invoiceBelongsToTenant(invoice.id)) — two queries + a write for a 404. Efficiency nit.

14. **Void route**: `body?.reason ?? null` — body optional; Elysia schema `t.Optional(t.Object({...}))`. `voidSupplierInvoice(params.id, body?.reason ?? null)` — if body is `{reason: undefined}` → null ✓.

15. **`voidSupplierInvoice` returns `getSupplierInvoice(id)`** — recomputes (write) after commit ✓ benign; returns the VOID dto. ✓. But if row missing → earlier tenant select returns null → controller already checked existence though. ✓.

16. **Payments in DTO from list**: `paidAt: p.paidAt.toISOString()` — paidAt presumably NOT NULL. ✓.

17. **`amount` string ops**: `parseFloat(row.amount ?? '0') || 0` — numeric → string via pg driver. ✓.

18. **`getSupplierInvoice` recompute then read — non-transactional**: between recompute and read, another payment could link → read shows stale amountReceived... next read heals. Benign.

19. **Migration 0135**: `supplier_invoice_number_sequences` with `tenant_id ... PRIMARY KEY` — the REFERENCES + PK inline — `tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE PRIMARY KEY` — valid Postgres? Column can be both FK and PK via inline constraints — yes, `ALTER`/column constraints compose; `PRIMARY KEY` inline after `ON DELETE CASCADE` is syntactically fine.

`ALTER TABLE supplier_payments ADD COLUMN supplier_invoice_id uuid REFERENCES supplier_invoices(id) ON DELETE SET NULL;` — ON DELETE SET NULL: deleting a supplier invoice nulls the payment link. But supplier invoices are never deleted (voided). Fine.

Missing in migration: no `currency` on supplier_payments shown (existing table). No index on `(tenant_id, period_from, period_to)` for `listSuppliersWithSupplierCommission` — has tenant_supplier_idx; period queries scan a tenant's rows — fine at this scale.

Wait — one migration-level check for M1: dropped global unique on invoice_number — the migration 0135 as shown CREATEs the table with plain `invoice_number text NOT NULL` and `CREATE UNIQUE INDEX ... (tenant_id, invoice_number)`. Since it's a fresh table in this migration, nothing to drop ✓ (the "global unique" was presumably in an earlier version of this same migration pre-fix — since 136 migrations applied cleanly on fresh DB, the final state is what's shown). ✓ M1 closed. Note: unique per (tenant, number) — void keeps its number (not reused) ✓ consistent.

But — subtle M1-adjacent: `renderSupplierInvoiceNumber` template per tenant from settings; sequence per tenant; unique (tenant, number). If the tenant changes the template mid-year to one that produces the same string as an existing number (e.g., switching from {SEQ:4} to {SEQ} — `SINV-2026-12` vs `SINV-2026-0012` differ; but a template WITHOUT year, e.g. 'SINV-{SEQ}' reused after a year, would collide with... 0012 vs 12? padStart only on {SEQ:4}; 'SINV-{SEQ}' at seq 12 → SINV-12, next year SINV-12 again if sequence persists — sequence is global per tenant (no year reset), so no collision unless template changes. Fine — collision → raw unique violation → 500 + full rollback (see #7). Acceptable, note as nit.

20. **The `{SEQ:4}` regex**: `.replace(/\{SEQ:(\d+)\}/g, ...)` runs BEFORE `.replace(/\{SEQ\}/g, ...)` ✓ order correct (otherwise `{SEQ}` would match inside `{SEQ:4}`? `\{SEQ\}` requires literal closing brace right after SEQ — `{SEQ:4}` has `:` after SEQ so no match anyway). ✓.

21. **Claim: "Report is built outside the lock"** — the author flags it. Consequence: two concurrent POSTs both build the report (duplicate work, fine); the check is inside the lock so no double-billing. But one more: the report reflects data as of its (unlocked) snapshot; a payment/void happening during report build could make the report stale — but the invoice created uses report figures; that's inherent. Fine.

But WAIT — one more M2 subtlety: the pre-check is `tx.select ... where sourceKey`. Under READ COMMITTED, statements inside the transaction see the latest committed data. The advisory lock ensures no other *issuer/void* for this tenant is mid-flight. But what about issuers for the SAME tenant that don't take the lock? All paths shown take it. Any other writer of source_key? Not shown. ✓.

And: is `hashtext` collision across different lock key strings possible? hashtext returns int4; two different tenants could hash-collide → spurious serialization between unrelated tenants — harmless (only performance). Also collisions with OTHER advisory lock usages in the app that use hashtext of other strings — e.g., `createCommissionOrdersFromReport` "the same construction" — if it uses hashtext('commission-orders:tenantId') etc., a cross-collision just over-serializes. Harmless.

22. **`daysOverdue` for the list derived status**: list uses `daysOverdue(row.dueDate)` ✓ same as detail. ✓ consistent.

23. **`deriveSupplierInvoiceStatus` epsilon**: `received + 0.005 >= amount` → PAID. If amount 0 and received 0 → PAID (second condition). If amount < 0 (shouldn't) and received 0 → `amount <= 0 && received <= 0` → PAID. Fine.

24. **DRAFT unreachable**: insert always 'SENT'. The enum has DRAFT; derive handles it. Dead but harmless.

25. **`assertSupplierInvoicesEnabled` reads `tenant?.settings?.brokerDeals?.enabled === true`** — TenantSettings type includes brokerDeals presumably. ✓.

26. **Classic PDF**: `rate` shown raw (`l.rate` from `parseFloat(line.rate).toLocaleString(...)` up to 4 decimals, NO currency/unit label) — the sleek shows `${rate} ${currency}/${unit}`. Classic just the number under "Rate". Fine.

`formatQty(null)` → '' and `${l.quantity} ${l.unit}` → `' '` — a blank qty cell. Fine.

27. **`buildLines` description**: `[productType, vesselName ? '— vessel' : ''].join(' ')` — if productType empty and vessel set → " — Vessel"? `filter(Boolean)` removes '' → "— Vessel" with leading "—" joined... `['', '— Ever Given'].filter(Boolean).join(' ')` → "— Ever Given". OK.

28. **The void note**: `[row.note, reason ? 'VOID: ...' : 'VOID', sourceKey ? 'released ...' : null].filter(Boolean).join(' | ')` — appends to note each void... but void is guarded by `row.status === 'VOID'` early-return, so single append. ✓.

29. **`createSupplierInvoicesFromReport` — `supplier.lineCount`** note ✓ says "line(s)" ✓ (fixes (d)'s analog on the supplier side).

30. **Claim 3 extra**: list includes `bankDetails: row.bankDetails ?? null` — the full bank details blob in the LIST response for every invoice — payload bloat; detail-level data in a list. Nit. Also `hasBankDetails`. Fine.

31. **`listSupplierInvoices` headers read**: `db.select().from(supplierInvoices).where(inArray(...))` — re-reads all columns for ids already fetched in the first query (which selected only id). Two passes over supplier_invoices; could have selected everything in the first query. The first query exists to apply filters; then headers re-read WITHOUT the filters — by id only, ids already tenant-scoped ✓. Fine, mild redundancy.

Wait — actually there's a subtle correctness point: the first query filters tenant + optional supplier + not-void; the headers query is by ids only — no tenant filter needed since ids came from tenant-scoped query. ✓.

32. **`payments` ordering in list**: `desc(paidAt)` ✓ same as detail.

33. **`SupplierInvoiceBankDetails` vs DTO naming** — service uses schema type `SupplierInvoiceBankDetails`; document uses `SupplierInvoiceBankDetailsDto` from @fueld/types. Service assigns `bankDetails` to `SupplierInvoiceBankDetails | null` then row.bankDetails (jsonb, typed as SupplierInvoiceBankDetails presumably via `$type<>`) — assume wired. Can't verify schema TS file. Assume ✓.

34. **`invoiceBelongsToTenant` used in void BEFORE voidSupplierInvoice's own tenant read** — double read; void then re-reads tenant inside. Redundant but fine.

35. **M5 — auth.role** — covered in #1 above.

36. **`createSupplierInvoicesFromReport` issuer select**: `const [issuer] = await tx.select({companyId: counterparties.preferredInvoicingCompanyId}).from(counterparties).where(eq(counterparties.id, supplier.supplierId))` — supplier.supplierId from report; report is tenant-scoped (presumably filters orders by tenant) — but is the supplier counterparty guaranteed tenant-owned? The report groups by supplier on tenant's orders; a counterparty id from a tenant's order legs — could an order reference a cross-tenant counterparty? If orders' supplier_id FK isn't tenant-constrained... speculative. The company/bank lookups (#6) are the concrete unscoped ones.

37. One more on **claim 1**: "two callers could both pass the pre-check" — also consider two DIFFERENT periods overlapping? source_key includes from/to, so different periods → different keys → both create — intended (periods are distinct statements; overlapping periods would double-bill the same commission, but that's an operator choice, not a race). Not a defect per se — but worth one line: idempotency is per exact (from, to) string; issuing both `2026-01-01→2026-01-31` and `2026-01-15→2026-02-15` double-bills overlapping commission. Round 1 didn't flag; not introduced by fixes. SHOULD-note maybe. The UI picker presumably prevents. I'll mention briefly.

38. **`getSupplierInvoice` write-on-read + PDF route** — the PDF route triggers recompute → status stored update — fine.

39. **Check `recomputeSupplierInvoiceReceived`'s two selects** — nit noted.

40. **Check M4's sum filter**: `eq(supplierPayments.currency, invoiceCurrency?.currency ?? '')` — invoice currency NOT NULL, so `?? ''` only if invoice row missing (guarded by earlier return). ✓.

41. **`applySupplierPaymentToInvoice` recompute of previous invoice** — sets affected = {previous, new}; recomputes both ✓. But it does the link-update and recomputes non-atomically (no transaction): crash between → link set, received stale — next read heals (S7). ✓ acceptable.

42. Void: does NOT recompute other invoices — unlinking payments from the voided invoice; those payments now settle nothing; no other invoice affected. ✓.

43. `supplierPayments` in list select includes rows where supplierInvoiceId null? `inArray(supplierInvoiceId, ids)` — null excluded by IN ✓ (and guarded again in grouping).

Now the verdict. MUSTs found in round 2:
- MUST A (introduced by S7): recompute-on-read is an unlocked read-modify-write that can overwrite a concurrent VOID with SENT/PAID — un-voids an invoice (reappears in lists, PDF renders again). Fix: guard the UPDATE (`WHERE status NOT IN ('VOID')` / re-read status in the update predicate), or take the tenant advisory lock, or compare-and-skip.
- MUST B (introduced by S9): list sums payments with no currency filter — reintroduces the M4 defect in the list; list and detail disagree. Fix: filter by row.currency in the reduce (payments already loaded; need currency in the select).
- MUST C (fix-incomplete, S1): issue-time company/bank lookup by bare id is tenant-unscoped; the snapshot (invoicingCompanyName + bankDetails incl. IBAN) can come from a foreign tenant if `preferredInvoicingCompanyId` isn't validated. One-line tenant predicate.

Hmm, is MUST C too aggressive? The S1 fix as described ("Resolves by the stored invoicing_company_id AND tenantId") — the fix as applied covers the render path only. The issue path was the original hazard too (round 1 said "could supply its logo/address/VAT" — that was render). The bank snapshot at issue is new-ish (M3 touched its storage). Given a payment document, I'll keep MUST C but frame it as "complete the S1 fix at issue time; cheap and the failure mode is a foreign IBAN printed on a payment demand."

SHOULDs:
- The `!inserted` conflict fallback still leaves the sequence incremented (number burned) in that path — unreachable under READ COMMITTED + lock, but make it safe: either move allocation after a conflict-safe pattern (e.g., insert first with a placeholder? no) — simplest: on `!inserted`, note it; or accept and document. Actually can we avoid? The pre-check makes it near-unreachable; the fallback is defense. A burned number in a pathological path is acceptable; but mention as SHOULD: under REPEATABLE READ the pre-check could go stale (snapshot taken at lock statement) — verify pool isolation is READ COMMITTED, and know that in the `!inserted` path the earlier allocation persists (burn) — consider `SET TRANSACTION READ COMMITTED` explicit or a comment. Wait, actually, under REPEATABLE READ, would the pre-check see stale? The snapshot is taken at the first statement of the transaction = the lock SELECT. If the lock SELECT blocks on A's lock, B's snapshot predates A's commit → B sees no row → both pass pre-check → B's insert conflicts (unique index is physical, not snapshot-based) → onConflictDoNothing → !inserted → alreadyInvoiced with re-select that ALSO sees nothing (same snapshot) → invoiceNumber: null. So under RR: no double-bill ✓, no burn... wait, the allocation happened before the insert attempt → seq incremented → committed → burn! Yes under RR every RR-retry burns. Default is READ COMMITTED for node-postgres pools unless configured. SHOULD: confirm isolation; optionally the alreadyInvoiced re-select under RR can return null number.

- GET /:id and /pdf call `getSupplierInvoice` (which now WRITES via recompute) before the tenancy check → cross-tenant id triggers a recompute write on another tenant's invoice, plus the stale comment about "through its supplier company's tenant" (implementation is direct tenant_id). SHOULD: tenant-check first / scope getSupplierInvoice.
- Void unlinking payments leaves no trace on the payment of the original invoice — relink is by eyeball; also feeds (a).
- (a) confirmed: directional ambiguity of supplier_payments stands; void's null-link makes it worse.
- (b) confirmed: multi-leg orders skipped with reason only.
- (c) confirmed: no concurrency e2e in evidence.
- (d) cannot verify from payload (file not included) — nothing in the fix list claims it was fixed; assume still open; supplier side says "line(s)" correctly.
- Sleek layout drops `accountName` when it differs from beneficiary (classic prints it; sleek passes beneficiary only + accountName: null at top level).
- auth.role vocabulary: confirm 'ADMIN' is the exact enum value (else M5 lockout).
- Overlapping-period double-billing is allowed by design (idempotency is per exact date pair).
- Redundant double select in recompute; recompute write-amplification on every GET (consider skipping write when values unchanged).
- Sequence-collision on (tenant, invoice_number) → raw 500 + full-batch rollback (e.g., after data restore with sequence behind max) — consider catching and re-allocating.

Also verify each M-fix explicitly:
- M1 ✓ closed: unique (tenant_id, invoice_number) index; column comment.
- M2 ✓ closed under READ COMMITTED: pre-check inside lock, allocation on tx (rolls back with tx). Residual: conflict-path burn + RR snapshot caveat.
- M3 ✓ closed: jsonb + named fields + remittanceLines, both layouts.
- M4 partially: recompute filters currency ✓; applySupplierPaymentToInvoice throws ✓ (pre-mutation, no half-applied state within the function; caller impact depends on createSupplierPayment's transactionality — not shown); BUT list path re-opens the hole (MUST B).
- M5 ✓ closed on both routes (subject to role vocabulary check).
- S1 render ✓; issue-time snapshot unscoped (MUST C).
- S3 ✓ all six routes gated.
- S4 ✓ orderId threaded (line.orderId ?? null; report DTO presumably carries it — assumed from fix description; the code passes it).
- S7 ✓ self-heal implemented — but introduces MUST A race.
- S9 ✓ N+1 gone (3 queries + header read... actually: first ids query + 3 parallel = 4 queries total, constant) — but currency filter lost (MUST B).
- Void lock ✓ real (claim 2 confirmed).
- Due date configurable ✓.
- from<=to ✓ throws.
- Settlement e2e assertion ✓ claimed (not in payload, take on trust; the route path fix can't be verified — no test file in Appendix A. I should note payload doesn't include the e2e file so S-fixes to tests are taken on trust).

Claim 6 answer: `Pick<typeof db, 'insert'|'select'>` — Drizzle tx satisfies structurally (PgTransaction exposes insert/select with same signatures); it cannot "silently fall back to db" unless a caller omits the arg; the only call site passes tx. ✓. One caveat: if someone later calls allocateSupplierInvoiceNumber without a tx while INSIDE a transaction, default db would allocate on a different connection — could deadlock with the tx if the tx later touches the sequence row... actually the issue path holds the advisory lock and any external allocator wouldn't take the lock → the upsert on the sequence row: tx A (locked) upserts seq row (holds row lock till commit); external db call upserts same row → blocks until A commits → fine, just waits. No deadlock unless external is itself inside a transaction holding other locks the first needs. Edge. Not worth much.

Claim 4 answer detail: The throw happens before any mutation in applySupplierPaymentToInvoice, so no half-applied state *within the function* — the link is unchanged, both invoices' caches untouched. The payment row itself was inserted by the caller before the call; whether that insert survives depends on createSupplierPayment's transactionality (not in payload). If not transactional: payment persists unlinked — which is arguably CORRECT (the receipt is real; it just can't settle this invoice) but the operator sees a 500, and the payment is recorded — need the caller to either (i) wrap in tx so the whole thing 4xx/5xx cleanly, or (ii) catch and return a 4xx "payment recorded but not applied: currency mismatch". Should verify. Mark SHOULD: inspect createSupplierPayment (not in payload) to confirm tx-wrapping or graceful handling; a 500 after the insert is the likely UX if unwrapped.

Claim 5 answer: remittanceLines handles nulls without misleading labels ✓; every field explicitly labelled or omitted; dedupes accountName===beneficiary; empty-only combinations reduce to beneficiary-only or nothing — the whole REMITTANCE block is omitted when bankDetails is null ✓. Sleek also named fields ✓. One gap: sleek never prints accountName.

Now, the verdict: three MUSTs — one data-integrity race introduced by S7, one currency regression introduced by S9, one incomplete S1 scope at issue time. All are small, surgical fixes. NO-GO or APPROVE-WITH-CONDITIONS? The feature is ALREADY DEPLOYED TO PRODUCTION. Hmm. The MUSTs: A is a narrow race (requires concurrent read during void commit — but voids are rare admin ops; consequence is un-voiding, bad); B is a straightforward figure divergence reachable whenever a mismatched-currency payment is linked out-of-band (the module explicitly supports out-of-band writes) — but note: can a mismatched payment be linked at all now? App path throws; out-of-band SQL can. So B requires out-of-band misuse to manifest... but M4's own rationale was exactly that scenario. Also — hmm, wait: can a mismatched payment exist *linked* from before the throw-guard deployed? The deployment was after fixes landed, so no pre-fix data... unless data existed from before (feature is new; deployed once). So B manifests only via out-of-band links. Still, the list is *the* place an operator scans totals; and the detail self-heals differently → guaranteed divergence in that scenario. Keep MUST.
C requires an unvalidated preferredInvoicingCompanyId — a data precondition; one-line fix. 

Given production is already live, the right call is APPROVE-WITH-CONDITIONS? Or NO-GO pending the three patches? The instructions: verdict among APPROVE / APPROVE-WITH-CONDITIONS / NO-GO. Since I found three MUSTs (one introduced by fixes, one reintroduced defect class, one incomplete fix) on an already-deployed money-handling feature, I'd say the fixes are *close* but the S9 regression (MUST B) is a one-line change, MUST A a one-predicate change, MUST C one predicate. None require re-architecture. Given it's a verification round on deployed code, I'll go APPROVE-WITH-CONDITIONS with the three MUSTs as blocking conditions for the next patch, and explicitly say: don't roll back, patch forward; the deployed state is acceptable to leave running only because the trigger conditions are narrow, but the patch should ship promptly. Hmm — or should a money-document un-voiding race force NO-GO? The race window: recompute's invoice read → void commit → recompute's update. getSupplierInvoice is called constantly (list views call listSupplierInvoices not getSupplierInvoice — getSupplierInvoice is detail/PDF/void-return). Detail views are less frequent. And it requires the read to interleave precisely. Rare. And self-heals? Once flipped to SENT, does anything heal it back? Next getSupplierInvoice → recompute reads status SENT (not VOID) → recomputes normally → stays SENT. voidedAt is still set but status SENT — list shows it (includeVoid false → included since status SENT!), PDF renders it (status !== 'VOID'). Does NOT self-heal. Permanent corruption until manual fix. That's why it's MUST. But still, APPROVE-WITH-CONDITIONS with ship-immediately conditions seems right for a verification round; NO-GO usually means the design/implementation is fundamentally unacceptable. I'll go APPROVE-WITH-CONDITIONS (conditions = the three MUSTs) and note that if the team's policy is "any MUST on deployed money code = rollback", the alternative is a fast-forward patch since all three are tiny.

Let me also double-check MUST A once more — is the update in recompute truly able to overwrite VOID? 

```
const [invoice] = await db.select({ id, status, amount }).from(supplierInvoices).where(eq(id)).limit(1);
if (!invoice) return;
... currency select ...
... sum ...
const nextStatus = deriveSupplierInvoiceStatus({ status: invoice.status, ... }, 0);
await db.update(supplierInvoices).set({ amountReceived, status: nextStatus === 'OVERDUE' ? 'SENT' : nextStatus, updatedAt: new Date() }).where(eq(supplierInvoices.id, invoiceId));
```

Yes: `invoice.status` read at t0; if void commits at t1 > t0, update at t2 writes status derived from pre-void status. If pre-void status was 'SENT' and received sums to 0 (payments unlinked by the void, visible if sum ran after void's commit — but even if sum ran before, received could be >0 → PARTIALLY_PAID) → writes 'SENT' or 'PARTIALLY_PAID' over 'VOID'. Confirmed. Also the inverse race (recompute reads after void → derive('VOID') → writes VOID back — fine/idempotent).

Also: could this race have existed pre-S7? recompute was called by applySupplierPaymentToInvoice (on payment links) and by... round 1's S7 said "cache that only the ledger helper refreshed" — so recompute ran on payment writes. A payment-link recompute concurrent with a void could also have overwritten VOID then. So the race pre-existed S7; S7 *widened* it from "payment-link writes" to "every read". So "introduced by" is partially true — "materially widened by". I'll phrase it accurately: pre-existing race, but the S7 fix put an unlocked RMW on every GET/PDF/detail read, multiplying exposure; still a MUST because void is now guarded by a lock that this path bypasses — the void's whole serialization argument (claim 2) is undermined by recompute not taking the lock. That's the cleanest framing: **the void lock is real, but recompute-on-read doesn't take it, so the serialization guarantee has a bypass.** The fix for claim 2's lock is correct as far as it goes; the bypass is the issue.

Also check: does voidSupplierInvoice's own final `getSupplierInvoice(id)` race anything? Sequential after commit ✓.

One more possible introduced bug to check: `getSupplierInvoice` calls recompute even when row won't be found — recompute no-op ✓. And in the PDF route, `getSupplierInvoice` runs before tenancy check → recompute WRITE on foreign tenant's invoice via cross-tenant id probing — an authenticated user of tenant X can cause writes (updatedAt bumps, status rewrites) on tenant Y's invoice row by hitting /supplier-invoices/:id/pdf with Y's id. Not data *disclosure* (404), but a cross-tenant write side effect. Combine with MUST A: user X's probe-read could even participate in the un-void race on tenant Y's invoice. Add to the SHOULD about ordering the tenancy check first (or fold into MUST A's fix). I'll put it as its own SHOULD (or fold: "make getSupplierInvoice tenant-scoped" solves both).

Also verify claim 3's "regression or fix" answer: both — staleness fixed (transient fresh compute), currency regressed. Also note list now writes NOTHING (pure read) while detail writes — so list can show fresh figures even when the stored cache is stale, meaning list≠stored-but-both-uncorrupted... consistent with detail because detail recomputes first. The ONLY divergence driver is currency. Good, crisp answer.

Let me also sanity-check the reduce float issue: `parseFloat("1234.56")` sums in IEEE double — cents-exact up to 2^53, fine for realistic totals; SQL numeric sum vs JS float sum can differ by rounding at 14-digit scale — negligible; skip or one-line nit. Skip.

Also `p.amount` in payments DTO is passed raw (string from numeric) while header amounts are `.toFixed(2)` — fine.

Check controller `POST /` body: `t.Object({from: DateOnly, to: DateOnly})` ✓ validates format, service re-validates order ✓.

`listSuppliersWithSupplierCommission` — `query.from/to` validated ✓. It builds the report outside any lock — fine (read-only picker).

Migration nit: `supplier_invoices_source_key_unique` — PLAIN unique index means `ON CONFLICT (source_key)` works, and also means... a human insert with a source_key colliding would fail — comment covers. And `WHERE sourceKey = X` lookups use the index ✓.

Index for `listSuppliersWithSupplierCommission`: filters tenant_id + period_from + period_to — `supplier_invoices_tenant_supplier_idx` covers tenant prefix ✓ adequate.

Missing index: `supplier_payments.supplier_invoice_id` — created ✓.

One more thing: `voidSupplierInvoice` reads the row INSIDE the tx AFTER taking the lock — but the initial tenant read is outside; if the invoice is deleted between (rows are never deleted) — fine.

Also `voidSupplierInvoice` — after tx, `return getSupplierInvoice(id)` — recomputes first: derive reads stored status VOID → stays VOID ✓; amountReceived recomputed from unlinked payments = 0 → sets amountReceived 0 on a VOID invoice — rewriting the historical received figure on a voided document! Hmm: pre-void, invoice had received 5000 (status PAID). Void unlinks payments, then getSupplierInvoice → recompute sets amountReceived=0 on the voided row. The voided document now shows received 0. Is that a problem? The payments were deliberately unlinked ("must not keep pointing at a voided document"), so recompute naturally zeroes. Audit-wise, the voided invoice's received history is lost (payments unlinked anyway, so it's consistent). The alternative (keep amountReceived) contradicts unlinking. It's coherent; just note that void erases the settlement trace on the invoice row (ties to
