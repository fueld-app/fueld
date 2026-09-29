Let me work through this carefully. I'm reviewing a supplier-invoice feature for a bunker brokerage (Moxie). The payload gives me the design rationale, verification evidence, and full source of the new files. I need to deliver: findings (MUST/SHOULD action items), disagreements, answers to the 8 specific challenges, and a verdict.

Let me read the code carefully for real bugs.

## File 1: `supplier-invoice.service.ts`

### `allocateSupplierInvoiceNumber`

```ts
export async function allocateSupplierInvoiceNumber(tenantId: string, now = new Date()): Promise<string> {
  const [seq] = await db
    .insert(supplierInvoiceNumberSequences)
    .values({ tenantId, lastSeq: 1 })
    .onConflictDoUpdate({...})
    .returning({...});
```

**BUG #1: This uses `db`, not `tx`.** In `createSupplierInvoicesFromReport`, the number is allocated INSIDE the transaction (`tx`), but `allocateSupplierInvoiceNumber` uses the global `db` handle. Wait — is that a correctness problem? With Drizzle + node-postgres, `db.insert(...)` outside a transaction runs on a pooled connection. Inside the outer transaction callback, `tx.execute` etc. run on the transaction's connection. So `allocateSupplierInvoiceNumber` runs on a DIFFERENT connection than the transaction. That has two consequences:

1. **The sequence increment is not covered by the transaction.** If the transaction rolls back (e.g., line insert fails), the sequence number is still consumed — creating a gap. Gaps in invoice numbering are usually acceptable (and they claim elsewhere "a gap... cannot look like a problem in this one" — they even acknowledge gaps elsewhere). Actually wait, they say the separate series means a gap in the customer series doesn't look like a problem here — they don't claim gap-free. So gap-on-rollback is a minor issue.

2. **More seriously: deadlock/lock-ordering and consistency.** Actually the bigger issue: `allocateSupplierInvoiceNumber` reads `tenants.settings` for the number template via `db` again — fine.

3. **Deadlock risk between the advisory lock (held on tx) and the sequence upsert (on a different connection)?** The advisory xact lock is on the tx connection. The sequence insert is a separate autocommit statement on another connection. Two concurrent issues for the same tenant: T1 takes advisory lock on conn A; T2 waits on advisory lock (on its own conn B). T1 then allocates a number on conn C (autocommit, brief row lock on the sequence row, released immediately at statement end). No deadlock there because the sequence update commits immediately. Actually wait — could there be a deadlock between the sequence row lock and the advisory lock? T1 holds advisory lock and briefly locks sequence row; T2 waits for advisory lock before touching the sequence row. So the sequence row lock is always taken while holding the advisory lock (for issue flows). Ordering is consistent: advisory → sequence. No deadlock. OK.

But there IS a real issue: **the number is allocated on a different connection than the transaction, so if the transaction rolls back AFTER allocating (e.g., the line insert fails), the number is burned but the invoice doesn't exist** — a gap. Acceptable in most invoice systems, but worth flagging as SHOULD.

Actually wait, more subtle and more serious: since the number allocation happens on `db` (autocommit), and then the invoice insert happens on `tx`, the unique constraint on `invoice_number`... The number can't be duplicated because the sequence is atomic (upsert returning). Fine.

Hmm, but actually is `db.insert` inside a transaction callback really using a separate connection? In Drizzle with node-postgres, `db` uses a pool; each `db` call checks out a connection. If you're inside `db.transaction(async (tx) => {...})`, calls on `tx` use the transaction's session; calls on `db` check out a NEW connection from the pool. Yes, separate connection. So sequence increments survive outer rollback. Gap on rollback — SHOULD note.

Actually, there's a worse variant: if the pool is exhausted... not realistic. Fine.

### Idempotency and the report-outside-the-lock

The report is built OUTSIDE the advisory lock, then the lock is taken, then per supplier: conflict-do-nothing on sourceKey. The unique index makes double-issue impossible regardless of lock. The lock serializes... The comment says holding the lock across the report query would serialize unrelated admin requests — fine.

**BUG/risk #2: `allocateSupplierInvoiceNumber` is called BEFORE the insert even when the invoice already exists.** Look:

```ts
const now = new Date();
const invoiceNumber = await allocateSupplierInvoiceNumber(tenantId, now);
...
const [inserted] = await tx.insert(supplierInvoices).values({... sourceKey }).onConflictDoNothing({ target: supplierInvoices.sourceKey }).returning();
if (!inserted) { ... alreadyInvoiced ... continue; }
```

So on a repeat call for an already-invoiced period, the sequence is INCREMENTED even though no invoice is created. That means the SINV series burns numbers on every idempotent retry. E.g., issue SINV-0001; second call → sequence goes to 2, no invoice created, "already invoiced SINV-0001"; then a void + reissue → SINV-0003? Wait let's trace: seq row starts at 1 → SINV-0001 issued (seq=1). Second call: seq→2, conflict, nothing created. Reissue after void: seq→3 → SINV-0003? Hmm, with the template `SINV-{YYYY}-{SEQ:4}` it's SINV-2026-0003. The e2e test "void + reissue with a NEW number" only checks `not.toBe(issued.invoiceNumber)`, so a gap wouldn't fail the test. But the verification claims "SINV-0007... SINV-0008" — consistent with gaps being real (they ran many times presumably).

This is a real defect worth flagging: **number allocation should happen after (or only when) the insert succeeds, or the sequence should roll back with the transaction.** Simplest fix: move `allocateSupplierInvoiceNumber` to use `tx` (pass tx as a param) so the increment rolls back with the failed insert — on conflict-do-nothing nothing is inserted so no number was needed at all. But you need the number BEFORE insert... Alternative: check existence first inside the lock (SELECT by sourceKey), skip if exists; else allocate + insert. The pre-check inside the advisory lock is race-free because the lock serializes issues per tenant. Actually the lock is per tenant via `hashtext('supplier-invoices:${tenantId}')` — all issue calls for the same tenant serialize. Void sets sourceKey to NULL without taking that advisory lock, but that doesn't create duplicates, it releases.

Hmm wait, but there's a subtler race: the fix "check existence first inside the lock" works only if every writer of sourceKey holds the lock. `voidSupplierInvoice` clears sourceKey without taking the advisory lock. Race: T1 issues (holds lock), inserts invoice with key K. T2 voids invoice... void doesn't need the lock because it only clears the key. Then T3 issues again: takes lock, sees no row with key K, allocates new number, inserts. Fine.

Race in current code (challenge #3): void racing an issue. Scenario: T1 (issue) builds report outside lock, takes advisory lock, starts inserting supplier rows one by one. Meanwhile T_void voids an EXISTING invoice for the same supplier+period (from a previous issue) — clears its sourceKey, no lock. Now T1's insert with the same sourceKey succeeds → the period is billed twice: once by the voided invoice (number kept, but VOID status) and once by the new invoice. Is that a double bill? The voided one is void — it's not collectible, doesn't count in lists by default, PDF 400s. So the outcome is: void + reissue, which is exactly the intended semantics. Not a double bill.

But what about: void racing issue where the issue is IN FLIGHT for the same key? T1 inserts invoice (status SENT, key K) — commit pending. T_void (separate transaction) reads the invoice... void does a SELECT (autocommit, sees committed data only), so it can't see T1's uncommitted row. No issue.

What about two concurrent voids? `voidSupplierInvoice` reads row, checks status !== VOID, then UPDATE. Two concurrent voids: both read status=SENT, both proceed to update; second overwrites the first's voidedAt and appends another "VOID" to the note. Minor: duplicated note text, double timestamp overwrite. Not a money bug. Could use a conditional `WHERE status != 'VOID'` and return early. SHOULD.

**BUG #3: `voidSupplierInvoice` doesn't take the advisory lock, and it uses `db` (autocommit) rather than a transaction, BUT the update of `supplierInvoices` and `supplierPayments` are two separate statements.** If the process dies between them, payments still point at a voided invoice. Minor consistency: `amount_received` on a voided invoice doesn't matter for collections. The unlink of payments is itself questionable — see challenge #2 discussion below.

Actually wait — bigger issue with void unlinking payments: **voiding an invoice with payments recorded rewrites the payments' `supplierInvoiceId` to NULL, orphaning the receipts.** Then the receipts can't be re-linked to the reissued invoice automatically; `recomputeSupplierInvoiceReceived` is not called for the voided invoice (no need) nor for the new one (no payments linked). If the supplier had partially paid and you void + reissue, the new invoice shows 0 received even though money came in. The user must manually relink each payment. Is that right? The design says "Payments already logged against it must not keep pointing at a voided document, or a settled invoice would strand its money." Hmm — actually the rationale is backwards: unlinking strands the money MORE. If a payment pointed at a voided invoice, the money is at least traceable to the period. By nulling the link, the recompute for the NEW invoice sees nothing → the new invoice demands the full amount again → **risk of double-chasing / double-billing the supplier for money already received.** The safer semantics: on void, keep payments linked to the voided invoice (they're historical), and on reissue either auto-link open payments or at least surface "this supplier has unapplied receipts of X". At minimum, `recomputeSupplierInvoiceReceived` should be called after the unlink (currently it isn't — but for a voided invoice the status is VOID and recompute... actually recompute would rewrite status from derive() which returns VOID — fine but pointless).

Wait, actually let me re-read `voidSupplierInvoice`... it updates supplierPayments to set supplierInvoiceId null, but does NOT call recompute for anything. Since the voided invoice's status is VOID, its amountReceived cache is stale-but-irrelevant. OK.

But the real money-safety issue: **payments unlinked from the voided invoice are not re-linked to the reissued one; the reissued invoice shows amountReceived=0 while the supplier has already paid some of it.** This is a genuine operational double-collection risk. I'd mark MUST or strong SHOULD: block voiding a PARTIALLY_PAID/PAID invoice (require unapplying payments first, like most AR systems won't let you void a paid invoice without credit note), or auto-transfer the payments to the new invoice on reissue... auto-transfer is wrong if amounts differ. Standard AR: cannot void an invoice with payments applied; must unapply/credit first. I'd say: refuse void when amountReceived > 0, or at least warn and require explicit confirmation + relink flow. Given this is a money document and the stated concern is double billing, I'll make this a MUST-level finding: voiding an invoice with recorded receipts silently orphans the receipts.

Hmm, but is it MUST-block-worthy? The review verdict overall — let me collect all findings then decide.

### Challenge #3 more: released key + concurrent issue

Advisory lock is `pg_advisory_xact_lock(hashtext('supplier-invoices:<tenantId>'))` — held across the whole loop, per tenant. Void doesn't take it. Double bill via released key: 

- T1: void invoice V (key K released, V keeps number). 
- T2: issue for same period: takes lock, inserts new invoice with key K. Fine — one live invoice.
- Concurrency: T1 void and T2 issue in flight simultaneously — T2's insert with key K: at the time T2 inserts, if T1's void hasn't committed, the unique index still holds K → conflict-do-nothing → T2 reports "already invoiced" with V's number. Then T1's void commits → now nothing is billed and the caller was told "already invoiced (V)" — V is void. The user retries and gets the new invoice. Slightly confusing but not a double bill. Actually is it possible T2 reads `existing.invoiceNumber` (V's number) and reports alreadyInvoiced, then void commits — caller believes it's invoiced when it's now void. Retry fixes. Minor.

- Two concurrent issues after release: both serialize on the advisory lock → second gets conflict → alreadyInvoiced. Safe.

So challenge #3: no double-bill path found, given the unique index + lock. The only wrinkle: the void-without-lock means a void can interleave with the per-supplier loop of an issue transaction, but each supplier's insert is either conflict-blocked or fresh; can't see how you get two live rows with the same key because the unique index is the backstop (any commit-ordering yields at most one row with K at a time; void clears it and a later issue inserts; if issue commits first and void... void only voids committed rows it selected; a void of a row selected BEFORE... void reads V (committed, SENT), then updates to VOID; meanwhile T2 inserts a second row with K? No — K is still held by V until void commits (sourceKey=NULL is part of void's update, which commits atomically). Until void commits, K is taken → T2's insert conflicts → no insert. After void commits, T2 (if it runs after) inserts fine. If T2's conflict happened BEFORE void commit, T2 sees "already invoiced". If T2's transaction started before but its INSERT executes after void commits → insert succeeds → new live invoice + voided V. Fine, intended.

So: safe. But one more: **`onConflictDoNothing({ target: sourceKey })` then `tx.select` for existing — inside the same transaction it sees its own snapshot...** After a conflict-do-nothing, the SELECT by sourceKey: the conflicting row was committed before the transaction's snapshot? Under READ COMMITTED, each statement gets a new snapshot, so the SELECT sees the committed conflicting row. Good — that's why `alreadyInvoiced.invoiceNumber` resolves. Under REPEATABLE READ it could miss, but Postgres default is READ COMMITTED. OK.

### Report-outside-lock staleness

The report is built BEFORE the advisory lock and BEFORE the transaction. If a new broker deal is confirmed between report build and insert, the invoice won't include it; reissue requires void. Standard TOCTOU but low severity for a period statement. SHOULD note maybe. Not a money-loss.

### `getSupplierInvoice` status derivation — challenge #7

`getSupplierInvoice` derives status from `row.amount`/`row.amountReceived` — but it does NOT recompute from payments; it trusts the cached `amountReceived`. The ledger comment says the stored status is a cache moved only when a payment is recorded "through the app". Where is recompute called from? `applySupplierPaymentToInvoice` and `recomputeSupplierInvoiceReceived` — the latter called from `orders.service` presumably when recording supplier payments via API (test shows `/orders/{id}/supplier-payments` with `supplierInvoiceId` body — the orders route applies it). If a payment is edited/deleted OUTSIDE those paths (e.g., direct DB edit, or a different route that edits supplier payments without recomputing), the cache goes stale and `getSupplierInvoice` returns the stale number. The design acknowledges this ("Amounts are the truth; the stored status is a cache"). But the DTO's `amountReceived`/`amountOutstanding` come from the cache, NOT recomputed. So a reader CAN see a stale figure if a payment is recorded through a path that doesn't recompute. Which paths touch supplierPayments? I can't see all of them (orders.service not in appendix). The claim in challenge #7: "amount_received is recomputed from payments on read paths." But LOOK at the code: `getSupplierInvoice` reads `row.amountReceived` — it does NOT recompute from the payments it just fetched! It even SELECTs the payments list but uses `row.amountReceived` for the figures. So the read path does NOT recompute; it uses the cache. The recompute happens on write paths (payment link). So the answer to #7: yes, there is a path — any write to `supplier_payments` that doesn't go through `applySupplierPaymentToInvoice`/`recomputeSupplierInvoiceReceived` (e.g., a payment updated via some other orders.service route, a deleted payment, an amount edit) leaves the cache stale, and reads will show stale figures. Given the design's own principle ("amounts are the truth"), the read path should derive received = sum(payments) — it already fetches them! It fetches the payments but then ignores them for the total. That's a cheap, obvious fix: compute `received` from the fetched payments list (or SQL sum) in `getSupplierInvoice` instead of trusting the cache, and keep the cache for list performance. This is a genuine MUST/SHOULD. Since payments are already loaded per-invoice in `getSupplierInvoice`, computing the sum client-side is trivial. But `listSupplierInvoices` N+1s `getSupplierInvoice` per row (also `getSupplierInvoicesByIds`) — an N+1 with 3 queries per invoice; for a list page that's fine-ish but it also means the list could compute sums too. I'd flag: derive on read (MUST for money correctness per their own principle), and fix N+1 (SHOULD).

Wait — is it really a MUST? The only writers of supplierPayments with supplierInvoiceId: the orders route (calls applySupplierPaymentToInvoice per the test's comment), and... void (unlink, no recompute — but voided invoices don't display money). Editing/deleting a payment: does the orders route call recompute on edit/delete? Unknown — not in the appendix. The test deletes a payment directly in DB and calls recompute manually, implying the API edit/delete path may or may not recompute. Since I can't verify orders.service, and the design explicitly says the cache "only moves when a payment is recorded through the app", any admin script/DB edit breaks it. The principle stated is "amounts are the truth" — but then the read path uses the cache. That's an internal inconsistency. I'll mark it as a MUST to derive on the detail read path (payments are already fetched — zero extra cost) or at minimum document and recompute in every payment mutation path. Actually for the detail endpoint, computing from already-fetched payments is free; there's no reason not to. MUST? It's a stale-money display risk on a receivables document → chase-the-wrong-amount risk. I'll say MUST (cheap fix) or strong SHOULD. Given evidence-first terseness, I'll mark SHOULD→MUST... Let me decide: the feature's own invariant is "amounts are the truth, status is a cache". The read path violating it is a bug against the stated invariant. Mark MUST for the detail path (free fix), SHOULD for the list path (N+1 + recompute in SQL).

### Void + `daysOverdue` — `deriveSupplierInvoiceStatus` call in getSupplierInvoice passes `daysOverdue(row.dueDate)` — fine. OVERDUE beats PARTIALLY_PAID — they documented it.

### `listSupplierInvoices` N+1

`rows.map((r) => getSupplierInvoice(r.id))` — for each invoice: 1 select invoice + 1 select lines + 1 select payments = 3 queries per invoice. With, say, 50 supplier invoices that's 151 queries. SHOULD: batch with `inArray` (they even wrote `getSupplierInvoicesByIds`... which ALSO N+1s through getSupplierInvoice — it selects ids via inArray then loops getSupplierInvoice per id! `getSupplierInvoicesByIds` is a fake batch: the outer inArray is pointless because it then calls getSupplierInvoice(id) per row anyway. That's worth calling out — the "batch read for lists" comment is misleading; it's an N+1 with extra steps.)

Also `listSupplierInvoices` has no pagination — all invoices ever, minus voided by default. Fine for now, SHOULD.

### `assertSupplierInvoicesEnabled` — reads tenant settings; called per route. Fine.

### Gating: detail route doesn't check `assertSupplierInvoicesEnabled`!

Look at the controller: `/candidates`, POST `/`, GET `/` all check `assertSupplierInvoicesEnabled`. `GET /:id`, `GET /:id/pdf`, POST `/:id/void`: `void` checks it. Detail and PDF do NOT — they only check `invoiceBelongsToTenant`. So a tenant with brokerDeals DISABLED can still fetch detail and PDF of a supplier invoice (if one exists — e.g., created while enabled, then the flag turned off). Is that a bug or deliberate ("the row's own tenant_id check")? The design says "every route 404s when the tenant's brokerDeals.enabled is false; the detail/PDF/void routes additionally check the row's own tenant_id". But the code shows detail and PDF do NOT check the flag — only void does. Contradiction between design claim and code. Wait, let me re-read the controller for `/:id`:

```ts
.get('/:id', async ({ auth, params, set }) => {
    const invoice = await getSupplierInvoice(params.id);
    if (!invoice || !(await invoiceBelongsToTenant(invoice.id, auth.tenantId))) { ...404... }
    return ...;
```

No `assertSupplierInvoicesEnabled`. And PDF likewise. Void has it. So the claim "every route 404s when brokerDeals.enabled is false" is FALSE for detail and PDF. If the flag is off, an authenticated user of that tenant can still read and download invoices that exist. Is that harmful? The invoices were legitimately issued by that tenant; reading them seems harmless-ish, but the stated invariant is broken, and the nav hides the pages. Also `invoiceBelongsToTenant(invoice.id, ...)` — wait, there's something worse here. `getSupplierInvoice(params.id)` runs FIRST, WITHOUT any tenant filter, and builds the full DTO including lines and payments — then `invoiceBelongsToTenant` is checked. The data of a foreign invoice is fully read into memory before the tenancy check. Not a leak per se (response gated), but a foreign tenant id returns 404 — the design explicitly wants indistinguishability. OK, but there's a subtle leak: the PDF route... same pattern. Not exploitable via response. But: `invoiceBelongsToTenant` is called with `invoice.id` — fine.

Hmm wait, actually there IS a real discrepancy worth flagging: design says gating on all routes; code omits it on detail/PDF. If disabling broker deals is meant to revoke access to the whole feature (e.g., a tenant turns it off, or an admin wants the feature hidden), detail/PDF still work. I'd call this a SHOULD (consistency with stated invariant; the data belongs to the tenant anyway) — or is it deliberate softening? The controller docblock says "Every route is gated on the tenant's broker-deals flag". So the code contradicts its own docblock. MUST vs SHOULD: no cross-tenant leak (tenant check present), so it's an inconsistency, not a security hole. SHOULD — align code with the documented gate (or fix the doc).

Wait, actually let me double check the void route: it checks enabled + belongsToTenant. Detail/PDF: only belongsToTenant. Yes.

### `invoiceBelongsToTenant` selects `bankDetailsSnapshot` needlessly (harmless). 

### PDF route resolves the company by NAME: `eq(counterparties.name, invoice.invoicingCompanyName)` — **BUG: name is not unique, and not tenant-scoped.** `counterparties.name` has no unique constraint (names can repeat across tenants — the cross-tenant test creates tenants with own counterparties; a same-named company in another tenant would match first/arbitrarily). Worse, the invoice already stores `invoicing_company_id` in the table — but the DTO doesn't expose it, so the PDF route re-finds the company by NAME instead of by ID. The right fix: expose `invoicingCompanyId` in the DTO (or re-select from `supplier_invoices` which the route can do) and look up by primary key, scoped by tenant. Selecting by name across ALL tenants could pull another tenant's company details (address, VAT, logo) into this tenant's PDF if names collide. That's a cross-tenant data bleed onto a money document. I'd mark this MUST: resolve issuer company by `invoicing_company_id` (already stored), not by name.

Let me verify: `supplierInvoices` table has `invoicing_company_id uuid REFERENCES counterparties(id)` — yes, stored. The service's DTO doesn't include it. The controller does `invoice.invoicingCompanyName ? select ... where eq(counterparties.name, invoice.invoicingCompanyName) : []`. No tenant filter, no id filter. Real bug. MUST.

Also `.limit(1)` on a non-unique name — nondeterministic pick. MUST fix by using the stored id.

### Snapshot issuer branding (challenge #4)

Design: lines/amounts frozen; branding live. Reasonable, but the PDF's footer/address/VAT come from the live company row while `invoicingCompanyName` is frozen — if the company is renamed, the letterhead shows the frozen name in the header but the live name in the footer (`senderName: invoice.invoicingCompanyName ?? company?.name` — footer uses frozen name, but companyAddress/VAT live). Mixed frozen/live on the same doc could produce a header/footer mismatch after a rename. Minor; deliberate tradeoff; I'd accept with a note: it's consistent enough (letterhead is ours), but flag the rename-mix case as cosmetic. Also `brandColor`/`logo` live — fine.

One more PDF nuance: if branding is disabled, `layout` may be 'CLASSIC' — unexercised branch, they admit. The classic branch: `footer: input.footer` — pdfmake `footer` as a function is allowed. `defaultStyle`, `pageMargins` — ok. Table widths `'auto','auto','*','auto','auto','auto'` — 6 columns matching headers? Header row is `['Order','Customer','Product','Qty','Rate','Amount']` — 6 columns; body lines have 6 cells; totals row has 6 cells. OK. The classic table lacks the Unit column but prints `${l.quantity} ${l.unit}` — fine. Rate column shows `l.rate` (raw number, unformatted-with-currency) — in classic, rate is just the number without currency; in SLEEK it's `${rate} ${currency}/${unit}`. Minor inconsistency; classic unexercised anyway. SHOULD note: verify classic layout once, since money docs in a misrendered table (e.g., Rate column showing "19" with no currency/unit) could confuse a supplier.

Also SLEEK bank block: `input.bankLines[2]` is bankName by snapshot line ordering: [0]=beneficiary, [1]=accountName-if-different, [2]=bankName, [3]=IBAN..., [4]=SWIFT, [5]=Currency. But the snapshot builder FILTERS OUT the accountName when identical to beneficiary — so lines shift! If accountName is omitted (identical), bankLines = [beneficiary, bankName, IBAN..., SWIFT..., Currency...]. Then `bankLines[2]` (bankName) is actually the IBAN line? Let's index: bankLines[0]=beneficiary, [1]=bankName, [2]="IBAN xxx", [3]="SWIFT...", [4]="Currency...". The SLEEK branch does `bankName: input.bankLines[2] ?? null` → that would be "IBAN xxx" assigned as bankName; `iban: input.bankLines[3]?.replace(/^IBAN\s*/,'')` → "SWIFT xxx" with the IBAN-prefix-strip applied → stays "SWIFT BIC xxx" (replace doesn't match) → iban="SWIFT BIC XXX"; `swift: input.bankLines[4]` → "Currency USD". **The line-index-based parsing is broken when the accountName line is omitted (i.e., whenever account holder == company name, which the snapshot code itself says is "usually identical"!).** So in the COMMON case, the SLEEK PDF's remittance block is scrambled: bankName shows the IBAN line, iban shows the SWIFT line, swift shows the currency line. Wait — but the verification says the PDF "reads correctly at full resolution ... plus..." — did they verify the remittance block? They said "the remittance block snapshotted with the real Nordea IBAN" (that's the DB snapshot, SINV-0007/8 real data). The PDF render evidence: "INVOICE TO (SUPPLIER) — Thor Marine Trading SL", number, lines, and the commission sentence. **No claim that the PDF's bank block was verified.** And the e2e doesn't render PDFs. So this is a live, likely-hit bug: whenever `accountName === beneficiary` (the code comment says "usually identical"), the snapshot has 5 lines (or fewer) and the SLEEK parser mis-assigns them. Also if `accountName !== beneficiary` (6 lines), [2]=bankName — correct. So it's correct only in the less-common case. This is a MUST: parse the snapshot structurally (store JSON, or prefix-tag lines) rather than by position. Also the Currency line is dropped entirely in SLEEK (no field for it) — fine-ish.

Hold on, let me re-count the snapshot composition:

```ts
const bankDetailsSnapshot = bank ? [
  beneficiary,
  accountName && accountName !== beneficiary ? accountName : '',
  bank.bankName,
  bank.iban ? `IBAN ${bank.iban}` : '',
  bank.swiftBic ? `SWIFT/BIC ${bank.swiftBic}` : '',
  bank.currency ? `Currency ${bank.currency}` : '',
].filter(Boolean).join('\n') : null;
```

filter(Boolean) removes '' AND also removes falsy `bank.bankName` if null etc. So even in the 6-field case, if e.g. bankName is null, positions shift. Positional parsing of a variable-length, filtered array = fragile. In the common case (accountName identical or empty), the array is [beneficiary, bankName, "IBAN ...", "SWIFT/BIC ...", "Currency ..."] (5 entries). SLEEK mapping: bankName=bankLines[2]="IBAN ...", iban=strip(bankLines[3])="SWIFT/BIC ..." (regex doesn't match, so remains "SWIFT/BIC XXX"), swift=bankLines[4]="Currency USD". So the PDF would show bankName="IBAN DK..."; IBAN field="SWIFT/BIC ..."; SWIFT field="Currency USD". **The supplier cannot pay correctly from this.** On a commission invoice, the remittance block is the single most important block after the total. MUST fix: store the snapshot as structured JSON (label→value) or store bank_account fields in dedicated columns; parse by prefix (`startsWith('IBAN ')` etc.), never by index. The classic layout prints raw lines — correct. But Moxie uses SLEEK (default) → the real invoices today get the scrambled remittance block?? Wait — verification says PDF evidence with "the remittance block snapshotted with the real Nordea IBAN" — that's about the snapshot column, and the live PDF read lists header/meta/lines/sentence, NOT the remittance block. So plausibly the bug is live and unobserved. This is the strongest concrete finding. MUST.

Double-check `bankLines[3]?.replace(/^IBAN\s*/, '')` — if bankLines[3] is "SWIFT/BIC NDEADKKK", replace returns it unchanged → iban="SWIFT/BIC NDEADKKK". Yes. And in SLEEK, `accountNumber: null`, `branchAddress: null`. So the visible remittance fields: beneficiary (correct), bankName (wrong), iban (wrong), swift (wrong). Unless sleek layout also prints... whatever it prints, it's mis-assigned.

Also `Currency` line never displayed in SLEEK — the invoice currency is in totals anyway. OK.

### Due date (challenge #5)

`dueDate = periodTo + 30d`, invented. The report presumably knows the orders' supplier payment terms? Not visible. Recommendation: make it a tenant setting (`brokerDeals.supplierInvoiceDueDays`, default 30) — one-line change — and surface the due date in the confirm UI before issuing. SHOULD, not MUST (it's explicit on the document, and Daniel can ask for a change → void+reissue). But note: since void+reissue is the only correction path and due date is baked in, a wrong due date means void/reissue churn → supports configurability. Also: dueDate is NOT stored on... it's stored, but is it editable? No edit route at all. So a wrong due date requires void. SHOULD: add dueDays setting; consider an edit-due-date admin action (no money figures change) — optional.

Also period-end +30 uses UTC — fine.

### Challenge #6 multi-leg exclusion

Deals attributed to multiple suppliers are excluded and only listed as `skipped` with empty supplierId and '—' name. The UI presumably shows skipped reasons. That's "correctly no-money" with a named reason — good. But the skip entries for multi-leg/currency use `supplierId: ''` — if the UI keys by supplierId it may glitch; also `result.skipped` mixes per-supplier skips and per-order skips — the DTO has reason strings, fine. I agree with the choice; recommend the report page makes skipped rows loud (they said it does — "appear only as a skipped reason"). Accept. One gap: the POST issues ALL suppliers with commission in the period — no dry-run/preview confirm per supplier. The candidates endpoint exists for the UI. A "bill everyone in the period" button that skips ambiguous ones loudly is acceptable. SHOULD: require per-supplier confirmation in UI or support `supplierIds[]` filter on POST so a partial period can be invoiced... Actually if one supplier is wrong you void just theirs — void is per-invoice. OK. Maybe suggest POST accepts optional supplierIds — SHOULD, nice-to-have.

### Challenge #2: settlement vehicle

`supplier_payments` is "money we paid out to suppliers" and now also hosts "money received from a supplier for a commission invoice". Semantically muddy. The alternative (new `supplier_receipts` table) is cleaner but duplicates payment plumbing. Their distinct FK approach avoids the never-written `invoice_id` confusion. Concerns: reporting — any existing report that sums `supplier_payments` as OUTFLOW will now include money IN? No — the rows are per-payment with an amount; existing reports presumably filter by orderSupplierId (payments tied to supplier legs). A commission receipt is linked to supplierInvoiceId and possibly an orderId... In the test they insert with `orderSupplierId: leg.id, orderId` — so a commission receipt tied to a broker deal's supplier leg would ALSO show up in any "what did we pay this supplier" report as a payment out! Wait — direction: `supplier_payments` rows presumably mean "payment TO supplier". A receipt from a supplier recorded as a supplier_payment with positive amount could inflate "total paid to supplier" reports. Is there such a report? Unknown (not in appendix). The e2e inserts the receipt with an orderSupplierId — mirroring the API shape. If reports sum supplier_payments per supplier leg, commission receipts would be counted as payments out → wrong cash-flow figures. I can't verify from the payload whether such reports exist; I should raise it as a MUST-verify: audit every reader of `supplier_payments` to ensure rows whose `supplier_invoice_id` is set (receipts FROM supplier) are excluded from payables reporting, or better, add a direction/kind column. Actually the cleanest: `kind: 'PAYMENT_OUT' | 'COMMISSION_RECEIPT'` or a boolean. I'll flag as MUST (verify readers) — evidence: the table is otherwise "money we paid out" per the review's own framing, and no reader audit is in the verification evidence.

Hmm, let me temper: the verification lists 943 passing tests unchanged — so no existing test broke, meaning no existing reader treats these rows differently... but no test covers "commission receipt appears in supplier payables" either way. So unknown. MUST to verify/flag readers; the fix may be one-line filters.

### Numbering gaps (see above) — SHOULD/MUST?

Sequence increments on already-invoiced path (because allocate happens before conflict check). Every double-click burns a number. Real invoices: SINV-2026-0007, 0008 observed — consistent with gaps from retries during dev. For an audit-facing series, gaps look like missing invoices to a counterparty/auditor ("where is SINV-0004?"). Customer side presumably has the same pattern (allocate-before-insert with onConflictDoNothing for commission orders). I'd mark SHOULD: allocate only when the insert will happen (pre-check under the lock, or allocate after successful insert by updating the row, or use the tx so rollback... conflict isn't rollback though — the insert doesn't fail, it no-ops; the sequence bump on `db` persists regardless. To avoid burning on no-op: check existence inside the lock first). Since the advisory lock serializes all issues per tenant, a pre-check `SELECT ... WHERE source_key = K` inside the lock is race-free for issue-vs-issue. Void doesn't take the lock but void only RELEASES keys, which can only turn "not exists" into "not exists". Safe. SHOULD.

Wait, one more: `allocateSupplierInvoiceNumber` uses `db` not `tx` — even in the success path the sequence increment commits separately; if the tx later rolls back (line insert failure), number burned with NO invoice — same gap issue. And partial failure: loop processes suppliers sequentially; supplier 2's line insert fails → whole tx rolls back → supplier 1's invoice also gone, but numbers 1 and 2 both burned. Gaps again. SHOULD: move allocation into the tx.

### `createSupplierInvoicesFromReport` — per-supplier queries inside the loop

`counterparties` lookups per supplier — fine, small.

**Amount as string from report:** `amount: supplier.totalCommission` (string) into numeric column — Drizzle handles string→numeric fine.

**Zero-commission skip:** `parseFloat(supplier.totalCommission) <= 0` → skipped 'no commission'. Good: negative commission (shouldn't happen; report presumably floors at 0) also skipped. OK.

**Currency:** `report.currency` — single currency for the whole report; excludedOtherCurrency handles others. Amounts are USD-only (per "not claiming non-USD"). Fine, documented.

**Rounding:** lines' `amount` from the report per-line commissionAmount; header `amount` = supplier.totalCommission. Do the lines SUM to the header? The e2e checks total foots in UI smoke (10,822.50 + 2,755.00 = 13,577.50) — good. But is there a DB-level check that SUM(lines) = header? If the report computes per-line rounding differently than the total (e.g., per-line round vs sum-of-unrounded), a supplier could be billed a total that doesn't foot to its lines. Evidence: UI smoke says it foots for the two real invoices; e2e single-line foots trivially. Multi-line: SINV-0007 = 3 lines 18,587.00 — "footed"? The smoke was on SINV-0008 (2 lines). I'd add a SHOULD: assert SUM(supplier_invoice_lines.amount) = supplier_invoices.amount in a test or compute the header as the sum of the line amounts AT ISSUE (store what you print). Actually best practice: header amount := sum of the frozen line amounts, so the document always foots by construction. In the code, header = report total; lines = report line amounts. If the report is internally consistent, fine. SHOULD: set header from the frozen lines' sum (belt & braces).

**Very large values:** numeric(14,2) max ~999,999,999,999.99 — fine. rate numeric(14,7), quantity numeric(14,6) — fine.

**`invoice_number` UNIQUE globally** (not per tenant!) — `invoice_number text NOT NULL UNIQUE` — across ALL tenants! Two tenants both issuing SINV-2026-0001 → the second insert FAILS with a unique violation (raw 23505, not the clean conflict path — onConflictDoNothing targets source_key, so the invoice_number conflict would throw). Wait — is that right? The customer `invoices` table — does it have a globally unique invoice_number? Many systems scope number uniqueness per tenant. Here: tenant A issues its first supplier invoice → SINV-2026-0001. Tenant B (another broker-deal tenant) issues → its sequence says 1 → SINV-2026-0001 → UNIQUE violation → 500. Is that plausible? Only brokerDeals-enabled tenants use this; Moxie may be the only one today. But the migration makes the series globally unique while the sequence is per-tenant — a design mismatch that will 500 the second tenant's first issue. MUST or SHOULD? It's a latent cross-tenant 500 on a money route. Fix: unique (tenant_id, invoice_number) or include a tenant discriminator in the template. I'd mark MUST (correctness under multi-tenant) — although today maybe only one tenant uses it, the schema is tenant-multi by construction, and the failure mode is an unhandled 23505 on a money route. Let me double check the migration: `invoice_number text NOT NULL UNIQUE` — yes, table-level unique. And `supplier_invoice_number_sequences` is keyed by tenant_id. Mismatch confirmed. MUST.

Hmm wait — is it possible the customer invoices table does the same (globally unique invoice numbers) and this mirrors it? "mirroring the customer invoice series" for the template; for the constraint, unknown. Even if the customer side does the same, it's still a bug pattern; but if the customer side does it, the app may generate tenant-unique numbers another way... can't verify. Still flag: either scope uniqueness per tenant or make the number globally unique by construction. As written, second tenant → guaranteed 500 on first invoice. That's consensus-worthy MUST.

Actually hold on, let me reconsider — is it "guaranteed"? Tenant B's sequence row starts... `values({ tenantId, lastSeq: 1 })` on conflict update +1. First call for tenant B: insert seq row lastSeq=1 → number SINV-2026-0001 (assuming default template). Tenant A already has SINV-2026-0001 → unique violation → 500 (unhandled). Yes, guaranteed for any two tenants using the feature with the same template/year. MUST.

### `order_id` on lines is always NULL

Lines insert `orderId: null` — the migration carefully added `order_id ... ON DELETE SET NULL` "for traceability", but the issuer never writes it! `orderId: null` in the insert. So the FK is dead weight and traceability is only via order_number text. Either write `line.orderId` (does the report line carry orderId? The report DTO isn't shown; line has orderNumber, customerName... the test's report presumably has orderId available in orders data). SHOULD: populate order_id at issue (traceability + future joins), or drop the column. Given the snapshot philosophy, keeping order_id is fine as long as it's never used for rendering. SHOULD.

### Void route body validation

`body: t.Optional(t.Object({ reason: t.Optional(t.Nullable(t.String())) }))` — fine. Void reason stored into note (append) — note grows; fine.

Void: sets `status: 'VOID'` — but `voidSupplierInvoice` doesn't check tenant INSIDE the service; the controller checks `invoiceBelongsToTenant` before calling. But `voidSupplierInvoice` by id directly — other callers? Only the route. OK. Race: two voids → double append; noted.

Also void doesn't require a reason (optional) — for a money document, most AR systems require a void reason. SHOULD: require reason.

### PDF: Content-Disposition attachment; fine. `createPdfBuffer(docDefinition as never)` — `as never` casts — smell but fine.

### `daysOverdue` uses `dueDate` at 23:59:59.999 UTC — invoice due date inclusive; fine.

### `deriveSupplierInvoiceStatus` with amount<=0 & received<=0 → PAID — a zero-amount invoice shows PAID... but issue path skips totalCommission <= 0, so zero-amount invoices shouldn't exist via the report path. Edge ok.

**Negative received (credit)?** If a payment is negative (a refund/reversal row?), received could exceed... `amountOutstanding = max(0, amount - received)` clamps. If received > amount (overpayment), status PAID, outstanding 0, the overpayment is invisible. Minor: report overpayment. SHOULD-ish, minor.

### Test coverage comments

- Tests directly manipulate DB and call internal helpers rather than only the API (settlement test inserts payments via db then calls recompute). The API path for linking (`/orders/:id/supplier-payments` with supplierInvoiceId) is guarded by `if (viaApi.status === 200)` — a SOFT assertion: if the route 404s/500s, the test silently passes that block! `expect(afterApi.data?.data?.amountReceived).toBeTruthy()` is inside the if. So the API settlement path is essentially untested — if it regresses, no failure. MUST/SHOULD: make that assertion unconditional (or assert viaApi.status === 200). Given money settlement via API is the real path, this is a test-quality MUST... I'd say SHOULD-to-MUST. It's a real hole in the evidence: the claim "settlement ... recorded through the API" is not actually pinned. I'll mark MUST for the money path or strong SHOULD. Let me mark it SHOULD+ (test rigor), but honestly the review says "verification already done" includes "settlement to PARTIALLY_PAID → PAID → reopened" — done via DB inserts + direct helper calls. The API path is soft-asserted. I'll flag as MUST to pin the API route, since that's the path production uses.

Hmm, let me also scan the controller for missing role checks: routes are behind `authGuard` — is there an ADMIN check? The POST summary says "(admin only)" but no role check visible in the route — depends on authGuard's behavior; other routes in the repo may check roles per-route. Can't verify. Flag as verify: the summary claims admin-only but no role guard is in the route code — confirm authGuard or add role check. If any authenticated user (e.g., a VIEWER) can raise invoices and void them, that's an authorization gap on money documents. MUST-verify (I can't see authGuard). I'll raise it as a question/verify item.

### `listSuppliersWithSupplierCommission` — no gating issue (route gates). It reads existing invoices for period — includes DRAFT? excludes VOID only. fine.

### Controller `DateOnly` pattern allows from > to — no validation that from <= to, or that the period is sane (e.g., from=2026-09-30, to=2026-09-01). Report service may handle. Minor SHOULD: validate from<=to (a reversed period would mint invoices with dueDate = from+30... weird). Also no limit on period length — a year-long period is fine.

### Cross-file consistency: DTO type `SupplierInvoiceDto` — includes `rawStatus` etc. Fine.

### `supplier-invoice-ledger.ts` — recompute uses `db`, not a tx; two updates (payments then invoices) non-atomic; fine-ish. `applySupplierPaymentToInvoice` — updates payment, then recomputes affected invoices sequentially — if recompute of old invoice succeeds and new fails, drift; minor. `SETTLEMENT_EPSILON = 0.005` — "half a cent" — `received + 0.005 >= amount` → treats received within half a cent as paid. Since amounts are cents (numeric(14,2)), epsilon is unnecessary but harmless; it can mark PAID when received is 0.005 LESS than amount — impossible with cents (min gap 0.01). Harmless.

### Migration details

- `CREATE TYPE supplier_invoice_status` — no IF NOT EXISTS; fine for a fresh migration.
- `supplier_payments.supplier_invoice_id ... ON DELETE SET NULL` — deleting an invoice orphans payments silently; invoices are never deleted (void instead). OK.
- `source_key` unique plain index — justified well (42P10 explanation is accurate: ON CONFLICT with partial index requires matching predicate; Drizzle drops targetWhere... actually `onConflictDoNothing` supports `targetWhere`? Drizzle's onConflictDoNothing has `target` and `targetWhere` options; there's a known issue where... The author says they hit 42P10 at runtime with tsc clean — plausible. Their reasoning that NULLs are distinct so partial buys nothing is correct for unique btree. Fine.)
- No `updated_at` trigger — `updated_at ... DEFAULT now()` only, updates set it manually in code. Fine since they always set it.
- `supplier_invoices.bank_account_id` — column added but NEVER written (issuer stores only the snapshot; `bank_account_id` isn't in the insert values). Dead column. Also `supplier_invoices.supplier_name` snapshotted — good. `bank_account_id` unused → SHOULD: drop or populate (populating contradicts snapshot purity? no, it's fine as provenance). SHOULD.
- No FTS/tenant index on `period_from/period_to` — queries by period exist in listSuppliersWithSupplierCommission (`where tenantId AND periodFrom AND periodTo AND status`) — the (tenant_id, supplier_id) index doesn't help; table small. Minor.
- `supplier_invoice_lines.rate numeric(14,7)` — 19.00 fits.
- Missing CHECK constraints: amount >= 0? A money table without `CHECK (amount >= 0)` — the app never writes negative, but a cheap belt. SHOULD-minor. Not consensus-worthy alone; bundle with "money document safety" item.

### Angular UI — not in appendix; the smoke test covered list+detail. Fine.

### Anything missed (challenge #8)

- **No audit trail for void reason as structured data** (mashed into note text with ' | ' joins) — makes parsing fragile; minor.
- **No `VOID` protection against voiding PAID invoices** — see payments-orphaning above; combine.
- **Concurrent issue + void:** covered; safe due to unique index.
- **Number series year rollover:** template includes {YYYY}; sequence is per-tenant global across years (not reset per year) — SINV-2027-0045 style; fine.
- **`hasText` lock key collision:** `pg_advisory_xact_lock(hashtext('supplier-invoices:<tenantId>'))` — hashtext returns int4; collisions across DIFFERENT lock keys possible (another feature using hashtext with a different string could collide → spurious serialization, not correctness). Note: advisory xact lock with 1 int arg — fine. Minor.
- **Time zone:** dueDate UTC; fine.
- **The PDF `invoice.status === 'VOID'` check uses the DERIVED status** — includes OVERDUE etc.; VOID check fine.
- **`getSupplierInvoice` returns payments regardless of void; voided detail shows payments [] (unlinked) — consistent.
- **`listSupplierInvoices` includeVoid=false uses `notInArray(status, ['VOID'])` — Drizzle notInArray with enum ok.
- **Email:** none, claimed.
- **`amountOutstanding` for OVERDUE shows total; fine.
- **Multi-currency:** excluded; documented.
- **`report.bySupplier` iteration inserts sequentially; a mid-loop failure rolls back all (tx) — partial-period state: some suppliers' invoices created, others not, all rolled back together; number gaps only. OK.
- **`createSupplierInvoicesFromReport` created_by: auth.sub — fine.

Now let me also double-check the **`supplierName` on voided & reissue**: reissue picks up `supplier.supplierName` from the CURRENT report — if the supplier was renamed between issue and reissue, the new invoice has the new name — correct (new document).

**Reissue after partial payment:** new invoice amountReceived=0 — double-chase risk — covered above.

**The 'DRAFT' status is in the enum but never used** — issue writes 'SENT' directly. Minor dead enum value; fine (mirrors customer side maybe).

Let me also reconsider the **`assertSupplierInvoicesEnabled` on `/candidates` and POST `/`** — POST is the money route, gated. Void gated. Detail/PDF ungated — flagged.

**`invoiceBelongsToTenant` does a second query after `getSupplierInvoice` already did 3 queries — could pass tenantId into getSupplierInvoice instead; N+1 again. Cosmetic.

Now the verdict. Findings ranked:

**MUST:**
1. SLEEK PDF remittance block parsed positionally from a variable-length, `filter(Boolean)`'d snapshot — mis-assigns bankName/IBAN/SWIFT whenever account holder name equals the company name (the code's own "usually identical" case). Supplier can't reliably pay. Fix: structured snapshot (JSON or prefixed parse). Evidence: snapshot builder lines vs `bankLines[2/3/4]` in supplier-invoice-document.ts. — MUST.
2. Issuer company resolved by NAME with no tenant scope in the PDF route (`eq(counterparties.name, invoice.invoicingCompanyName)`) while `invoicing_company_id` is stored — cross-tenant collision / wrong letterhead; nondeterministic with duplicate names. — MUST.
3. `invoice_number` globally UNIQUE but sequence per-tenant → second broker-deals tenant's first issue 500s with raw 23505. — MUST (schema change: unique (tenant_id, invoice_number) or globally-unique numbers).
4. Void of an invoice with recorded receipts unlinks payments and leaves them unapplied; reissue starts at 0 received → double-collection chase. Block void when amountReceived > 0 (require unapply first) or carry receipts forward explicitly. — MUST (money safety).
5. `supplier_payments` readers audit: commission receipts now live in a payables-shaped table; any reader summing supplier_payments as outflow per supplier/leg will misreport. Add kind/direction or verify all readers. — MUST-verify.
6. Read path trusts `amount_received` cache (contradicting the "amounts are the truth" invariant); payments are already fetched in `getSupplierInvoice` — derive received from them. — MUST (cheap) or SHOULD... I'll put MUST since it's their own stated invariant and free to fix on detail; list can keep cache.

Hmm, six MUSTs is a lot; some could be SHOULD. Let me weigh by "consensus-worthy, evidence-first, terse".

Let me reconsider #3: is it really certain? `invoice_number text NOT NULL UNIQUE` — yes, in the migration, plain UNIQUE = global. Sequence per tenant — yes (`supplier_invoice_number_sequences` PK tenant_id). Number includes {YYYY} + seq per tenant. Two tenants → same rendered number → collision. Unless the tenant template differs. Default template same. So yes. Also within ONE tenant it's fine. Moxie is the only brokerDeals tenant today? Possibly. But schema is multi-tenant; latent 500. I'll keep MUST but note it only bites when a second tenant enables broker deals... Actually wait — also relevant: does the customer `invoices` table have the same global-unique pattern? If yes, this "mirrors" existing behavior and the second-tenant bug already exists elsewhere (pre-existing). I can't verify. I'll phrase: scope to (tenant_id, invoice_number) unless customer ledger is also globally unique by design.

#5 — I can't see the readers; the review's own framing says the table is "otherwise money we paid out". The verification didn't audit readers. So: MUST to verify before merge, since a wrong payables figure is a money-reporting bug. OK.

#4 — Voiding paid invoices: does any test cover it? No. The e2e voids an unpaid invoice. Real risk when Daniel voids a wrong-rate invoice the supplier already partially paid. The current code silently drops the link. MUST.

#6 — yes keep as MUST? The detail endpoint already loads payments; the fix is 2 lines. The failure mode requires an out-of-band edit or an unverified API path (payment edit/delete). The API payment edit path might recompute (orders.service not shown). Because I can't verify every payment mutation path calls recompute, and their own doc says the cache only moves when recorded "through the app", stale reads are possible. MUST-verify + 2-line hardening. I'll phrase as MUST (harden the detail read; it's free).

Maybe also the **test soft-assert** (`if (viaApi.status === 200)`) — MUST to pin the production settlement route, since that's the actual path users take. Or SHOULD? The claim in the header says settlement works through the API; the test doesn't actually pin it. I'll make it MUST for evidence integrity — cheap to fix.

**SHOULDs:**
- Number burned on idempotent-retry & on rollback: allocate after a lock-held existence pre-check; run allocation on `tx`.
- `order_id` never written on lines despite migration rationale.
- `bank_account_id` column never written.
- Detail/PDF missing the enabled-gate the docblock claims.
- Require void reason; prevent double-void note duplication via conditional update.
- `from <= to` validation on the two period routes.
- N+1 list reads (and `getSupplierInvoicesByIds` is not actually a batch); no pagination.
- dueDays tenant setting (challenge #5).
- Header amount := sum of frozen lines at issue (footing by construction).
- Classic layout unexercised: verify once visually (they admit); positional remittance bug also fixed by structured snapshot for both layouts.
- Multi-leg skip visibility in UI (accepted design; make it loud) — answer to #6.
- Overpayment visibility (received > amount shows PAID/0 outstanding with no credit signal) — minor.

Answers to the 8 challenges:

1. **Separate table vs payer column:** Agree with separation. The four readers inferring payer from orders.client_id make a nullable payer a landmine (any missed filter = misstated customer receivables + QuickBooks Customer sync of a vendor). Cost of duplicate semantics is real but bounded (statuses derive in one small module). Separation is right. Also note: don't later "helpfully" merge them (e.g., ageing reports wanting both) — if a combined AR view is ever wanted, build an explicit union view, never reuse `invoices`.

2. **`supplier_payments` as settlement vehicle:** Wrong home semantically; acceptable only with a direction/kind discriminator and a reader audit. The never-written `invoice_id` should be dropped in a later migration (dead column invites future confusion — they added a THIRD meaning by proximity). Distinct FK is the right call vs reusing invoice_id. Recommend: add `kind` column now (values 'PAYMENT' | 'RECEIPT') or accept the risk after auditing readers. MUST-verify as above.

3. **Released key double-bill:** No path found. Unique index is the backstop; advisory lock serializes issues per tenant; void only releases (never creates) keys, so issue-vs-void races resolve to either "conflict → already-invoiced (possibly a number that then gets voided — retry heals)" or "insert after release → intended reissue". The residual wrinkle: a caller can be told "already invoiced: X" in the instant X is being voided by someone else; harmless (retry). The lock is per-tenant, held across the loop — issue throughput fine. Keep.

4. **Live letterhead vs frozen lines:** Agree with the split (our letterhead, not a transaction term), but the current implementation mixes: name frozen (invoicingCompanyName), address/VAT/logo/color live. After a company rename, header shows old name, footer uses frozen name but live address/VAT — a document that is internally inconsistent. Either resolve all issuer identity live (including the displayed name, by id) or freeze all; the current half-half is the one combination I'd avoid. Also note the name→company lookup bug (MUST #2) is adjacent: once you resolve by id, "live branding" becomes both safe and consistent.

5. **Due date:** periodTo+30 is a sane default but should be a tenant setting (`brokerDeals.supplierInvoiceDueDays`, default 30) and ideally shown pre-issue in the confirm UI. Not blocker; the date is printed on the doc and correction is void+reissue (which argues for the setting, since voids burn numbers).

6. **Multi-leg exclusion:** Correct choice. Never attribute; report loudly. Make sure the POST response's skipped entries are surfaced in the UI as blocking items (they have empty supplierId — ensure UI renders reason strings, which it must since supplierId is ''). Fine.

7. **Stale cache:** Yes — the detail read trusts the cache while already fetching payments; fix as MUST #6. Also `voidSupplierInvoice` unlinks payments without recompute (voided invoice — harmless). The recompute-on-link path is fine; the danger is any payment mutation outside `applySupplierPaymentToInvoice` (edit amount, delete, re-link) — orders.service not shown, so verify delete/edit call recompute.

8. **Missed items:** the MUSTs above — SLEEK remittance positional parse (the big one), global invoice_number unique, name-based issuer lookup, void-with-receipts, supplier_payments reader audit, plus SHOULD list. Also: no role/permission check visible beyond authGuard (verify admin-only claim), `as never` casts, `if (viaApi.status === 200)` soft assert.

Verdict: The core design is sound and the evidence is strong, but there are live money-doc defects — most notably the SLEEK remittance block scrambling (the layout Moxie actually uses), the name-based issuer lookup, and the global invoice-number unique constraint. Those need fixes before this issues real invoices to suppliers. **NO-GO** or APPROVE-WITH-CONDITIONS? The header says this is uncommitted work, follow-on to deployed tracking/report (read-only). The new thing is the actual invoicing. Given the remittance block on the DEFAULT layout is very likely scrambled whenever account holder == company name — i.e., on Moxie's own real invoices — I lean NO-GO until the MUSTs are fixed... but wait, let me double-check that against their verification: "the remittance block snapshotted with the real Nordea IBAN" — they verified the snapshot text, and the PDF verification sentence doesn't mention the remittance block. Also the SLEEK bank block: `bankName: input.bankLines[2]`... let me triple-check the snapshot composition once more, carefully, because this is my headline finding.

Snapshot lines (before filter):
0: beneficiary (company name or tenant name)
1: accountName && accountName !== beneficiary ? accountName : ''
2: bank.bankName
3: bank.iban ? `IBAN ${...}` : ''
4: bank.swiftBic ? `SWIFT/BIC ${...}` : ''
5: bank.currency ? `Currency ${...}` : ''

filter(Boolean) removes falsy — so empty strings AND any null bank fields.

Typical real case (Moxie/Nordea): accountName likely equals company name (or maybe differs — e.g., account "Moxie Brokerage ApS" == company name). If equal → line 1 dropped → array: [beneficiary, bankName, IBAN..., SWIFT..., Currency...].

SLEEK: beneficiary = bankLines[0] ✓; bankName = bankLines[2] → "IBAN DK..." ✗; iban = bankLines[3].replace(/^IBAN\s*/,'') → "SWIFT/BIC NDEA..." (no match, unchanged) ✗; swift = bankLines[4] → "Currency USD" ✗.

Yes. Scrambled. Unless sleek's renderer just prints these strings in labeled fields, in which case the labels themselves ("Bank: IBAN DK..., IBAN: SWIFT/BIC..., SWIFT: Currency USD") are wrong on the document a supplier pays from. On a real Moxie invoice. Today.

Unless... accountName !== beneficiary in their real data (some banks put a different account title). Their own comment says "usually identical" — the code was written EXPECTING the identical case, and the identical case is the broken one. Strong.

So: if this ships, Moxie's first real supplier invoice PDF likely carries a garbled remittance block. That's NO-GO territory? The work is uncommitted; my review gates the commit. The verdict options: APPROVE / APPROVE-WITH-CONDITIONS / NO-GO. Given several MUSTs including one that corrupts the payment instructions on the default layout, I say **NO-GO** (fix the MUSTs; the design itself is approved — separation, snapshot, idempotency, ledger module all endorsed). Actually, let me weigh: NO-GO vs APPROVE-WITH-CONDITIONS. "Conditions" implies mergeable once conditions met; NO-GO says don't merge as-is. With a remittance block that misdirects payment details on the default layout, I would not merge. NO-GO, with clear "design approved, implementation has these specific defects, fix and re-review the MUST list; SHOULDs can follow."

Hmm — but should I be careful: maybe `bank.accountName` in their seed/real data differs from the company name? The verification says "the remittance block snapshotted with the real Nordea IBAN" — snapshot text, not PDF block. And the PDF evidence paragraph lists: header, invoice number, line math, and the commission sentence. Conspicuously no remittance verification. I'm confident enough to lead with it, phrased with the conditional ("whenever account holder == company name — the case your own comment calls 'usually identical'").

Also double-check MUST #2 (name-based lookup): the PDF route selects counterparties by name with no tenant scoping. Cross-tenant: another tenant's company with the same name → its address/VAT/logo could print. Within one tenant, duplicate own-company names → arbitrary pick. And they have invoicing_company_id stored but unused. Solid.

MUST #3 (global unique invoice_number): solid from migration text.

MUST #4 (void with receipts): the code unlinks payments and nothing re-links; reissue shows 0. Solid as a risk; the fix is policy (block void with applied payments or explicit transfer flow).

MUST #5 (supplier_payments reader audit): can't verify readers from payload → phrase as blocking verification item.

MUST #6 (cache on read): getSupplierInvoice uses row.amountReceived while holding payments[]. Solid.

MUST #7 (soft test assert): solid from test source.

That's 7 MUSTs. Maybe consolidate: group MUST list by file with line-ish references (no line numbers available; use function names). Keep terse.

Also challenge #1 asked "Is duplicating status derivation worth it?" — answer: yes, and the derivation lives in ONE module both sides import; duplication is bounded. Endorse.

One more scan for anything missed:

- `allocateSupplierInvoiceNumber` runs BEFORE `onConflictDoNothing` — also note the tenant settings read there is a second tenant query per supplier — n/a, once per invoice.
- The `note` on the invoice: "Brokerage commission for N line(s), from to" — fine.
- `listSuppliersWithSupplierCommission` marks alreadyInvoiced even if the existing invoice is... excludes VOID only — good (reissue after void shows not invoiced).
- `getSupplierInvoice` on a VOID invoice still lists payments (unlinked → empty) fine.
- Security: `getSupplierInvoice(params.id)` before tenant check — 401/403 vs 404: returns 404 for foreign — good (indistinguishable), as designed.
- PDF filename sanitization: `replace(/[^a-zA-Z0-9-]/g,'_')` — fine.
- `Content-Length` with binary body in Elysia — presumably fine.
- The `t.Optional(t.Object({...}))` body on void route — ok.
- No DELETE route — good (void-only).
- Currency on payments: test inserts `currency: 'USD'` — the settlement sum ignores currency mismatch between payment and invoice (a EUR receipt could settle a USD invoice in the sum). Minor: recompute sums amounts regardless of currency. SHOULD-minor: assert payment currency == invoice currency on link, or convert explicitly. Add to money-safety list.
- `SETTLEMENT_EPSILON` — fine.
- Migration: no down-migration concern; fine.
- `supplier_invoices.status` default 'DRAFT' but insert writes 'SENT' — ok.
- `hasBankDetails: !!row.bankDetailsSnapshot` — PDF uses `invoice.hasBankDetails ? readBankSnapshotLines(...)` — reads snapshot column again (already have DTO... but DTO only exposes hasBankDetails bool, so re-fetch — fine).
- SLEEK `issuer.address: null` etc — letterhead address only in footer; fine.
- `formatQty` max 3 decimals; quantity 145 → "145" fine.
- `rate` in SLEEK: `${l.rate} ${currency}/${unit}` — l.rate is raw string from DB ("19.0000000"? numeric(14,7) → text like "19.0000000") — **parseFloat in buildLines for classic: `l.rate` used raw in classic table cell** — classic shows "19.0000000"? In buildLines, `rate: line.rate ? `${parseFloat(line.rate).toLocaleString(...)}` : ''` — so l.rate is formatted "19". SLEEK uses `l.rate` (formatted) + currency/unit → "19 USD/MT". Good. Classic table cell `l.rate` — the same formatted string. Fine.
- DTO rate: `rate: row.rate ?? null` — raw numeric text; e2e parseFloat's it. Fine.
- `formatAmount` uses toLocaleString('en-US') — "2,755.00 USD" — thousands separators; supplier-friendly. Fine.
- Due line and period meta — fine.
- `verifyUrl: null` — no fraud-prevention link, unlike customer invoices maybe; fine for v1.
- Missing: supplier invoice EMAIL — admitted not done.
- Missing: credit notes (negative adjustments). Void+reissue covers corrections; a PAID invoice that needs partial correction has no path (void blocked by my MUST #4 → then what? credit note needed eventually). Mention as roadmap, not blocker.
- Reports: no ageing/receivables report for supplier invoices yet? List page only. Collections view for supplier receivables — roadmap. Not claimed.
- QuickBooks vendor sync — deliberately not done, fine (but note the commission revenue will not hit QB until they build it — Daniel should know; the review asked "anything missed" — bookkeeping gap: commission revenue recognized nowhere except this table; presumably orders already track it; fine).

Also challenge #8's "concurrent issue + void" — answered; "rounding" — header-vs-lines footing (SHOULD: derive header from lines at issue); "currency" — payment-currency mismatch (SHOULD); "negative amounts" — none possible via app; CHECK constraint (SHOULD-minor); "very large" — numeric(14,2) fine; "classic layout unexercised" — SHOULD verify + the remittance bug affects both layouts? Classic prints raw snapshot lines → correct even with shifted positions (it prints verbatim). So classic is safe from the parse bug; SLEEK (the DEFAULT, Moxie's layout) is the broken one. Emphasize.

One more potential issue in SLEEK: `bank: input.bankLines ? { beneficiary: input.bankLines[0] ... }` — if snapshot exists but currency line filtered... covered.

What about `buildSleekDocument`'s bank rendering — unknown; I can only speak to the values passed. Phrase the finding on the mapping, which is in the reviewed file.

OK, also the "verification" claims PDF was "reads correctly at full resolution" listing specific content but NOT remittance — I'll note the absence as supporting evidence, politely.

Now, disagreement with design: 
- I agree with the separate ledger (challenge 1) — no disagreement there.
- Disagreement: void-releases-key policy is fine, but void-with-payments and void-reason-optional are too loose for a money document.
- Disagreement-ish: "recompute on read" claim vs code — the code doesn't recompute on read; either the claim or the code must change.
- `supplier_payments` home: accept with discriminator; would prefer `kind` column now.
- Live-letterhead: half-frozen issuer identity is the one inconsistency I'd resolve (freeze name too or resolve all live by id).

Also confirm: "the advisory lock is per-tenant and held across the whole issue loop" — yes, `pg_advisory_xact_lock` in the tx. And note hashtext(int4) lock key space collisions are theoretical; fine.

Let me also double-check `allocateSupplierInvoiceNumber`'s `onConflictDoUpdate` — target tenantId (PK) — fine. `seq?.lastSeq ?? 1` — returning gives the updated value; fine.

And the `listSupplierInvoices` ordering by createdAt desc — fine.

`getSupplierInvoicesByIds` — "batch read for lists" — who calls it? Not in appendix (maybe dashboard). Its N+1 noted.

Structure of my review:
- Verdict up front (NO-GO) with one-line reason.
- MUST items (file + location + evidence + fix), ~6-7.
- SHOULD items, grouped, terse.
- Answers to the 8 challenges, numbered, terse.
- Disagreements/endorsements.
- What I'd accept for re-review.

Length: needs to be thorough but terse. This is a high-stakes review; aim for detailed but evidence-first bullets. Use headers + numbered lists. Given the payload's density, a fairly long but tight response is right — maybe 900–1300 words.
