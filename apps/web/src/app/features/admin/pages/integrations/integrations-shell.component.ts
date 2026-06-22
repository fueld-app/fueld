import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Subscription } from 'rxjs';
import type { ApiResponse, IntegrationStatusDto } from '@fueld/types';

import { API } from '@app/core/config/api';
import { IntegrationsToastService } from './integrations-toast.service';

@Component({
  selector: 'app-integrations-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div>
      <!-- Header -->
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">Integrations</h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-muted">
          Manage API credentials for third-party data providers. Credentials are encrypted at rest.
        </p>
      </div>

      <!-- Tabs -->
      <nav class="mb-6 border-b border-gray-200 dark:border-line">
        <ul class="flex flex-wrap gap-1">
          @for (tab of tabs; track tab.path) {
            <li>
              <a
                [routerLink]="tab.path"
                routerLinkActive="!border-brand-500 !text-brand-600"
                class="inline-block rounded-t-lg border-b-2 border-transparent px-4 py-2 text-sm font-medium text-gray-500 dark:text-muted hover:border-gray-300 hover:text-gray-700"
              >
                {{ tab.label }}
              </a>
            </li>
          }
        </ul>
      </nav>

      <!-- Tab Content -->
      <router-outlet />

      <!-- Toast notification -->
      @if (toastService.toast()) {
        <div
          class="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-opacity"
          [class]="toastService.toast()!.type === 'success'
            ? 'border border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/15 text-green-800 dark:text-green-300'
            : 'border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 text-red-800 dark:text-red-300'"
        >
          {{ toastService.toast()!.message }}
        </div>
      }
    </div>
  `,
})
export class IntegrationsShellComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  readonly toastService = inject(IntegrationsToastService);

  readonly loading = signal(true);
  readonly integrations = signal<IntegrationStatusDto[]>([]);

  private routeSub: Subscription | null = null;

  tabs = [
    { path: 'lli', label: 'LLI' },
    { path: 'smtp', label: 'SMTP' },
    { path: 'microsoft', label: 'Microsoft 365' },
    { path: 'push', label: 'Web Push' },
    { path: 'quickbooks', label: 'QuickBooks' },
    { path: 'whatsapp', label: 'WhatsApp' },
  ] as const;

  ngOnInit(): void {
    this.routeSub = this.route.queryParams.subscribe((params) => {
      if (params['qb'] === 'connected') {
        this.toastService.show('success', 'QuickBooks Online connected successfully!');
      } else if (params['qb'] === 'error') {
        const reason = params['reason'] ?? 'unknown';
        this.toastService.show('error', `QuickBooks connection failed: ${reason}. Please try again.`);
      }
    });

    this.loadIntegrations();
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
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
}
