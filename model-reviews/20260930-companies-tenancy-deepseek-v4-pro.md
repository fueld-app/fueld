# Code Review — Tenant Isolation for Companies Module

## Verdict: NO-GO

The core fix is directionally correct, but the blanket `onBeforeHandle` guard is unsound: it **under-blocks** on several routes that reach a company through a non-`id` param, and it **over-blocks** on at least one legitimate route. The websocket path has a correctness issue. Details below.

---

## MUST-FIX

### M1. `onBeforeHandle` under-blocks: routes that reach a company without `params.id`

The guard only checks `params.id`. Several routes in this controller reach `counterparties` through a different param and are completely unprotected:

**`PATCH /contacts/:contactId`** — updates a company contact by contact id, no company id in the path:
```ts
.patch(
  '/contacts/:contactId',
  async ({ params, body }) => {
    try {
      const updated = await updateCompanyContact(params.contactId, body);
```
A user of tenant B can update a contact belonging to tenant A's company by guessing/obtaining a `contactId`. Same for:

- **`DELETE /contacts/:contactId`** — `deleteCompanyContact(params.contactId)`
- **`PATCH /emails/:emailId`** — `updateCompanyEmail(params.emailId, …)`
- **`DELETE /emails/:emailId`** — `deleteCompanyEmail(params.emailId)`
- **`PATCH /offices/:officeId`** — `updateCompanyOffice(params.officeId, …)`
- **`DELETE /offices/:officeId`** — `deleteCompanyOffice(params.officeId)`
- **`DELETE /attachments/:attachmentId`** — `deleteCompanyAttachment(params.attachmentId)`

These are all tenant-blind writes/deletes to child tables of `counterparties`. The guard never fires because `params.id` is undefined on these routes. This is the same class of bug the change claims to fix, just one level down.

**`GET /by-seasearcher/:seasearcherId`** — returns a local company by Seasearcher ID with no tenant check:
```ts
.get(
  '/by-seasearcher/:seasearcherId',
  async ({ params }) => {
    const company = await getCompanyBySeasearcherId(params.seasearcherId);
```
`getCompanyBySeasearcherId` (per the diff) is unchanged and unscoped. Any tenant can read another tenant's company by its Seasearcher ID. This is a direct cross-tenant read of `counterparties`.

**`POST /local/:id/set-parent`** — the `body.parentId` is not validated to belong to the caller's tenant:
```ts
.post(
  '/local/:id/set-parent',
  async ({ params, body }) => {
    try {
      const updated = await setParentCompany(params.id, body.parentId);
```
The guard checks `params.id` (the child), but `body.parentId` can be a company from another tenant. This creates a cross-tenant parent/child link, which then leaks data through `getChildCompanies`, `getParentCompany`, `getCompanyGroupAggregate`, `getGroupOrdersForCompany`, `getGroupVesselsForCompany`, `getGroupFleetForCompany` — all of which are guarded only on `params.id` and then traverse the hierarchy without tenant checks.

### M2. `onBeforeHandle` over-blocks: `POST /local/:id/place-supply-rules/:ruleId/reapply` and other routes with `params.id` that is NOT a company id

The guard treats every `params.id` as a company id. But:

**`PUT /local/:id/place-supply-rules/:ruleId`** and **`DELETE /local/:id/place-supply-rules/:ruleId`** and **`POST /local/:id/place-supply-rules/:ruleId/reapply`** — here `params.id` is a company id, so these are fine.

However, **`PATCH /contacts/:contactId`** etc. are the inverse problem (no `id`), and there is no route in this file where `params.id` is a non-company id. So the over-block concern is theoretical for the current route set — but the guard's design is fragile: any future route with an `id` param that isn't a company id will be silently blocked. The comment claims "every `/local/:id…` route must name a company" — that's true today, but the guard doesn't distinguish route shapes; it just checks for the presence of `params.id`. A future `/local/:id/…` route where `id` is, say, a rule id or an order id would be broken. This is a design smell, not a current bug — but combined with M1, the guard gives false confidence.

### M3. `getTopCreditGroups` SQL injection / parameter binding

```ts
WHERE p.tenant_id = ${tenantId}
```
This interpolates `tenantId` directly into a raw SQL template. Drizzle's `sql` template does parameterize interpolated values when used with `db.execute`, so this is likely safe from injection — but it's inconsistent with the rest of the codebase (which uses `eq()`), and if `tenantId` ever comes from an untrusted source without validation it's a risk. More importantly, the comment says "`p.tenant_id = c.tenant_id` is implied by the parent join" — but the join is `INNER JOIN counterparties c ON c.parent_id = p.id`. There is **no** `p.tenant_id = c.tenant_id` condition in the join. If a cross-tenant parent/child link exists (which M1 shows is possible via `set-parent`), the `WHERE p.tenant_id = ${tenantId}` filters only the parent, but children from other tenants would still be aggregated into the parent's group. The comment's claim is false. The fix should add `AND c.tenant_id = p.tenant_id` to the join or the WHERE.

### M4. `getSessionTenant` failure mode: silent skip on unknown socket

```ts
export async function getSessionTenant(socketId: string): Promise<string | null> {
  const session = sessions.get(socketId);
  if (!session?.userId) return null;
  const user = await findUserById(session.userId);
  return user?.tenantId ?? null;
}
```
And in `index.ts`:
```ts
const tenantId = await getSessionTenant(socketId);
if (!tenantId) return;
```
If the session is unknown or the user lookup fails, the sync is silently skipped. For an auto-sync hook triggered by `onEntityView`, this means a legitimate user viewing a company gets no sync and no error — a silent failure. The right failure mode depends on the product: if the hook is best-effort, silent skip is acceptable; if it's expected to always fire for a live session, this should log or surface an error. At minimum, this should `console.warn` or `logActivity` so the failure is observable. The comment says "treated as 'skip'" but doesn't justify why silent.

### M5. `importCompanyFromSeasearcher` still returns an existing company from ANY tenant

```ts
export async function importCompanyFromSeasearcher(seasearcherId: string, tenantId: string) {
  // Check if already imported
  const existing = await getCompanyBySeasearcherId(seasearcherId);
  if (existing) return existing;
```
`getCompanyBySeasearcherId` is unscoped. If tenant A has already imported Seasearcher company X, and tenant B tries to import the same Seasearcher ID, tenant B receives tenant A's company record — including its `id`, `tenantId`, and all fields. This is a cross-tenant data leak through the import path. The `existing` check must be scoped to `tenantId`, or the function must create a separate company per tenant (which is the correct multi-tenant behavior for a global directory import).

### M6. `getCompanyBySeasearcherId` route (`/by-seasearcher/:seasearcherId`) is completely unscoped

Covered in M1, but worth calling out separately: this is a direct GET route that returns a full company record by Seasearcher ID with no tenant check. It's not behind the `params.id` guard and the service function is unchanged.

---

## SHOULD-FIX

### S1. 404 vs 403 — the rationale is sound, but the implementation leaks existence in one place

The 404 choice is correct for the guarded routes. However, the `onBeforeHandle` guard returns 404 for a foreign id, but then the handler for `GET /local/:id` also returns 404 if `getCompanyById` returns null. That's consistent. But `DELETE /local/:id` has a role check that runs **after** the guard:

```ts
.delete(
  '/local/:id',
  async ({ params, auth, set }) => {
    const allowed = ['ADMIN', 'CREDITMANAGER', 'TEAMLEAD'];
    if (!allowed.includes(auth.role)) {
      set.status = 403;
```
The guard runs first, so a foreign id returns 404 before the role check. That's fine. But if a user has a valid id in their own tenant and lacks the role, they get 403 — which is correct and doesn't leak existence. No leak here.

However, `POST /local/:id/sync` returns a different message for a company that exists but has no Seasearcher ID:
```ts
return { success: false, data: null, message: 'Company not found or no Seasearcher ID' };
```
This is only reachable for a company in the caller's own tenant (guard passed), so it doesn't leak cross-tenant existence. Fine.

### S2. `updateCompanyTypes`, `updateCompanySegments`, `updateCompanyResponsibleUser` — the UPDATE statements are not tenant-scoped

The diff shows `updateCompany` got a tenant predicate on its UPDATE:
```ts
.where(and(eq(counterparties.id, companyId), eq(counterparties.tenantId, tenantId)))
```
But `updateCompanyTypes`, `updateCompanySegments`, and `updateCompanyResponsibleUser` are not in the diff — they still update by `id` alone. The route guard protects the HTTP path, but the service functions remain tenant-blind. If any non-HTTP caller (websocket, job, sibling module) calls them with a foreign id, the write lands. The stated principle was "threaded through to the read and the UPDATE so a foreign id cannot be read or written even if a caller forgets the route guard" — but that principle was only applied to `updateCompany`, not the other three update functions.

### S3. `deleteCompany` is not tenant-scoped

```ts
const deleted = await deleteCompany(params.id);
```
The route guard protects the HTTP path, but `deleteCompany` itself has no tenant predicate. Same concern as S2: any non-HTTP caller can delete a foreign company.

### S4. `getCompanyEnrichment`, `getCompanyFleet`, `getCompanyHierarchy`, `getCompanySeizures`, `getCompanySanctions` — Seasearcher data, not tenant data

These are global directory lookups by Seasearcher ID, not tenant-owned data. Leaving them unscoped is correct. But `getCompanyBySeasearcherId` (the local DB lookup) is tenant data and must be scoped — see M1/M6.

### S5. `getCustomerPaymentLedger` is not tenant-scoped, unlike `getSupplierPaymentLedger`

```ts
.get(
  '/local/:id/ledger/customer',
  async ({ params, query }) => {
    try {
      const ledger = await getCustomerPaymentLedger(params.id, {
```
The supplier ledger takes `auth.tenantId`:
```ts
const ledger = await getSupplierPaymentLedger(params.id, { … }, auth.tenantId);
```
But the customer ledger does not. The route guard protects the HTTP path, but the service function is tenant-blind. If the ledger queries join to `counterparties` or `orders` without a tenant filter, a non-HTTP caller could read another tenant's payment data. This is inconsistent with the supplier ledger fix.

### S6. `getSupplyPortsForCompany` and `listCompanyPlaceSupplyRules` etc. — service functions remain tenant-blind

The route guard protects the HTTP path, but all the child-resource service functions (`getCompanyContacts`, `getCompanyEmails`, `getCompanyOffices`, `getCompanyAttachments`, `getChildCompanies`, `getParentCompany`, `getCompanyGroupAggregate`, `getGroupOrdersForCompany`, `getGroupVesselsForCompany`, `getGroupFleetForCompany`, `getSupplyPortsForCompany`, `listCompanyPlaceSupplyRules`, etc.) take only `companyId` with no tenant. The stated design principle was to thread `tenantId` explicitly and make it required — but that was only done for a handful of functions. The rest still rely entirely on the route guard, which M1 shows is incomplete.

### S7. Test coverage gap: the isolation test doesn't cover the under-blocked routes

The test in Appendix E checks:
- `GET /local/:id` (guarded)
- `GET /local/:id/orders` (guarded)
- `GET /local/:id/contacts` (guarded)
- `GET /local/:id/emails` (guarded)
- `GET /local/:id/ledger/supplier` (guarded)
- `GET /local/:id/ledger/customer` (guarded)
- `GET /local/:id/group-aggregate` (guarded)
- `POST /local/:id/emails` (guarded)

It does **not** test:
- `PATCH /contacts/:contactId` (under-blocked)
- `DELETE /contacts/:contactId` (under-blocked)
- `PATCH /emails/:emailId` (under-blocked)
- `DELETE /emails/:emailId` (under-blocked)
- `PATCH /offices/:officeId` (under-blocked)
- `DELETE /offices/:officeId` (under-blocked)
- `DELETE /attachments/:attachmentId` (under-blocked)
- `GET /by-seasearcher/:seasearcherId` (under-blocked)
- `POST /local/:id/set-parent` with a foreign `body.parentId` (under-blocked)
- `POST /import` with a Seasearcher ID already imported by another tenant (M5)

The test suite gives false confidence that the module is isolated.

---

## Disagreement with the approach

The blanket `onBeforeHandle` is a reasonable idea for the `:id` routes, but it's being asked to carry the entire security boundary for the module, and it can't. The module has multiple shapes of company reference:

1. `params.id` — company id (guarded)
2. `params.contactId`, `params.emailId`, `params.officeId`, `params.attachmentId` — child record ids (unguarded)
3. `params.seasearcherId` — Seasearcher id that maps to a local company (unguarded)
4. `body.parentId` — company id in a body (unguarded)
5. `body.seasearcherId` — Seasearcher id in a body (partially guarded via import, but the existing-company check is unscoped)

A single `onBeforeHandle` checking `params.id` cannot cover all of these. The right fix is one of:

- **Repository-level tenant scoping** (which the author explicitly rejected) — but the rejection rationale ("hides the requirement and still leaves the query itself unscoped") is exactly the problem: the queries ARE still unscoped, and the route guard is incomplete.
- **Per-service tenant predicates** on every function that touches `counterparties` or its children — which is what the author started doing (`getCompanyById`, `updateCompany`, etc.) but didn't finish.
- **A combination**: keep the route guard as defense-in-depth, but add tenant predicates to every service function and every child-resource route.

The current state is the worst of both: the route guard gives the appearance of coverage, while the service layer remains tenant-blind and the child-resource routes are completely open.

---

## Summary of findings

| ID | Severity | Location | Issue |
|----|----------|----------|-------|
| M1 | MUST | `companies.controller.ts` — `/contacts/:contactId`, `/emails/:emailId`, `/offices/:officeId`, `/attachments/:attachmentId`, `/by-seasearcher/:seasearcherId`, `/local/:id/set-parent` | Guard under-blocks: routes reach company data without `params.id` |
| M2 | MUST | `companies.controller.ts` — `onBeforeHandle` | Guard design is fragile: any future non-company `id` param is silently blocked |
| M3 | MUST | `company.service.ts` — `getTopCreditGroups` | Comment claims tenant equality is implied by join; it is not. Cross-tenant children can be aggregated |
| M4 | MUST | `session-tracker.ts` / `index.ts` | Silent skip on unknown socket; no logging or error surface |
| M5 | MUST | `company.service.ts` — `importCompanyFromSeasearcher` | Existing-company check is unscoped; returns another tenant's company |
| M6 | MUST | `company.service.ts` — `getCompanyBySeasearcherId` | Unscoped read of `counterparties` by Seasearcher ID |
| S1 | SHOULD | `companies.controller.ts` | 404 vs 403 is correct; no leak found in current routes |
| S2 | SHOULD | `company.service.ts` — `updateCompanyTypes`, `updateCompanySegments`, `updateCompanyResponsibleUser` | UPDATE statements not tenant-scoped |
| S3 | SHOULD | `company.service.ts` — `deleteCompany` | DELETE not tenant-scoped |
| S4 | SHOULD | `companies.controller.ts` — enrichment routes | Seasearcher data is global; unscoped is correct |
| S5 | SHOULD | `company.service.ts` — `getCustomerPaymentLedger` | Not tenant-scoped, unlike supplier ledger |
| S6 | SHOULD | `company.service.ts` — child-resource functions | All remain tenant-blind; rely entirely on incomplete route guard |
| S7 | SHOULD | Appendix E test | Test doesn't cover under-blocked routes; false confidence |