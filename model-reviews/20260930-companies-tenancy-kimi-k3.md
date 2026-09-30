# Code Review: Tenant Isolation Fix

## Verdict: **APPROVE-WITH-CONDITIONS**

The fix is architecturally sound and addresses the core vulnerability correctly. The instance-level `onBeforeHandle` guard is the right shape for this module. However, there are gaps in coverage that should be addressed before this ships.

---

## Findings

### MUST-1: `getCompanyBySeasearcherId` remains unscoped

**File:** `company.service.ts` (line ~667 in diff context)

The function `getCompanyBySeasearcherId` is called by:
- `GET /companies/by-seasearcher/:seasearcherId` (controller line ~340)
- `importCompanyFromSeasearcher` (line ~739 in diff)

Neither call passes a tenant. The route `/by-seasearcher/:seasearcherId` is **not** covered by the `onBeforeHandle` guard because its param is `seasearcherId`, not `id`.

```ts
// Controller — no tenant check, no guard coverage
.get(
  '/by-seasearcher/:seasearcherId',
  async ({ params }) => {
    const company = await getCompanyBySeasearcherId(params.seasearcherId);
    // ...
  },
```

This means any authenticated user can probe whether a Seasearcher ID has been imported by **any** tenant, and receive that tenant's company data back. The response includes the full company object.

**Fix:** Either scope `getCompanyBySeasearcherId` with a required `tenantId`, or document why this is intentionally global (e.g., if Seasearcher imports are meant to be shared). If intentional, the route should not return tenant-specific fields like `creditLimit`, `creditUsed`, or internal notes.

---

### MUST-2: Sub-resource routes by non-`:id` param are unguarded

**File:** `companies.controller.ts`

These routes operate on sub-resources by their own ID, not the company ID, and are **not** covered by the guard:

| Route | Param | Risk |
|-------|-------|------|
| `PATCH /contacts/:contactId` | `contactId` | Update any tenant's contact |
| `DELETE /contacts/:contactId` | `contactId` | Delete any tenant's contact |
| `PATCH /emails/:emailId` | `emailId` | Update any tenant's email |
| `DELETE /emails/:emailId` | `emailId` | Delete any tenant's email |
| `PATCH /offices/:officeId` | `officeId` | Update any tenant's office |
| `DELETE /offices/:officeId` | `officeId` | Delete any tenant's office |
| `DELETE /attachments/:attachmentId` | `attachmentId` | Delete any tenant's attachment |

Example:
```ts
.delete(
  '/emails/:emailId',
  async ({ params }) => {
    const deleted = await deleteCompanyEmail(params.emailId);
    // No tenant check — emailId could belong to any tenant
  },
```

**Fix:** Either:
1. Extend the guard to resolve these sub-resource IDs to their parent company and check tenant ownership, or
2. Add tenant checks in the service functions (`updateCompanyEmail`, `deleteCompanyEmail`, etc.), or
3. Change routes to `/local/:id/emails/:emailId` so the guard catches them.

Option 3 is cleanest and most consistent.

---

### MUST-3: `setParentCompany` can create cross-tenant parent/child links

**File:** `companies.controller.ts` (line ~1050)

```ts
.post(
  '/local/:id/set-parent',
  async ({ params, body }) => {
    const updated = await setParentCompany(params.id, body.parentId);
    // ...
  },
```

The guard checks that `params.id` (the child) belongs to the caller's tenant. But `body.parentId` is not validated. A user could set their company's parent to a company in another tenant, creating a cross-tenant hierarchy.

This would then leak data through:
- `GET /local/:id/children` — if the foreign parent is queried
- `GET /local/:id/group-aggregate` — aggregates across the link
- `getTopCreditGroups` — the join `c.parent_id = p.id` would include cross-tenant children in the parent's group

**Fix:** In `setParentCompany`, verify that `parentId` belongs to the same tenant as `companyId`. Reject or ignore cross-tenant links.

---

### SHOULD-1: `importCompanyFromSeasearcher` returns existing company without tenant check

**File:** `company.service.ts` (line ~739)

```ts
export async function importCompanyFromSeasearcher(seasearcherId: string, tenantId: string) {
  const existing = await getCompanyBySeasearcherId(seasearcherId);
  if (existing) return existing;  // ← No tenant check on `existing`
  // ...
}
```

If tenant A imported a company from Seasearcher, and tenant B calls `POST /companies/import` with the same `seasearcherId`, tenant B receives tenant A's company object (including any tenant-specific fields that have been edited).

**Fix:** After finding `existing`, check `existing.tenantId === tenantId`. If not, either:
- Create a new company for tenant B (if the model allows the same Seasearcher company in multiple tenants), or
- Return an error indicating the company is already imported by another tenant (without revealing which).

---

### SHOULD-2: `deleteCompany` does not verify tenant ownership

**File:** `companies.controller.ts` (line ~640)

```ts
.delete(
  '/local/:id',
  async ({ params, auth, set }) => {
    // Role check...
    const deleted = await deleteCompany(params.id);
    // ...
  },
```

The guard ensures `:id` belongs to the caller's tenant, so this is **currently safe**. However, `deleteCompany` itself takes no `tenantId`, making it fragile if called from elsewhere (websocket, admin tooling, future refactor).

**Recommendation:** Add `tenantId` as a required parameter to `deleteCompany` and include it in the `WHERE` clause, consistent with `updateCompany`.

---

### SHOULD-3: Websocket failure mode is silent skip — consider logging

**File:** `index.ts` (diff)

```ts
const tenantId = await getSessionTenant(socketId);
if (!tenantId) return;  // Silent skip
```

If `getSessionTenant` returns null (unknown socket, user not found, user has no tenant), the sync is silently skipped. This is the correct security posture, but operationally it could mask bugs (e.g., session tracking broken, user record deleted mid-session).

**Recommendation:** Log at `warn` level when skipping due to unknown tenant:
```ts
if (!tenantId) {
  console.warn('[AutoSync] Skipping company sync: no tenant for socket', socketId);
  return;
}
```

---

### SHOULD-4: Test coverage gaps

**File:** Appendix E

The tests cover the main guard paths well. Missing:

1. **Sub-resource by own ID** — no test for `PATCH /emails/:emailId` with a foreign `emailId`.
2. **`/by-seasearcher/:seasearcherId`** — no test that this returns 404 or scoped data for foreign tenants.
3. **`setParentCompany` cross-tenant** — no test that linking to a foreign parent is rejected.
4. **Websocket sync** — no test that `getSessionTenant` returning null skips the sync.

---

## Answers to your scrutiny questions

### 1. Is a blanket instance-level `onBeforeHandle` on `params.id` sound?

**Yes, with caveats.** It correctly covers all `/local/:id…` routes. It does not over-block because:
- Routes without `:id` (`/local`, `/search`, `/own`, `/import`, `/top-credit-groups`) are unaffected.
- Routes with different param names (`:seasearcherId`, `:contactId`, `:emailId`) are unaffected — but this is also the under-block risk (MUST-2).

The guard is the right shape. The gap is that sibling routes using sub-resource IDs bypass it entirely.

### 2. 404 vs 403 — right call?

**Yes.** 404 is correct. A 403 would confirm the id exists in another tenant. The implementation is consistent:

```ts
if (!(await companyBelongsToTenant(id, auth.tenantId))) {
  set.status = 404;
  return { success: false, data: null, message: 'Company not found' };
}
```

**Leak check:** The only place existence could leak is timing — a foreign id that exists vs one that doesn't might have different query times. This is negligible for UUID lookups and not worth mitigating.

### 3. Did I miss any tenant-blind read?

Yes — see MUST-1 (`getCompanyBySeasearcherId`) and MUST-2 (sub-resource routes).

### 4. Can a foreign id still be written through any path?

- **Direct service call:** `updateCompany` now requires `tenantId` and scopes its `UPDATE`. Good.
- **Websocket hook:** Covered by `getSessionTenant`. Good.
- **Sibling module:** Not shown, but if any other module imports `company.service` functions, they must now pass `tenantId`. The compiler will catch missing args since it's required.
- **`setParentCompany`:** Yes — see MUST-3.

### 5. Is `getSessionTenant` correct, and is skipping the right failure mode?

**Correct:** It resolves socket → session → user → tenant. The chain is sound.

**Skipping is right:** If the tenant is unknown, the sync cannot be scoped safely, so skipping is the only safe option. Failing open (syncing anyway) would be a vulnerability. Failing closed with an error to the socket would be noisy for a background operation.

---

## Summary

| # | Severity | Issue |
|---|----------|-------|
| MUST-1 | **Blocker** | `getCompanyBySeasearcherId` unscoped; `/by-seasearcher/:seasearcherId` leaks cross-tenant |
| MUST-2 | **Blocker** | Sub-resource routes (`:contactId`, `:emailId`, `:officeId`, `:attachmentId`) unguarded |
| MUST-3 | **Blocker** | `setParentCompany` allows cross-tenant parent links |
| SHOULD-1 | Important | `importCompanyFromSeasearcher` returns foreign tenant's existing company |
| SHOULD-2 | Important | `deleteCompany` takes no `tenantId` (defence in depth) |
| SHOULD-3 | Minor | Silent skip on websocket sync — add logging |
| SHOULD-4 | Minor | Test gaps for sub-resources, by-seasearcher, cross-tenant parent |

The core fix is correct and well-executed. Address the three MUST items before merge.