# Adopting the Fueld design system in the platform

The marketing site at `apps/marketing/` ships a small, framework-agnostic
design system you can drop into the Angular platform (`apps/web/`) without
pulling in Astro or any new dependency.

It is just two CSS files plus an optional theme toggle (~20 lines of vanilla
JS). Everything is driven by CSS custom properties, so once the tokens are in
scope you can theme any component — Angular, Tailwind, plain CSS, custom
elements — by writing `var(--surface)`, `var(--ink)`, `var(--accent)`, etc.

---

## 1. What is in the system

Two files in [apps/marketing/src/styles/](../src/styles/):

- **[`tokens.css`](../src/styles/tokens.css)** — single source of truth for the
  design system. Defines CSS variables for both **dark** (default) and
  **light** themes, plus a `prefers-color-scheme: light` block so users with
  no explicit preference get the right theme automatically.
- **[`global.css`](../src/styles/global.css)** — opinionated component styles
  (header, hero, cards, FAQ, contact form, code block, phone mockup, etc.).
  Consumes only `tokens.css` variables — no hard-coded colors. Optional for
  the platform; copy what you want.

Themes are toggled by setting an attribute on `<html>`:

| Attribute | Behaviour |
| --- | --- |
| _(none)_ | Follows OS `prefers-color-scheme`. |
| `data-theme="dark"` | Force dark. |
| `data-theme="light"` | Force light. |

---

## 2. Token cheat sheet

All values live in [`tokens.css`](../src/styles/tokens.css). Use the
**semantic** name in your code, never the raw hex.

### Surfaces & layout

| Var | Use for |
| --- | --- |
| `--bg`, `--bg-2` | Page backgrounds |
| `--surface`, `--surface-2`, `--surface-3` | Cards, panels, nested containers |
| `--surface-tint`, `--surface-tint-strong` | Subtle hover/striping fills |
| `--surface-inset`, `--surface-inset-strong` | Form inputs, code wells |
| `--line`, `--line-strong`, `--line-hover` | Borders/dividers |
| `--radius-sm` `8px` · `--radius-md` `10px` · `--radius-lg` `16px` · `--radius-xl` `24px` | Corner radii |

### Text

| Var | Use for |
| --- | --- |
| `--ink` | Primary body text, headings |
| `--ink-dim` | Secondary copy |
| `--muted` | Tertiary / labels |
| `--heading-from`, `--heading-to` | Gradient applied to large headings |

### Brand / accent (theme-agnostic)

| Var | Use for |
| --- | --- |
| `--accent` `#f59e0b`, `--accent-2`, `--accent-deep` | Primary brand orange |
| `--on-accent` `#1a1208` | Foreground on accent backgrounds |
| `--cyan`, `--emerald` | Secondary informational colors |
| `--gradient-accent`, `--gradient-accent-hover` | CTA button backgrounds |

### Status pills

| Var | Use for |
| --- | --- |
| `--pill-emerald-bg/-fg/-line` | Success, "Confirmed", "Delivered" |
| `--pill-amber-bg/-fg/-line` | Pending, warning |

### Shadows

| Var | Use for |
| --- | --- |
| `--shadow-soft` | Top-level bands |
| `--shadow-card` | Cards |
| `--shadow-phone` | Floating phone/mockup frames |
| `--shadow-accent`, `--shadow-accent-hover` | Primary CTA glow |

### Typography

| Var | Default |
| --- | --- |
| `--font-display`, `--font-body` | Native system sans stack |
| `--font-mono` | Native system mono stack |

### Code highlighting

`--code-bg`, `--code-kw`, `--code-fn`, `--code-str`, `--code-cm` (each have
sensible dark + light variants).

---

## 3. Wiring it into the Angular platform

### 3.1 Copy or symlink the tokens

The tokens file is intentionally framework-free. Two options:

**Option A — symlink (always in sync, recommended during co-development):**

```bash
ln -s ../../marketing/src/styles/tokens.css apps/web/src/styles/tokens.css
```

**Option B — copy (decouples versions):**

```bash
cp apps/marketing/src/styles/tokens.css apps/web/src/styles/tokens.css
```

Either way, import it as the **first** thing in `apps/web/src/styles.css` (or
your global Tailwind entry):

```css
@import './styles/tokens.css';
/* …existing platform styles… */
```

If you want the component styling too (header pill, cards, FAQ details, etc.),
also copy `global.css` — but that file is opinionated marketing-site CSS;
prefer cherry-picking the rules you want.

### 3.2 Set the theme on `<html>`

In `apps/web/src/index.html`, add an inline bootstrap script in `<head>` so
the saved theme is applied **before paint** (no FOUC):

```html
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f6f7fb" />
<meta name="theme-color" media="(prefers-color-scheme: dark)"  content="#06080d" />
<script>
  try {
    var t = localStorage.getItem('fueld-theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
    }
  } catch (_) {}
</script>
```

> Use the **same key** `fueld-theme` as the marketing site so a logged-in user
> who set the theme on the marketing site (same root domain) keeps their
> choice when they enter the app subdomain — provided you serve both from the
> same origin or share a parent domain and propagate via a small redirect/SSO
> step.

### 3.3 An Angular `ThemeService` (zoneless-friendly)

```ts
// apps/web/src/app/core/theme.service.ts
import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';

export type Theme = 'light' | 'dark' | 'system';

const KEY = 'fueld-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly mql = this.doc.defaultView?.matchMedia('(prefers-color-scheme: light)');

  readonly preference = signal<Theme>(this.read());
  readonly resolved = computed<'light' | 'dark'>(() => {
    const p = this.preference();
    if (p !== 'system') return p;
    return this.mql?.matches ? 'light' : 'dark';
  });

  constructor() {
    this.apply(this.preference());
    this.mql?.addEventListener?.('change', () => {
      if (this.preference() === 'system') this.apply('system');
    });
  }

  set(theme: Theme): void {
    this.preference.set(theme);
    this.apply(theme);
    try {
      if (theme === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {}
  }

  toggle(): void {
    this.set(this.resolved() === 'dark' ? 'light' : 'dark');
  }

  private read(): Theme {
    try {
      const v = localStorage.getItem(KEY);
      if (v === 'light' || v === 'dark') return v;
    } catch {}
    return 'system';
  }

  private apply(theme: Theme): void {
    const html = this.doc.documentElement;
    if (theme === 'system') html.removeAttribute('data-theme');
    else html.setAttribute('data-theme', theme);
  }
}
```

A minimal toggle button:

```ts
@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  template: `
    <button type="button" (click)="theme.toggle()" [attr.aria-label]="'Toggle theme'">
      {{ theme.resolved() === 'dark' ? '☾' : '☀' }}
    </button>
  `,
})
export class ThemeToggleComponent {
  protected readonly theme = inject(ThemeService);
}
```

### 3.4 Use the tokens from Angular components

Plain CSS:

```css
.card {
  background: var(--surface-2);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.card__title {
  background: linear-gradient(180deg, var(--heading-from), var(--heading-to));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.card__cta {
  background: var(--gradient-accent);
  color: var(--on-accent);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-accent);
}
```

### 3.5 Bridge to Tailwind v4

Tailwind v4 reads CSS variables directly via `@theme`. After importing
`tokens.css`, expose the tokens as Tailwind colors:

```css
@import './styles/tokens.css';
@import 'tailwindcss';

@theme {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-ink: var(--ink);
  --color-ink-dim: var(--ink-dim);
  --color-muted: var(--muted);
  --color-line: var(--line);
  --color-accent: var(--accent);
  --color-cyan: var(--cyan);
  --color-emerald: var(--emerald);
  --radius-card: var(--radius-lg);
}
```

Then `bg-surface text-ink border-line rounded-card` "just works" and reacts to
the `data-theme` attribute live.

---

## 4. Status-pill / mockup snippets you can re-use

If you want the same product-card vocabulary inside the platform (e.g. for
dashboards, lists, status badges), the relevant rules in
[`global.css`](../src/styles/global.css) are:

- `.mock-row`, `.mock-row__dot`, `.mock-row__pill[--amber]` — list item with
  status indicator + pill.
- `.mock-stat`, `.mock-stat__value`, `.mock-stat__delta` — KPI stat tile.
- `.code-block` + `.tk-kw/.tk-fn/.tk-str/.tk-cm` — themed code block.
- `.faq-item` (uses `<details>`) — accessible accordion with `+`/`−` marker.

Copy them as-is or rewrite as Angular components — they reference only the
shared tokens, so they will automatically follow the active theme.

---

## 5. Checklist

- [ ] `tokens.css` imported as the first stylesheet in the platform.
- [ ] Inline `<script>` in `index.html` reads `fueld-theme` before paint.
- [ ] `<meta name="theme-color">` per scheme is set.
- [ ] All component CSS uses semantic vars (`--ink`, `--surface`, …) — no
      raw hex except in `tokens.css`.
- [ ] (Optional) `ThemeService` + toggle component shipped.
- [ ] (Optional) Tailwind `@theme` block bridges tokens to utility classes.

That is the full integration. The marketing site and the platform stay
visually consistent because they share one set of variables — change a value
in `tokens.css` and both surfaces update on the next deploy.
