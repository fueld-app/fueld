# Broker Deals — Quick Guide

**What it is:** Track orders where you're the broker (not the trader). Moxie earns $3/MT commission on Ocean7 deliveries.

---

## Setup (Admin only)

1. Go to **Admin → Settings → Broker Deals**
2. Tick **Enable Broker Deals**
3. Set default commission rate (e.g. 3.00/unit)
4. Set which order statuses appear in the monthly report
5. Toggle credit auto-release + buffer days
6. Click **Save Settings**

---

## Creating a Broker Deal

1. Click **+ New Inquiry**
2. Tick the **Broker Deal** checkbox
3. Fill in client (Ocean7 company), vessel, place, line items as normal
4. Set commission per unit on each line item (defaults to your admin rate)
5. The order flows through the normal status pipeline: Inquiry → Confirmed → Delivered → Invoiced → Paid

**Key difference:** No invoicing company or bank account needed — the supplier invoices the customer directly.

---

## Viewing Broker Deals

- **Sidebar → Trading → Broker Deals** shows all broker deal orders across all statuses
- Each line item shows its commission rate and calculated commission amount

---

## Monthly Commission Report

1. Go to **Broker Deals** tab → click **Commission Report**
2. Pick a date range (from/to)
3. Click **Generate Report**
4. Report groups by customer, showing each order with quantity, rate, and commission
5. Export as **CSV** or **XLSX** for sending to Ocean7
6. Click **Create Commission Orders** to auto-generate commission invoices (admin only)

---

## Broker Credit Lines

- Create a **Broker Credit Line** in **Credit → Suppliers** (tick "Broker Credit Line")
- Links to Ocean7 companies as counterparties
- Tracks Ocean7's exposure with the supplier, separate from your own trading exposure
- Credit auto-releases after the credit period from delivery date (no manual payment confirmation needed)
- Buffer days can be added as a safety margin

---

## Tenant Isolation

- Broker deals are **off by default** for all tenants
- Only tenants with the feature enabled see the tab, checkbox, and commission fields
- Regular (non-broker) orders are completely unaffected