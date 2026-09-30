Let me carefully analyze this code review request. The change is about tenant isolation in a multi-tenant Bun + Elysia + Drizzle monorepo. The fix:

1. Adds a blanket `onBeforeHandle` on the companiesController instance that checks `params.id` against `auth.tenantId` via `companyBelongsToTenant`, returning 404 if not owned.
2. Threads `tenantId` explicitly through service functions.
3. Adds `getSessionTenant` for the websocket path.

Let me scrutinize each area.

**1. The blanket `onBeforeHandle` — over-block / under-block analysis.**

The guard reads `(params as { id?: string } | undefined)?.id`. Routes in this controller:

- `/own` — no params.id → guard skips. OK.
- `/local` — no params.id → skips. OK (list is scoped in service).
- `/local/:id` — guarded.
- `/local/:id/inquiry-data` — guarded.
- `/local/:id/orders`, `/vessels` — guarded.
- `/search` — no id. OK.
- `/enrichment/:seasearcherId` — params is `{ seasearcherId }`, no `id` → guard skips. OK — enrichment is a global Seasearcher directory, not tenant data. But wait — is that right? `getCompanyEnrichment(params.seasearcherId)` — Seasearcher is an external data provider, so enrichment data is global. That's fine.
- `/by-seasearcher/:seasearcherId` — **`getCompanyBySeasearcherId(params.seasearcherId)`** — this is a tenant-blind read! The diff shows `getCompanyBySeasearcherId` was NOT changed (it's not in the diff). Let me check: the diff shows changes to `listCompanies`, `companyBelongsToTenant` (new), `getCompanyById`, `createCompany`, `importCompanyFromSeasearcher`, `importCompanyByName`, `syncCompanyFromSeasearcher`, `acceptSeasearcherValue`, `keepMineValue`, `updateCompany`, `searchCompaniesTypeahead`, `getTopCreditGroups`. `getCompanyBySeasearcherId` is NOT in the diff — it remains unscoped. So `GET /companies/by-seasearcher/:seasearcherId` returns a local company (with all its fields — name, country, credit limit, etc.) for any tenant, given a Seasearcher id. Is that a leak? The Seasearcher id is a global directory id — any user could know/enumerate Seasearcher ids (they're from an external API, and the `/companies/search` typeahead returns Seasearcher results to everyone). So an attacker can obtain a Seasearcher id from the global search, then call `/by-seasearcher/:seasearcherId` and get the local company record — which may belong to another tenant — including name, country, creditLimit, creditUsed, etc. That's a cross-tenant read. This is a MUST finding: `getCompanyBySeasearcherId` is unscoped and reachable via `GET /companies/by-seasearcher/:seasearcherId`.

Wait — but is it? Let me think about whether the same seasearcher company can exist in multiple tenants. `importCompanyFromSeasearcher` checks `getCompanyBySeasearcherId(seasearcherId)` — "Check if already imported / const existing = await getCompanyBySeasearcherId(seasearcherId); if (existing) return existing;" — this is ALSO a bug! `importCompanyFromSeasearcher(seasearcherId, tenantId)` now takes tenantId, but the dedupe check `getCompanyBySeasearcherId` is unscoped: if tenant A imported company X (seasearcher id S), and tenant B calls `POST /companies/import { seasearcherId: S }`, the function finds A's existing company and **returns it to tenant B** — leaking A's company record (id, name, credit data, etc.) AND, worse, tenant B might then use that company id in operations... well, the route guard would block `/local/:id` routes for B since the company belongs to A. But the import response itself returns the full company object. That's a cross-tenant data leak AND a correctness bug: B thinks it imported the company but actually got A's company, which B cannot access via any `/local/:id` route. So B's import silently "succeeds" but is unusable. This is a MUST: the dedupe in `importCompanyFromSeasearcher` must be scoped by tenant (e.g., `getCompanyBySeasearcherId(seasearcherId, tenantId)`), and `GET /by-seasearcher/:seasearcherId` must be scoped too.

Actually wait — is there a unique constraint on seasearcherId? Not stated. The context says `counterparties.name` is NOT unique across tenants; nothing about seasearcherId. Given multi-tenant, two tenants could legitimately each want their own copy of the same external company. The unscoped findFirst would prevent tenant B from having its own copy. So both a leak and a functional bug.

**2. Under-block: routes that reach a company another way.**

- `/contacts/:contactId` (PATCH), `/contacts/:contactId` (DELETE) — params is `{ contactId }`, no `id` → guard skips. `updateCompanyContact(params.contactId, body)` and `deleteCompanyContact(params.contactId)` — these operate on `companyContacts` by contact id with no tenant check. A contact id is presumably a UUID — hard to enumerate, but if leaked (e.g., visible in a shared log, or a contact belongs to a company that appears in a global context), any authenticated user of any tenant can update/delete another tenant's contact. Same for:
  - `/emails/:emailId` PATCH and DELETE — `updateCompanyEmail(params.emailId)`, `deleteCompanyEmail(params.emailId)` — unscoped.
  - `/offices/:officeId` PATCH and DELETE — unscoped.
  - `/attachments/:attachmentId` DELETE — `deleteCompanyAttachment(params.attachmentId)` — unscoped, AND it deletes the file from disk. Cross-tenant deletion.
  
  These are the "under-block" routes: the guard only checks `params.id`, but these sibling routes address child resources by their own ids. The fix's own rationale ("a foreign id must be indistinguishable...") applies equally here. This is a MUST finding — the guard's param name allowlist is `id` only, and child-resource routes (`contactId`, `emailId`, `officeId`, `attachmentId`, and `ruleId` under place-supply-rules — wait, place-supply-rules routes have both `id` and `ruleId`, so the `id` guard covers the company; but `updateCompanyPlaceSupplyRule(params.id, params.ruleId, body)` — does the service check that ruleId belongs to that company? Unknown — service not shown. The `id` is guarded, so at least the company is the caller's. But if the service looks up the rule by ruleId alone without checking it belongs to params.id's company... we can't see. Hmm, the signature `updateCompanyPlaceSupplyRule(params.id, params.ruleId, body)` suggests it takes both, so presumably it joins. Can't verify — flag as SHOULD/verify.)

  For contacts/emails/offices/attachments, the service functions take only the child id — no company id, no tenant. So they're definitely unscoped unless the service internally joins to counterparties (not shown, but the signature `updateCompanyContact(params.contactId, body)` has no tenant param, and the diff didn't touch them — the diff only shows changed functions; these weren't changed). MUST: scope child-resource mutations/reads by tenant (join through counterpartyId → counterparties.tenantId).

  Also note: these child routes don't even have the company id in the URL, so the guard can't cover them without a lookup. The reviewer asked "can it over-block (a legitimate route that takes a non-company id)" — actually the opposite problem: routes that take a non-company id (contactId, emailId, officeId, attachmentId, seasearcherId, ruleId) are NOT blocked, and some of them should be.

  Over-block check: is there any route where `params.id` is NOT a counterparty id? Scanning: all `/local/:id...` routes use id as company id. `/local/:id/place-supply-rules/:ruleId` — id is company. No route uses `id` for something else. So no over-block currently. But future risk: if someone adds `/companies/foo/:id` where id is not a company, the guard would 404 legitimate requests... actually it would 404 because `companyBelongsToTenant` returns false for a non-company id. That's a latent footgun but acceptable with the comment. Also performance: the guard runs a DB query per request — one extra query per `/local/:id` request, and then handlers like `getCompanyById` run the same query again. Minor.

  Another subtlety: `onBeforeHandle` returning a value — in Elysia, returning a value from `onBeforeHandle` short-circuits the handler and the returned value becomes the response. Yes, that's correct Elysia behavior. And `set.status = 404` with a returned body works. OK.

  But wait — does `onBeforeHandle` run for ALL routes including `/search`, `/local` (list), `/own`, `/import`? Yes, but those have no `params.id` so the guard returns undefined and continues. Fine.

  One more: the guard checks `if (!auth?.tenantId)` → 401. But `authGuard` presumably already ensures auth. Fine, defensive.

  What about `params.id` when the route is `/local/:id/place-supply-rules/:ruleId` — params.id exists, guarded. Good.

**3. 404 vs 403.**

404 is the right call for cross-tenant ids (don't leak existence). But check for leaks of existence elsewhere:

- `createCompany` with a `seasearcherId` in the body: `createCompany(auth.tenantId, body)` — body includes optional `seasearcherId`. What does createCompany do with it? Not shown in diff (the diff shows the tenant resolution part). If it inserts with the given seasearcherId, two tenants can have the same seasearcherId — fine. But if there's a unique constraint... unknown.

- `importCompanyFromSeasearcher` — as noted, returns another tenant's company. That leaks existence AND data. MUST.

- `GET /by-seasearcher/:seasearcherId` — returns `{ success: true, data: company }` for a foreign company or `{ success: false, data: null }` if not found. This distinguishes "imported by some tenant" from "not imported" — an existence oracle across tenants, plus full data. MUST.

- `searchCompaniesTypeahead` — the local half is now scoped; the Seasearcher half is global directory — fine, that's external data.

- `getCompanyEnrichment` etc. — external data, fine.

- The 404 responses: the guard returns 404 with message 'Company not found'. The handler for `/local/:id` also returns 'Company not found' but with status 200 (no `set.status`)! Look: 

```ts
.get('/local/:id', async ({ params, auth }) => {
  const company = await getCompanyById(params.id, auth.tenantId);
  if (!company) {
    return { success: false, data: null, message: 'Company not found' };
  }
```
No `set.status = 404` — returns 200 with success:false. Inconsistent with the guard's 404. Minor/SHOULD: nonexistent id via the guard... wait, the guard runs first: for a nonexistent id, `companyBelongsToTenant` returns false → 404 from the guard. So the handler's `!company` branch is dead code for the HTTP path (guard already 404'd). Actually not dead — the guard covers it. But the handler branch returns 200. Since the guard intercepts first, the handler branch is unreachable via HTTP. Fine, but the inconsistency is cosmetic. Actually wait — is it unreachable? The guard checks `companyBelongsToTenant(id, auth.tenantId)` — for a nonexistent id, no row → false → 404. So yes, handler never sees a missing company. OK.

- `updateCompanyTypes`, `updateCompanySegments`, `updateCompanyResponsibleUser`, `deleteCompany`, `setParentCompany`, `removeParentCompany` — these take only `params.id` (no tenantId) and presumably do `WHERE id = $1` unscoped. But the guard already verified the company belongs to the caller's tenant, so the write is scoped transitively... BUT there's a TOCTOU-ish concern? Not really — the guard runs in the same request, microseconds earlier. The company can't change tenants between. So these are OK via the guard. However — the stated design principle was "tenantId made a REQUIRED parameter so the compiler enumerated every caller" — but `updateCompanyTypes`, `updateCompanySegments`, `updateCompanyResponsibleUser`, `deleteCompany`, `setParentCompany`, `removeParentCompany`, `updateCompanyContact`, etc. were NOT threaded. The guard covers the HTTP path for the first five. But `setParentCompany(params.id, body.parentId)` — **the parentId in the body is NOT validated!** Tenant A's user can set the parent of their own company to tenant B's company id (if they know/guess B's company id — UUIDs are hard to guess, but ids can leak via... hmm, the typeahead is now scoped; via import dedupe leak; via logs). What happens: `setParentCompany` links A's child to B's parent. Then `getCompanyGroupAggregate`, `getGroupOrdersForCompany`, `getTopCreditGroups` aggregate across the parent-child link — cross-tenant credit aggregation! `getTopCreditGroups` now filters `WHERE p.tenant_id = $tenantId` but joins children `c ON c.parent_id = p.id` — if a foreign child is attached to a local parent, or a foreign parent attached to a local child... The comment says "`p.tenant_id = c.tenant_id` is implied by the parent join" — that's only true if the hierarchy is guaranteed same-tenant, which `setParentCompany` does NOT enforce (it takes parentId with no tenant check). So the claim "implied by the parent join" is unenforced. MUST or SHOULD: validate `body.parentId` belongs to the same tenant in `setParentCompany` (and the guard doesn't cover body params). This is a genuine hole: cross-tenant hierarchy link poisons group aggregates, group orders, group fleet, and the dashboard credit widget. I'd call it MUST (it's a write path that reaches another tenant's data, question 4 explicitly asks "can a foreign id still be written through any path").

  Similarly `updateCompany` body has `preferredInvoicingCompanyId: t.Optional(t.Nullable(t.String()))` — a company id in the body! `updateCompany(params.id, auth.tenantId, body)` — the UPDATE is tenant-scoped on the target, but `preferredInvoicingCompanyId` is written as a field with no validation that it belongs to the same tenant. A user could set their company's preferred invoicing company to a foreign company id. Downstream invoicing might then reference another tenant's company. SHOULD/MUST — depends on how preferredInvoicingCompanyId is used downstream; at minimum SHOULD validate. Also `createCompany` body has `seasearcherId` — fine.

  Also `createCompanyContact(params.id, body)` — id guarded. `addCompanyEmail(params.id, ...)` — guarded. `createCompanyAttachment({ counterpartyId: params.id, ... })` — guarded. `addCompanyOffice(params.id, body)` — guarded. OK.

**4. `getCustomerPaymentLedger(params.id, {...})` — no tenantId!** Compare: `getSupplierPaymentLedger(params.id, {...}, auth.tenantId)` gets tenantId, but the customer ledger does NOT. The guard covers the company ownership, so transitively the ledger rows for that company are the caller's... unless the ledger query joins through orders/payments that might include rows from... hmm. The customer ledger presumably queries customerPayments/orders where counterpartyId = params.id. Since the company is verified as the caller's, its payments are the caller's. So why does the supplier ledger need tenantId but not the customer one? The context says "A previous change put supplier-invoice receipts into the company ledger" — the supplier ledger probably joins supplierInvoices/supplierReceipts which may be tenant-keyed differently, or the supplier ledger aggregates across order legs where the supplier might be... Actually the asymmetry is suspicious: if `getSupplierPaymentLedger` needs a tenantId, the author determined its query isn't fully scoped by company id alone (maybe it joins through orders where the company is a supplier, and orders have their own tenant scoping, or it reads tenant-keyed tables like creditLines). If the supplier one needed it, the customer one might too — or the supplier one's tenantId is used for something else. We can't see the implementation. Flag as SHOULD: verify `getCustomerPaymentLedger` is scoped by the company's ownership; the asymmetry with `getSupplierPaymentLedger(params.id, {...}, auth.tenantId)` needs justification. Actually — since the guard ensures params.id is the caller's company, and the ledger is keyed by that company, it's probably fine. But the asymmetry begs the question. SHOULD.

**5. `getOrdersForCompany(params.id)`, `getVesselsForCompany(params.id)`, `getCompanyContacts`, `getCompanyAttachments`, `getCompanyEmails`, `getCompanyOffices`, `getChildCompanies`, `getParentCompany`, `getCompanyGroupAggregate`, `getGroupOrdersForCompany`, `getGroupFleetForCompany`, `getGroupVesselsForCompany`, `getSupplyPortsForCompany`, `listCompanyPlaceSupplyRules`, `getCustomerPaymentLedger`** — all take only company id, no tenantId. Transitively scoped via the guard for the anchor company. BUT: `getChildCompanies(params.id)` returns children — are children guaranteed same tenant? Only if hierarchy links are same-tenant, which `setParentCompany` doesn't enforce (see above). `getParentCompany(params.id)` returns the parent — same issue. `getCompanyGroupAggregate`, `getGroupOrdersForCompany`, etc. traverse the hierarchy — cross-tenant traversal possible if a foreign link exists. So the hierarchy enforcement in `setParentCompany` is the root fix; with that enforced, the group reads are safe. Also `getOrdersForCompany` — orders where company is client; orders presumably belong to the tenant too; company is caller's so fine.

**6. The websocket path.**

`getSessionTenant(socketId)`: looks up `sessions.get(socketId)`, then `findUserById(session.userId)`, returns `user?.tenantId ?? null`. Concerns:

- The session's tenant is resolved from the CURRENT user record. If a user's tenant changed (rare), fine. If `findUserById` returns the user with tenantId — presumably fine.
- **The sync is triggered by `onEntityView(socketId, 'Company', entityId)`** — a socket "views" an entity. Where does `entityId` come from? Presumably the client sends a "view company X" message over the socket. **There is NO check that the viewed company belongs to the socket's tenant before syncing!** The hook resolves the socket's tenant, then calls `syncCompanyFromSeasearcher(entityId, tenantId)` — and `syncCompanyFromSeasearcher` does `getCompanyById(companyId, tenantId)` which returns null for a foreign company → sync skipped. OK, so the scoping holds: a malicious socket can send `view Company <foreign-id>` and the sync will no-op because getCompanyById is tenant-scoped. Good. But wait — `syncVesselFromSeasearcher(entityId)` for vessels is unscoped — out of scope for this change (vessels module), but worth a SHOULD note? The change's threat model is companies; vessels may be global (vessels are physical ships, arguably global data). Skip or minor note.
- Skipping when tenant unknown: "An unknown socket yields null and the sync is skipped." Is skip the right failure mode? For a security fix, fail-closed is right. But silent skip means a legitimate sync could silently stop working if session tracking hiccups (e.g., session evicted). No logging — SHOULD: log when skipping due to unknown tenant, so the failure mode is observable. Also `getSessionTenant` does a DB lookup (`findUserById`) on every entity view — the session could store tenantId at connect time instead. Minor perf note. Also: the session record "carries the user, not the tenant" — could the session store tenantId at auth time? That would avoid the per-view DB hit and avoid stale lookups. SHOULD (nice-to-have).
- Race: `sessions.get(socketId)` — is `sessions` a Map in module scope? Yes (`sessions.values()`). Fine.
- One more: `getSessionTenant` returns the user's CURRENT tenantId from the DB. If the socket authenticated as user U, and U's tenantId is looked up fresh — fine.

**7. `createCompany` tenant validation.**

```ts
const [tenantRow] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
if (!tenantRow) throw new Error('Tenant not found');
```
This validates the tenant exists. But `auth.tenantId` comes from the auth guard — presumably from the JWT/session. If auth.tenantId is trusted, the lookup is redundant but harmless (one extra query). Actually it's good defense. But note: the controller's POST /local does NOT wrap in try/catch — `createCompany` throws → 500 with stack? Elysia default error handling. Other routes have try/catch. Minor.

Hmm wait, actually there's a subtle issue: does the insert use `tenantRow.id` or the passed `tenantId`? Not shown, but presumably `tenantId`. Fine.

**8. `importCompanyFromSeasearcher` dedupe** — covered above. MUST. Let me re-read the diff:

```ts
-export async function importCompanyFromSeasearcher(seasearcherId: string) {
+export async function importCompanyFromSeasearcher(seasearcherId: string, tenantId: string) {
   // Check if already imported
   const existing = await getCompanyBySeasearcherId(seasearcherId);
   if (existing) return existing;
```
Yes — `getCompanyBySeasearcherId` unchanged and unscoped. So tenant B importing a company already imported by tenant A gets A's company object back (full row: name, country, creditLimit, creditUsed, types, contacts? — whatever getCompanyById-like shape returns) and B never gets its own copy. Both a leak and a functional bug. MUST.

And `GET /by-seasearcher/:seasearcherId` — same unscoped function, directly exposed. MUST.

**9. `getTopCreditGroups` scoping.**

```sql
FROM counterparties p
INNER JOIN counterparties c ON c.parent_id = p.id
WHERE p.tenant_id = ${tenantId}
```
The comment claims "`p.tenant_id = c.tenant_id` is implied by the parent join" — it is NOT implied by the join; it's only true if hierarchy links are same-tenant, which nothing enforces (see setParentCompany). Also note: `WHERE p.tenant_id = ...` with `sql` template — is `${tenantId}` parameterized? Drizzle's `sql` template parameterizes interpolated values — yes, `sql`...${value}``` becomes a bind param. OK, no injection.

Also the CTE only includes parents that HAVE children (INNER JOIN) — pre-existing behavior, not this change's concern.

**10. The guard's DB hit per request + N+1.** Every `/local/:id` request now does: guard query (1) + handler's own scoped query (e.g., `getCompanyById` again). Doubled latency on the hot read path. Acceptable for correctness; could cache the resolved company in `context` (e.g., `store.companyId`) — SHOULD (perf, optional). Not blocking.

**11. `onBeforeHandle` and Elysia lifecycle with `.use(authGuard)`** — the guard is registered on the controller instance after `.use(authGuard)`. In Elysia, `onBeforeHandle` added via chained `.onBeforeHandle` applies to routes defined... hmm, actually in Elysia, hooks added on an instance apply to all routes on that instance regardless of definition order relative to the hook? Elysia registers hooks on the instance; when the instance is later `.use`d into the app, the hooks apply to all routes of that instance. I believe Elysia's `onBeforeHandle` on an instance applies to all routes in that instance (it's not order-dependent like some frameworks). Actually — in Elysia, hooks must be defined BEFORE routes? Let me think. Elysia documentation: "hook must be registered before the route" — no wait. In Elysia, `app.onBeforeHandle(...)` applies to routes registered after it on the same instance? Hmm. Elysia's design: hooks are applied per-instance and apply to all routes in that instance when the instance is used. Actually I recall that in Elysia, lifecycle hooks apply to routes defined AFTER the hook in the same instance — no, I think Elysia hooks apply to the whole instance. Let me recall: Elysia's `onBeforeHandle` is scoped to the plugin instance and applies to all routes of that instance. From Elysia docs: "By default, hooks are scoped to the instance they're defined in and apply to all routes in that instance." Hmm, but there's a known gotcha that hooks defined after routes... I believe in Elysia, when you `.use(plugin)`, the plugin's hooks apply to all its routes regardless of order, because the plugin is a fully-formed Elysia instance and hooks are collected at registration. Actually the Elysia docs say: "Hooks registered in a plugin apply to routes in that plugin only" and I believe order within the instance doesn't matter — Elysia composes at `.use` time. Hmm, but actually there IS a documented behavior: in Elysia, `app.state`/`decorate` must be defined before routes that use them, but lifecycle hooks... The Elysia docs "Life Cycle" page: "hook must be registered before route registration to take effect"? I genuinely recall Elysia hooks apply regardless of order within an instance because routes are matched at request time via the compiled router with hook chains per route, and the hook chain is built when routes are added... If hooks are captured at route-definition time, then `.onBeforeHandle` defined AFTER some routes would not apply to them. In this file, the guard is defined FIRST (right after `.use(authGuard)`), before all routes. So even if order matters, it's fine here. Good — the guard is at the top. But worth noting: any route added ABOVE the guard in a future refactor... it's at the top, fine. No finding, or a tiny note.

Wait, actually let me double check the order in Appendix A: `.use(authGuard)` then the comment then `.onBeforeHandle(...)` then all routes. Yes, guard first. Good.

**12. `params` typing in the guard.** `(params as { id?: string } | undefined)?.id` — for routes like `/contacts/:contactId`, params.id is undefined → skip. For `/local/:id/place-supply-rules/:ruleId`, params.id is the company → guarded. OK.

But: **the guard runs for `/enrichment/:seasearcherId` routes** — params.id undefined → skip. Fine.

**13. Existence leak via guard ordering/timing?** The guard 404s foreign ids. But `POST /companies/import` returns another tenant's company (via dedupe) — leaks. `GET /by-seasearcher` leaks. Those are the two existence leaks. Also `searchCompaniesTypeahead`'s Seasearcher half is global — by design.

**14. `updateCompany` — `preferredInvoicingCompanyId`** — mentioned above. Also `updateCompany`'s `setFields` — does it whitelist fields? `OVERRIDABLE_FIELDS` and manualOverrides merging suggests care, but `preferredInvoicingCompanyId` handling not visible. The body schema allows it, so presumably it's written. SHOULD validate same-tenant.

**15. `deleteCompany(params.id)`** — unscoped service, guarded route. OK transitively. But `deleteCompanyAttachment(params.attachmentId)` — unguarded route (`/attachments/:attachmentId`), unscoped service — cross-tenant delete + file unlink. MUST (part of the child-resource finding).

**16. Test quality (Appendix E).**

- The 404 loop includes `/emails` twice — duplicate line, cosmetic.
- Tests don't cover: `/by-seasearcher/:seasearcherId` cross-tenant (the leak), `POST /import` dedupe cross-tenant, `/contacts/:contactId` etc. child routes, `setParentCompany` with foreign parentId, `updateCompany` with foreign `preferredInvoicingCompanyId`. SHOULD: add tests for those (or they'd fail, proving the holes).
- `expect(own.status).toBe(200)` — fine.
- The ghost-id test: `expect(ghost.status).toBe(404)` — good, indistinguishability pinned.
- The write test asserts `emails.length` toBe(0 — but seedBasics might create emails? They truncateAll in beforeEach and seedBasics creates tenant A + presumably a user; if seedBasics created companies with emails, the count would be off. They only inserted aCompany manually. Probably fine.
- Test 3 asserts created.status 200 — but the POST /local handler has no try/catch; if createCompany throws, 500. Fine.
- Test 4: `expect(groups.length).toBe(0)` — tenant B has no parents with children. OK.

**17. `getSessionTenant` — `findUserById` import from auth.service** — circular import risk? session-tracker imports activity.service, auth.service imports...? Can't verify. Skip or tiny note.

**18. The `onEntityView` hook skip for vessels** — `syncVesselFromSeasearcher(entityId)` runs BEFORE the tenant check? Look at the diff:

```ts
const tenantId = await getSessionTenant(socketId);
if (!tenantId) return;
if (entityType === 'Vessel') {
  const synced = await syncVesselFromSeasearcher(entityId);
```
The tenant check gates both. Vessel sync is unscoped but vessels are global maritime data — acceptable, maybe note.

**19. One more under-block: `/local/:id/inquiry-data`** — guarded (params.id). Its queries are inline `db.select...where(eq(companyEmails.counterpartyId, params.id))` — fine given guard.

**20. `getSupplyPortsForCompany(params.id)`** — from lli.service; guarded via id. Fine.

**21. `getUserCompanyAccess(auth.sub)`** — `/own` route — keyed by user, user belongs to tenant. Fine.

**22. `listCompanies` sort fields** — `sortBy` from query passed to... presumably a whitelist in service (not visible). Out of scope.

**23. Guard returns 401 when `!auth?.tenantId`** — but authGuard presumably 401s already. If a user legitimately has no tenantId (shouldn't happen — tenant_id NOT NULL on users presumably), they'd get 401 on all :id routes. Fine.

**24. Missing: `updateCompanyTypes` / `updateCompanySegments` / `updateCompanyResponsibleUser` / `deleteCompany` / `setParentCompany` / `removeParentCompany` / place-supply-rule functions / contact/email/office/attachment functions were not given tenantId params.** The author's stated principle: "made a REQUIRED parameter so the compiler enumerated every caller rather than letting any silently default." Applied only to some. The write functions relying on the guard are transitively safe for the anchor id, but the principle is inconsistently applied — and the child-resource routes prove the guard alone is insufficient. The strongest recommendation: either thread tenantId through all mutation functions (defense in depth) or extend the guard to child-id routes via a join lookup. At minimum, MUST fix the child routes (contacts/emails/offices/attachments by child id) and `setParentCompany`'s parentId.

Let me also double-check `keepMineValue(params.id, body.field, body.seasearcherValue, auth.tenantId)` — signature `(companyId, field, seasearcherValue, tenantId)` — matches. `acceptSeasearcherValue(params.id, body.field, auth.tenantId)` — matches `(companyId, field, tenantId)`. OK.

`syncCompanyFromSeaseasearcher(params.id, auth.tenantId)` — matches. OK.

**25. `getCompanyBySeasearcherId` used anywhere else?** In the controller: `/by-seasearcher/:seasearcherId` and inside import. Both problematic.

**26. `searchCompaniesTypeahead`** — the local half scoped. But then: `const localSeasearcherIds = new Set(...)` — presumably to dedupe Seasearcher results already imported locally. If local is scoped, Seasearcher results for companies imported by ANOTHER tenant will still show as "not imported" — fine, no leak, and arguably correct (they're not imported in YOUR tenant). OK.

**27. `importCompanyByName`** — delegates to importCompanyFromSeasearcher with tenantId — inherits the dedupe bug.

**28. 404 body shape** — guard returns `{ success: false, data: null, message: 'Company not found' }` with set.status=404. Consistent with module conventions. OK.

**29. Performance of guard on `/local/:id/place-supply-rules/:ruleId/reapply` etc.** — one extra query. Fine.

**30. `getSessionTenant` returns user's tenant — but what if the socket's user was deleted between connect and view?** findUserById → null → skip. Fail-closed. Good.

**31. Is skipping sync on unknown tenant observable/harmful?** The client asked "is skipping the sync when the tenant is unknown the right failure mode?" — Yes fail-closed is right, but silent. SHOULD log. Also the socket could be for a user whose session is in `sessions` but userId missing → null → skip. Fine.

Now, is there anything about the guard that OVER-blocks? Consider `/companies/local/:id` where id is a valid company of the caller — guard passes. Consider future route `/companies/users/:id` — would 404. The comment documents the contract. Acceptable. One real over-block-ish concern: the guard applies to the whole instance including any route added by a future `.use` of this instance by another module? `companiesController` is exported and presumably `.use`d into the app; if another plugin is `.use`d INTO companiesController (not shown), its routes with `:id` would be guarded. Not shown. Skip.

Also: **the guard does `await companyBelongsToTenant(id, ...)` on every request with params.id — including `/local/:id/sync` which then does `getCompanyById(id, tenantId)` — 2 queries, then sync. Fine.**

**Verdict formation:**

MUST findings:
1. `GET /companies/by-seasearcher/:seasearcherId` → `getCompanyBySeasearcherId` unscoped — cross-tenant read of full company record + existence oracle. (Under-block; question 1/3.)
2. `importCompanyFromSeasearcher` dedupe via unscoped `getCompanyBySeasearcherId` — returns another tenant's company on `POST /companies/import` (and `/import-by-name`); leak + functional bug (importing tenant never gets its own copy).
3. Child-resource routes bypass the guard: `/contacts/:contactId` (PATCH/DELETE), `/emails/:emailId` (PATCH/DELETE), `/offices/:officeId` (PATCH/DELETE), `/attachments/:attachmentId` (DELETE) — services take only the child id, no tenant scope → cross-