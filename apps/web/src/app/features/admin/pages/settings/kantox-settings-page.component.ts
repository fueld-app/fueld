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
import type { ApiResponse, KantoxConnectionResultDto, KantoxSettingsDto } from '@fueld/types';
import { API } from '@app/core/config/api';
import { SettingsToastService } from './settings-toast.service';

/**
 * Kantox Dynamic Hedging® configuration (ADMIN only).
 *
 * The API password is deliberately absent from this form: it lives in the
 * encrypted credential vault (Admin → Integrations) and is never returned by
 * the API. `hasPassword` tells the operator whether one is already stored.
 */
@Component({
  selector: 'app-kantox-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">Kantox Dynamic Hedging</h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-muted">
          USD margin hedging for this tenant. We push the full exposure per confirmed
          deal; the hedge ratio itself is a Kantox platform business rule.
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
        <div class="space-y-6 max-w-2xl">
          <!-- Enable toggle -->
          <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
            <label class="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" [ngModel]="enabled()" (ngModelChange)="enabled.set($event)"
                class="h-5 w-5 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
              <div>
                <span class="text-sm font-semibold text-gray-900 dark:text-ink">Enable Dynamic Hedging</span>
                <p class="text-xs text-gray-500 dark:text-muted mt-0.5">
                  Pushes hedge entries on order confirmation, closes them as customer payments arrive,
                  and shows the FX Hedging card on order pages.
                </p>
              </div>
            </label>
            @if (enabled() && !configured()) {
              <p class="mt-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-500/15 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                Not ready: an API user, company reference and stored API password are all required
                before entries can be sent. Add the password under Admin → Integrations.
              </p>
            }
          </div>

          <!-- Connection -->
          <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim mb-4">Connection</h3>
            <div class="space-y-3">
              <div>
                <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">API base URL</label>
                <input type="text" [ngModel]="apiBaseUrl()" (ngModelChange)="apiBaseUrl.set($event)"
                  class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                  placeholder="https://kantox-preprod.com/api" />
                <p class="text-xs text-gray-500 dark:text-muted mt-1">
                  Sandbox: <code>https://kantox-preprod.com/api</code> · Production: <code>https://kantox.com/api</code>
                </p>
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">API user</label>
                <input type="text" [ngModel]="apiUser()" (ngModelChange)="apiUser.set($event)"
                  class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                  placeholder="rivieramarine.api@kantox.com" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Company reference</label>
                <input type="text" [ngModel]="companyRef()" (ngModelChange)="companyRef.set($event)"
                  class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                  placeholder="api_company_131804" />
              </div>
              <div class="flex items-center gap-3">
                <button type="button" (click)="testConnection()" [disabled]="testing()"
                  class="rounded-lg border border-gray-300 dark:border-line-strong px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint disabled:opacity-50 inline-flex items-center gap-2">
                  @if (testing()) {
                    <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    Testing…
                  } @else {
                    Test connection
                  }
                </button>
                @if (testResult() === 'ok') {
                  <span class="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Login successful</span>
                } @else if (testResult()) {
                  <span class="text-xs text-rose-600 dark:text-rose-400">{{ testResult() }}</span>
                }
              </div>
              <div class="border-t border-gray-100 dark:border-line pt-3">
                <span class="text-xs text-gray-500 dark:text-muted">
                  API password:
                  @if (hasPassword()) {
                    <span class="font-semibold text-emerald-700 dark:text-emerald-400">stored</span>
                    <span class="text-gray-400 dark:text-muted">(managed under Admin → Integrations; never shown)</span>
                  } @else {
                    <span class="font-semibold text-amber-700 dark:text-amber-400">not set</span>
                    <span class="text-gray-400 dark:text-muted">— add it under Admin → Integrations</span>
                  }
                </span>
              </div>
            </div>
          </div>

          @if (enabled()) {
            <!-- Currencies -->
            <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
              <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim mb-4">Currencies</h3>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Exposure currency</label>
                  <input type="text" maxlength="3" [ngModel]="hedgeCurrency()" (ngModelChange)="hedgeCurrency.set($event.toUpperCase())"
                    class="w-24 rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm uppercase focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Counter currency</label>
                  <input type="text" maxlength="3" [ngModel]="hedgeCounterCurrency()" (ngModelChange)="hedgeCounterCurrency.set($event.toUpperCase())"
                    class="w-24 rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm uppercase focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none" />
                </div>
              </div>
              <p class="text-xs text-gray-500 dark:text-muted mt-2">Only deals settling in the exposure currency are sent.</p>
            </div>

            <!-- Amount & value date -->
            <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
              <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim mb-4">Amount &amp; Value Date</h3>
              <div class="space-y-3">
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Amount basis (floating quantities)</label>
                  <select [ngModel]="amountBasis()" (ngModelChange)="amountBasis.set($event)"
                    class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none">
                    <option value="MINIMUM">Minimum quantity (never over-hedge)</option>
                    <option value="EXACT_AT_INVOICE">Exact amount at invoice</option>
                  </select>
                  @if (amountBasis() === 'EXACT_AT_INVOICE') {
                    <p class="text-xs text-amber-700 dark:text-amber-400 mt-1">
                      Requires delta entries after invoicing — not part of the current push flow.
                    </p>
                  }
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Payment date buffer (days)</label>
                  <input type="number" min="0" max="365" [ngModel]="paymentDateBufferDays()" (ngModelChange)="paymentDateBufferDays.set(+$event)"
                    class="w-24 rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none" />
                  <p class="text-xs text-gray-500 dark:text-muted mt-1">Added to the expected payment date. Kantox does not auto-roll past-due positions.</p>
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Value-date rounding</label>
                  <select [ngModel]="valueDateRounding()" (ngModelChange)="valueDateRounding.set($event)"
                    class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none">
                    <option value="WEEKLY_MONDAY">Weekly — round up to Monday</option>
                    <option value="TWICE_MONTHLY">Twice monthly</option>
                    <option value="MONTHLY">Monthly</option>
                    <option value="NONE">No rounding</option>
                  </select>
                  <p class="text-xs text-gray-500 dark:text-muted mt-1">
                    One settlement day per week keeps cash management simple. Pierre has not yet confirmed a cadence with management.
                  </p>
                </div>
                <label class="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" [ngModel]="hedgeCodPrepay()" (ngModelChange)="hedgeCodPrepay.set($event)"
                    class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                  <span class="text-sm text-gray-700 dark:text-ink-dim">Include COD / prepay deals (near-term, value date ≈ delivery)</span>
                </label>
              </div>
            </div>

            <!-- Limits -->
            <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
              <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim mb-4">Limits</h3>
              <div>
                <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Daily hedge limit (USD)</label>
                <input type="number" min="0" [ngModel]="dailyHedgeLimitUsd()" (ngModelChange)="dailyHedgeLimitUsd.set(+$event)"
                  class="w-40 rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none" />
                <p class="text-xs text-gray-500 dark:text-muted mt-1">
                  FDDR reference limit. A day exceeding it is flagged, not blocked — Kantox has not yet
                  confirmed whether this is a hard cap.
                </p>
              </div>
            </div>
          }

          <!-- Save -->
          <div class="flex justify-end">
            <button (click)="save()" [disabled]="saving()"
              class="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50 inline-flex items-center gap-2">
              @if (saving()) {
                <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Saving…
              } @else {
                Save Settings
              }
            </button>
          </div>
        </div>
      }
    </div>
  `,
})
export class KantoxSettingsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toastSvc = inject(SettingsToastService);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly testing = signal(false);
  readonly testResult = signal<string>('');

  readonly enabled = signal(false);
  readonly configured = signal(false);
  readonly hasPassword = signal(false);
  readonly apiBaseUrl = signal('');
  readonly apiUser = signal('');
  readonly companyRef = signal('');
  readonly hedgeCurrency = signal('USD');
  readonly hedgeCounterCurrency = signal('EUR');
  readonly amountBasis = signal<KantoxSettingsDto['amountBasis']>('MINIMUM');
  readonly paymentDateBufferDays = signal(7);
  readonly valueDateRounding = signal<KantoxSettingsDto['valueDateRounding']>('WEEKLY_MONDAY');
  readonly hedgeCodPrepay = signal(true);
  readonly dailyHedgeLimitUsd = signal(200000);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<KantoxSettingsDto>>(`${API}/kantox/settings`),
      );
      if (res.success && res.data) {
        const d = res.data;
        this.enabled.set(d.enabled);
        this.hasPassword.set(d.hasPassword);
        this.apiBaseUrl.set(d.apiBaseUrl);
        this.apiUser.set(d.apiUser);
        this.companyRef.set(d.companyRef);
        this.hedgeCurrency.set(d.hedgeCurrency);
        this.hedgeCounterCurrency.set(d.hedgeCounterCurrency);
        this.amountBasis.set(d.amountBasis);
        this.paymentDateBufferDays.set(d.paymentDateBufferDays);
        this.valueDateRounding.set(d.valueDateRounding);
        this.hedgeCodPrepay.set(d.hedgeCodPrepay);
        this.dailyHedgeLimitUsd.set(d.dailyHedgeLimitUsd);
        this.configured.set(!!d.apiUser && !!d.companyRef && d.hasPassword);
      }
    } catch {
      this.toastSvc.show('error', 'Failed to load Kantox settings.');
    } finally {
      this.loading.set(false);
    }
  }

  async save(): Promise<void> {
    this.saving.set(true);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<KantoxSettingsDto>>(`${API}/kantox/settings`, {
          enabled: this.enabled(),
          apiBaseUrl: this.apiBaseUrl(),
          apiUser: this.apiUser(),
          companyRef: this.companyRef(),
          hedgeCurrency: this.hedgeCurrency(),
          hedgeCounterCurrency: this.hedgeCounterCurrency(),
          amountBasis: this.amountBasis(),
          paymentDateBufferDays: this.paymentDateBufferDays(),
          valueDateRounding: this.valueDateRounding(),
          hedgeCodPrepay: this.hedgeCodPrepay(),
          dailyHedgeLimitUsd: this.dailyHedgeLimitUsd(),
        }),
      );
      if (res.success && res.data) {
        this.hasPassword.set(res.data.hasPassword);
        this.configured.set(!!res.data.apiUser && !!res.data.companyRef && res.data.hasPassword);
        this.toastSvc.show('success', 'Kantox settings saved.');
      } else {
        this.toastSvc.show('error', res.message ?? 'Failed to save settings.');
      }
    } catch {
      this.toastSvc.show('error', 'Failed to save settings.');
    } finally {
      this.saving.set(false);
    }
  }

  /** Saves first so the roundtrip tests what the operator is looking at. */
  async testConnection(): Promise<void> {
    this.testing.set(true);
    this.testResult.set('');
    try {
      await this.save();
      const res = await firstValueFrom(
        this.http.post<ApiResponse<KantoxConnectionResultDto>>(`${API}/kantox/test-connection`, {}),
      );
      this.testResult.set(res.success ? 'ok' : (res.message ?? 'Connection failed'));
    } catch {
      this.testResult.set('Connection failed');
    } finally {
      this.testing.set(false);
    }
  }
}
