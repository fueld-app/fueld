import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
  input,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, IntegrationStatusDto } from '@fueld/types';

import { API } from '@app/core/config/api';
import { IntegrationsToastService } from './integrations-toast.service';

@Component({
  selector: 'app-lli-integration-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="app-panel">
      <div class="app-panel-header app-panel-header--blue">
        <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--blue">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd" />
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="text-base font-semibold text-gray-900">Lloyd's List Intelligence / Seasearcher</h3>
          <p class="text-sm text-gray-500">Vessel tracking &amp; port data from Lloyd's List Intelligence.</p>
        </div>
        <div>
          @if (status()?.configured) {
            <span class="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 ring-1 ring-green-600/20">
              <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
              Connected
            </span>
          } @else {
            <span class="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-500/10">
              <span class="h-1.5 w-1.5 rounded-full bg-gray-400"></span>
              Not Configured
            </span>
          }
        </div>
      </div>

      @if (status()?.configured) {
        <div class="border-b border-gray-100 bg-gray-50/50 px-6 py-3">
          <div class="flex items-center gap-6 text-sm">
            <div>
              <span class="text-gray-500">Username:</span>
              <span class="ml-1.5 font-medium text-gray-900">{{ status()!.username }}</span>
            </div>
            @if (status()!.updatedAt) {
              <div>
                <span class="text-gray-500">Last updated:</span>
                <span class="ml-1.5 text-gray-700">{{ formatDate(status()!.updatedAt!) }}</span>
              </div>
            }
            @if (status()!.updatedBy) {
              <div>
                <span class="text-gray-500">by</span>
                <span class="ml-1 text-gray-700">{{ status()!.updatedBy }}</span>
              </div>
            }
          </div>
        </div>
      }

      <div class="px-6 py-5">
        @if (successMessage()) {
          <div class="mb-4 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
            </svg>
            {{ successMessage() }}
          </div>
        }
        @if (errorMessage()) {
          <div class="mb-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            {{ errorMessage() }}
          </div>
        }

        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700">Username / Email</label>
            <input type="text" [ngModel]="formUsername()" (ngModelChange)="formUsername.set($event)"
              class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              placeholder="your-lli-username@example.com" autocomplete="username" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700">Password</label>
            <input type="password" [ngModel]="formPassword()" (ngModelChange)="formPassword.set($event)"
              class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              [placeholder]="status()?.configured ? '••••••••  (enter new password to update)' : 'Enter your LLI password'"
              autocomplete="current-password" />
          </div>
        </div>

        <div class="mt-5 flex items-center gap-3">
          <button (click)="saveLLICredentials()" [disabled]="saving()"
            class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 transition-colors">
            @if (saving()) {
              <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              Verifying & Saving…
            } @else {
              Save Credentials
            }
          </button>
          <span class="text-xs text-gray-400">Credentials will be verified against the LLI API before saving.</span>
        </div>
      </div>
    </div>
  `,
})
export class LliIntegrationCardComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toastService = inject(IntegrationsToastService);

  readonly integration = input.required<IntegrationStatusDto | undefined>();

  readonly formUsername = signal('');
  readonly formPassword = signal('');
  readonly saving = signal(false);
  readonly successMessage = signal('');
  readonly errorMessage = signal('');

  status(): IntegrationStatusDto | null {
    return this.integration() ?? null;
  }

  ngOnInit(): void {
    const s = this.status();
    if (s?.username) this.formUsername.set(s.username);
    if (s?.configured) this.formPassword.set('******');
  }

  async saveLLICredentials(): Promise<void> {
    const username = this.formUsername().trim();
    const password = this.formPassword().trim();

    if (!username) { this.errorMessage.set('Username is required.'); return; }
    if (!password || password === '******') { this.errorMessage.set('Please enter a new password.'); return; }

    this.saving.set(true);
    this.successMessage.set('');
    this.errorMessage.set('');

    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ message: string }>>(`${API}/admin/settings/integrations/lli`, { username, password }),
      );
      if (res.success) {
        this.successMessage.set('Credentials verified and saved successfully.');
        this.formPassword.set('');
        this.toastService.show('success', 'LLI credentials saved successfully.');
      }
    } catch (err: any) {
      const msg = err?.error?.error ?? 'Failed to verify credentials. Please check and try again.';
      this.errorMessage.set(msg);
    } finally {
      this.saving.set(false);
    }
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
}
