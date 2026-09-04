import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse } from '@fueld/types';

import { API } from '@app/core/config/api';

/**
 * Tenant-gated optional data views (the "view module").
 * Enabled views are configured per tenant (Admin → General → Views &
 * Deal Economics) and exposed to all users via /admin/settings/my-views.
 */
@Injectable({ providedIn: 'root' })
export class ViewsService {
  private http = inject(HttpClient);
  private loaded = false;

  /** Enabled view keys, e.g. 'deal-economics', 'performance-history'. */
  readonly enabledViews = signal<string[]>([]);

  has(view: string): boolean {
    return this.enabledViews().includes(view);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ views: string[] }>>(`${API}/admin/settings/my-views`),
      );
      if (res.success && res.data) this.enabledViews.set(res.data.views ?? []);
    } catch {
      // Views are optional — fail silently (all disabled).
    }
  }
}