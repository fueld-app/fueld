# Angular 22 Modernization — Baseline (before refactor)

Captured on commit `2847779f` (the dark-mode theme adoption commit), before any
modernization refactor. All numbers from a fresh `bun run --filter @fueld/web build`
(exit 0, no budget warnings).

## Build output: `apps/web/dist/web/browser/browser/`

| Metric | Bytes | Notes |
|---|---|---|
| Total JS | 3,477,024 (3.31 MiB) | all `*.js` chunks (eager + lazy) |
| Total CSS | 181,184 (177 KiB) | `styles-*.css` |
| Main entry chunk (`main-Z2DRUTIK.js`) | 365,200 (357 KiB) | initial bundle entry |
| Whole `dist/web/browser` | ~5.9 MiB | incl. assets, ngsw-worker, licenses |

## angular.json budgets (current thresholds)

- `initial`: maximumWarning `1.6MB`, maximumError `2MB`
- `anyComponentStyle`: maximumWarning `4kB`

Build exited 0 with **no budget warnings** → initial bundle is under 1.6MB.

## Green gate (baseline, pre-refactor)

- `bun run --filter @fueld/web typecheck` → exit 0
- `bun run --filter @fueld/web build` → exit 0
- Vitest unit → 65/65 passed (18 files)
- `sh scripts/e2e.sh test` → **542 passed / 0 failed** across all 7 Playwright projects
  (chromium, firefox, webkit, mobile-chrome, mobile-safari, tablet, pwa), in dark
  mode — verified on commit `2847779f` (the final theme-verification run; no code
  changes between that run and this baseline).

## Debt inventory (pre-refactor)

- `ChangeDetectionStrategy.Eager` / `ChangeDetectionStrategy.Default`: **2** occurrences
  (145 components already `OnPush`; 147 `@Component` total).
- `@Injectable({ providedIn: 'root' })`: **30** occurrences; `@Service()`: **0**.
- `FormGroup`/`FormControl`/`FormBuilder`: **0** (Signal-Forms goal dropped — no debt).
- `HttpClient`+`switchMap` / `isLoading` / `hasError`: **12** occurrences.
- `route.parent` / `parent?.parent` chains: **0** (router goal dropped — no debt).

These are the "before" numbers; the Performance Metric Impact doc will record the
matching "after" numbers once the refactor lands.