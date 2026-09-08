import { Service, signal, inject, DOCUMENT } from '@angular/core';

// ═══════════════════════════════════════════════════════════════════════
//  DensityService — user-selectable table/list density.
//
//  'comfortable' (default) vs 'compact' (Terminal-style, ~30% denser rows).
//  Applied as `data-density` on <html> and persisted to localStorage so it
//  survives reloads. CSS in styles.css keys off the attribute.
// ═══════════════════════════════════════════════════════════════════════

export type Density = 'comfortable' | 'compact';

const KEY = 'fueld-app-density';

@Service()
export class DensityService {
  private readonly doc = inject(DOCUMENT);

  readonly density = signal<Density>(this.read());

  constructor() {
    this.apply(this.density());
  }

  toggle(): void {
    this.set(this.density() === 'compact' ? 'comfortable' : 'compact');
  }

  set(d: Density): void {
    this.density.set(d);
    this.apply(d);
    try {
      localStorage.setItem(KEY, d);
    } catch {
      // ignore — persistence is best-effort
    }
  }

  private read(): Density {
    try {
      const v = localStorage.getItem(KEY);
      if (v === 'compact' || v === 'comfortable') return v;
    } catch {
      // ignore
    }
    return 'comfortable';
  }

  private apply(d: Density): void {
    this.doc.documentElement.setAttribute('data-density', d);
  }
}