import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
  ElementRef,
  viewChild,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, PlaceDto, VesselDto } from '@fueld/types';
import { CommandPaletteService, type PaletteEntity } from './command-palette.service';

import { API } from '@app/core/config/api';

interface EntityResult {
  places: PlaceDto[];
  companies: Array<{ id: string; name: string; country?: string; types?: string[] }>;
  vessels: VesselDto[];
  orders: Array<{
    id?: string;
    orderNumber?: string;
    status?: string;
    clientName?: string;
    vesselName?: string;
    placeName?: string;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════
//  CommandPaletteComponent — ⌘K launcher.
//
//  One input drives everything: registered actions ("New Inquiry", theme,
//  density, navigation) and live entity search (orders, companies, vessels,
//  places) via the same endpoints as the old topbar search.
//
//  Keyboard: ⌘K/Ctrl+K toggle · ↑↓ move · ↵ run · Esc close.
//  Mobile: renders as a top sheet below the topbar; the search button in
//  the topbar opens it (palette button lives in main layout).
// ═══════════════════════════════════════════════════════════════════════

interface PaletteItem {
  key: string;
  section: string;
  icon: string | null;
  label: string;
  subtitle?: string;
  hint?: string;
  run: () => void | Promise<void>;
}

@Component({
  selector: 'app-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (palette.open()) {
      <div
        class="fixed inset-0 z-[200] bg-black/50 backdrop-blur-[3px]"
        (click)="close()"
        aria-hidden="true"
      ></div>
      <div
        class="palette fixed inset-x-2 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[201] mx-auto max-w-[600px] overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-2xl sm:inset-x-auto sm:top-[14vh] sm:left-1/2 sm:w-[min(600px,92vw)] sm:-translate-x-1/2"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <!-- Search input -->
        <div class="flex items-center gap-3 border-b border-line px-4">
          <svg class="h-4 w-4 shrink-0 text-muted" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clip-rule="evenodd"/>
          </svg>
          <input
            #searchInput
            type="text"
            class="w-full bg-transparent py-3.5 text-[0.95rem] text-ink outline-none placeholder:text-muted"
            placeholder="Search orders, vessels, companies, actions…"
            [value]="query()"
            (input)="onQuery($event)"
            (keydown)="onKeydown($event)"
            aria-label="Search or jump to"
          />
          @if (searching()) {
            <svg class="h-4 w-4 shrink-0 animate-spin text-muted" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          } @else {
            <kbd class="hidden shrink-0 rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted sm:block">esc</kbd>
          }
        </div>

        <!-- Results -->
        <div class="palette-results max-h-[min(56vh,420px)] overflow-y-auto overscroll-contain py-1.5">
          @for (group of grouped(); track group.section) {
            <p class="px-4 pb-1 pt-2 text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-muted">{{ group.section }}</p>
            @for (item of group.items; track item.key) {
              <button
                type="button"
                class="palette-item flex w-full items-center gap-3 px-4 py-2.5 text-left"
                [class.palette-item-selected]="isSelected(item)"
                (mouseenter)="select(item)"
                (click)="runItem(item)"
              >
                @if (item.icon) {
                  <svg class="h-4 w-4 shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" [attr.d]="item.icon"/>
                  </svg>
                } @else {
                  <span class="palette-glyph shrink-0" aria-hidden="true">{{ glyph(item) }}</span>
                }
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium text-ink">{{ item.label }}</span>
                  @if (item.subtitle) {
                    <span class="block truncate text-xs text-muted">{{ item.subtitle }}</span>
                  }
                </span>
                @if (item.hint) {
                  <kbd class="shrink-0 rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">{{ item.hint }}</kbd>
                }
              </button>
            }
          } @empty {
            <div class="px-4 py-8 text-center text-sm text-muted">
              @if (query().length >= 2 && !searching()) {
                No matches for “{{ query() }}”
              } @else {
                Type to search, or pick an action
              }
            </div>
          }
        </div>

        <!-- Footer -->
        <div class="flex items-center gap-3 border-t border-line bg-surface-2/60 px-4 py-2 text-[0.68rem] text-muted">
          <span><kbd class="palette-kbd">↑↓</kbd> navigate</span>
          <span><kbd class="palette-kbd">↵</kbd> open</span>
          <span class="ml-auto hidden sm:inline"><kbd class="palette-kbd">⌘K</kbd> toggle</span>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host { display: contents; }

      .palette {
        animation: palette-pop 0.14s ease-out;
      }
      @keyframes palette-pop {
        from { transform: translateX(var(--palette-tx, 0)) translateY(-8px) scale(0.985); opacity: 0; }
        to { opacity: 1; }
      }
      @media (min-width: 640px) {
        .palette { --palette-tx: -50%; }
      }

      .palette-item { border-radius: 0.5rem; transition: background 0.1s; }
      .palette-item-selected {
        background: color-mix(in srgb, var(--accent) 12%, transparent);
        box-shadow: inset 2px 0 0 var(--accent);
      }
      .palette-item-selected .palette-glyph { color: var(--accent); }
      .palette-glyph {
        display: grid;
        place-items: center;
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 0.375rem;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.62rem;
        font-weight: 700;
        color: var(--muted);
        background: var(--surface-tint-strong);
        text-transform: uppercase;
      }
      .palette-kbd {
        border: 1px solid var(--line);
        background: var(--surface-2);
        border-radius: 0.25rem;
        padding: 0.05rem 0.3rem;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.62rem;
      }
      .palette-results { scrollbar-width: thin; }
    `,
  ],
  host: {
    '(document:keydown)': 'onGlobalKeydown($event)',
  },
})
export class CommandPaletteComponent {
  protected readonly palette = inject(CommandPaletteService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  protected readonly query = signal('');
  protected readonly searching = signal(false);
  protected readonly entityResults = signal<PaletteEntity[]>([]);
  protected readonly selectedIndex = signal(0);

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchSeq = 0;

  private readonly recents = signal<PaletteEntity[]>([]);

  constructor() {
    // Re-read recents + refocus input each time the palette opens
    effect(() => {
      if (this.palette.open()) {
        this.recents.set(this.palette.recents());
        this.resetState();
        setTimeout(() => this.searchInput()?.nativeElement.focus(), 20);
      }
    });
  }

  // ─── Flat items model ────────────────────────────────────────────

  protected readonly items = computed<PaletteItem[]>(() => {
    const q = this.query().trim().toLowerCase();
    const out: PaletteItem[] = [];

    if (q.length < 2) {
      for (const r of this.recents()) {
        out.push(this.entityToItem(r, 'Recent'));
      }
      for (const a of this.palette.actions()) {
        out.push({
          key: `action:${a.id}`,
          section: a.section,
          icon: a.icon ?? null,
          label: a.label,
          hint: a.hint,
          run: a.run,
        });
      }
      return out;
    }

    // With a query: actions matched by label/keywords, then entities
    for (const a of this.palette.actions()) {
      const haystack = `${a.label} ${a.keywords ?? ''} ${a.section}`.toLowerCase();
      if (haystack.includes(q)) {
        out.push({
          key: `action:${a.id}`,
          section: a.section,
          icon: a.icon ?? null,
          label: a.label,
          hint: a.hint,
          run: a.run,
        });
      }
    }
    for (const e of this.entityResults()) {
      out.push(this.entityToItem(e, 'Search results'));
    }
    return out;
  });

  protected readonly grouped = computed(() => {
    const groups: Array<{ section: string; items: PaletteItem[] }> = [];
    for (const item of this.items()) {
      const last = groups[groups.length - 1];
      if (last && last.section === item.section) last.items.push(item);
      else groups.push({ section: item.section, items: [item] });
    }
    return groups;
  });

  private entityToItem(e: PaletteEntity, section: string): PaletteItem {
    const glyph = e.kind === 'order' ? 'FU' : e.kind === 'company' ? 'CO' : e.kind === 'vessel' ? 'MV' : 'PL';
    return {
      key: `${e.kind}:${e.id}`,
      section,
      icon: null,
      label: e.name,
      subtitle: e.subtitle,
      run: () => {
        this.palette.pushRecent(e);
        this.palette.closePalette();
        void this.router.navigate(e.route);
      },
    };
  }

  // ─── Interaction ─────────────────────────────────────────────────

  protected onQuery(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query.set(value);
    this.selectedIndex.set(0);

    if (this.searchTimer) clearTimeout(this.searchTimer);
    const term = value.trim();
    if (term.length < 2) {
      this.entityResults.set([]);
      this.searching.set(false);
      return;
    }
    this.searching.set(true);
    this.searchTimer = setTimeout(() => void this.executeEntitySearch(term), 250);
  }

  private async executeEntitySearch(term: string): Promise<void> {
    const seq = ++this.searchSeq;
    try {
      const [placesRes, companiesRes, vesselsRes, ordersRes] = await Promise.all([
        firstValueFrom(
          this.http.get<ApiResponse<{ places: PlaceDto[]; total: number }>>(
            `${API}/lloyds/places/local?search=${encodeURIComponent(term)}&limit=5`,
          ),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<{ companies: EntityResult['companies']; total: number }>>(
            `${API}/companies/local?search=${encodeURIComponent(term)}&limit=5`,
          ),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<{ vessels: VesselDto[]; total: number }>>(
            `${API}/vessels/local?search=${encodeURIComponent(term)}&limit=5`,
          ),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<{ items: EntityResult['orders']; total: number }>>(
            `${API}/orders?search=${encodeURIComponent(term)}&limit=5`,
          ),
        ),
      ]);

      if (seq !== this.searchSeq) return; // stale response

      const results: PaletteEntity[] = [];

      if (ordersRes.success && ordersRes.data?.items?.length) {
        for (const o of ordersRes.data.items) {
          const routeId = o.id ?? o.orderNumber;
          if (!routeId) continue;
          results.push({
            kind: 'order',
            id: String(routeId),
            name: o.orderNumber ?? String(o.id),
            subtitle: [o.status, o.clientName, o.vesselName, o.placeName].filter(Boolean).join(' · '),
            route: [orderListRouteForStatus(o.status), String(routeId)],
            orderStatus: o.status,
          });
        }
      }
      if (companiesRes.success && companiesRes.data?.companies?.length) {
        for (const c of companiesRes.data.companies) {
          results.push({
            kind: 'company',
            id: String(c.id),
            name: c.name,
            subtitle: [c.country, c.types?.join(', ')].filter(Boolean).join(' · '),
            route: ['/companies', String(c.id)],
          });
        }
      }
      if (vesselsRes.success && vesselsRes.data?.vessels?.length) {
        for (const v of vesselsRes.data.vessels) {
          results.push({
            kind: 'vessel',
            id: String(v.id),
            name: v.name,
            subtitle: [v.imo ? `IMO ${v.imo}` : null, v.flag, v.type].filter(Boolean).join(' · '),
            route: ['/vessels', String(v.id)],
          });
        }
      }
      if (placesRes.success && placesRes.data?.places?.length) {
        for (const p of placesRes.data.places) {
          results.push({
            kind: 'place',
            id: String(p.id),
            name: p.name,
            subtitle: [p.country, p.placeType].filter(Boolean).join(' · '),
            route: ['/places', String(p.id)],
          });
        }
      }

      this.entityResults.set(results);
    } catch {
      if (seq === this.searchSeq) this.entityResults.set([]);
    } finally {
      if (seq === this.searchSeq) this.searching.set(false);
    }
  }

  protected isSelected(item: PaletteItem): boolean {
    return this.items()[this.selectedIndex()]?.key === item.key;
  }

  protected select(item: PaletteItem): void {
    const idx = this.items().findIndex((i) => i.key === item.key);
    if (idx >= 0) this.selectedIndex.set(idx);
  }

  protected glyph(item: PaletteItem): string {
    const label = item.label;
    if (/^FU-\d/i.test(label)) return 'FU';
    const words = label.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return label.slice(0, 2).toUpperCase();
  }

  protected async runItem(item: PaletteItem): Promise<void> {
    this.palette.closePalette();
    try {
      await item.run();
    } catch {
      // Actions handle their own errors
    }
  }

  protected close(): void {
    this.palette.closePalette();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const items = this.items();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (items.length) this.selectedIndex.update((i) => (i + 1) % items.length);
      this.scrollSelectedIntoView();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length) this.selectedIndex.update((i) => (i - 1 + items.length) % items.length);
      this.scrollSelectedIntoView();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = items[this.selectedIndex()];
      if (item) void this.runItem(item);
    }
  }

  protected onGlobalKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.palette.togglePalette();
      return;
    }
    if (event.key === 'Escape' && this.palette.open()) {
      event.preventDefault();
      this.palette.closePalette();
    }
  }

  private resetState(): void {
    this.query.set('');
    this.entityResults.set([]);
    this.searching.set(false);
    this.selectedIndex.set(0);
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  private scrollSelectedIntoView(): void {
    setTimeout(() => {
      const el = document.querySelector('.palette-item-selected');
      el?.scrollIntoView({ block: 'nearest' });
    });
  }
}

function orderListRouteForStatus(status?: string): string {
  if (status === 'INQUIRY' || status === 'OFFER') return '/trading/inquiries';
  if (status === 'DELIVERED') return '/trading/delivered-orders';
  if (status === 'INVOICED') return '/trading/invoiced-orders';
  if (status === 'PAID') return '/trading/completed-orders';
  if (status === 'CANCELLED') return '/trading/cancelled-orders';
  return '/trading/orders';
}