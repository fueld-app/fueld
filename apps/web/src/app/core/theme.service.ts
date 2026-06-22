import { DOCUMENT } from '@angular/common';
import { Service, computed, effect, inject, signal } from '@angular/core';

export type ThemePref = 'device' | 'light' | 'dark';

const KEY = 'fueld-app-theme';

/**
 * Feature flag for the in-app theme toggle (decision #6).
 *
 * Flipped to `true` after the dark-mode migration completed and all
 * verification passed (plan step 8): typecheck, build, Vitest unit, Playwright
 * e2e (all projects), and WCAG AA contrast spot-check (status pills, dense
 * tables, focus rings, buttons). The Light/Dark/Device control is now visible
 * to everyone in account settings. Theming itself was always active (the
 * pre-paint script in index.html + the OS preference drive `data-theme`); the
 * flag only gates the user-facing control.
 */
export const THEME_TOGGLE_ENABLED = true;

@Service()
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly mql = this.doc.defaultView?.matchMedia?.(
    '(prefers-color-scheme: dark)',
  );

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
    this.apply(this.resolved()); // index.html script already did first paint
    effect(() => this.apply(this.resolved())); // covers explicit set()
    this.mql?.addEventListener('change', (e) => {
      // covers OS change while in 'device'
      if (this.pref() === 'device') this.apply(e.matches ? 'dark' : 'light');
    });
  }

  set(p: ThemePref): void {
    this.pref.set(p);
    try {
      localStorage.setItem(KEY, p);
    } catch {
      // ignore — persistence is best-effort
    }
  }

  private read(): ThemePref {
    try {
      const v = localStorage.getItem(KEY);
      if (v === 'light' || v === 'dark' || v === 'device') return v;
    } catch {
      // ignore
    }
    return 'device';
  }

  private apply(t: 'light' | 'dark'): void {
    this.doc.documentElement.setAttribute('data-theme', t);
  }
}