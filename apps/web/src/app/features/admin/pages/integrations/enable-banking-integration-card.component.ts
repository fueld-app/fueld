import { Component, ChangeDetectionStrategy, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { API } from '@app/core/config/api';
import { AuthService } from '@app/core/auth';
import { IntegrationsToastService } from './integrations-toast.service';

interface ApiResponse<T> { success: boolean; data: T; message?: string; }
interface BankConnection { id: string; aspsp_name: string; aspsp_country: string; status: string; last_synced_at: string | null; }
interface ASPSP { name: string; country: string; bic?: string; }

// European countries supported by Enable Banking (PSD2/EEA)
const BANKING_COUNTRIES = [
  { code: 'AT', name: 'Austria', flag: '\ud83c\udde6\ud83c\uddf9' },
  { code: 'BE', name: 'Belgium', flag: '\ud83c\udde7\ud83c\uddea' },
  { code: 'BG', name: 'Bulgaria', flag: '\ud83c\udde7\ud83c\uddec' },
  { code: 'CH', name: 'Switzerland', flag: '\ud83c\udde8\ud83c\udded' },
  { code: 'CY', name: 'Cyprus', flag: '\ud83c\udde8\ud83c\uddfe' },
  { code: 'CZ', name: 'Czech Republic', flag: '\ud83c\udde8\ud83c\uddff' },
  { code: 'DE', name: 'Germany', flag: '\ud83c\udde9\ud83c\uddea' },
  { code: 'DK', name: 'Denmark', flag: '\ud83c\udde9\ud83c\uddf0' },
  { code: 'EE', name: 'Estonia', flag: '\ud83c\uddea\ud83c\uddea' },
  { code: 'ES', name: 'Spain', flag: '\ud83c\uddea\ud83c\uddf8' },
  { code: 'FI', name: 'Finland', flag: '\ud83c\uddeb\ud83c\uddee' },
  { code: 'FR', name: 'France', flag: '\ud83c\uddeb\ud83c\uddf7' },
  { code: 'GB', name: 'United Kingdom', flag: '\ud83c\uddec\ud83c\udde7' },
  { code: 'GR', name: 'Greece', flag: '\ud83c\uddec\ud83c\uddf7' },
  { code: 'HR', name: 'Croatia', flag: '\ud83c\udded\ud83c\uddf7' },
  { code: 'HU', name: 'Hungary', flag: '\ud83c\udded\ud83c\uddfa' },
  { code: 'IE', name: 'Ireland', flag: '\ud83c\uddee\ud83c\uddea' },
  { code: 'IS', name: 'Iceland', flag: '\ud83c\uddee\ud83c\uddf8' },
  { code: 'IT', name: 'Italy', flag: '\ud83c\uddee\ud83c\uddf9' },
  { code: 'LT', name: 'Lithuania', flag: '\ud83c\uddf1\ud83c\uddf9' },
  { code: 'LU', name: 'Luxembourg', flag: '\ud83c\uddf1\ud83c\uddfa' },
  { code: 'LV', name: 'Latvia', flag: '\ud83c\uddf1\ud83c\uddfb' },
  { code: 'MC', name: 'Monaco', flag: '\ud83c\uddf2\ud83c\udde8' },
  { code: 'MT', name: 'Malta', flag: '\ud83c\uddf2\ud83c\uddf9' },
  { code: 'NL', name: 'Netherlands', flag: '\ud83c\uddf3\ud83c\uddf1' },
  { code: 'NO', name: 'Norway', flag: '\ud83c\uddf3\ud83c\uddf4' },
  { code: 'PL', name: 'Poland', flag: '\ud83c\uddf5\ud83c\uddf1' },
  { code: 'PT', name: 'Portugal', flag: '\ud83c\uddf5\ud83c\uddf9' },
  { code: 'RO', name: 'Romania', flag: '\ud83c\uddf7\ud83c\uddf4' },
  { code: 'SE', name: 'Sweden', flag: '\ud83c\uddf8\ud83c\uddea' },
  { code: 'SI', name: 'Slovenia', flag: '\ud83c\uddf8\ud83c\uddee' },
  { code: 'SK', name: 'Slovakia', flag: '\ud83c\uddf8\ud83c\uddf0' },
];

@Component({
  selector: 'app-enable-banking-integration-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, RouterLink],
  template: `
    <div class="app-panel">
      <div class="app-panel-header app-panel-header--blue">
        <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--blue">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600 dark:text-blue-400" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.5 3.75a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5zM10.5 12.75a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5z"/>
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-2a6 6 0 100-12 6 6 0 000 12z" clip-rule="evenodd"/>
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="text-base font-semibold text-gray-900 dark:text-ink">Enable Banking</h3>
          <p class="text-sm text-gray-500 dark:text-muted">Connect European banks for live cash balances &amp; transactions.</p>
        </div>
        <div>
          @if (configured()) {
            <span class="inline-flex items-center gap-1.5 rounded-full bg-green-50 dark:bg-green-500/15 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-400 ring-1 ring-green-600/20">
              <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
              Configured
            </span>
          } @else {
            <span class="inline-flex items-center gap-1.5 rounded-full bg-gray-50 dark:bg-gray-700/30 px-2.5 py-1 text-xs font-medium text-gray-500 ring-1 ring-gray-600/20">
              <span class="h-1.5 w-1.5 rounded-full bg-gray-400"></span>
              Not configured
            </span>
          }
        </div>
      </div>

      <div class="app-panel-body">
        @if (!showSetup() && !showConnect()) {
          @if (connections().length > 0) {
            <div class="space-y-2 mb-3">
              <p class="text-xs font-semibold uppercase tracking-wider text-gray-500">Connected Banks</p>
              @for (conn of connections(); track conn.id) {
                <div class="flex items-center justify-between rounded-lg border border-gray-200 dark:border-line px-3 py-2">
                  <div>
                    <span class="text-sm font-medium text-gray-700 dark:text-ink">{{ conn.aspsp_name }}</span>
                    <span class="ml-2 text-xs text-gray-400">{{ conn.aspsp_country }}</span>
                    @if (conn.status === 'expired') {
                      <span class="ml-2 inline-flex items-center gap-1 rounded-full bg-red-50 dark:bg-red-900/20 px-2 py-0.5 text-xs font-medium text-red-600">Expired — re-authorize</span>
                    } @else if (conn.last_synced_at) {
                      <span class="ml-2 text-xs text-gray-400">synced {{ conn.last_synced_at | date:'short' }}</span>
                    }
                  </div>
                  @if (auth.isAdmin() || auth.isFinance()) {
                    <button type="button" (click)="removeConnection(conn.id)"
                      class="text-xs text-red-500 hover:text-red-700">Remove</button>
                  }
                </div>
              }
            </div>
          }
          <div class="flex gap-2">
            @if (configured() && (auth.isAdmin() || auth.isFinance())) {
              <button type="button" (click)="openConnectPanel()"
                class="inline-flex items-center rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800">
                Add Bank Connection
              </button>
            }
            @if (auth.isAdmin() || auth.isFinance()) {
              <button type="button" (click)="showSetup.set(true)"
                class="inline-flex items-center rounded-lg border border-gray-300 dark:border-line px-3 py-2 text-sm font-semibold text-gray-700 dark:text-ink hover:bg-gray-50 dark:hover:bg-surface-dim">
                {{ configured() ? 'Edit Credentials' : 'Set Up' }}
              </button>
            }
            @if (configured()) {
              <a routerLink="/cash" class="inline-flex items-center rounded-lg border border-gray-300 dark:border-line px-3 py-2 text-sm font-semibold text-gray-700 dark:text-ink hover:bg-gray-50 dark:hover:bg-surface-dim">
                View Cash Dashboard →
              </a>
            }
          </div>
          @if (auth.isAdmin() || auth.isFinance()) {
            <p class="mt-3 text-xs text-gray-400">
              Don't have an Enable Banking account?
              <button type="button" (click)="openSelfService()" class="text-blue-500 hover:underline">
                Set up automatically →
              </button>
            </p>
          }
        }

        @if (showSelfService()) {
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <h4 class="text-sm font-semibold text-gray-700 dark:text-ink">Self-Service Setup</h4>
              <button type="button" (click)="closeSelfService()" class="text-xs text-gray-400 hover:text-gray-600">✕ Close</button>
            </div>

            @if (ssStep() === 'idle') {
              <div class="space-y-3">
                <p class="text-sm text-gray-500 dark:text-muted">
                  We'll create an Enable Banking account for you automatically. Just enter your email and we'll send you a sign-in link.
                </p>
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Your Email</label>
                  <input type="email" [ngModel]="ssEmail()" (ngModelChange)="ssEmail.set($event)"
                    class="w-full rounded-lg border border-gray-300 dark:border-line px-3 py-2 text-sm dark:bg-surface"
                    placeholder="you@example.com" />
                </div>
                <button type="button" (click)="sendSetupEmail()" [disabled]="!ssEmail()"
                  class="inline-flex items-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
                  Send Sign-In Email
                </button>
                <div class="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3 text-xs text-blue-700 dark:text-blue-300 space-y-1">
                  <p class="font-semibold">What happens next:</p>
                  <ol class="list-decimal list-inside space-y-0.5">
                    <li>You'll receive an email from Enable Banking</li>
                    <li>Click the sign-in link in the email</li>
                    <li>We'll automatically create your Enable Banking account and app</li>
                    <li>You can then connect your bank accounts</li>
                  </ol>
                </div>
              </div>
            }

            @if (ssStep() === 'email-sent') {
              <div class="space-y-3 py-2">
                <div class="text-center space-y-2">
                  <div class="mx-auto h-12 w-12 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                    <svg class="h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                    </svg>
                  </div>
                  <p class="text-sm font-medium text-gray-700 dark:text-ink">Check your email</p>
                  <p class="text-sm text-gray-500 dark:text-muted">
                    We sent a sign-in link to <strong>{{ ssEmail() }}</strong>.
                  </p>
                </div>
                <div class="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-700 dark:text-amber-300 space-y-1">
                  <p class="font-semibold">📋 Instructions:</p>
                  <ol class="list-decimal list-inside space-y-0.5">
                    <li>Open the email from Enable Banking</li>
                    <li>Click the sign-in link — it will open a page on enablebanking.com</li>
                    <li>Copy the <strong>oobCode</strong> from the URL in your browser's address bar</li>
                    <li>Paste it in the field below and click "Complete Setup"</li>
                  </ol>
                  <p class="mt-1">The oobCode looks like: <code class="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">abc123-def456-...</code></p>
                </div>
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Paste oobCode from email link</label>
                  <input type="text" [ngModel]="ssOobCodeInput()" (ngModelChange)="ssOobCodeInput.set($event)"
                    class="w-full rounded-lg border border-gray-300 dark:border-line px-3 py-2 text-sm font-mono dark:bg-surface"
                    placeholder="Paste the oobCode here…" />
                </div>
                <button type="button" (click)="completeWithOobCode()" [disabled]="!ssOobCodeInput()"
                  class="inline-flex items-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
                  Complete Setup
                </button>
                @if (ssPolling()) {
                  <div class="flex items-center justify-center gap-2 text-xs text-gray-400">
                    <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Also polling for automatic completion…
                  </div>
                }
                <button type="button" (click)="ssStep.set('idle')" class="text-xs text-gray-500 hover:underline">← Back</button>
              </div>
            }

            @if (ssStep() === 'completing') {
              <div class="space-y-3 text-center py-4">
                <div class="flex items-center justify-center">
                  <svg class="animate-spin h-8 w-8 text-brand-600" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                </div>
                <p class="text-sm font-medium text-gray-700 dark:text-ink">Creating your Enable Banking account…</p>
                <p class="text-xs text-gray-400">Generating RSA keys and registering your app. This takes a few seconds.</p>
              </div>
            }

            @if (ssStep() === 'completed') {
              <div class="space-y-3 text-center py-4">
                <div class="mx-auto h-12 w-12 rounded-full bg-green-50 dark:bg-green-900/20 flex items-center justify-center">
                  <svg class="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
                  </svg>
                </div>
                <p class="text-sm font-medium text-gray-700 dark:text-ink">Enable Banking account created!</p>
                <p class="text-sm text-gray-500 dark:text-muted">You can now connect your bank accounts.</p>
                <button type="button" (click)="closeSelfService(); openConnectPanel()"
                  class="inline-flex items-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800">
                  Connect a Bank →
                </button>
              </div>
            }

            @if (ssStep() === 'error') {
              <div class="space-y-3 text-center py-4">
                <div class="mx-auto h-12 w-12 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                  <svg class="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </div>
                <p class="text-sm font-medium text-red-600">Setup failed</p>
                <p class="text-sm text-gray-500 dark:text-muted">{{ ssError() }}</p>
                <button type="button" (click)="ssStep.set('idle')"
                  class="inline-flex items-center rounded-lg border border-gray-300 dark:border-line px-4 py-2 text-sm font-semibold text-gray-700 dark:text-ink hover:bg-gray-50">
                  Try Again
                </button>
              </div>
            }
          </div>
        }

        @if (showSetup()) {
          <div class="space-y-3">
            @if (configured()) {
              <div class="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3 text-sm text-blue-700 dark:text-blue-300">
                <strong>Credentials are already configured.</strong> Enter new values below to replace them. (For security, current values are not shown.)
              </div>
            } @else {
              <p class="text-sm text-gray-500 dark:text-muted">
                Enter your Enable Banking credentials. Get these from
                <a href="https://enablebanking.com/cp/applications" target="_blank" rel="noopener" class="text-blue-500 hover:underline">enablebanking.com → Applications</a>
              </p>
            }
            <div>
              <label class="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">App ID</label>
              <input type="text" [ngModel]="appId()" (ngModelChange)="appId.set($event)"
                class="w-full rounded-lg border border-gray-300 dark:border-line px-3 py-2 text-sm dark:bg-surface"
                placeholder="e.g. ae51f60d-a5ec-4ecc-..." />
            </div>
            <div>
              <label class="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Private Key (PEM)</label>
              <textarea [ngModel]="privateKey()" (ngModelChange)="privateKey.set($event)"
                rows="6"
                class="w-full rounded-lg border border-gray-300 dark:border-line px-3 py-2 text-sm font-mono dark:bg-surface"
                placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"></textarea>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Environment</label>
                <select [ngModel]="environment()" (ngModelChange)="environment.set($event)"
                  class="w-full rounded-lg border border-gray-300 dark:border-line px-3 py-2 text-sm dark:bg-surface">
                  <option value="production">Production</option>
                  <option value="sandbox">Sandbox</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Redirect URL</label>
                <input type="text" [ngModel]="redirectUrl()" (ngModelChange)="redirectUrl.set($event)"
                  class="w-full rounded-lg border border-gray-300 dark:border-line px-3 py-2 text-sm dark:bg-surface"
                  placeholder="https://your-domain.fueld.app/api/banking/callback" />
              </div>
            </div>
            <div class="flex gap-2 pt-2">
              <button type="button" (click)="saveCredentials()"
                class="inline-flex items-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800">
                Save Credentials
              </button>
              <button type="button" (click)="showSetup.set(false)"
                class="inline-flex items-center rounded-lg border border-gray-300 dark:border-line px-4 py-2 text-sm font-semibold text-gray-700 dark:text-ink hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        }

        @if (showConnect()) {
          <div class="space-y-4">
            <!-- Country selector (always visible) -->
            <div>
              <label class="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Country</label>
              <div class="flex gap-2">
                <select [ngModel]="country()" (ngModelChange)="country.set($event); loadBanks()"
                  class="rounded-lg border border-gray-300 dark:border-line px-3 py-2 text-sm dark:bg-surface">
                  @for (c of bankingCountries; track c.code) {
                    <option [value]="c.code">{{ c.flag }} {{ c.name }}
                  }
                </select>
                @if (loadingBanks()) {
                  <span class="text-sm text-gray-400">Loading banks…</span>
                }
              </div>
            </div>

            <!-- Bank selector -->
            @if (loadingBanks()) {
              <p class="text-sm text-gray-400">Loading available banks…</p>
            } @else if (availableBanks().length === 0) {
              <p class="text-sm text-gray-400">No banks found for {{ country() }}. Try a different country.</p>
            } @else {
              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Select Bank</label>
                <select [ngModel]="selectedBank()" (ngModelChange)="selectedBank.set($event)"
                  class="w-full rounded-lg border border-gray-300 dark:border-line px-3 py-2 text-sm dark:bg-surface">
                  <option value="">— Choose a bank —</option>
                  @for (bank of availableBanks(); track bank.name) {
                    <option [value]="bank.name">{{ bank.name }}{{ bank.bic ? ' (' + bank.bic + ')' : '' }}</option>
                  }
                </select>
              </div>
              <button type="button" (click)="connectBank()" [disabled]="!selectedBank()"
                class="inline-flex items-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
                Connect Bank
              </button>
              <p class="text-xs text-gray-400">You'll be redirected to the bank's website to authorize access.</p>
            }
            <button type="button" (click)="showConnect.set(false)"
              class="text-sm text-gray-500 hover:underline">Cancel</button>
          </div>
        }
      </div>
    </div>
  `,
})
export class EnableBankingIntegrationCardComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(IntegrationsToastService);
  readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  readonly configured = signal(false);
  readonly connections = signal<BankConnection[]>([]);
  readonly showSetup = signal(false);
  readonly showConnect = signal(false);
  readonly showSelfService = signal(false);

  // Self-service setup wizard
  readonly ssEmail = signal('');
  readonly ssStep = signal<'idle' | 'email-sent' | 'completing' | 'completed' | 'error'>('idle');
  readonly ssError = signal<string | null>(null);
  readonly ssPolling = signal(false);
  private ssPollTimer: ReturnType<typeof setInterval> | null = null;
  private ssOobCode: string | null = null;
  private ssOobEmail: string | null = null;
  readonly ssOobCodeInput = signal('');

  // Setup form
  readonly appId = signal('');
  readonly privateKey = signal('');
  readonly environment = signal('production');
  readonly redirectUrl = signal('');

  // Connect form
  readonly availableBanks = signal<ASPSP[]>([]);
  readonly loadingBanks = signal(false);
  readonly selectedBank = signal('');
  readonly country = signal('FR');
  readonly bankingCountries = BANKING_COUNTRIES;

  ngOnInit(): void {
    // Pre-fill redirect URL with current domain
    if (typeof window !== 'undefined') {
      this.redirectUrl.set(`${window.location.origin}/api/banking/callback`);
    }
    // Pre-fill email with user's Fueld email
    this.ssEmail.set(this.auth.userEmail());
    this.loadStatus();

    // Check for oobCode in URL params (from email-link redirect)
    this.route.queryParams.subscribe(params => {
      const oobCode = params['oobCode'];
      const email = params['email'];
      if (oobCode) {
        this.ssOobCode = oobCode;
        this.ssOobEmail = email ?? this.auth.userEmail();
        if (email) this.ssEmail.set(email);
        this.showSelfService.set(true);
        this.completeSelfServiceSetup(oobCode, email ?? this.auth.userEmail());
      }
    });
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  private async loadStatus(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ configured: boolean; connections: BankConnection[] }>>(`${API}/banking/status`),
      );
      if (res.success && res.data) {
        this.configured.set(res.data.configured);
        this.connections.set(res.data.connections ?? []);
      }
    } catch {}
  }

  async saveCredentials(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<any>>(`${API}/banking/credentials`, {
          appId: this.appId(),
          privateKey: this.privateKey(),
          environment: this.environment(),
          redirectUrl: this.redirectUrl(),
        }),
      );
      if (res.success) {
        this.toast.show('success', 'Enable Banking credentials saved');
        this.showSetup.set(false);
        this.configured.set(true);
      } else {
        this.toast.show('error', res.message ?? 'Failed to save credentials');
      }
    } catch (e: any) {
      this.toast.show(e?.message ?? 'Failed to save credentials', 'error');
    }
  }

  async openConnectPanel(): Promise<void> {
    this.showConnect.set(true);
    this.availableBanks.set([]);
    this.selectedBank.set('');
    await this.loadBanks();
  }

  async loadBanks(): Promise<void> {
    this.loadingBanks.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<ASPSP[]>>(`${API}/banking/aspsps?country=${this.country()}`),
      );
      if (res.success && res.data) {
        this.availableBanks.set((res.data as ASPSP[]).sort((a, b) => a.name.localeCompare(b.name)));
      }
    } catch (e: any) {
      this.toast.show('error', 'Failed to load banks: ' + (e?.message ?? ''));
    } finally {
      this.loadingBanks.set(false);
    }
  }

  async connectBank(): Promise<void> {
    if (!this.selectedBank()) return;
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<{ authorizationUrl: string; state: string }>>(`${API}/banking/connect`, {
          aspspName: this.selectedBank(),
          country: this.country(),
        }),
      );
      if (res.success && res.data?.authorizationUrl) {
        const oauthState = res.data.state;
        // Open OAuth2 flow in popup
        const popup = window.open(res.data.authorizationUrl, 'enablebanking-auth', 'width=600,height=700');
        // Listen for callback postMessage
        const handler = async (event: MessageEvent) => {
          if (event.data?.type === 'enablebanking-callback' && event.data?.code) {
            window.removeEventListener('message', handler);
            popup?.close();
            // Complete the flow — pass state for CSRF validation
            const completeRes = await firstValueFrom(
              this.http.post<ApiResponse<any>>(`${API}/banking/complete`, {
                code: event.data.code,
                state: oauthState,
                aspspName: this.selectedBank(),
                country: this.country(),
              }),
            );
            if (completeRes.success) {
              this.toast.show('success', `${this.selectedBank()} connected`);
              this.showConnect.set(false);
              this.loadStatus();
            } else {
              this.toast.show('error', completeRes.message ?? 'Failed to complete connection');
            }
          }
        };
        window.addEventListener('message', handler);
      }
    } catch (e: any) {
      this.toast.show('error', 'Failed to start connection: ' + (e?.message ?? ''));
    }
  }

  async removeConnection(id: string): Promise<void> {
    try {
      await firstValueFrom(this.http.delete<ApiResponse<any>>(`${API}/banking/connections/${id}`));
      this.toast.show('success', 'Bank connection removed');
      this.loadStatus();
    } catch (e: any) {
      this.toast.show('error', 'Failed to remove connection');
    }
  }

  // ─── Self-Service Setup Wizard ──────────────────────────────────

  openSelfService(): void {
    this.showSelfService.set(true);
    this.ssStep.set('idle');
    this.ssError.set(null);
    this.ssEmail.set(this.auth.userEmail());
  }

  async sendSetupEmail(): Promise<void> {
    if (!this.ssEmail()) return;
    this.ssStep.set('email-sent');
    this.ssError.set(null);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<any>>(`${API}/banking/enablebanking/initiate`, { email: this.ssEmail() }),
      );
      if (res.success) {
        this.toast.show('success', 'Sign-in email sent. Check your inbox.');
        this.startPolling();
      } else {
        this.ssStep.set('error');
        this.ssError.set(res.message ?? 'Failed to send email');
      }
    } catch (e: any) {
      this.ssStep.set('error');
      this.ssError.set(e?.message ?? 'Failed to send email');
    }
  }

  private startPolling(): void {
    this.ssPolling.set(true);
    this.ssPollTimer = setInterval(async () => {
      try {
        const res = await firstValueFrom(
          this.http.get<ApiResponse<{ status: string; error?: string }>>(`${API}/banking/enablebanking/status`),
        );
        if (res.success && res.data) {
          if (res.data.status === 'completed') {
            this.stopPolling();
            this.ssStep.set('completed');
            this.configured.set(true);
            this.toast.show('success', 'Enable Banking account created successfully!');
            this.loadStatus();
          } else if (res.data.status === 'error') {
            this.stopPolling();
            this.ssStep.set('error');
            this.ssError.set(res.data.error ?? 'Setup failed');
          }
        }
      } catch {}
    }, 3000);
  }

  private stopPolling(): void {
    this.ssPolling.set(false);
    if (this.ssPollTimer) {
      clearInterval(this.ssPollTimer);
      this.ssPollTimer = null;
    }
  }

  async completeSelfServiceSetup(oobCode: string, email: string): Promise<void> {
    this.ssStep.set('completing');
    this.ssError.set(null);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<{ appId: string }>>(`${API}/banking/enablebanking/complete`, { oobCode, email }),
      );
      if (res.success) {
        this.ssStep.set('completed');
        this.configured.set(true);
        this.toast.show('success', 'Enable Banking account created successfully!');
        this.loadStatus();
        if (typeof window !== 'undefined') {
          window.history.replaceState({}, '', window.location.pathname);
        }
      } else {
        this.ssStep.set('error');
        this.ssError.set(res.message ?? 'Failed to complete setup');
      }
    } catch (e: any) {
      this.ssStep.set('error');
      this.ssError.set(e?.message ?? 'Failed to complete setup');
    }
  }

  async completeWithOobCode(): Promise<void> {
    const oobCode = this.ssOobCodeInput().trim();
    if (!oobCode) return;
    this.stopPolling();
    await this.completeSelfServiceSetup(oobCode, this.ssEmail());
  }

  closeSelfService(): void {
    this.showSelfService.set(false);
    this.stopPolling();
    this.ssStep.set('idle');
    this.ssError.set(null);
    // Clear URL params if any
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }
}