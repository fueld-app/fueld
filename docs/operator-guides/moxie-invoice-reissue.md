# Moxie — invoice reissue runbook

**Status: DONE (2026-09-30 and 2026-10-01).**
- `20260916-000130` reissued as `INV-2026-0005`; `INV-2026-0004` VOID.
- `20260915-000129` — `INV-2026-0006` (368,400.47) **VOID, no reissue**: the order
  was an abandoned duplicate; the same commission is already correctly billed as
  `INV-2026-0007` (9,288.00). A replacement would have double-billed it.
- `20260902-000108` reissued as `INV-2026-0009` (7,079.24); `INV-2026-0003` VOID.
  It had billed 6,880.45 from a quantity of 91.568 MT while the order was
  mid-edit, and was emailed with that stale figure; the delivered 94.214 MT bills
  7,079.24.

Four invoices were issued before the Sleek invoice layout was corrected. They keep
the bytes they were issued with (an issued invoice is a frozen artifact: the PDF
is stored and served, never re-rendered), so nothing in the deploy changed them.
To correct one, it has to be voided and reissued.

## What was wrong with them

The Sleek layout printed the **order** number under the label "Invoice number":

```
Invoice number: 20260916-000130      ← the order number, not INV-2026-0004
```

So a customer looking for `INV-2026-0004` found no such invoice on the page, and
the reference their payment would quote was the thing labelled as the invoice
number. The PO field was not printed at all. Both are fixed for anything issued
from 2026-09-30 onward.

## The invoices

Run against the Moxie database (`/opt/fueld/.env` → `DATABASE_URL`):

```sql
select o.order_number, o.purchase_order_number as po,
       i.invoice_number, i.amount, i.due_date, i.amount_paid
from orders o join invoices i on i.order_id = o.id
order by i.created_at;
```

| Order | Invoice | Amount | Due | PO | Payments |
|---|---|---|---|---|---|
| 20260916-000131 | INV-2026-0001 | 89,186.00 | 2026-10-30 | — | none |
| 20260908-000113 | INV-2026-0002 | 43,847.89 | 2026-10-01 | — | none |
| 20260902-000108 | INV-2026-0003 | 6,880.45 | 2026-10-13 | — | none |
| 20260916-000130 | INV-2026-0004 | 7,265.62 | 2026-10-23 | `REF : AE088125` | none |

Only `20260916-000130` carries a PO, so it is the only one where reissue changes
the *content* of what the customer needs to reconcile. The other three are
mislabelled (order number shown as the invoice number) but nothing is missing.

## Two things to decide before reissuing

**1. Reissuing changes the invoice number.** `voidOrderInvoice` deliberately
mints a fresh number — "the number is NOT reused: the replacement gets a fresh
one, which is what makes the two documents independently traceable". So
`20260916-000130` would go `INV-2026-0004` → `INV-2026-0005`. If the number has
already been communicated to the customer and quoted on their side, reissuing
fixes the mislabel but changes the number again. That trade is Moxie's call.

**2. The PO value has a label typed into it.** `20260916-000130` stores
`REF : AE088125`. The field is printed verbatim, so the invoice will show:

```
PO number: REF : AE088125
```

Correct the value to `AE088125` **before** reissuing, or that is what the
customer's AP department will see. **Done** for `20260916-000130`: Moxie's other
four invoices print a bare code (`PO.: O7MB108806`), so the stored value is now
`AE088125`. Note also that only 5 of Moxie's 163 orders have a PO number at all —
if POs are meant to appear on invoices, the field is being filled far too rarely.

## How to reissue

Admin only. `POST /orders/:id/invoice/void`, with the order id or number:

```bash
curl -X POST "https://moxie.fueld.app/api/orders/20260916-000130/invoice/void" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"reissue": true, "reason": "Sleek layout printed the order number as the invoice number"}'
```

- `reissue: true` (the default) voids the old invoice and issues a replacement.
- The replacement **keeps the original due date** unless you pass `dueDate`, so a
  payment deadline already communicated does not silently move.
- The old invoice is kept for audit with status `VOID`, and its number is not
  reused. Its PDF stays on file and is marked voided.
- Payments already stamped on the old invoice are re-pointed at the replacement.
  None of these four have any, so nothing moves.
- The replacement renders on first view with the corrected number, PO and
  reference.

### A bug this uncovered (fixed, deployed 2026-09-30, commit `c25c6a9b`)

Right after a reissue the replacement served the **voided** invoice's PDF, stamped
with the cancelled number. The voided revision is the order's most recent INVOICE
revision while the replacement has none of its own, and the order-level revision
fallback matched it — then returned early, so the replacement could never render
one of its own. Fixed by excluding revisions that belong to a VOID invoice; the
regression test asserts the replacement's own number and a different buffer.

The fix is deployed to all four instances. **Any invoice reissued before that
deploy would have been in this state** — `20260916-000130` was reissued after it,
so it is correct. If another instance was reissued earlier, re-check that order's
invoice PDF renders the replacement's number, not the voided one.

## Correcting the PO only

If Moxie decides the numbers are not worth changing, the mislabel can be left —
those invoices still print a working reference (the order number), so they are
usable, just labelled wrongly. In that case correcting `purchase_order_number`
on the order does nothing for the already-issued PDF; it only affects invoices
issued afterwards.

## Still open

Two invoices still print the order number under "Invoice number": `INV-2026-0001`
(89,186.00) and `INV-2026-0002` (43,847.89). Neither carries a PO, so nothing is
missing from them and the reference they print still works — mislabelled, not
broken. Reissuing would change the number for no gain. **Recommendation: leave.**

`INV-2026-0001` needs nothing else: its due date 30/10 was correctly frozen as
delivered 09/10 + 21 days. The order's 01/10 edit moved `deliveredAt` to 09/09
afterwards, which is an internal divergence only.

**Two customers hold superseded documents** and Moxie must send the replacements:
- Global Seatrade was emailed the now-void `INV-2026-0004` → send `INV-2026-0005`.
- Dan Bunkering was emailed the now-void `INV-2026-0003` at 08:23 on 2026-10-01,
  billing 6,880.45 → send `INV-2026-0009` (7,079.24, due 13/10). Until they get
  it they are being asked for 198.79 less than they owe.
