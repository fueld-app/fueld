import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, IntegrationStatusDto } from '@fueld/types';

import { API } from '@app/core/config/api';

@Component({
  selector: 'app-integrations-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <!-- Header -->
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900">Integrations</h1>
        <p class="mt-1 text-sm text-gray-500">
          Manage API credentials for third-party data providers. Credentials are encrypted at rest.
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
        <div class="grid gap-6 lg:grid-cols-2">

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  LLI / Seasearcher Card                                -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-base font-semibold text-gray-900">Lloyd's List Intelligence / Seasearcher</h3>
                <p class="text-sm text-gray-500">Vessel tracking &amp; port data from Lloyd's List Intelligence.</p>
              </div>
              <div>
                @if (lliStatus()?.configured) {
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

            @if (lliStatus()?.configured) {
              <div class="border-b border-gray-100 bg-gray-50/50 px-6 py-3">
                <div class="flex items-center gap-6 text-sm">
                  <div>
                    <span class="text-gray-500">Username:</span>
                    <span class="ml-1.5 font-medium text-gray-900">{{ lliStatus()!.username }}</span>
                  </div>
                  @if (lliStatus()!.updatedAt) {
                    <div>
                      <span class="text-gray-500">Last updated:</span>
                      <span class="ml-1.5 text-gray-700">{{ formatDate(lliStatus()!.updatedAt!) }}</span>
                    </div>
                  }
                  @if (lliStatus()!.updatedBy) {
                    <div>
                      <span class="text-gray-500">by</span>
                      <span class="ml-1 text-gray-700">{{ lliStatus()!.updatedBy }}</span>
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
                    [placeholder]="lliStatus()?.configured ? '••••••••  (enter new password to update)' : 'Enter your LLI password'"
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

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  SMTP (Invite Emails)                                 -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
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
                @if (smtpStatus()?.configured) {
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
                    [placeholder]="smtpStatus()?.configured ? 'Enter new password to update' : 'Enter SMTP password'"
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

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Microsoft 365 / Entra ID                              -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-sky-600" viewBox="0 0 23 23" fill="currentColor">
                  <path d="M0 0h11v11H0zM12 0h11v11H12zM0 12h11v11H0zM12 12h11v11H12z"/>
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-base font-semibold text-gray-900">Microsoft 365 / Entra ID</h3>
                <p class="text-sm text-gray-500">SSO login &amp; send email via Microsoft Graph (Mail.Send).</p>
              </div>
              <div>
                @if (msStatus()?.configured) {
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

              @if (msStatus()?.configured) {
                <div class="mb-4 text-sm text-gray-500 space-y-1">
                  <p><span class="font-medium text-gray-700">Client ID:</span> {{ msStatus()?.msClientId }}</p>
                  <p><span class="font-medium text-gray-700">Tenant ID:</span> {{ msStatus()?.msTenantId || 'common' }}</p>
                  @if (msStatus()?.updatedBy) {
                    <p class="text-xs text-gray-400">Last updated by {{ msStatus()?.updatedBy }}</p>
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
                    [placeholder]="msStatus()?.configured ? 'Enter new secret to update' : 'Enter client secret'"
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

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Web Push (VAPID)                                     -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-600" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 2a6 6 0 00-6 6v2.5c0 .67-.167 1.33-.486 1.92l-.91 1.67A1 1 0 004.5 16h11a1 1 0 00.896-1.41l-.91-1.67A4 4 0 0115 10.5V8a6 6 0 00-6-6zm0 16a2.5 2.5 0 002.45-2h-4.9A2.5 2.5 0 0010 18z" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-base font-semibold text-gray-900">Web Push Notifications</h3>
                <p class="text-sm text-gray-500">Configure VAPID keys to enable browser push notifications.</p>
              </div>
              <div>
                @if (pushStatus()?.configured) {
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

            @if (pushStatus()?.configured) {
              <div class="border-b border-gray-100 bg-gray-50/50 px-6 py-3">
                <div class="flex flex-wrap items-center gap-4 text-sm">
                  @if (pushStatus()!.pushPublicKey) {
                    <div class="truncate">
                      <span class="text-gray-500">Public key:</span>
                      <span class="ml-1.5 font-medium text-gray-900">{{ pushStatus()!.pushPublicKey }}</span>
                    </div>
                  }
                  @if (pushStatus()!.updatedAt) {
                    <div>
                      <span class="text-gray-500">Updated:</span>
                      <span class="ml-1.5 text-gray-700">{{ formatDate(pushStatus()!.updatedAt!) }}</span>
                    </div>
                  }
                  @if (pushStatus()!.updatedBy) {
                    <div>
                      <span class="text-gray-500">by</span>
                      <span class="ml-1 text-gray-700">{{ pushStatus()!.updatedBy }}</span>
                    </div>
                  }
                </div>
              </div>
            }

            <div class="px-6 py-5">
              @if (pushSaveSuccess()) {
                <div class="mb-4 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                  </svg>
                  {{ pushSaveSuccess() }}
                </div>
              }
              @if (pushSaveError()) {
                <div class="mb-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
                  </svg>
                  {{ pushSaveError() }}
                </div>
              }

              <div class="space-y-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700">VAPID Public Key</label>
                  <input type="text" [ngModel]="pushPublicKey()" (ngModelChange)="pushPublicKey.set($event)"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                    placeholder="BGo..." autocomplete="off" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700">VAPID Private Key</label>
                  <input type="password" [ngModel]="pushPrivateKey()" (ngModelChange)="pushPrivateKey.set($event)"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                    [placeholder]="pushStatus()?.configured ? 'Enter new private key to update' : 'Enter VAPID private key'"
                    autocomplete="new-password" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700">VAPID Subject</label>
                  <input type="text" [ngModel]="pushSubject()" (ngModelChange)="pushSubject.set($event)"
                    class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                    placeholder="mailto:support@fueld.app" />
                </div>
              </div>

              <div class="mt-5 flex items-center gap-3">
                <button (click)="savePushCredentials()" [disabled]="pushSaving()"
                  class="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-50 transition-colors">
                  @if (pushSaving()) {
                    <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    Saving…
                  } @else {
                    Save Push Settings
                  }
                </button>
                <span class="text-xs text-gray-400">Keys are stored encrypted.</span>
              </div>
            </div>
          </div>

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  QuickBooks Card                                       -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <!-- Card Header -->
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-emerald-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-base font-semibold text-gray-900">QuickBooks</h3>
                <p class="text-sm text-gray-500">Sync orders &amp; invoices with QuickBooks for accounting.</p>
              </div>
              <div>
                @if (qbStatus()?.configured) {
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

            <!-- Connected Info -->
            @if (qbStatus()?.configured) {
              <div class="border-b border-gray-100 bg-gray-50/50 px-6 py-3">
                <div class="flex items-center gap-6 text-sm">
                  <div>
                    <span class="text-gray-500">Company:</span>
                    <span class="ml-1.5 font-medium text-gray-900">{{ qbStatus()!.companyName ?? qbStatus()!.username }}</span>
                  </div>
                  <div>
                    <span class="text-gray-500">Type:</span>
                    <span class="ml-1.5 font-medium text-gray-900">{{ qbStatus()!.connectionType === 'online' ? 'QuickBooks Online' : 'QuickBooks Desktop' }}</span>
                  </div>
                  @if (qbStatus()!.updatedAt) {
                    <div>
                      <span class="text-gray-500">Connected:</span>
                      <span class="ml-1.5 text-gray-700">{{ formatDate(qbStatus()!.updatedAt!) }}</span>
                    </div>
                  }
                  @if (qbStatus()!.updatedBy) {
                    <div>
                      <span class="text-gray-500">by</span>
                      <span class="ml-1 text-gray-700">{{ qbStatus()!.updatedBy }}</span>
                    </div>
                  }
                </div>
              </div>
            }

            <div class="px-6 py-5">
              <!-- QB Success / Error Messages -->
              @if (qbSuccessMessage()) {
                <div class="mb-4 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                  </svg>
                  {{ qbSuccessMessage() }}
                </div>
              }
              @if (qbErrorMessage()) {
                <div class="mb-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
                  </svg>
                  {{ qbErrorMessage() }}
                </div>
              }

              @if (qbStatus()?.configured) {
                <!-- When connected: show disconnect button -->
                <div class="flex items-center gap-4">
                  <p class="text-sm text-gray-600 flex-1">
                    QuickBooks is connected and ready to sync orders and invoices.
                  </p>
                  <button (click)="disconnectQuickBooks()" [disabled]="qbSaving()"
                    class="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors">
                    @if (qbSaving()) {
                      <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                      Disconnecting…
                    } @else {
                      Disconnect
                    }
                  </button>
                </div>
              } @else {
                <!-- Connection Type Toggle -->
                <div class="mb-5">
                  <label class="block text-sm font-medium text-gray-700 mb-2">Connection Type</label>
                  <div class="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
                    <button (click)="qbConnectionType.set('online')"
                      [class]="qbConnectionType() === 'online'
                        ? 'px-4 py-1.5 rounded-md text-sm font-medium bg-white shadow-sm text-gray-900 transition-all'
                        : 'px-4 py-1.5 rounded-md text-sm font-medium text-gray-500 hover:text-gray-700 transition-all'">
                      QuickBooks Online
                    </button>
                    <button (click)="qbConnectionType.set('desktop')"
                      [class]="qbConnectionType() === 'desktop'
                        ? 'px-4 py-1.5 rounded-md text-sm font-medium bg-white shadow-sm text-gray-900 transition-all'
                        : 'px-4 py-1.5 rounded-md text-sm font-medium text-gray-500 hover:text-gray-700 transition-all'">
                      QuickBooks Desktop
                    </button>
                  </div>
                </div>

                @if (qbConnectionType() === 'online') {
                  <!-- QuickBooks Online — OAuth2 Connect -->
                  <div class="space-y-4">
                    <div class="rounded-lg bg-blue-50 border border-blue-100 p-4">
                      <div class="flex gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
                        </svg>
                        <div class="text-sm text-blue-800">
                          <p class="font-medium">How it works</p>
                          <p class="mt-1">
                            Click "Connect" to sign in with your Intuit account. You'll authorise Fueld to read and create
                            invoices in your QuickBooks Online company. No passwords are stored — we use secure OAuth2 tokens.
                          </p>
                        </div>
                      </div>
                    </div>

                    <button (click)="connectQuickBooksOnline()" [disabled]="qbSaving()"
                      class="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                      @if (qbSaving()) {
                        <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                        Connecting…
                      } @else {
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14a1 1 0 11-2 0 1 1 0 012 0zm0-7a1 1 0 10-2 0v3a1 1 0 102 0V7z" clip-rule="evenodd" />
                        </svg>
                        Connect to QuickBooks Online
                      }
                    </button>
                  </div>
                } @else {
                  <!-- QuickBooks Desktop — Web Connector Credentials -->
                  <div class="space-y-4">
                    <div class="rounded-lg bg-amber-50 border border-amber-100 p-4">
                      <div class="flex gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-600 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
                        </svg>
                        <div class="text-sm text-amber-800">
                          <p class="font-medium">QuickBooks Desktop Integration</p>
                          <p class="mt-1">
                            Enter the credentials for the QuickBooks Web Connector. These will be used to authenticate
                            sync requests between Fueld and your QuickBooks Desktop application.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label class="block text-sm font-medium text-gray-700">Company Name</label>
                      <input type="text" [ngModel]="qbDesktopCompanyName()" (ngModelChange)="qbDesktopCompanyName.set($event)"
                        class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                        placeholder="e.g. My Company Ltd" />
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700">Web Connector Username</label>
                      <input type="text" [ngModel]="qbDesktopUsername()" (ngModelChange)="qbDesktopUsername.set($event)"
                        class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                        placeholder="web-connector-user" autocomplete="off" />
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700">Web Connector Password</label>
                      <input type="password" [ngModel]="qbDesktopPassword()" (ngModelChange)="qbDesktopPassword.set($event)"
                        class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                        placeholder="Enter password" autocomplete="new-password" />
                    </div>

                    <div class="mt-5 flex items-center gap-3">
                      <button (click)="saveDesktopCredentials()" [disabled]="qbSaving()"
                        class="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                        @if (qbSaving()) {
                          <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                          </svg>
                          Saving…
                        } @else {
                          Save Desktop Credentials
                        }
                      </button>
                    </div>
                  </div>
                }
              }
            </div>
          </div>

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  WhatsApp Integration                                  -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12.05 21.785c-1.875 0-3.713-.504-5.322-1.46l-.382-.227-3.961.99 1.01-3.694-.25-.394A9.848 9.848 0 011.847 12c0-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.82 9.82 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884zm0-21.67C5.495.115.112 5.498.112 12.055c0 2.104.549 4.162 1.595 5.98L.05 24l6.148-1.612a11.87 11.87 0 005.843 1.53h.005c6.554 0 11.89-5.335 11.893-11.893A11.82 11.82 0 0020.526 3.49 11.81 11.81 0 0012.05.115z" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-base font-semibold text-gray-900">WhatsApp</h3>
                <p class="text-sm text-gray-500">Enable WhatsApp messaging, RFQ parsing, and set a default broadcast group.</p>
              </div>
              <div>
                @if (waEnabled()) {
                  <span class="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 ring-1 ring-green-600/20">
                    <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
                    Enabled
                  </span>
                } @else {
                  <span class="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-500/10">
                    <span class="h-1.5 w-1.5 rounded-full bg-gray-400"></span>
                    Disabled
                  </span>
                }
              </div>
            </div>

            <div class="px-6 py-5">
              @if (waSaveSuccess()) {
                <div class="mb-4 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                  </svg>
                  {{ waSaveSuccess() }}
                </div>
              }
              @if (waSaveError()) {
                <div class="mb-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
                  </svg>
                  {{ waSaveError() }}
                </div>
              }

              <!-- Enable/Disable toggle -->
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium text-gray-900">Enable WhatsApp</p>
                  <p class="text-xs text-gray-500">Allow users to link their WhatsApp accounts and send messages.</p>
                </div>
                <button
                  (click)="toggleWhatsApp()"
                  [disabled]="waSaving()"
                  [class]="waEnabled()
                    ? 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-green-500 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50'
                    : 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50'"
                >
                  <span
                    [class]="waEnabled()
                      ? 'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-5'
                      : 'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-0'"
                  ></span>
                </button>
              </div>

              <!-- Incoming RFQ parsing toggle -->
              @if (waEnabled()) {
                <div class="mt-4 flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium text-gray-900">Enable Incoming RFQs</p>
                    <p class="text-xs text-gray-500">Parse incoming WhatsApp DMs and create RFQs automatically.</p>
                  </div>
                  <button
                    (click)="toggleWaIncomingRfq()"
                    [disabled]="waSaving()"
                    [class]="waIncomingRfqEnabled()
                      ? 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-green-500 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50'
                      : 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50'"
                  >
                    <span
                      [class]="waIncomingRfqEnabled()
                        ? 'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-5'
                        : 'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-0'"
                    ></span>
                  </button>
                </div>
              }

              <!-- Default Group picker (visible when enabled) -->
              @if (waEnabled()) {
                <div class="mt-5 border-t border-gray-100 pt-5">
                  <label class="block text-sm font-medium text-gray-700">Default Group</label>
                  <p class="mt-0.5 text-xs text-gray-500">
                    WhatsApp group for automatic RFQ sharing. Requires a user to have WhatsApp linked.
                  </p>
                  <div class="relative mt-2 flex items-center gap-2">
                    <!-- Typeahead input -->
                    <div class="relative flex-1">
                      <input
                        type="text"
                        [value]="waGroupSearch()"
                        (input)="waGroupSearch.set($any($event.target).value); waGroupDropdownOpen.set(true)"
                        (focus)="waGroupDropdownOpen.set(true)"
                        (blur)="waGroupDropdownOpen.set(false); syncWaGroupSearchText()"
                        (keydown.escape)="waGroupDropdownOpen.set(false)"
                        [disabled]="waGroupsLoading() || waSaving()"
                        placeholder="Search groups…"
                        autocomplete="off"
                        class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm
                               focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
                      />
                      @if (waGroupSearch() && !waGroupsLoading()) {
                        <button
                          (click)="clearWaGroupSelection()"
                          class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          title="Clear selection"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      }

                      <!-- Dropdown -->
                      @if (waGroupDropdownOpen() && !waGroupsLoading()) {
                        <div
                          class="absolute left-0 top-full z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg"
                          (mousedown)="$event.preventDefault()"
                        >
                          <button
                            (click)="selectWaGroup('', 'None')"
                            class="flex w-full items-center px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50 transition-colors"
                            [class.bg-brand-50]="!waDefaultGroupJid()"
                          >
                            None
                          </button>
                          @for (g of filteredWaGroups(); track g.jid) {
                            <button
                              (click)="selectWaGroup(g.jid, g.name + ' (' + g.participants + ')')"
                              class="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-50 transition-colors"
                              [class.bg-brand-50]="g.jid === waDefaultGroupJid()"
                            >
                              <span>{{ g.name }}</span>
                              <span class="text-xs text-gray-400">{{ g.participants }} members</span>
                            </button>
                          } @empty {
                            @if (waGroups().length) {
                              <div class="px-3 py-2 text-sm text-gray-400">No groups matching "{{ waGroupSearch() }}"</div>
                            }
                          }
                        </div>
                      }
                    </div>

                    <!-- Refresh button -->
                    <button
                      (click)="loadWaGroups()"
                      [disabled]="waGroupsLoading()"
                      class="rounded-lg border border-gray-300 p-2 text-gray-500 hover:bg-gray-50 transition-colors disabled:opacity-50"
                      title="Refresh groups"
                    >
                      @if (waGroupsLoading()) {
                        <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                      } @else {
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="23 4 23 10 17 10" />
                          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                        </svg>
                      }
                    </button>
                  </div>
                  @if (!waGroups().length && !waGroupsLoading()) {
                    <p class="mt-2 text-xs text-amber-600">
                      No groups available. Make sure at least one user has linked WhatsApp, then click refresh.
                    </p>
                  }
                </div>
              }
            </div>
          </div>

        </div>
      }
    </div>
  `,
})
export class IntegrationsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);

  // ── General state ──────────────────────────────────────────────────
  readonly loading = signal(true);
  readonly integrations = signal<IntegrationStatusDto[]>([]);

  // ── LLI state ──────────────────────────────────────────────────────
  readonly formUsername = signal('');
  readonly formPassword = signal('');
  readonly saving = signal(false);
  readonly successMessage = signal('');
  readonly errorMessage = signal('');

  // ── QuickBooks state ───────────────────────────────────────────────
  readonly qbConnectionType = signal<'online' | 'desktop'>('online');
  readonly qbDesktopCompanyName = signal('');
  readonly qbDesktopUsername = signal('');
  readonly qbDesktopPassword = signal('');
  readonly qbSaving = signal(false);
  readonly qbSuccessMessage = signal('');
  readonly qbErrorMessage = signal('');

  // ── SMTP ─────────────────────────────────────────────────────────
  readonly smtpHost = signal('');
  readonly smtpPort = signal('587');
  readonly smtpUser = signal('');
  readonly smtpPass = signal('');
  readonly smtpFrom = signal('');
  readonly smtpSecure = signal(false);
  readonly smtpSaving = signal(false);
  readonly smtpSaveSuccess = signal('');
  readonly smtpSaveError = signal('');

  // ── SMTP Test ────────────────────────────────────────────────────
  readonly smtpTestEmail = signal('');
  readonly smtpTestSending = signal(false);
  readonly smtpTestSuccess = signal('');
  readonly smtpTestError = signal('');

  // ── Web Push (VAPID) ─────────────────────────────────────────────
  readonly pushPublicKey = signal('');
  readonly pushPrivateKey = signal('');
  readonly pushSubject = signal('mailto:support@fueld.app');
  readonly pushSaving = signal(false);
  readonly pushSaveSuccess = signal('');
  readonly pushSaveError = signal('');

  // ── Microsoft 365 / Entra ID ─────────────────────────────────────
  readonly msClientId = signal('');
  readonly msClientSecret = signal('');
  readonly msTenantId = signal('');
  readonly msSaving = signal(false);
  readonly msSaveSuccess = signal('');
  readonly msSaveError = signal('');

  // ── WhatsApp ─────────────────────────────────────────────────────
  readonly waEnabled = signal(false);
  readonly waIncomingRfqEnabled = signal(true);
  readonly waDefaultGroupJid = signal<string | null>(null);
  readonly waGroups = signal<{ jid: string; name: string; participants: number }[]>([]);
  readonly waGroupsLoading = signal(false);
  readonly waSaving = signal(false);
  readonly waSaveSuccess = signal('');
  readonly waSaveError = signal('');
  readonly waGroupSearch = signal('');
  readonly waGroupDropdownOpen = signal(false);
  readonly filteredWaGroups = computed(() => {
    const term = this.waGroupSearch().toLowerCase().trim();
    const groups = this.waGroups();
    if (!term) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(term));
  });

  // ── Computed status helpers ────────────────────────────────────────
  lliStatus = () => this.integrations().find((i) => i.provider.toUpperCase() === 'LLI') ?? null;
  qbStatus = () => this.integrations().find((i) => i.provider.toUpperCase() === 'QUICKBOOKS') ?? null;
  smtpStatus = () => this.integrations().find((i) => i.provider.toUpperCase() === 'SMTP') ?? null;
  pushStatus = () => this.integrations().find((i) => i.provider.toUpperCase() === 'PUSH') ?? null;
  msStatus = () => this.integrations().find((i) => i.provider.toUpperCase() === 'MICROSOFT') ?? null;

  ngOnInit(): void {
    // Check for QB OAuth callback query params
    this.route.queryParams.subscribe((params) => {
      if (params['qb'] === 'connected') {
        this.qbSuccessMessage.set('QuickBooks Online connected successfully!');
      } else if (params['qb'] === 'error') {
        const reason = params['reason'] ?? 'unknown';
        this.qbErrorMessage.set(`QuickBooks connection failed: ${reason}. Please try again.`);
      }
    });

    this.loadIntegrations();
  }

  async loadIntegrations(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<IntegrationStatusDto[]>>(`${API}/admin/settings/integrations`),
      );
      if (res.success) {
        this.integrations.set(res.data);
        // Pre-fill LLI username if already configured
        const lli = res.data.find((i) => i.provider.toUpperCase() === 'LLI');
        if (lli?.username) this.formUsername.set(lli.username);
        if (lli?.configured) this.formPassword.set('******');

        // Set QB connection type based on existing config
        const qb = res.data.find((i) => i.provider.toUpperCase() === 'QUICKBOOKS');
        if (qb?.connectionType) this.qbConnectionType.set(qb.connectionType);

        const smtp = res.data.find((i) => i.provider.toUpperCase() === 'SMTP');
        if (smtp?.smtpHost) this.smtpHost.set(smtp.smtpHost);
        if (smtp?.smtpPort) this.smtpPort.set(String(smtp.smtpPort));
        if (smtp?.smtpUser) this.smtpUser.set(smtp.smtpUser);
        if (smtp?.smtpFrom) this.smtpFrom.set(smtp.smtpFrom);
        if (typeof smtp?.smtpSecure === 'boolean') this.smtpSecure.set(smtp.smtpSecure);

        const push = res.data.find((i) => i.provider.toUpperCase() === 'PUSH');
        if (push?.pushPublicKey) this.pushPublicKey.set(push.pushPublicKey);
        if (push?.pushSubject) this.pushSubject.set(push.pushSubject);

        const ms = res.data.find((i) => i.provider.toUpperCase() === 'MICROSOFT');
        if (ms?.msClientId) this.msClientId.set(ms.msClientId);
        if (ms?.msTenantId) this.msTenantId.set(ms.msTenantId);
      }

      // Load WhatsApp settings
      const waRes = await firstValueFrom(
        this.http.get<ApiResponse<{ enabled: boolean; defaultGroupJid: string | null; incomingRfqEnabled: boolean }>>(`${API}/admin/settings/whatsapp`),
      );
      if (waRes.success) {
        this.waEnabled.set(waRes.data.enabled);
        this.waIncomingRfqEnabled.set(waRes.data.incomingRfqEnabled !== false);
        if (waRes.data.enabled) await this.loadWaGroups();
        this.waDefaultGroupJid.set(waRes.data.defaultGroupJid);
        this.syncWaGroupSearchText();
      }
    } catch (err) {
      console.error('Failed to load integrations:', err);
    } finally {
      this.loading.set(false);
    }
  }

  // ── LLI ────────────────────────────────────────────────────────────

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
        await this.loadIntegrations();
      }
    } catch (err: any) {
      const msg = err?.error?.error ?? 'Failed to verify credentials. Please check and try again.';
      this.errorMessage.set(msg);
    } finally {
      this.saving.set(false);
    }
  }

  // ── QuickBooks Online (OAuth2) ─────────────────────────────────────

  async connectQuickBooksOnline(): Promise<void> {
    this.qbSaving.set(true);
    this.qbSuccessMessage.set('');
    this.qbErrorMessage.set('');

    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ authUrl: string }>>(`${API}/admin/settings/integrations/quickbooks/auth-url`),
      );
      if (res.success && res.data.authUrl) {
        // Redirect the user to Intuit's authorization page
        window.location.href = res.data.authUrl;
      } else {
        this.qbErrorMessage.set('Failed to generate authorization URL. Please ensure QuickBooks app credentials are configured.');
      }
    } catch (err: any) {
      const msg = err?.error?.message ?? 'Failed to initiate QuickBooks connection.';
      this.qbErrorMessage.set(msg);
    } finally {
      this.qbSaving.set(false);
    }
  }

  // ── QuickBooks Desktop ─────────────────────────────────────────────

  async saveDesktopCredentials(): Promise<void> {
    const companyName = this.qbDesktopCompanyName().trim();
    const username = this.qbDesktopUsername().trim();
    const password = this.qbDesktopPassword().trim();

    if (!companyName) { this.qbErrorMessage.set('Company name is required.'); return; }
    if (!username) { this.qbErrorMessage.set('Username is required.'); return; }
    if (!password || password === '******') { this.qbErrorMessage.set('Please enter a password.'); return; }

    this.qbSaving.set(true);
    this.qbSuccessMessage.set('');
    this.qbErrorMessage.set('');

    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ saved: boolean }>>(`${API}/admin/settings/integrations/quickbooks/desktop`, {
          companyName, username, password,
        }),
      );
      if (res.success) {
        this.qbSuccessMessage.set('QuickBooks Desktop credentials saved successfully.');
        this.qbDesktopPassword.set('');
        await this.loadIntegrations();
      }
    } catch (err: any) {
      const msg = err?.error?.message ?? 'Failed to save Desktop credentials.';
      this.qbErrorMessage.set(msg);
    } finally {
      this.qbSaving.set(false);
    }
  }

  // ── QuickBooks Disconnect ──────────────────────────────────────────

  async disconnectQuickBooks(): Promise<void> {
    if (!confirm('Are you sure you want to disconnect QuickBooks? This will revoke access tokens and stop all syncing.')) {
      return;
    }

    this.qbSaving.set(true);
    this.qbSuccessMessage.set('');
    this.qbErrorMessage.set('');

    try {
      const res = await firstValueFrom(
        this.http.delete<ApiResponse<{ disconnected: boolean }>>(`${API}/admin/settings/integrations/quickbooks`),
      );
      if (res.success) {
        this.qbSuccessMessage.set('QuickBooks has been disconnected.');
        await this.loadIntegrations();
      }
    } catch (err: any) {
      const msg = err?.error?.message ?? 'Failed to disconnect QuickBooks.';
      this.qbErrorMessage.set(msg);
    } finally {
      this.qbSaving.set(false);
    }
  }

  // ── SMTP Save ────────────────────────────────────────────────────

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
        await this.loadIntegrations();
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

  // ── SMTP Test ────────────────────────────────────────────────────

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

  // ── Web Push (VAPID) ─────────────────────────────────────────────

  async savePushCredentials(): Promise<void> {
    const publicKey = this.pushPublicKey().trim();
    const privateKey = this.pushPrivateKey().trim();
    const subject = this.pushSubject().trim();

    if (!publicKey) { this.pushSaveError.set('VAPID public key is required.'); return; }
    if (!privateKey) { this.pushSaveError.set('VAPID private key is required.'); return; }
    if (!subject) { this.pushSaveError.set('VAPID subject is required.'); return; }

    this.pushSaving.set(true);
    this.pushSaveSuccess.set('');
    this.pushSaveError.set('');

    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ saved: boolean }>>(`${API}/admin/settings/integrations/push`, {
          publicKey,
          privateKey,
          subject,
        }),
      );

      if (res.success) {
        this.pushSaveSuccess.set('Push notification keys saved successfully.');
        this.pushPrivateKey.set('');
        await this.loadIntegrations();
      } else {
        this.pushSaveError.set(res.message ?? 'Failed to save push credentials.');
      }
    } catch (err: any) {
      const msg = err?.error?.message ?? err?.message ?? 'Failed to save push credentials.';
      this.pushSaveError.set(msg);
    } finally {
      this.pushSaving.set(false);
    }
  }

  // ── Microsoft 365 / Entra ID ──────────────────────────────────────

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
        await this.loadIntegrations();
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

  // ── WhatsApp ─────────────────────────────────────────────────────

  async toggleWhatsApp(): Promise<void> {
    this.waSaving.set(true);
    this.waSaveSuccess.set('');
    this.waSaveError.set('');
    const enabled = !this.waEnabled();

    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ enabled: boolean; defaultGroupJid: string | null; incomingRfqEnabled: boolean }>>(`${API}/admin/settings/whatsapp`, { enabled }),
      );
      if (res.success) {
        this.waEnabled.set(res.data.enabled);
        this.waIncomingRfqEnabled.set(res.data.incomingRfqEnabled !== false);
        this.waDefaultGroupJid.set(res.data.defaultGroupJid);
        this.waSaveSuccess.set(enabled ? 'WhatsApp integration enabled.' : 'WhatsApp integration disabled.');
        if (enabled) this.loadWaGroups();
      }
    } catch (err: any) {
      this.waSaveError.set(err?.error?.error ?? 'Failed to update WhatsApp settings.');
    } finally {
      this.waSaving.set(false);
    }
  }

  async toggleWaIncomingRfq(): Promise<void> {
    this.waSaving.set(true);
    this.waSaveSuccess.set('');
    this.waSaveError.set('');
    const incomingRfqEnabled = !this.waIncomingRfqEnabled();

    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ enabled: boolean; defaultGroupJid: string | null; incomingRfqEnabled: boolean }>>(`${API}/admin/settings/whatsapp`, { incomingRfqEnabled }),
      );
      if (res.success) {
        this.waEnabled.set(res.data.enabled);
        this.waIncomingRfqEnabled.set(res.data.incomingRfqEnabled !== false);
        this.waDefaultGroupJid.set(res.data.defaultGroupJid);
        this.waSaveSuccess.set(incomingRfqEnabled ? 'Incoming WhatsApp RFQ parsing enabled.' : 'Incoming WhatsApp RFQ parsing disabled.');
      }
    } catch (err: any) {
      this.waSaveError.set(err?.error?.error ?? 'Failed to update WhatsApp RFQ setting.');
    } finally {
      this.waSaving.set(false);
    }
  }

  async onWaGroupChange(jid: string): Promise<void> {
    this.waSaving.set(true);
    this.waSaveSuccess.set('');
    this.waSaveError.set('');

    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ enabled: boolean; defaultGroupJid: string | null; incomingRfqEnabled: boolean }>>(`${API}/admin/settings/whatsapp`, {
          defaultGroupJid: jid || null,
        }),
      );
      if (res.success) {
        this.waEnabled.set(res.data.enabled);
        this.waIncomingRfqEnabled.set(res.data.incomingRfqEnabled !== false);
        this.waDefaultGroupJid.set(res.data.defaultGroupJid);
        this.syncWaGroupSearchText();
        this.waSaveSuccess.set('Default group updated.');
      }
    } catch (err: any) {
      this.waSaveError.set(err?.error?.error ?? 'Failed to update default group.');
    } finally {
      this.waSaving.set(false);
    }
  }

  selectWaGroup(jid: string, displayName: string): void {
    this.waGroupDropdownOpen.set(false);
    this.waGroupSearch.set(jid ? displayName : '');
    this.onWaGroupChange(jid);
  }

  clearWaGroupSelection(): void {
    this.waGroupSearch.set('');
    this.waGroupDropdownOpen.set(false);
    this.onWaGroupChange('');
  }

  syncWaGroupSearchText(): void {
    const jid = this.waDefaultGroupJid();
    if (!jid) {
      this.waGroupSearch.set('');
      return;
    }
    const g = this.waGroups().find((x) => x.jid === jid);
    this.waGroupSearch.set(g ? `${g.name} (${g.participants})` : '');
  }

  async loadWaGroups(): Promise<void> {
    this.waGroupsLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ jid: string; name: string; participants: number }[]>>(`${API}/whatsapp/groups`),
      );
      if (res.success) this.waGroups.set(res.data);
    } catch (err) {
      console.error('Failed to load WhatsApp groups:', err);
    } finally {
      this.waGroupsLoading.set(false);
    }
  }

  // ── Utilities ──────────────────────────────────────────────────────

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
}
