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
import type { ApiResponse, AdminUserDto } from '@fueld/types';

import { API } from '@app/core/config/api';
import { SettingsToastService } from './settings-toast.service';

interface TraderScheme {
  userId: string;
  rates: Record<string, number>;
}

//  Views & Deal Economics settings card — tenant-gated optional data views
//  (the "view module"): enable/disable views platform-wide for this tenant,
//  and configure trader commission schemes (the Excel "Annexe").
//  Commission rates are compensation data — admin-only.

@Component({
  selector: 'app-views-settings-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="app-panel">
      <div class="app-panel-header app-panel-header--brand">
        <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--brand">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-brand-600 dark:text-brand-400" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 2a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 2zM4.4 4.4a.75.75 0 011.06 0l1.06 1.06a.75.75 0 11-1.06 1.06L4.4 5.46a.75.75 0 010-1.06zM15.6 4.4a.75.75 0 010 1.06l-1.06 1.06a.75.75 0 11-1.06-1.06l1.06-1.06a.75.75 0 011.06 0zM2 10a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5A.75.75 0 012 10zm13.75 0a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5a.75.75 0 01-.75-.75z" />
            <path fill-rule="evenodd" d="M10 6a4 4 0 100 8 4 4 0 000-8zm0 2a2 2 0 100 4 2 2 0 000-4z" clip-rule="evenodd" />
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Views &amp; Deal Economics</h3>
          <p class="text-xs text-gray-500 dark:text-muted">Enable optional data views for this tenant, and configure trader commission schemes.</p>
        </div>
      </div>

      <div class="app-panel-body space-y-4">
        @if (loading()) {
          <div class="flex items-center justify-center py-6">
            <svg class="h-6 w-6 animate-spin text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          </div>
        } @else {
          <!-- View toggles -->
          <div class="space-y-2">
            @for (view of knownViews; track view.key) {
              <label class="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-line bg-gray-50 dark:bg-bg-2 px-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  [ngModel]="enabled().includes(view.key)"
                  (ngModelChange)="toggleView(view.key, $event)"
                  class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium text-gray-900 dark:text-ink">{{ view.label }}</div>
                  <div class="text-xs text-gray-500 dark:text-muted">{{ view.description }}</div>
                </div>
              </label>
            }
          </div>

          <!-- Trader commission schemes -->
          <div class="pt-2 border-t border-gray-200 dark:border-line">
            <div class="flex items-center justify-between mb-2">
              <div>
                <h4 class="text-sm font-semibold text-gray-900 dark:text-ink">Trader commissions</h4>
                <p class="text-xs text-gray-500 dark:text-muted">% of margin (after TPC) per trader, keyed by deal type (e.g. SPOT, MILITARY). Auto-fills the commission on deals.</p>
              </div>
              <button type="button" (click)="addTrader()" class="app-btn app-btn--secondary text-xs">Add trader</button>
            </div>
            <div class="space-y-2">
              @for (scheme of schemes(); track scheme.userId; let i = $index) {
                <div class="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-line bg-gray-50 dark:bg-bg-2 px-3 py-2">
                  <select [ngModel]="scheme.userId" (ngModelChange)="updateTraderUser(i, $event)" class="app-input flex-1 bg-white dark:bg-surface">
                    <option value="" disabled>Select trader…</option>
                    @for (u of traders(); track u.id) {
                      <option [value]="u.id">{{ u.name }}</option>
                    }
                  </select>
                  <input
                    type="text"
                    [ngModel]="ratesText(scheme)"
                    (ngModelChange)="updateRates(i, $event)"
                    class="app-input w-56 font-mono text-xs"
                    placeholder='{"SPOT": 7, "MILITARY": 0}'
                    title="Commission % per deal type (JSON)"
                  />
                  <button
                    type="button"
                    (click)="removeTrader(i)"
                    class="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/15 dark:hover:text-red-400"
                    title="Remove trader scheme"
                  >✕</button>
                </div>
              } @empty {
                <p class="text-sm text-gray-500 dark:text-muted">No trader commission schemes configured.</p>
              }
            </div>
          </div>

          <div class="flex justify-end">
            <button type="button" (click)="save()" [disabled]="saving()" class="app-btn app-btn--primary">
              {{ saving() ? 'Saving…' : 'Save settings' }}
            </button>
          </div>
        }
      </div>
    </div>
  `,
})
export class ViewsSettingsCardComponent implements OnInit {
  private http = inject(HttpClient);
  private toast = inject(SettingsToastService);

  readonly knownViews = [
    {
      key: 'deal-economics',
      label: 'Deal Economics',
      description: 'Per-deal commissions (TPC, trader commission %) and trading profit on orders.',
    },
    {
      key: 'performance-history',
      label: 'Performance History',
      description: 'Monthly trading profit + turnover chart on the dashboard.',
    },
  ];

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly enabled = signal<string[]>([]);
  readonly schemes = signal<TraderScheme[]>([]);
  readonly traders = signal<{ id: string; name: string }[]>([]);

  async ngOnInit(): Promise<void> {
    try {
      const [viewsRes, schemesRes, usersRes] = await Promise.all([
        firstValueFrom(this.http.get<ApiResponse<{ views: string[] }>>(`${API}/admin/settings/my-views`)),
        firstValueFrom(this.http.get<ApiResponse<TraderScheme[]>>(`${API}/admin/settings/trader-commissions`)),
        firstValueFrom(this.http.get<ApiResponse<AdminUserDto[]>>(`${API}/admin/users`)),
      ]);
      if (viewsRes.success && viewsRes.data) this.enabled.set(viewsRes.data.views ?? []);
      if (schemesRes.success && Array.isArray(schemesRes.data)) this.schemes.set(schemesRes.data);
      if (usersRes.success && Array.isArray(usersRes.data)) this.traders.set(usersRes.data.filter((u) => u.isActive).map((u) => ({ id: u.id, name: u.name })));
    } catch {
      // fail silently
    } finally {
      this.loading.set(false);
    }
  }

  toggleView(key: string, on: boolean): void {
    const current = new Set(this.enabled());
    if (on) current.add(key);
    else current.delete(key);
    this.enabled.set(Array.from(current));
  }

  addTrader(): void {
    this.schemes.update((s) => [...s, { userId: '', rates: {} }]);
  }

  removeTrader(index: number): void {
    this.schemes.update((s) => s.filter((_, i) => i !== index));
  }

  updateTraderUser(index: number, userId: string): void {
    this.schemes.update((s) => s.map((scheme, i) => (i === index ? { ...scheme, userId } : scheme)));
  }

  ratesText(scheme: TraderScheme): string {
    return JSON.stringify(scheme.rates ?? {});
  }

  updateRates(index: number, text: string): void {
    try {
      const rates = JSON.parse(text || '{}') as Record<string, number>;
      this.schemes.update((s) => s.map((scheme, i) => (i === index ? { ...scheme, rates } : scheme)));
    } catch {
      // invalid JSON while typing — ignore until save
    }
  }

  async save(): Promise<void> {
    this.saving.set(true);
    try {
      const schemes = this.schemes().filter((s) => s.userId);
      // Sequential — both PUTs do read-modify-write on the same settings JSONB;
      // concurrent writes would lose one of the two updates (last writer wins).
      await firstValueFrom(this.http.put(`${API}/admin/settings/views`, { views: this.enabled() }));
      await firstValueFrom(this.http.put(`${API}/admin/settings/trader-commissions`, { schemes }));
      this.toast.show('success', 'Views & commission settings saved');
    } catch {
      this.toast.show('error', 'Failed to save settings');
    } finally {
      this.saving.set(false);
    }
  }
}