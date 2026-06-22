import { Service, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse } from '@fueld/types';
import { API } from '@app/core/config/api';

export interface AppHealthDto {
  status: string;
  uptime: number;
  appVersion: string;
  deployVersion: string;
  gitSha: string;
  buildTime: string;
  backupFormatVersion: number;
  restoreInProgress: boolean;
}

export function formatAppVersionLabel(health: AppHealthDto | null): string {
  if (!health) {
    return 'Fueld';
  }

  const deploySuffix = health.deployVersion.startsWith(`${health.appVersion}+`)
    ? health.deployVersion.slice(health.appVersion.length + 1)
    : health.deployVersion;

  return deploySuffix
    ? `Fueld v${health.appVersion} (${deploySuffix})`
    : `Fueld v${health.appVersion}`;
}

@Service()
export class AppHealthService {
  private readonly http = inject(HttpClient);

  readonly health = signal<AppHealthDto | null>(null);

  async refresh(force = false): Promise<AppHealthDto | null> {
    if (!force && this.health()) {
      return this.health();
    }

    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<AppHealthDto>>(`${API}/health`),
      );

      if (response.success && response.data) {
        this.health.set(response.data);
        return response.data;
      }
    } catch {
      // Ignore health lookup failures and keep UI fallbacks.
    }

    this.health.set(null);
    return null;
  }
}