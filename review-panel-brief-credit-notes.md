# Panel Review Brief — Credit Note Support for Fueld (Riviera Marine request)

## Context
Fueld is a multi-tenant bunker trading SaaS. Orders are two-sided: the broker/trader (e.g. Riviera Marine) buys from a supplier and sells to a customer, often at different prices, on separate payment terms. Each tenant runs its own VPS with its own Postgres + QuickBooks Online integration.

A trader (Allan, Riviera Marine) hit this real-world case, reported via WhatsApp:
- His supplier issued a **credit note** (money back) on a delivered order (USS JASON DUNHAM, Limassol, LSMGO 720 MT total).
- To represent it, he added a fake **"CREDIT NOTE" product line** (480 MT) with a negative cost on the buy side and **no sell price**.
- Consequence 1: the customer-facing CONFIRMATION PDF includes this line with a bare dash where the price should be — looks broken.
- Consequence 2: the order economics panel treats it as a product line, so totals show confusing negative margin (e.g. -4,069 USD gross, -1,469.50 net), and it is unclear what the credit actually does to the deal. His words: "I get a credit note from the supplier, but my price becomes higher than the price to my customer."

## Existing data model (relevant parts)
- `order_suppliers` — per-order supplier legs (companyId, payment terms, deliveredAt, settlement: amountPaid/paidAt).
- Order lines — costPrice (supplier side, with formula pricing: Platts ref, premium, barging, credit days, costPriceFinalized) and sell side (sales pricing model, sell price, taxRate/taxAmount).
- `product_type` enum already contains 'CREDIT_NOTE' (but it is only a label; no behavior anywhere).
- Document pipeline: OFFER / PROFORMA_INVOICE / INVOICE / CONFIRMATION PDFs generated server-side, emailable; numbering prefixes OFF/PFI/INV.
- QuickBooks integration just launched: sync order -> QBO Customer lookup/creation, Item mapping, Invoice creation. Tokens encrypted AES-256-GCM per tenant.
- Credit management exists for customer credit lines/limits (separate concept, do not confuse).

## Proposed plan

### Phase 1 (quick wins, ~hours)
- Confirmation PDF: skip product lines with no sell price flagged as internal — stops the empty CREDIT NOTE row on customer docs.
- Order economics panel: separate "Adjustments" block so credit lines don't distort visible margin.

### Phase 2 (~1 day): Supplier credit notes as first-class objects on the supplier leg
- New table/objects per order_suppliers leg: CN number, supplier invoice reference, reason (price correction / quantity shortage / quality claim / rebate), amount + currency, date, status (expected -> received), note.
- Cost math: leg net cost = product costs - supplier credits. Order panel shows gross margin and net margin (after credits) separately.
- Never rendered as a product row on customer documents.

### Phase 3 (~1 day): Customer credit notes as separate documents
- Proper Credit Note document: CN-YYYY-NNNN numbering, negative amount referencing original invoice/confirmation, reason, printable + emailable like invoices.
- Optional confirmation footnote: "A credit note of USD X will be issued in respect of this order".
- Optional later: QBO mapping — supplier credit -> Vendor Credit against the supplier bill; customer credit -> CreditMemo linked to invoice.

## Questions for the panel
1. Is the phased approach right, or would you restructure? Any missing phases?
2. Data-model concerns: credits on the supplier leg vs order level? Multiple credits per leg? Partial credits (e.g. credit covers only 480 of 720 MT, or only one product)? Allocation to specific product lines — worth the complexity?
3. Currency handling when the credit differs from order currency.
4. Pitfalls in the margin display split (gross vs net after credits) — how should commission/other product types interact?
5. The Phase 1 PDF heuristic (skip internal/no-price lines) — risks of hiding a legitimate line?
6. CN numbering across a tenant vs per order — implications for audit and QBO CreditMemo references?
7. Anything about the QBO mapping (Vendor Credit / CreditMemo) that could bite later?
8. Over-engineering risks: what would you cut for a trading company with 4 tenants?

Return: verdict per phase (approve / approve with changes / reject), concrete concerns ranked by severity, and any cheaper alternative you'd recommend instead.