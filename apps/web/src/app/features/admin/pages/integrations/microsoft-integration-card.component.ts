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
  selector: 'app-microsoft-integration-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="app-panel">
      <div class="app-panel-header app-panel-header--sky">
        <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--sky">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-sky-600" viewBox="0 0 23 23" fill="currentColor">
            <path d="M0 0h11v11H0zM12 0h11v11H12zM0 12h11v11H0zM12 12h11v11H12z"/>
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="text-base font-semibold text-gray-900">Microsoft 365 / Entra ID</h3>
          <p class="text-sm text-gray-500">SSO login &amp; send email via Microsoft Graph (Mail.Send).</p>
        </div>
        <div>
          @if (status()?.configured) {
            <span class="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 ring-1 ring-green-600/20">
              <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
              Configured
            </span>
          } @else {
            <span class="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-500/10">
              <span class="h-1.5 w-1.5 rounded-full bg-gray-400"></span>
              Not Configured
            </span>
          }
        </div>
      </div>

      <div class="px-6 py-5">
        @if (msSaveSuccess()) {
          <div class="mb-4 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
            </svg>
            {{ msSaveSuccess() }}
          </div>
        }
        @if (msSaveError()) {
          <div class="mb-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            {{ msSaveError() }}
          </div>
        }

        @if (status()?.configured) {
          <div class="mb-4 text-sm text-gray-500 space-y-1">
            <p><span class="font-medium text-gray-700">Client ID:</span> {{ status()?.msClientId }}</p>
            <p><span class="font-medium text-gray-700">Tenant ID:</span> {{ status()?.msTenantId || 'common' }}</p>
            @if (status()?.updatedBy) {
              <p class="text-xs text-gray-400">Last updated by {{ status()?.updatedBy }}</p>
            }
          </div>
        }

        <div class="grid gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700">Tenant ID (Directory ID)</label>
            <input type="text" [ngModel]="msTenantId()" (ngModelChange)="msTenantId.set($event)"
              class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              placeholder="e.g. 72f988bf-86f1-41af-91ab-2d7cd011db47" />
            <p class="mt-1 text-xs text-gray-500">Azure Portal → Microsoft Entra ID → Overview.</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700">Client ID (Application ID)</label>
            <input type="text" [ngModel]="msClientId()" (ngModelChange)="msClientId.set($event)"
              class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              placeholder="e.g. 6731de76-14a6-49ae-97bc-6eba6914391e" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700">Client Secret</label>
            <input type="password" [ngModel]="msClientSecret()" (ngModelChange)="msClientSecret.set($event)"
              class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              [placeholder]="status()?.configured ? 'Enter new secret to update' : 'Enter client secret'"
              autocomplete="new-password" />
          </div>
        </div>

        <div class="mt-5 flex items-center gap-3">
          <button (click)="saveMicrosoftCredentials()" [disabled]="msSaving()"
            class="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-50 transition-colors">
            @if (msSaving()) {
              <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              Saving…
            } @else {
              Save Microsoft Settings
            }
          </button>
          <span class="text-xs text-gray-400">Credentials are stored encrypted. Enable SSO in Security settings.</span>
        </div>
      </div>
    </div>
  `,
})
export class MicrosoftIntegrationCardComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toastService = inject(IntegrationsToastService);

  readonly integration = input.required<IntegrationStatusDto | undefined>();

  readonly msClientId = signal('');
  readonly msClientSecret = signal('');
  readonly msTenantId = signal('');
  readonly msSaving = signal(false);
  readonly msSaveSuccess = signal('');
  readonly msSaveError = signal('');

  status(): IntegrationStatusDto | null {
    return this.integration() ?? null;
  }

  ngOnInit(): void {
    const s = this.status();
    if (s?.msClientId) this.msClientId.set(s.msClientId);
    if (s?.msTenantId) this.msTenantId.set(s.msTenantId);
  }

  async saveMicrosoftCredentials(): Promise<void> {
    const clientId = this.msClientId().trim();
    const clientSecret = this.msClientSecret().trim();
    const tenantId = this.msTenantId().trim();

    if (!clientId) { this.msSaveError.set('Client ID is required.'); return; }
    if (!clientSecret) { this.msSaveError.set('Client Secret is required.'); return; }
    if (!tenantId) { this.msSaveError.set('Tenant ID is required.'); return; }

    this.msSaving.set(true);
    this.msSaveSuccess.set('');
    this.msSaveError.set('');

    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ saved: boolean }>>(`${API}/admin/settings/integrations/microsoft`, {
          clientId,
          clientSecret,
          tenantId,
        }),
      );

      if (res.success) {
        this.msSaveSuccess.set('Microsoft 365 credentials saved successfully.');
        this.msClientSecret.set('');
        this.toastService.show('success', 'Microsoft 365 credentials saved successfully.');
      } else {
        this.msSaveError.set(res.message ?? 'Failed to save Microsoft credentials.');
      }
    } catch (err: any) {
      const msg = err?.error?.message ?? err?.message ?? 'Failed to save Microsoft credentials.';
      this.msSaveError.set(msg);
    } finally {
      this.msSaving.set(false);
    }
  }
}
