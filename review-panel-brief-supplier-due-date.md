# Feature design review: Supplier invoice due-date override (Riviera Marine)

## Request (Tomaso, Riviera Marine)
"Some suppliers give us 30 days from **invoice receipt** instead of 30 days from **delivery**. The system is not aware of when the supplier invoice is sent, so we need an option on those orders to override when the supplier invoice due date is."

Goal: least complexity, but fully supported for **future liquidity / cash-flow views** (when money actually leaves the account).

## Current model (verified in code)

- **Per supplier leg** (`order_suppliers`, schema.ts:1141): `paymentTermType` (CREDIT/COD/PREPAY enum), `creditDays` int, `deliveredAt` timestamptz, `amountPaid`, `paidAt`, `note`. Orders can have MULTIPLE suppliers.
- **Order-level legacy columns** (`orders.supplierPaymentTermType/supplierCreditDays`, schema.ts:1055): still used by the financing calc.
- **Due-date math**: `computeDueDate(baseDate, type, creditDays, deliveryDate)` (document.service.ts:830) — CREDIT anchors on `deliveryDate ?? baseDate` + creditDays. Only used for the customer invoice PDF today.
- **Financing cost**: `getFinancingDays()` (order-financing.ts:117) = `customerDays − supplierDays` (pure day count, no calendar dates).
- **Kantox hedging**: `deriveValueDate()` (kantox.service.ts:154) — valueDate = dueDate ?? deliveredAt ?? eta (+creditDays if CREDIT) + bufferDays, rounded. Currently fed from the CUSTOMER side only; PO legs share the same valueDate.
- **Supplier payments**: `supplier_payments` table records actual payments (amount, paidAt) against an orderSupplier. No supplier-invoice entity exists (no invoice number, no received-date, no AP register).
- **UI**: Supplier Payment Terms card (`order-payment-terms-card`) shows term type + credit days + note, driven by the ACTIVE (primary) supplier leg (`activeSupplierPaymentTermType()`). Delivery card sets `orderSuppliers.deliveredAt`.

## Design options

### Option A — Due-date override (RECOMMENDED)
One nullable column: `order_suppliers.supplier_due_date DATE NULL`.
- Semantics: when set, the effective supplier payment due date is this exact calendar date (the trader reads it off the supplier's invoice: "payable 15 Oct").
- Central helper `effectiveSupplierDueDate(supplierLeg, order)` = `supplierDueDate ?? (deliveredAt ?? order.eta) + creditDays` — the ONE function any future liquidity/cash-flow view calls.
- UI: in the Supplier Payment Terms card, when term type = CREDIT, a "Due date override" date input + the computed effective due date displayed (e.g. "Due 15 Oct (overridden — was 12 Sep)").
- Audit: activity_logs entry on set/change (pattern exists for other order fields).
- Migration: single `ALTER TABLE order_suppliers ADD COLUMN supplier_due_date date`.
- Financing day count: when override set, effective supplierDays = max(0, daysBetween(deliveryAnchor, override)) so `getFinancingDays` keeps working (or financing keeps using creditDays — see Q3).
- Kantox PO legs: pass the effective supplier due date into PO-leg value date derivation (see Q4).

### Option B — Payment-term basis + invoice received date
Add `supplierTermBasis` enum (FROM_DELIVERY | FROM_INVOICE_RECEIPT) + `supplierInvoiceReceivedAt DATE NULL`. Due = invoiceReceivedAt + creditDays when basis = receipt.
- More semantic fidelity ("we GET 30 days from receipt"), supports future AP automation.
- But: two fields, more UI, and the trader STILL must enter the receipt date (system still doesn't know it) — so it's strictly more work for the same outcome. The due date is the only financially meaningful datum.

### Option C — Supplier-invoice entity
Full AP register: supplier invoice number, received date, due date, amount, 3-way match against BDN/delivery.
- Best long-term (real AP workflow), but far more complexity than the request needs. Could be phase 2 later; Option A's column survives as a subset.

## Questions for the panel
1. Option choice — is A right, or does B/C pay for itself? Any 4th option?
2. Per supplier leg vs order-level placement? (Multiple suppliers per order exist; the UI terms card shows the active/primary leg. Legacy order-level supplierCreditDays columns still feed financing.)
3. Financing interaction: when override set, should `getFinancingDays` derive supplierDays from the override date vs delivery anchor, or keep using creditDays? (Financing cost currently = margin × rate × max(customerDays − supplierDays, 0).)
4. Kantox PO-leg value dates: wire the override into PO value-date derivation NOW or note as follow-up? (Risk: hedge maturity misaligned with actual cash-out date.)
5. Permissions: who may override — `canSeePrices`, order owner, admin? Existing pattern for financial fields?
6. Edge cases: override earlier than delivery date (prepay-like), override after order paid (paidAt set), clearing the override, term type switched to COD/PREPAY while override set.
7. Anything that already computes supplier due dates that would need updating (search found only computeDueDate for customer invoices + deriveValueDate for customer leg)?