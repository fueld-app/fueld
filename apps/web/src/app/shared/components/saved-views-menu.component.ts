import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
  computed,
  effect,
  HostListener,
  OnInit,
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SavedViewsService, type SavedView } from '@app/core/ui/saved-views.service';
import { ToastService } from '@app/core/ui/toast.service';

// ═══════════════════════════════════════════════════════════════════════
//  SavedViewsMenuComponent — "Views ▾" dropdown for list pages.
//
//  Lets users save the current search/filter/sort state under a name,
//  re-apply it later, delete it (with Undo), and share the view via a
//  `?view=<name>` query param (restored on the same browser/profile).
//
//  The host page owns the state shape; it passes a `snapshot()` getter and
//  receives whole snapshots back through `applyView`.
// ═══════════════════════════════════════════════════════════════════════

@Component({
  selector: 'app-saved-views-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="relative" (keydown.escape)="menuOpen.set(false)">
      <button
        type="button"
        (click)="toggleMenu()"
        class="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint transition-colors"
        [attr.aria-expanded]="menuOpen()"
        aria-haspopup="listbox"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5zM10 14a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
        </svg>
        Views
        @if (activeViewName()) {
          <span class="max-w-[10rem] truncate rounded-full bg-brand-100 dark:bg-brand-700/25 px-2 py-0.5 text-[10px] font-semibold text-brand-700 dark:text-brand-300">
            {{ activeViewName() }}
          </span>
        }
      </button>

      @if (menuOpen()) {
        <div class="fixed inset-0 z-40" (click)="menuOpen.set(false)"></div>
        <div
          class="fixed inset-x-2 top-[10vh] z-50 mx-auto w-[calc(100vw-1rem)] max-w-[320px] rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-xl sm:absolute sm:inset-x-auto sm:left-0 sm:top-auto sm:mt-2 sm:w-80"
          role="listbox"
          aria-label="Saved views"
        >
          <div class="border-b border-gray-100 dark:border-line px-4 py-3">
            <p class="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-muted">Saved views</p>
          </div>

          <!-- Views list -->
          <div class="max-h-64 overflow-y-auto overscroll-contain py-1">
            @for (view of savedViews(); track view.id) {
              <div
                class="group flex items-center gap-1 px-2 py-0.5"
                role="option"
                [attr.aria-selected]="activeViewName() === view.name"
              >
                <button
                  type="button"
                  (click)="applyViewInternal(view)"
                  class="flex-1 truncate rounded-md px-2 py-2 text-left text-sm transition-colors"
                  [class.font-semibold]="activeViewName() === view.name"
                  [class.text-brand-700]="activeViewName() === view.name"
                  [class.dark:text-brand-400]="activeViewName() === view.name"
                  [class.text-gray-700]="activeViewName() !== view.name"
                  [class.dark:text-ink-dim]="activeViewName() !== view.name"
                  [class.hover:bg-gray-50]="activeViewName() !== view.name"
                  [class.dark:hover:bg-surface-tint]="activeViewName() !== view.name"
                >
                  {{ view.name }}
                </button>
                <button
                  type="button"
                  (click)="deleteView(view)"
                  class="rounded-md p-1.5 text-gray-300 opacity-0 transition-opacity hover:text-red-500 focus:opacity-100 group-hover:opacity-100 dark:text-muted dark:hover:text-red-400"
                  [attr.aria-label]="'Delete view ' + view.name"
                  title="Delete view"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.296a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.25 2.25 0 002.241-2.057l.841-10.518.149.022a.75.75 0 00.23-1.482l-.623-.093-.01-.001-.026-.004-.04-.005-.04-.005-.039-.004-.038-.004-.037-.003-.037-.003-.036-.002-.035-.002-.034-.002-.034-.002-.033-.001-.032-.001-.032-.001-.031-.001-.03-.001-.03-.001-.03-.001-.029-.001-.028-.001-.028-.001-.027-.001-.027-.001-.027-.001-.026-.001-.025-.001-.026-.001-.025-.001-.024-.001-.025-.001-.024-.001-.023-.001-.024-.001-.023-.001-.022-.001-.022-.001-.022-.001-.021-.001-.021-.001-.021-.001-.02-.001-.02-.001-.02-.001-.019-.001-.019-.001-.019-.001-.018-.001-.018-.001-.018-.001-.017-.001-.017-.001-.017-.001-.017-.001-.016-.001-.016-.001-.015-.001-.015-.001-.015-.001-.015-.001-.014-.001-.014-.001-.013-.001-.013-.001-.013-.001-.013-.001-.012-.001-.012-.001-.011-.001-.011-.001-.011-.001-.011-.001-.01-.001-.01-.001-.009-.001-.01-.001-.009-.001-.008-.001-.009-.001-.008-.001-.008-.001-.007-.001-.008-.001-.007-.001-.007-.001-.006-.001-.007-.001-.006-.001-.006-.001-.005-.001-.006-.001-.005-.001-.005-.001-.005-.001-.004-.001-.004-.001-.004-.001-.004-.001-.003-.001-.003-.001-.003-.001-.003-.001-.002-.001-.002-.001-.002-.001-.002-.001-.001-.001-.002-.001-.001-.001-.001-.001-.001-.001z" clip-rule="evenodd" />
                    <path d="M10 5.25a.75.75 0 01.75.75v6a.75.75 0 01-1.5 0v-6a.75.75 0 01.75-.75z" />
                  </svg>
                </button>
              </div>
            } @empty {
              <p class="px-4 py-4 text-center text-xs text-gray-400 dark:text-muted">
                No saved views yet.<br />Set up filters, then save them here.
              </p>
            }
          </div>

          <!-- Save current state -->
          <div class="border-t border-gray-100 dark:border-line p-3">
            <label class="sr-only" for="view-name">View name</label>
            <div class="flex gap-2">
              <input
                id="view-name"
                type="text"
                class="h-9 min-w-0 flex-1 rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface-2 px-2.5 text-sm text-gray-800 dark:text-ink placeholder:text-gray-400 dark:placeholder:text-muted focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
                placeholder="Save current as…"
                [ngModel]="newName()"
                (ngModelChange)="newName.set($event)"
                (keydown.enter)="saveCurrent()"
              />
              <button
                type="button"
                (click)="saveCurrent()"
                class="h-9 shrink-0 rounded-lg bg-brand-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-brand-700"
              >
                Save
              </button>
            </div>
            @if (nameError()) {
              <p class="mt-1.5 text-[11px] text-red-500">{{ nameError() }}</p>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class SavedViewsMenuComponent implements OnInit {
  /** Stable key identifying the page, e.g. 'filter_active-orders'. */
  readonly pageKey = input.required<string>();
  /** Current page state snapshot (search/filters/sort) to persist. */
  readonly snapshot = input<() => Record<string, unknown>>(() => ({}));

  /** Emitted when the user picks a view; payload is the stored state. */
  readonly applyView = output<Record<string, unknown>>();

  private readonly views = inject(SavedViewsService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  // Optional: the menu can render outside an ActivatedRoute context (tests, embedded shells)
  private readonly route = inject(ActivatedRoute, { optional: true });

  readonly menuOpen = signal(false);
  readonly newName = signal('');
  readonly nameError = signal<string | null>(null);
  readonly activeViewName = signal<string | null>(null);

  readonly savedViews = computed(() => this.views.viewsFor(this.pageKey()));

  ngOnInit(): void {
    // Restore from ?view= deep link (shareable on the same browser/profile)
    const viewParam = this.route?.snapshot?.queryParamMap?.get('view');
    if (viewParam) {
      const view = this.views.findByName(this.pageKey(), viewParam);
      if (view) {
        this.activeViewName.set(view.name);
        this.applyView.emit(view.state);
      } else {
        this.toast.info(`View "${viewParam}" not found on this device.`);
      }
    }
  }

  toggleMenu(): void {
    const opening = !this.menuOpen();
    this.menuOpen.set(opening);
    if (opening) this.nameError.set(null);
  }

  /** Close on document-level Escape (matches the filter overlay behaviour). */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.menuOpen()) this.menuOpen.set(false);
  }

  saveCurrent(): void {
    const name = this.newName().trim();
    if (name.length > 40) {
      this.nameError.set('Keep names under 40 characters.');
      return;
    }
    const view = this.views.save(this.pageKey(), name || 'View', this.snapshot()());
    this.activeViewName.set(view.name);
    this.newName.set('');
    this.nameError.set(null);
    this.syncUrl(view.name);
    this.menuOpen.set(false);
    this.toast.success(`View “${view.name}” saved`);
  }

  applyViewInternal(view: SavedView): void {
    this.activeViewName.set(view.name);
    this.menuOpen.set(false);
    this.applyView.emit(view.state);
    this.syncUrl(view.name);
  }

  deleteView(view: SavedView): void {
    const removed = this.views.delete(this.pageKey(), view.id);
    if (!removed) return;
    if (this.activeViewName() === view.name) this.activeViewName.set(null);
    this.toast.show(`View “${view.name}” deleted`, {
      type: 'info',
      action: {
        label: 'Undo',
        run: () => this.views.restore(this.pageKey(), removed),
      },
    });
  }

  /** Page calls this when the user manually changes filters/search. */
  clearActiveView(): void {
    this.activeViewName.set(null);
  }

  private syncUrl(name: string): void {
    if (!this.route) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { view: name },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

}
