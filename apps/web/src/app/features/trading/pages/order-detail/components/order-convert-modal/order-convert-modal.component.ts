import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
} from '@angular/core';

@Component({
  selector: 'app-order-convert-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div class="w-full max-w-md rounded-xl bg-white dark:bg-surface p-6 shadow-xl">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-ink">Convert to Order?</h3>
            <button type="button" (click)="close()" class="text-gray-400 dark:text-muted hover:text-gray-600">✕</button>
          </div>
          <p class="mt-3 text-sm text-gray-600 dark:text-ink-dim">This will change the status from inquiry to confirmed order.</p>
          <div class="mt-5 flex items-center justify-end gap-3">
            <button type="button" (click)="close()"
              class="rounded-lg border border-gray-200 dark:border-line px-4 py-2 text-sm font-semibold text-gray-600 dark:text-ink-dim">Cancel</button>
            <button type="button" (click)="confirm()" [disabled]="saving()"
              class="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-800 disabled:opacity-50">
              Confirm Convert
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class OrderConvertModalComponent {
  readonly saving = input(false);
  readonly open = signal(false);
  readonly confirmed = output<void>();
  readonly closed = output<void>();

  show(): void { this.open.set(true); }
  close(): void { this.open.set(false); this.closed.emit(); }
  protected confirm(): void { this.confirmed.emit(); }
}
