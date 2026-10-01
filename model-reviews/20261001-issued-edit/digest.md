# Panel digest — editing an order after its invoice is issued (2026-10-01)

**Panel:** kimi-k3, glm-5.3, deepseek-v4-pro · slug `issued-edit-v1`
**Payload:** `/tmp/issued-edit-panel.md` (brief + 7 appendices)
**Reviews:** `model-reviews/20261001-issued-edit/issued-edit-v1-*.md`
**Verdicts:** 3/3 APPROVE-WITH-CONDITIONS, no NO-GO. Convergent on findings and order.

## Correction to the brief (found after the panel ran)

The brief told the panel that `INV-2026-0006` (368,400.47) "was emailed to the customer
(Dan Bunkering) on 2026-10-01". **That is false.** `email_log` has no row for order
`20260915-000129` and no subject matching `INV-2026-0006`. The invoice was **never sent**.

The confusion: `INV-2026-0007` on order `20261001-000170` — a *different* invoice — was sent to
Dan Bunkering. I read the shipped-invoice list and attributed the send to the wrong one.

This does not change any verdict (every finding is about code, and the urgency claim attached to
glm's F1 only). It does change the remediation.

## What the order actually is (established after the panel)

`20260915-000129` is an **abandoned duplicate**:

| | `20260915-000129` | `20261001-000170` |
|---|---|---|
| Order created | 2026-09-15 13:07 | 2026-10-01 08:38:41 |
| Vessel / place / ETA / delivered | Eendracht / Skaw-Gothenburg / 19-09 / 19-09 | identical |
| Commission line | 1 x 9,288.00 (COMMISSION) | 1 x 9,288.00 (COMMISSION) |
| Invoice | INV-2026-0006 — **368,400.47** | INV-2026-0007 — **9,288.00** |
| Invoice status | was SENT, never emailed | SENT, emailed to Dan Bunkering |
| Invoice issued | 2026-10-01 **08:32:51** | 2026-10-01 08:38:41+ |

Timeline on 2026-10-01:

```
08:29:18 - 08:31  repeated save_items (itemCount 2), order still INQUIRY/CONFIRMED
08:32:51          invoice INV-2026-0006 ISSUED, frozen at 368,400.47
                  -> the order was NOT DELIVERED at this point (DELIVERED came at 08:37:16)
08:36:27 - 08:37:18 repeated save_items, CONFIRMED at 08:37:06, DELIVERED at 08:37:16
                  -> the trader kept hitting the state; the order had no usable 9,288 line
08:38:41          order 20261001-000170 CREATED (same vessel/place/ETA/commission)
                  -> invoiced correctly as INV-2026-0007 = 9,288.00
```

So the trader abandoned the broken order and rebuilt it, which worked. The 368,400.47 figure came
from a mid-edit computation while the order had no usable priced line — and was frozen **before
the order was DELIVERED at all**.

## Consensus findings (severity, all three unless noted)

| # | Sev | Finding |
|---|---|---|
| F1 | P0 | Issuance freezes unvalidated order state — no priced-line invariant, no confirmation, and (proven here) not even DELIVERED. |
| F2 | P1 | `orderPayableBase = Math.max(invoiced, liveLines)` is wrong in both directions: picks the unbilled 7,079.24 over the 6,880.45 document (Case A), and picks the 368,400.47 anyway (Case B). All three: **collections must be invoice-authoritative**. |
| F3 | P1 | Priced fields and `deliveredAt` stay editable after issuance, with no counterpart to `savePaymentSchedule`'s refusal. |
| F4 | P2 | The `InvoiceLinesChangedError` guard is unreachable once a revision exists, so drift is structurally undetectable. |
| F5 | P2 | CREDIT due date anchors on `deliveredAt ?? eta`, which can freeze a pre-delivery guess. |

## Where I was wrong, and the panel corrected me

- I assumed `max()` was a deliberate allowance for over-delivery. All three rebut it: it fails in
  both directions and actively contradicts the frozen document. Invoice-authoritative is correct.
- I assumed a lock/transaction would fix Case B. glm rebutted precisely: "the mid-edit state was
  committed, not interleaved" — a serializable read freezes the same bad number. The **confirmation
  gate** is the fix; the lock is hygiene.

## Disagreement resolution

glm F6 claimed the order-level revision fallback could violate the freeze (ambiguous order →
re-render where a frozen revision exists). **Refuted against the code:** the only other caller,
`getLatestInvoiceRevisionForOrder` (used by `/verify`), is a *different* function that already
excludes VOID and falls back only to genuinely invoiceless legacy revisions. Latent, already
mitigated; no action.

## Recommended order (synthesised)

0. **Ops** — done: `INV-2026-0006` voided, **no reissue** (see below).
1. **Issuance gate** — refuse when not DELIVERED or no priced line; confirm the frozen figure.
2. **`orderPayableBase` invoice-authoritative** — schedule-aware, never raw `max()`.
   Ship BEFORE the edit block, or enforcing the freeze silently drops capped payments on
   already-diverged orders.
3. **Edit block** — block price/currency/terms/`deliveredAt`; `delivered_quantity` as warn + CTA
   pending trader validation (may be a legitimate BDN finalization edit).
4. **Reconciliation job** across all four tenants — the standing detector F4 never provided, and
   the acceptance gate for "are the known cases the complete set".

Two conditions the panel says need product sign-off before 2 and 3: the payable change **lowers
collectible caps** on diverged orders; and the `delivered_quantity` block needs trader input.

## Remediation performed (2026-10-01)

`INV-2026-0006` **voided with `reissue: false`**. Reissue would have been wrong: the same
commission is already correctly invoiced as `INV-2026-0007` (9,288.00), so a replacement would
have double-billed it. Void-only leaves `20260915-000129` with no live invoice and no receivable,
which is correct for an abandoned duplicate.

Live Moxie receivable after: 165,604.43 across 6 live invoices (was 7).

Still open: `INV-2026-0003` (20260902-000108) needs the commercial decision — bill the delivered
7,079.24 by void+reissue, or revert the edit and accept 6,880.45. `INV-2026-0001`
(20260916-000131) needs nothing: its 30/10 was correctly frozen for the state at issuance.
