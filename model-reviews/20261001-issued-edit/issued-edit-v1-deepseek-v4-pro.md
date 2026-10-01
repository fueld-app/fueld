## Findings

| # | Severity | File / symbol | What breaks | New / Pre-existing |
|---|----------|---------------|-------------|--------------------|
| 1 | **P0** | `apps/api/src/modules/orders/orders.service.ts` – order/line update handlers (no symbol given) | Post-issuance edits to priced fields (quantity, delivered_quantity, sales_price) are allowed. Live order totals silently diverge from the frozen invoice. Customer‑facing figures disagree, and `orderPayableBase` may overstate what is owed. | Pre-existing |
| 2 | **P0** | `apps/api/src/modules/orders/invoice.service.ts` – issuance path around line 652 (`insertInvoiceWithRetry` / caller) | Invoice can be issued while the order is mid‑edit or has no priced line (Case B). Wrong amount is frozen and emailed to the customer. | Pre-existing |
| 3 | **P1** | `apps/api/src/modules/orders/orders.service.ts:2434-2456` – `orderPayableBase` | Uses `Math.max(invoiced, liveLines)`. When live lines exceed the frozen invoice, the payment cap and collections readers chase a larger amount than the customer was actually billed. | Pre-existing |
| 4 | **P1** | `apps/api/src/modules/orders/invoice.service.ts:652-668` + `apps/api/src/modules/orders/invoice-amounts.ts:25-48` – `computeInvoiceDueDate` | Due date is anchored on `deliveredAt ?? eta`, but `deliveredAt` can be set before the order is DELIVERED. A pre‑delivery guess can be frozen at issuance, and later edits cause divergence (Case C). | Pre-existing |
| 5 | **P2** | `apps/api/src/modules/documents/document.service.ts:1455-1495` – `generateOrderInvoicePdfBuffer` | The `InvoiceLinesChangedError` guard runs only on the first render. Once a revision exists, the early return bypasses the guard, so later divergences are never detected or warned about. | Pre-existing |

## Answers to the six questions

**1. Which interventions, and in what order? Is Case B a separate defect?**  
Yes, Case B is a **separate defect**: it occurs at issuance time, not after issuance. It needs its own guard.  
Recommended interventions, in order:

1. **Guard issuance** (intervention 5) – refuse to issue when the order is not DELIVERED or has no priced lines.  
2. **Block priced edits** once an invoice exists (intervention 2) – mirror `savePaymentSchedule`.  
3. **Reconcile the money path** (intervention 4) – `orderPayableBase` should use invoices only, not `max()`.  
4. **Make divergence visible** (intervention 3) – side‑by‑side display as an interim/fallback for legacy data.  

Warn‑only (intervention 1) is not sufficient because it still allows silent money divergence.

**2. Is freezing‑on‑issue still the right model?**  
Yes. The freeze is load‑bearing and matches the `savePaymentSchedule` precedent. Once an invoice is issued, the live figure must **never** silently win. Any correction must go through `voidOrderInvoice` with a fresh number.

**3. For collections: frozen invoice or larger live line total?**  
The money owed must be the **frozen invoice**.  
`Math.max()` is wrong because it can overstate the debt and cause collections to chase a number the customer never agreed to. The fix: `orderPayableBase` returns the sum of non‑VOID invoices only. The alternative (live lines) would over‑collect and break trust.

**4. Is anchoring CREDIT due dates on `deliveredAt ?? eta` correct when `deliveredAt` may be a pre‑delivery guess?**  
No. Issuance should **require DELIVERED status**. That makes `deliveredAt` the actual delivery date, not a guess. The `?? eta` fallback should remain only for non‑DELIVERED contexts (e.g., provisional schedule previews), never for a frozen invoice.

**5. Case B trigger: no unpriced lines / confirmation gate, or transactional issuance?**  
Both. The right fix is a **gate at issuance**: reject if the order is not DELIVERED or has no priced lines. Additionally, the issuance computation should run **transactionally** (lock the order row) so concurrent edits cannot change the order between amount computation and invoice insert.

**6. What must be fixed before the rest, and what can wait?**  
Must fix first (customer‑visible money problems):

- **Case B guard** (P0) – prevents wrong invoices from being emailed.  
- **Block post‑issuance edits** (P0) – prevents live figures from diverging after a correct invoice.  
- **`orderPayableBase`** (P1) – stops collections from overstating the amount owed.

Can wait:

- Visible side‑by‑side reconciliation (P2) – helpful for existing divergences, but not a root cause.  
- First‑render guard enhancement (P2) – becomes moot once edits are blocked, but useful for legacy detection.

## Recommended implementation order

1. **Add issuance guard**: require `order.status === 'DELIVERED'` and at least one priced line; compute amount inside a transaction/lock. *(Highest value – stops Case B immediately.)*  
2. **Block edits to amount‑affecting and due‑date‑affecting fields** once any non‑VOID invoice exists for the order; force `voidOrderInvoice` + reissue for corrections.  
3. **Change `orderPayableBase`** to `SUM(invoices.amount)` for non‑VOID invoices only; remove `Math.max`.  
4. **Add frozen‑vs‑live display** on order and payment cap for any legacy divergences.  
5. **Optionally** extend the PDF guard to run on every render, or add a reconciliation job to flag existing divergences.

## Verdict

**APPROVE‑WITH‑CONDITIONS**

The plan is correct, but it must be implemented in the order above. Visibility alone is not acceptable; the money path must be corrected and bad issuance prevented before any further orders are edited or invoiced.
