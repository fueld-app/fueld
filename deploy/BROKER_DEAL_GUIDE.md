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

**Clicking it twice is safe.** Commission orders are created once per period and
customer: a repeat click (or two tabs, or a retry) creates nothing and reports
which customers were already billed, with the order number that did it. Run it
again for a *different* period and it bills that period normally.

**Commission is earned on products only.** A broker deal's line items are split into
products (VLSFO, LSMGO, blends — anything with its own product type) and charges
(barging fees, agency, trucking, taxes, hire, commission, payments). The report and
the broker-deal profit column both bill the **$/MT rate on products only**; a charge
line is excluded from both the commission and the quantity total.

This matters because a charge is stored as a single line with the fee as the amount —
a 2,500 barging fee is `quantity: 1`. Charging a per-MT rate on it billed a flat rate
as though it were one tonne of fuel, and added that 1 to the reported tonnage.

---

## Commission Paid By the Supplier

Usually the customer funds the whole commission. When a rate above the standard is
negotiated — or the supplier funds the entire rate — the extra is paid by the supplier
instead, and each line carries **two** rates:

| Field on the line | Who pays it |
|---|---|
| **Comm./Unit** | The customer (unchanged) |
| **Supp./Unit** | The supplier |

Set the customer's rate to `0` when the supplier funds the whole thing; the field
accepts a deliberately typed `0` and keeps it. The deal's **Profit** column adds both
rates, so a supplier-funded deal is no longer reported as earning nothing.

⚠️ **The two rates are independent, so they must not both carry the supplier's full
rate.** They answer different questions — "what does the customer pay?" and "what does
the supplier pay?" — and the system adds them. Setting `Comm./Unit = 19` *and*
`Supp./Unit = 19` charges 19 twice: once to the customer and once to the supplier. For
a deal where the supplier funds the whole rate, `Comm./Unit` must be `0`:

| | Comm./Unit | Supp./Unit |
|---|---|---|
| Customer funds everything (usual) | 3 | *(blank)* |
| Customer pays 3, supplier pays the rest of 19 | 3 | 16 |
| Supplier funds everything (e.g. 20260916-000132) | **0** | 19 |

Setting `Comm./Unit` to `0` is what stops the customer report billing that commission;
leaving it at `19` would bill United O7 for commission Thor Marine is paying.

Leaving `Supp./Unit` **blank** is different from setting it to `0`: blank means "nothing
recorded yet", `0` means "the supplier owes nothing on this line". Both keep the line out
of the supplier statement, which is the same outcome here.

`Supp./Unit` has **no fallback** — it is not taken from the order-level rate or the
tenant default. The three-tier chain (line → order → tenant default) describes only
what the *customer* is billed. Blank means the supplier owes nothing on that line.

### Supplier Commission Report

**Reports → Supplier Commission** (also linked from the Broker Deals tab). Pick a
period, click **Generate Report**, and export **CSV** or **XLSX** to send to the
supplier.

- Grouped **by supplier**; each block lists the orders, the customer on each, the
  supplier rate and the commission owed.
- The summary also states what the **customer** is billed on the same lines, so the two
  reports reconcile.
- Lines with no supplier rate are omitted, and a charge line (barging fee, agency,
  trucking, tax, hire, commission, payment) earns nothing on either side.
- **This is a statement, not an invoice.** It creates no invoice, no order and no
  receivable — Moxie sends it and collects outside the system. Customer billing,
  collections, ageing and QuickBooks are untouched.
- If a deal has **more than one supplier leg**, its supplier commission cannot be
  attributed to a single supplier. Such deals are listed as **excluded** on screen and
  in the export rather than silently billed to the primary supplier; split the deal
  first.

### Invoicing the supplier

The report has an **Invoice suppliers** button. Pick a period, click it, and every
supplier with commission owing gets a real invoice.

- **One invoice per supplier per period.** Clicking it twice bills nothing extra; it
  tells you which suppliers were already invoiced for that period and by which number.
- **Its own number series** — `SINV-2026-0001` and so on, separate from customer
  invoices so the two series never interleave.
- **Due 30 days after the period end.** Commission has no delivery date to count from,
  so the period end plus a month is stated on the invoice itself.
- **Frozen once issued.** The lines, amounts and Moxie's bank details are captured when
  it is raised. Renaming a company, editing a rate or delivering the order afterwards
  will not change a document the supplier already holds.
- **Voiding releases the period** so the correct invoice can be raised. The voided
  document keeps its number and stays on file.
- **Money received** from the supplier is recorded against the invoice (record it as a
  supplier payment and pick the invoice), and the paid/outstanding figures follow.

These invoices are kept in a **separate ledger from customer invoices**. Customer
invoices are treated everywhere as money owed *to* Moxie *by* a customer — Collections,
Invoice Ageing, the company balance and QuickBooks. A supplier invoice filed there
would have appeared as a customer debt, so the two are kept apart by design: supplier
invoices never appear in those views.

**Reports → Supplier Invoices** is where you track them after they are raised. It lists
them newest first with the invoice number, supplier, period, amount, received,
outstanding, status and due date, plus an **Include voided** toggle — voided invoices are
hidden by default but kept on file. Clicking a row opens the detail: the frozen lines, the
payments booked against it, a **Download PDF** button and **Void Invoice**. A voided
invoice is marked as such and its PDF is disabled, because the API refuses to re-render a
voided document.

**Before you send one:** check the customer rate on the underlying deals is `0` for
anything the supplier is funding. If a line still has the supplier's full rate in
`Comm./Unit`, the customer is being billed for commission the supplier is paying too.

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