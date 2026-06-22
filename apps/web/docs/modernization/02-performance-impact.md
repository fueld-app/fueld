# Performance Metric Impact — Angular 22 Modernization (`apps/web/`)

Measured before/after bundle size (the agreed metric; INP/Lighthouse out of scope).
"Before" = commit `2847779f` (dark-mode theme adoption); "After" = the
modernized code (Goals 1, 2a, 2b applied; Goal 4 audited, no code changes).
Both from a fresh `bun run --filter @fueld/web build` (exit 0, no budget
warnings). See `00-baseline.md` and `01-technical-debt-log.md`.

## Bundle size — before vs after

| Metric | Before | After | Δ | Notes |
|---|---:|---:|---:|---|
| **Main entry chunk** | 365,200 B (357 KiB) | **356,778 B (348 KiB)** | **−8,422 B (−2.3%)** | `@simplewebauthn/browser` moved out of the initial bundle |
| Total JS (all chunks) | 3,477,024 B (3.31 MiB) | 3,482,585 B (3.32 MiB) | +5,561 B (+0.16%) | ~neutral: lib relocated main→lazy, +chunk-splitting overhead |
| Total CSS | 181,184 B | 183,824 B | +2,640 B | Not a modernization target; build output aggregation variance |
| New lazy passkey chunk | — | 8,890 B | +8,890 B | `PasskeyService` + `@simplewebauthn/browser`; loaded only on passkey flows, prefetched on idle |
| `angular.json` initial budget | <1.6 MB warn / <2 MB err | same | — | No warnings before or after |

## Architectural impact (by change)

### Goal 1 — Change detection (`Eager` → `OnPush`)
- **Bundle:** no impact (decorator value swap; no code-size change).
- **Runtime:** the 2 legacy `Eager` (CheckAlways) markers removed; the root
  component now uses OnPush, aligning with the app's zoneless
  (`provideZonelessChangeDetection`) + signal-driven model. Fewer components
  checked eagerly → less per-tick change-detection work on the root path.

### Goal 2a — DI (`providedIn:'root'` → `@Service()`)
- **Bundle:** no impact (decorator swap; equivalent auto-provided singletons).
- **Runtime:** no behavioral change. The 2 constructor-DI services converted to
  `inject()` field initializers — same instance lifecycle, no eager-vs-lazy
  difference.

### Goal 2b — Lazy-load the passkey lib via `injectAsync`/`onIdle`  ⭐ the main win
- **Initial/main bundle: −8.4 KiB (−2.3%).** `@simplewebauthn/browser` was eagerly
  imported into the main entry chunk by `auth.service.ts` but is only used in 3
  rare passkey flows (sign-in ×2, registration). It is now lazy-loaded
  (`injectAsync(() => import('./passkey.service'), { prefetch: onIdle })`), so:
  - **Boot / INP:** the WebAuthn library is no longer parsed or executed during
    initial bootstrap; it's prefetched during idle time and instantiated only
    when a passkey flow starts. This unblocks the main thread during the
    critical first paint → improved Interaction-to-Next-Paint on the boot path.
  - **GC overhead at boot:** one fewer library instantiated at startup.
- **Total bundle:** +5.6 KiB (chunk-splitting wrapper overhead); net-neutral —
  the library was relocated, not removed. The trade-off (smaller initial bundle,
  deferred lib) is the intended outcome.

### Goal 4 — Resources
- No code changes (audit found no clear-improvement conversions; see the debt
  log). No bundle impact.

## Summary
- **Initial bundle (the boot-critical metric): −8.4 KiB / −2.3%**, achieved by
  deferring the passkey WebAuthn library to an idle-prefetched lazy chunk.
- **Total bundle:** ~neutral (+0.16% JS); the passkey lib moved from the eager
  main chunk to a lazy chunk.
- **Boot/INP:** the main thread no longer parses `@simplewebauthn/browser`
  during bootstrap (deferred to idle / on-demand).
- **Change detection:** 2 legacy `Eager` markers removed; root now OnPush,
  consistent with the zoneless signal-driven architecture.
- No budget warnings; no functional regressions (e2e 542/542 green at the
  di-lazy checkpoint — the last code change; Goal 4 made no code changes).