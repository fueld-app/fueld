# What's New — Recent Updates

Here's a summary of the improvements and fixes rolled out over the past couple of weeks.

---

## Invoicing

- **Real invoice numbers and a working receivables ledger.** Issuing a final invoice now creates the invoice on the order with a proper number (e.g. `INV-2026-0007`, format configurable per tenant), its own amount, and its own due date. Previously invoices were never actually recorded, so documents showed a placeholder number, the Collections widget and Invoice Aging report stayed empty, and QuickBooks sync could not run at all.
- **Due dates follow the real delivery date.** Credit terms are now counted from the actual delivery date (falling back to ETA before delivery) instead of always counting from ETA. Cash-on-delivery and prepayment invoices are due on the delivery/advance date rather than silently gaining a 30-day credit term.
- **Payments settle a specific invoice.** Recording a payment updates that invoice's paid amount, so the paid/outstanding figures on each invoice are correct and one invoice's payment can no longer be counted against another.
- **Each tranche is its own downloadable/emailable document.** Because a split order has one invoice per tranche, you can download or email a specific one (e.g. the balance invoice) rather than only the first, and each document shows the order total alongside the amount this invoice bills so the figures reconcile.
- **Financing cost reflects when the money actually arrives.** A deal split 50% in advance and 50% at 60 days is financed for the 60-day half only, not for the whole invoice value for 60 days — so the carrying cost shown against the order, the dashboard and the reports matches what the instalments really cost.
- **QuickBooks syncs every tranche.** For a split order, "sync to QuickBooks" now pushes each invoice rather than trying to push one order-level invoice that does not exist, and tells you how many landed if one fails.
- **Set up split payment terms from the order screen.** A deal paid in instalments (e.g. 50% cash in advance and 50% at 21 days) is configured on the order itself: add a tranche, give it a share and when it falls due, and save. The editor shows the running total and previews what each tranche will bill.
- **A part-payment covering several invoices stays one payment.** If a customer pays for two tranches in one transfer, it is recorded and shown as the single payment it was, with the invoices it settled — instead of appearing as several separate receipts.
- **Split payment terms — one invoice per tranche.** An order can now carry a payment schedule (e.g. 50% cash in advance and 50% at 21 days), and issuing bills each tranche as its own numbered invoice with its own amount and its own due date. Cash-in-advance tranches are due on the issue date; delivery-based tranches count from the actual delivery date plus the tranche's own credit days. A payment that arrives before issuance and covers more than one tranche is split across them, so no tranche ever reads unpaid for money already received.
- **Overdue is always current.** Overdue status is calculated from each invoice's due date at the moment you look at it, so it can never go stale.

---

## Orders & Inquiries

- **Lost Inquiries are now separate from Cancelled Orders.** When you cancel an inquiry before it becomes an order, it now shows up in a new "Lost Inquiries" list instead of mixing with cancelled orders. Cancelled Orders now only contains actual orders that were cancelled.
- **New Response Deadline field** on inquiry creation — you can now set a deadline for suppliers to respond, and it appears on the inquiry board.
- **PO Number field is always visible** on the order details page, even when a broker is assigned. Previously it would disappear when a broker was set.
- **Customer and supplier terms** now show up to 2 lines by default with a "show more" toggle, so you can see more terms at a glance without scrolling.

## Broker Deals

- **A supplier that funds the commission can now be invoiced for it.** When Moxie negotiates a rate above the usual $3/MT, the supplier pays that commission rather than the customer. Reports → Supplier Commission now has an **Invoice suppliers** button: pick a period, and each supplier with commission owing gets a real invoice in its own number series (`SINV-…`), with the lines, a due date, Moxie's own bank details, and a PDF to send.

  These invoices are a **separate ledger from customer invoices**, on purpose: customer invoices are read as money owed *to* us *by* the customer everywhere in the system (Collections, Invoice Ageing, the company balance and QuickBooks), so a supplier invoice filed there would have shown up as a customer debt. Supplier invoices are hidden from all of those, and the two number series never interleave.

  An issued invoice is frozen — the lines, amounts and remittance details are captured when it is raised, so renaming a company, editing a rate or delivering the order later cannot change a document the supplier already holds. Voiding an invoice releases that period so the correct one can be raised; the voided document keeps its number and is kept for audit.

  Recording money received from the supplier against the invoice updates what has been received and the paid/outstanding figures. `Create supplier invoices` is safe to click twice — it bills each supplier once per period and tells you which were already invoiced.

  **Reports → Supplier Invoices** lists them newest first, with a toggle for voided ones, and each row opens a detail page showing the frozen lines, the payments booked against it, and the PDF download. A voided invoice is marked and its PDF is disabled — it is kept for audit, not reissued.

  **Send it straight from the invoice.** The detail page has a **Send** button: leave the recipient blank and it goes to the supplier's billing address on file, or enter one yourself. The invoice is marked with when it was sent and to whom, so you can see at a glance which payables have actually gone out — an invoice nobody sent is money nobody owes. The PDF you mail is the same document as the PDF you download.

  Money received from a supplier now shows on that supplier's own page too, kept clearly apart from money you paid *them*: the two run in opposite directions, so the received figure sits alongside the fuel payable rather than inside it. If you void an invoice that money had already been received against, the cash is not lost — it is listed as an **unapplied receipt** for you to apply to the reissued invoice or refund.

- **Commission funded by the supplier can now be tracked and reported.** On some deals the commission Moxie negotiates is paid by the supplier rather than the customer — sometimes only the part above the usual $3/MT, sometimes the whole rate. Each line item now carries two commission rates: **Comm./Unit** (what the customer is billed, as before) and a new **Supp./Unit** (what the supplier pays). Both feed the deal's profit figure, so a deal where the supplier funds the commission no longer reads as earning nothing.

  A new **Supplier Commission Report** (Reports → Supplier Commission) turns those supplier-side rates into a statement per supplier for a period, with CSV and XLSX exports, alongside the figure the customer is billed on the same lines for reconciliation. It is a statement Moxie sends itself — it creates no invoice and no receivable, so nothing about customer billing, collections, ageing or QuickBooks changes.

  A line with no supplier rate means the supplier owes nothing on it, and such lines are left out of the statement entirely. If a deal has more than one supplier leg, its supplier commission cannot be attributed to a single supplier, so the deal is listed as excluded rather than silently billed to the wrong party.

- **Create Commission Orders is now safe to click twice.** It used to create a fresh order on every click, so a double click (or two tabs, or a retry) billed the same commission period twice as two identical invoices. Commission orders are now created once per period and customer: a repeat click creates nothing and tells you which customers were already billed and by which order.

- **Commission is now earned on products only.** A broker commission report counted the $/MT rate against every line on a broker deal, so a barging fee — a lump sum stored as one unit — collected a full rate as though it were a tonne of fuel, and its 1 was added to the reported tonnage. Fees, agency, trucking, taxes, hire and similar charges are now excluded from both the commission and the quantity total, in the report, the exports, the auto-generated commission orders, the broker-deal profit column and the on-screen preview. Products (VLSFO, LSMGO, blends, anything with its own product type) are unaffected.

## Documents & Settings

- **Attach any file on the order to any document email — including the Bunker Booking.** The send-email window now lists the files uploaded to the order and lets you attach them to whatever document you are sending. A Bunker Booking previously offered no attachments at all, which is the mail that reaches the port agent — the one that most needs the calling sheet. You can also upload straight from the window by dragging files onto it or using the file picker, so a calling that arrives while you are writing the booking does not mean closing the window to upload it first. The old rule restricted what could be attached to the tenant's delivery-documentation types, which meant a calling sheet, a customer invoice or anything else filed as "OTHER" could never be attached to any email.
- **Emails greet the contact person you are writing to.** Document emails used to open with a generic "Dear Customer" even when you had picked a specific contact out of the list. They now open with that person's name; when an order has no contact on file the generic greeting is used rather than a company name.
- **A second document layout is available on request.** Documents can now use a "sleek" layout with a lighter, airier structure — the number, date and due date on one line, an itemised tax break-down under the lines, and a plain "Payment methods accepted" block — instead of the classic layout. It is off by default, so nothing about your existing documents changes unless you ask us to switch it on. Documents you have already issued keep the layout they were issued with.
- **Branded documents are available on request.** If you'd like your own brand colour on document headings and links, it can be switched on for your account — tell us and we'll enable it. It is off by default, so nothing about your existing documents changes unless you ask. A very pale brand colour is ignored in favour of the readable default, so a light colour can never make headings unreadable on paper.
- **Invoices no longer print another company's bank account.** When an order had no bank account configured, the invoice fell back to a built-in default — which was Fueld's own account. A tenant that had not set up banking was therefore telling its customers to pay into the wrong account, and the customer had no way to notice. Invoices now print no remittance section until a bank account is configured, which is a visible gap rather than a silent money hazard.

- **Date format now applies to the due date.** Choose ISO (`2026-10-01`), European (`01/10/2026`) or American (`10/01/2026`) under Admin → Settings → General, and invoice due dates follow it. Previously the setting changed most dates on a document but not the due date itself, which stayed in the ISO form regardless.
- **Date format follows the document's own tenant.** The setting was read from the first tenant on the instance rather than the one the document belongs to, so on a multi-tenant server every tenant rendered — and saved — in the same format.
- **Same fix on the offer/confirmation date and the dashboard/report due dates** (Collections widget, reports drill-down, payment schedule preview), which showed the raw form rather than your configured one.

## Credit

- **Search and sort the credit lists.** Both the Customer and Supplier credit pages now have a search box that filters by company name on the server (so it searches the whole list, not just the 25 rows on screen), and every column is sortable — including the derived Used and Available figures and the average-days-to-pay column.
- **Broker credit flag on customer lines.** A customer credit line can be marked as broker credit, matching the supplier side, and the flag can be set and cleared from the create/edit form. Broker deals use broker lines, regular deals use regular lines.
- **Credit lines on the company page.** Opening a company now shows its credit lines — customer and supplier — with credit, used and available amounts, the period and the average days to pay, so you no longer have to leave the company to look up its credit.
- **Credit figures respect roles.** The company card follows the same access rules as the credit pages: supplier credit is shown to administrators and credit managers, customer credit additionally to finance, and staff without either access do not see the card.

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

- **The invoice now shows the real invoice number, alongside your order reference and the customer's PO number.** A modern-layout invoice used to print the *order* number under "Invoice number" — so a customer looking for `INV-2026-0004` found no such invoice on the page, and the reference their payment would quote was the thing labelled as the invoice number. The invoice number is now the number we told the customer to pay against, with the order reference stated separately (payments quote it) and the PO number on its own line, exactly as it appears in the classic layout.
- **QR code repositioned** in invoice PDFs to sit alongside payment terms.
- **PO label** changed from "PO No.:" to "PO.:" across all PDF templates.
- **Price decimal precision** capped at 4 digits to prevent overly long numbers in PDFs and order details.
- **Proforma invoice generation blocked** after delivery — you can no longer generate a proforma for an order that's already been delivered.
- **Invoice notes** moved directly under the due date for better readability.

## Integrations

- **QuickBooks invoice sync** added — invoices can now be synced to QuickBooks with token expiry warnings.
- **Argentina** added to the country dropdown list.
- **Manual KYC date fields** added to company records.
- **FX hedging status is now tracked correctly.** Hedges executed on the Kantox side are marked as such here too, instead of staying "sent" forever — which had left the order card showing an open hedge that no longer existed and would have raised a false "value date passed" warning on a hedge that had already executed. A rolled hedge now picks up Kantox's new value date (a roll keeps the same reference and changes only the date, so nothing else would notice it), and a hedge present on the Kantox platform with no matching record here raises an alert instead of being silently invisible. Hedge rates are also no longer re-written on every sync, so the stored rate matches what Kantox reports to its own precision.

## Reports & Dashboard

- **Team-based report attribution** fixed — reports now correctly attribute orders to the right team members.
- **Tenant isolation** fixed for teams — teams are now properly scoped to their tenant.

---

_These changes have been deployed to all instances (staging, ChannelTX, Riviera Marine, and Moxie)._