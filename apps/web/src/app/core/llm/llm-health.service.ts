import { Service, signal, computed, DestroyRef, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API } from '@app/core/config/api';

interface HealthResponse {
  success: boolean;
  data?: { healthy: boolean; searchAvailable?: boolean };
}

/**
 * Shared service to track LLM health status across the app.
 * Polls every 60s by default; components can force an immediate refresh.
 */
@Service()
export class LlmHealthService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private timer: ReturnType<typeof setInterval> | null = null;

  /** null = not yet checked, true/false = healthy/unhealthy */
  readonly healthy = signal<boolean | null>(null);
  readonly searchAvailable = signal(false);

  /** Start polling (called once from a root-level component) */
  startPolling(intervalMs = 60_000): void {
    if (this.timer) return; // already polling
    this.refresh();
    this.timer = setInterval(() => this.refresh(), intervalMs);
    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Force an immediate health check (e.g. after start/stop) */
  async refresh(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<HealthResponse>(`${API}/admin/llm/health`),
      );
      this.healthy.set(res.data?.healthy ?? false);
      this.searchAvailable.set(res.data?.searchAvailable ?? false);
    } catch {
      this.healthy.set(false);
      this.searchAvailable.set(false);
    }
  }
}
