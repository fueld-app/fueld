import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import type { SavedReportViewDto } from '@fueld/types';

@Component({
  selector: 'app-reports-saved-views-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 class="text-lg font-semibold text-gray-900">Saved Views</h2>
          <p class="text-sm text-gray-500">Store a shared filter preset for repeated reporting cuts.</p>
        </div>
        @if (canManage()) {
          <div class="flex w-full flex-col gap-3 lg:w-auto lg:min-w-[420px]">
            <div class="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <input type="text" [value]="viewName()" (input)="onViewNameInput($event)" placeholder="View name" class="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
              <input type="text" [value]="viewDescription()" (input)="onViewDescInput($event)" placeholder="Description (optional)" class="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
              <div class="flex gap-2">
                <button type="button" (click)="save.emit()" [disabled]="saving() || !viewName().trim()" class="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60">
                  {{ saving() ? 'Saving…' : editing() ? 'Update view' : 'Save view' }}
                </button>
                @if (editing()) {
                  <button type="button" (click)="cancel.emit()" class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
                    Cancel
                  </button>
                }
              </div>
            </div>
          </div>
        }
      </div>

      <div class="mt-4 flex flex-wrap gap-3">
        @for (view of views(); track view.id) {
          <div class="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <button type="button" (click)="apply.emit(view)" class="text-left">
              <div class="text-sm font-medium text-gray-900">{{ view.name }}</div>
              <div class="text-xs text-gray-500">{{ view.description || 'Shared preset' }}</div>
            </button>
            @if (canManage()) {
              <button type="button" (click)="edit.emit(view)" class="rounded-md px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-white">
                Edit
              </button>
              <button type="button" (click)="deleteView.emit(view.id)" class="rounded-md px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50">
                Delete
              </button>
            }
          </div>
        } @empty {
          <p class="text-sm text-gray-500">No shared views saved yet.</p>
        }
      </div>
    </section>
  `,
})
export class ReportsSavedViewsCardComponent {
  readonly canManage = input(false);
  readonly saving = input(false);
  readonly editing = input(false);
  readonly viewName = input('');
  readonly viewDescription = input('');
  readonly views = input<SavedReportViewDto[]>([]);
  readonly save = output<void>();
  readonly cancel = output<void>();
  readonly apply = output<SavedReportViewDto>();
  readonly edit = output<SavedReportViewDto>();
  readonly deleteView = output<string>();
  readonly viewNameChange = output<string>();
  readonly viewDescriptionChange = output<string>();

  onViewNameInput(event: Event): void {
    this.viewNameChange.emit(((event.target as HTMLInputElement).value || '').trimStart());
  }

  onViewDescInput(event: Event): void {
    this.viewDescriptionChange.emit(((event.target as HTMLInputElement).value || '').trimStart());
  }
}