import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Dashboard</h1>
      <p class="mt-1 text-sm text-gray-500">Overview of your bunker trading operations.</p>
      <div class="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        @for (card of cards; track card.label) {
          <div class="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <p class="text-sm font-medium text-gray-500">{{ card.label }}</p>
            <p class="mt-2 text-3xl font-bold text-gray-900">{{ card.value }}</p>
          </div>
        }
      </div>
    </div>
  `,
})
export class DashboardPageComponent {
  readonly cards = [
    { label: 'Active Orders', value: '—' },
    { label: 'Revenue (MTD)', value: '—' },
    { label: 'Overdue Invoices', value: '—' },
    { label: 'Margin %', value: '—' },
  ];
}
