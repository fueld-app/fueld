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
  selector: 'app-quickbooks-integration-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="app-panel">
      <!-- Card Header -->
      <div class="app-panel-header app-panel-header--emerald">
        <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--emerald">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-emerald-600 dark:text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd" />
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="text-base font-semibold text-gray-900 dark:text-ink">QuickBooks</h3>
          <p class="text-sm text-gray-500 dark:text-muted">Sync orders &amp; invoices with QuickBooks for accounting.</p>
        </div>
        <div>
          @if (status()?.configured) {
            <span class="inline-flex items-center gap-1.5 rounded-full bg-green-50 dark:bg-green-500/15 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-400 ring-1 ring-green-600/20">
              <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
              Connected
            </span>
          } @else {
            <span class="inline-flex items-center gap-1.5 rounded-full bg-gray-50 dark:bg-bg-2 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-ink-dim ring-1 ring-gray-500/10">
              <span class="h-1.5 w-1.5 rounded-full bg-gray-400"></span>
              Not Configured
            </span>
          }
        </div>
      </div>

      <!-- Connected Info -->
      @if (status()?.configured) {
        <div class="border-b border-gray-100 dark:border-line bg-gray-50/50 px-6 py-3 dark:bg-surface-2">
          <div class="flex items-center gap-6 text-sm">
            <div>
              <span class="text-gray-500 dark:text-muted">Company:</span>
              <span class="ml-1.5 font-medium text-gray-900 dark:text-ink">{{ status()!.companyName ?? status()!.username }}</span>
            </div>
            <div>
              <span class="text-gray-500 dark:text-muted">Type:</span>
              <span class="ml-1.5 font-medium text-gray-900 dark:text-ink">{{ status()!.connectionType === 'online' ? 'QuickBooks Online' : 'QuickBooks Desktop' }}</span>
            </div>
            @if (status()!.updatedAt) {
              <div>
                <span class="text-gray-500 dark:text-muted">Connected:</span>
                <span class="ml-1.5 text-gray-700 dark:text-ink-dim">{{ formatDate(status()!.updatedAt!) }}</span>
              </div>
            }
            @if (status()!.updatedBy) {
              <div>
                <span class="text-gray-500 dark:text-muted">by</span>
                <span class="ml-1 text-gray-700 dark:text-ink-dim">{{ status()!.updatedBy }}</span>
              </div>
            }
          </div>
          @if (status()!.connectionType === 'online' && status()!.tokenExpiresAt) {
            <div class="mt-2 flex items-center gap-2 text-xs">
              @if (isTokenExpiringSoon()) {
                <span class="inline-flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400 ring-1 ring-amber-600/20">
                  <span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                  Token expires soon — reconnect if sync stops working
                </span>
              } @else {
                <span class="text-gray-400 dark:text-muted">Token expires: {{ formatDate(status()!.tokenExpiresAt!) }}</span>
              }
            </div>
          }
        </div>
      }

      <div class="px-6 py-5">
        <!-- QB Success / Error Messages -->
        @if (qbSuccessMessage()) {
          <div class="mb-4 flex items-center gap-2 rounded-lg bg-green-50 dark:bg-green-500/15 border border-green-200 dark:border-green-500/30 p-3 text-sm text-green-700 dark:text-green-400">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
            </svg>
            {{ qbSuccessMessage() }}
          </div>
        }
        @if (qbErrorMessage()) {
          <div class="mb-4 flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 p-3 text-sm text-red-700 dark:text-red-400">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            {{ qbErrorMessage() }}
          </div>
        }

        @if (status()?.configured) {
          <!-- When connected: show disconnect button -->
          <div class="flex items-center gap-4">
            <p class="text-sm text-gray-600 dark:text-ink-dim flex-1">
              QuickBooks is connected and ready to sync orders and invoices.
            </p>
            <button (click)="disconnectQuickBooks()" [disabled]="qbSaving()"
              class="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white dark:bg-surface px-4 py-2 text-sm font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/15 disabled:opacity-50 transition-colors">
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
            <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim mb-2">Connection Type</label>
            <div class="inline-flex rounded-lg border border-gray-200 dark:border-line p-0.5 bg-gray-50 dark:bg-bg-2">
              <button (click)="qbConnectionType.set('online')"
                [class]="qbConnectionType() === 'online'
                  ? 'px-4 py-1.5 rounded-md text-sm font-medium bg-white dark:bg-surface shadow-sm text-gray-900 dark:text-ink transition-all'
                  : 'px-4 py-1.5 rounded-md text-sm font-medium text-gray-500 dark:text-muted hover:text-gray-700 transition-all'">
                QuickBooks Online
              </button>
              <button (click)="qbConnectionType.set('desktop')"
                [class]="qbConnectionType() === 'desktop'
                  ? 'px-4 py-1.5 rounded-md text-sm font-medium bg-white dark:bg-surface shadow-sm text-gray-900 dark:text-ink transition-all'
                  : 'px-4 py-1.5 rounded-md text-sm font-medium text-gray-500 dark:text-muted hover:text-gray-700 transition-all'">
                QuickBooks Desktop
              </button>
            </div>
          </div>

          @if (qbConnectionType() === 'online') {
            <!-- QuickBooks Online — OAuth2 Connect -->
            <div class="space-y-4">
              <div class="rounded-lg bg-blue-50 dark:bg-blue-500/15 border border-blue-100 dark:border-blue-500/25 p-4">
                <div class="flex gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
                  </svg>
                  <div class="text-sm text-blue-800 dark:text-blue-300">
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
              <div class="rounded-lg bg-amber-50 dark:bg-amber-500/15 border border-amber-100 dark:border-amber-500/25 p-4">
                <div class="flex gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
                  </svg>
                  <div class="text-sm text-amber-800 dark:text-amber-300">
                    <p class="font-medium">QuickBooks Desktop Integration</p>
                    <p class="mt-1">
                      Enter the credentials for the QuickBooks Web Connector. These will be used to authenticate
                      sync requests between Fueld and your QuickBooks Desktop application.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Company Name</label>
                <input type="text" [ngModel]="qbDesktopCompanyName()" (ngModelChange)="qbDesktopCompanyName.set($event)"
                  class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                  placeholder="e.g. My Company Ltd" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Web Connector Username</label>
                <input type="text" [ngModel]="qbDesktopUsername()" (ngModelChange)="qbDesktopUsername.set($event)"
                  class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                  placeholder="web-connector-user" autocomplete="off" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Web Connector Password</label>
                <input type="password" [ngModel]="qbDesktopPassword()" (ngModelChange)="qbDesktopPassword.set($event)"
                  class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
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
  `,
})
export class QuickBooksIntegrationCardComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toastService = inject(IntegrationsToastService);

  readonly integration = input.required<IntegrationStatusDto | undefined>();

  readonly qbConnectionType = signal<'online' | 'desktop'>('online');
  readonly qbDesktopCompanyName = signal('');
  readonly qbDesktopUsername = signal('');
  readonly qbDesktopPassword = signal('');
  readonly qbSaving = signal(false);
  readonly qbSuccessMessage = signal('');
  readonly qbErrorMessage = signal('');

  status(): IntegrationStatusDto | null {
    return this.integration() ?? null;
  }

  /** True if the QBO access token expires within 24 hours. */
  isTokenExpiringSoon(): boolean {
    const exp = this.status()?.tokenExpiresAt;
    if (!exp) return false;
    const msUntilExpiry = new Date(exp).getTime() - Date.now();
    return msUntilExpiry < 24 * 60 * 60 * 1000; // 24h
  }

  ngOnInit(): void {
    const s = this.status();
    if (s?.connectionType) this.qbConnectionType.set(s.connectionType);
  }

  async connectQuickBooksOnline(): Promise<void> {
    this.qbSaving.set(true);
    this.qbSuccessMessage.set('');
    this.qbErrorMessage.set('');

    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ authUrl: string }>>(`${API}/admin/settings/integrations/quickbooks/auth-url`),
      );
      if (res.success && res.data.authUrl) {
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
        this.toastService.show('success', 'QuickBooks Desktop credentials saved successfully.');
      }
    } catch (err: any) {
      const msg = err?.error?.message ?? 'Failed to save Desktop credentials.';
      this.qbErrorMessage.set(msg);
    } finally {
      this.qbSaving.set(false);
    }
  }

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
        this.toastService.show('success', 'QuickBooks has been disconnected.');
      }
    } catch (err: any) {
      const msg = err?.error?.message ?? 'Failed to disconnect QuickBooks.';
      this.qbErrorMessage.set(msg);
    } finally {
      this.qbSaving.set(false);
    }
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
}
