# Panel digest — payment cap + mark-paid gate (2 rounds)

Panel: deepseek-v4-pro:0813, kimi-k3, glm-5.3 (ollama HTTP API, no-tools, `think:false`).
Raw: `20260930-payment-cap-*.md` (round 1), `-r2-*.md` (round 2).

## The reported bug (customer, via WhatsApp)

> "We clear the invoice as paid, but it does not credit the value back to the client's credit line.
> I.e. STS pays 152K, we clear the invoice, it does not free up the same value on the credit line."
> "Also when you process payment the system requires you to mark paid 2x to be able to move to paid."

## Verified against production before touching anything

On **channeltx** (`74.208.245.215`), order `20260706-000129`, line
`7500 MT ordered / 7382 MT DELIVERED @ 4.6925`:

- ordered basis **35,193.75**, delivered basis **34,694.66** (what the UI displayed)
- **two** payment rows, same amount `34,694.66`, same `received_at`, created **62 seconds
  apart** (19:13:21, 19:14:23); the order went PAID at 19:14:27
- the page therefore read **"Total paid: 69,389.32"** against a 34,694.66 receivable

Mechanism: paying exactly what the screen asked (34,694.66) left the operator short of what the
gate compared against (35,193.75), so he paid again — the two symptoms are one cause. The API
validated only `Number.isFinite(amount) && amount >= 0`, so nothing refused the second payment.

**Reproduction of the reported 152K failed, and two of my own hypotheses were killed by the
data:** `STS` matches no counterparty in any of the four instances; and my two best theories —
"credit holds until status PAID" and "a currency mismatch stops the netting" — were both refuted
(a fully-paid active order contributes `max(value − paid, 0) = 0`, and there are zero
cross-currency payments in production). The mechanism above is proven; the 152K figure needs the
customer's own credit line. Deliberately fixed tenant-agnostically.

## Round 1 → NO-GO from deepseek and kimi. All findings accepted and fixed.

1. **`due <= 0 → true` conflated "nothing owed" with "cannot tell"** (deepseek MUST, kimi MUST-3).
   `amountDue` is now REQUIRED on `OrderDto`; the gate treats missing/non-finite as refuse and only
   an explicit `0` as "nothing owed".
2. **`sumOrderPayments` ignored currency** (kimi MUST-2, glm). A payment was subtracted from a
   payable in a different denomination, and the refusal message named the wrong currency.
3. **Invoice-only precedence blocked prepayment of a partially invoiced order** (kimi MUST-1). The
   payable is now `max(invoiced, lineTotal)` — both are real claims, and taking one alone was wrong
   in each direction.
4. **`computeInvoiceAmount` throws on mixed-currency lines and propagated** (deepseek, glm).
   Guarded: a data problem that makes an order uninvoiceable must not turn a payment into a 500.
5. **Check-then-insert was not a control** (glm). The cap and the insert are now one transaction
   with `SELECT … FOR UPDATE` on the order row.

**One round-1 finding was my briefing error, not a code bug:** glm's MUST-1 concluded the documented
`payable > 0` guard was absent. It was present in the code; my brief's diff had been captured before
that edit. The reviewer read the payload correctly — the payload was wrong. Round 2's brief was
regenerated from the tree with an assertion that the guard appears in it.

## Round 2 → APPROVE-WITH-CONDITIONS (deepseek, kimi); glm NO-GO-ish on two points

The conditions were real and are fixed:

- **The payable basis was read OUTSIDE the lock** (deepseek M1, kimi M1, glm). I had claimed "one
  transaction" while `orderPayableBase` ran before it — so an invoice issued, a line edited or a
  credit note posted in that window would be enforced against a stale basis. `orderPayableBase`
  and `resolvePaymentInvoiceTarget` now both take the transaction and run *inside* the lock.
- **Cross-currency comparison** (glm): refusing a payment whose currency differs from the order's,
  since there is no FX rate to convert with. All production payments are USD, so this path is
  unreachable today — but the comparison was wrong and the message mislabelled denominations.
- kimi's second condition (`resolvePaymentInvoiceTarget` inside the transaction) is the same fix.

## Verified-by-me, not taken on trust

- The cap test **fails with the cap disabled** (4 of 5 cases) — a guard test that cannot fail is
  decoration.
- `orders.service.edges` pinned a EUR+USD pair on a USD order. That fixture pinned incidental
  behaviour, not its subject (payment ordering), so it was corrected to USD rather than being
  allowed to block the currency rule.
- 8 tests in `order-payment-cap.e2e.test.ts`, including the delivered-vs-ordered basis that caused
  the original double payment.

## Left as-is, stated in the code

The cap is enforced only when `payable > 0`, because a deposit against an order with no invoice and
no priced lines is a real workflow. `amountDue` uses the order-currency balance; payments in other
currencies are not netted into a displayed total (no FX rate).
