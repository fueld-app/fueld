import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';

interface SegmentCategory {
  key: string;
  label: string;
  mode: 'multi' | 'single';
  options: { key: string; label: string }[];
}

@Component({
  selector: 'app-segments-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm min-[900px]:order-[11]">
      <div class="border-b border-gray-100 dark:border-line px-5 py-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-gray-700 dark:text-ink-dim">Segments</h2>
        @if (saving()) { <span class="text-xs text-gray-400 dark:text-muted">Saving…</span> }
      </div>
      <div class="px-5 py-4 space-y-4">
        @for (cat of categories(); track cat.key) {
          <div>
            <label class="text-xs font-medium text-gray-500 dark:text-muted uppercase tracking-wide">{{ cat.label }}</label>
            @if (cat.mode === 'multi') {
              <div class="mt-1.5 flex flex-wrap gap-2">
                @for (opt of cat.options; track opt.key) {
                  <button
                    (click)="toggle.emit({ catKey: cat.key, optKey: opt.key, mode: 'multi' })"
                    [class]="isSelected(cat.key, opt.key)
                      ? 'rounded-full px-3 py-1 text-xs font-medium bg-violet-100 dark:bg-violet-500/15 text-violet-800 dark:text-violet-300 ring-1 ring-violet-300 dark:ring-violet-500/40'
                      : 'rounded-full px-3 py-1 text-xs font-medium bg-gray-100 dark:bg-surface-3 text-gray-600 dark:text-ink-dim ring-1 ring-gray-200 dark:ring-line hover:bg-gray-200'"
                  >{{ opt.label }}</button>
                }
              </div>
            } @else {
              <div class="mt-1.5 flex flex-wrap gap-2">
                @for (opt of cat.options; track opt.key) {
                  <button
                    (click)="toggle.emit({ catKey: cat.key, optKey: opt.key, mode: 'single' })"
                    [class]="getValue(cat.key) === opt.key
                      ? 'rounded-full px-3 py-1 text-xs font-medium bg-violet-100 dark:bg-violet-500/15 text-violet-800 dark:text-violet-300 ring-1 ring-violet-300 dark:ring-violet-500/40'
                      : 'rounded-full px-3 py-1 text-xs font-medium bg-gray-100 dark:bg-surface-3 text-gray-600 dark:text-ink-dim ring-1 ring-gray-200 dark:ring-line hover:bg-gray-200'"
                  >{{ opt.label }}</button>
                }
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class SegmentsCardComponent {
  readonly categories = input.required<SegmentCategory[]>();
  readonly segments = input<Record<string, string | string[]>>({});
  readonly saving = input<boolean>(false);

  readonly toggle = output<{ catKey: string; optKey: string; mode: 'multi' | 'single' }>();

  isSelected(catKey: string, optKey: string): boolean {
    const val = this.segments()[catKey];
    return Array.isArray(val) ? val.includes(optKey) : val === optKey;
  }

  getValue(catKey: string): string | undefined {
    const val = this.segments()[catKey];
    return typeof val === 'string' ? val : undefined;
  }
}
