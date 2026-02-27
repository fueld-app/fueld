import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';

@Component({
  selector: 'app-trading-detail-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusBadgeComponent],
  template: `
    <div class="mb-6">
      <!-- Breadcrumb -->
      <nav class="mb-4 flex items-center gap-1.5 text-sm text-gray-500">
        <a [routerLink]="breadcrumbLink()" class="hover:text-brand-600 transition-colors">{{ breadcrumbLabel() }}</a>
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fill-rule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
        </svg>
        <span class="text-gray-900 font-medium">{{ displayId() }}</span>
      </nav>

      <!-- Title row -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div class="flex items-center gap-3">
            <h1 class="text-2xl font-bold text-gray-900">{{ title() }}</h1>
            <app-status-badge [status]="status()" />
          </div>
          <div class="mt-1 flex items-center gap-2 text-sm text-gray-500">
            <p>
              @if (entityNumber()) {
                <span class="font-mono text-gray-600">{{ entityNumber() }}</span>
                @if (subtitle().trim()) {
                  <span class="mx-1.5">·</span>
                }
              }
              {{ subtitle() }}
            </p>
            <ng-content select="[subtitle-extra]"></ng-content>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <!-- Save button -->
          @if (showSave()) {
            <button
              (click)="saveClicked.emit()"
              [disabled]="saveDisabled()"
              class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold
                     text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50
                     focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
            >
              @if (saving()) {
                <svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              }
              Save
            </button>
          }

          <!-- Autosave indicator -->
          @if (showAutosave()) {
            <div class="flex items-center gap-2 text-sm text-gray-500">
              @if (autoSaving()) {
                <svg class="h-4 w-4 animate-spin text-brand-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                <span>Saving...</span>
              } @else if (lastSaved()) {
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-green-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd" />
                </svg>
                <span>Saved</span>
              }
            </div>
          }

          <ng-content select="[detail-actions]"></ng-content>
        </div>
      </div>
    </div>
  `,
})
export class TradingDetailHeaderComponent {
  readonly title = input.required<string>();
  readonly breadcrumbLabel = input.required<string>();
  readonly breadcrumbLink = input.required<string>();
  readonly entityNumber = input<string | null>(null);
  readonly fallbackId = input.required<string>();
  readonly status = input.required<string>();
  readonly subtitle = input.required<string>();
  readonly showSave = input<boolean>(false);
  readonly saveDisabled = input<boolean>(false);
  readonly saving = input<boolean>(false);
  readonly showAutosave = input<boolean>(true);
  readonly autoSaving = input<boolean>(false);
  readonly lastSaved = input<Date | null>(null);

  readonly saveClicked = output<void>();

  displayId(): string {
    const number = this.entityNumber();
    if (number) return number;
    const fallback = this.fallbackId();
    return fallback ? `${fallback.slice(0, 8)}...` : '—';
  }
}
