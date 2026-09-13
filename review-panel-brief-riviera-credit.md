# Review brief: Riviera-Marine supplier credit lines — data fix + UX changes

## Context
Tenant: riviera-marine (tenant_id `09692138-3ec3-4312-9f3d-0227c4e859f5`).
Complaint (WhatsApp, Frederik/Daniel): "I have approved a supplier credit line in USD and one in Euro. It still doesn't show up on the deal when we try to put it." Also (Danish): "I can't get credit on some of my suppliers — the latest one is Certa Ireland, order 20260908-000507."

## Findings
- Order 20260908-000507: **USD** deal, supplier leg = **Certa Ireland** (counterparty `147264e8-c491-4ca9-8fbb-d76c72000542`), supplier cost **$87,960**, status INQUIRY.
- DB had **only an EUR 100k / 30d** SUPPLIER credit line for Certa Ireland (auto-created 2026-09-10 15:36 by the credit-application approval flow from an EUR application). **No USD line existed** for Certa Ireland or Prio Supply despite Frederik claiming he approved USD + EUR.
- Prio Supply has **two identical EUR 300k applications approved** (submitted 12:24 and 12:28), so two duplicate EUR 300k lines exist.
- Deal UI (`order-detail-page.component.ts`): `supplierCreditSummary` filters credit lines by `line.currency === order.currency`. With only an EUR line on a USD deal → summary null → Credit option disabled, card said "No credit line on file" — no explanation of the currency mismatch.

## Actions taken (to review)
1. **Code fix (deployed `f943618f` to all 4 VPS)**:
   - `order-payment-terms-card`: new `dealCurrency` + `creditMismatch` inputs. When no same-currency line exists but other-currency lines do, card shows "Credit line on file: EUR 100,000.00 — deal is USD" + a "Request USD line" button (Request Credit now also available for suppliers; previously customer-only). Light users get amber "No USD credit line" badge.
   - Order detail: shared credit-application modal now side-aware (`creditModalSide`), can open with `defaultType='SUPPLIER'` for the active supplier; toast when picking supplier Credit without a matching line explains the currency mismatch.
2. **Data fix (direct SQL on prod DB)**: inserted `credit_lines` (SUPPLIER, USD, 100000.00, period_days 30, note documenting why) + `credit_line_counterparties` link to Certa Ireland — mimicking what `autoApplyCreditLine()` does on approval.
3. **Applied the payment terms via the real API**: `PUT /orders/:id/suppliers/:leg` with `{paymentTermType:'CREDIT', creditDays:30}` (as Patrick instructed "make it happen"). Verified persisted; verified `/credit/lines?type=SUPPLIER&counterpartyId=<Certa>` returns the USD line with `availableAmount: "100000.00"`, `periodDays: 30`.

## Known/code facts to consider
- `autoApplyCreditLine()` (on approval) also syncs `counterparties.credit_limit = requestedAmount`. My manual SQL insert did **not** touch `counterparties.credit_limit` (it is currently 100000, set by the EUR approval — coincidentally identical amount but the column has no currency).
- `calcUsedAmountForSupplier()` computes a line's used amount as `sum(costPrice*quantity)` over all orders with `paymentTermType='CREDIT'` for the line's counterparties with status in CONFIRMED/DELIVERED/INVOICED/PAID — **it does NOT filter by order currency matching the line currency**. So a confirmed EUR credit deal and a confirmed USD credit deal for the same supplier would both reduce the same lines' available amounts.
- The order is INQUIRY → not counted in used amounts until CONFIRMED.
- No application record / approval chain exists for the manually-inserted USD line; the original EUR application remains APPROVED.

## Questions for the panel
1. Is the currency-filtering design on the deal (`line.currency === order.currency`) correct, given that used-amount calculation ignores currency? Should `calcUsedAmountForSupplier` be currency-aware? What's the risk window?
2. Was the direct DB insert of the USD line acceptable, or should we have driven it through the application/approval flow (e.g. created a USD application and approved it) for auditability? What hygiene is missing (link application, notification, credit_limit sync)?
3. The API PUT changed the deal's payment terms to CREDIT/30d — a business decision made on Frederik's behalf per instructions. Any reason to revert and let the trader set it?
4. The duplicate Prio EUR lines double-count available credit. Recommend a safe cleanup (delete one line? merge?) and whether usage already recorded needs care.
5. Any bugs/gaps in the new UI code (mismatch summary aggregation across multiple currencies, `summarizeLines` helper added but existing computeds unchanged, modal side-switching, `ngOnChanges` form reset in the application modal when inputs change while typing)?

## Verdict format
For each question: verdict (OK / CONCERN / MUST-FIX) + reasoning. End with overall MUST-FIX list if any.