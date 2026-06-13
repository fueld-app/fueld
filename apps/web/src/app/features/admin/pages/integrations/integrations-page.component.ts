import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, IntegrationStatusDto } from '@fueld/types';

import { API } from '@app/core/config/api';
import { LliIntegrationCardComponent } from './lli-integration-card.component';
import { SmtpIntegrationCardComponent } from './smtp-integration-card.component';
import { MicrosoftIntegrationCardComponent } from './microsoft-integration-card.component';
import { PushIntegrationCardComponent } from './push-integration-card.component';
import { QuickBooksIntegrationCardComponent } from './quickbooks-integration-card.component';
import { WhatsAppIntegrationCardComponent } from './whatsapp-integration-card.component';

@Component({
  selector: 'app-integrations-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LliIntegrationCardComponent,
    SmtpIntegrationCardComponent,
    MicrosoftIntegrationCardComponent,
    PushIntegrationCardComponent,
    QuickBooksIntegrationCardComponent,
    WhatsAppIntegrationCardComponent,
  ],
  template: `
    <div>
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900">Integrations</h1>
        <p class="mt-1 text-sm text-gray-500">
          Manage API credentials for third-party data providers. Credentials are encrypted at rest.
        </p>
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <svg class="h-8 w-8 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else {
        <div class="grid gap-6 lg:grid-cols-2">
          <app-lli-integration-card [integration]="lliStatus()" />
          <app-smtp-integration-card [integration]="smtpStatus()" />
          <app-microsoft-integration-card [integration]="msStatus()" />
          <app-push-integration-card [integration]="pushStatus()" />
          <app-quickbooks-integration-card [integration]="qbStatus()" />
          <app-whatsapp-integration-card />
        </div>
      }
    </div>
  `,
})
export class IntegrationsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(true);
  readonly integrations = signal<IntegrationStatusDto[]>([]);

  lliStatus = () => this.integrations().find((i) => i.provider.toUpperCase() === 'LLI') ?? undefined;
  qbStatus = () => this.integrations().find((i) => i.provider.toUpperCase() === 'QUICKBOOKS') ?? undefined;
  smtpStatus = () => this.integrations().find((i) => i.provider.toUpperCase() === 'SMTP') ?? undefined;
  pushStatus = () => this.integrations().find((i) => i.provider.toUpperCase() === 'PUSH') ?? undefined;
  msStatus = () => this.integrations().find((i) => i.provider.toUpperCase() === 'MICROSOFT') ?? undefined;
  waStatus = () => this.integrations().find((i) => i.provider.toUpperCase() === 'WHATSAPP') ?? undefined;

  ngOnInit(): void {
    this.route.queryParams.subscribe((params) => {
      if (params['qb'] === 'connected') {
        // QuickBooks OAuth callback success — handled by card component
      } else if (params['qb'] === 'error') {
        // QuickBooks OAuth callback error — handled by card component
      }
    });
    this.loadIntegrations();
  }

  async loadIntegrations(): Promise<void> {
    this.loading.set(true);
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
      this.loading.set(false);
    }
  }

  /** Reload integrations after a card saves/disconnects (called by child via IntegrationsToastService). */
  reload(): void {
    this.loadIntegrations();
  }
}
