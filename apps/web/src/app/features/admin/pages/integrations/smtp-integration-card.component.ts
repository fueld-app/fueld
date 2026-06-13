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
  selector: 'app-smtp-integration-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="app-panel">
      <div class="app-panel-header app-panel-header--indigo">
        <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--indigo">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-indigo-600" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2.94 6.34A2 2 0 0 1 4.8 5h10.4a2 2 0 0 1 1.86 1.34L10 10.8 2.94 6.34Z" />
            <path d="M18 8.08V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.08l7.4 4.44a1 1 0 0 0 1.2 0L18 8.08Z" />
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="text-base font-semibold text-gray-900">SMTP (Invite Emails)</h3>
          <p class="text-sm text-gray-500">Send automatic user invites via SMTP.</p>
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
        @if (smtpSaveSuccess()) {
          <div class="mb-4 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
            </svg>
            {{ smtpSaveSuccess() }}
          </div>
        }
        @if (smtpSaveError()) {
          <div class="mb-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            {{ smtpSaveError() }}
          </div>
        }

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="block text-sm font-medium text-gray-700">SMTP Host</label>
            <input type="text" [ngModel]="smtpHost()" (ngModelChange)="smtpHost.set($event)"
              class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              placeholder="smtp-relay.brevo.com" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700">Port</label>
            <input type="number" [ngModel]="smtpPort()" (ngModelChange)="smtpPort.set($event)"
              class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              placeholder="587" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700">Username</label>
            <input type="text" [ngModel]="smtpUser()" (ngModelChange)="smtpUser.set($event)"
              class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              placeholder="smtp-user" autocomplete="username" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700">Password</label>
            <input type="password" [ngModel]="smtpPass()" (ngModelChange)="smtpPass.set($event)"
              class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              [placeholder]="status()?.configured ? 'Enter new password to update' : 'Enter SMTP password'"
              autocomplete="new-password" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700">From Address</label>
            <input type="email" [ngModel]="smtpFrom()" (ngModelChange)="smtpFrom.set($event)"
              class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              placeholder="noreply@fueld.app" autocomplete="email" />
          </div>
          <div class="flex items-center gap-2 pt-6">
            <input id="smtp-secure" type="checkbox" [ngModel]="smtpSecure()" (ngModelChange)="smtpSecure.set($event)"
              class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
            <label for="smtp-secure" class="text-sm text-gray-700">Use TLS/SSL</label>
          </div>
        </div>

        <div class="mt-5 flex items-center gap-3">
          <button (click)="saveSmtpCredentials()" [disabled]="smtpSaving()"
            class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            @if (smtpSaving()) {
              <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              Saving…
            } @else {
              Save SMTP Settings
            }
          </button>
          <span class="text-xs text-gray-400">Credentials are stored encrypted.</span>
        </div>

        <div class="mt-6 border-t border-gray-100 pt-5">
          @if (smtpTestSuccess()) {
            <div class="mb-4 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
              </svg>
              {{ smtpTestSuccess() }}
            </div>
          }
          @if (smtpTestError()) {
            <div class="mb-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
              </svg>
              {{ smtpTestError() }}
            </div>
          }

          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700">Test email address</label>
              <input type="email" [ngModel]="smtpTestEmail()" (ngModelChange)="smtpTestEmail.set($event)"
                class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                placeholder="you@example.com" autocomplete="email" />
            </div>
          </div>

          <div class="mt-4 flex items-center gap-3">
            <button (click)="sendSmtpTest()" [disabled]="smtpTestSending()"
              class="inline-flex items-center gap-2 rounded-lg border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 transition-colors">
              @if (smtpTestSending()) {
                <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Sending…
              } @else {
                Send Test Email
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class SmtpIntegrationCardComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toastService = inject(IntegrationsToastService);

  readonly integration = input.required<IntegrationStatusDto | undefined>();

  readonly smtpHost = signal('');
  readonly smtpPort = signal('587');
  readonly smtpUser = signal('');
  readonly smtpPass = signal('');
  readonly smtpFrom = signal('');
  readonly smtpSecure = signal(false);
  readonly smtpSaving = signal(false);
  readonly smtpSaveSuccess = signal('');
  readonly smtpSaveError = signal('');

  readonly smtpTestEmail = signal('');
  readonly smtpTestSending = signal(false);
  readonly smtpTestSuccess = signal('');
  readonly smtpTestError = signal('');

  status(): IntegrationStatusDto | null {
    return this.integration() ?? null;
  }

  ngOnInit(): void {
    const s = this.status();
    if (s?.smtpHost) this.smtpHost.set(s.smtpHost);
    if (s?.smtpPort) this.smtpPort.set(String(s.smtpPort));
    if (s?.smtpUser) this.smtpUser.set(s.smtpUser);
    if (s?.smtpFrom) this.smtpFrom.set(s.smtpFrom);
    if (typeof s?.smtpSecure === 'boolean') this.smtpSecure.set(s.smtpSecure);
  }

  async saveSmtpCredentials(): Promise<void> {
    const host = this.smtpHost().trim();
    const port = Number(this.smtpPort().trim() || '587');
    const user = this.smtpUser().trim();
    const pass = this.smtpPass().trim();
    const from = this.smtpFrom().trim();
    const secure = this.smtpSecure();

    if (!host) { this.smtpSaveError.set('SMTP host is required.'); return; }
    if (!Number.isFinite(port)) { this.smtpSaveError.set('SMTP port is invalid.'); return; }
    if (!user) { this.smtpSaveError.set('SMTP username is required.'); return; }
    if (!from) { this.smtpSaveError.set('From address is required.'); return; }
    if (!pass) { this.smtpSaveError.set('SMTP password is required.'); return; }

    this.smtpSaving.set(true);
    this.smtpSaveSuccess.set('');
    this.smtpSaveError.set('');

    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ saved: boolean }>>(`${API}/admin/settings/integrations/smtp`, {
          host,
          port,
          user,
          pass,
          from,
          secure,
        }),
      );
      if (res.success) {
        this.smtpSaveSuccess.set('SMTP settings saved successfully.');
        this.smtpPass.set('');
        this.toastService.show('success', 'SMTP settings saved successfully.');
      } else {
        this.smtpSaveError.set(res.message ?? 'Failed to save SMTP settings.');
      }
    } catch (err: any) {
      const msg = err?.error?.message ?? err?.message ?? 'Failed to save SMTP settings.';
      this.smtpSaveError.set(msg);
    } finally {
      this.smtpSaving.set(false);
    }
  }

  async sendSmtpTest(): Promise<void> {
    const email = this.smtpTestEmail().trim();
    if (!email) {
      this.smtpTestError.set('Email is required.');
      return;
    }

    this.smtpTestSending.set(true);
    this.smtpTestSuccess.set('');
    this.smtpTestError.set('');

    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<{ email: string }>>(`${API}/admin/email/test`, { email }),
      );
      if (res.success) {
        this.smtpTestSuccess.set(`Test email sent to ${email}.`);
      } else {
        this.smtpTestError.set(res.message ?? 'Failed to send test email.');
      }
    } catch (err: any) {
      const msg = err?.error?.message ?? err?.message ?? 'Failed to send test email.';
      this.smtpTestError.set(msg);
    } finally {
      this.smtpTestSending.set(false);
    }
  }
}
