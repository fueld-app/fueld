# CODE REVIEW — ROUND 2

## FINDINGS

### MUST

**M1. `getCompanyById` fallback path is unscoped** — `company.service.ts`, `getCompanyById`

The primary query is scoped, but the `isMissingCompanyRegistrationColumnError` fallback is not shown in the diff. The diff shows the fallback pattern in `getCompanyBySeasearcherId`:

```ts
row = await db.query.counterparties.findFirst({
  where: and(eq(counterparties.seasearcherId, seasearcherId), eq(counterparties.tenantId, tenantId)),
```

…but `getCompanyById`'s fallback is not in the diff at all. If it still reads `where: eq(counterparties.id, id)` without `tenantId`, the scoping silently disappears whenever the fallback fires (a live schema-migration window). Evidence: the diff for `getCompanyById` shows only the signature change and the primary `select()`; the `catch` branch is absent. **Verify the fallback carries `and(eq(id), eq(tenantId))`.**

---

**M2. `getCompanyBySeasearcherId` accepts `opts: { includeDeleted?: boolean }` but never uses it** — `company.service.ts`

```ts
export async function getCompanyBySeasearcherId(
  seasearcherId: string,
  tenantId: string,
  opts: { includeDeleted?: boolean } = {},
) {
```

`opts` is declared and defaulted but never referenced in the visible body. Either the soft-delete filter is missing (a caller passing `includeDeleted: false` gets deleted rows) or the parameter is dead. If soft-delete exists on `counterparties`, this is a correctness bug; if not, it's dead API surface. Either way it must be resolved.

---

**M3. `updateCompanyContact` pre-update read is unscoped** — `company.service.ts`

```ts
const [current] = await db
  .select({
    id: companyContacts.id,
    // …
  })
  .from(companyContacts)
  .where(eq(companyContacts.id, contactId))   // ← no tenant predicate
  .limit(1);
```

The subsequent `update` is correctly scoped with `inArray(…, ownedCompanyIds(tenantId))`, but this `current` read fetches the contact's `source`/`seasearcherPersonId` before the scoped write. If `current` is used to decide *whether* to update (the diff truncates the body), a foreign contact's metadata influences the control flow. The read itself must carry the `inArray(companyContacts.counterpartyId, ownedCompanyIds(tenantId))` predicate.

---

**M4. `deleteCompanyContact` pre-delete read is unscoped** — `company.service.ts`

```ts
const [current] = await db
  .select({
    id: companyContacts.id,
    source: companyContacts.source,
    seasearcherPersonId: companyContacts.seasearcherPersonId,
    counterpartyId: companyContacts.counterpartyId,
  })
  .from(companyContacts)
  .where(eq(companyContacts.id, contactId))   // ← no tenant predicate
  .limit(1);
```

The follow-up check `companyBelongsToTenant(current.counterpartyId, tenantId)` is correct, but this is a **two-query TOCTOU**: between the read of `current` and the `companyBelongsToTenant` check, the contact's `counterpartyId` could theoretically change. More practically, the `delete`/`update` that follows is scoped only by `eq(companyContacts.id, contactId)` — the tenant check already happened in JS, not in SQL. The delete should be a single scoped statement:

```ts
.where(and(eq(companyContacts.id, contactId), inArray(companyContacts.counterpartyId, ownedCompanyIds(tenantId))))
```

matching the pattern used in `deleteCompanyEmail`/`deleteCompanyOffice`/`deleteCompanyAttachment`.

---

**M5. `updateCompanyEmail` primary-unset subquery is unscoped** — `company.service.ts`

```ts
if (data.isPrimary) {
  // fetch counterpartyId and emailType first
```

The diff shows the comment but not the body of this branch. If the "unset other primaries" `UPDATE` runs `where eq(counterpartyId, fetchedId)` without a tenant predicate, it can unset primaries on another tenant's company if the fetched `counterpartyId` was read from an unscoped query. The main `update` is correctly scoped; the primary-unset must be too.

---

**M6. `getTopCreditGroups` comment is wrong about the join** — `company.service.ts`

```ts
/**
 * … `p.tenant_id = c.tenant_id` is implied by the parent join, so
 * filtering the parents is enough.
 */
```

The join is `c.parent_id = p.id`. It implies nothing about tenants. The `WHERE p.tenant_id = ${tenantId}` filter is correct and necessary, but the comment rationalises it with a false claim. If a child row ever had a different `tenant_id` than its parent (a pre-existing bad link, or a future bug), the aggregate would silently include the child's credit in the parent's totals. The comment should say: *"we filter parents; children are joined by `parent_id` and are expected to share the parent's tenant because `setParentCompany` refuses cross-tenant links."*

---

**M7. `getSessionTenant` does a DB lookup per entity view with no cache** — `session-tracker.ts`

```ts
export async function getSessionTenant(socketId: string): Promise<string | null> {
  const session = sessions.get(socketId);
  if (!session?.userId) return null;
  const user = await findUserById(session.userId);   // ← DB hit every call
  return user?.tenantId ?? null;
}
```

`onEntityView` fires per entity view per socket. A user scrolling a company list triggers one `findUserById` per row. The session record already holds `userId`; it should also hold `tenantId` (resolved once at session creation) so this is a Map lookup, not a query. The silent skip (`if (!tenantId) return`) also needs a `console.warn` so a broken session doesn't silently disable auto-sync.

---

### SHOULD

**S1. `ownedCompanyIds` subquery is correct but O(n) per call** — `company.service.ts`

```ts
function ownedCompanyIds(tenantId: string) {
  return db.select({ id: counterparties.id }).from(counterparties).where(eq(counterparties.tenantId, tenantId));
}
```

This is the right pattern (typed, composable, used consistently). For a tenant with 10k companies the `IN (SELECT …)` is fine in Postgres, but if this ever becomes a bottleneck, a `company.tenantId` denormalised column on the child tables would be the fix. Not a blocker.

---

**S2. `deleteCompanyContact` returns `true` after soft-delete but the route says "Contact deleted"** — `companies.controller.ts`

```ts
if (current.source === 'seasearcher' || current.seasearcherPersonId !== null) {
  await db.update(companyContacts).set({ deletedAt: new Date(), … });
  return true;
}
```

The route responds `{ success: true, data: null, message: 'Contact deleted' }` for both hard and soft deletes. The distinction matters for audit. Consider returning `{ deleted: true, soft: boolean }` or at least a different message.

---

**S3. `setParentCompany` child-existence check is a separate query** — `company.service.ts`

```ts
const [child] = await db
  .select({ id: counterparties.id })
  .from(counterparties)
  .where(and(eq(counterparties.id, childId), eq(counterparties.tenantId, tenantId)))
  .limit(1);
if (!child) throw Object.assign(new Error('Company not found.'), { code: 'NOT_FOUND' });
```

This is correct but redundant with the route guard (which already verified `companyBelongsToTenant(params.id, auth.tenantId)`). The defence-in-depth is intentional per the comment, but it costs a round-trip. Acceptable; just noting the trade-off is deliberate.

---

**S4. `importCompanyFromSeasearcher` dedupe is scoped, but the Seasearcher fetch is not idempotent** — `company.service.ts`

```ts
const existing = await getCompanyBySeasearcherId(seasearcherId, tenantId);
if (existing) return existing;
// Fetch from Seasearcher
```

Two concurrent imports for the same `seasearcherId` in the same tenant will both pass the dedupe check and both insert. A unique constraint on `(tenantId, seasearcherId)` would close this; the current code relies on the fact that `seasearcherId` is probably unique in practice. Not a tenancy bug, but a race.

---

**S5. `getCompanyById` fallback in `createCompany` is safe but only because `tenantId` is threaded** — `company.service.ts`

```ts
const created = await getCompanyById(createdId, tenantId);
```

This is correct. If M1's fallback is unscoped, this read could return null (company created but not found), causing a spurious throw. The M1 fix covers this.

---

**S6. `getTopCreditGroups` raw SQL uses `p.tenant_id` but the schema field is `tenantId`** — `company.service.ts`

```sql
WHERE p.tenant_id = ${tenantId}
```

Drizzle's `sql` template with `counterparties` table alias `p` — the column name in the database is `tenant_id` (snake_case), so this is correct. Just confirming the mapping is intentional.

---

**S7. Websocket skip is silent** — `index.ts`

```ts
const tenantId = await getSessionTenant(socketId);
if (!tenantId) return;
```

No log. If `getSessionTenant` returns null unexpectedly (session expired, user deleted), the auto-sync silently stops. Add `console.warn('[AutoSync] Skipping: no tenant for socket', socketId)`.

---

## DISAGREEMENTS WITH STATED GAPS

**D1. `getChildCompanies` / `getParentCompany` / group reads unscoped — ACCEPTED as stated.**

The reasoning is sound: these are reachable only through `/local/:id/group-*` routes, which are guarded by `onBeforeHandle`. Cross-tenant links are refused at `setParentCompany`. A pre-existing bad link would require a data migration or a bug to create. The residual risk is acknowledged and acceptable.

**D2. `getTopCreditGroups` comment — DISAGREE with the comment, not the code.**

The code is correct (`WHERE p.tenant_id = ${tenantId}`). The comment's claim that "`p.tenant_id = c.tenant_id` is implied by the parent join" is false. The join is `c.parent_id = p.id`. See M6.

**D3. `getSessionTenant` DB lookup per view — DISAGREE that this is acceptable.**

The stated gap acknowledges the lookup but not the frequency. `onEntityView` fires per entity view; a user browsing a list of 50 companies triggers 50 `findUserById` calls. This is a performance bug, not just a design note. See M7.

---

## VERDICT

**APPROVE-WITH-CONDITIONS**

The round-2 fixes correctly address all three round-1 MUSTs. The child-resource scoping via `inArray(…, ownedCompanyIds(tenantId))` is the right pattern, consistently applied. The 404-vs-403 choice is correctly implemented and documented. The websocket hook is properly closed.

**Conditions for approval:**

1. **M1**: Verify `getCompanyById`'s `isMissingCompanyRegistrationColumnError` fallback carries `and(eq(id), eq(tenantId))`.
2. **M2**: Remove or implement the `opts.includeDeleted` parameter in `getCompanyBySeasearcherId`.
3. **M3/M4**: Scope the pre-write reads in `updateCompanyContact` and `deleteCompanyContact` (or convert to single-statement scoped writes).
4. **M5**: Verify the primary-unset in `updateCompanyEmail` is tenant-scoped.
5. **M6**: Fix the `getTopCreditGroups` comment.
6. **M7**: Cache `tenantId` on the session record; add a warn log to the skip.

None of these are architectural; all are verifiable in a single pass. The design (route guard + explicit `tenantId` threading + child-resource subquery scoping) is sound and correctly executed.