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
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, OrderNumberSettingsDto } from '@fueld/types';

import { API } from '@app/core/config/api';

@Component({
  selector: 'app-general-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <!-- Header -->
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900">General Settings</h1>
        <p class="mt-1 text-sm text-gray-500">
          Configure order numbering and other general settings.
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
        <div class="grid grid-cols-1 gap-6 min-[900px]:grid-cols-2 min-[1600px]:grid-cols-3">

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Order Number Template                                   -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--brand">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--brand">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-brand-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm4.75 6.75a.75.75 0 00-1.5 0v2.546l-.943-1.048a.75.75 0 00-1.114 1.004l2.25 2.5a.75.75 0 001.114 0l2.25-2.5a.75.75 0 10-1.114-1.004l-.943 1.048V8.75z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Order Number Format</h3>
                <p class="text-xs text-gray-500">Configure the format used for external order/inquiry numbers.</p>
              </div>
            </div>

            <div class="app-panel-body space-y-5">

              <!-- Prefix -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Prefix (optional)</label>
                <input
                  type="text"
                  [ngModel]="prefix()"
                  (ngModelChange)="prefix.set($event)"
                  placeholder="e.g. FU-"
                      class="app-input w-full max-w-xs"
                />
                <p class="mt-1 text-xs text-gray-500">
                  Added before the template. Leave empty for no prefix.
                </p>
              </div>

              <!-- Template -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Template</label>
                <input
                  type="text"
                  [ngModel]="template()"
                  (ngModelChange)="template.set($event)"
                      class="app-input-mono w-full max-w-md"
                />
                <p class="mt-1 text-xs text-gray-500">
                  Available tokens:
                  <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">{{ '{' }}PREFIX{{ '}' }}</code>,
                  <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">{{ '{' }}YYYY{{ '}' }}</code>,
                  <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">{{ '{' }}MM{{ '}' }}</code>,
                  <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">{{ '{' }}DD{{ '}' }}</code>,
                  <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">{{ '{' }}SEQ:N{{ '}' }}</code> (N = zero-padded digits)
                </p>
              </div>

              <!-- Preview -->
              <div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p class="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">Preview (next number)</p>
                <p class="text-lg font-mono font-semibold text-gray-900">{{ livePreview() }}</p>
                <p class="text-xs text-gray-500 mt-1">
                  Global sequence counter: {{ nextSeq() }}
                </p>
              </div>

              <!-- Save button -->
              <div class="flex items-center gap-3 pt-2">
                <button
                  (click)="save()"
                  [disabled]="saving()"
                      class="app-button-primary"
                >
                  @if (saving()) {
                    Saving…
                  } @else {
                    Save Changes
                  }
                </button>

                @if (saved()) {
                  <span class="text-sm text-green-600 flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                    </svg>
                    Saved
                  </span>
                }
              </div>
            </div>
          </div>

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Timezone                                               -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--blue">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--blue">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Timezone</h3>
                <p class="text-xs text-gray-500">Default timezone for date/time display in the UI, emails, WhatsApp messages, and PDF documents.</p>
              </div>
            </div>

            <div class="app-panel-body space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Default timezone</label>
                <select
                  [ngModel]="defaultTimezone()"
                  (ngModelChange)="setDefaultTimezone($event)"
                  class="app-input w-full max-w-xs bg-white"
                >
                  <option value="">Browser default (no override)</option>
                  @for (tz of commonTimezones(); track tz.value) {
                    <option [value]="tz.value">{{ tz.label }}</option>
                  }
                </select>
                <p class="mt-1 text-xs text-gray-500">
                  All timestamps are stored as UTC. This setting controls how dates are displayed.
                  Leave empty to use each user's browser timezone.
                </p>
              </div>

              @if (defaultTimezone()) {
                <div class="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
                  Current time in {{ defaultTimezone() }}:
                  <span class="font-semibold">{{ timezonePreview() }}</span>
                </div>
              }

              <div class="flex items-center gap-3 pt-2">
                <button
                  (click)="saveTimezone()"
                  [disabled]="timezoneSaving()"
                  class="app-button-primary"
                >
                  @if (timezoneSaving()) { Saving… } @else { Save Timezone }
                </button>
                @if (timezoneSaved()) {
                  <span class="text-sm text-green-600 flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                    </svg>
                    Saved
                  </span>
                }
              </div>
            </div>
          </div>

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Role Dashboards                                        -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--indigo">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--indigo">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-indigo-600" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Role Dashboards</h3>
                <p class="text-xs text-gray-500">Configure default landing page per role.</p>
              </div>
            </div>

            <div class="app-panel-body space-y-3">
              @for (role of availableRoles; track role.key) {
                <div class="flex items-center gap-3">
                  <span class="w-24 text-sm font-medium text-gray-700">{{ role.label }}</span>
                  <select
                    [ngModel]="roleDashboards()[role.key]"
                    (ngModelChange)="setRoleDashboard(role.key, $event)"
                    class="app-input flex-1"
                  >
                    <option value="">Default Dashboard</option>
                    <option value="/operations/board">Operations Board</option>
                    <option value="/trading/orders">Active Orders</option>
                    <option value="/trading/inquiries">Inquiries</option>
                    <option value="/reports">Reports</option>
                  </select>
                </div>
              }

              <div class="flex items-center gap-3 pt-2">
                <button
                  (click)="saveRoleDashboards()"
                  [disabled]="roleDashboardsSaving()"
                  class="app-button-primary"
                >
                  @if (roleDashboardsSaving()) { Saving… } @else { Save Dashboards }
                </button>
                @if (roleDashboardsSaved()) {
                  <span class="text-sm text-green-600 flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                    </svg>
                    Saved
                  </span>
                }
              </div>
            </div>
          </div>

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Follow-Up Settings                                       -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--amber">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--amber">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Follow-Up Settings</h3>
                <p class="text-xs text-gray-500">Configure default follow-up reminder timing for comments.</p>
              </div>
            </div>

            <div class="app-panel-body">
              <div>
                <p class="text-sm font-medium text-gray-900">Default follow-up days</p>
                <p class="text-xs text-gray-500">When a user adds a follow-up to a comment, the date will default to this many days from today.</p>
              </div>
              <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                <div class="w-full sm:w-40">
                  <label class="block text-sm font-medium text-gray-700">Days</label>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    [ngModel]="followUpDefaultDays()"
                    (ngModelChange)="setFollowUpDefaultDays($event)"
                    class="app-input mt-1 w-full"
                  />
                </div>
                <button
                  type="button"
                  (click)="saveFollowUpSettings()"
                  [disabled]="followUpSaving()"
                  class="inline-flex items-center justify-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-50"
                >
                  @if (followUpSaving()) { Saving… } @else { Save }
                </button>
                @if (followUpSaved()) {
                  <span class="text-sm text-green-600 flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                    </svg>
                    Saved
                  </span>
                }
              </div>
            </div>
          </div>

        </div>
      }

      <!-- Toast notification -->
      @if (toast()) {
        <div
          class="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-opacity"
          [class]="toast()!.type === 'success'
            ? 'border border-green-200 bg-green-50 text-green-800'
            : 'border border-red-200 bg-red-50 text-red-800'"
        >
          {{ toast()!.message }}
        </div>
      }
    </div>
  `,
})
export class GeneralSettingsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);

  readonly template = signal('{YYYY}{MM}{DD}-{SEQ:6}');
  readonly prefix = signal('');
  readonly nextSeq = signal(1);

  readonly defaultTimezone = signal('');
  readonly timezoneSaving = signal(false);
  readonly timezoneSaved = signal(false);

  readonly roleDashboards = signal<Record<string, string>>({});
  readonly roleDashboardsSaving = signal(false);
  readonly roleDashboardsSaved = signal(false);
  readonly availableRoles = [
    { key: 'ADMIN', label: 'Admin' },
    { key: 'TRADER', label: 'Trader' },
    { key: 'FINANCE', label: 'Finance' },
    { key: 'TEAMLEAD', label: 'Team Lead' },
    { key: 'CREDITMANAGER', label: 'Credit Manager' },
    { key: 'OPERATIONSMANAGER', label: 'Operations Manager' },
    { key: 'LIGHT', label: 'Light' },
  ];

  readonly followUpDefaultDays = signal('90');
  readonly followUpSaving = signal(false);
  readonly followUpSaved = signal(false);

  readonly commonTimezones = signal<{ value: string; label: string }[]>([
    { value: 'America/Chicago', label: 'America/Chicago (Houston, CST/CDT)' },
    { value: 'Europe/Copenhagen', label: 'Europe/Copenhagen (CET/CEST)' },
    { value: 'Europe/Monaco', label: 'Europe/Monaco (CET/CEST)' },
    { value: 'Asia/Dubai', label: 'Asia/Dubai (GST)' },
    { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
    { value: 'Europe/Paris', label: 'Europe/Paris (CET/CEST)' },
    { value: 'America/New_York', label: 'America/New York (EST/EDT)' },
    { value: 'America/Los_Angeles', label: 'America/Los Angeles (PST/PDT)' },
    { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT)' },
    { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
    { value: 'Asia/Shanghai', label: 'Asia/Shanghai (CST)' },
    { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' },
    { value: 'Europe/Moscow', label: 'Europe/Moscow (MSK)' },
    { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST/AEDT)' },
    { value: 'Pacific/Auckland', label: 'Pacific/Auckland (NZST/NZDT)' },
    { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
  ]);

  readonly timezonePreview = computed(() => {
    const tz = this.defaultTimezone();
    if (!tz) return '';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZoneName: 'short',
      }).format(new Date());
    } catch {
      return 'Invalid timezone';
    }
  });

  readonly livePreview = computed(() => {
    const tmpl = this.template();
    const pfx = this.prefix();
    const seq = this.nextSeq();

    const now = new Date();
    const yyyy = now.getUTCFullYear().toString();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');

    let result = tmpl
      .replace('{PREFIX}', pfx)
      .replace('{YYYY}', yyyy)
      .replace('{MM}', mm)
      .replace('{DD}', dd);

    result = result.replace(/\{SEQ:(\d+)\}/g, (_match: string, digits: string) => {
      return String(seq).padStart(parseInt(digits, 10), '0');
    });
    result = result.replace('{SEQ}', String(seq).padStart(6, '0'));

    return result;
  });

  ngOnInit(): void {
    this.loadSettings();
    this.loadTimezoneSettings();
    this.loadRoleDashboards();
    this.loadFollowUpSettings();
  }

  private async loadSettings(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<OrderNumberSettingsDto>>(
          `${API}/admin/settings/order-number`,
        ),
      );
      if (res.success) {
        this.template.set(res.data.template);
        this.prefix.set(res.data.prefix);
        this.nextSeq.set(res.data.nextSeq);
      }
    } catch {
      this.showToast('error', 'Failed to load order number settings.');
    } finally {
      this.loading.set(false);
    }
  }

  async save(): Promise<void> {
    this.saving.set(true);
    this.saved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<OrderNumberSettingsDto>>(
          `${API}/admin/settings/order-number`,
          {
            template: this.template(),
            prefix: this.prefix(),
          },
        ),
      );
      if (res.success) {
        this.nextSeq.set(res.data.nextSeq);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
      } else {
        this.showToast('error', res.message ?? 'Failed to save.');
      }
    } catch {
      this.showToast('error', 'Failed to save order number settings.');
    } finally {
      this.saving.set(false);
    }
  }

  private async loadTimezoneSettings(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ defaultTimezone: string | null }>>(`${API}/admin/settings/timezone`),
      );
      if (res.success) {
        this.defaultTimezone.set(res.data.defaultTimezone ?? '');
      }
    } catch {
      // ignore – defaults work fine
    }
  }

  setDefaultTimezone(value: string): void {
    this.defaultTimezone.set(value);
  }

  async saveTimezone(): Promise<void> {
    this.timezoneSaving.set(true);
    this.timezoneSaved.set(false);
    try {
      const tz = this.defaultTimezone() || null;
      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ defaultTimezone: string | null }>>(`${API}/admin/settings/timezone`, { defaultTimezone: tz }),
      );
      if (res.success) {
        this.defaultTimezone.set(res.data.defaultTimezone ?? '');
        this.timezoneSaved.set(true);
        setTimeout(() => this.timezoneSaved.set(false), 3000);
      } else {
        this.showToast('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.showToast('error', 'Failed to save timezone settings.');
    } finally {
      this.timezoneSaving.set(false);
    }
  }

  private async loadRoleDashboards(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ dashboards: Record<string, string> }>>(`${API}/admin/settings/role-dashboards`),
      );
      if (res.success) {
        this.roleDashboards.set(res.data.dashboards ?? {});
      }
    } catch {
      // ignore
    }
  }

  setRoleDashboard(roleKey: string, route: string): void {
    this.roleDashboards.update((current) => ({ ...current, [roleKey]: route }));
  }

  async saveRoleDashboards(): Promise<void> {
    this.roleDashboardsSaving.set(true);
    this.roleDashboardsSaved.set(false);
    try {
      const payload = this.roleDashboards();
      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ dashboards: typeof payload }>>(`${API}/admin/settings/role-dashboards`, { dashboards: payload }),
      );
      if (res.success) {
        this.roleDashboardsSaved.set(true);
        setTimeout(() => this.roleDashboardsSaved.set(false), 3000);
      } else {
        this.showToast('error', (res as any).message ?? 'Failed to save role dashboards.');
      }
    } catch {
      this.showToast('error', 'Failed to save role dashboards.');
    } finally {
      this.roleDashboardsSaving.set(false);
    }
  }

  private async loadFollowUpSettings(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ defaultFollowUpDays: number }>>(`${API}/admin/settings/follow-up`),
      );
      if (res.success) {
        this.followUpDefaultDays.set(String(res.data.defaultFollowUpDays));
      }
    } catch {
      // ignore – defaults work fine
    }
  }

  setFollowUpDefaultDays(value: string): void {
    this.followUpDefaultDays.set(value);
  }

  async saveFollowUpSettings(): Promise<void> {
    const days = parseInt(this.followUpDefaultDays(), 10);
    if (!days || days < 1 || days > 365) {
      this.showToast('error', 'Days must be between 1 and 365.');
      return;
    }
    this.followUpSaving.set(true);
    this.followUpSaved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ defaultFollowUpDays: number }>>(`${API}/admin/settings/follow-up`, { defaultFollowUpDays: days }),
      );
      if (res.success) {
        this.followUpDefaultDays.set(String(res.data.defaultFollowUpDays));
        this.followUpSaved.set(true);
        setTimeout(() => this.followUpSaved.set(false), 3000);
      } else {
        this.showToast('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.showToast('error', 'Failed to save follow-up settings.');
    } finally {
      this.followUpSaving.set(false);
    }
  }

  private showToast(type: 'success' | 'error', message: string): void {
    this.toast.set({ type, message });
    setTimeout(() => this.toast.set(null), 4000);
  }
}
