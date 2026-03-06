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
import type { ApiResponse, CreditApplicationSettingsDto } from '@fueld/types';
import { API } from '@app/core/config/api';

@Component({
  selector: 'app-credit-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900">Credit Application Settings</h1>
        <p class="mt-1 text-sm text-gray-500">
          Configure the approval workflow for credit applications.
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
        <div class="max-w-2xl">
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-brand-600" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Approval Workflow</h3>
                <p class="text-xs text-gray-500">Control how credit applications are reviewed and approved.</p>
              </div>
            </div>

            <div class="p-6 space-y-6">
              <!-- Required Approvals -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Required Approvals</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  [ngModel]="requiredApprovals()"
                  (ngModelChange)="requiredApprovals.set($event)"
                  class="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm
                         focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
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

              <!-- Save button -->
              <div class="pt-2 border-t border-gray-100">
                <button (click)="save()" [disabled]="saving()"
                  class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 transition-colors disabled:opacity-50">
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
        </div>
      }
    </div>
  `,
})
export class CreditSettingsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly saveSuccess = signal(false);
  readonly saveError = signal('');

  readonly requiredApprovals = signal(1);
  readonly autoApplyOnApproval = signal(true);
  readonly immediateRejection = signal(true);
  readonly notifyCreditManagers = signal(true);

  ngOnInit() {
    this.loadSettings();
  }

  async loadSettings() {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CreditApplicationSettingsDto>>(
          `${API}/credit/applications/settings`,
        ),
      );
      if (res.success && res.data) {
        this.requiredApprovals.set(res.data.requiredApprovals);
        this.autoApplyOnApproval.set(res.data.autoApplyOnApproval);
        this.immediateRejection.set(res.data.immediateRejection);
        this.notifyCreditManagers.set(res.data.notifyCreditManagers);
      }
    } catch (err) {
      console.error('Failed to load credit application settings:', err);
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
}
