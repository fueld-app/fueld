import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DateLabelPipe } from '@app/shared/pipes/date-format.pipe';

interface NameEntry { name: string; fromDate: string }

@Component({
  selector: 'app-name-history-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DateLabelPipe, DatePipe],
  template: `
    <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm min-[900px]:order-12">
      <div class="border-b border-gray-100 dark:border-line px-5 py-3">
        <h2 class="text-sm font-semibold text-gray-700 dark:text-ink-dim">Name History</h2>
      </div>
      <div class="divide-y divide-gray-50">
        @for (entry of entries(); track $index) {
          <div class="px-5 py-2.5 flex justify-between text-sm">
            <span class="text-gray-900 dark:text-ink">{{ entry.name }}</span>
            <span class="text-xs text-gray-400 dark:text-muted">{{ entry.fromDate | dateLabel }}</span>
          </div>
        }
      </div>
    </div>
  `,
})
export class NameHistoryCardComponent {
  readonly entries = input.required<NameEntry[]>();
}
