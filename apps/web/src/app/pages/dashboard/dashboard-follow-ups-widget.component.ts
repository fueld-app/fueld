import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { DateLabelPipe } from '../../shared/pipes/date-format.pipe';
import type { DashboardFollowUpItem, FollowUpGroups } from './dashboard.types';

@Component({
  selector: 'app-dashboard-follow-ups-widget',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DateLabelPipe],
  template: `
    @if (groups().total) {
      <div class="mt-8 rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm overflow-hidden">
        <div class="border-b border-gray-100 dark:border-line px-5 py-3 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-500 dark:text-amber-300" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clip-rule="evenodd" />
          </svg>
          <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Follow-Ups</h3>
          <span class="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
            {{ groups().total }}
          </span>
        </div>
        <div class="border-b border-gray-100 dark:border-line px-5 py-3 flex flex-wrap gap-2 bg-gray-50/70">
          @if (groups().overdue.length) {
            <span class="inline-flex items-center rounded-full bg-red-100 dark:bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400">
              Overdue {{ groups().overdue.length }}
            </span>
          }
          @if (groups().dueToday.length) {
            <span class="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
              Due Today {{ groups().dueToday.length }}
            </span>
          }
          @if (groups().upcoming.length) {
            <span class="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400">
              Next {{ upcomingWindowDays() }} Days {{ groups().upcoming.length }}
            </span>
          }
        </div>
        <div class="divide-y divide-gray-100 dark:divide-line">

          <!-- Overdue -->
          @if (groups().overdue.length) {
            <div class="px-5 py-4">
              <div class="mb-3 flex items-center justify-between gap-3">
                <h4 class="text-xs font-semibold uppercase tracking-[0.12em] text-red-700 dark:text-red-400">Overdue</h4>
                <span class="inline-flex items-center rounded-full bg-red-100 dark:bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400">
                  {{ groups().overdue.length }}
                </span>
              </div>
              <div class="space-y-2">
                @for (f of groups().overdue; track f.id) {
                  <div class="flex items-center gap-4 rounded-lg border border-red-100 dark:border-red-500/25 bg-red-50/40 px-4 py-3">
                    <button
                      type="button"
                      (click)="open.emit(f)"
                      class="min-w-0 flex-1 rounded-md text-left transition-colors hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2"
                      title="Open related record"
                    >
                      <div class="flex items-center gap-2">
                        <span class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium bg-red-100 dark:bg-red-500/15 border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-400">
                          {{ f.followUpDate | dateLabel }}
                        </span>
                        <span class="text-xs uppercase tracking-wide text-gray-400 dark:text-muted">{{ f.entityType }}</span>
                        <span class="text-sm font-medium text-gray-900 dark:text-ink truncate">{{ f.entityName || f.entityId }}</span>
                      </div>
                      <p class="mt-0.5 text-xs text-gray-500 dark:text-muted line-clamp-1">{{ f.content }}</p>
                      <span class="text-[10px] text-gray-400 dark:text-muted">{{ f.userName }}</span>
                    </button>
                    <button
                      type="button"
                      (click)="complete.emit(f.id)"
                      class="shrink-0 rounded-full p-1.5 text-gray-400 dark:text-muted hover:bg-green-50 dark:hover:bg-green-500/15 hover:text-green-600 transition-colors"
                      title="Mark done"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                      </svg>
                    </button>
                  </div>
                }
              </div>
            </div>
          }

          <!-- Due Today -->
          @if (groups().dueToday.length) {
            <div class="px-5 py-4">
              <div class="mb-3 flex items-center justify-between gap-3">
                <h4 class="text-xs font-semibold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-400">Due Today</h4>
                <span class="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                  {{ groups().dueToday.length }}
                </span>
              </div>
              <div class="space-y-2">
                @for (f of groups().dueToday; track f.id) {
                  <div class="flex items-center gap-4 rounded-lg border border-amber-100 dark:border-amber-500/25 bg-amber-50/40 px-4 py-3">
                    <button
                      type="button"
                      (click)="open.emit(f)"
                      class="min-w-0 flex-1 rounded-md text-left transition-colors hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2"
                      title="Open related record"
                    >
                      <div class="flex items-center gap-2">
                        <span class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium bg-amber-100 dark:bg-amber-500/15 border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-400">
                          {{ f.followUpDate | dateLabel }}
                        </span>
                        <span class="text-xs uppercase tracking-wide text-gray-400 dark:text-muted">{{ f.entityType }}</span>
                        <span class="text-sm font-medium text-gray-900 dark:text-ink truncate">{{ f.entityName || f.entityId }}</span>
                      </div>
                      <p class="mt-0.5 text-xs text-gray-500 dark:text-muted line-clamp-1">{{ f.content }}</p>
                      <span class="text-[10px] text-gray-400 dark:text-muted">{{ f.userName }}</span>
                    </button>
                    <button
                      type="button"
                      (click)="complete.emit(f.id)"
                      class="shrink-0 rounded-full p-1.5 text-gray-400 dark:text-muted hover:bg-green-50 dark:hover:bg-green-500/15 hover:text-green-600 transition-colors"
                      title="Mark done"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                      </svg>
                    </button>
                  </div>
                }
              </div>
            </div>
          }

          <!-- Upcoming -->
          @if (groups().upcoming.length) {
            <div class="px-5 py-4">
              <div class="mb-3 flex items-center justify-between gap-3">
                <h4 class="text-xs font-semibold uppercase tracking-[0.12em] text-blue-700 dark:text-blue-400">Upcoming (Next {{ upcomingWindowDays() }} Days)</h4>
                <span class="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400">
                  {{ groups().upcoming.length }}
                </span>
              </div>
              <div class="space-y-2">
                @for (f of groups().upcoming; track f.id) {
                  <div class="flex items-center gap-4 rounded-lg border border-blue-100 dark:border-blue-500/25 bg-blue-50/40 px-4 py-3">
                    <button
                      type="button"
                      (click)="open.emit(f)"
                      class="min-w-0 flex-1 rounded-md text-left transition-colors hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2"
                      title="Open related record"
                    >
                      <div class="flex items-center gap-2">
                        <span class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium bg-blue-100 dark:bg-blue-500/15 border-blue-200 dark:border-blue-500/30 text-blue-700 dark:text-blue-400">
                          {{ f.followUpDate | dateLabel }}
                        </span>
                        <span class="text-xs uppercase tracking-wide text-gray-400 dark:text-muted">{{ f.entityType }}</span>
                        <span class="text-sm font-medium text-gray-900 dark:text-ink truncate">{{ f.entityName || f.entityId }}</span>
                      </div>
                      <p class="mt-0.5 text-xs text-gray-500 dark:text-muted line-clamp-1">{{ f.content }}</p>
                      <span class="text-[10px] text-gray-400 dark:text-muted">{{ f.userName }}</span>
                    </button>
                    <button
                      type="button"
                      (click)="complete.emit(f.id)"
                      class="shrink-0 rounded-full p-1.5 text-gray-400 dark:text-muted hover:bg-green-50 dark:hover:bg-green-500/15 hover:text-green-600 transition-colors"
                      title="Mark done"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                      </svg>
                    </button>
                  </div>
                }
              </div>
            </div>
          }

        </div>
      </div>
    }
  `,
})
export class DashboardFollowUpsWidgetComponent {
  readonly groups = input.required<FollowUpGroups>();
  readonly upcomingWindowDays = input(14);
  readonly open = output<DashboardFollowUpItem>();
  readonly complete = output<string>();
}