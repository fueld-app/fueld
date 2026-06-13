import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { DatePipe } from '@angular/common';

interface NameEntry { name: string; fromDate: string }

@Component({
  selector: 'app-name-history-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:order-12">
      <div class="border-b border-gray-100 px-5 py-3">
        <h2 class="text-sm font-semibold text-gray-700">Name History</h2>
      </div>
      <div class="divide-y divide-gray-50">
        @for (entry of entries(); track $index) {
          <div class="px-5 py-2.5 flex justify-between text-sm">
            <span class="text-gray-900">{{ entry.name }}</span>
            <span class="text-xs text-gray-400">{{ entry.fromDate | date:'mediumDate' }}</span>
          </div>
        }
      </div>
    </div>
  `,
})
export class NameHistoryCardComponent {
  readonly entries = input.required<NameEntry[]>();
}
