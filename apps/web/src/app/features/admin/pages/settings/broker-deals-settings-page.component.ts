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
import type { ApiResponse } from '@fueld/types';
import { API } from '@app/core/config/api';
import { SettingsToastService } from './settings-toast.service';

@Component({
  selector: 'app-broker-deals-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">Broker Deals</h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-muted">
          Enable broker deal functionality, configure commission rates, and customize reporting.
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
                <span class="text-sm font-semibold text-gray-900 dark:text-ink">Enable Broker Deals</span>
                <p class="text-xs text-gray-500 dark:text-muted mt-0.5">Shows the Broker Deals tab, checkboxes on orders, and commission tracking.</p>
              </div>
            </label>
          </div>

          @if (enabled()) {
            <!-- Commission settings -->
            <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
              <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim mb-4">Commission</h3>
              <div class="grid grid-cols-3 gap-4">
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Default Rate</label>
                  <input type="number" step="0.01" [ngModel]="defaultCommissionPerMt()" (ngModelChange)="defaultCommissionPerMt.set(+$event)"
                    class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Currency</label>
                  <input type="text" [ngModel]="commissionCurrency()" (ngModelChange)="commissionCurrency.set($event)"
                    class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Unit</label>
                  <select [ngModel]="commissionUnit()" (ngModelChange)="commissionUnit.set($event)"
                    class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none bg-white dark:bg-surface">
                    <option value="MT">MT</option>
                    <option value="GAL">GAL</option>
                    <option value="BBL">BBL</option>
                    <option value="CBM">CBM</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Report settings -->
            <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
              <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim mb-4">Commission Report</h3>
              <div class="space-y-4">
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Report Title</label>
                  <input type="text" [ngModel]="reportTitle()" (ngModelChange)="reportTitle.set($event)"
                    class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none" />
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Report Date Field</label>
                    <select [ngModel]="reportDateField()" (ngModelChange)="reportDateField.set($event)"
                      class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none bg-white dark:bg-surface">
                      <option value="deliveredAt">Delivered Date</option>
                      <option value="eta">ETA</option>
                      <option value="createdAt">Created Date</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Date Fallback</label>
                    <select [ngModel]="reportDateFallback()" (ngModelChange)="reportDateFallback.set($event)"
                      class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none bg-white dark:bg-surface">
                      <option value="eta">ETA</option>
                      <option value="deliveredAt">Delivered Date</option>
                      <option value="createdAt">Created Date</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Report Statuses (comma-separated)</label>
                  <input type="text" [ngModel]="reportStatusesStr()" (ngModelChange)="reportStatusesStr.set($event)"
                    class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                    placeholder="CONFIRMED,DELIVERED,INVOICED,PAID" />
                </div>
              </div>
            </div>

            <!-- Credit settings -->
            <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
              <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim mb-4">Credit & Invoicing</h3>
              <div class="space-y-3">
                <label class="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" [ngModel]="autoReleaseCredit()" (ngModelChange)="autoReleaseCredit.set($event)"
                    class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                  <span class="text-sm text-gray-700 dark:text-ink-dim">Auto-release supplier credit after credit period</span>
                </label>
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Buffer days (extra days before auto-release)</label>
                  <input type="number" [ngModel]="autoReleaseBufferDays()" (ngModelChange)="autoReleaseBufferDays.set(+$event)"
                    class="w-24 rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none" />
                </div>
                <label class="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" [ngModel]="hideInvoicingFields()" (ngModelChange)="hideInvoicingFields.set($event)"
                    class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                  <span class="text-sm text-gray-700 dark:text-ink-dim">Hide invoicing fields on broker deals</span>
                </label>
              </div>
            </div>

            <!-- Labels -->
            <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
              <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim mb-4">Labels</h3>
              <div class="grid grid-cols-3 gap-4">
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Deal Label</label>
                  <input type="text" [ngModel]="brokerDealLabel()" (ngModelChange)="brokerDealLabel.set($event)"
                    class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Commission Label</label>
                  <input type="text" [ngModel]="commissionLabel()" (ngModelChange)="commissionLabel.set($event)"
                    class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Credit Line Label</label>
                  <input type="text" [ngModel]="brokerCreditLabel()" (ngModelChange)="brokerCreditLabel.set($event)"
                    class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none" />
                </div>
              </div>
            </div>
          }

          <!-- Save button -->
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
export class BrokerDealsSettingsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toastSvc = inject(SettingsToastService);

  readonly loading = signal(true);
  readonly saving = signal(false);

  readonly enabled = signal(false);
  readonly defaultCommissionPerMt = signal(3);
  readonly commissionCurrency = signal('USD');
  readonly commissionUnit = signal('MT');
  readonly reportTitle = signal('Broker Commission Report');
  readonly reportStatusesStr = signal('CONFIRMED,DELIVERED,INVOICED,PAID');
  readonly reportDateField = signal('deliveredAt');
  readonly reportDateFallback = signal('eta');
  readonly hideInvoicingFields = signal(true);
  readonly brokerDealLabel = signal('Broker Deal');
  readonly commissionLabel = signal('Commission');
  readonly autoReleaseCredit = signal(true);
  readonly autoReleaseBufferDays = signal(0);
  readonly brokerCreditLabel = signal('Broker Credit');

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<any>>(`${API}/admin/settings/my-broker-deal-settings`),
      );
      if (res.success && res.data) {
        const d = res.data;
        this.enabled.set(d.enabled);
        this.defaultCommissionPerMt.set(d.defaultCommissionPerMt);
        this.commissionCurrency.set(d.commissionCurrency);
        this.commissionUnit.set(d.commissionUnit);
        this.reportTitle.set(d.reportTitle);
        this.reportStatusesStr.set(d.reportStatuses.join(','));
        this.reportDateField.set(d.reportDateField);
        this.reportDateFallback.set(d.reportDateFallback);
        this.hideInvoicingFields.set(d.hideInvoicingFields);
        this.brokerDealLabel.set(d.brokerDealLabel);
        this.commissionLabel.set(d.commissionLabel);
        this.autoReleaseCredit.set(d.autoReleaseCredit);
        this.autoReleaseBufferDays.set(d.autoReleaseBufferDays);
        this.brokerCreditLabel.set(d.brokerCreditLabel);
      }
    } catch {
      // defaults are fine
    } finally {
      this.loading.set(false);
    }
  }

  async save(): Promise<void> {
    this.saving.set(true);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<any>>(`${API}/admin/settings/broker-deals`, {
            enabled: this.enabled(),
            defaultCommissionPerMt: this.defaultCommissionPerMt(),
            commissionCurrency: this.commissionCurrency(),
            commissionUnit: this.commissionUnit(),
            reportTitle: this.reportTitle(),
            reportStatuses: this.reportStatusesStr().split(',').map((s) => s.trim()).filter(Boolean),
            reportDateField: this.reportDateField(),
            reportDateFallback: this.reportDateFallback(),
            hideInvoicingFields: this.hideInvoicingFields(),
            brokerDealLabel: this.brokerDealLabel(),
            commissionLabel: this.commissionLabel(),
            autoReleaseCredit: this.autoReleaseCredit(),
            autoReleaseBufferDays: this.autoReleaseBufferDays(),
            brokerCreditLabel: this.brokerCreditLabel(),
        }),
      );
      if (res.success) {
        this.toastSvc.show('success', 'Broker deal settings saved.');
      } else {
        this.toastSvc.show('error', res.message ?? 'Failed to save settings.');
      }
    } catch {
      this.toastSvc.show('error', 'Failed to save settings.');
    } finally {
      this.saving.set(false);
    }
  }
}