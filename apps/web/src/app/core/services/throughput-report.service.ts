import { Service, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_URL } from '../config/api';

export interface ThroughputReportSettings {
  enabled: boolean;
  defaultUnit: string;
  groupByCategory: boolean;
}

const DEFAULT_SETTINGS: ThroughputReportSettings = {
  enabled: false,
  defaultUnit: 'Gallons',
  groupByCategory: false,
};

/** Shared service for tenant-configurable throughput report settings. */
@Service()
export class ThroughputReportService {
  private readonly http = inject(HttpClient);

  readonly settings = signal<ThroughputReportSettings>(DEFAULT_SETTINGS);
  readonly enabled = computed(() => this.settings().enabled);

  private _loaded = false;

  /** Load throughput report settings from the API (non-admin endpoint). */
  async load(): Promise<void> {
    if (this._loaded) return;
    this._loaded = true;
    try {
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; data: ThroughputReportSettings }>(
          `${API_URL}/admin/settings/my-throughput-report-settings`,
        ),
      );
      if (res.success && res.data) {
        this.settings.set(res.data);
      }
    } catch {
      // default settings work fine — feature is off
    }
  }

  /** Invalidate cache so the next load() call refetches. */
  invalidateCache(): void {
    this._loaded = false;
  }
}