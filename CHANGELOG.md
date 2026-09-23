# What's New — Recent Updates

Here's a summary of the improvements and fixes rolled out over the past couple of weeks.

---

## Invoicing

- **Real invoice numbers and a working receivables ledger.** Issuing a final invoice now creates the invoice on the order with a proper number (e.g. `INV-2026-0007`, format configurable per tenant), its own amount, and its own due date. Previously invoices were never actually recorded, so documents showed a placeholder number, the Collections widget and Invoice Aging report stayed empty, and QuickBooks sync could not run at all.
- **Due dates follow the real delivery date.** Credit terms are now counted from the actual delivery date (falling back to ETA before delivery) instead of always counting from ETA. Cash-on-delivery and prepayment invoices are due on the delivery/advance date rather than silently gaining a 30-day credit term.
- **Payments settle a specific invoice.** Recording a payment updates that invoice's paid amount, so the paid/outstanding figures on each invoice are correct and one invoice's payment can no longer be counted against another.
- **Split payment terms — one invoice per tranche.** An order can now carry a payment schedule (e.g. 50% cash in advance and 50% at 21 days), and issuing bills each tranche as its own numbered invoice with its own amount and its own due date. Cash-in-advance tranches are due on the issue date; delivery-based tranches count from the actual delivery date plus the tranche's own credit days. A payment that arrives before issuance and covers more than one tranche is split across them, so no tranche ever reads unpaid for money already received.
- **Overdue is always current.** Overdue status is calculated from each invoice's due date at the moment you look at it, so it can never go stale.

---

## Orders & Inquiries

- **Lost Inquiries are now separate from Cancelled Orders.** When you cancel an inquiry before it becomes an order, it now shows up in a new "Lost Inquiries" list instead of mixing with cancelled orders. Cancelled Orders now only contains actual orders that were cancelled.
- **New Response Deadline field** on inquiry creation — you can now set a deadline for suppliers to respond, and it appears on the inquiry board.
- **PO Number field is always visible** on the order details page, even when a broker is assigned. Previously it would disappear when a broker was set.
- **Customer and supplier terms** now show up to 2 lines by default with a "show more" toggle, so you can see more terms at a glance without scrolling.

## Filtering

- **New filter overlay on Companies, Vessels, and Places pages.** The same filter panel used on the orders list is now available across all major list pages, with relevant filters for each:
  - **Companies:** Filter by type, responsible person, country, and segment
  - **Vessels:** Filter by vessel type and flag
  - **Places:** Filter by place type and responsible person
- **Filter overlay works properly on mobile** — the panel now stays within the screen and the filter button sits next to the search bar.
- **Filters persist after refresh.** If you filter on a customer and refresh the page, the customer name still shows in the filter overlay.
- **Search shows results immediately on focus** — no need to type first; the first matches appear as soon as you click into a search field.
- **Loading spinner** shows instead of "No results" while searching.
- **"Port" renamed to "Place"** in the order filter to match the actual entity name.

## WhatsApp

- **WhatsApp linking issue fixed.** If WhatsApp appeared disabled for your account despite being enabled in settings, this is now resolved — the system correctly reads your tenant's WhatsApp settings.
- **`{{Phone}}` variable now works in WhatsApp group message templates.** Previously this variable only worked in direct messages; now it resolves in group notifications too.
- **Per-product template variables** added for WhatsApp messages (e.g. `{{product1}}`, `{{product1Qty}}`) and conditional/iteration block support (`{{#items}}...{{/items}}`).
- **Order confirmation notifications** now include date variables (ETA, ETD, delivery window).

## Invoice & PDF

- **QR code repositioned** in invoice PDFs to sit alongside payment terms.
- **PO label** changed from "PO No.:" to "PO.:" across all PDF templates.
- **Price decimal precision** capped at 4 digits to prevent overly long numbers in PDFs and order details.
- **Proforma invoice generation blocked** after delivery — you can no longer generate a proforma for an order that's already been delivered.
- **Invoice notes** moved directly under the due date for better readability.

## Integrations

- **QuickBooks invoice sync** added — invoices can now be synced to QuickBooks with token expiry warnings.
- **Argentina** added to the country dropdown list.
- **Manual KYC date fields** added to company records.

## Reports & Dashboard

- **Team-based report attribution** fixed — reports now correctly attribute orders to the right team members.
- **Tenant isolation** fixed for teams — teams are now properly scoped to their tenant.

---

_These changes have been deployed to all instances (staging, ChannelTX, Riviera Marine, and Moxie)._