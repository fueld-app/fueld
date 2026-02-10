import {
  Component,
  ChangeDetectionStrategy,
  signal,
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
          <!--  SMTP Test Card                                       -->
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
                <h3 class="text-base font-semibold text-gray-900">SMTP Test</h3>
                <p class="text-sm text-gray-500">Send a test email to verify SMTP credentials.</p>
              </div>
            </div>

            <div class="px-6 py-5">
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

              <div class="mt-5 flex items-center gap-3">
                <button (click)="sendSmtpTest()" [disabled]="smtpTestSending()"
                  class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors">
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
                <span class="text-xs text-gray-400">Uses SMTP settings from the server environment.</span>
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

  // ── SMTP Test ────────────────────────────────────────────────────
  readonly smtpTestEmail = signal('');
  readonly smtpTestSending = signal(false);
  readonly smtpTestSuccess = signal('');
  readonly smtpTestError = signal('');

  // ── Computed status helpers ────────────────────────────────────────
  lliStatus = () => this.integrations().find((i) => i.provider.toUpperCase() === 'LLI') ?? null;
  qbStatus = () => this.integrations().find((i) => i.provider.toUpperCase() === 'QUICKBOOKS') ?? null;

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

  // ── Utilities ──────────────────────────────────────────────────────

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
}
