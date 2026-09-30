Let me work through this carefully. I'm reviewing a fix for two bugs in a Bun + Elysia + Drizzle multi-tenant bunker-trading app:

1. Invoice cleared as paid doesn't credit back to the client's credit line.
2. Marking paid requires 2x.

The fix:
- Caps payments at outstanding balance in `createOrderPayment` via `orderPayableBase` + `sumOrderPayments`.
- Adds `amountDue` to `OrderDto` computed in `getOrderById`.
- Web gate reads `amountDue`, returns true when due <= 0.
- Modal `submit()` early-returns while `saving()`.

I need to scrutinize:
1. `orderPayableBase` precedence — invoice-first correctness.
2. The cap: currency handling, 0.005 tolerance, blocked workflows.
3. `due <= 0 → true` on the web gate.
4. `amountDue` two extra queries per order read — hotspot?
5. Anything else that could still produce doubled "Total paid" or leave credit unreleased.

Let me go through the code carefully.

### 1. `orderPayableBase` precedence

```ts
export async function orderPayableBase(orderId: string): Promise<number> {
  const [existing] = await db
    .select({ total: sql<string>`COALESCE(SUM(${invoices.amount}::numeric), 0)::text` })
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), notInArray(invoices.status, ['VOID'])));
  const invoiced = parseFloat(existing?.total ?? '0') || 0;
  if (invoiced > 0) return invoiced;
  return parseFloat(await computeInvoiceAmount(orderId)) || 0;
}
```

Issues:

a) **Credit notes.** The comment says "An ISSUED invoice is the authoritative receivable". But what about credit notes? The schema has `invoices` with statuses; the diff mentions `notInArray(invoices.status, ['VOID'])`. If credit notes are stored as invoices with negative amounts (or a CREDIT status), then SUM would net them — that could be correct or incorrect depending on semantics. But if credit notes are stored as separate documents or as `orderItems` with negative prices (the `computeInvoiceAmount` mentions "credit-note placeholders" excluded via `customerFacingItems`), then the invoice-first precedence could diverge from the line total. Actually the comment in `computeInvoiceAmount` says "hidden / credit-note placeholders" are excluded from billable. So credit notes are item-level placeholders. Hmm.

Actually the bigger issue: **partial invoicing**. Consider an order with 10,000 line total, and a tranche invoice issued for 4,000 (partial — e.g., first tranche of a split delivery). `orderPayableBase` returns 4,000 (invoiced > 0). The customer pays 4,000. Fine. But then the customer wants to pay the remaining 6,000 before the second invoice is issued — refused. Is that a legitimate workflow? The fix's own rationale says "an order can be billed without priced item lines" and "a split order's value lives in tranche invoices". But the flip side: an order partially invoiced where the customer prepays the whole order value — now blocked. Is prepayment against uninvoiced balance legitimate? The fix explicitly allows deposits when NO invoice exists (payable = line total). But once ANY invoice exists, the cap is the invoiced total, so a deposit against the uninvoiced remainder is refused. That's an inconsistency: deposits are OK before any invoice, but not after the first invoice. This is a real behavioral cliff worth flagging as SHOULD (product decision), maybe MUST depending on workflow. The scrutinize list explicitly asks: "a partially-invoiced order". So I should flag it.

Actually wait — think harder. Is invoice-first correct for the *cap*? The cap's purpose is to prevent overpayment. If the order's total value is 10,000 (line total) and only 4,000 is invoiced, the maximum the customer could ever owe is 10,000 (assuming no further invoices exceed the line total). So a safer cap would be `max(invoiced, lineTotal)` — no wait, that would defeat the purpose in the case where the invoice is for less than the line total because delivered < ordered... Hmm, no. Actually `computeInvoiceAmount` uses delivered quantity, so line total already reflects delivered. If an invoice was issued for the delivered amount, invoiced == line total roughly.

But consider: invoice issued for 4,000 (partial tranche), line total 10,000 (full order, all delivered or ordered?). `computeInvoiceAmount` uses `coalesce(deliveredQuantity, quantity)` — so undelivered lines bill at ordered quantity. Hmm, that's interesting: `coalesce(deliveredQuantity, quantity)` means if deliveredQuantity is NULL, use quantity; if deliveredQuantity is 0, use 0. OK.

So the divergence cases:
- Partial invoicing: invoiced (4,000) < line total (10,000). Cap = 4,000. Customer can't prepay the rest. Blocked workflow (arguably).
- Invoice > line total: can that happen? An invoice with manually adjusted amount (invoice carries "a single scalar amount") — e.g., invoice includes fees/adjustments not on item lines. Then cap = invoiced, which is correct (the document is authoritative).
- Credit note as an invoice row with negative amount: SUM nets it. If a credit note is issued AFTER payment, e.g., invoice 10,000, paid 10,000, then credit note -500 issued → invoiced = 9,500, alreadyPaid = 10,000, outstanding = -500 → any further payment refused (good), but the customer is owed 500 — refund flow, not payment. Fine. But what if credit note is issued and then the customer pays the net? invoice 10,000 + credit -500 = 9,500 cap; paying 9,500 OK. Seems right, IF credit notes are negative-amount invoice rows. But if credit notes are stored with positive amounts and a status like 'CREDIT', the SUM would ADD them, inflating the cap — that would be a bug letting overpayment through. I can't see the schema; I should flag it as a question/SHOULD: verify credit-note representation. The `computeInvoiceAmount` comment mentions "credit-note placeholders" as item rows excluded from billable — so credit notes might be modeled as item rows with hideOnDocuments or a productType marker. If a credit note is an item row excluded from `customerFacingItems`, then the line-total branch excludes it, but the invoice branch (invoices.amount) — if the credit note is ALSO an invoice row... unclear. Flag it.

b) **`notInArray(invoices.status, ['VOID'])`** — what about DRAFT invoices? The comment says "An ISSUED (non-VOID) invoice is the authoritative receivable" but the code excludes only VOID, not DRAFT. So a DRAFT invoice counts toward the payable. Is that right? A draft invoice is not a receivable yet — the customer doesn't hold it. If a draft exists for 10,000 and the customer wants to pay a 2,000 deposit... cap = 10,000, fine. But if a draft exists with a wrong amount, the cap is wrong. More importantly: comment/code mismatch — "issued (non-VOID)" vs code excluding only VOID. If the schema has statuses like DRAFT/ISSUED/PAID/VOID, then DRAFT invoices are included in the payable. Hmm, is that harmful? It could *inflate* the cap (draft for full amount while line total is lower due to delivered < ordered — wait, drafts are usually generated from computeInvoiceAmount so same figure). It could also *deflate*: no. Including drafts mostly makes the cap more permissive or equal. Actually there's a subtle case: order has line total 10,000 (delivered basis 8,000). Draft invoice created from computeInvoiceAmount = 8,000. Then more quantity delivered → line total 10,000. Cap = 8,000 (draft counts). Customer pays 8,000. Then invoice issued for 10,000. Outstanding = 2,000. OK fine.

But the reverse: draft invoice for 10,000 created when delivered was... no, drafts use delivered at creation time.

The real risk with including DRAFT: an operator creates a draft, abandons it, edits the order down (line total now 6,000), and the stale draft (10,000) still caps at 10,000 → overpayment possible up to 10,000. That defeats the cap. Should be `inArray(invoices.status, ['ISSUED', ...])` or exclude DRAFT too. But I don't know the actual status enum. The comment says "issued (non-VOID)" — the code says non-VOID. Mismatch between comment and code is itself a finding. I'll flag as SHOULD/MUST: either the comment is wrong or the filter is wrong; if DRAFT exists in the status enum, drafts inflate the payable and can defeat the cap. Given the comment explicitly says "An ISSUED (non-VOID) invoice", and the code only excludes VOID, this is a genuine discrepancy. I'd call it SHOULD (needs verification of the enum) or MUST if we assume DRAFT exists. Most invoice systems have DRAFT. The fix text says "an issued (non-VOID) invoice total if one exists". I'll mark SHOULD with strong wording, or MUST? The instruction says evidence-first. The evidence: comment claims ISSUED, code filters only VOID. One of them is wrong. If DRAFT exists, cap can be inflated by a stale draft → overpayment → the exact bug recurs. I'll mark it MUST to verify/align, since the whole point of the PR is the cap. Hmm, but I can't verify the enum. Let me mark it as MUST: "comment says ISSUED, code says non-VOID — if DRAFT (or any pre-issue status) exists, a stale/abandoned draft inflates orderPayableBase and defeats the cap; align the filter with the comment (whitelist ISSUED-ish statuses) or fix the comment."

Also PAID invoices: a PAID invoice should still count toward payable (it's been billed), and payments sum separately, so fine.

c) **Mixed currency.** `computeInvoiceAmount` throws `MixedCurrencyInvoiceError` when billable lines have >1 currency. In `orderPayableBase`, that throw propagates. Where is it caught? In `createOrderPayment`, the try/catch in the controller catches `OrderPaymentError` specifically, else logs and returns 500 "Failed to add payment". So a mixed-currency order (no invoice) → any payment attempt → 500 with generic message. Previously payments on mixed-currency orders were... allowed? The cap now blocks ALL payments on mixed-currency un-invoiced orders with a 500. Is that a regression? The `computeInvoiceAmount` comment says invoices can't express mixed currency, so such orders can't be invoiced either — but payments (deposits) could previously be recorded. Now they can't. That's a blocked workflow. Also `getOrderById` calls `orderPayableBase` — wait, does it? Yes: `await orderPayableBase(row.id)` inside `getOrderById`. If the order is mixed-currency with no invoice, `computeInvoiceAmount` throws → **getOrderById throws → the order detail page 500s entirely**! That's a MUST. The whole order page becomes unreadable for mixed-currency orders. Unless mixed-currency orders always have invoices... no, the error exists precisely because they can't be invoiced. So: mixed-currency order → cannot invoice → orderPayableBase falls to computeInvoiceAmount → throws → getOrderById 500s. MUST fix: catch MixedCurrencyInvoiceError in getOrderById (amountDue = undefined) and in createOrderPayment (either allow with no cap, or 400 with clear message — but 500 generic is wrong).

Wait, let me double check `getOrderById` diff:

```ts
const orderAmountDue = (Math.max(
  (await orderPayableBase(row.id)) - (await sumOrderPayments(row.id)),
  0,
)).toFixed(2);
```

Yes, unguarded await. If `computeInvoiceAmount` throws MixedCurrencyInvoiceError, getOrderById rejects. The controller for GET /orders/:id presumably has a try/catch returning 500. So the order page breaks for mixed-currency orders. MUST.

Also note: `computeInvoiceAmount`'s class is cut off in Appendix F: `export class Mix` — truncated, presumably `MixedCurrencyInvoiceError`. Fine.

d) **Currency of payments vs payable.** `sumOrderPayments` sums ALL customerPayments for the order regardless of currency. `input.currency` is the payment's currency. The cap compares `incoming` (in input.currency) against `outstanding` (payable in invoice/line currency, minus payments in whatever currencies they were recorded). The error message even interpolates `input.currency` as if outstanding were in that currency: `` `Payment exceeds the ${outstanding.toFixed(2)} ${input.currency} still outstanding` `` — if the order is USD and the payment is EUR, the message says "exceeds the 4000.00 EUR still outstanding" which is wrong (it's USD). And the cap itself: a 4,000 EUR payment against a 10,000 USD payable with 6,000 USD already paid → outstanding 4,000 USD; incoming 4,000 EUR passes the numeric check (4,000 ≤ 4,000+0.005) but is actually ~4,300+ USD → overpayment in value terms. No FX conversion anywhere. The scrutinize list explicitly calls this: "payments are summed across currencies with no conversion". So: the cap is numeric-only, currency-blind. Pre-existing behavior summed across currencies too (paymentsTotal on the page), but the NEW cap gives a false sense of control and the error message misstates the currency. Finding: SHOULD (or MUST?) — the message claims the outstanding is in `input.currency` when it's in the order's currency; and cross-currency payments can still overpay. Given the app is bunker trading (USD mostly, but multi-currency exists — costCurrency/salesCurrency per line), I'd mark SHOULD: at minimum, use the order's sales currency in the message and consider rejecting payments whose currency differs from the payable currency, or documenting the limitation. Actually, is there a scenario where a customer pays in a different currency legitimately? Possibly (EUR payment against USD invoice). The old system allowed it. The new cap numerically caps it, which is better than nothing but wrong across currencies. I'll flag SHOULD with the message-currency bug as the concrete defect (that part is unambiguous: the message asserts the wrong currency).

e) **`parseFloat` on numeric strings.** `parseFloat(await computeInvoiceAmount(orderId))` — computeInvoiceAmount returns '0.00' or a numeric(14,2) string. parseFloat fine. `sumOrderPayments` uses SUM::text then parseFloat — fine, though float64 for money; the codebase itself warns "routing those through float64 ... can drift a cent on a large order" (in computeInvoiceAmount comment). The cap arithmetic `incoming > outstanding + 0.005` is done in float64. With 0.005 tolerance, a cent of drift is absorbed. Values up to ~9e15 — fine for typical amounts. Minor; not a finding beyond noting tolerance covers it.

f) **Race condition / TOCTOU.** The cap is check-then-insert without a transaction or lock: `sumOrderPayments` reads, then insert happens later in `createOrderPayment`. Two concurrent requests (the double-submit!) can both read alreadyPaid=0 and both insert → duplicate rows again. The modal guard reduces but doesn't eliminate (two tabs, retries, API clients). The test posts sequentially so it passes. The proper control: serialize with a transaction (SELECT ... FOR UPDATE on the order row) or a DB-level constraint/assertion, or re-check inside the insert transaction. Given the whole PR is about stopping duplicates, the missing atomicity is significant. The 62-second gap in production suggests it wasn't even concurrency — but the stated threat "a second click in the same tick" IS concurrency (two in-flight HTTP requests). `if (this.saving()) return` guards the modal, but the API is the control per the diff's own words: "The page's own 'mark as paid' guard is a courtesy, not a control — this is the control." Yet the control itself is not atomic. MUST or SHOULD? I'd say MUST for a payment-money path: wrap in a transaction with a row lock on the order (or advisory lock), re-reading the sum inside. At minimum SHOULD. Let me think about severity: the double-submit via the modal is guarded client-side; the API race window is milliseconds — the two production rows were 62s apart, which suggests the operator clicked twice with a stale page (the page still showed outstanding because... hmm, actually the second payment 62s later succeeded because there was no cap at all; with the cap, the second would be refused since alreadyPaid would be committed by then). So the race window is small but real (double-click before first response → two concurrent requests → both pass). The modal's `saving()` guard: does `saving()` get set synchronously before the await? Presumably `saving.set(true)` at start of submit — the diff only shows the early return added at the top; the existing code presumably sets saving. If saving is set synchronously, same-tick double submit is guarded. But two tabs / direct API / network retry still race. I'll mark SHOULD→MUST. Given it's the core control of the PR and money movement, I'll say MUST: make the check-then-insert atomic (transaction + SELECT FOR UPDATE on orders row, or recheck within the insert transaction). Actually, let me be careful about being too prescriptive without seeing the rest of createOrderPayment. The insert happens after; there's a comment about stamping invoice. The finding stands: non-atomic check-then-act; two concurrent requests both pass. Evidence: `const alreadyPaid = await sumOrderPayments(orderId);` then later insert, no transaction/lock shown. MUST.

g) **`orderPayableBase` sums ALL non-VOID invoices for the order** — including invoices for tranches. Good for split orders. But what about invoices that are ISSUED then VOIDed then reissued? Fine. What about an invoice in a different currency than the order lines? invoices has "a single scalar amount with no currency column" per Appendix F comment — wait: "`invoices` carries a single scalar amount with no currency column". So invoice amounts have no currency! Then `orderPayableBase` sums invoice amounts across... if a split order has tranche invoices in different currencies (possible? invoice has no currency column, so presumably all invoices on an order share a currency, or the currency lives elsewhere). If invoices carry no currency, then the cap compares payment (input.currency) against a currencyless number — consistent with the currency-blindness finding above. OK, fold into the currency finding.

h) **Deposit workflow after first invoice.** Covered in (a). Also: the fix says "Enforced ONLY when `payable > 0`" — wait, where is that in the code? Let me re-read the diff:

```ts
const payable = await orderPayableBase(orderId);
const alreadyPaid = await sumOrderPayments(orderId);
const outstanding = payable - alreadyPaid;
const incoming = parseFloat(input.amount) || 0;
if (incoming > outstanding + 0.005) {
  throw new OrderPaymentError(...)
}
```

Hmm — the fix description says "Enforced ONLY when `payable > 0`: an order with no issued invoice and no priced lines has payable 0, and taking a deposit against a deal still being built is a real workflow". But the code as shown does NOT check `payable > 0`! If payable = 0 (no invoice, no priced lines) and alreadyPaid = 0, outstanding = 0, and any incoming > 0.005 throws "This order is already settled in full (0.00 USD)." — which BLOCKS the deposit workflow the description explicitly says must not be blocked! Wait, let me re-read. The description: "Enforced ONLY when `payable > 0`: an order with no issued invoice and no priced lines has payable 0, and taking a deposit against a deal still being built is a real workflow (`orders.service.edges` pins a two-payment no-invoice order), so refusing those would be a regression and there is no figure to enforce against."

But the diff shows no `if (payable > 0)` guard around the check. Unless... the diff is partial and the guard exists elsewhere? The diff hunk shows:

```
+  const payable = await orderPayableBase(orderId);
+  const alreadyPaid = await sumOrderPayments(orderId);
+  const outstanding = payable - alreadyPaid;
+  const incoming = parseFloat(input.amount) || 0;
+  if (incoming > outstanding + 0.005) {
+    throw new OrderPaymentError(
+      outstanding <= 0.005
+        ? `This order is already settled in full (${payable.toFixed(2)} ${input.currency}).`
+        : `Payment exceeds the ${outstanding.toFixed(2)} ${input.currency} still outstanding on this order.`,
+    );
+  }
```

No `payable > 0` condition. So either the description is aspirational/lying, or the diff is incomplete. Based on evidence-first review: the code shown blocks payments on payable=0 orders. The description says it shouldn't. Also the test file: `orderWithLine` creates an order WITH a priced line, so payable = 10,000 > 0; no test covers the payable=0 deposit case. And the description references `orders.service.edges` pinning "a two-payment no-invoice order" — if such a test exists in the repo, this change would break it (an order with no invoice and no priced lines, two payments). Actually wait — "a two-payment no-invoice order": no invoice, but does it have priced lines? If it has priced lines, payable = line total > 0, and two payments within the total pass. If it has NO priced lines, payable = 0 and the first payment is refused → that existing edge test breaks. The description explicitly says "an order with no issued invoice and no priced lines has payable 0 ... refusing those would be a regression". So the code as diffed contradicts the stated design. This is a MUST: add the `payable > 0` guard (or show it). This is exactly the kind of description-vs-code mismatch a reviewer must catch.

Hmm wait, let me reconsider. Maybe `outstanding <= 0.005` branch message "already settled in full" — for payable=0, alreadyPaid=0: outstanding=0, message "already settled in full (0.00 USD)". Yes, refused. So the deposit-on-empty-order workflow IS blocked by the shown code. MUST finding: the `payable > 0` exemption described in the PR is not present in the diff; either the diff is missing a hunk or the regression described (deposits on unbuilt deals, pinned by orders.service.edges) is live. Also note: an order with lines but zero prices (salesPrice null/0) → computeInvoiceAmount returns 0 → payable 0 → deposits refused. The description says that's a regression. MUST.

Actually — hold on. Let me reconsider whether the guard might be implicit. `if (incoming > outstanding + 0.005)`. If payable=0 and alreadyPaid=0, outstanding=0, incoming=5000 > 0.005 → throw. Yes. Blocked. Unless there's an outer `if (payable > 0) { ... }` not shown — but the diff shows the full added block within the hunk context (the lines after are the existing invoice-stamping comment). The hunk header `@@ -2361,6 +2428,32 @@` shows 32 added lines — let me count the added lines in that hunk: comment block (13 lines?), payable/alreadyPaid/outstanding/incoming (4), if-throw (8)... The description block comment is long. Let me count precisely:

```
+  /**
+   * A payment above the outstanding balance is refused, not absorbed.
+   *
+   * Nothing used to check this, so a customer could pay an order twice and both
+   * rows were accepted: on channeltx one order was paid 34,694.66 twice within 62
+   * seconds and read "Total paid: 69,389.32" against a 34,694.66 receivable. The
+   * page's own "mark as paid" guard is a courtesy, not a control — this is
+   * the control.
+   *
+   * `computeInvoiceAmount` is the same figure the invoice bills and the customer
+   * card shows, so the cap agrees with the document instead of a second
+   * arithmetic. Half a cent of tolerance, matching the existing precedent for
+   * float/rounding noise elsewhere in this file.
+   */
+  const payable = await orderPayableBase(orderId);
+  const alreadyPaid = await sumOrderPayments(orderId);
+  const outstanding = payable - alreadyPaid;
+  const incoming = parseFloat(input.amount) || 0;
+  if (incoming > outstanding + 0.005) {
+    throw new OrderPaymentError(
+      outstanding <= 0.005
+        ? `This order is already settled in full (${payable.toFixed(2)} ${input.currency}).`
+        : `Payment exceeds the ${outstanding.toFixed(2)} ${input.currency} still outstanding on this order.`,
+    );
+  }
```

That's 13 + 4 + 8 = 25 added lines... plus blank lines? The hunk says +32 lines added (2428-2361... the hunk range `@@ -2361,6 +2428,32 @@` means old file 6 lines starting 2361, new file 32 lines starting 2428; so 26 added lines net (32-6). My count of 25-27 with blanks roughly matches. So no room for a `payable > 0` guard unless I miscounted. The blank line after the block comment and blank lines... Let me not over-index; the shown code has no payable>0 guard. The PR description claims one. MUST: reconcile — either the diff dropped the guard or the description overstates. Given the description is explicit ("Enforced ONLY when `payable > 0`"), and the code lacks it, this is the single most important finding: the shipped code blocks the deposit workflow the PR says it preserves, and likely breaks `orders.service.edges`' pinned two-payment no-invoice order.

Hmm, wait. Actually, maybe I should reconsider: maybe the "enforced only when payable > 0" is realized through... `outstanding <= 0.005` message branch? No, that's just message selection. Or maybe `orderPayableBase` returning 0 and then... no. The check `incoming > outstanding + 0.005` fires for any positive incoming when outstanding <= 0. So yes, blocked.

Unless... the description means: the cap is enforced only when payable > 0, i.e., they INTENDED `if (payable > 0 && incoming > outstanding + 0.005)`. The code omits `payable > 0 &&`. So the description documents intent not matched by the diff. MUST.

Also note the test suite doesn't cover payable=0 deposits — the description says orders.service.edges pins it, but the new test file doesn't. So the regression wouldn't be caught by the new tests; would be caught by the existing edges test (if it exists and runs). Flag: add a test for the deposit-on-unpriced-order case.

### 2. The cap details

- **0.005 tolerance**: `incoming > outstanding + 0.005` — allows overpayment up to half a cent. Fine. But also `hasEnoughPaymentsForMarkPaid` uses `due - 0.005`. Consistent. OK.

- **Negative payments / refunds?** `createOrderPayment` validates `Number.isFinite(amount) && amount >= 0`. So refunds aren't via this path (or refunds are negative amounts elsewhere — `updateSupplierPayment` exists for supplier side; customer side has `customerPayments` — is there an update/delete customer payment route? The controller imports list/create for customer payments; supplier has update/delete. So customer payments can't be edited/deleted via API? If a wrong payment is recorded, no way to remove it → the cap then blocks the correct payment. Hmm: operator records 4,000 payment by mistake (typo), can't delete it, and now the customer's real 4,000 payment is refused because outstanding is reduced by the typo. Pre-existing lack of delete, but the cap makes it operationally painful. Worth a SHOULD: without a void/delete customer-payment path, a mistyped payment permanently consumes cap headroom; consider a refund/void flow or allow admin correction. This is speculative about the API surface (maybe deletion exists elsewhere), so phrase carefully: "no delete/update route for customer payments is visible in the controller imports; a mistyped payment now permanently eats the cap".

- **Currency**: covered above. The message bug: `${input.currency}` — the outstanding is in the order/invoice currency, not necessarily input.currency. Concrete: order USD, payment EUR → "Payment exceeds the 4000.00 EUR still outstanding" — wrong currency label. SHOULD (or fold into currency MUST?). I'll make one finding: currency-blind cap + mislabeled currency in the error message. Severity: SHOULD (pre-existing sums were currency-blind too; the cap is still an improvement; but the message is newly wrong).

Wait, actually, is it possible payments must match order currency upstream? The route body takes `currency: string` per tests. No evidence of validation against order currency. So cross-currency payments are possible. The cap treats numbers as commensurable. SHOULD.

- **`parseFloat(input.amount) || 0`**: if input.amount is "abc", parseFloat → NaN → ||0 → 0 → 0 > outstanding+0.005 false → passes the cap, then presumably later validation rejects? The route validated `Number.isFinite(amount) && amount >= 0` — where? "validated only Number.isFinite(amount) && amount >= 0" — on what parse? If the route parses with Number() and checks isFinite, "abc" is rejected before service. OK fine. But note: `parseFloat("4000abc")` = 4000 — discrepancy between route validation (Number("4000abc") = NaN → rejected) and service parseFloat. Not exploitable given route rejects first. Skip.

- **`sumOrderPayments` includes payments with... any status?** customerPayments rows — are there voided/reversed customer payments? If the table has a status/void flag, summing all rows might include reversed ones. No evidence. Skip or mention briefly.

### 3. Web gate `due <= 0 → true`

```ts
readonly hasEnoughPaymentsForMarkPaid = computed(() => {
  const due = this.totalDueForMarkPaid();
  if (due <= 0) return true;
  return this.paymentsTotal() >= due - 0.005;
});
```

`totalDueForMarkPaid = parseFloat(this.order()?.amountDue ?? '') || 0`.

Problems:

a) **`amountDue` is optional and `|| 0` conflates "missing" with "zero owed".** If the API hasn't returned amountDue (older API, cached DTO, list endpoint vs detail, or the field is undefined for some orders — e.g., mixed-currency where... well that 500s), `parseFloat(undefined ?? '') = NaN || 0 = 0` → due = 0 → gate returns TRUE → order can be marked paid with NO payments at all. The old code returned false when due <= 0 (which broke completed orders) but at least didn't auto-pass on missing data. The new comment says "'Nothing owed' and 'cannot tell' are different, and only the second should refuse" — but the implementation treats "cannot tell" (missing amountDue) as "nothing owed"! `amountDue ?? ''` → '' → 0 → true. Direct contradiction between the comment and the code. This is the scrutinize point #3: "can it now mark an order paid that should not be?" Answer: yes — when `amountDue` is absent (undefined), the gate returns true and markPaid proceeds. Given `amountDue?: string` is optional in the DTO, any consumer (stale bundle vs new API, or new bundle vs stale API during deploy, or another surface like a list DTO that doesn't populate it) silently gets "can mark paid". MUST: distinguish undefined (refuse or fall back) from '0.00' (allow). E.g., `const raw = this.order()?.amountDue; if (raw == null) return false;` — or keep old behavior for missing. Also during a rolling deploy, web (new) + API (old) → amountDue undefined → every order's gate passes → operators can mark unpaid orders PAID. That's a real deploy-window hazard. MUST.

b) **`paymentsTotal()`** — how is it computed? Not shown in the diff (pre-existing). It presumably sums the payments list loaded on the page. If payments are loaded from a different endpoint and include supplier payments or filtered... can't verify. Skip, but note the gate compares paymentsTotal (client figure) against server amountDue — if paymentsTotal is stale (page not refreshed after a payment), the gate could pass/fail incorrectly; but markPaid presumably re-validates server-side? Does it? The description says "markPaid's own guard on it silently stopped guarding" — the guard is client-side. Is there a server-side guard on the status transition to PAID? Not shown. So marking paid is client-gated only → the `due <= 0 → true` change means: any order whose amountDue is 0/missing can be marked PAID regardless of payments. When is amountDue legitimately 0? When payable − payments ≤ 0, i.e., fully paid or overpaid, or payable=0 (unpriced, uninvoiced order!). So an INQUIRY with no prices (payable 0, payments 0) → amountDue '0.00' → gate true → can be marked PAID. Is that a problem? Marking an unpriced inquiry as PAID... the old code refused (due<=0 → false). New code allows. Is that legitimate? The PR argues "an order with nothing outstanding is a legitimate thing to mark paid". For a completed order with no receivable (free sample?), fine. For a draft inquiry, marking PAID is probably wrong but the status transition endpoint may have its own state-machine rules (CONFIRMED→DELIVERED→PAID etc.) that prevent INQUIRY→PAID jumps. Can't verify. Mention as SHOULD/question: verify the status-transition state machine still prevents nonsensical jumps, since the gate no longer does.

c) The gate now uses server amountDue but `paymentsTotal()` client-side — after recording a payment via the modal, does the page refresh both the order (amountDue) and payments list? If the modal emits and the page reloads payments but not the order (or vice versa), the gate could be inconsistent. Not shown. Skip/brief.

### 4. `amountDue` performance

`getOrderById` now runs `orderPayableBase` (1 query on invoices + 1 query on orderItems via computeInvoiceAmount — actually computeInvoiceAmount runs 2 queries: select items, then the SUM) plus `sumOrderPayments` (1 query). So up to 4 extra queries per order read. Sequential awaits: `orderPayableBase(row.id)` then `sumOrderPayments(row.id)` — could be `Promise.all`. getOrderById is a single-order detail endpoint — 4 small indexed queries is fine, not a hotspot. SHOULD (minor): parallelize with Promise.all; also note computeInvoiceAmount is only needed when invoiced == 0 (orderPayableBase short-circuits — yes it does: `if (invoiced > 0) return invoiced;` so computeInvoiceAmount only runs when no invoice). So typical invoiced order: 2 extra queries. Fine. Verdict: acceptable; minor SHOULD for Promise.all and for guarding the MixedCurrencyInvoiceError throw (which is the MUST above).

Also: is `amountDue` added to list endpoints? No — only getOrderById. The gate is on the detail page. Fine.

### 5. Anything else — doubled "Total paid" or credit unreleased

**The credit line!** The customer's FIRST bug: "we clear the invoice as paid, but it does not credit the value back to the client's credit line." The PR fixes duplicate payments and the mark-paid gate, but does anything here actually credit the credit line when an invoice is cleared/markPaid? The context mentions `creditLines` import and `checkCreditAvailability`. The description's "The fix" says nothing about credit release. Hmm — the root causes identified are (1) no payment cap, (2) gate disagreement, (3) double-submit. The claim is presumably that the credit line is computed from order status/payments, and the doubled payment / stuck status caused the credit not to be released... Actually re-read the customer quote: "We clear the invoice as paid, but it does not credit the value back to the client's credit line. I.e. STS pays 152K, we clear the invoice, it does not free up the same value on the credit line."

So: invoice cleared as paid → credit line should free up the invoice's value → doesn't. Where in this diff is credit release handled? Nowhere visible. The diff touches orders.service (payment cap, amountDue), controller (400 mapping), dto, web gate, modal. Nothing about `creditLines` or releasing credit on markPaid/invoice payment. Unless credit availability is computed dynamically from open orders (checkCreditAvailability reads outstanding exposure = uninvoiced/unpaid order value), in which case fixing the payment cap + amountDue might indirectly fix the computation... but the customer's scenario: invoice ISSUED and PAID — the order's exposure should drop. If credit availability derives from order status (e.g., orders in CONFIRMED/DELIVERED count against the line, PAID doesn't), then the "requires mark paid 2x" bug kept the order un-PAID → credit never freed. Fixing the gate lets it move to PAID → credit freed. That's plausibly the causal chain the PR claims. But nothing in the payload demonstrates the credit-release path. As a reviewer, I should flag: the first reported symptom (credit not released on clearing invoice) is not directly addressed anywhere in the diff; the fix relies on the assumption that credit availability is derived from order status/payments downstream. If credit is released by a specific event/handler (e.g., on invoice payment or markPaid), no change here touches it. MUST or SHOULD? The PR's own root-cause narrative ties bug 1 to the doubled payment/gate, but there's no evidence in the payload that clearing an invoice as paid releases credit. I'd raise it as a MUST-verify / SHOULD: "No code in this diff touches creditLines release; confirm the causal chain (order → PAID → exposure recomputed) actually covers 'clear the invoice as paid', or bug 1 persists." Given the customer's primary complaint is the credit line, and the diff has zero credit logic, this deserves strong wording. I'll make it a MUST: the stated customer bug #1 has no direct fix in the diff; verify or add the release path. Hmm — but the instructions say evidence-first; the evidence is absence: `creditLines` is imported in orders.service (pre-existing) and `checkCreditAvailability` imported, but no release function appears in any appendix. The description never mentions credit release code. So: "Bug #1 (credit not freed) is addressed only indirectly; nothing in the diff releases credit. If credit availability is a live computation from order state, say so and test it; otherwise NO-GO on that symptom." I'll put it as MUST-verify with the verdict hinging on it.

Also: **"Total paid" doubling could still occur via**:
- The race (covered).
- Payments created via other paths: e.g., invoice-level payments (`resolvePaymentInvoiceTarget`, `recomputeInvoiceAmountPaid` — invoice.service has payment recording that may create customerPayments rows for orders). If a payment can be recorded through the invoice module (paying an invoice directly), does THAT path have the cap? The diff only caps `createOrderPayment`. If `resolvePaymentInvoiceTarget` / invoice payment flows insert customerPayments rows, overpayment/duplicates can still enter through them. Evidence: `resolvePaymentInvoiceTarget` is imported in orders.service (pre-existing) and used in createOrderPayment ("A payment settles ONE invoice. Stamping the newest invoice..."). So invoice payment routing happens inside createOrderPayment — good. But is there a separate invoice-payment endpoint? Unknown. SHOULD: confirm all customerPayments insert paths go through the cap (or share it).
- `updateSupplierPayment`/supplier side — different table, irrelevant.
- Customer payments created via bulk/ledger endpoints? Unknown. Mention.

**`recomputeInvoiceAmountPaid`** — when an order payment is recorded, invoice paid amounts are recomputed. With the cap, fine.

**Voided invoice edge**: invoice ISSUED for 10,000,