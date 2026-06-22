import {
  Component,
  ChangeDetectionStrategy,
  signal,
  input,
  output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-two-factor-setup-profile-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="flex flex-col rounded-2xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-6 shadow-sm">
      <h2 class="text-lg font-bold text-gray-900 dark:text-ink">Profile</h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-muted">Your phone number will appear on generated PDF documents (offers, proforma invoices).</p>

      @if (success()) {
        <div class="mt-3 rounded-lg border border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/15 px-4 py-2.5 text-sm text-green-700 dark:text-green-400">
          {{ success() }}
        </div>
      }
      @if (error()) {
        <div class="mt-3 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-4 py-2.5 text-sm text-red-700 dark:text-red-400">
          {{ error() }}
        </div>
      }

      <form (ngSubmit)="save.emit()" class="mt-4 flex items-end gap-3">
        <div class="flex-1">
          <label for="phone" class="block text-sm font-medium text-gray-700 dark:text-ink-dim mb-1">Phone number</label>
          <input
            id="phone"
            type="tel"
            [ngModel]="phoneValue()"
            (ngModelChange)="phoneValueChange.emit($event)"
            name="phone"
            placeholder="e.g. +45 2613 1217"
            class="block w-full rounded-lg border border-gray-300 dark:border-line-strong px-3.5 py-2.5 text-sm shadow-sm placeholder:text-gray-400 dark:placeholder:text-muted focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          />
        </div>
        <button
          type="submit"
          [disabled]="saving()"
          class="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {{ saving() ? 'Saving…' : 'Save' }}
        </button>
      </form>
    </div>
  `,
})
export class TwoFactorSetupProfileCardComponent {
  readonly phoneValue = input('');
  readonly saving = input(false);
  readonly success = input('');
  readonly error = input('');
  readonly phoneValueChange = output<string>();
  readonly save = output<void>();
}