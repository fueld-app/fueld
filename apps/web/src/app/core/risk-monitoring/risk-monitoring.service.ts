import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API } from '@app/core/config/api';
import type {
  ApiResponse,
  RiskSummaryDto,
  RiskCheckDto,
  RiskHitDto,
  RiskOverrideDto,
  RiskMonitoringSettingsDto,
} from '@fueld/types';

@Service()
export class RiskMonitoringService {
  private readonly http = inject(HttpClient);

  async getSummary(counterpartyId: string): Promise<RiskSummaryDto | null> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<RiskSummaryDto>>(`${API}/risk-monitoring/summary/${counterpartyId}`),
    );
    return res.success ? res.data : null;
  }

  async getChecks(counterpartyId: string): Promise<RiskCheckDto[]> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<RiskCheckDto[]>>(`${API}/risk-monitoring/checks/${counterpartyId}`),
    );
    return res.success ? res.data : [];
  }

  async getHits(counterpartyId: string, activeOnly = true): Promise<RiskHitDto[]> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<RiskHitDto[]>>(`${API}/risk-monitoring/hits/${counterpartyId}?activeOnly=${activeOnly}`),
    );
    return res.success ? res.data : [];
  }

  async triggerCheck(counterpartyId: string): Promise<RiskSummaryDto | null> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<RiskSummaryDto>>(`${API}/risk-monitoring/check/${counterpartyId}`, {}),
    );
    return res.success ? res.data : null;
  }

  async isFrozen(counterpartyId: string): Promise<boolean> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<{ frozen: boolean }>>(`${API}/risk-monitoring/frozen/${counterpartyId}`),
    );
    return res.success ? res.data.frozen : false;
  }

  async batchFrozen(counterpartyIds: string[]): Promise<Set<string>> {
    if (!counterpartyIds.length) return new Set();
    const res = await firstValueFrom(
      this.http.post<ApiResponse<{ frozenCounterpartyIds: string[] }>>(`${API}/risk-monitoring/frozen/batch`, { counterpartyIds }),
    );
    return res.success ? new Set(res.data.frozenCounterpartyIds) : new Set();
  }

  async getOverrides(counterpartyId: string): Promise<RiskOverrideDto[]> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<RiskOverrideDto[]>>(`${API}/risk-monitoring/overrides/${counterpartyId}`),
    );
    return res.success ? res.data : [];
  }

  async getPendingOverrides(): Promise<RiskOverrideDto[]> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<RiskOverrideDto[]>>(`${API}/risk-monitoring/overrides`),
    );
    return res.success ? res.data : [];
  }

  async requestOverride(counterpartyId: string, reason: string): Promise<RiskOverrideDto | null> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<RiskOverrideDto>>(`${API}/risk-monitoring/overrides`, { counterpartyId, reason }),
    );
    return res.success ? res.data : null;
  }

  async decideOverride(overrideId: string, decision: 'APPROVED' | 'REJECTED', comment?: string): Promise<RiskOverrideDto | null> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<RiskOverrideDto>>(`${API}/risk-monitoring/overrides/${overrideId}/decide`, { decision, comment }),
    );
    return res.success ? res.data : null;
  }

  async getSettings(): Promise<RiskMonitoringSettingsDto | null> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<RiskMonitoringSettingsDto>>(`${API}/risk-monitoring/settings`),
    );
    return res.success ? res.data : null;
  }

  async updateSettings(settings: Partial<RiskMonitoringSettingsDto>): Promise<RiskMonitoringSettingsDto | null> {
    const res = await firstValueFrom(
      this.http.put<ApiResponse<RiskMonitoringSettingsDto>>(`${API}/risk-monitoring/settings`, settings),
    );
    return res.success ? res.data : null;
  }
}
