import {
  Component,
  ChangeDetectionStrategy,
} from '@angular/core';
import { RouterLink } from '@angular/router';

// ═══════════════════════════════════════════════════════════════════════
//  Analytics Page — Funnel Chart and Loss Analysis Pie Chart
// ═══════════════════════════════════════════════════════════════════════

@Component({
  selector: 'app-analytics-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="mb-6">
      <!-- Breadcrumb -->
      <nav class="mb-4 flex items-center gap-1.5 text-sm text-gray-500">
        <a routerLink="/" class="hover:text-brand-600 transition-colors">Dashboard</a>
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fill-rule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
        </svg>
        <span class="text-gray-900 font-medium">Analytics</span>
      </nav>

      <!-- Title row -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Analytics</h1>
          <p class="mt-1 text-sm text-gray-500">Performance insights and loss analysis.</p>
        </div>
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <!-- Funnel Chart -->
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">Sales Funnel</h3>
        <p class="text-sm text-gray-500">No data available yet.</p>
      </div>

      <!-- Loss Analysis Pie Chart -->
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">Loss Analysis</h3>
        <p class="text-sm text-gray-500">No data available yet.</p>
      </div>
    </div>
  `,
})
export class AnalyticsPageComponent {}
