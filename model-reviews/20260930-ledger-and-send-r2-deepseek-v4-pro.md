# Review

## Findings

### MUST

**M1 — `unappliedReceipts` is unfiltered while `totalReceived` is filtered: the same receipt can be reported twice across two date windows, and the unfiltered stock is inconsistent with the filtered flow.**

`company.service.ts`, `getSupplierPaymentLedger`:

```ts
const receivedByCurrency = await db
  .select({ ... })
  .from(supplierReceipts)
  .innerJoin(supplierInvoices, ...)
  .where(and(
    eq(supplierReceipts.supplierId, companyId),
    ne(supplierInvoices.status, 'VOID'),
    ...(opts.dateFrom ? [sql`${supplierReceipts.receivedAt} >= ${opts.dateFrom}`] : []),
    ...(opts.dateTo ? [sql`${supplierReceipts.receivedAt} <= ${opts.dateTo}`] : []),
  ))
```

```ts
const unappliedRows = await db
  .select({ ... })
  .from(supplierReceipts)
  .innerJoin(supplierInvoices, ...)
  .where(and(eq(supplierReceipts.supplierId, companyId), eq(supplierInvoices.status, 'VOID')))
```

The brief says the unfiltered unapplied figure is "intentional (it is a stock, not a flow)". That is defensible for a *balance* figure, but the API returns it alongside a filtered `totalReceived` and a filtered `outstanding`. A caller fetching `dateFrom=2026-09-01&dateTo=2026-09-30` sees `totalReceived` for that window but `unappliedReceipts` for all time. A receipt received in August against an invoice voided in September appears in the September response's `unappliedReceipts` but not in August's `totalReceived` — it is visible in neither window's flow and in both windows' stock. If the intent is "operator can see cash that vanished from the page", the operator looking at a filtered page still cannot tell *when* it arrived or whether it belongs to the window. Either filter `unappliedRows` by `receivedAt` too, or return it as a separate unfiltered endpoint/field with an explicit `asOf`/`unfiltered: true` marker so callers cannot mistake it for window-scoped data.

**M2 — `getSupplierInvoice` tenant scoping is asserted by the test but not shown in the diff; if it scopes by `id` only, the cross-tenant 404 test would fail, so this is likely fine — but the reviewer cannot verify it from the payload.**

`supplier-invoices.controller.ts`:

```ts
const invoice = await getSupplierInvoice(params.id, auth.tenantId);
```

The test `cannot send another tenant's invoice` expects 404, which implies `getSupplierInvoice` filters by tenant. That function is not in the payload. If it does not filter by tenant, this is a MUST-fix wrong-party disclosure (invoice PDF, supplier name, amounts, recipient emails). Please confirm the function body includes `eq(supplierInvoices.tenantId, auth.tenantId)` (or equivalent). The same applies to the PDF route, which shares the helper.

**M3 — `buildDocumentEmailSubject` for `SUPPLIER_INVOICE` can produce a subject of `"Invoice "` (trailing space) when `invoiceNumber` and `periodLabel` are both absent, and `"Invoice  — period"` (double space) when only `periodLabel` is present.**

`mail.service.ts`:

```ts
if (params.documentType === 'SUPPLIER_INVOICE') {
  const period = params.periodLabel ? ` — ${params.periodLabel}` : '';
  return `Invoice ${params.invoiceNumber ?? ''}${period}`.trim();
}
```

`.trim()` removes leading/trailing whitespace but not the internal double space in `"Invoice  — 2026-09"` (two spaces before the em dash when `invoiceNumber` is empty). The controller always passes `invoiceNumber` (`invoice.invoiceNumber`), so the production path is safe today, but the builder is exported and the type allows both to be absent. A future caller gets a malformed subject. Build the parts conditionally:

```ts
const parts = ['Invoice', params.invoiceNumber, params.periodLabel].filter(Boolean);
return parts.join(' — ');
```

**M4 — `buildDocumentEmailHtml` interpolates `params.vesselName`/`params.portName` into HTML without escaping, and the new optional fields (`invoiceNumber`, `totalAmount`, `dueDate`, `periodLabel`) inherit the same pattern.**

`mail.service.ts`:

```ts
intro: `Please find attached our invoice for broker commission on your deliveries during the period <strong>${params.periodLabel ?? ''}</strong>.`,
```

and

```ts
<td style="padding: 4px 0; font-weight: 600;">${params.invoiceNumber}</td>
```

These come from the frozen invoice snapshot (`invoice.invoiceNumber`, `invoice.periodFrom/To`, `invoice.amount`, `invoice.dueDate`), which are generated server-side, so the immediate risk is low. But `periodLabel` is built in the controller as `` `${invoice.periodFrom} – ${invoice.periodTo}` `` — if `periodFrom`/`periodTo` are ever user-influenced (e.g. a supplier name or free-text field flows into them), this is an HTML injection into an email. The pre-existing order-scoped fields had the same issue, so this is not a regression, but the new fields widen the surface. Escape or use a template that treats these as text.

### SHOULD

**S1 — `outstanding = cost - paid - received` nets a supplier receivable against a supplier payable in one figure. The brief asks whether this is defensible. It is, with a caveat.**

The comment block in `company.service.ts` argues the position is "what is the position with this supplier", and for a single counterparty that is the difference between what we owe them (fuel cost minus what we've paid) and what they owe us (commission receipts). That is a legitimate net position. The caveat: the figure is now a *net* number that can be negative, and the API does not label it as such. A caller that previously treated `outstanding` as "amount we still owe" will now see a negative number and may render it as a payable or clamp it to zero. The field name `outstanding` and the pre-existing semantics ("sum(cost) - sum(paid)") both implied a one-directional debt. Renaming to `netPosition` (or adding a `direction`/`sign` field) would be clearer, but that is an API break. At minimum, document the sign convention in the response type.

**S2 — `unappliedReceipts` is not included in the `totals` map, so a currency with ONLY voided receipts does not appear in `totals` at all.**

`company.service.ts`:

```ts
const totals = Array.from(totalsByCurrency.entries()).map(...)
for (const r of receivedByCurrency) {
  if (totalsByCurrency.has(r.currency)) continue;
  totals.push({ ... })
}
```

The second loop only iterates `receivedByCurrency` (non-void receipts). If a supplier has a voided invoice with a receipt in `EUR` and no other EUR activity, `unappliedReceipts` contains EUR but `totals` does not. The comment says "A receipt in a currency with no fuel cost at all still has to appear, or the money vanishes" — but that guarantee only holds for non-void receipts. A voided-only currency vanishes from `totals` and appears only in `unappliedReceipts`. If the operator looks at `totals` for the position, the cash is still invisible there. Consider emitting a zeroed `totals` entry for unapplied-only currencies, or documenting that `unappliedReceipts` is the only place such cash appears.

**S3 — `renderSupplierInvoicePdf` extraction: the `tenant` query changed shape.**

Original (inlined in controller):

```ts
const [tenant] = await db
  .select({ settings: tenants.settings, name: tenants.name })
  .from(tenants)
  .where(eq(tenants.id, auth.tenantId))
  .limit(1);
const settings = (tenant?.settings ?? {}) as TenantSettings;
```

Extracted (`supplier-invoice-pdf.ts`):

```ts
const [tenant] = await db
  .select({ name: tenants.name })
  .from(tenants)
  .where(eq(tenants.id, tenantId))
  .limit(1);
```

The `settings` const was dropped as dead (the brief says it was dead in the original too). The `tenant.name` fallback in `buildDocumentFooter` is preserved. No semantic change to the PDF output. This is fine.

**S4 — `sendDocumentEmail` error path returns `err.message` to the client.**

`supplier-invoices.controller.ts`:

```ts
} catch (err) {
  console.error('[SupplierInvoices] Send failed:', err);
  set.status = 500;
  return { success: false, data: null, message: err instanceof Error ? err.message : 'Failed to send invoice' };
}
```

The brief flags this as a deliberate disagreement. I agree with the brief: the repo's own send route does the same, and the SMTP configuration error is actionable. The risk is leaking internal paths or credentials in a stack trace if `err.message` contains them; the `console.error` already logs the full error server-side, so the client message adds little beyond the SMTP case. A middle ground: return `err.message` only for known SMTP/config errors, generic text otherwise. Not a blocker.

**S5 — `recipientEmails` override bypasses the supplier's own addresses entirely, with no confirmation that the override belongs to the supplier.**

`supplier-invoices.controller.ts`:

```ts
let recipientEmails = (body.recipientEmails ?? []).map((e) => e.trim()).filter(Boolean);
```

The override is a feature (operator may need to send to a different contact), but a payable sent to a mistyped address is a real loss, as the brief itself notes. The 400-when-no-address path is loud; the override path is silent. Consider logging the override distinctly in `email_log` (e.g. a `recipientSource: 'override' | 'company'` field) so an audit can distinguish operator choice from company data. Not a correctness bug.

**S6 — `buildDocumentEmailHtml` for `PORT_DOCUMENTATION` now passes `vesselName: params.vesselName ?? ''` into `buildPortDocumentationEmailHtml`, but the original call passed the raw (required) values.**

`mail.service.ts`:

```ts
if (params.documentType === 'PORT_DOCUMENTATION') {
  return buildPortDocumentationEmailHtml({
    ...params,
    vesselName: params.vesselName ?? '',
    portName: params.portName ?? '',
  });
}
```

If `buildPortDocumentationEmailHtml` has its own required `vesselName: string` parameter, this now satisfies the type but changes behavior only when the caller omitted the field — which was previously a compile error and is now silently an empty string. The comment says "the order fields are always present here", which is true for existing callers, but the type no longer enforces it. This is the same optional-field loosening the brief says was guarded with `?? ''`; the guard prevents "undefined" in output but not the semantic drift of an empty vessel name in a port documentation email. Acceptable given the constraints, but a discriminated union would have been safer.

**S7 — `email_log.order_id` is now nullable and the send route does not pass `orderId`, so supplier-invoice emails are not attributable to any order in the log.**

`mail.service.ts`:

```ts
orderId: options.orderId ?? null,
```

The brief says the document number is in the log's subject. That is true, but any existing report or filter that joins `email_log` to `orders` on `order_id` will silently drop supplier-invoice emails. If there is an "emails for this order" view, it will not show the supplier invoice that covered that order's period. Consider a join table or a `documentId`/`documentNumber` column on `email_log` for non-order documents. Not a blocker for this change, but a data-model gap.

**S8 — `hasMore: rows.length === limit` is a pre-existing pattern, but with the new `totals`/`unappliedReceipts` fields the pagination only applies to `payments`, not to the aggregates.**

`company.service.ts`:

```ts
pagination: { limit, offset, hasMore: rows.length === limit },
```

The `totals` and `unappliedReceipts` arrays are not paginated, which is correct for aggregates, but the response shape mixes a paginated list with unpaginated aggregates under one `pagination` object. A caller may assume `hasMore` applies to everything. Pre-existing, not introduced here, but worth a comment.

## Disagreement

None. The netting of receipts into `outstanding` is defensible as a position figure, the `unappliedReceipts` addition closes the voided-cash hole (with the caveats in M1/S2), and the `err.message` return is consistent with the repo's existing pattern.

## Verdict

**APPROVE-WITH-CONDITIONS**

Conditions: confirm `getSupplierInvoice` scopes by tenant (M2), fix the subject builder's double-space/empty-subject edge (M3), and decide on M1 (filter `unappliedReceipts` or mark it explicitly unfiltered). S1–S8 are improvements to make but do not block.