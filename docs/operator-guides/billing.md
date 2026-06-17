# Billing & Invoicing — Operator Guide

## Overview

The billing module lives inside each order. You access it by opening any order from **Trading > Orders** (or Inquiries, Delivered, Completed). Everything — payment terms, invoices, payments — is managed on the order detail page.

---

## 1. Setting Payment Terms

Payment terms are set per side (customer and supplier) in the **Client** and **Supplier** cards at the top of the order.

### Steps
1. Open the order
2. In the **Client** card, find the **Payment** section
3. Choose a term from the dropdown:
   - **COD** — Cash on Delivery
   - **Credit** — Pay after X days (requires a credit line)
   - **Cash in advance** — Pay before delivery
4. If you select **Credit**, enter the number of days (e.g. `30`)
5. Optionally add a **note** (appears on PDFs and emails) — click "Add note"
6. Repeat for the **Supplier** card if needed

### Credit Lines
- If the customer has a credit line, available amount and max days are shown
- If credit is **frozen** (risk monitoring flagged them), Credit is disabled
- Click **Request Increase** to send the customer to the credit application page

---

## 2. Generating an Invoice

### Proforma Invoice (before delivery)
Use this to send a preliminary invoice for customer approval.

1. Open the order
2. Click the **header action button** (⋯ menu in the top-right area)
3. Select **View Proforma Invoice**
4. A PDF opens in a new tab — review it
5. To send it: select **Send Proforma Invoice** from the same menu

### Final Invoice (after delivery)
Once the order is marked **Delivered**, the invoice becomes final.

1. Mark the order as Delivered first (header action > **Mark Delivered**)
2. The menu option changes to **View Invoice** / **Send Invoice**
3. Generate and send the same way

### What appears on the invoice
- Order number, dates, vessel, port
- Your company logo and bank details (from Admin > Our Companies)
- Line items with quantities, units, prices
- Payment terms and due date
- Customer and supplier notes

---

## 3. Sending an Invoice

You can send invoices via **Email** or **WhatsApp**.

### By Email
1. From the header actions menu, select **Send Invoice** (or **Send Proforma Invoice**)
2. A modal opens — verify the recipient, subject, and message
3. The PDF is automatically attached
4. Click **Send**

### By WhatsApp
1. From the header actions menu, select the WhatsApp option
2. The PDF is sent to the customer's WhatsApp if they have a linked number
3. Requires your WhatsApp to be linked (Settings > Integrations > WhatsApp)

---

## 4. Recording Payments

Track every payment the customer makes against the order.

### Add a payment
1. Scroll to the **Payments** card (bottom section of the order)
2. Click **Add payment**
3. Fill in:
   - **Amount** — the payment amount (required)
   - **Currency** — defaults to the order's currency
   - **Received at** — date the payment was received
   - **Method** — e.g. "Wire", "ACH", "Card" (optional)
   - **Note** — any reference or memo (optional)
4. Click **Record payment**

### View payments
- All recorded payments appear in the Payments card
- Shows amount, date, method, and notes
- Running total is displayed at the top

---

## 5. Marking an Order as Paid

Once total payments equal or exceed the amount due:

1. From the header actions menu, select **Mark Paid**
2. If payments don't cover the total due, you'll be prompted to add more
3. The order status changes to **Paid** — it's now read-only

> **Note:** Once Paid, you cannot edit the order. Use **Reopen Order** (admin only) if you need to make changes.

---

## 6. Payment Status Flow

```
Inquiry → Confirmed → Delivered → Invoiced → Paid
                                  ↓
                            Generate Invoice
                            Send to Customer
                            Record Payments
                            Mark Paid
```

---

## Quick Reference

| Action | Where |
|---|---|
| Set payment terms | Client/Supplier cards > Payment section |
| Generate invoice | Header ⋯ menu > View Invoice |
| Send invoice | Header ⋯ menu > Send Invoice |
| Record payment | Payments card > Add payment |
| Mark as paid | Header ⋯ menu > Mark Paid |
| View credit line | Client card > Payment section |
| Request credit increase | Client card > Payment > Request Increase |
