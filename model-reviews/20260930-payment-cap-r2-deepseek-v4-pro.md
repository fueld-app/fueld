# REVIEW — ROUND 2

## Verdict: APPROVE-WITH-CONDITIONS

---

## MUST

### M1. `orderPayableBase` is computed OUTSIDE the transaction, so the cap can be stale

`orders.service.ts`, `createOrderPayment`:

```ts
const payable = await orderPayableBase(orderId);
const incoming = parseFloat(input.amount) || 0;

const [created] = await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT id FROM ${orders} WHERE id = ${orderId} FOR UPDATE`);
  const alreadyPaid = await sumOrderPayments(orderId, input.currency, tx);
  const outstanding = payable - alreadyPaid;
```

`payable` is read before the transaction begins. The lock serialises concurrent *payments*, but `payable` itself can change between the read and the lock acquisition — an invoice is issued, a line is edited, or a credit note is posted in that window. The second transaction then enforces against a stale basis. The fix is to move `orderPayableBase` inside the transaction, after the `FOR UPDATE`:

```ts
const [created] = await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT id FROM ${orders} WHERE id = ${orderId} FOR UPDATE`);
  const payable = await orderPayableBase(orderId);  // re-read inside the lock
  const alreadyPaid = await sumOrderPayments(orderId, input.currency, tx);
  ...
```

The lock on the order row does not prevent `invoices` or `orderItems` from being modified by other transactions, so the re-read must happen inside the lock to be meaningful. As written, the lock only protects `alreadyPaid`, not `payable`.

---

### M2. `orderPayableBase` does not subtract credit notes / voided invoices correctly

`orders.service.ts`, `orderPayableBase`:

```ts
const [existing] = await db
  .select({ total: sql<string>`COALESCE(SUM(${invoices.amount}::numeric), 0)::text` })
  .from(invoices)
  .where(and(eq(invoices.orderId, orderId), notInArray(invoices.status, ['VOID'])));
const invoiced = parseFloat(existing?.total ?? '0') || 0;
```

Credit notes are typically represented as invoices with negative amounts or a distinct status. If a credit note is a negative-amount invoice with status `SENT` (or any non-VOID status), it is summed into `invoiced` and reduces the payable — which is correct. But if credit notes use a separate status (e.g. `CREDIT_NOTE`, `REVERSED`, `CANCELLED`) that is not `VOID`, they are summed as positive amounts and **inflate** the payable. The `notInArray(invoices.status, ['VOID'])` filter only excludes `VOID`; any other non-invoice status is treated as a claim. The test file only inserts a `SENT` invoice and never exercises a credit note or a voided invoice. This is a real workflow gap: a void-heavy history or a credit-note-heavy history will produce a payable that does not match what the customer actually owes.

**Evidence:** the filter is `notInArray(invoices.status, ['VOID'])` — it does not exclude `CREDIT_NOTE`, `CANCELLED`, `REVERSED`, or any other status that represents a non-claim. The comment says "an issued invoice is the document the customer holds", but the code does not restrict to issued invoices; it restricts to "not VOID".

---

### M3. `amountDue` is a string, and the UI's `paymentsTotal()` is un-scoped — the gate can disagree with the cap

`order-detail-page.component.ts`:

```ts
readonly hasEnoughPaymentsForMarkPaid = computed(() => {
  const raw = this.order()?.amountDue;
  if (raw === undefined || raw === null || raw === '') return false;
  const due = Number(raw);
  if (!Number.isFinite(due)) return false;
  if (due <= 0) return true;
  return this.paymentsTotal() >= due - 0.005;
});
```

`paymentsTotal()` is defined earlier as:

```ts
this.paymentSchedule().reduce((sum, t) => sum + (parseFloat(t.issuedAmount ?? t.amount) || 0), 0),
```

This sums **all** payments regardless of currency. `amountDue` is computed server-side as `orderPayableBase(row.id) - sumOrderPayments(row.id, row.currency)` — i.e. it subtracts only payments in the **order's currency**. If a customer pays 3,000 EUR against a 10,000 USD order, `amountDue` is still `10000.00` (as the test asserts), but `paymentsTotal()` on the UI includes the 3,000 EUR payment. The gate then compares `paymentsTotal()` (which includes EUR) against `due` (which does not subtract EUR). This means the UI's "mark as paid" gate can **pass** when the server's cap would still refuse — the exact disagreement the change was meant to eliminate.

**Evidence:** the test `does not subtract a payment in another currency from the payable` asserts `amountDue` is `10000.00` after a 3,000 EUR payment. The UI's `paymentsTotal()` would include that 3,000 EUR payment. The gate compares `paymentsTotal() >= due - 0.005`, so 3,000 >= 9,999.995 is false — but if the EUR payment were 10,000, `paymentsTotal()` would be 10,000 and `due` would be 10,000, so the gate would pass while the server would refuse a further USD payment. The gate and the cap are not on the same arithmetic.

---

## SHOULD

### S1. `amountDue` costs up to 4 extra queries per `getOrderById` — acceptable, but the comment is misleading

`orders.service.ts`, `getOrderById`:

```ts
const orderAmountDue = (Math.max(
  (await orderPayableBase(row.id)) - (await sumOrderPayments(row.id, row.currency)),
  0,
)).toFixed(2);
```

`orderPayableBase` runs at least 2 queries (invoices + `computeInvoiceAmount`), and `sumOrderPayments` runs 1. `computeInvoiceAmount` may run additional queries. The comment says "computed ONCE on the server" — it is computed once per `getOrderById` call, but `getOrderById` is called on every order detail page load. For a list endpoint or a page that loads many orders, this is a per-order cost. The question asks whether this is acceptable; it is acceptable for a detail page, but the comment should not imply it is free. If `getOrderById` is ever called in a loop (e.g. a list of orders), this becomes a N+1 problem.

---

### S2. The `payable > 0` guard still allows overpayment when `payable` is 0 but a payment is made in a different currency

`orders.service.ts`, `createOrderPayment`:

```ts
if (payable > 0 && incoming > outstanding + 0.005) {
```

If `payable` is 0 (no invoice, no priced lines), the cap is skipped entirely. A payment in any currency is accepted. This is the documented "deposit against a deal being built" workflow, but it means a customer can pay an arbitrary amount in any currency against an order with no payable basis. The test file does not exercise this path. This is a design decision, not a bug, but it is worth flagging: the cap exists to stop overpaying a known debt, but it does not stop overpaying an unknown debt.

---

### S3. The `OrderPaymentError` message uses `input.currency` but the outstanding is computed in the order's currency

`orders.service.ts`, `createOrderPayment`:

```ts
throw new OrderPaymentError(
  outstanding <= 0.005
    ? `This order is already settled in full (${payable.toFixed(2)} ${input.currency}).`
    : `Payment exceeds the ${outstanding.toFixed(2)} ${input.currency} still outstanding on this order.`,
);
```

`payable` is the order's payable in the order's currency. `outstanding` is `payable - alreadyPaid` where `alreadyPaid` is scoped to `input.currency`. If the incoming payment is in a different currency than the order, `payable` is denominated in the order's currency but the message says `${input.currency}`. The test `does not subtract a payment in another currency from the payable` does not trigger this message because the EUR payment is accepted. But if a EUR payment were refused (e.g. the order is settled in USD and a EUR payment is attempted), the message would say "already settled in full (10000.00 EUR)" when the 10,000 figure is USD. The message is misleading.

---

### S4. The `submit()` early return in the modal is a courtesy, not a control — the API is the control, but the modal's `saving()` flag is not reset on error

`order-payment-modal.component.ts`:

```ts
async submit(): Promise<void> {
  if (this.saving()) return;
  const id = this.orderId();
  ...
```

If the API returns an error (e.g. the cap refuses the payment), does `saving()` get reset? The diff does not show the error path. If `saving()` is set to `true` before the API call and only reset on success, a refused payment leaves the modal permanently disabled. This is a UX bug, not a security bug, but it is worth checking.

---

## Disagreements

None. The round 1 findings are correctly addressed: the missing-vs-zero treatment is correct, the currency scoping is correct in principle, and the transaction is a real improvement. The remaining issues are refinements, not reversals.

---

## Summary

The core fix is sound: the cap is enforced server-side, the transaction serialises concurrent payments, and the missing-vs-zero distinction is correct. The remaining MUSTs are:

1. **M1:** `payable` is read outside the transaction — move it inside the lock.
2. **M2:** `orderPayableBase` does not exclude credit notes or other non-claim invoice statuses.
3. **M3:** The UI's `paymentsTotal()` is un-scoped, so the gate can disagree with the cap when cross-currency payments exist.

These are fixable without redesigning the approach. The SHOULDs are refinements to messages, comments, and edge cases.