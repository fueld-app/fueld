# REVIEW — Round 2 Payment-Cap Fix

## Verdict: **APPROVE-WITH-CONDITIONS**

The round 1 findings are genuinely fixed. The transaction closes the race, the currency scoping is correct, and the missing-vs-zero distinction is properly handled. Two conditions must be met before merge.

---

## MUST

### M1. `orderPayableBase` is called **outside** the transaction — the lock does not protect the payable read

**File:** `orders.service.ts`, `createOrderPayment`

```ts
const payable = await orderPayableBase(orderId);  // ← OUTSIDE tx
const incoming = parseFloat(input.amount) || 0;

const [created] = await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT id FROM ${orders} WHERE id = ${orderId} FOR UPDATE`);
  const alreadyPaid = await sumOrderPayments(orderId, input.currency, tx);
  const outstanding = payable - alreadyPaid;  // ← uses stale `payable`
```

The `FOR UPDATE` lock serialises concurrent **payment inserts**, and `sumOrderPayments` is correctly re-read inside the lock. But `orderPayableBase` runs **before** the transaction starts. If a concurrent request modifies the order's lines or invoices (e.g., a credit note voids an invoice, or a line price is adjusted) between the `orderPayableBase` call and the lock acquisition, the cap is computed against a stale payable.

**Concrete scenario:** Order has payable 10,000. Request A reads payable=10,000. Concurrently, an invoice for 4,000 is voided, making the true payable 6,000 (lines-only). Request A acquires the lock, reads alreadyPaid=7,000, computes outstanding=3,000, and accepts a 3,000 payment — but the true outstanding is −1,000 (overpaid).

**Fix:** Move `orderPayableBase(orderId)` inside the transaction, after the `FOR UPDATE`:

```ts
const [created] = await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT id FROM ${orders} WHERE id = ${orderId} FOR UPDATE`);
  const payable = await orderPayableBase(orderId);  // ← inside lock
  const alreadyPaid = await sumOrderPayments(orderId, input.currency, tx);
  ...
```

Note: `orderPayableBase` uses `db` directly (not the `tx` executor). It also needs to accept an executor parameter, same as `sumOrderPayments` does, or it will read outside the transaction's snapshot even if called inside the callback.

---

### M2. `resolvePaymentInvoiceTarget` is called **outside** the transaction — the invoice lookup is not protected

**File:** `orders.service.ts`, `createOrderPayment`

```ts
const invoice = await resolvePaymentInvoiceTarget(orderId);  // ← OUTSIDE tx
```

If a concurrent request voids the invoice that `resolvePaymentInvoiceTarget` selected, the payment row will reference a voided invoice. This is less severe than M1 (the payment itself is still capped correctly), but it means `invoiceId` on the payment can point to a voided document, and `recomputeInvoiceAmountPaid` will then run against that voided invoice.

**Fix:** Move inside the transaction, or at minimum re-validate the invoice status after the lock is held.

---

## SHOULD

### S1. `orderPayableBase` does not accept a transaction executor

**File:** `orders.service.ts`, `orderPayableBase`

```ts
export async function orderPayableBase(orderId: string): Promise<number> {
  const [existing] = await db  // ← always uses `db`, never `tx`
```

`sumOrderPayments` correctly accepts an `executor` parameter. `orderPayableBase` does not. Even after fixing M1 by moving the call inside the transaction callback, the queries inside `orderPayableBase` will still run on the default `db` connection, outside the transaction's snapshot. This means the `FOR UPDATE` lock provides no isolation for the payable computation.

**Fix:** Add the same `executor` parameter pattern:

```ts
export async function orderPayableBase(
  orderId: string,
  executor: { select: typeof db.select } = db,
): Promise<number> {
```

---

### S2. `max(invoiced, lines)` — credit note scenario not handled

**File:** `orders.service.ts`, `orderPayableBase`

The `notInArray(invoices.status, ['VOID'])` filter excludes VOID invoices, which is correct. But there is no handling for **credit notes** (negative-amount invoices or a `CREDIT_NOTE` status). If the schema supports credit notes as invoice rows with negative amounts, the `SUM` will correctly reduce `invoiced`. But if credit notes are stored as a separate type or with a different status that is not `'VOID'`, they will be **added** to the payable, inflating it.

**Question:** Does the schema have a `CREDIT_NOTE` invoice status or type? If so, it needs to be either excluded or handled with sign awareness.

---

### S3. `amountDue` costs 2 extra queries per `getOrderById`, not 4

**File:** `orders.service.ts`, `getOrderById`

```ts
const orderAmountDue = (Math.max(
  (await orderPayableBase(row.id)) - (await sumOrderPayments(row.id, row.currency)),
  0,
)).toFixed(2);
```

`orderPayableBase` runs 2 queries (invoice sum + `computeInvoiceAmount`). `sumOrderPayments` runs 1. Total: 3 extra queries per `getOrderById`. The "up to 4" in the scrutiny questions overstates it slightly. This is acceptable for a detail-page load, but worth noting that `computeInvoiceAmount` may itself run multiple queries internally (its implementation is not shown). If it does, the actual cost could be higher.

---

### S4. The `hasEnoughPaymentsForMarkPaid` tolerance is asymmetric with the server cap

**File:** `order-detail-page.component.ts`

```ts
return this.paymentsTotal() >= due - 0.005;
```

The web gate subtracts 0.005 from `due` (making it easier to pass), while the server cap adds 0.005 to `outstanding` (making it harder to overpay). These are consistent in direction — both favour the operator — but the web gate's `paymentsTotal()` is the **un-scoped** sum (all currencies), while `amountDue` is the **order-currency-scoped** balance. If an order has 3,000 EUR paid and 10,000 USD due, `paymentsTotal()` includes the EUR 3,000, so `hasEnoughPaymentsForMarkPaid` could return `true` when the USD balance is not actually covered.

This is a display/gate issue, not a control issue (the server cap is the control), but it could confuse the operator.

---

### S5. `console.warn` in `orderPayableBase` catch block

**File:** `orders.service.ts`, `orderPayableBase`

```ts
console.warn('[Orders] No payable basis for order', orderId, err instanceof Error ? err.message : err);
```

This logs the raw error message, which may contain internal details. Consider sanitising or using a structured logger. Minor.

---

## Round 1 findings — verification

| # | Finding | Fixed? | Evidence |
|---|---------|--------|----------|
| 1 | `due <= 0 → true` conflation | ✅ | `hasEnoughPaymentsForMarkPaid` now checks `raw === undefined \|\| raw === null \|\| raw === ''` → `false`, and `due <= 0 → true` only for explicit 0 |
| 2 | Currency-agnostic sum | ✅ | `sumOrderPayments` takes `currency?: string` and filters `eq(customerPayments.currency, currency)` when provided |
| 3 | Invoice-only precedence | ✅ | `orderPayableBase` returns `Math.max(invoiced, lines)` |
| 4 | `computeInvoiceAmount` throw propagation | ✅ | Wrapped in try/catch, falls back to `invoiced` or 0 |
| 5 | Check-then-insert race | ✅ | `FOR UPDATE` + re-read inside transaction (but see M1/M2 — the lock does not cover all reads) |

---

## Scrutiny questions — answers

1. **Does the transaction close the race?** Partially. The payment-sum re-read is inside the lock, which is correct. But the payable computation and invoice resolution are outside — see M1, M2, S1.

2. **`max(invoiced, lines)` — wrong basis scenarios?** Credit notes are the gap (S2). Split orders and discounted deals are handled correctly by `max` — the larger claim wins, which is the conservative direction.

3. **Currency scoping vs UI "Total paid"?** The UI's un-scoped total will disagree with the scoped cap in cross-currency cases. This is acknowledged in the code comments and is the right trade-off, but the operator may see "Total paid: 13,000" (USD+EUR) against an `amountDue` of "10,000.00" and think the order is overpaid when it is not (S4).

4. **Missing-vs-zero: any remaining path to marking unpaid as paid?** No. The gate refuses on missing, non-finite, or empty. The `order-loader.service.ts` maps `d.amountDue ?? ''` which the gate treats as missing → refuse. Correct.

5. **Query cost?** 3 extra queries (not 4), acceptable for a detail page (S3).

---

## Conditions for approval

1. **M1 + S1:** Move `orderPayableBase` inside the transaction and give it an `executor` parameter.
2. **M2:** Move `resolvePaymentInvoiceTarget` inside the transaction, or document why it is safe outside.