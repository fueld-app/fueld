# REVIEW

## Findings

**SHOULD-1 — `company.service.ts::getSupplierPaymentLedger` — `outstanding` mixes filtered and unfiltered bases, and the new netting extends it.**
`totalCost` is unfiltered (the `outstandingByCurrency` query has no date conditions), while `totalPaid` is filtered (`sql\`${supplierPayments.paidAt} >= ${opts.dateFrom}\``) and the new `totalReceived` is filtered (`sql\`${supplierReceipts.receivedAt} >= ${opts.dateFrom}\``). Under a date range, `outstanding = allTimeCost − inRangePaid − inRangeReceived` is neither the current position nor the period position. This predates the change for `paid`, but this change subtracts a newly-filtered flow from the hybrid, and adds a fourth basis (`unappliedReceipts`, deliberately unfiltered) on the same screen. Resolve (position is a stock → compute it unfiltered; or make flows cumulative to `dateTo`) or document/label it explicitly. You asked directly whether the unfiltered unapplied figure is correct — as a stock, yes, but it sits next to a filtered `totalReceived`, so the page shows two receipt figures on different bases under a filter.

**SHOULD-2 — receipts are aggregate-only in the ledger response.**
`payments` is itemized; receipts appear only as `totalReceived`/`receivedCount`/`unappliedReceipts` numbers. The voided-receipt cash (`amount: 250, count: 1` in your own test) cannot be drilled from this endpoint to a receipt or invoice. If the voided invoice's detail page lists its receipts, fine — say so in the response comment; otherwise itemize receipts here.

**SHOULD-3 — no visible reapply path for `unappliedReceipts`.**
The comment says "held, pending reissue or refund", but the shown surface blocks new receipts on voided invoices (test: "blocks them on a voided invoice") and shows no move/reapply endpoint. If no path exists, this is permanently stuck cash — visible now, but unactionable. Confirm the path or add one. Related: if `supplierReceipts.supplierInvoiceId` is ever nullable, the `innerJoin(supplierInvoices, …)` in both receipt queries silently drops orphans — the vanishing-money bug in reverse. Confirm NOT NULL.

**SHOULD-4 — test gaps on branches the brief itself calls load-bearing.**
(a) "A receipt in a currency with no fuel cost is still emitted" — the `for (const r of receivedByCurrency) { if (totalsByCurrency.has(r.currency)) continue; … }` loop has no test in the shown diffs. (b) date-filtered `totalReceived` vs unfiltered `unappliedReceipts`. (c) `/send` recipient-override happy path — Appendix G covers server-side resolution, 404, and 400, but the override is the wrong-party lever and is untested.

**SHOULD-5 — `getSupplierPaymentLedger(companyId, opts)` takes no tenantId.**
The sibling new code does: `renderSupplierInvoicePdf(invoice, tenantId)`, `getSupplierInvoice(params.id, auth.tenantId)`. Every query here keys off `companyId` alone; safety depends entirely on the route authorizing `companyId` within the tenant. Confirm that, and consider threading tenantId for defense in depth.

**SHOULD-6 (minor) — `supplier-invoice-pdf.ts`:** `createPdfBuffer(docDefinition as never)` carried into the new file. Faithful extraction, but the new file was the moment to type it properly.

**MUST: none.**

## On the five scrutiny points

1. **Netting (`cost − paid − received`): agree.** All three components are reported separately, netting is per-currency, and excluding voided-invoice receipts is the conservative direction for a payable. The "position, not a one-way total" framing is documented at the query. Nothing hidden → defensible.
2. **`unappliedReceipts` closes the hole.** No double-count in `outstanding` is possible since unapplied is never netted; a display-level double count would require entering a *second* receipt row on reissue rather than moving the first — workflow, not code. Residuals are SHOULD-2/3.
3. **Tenant/wrong-party on `/send`: solid.** `getSupplierInvoice(params.id, auth.tenantId)` plus a cross-tenant 404 test; recipient resolution keyed to the frozen `invoice.supplierId`; PDF counterparty resolved `eq(counterparties.id, …) AND eq(counterparties.tenantId, …)`. The residual wrong-party lever is the operator override — intentional, format-validated, logged in `email_log`.
4. **Extraction: faithful.** Checked line-by-line against the removed hunk in Appendix C: identical except the dropped dead `settings` (`select({ settings: tenants.settings, name: tenants.name })` + `const settings = (tenant?.settings ?? {}) as TenantSettings;` → now `select({ name: tenants.name })`). No semantic drift; previewed and mailed bytes cannot diverge.
5. **Optional-field loosening: no regression path.** Every order-scoped interpolation is guarded (`?? ''`); Vessel/Port rows are now conditional, changing output only where it previously printed empty/"undefined"; `PORT_DOCUMENTATION` gets explicit fallbacks (`vesselName: params.vesselName ?? ''`). Existing callers pass the same values and get identical output. The discriminated union was rightly rejected as wider than the risk.

## Disagreements

None. On your stated one — returning `err.message` on 500 — concur: it matches the repo's own send route, and "SMTP is not configured…" is the only actionable text an operator can get; redacting it would push the common failure into server logs.

## Verdict

**APPROVE-WITH-CONDITIONS.** Conditions: SHOULD-1 (resolve or explicitly document the `outstanding` date-filter semantics — you asked; the current answer is "inconsistent, inherited") and SHOULD-4(a) (test the receipt-only-currency branch you call load-bearing). SHOULD-2/3/5 are follow-ups, not blockers.