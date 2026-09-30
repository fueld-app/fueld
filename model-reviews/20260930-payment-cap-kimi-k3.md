# CODE REVIEW

## Findings

### MUST-1: `orderPayableBase` blocks legitimate deposits on partially-invoiced orders
**File:** `orders.service.ts` — `orderPayableBase`

```ts
if (invoiced > 0) return invoiced;
return parseFloat(await computeInvoiceAmount(orderId)) || 0;
```

The invoice-first precedence is correct for a fully-invoiced order, but wrong for a **partially-invoiced** one. If an order has one issued invoice for 5,000 and unbilled lines worth another 5,000, `orderPayableBase` returns 5,000 — the unbilled remainder is invisible. A deposit against the unbilled tranche (a stated real workflow: "taking a deposit against a deal still being built") is now refused as overpayment.

The comment claims this "is the same precedence the customer card and the invoice itself use" — but the customer card shows a *receivable*, not a *payable ceiling*. Those are different questions. The cap should be `max(invoiced, computedLines)` or `invoiced + unbilledLines`, not `invoiced || computedLines`.

---

### MUST-2: `sumOrderPayments` ignores currency — cap is meaningless on mixed-currency orders
**File:** `orders.service.ts` — `sumOrderPayments`

```ts
.select({ total: sql<string>`COALESCE(SUM(${customerPayments.amount}::numeric), 0)::text` })
```

Payments are summed raw with no currency conversion. If an order is billed in USD but a payment arrives in EUR (or vice versa), the cap compares 5,000 EUR against a 5,000 USD payable as if they were the same unit. `computeInvoiceAmount` explicitly refuses mixed-currency orders (`MixedCurrencyInvoiceError`), but `sumOrderPayments` has no such guard — it will happily blend currencies and produce a cap that is wrong in both directions.

At minimum, the sum should be filtered to the invoice currency, or the cap should refuse when payment currencies don't match the payable currency.

---

### MUST-3: `due <= 0 → true` allows marking PAID an order with no invoice and no payments
**File:** `order-detail-page.component.ts` — `hasEnoughPaymentsForMarkPaid`

```ts
if (due <= 0) return true;
```

The intent is correct — "nothing owed" should not block. But `amountDue` is 0 in two very different states:
1. Order fully paid (legitimate).
2. Order has **no priced lines and no invoice** — `orderPayableBase` returns 0, `sumOrderPayments` returns 0, `amountDue` = "0.00".

In case 2 the operator can mark PAID an order that was never billed. The old code returned `false` here, which was wrong for case 1 but safe for case 2. The fix conflates them. The gate needs to distinguish "settled" from "nothing to settle" — e.g. check that `payable > 0` (or at least one payment exists) before allowing mark-paid on a zero-due order.

---

### SHOULD-1: Two extra sequential queries per `getOrderById` — N+1 on list views
**File:** `orders.service.ts` — `getOrderById`

```ts
const orderAmountDue = (Math.max(
  (await orderPayableBase(row.id)) - (await sumOrderPayments(row.id)),
  0,
)).toFixed(2);
```

`orderPayableBase` runs 1–2 queries (invoices, then possibly `computeInvoiceAmount` which itself runs 2 queries), plus `sumOrderPayments` = up to 4 extra sequential round-trips per order read. If `getOrderById` is called in a list/loop, this is an N+1. Acceptable for a single-detail view; should be lazy-loaded or joined if it ever appears in a list endpoint.

---

### SHOULD-2: `OrderPaymentError` message leaks `payable` in the "already settled" branch
**File:** `orders.service.ts` — `createOrderPayment`

```ts
`This order is already settled in full (${payable.toFixed(2)} ${input.currency}).`
```

`input.currency` is the currency of the *incoming payment*, not necessarily the payable's currency. If the order is billed in USD and someone posts EUR, the message reads "settled in full (34694.66 EUR)" — wrong currency, confusing the operator. Use the invoice/order currency.

---

### SHOULD-3: No test for the partially-invoiced deposit scenario
**File:** `orders.service.edges.ts` (referenced but not shown)

The fix description says "orders.service.edges pins a two-payment no-invoice order" — good. But there is no test pinning the partially-invoiced case (MUST-1). The scenario: one issued invoice + unbilled lines → deposit against unbilled remainder → currently refused.

---

### SHOULD-4: `hasEnoughPaymentsForMarkPaid` tolerance asymmetry with the server cap
**File:** `order-detail-page.component.ts`

```ts
return this.paymentsTotal() >= due - 0.005;
```

The web gate uses `due - 0.005` (operator can be half a cent short and still mark paid). The server cap uses `outstanding + 0.005` (operator can overpay by half a cent). These are consistent in direction but the tolerance is applied in different units — one on the due side, one on the payment side. Minor, but worth aligning.

---

## Disagreements

**Invoice-first precedence is not correct as implemented.** The review prompt asks "is invoice-first correct?" — it is correct only when the invoice covers the full order value. For partial invoicing it is wrong (MUST-1). The fix should compute `invoiced + unbilled line total` or `max(invoiced, lineTotal)`, not `invoiced || lineTotal`.

---

## Verdict

**NO-GO**

MUST-1 blocks a stated legitimate workflow (deposits on partially-invoiced orders). MUST-2 makes the cap unreliable on any multi-currency order. MUST-3 re-opens the door to marking unbilled orders as paid. The core idea — server-side cap, single payable source, `amountDue` on the DTO — is sound and the tests are good, but the payable computation needs to handle partial invoicing and currency before this ships.