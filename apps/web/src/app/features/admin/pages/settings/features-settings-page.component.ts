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
import { BrokerDealService } from '@app/core/services/broker-deal.service';
import { ThroughputReportService } from '@app/core/services/throughput-report.service';

@Component({
  selector: 'app-features-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">Feature Toggles</h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-muted">
          Enable or disable optional features for your workspace.
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

          <!-- Photo Gallery -->
          <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
            <div class="flex items-start justify-between">
              <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">📸 Photo Gallery</h3>
                <p class="mt-1 text-xs text-gray-500 dark:text-muted">
                  Upload categorized photos to orders and view them in a gallery on the order detail page.
                </p>
              </div>
              <label class="flex items-center gap-2 cursor-pointer ml-4">
                <input
                  type="checkbox"
                  [ngModel]="photoGalleryEnabled()"
                  (ngModelChange)="photoGalleryEnabled.set($event)"
                  class="h-5 w-5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <span class="text-sm font-medium text-gray-700 dark:text-ink-dim">
                  {{ photoGalleryEnabled() ? 'Enabled' : 'Disabled' }}
                </span>
              </label>
            </div>

            @if (photoGalleryEnabled()) {
              <div class="mt-4 space-y-3 border-t border-gray-100 dark:border-line pt-4">
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Photo Categories</label>
                  <input
                    type="text"
                    [ngModel]="photoCategoriesStr()"
                    (ngModelChange)="photoCategoriesStr.set($event)"
                    placeholder="BEFORE, AFTER, TANK_SEAL, OTHER"
                    class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                  />
                  <p class="mt-1 text-xs text-gray-400 dark:text-muted">Comma-separated list of category names</p>
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Max File Size (MB)</label>
                  <input
                    type="number"
                    [ngModel]="photoMaxFileSizeMb()"
                    (ngModelChange)="photoMaxFileSizeMb.set(+$event)"
                    class="w-24 rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                  />
                </div>
              </div>
            }
          </div>

          <!-- Throughput Report -->
          <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
            <div class="flex items-start justify-between">
              <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">📊 Throughput / Sales Report</h3>
                <p class="mt-1 text-xs text-gray-500 dark:text-muted">
                  Report showing product/service volumes by time period with Excel export. Replaces manual spreadsheets.
                </p>
              </div>
              <label class="flex items-center gap-2 cursor-pointer ml-4">
                <input
                  type="checkbox"
                  [ngModel]="throughputEnabled()"
                  (ngModelChange)="throughputEnabled.set($event)"
                  class="h-5 w-5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <span class="text-sm font-medium text-gray-700 dark:text-ink-dim">
                  {{ throughputEnabled() ? 'Enabled' : 'Disabled' }}
                </span>
              </label>
            </div>

            @if (throughputEnabled()) {
              <div class="mt-4 space-y-3 border-t border-gray-100 dark:border-line pt-4">
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Default Unit</label>
                  <input
                    type="text"
                    [ngModel]="throughputDefaultUnit()"
                    (ngModelChange)="throughputDefaultUnit.set($event)"
                    class="w-40 rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                  />
                </div>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    [ngModel]="throughputGroupByCategory()"
                    (ngModelChange)="throughputGroupByCategory.set($event)"
                    class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span class="text-sm text-gray-700 dark:text-ink-dim">Group results by order category</span>
                </label>
              </div>
            }
          </div>

          <!-- Save button -->
          <div class="flex justify-end">
            <button
              (click)="save()"
              [disabled]="saving()"
              class="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50 inline-flex items-center gap-2"
            >
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
export class FeaturesSettingsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toastSvc = inject(SettingsToastService);
  private readonly brokerDealSvc = inject(BrokerDealService);
  private readonly throughputReportSvc = inject(ThroughputReportService);

  readonly loading = signal(true);
  readonly saving = signal(false);

  // Photo Gallery settings
  readonly photoGalleryEnabled = signal(false);
  readonly photoCategoriesStr = signal('BEFORE, AFTER, TANK_SEAL, OTHER');
  readonly photoMaxFileSizeMb = signal(10);

  // Throughput Report settings
  readonly throughputEnabled = signal(false);
  readonly throughputDefaultUnit = signal('Gallons');
  readonly throughputGroupByCategory = signal(false);

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [photoRes, throughputRes] = await Promise.all([
        firstValueFrom(this.http.get<ApiResponse<{
          enabled: boolean; photoCategories: string[]; maxFileSizeMb: number;
        }>>(`${API}/admin/settings/my-photo-gallery-settings`)),
        firstValueFrom(this.http.get<ApiResponse<{
          enabled: boolean; defaultUnit: string; groupByCategory: boolean;
        }>>(`${API}/admin/settings/my-throughput-report-settings`)),
      ]);

      if (photoRes.success && photoRes.data) {
        this.photoGalleryEnabled.set(photoRes.data.enabled);
        this.photoCategoriesStr.set(photoRes.data.photoCategories.join(', '));
        this.photoMaxFileSizeMb.set(photoRes.data.maxFileSizeMb);
      }
      if (throughputRes.success && throughputRes.data) {
        this.throughputEnabled.set(throughputRes.data.enabled);
        this.throughputDefaultUnit.set(throughputRes.data.defaultUnit);
        this.throughputGroupByCategory.set(throughputRes.data.groupByCategory);
      }
    } catch {
      this.toastSvc.show('error', 'Failed to load feature settings.');
    } finally {
      this.loading.set(false);
    }
  }

  async save(): Promise<void> {
    this.saving.set(true);
    try {
      const photoCategories = this.photoCategoriesStr()
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter((c) => c.length > 0);

      const [photoRes, throughputRes] = await Promise.all([
        firstValueFrom(this.http.put<ApiResponse<unknown>>(`${API}/admin/settings/photo-gallery`, {
          enabled: this.photoGalleryEnabled(),
          photoCategories: photoCategories.length ? photoCategories : ['BEFORE', 'AFTER', 'TANK_SEAL', 'OTHER'],
          maxFileSizeMb: this.photoMaxFileSizeMb(),
        })),
        firstValueFrom(this.http.put<ApiResponse<unknown>>(`${API}/admin/settings/throughput-report`, {
          enabled: this.throughputEnabled(),
          defaultUnit: this.throughputDefaultUnit(),
          groupByCategory: this.throughputGroupByCategory(),
        })),
      ]);

      if (photoRes.success && throughputRes.success) {
        this.toastSvc.show('success', 'Feature settings saved.');
        // Invalidate cached services so nav menu updates
        this.brokerDealSvc.invalidateCache();
        void this.brokerDealSvc.load();
        this.throughputReportSvc.invalidateCache();
        void this.throughputReportSvc.load();
      } else {
        this.toastSvc.show('error', 'Failed to save some settings.');
      }
    } catch {
      this.toastSvc.show('error', 'Failed to save feature settings.');
    } finally {
      this.saving.set(false);
    }
  }
}