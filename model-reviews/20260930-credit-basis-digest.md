# Credit usage basis — delivered vs ordered (no panel round)

Single-cause fix, verified against production. No panel: the change is one
expression with a direct regression test, and the report driving it was a customer
complaint rather than a design decision.

## The report
channeltx customer (John): "We clear the invoice as paid, but it does not credit the
value back to the client's credit line. I.e. STS pays 152K."

## What the data showed
`STS` matches no counterparty. But channeltx **does** have a customer whose used
credit was exactly **151,836** — which rounds to "152K":

- Fratelli Cosulich USA LLC, credit line 200,000
- order `20260624-000087`, status INVOICED, `paid = 0` — and that single order is the
  WHOLE of their used credit
- **ordered basis 151,844.30 vs delivered basis 151,836.09**

## Root cause
`calcUsedAmountForCustomer` summed `salesPrice × quantity` — the ORDERED quantity —
while the invoice, `order-financing` and the new payment cap all use the DELIVERED
quantity. Exposure held and amount owed were therefore computed from different
numbers and could never agree, and a part-delivered order held MORE credit than the
customer owed. That is the mechanism behind "clearing the invoice does not free the
value on the credit line".

Fixed: the customer-side sum uses `COALESCE(deliveredQuantity, quantity)`.

## Refuted along the way (do not repeat these)
Three plausible stories were checked against the data and **disproven**:
1. "Credit holds until status PAID" — no: `usedAmount` nets payments against any
   active status, so a fully-paid active order contributes `max(value − paid, 0) = 0`.
2. "A currency mismatch stops the netting" — no: zero cross-currency payments across
   all four instances.
3. "The duplicated payment was holding the credit" — no: the reported order had
   `paid = 0` and no invoice (channeltx has ZERO invoices), so there was nothing to
   over-pay. The duplicate story belongs to the *other* two orders, not this one.

## Deliberately NOT changed
The SUPPLIER side still sums the ORDERED quantity, though it looks like the mirror
image. `updateOrderSupplierAmountPaid` settles a leg on costPrice × quantity ordered
and that is what defines a leg as fully paid; switching this reader would make
"settled" and "fully paid" disagree for every open supplier leg. That is settlement
semantics, not a consistency fix, and needs its own change and tests. Recorded in the
comment so it does not read as an oversight.

## Verified
`credit-used-basis.e2e.test.ts`: 100 MT ordered / 60 delivered at 100 gives **6,000**
used, not 10,000; paying 6,000 releases the line to **0**. Reverting the sum to the
ordered basis fails both (**10,000** used, **4,000** still held) — so the tests pin
the basis rather than passing vacuously. Suite 986 → 988 pass, failure set otherwise
identical to baseline.
