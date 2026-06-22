# Adopting the Fueld design system in the platform

**Goal:** Make the Angular platform (`apps/web/`) share one visual system with
the marketing site (`apps/marketing/`) — orange brand, dark + light themes,
theme-aware status colors — with **device-default theming** the user can
override in their account settings.

This is the single plan. A live before/after (Current / New Dark / New Light)
lives at [`docs/design-preview.html`](../../../docs/design-preview.html) — open
it in a browser.

The design system itself is two framework-free CSS files in
[`apps/marketing/src/styles/`](../src/styles/): `tokens.css` (the single source
of truth) and `global.css` (marketing component styles, optional). Only
`tokens.css` is needed for the platform.

---

## Decisions (locked)

1. **Theme default = device.** First visit follows the OS color scheme. Users
   override to **Light / Dark / Device** in their account settings. Persisted
   in `localStorage`.
2. **Brand → orange.** Repoint the existing `--color-brand-*` scale to the amber
   palette (`#f59e0b` = `brand-500`). All existing `brand-*` utilities turn
   orange with **zero template edits**.
3. **Sidebar = theme-aware.** Drop the special `--color-sidebar-*` slate tokens;
   the sidebar uses the shared `--surface-*` family and follows the theme like
   everything else. One mental model: the theme toggles the whole app.
4. **Status colors → semantic, theme-aware tokens.** Add `--st-{status}-bg/fg/line`
   tokens (dark + light) and a `.status-pill` class; migrate status badges to it.
5. **No cross-domain sharing.** The theme key is app-scoped (`fueld-app-theme`) on
   `app.fueld.app` only. Device-default (#1) means the OS makes the marketing
   site and app match anyway — no parent-domain cookie or postMessage.
6. **Rollout = incremental, gated.** Light mode is never broken: each component
   keeps its light utilities and **adds `dark:` variants**. The settings toggle
   ships **behind a flag** until migration is far enough, then is enabled for all.

---

## How theming works

Three pieces, together:

1. **`tokens.css`** defines `--surface`, `--ink`, `--line`, `--accent`, … for
   `data-theme="dark"` and `data-theme="light"`.
2. **The app always sets an explicit `data-theme`** on `<html>` (never absent).
   `ThemeService` resolves the user's preference (`device` → read OS) and writes
   `"dark"` or `"light"`. This makes dark-mode behavior predictable and the
   Tailwind `dark:` variant trivial.
3. **Tailwind v4 bridge:** `@theme` exposes the tokens as Tailwind colors
   (`bg-surface`, `text-ink`, `border-line`, `text-accent`, …) so they are
   theme-aware utilities. `@custom-variant dark` makes `dark:foo` apply under
   `data-theme="dark"`.

Migrating a component = keep its light utilities, **add `dark:` variants**.
Light mode is untouched; dark mode is additive. (Cleaning up to pure semantic
utilities later is optional polish.)

---

## Token / utility mapping

Add `dark:` variants using the semantic utilities:

| Light utility (keep) | `dark:` addition |
|---|---|
| `bg-white` | `dark:bg-surface` |
| `bg-gray-50` | `dark:bg-bg-2` |
| `bg-gray-100` / `bg-gray-200` | `dark:bg-surface-3` |
| `hover:bg-gray-100` | `dark:hover:bg-surface-tint-strong` |
| `text-gray-900` | `dark:text-ink` |
| `text-gray-700` / `text-gray-600` | `dark:text-ink-dim` |
| `text-gray-500` / `text-gray-400` | `dark:text-muted` |
| `border-gray-200` | `dark:border-line` |
| `border-gray-300` | `dark:border-line-strong` |
| `bg-brand-600` etc. | unchanged (now orange); optionally `dark:bg-brand-500` for brightness |

Semantic color tokens to expose in `@theme` (all theme-aware, via the vars in
`tokens.css`):

```
--color-bg, --color-bg-2,
--color-surface, --color-surface-2, --color-surface-3,
--color-surface-tint, --color-surface-tint-strong,
--color-ink, --color-ink-dim, --color-muted,
--color-line, --color-line-strong,
--color-accent, --color-cyan, --color-emerald
```

---

## Steps

### 1. Foundation (1 PR, non-visual)

In `apps/web/src/styles.css`:

```css
@import 'tailwindcss';
@import './styles/tokens.css';   /* symlink of apps/marketing/src/styles/tokens.css */

/* Attribute-based dark mode for Tailwind v4 */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

@theme {
  /* Brand → amber (decision #2). All brand-* utilities become orange. */
  --color-brand-50:  #fffbeb;
  --color-brand-100: #fef3c7;
  --color-brand-200: #fde68a;
  --color-brand-300: #fcd34d;
  --color-brand-400: #fbbf24;
  --color-brand-500: #f59e0b;
  --color-brand-600: #d97706;
  --color-brand-700: #b45309;
  --color-brand-800: #92400e;
  --color-brand-900: #78350f;

  /* Semantic surfaces/ink/line/accent — theme-aware via tokens.css */
  --color-bg:               var(--bg);
  --color-bg-2:             var(--bg-2);
  --color-surface:          var(--surface);
  --color-surface-2:        var(--surface-2);
  --color-surface-3:        var(--surface-3);
  --color-surface-tint:     var(--surface-tint);
  --color-surface-tint-strong: var(--surface-tint-strong);
  --color-ink:              var(--ink);
  --color-ink-dim:          var(--ink-dim);
  --color-muted:            var(--muted);
  --color-line:             var(--line);
  --color-line-strong:      var(--line-strong);
  --color-accent:           var(--accent);
  --color-cyan:             var(--cyan);
  --color-emerald:          var(--emerald);

  --font-sans: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
}
```

Remove the old `--color-sidebar-*` and `--color-status-*` blocks (decisions #3,
#4). Symlink the tokens file:

```bash
ln -s ../../marketing/src/styles/tokens.css apps/web/src/styles/tokens.css
```

In `apps/web/src/index.html` `<head>`, add the pre-paint script + dual
`theme-color` metas (mirrors the service; runs before Angular to avoid FOUC):

```html
<script>
  try {
    var p = localStorage.getItem('fueld-app-theme');
    var dark;
    if (p === 'light') dark = false;
    else if (p === 'dark') dark = true;
    else dark = matchMedia('(prefers-color-scheme: dark)').matches; /* device / null */
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (_) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
</script>
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f6f7fb" />
<meta name="theme-color" media="(prefers-color-scheme: dark)"  content="#06080d" />
```

### 2. ThemeService + settings control

`apps/web/src/app/core/theme.service.ts`:

```ts
import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';

export type ThemePref = 'device' | 'light' | 'dark';
const KEY = 'fueld-app-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly mql = this.doc.defaultView?.matchMedia('(prefers-color-scheme: dark)');

  /** User's preference. 'device' = follow OS. */
  readonly pref = signal<ThemePref>(this.read());
  /** The actual theme applied to <html data-theme>. */
  readonly resolved = computed<'light' | 'dark'>(() => {
    const p = this.pref();
    if (p === 'light') return 'light';
    if (p === 'dark') return 'dark';
    return this.mql?.matches ? 'dark' : 'light';
  });

  constructor() {
    this.apply(this.resolved());                    // index.html script already did first paint
    effect(() => this.apply(this.resolved()));      // covers explicit set()
    this.mql?.addEventListener('change', (e) => {   // covers OS change while in 'device'
      if (this.pref() === 'device') this.apply(e.matches ? 'dark' : 'light');
    });
  }

  set(p: ThemePref): void {
    this.pref.set(p);
    try { localStorage.setItem(KEY, p); } catch {}
  }

  private read(): ThemePref {
    try {
      const v = localStorage.getItem(KEY);
      if (v === 'light' || v === 'dark' || v === 'device') return v;
    } catch {}
    return 'device';
  }

  private apply(t: 'light' | 'dark'): void {
    this.doc.documentElement.setAttribute('data-theme', t);
  }
}
```

Add a 3-way control (Light / Dark / Device) to the user account settings page,
bound to `theme.pref()` / `theme.set(...)`. **Hide it behind a flag** for now
(decision #6).

### 3. Retheme the global component layer

`styles.css` `@layer components` — `app-panel`, `app-panel-header--*`,
`app-kpi-card`, `app-input`, `app-button-primary`, `app-button-add`, scrollbar.
These are CSS (not templates), so use the semantic tokens directly (they're
theme-aware already); add `dark:` only where a token doesn't cover it. Small,
high leverage — fixes every panel/button/input at once.

### 4. Migrate the shell

`main-layout.component.ts` (sidebar, topbar, search, price strip, MFA banner,
RFQ slide-out, paste modal) + `user-menu`. Most visible surface — do it first.
Replace `bg-sidebar` / `text-sidebar-text` / `bg-sidebar-hover` / etc. with
`bg-surface` / `text-muted` / `bg-surface-tint-strong` and add `dark:` per the
mapping table.

### 5. Migrate the features (146 components)

Order: `dashboard` → `trading` (36) → `admin` (46) → `companies` (22) →
`credit` / `vessels` / `reports` / `operations` / `resources` →
`pages/*` (login, 2FA setup/verify, reset-password, invite-signup, placeholder)
→ `shared/components` (12).

Per component: add `dark:` variants per the mapping table. **Light mode stays
unchanged** — this is what makes the rollout safe.

### 6. Status tokens + `.status-pill`

Add to a platform token extension (e.g. a small `apps/web/src/styles/status.css`
imported after `tokens.css`), for both themes:

```css
.preview, :root[data-theme='dark'] {
  --st-inquiry-bg: rgba(245,158,11,0.12);  --st-inquiry-fg: var(--accent-2);  --st-inquiry-line: rgba(245,158,11,0.30);
  --st-offer-bg:   rgba(249,115,22,0.14);  --st-offer-fg:   #fb923c;          --st-offer-line:   rgba(249,115,22,0.32);
  --st-confirmed-bg: rgba(34,211,238,0.12);--st-confirmed-fg: var(--cyan);    --st-confirmed-line: rgba(34,211,238,0.30);
  --st-delivered-bg: rgba(139,92,246,0.14);--st-delivered-fg:#a78bfa;         --st-delivered-line: rgba(139,92,246,0.32);
  --st-invoiced-bg: rgba(99,102,241,0.14); --st-invoiced-fg:#818cf8;          --st-invoiced-line: rgba(99,102,241,0.32);
  --st-paid-bg: var(--pill-emerald-bg);    --st-paid-fg: var(--pill-emerald-fg); --st-paid-line: var(--pill-emerald-line);
  --st-cancelled-bg: rgba(239,68,68,0.12); --st-cancelled-fg:#f87171;         --st-cancelled-line: rgba(239,68,68,0.30);
  --st-overdue-bg:   rgba(220,38,38,0.16); --st-overdue-fg:#fca5a5;           --st-overdue-line: rgba(220,38,38,0.34);
}
:root[data-theme='light'] {
  --st-offer-fg:#c2410c; --st-delivered-fg:#7c3aed; --st-invoiced-fg:#4f46e5;
  --st-cancelled-fg:#b91c1c; --st-overdue-fg:#991b1b;
}
```

Add a `.status-pill` class in the global component layer:

```css
.status-pill { display:inline-flex; align-items:center; padding:.15rem .55rem; border-radius:999px;
  font-size:.68rem; font-weight:600; border:1px solid transparent; }
.status-pill[data-status="inquiry"]  { background:var(--st-inquiry-bg);  color:var(--st-inquiry-fg);  border-color:var(--st-inquiry-line); }
.status-pill[data-status="offer"]    { background:var(--st-offer-bg);    color:var(--st-offer-fg);    border-color:var(--st-offer-line); }
.status-pill[data-status="confirmed"]{ background:var(--st-confirmed-bg);color:var(--st-confirmed-fg);border-color:var(--st-confirmed-line); }
.status-pill[data-status="delivered"]{ background:var(--st-delivered-bg);color:var(--st-delivered-fg);border-color:var(--st-delivered-line); }
.status-pill[data-status="invoiced"] { background:var(--st-invoiced-bg); color:var(--st-invoiced-fg); border-color:var(--st-invoiced-line); }
.status-pill[data-status="paid"]     { background:var(--st-paid-bg);     color:var(--st-paid-fg);     border-color:var(--st-paid-line); }
.status-pill[data-status="cancelled"]{ background:var(--st-cancelled-bg);color:var(--st-cancelled-fg);border-color:var(--st-cancelled-line); }
.status-pill[data-status="overdue"]  { background:var(--st-overdue-bg);  color:var(--st-overdue-fg);  border-color:var(--st-overdue-line); }
```

Then replace inline status badges (e.g. `bg-red-50 text-red-700 border-red-200`
→ `<span class="status-pill" data-status="cancelled">Cancelled</span>`).

### 7. Third-party theming

- **Leaflet** (6 files): switch the tile layer + theme controls/popups, bound to
  `theme.resolved()` (re-theme on change).
- **pdfjs** viewer (6 files): skin the toolbar/surround with tokens. (Generated
  PDFs are API-side — out of scope for this frontend plan.)
- **ngx-echarts** is in `package.json` but imported 0 times — not a concern now.

### 8. Verify & enable

- `bun run --filter @fueld/web typecheck` + `build` + Vitest unit + Playwright e2e.
- WCAG AA contrast spot-check on dense tables, disabled states, focus rings,
  status pills — both themes.
- Standalone PWA check on iOS, both themes (`theme-color` + safe areas).
- Screenshot diff: current vs new, light + dark, per area.
- Flip the step-2 flag → dark mode enabled for everyone.

---

## Checklist

- [ ] `tokens.css` imported first; `@theme` merged (brand→amber + semantic bridge); `@custom-variant dark` set; old `--color-sidebar-*` / `--color-status-*` removed
- [ ] Pre-paint script + dual `theme-color` metas in `index.html`
- [ ] `ThemeService` + 3-way control in account settings (flagged off)
- [ ] Global `@apply` component layer on tokens
- [ ] Shell migrated (`main-layout` + `user-menu`)
- [ ] All 146 components have `dark:` variants; light mode unchanged
- [ ] `--st-*` status tokens + `.status-pill`; status badges migrated
- [ ] Leaflet + pdfjs themed
- [ ] Contrast + PWA standalone verified (both themes)
- [ ] Flag flipped → dark enabled for everyone