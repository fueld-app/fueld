import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, SecuritySettingsDto } from '@fueld/types';

import { API } from '@app/core/config/api';

@Component({
  selector: 'app-security-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <!-- Header -->
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900">Authentication &amp; Security</h1>
        <p class="mt-1 text-sm text-gray-500">
          Configure single sign-on, two-factor authentication, and session policies.
        </p>
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <svg class="h-8 w-8 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else {
        <div class="grid gap-6 grid-cols-1 lg:grid-cols-2">

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  SSO Configuration                                      -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Single Sign-On (SSO)</h3>
                <p class="text-xs text-gray-500">Allow users to authenticate with a corporate identity provider.</p>
              </div>
              <div class="flex items-center gap-2">
                @if (ssoEnabled()) {
                  <span class="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
                    Active
                  </span>
                } @else {
                  <span class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                    Disabled
                  </span>
                }
              </div>
            </div>
            <div class="flex-1 px-6 py-5 space-y-4">
              <!-- Provider -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Provider</label>
                <select
                  [ngModel]="ssoProvider()"
                  (ngModelChange)="ssoProvider.set($event)"
                  class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                >
                  <option value="none">None</option>
                  <option value="microsoft">Microsoft Entra ID (Azure AD)</option>
                  <option value="google">Google Workspace</option>
                </select>
              </div>

              @if (ssoProvider() !== 'none') {
                <!-- Enabled toggle -->
                <label class="flex items-center gap-3 cursor-pointer">
                  <button
                    type="button"
                    (click)="ssoEnabled.set(!ssoEnabled())"
                    class="relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
                    [class]="ssoEnabled() ? 'bg-brand-600' : 'bg-gray-200'"
                    role="switch"
                    [attr.aria-checked]="ssoEnabled()"
                  >
                    <span
                      class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                      [class]="ssoEnabled() ? 'translate-x-5' : 'translate-x-0'"
                    ></span>
                  </button>
                  <span class="text-sm text-gray-700">Enable SSO authentication</span>
                </label>

                @if (ssoProvider() === 'microsoft') {
                  <!-- Microsoft-specific fields -->
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Tenant ID (Directory ID)</label>
                    <input
                      type="text"
                      [ngModel]="ssoTenantId()"
                      (ngModelChange)="ssoTenantId.set($event)"
                      placeholder="e.g. 72f988bf-86f1-41af-91ab-2d7cd011db47"
                      class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    />
                    <p class="mt-1 text-xs text-gray-500">Found in Azure Portal → Microsoft Entra ID → Overview.</p>
                  </div>
                }

                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Client ID (Application ID)</label>
                  <input
                    type="text"
                    [ngModel]="ssoClientId()"
                    (ngModelChange)="ssoClientId.set($event)"
                    placeholder="e.g. 6731de76-14a6-49ae-97bc-6eba6914391e"
                    class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                </div>

                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Client Secret</label>
                  <input
                    type="password"
                    [ngModel]="ssoClientSecret()"
                    (ngModelChange)="ssoClientSecret.set($event)"
                    placeholder="Enter new secret to update..."
                    class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                  <p class="mt-1 text-xs text-gray-500">Leave empty to keep the existing secret. Secrets are encrypted at rest.</p>
                </div>
              }
            </div>
            <div class="border-t border-gray-100 px-6 py-3 bg-gray-50/50 flex justify-end">
              <button
                (click)="saveSso()"
                [disabled]="saving()"
                class="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {{ saving() ? 'Saving...' : 'Save SSO Settings' }}
              </button>
            </div>
          </div>

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Two-Factor Authentication                              -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Two-Factor Authentication (2FA)</h3>
                <p class="text-xs text-gray-500">Require users to verify identity with an authenticator app.</p>
              </div>
              <div class="flex items-center gap-2">
                @if (enforce2FA()) {
                  <span class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    Enforced
                  </span>
                } @else {
                  <span class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                    Optional
                  </span>
                }
              </div>
            </div>
            <div class="flex-1 px-6 py-5 space-y-4">
              <label class="flex items-center gap-3 cursor-pointer">
                <button
                  type="button"
                  (click)="enforce2FA.set(!enforce2FA())"
                  class="relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
                  [class]="enforce2FA() ? 'bg-brand-600' : 'bg-gray-200'"
                  role="switch"
                  [attr.aria-checked]="enforce2FA()"
                >
                  <span
                    class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                    [class]="enforce2FA() ? 'translate-x-5' : 'translate-x-0'"
                  ></span>
                </button>
                <div>
                  <span class="text-sm font-medium text-gray-700">Enforce 2FA for all users</span>
                  <p class="text-xs text-gray-500">When enabled, users must set up 2FA before accessing the application. Applies to email/password logins only.</p>
                </div>
              </label>
            </div>
            <div class="border-t border-gray-100 px-6 py-3 bg-gray-50/50 flex justify-end">
              <button
                (click)="save2FA()"
                [disabled]="saving()"
                class="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {{ saving() ? 'Saving...' : 'Save 2FA Settings' }}
              </button>
            </div>
          </div>

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Passkeys (FIDO2)                                       -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-indigo-600" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Passkeys (FIDO2)</h3>
                <p class="text-xs text-gray-500">Allow users to authenticate with biometrics, security keys, or device PIN.</p>
              </div>
              <div class="flex items-center gap-2">
                @if (passkeyEnabled()) {
                  <span class="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
                    Enabled
                  </span>
                } @else {
                  <span class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                    Disabled
                  </span>
                }
              </div>
            </div>
            <div class="flex-1 px-6 py-5 space-y-4">
              <label class="flex items-center gap-3 cursor-pointer">
                <button
                  type="button"
                  (click)="passkeyEnabled.set(!passkeyEnabled())"
                  class="relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
                  [class]="passkeyEnabled() ? 'bg-brand-600' : 'bg-gray-200'"
                  role="switch"
                  [attr.aria-checked]="passkeyEnabled()"
                >
                  <span
                    class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                    [class]="passkeyEnabled() ? 'translate-x-5' : 'translate-x-0'"
                  ></span>
                </button>
                <div>
                  <span class="text-sm font-medium text-gray-700">Allow passkeys as a 2FA method</span>
                  <p class="text-xs text-gray-500">Users can register a passkey (fingerprint, Face ID, security key) as a second factor during login.</p>
                </div>
              </label>

              @if (passkeyEnabled()) {
                <label class="flex items-center gap-3 cursor-pointer ml-14">
                  <button
                    type="button"
                    (click)="passkeyAllowPasswordless.set(!passkeyAllowPasswordless())"
                    class="relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
                    [class]="passkeyAllowPasswordless() ? 'bg-brand-600' : 'bg-gray-200'"
                    role="switch"
                    [attr.aria-checked]="passkeyAllowPasswordless()"
                  >
                    <span
                      class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                      [class]="passkeyAllowPasswordless() ? 'translate-x-5' : 'translate-x-0'"
                    ></span>
                  </button>
                  <div>
                    <span class="text-sm font-medium text-gray-700">Allow passwordless login</span>
                    <p class="text-xs text-gray-500">Users with registered passkeys can sign in without entering a password. The passkey replaces both password and 2FA.</p>
                  </div>
                </label>
              }

              <div class="mt-3 rounded-lg bg-indigo-50 p-3">
                <p class="text-xs text-indigo-700">
                  <strong>How it works:</strong> Each user can register passkeys from their profile settings. 
                  Passkeys use the WebAuthn (FIDO2) standard and are supported by all modern browsers and devices 
                  including Touch ID, Face ID, Windows Hello, and hardware security keys.
                </p>
              </div>
            </div>
            <div class="border-t border-gray-100 px-6 py-3 bg-gray-50/50 flex justify-end">
              <button
                (click)="savePasskey()"
                [disabled]="saving()"
                class="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {{ saving() ? 'Saving...' : 'Save Passkey Settings' }}
              </button>
            </div>
          </div>

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Session & Token Settings                               -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-purple-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Session &amp; Token Policies</h3>
                <p class="text-xs text-gray-500">Control how long users stay signed in.</p>
              </div>
            </div>
            <div class="flex-1 px-6 py-5 space-y-5">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Token Expiration</label>
                <div class="flex items-center gap-2">
                  <input
                    type="number"
                    [ngModel]="tokenExpirationMinutes()"
                    (ngModelChange)="tokenExpirationMinutes.set($event)"
                    min="5"
                    max="1440"
                    class="w-24 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                  <span class="text-sm text-gray-500">minutes</span>
                </div>
                <p class="mt-1 text-xs text-gray-500">How long a JWT access token is valid before requiring refresh. Default: 15 min.</p>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Idle Session Timeout</label>
                <div class="flex items-center gap-2">
                  <input
                    type="number"
                    [ngModel]="sessionTimeoutMinutes()"
                    (ngModelChange)="sessionTimeoutMinutes.set($event)"
                    min="5"
                    max="10080"
                    class="w-24 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                  <span class="text-sm text-gray-500">minutes</span>
                  <span class="text-xs text-gray-400 ml-2">({{ formatDuration(sessionTimeoutMinutes()) }})</span>
                </div>
                <p class="mt-1 text-xs text-gray-500">Inactive sessions are terminated after this period. Default: 480 min (8 hours).</p>
              </div>
            </div>
            <div class="border-t border-gray-100 px-6 py-3 bg-gray-50/50 flex justify-end">
              <button
                (click)="saveSession()"
                [disabled]="saving()"
                class="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {{ saving() ? 'Saving...' : 'Save Session Settings' }}
              </button>
            </div>
          </div>

          <!-- Success toast -->
          @if (saveSuccess()) {
            <div class="fixed bottom-6 right-6 rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white shadow-lg animate-in fade-in slide-in-from-bottom-4">
              Settings saved successfully.
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class SecurityPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly saveSuccess = signal(false);

  // SSO
  readonly ssoProvider = signal<'microsoft' | 'google' | 'none'>('none');
  readonly ssoClientId = signal('');
  readonly ssoClientSecret = signal('');
  readonly ssoTenantId = signal('');
  readonly ssoEnabled = signal(false);

  // 2FA
  readonly enforce2FA = signal(false);

  // Passkeys
  readonly passkeyEnabled = signal(false);
  readonly passkeyAllowPasswordless = signal(false);

  // Session
  readonly tokenExpirationMinutes = signal(15);
  readonly sessionTimeoutMinutes = signal(480);

  ngOnInit(): void {
    this.loadSettings();
  }

  async loadSettings(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<SecuritySettingsDto>>(`${API}/admin/security`),
      );
      if (res.success && res.data) {
        this.ssoProvider.set(res.data.ssoProvider);
        this.ssoClientId.set(res.data.ssoClientId);
        this.ssoTenantId.set(res.data.ssoTenantId);
        this.ssoEnabled.set(res.data.ssoEnabled);
        this.enforce2FA.set(res.data.enforce2FA);
        this.passkeyEnabled.set(res.data.passkeyEnabled);
        this.passkeyAllowPasswordless.set(res.data.passkeyAllowPasswordless);
        this.tokenExpirationMinutes.set(res.data.tokenExpirationMinutes);
        this.sessionTimeoutMinutes.set(res.data.sessionTimeoutMinutes);
      }
    } catch {
      // silent
    } finally {
      this.loading.set(false);
    }
  }

  async saveSso(): Promise<void> {
    this.saving.set(true);
    try {
      const body: Record<string, unknown> = {
        ssoProvider: this.ssoProvider(),
        ssoClientId: this.ssoClientId(),
        ssoTenantId: this.ssoTenantId(),
        ssoEnabled: this.ssoEnabled(),
      };
      if (this.ssoClientSecret()) {
        body['ssoClientSecret'] = this.ssoClientSecret();
      }
      await firstValueFrom(this.http.put(`${API}/admin/security`, body));
      this.ssoClientSecret.set('');
      this.showSuccess();
    } catch {
      // silent
    } finally {
      this.saving.set(false);
    }
  }

  async save2FA(): Promise<void> {
    this.saving.set(true);
    try {
      await firstValueFrom(
        this.http.put(`${API}/admin/security`, { enforce2FA: this.enforce2FA() }),
      );
      this.showSuccess();
    } catch {
      // silent
    } finally {
      this.saving.set(false);
    }
  }

  async savePasskey(): Promise<void> {
    this.saving.set(true);
    try {
      await firstValueFrom(
        this.http.put(`${API}/admin/security`, {
          passkeyEnabled: this.passkeyEnabled(),
          passkeyAllowPasswordless: this.passkeyAllowPasswordless(),
        }),
      );
      this.showSuccess();
    } catch {
      // silent
    } finally {
      this.saving.set(false);
    }
  }

  async saveSession(): Promise<void> {
    this.saving.set(true);
    try {
      await firstValueFrom(
        this.http.put(`${API}/admin/security`, {
          tokenExpirationMinutes: this.tokenExpirationMinutes(),
          sessionTimeoutMinutes: this.sessionTimeoutMinutes(),
        }),
      );
      this.showSuccess();
    } catch {
      // silent
    } finally {
      this.saving.set(false);
    }
  }

  formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  private showSuccess(): void {
    this.saveSuccess.set(true);
    setTimeout(() => this.saveSuccess.set(false), 3000);
  }
}
