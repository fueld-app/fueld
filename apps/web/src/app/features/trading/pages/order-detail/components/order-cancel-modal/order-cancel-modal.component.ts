import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-order-cancel-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div class="w-full max-w-md rounded-xl bg-white dark:bg-surface p-6 shadow-xl">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-ink">Cancel {{ targetLabel() }}</h3>
            <button type="button" (click)="close()" class="text-gray-400 dark:text-muted hover:text-gray-600">✕</button>
          </div>
          <p class="mt-3 text-sm text-gray-600 dark:text-ink-dim">Select a reason for cancelling this {{ targetLabel() }}.</p>
          <div class="mt-4">
            <label class="text-xs font-medium text-gray-500 dark:text-muted">Cancellation reason</label>
            <select [ngModel]="selectedReason()" (ngModelChange)="selectedReason.set($event)"
              class="fueld-select-no-chevron mt-1 w-full appearance-none rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 bg-white dark:bg-surface">
              @for (reason of reasons(); track reason) {
                <option [value]="reason">{{ reason }}</option>
              }
            </select>
          </div>
          @if (selectedReason() === 'Other') {
            <div class="mt-3">
              <label class="text-xs font-medium text-gray-500 dark:text-muted">Please specify</label>
              <textarea [ngModel]="otherDetail()" (ngModelChange)="otherDetail.set($event)"
                placeholder="e.g. Adani is exclusive at Mundra - direct with client" rows="3"
                class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"></textarea>
            </div>
          }
          <div class="mt-5 flex items-center justify-end gap-3">
            <button type="button" (click)="close()"
              class="rounded-lg border border-gray-200 dark:border-line px-4 py-2 text-sm font-semibold text-gray-600 dark:text-ink-dim">Cancel</button>
            <button type="button" (click)="confirm()" [disabled]="saving()"
              class="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-800 disabled:opacity-50">
              Confirm Cancel
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class OrderCancelModalComponent {
  readonly saving = input(false);
  readonly targetLabel = input('inquiry');
  readonly reasons = input<string[]>([]);

  readonly open = signal(false);
  readonly selectedReason = signal('');
  readonly otherDetail = signal('');

  readonly confirmed = output<{ reason: string; reasonOther?: string }>();
  readonly closed = output<void>();

  show(): void {
    this.selectedReason.set('');
    this.otherDetail.set('');
    this.open.set(true);
  }

  close(): void {
    this.open.set(false);
    this.closed.emit();
  }

  protected confirm(): void {
    const reason = this.selectedReason();
    if (!reason) return;
    this.confirmed.emit({
      reason,
      reasonOther: reason === 'Other' ? this.otherDetail() || undefined : undefined,
    });
  }
}
