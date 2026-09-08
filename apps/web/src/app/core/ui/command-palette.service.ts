import { Service, signal } from '@angular/core';

// ═══════════════════════════════════════════════════════════════════════
//  CommandPaletteService — global ⌘K palette state + action registry.
//
//  Pages/features register action providers (functions returning actions so
//  they stay fresh/role-aware). The palette component renders registered
//  actions, entity search results, and recents.
//
//  Open with ⌘K / Ctrl+K (bound in the component) or palette.open().
// ═══════════════════════════════════════════════════════════════════════

export interface CommandAction {
  id: string;
  label: string;
  /** Right-aligned hint, e.g. "N" or "G O". */
  hint?: string;
  /** Optional 24x24 stroke icon path. */
  icon?: string;
  /** Group heading, e.g. "Actions" / "Navigate". */
  section: string;
  /** Extra terms matched against the query. */
  keywords?: string;
  run: () => void | Promise<void>;
}

export type PaletteEntityKind = 'order' | 'company' | 'vessel' | 'place';

export interface PaletteEntity {
  kind: PaletteEntityKind;
  id: string;
  name: string;
  subtitle: string;
  route: string[];
  orderStatus?: string;
}

@Service()
export class CommandPaletteService {
  readonly open = signal(false);

  /** Dynamic action providers (re-evaluated each time the palette opens). */
  private readonly providers = new Set<() => CommandAction[]>();

  register(fn: () => CommandAction[]): () => void {
    this.providers.add(fn);
    return () => this.providers.delete(fn);
  }

  /** Snapshot of all currently-registered actions. */
  actions(): CommandAction[] {
    const out: CommandAction[] = [];
    for (const p of this.providers) {
      try {
        out.push(...p());
      } catch {
        // A broken provider must not break the palette
      }
    }
    return out;
  }

  openPalette(): void {
    this.open.set(true);
  }

  closePalette(): void {
    this.open.set(false);
  }

  togglePalette(): void {
    this.open.update((v) => !v);
  }

  // ─── Recent entities (persisted) ─────────────────────────────────

  private static readonly RECENTS_KEY = 'fueld-recent-entities';
  private static readonly RECENTS_MAX = 5;

  recents(): PaletteEntity[] {
    try {
      const raw = localStorage.getItem(CommandPaletteService.RECENTS_KEY);
      const parsed = raw ? (JSON.parse(raw) as PaletteEntity[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  pushRecent(entity: PaletteEntity): void {
    if (entity.kind === 'place') return; // places are less useful as recents
    const next = [
      entity,
      ...this.recents().filter((r) => !(r.kind === entity.kind && r.id === entity.id)),
    ].slice(0, CommandPaletteService.RECENTS_MAX);
    try {
      localStorage.setItem(CommandPaletteService.RECENTS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
}