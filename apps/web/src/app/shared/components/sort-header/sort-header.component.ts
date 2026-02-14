import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';

// ═══════════════════════════════════════════════════════════════════════
//  Sort Header — Clickable column header with ascending/descending arrows
//
//  Usage:
//    <th app-sort-header field="name" [sortBy]="sortBy()" [sortDir]="sortDir()"
//        (sortChange)="onSort($event)">Name</th>
// ═══════════════════════════════════════════════════════════════════════

export interface SortChangeEvent {
  field: string;
  dir: 'asc' | 'desc';
}

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'th[app-sort-header]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(click)': 'toggle()',
    class: 'cursor-pointer select-none',
  },
  template: `
    <div class="flex items-center gap-1">
      <ng-content />
      <span class="inline-flex flex-col -space-y-1 text-[10px] leading-none">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
          class="h-3 w-3 transition-colors"
          [class.text-brand-600]="sortBy() === field() && sortDir() === 'asc'"
          [class.text-gray-300]="sortBy() !== field() || sortDir() !== 'asc'">
          <path fill-rule="evenodd" d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.832 6.29 12.77a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z" clip-rule="evenodd" />
        </svg>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
          class="h-3 w-3 transition-colors"
          [class.text-brand-600]="sortBy() === field() && sortDir() === 'desc'"
          [class.text-gray-300]="sortBy() !== field() || sortDir() !== 'desc'">
          <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
        </svg>
      </span>
    </div>
  `,
})
export class SortHeaderComponent {
  /** Column key sent to the API (e.g. "name", "createdAt") */
  readonly field = input.required<string>();

  /** Currently active sort field */
  readonly sortBy = input<string>('');

  /** Currently active sort direction */
  readonly sortDir = input<'asc' | 'desc'>('asc');

  /** Emitted when the user clicks this header */
  readonly sortChange = output<SortChangeEvent>();

  toggle(): void {
    const current = this.sortBy();
    const f = this.field();

    if (current === f) {
      // Toggle direction
      this.sortChange.emit({ field: f, dir: this.sortDir() === 'asc' ? 'desc' : 'asc' });
    } else {
      // New column — default to ascending
      this.sortChange.emit({ field: f, dir: 'asc' });
    }
  }
}
