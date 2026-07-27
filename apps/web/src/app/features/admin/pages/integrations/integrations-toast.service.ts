import { Service, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, IntegrationStatusDto } from '@fueld/types';
import { API } from '@app/core/config/api';

@Service()
export class IntegrationsToastService {
  private readonly http = inject(HttpClient);

  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);
  readonly integrations = signal<IntegrationStatusDto[]>([]);
  readonly loaded = signal(false);

  show(type: 'success' | 'error', message: string): void {
    this.toast.set({ type, message });
    setTimeout(() => this.toast.set(null), 3000);
  }

  /** Load all integration statuses from the API. */
  async loadIntegrations(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<IntegrationStatusDto[]>>(`${API}/admin/settings/integrations`),
      );
      if (res.success) {
        this.integrations.set(res.data);
      }
    } catch (err) {
      console.error('Failed to load integrations:', err);
    } finally {
      this.loaded.set(true);
    }
  }

  /** Find a specific provider's status. */
  getProvider(provider: string): IntegrationStatusDto | undefined {
    return this.integrations().find((i) => i.provider.toUpperCase() === provider.toUpperCase());
  }
}
