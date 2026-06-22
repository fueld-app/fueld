import {
  Component,
  ChangeDetectionStrategy,
  computed,
  signal,
  inject,
  OnInit,
  ElementRef,
  viewChild,
} from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, SecuritySettingsDto } from '@fueld/types';

import { API } from '@app/core/config/api';

@Component({
  selector: 'app-security-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: `
    <div>
      <!-- Header -->
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">Authentication &amp; Security</h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-muted">
          Configure single sign-on, two-factor authentication, and session policies.
        </p>
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <svg class="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else {
        <div class="grid gap-6 grid-cols-1 lg:grid-cols-2">

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  SSO Configuration                                      -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel flex flex-col">
            <div class="app-panel-header app-panel-header--blue">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--blue">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600 dark:text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Single Sign-On (SSO)</h3>
                <p class="text-xs text-gray-500 dark:text-muted">Allow users to authenticate with a corporate identity provider.</p>
              </div>
              <div class="flex items-center gap-2">
                @if (ssoEnabled()) {
                  <span class="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                    <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
                    Active
                  </span>
                } @else {
                  <span class="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-surface-3 px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-muted">
                    Disabled
                  </span>
                }
              </div>
            </div>
            <div class="flex-1 px-6 py-5 space-y-4">
              <!-- Provider -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim mb-1">Provider</label>
                <select
                  [ngModel]="ssoProvider()"
                  (ngModelChange)="ssoProvider.set($event)"
                  class="w-full rounded-md border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
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
                    class="relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2"
                    [class]="ssoEnabled() ? 'bg-brand-700' : 'bg-gray-200 dark:bg-surface-3'"
                    role="switch"
                    [attr.aria-checked]="ssoEnabled()"
                  >
                    <span
                      class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-surface shadow ring-0 transition duration-200 ease-in-out"
                      [class]="ssoEnabled() ? 'translate-x-5' : 'translate-x-0'"
                    ></span>
                  </button>
                  <span class="text-sm text-gray-700 dark:text-ink-dim">Enable SSO authentication</span>
                </label>

                <p class="text-sm text-gray-500 dark:text-muted">
                  Configure credentials (Client ID, Secret, Tenant ID) in
                  <a routerLink="/admin/integrations" class="text-brand-600 dark:text-brand-400 hover:underline font-medium">Admin → Integrations</a>.
                </p>
              }
            </div>
            <div class="border-t border-gray-100 dark:border-line px-6 py-3 bg-gray-50/50 flex justify-end dark:bg-surface-2">
              <button
                (click)="saveSso()"
                [disabled]="saving()"
                class="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50 transition-colors"
              >
                {{ saving() ? 'Saving...' : 'Save SSO Settings' }}
              </button>
            </div>
          </div>

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Two-Factor Authentication                              -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel flex flex-col">
            <div class="app-panel-header app-panel-header--amber">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--amber">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-600 dark:text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Two-Factor Authentication (2FA)</h3>
                <p class="text-xs text-gray-500 dark:text-muted">Require users to verify identity with an authenticator app.</p>
              </div>
              <div class="flex items-center gap-2">
                @if (enforce2FA()) {
                  <span class="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                    Enforced
                  </span>
                } @else {
                  <span class="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-surface-3 px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-muted">
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
                  class="relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2"
                  [class]="enforce2FA() ? 'bg-brand-700' : 'bg-gray-200 dark:bg-surface-3'"
                  role="switch"
                  [attr.aria-checked]="enforce2FA()"
                >
                  <span
                    class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-surface shadow ring-0 transition duration-200 ease-in-out"
                    [class]="enforce2FA() ? 'translate-x-5' : 'translate-x-0'"
                  ></span>
                </button>
                <div>
                  <span class="text-sm font-medium text-gray-700 dark:text-ink-dim">Enforce 2FA for all users</span>
                  <p class="text-xs text-gray-500 dark:text-muted">When enabled, users must set up 2FA before accessing the application. Applies to email/password logins only.</p>
                </div>
              </label>
            </div>
            <div class="border-t border-gray-100 dark:border-line px-6 py-3 bg-gray-50/50 flex justify-end dark:bg-surface-2">
              <button
                (click)="save2FA()"
                [disabled]="saving()"
                class="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50 transition-colors"
              >
                {{ saving() ? 'Saving...' : 'Save 2FA Settings' }}
              </button>
            </div>
          </div>

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Passkeys (FIDO2)                                       -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel flex flex-col">
            <div class="app-panel-header app-panel-header--indigo">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--indigo">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-indigo-600 dark:text-indigo-400" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Passkeys (FIDO2)</h3>
                <p class="text-xs text-gray-500 dark:text-muted">Allow users to authenticate with biometrics, security keys, or device PIN.</p>
              </div>
              <div class="flex items-center gap-2">
                @if (passkeyEnabled()) {
                  <span class="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                    <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
                    Enabled
                  </span>
                } @else {
                  <span class="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-surface-3 px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-muted">
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
                  class="relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2"
                  [class]="passkeyEnabled() ? 'bg-brand-700' : 'bg-gray-200 dark:bg-surface-3'"
                  role="switch"
                  [attr.aria-checked]="passkeyEnabled()"
                >
                  <span
                    class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-surface shadow ring-0 transition duration-200 ease-in-out"
                    [class]="passkeyEnabled() ? 'translate-x-5' : 'translate-x-0'"
                  ></span>
                </button>
                <div>
                  <span class="text-sm font-medium text-gray-700 dark:text-ink-dim">Allow passkeys as a 2FA method</span>
                  <p class="text-xs text-gray-500 dark:text-muted">Users can register a passkey (fingerprint, Face ID, security key) as a second factor during login.</p>
                </div>
              </label>

              @if (passkeyEnabled()) {
                <label class="flex items-center gap-3 cursor-pointer ml-14">
                  <button
                    type="button"
                    (click)="passkeyAllowPasswordless.set(!passkeyAllowPasswordless())"
                    class="relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2"
                    [class]="passkeyAllowPasswordless() ? 'bg-brand-700' : 'bg-gray-200 dark:bg-surface-3'"
                    role="switch"
                    [attr.aria-checked]="passkeyAllowPasswordless()"
                  >
                    <span
                      class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-surface shadow ring-0 transition duration-200 ease-in-out"
                      [class]="passkeyAllowPasswordless() ? 'translate-x-5' : 'translate-x-0'"
                    ></span>
                  </button>
                  <div>
                    <span class="text-sm font-medium text-gray-700 dark:text-ink-dim">Allow passwordless login</span>
                    <p class="text-xs text-gray-500 dark:text-muted">Users with registered passkeys can sign in without entering a password. The passkey replaces both password and 2FA.</p>
                  </div>
                </label>
              }

              <div class="mt-3 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 p-3">
                <p class="text-xs text-indigo-700 dark:text-indigo-400">
                  <strong>How it works:</strong> Each user can register passkeys from their profile settings. 
                  Passkeys use the WebAuthn (FIDO2) standard and are supported by all modern browsers and devices 
                  including Touch ID, Face ID, Windows Hello, and hardware security keys.
                </p>
              </div>
            </div>
            <div class="border-t border-gray-100 dark:border-line px-6 py-3 bg-gray-50/50 flex justify-end dark:bg-surface-2">
              <button
                (click)="savePasskey()"
                [disabled]="saving()"
                class="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50 transition-colors"
              >
                {{ saving() ? 'Saving...' : 'Save Passkey Settings' }}
              </button>
            </div>
          </div>

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Session & Token Settings                               -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel flex flex-col">
            <div class="app-panel-header app-panel-header--purple">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--purple">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-purple-600 dark:text-purple-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Session &amp; Token Policies</h3>
                <p class="text-xs text-gray-500 dark:text-muted">Control how long users stay signed in.</p>
              </div>
            </div>
            <div class="flex-1 px-6 py-5 space-y-5">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim mb-1">Token Expiration</label>
                <div class="flex items-center gap-2">
                  <input
                    type="number"
                    [ngModel]="tokenExpirationMinutes()"
                    (ngModelChange)="tokenExpirationMinutes.set($event)"
                    min="5"
                    max="1440"
                    class="w-24 rounded-md border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                  />
                  <span class="text-sm text-gray-500 dark:text-muted">minutes</span>
                </div>
                <p class="mt-1 text-xs text-gray-500 dark:text-muted">How long a JWT access token is valid before requiring refresh. Default: 15 min.</p>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim mb-1">Idle Session Timeout</label>
                <div class="flex items-center gap-2">
                  <input
                    type="number"
                    [ngModel]="sessionTimeoutMinutes()"
                    (ngModelChange)="sessionTimeoutMinutes.set($event)"
                    min="5"
                    max="10080"
                    class="w-24 rounded-md border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                  />
                  <span class="text-sm text-gray-500 dark:text-muted">minutes</span>
                  <span class="text-xs text-gray-400 dark:text-muted ml-2">({{ formatDuration(sessionTimeoutMinutes()) }})</span>
                </div>
                <p class="mt-1 text-xs text-gray-500 dark:text-muted">Inactive sessions are terminated after this period. Default: 480 min (8 hours).</p>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim mb-1">Document Verification Link Expiry</label>
                <div class="flex items-center gap-2">
                  <input
                    type="number"
                    [ngModel]="documentVerificationLinkExpiryDays()"
                    (ngModelChange)="documentVerificationLinkExpiryDays.set($event)"
                    min="0"
                    max="3650"
                    class="w-24 rounded-md border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                  />
                  <span class="text-sm text-gray-500 dark:text-muted">days</span>
                </div>
                <p class="mt-1 text-xs text-gray-500 dark:text-muted">Public verification links expire after this many days. Set 0 for no expiry.</p>
              </div>
            </div>
            <div class="border-t border-gray-100 dark:border-line px-6 py-3 bg-gray-50/50 flex justify-end dark:bg-surface-2">
              <button
                (click)="saveSession()"
                [disabled]="saving()"
                class="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50 transition-colors"
              >
                {{ saving() ? 'Saving...' : 'Save Session Settings' }}
              </button>
            </div>
          </div>

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Microsoft Email Policy                                  -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel flex flex-col">
            <div class="app-panel-header app-panel-header--blue">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--blue">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600 dark:text-blue-400" viewBox="0 0 23 23" fill="currentColor">
                  <path d="M1 1h10v10H1z"/>
                  <path d="M12 1h10v10H12z"/>
                  <path d="M1 12h10v10H1z"/>
                  <path d="M12 12h10v10H12z"/>
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Microsoft Email Policy</h3>
                <p class="text-xs text-gray-500 dark:text-muted">Control which Microsoft accounts users can connect for sending emails.</p>
              </div>
            </div>
            <div class="flex-1 px-6 py-5 space-y-5">
              <!-- Force same email toggle -->
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-ink">Require matching email</p>
                  <p class="text-xs text-gray-500 dark:text-muted">Users must connect the same Microsoft email as their Fueld account.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  (click)="microsoftForceEmail.set(!microsoftForceEmail())"
                  [class]="microsoftForceEmail() ? 'bg-brand-700' : 'bg-gray-200 dark:bg-surface-3'"
                  class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2"
                  [attr.aria-checked]="microsoftForceEmail()"
                >
                  <span
                    [class]="microsoftForceEmail() ? 'translate-x-5' : 'translate-x-0'"
                    class="pointer-events-none inline-block h-5 w-5 translate-y-0.5 transform rounded-full bg-white dark:bg-surface shadow ring-0 transition duration-200 ease-in-out"
                  ></span>
                </button>
              </div>

              <!-- Approved domains -->
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim mb-1">Approved email domains</label>
                <div
                  class="flex min-h-[42px] w-full flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors"
                  [class]="approvedDomainsError() ? 'border-red-300 bg-red-50/30' : approvedDomainsFocused() ? 'border-brand-500 ring-1 ring-brand-500' : 'border-gray-300 dark:border-line-strong'"
                  (click)="focusApprovedDomainsInput()"
                >
                  @for (domain of approvedDomains(); track domain) {
                    <span class="inline-flex max-w-full items-center gap-1 rounded-full bg-blue-50 dark:bg-blue-500/15 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-400">
                      <span class="truncate">{{ domain }}</span>
                      <button
                        type="button"
                        class="inline-flex h-4 w-4 items-center justify-center rounded-full text-blue-500 dark:text-blue-300 transition hover:bg-blue-100 dark:hover:bg-blue-500/20 hover:text-blue-700"
                        (click)="removeApprovedDomain(domain); $event.stopPropagation()"
                        [disabled]="saving()"
                        aria-label="Remove approved domain"
                      >
                        <svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                        </svg>
                      </button>
                    </span>
                  }

                  <input
                    #approvedDomainInputEl
                    type="text"
                    [ngModel]="approvedDomainsDraft()"
                    (ngModelChange)="onApprovedDomainsDraftChange($event)"
                    (focus)="approvedDomainsFocused.set(true)"
                    (blur)="approvedDomainsFocused.set(false); commitApprovedDomainsDraft()"
                    (keydown)="onApprovedDomainsKeydown($event)"
                    (paste)="onApprovedDomainsPaste($event)"
                    name="approvedDomains"
                    placeholder="{{ approvedDomains().length === 0 ? 'Type a domain and press Enter' : 'Add another domain' }}"
                    class="min-w-[180px] flex-1 border-none bg-transparent p-0 text-sm placeholder:text-gray-400 dark:placeholder:text-muted focus:outline-none focus:ring-0"
                  />
                </div>
                @if (approvedDomainsError()) {
                  <p class="mt-1 text-xs text-red-600 dark:text-red-400">{{ approvedDomainsError() }}</p>
                } @else {
                  <p class="mt-1 text-xs text-gray-500 dark:text-muted">Press Enter, comma, or paste a list to add domains. Leave empty to allow any domain.</p>
                }
              </div>
            </div>
            <div class="border-t border-gray-100 dark:border-line px-6 py-3 bg-gray-50/50 flex justify-end dark:bg-surface-2">
              <button
                (click)="saveMicrosoftPolicy()"
                [disabled]="saving() || hasApprovedDomainsValidationError()"
                class="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50 transition-colors"
              >
                {{ saving() ? 'Saving...' : 'Save Email Policy' }}
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
  readonly documentVerificationLinkExpiryDays = signal(0);

  // Microsoft Email Policy
  readonly microsoftForceEmail = signal(false);
  readonly approvedDomains = signal<string[]>([]);
  readonly approvedDomainsDraft = signal('');
  readonly approvedDomainsError = signal<string | null>(null);
  readonly approvedDomainsFocused = signal(false);
  readonly hasApprovedDomainsValidationError = computed(() => this.approvedDomainsError() !== null);

  private readonly approvedDomainInputEl = viewChild<ElementRef<HTMLInputElement>>('approvedDomainInputEl');

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
        this.documentVerificationLinkExpiryDays.set(res.data.documentVerificationLinkExpiryDays ?? 0);
        this.microsoftForceEmail.set(res.data.microsoftConnectForceUserEmail ?? false);
        this.approvedDomains.set([...(res.data.approvedEmailDomains ?? [])].map((domain) => domain.trim().toLowerCase()));
        this.approvedDomainsDraft.set('');
        this.approvedDomainsError.set(null);
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
        ssoEnabled: this.ssoEnabled(),
      };
      await firstValueFrom(this.http.put(`${API}/admin/security`, body));
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
          documentVerificationLinkExpiryDays: this.documentVerificationLinkExpiryDays(),
        }),
      );
      this.showSuccess();
    } catch {
      // silent
    } finally {
      this.saving.set(false);
    }
  }

  async saveMicrosoftPolicy(): Promise<void> {
    if (!this.commitApprovedDomainsDraft()) {
      this.focusApprovedDomainsInput();
      return;
    }

    this.saving.set(true);
    try {
      await firstValueFrom(
        this.http.put(`${API}/admin/security`, {
          microsoftConnectForceUserEmail: this.microsoftForceEmail(),
          approvedEmailDomains: this.approvedDomains(),
        }),
      );
      this.showSuccess();
    } catch (error) {
      const message = error instanceof HttpErrorResponse
        ? error.error?.message
        : null;
      if (typeof message === 'string' && message.length > 0) {
        this.approvedDomainsError.set(message);
      }
    } finally {
      this.saving.set(false);
    }
  }

  focusApprovedDomainsInput(): void {
    this.approvedDomainInputEl()?.nativeElement?.focus();
  }

  onApprovedDomainsDraftChange(value: string): void {
    this.approvedDomainsDraft.set(value);
    this.approvedDomainsError.set(this.getApprovedDomainValidationMessage(value));
  }

  onApprovedDomainsKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
      event.preventDefault();
      this.commitApprovedDomainsDraft();
      return;
    }

    if (event.key === 'Backspace' && this.approvedDomainsDraft().trim() === '') {
      const domains = this.approvedDomains();
      if (domains.length > 0) {
        this.removeApprovedDomain(domains[domains.length - 1]);
      }
    }
  }

  onApprovedDomainsPaste(event: ClipboardEvent): void {
    const pastedText = event.clipboardData?.getData('text')?.trim() ?? '';
    if (!pastedText || !/[\n,;]/.test(pastedText)) {
      return;
    }

    event.preventDefault();
    const entries = pastedText
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    for (const entry of entries) {
      if (!this.addApprovedDomain(entry)) {
        this.approvedDomainsDraft.set(entry);
        return;
      }
    }

    this.approvedDomainsDraft.set('');
    this.approvedDomainsError.set(null);
  }

  removeApprovedDomain(domain: string): void {
    this.approvedDomains.update((domains) => domains.filter((item) => item !== domain));
    this.approvedDomainsError.set(this.getApprovedDomainValidationMessage(this.approvedDomainsDraft()));
  }

  commitApprovedDomainsDraft(): boolean {
    const rawValue = this.approvedDomainsDraft();
    const entries = rawValue
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    if (entries.length === 0) {
      this.approvedDomainsDraft.set('');
      this.approvedDomainsError.set(null);
      return true;
    }

    for (const entry of entries) {
      if (!this.addApprovedDomain(entry)) {
        this.approvedDomainsDraft.set(entry);
        return false;
      }
    }

    this.approvedDomainsDraft.set('');
    this.approvedDomainsError.set(null);
    return true;
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

  private addApprovedDomain(value: string): boolean {
    const message = this.getApprovedDomainValidationMessage(value);
    if (message) {
      this.approvedDomainsError.set(message);
      return false;
    }

    const normalized = this.normalizeApprovedDomain(value);
    this.approvedDomains.update((domains) => [...domains, normalized]);
    this.approvedDomainsError.set(null);
    return true;
  }

  private getApprovedDomainValidationMessage(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const normalized = this.normalizeApprovedDomain(trimmed);

    if (normalized.includes('://')) {
      return 'Enter only the domain, without http:// or https://.';
    }

    if (normalized.includes('@')) {
      return 'Enter only the domain, not a full email address.';
    }

    if (/\s|\//.test(normalized)) {
      return 'Enter a valid domain like example.com.';
    }

    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(normalized)) {
      return 'Enter a valid domain like example.com.';
    }

    if (this.approvedDomains().includes(normalized)) {
      return 'This domain has already been added.';
    }

    return null;
  }

  private normalizeApprovedDomain(value: string): string {
    return value.trim().toLowerCase().replace(/^@/, '').replace(/\.+$/, '');
  }
}
