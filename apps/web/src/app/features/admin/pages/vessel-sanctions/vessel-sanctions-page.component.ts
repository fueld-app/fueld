import { Component, ChangeDetectionStrategy, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { API } from '@app/core/config/api';
import type { ApiResponse, VesselSanctionSettingsDto, VesselSanctionCheckDto } from '@fueld/types';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'app-vessel-sanctions-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 class="text-lg font-semibold text-gray-900 dark:text-ink">Vessel Sanctions</h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-muted">
          Automated daily check of your fleet against the
          <a href="https://tankertrackers.com/report/sanctioned" target="_blank" rel="noopener noreferrer"
            class="text-brand-600 dark:text-brand-400 underline hover:text-brand-700">TankerTrackers sanctioned vessel list</a>.
        </p>
      </div>

      @if (loading()) {
        <div class="flex items-center gap-2 text-sm text-gray-400 dark:text-muted">
          <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          Loading…
        </div>
      } @else {
        <div class="grid gap-6 lg:grid-cols-2">
          <!-- Settings Panel -->
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--amber">
              <div class="app-panel-icon-shell app-panel-icon-shell--pill app-panel-icon-shell--amber">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-600 dark:text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.72-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Sanction Check Settings</h3>
                <p class="text-xs text-gray-600 dark:text-ink-dim">Configure automated vessel sanction screening.</p>
              </div>
            </div>

            <div class="app-panel-body app-panel-stack">
              <!-- Master toggle -->
              <div class="flex items-start gap-3">
                <button (click)="enabled.set(!enabled())"
                  class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                  [class]="enabled() ? 'bg-brand-700' : 'bg-gray-300'">
                  <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-surface transition-transform"
                    [class]="enabled() ? 'translate-x-4' : 'translate-x-0.5'"></span>
                </button>
                <div>
                  <p class="text-sm font-medium text-gray-700 dark:text-ink-dim">Enable Vessel Sanction Checks</p>
                  <p class="text-xs text-gray-500 dark:text-muted">Automatically check all vessels against the TankerTrackers sanctioned list.</p>
                </div>
              </div>

              @if (enabled()) {
                <!-- Check interval -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim mb-1">Check Interval (hours)</label>
                  <input
                    type="number"
                    min="1"
                    max="720"
                    [ngModel]="checkIntervalHours()"
                    (ngModelChange)="checkIntervalHours.set($event)"
                    class="app-input w-24"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-muted">How often to re-check all vessels. Default: 24 hours.</p>
                </div>

                <!-- Notifications -->
                <div class="space-y-2">
                  <p class="text-sm font-medium text-gray-700 dark:text-ink-dim">Notifications</p>

                  <div class="flex items-start gap-3">
                    <button (click)="notifyPush.set(!notifyPush())"
                      class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                      [class]="notifyPush() ? 'bg-brand-700' : 'bg-gray-300'">
                      <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-surface transition-transform"
                        [class]="notifyPush() ? 'translate-x-4' : 'translate-x-0.5'"></span>
                    </button>
                    <div>
                      <p class="text-sm text-gray-700 dark:text-ink-dim">Push Notifications</p>
                      <p class="text-xs text-gray-500 dark:text-muted">Notify admins and credit managers via push when sanctions are detected.</p>
                    </div>
                  </div>

                  <div class="flex items-start gap-3">
                    <button (click)="notifyEmail.set(!notifyEmail())"
                      class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                      [class]="notifyEmail() ? 'bg-brand-700' : 'bg-gray-300'">
                      <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-surface transition-transform"
                        [class]="notifyEmail() ? 'translate-x-4' : 'translate-x-0.5'"></span>
                    </button>
                    <div>
                      <p class="text-sm text-gray-700 dark:text-ink-dim">Email Notifications</p>
                    </div>
                  </div>

                  <div class="flex items-start gap-3">
                    <button (click)="notifyWhatsApp.set(!notifyWhatsApp())"
                      class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                      [class]="notifyWhatsApp() ? 'bg-brand-700' : 'bg-gray-300'">
                      <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-surface transition-transform"
                        [class]="notifyWhatsApp() ? 'translate-x-4' : 'translate-x-0.5'"></span>
                    </button>
                    <div>
                      <p class="text-sm text-gray-700 dark:text-ink-dim">WhatsApp Notifications</p>
                    </div>
                  </div>
                </div>
              }

              <!-- Save -->
              <div class="pt-2 border-t border-gray-100 dark:border-line">
                <button (click)="saveSettings()" [disabled]="saving()"
                  class="inline-flex items-center gap-1.5 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-800 transition-colors disabled:opacity-50">
                  @if (saving()) {
                    <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                  }
                  Save Settings
                </button>
                @if (saveSuccess()) {
                  <span class="ml-3 text-sm text-green-600 dark:text-green-400">Settings saved.</span>
                }
                @if (saveError()) {
                  <span class="ml-3 text-sm text-red-600 dark:text-red-400">{{ saveError() }}</span>
                }
              </div>
            </div>
          </div>

          <!-- Manual Check Panel -->
          <div class="app-panel">
            <div class="app-panel-header">
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Manual Check</h3>
                <p class="text-xs text-gray-600 dark:text-ink-dim">Trigger an immediate sanction check against all vessels in the database.</p>
              </div>
            </div>
            <div class="app-panel-body">
              <button (click)="runCheckNow()" [disabled]="checking()"
                class="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 transition-colors disabled:opacity-50">
                @if (checking()) {
                  <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  Checking…
                } @else {
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.757l4.9-4.9a.75.75 0 011.1 0l3.002 3.002a.75.75 0 010 1.06l-4.5 4.5a.75.75 0 01-1.137-.089l-3.375-4.5a.75.75 0 01.01-.073z" clip-rule="evenodd"/>
                  </svg>
                  Run Check Now
                }
              </button>

              @if (checkResult()) {
                <div class="mt-4 rounded-lg border p-3 text-sm space-y-1"
                  [class]="checkResult()!.sanctioned > 0 ? 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15' : 'border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/15'">
                  <p><strong>Vessels checked:</strong> {{ checkResult()!.checked }}</p>
                  <p><strong>Sanctioned:</strong>
                    <span [class]="checkResult()!.sanctioned > 0 ? 'text-red-700 dark:text-red-400 font-semibold' : 'text-green-700 dark:text-green-400'">
                      {{ checkResult()!.sanctioned }}
                    </span>
                  </p>
                  @if (checkResult()!.errors > 0) {
                    <p><strong>Errors:</strong> <span class="text-amber-700 dark:text-amber-400">{{ checkResult()!.errors }}</span></p>
                  }
                </div>
              }

              @if (checkError()) {
                <div class="mt-3 text-sm text-red-600 dark:text-red-400">{{ checkError() }}</div>
              }
            </div>
          </div>
        </div>

        <!-- Check History -->
        <div class="app-panel">
          <div class="app-panel-header">
            <div class="flex-1 min-w-0">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Check History</h3>
              <p class="text-xs text-gray-600 dark:text-ink-dim">Recent vessel sanction check results (sanctioned vessels only shown by default).</p>
            </div>
            <div class="flex items-center gap-2">
              <label class="text-xs text-gray-500 dark:text-muted">
                <input type="checkbox" [ngModel]="showAllHistory()" (ngModelChange)="showAllHistory.set($event); loadHistory()" class="mr-1" />
                Show all
              </label>
            </div>
          </div>
          <div class="app-panel-body p-0">
            @if (historyLoading()) {
              <div class="p-4 text-sm text-gray-400 dark:text-muted">Loading history…</div>
            } @else if (history().length === 0) {
              <div class="p-4 text-sm text-gray-400 dark:text-muted">No sanction checks recorded yet.</div>
            } @else {
              <div class="overflow-x-auto">
                <table class="min-w-full text-xs">
                  <thead>
                    <tr class="border-b border-gray-100 dark:border-line bg-gray-50/60">
                      <th class="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-muted">Vessel</th>
                      <th class="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-muted">IMO</th>
                      <th class="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-muted">Status</th>
                      <th class="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-muted">Matched On</th>
                      <th class="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-muted">Source</th>
                      <th class="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-muted">Checked At</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-50">
                    @for (c of history(); track c.id) {
                      <tr class="hover:bg-gray-50/50">
                        <td class="px-4 py-2 font-medium text-gray-900 dark:text-ink">{{ c.vesselName }}</td>
                        <td class="px-4 py-2 text-gray-500 dark:text-muted font-mono">{{ c.vesselImo || '—' }}</td>
                        <td class="px-4 py-2">
                          @if (c.status === 'SANCTIONED') {
                            <span class="inline-flex rounded-full bg-red-100 dark:bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">Sanctioned</span>
                          } @else if (c.status === 'CLEAR') {
                            <span class="inline-flex rounded-full bg-green-100 dark:bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">Clear</span>
                          } @else {
                            <span class="inline-flex rounded-full bg-yellow-100 dark:bg-yellow-500/15 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:text-yellow-400">Error</span>
                          }
                        </td>
                        <td class="px-4 py-2 text-gray-500 dark:text-muted">{{ c.matchedOn || '—' }}</td>
                        <td class="px-4 py-2 text-gray-500 dark:text-muted">{{ c.source }}</td>
                        <td class="px-4 py-2 text-gray-500 dark:text-muted">{{ c.checkedAt | date:'medium' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>

              <!-- Pagination -->
              @if (historyTotal() > historyLimit) {
                <div class="flex items-center justify-between border-t border-gray-100 dark:border-line px-4 py-2 text-xs text-gray-500 dark:text-muted">
                  <span>{{ historyTotal() }} total results</span>
                  <div class="flex gap-2">
                    <button (click)="historyPage.set(historyPage() - 1); loadHistory()"
                      [disabled]="historyPage() <= 1"
                      class="rounded px-2 py-1 hover:bg-gray-100 dark:hover:bg-surface-tint-strong disabled:opacity-30">Previous</button>
                    <span>Page {{ historyPage() }}</span>
                    <button (click)="historyPage.set(historyPage() + 1); loadHistory()"
                      [disabled]="historyPage() * historyLimit >= historyTotal()"
                      class="rounded px-2 py-1 hover:bg-gray-100 dark:hover:bg-surface-tint-strong disabled:opacity-30">Next</button>
                  </div>
                </div>
              }
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class VesselSanctionsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly saveSuccess = signal(false);
  readonly saveError = signal('');
  readonly checking = signal(false);
  readonly checkResult = signal<{ checked: number; sanctioned: number; errors: number } | null>(null);
  readonly checkError = signal('');

  // Settings
  readonly enabled = signal(false);
  readonly checkIntervalHours = signal(24);
  readonly notifyPush = signal(true);
  readonly notifyEmail = signal(true);
  readonly notifyWhatsApp = signal(false);

  // History
  readonly history = signal<VesselSanctionCheckDto[]>([]);
  readonly historyTotal = signal(0);
  readonly historyPage = signal(1);
  readonly historyLoading = signal(false);
  readonly showAllHistory = signal(false);
  readonly historyLimit = 50;

  ngOnInit() {
    this.loadAll();
  }

  private async loadAll() {
    this.loading.set(true);
    try {
      await Promise.all([this.loadSettings(), this.loadHistory()]);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadSettings() {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<VesselSanctionSettingsDto>>(`${API}/vessel-sanctions/settings`),
      );
      if (res.success && res.data) {
        this.enabled.set(res.data.enabled);
        this.checkIntervalHours.set(res.data.checkIntervalHours);
        this.notifyPush.set(res.data.notifyPush);
        this.notifyEmail.set(res.data.notifyEmail);
        this.notifyWhatsApp.set(res.data.notifyWhatsApp);
      }
    } catch { /* ignore */ }
  }

  async loadHistory() {
    this.historyLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ checks: VesselSanctionCheckDto[]; total: number }>>(
          `${API}/vessel-sanctions/history?page=${this.historyPage()}&limit=${this.historyLimit}`,
        ),
      );
      if (res.success && res.data) {
        const checks = this.showAllHistory()
          ? res.data.checks
          : res.data.checks.filter((c) => c.status === 'SANCTIONED');
        this.history.set(checks);
        this.historyTotal.set(res.data.total);
      }
    } catch { /* ignore */ } finally {
      this.historyLoading.set(false);
    }
  }

  async saveSettings() {
    this.saving.set(true);
    this.saveSuccess.set(false);
    this.saveError.set('');

    try {
      await firstValueFrom(
        this.http.put<ApiResponse<VesselSanctionSettingsDto>>(`${API}/vessel-sanctions/settings`, {
          enabled: this.enabled(),
          checkIntervalHours: this.checkIntervalHours(),
          notifyPush: this.notifyPush(),
          notifyEmail: this.notifyEmail(),
          notifyWhatsApp: this.notifyWhatsApp(),
        }),
      );
      this.saveSuccess.set(true);
      setTimeout(() => this.saveSuccess.set(false), 3000);
    } catch (err: any) {
      this.saveError.set(err?.error?.message ?? 'Failed to save settings');
    } finally {
      this.saving.set(false);
    }
  }

  async runCheckNow() {
    this.checking.set(true);
    this.checkResult.set(null);
    this.checkError.set('');

    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<{ checked: number; sanctioned: number; errors: number }>>(
          `${API}/vessel-sanctions/check-now`, {},
        ),
      );
      if (res.success && res.data) {
        this.checkResult.set(res.data);
        await this.loadHistory();
      } else {
        this.checkError.set(res.message ?? 'Check failed');
      }
    } catch (err: any) {
      this.checkError.set(err?.error?.message ?? 'Failed to run sanction check');
    } finally {
      this.checking.set(false);
    }
  }
}
