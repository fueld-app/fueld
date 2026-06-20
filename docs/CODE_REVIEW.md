# Fueld — Code Review Report

**Date:** 2026-06-20
**Scope:** Bun JS API (`apps/api/src`, ~152 TS files) + Angular web app (`apps/web/src`, ~241 files). Astro marketing site excluded.
**Reviewer:** pi coding agent (API core reviewed directly; API modules + Angular app reviewed via 6 parallel `worker` subagents on `ollama-cloud/glm-5.2`, disjoint file sets).
**Methodology:** Medium-depth. Files were read in full or via map/signatures + targeted section reads; the whole codebase was also pattern-scanned for systemic issue classes (SQL injection, XSS/sanitization bypass, empty catches, subscription/timer leaks, secret logging, `as any` density, dead code). High-confidence, low-risk bugs were fixed inline; larger/ambiguous/design-level issues are report-only.

## Overall

The codebase is well-structured and professionally written. Authentication is a strong, modern stack: Argon2id passwords, JWT dual-token (access/refresh), TOTP, WebAuthn passkeys, AES-256-GCM credential encryption, and HMAC-signed OAuth state. Controllers consistently separate from services, drizzle queries are parameterized (very low SQL-injection surface), and the Angular app uses standalone components, signals, OnPush, and mostly-correct subscription cleanup.

The most serious findings are **four path-traversal vectors** in admin/file-handling (three fixed inline, one report-only), a **JWT secret fallback to a hardcoded dev value with no production assertion**, and a **dead shell-injection-prone helper**. A real **inventory balance double-counting bug**, an **autosave feedback loop**, and several **silent-error / unhandled-rejection** paths were found and (where high-confidence) fixed. Maintainability is dragged down by substantial **dead/duplicate code** (an unused `report-delivery.service.ts`, an unused `document-pdf-*` family, an unused `orders` split-file set, dead `vessel-detail` store+tabs and `llm-page.store.ts`, and a ~2500-line `llm.controller.ts` duplicating `llm.service.ts`).

**Inline fixes: 20** (1 by the orchestrator + 19 by subagents), plus 1 pre-existing path-traversal fix already in the working tree. All other findings are report-only.

## Follow-up Status (post-review)

The following report-only findings have since been fixed and shipped to `main` (each passed CI Tests + Deploy):

- **`20c3750c`** — JWT production fail-fast assertion (`jwt.setup.ts`, closes the critical dev-secret fallback); removed 18 dead-code files (`report-delivery.service.ts`, the `document-pdf-*` family, the dead `vessel-detail` store + 3 tabs + 7 components, `llm-page.store.ts`, `settings-page.component.ts.deprecated`) and the unused shell-injection-prone `downloadModel` helper (`llm.service.ts`). (Kept `order-utils.service`, which is live via `company-crud.service.ts`.)
- **`b696e799`** — fixed the inventory balance double-count (`inventory.service.ts` `getBalance.earliestAvailableAt` now projects the timeline from 0 and returns the first *future* recovery) + removed a dead empty loop; changed the inventory/transfers privilege helpers to return **403** instead of throwing → 500; deleted 7 dead `order-*.service` split files.
- **`7a05a584`** — broke the order-detail autosave feedback loop (`_autosavePaused` guard); added `t.Object` query schemas to all 6 dashboard routes; added `Number.isFinite` guards to `page`/`limit` parsing in vessels / risk-monitoring / vessel-sanctions controllers.
- **`0a313661`** — XSS hardening: escaped user-controllable values in invite/reset email HTML (`lib/email.ts`), report email HTML (`reports.service.ts`), and the Leaflet vessel popup (`vessel-detail-page.component.ts`); sanitized the `Content-Disposition` filename in `port-documentation.controller.ts`.
- **`03aa8709`** — validated the order payment `amount` (finite, non-negative → 400) before insert; added `minLength:1` on the vessel-company `role` fields (full role-catalog validation deferred — roles are admin-configurable).
- **`81454086`** — hashed refresh tokens at rest (`auth.service.ts`/`auth.controller.ts`, backward-compatible: existing sessions keep working, rotate to hashed on next refresh); encrypted the SSO client secret via `integration_credentials` and cleared it from plaintext `tenant.settings` (`security.controller.ts`, backward-compatible legacy fallback).
- **`9e891b9a`** — sandboxed the send-inquiry email preview: replaced `[innerHTML]="previewEmailHtml()"` (bypassSecurityTrustHtml -> app DOM) with a `<iframe [srcdoc] sandbox="">` so active content in the user-composed email body cannot execute in the app context. Verified by a new Playwright e2e regression (`e2e/trading/send-inquiry-preview.spec.ts`) asserting a non-empty `srcdoc` and `sandbox=""` (no `allow-scripts`); 4/4 trading inquiry specs pass.

### Still open (report-only, need a product / deployment decision)
- `auth.guard.ts` IP allowlist fail-open + IPv4-only CIDR matching (warning).
- `microsoft-oauth.service.ts` `getStateSigningKey` weak fallback (unreachable in prod while `DATABASE_URL` is set) and `validateReturnUrl` allowing any `https` origin (warning).
- `company.service.ts:459` raw-SQL `catKey` interpolation with manual escaping (warning).
- `admin/llm.controller.ts` model-install filename arbitrary file write (warning).
- `admin/backup.service.ts` `pg_dump`/`psql` stderr may echo the `DATABASE_URL` connection string (warning).
- `core/websocket/websocket.service.ts` JWT in WS URL query; `core/auth/auth.service.ts` tokens in `localStorage`; `files-card.component.ts` `window.open` bypasses the auth interceptor (warning, design-level).
- Various `info`: geoip `ip-api` path handling, `lli.client`/`integrations.service` upstream error leakage, LIKE wildcard injection, vessel `role` full catalog validation, `send-inquiry-modal.utils` non-DOM HTML fallback, `order-financial.service.ts` dead branch, `parseInt` radix.

### Pre-existing (not caused by this review)
- `inventory.transfers.test.ts` "DELIVERED transfer records both source TRANSFER_OUT and destination TRANSFER_IN" fails on clean `main` (reproduces without any review change) and is not run by CI scripts — separate transfer-delivery bug.

## Coverage

The full in-scope set was reviewed (API core read directly; API domain modules and the Angular app covered by 6 parallel worker subagents over disjoint file sets). Large files were read via map/signatures with targeted full reads of suspect sections. No in-scope module was skipped.

## Inline Fixes Applied

| # | File | Line (approx) | Severity | Change |
|---|---|---|---|---|
| 0 | `apps/api/src/index.ts` | ~250, 468-470 | critical | `/uploads/{avatars,logos,attachments}` path-traversal guard (`serveUpload()`) — **pre-existing** in working tree, documented only. |
| 1 | `apps/api/src/modules/auth/microsoft-oauth.service.ts` | ~103 | warning | Replaced timing-unsafe `sig !== expectedSig` HMAC compare with `timingSafeEqual` + length guard. |
| 2 | `apps/api/src/modules/admin/backup.controller.ts` | 22 | critical | `writeUploadedFile` used user-controlled `file.name` in `path.join`; sanitized with `basename()` + dotfile fallback. |
| 3 | `apps/api/src/modules/admin/llm.controller.ts` | 2441,2483,2506 | critical | `/admin/llm/prompts/:id` GET/PUT/DELETE passed `params.id` straight to file ops; added `isValidPromptSlug` validation (rejects `../../`). |
| 4 | `apps/api/src/modules/whatsapp/whatsapp.service.ts` | 247 | warning | Fire-and-forget `db.update(...).then(()=>{})` had no `.catch`; added catch + warn log. |
| 5 | `apps/api/src/modules/orders/orders.controller.ts` | 716 | warning | Attachment upload took file extension from user filename with no allowlist (stored-XSS via spoofed MIME); added extension allowlist. |
| 6 | `apps/web/src/app/core/auth/auth.service.ts` | 191 | warning | `enable2fa()` built `Bearer ${token}` without the null guard other 2FA methods have; added guard. |
| 7 | `apps/web/.../company-detail-page.component.ts` | 218 | warning | `route.paramMap.subscribe(...)` never stored/unsubscribed; added `routeSub` + `ngOnDestroy` cleanup. |
| 8 | `apps/web/.../integrations-page.component.ts` | 76 | warning | Dead `route.queryParams.subscribe(...)` (empty body) + leak; removed subscription + unused `ActivatedRoute`. |
| 9 | `apps/web/.../integrations-shell.component.ts` | 82 | warning | `route.queryParams.subscribe(...)` never unsubscribed; added `OnDestroy` + `routeSub` cleanup. |
| 10 | `apps/web/.../customer-credit-page.component.ts` | 428 | warning | `searchTimer` debounce never cleared on destroy; added `OnDestroy` + `clearTimeout`. |
| 11 | `apps/web/.../vessel-detail-page.component.ts` | 1503 | warning | `companySearchTimeout` debounce not cleared in `ngOnDestroy`; added `clearTimeout`. |
| 12 | `apps/web/.../vessel-detail-page.component.ts` | 1949 | warning | `loadVesselRiskImpacts` fire-and-forget with no `catch` → unhandled rejection; added catch + reset to `[]`. |
| 13 | `apps/web/.../order-communication.service.ts` | 315 | warning | `blobToBase64` used `onloadend` (fires on error too) → `result.split(',')` threw; changed to `onload`. |
| 14 | `apps/web/.../last-edited-badge.component.ts` | 64 | warning | `setInterval` (60s) never cleared on destroy; added `OnDestroy` + `clearInterval`. |
| 15 | `apps/web/.../send-inquiry-modal.component.ts` | 1482 | warning | `addSupplierDebounce` setTimeout never cleared on destroy; added `OnDestroy` + `clearTimeout`. |
| 16 | `apps/web/.../send-inquiry-modal.component.ts` | 1195 | warning | `navigator.clipboard.writeText(...).then(...)` had no `.catch`; added catch (ignore clipboard denial). |
| 17 | `apps/web/.../internal-transfer-sides.component.ts` | 220 | warning | `updateField` optimistic update with no try/catch; on HTTP failure local state diverged; added try/catch + revert. |
| 18 | `apps/web/.../internal-transfer-sides.component.ts` | 242 | warning | `finalize` try/finally with no catch → unhandled rejection; added catch. |
| 19 | `apps/web/.../internal-transfer-sides.component.ts` | 257 | warning | `reopen` try/finally with no catch → unhandled rejection; added catch. |
| 20 | `apps/web/.../inquiries-list-page.component.ts` | 607 | warning | `searchTimeout` debounce never cleared in `ngOnDestroy`; added `clearTimeout`. |

All other findings below are **report-only**.

## Findings by Aspect

### 1. Code Quality & Best Practices

- [REPORTED][info] `apps/api/src/index.ts` — WebSocket handler uses `(ws.data as any)` pervasively; `onAfterResponse` cast `as any`.
- [REPORTED][info] Highest `as any` density: `apps/api/src/modules/auth/auth-routes.service.ts` (26), `apps/api/src/modules/admin/settings.service.ts` (26), `apps/api/src/modules/admin/settings.controller.ts` (18), `apps/api/src/index.ts` (17). Route handlers accept `body: any` and call typed services via `(serviceFn as any)(body)`, defeating compile-time input validation.
- [REPORTED][info] `apps/api/src/modules/admin/llm.controller.ts` (~2536 lines) duplicates a large amount of logic already in `llm.service.ts` (install/build/download/benchmark helpers). Two parallel copies of the install pipeline is a consistency risk — consolidate.
- [REPORTED][info] `apps/api/src/modules/reports/report-delivery.service.ts` — entire file is dead/duplicate (re-defines `buildSummaryEmailHtml`, `runScheduleForTenant`, `startReportsScheduleJob` already in `reports.service.ts`, which is the one `index.ts` imports). Delete or fold in.
- [REPORTED][info] `apps/api/src/modules/documents/document-pdf-{generators,invoice,offer,utils}.service.ts` — unused `document-pdf-*` family (barrel never imported; active generators live in `document.service.ts`). Hosts the duplicate broken logo code. Remove or consolidate.
- [REPORTED][info] `apps/api/src/modules/orders/` — split files (`order-crud.service.ts`, `order-items.service.ts`, `order-status.service.ts`, `order-suppliers.service.ts`, `order-utils.service.ts`, `order-payments.service.ts`, `order-attachments.service.ts`, `order-activity.service.ts`) are not imported by `orders.controller.ts` (which uses the `orders.service.ts` monolith). Refactor-in-progress that has diverged; finish the split or delete the unused files.
- [REPORTED][info] `apps/web/.../vessel-detail/` — `vessel-detail.store.ts` + `tabs/*` + several `components/*` are dead/orphaned (~1500+ lines); store has no provider, tabs inject it (would throw if instantiated). Incomplete refactor from store-based to page-based. Delete or complete.
- [REPORTED][info] `apps/web/.../admin/pages/llm/llm-page.store.ts` — dead `LlmPageStore` duplicating `llm-page.component.ts`.
- [REPORTED][info] `apps/web/.../admin/pages/users/users-page.component.ts:802` + `users-page.store.ts:126` — both component and store independently subscribe to the same `admin:sessions` WS message and maintain duplicate `sessions` state.
- [REPORTED][info] `apps/web/.../admin/pages/settings/settings-page.component.ts.deprecated` — deprecated file left in repo (dead code); remove.
- [REPORTED][info] `apps/web/.../place-detail/components/place-map-card/place-map-card.component.ts:77` — leftover debug `console.log('[PlaceMapCard] ngOnDestroy', new Error().stack)`; remove.
- [REPORTED][info] `apps/api/src/db/seed.ts` — logs `password123` for all seeded users (acceptable for a dev seed script; never run in production).
- [REPORTED][info] `apps/api/src/modules/risk-monitoring/risk-monitoring.service.ts:527` — stale comment "need 2 approvals" while code uses configurable `requiredApprovals` (default 1).
- [REPORTED][info] `apps/web/.../credit/components/credit-application-modal.component.ts:170` — uses `ngOnChanges()` without `implements OnChanges` (works, style nit).
- [REPORTED][info] `apps/web/.../two-factor-verify-page.component.ts:81` — `router.getCurrentNavigation()` in `ngOnInit` always returns `null` (dead path; falls back to `history.state`).

### 2. Potential Bugs & Unhandled Edge Cases

- [REPORTED][warning] `apps/api/src/modules/inventory/inventory.service.ts:783-790` — `getBalance` `earliestAvailableAt` **double-counts on-hand stock**: `running` is initialized to `onHand` (already the sum of all movements, line 739) then walks `events` which also include every movement delta. Fix: `let running = 0;` (matches the `checkAvailability` pattern below which uses `let balance = 0`). Needs test coverage before changing.
- [REPORTED][warning] `apps/api/src/modules/inventory/inventory.controller.ts:56` and `transfers.controller.ts:27,33` — `requirePrivileged`/`requireOpsPrivileged`/`requireFinanceOrOps` throw an `Error` without `set.status = 403`, so forbidden requests return HTTP 500 instead of 403. (Other controllers correctly set 403.)
- [REPORTED][warning] `apps/api/src/modules/inventory/transfers.service.ts:330-335` — `updateTransferSide` returns a partial row (`{ id, status }` only) on the FINALIZED branch; callers receive an object missing `orderId`, `kind`, `companyName`, `currency`, etc. Return the full side DTO.
- [REPORTED][warning] `apps/api/src/modules/dashboard/dashboard.controller.ts:18-95` — dashboard routes cast `query as {...}` with no `t.Object` schema; invalid `from`/`to` date strings propagate to `new Date(\`${from}T00:00:00\`)` → `Invalid Date` silently matches nothing. Add a query schema + date validation.
- [REPORTED][warning] `apps/api/src/modules/orders/orders.controller.ts:585-603` and `orders.service.ts:1690-1730` — `createOrderPayment` inserts `input.amount` (string) into a numeric column with no validation; a non-numeric amount throws a Postgres cast error surfaced as a generic "Failed to add payment". Validate finite non-negative number → 400.
- [REPORTED][warning] `apps/web/.../order-detail-page.component.ts:851` — autosave `effect` watches `order()`/`itemRows()`/`orderSuppliers()`, but `performAutoSave()` → `saveOrder()` → `reloadOrderSuppliers()` does `orderSuppliers.set(res.data)` (new array ref every time) and `rebindTemporaryItemSupplierIds()` mutates `itemRows`, both re-triggering the effect → continuous autosave loop (~every 1.5s PUT + supplier-sync + reload) while the page is open. Track a dirty/changeVersion signal instead.
- [REPORTED][warning] `apps/web/.../admin/pages/llm/llm-page.component.ts:2554` — `installModel` poll loop runs up to 12h with no cancellation on destroy; keeps polling/writing signals to a destroyed component. Benchmark sweeps have the same pattern. Add a `destroyed`/Abort guard.
- [REPORTED][warning] `apps/web/.../admin/pages/security/security-page.component.ts:586` — `saveSso`/`save2FA`/`savePasskey`/`saveSession` `catch {}` silently swallows errors with no user feedback. Surface an error toast.
- [REPORTED][info] `apps/api/src/modules/credit/credit-applications.service.ts:55-58` — dead migration branch (`raw.notifyPush` can never be `undefined` because `DEFAULT_SETTINGS` sets it `true`).
- [REPORTED][info] `apps/api/src/modules/inventory/inventory.service.ts:723-728` — empty `for (const e of events)` loop body is just a comment (dead code).
- [REPORTED][info] `apps/web/.../order-detail-page.component.ts:961` — `loadSupplierContext(orderId())` is listed twice in the same `Promise.all` in `loadOrder` → duplicate API request on every load.
- [REPORTED][info] `apps/web/.../order-port-documentation.service.ts:238` — `URL.revokeObjectURL(objectUrl)` on next macrotask immediately after `anchor.click()` can race with download initiation; use a longer delay (e.g. 1000ms).
- [REPORTED][info] `apps/web/.../reports-page.store.ts:608` — `formatCurrency` `parseFloat(value)` without NaN guard → `$NaN` for non-numeric input. Add `Number.isFinite` fallback.
- [REPORTED][info] `apps/web/.../dashboard-redirect.component.ts:29` — `res.data.dashboards[role]` without guarding `res.data.dashboards`; use `res.data?.dashboards?.[role]`.

### 3. Performance

- [REPORTED][warning] `apps/api/src/modules/vessel-sanctions/vessel-sanctions.service.ts:141` — `runVesselSanctionCheckForTenant` selects ALL vessels (not tenant-scoped) and inserts a `vesselSanctionChecks` row tagged with the calling `tenantId` for every one. In multi-tenant deploys this creates N(tenants)×M(vessels) rows per run and re-scans the global fleet once per tenant. Check once globally and share results, or scope vessels by tenant.
- [REPORTED][info] `apps/web/.../customer-credit-page.component.ts:704` — `toggleFromDelivery`/`toggleQualified` each call full `loadData()` (re-fetch all credit lines + companies + currencies + overrides) instead of a targeted in-place update from the PATCH response.
- [REPORTED][info] `apps/web/.../company-detail-page.component.ts:217` (and `place-detail-page.component.ts:114`) — `loadCompany`/`loadPlace` is called once from `route.snapshot.paramMap` AND again from the `route.paramMap.subscribe(...)` emission (paramMap emits current value on subscribe) → double load (+ ~13 sub-loads) on initial navigation. Drop the snapshot call or guard reload-while-loading.
- [REPORTED][info] `apps/api/src/index.ts:316,333` + several modules — `setInterval` background jobs with no explicit cleanup (acceptable for a long-running server; handles stored where relevant).

### 4. Readability & Maintainability

- [REPORTED][info] Very large files concentrate complexity: `platts-parser.service.ts` (3277L), `document.service.ts` (3048L), `llm-page.component.ts` (2916L), `company.service.ts` (2341L), `settings.controller.ts` (2296L), `vessel-detail-page.component.ts` (2274L), `reports.service.ts` (2263L), `documents.controller.ts` (2147L), `orders.service.ts` (2123L), `settings.service.ts` (1968L), `order-detail-page.component.ts` (2470L), `auth.controller.ts` (1626L). Split the biggest services/controllers along feature boundaries.
- [REPORTED][info] Angular subscription discipline is good overall (most components assign subs and unsubscribe in `ngOnDestroy`, or use `takeUntil(this.destroy$)`/`DestroyRef`). The remaining un-cleaned subscribes/timers were fixed inline (see fixes #7-#11, #14-#16, #20); a few `searchTimer` instances remain (see #5 No-issues-adjacent notes: `supplier-credit-page.component.ts:367`, `our-companies-page.component.ts:460`). Standardize on `takeUntilDestroyed()`/`DestroyRef`.
- [REPORTED][info] `apps/api/src/modules/companies/company-relationships.service.ts:82-86` — variable named `childSeasearcherIds` actually holds child *company* IDs; misleading. Rename `childCompanyIds`.
- [REPORTED][info] `apps/api/src/modules/orders/order-suppliers.service.ts:56,165` — mid-file imports (hoist OK but hurts readability); `ordersTable` import is unused (dead).
- [REPORTED][info] `parseInt(query.page)`/`parseInt(query.limit)` without radix in `orders.controller.ts:68-69`, `companies.controller.ts:113-114`, `credit.controller.ts:30-31`, `credit-applications.controller.ts:79-80`. Pass `10` as radix.
- [REPORTED][info] `parseInt(query.limit)`/`Number(query.page)` without NaN guards in `risk-monitoring.controller.ts:70`, `vessels.controller.ts:61-62`, `vessel-sanctions.controller.ts:69-70`. Guard with `Number.isFinite` + default.
- [REPORTED][info] `apps/web/.../order-financial.service.ts:175,193` — duplicate unreachable `if (normalizedId && companies.some(...)) return normalizedId;` after an identical earlier check. Remove.
- [REPORTED][info] `apps/web/.../llm-page.component.ts:2536` (and `:2869`, `:2893`, settings pages) — failure messages read via `(res as any).error ?? '...'` while `ApiResponse` exposes `message`. Server `message` is ignored when only `message` is present. Standardize on `res.message`.
- [REPORTED][info] `apps/api/src/modules/admin/email-settings.service.ts:154` — `renderTemplate` uses `(vars as any)[key] ?? ''`, bypassing the `TemplateVariables` type.

### 5. Security

**Critical / high**
- [FIXED-PRE-EXISTING][critical] `apps/api/src/index.ts` — `/uploads/{avatars,logos,attachments}/:filename` path traversal (unvalidated `filename`). Already guarded by `serveUpload()` in the working tree.
- [FIXED][critical] `apps/api/src/modules/admin/backup.controller.ts:22` — backup upload wrote `path.join(dir, file.name)` with user-controlled `file.name` → path traversal outside the temp dir. Sanitized with `basename()`.
- [FIXED][critical] `apps/api/src/modules/admin/llm.controller.ts:2441,2483,2506` — `/admin/llm/prompts/:id` passed `params.id` to `join(promptsDir, \`${id}.md\`)` with no slug validation (unlike `createPrompt`) → admin could read/overwrite/delete `.md` outside prompts dir. Added `isValidPromptSlug` validation.
- [FIXED][warning] `apps/api/src/modules/auth/microsoft-oauth.service.ts:~103` — timing-unsafe HMAC state-signature compare → `timingSafeEqual` + length guard.
- [FIXED][warning] `apps/api/src/modules/orders/orders.controller.ts:716` — attachment upload trusted user filename extension while only validating MIME (spoofable) → stored-XSS via `.html` attachment served inline. Added extension allowlist.
- [REPORTED][critical] `apps/api/src/modules/auth/jwt.setup.ts:10,16` — `jwtAccess`/`jwtRefresh` secret falls back to hardcoded `'dev-access-secret'`/`'dev-refresh-secret'` with **no production assertion** (unlike `crypto.ts`). In production without the env vars, tokens are forgeable. Fail fast in production.
- [REPORTED][critical] `apps/api/src/modules/admin/llm.service.ts:884` (`downloadModel`) — builds a shell command interpolating `modelUrl` into `bash -c '... curl ... "${modelUrl}"'`; a URL with shell metacharacters would execute. Exported but currently unused (controller uses safe `fetch`). Remove or rewrite with `fetch` + `Bun.file().writer()`.
- [REPORTED][warning] `apps/api/src/modules/admin/llm.controller.ts:2260` (`POST /admin/llm/models/install`) — `body.filename` (max 200 chars, no format validation) used in `join(paths.modelDir, partFilename)` → `../../etc/foo.gguf` writes outside the model dir (admin-only arbitrary file write). Validate `/^[A-Za-z0-9._-]+\.gguf$/`.
- [REPORTED][warning] `apps/api/src/modules/admin/security.controller.ts:103` — `body.ssoClientSecret` stored **plaintext** in `tenant.settings` JSONB (other integration secrets are AES-encrypted). Migrate to encrypted `integration_credentials`.
- [REPORTED][warning] `apps/api/src/modules/admin/backup.service.ts:334,353` — `pg_dump`/`psql` stderr (which can echo the `DATABASE_URL` with the DB password) is thrown into the API response body. Sanitize/redact the connection string.
- [REPORTED][warning] `apps/api/src/modules/auth/auth.guard.ts` — IP allowlist is **fail-open**: non-"not allowed" errors from `getUserAllowedIps` are swallowed and the request is allowed through. Fail closed on fetch errors.
- [REPORTED][warning] `apps/api/src/modules/auth/auth.guard.ts` — `ipMatchesCidr`/`ipToNumber` are IPv4-only; IPv6 client IPs / IPv6 CIDR entries never match (IPv6 users with restrictions get 403).
- [REPORTED][warning] `apps/api/src/modules/auth/auth.service.ts:storeRefreshToken` — refresh tokens stored **plaintext** in `users.refreshToken`. Hash at rest (the Microsoft refresh token is correctly encrypted; apply the same).
- [REPORTED][warning] `apps/api/src/modules/auth/microsoft-oauth.service.ts:getStateSigningKey` — falls back to `'fueld-oauth-state-fallback'` when no env. Add a production assertion.
- [REPORTED][warning] `apps/api/src/modules/auth/microsoft-oauth.service.ts:validateReturnUrl` — allows any `https:` URL as `returnUrl` (not app-origin-restricted). Safe today (returnUrl is server-generated + HMAC-signed) but tighten for defense-in-depth against open redirect.
- [REPORTED][warning] `apps/api/src/lib/email.ts` (`sendInviteEmail`/`sendPasswordResetEmail`) — user-controllable `invitedByName`/`role` interpolated into HTML email without escaping → HTML injection. HTML-escape interpolated values.
- [REPORTED][warning] `apps/api/src/modules/companies/company.service.ts:459-460` — raw SQL `sql.raw(\`'${catKey.replace(/'/g, "''")}'\`)` interpolates user-controlled segment key with manual escaping. Parameterize the jsonb access key instead of `sql.raw`.
- [REPORTED][warning] `apps/api/src/modules/port-documentation/port-documentation.controller.ts:179,309` — `Content-Disposition: filename="${fileMeta.fileName}"` uses the raw stored original filename; `"`/CRLF could break/inject the header. Sanitize or use RFC 5987 encoding.
- [REPORTED][warning] `apps/web/.../send-inquiry-modal.component.ts:842` — `bypassSecurityTrustHtml(renderEmailPreview(this.htmlBody(), supplier))` bound via `[innerHTML]` (line 647) into the DOM; active content in user-composed email body (`<img onerror>`, `<svg onload>`) can execute. Sanitize before rendering (or sandbox in an iframe).
- [REPORTED][warning] `apps/web/.../send-email-modal.component.ts:780,949`, `inquiry-body-editor.component.ts:95`, `send-inquiry-modal.utils.ts:142` — `editor.innerHTML = html` rich-text editors; ensure source HTML is sanitized before insertion.
- [REPORTED][warning] `apps/web/.../vessel-detail-page.component.ts:1463` (duplicated in `vessel-position-map-card.component.ts:99`) — Leaflet popup HTML interpolates server-controlled `vesselName`/`dest` without escaping → stored XSS in the map popup. Escape or use `textContent`.
- [REPORTED][warning] `apps/web/.../core/auth/auth.service.ts:138-139` — access/refresh tokens persisted in `localStorage` (XSS-exposed; refresh token enables long-lived takeover). Consider `httpOnly` cookies for refresh / in-memory access.
- [REPORTED][warning] `apps/web/.../core/websocket/websocket.service.ts:148` — JWT access token passed as `?token=...` in the WS URL (exposed in server/proxy access logs + browser history). Use a short-lived one-time WS ticket, or ensure access logs redact `token`.
- [REPORTED][warning] `apps/web/.../company-detail/components/files-card/files-card.component.ts:143` — attachment download via `window.open(\`${API}/.../${a.id}\`)` bypasses the Angular `HttpClient` interceptor (no `Authorization` header) → 401 if the route requires Bearer. Fetch via `HttpClient` as a blob, or confirm cookie/query auth.
- [REPORTED][info] `apps/api/src/modules/auth/auth.guard.ts` — `extractClientIp` trusts forwarded headers; ensure deployment is behind a trusted reverse proxy.
- [REPORTED][info] `apps/api/src/modules/activity/geoip.ts:120-128` — `http://ip-api.com/json/${normalized}` with `normalized` not validated as an IP; a malicious `X-Forwarded-For` with `/`/`?` could manipulate the request path (low impact). Validate against an IP regex.
- [REPORTED][info] `apps/api/src/modules/lloyds/lli.client.ts:73` and `apps/api/src/modules/admin/integrations.service.ts:181` — upstream response `text` embedded in thrown errors that propagate to the API response. Sanitize/truncate.
- [REPORTED][info] `apps/api/src/modules/risk-monitoring/risk-monitoring.service.ts:298-303` and `apps/api/src/modules/vessels/vessel-crud.service.ts:51-53` — `ilike(col, \`%${name}%\`)` allows LIKE wildcard injection (over-broad matches). Escape `%`/`_`.
- [REPORTED][info] `apps/api/src/modules/vessels/vessels.controller.ts:516,554` — `body.role as VesselCompanyRole` casts a `t.String()` field without union validation → arbitrary role strings persisted. Use `t.Union([t.Literal(...), ...])`.
- [REPORTED][info] `apps/web/.../send-inquiry-modal.utils.ts:134` — `upsertMetadataRowInHtml` (non-DOM fallback) interpolates `label`/`trimmedValue` into HTML unescaped (currently date strings; low risk). Escape.

## Verification

- **API typecheck** (`cd apps/api && bun run typecheck` → `tsc --noEmit`): **PASS** (exit 0) after all inline fixes.
- **Web typecheck** (`cd apps/web && bunx tsc --noEmit -p tsconfig.json`): **PASS** (exit 0) after all inline fixes.
- **Unit tests (DB-free subset):** `password.service`, `totp.service`, `platts-parser.service`, `rfq.service`, `inquiry.utils`, `packages/types` → **44 pass / 0 fail**. The 20 inline fixes introduced no regressions.
- **Pre-existing failures (not caused by this review):** `apps/api/tests/document.service.formatting.test.ts` has 15 failures due to an incomplete `db` mock (`db.select(...).from(tenants).limit is not a function`), unrelated to any review change.
- **Integration suite (78 files):** **not run** — it targets and mutates a live Postgres `fueld_test` database (listening on localhost:5432). The inline fixes are small, surgical, and typecheck-clean; running the full integration suite was judged out of scope for a review verification.

## Modules With No Notable Issues

API: `lib/crypto.ts`, `lib/web-search.ts`, `lib/llm.ts`, `utils/client-ip.ts`, `utils/timezone.ts`, `auth/password.service.ts`, `auth/o365.service.ts`, `auth/totp.service.ts`, `auth/passkey.service.ts`, `orders/order-financing.ts`, `orders/order-activity.service.ts`, `orders/order.types.ts`, `orders/order-attachments.service.ts`, `orders/order-payments.service.ts`, `orders/order-items.service.ts`, `orders/order-status.service.ts`, `orders/order-utils.service.ts`, `orders/order-crud.service.ts`, `companies/company-attachments.service.ts`, `companies/company-contacts.service.ts`, `companies/company-crud.service.ts`, `companies/company.types.ts`, `comments/comments.service.ts`, `comments/comments.controller.ts`, `credit/credit.service.ts`, `credit/credit.controller.ts`, `credit/credit-notifications.ts`, `activity/activity-diff.ts`, `activity/activity.controller.ts`, `activity/activity.service.ts`, `activity/session-tracker.ts`, `dashboard/dashboard.service.ts`, `rfq/rfq.service.ts`, `rfq/rfq.controller.ts`, `prices/price.service.ts`, `push/*`, `quickbooks/quickbooks.service.ts`, `lloyds/lli-vessel.service.ts`, `documents/verify.controller.ts`, `platts/platts.service.ts` (upload/parse), `admin/backup-state.ts`, `admin/llm.types.ts`, `admin/email-settings.service.ts`, `vessels/vessel.types.ts`, `vessels/vessel-companies.service.ts`, `vessels/vessel-seasearcher.service.ts`, `vessel-sanctions/tankertrackers.client.ts`, `vessel-sanctions/vessel-sanctions.controller.ts`, `whatsapp/rfq-parser.ts`, `whatsapp/whatsapp.controller.ts`.

Web: `shared/components/pdf-preview-modal/*`, `order-detail/components/*`, `order-detail/services/*` (except items noted), `order-detail-page.component.html`, `customer-credit.types.ts`, `companies-settings-page.component.ts`, `app.config.ts`, `app.routes.ts`, `core/config/api.ts`, `core/auth/*` (guards/interceptor), `core/llm/llm-health.service.ts`, `core/runtime/app-health.service.ts`, `core/services/*`, `core/title/*`, `core/pwa/*`, `layout/main-layout.component.ts`, `pages/login|reset-password|invite-signup|two-factor-setup|placeholder|dashboard`, `admin/pages/{activity-log,places,place-detail,backup,credit-settings,warehouses,vessel-sanctions,teams,company-groups,port-documentation,email-settings,our-companies,settings/*,integrations/*-card}`, `companies/pages/{companies,company-detail/*}`, `credit/pages/credit-applications`, `dashboard/pages/analytics`, `operations/pages/*`, `reports/pages/*`, `resources/pages/*`, `trading/components/{detail-header,header-actions,internal-transfer-summary,order-financing-summary,order-items/*,send-inquiry-modal/{inquiry-body-editor,inquiry-deadline-picker,utils}}`, `trading/pages/{cancelled,completed,delivered}-orders-list`, `trading/pages/{orders-list,public-supplier-nomination,public-supplier-quote,inquiries-list/*}`, `vessels/pages/vessels/vessels-page.component.ts`, `shared/components/{activity-timeline,column-picker,comments-card,email-history-card,email-tag-input,pagination,searchable-dropdown,sort-header,status-badge,user-menu}/*`, `shared/data/*`, `shared/pipes/*`, `shared/utils/flags.ts`.

## Recommended Follow-Up

Highest-value follow-ups (report-only items needing a deliberate decision):
1. **JWT production assertion** — add a fail-fast check in production for `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` (and the OAuth state-signing key). Highest-impact, lowest-effort security hardening.
2. **Inventory balance double-counting** — `inventory.service.ts:621` `let running = 0;` with test coverage.
3. **Remove the dead `downloadModel` shell-injection helper** (`llm.service.ts:884`) and validate the LLM model-install filename.
4. **Delete the dead/duplicate code** — `report-delivery.service.ts`, `document-pdf-*` family, unused `orders` split files, `vessel-detail` store+tabs, `llm-page.store.ts`, `settings-page.component.ts.deprecated`. Large maintainability win.
5. **Order-detail autosave loop** — track a dirty/changeVersion signal instead of re-saving on every supplier-reload.
6. **Secret storage consistency** — encrypt the SSO client secret and hash the Fueld refresh token at rest.
7. **403 vs 500** — fix the inventory/transfer privilege helpers to set `set.status = 403`.
8. **Input validation** — add `t.Object` query schemas (dashboard, vessels, risk-monitoring, vessel-sanctions) and amount/role validation.
9. **XSS hardening** — sanitize the send-inquiry email preview, Leaflet popups, and email-body HTML; HTML-escape interpolated values in report/invite/reset emails and `Content-Disposition`.