import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

// ═══════════════════════════════════════════════════════════════════════
//  Column Picker — Dropdown to show/hide/reorder table columns
// ═══════════════════════════════════════════════════════════════════════

export interface ColumnOption {
  field: string;
  label: string;
  sortable?: boolean;
}

@Component({
  selector: 'app-column-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="relative inline-block">
      <button
        type="button"
        (click)="open.set(!open())"
        class="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-3 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim shadow-sm hover:bg-gray-50 dark:hover:bg-surface-tint"
        [attr.aria-expanded]="open()"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500 dark:text-muted" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 3.75a2 2 0 10-4 0 2 2 0 004 0zM17.25 4.5a.75.75 0 000-1.5h-5.043a.75.75 0 000 1.5h5.043zM5.5 6.25a.75.75 0 01-.75.75h-3.5a.75.75 0 010-1.5h3.5a.75.75 0 01.75.75zM17.25 7.5a.75.75 0 000-1.5h-1.5a.75.75 0 000 1.5h1.5zM5.5 10.25a.75.75 0 01-.75.75h-3.5a.75.75 0 010-1.5h3.5a.75.75 0 01.75.75zM17.25 10.5a.75.75 0 000-1.5h-1.5a.75.75 0 000 1.5h1.5zM5.5 13.25a.75.75 0 01-.75.75h-3.5a.75.75 0 010-1.5h3.5a.75.75 0 01.75.75zM17.25 14.5a.75.75 0 000-1.5h-1.5a.75.75 0 000 1.5h1.5zM8 14a2 2 0 100-4 2 2 0 000 4zM14.25 12.75a.75.75 0 000-1.5h-5.043a.75.75 0 000 1.5h5.043z" />
        </svg>
        Columns
      </button>

      @if (open()) {
        <div
          class="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-3 shadow-lg"
          (click)="$event.stopPropagation()"
        >
          <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-muted">Visible columns</p>
          <div class="max-h-72 space-y-1 overflow-y-auto">
            @for (col of orderedColumns(); track col.field) {
              <div class="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-gray-50 dark:hover:bg-surface-tint">
                <input
                  type="checkbox"
                  [id]="'col-' + col.field"
                  [checked]="isVisible(col.field)"
                  (change)="toggleVisibility(col.field)"
                  class="h-4 w-4 rounded border-gray-300 dark:border-line-strong text-brand-600 dark:text-brand-400 focus:ring-brand-600"
                />
                <label [for]="'col-' + col.field" class="flex-1 cursor-pointer text-sm text-gray-700 dark:text-ink-dim">
                  {{ col.label }}
                </label>
                <div class="flex flex-col gap-0.5">
                  <button
                    type="button"
                    (click)="moveUp(col.field)"
                    [disabled]="!canMoveUp(col.field)"
                    class="rounded p-0.5 text-gray-400 dark:text-muted hover:bg-gray-100 dark:hover:bg-surface-tint-strong hover:text-gray-600 disabled:opacity-30"
                    title="Move up"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.832 6.29 12.77a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z" clip-rule="evenodd" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    (click)="moveDown(col.field)"
                    [disabled]="!canMoveDown(col.field)"
                    class="rounded p-0.5 text-gray-400 dark:text-muted hover:bg-gray-100 dark:hover:bg-surface-tint-strong hover:text-gray-600 disabled:opacity-30"
                    title="Move down"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class ColumnPickerComponent {
  readonly columns = input.required<ColumnOption[]>();
  readonly visible = input.required<string[]>();
  readonly order = input.required<string[]>();

  readonly visibleChange = output<string[]>();
  readonly orderChange = output<string[]>();

  readonly open = signal(false);

  readonly orderedColumns = computed(() => {
    const orderMap = new Map(this.order().map((f, i) => [f, i]));
    return [...this.columns()].sort((a, b) => {
      const ai = orderMap.get(a.field) ?? 999;
      const bi = orderMap.get(b.field) ?? 999;
      return ai - bi;
    });
  });

  isVisible(field: string): boolean {
    return this.visible().includes(field);
  }

  toggleVisibility(field: string): void {
    const current = new Set(this.visible());
    if (current.has(field)) {
      current.delete(field);
    } else {
      current.add(field);
    }
    this.visibleChange.emit(Array.from(current));
  }

  moveUp(field: string): void {
    const current = [...this.order()];
    const idx = current.indexOf(field);
    if (idx > 0) {
      [current[idx], current[idx - 1]] = [current[idx - 1], current[idx]];
      this.orderChange.emit(current);
    }
  }

  moveDown(field: string): void {
    const current = [...this.order()];
    const idx = current.indexOf(field);
    if (idx >= 0 && idx < current.length - 1) {
      [current[idx], current[idx + 1]] = [current[idx + 1], current[idx]];
      this.orderChange.emit(current);
    }
  }

  canMoveUp(field: string): boolean {
    return this.order().indexOf(field) > 0;
  }

  canMoveDown(field: string): boolean {
    const idx = this.order().indexOf(field);
    return idx >= 0 && idx < this.order().length - 1;
  }
}
