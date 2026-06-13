import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  HostListener,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { DropdownOption } from '@app/shared/components/searchable-dropdown/searchable-dropdown.component';

@Component({
  selector: 'app-order-settings-dropdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="relative">
      <button
        (click)="toggle()"
        class="inline-flex items-center rounded-lg border border-gray-300 bg-white p-2 text-sm
               text-gray-500 shadow-sm hover:bg-gray-50 hover:text-gray-700 transition-colors"
        title="Settings"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fill-rule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.993 6.993 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clip-rule="evenodd" />
        </svg>
      </button>

      @if (isOpen()) {
        <div class="fixed inset-0 z-40" (click)="close()"></div>
        <div
          class="fixed z-50 w-48 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
          [style]="positionStyle()"
        >
          <label class="mb-1 block text-xs font-medium text-gray-500">Currency</label>
          <select
            [ngModel]="currency()"
            (ngModelChange)="currencyChange.emit($event); close()"
            class="fueld-select-no-chevron w-full appearance-none rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900
                   outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            @for (c of currencyOptions(); track c.value) {
              <option [value]="c.value">{{ c.label }}</option>
            }
          </select>
          <label class="mt-2 mb-1 block text-xs font-medium text-gray-500">Category</label>
          <select
            [ngModel]="category()"
            (ngModelChange)="categoryChange.emit($event); close()"
            class="fueld-select-no-chevron w-full appearance-none rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900
                   outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            <option value="">— None —</option>
            @for (c of categoryOptions(); track c.key) {
              <option [value]="c.key">{{ c.label }}</option>
            }
          </select>
        </div>
      }
    </div>
  `,
})
export class OrderSettingsDropdownComponent {
  readonly currency = input<string>('USD');
  readonly category = input<string>('');
  readonly currencyOptions = input<DropdownOption[]>([]);
  readonly categoryOptions = input<{ key: string; label: string }[]>([]);

  readonly currencyChange = output<string>();
  readonly categoryChange = output<string>();

  protected readonly isOpen = signal(false);
  protected positionStyle = signal('top: 0px; left: 0px');

  protected toggle(): void {
    if (this.isOpen()) {
      this.close();
    } else {
      this.isOpen.set(true);
    }
  }

  protected close(): void {
    this.isOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.close();
  }
}
