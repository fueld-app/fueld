import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-inquiry-deadline-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <div class="flex items-center justify-between gap-3">
        <label for="inquiry-deadline" class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Response deadline</label>
        <label class="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-ink-dim cursor-pointer">
          <input
            type="checkbox"
            class="h-4 w-4 rounded border-gray-300 dark:border-line-strong text-brand-600 dark:text-brand-400 focus:ring-brand-600"
            [ngModel]="responseDeadlineEnabled()"
            (ngModelChange)="onToggle($event)"
          />
          Enable deadline
        </label>
      </div>
      <input
        id="inquiry-deadline"
        type="datetime-local"
        class="mt-1 block w-full rounded-lg border border-gray-300 dark:border-line-strong px-3.5 py-2.5 text-sm text-gray-900 dark:text-ink focus:border-brand-600 focus:ring-1 focus:ring-brand-600 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
        [ngModel]="responseDeadlineAt()"
        (ngModelChange)="onDeadlineChange($event)"
        [disabled]="!responseDeadlineEnabled()"
      />
      <div class="mt-3 flex items-start justify-between gap-3 rounded-xl border border-gray-200 dark:border-line bg-gray-50 dark:bg-bg-2 px-3.5 py-3">
        <div>
          <p class="text-sm font-medium text-gray-700 dark:text-ink-dim">Automatic reminder</p>
          <p class="mt-1 text-xs leading-5 text-gray-500 dark:text-muted">Send one reminder before the deadline if the supplier has not replied.</p>
        </div>
        <label class="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-ink-dim cursor-pointer">
          <input
            type="checkbox"
            class="h-4 w-4 rounded border-gray-300 dark:border-line-strong text-brand-600 dark:text-brand-400 focus:ring-brand-600 disabled:cursor-not-allowed"
            [ngModel]="reminderEnabled()"
            (ngModelChange)="onReminderToggle($event)"
            [disabled]="!responseDeadlineEnabled()"
          />
          Opt in
        </label>
      </div>
      @if (responseDeadlineEnabled() && reminderEnabled()) {
        <p class="mt-2 text-xs leading-5 text-gray-500 dark:text-muted">One reminder will be sent automatically before this deadline if the supplier has not replied.</p>
      } @else if (responseDeadlineEnabled()) {
        <p class="mt-2 text-xs leading-5 text-gray-500 dark:text-muted">No automatic reminder will be sent unless you opt in for this inquiry.</p>
      } @else {
        <p class="mt-2 text-xs leading-5 text-gray-500 dark:text-muted">No response deadline or automatic reminder will be sent for this inquiry.</p>
      }
    </div>
  `,
})
export class InquiryDeadlinePickerComponent {
  readonly responseDeadlineAt = input<string>('');
  readonly responseDeadlineEnabled = input(false);
  readonly reminderEnabled = input(false);

  readonly deadlineChange = output<string>();
  readonly toggle = output<boolean>();
  readonly reminderToggle = output<boolean>();

  protected onDeadlineChange(value: string): void {
    this.deadlineChange.emit(value);
  }

  protected onToggle(enabled: boolean): void {
    this.toggle.emit(enabled);
  }

  protected onReminderToggle(enabled: boolean): void {
    this.reminderToggle.emit(enabled);
  }
}
