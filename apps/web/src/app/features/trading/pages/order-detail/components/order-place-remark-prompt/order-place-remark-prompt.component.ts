import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
} from '@angular/core';

@Component({
  selector: 'app-order-place-remark-prompt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div class="w-full max-w-md rounded-xl bg-white dark:bg-surface p-6 shadow-xl">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-ink">Update place remark?</h3>
            <button type="button" (click)="dismiss()" class="text-gray-400 dark:text-muted hover:text-gray-600">✕</button>
          </div>
          <p class="mt-3 text-sm text-gray-600 dark:text-ink-dim">
            The new place has a different default remark. Would you like to update the order's place remark to match?
          </p>
          @if (pendingRemark(); as remark) {
            <div class="mt-3 rounded-lg border border-gray-200 dark:border-line bg-gray-50 dark:bg-bg-2 p-3 text-sm text-gray-700 dark:text-ink-dim whitespace-pre-line max-h-32 overflow-y-auto">
              {{ remark }}
            </div>
          } @else {
            <p class="mt-3 text-sm text-gray-400 dark:text-muted italic">The new place has no default remark.</p>
          }
          <div class="mt-5 flex items-center justify-end gap-3">
            <button type="button" (click)="dismiss()"
              class="rounded-lg border border-gray-200 dark:border-line px-4 py-2 text-sm font-semibold text-gray-600 dark:text-ink-dim">Keep current</button>
            <button type="button" (click)="apply()"
              class="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-800">
              {{ pendingRemark() ? 'Use new remark' : 'Clear remark' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class OrderPlaceRemarkPromptComponent {
  readonly pendingRemark = input<string | null>(null);

  readonly open = signal(false);
  readonly applied = output<void>();
  readonly dismissed = output<void>();

  show(): void { this.open.set(true); }
  protected dismiss(): void { this.open.set(false); this.dismissed.emit(); }
  protected apply(): void { this.open.set(false); this.applied.emit(); }
}
