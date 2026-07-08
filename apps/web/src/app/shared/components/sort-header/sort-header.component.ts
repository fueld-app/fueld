import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';

// ═══════════════════════════════════════════════════════════════════════
//  Sort Header — Clickable column header with ascending/descending arrows
//
//  Supports multi-column sorting:
//  - Click: if already sorted, toggle direction; otherwise replace all
//    sorts with this column (ascending).
//  - Shift+Click: add/remove this column to/from the sort stack.
//
//  Usage (single-sort, backwards compatible):
//    <th app-sort-header field="name" [sortBy]="sortBy()" [sortDir]="sortDir()"
//        (sortChange)="onSort($event)">Name</th>
//
//  Usage (multi-sort):
//    <th app-sort-header field="name" [sortFields]="sortFields()"
//        (sortChange)="onSort($event)">Name</th>
// ═══════════════════════════════════════════════════════════════════════

export interface SortChangeEvent {
  field: string;
  dir: 'asc' | 'desc';
  /** True when the user shift-clicked (additive multi-sort). */
  additive?: boolean;
}

export interface SortField {
  field: string;
  dir: 'asc' | 'desc';
}

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'th[app-sort-header]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(click)': 'toggle($event)',
    class: 'cursor-pointer select-none',
  },
  template: `
    <div class="flex items-center gap-1">
      <ng-content />
      <span class="inline-flex flex-col -space-y-1 text-[10px] leading-none">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
          class="h-3 w-3 transition-colors"
          [class.text-brand-600]="isActive() && activeDir() === 'asc'"
          [class.text-gray-300]="!isActive() || activeDir() !== 'asc'">
          <path fill-rule="evenodd" d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.832 6.29 12.77a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z" clip-rule="evenodd" />
        </svg>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
          class="h-3 w-3 transition-colors"
          [class.text-brand-600]="isActive() && activeDir() === 'desc'"
          [class.text-gray-300]="!isActive() || activeDir() !== 'desc'">
          <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
        </svg>
      </span>
      @if (sortIndex() >= 0) {
        <span class="text-[10px] font-semibold text-brand-600">{{ sortIndex() + 1 }}</span>
      }
    </div>
  `,
})
export class SortHeaderComponent {
  /** Column key sent to the API (e.g. "name", "createdAt") */
  readonly field = input.required<string>();

  /** Currently active sort field (single-sort mode, backwards compatible) */
  readonly sortBy = input<string>('');

  /** Currently active sort direction (single-sort mode, backwards compatible) */
  readonly sortDir = input<'asc' | 'desc'>('asc');

  /** Multi-sort array. When provided, takes precedence over sortBy/sortDir. */
  readonly sortFields = input<SortField[] | null>(null);

  /** Emitted when the user clicks this header */
  readonly sortChange = output<SortChangeEvent>();

  /** Whether this column is currently being sorted. */
  isActive(): boolean {
    const multi = this.sortFields();
    if (multi !== null) {
      return multi.some((s) => s.field === this.field());
    }
    return this.sortBy() === this.field();
  }

  /** Current sort direction for this column, or 'asc' if not sorted. */
  activeDir(): 'asc' | 'desc' {
    const multi = this.sortFields();
    if (multi !== null) {
      return multi.find((s) => s.field === this.field())?.dir ?? 'asc';
    }
    return this.sortDir();
  }

  /** Index of this column in the multi-sort stack, or -1 if not sorted. */
  sortIndex(): number {
    const multi = this.sortFields();
    if (multi === null) {
      return this.sortBy() === this.field() ? 0 : -1;
    }
    return multi.findIndex((s) => s.field === this.field());
  }

  toggle(event: MouseEvent): void {
    event.shiftKey && event.preventDefault();
    const f = this.field();
    const additive = event.shiftKey;
    const currentDir = this.activeDir();

    if (this.isActive()) {
      if (additive) {
        // Shift+click on active column: remove it from the sort stack
        this.sortChange.emit({ field: f, dir: currentDir, additive: true });
      } else {
        // Regular click on active column: toggle direction (replacing all sorts)
        this.sortChange.emit({ field: f, dir: currentDir === 'asc' ? 'desc' : 'asc' });
      }
    } else {
      // New column
      this.sortChange.emit({ field: f, dir: 'asc', additive });
    }
  }
}
