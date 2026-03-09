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
import type { ApiResponse, CreditApplicationSettingsDto, FinancingSettingsDto, RiskMonitoringSettingsDto } from '@fueld/types';
import { API } from '@app/core/config/api';
import { RiskMonitoringService } from '@app/core/risk-monitoring/risk-monitoring.service';

@Component({
  selector: 'app-credit-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900">Credit & Financing Settings</h1>
        <p class="mt-1 text-sm text-gray-500">
          Configure credit approvals and the financing rate used in trader margin calculations.
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
        <div class="max-w-4xl space-y-5 sm:space-y-6">
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--brand">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--brand">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M14.25 3.75H8.25A2.25 2.25 0 0 0 6 6v12a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 18V7.5l-3.75-3.75Z" />
                  <path d="M14.25 3.75V7.5H18" />
                  <path d="M9 10.5h6" />
                  <path d="M9 14.25h3.75" />
                  <path d="m10.125 17.25 1.125 1.125 2.625-2.625" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Approval Workflow</h3>
                <p class="text-xs text-gray-600">Control how credit applications are reviewed and approved.</p>
              </div>
            </div>

            <div class="app-panel-body app-panel-stack">
              <!-- Required Approvals -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Required Approvals</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  [ngModel]="requiredApprovals()"
                  (ngModelChange)="requiredApprovals.set($event)"
                      class="app-input w-24"
                />
                <p class="mt-1 text-xs text-gray-500">
                  How many credit managers must approve a credit application before it is accepted.
                </p>
              </div>

              <!-- Immediate Rejection -->
              <div class="flex items-start gap-3">
                <button (click)="immediateRejection.set(!immediateRejection())"
                  class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                  [class]="immediateRejection() ? 'bg-brand-600' : 'bg-gray-300'">
                  <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                    [class]="immediateRejection() ? 'translate-x-4' : 'translate-x-0.5'"></span>
                </button>
                <div>
                  <p class="text-sm font-medium text-gray-700">Immediate Rejection</p>
                  <p class="text-xs text-gray-500">
                    When enabled, a single rejection immediately rejects the application.
                    When disabled, all required reviewers must vote (majority decides).
                  </p>
                </div>
              </div>

              <!-- Auto Apply -->
              <div class="flex items-start gap-3">
                <button (click)="autoApplyOnApproval.set(!autoApplyOnApproval())"
                  class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                  [class]="autoApplyOnApproval() ? 'bg-brand-600' : 'bg-gray-300'">
                  <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                    [class]="autoApplyOnApproval() ? 'translate-x-4' : 'translate-x-0.5'"></span>
                </button>
                <div>
                  <p class="text-sm font-medium text-gray-700">Auto-Apply on Approval</p>
                  <p class="text-xs text-gray-500">
                    Automatically create or update the credit line when an application is fully approved.
                  </p>
                </div>
              </div>

              <!-- Notify Credit Managers -->
              <div class="flex items-start gap-3">
                <button (click)="notifyCreditManagers.set(!notifyCreditManagers())"
                  class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                  [class]="notifyCreditManagers() ? 'bg-brand-600' : 'bg-gray-300'">
                  <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                    [class]="notifyCreditManagers() ? 'translate-x-4' : 'translate-x-0.5'"></span>
                </button>
                <div>
                  <p class="text-sm font-medium text-gray-700">Push Notifications</p>
                  <p class="text-xs text-gray-500">
                    Send push notifications to credit managers when a new application is submitted.
                  </p>
                </div>
              </div>

              <!-- Email Notifications -->
              <div class="flex items-start gap-3">
                <button (click)="notifyEmail.set(!notifyEmail())"
                  class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                  [class]="notifyEmail() ? 'bg-brand-600' : 'bg-gray-300'">
                  <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                    [class]="notifyEmail() ? 'translate-x-4' : 'translate-x-0.5'"></span>
                </button>
                <div>
                  <p class="text-sm font-medium text-gray-700">Email Notifications</p>
                  <p class="text-xs text-gray-500">
                    Send an email to all credit managers and admins when a new application is submitted.
                  </p>
                </div>
              </div>

              <!-- WhatsApp Notifications -->
              <div class="flex items-start gap-3">
                <button (click)="notifyWhatsApp.set(!notifyWhatsApp())"
                  class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                  [class]="notifyWhatsApp() ? 'bg-brand-600' : 'bg-gray-300'">
                  <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                    [class]="notifyWhatsApp() ? 'translate-x-4' : 'translate-x-0.5'"></span>
                </button>
                <div>
                  <p class="text-sm font-medium text-gray-700">WhatsApp Notifications</p>
                  <p class="text-xs text-gray-500">
                    Send a WhatsApp message to the default group when a new application is submitted.
                    Requires WhatsApp to be connected and a default group configured in Integrations.
                  </p>
                </div>
              </div>

              <!-- Save button -->
              <div class="pt-2 border-t border-gray-100">
                <button (click)="save()" [disabled]="saving()"
                  class="app-button-primary inline-flex items-center gap-1.5 font-semibold">
                  @if (saving()) {
                    <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                  }
                  Save Settings
                </button>
                @if (saveSuccess()) {
                  <span class="ml-3 text-sm text-green-600">Settings saved successfully.</span>
                }
                @if (saveError()) {
                  <span class="ml-3 text-sm text-red-600">{{ saveError() }}</span>
                }
              </div>
            </div>
          </div>

          <div class="app-panel">
            <div class="app-panel-header app-panel-header--amber">
              <div class="app-panel-icon-shell app-panel-icon-shell--pill app-panel-icon-shell--amber">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4.5 5A2.5 2.5 0 0 1 7 2.5h6A2.5 2.5 0 0 1 15.5 5v.5h.5A2.5 2.5 0 0 1 18.5 8v5A2.5 2.5 0 0 1 16 15.5h-.5v.5A2.5 2.5 0 0 1 13 18.5H7A2.5 2.5 0 0 1 4.5 16v-.5H4A2.5 2.5 0 0 1 1.5 13V8A2.5 2.5 0 0 1 4 5.5h.5V5Zm2 0v.5h7V5A.5.5 0 0 0 13 4.5H7a.5.5 0 0 0-.5.5Zm7 2.5h-7V13a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5V7.5Zm-4.25 1a.75.75 0 0 1 .75.75v.5h.5a.75.75 0 0 1 0 1.5H10v.5a.75.75 0 0 1-1.5 0v-.5H8a.75.75 0 0 1 0-1.5h.5v-.5a.75.75 0 0 1 .75-.75Z" clip-rule="evenodd"/>
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Trade Financing</h3>
                <p class="text-xs text-gray-600">Default rate used to calculate financing drag from payment-day spreads.</p>
              </div>
            </div>

            <div class="app-panel-body app-panel-stack">
              <div class="grid gap-4 sm:grid-cols-2">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Annual Rate (%)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    [ngModel]="financingAnnualRatePercent()"
                    (ngModelChange)="financingAnnualRatePercent.set($event)"
                    class="app-input w-full"
                  />
                  <p class="mt-1 text-xs text-gray-500">Stored as a decimal rate in the backend and applied to buy value only.</p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Day Count Convention</label>
                  <input
                    type="number"
                    [ngModel]="financingDayCountConvention()"
                    disabled
                    class="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 outline-none"
                  />
                  <p class="mt-1 text-xs text-gray-500">Fixed at 365 for V1.</p>
                </div>
              </div>

              <div class="pt-2 border-t border-gray-100">
                <button (click)="saveFinancingSettings()" [disabled]="financingSaving()"
                  class="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 transition-colors disabled:opacity-50">
                  @if (financingSaving()) {
                    <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                  }
                  Save Financing Settings
                </button>
                @if (financingSaveSuccess()) {
                  <span class="ml-3 text-sm text-green-600">Financing settings saved successfully.</span>
                }
                @if (financingSaveError()) {
                  <span class="ml-3 text-sm text-red-600">{{ financingSaveError() }}</span>
                }
              </div>
            </div>
          </div>

          <!-- Risk Monitoring Settings -->
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--red">
              <div class="app-panel-icon-shell app-panel-icon-shell--pill app-panel-icon-shell--red">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-red-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 1a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 1zM5.05 3.05a.75.75 0 011.06 0l1.062 1.06A.75.75 0 116.11 5.173L5.05 4.11a.75.75 0 010-1.06zm9.9 0a.75.75 0 010 1.06l-1.06 1.062a.75.75 0 01-1.062-1.06l1.06-1.062a.75.75 0 011.06 0zM10 7a3 3 0 100 6 3 3 0 000-6zm-6.25 3a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5H4.5a.75.75 0 01-.75-.75zm11 0a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5a.75.75 0 01-.75-.75zM6.11 14.828a.75.75 0 010 1.06l-1.06 1.06a.75.75 0 01-1.06-1.06l1.06-1.06a.75.75 0 011.06 0zm7.78 0a.75.75 0 011.06 0l1.06 1.06a.75.75 0 11-1.06 1.06l-1.06-1.06a.75.75 0 010-1.06z" clip-rule="evenodd"/>
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Risk Monitoring</h3>
                <p class="text-xs text-gray-600">Automated sanctions, maritime, and business-distress checks on counterparties.</p>
              </div>
            </div>

            <div class="app-panel-body app-panel-stack">
              <!-- Master toggle -->
              <div class="flex items-start gap-3">
                <button (click)="riskEnabled.set(!riskEnabled())"
                  class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                  [class]="riskEnabled() ? 'bg-brand-600' : 'bg-gray-300'">
                  <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                    [class]="riskEnabled() ? 'translate-x-4' : 'translate-x-0.5'"></span>
                </button>
                <div>
                  <p class="text-sm font-medium text-gray-700">Enable Risk Monitoring</p>
                  <p class="text-xs text-gray-500">Run automated risk checks on counterparties with active credit lines.</p>
                </div>
              </div>

              @if (riskEnabled()) {
                <!-- Check interval -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Check Interval (hours)</label>
                  <input
                    type="number"
                    min="1"
                    max="720"
                    [ngModel]="riskCheckIntervalHours()"
                    (ngModelChange)="riskCheckIntervalHours.set($event)"
                    class="app-input w-24"
                  />
                  <p class="mt-1 text-xs text-gray-500">How often to re-check each counterparty. Default: 24 hours.</p>
                </div>

                <!-- Override expiry -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Override Expiry (days)</label>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    [ngModel]="riskOverrideExpiryDays()"
                    (ngModelChange)="riskOverrideExpiryDays.set($event)"
                    class="app-input w-24"
                  />
                  <p class="mt-1 text-xs text-gray-500">How many days an approved override remains valid before it expires.</p>
                </div>

                <!-- Provider: OpenSanctions -->
                <div class="rounded-lg border border-gray-200 p-4 space-y-3">
                  <div class="flex items-start gap-3">
                    <button (click)="riskOpenSanctionsEnabled.set(!riskOpenSanctionsEnabled())"
                      class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                      [class]="riskOpenSanctionsEnabled() ? 'bg-brand-600' : 'bg-gray-300'">
                      <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                        [class]="riskOpenSanctionsEnabled() ? 'translate-x-4' : 'translate-x-0.5'"></span>
                    </button>
                    <div>
                      <p class="text-sm font-medium text-gray-700">OpenSanctions (Yente)</p>
                      <p class="text-xs text-gray-500">Watchlist screening via a self-hosted yente instance.</p>
                    </div>
                  </div>
                  @if (riskOpenSanctionsEnabled()) {
                    <div>
                      <label class="block text-xs font-medium text-gray-600">Yente Base URL</label>
                      <input type="text" [ngModel]="riskOpenSanctionsBaseUrl()" (ngModelChange)="riskOpenSanctionsBaseUrl.set($event)"
                        class="app-input w-full mt-1" placeholder="http://yente:8000" />
                    </div>
                  }
                </div>

                <!-- Provider: SeaSearcher -->
                <div class="rounded-lg border border-gray-200 p-4">
                  <div class="flex items-start gap-3">
                    <button (click)="riskSeaSearcherEnabled.set(!riskSeaSearcherEnabled())"
                      class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                      [class]="riskSeaSearcherEnabled() ? 'bg-brand-600' : 'bg-gray-300'">
                      <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                        [class]="riskSeaSearcherEnabled() ? 'translate-x-4' : 'translate-x-0.5'"></span>
                    </button>
                    <div>
                      <p class="text-sm font-medium text-gray-700">SeaSearcher</p>
                      <p class="text-xs text-gray-500">Maritime sanctions and seizure data. Uses your existing SeaSearcher subscription.</p>
                    </div>
                  </div>
                </div>

                <!-- Provider: Companies House -->
                <div class="rounded-lg border border-gray-200 p-4 space-y-3">
                  <div class="flex items-start gap-3">
                    <button (click)="riskCompaniesHouseEnabled.set(!riskCompaniesHouseEnabled())"
                      class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                      [class]="riskCompaniesHouseEnabled() ? 'bg-brand-600' : 'bg-gray-300'">
                      <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                        [class]="riskCompaniesHouseEnabled() ? 'translate-x-4' : 'translate-x-0.5'"></span>
                    </button>
                    <div>
                      <p class="text-sm font-medium text-gray-700">Companies House (UK)</p>
                      <p class="text-xs text-gray-500">Insolvency and dissolution checks for UK-registered companies.</p>
                    </div>
                  </div>
                  @if (riskCompaniesHouseEnabled()) {
                    <div>
                      <label class="block text-xs font-medium text-gray-600">API Key</label>
                      <input type="password" [ngModel]="riskCompaniesHouseApiKey()" (ngModelChange)="riskCompaniesHouseApiKey.set($event)"
                        class="app-input w-full mt-1" placeholder="Companies House API key" />
                    </div>
                  }
                </div>

                <!-- Notifications -->
                <div class="flex items-start gap-3">
                  <button (click)="riskNotifyPush.set(!riskNotifyPush())"
                    class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                    [class]="riskNotifyPush() ? 'bg-brand-600' : 'bg-gray-300'">
                    <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                      [class]="riskNotifyPush() ? 'translate-x-4' : 'translate-x-0.5'"></span>
                  </button>
                  <div>
                    <p class="text-sm font-medium text-gray-700">Push Notifications</p>
                    <p class="text-xs text-gray-500">Send push notifications to admins, credit managers, and finance when a new risk signal is detected.</p>
                  </div>
                </div>

                <!-- Auto enforce -->
                <div class="flex items-start gap-3">
                  <button (click)="riskAutoEnforce.set(!riskAutoEnforce())"
                    class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                    [class]="riskAutoEnforce() ? 'bg-brand-600' : 'bg-gray-300'">
                    <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                      [class]="riskAutoEnforce() ? 'translate-x-4' : 'translate-x-0.5'"></span>
                  </button>
                  <div>
                    <p class="text-sm font-medium text-gray-700">Auto-Freeze on Hit</p>
                    <p class="text-xs text-gray-500">Automatically freeze credit when risk signals are detected. When disabled, hits are recorded but credit is not blocked.</p>
                  </div>
                </div>
              }

              <!-- Save button -->
              <div class="pt-2 border-t border-gray-100">
                <button (click)="saveRiskSettings()" [disabled]="riskSaving()"
                  class="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 transition-colors disabled:opacity-50">
                  @if (riskSaving()) {
                    <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                  }
                  Save Risk Settings
                </button>
                @if (riskSaveSuccess()) {
                  <span class="ml-3 text-sm text-green-600">Risk settings saved.</span>
                }
                @if (riskSaveError()) {
                  <span class="ml-3 text-sm text-red-600">{{ riskSaveError() }}</span>
                }
              </div>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class CreditSettingsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly riskService = inject(RiskMonitoringService);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly saveSuccess = signal(false);
  readonly saveError = signal('');
  readonly financingSaving = signal(false);
  readonly financingSaveSuccess = signal(false);
  readonly financingSaveError = signal('');

  readonly requiredApprovals = signal(1);
  readonly autoApplyOnApproval = signal(true);
  readonly immediateRejection = signal(true);
  readonly notifyCreditManagers = signal(true);
  readonly notifyEmail = signal(false);
  readonly notifyWhatsApp = signal(false);
  readonly financingAnnualRatePercent = signal(8);
  readonly financingDayCountConvention = signal(365);

  // Risk monitoring
  readonly riskEnabled = signal(false);
  readonly riskCheckIntervalHours = signal(24);
  readonly riskOverrideExpiryDays = signal(7);
  readonly riskOpenSanctionsEnabled = signal(false);
  readonly riskOpenSanctionsBaseUrl = signal('http://yente:8000');
  readonly riskSeaSearcherEnabled = signal(false);
  readonly riskCompaniesHouseEnabled = signal(false);
  readonly riskCompaniesHouseApiKey = signal('');
  readonly riskAutoEnforce = signal(true);
  readonly riskNotifyPush = signal(true);
  readonly riskNotifyEmail = signal(true);
  readonly riskNotifyWhatsApp = signal(false);
  readonly riskSaving = signal(false);
  readonly riskSaveSuccess = signal(false);
  readonly riskSaveError = signal('');

  ngOnInit() {
    this.loadSettings();
  }

  async loadSettings() {
    this.loading.set(true);
    try {
      const [creditRes, financingRes, riskRes] = await Promise.all([
        firstValueFrom(
          this.http.get<ApiResponse<CreditApplicationSettingsDto>>(
            `${API}/credit/applications/settings`,
          ),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<FinancingSettingsDto>>(
            `${API}/admin/settings/financing`,
          ),
        ),
        this.riskService.getSettings().catch(() => null),
      ]);
      if (creditRes.success && creditRes.data) {
        this.requiredApprovals.set(creditRes.data.requiredApprovals);
        this.autoApplyOnApproval.set(creditRes.data.autoApplyOnApproval);
        this.immediateRejection.set(creditRes.data.immediateRejection);
        this.notifyCreditManagers.set(creditRes.data.notifyCreditManagers);
        this.notifyEmail.set(creditRes.data.notifyEmail ?? false);
        this.notifyWhatsApp.set(creditRes.data.notifyWhatsApp ?? false);
      }
      if (financingRes.success && financingRes.data) {
        this.financingAnnualRatePercent.set(financingRes.data.annualRate * 100);
        this.financingDayCountConvention.set(financingRes.data.dayCountConvention);
      }
      if (riskRes) {
        this.riskEnabled.set(riskRes.enabled);
        this.riskCheckIntervalHours.set(riskRes.checkIntervalHours);
        this.riskOverrideExpiryDays.set(riskRes.overrideExpiryDays);
        this.riskOpenSanctionsEnabled.set(riskRes.openSanctionsEnabled);
        this.riskOpenSanctionsBaseUrl.set(riskRes.openSanctionsBaseUrl ?? 'http://yente:8000');
        this.riskSeaSearcherEnabled.set(riskRes.seasearcherEnabled);
        this.riskCompaniesHouseEnabled.set(riskRes.companiesHouseEnabled);
        this.riskCompaniesHouseApiKey.set(riskRes.companiesHouseApiKey ?? '');
        this.riskAutoEnforce.set(riskRes.autoEnforceOnHit);
        this.riskNotifyPush.set(riskRes.notifyPush);
        this.riskNotifyEmail.set(riskRes.notifyEmail);
        this.riskNotifyWhatsApp.set(riskRes.notifyWhatsApp);
      }
    } catch (err) {
      console.error('Failed to load credit and financing settings:', err);
    } finally {
      this.loading.set(false);
    }
  }

  async save() {
    this.saving.set(true);
    this.saveSuccess.set(false);
    this.saveError.set('');

    try {
      await firstValueFrom(
        this.http.patch<ApiResponse<CreditApplicationSettingsDto>>(
          `${API}/credit/applications/settings`,
          {
            requiredApprovals: this.requiredApprovals(),
            autoApplyOnApproval: this.autoApplyOnApproval(),
            immediateRejection: this.immediateRejection(),
            notifyCreditManagers: this.notifyCreditManagers(),
            notifyPush: this.notifyCreditManagers(),
            notifyEmail: this.notifyEmail(),
            notifyWhatsApp: this.notifyWhatsApp(),
          },
        ),
      );
      this.saveSuccess.set(true);
      setTimeout(() => this.saveSuccess.set(false), 3000);
    } catch (err: any) {
      this.saveError.set(err?.error?.message ?? 'Failed to save settings');
    } finally {
      this.saving.set(false);
    }
  }

  async saveFinancingSettings() {
    this.financingSaving.set(true);
    this.financingSaveSuccess.set(false);
    this.financingSaveError.set('');

    try {
      await firstValueFrom(
        this.http.put<ApiResponse<FinancingSettingsDto>>(
          `${API}/admin/settings/financing`,
          {
            annualRate: this.financingAnnualRatePercent() / 100,
          },
        ),
      );
      this.financingSaveSuccess.set(true);
      setTimeout(() => this.financingSaveSuccess.set(false), 3000);
    } catch (err: any) {
      this.financingSaveError.set(err?.error?.message ?? 'Failed to save financing settings');
    } finally {
      this.financingSaving.set(false);
    }
  }

  async saveRiskSettings() {
    this.riskSaving.set(true);
    this.riskSaveSuccess.set(false);
    this.riskSaveError.set('');

    try {
      await this.riskService.updateSettings({
        enabled: this.riskEnabled(),
        checkIntervalHours: this.riskCheckIntervalHours(),
        overrideExpiryDays: this.riskOverrideExpiryDays(),
        openSanctionsEnabled: this.riskOpenSanctionsEnabled(),
        openSanctionsBaseUrl: this.riskOpenSanctionsBaseUrl() || 'http://localhost:8000',
        seasearcherEnabled: this.riskSeaSearcherEnabled(),
        companiesHouseEnabled: this.riskCompaniesHouseEnabled(),
        companiesHouseApiKey: this.riskCompaniesHouseApiKey() || '',
        autoEnforceOnHit: this.riskAutoEnforce(),
        notifyPush: this.riskNotifyPush(),
        notifyEmail: this.riskNotifyEmail(),
        notifyWhatsApp: this.riskNotifyWhatsApp(),
      });
      this.riskSaveSuccess.set(true);
      setTimeout(() => this.riskSaveSuccess.set(false), 3000);
    } catch (err: any) {
      this.riskSaveError.set(err?.error?.message ?? 'Failed to save risk settings');
    } finally {
      this.riskSaving.set(false);
    }
  }
}
