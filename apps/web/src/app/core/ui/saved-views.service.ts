import { Service, signal } from '@angular/core';

// ═══════════════════════════════════════════════════════════════════════
//  SavedViewsService — named, per-page saved filter/search/sort "views".
//
//  Views are stored client-side (localStorage) keyed by a stable page key,
//  e.g. 'trading/inquiries'. Each view snapshots whatever state the page
//  passes in (search term, filters, sort, columns…) as a plain JSON object,
//  so this service stays decoupled from any specific page's shape.
//
//  Shareable URLs: pages sync the active view name to `?view=` query param.
//  Opening the same link restores the view on the same browser/profile
//  (localStorage is per-user; views are not synced to the server in v1).
//
//  Deletion is undo-able — pages wire `delete()` into ToastService by
//  re-saving the returned snapshot on undo.
// ═══════════════════════════════════════════════════════════════════════

export interface SavedView {
  id: string;
  name: string;
  /** Page-defined snapshot: search term, filters, sort, etc. */
  state: Record<string, unknown>;
  createdAt: number;
}

const KEY_PREFIX = 'fueld-saved-views:';

@Service()
export class SavedViewsService {
  /** pageKey → views (reactive for all consumers) */
  private readonly store = signal<Record<string, SavedView[]>>(readAll());

  viewsFor(pageKey: string): SavedView[] {
    return this.store()[pageKey] ?? [];
  }

  /** Re-active per-page signal helper for templates. */
  pageViews(pageKey: string) {
    // Returns a live array; called inside computed() on the page.
    return this.store()[pageKey] ?? [];
  }

  has(pageKey: string, name: string): boolean {
    return this.viewsFor(pageKey).some((v) => v.name.toLowerCase() === name.trim().toLowerCase());
  }

  /**
   * Save (or overwrite) a named view. Returns the stored view.
   * Empty name → auto-name "View N".
   */
  save(pageKey: string, name: string, state: Record<string, unknown>): SavedView {
    const trimmed = name.trim() || `View ${this.viewsFor(pageKey).length + 1}`;
    const existing = this.viewsFor(pageKey).find(
      (v) => v.name.toLowerCase() === trimmed.toLowerCase(),
    );
    const view: SavedView = existing
      ? { ...existing, state, createdAt: Date.now() }
      : {
          id: `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          name: trimmed,
          state,
          createdAt: Date.now(),
        };

    this.store.update((all) => {
      const list = all[pageKey] ?? [];
      const next = existing
        ? list.map((v) => (v.id === existing.id ? view : v))
        : [...list, view];
      const nextAll = { ...all, [pageKey]: next };
      persist(pageKey, next);
      return nextAll;
    });
    return view;
  }

  /** Delete a view and return its snapshot (for undo). */
  delete(pageKey: string, id: string): SavedView | null {
    const view = this.viewsFor(pageKey).find((v) => v.id === id) ?? null;
    if (!view) return null;
    this.store.update((all) => {
      const next = (all[pageKey] ?? []).filter((v) => v.id !== id);
      persist(pageKey, next);
      return { ...all, [pageKey]: next };
    });
    return view;
  }

  /** Restore a previously-deleted view (undo path). */
  restore(pageKey: string, view: SavedView): void {
    this.save(pageKey, view.name, view.state);
  }

  /** Find a view by name (used for ?view= deep links). */
  findByName(pageKey: string, name: string): SavedView | null {
    const needle = name.trim().toLowerCase();
    return this.viewsFor(pageKey).find((v) => v.name.toLowerCase() === needle) ?? null;
  }
}

function readAll(): Record<string, SavedView[]> {
  try {
    const all: Record<string, SavedView[]> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(KEY_PREFIX)) {
        const pageKey = key.slice(KEY_PREFIX.length);
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw) as SavedView[];
          all[pageKey] = Array.isArray(parsed) ? parsed : [];
        }
      }
    }
    return all;
  } catch {
    return {};
  }
}

function persist(pageKey: string, views: SavedView[]): void {
  try {
    localStorage.setItem(KEY_PREFIX + pageKey, JSON.stringify(views));
  } catch {
    // ignore — storage may be full/unavailable
  }
}