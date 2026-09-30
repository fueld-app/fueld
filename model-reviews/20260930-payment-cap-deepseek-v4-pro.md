## Findings

### MUST

**M1 — `orderPayableBase` invoice-first precedence can block legitimate deposits on partially-invoiced orders.**

`orders.service.ts` (diff, `orderPayableBase`):

```ts
const invoiced = parseFloat(existing?.total ?? '0') || 0;
if (invoiced > 0) return invoiced;
```

The comment claims "Only when there is no issued invoice does the line total stand in — which is the case for an order still being built, where a deposit may legitimately be taken before anything is billed." But the code returns the invoice total whenever ANY issued invoice exists, even if it covers only a tranche of a split order. If tranche 1 is invoiced at 10,000 and tranche 2 (not yet invoiced) is worth 20,000, a customer paying a 15,000 deposit against tranche 2 is refused: `incoming (15,000) > outstanding (10,000 − alreadyPaid) + 0.005`. The fix's own rationale says "a split order's value lives in tranche invoices" — but only once those invoices exist. Between tranches, the payable is understated and legitimate payments are blocked. The test suite has no split-order or partially-invoiced case.

**M2 — `sumOrderPayments` sums across currencies with no conversion; the cap is wrong for multi-currency orders.**

`orders.service.ts`:

```ts
const [row] = await db
  .select({ total: sql<string>`COALESCE(SUM(${customerPayments.amount}::numeric), 0)::text` })
  .from(customerPayments)
  .where(eq(customerPayments.orderId, orderId));
```

`computeInvoiceAmount` explicitly refuses mixed-currency orders (`MixedCurrencyInvoiceError`), but `sumOrderPayments` does not. A customer can pay 5,000 USD and 5,000 EUR against a 10,000 USD order. The cap sees `alreadyPaid = 10,000`, `outstanding = 0`, and refuses the remaining 5,000 USD — or worse, accepts a 5,000 EUR payment as if it were USD. The error message even prints `${outstanding.toFixed(2)} ${input.currency}`, asserting a USD figure in EUR. The invoice helper's own comment says a mixed-currency order "cannot be expressed as one number" — the cap ignores that.

**M3 — `due <= 0 → true` on the web gate can mark an order paid when `amountDue` is absent or unparseable.**

`order-detail-page.component.ts`:

```ts
readonly totalDueForMarkPaid = computed(() => parseFloat(this.order()?.amountDue ?? '') || 0);
```

`amountDue` is optional on `OrderDto` (`amountDue?: string`). If the order was fetched before the API deployed, or `amountDue` is missing for any other reason, `parseFloat('')` is `NaN`, `NaN || 0` is `0`, `due <= 0` is true, and `hasEnoughPaymentsForMarkPaid` returns true. The operator can mark an order paid with zero payments recorded. The comment says "Nothing owed" and "cannot tell" are different, and only the second should refuse — but the code cannot tell them apart. `amountDue` must be required, or the gate must distinguish `undefined` from `'0.00'`.

### SHOULD

**S1 — The 0.005 tolerance is applied inconsistently between server and client.**

Server (`orders.service.ts`):

```ts
if (incoming > outstanding + 0.005) {
```

Client (`order-detail-page.component.ts`):

```ts
return this.paymentsTotal() >= due - 0.005;
```

The server allows `incoming ≤ outstanding + 0.005`; the client requires `paymentsTotal ≥ due − 0.005`. These are not the same predicate. A payment of `outstanding + 0.004` is accepted by the API but leaves `paymentsTotal = due − 0.004`, which fails the client gate (`due − 0.004 < due − 0.005` is false). The operator can record a payment the API accepts and still be told they haven't paid enough. The tolerance should be a single shared constant with one predicate.

**S2 — `amountDue` adds two queries per `getOrderById` call; this is a read-hot path.**

`orders.service.ts`:

```ts
const orderAmountDue = (Math.max(
  (await orderPayableBase(row.id)) - (await sumOrderPayments(row.id)),
  0,
)).toFixed(2);
```

`orderPayableBase` runs up to two queries (invoices, then `computeInvoiceAmount` which runs up to two more), and `sumOrderPayments` runs one. That's 3–5 extra queries per order read. `getOrderById` is likely called on every order detail page load and possibly in list views. For a tenant with many orders, this is a measurable hotspot. Consider caching the payable/payments on the order row, or computing `amountDue` only when explicitly requested (e.g. a query param or a separate endpoint).

**S3 — The cap is not transactional; a race between two concurrent payment requests can still double-post.**

`createOrderPayment` reads `orderPayableBase` and `sumOrderPayments`, then inserts. Two concurrent requests can both read `outstanding = 10,000`, both pass the check, and both insert. The modal's `saving()` guard prevents double-submit from one browser, but two tabs, two operators, or an API client can still race. The test suite only covers sequential requests. A unique constraint or a row lock on the order during payment creation would close this.

**S4 — `orderPayableBase` returns 0 for an order with no invoice and no priced lines, and the cap is skipped — but `amountDue` is then `'0.00'`, which the web gate now treats as "mark paid OK".**

The fix's own comment says "an order with no issued invoice and no priced lines has payable 0, and taking a deposit against a deal still being built is a real workflow." But the web gate change (`due <= 0 → true`) means such an order can be marked paid with zero payments. If the workflow is "deposit before invoicing," the order should not be markable as paid until the payable is known. The server cap and the web gate now disagree about what payable 0 means.

**S5 — `computeInvoiceAmount` throws `MixedCurrencyInvoiceError` for mixed-currency orders, but `orderPayableBase` does not catch it.**

`orders.service.ts`:

```ts
return parseFloat(await computeInvoiceAmount(orderId)) || 0;
```

If an order has mixed-currency lines and no invoice, `orderPayableBase` throws, which propagates out of `getOrderById` and `createOrderPayment` as a 500. The invoice helper's own comment says "Callers must surface this to the user; it is a data problem, not an outage" — but neither caller here does. `getOrderById` will fail entirely for such an order, and `createOrderPayment` will return a generic failure.

## Disagreement

The fix's claim that "`orderPayableBase` defines the payable ONCE" is not true in the partially-invoiced case. The payable is defined once per order, but the basis switches from line-total to invoice-total the moment any invoice is issued, even if that invoice covers only part of the order. The "ONCE" claim holds only for fully-invoiced or never-invoiced orders.

## Verdict

**NO-GO**

M1 (partially-invoiced split orders blocked), M2 (multi-currency cap is wrong), and M3 (missing `amountDue` silently disables the gate) are each sufficient to block. The fix addresses the reported double-payment symptom but introduces regressions for legitimate workflows the codebase explicitly claims to support (deposits before invoicing, split orders, multi-currency). The test suite covers only the happy path and the exact reported sequence; it does not exercise any of the edge cases the fix's own comments claim to handle.