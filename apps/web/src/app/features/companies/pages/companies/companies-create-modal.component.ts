import {
  Component,
  ChangeDetectionStrategy,
  signal,
  input,
  output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-companies-create-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div class="rounded-xl bg-white p-6 shadow-xl w-full max-w-lg mx-4" (click)="$event.stopPropagation()">
          <h3 class="text-lg font-semibold text-gray-900">Create Company</h3>
          <p class="mt-1 text-sm text-gray-500">Add a company manually that isn't in Seasearcher.</p>

          @if (error()) {
            <div class="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {{ error() }}
            </div>
          }

          <div class="mt-4 space-y-4">
            <div class="grid grid-cols-2 gap-4">
              <div class="col-span-2">
                <label class="block text-sm font-medium text-gray-700">Name *</label>
                <input type="text" [ngModel]="form().name" (ngModelChange)="updateForm('name', $event)"
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  placeholder="Company name" />
              </div>
              <div class="col-span-2">
                <label class="block text-sm font-medium text-gray-700 mb-1">Type(s) *</label>
                <div class="flex flex-wrap gap-3">
                  @for (opt of typeOptions(); track opt.value) {
                    <label class="inline-flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" [checked]="form().types.includes(opt.value)"
                        (change)="toggleType.emit(opt.value)"
                        class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                      <span class="text-sm text-gray-700">{{ opt.label }}</span>
                    </label>
                  }
                </div>
              </div>
              <div class="col-span-2 sm:col-span-1">
                <label class="block text-sm font-medium text-gray-700">Country</label>
                <select [ngModel]="form().countryIso" (ngModelChange)="countryChange.emit($event)"
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white">
                  <option value="">Select country…</option>
                  @for (c of countries(); track c.code) {
                    <option [value]="c.code">{{ c.name }}</option>
                  }
                </select>
              </div>
            </div>
          </div>

          <div class="mt-5 flex justify-end gap-2">
            <button (click)="cancel.emit()" class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
            <button (click)="save.emit()" [disabled]="!form().name || !form().types.length || creating()"
              class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {{ creating() ? 'Creating…' : 'Create Company' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class CompaniesCreateModalComponent {
  readonly open = input(false);
  readonly creating = input(false);
  readonly error = input<string | null>(null);
  readonly form = input<{ name: string; types: string[]; country: string; countryIso: string }>({ name: '', types: ['CLIENT'], country: '', countryIso: '' });
  readonly typeOptions = input<{ value: string; label: string }[]>([]);
  readonly countries = input<{ code: string; name: string }[]>([]);
  readonly cancel = output<void>();
  readonly save = output<void>();
  readonly toggleType = output<string>();
  readonly countryChange = output<string>();
  readonly formChange = output<Partial<{ name: string; types: string[]; country: string; countryIso: string }>>();

  updateForm(key: string, value: unknown): void {
    this.formChange.emit({ [key]: value } as any);
  }
}