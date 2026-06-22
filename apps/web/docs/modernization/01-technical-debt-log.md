# Technical Debt Log — Angular 22 Modernization (`apps/web/`)

Audit of legacy / non-optimized rendering & data-fetching patterns, and what was
done for each. (See `02-performance-impact.md` for measured bundle effects.)

## Goal 1 — Change detection: DONE ✅

- **`ChangeDetectionStrategy.Eager` markers (2):** the v22 migration schematic
  left `Eager` (the legacy `CheckAlways` marker) on `app.ts` (root) and
  `pages/dashboard/dashboard-redirect.component.ts` (empty template).
  - **Done:** both → `ChangeDetectionStrategy.OnPush` (the v22 default; matches
    the codebase's 145 existing OnPush components).
  - grep confirms 0 `Eager`/`Default` remain. 145 components were already OnPush;
    the rest inherit the v22 OnPush default.
  - Note: the app already runs zoneless (`provideZonelessChangeDetection()` in
    `app.config.ts`), so signal-driven OnPush is the correct model.

## Goal 2 — Service layer: DONE ✅

### 2a. `providedIn: 'root'` → `@Service()` (30 services)
- **Done:** all 30 `@Injectable({ providedIn: 'root' })` services migrated to the
  native `@Service()` decorator (auto-provided, equivalent semantics). Imports
  swapped `Injectable` → `Service`.
- **NG2028 follow-up:** `@Service` classes cannot use constructor DI — the 2
  services that used constructor DI (`auth.service.ts`: http, router;
  `fueld-title-strategy.ts`: Title) were converted to `inject()` field
  initializers. The other 28 already used `inject()`.
- 4 bare `@Injectable()` store classes (provided via `providers` arrays, not
  `providedIn:'root'`) left as-is — out of scope (not root-provided).
- grep confirms 0 `providedIn: 'root'` remain.

### 2b. Lazy-load heavy non-critical services via `injectAsync`/`onIdle`: DONE ✅
- **Audit:** only one heavy non-critical-at-boot dependency was eagerly imported
  into the main bundle — `@simplewebauthn/browser` (WebAuthn/passkey), used in
  `auth.service.ts` only in 3 rare passkey flows (sign-in ×2, registration ×1).
  No heavy client-side PDF engine exists — `order-pdf.service` delegates to the
  API (server-side PDF generation).
- **Done:** extracted `core/auth/passkey.service.ts` (`@Service` wrapping
  `startAuthentication`/`startRegistration`) and lazy-loaded it in `AuthService`
  via `injectAsync(() => import('./passkey.service').then(m => m.PasskeyService),
  { prefetch: onIdle })`. `@simplewebauthn/browser` moved out of the main entry
  chunk into a lazily-loaded chunk (prefetched during idle, loaded only on
  passkey flows).
- `auth.service` (critical at boot) is NOT deferred — only the passkey lib is.

## Goal 4 — Async streams → native Resource APIs: AUDITED, NO CLEAR-IMPROVEMENT CONVERSIONS

A scan for `HttpClient` fetching coupled with manual boolean state
(`isLoading`/`hasError`/`loading = signal`) + `switchMap` found 12 occurrences.
Each was evaluated against `resource()`/`httpResource()` for a **clear
improvement** (the contract bar). None met it:

### Exceptions (documented with reasons)

1. **`auth.interceptor.ts` — 2 × `switchMap`** (token refresh). This is an HTTP
   *interceptor* (request/response pipeline), not a data-fetching pipeline.
   Interceptors are fundamentally RxJS (`HttpHandler.handle()` returns an
   `Observable`). `resource`/`httpResource` is for data fetching, not request
   interception. **Not applicable.**

2. **Typeahead search — 4 components × `debounceTime` + `switchMap`**
   (`vessels-page`, `places-page`, `companies-page`, `email-tag-input`).
   Search-as-you-type with debounce + cancel-on-new-keystroke is the canonical
   RxJS `switchMap` use case. `resource()` has no native debounce and would
   require a separate debounced signal — *more* code, not less, with no
   correctness gain. **RxJS is idiomatic here.**

3. **Orchestrated multi-fetch + side effects — `vessel-detail-page`,
   `platts-report-detail-page`** (`isLoading`/`error` signals). These load a
   primary entity then conditionally fan out to several endpoints in parallel
   with side effects (set page title, send WS presence, init Leaflet map, toggle
   syncing indicator). `resource()` models a single async value; it cannot
   express multi-resource orchestration with side effects. **Doesn't fit.**

4. **Action-triggered refresh with await semantics — credit pages**
   (`credit-applications-page`, `supplier-credit-page`, `customer-credit-page`,
   `isLoading` signal). These load a paginated list and, after a
   review/submit/cancel action, `await Promise.all([load(), loadPendingCount()])`
   so the UI re-renders the updated list *before* re-enabling the button. A
   conversion attempt on `credit-applications-page` revealed that
   `ResourceRef.reload()` returns `boolean` (fire-and-forget — it *schedules* a
   reload; the value updates reactively later), so it **loses the await-the-
   refresh semantics** the action handlers rely on — a behavioral regression.
   The param-driven initial/page-change load *would* fit `resource()`, but the
   mixed imperative+await refresh model makes it **not a clear improvement**.
   Conversion reverted; documented here.

**Outcome:** Goal 4 produced no code changes. The 12 occurrences are all
legitimately served by their current patterns (RxJS-idiomatic typeahead,
RxJS interceptor, orchestrated multi-fetch, or imperative action-refresh with
await semantics). A future pass could convert *purely* param-driven GETs (no
side effects, no action-refresh) if any emerge.

## Goals 3 & 5 — dropped (no debt)
- `FormGroup`/`FormControl`/`FormBuilder`: 0 usages (no Signal-Forms work).
- `route.parent`/`parent?.parent` chains: 0 (no router param-inheritance work).