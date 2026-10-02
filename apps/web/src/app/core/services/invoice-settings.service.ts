import { Service, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_URL } from '../config/api';

export interface InvoiceSettings {
  /** Invoice numbers are derived from the order number (INVOICE-<order>). */
  numberFromOrder: boolean;
  /** The Reports → Invoices register is available. */
  register: boolean;
}

const DEFAULT_SETTINGS: InvoiceSettings = {
  numberFromOrder: false,
  register: false,
};

/**
 * Shared service for the tenant's invoice settings.
 *
 * Both flags are opt-in, so the defaults are `false` and a failed load is
 * deliberately silent: a feature that is off must stay off, and an error banner
 * for "the register is not enabled" would be noise on every page load.
 */
@Service()
export class InvoiceSettingsService {
  private readonly http = inject(HttpClient);

  readonly settings = signal<InvoiceSettings>(DEFAULT_SETTINGS);
  readonly register = computed(() => this.settings().register);
  readonly numberFromOrder = computed(() => this.settings().numberFromOrder);

  private _loaded = false;

  async load(): Promise<void> {
    if (this._loaded) return;
    this._loaded = true;
    try {
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; data: InvoiceSettings }>(
          `${API_URL}/admin/settings/my-invoice-settings`,
        ),
      );
      if (res.success && res.data) this.settings.set(res.data);
    } catch {
      // Keep the off defaults.
    }
  }

  /** Invalidate so the next `load()` refetches after an admin changes a flag. */
  invalidateCache(): void {
    this._loaded = false;
  }
}
