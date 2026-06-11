import {
  Component,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { SettingsToastService } from './settings-toast.service';

@Component({
  selector: 'app-settings-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div>
      <!-- Header -->
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900">Settings</h1>
        <p class="mt-1 text-sm text-gray-500">
          Configure your workspace preferences and defaults.
        </p>
      </div>

      <!-- Tabs -->
      <nav class="mb-6 border-b border-gray-200">
        <ul class="flex flex-wrap gap-1">
          @for (tab of tabs; track tab.path) {
            <li>
              <a
                [routerLink]="tab.path"
                routerLinkActive="border-brand-500 text-brand-600"
                class="inline-block rounded-t-lg border-b-2 border-transparent px-4 py-2 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700"
              >
                {{ tab.label }}
              </a>
            </li>
          }
        </ul>
      </nav>

      <!-- Tab Content -->
      <router-outlet />

      <!-- Toast notification -->
      @if (toastService.toast()) {
        <div
          class="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-opacity"
          [class]="toastService.toast()!.type === 'success'
            ? 'border border-green-200 bg-green-50 text-green-800'
            : 'border border-red-200 bg-red-50 text-red-800'"
        >
          {{ toastService.toast()!.message }}
        </div>
      }
    </div>
  `,
})
export class SettingsShellComponent {
  private readonly toastService = inject(SettingsToastService);

  tabs = [
    { path: 'general', label: 'General' },
    { path: 'products', label: 'Products' },
    { path: 'units-pricing', label: 'Units & Pricing' },
    { path: 'companies', label: 'Companies' },
    { path: 'documents', label: 'Documents & Workflow' },
  ] as const;

}
