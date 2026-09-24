import { Service, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_URL } from '../config/api';

export interface BrokerDealSettings {
  enabled: boolean;
  defaultCommissionRate: number;
  reportStatuses: string[];
  autoReleaseCredit: boolean;
  autoReleaseBufferDays: number;
  /**
   * When true, a broker deal's CUSTOMER credit is not enforced server-side (the
   * risk sits with the supplier leg). Mirrored here so the order page does not
   * gate on a customer line the server would never require.
   */
  skipCustomerCreditCheckOnBrokerDeals: boolean;
}

const DEFAULT_SETTINGS: BrokerDealSettings = {
  enabled: false,
  defaultCommissionRate: 0,
  reportStatuses: ['CONFIRMED', 'DELIVERED', 'INVOICED', 'PAID'],
  autoReleaseCredit: true,
  autoReleaseBufferDays: 0,
  skipCustomerCreditCheckOnBrokerDeals: false,
};

/** Shared service for tenant-configurable broker deal settings. */
@Service()
export class BrokerDealService {
  private readonly http = inject(HttpClient);

  readonly settings = signal<BrokerDealSettings>(DEFAULT_SETTINGS);
  readonly enabled = computed(() => this.settings().enabled);

  private _loaded = false;

  /** Load broker deal settings from the API (non-admin endpoint). */
  async load(): Promise<void> {
    if (this._loaded) return;
    this._loaded = true;
    try {
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; data: BrokerDealSettings }>(
          `${API_URL}/admin/settings/my-broker-deal-settings`,
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