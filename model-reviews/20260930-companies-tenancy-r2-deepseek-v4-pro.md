## Findings

### MUST-1 — `updateCompanyContact` reads the current row unscoped, then writes scoped

`company.service.ts` diff, `updateCompanyContact`:

```ts
const [current] = await db
    .select({
      ...
    })
    .from(companyContacts)
    .where(eq(companyContacts.id, contactId))
```

The SELECT that loads `current` filters only on `eq(companyContacts.id, contactId)` — no tenant predicate. The subsequent UPDATE is scoped via `inArray(companyContacts.counterpartyId, ownedCompanyIds(tenantId))`, so the write cannot land cross-tenant. But the read leaks: a tenant B caller can PATCH `/companies/contacts/:contactId` with a tenant A contact id, and the handler will read tenant A's contact row (including `source`, `seasearcherPersonId`, `counterpartyId`) before the scoped UPDATE matches zero rows and returns `undefined` → 404. The response body is 404, but the data was already read into memory and the handler's logic (e.g. the `isPrimary` branch, the `source === 'seasearcher'` soft-delete decision) ran against foreign data. The same pattern appears in `deleteCompanyContact` — but there the read is followed by an explicit `companyBelongsToTenant(current.counterpartyId, tenantId)` check, so it is guarded. `updateCompanyContact` has no such check.

Fix: add `inArray(companyContacts.counterpartyId, ownedCompanyIds(tenantId))` to the SELECT, or do the `companyBelongsToTenant` check after the read as `deleteCompanyContact` does.

### MUST-2 — `updateCompanyEmail`'s `isPrimary` pre-fetch is unscoped

`company.service.ts` diff, `updateCompanyEmail`:

```ts
if (data.isPrimary) {
    ...
    // fetch counterpartyId and emailType first
```

The diff shows the UPDATE is scoped (`inArray(companyEmails.counterpartyId, ownedCompanyIds(tenantId))`), but the pre-fetch that runs when `data.isPrimary` is true is not shown as modified. The comment in the diff says "If setting as primary, fetch counterpartyId and emailType first" — that fetch presumably reads by `eq(companyEmails.id, id)` alone. A tenant B caller can PATCH `/companies/emails/:emailId` with `isPrimary: true` on a tenant A email id; the pre-fetch reads tenant A's email row (leaking `counterpartyId`, `emailType`), then the scoped UPDATE matches nothing and returns null → 404. Same class as MUST-1: read leak before the scoped write.

Fix: scope the pre-fetch with `inArray(companyEmails.counterpartyId, ownedCompanyIds(tenantId))`.

### MUST-3 — `getCustomerPaymentLedger` route takes `params.id` but the handler ignores `auth` entirely

`companies.controller.ts`:

```ts
.get(
    '/local/:id/ledger/customer',
    async ({ params, query }) => {
      try {
        const ledger = await getCustomerPaymentLedger(params.id, {
```

The route guard (`onBeforeHandle`) does fire here because `params.id` exists, so the company id is checked against `auth.tenantId` before the handler runs. That covers the company itself. But the handler destructures no `auth`, and `getCustomerPaymentLedger` is not shown in the diff as taking a `tenantId`. The question is whether the ledger query inside `getCustomerPaymentLedger` filters by tenant. The supplier ledger route explicitly passes `auth.tenantId`:

```ts
const ledger = await getSupplierPaymentLedger(params.id, { ... }, auth.tenantId);
```

The customer ledger route does not. If `getCustomerPaymentLedger` internally joins orders/payments to the company id without a tenant predicate, the route guard on the company id is sufficient only if every order/payment row is guaranteed to belong to the same tenant as the company — which is not established here. The asymmetry between the two sibling routes (one threads `tenantId`, the other does not) is strong evidence the customer ledger service was not scoped. This is a read of tenant financial data reachable through a guarded route but with an unscoped service.

Fix: thread `auth.tenantId` into `getCustomerPaymentLedger` and add the tenant predicate to its queries, matching the supplier ledger.

### SHOULD-1 — `getCompanyById`'s try/catch fallback path may bypass the tenant predicate

`company.service.ts` diff, `getCompanyById`:

```ts
let row: typeof counterparties.$inferSelect | null = null;
  try {
    const [selected] = await db
      .select()
      ...
```

The diff shows the signature change but not the body of the try/catch. The pattern in `getCompanyBySeasearcherId` shows a fallback to `db.query.counterparties.findFirst` when a column is missing. If `getCompanyById` has a similar fallback (the `isMissingCompanyRegistrationColumnError` pattern), that fallback must also carry `eq(counterparties.tenantId, tenantId)`. The diff for `getCompanyBySeasearcherId` explicitly scopes both the primary and fallback queries; `getCompanyById`'s body is not shown, so this cannot be confirmed. Worth verifying.

### SHOULD-2 — `getCompanyContacts`, `getCompanyEmails`, `getCompanyOffices`, `getCompanyAttachments` (the list-by-company-id variants) are unscoped but only reachable through the guarded `:id` route

These are the GET `/local/:id/contacts`, `/local/:id/emails`, `/local/:id/offices`, `/local/:id/attachments` handlers. The route guard fires on `params.id`, so the company id is verified. The service functions take only the company id and have no tenant predicate. This is acceptable under the stated design (guard at the route), but it is inconsistent with the child-resource write paths which were scoped inside the service. If any of these service functions is called from a non-HTTP entry point (websocket, cron, another module), the tenant predicate is absent. The websocket hook was fixed for `syncCompanyFromSeasearcher`; these list functions are not shown as called elsewhere, but the inconsistency is worth noting.

### SHOULD-3 — `getCompanyEnrichment`, `getCompanyFleet`, `getCompanyHierarchy`, `getCompanySeizures`, `getCompanySanctions` are unscoped by design (global Seasearcher directory), but the routes take `:seasearcherId` and are not guarded

These are documented as global directory reads, so no tenant predicate is correct. But note the route guard only fires on `params.id`, and these routes use `params.seasearcherId` — so they are not guarded at all. That is fine for global data, but any future change that makes these return tenant-specific data would silently become a leak. A comment on each route or a shared prefix would reduce the risk.

### SHOULD-4 — `getTopCreditGroups` raw SQL interpolates `tenantId` directly

`company.service.ts` diff:

```ts
WHERE p.tenant_id = ${tenantId}
```

`tenantId` comes from `auth.tenantId` (a JWT claim) and is interpolated into a raw SQL template. Drizzle's `sql` template does parameterize interpolated values, so this is not a SQL injection, but it is worth confirming the value is treated as a bound parameter and not string-concatenated. The diff shows `${tenantId}` inside a `sql` template literal, which Drizzle handles safely. No action needed unless the codebase has a pattern of raw string concatenation elsewhere.

### SHOULD-5 — `getSessionTenant` does a DB lookup per entity view, and the skip is silent

Already acknowledged in the stated gaps. Agreed with the judgement: the silent skip is acceptable for a sync hook, but a debug-level log would help diagnose "sync didn't happen" issues. The DB lookup per view is a performance concern but not a correctness issue.

### SHOULD-6 — `deleteCompanyContact` returns `false` for "not found" and "not yours", but the soft-delete path for seasearcher contacts returns `true` without re-checking tenant

`company.service.ts` diff, `deleteCompanyContact`:

```ts
if (!current || !(await companyBelongsToTenant(current.counterpartyId, tenantId))) return false;

  if (current.source === 'seasearcher' || current.seasearcherPersonId !== null) {
    await db
      .update(companyContacts)
      .set({ ... })
      .where(eq(companyContacts.id, contactId));
    return true;
  }
```

The tenant check happens before the soft-delete branch, so the soft-delete UPDATE is guarded by the earlier check. This is correct. The hard-delete path (`db.delete(companyContacts).where(eq(companyContacts.id, contactId))`) is also guarded by the earlier check. No issue.

### SHOULD-7 — `setParentCompany` checks the child's tenant, then checks the parent's tenant, but the final UPDATE re-checks the child's tenant

`company.service.ts` diff:

```ts
const [child] = await db
    .select({ id: counterparties.id })
    .from(counterparties)
    .where(and(eq(counterparties.id, childId), eq(counterparties.tenantId, tenantId)))
    .limit(1);
  if (!child) throw Object.assign(new Error('Company not found.'), { code: 'NOT_FOUND' });
```

Then later:

```ts
const [updated] = await db
    .update(counterparties)
    .set({ parentId, updatedAt: new Date() })
    .where(and(eq(counterparties.id, childId), eq(counterparties.tenantId, tenantId)))
    .returning();
```

The double check is redundant but harmless. The parent check is the critical one and it is correct: `parentRow.tenantId !== tenantId` throws `NOT_FOUND`. No issue.

### SHOULD-8 — `getCompanyBySeasearcherId`'s `opts: { includeDeleted?: boolean }` parameter is unused in the diff

The signature adds `opts: { includeDeleted?: boolean } = {}` but the diff does not show it being used in the query. If `includeDeleted` is meant to include soft-deleted rows, it is not implemented. This is a latent bug but not a tenant isolation issue. Worth flagging for the author.

## Disagreements

None. The three round-1 MUSTs are addressed correctly:
- `getCompanyBySeasearcherId` is scoped in both the primary and fallback queries.
- Child-resource routes are scoped via `inArray(subquery)` in the write paths.
- `setParentCompany` constrains both ends and refuses cross-tenant parents as `NOT_FOUND`.

The 404-vs-403 choice is consistent and correctly applied. The `setParentCompany` catch block in the controller sets 404 for `NOT_FOUND` and leaves other domain errors (self-reference, already-child) as their original status — that is the right call.

## Verdict

**NO-GO**

MUST-1 and MUST-2 are read leaks in the child-resource write paths — the exact class of bug this round was meant to eliminate. MUST-3 is a likely unscoped financial read. All three are reachable by an authenticated user of any tenant.