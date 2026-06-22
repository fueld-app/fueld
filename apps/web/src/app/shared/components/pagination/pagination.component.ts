import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  computed,
} from '@angular/core';

// ═══════════════════════════════════════════════════════════════════════
//  Pagination — Numbered page navigation with first/last buttons
// ═══════════════════════════════════════════════════════════════════════

export type PageItem = { type: 'page'; page: number } | { type: 'ellipsis' };

@Component({
  selector: 'app-pagination',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (totalPages() > 1) {
      <div class="mt-4 flex items-center justify-between text-sm text-gray-600 dark:text-ink-dim">
        <span>Showing {{ rangeStart() }}–{{ rangeEnd() }} of {{ totalItems() }}</span>
        <div class="flex items-center gap-1">
          <!-- First -->
          <button (click)="goTo(1)" [disabled]="currentPage() <= 1"
            class="rounded-md border border-gray-300 dark:border-line-strong px-2 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-surface-tint disabled:opacity-40 disabled:cursor-not-allowed"
            title="First page">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M15.707 15.707a1 1 0 01-1.414 0l-5-5a1 1 0 010-1.414l5-5a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 010 1.414zm-6 0a1 1 0 01-1.414 0l-5-5a1 1 0 010-1.414l5-5a1 1 0 011.414 1.414L5.414 10l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd" />
            </svg>
          </button>

          <!-- Previous -->
          <button (click)="goTo(currentPage() - 1)" [disabled]="currentPage() <= 1"
            class="rounded-md border border-gray-300 dark:border-line-strong px-2 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-surface-tint disabled:opacity-40 disabled:cursor-not-allowed"
            title="Previous page">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd" />
            </svg>
          </button>

          <!-- Page numbers -->
          @for (item of pageItems(); track $index) {
            @if (item.type === 'ellipsis') {
              <span class="px-1.5 py-1.5 text-xs text-gray-400 dark:text-muted">…</span>
            } @else {
              <button (click)="goTo(item.page)" [disabled]="item.page === currentPage()"
                [class]="item.page === currentPage()
                  ? 'rounded-md border border-blue-500 bg-blue-50 dark:bg-blue-500/15 px-2.5 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-400'
                  : 'rounded-md border border-gray-300 dark:border-line-strong px-2.5 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-surface-tint'">
                {{ item.page }}
              </button>
            }
          }

          <!-- Next -->
          <button (click)="goTo(currentPage() + 1)" [disabled]="currentPage() >= totalPages()"
            class="rounded-md border border-gray-300 dark:border-line-strong px-2 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-surface-tint disabled:opacity-40 disabled:cursor-not-allowed"
            title="Next page">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
            </svg>
          </button>

          <!-- Last -->
          <button (click)="goTo(totalPages())" [disabled]="currentPage() >= totalPages()"
            class="rounded-md border border-gray-300 dark:border-line-strong px-2 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-surface-tint disabled:opacity-40 disabled:cursor-not-allowed"
            title="Last page">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4.293 15.707a1 1 0 010-1.414L8.586 10 4.293 5.707a1 1 0 011.414-1.414l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0zm6 0a1 1 0 01-1.414 0l5-5a1 1 0 010-1.414l-5-5a1 1 0 011.414 1.414L14.586 10l-4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd" />
            </svg>
          </button>
        </div>
      </div>
    }
  `,
})
export class PaginationComponent {
  /** Current active page (1-based) */
  readonly currentPage = input.required<number>();
  /** Total number of items */
  readonly totalItems = input.required<number>();
  /** Items per page */
  readonly pageSize = input<number>(25);

  /** Emits the new page number when user navigates */
  readonly pageChange = output<number>();

  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalItems() / this.pageSize()))
  );

  readonly rangeStart = computed(() => {
    const total = this.totalItems();
    if (total === 0) return 0;
    return (this.currentPage() - 1) * this.pageSize() + 1;
  });

  readonly rangeEnd = computed(() =>
    Math.min(this.currentPage() * this.pageSize(), this.totalItems())
  );

  readonly pageItems = computed<PageItem[]>(() => {
    const total = this.totalPages();
    const current = this.currentPage();
    const items: PageItem[] = [];

    if (total <= 7) {
      // Show all pages
      for (let i = 1; i <= total; i++) {
        items.push({ type: 'page', page: i });
      }
      return items;
    }

    // Always show first page
    items.push({ type: 'page', page: 1 });

    if (current > 3) {
      items.push({ type: 'ellipsis' });
    }

    // Show pages around current
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);

    for (let i = start; i <= end; i++) {
      items.push({ type: 'page', page: i });
    }

    if (current < total - 2) {
      items.push({ type: 'ellipsis' });
    }

    // Always show last page
    items.push({ type: 'page', page: total });

    return items;
  });

  goTo(page: number): void {
    const clamped = Math.max(1, Math.min(page, this.totalPages()));
    if (clamped !== this.currentPage()) {
      this.pageChange.emit(clamped);
    }
  }
}
