import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
  input,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, IntegrationStatusDto } from '@fueld/types';

import { API } from '@app/core/config/api';
import { IntegrationsToastService } from './integrations-toast.service';

@Component({
  selector: 'app-push-integration-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="app-panel">
      <div class="app-panel-header app-panel-header--amber">
        <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--amber">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-600 dark:text-amber-400" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 2a6 6 0 00-6 6v2.5c0 .67-.167 1.33-.486 1.92l-.91 1.67A1 1 0 004.5 16h11a1 1 0 00.896-1.41l-.91-1.67A4 4 0 0115 10.5V8a6 6 0 00-6-6zm0 16a2.5 2.5 0 002.45-2h-4.9A2.5 2.5 0 0010 18z" />
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="text-base font-semibold text-gray-900 dark:text-ink">Web Push Notifications</h3>
          <p class="text-sm text-gray-500 dark:text-muted">Configure VAPID keys to enable browser push notifications.</p>
        </div>
        <div>
          @if (status()?.configured) {
            <span class="inline-flex items-center gap-1.5 rounded-full bg-green-50 dark:bg-green-500/15 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-400 ring-1 ring-green-600/20">
              <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
              Configured
            </span>
          } @else {
            <span class="inline-flex items-center gap-1.5 rounded-full bg-gray-50 dark:bg-bg-2 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-ink-dim ring-1 ring-gray-500/10">
              <span class="h-1.5 w-1.5 rounded-full bg-gray-400"></span>
              Not Configured
            </span>
          }
        </div>
      </div>

      @if (status()?.configured) {
        <div class="border-b border-gray-100 dark:border-line bg-gray-50/50 px-6 py-3">
          <div class="flex flex-wrap items-center gap-4 text-sm">
            @if (status()!.pushPublicKey) {
              <div class="truncate">
                <span class="text-gray-500 dark:text-muted">Public key:</span>
                <span class="ml-1.5 font-medium text-gray-900 dark:text-ink">{{ status()!.pushPublicKey }}</span>
              </div>
            }
            @if (status()!.updatedAt) {
              <div>
                <span class="text-gray-500 dark:text-muted">Updated:</span>
                <span class="ml-1.5 text-gray-700 dark:text-ink-dim">{{ formatDate(status()!.updatedAt!) }}</span>
              </div>
            }
            @if (status()!.updatedBy) {
              <div>
                <span class="text-gray-500 dark:text-muted">by</span>
                <span class="ml-1 text-gray-700 dark:text-ink-dim">{{ status()!.updatedBy }}</span>
              </div>
            }
          </div>
        </div>
      }

      <div class="px-6 py-5">
        @if (pushSaveSuccess()) {
          <div class="mb-4 flex items-center gap-2 rounded-lg bg-green-50 dark:bg-green-500/15 border border-green-200 dark:border-green-500/30 p-3 text-sm text-green-700 dark:text-green-400">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
            </svg>
            {{ pushSaveSuccess() }}
          </div>
        }
        @if (pushSaveError()) {
          <div class="mb-4 flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 p-3 text-sm text-red-700 dark:text-red-400">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            {{ pushSaveError() }}
          </div>
        }

        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">VAPID Public Key</label>
            <input type="text" [ngModel]="pushPublicKey()" (ngModelChange)="pushPublicKey.set($event)"
              class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
              placeholder="BGo..." autocomplete="off" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">VAPID Private Key</label>
            <input type="password" [ngModel]="pushPrivateKey()" (ngModelChange)="pushPrivateKey.set($event)"
              class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
              [placeholder]="status()?.configured ? 'Enter new private key to update' : 'Enter VAPID private key'"
              autocomplete="new-password" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">VAPID Subject</label>
            <input type="text" [ngModel]="pushSubject()" (ngModelChange)="pushSubject.set($event)"
              class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
              placeholder="mailto:support@fueld.app" />
          </div>
        </div>

        <div class="mt-5 flex items-center gap-3">
          <button (click)="savePushCredentials()" [disabled]="pushSaving()"
            class="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-50 transition-colors">
            @if (pushSaving()) {
              <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              Saving…
            } @else {
              Save Push Settings
            }
          </button>
          <span class="text-xs text-gray-400 dark:text-muted">Keys are stored encrypted.</span>
        </div>
      </div>
    </div>
  `,
})
export class PushIntegrationCardComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toastService = inject(IntegrationsToastService);

  readonly integration = input.required<IntegrationStatusDto | undefined>();

  readonly pushPublicKey = signal('');
  readonly pushPrivateKey = signal('');
  readonly pushSubject = signal('mailto:support@fueld.app');
  readonly pushSaving = signal(false);
  readonly pushSaveSuccess = signal('');
  readonly pushSaveError = signal('');

  status(): IntegrationStatusDto | null {
    return this.integration() ?? null;
  }

  ngOnInit(): void {
    const s = this.status();
    if (s?.pushPublicKey) this.pushPublicKey.set(s.pushPublicKey);
    if (s?.pushSubject) this.pushSubject.set(s.pushSubject);
  }

  async savePushCredentials(): Promise<void> {
    const publicKey = this.pushPublicKey().trim();
    const privateKey = this.pushPrivateKey().trim();
    const subject = this.pushSubject().trim();

    if (!publicKey) { this.pushSaveError.set('VAPID public key is required.'); return; }
    if (!privateKey) { this.pushSaveError.set('VAPID private key is required.'); return; }
    if (!subject) { this.pushSaveError.set('VAPID subject is required.'); return; }

    this.pushSaving.set(true);
    this.pushSaveSuccess.set('');
    this.pushSaveError.set('');

    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ saved: boolean }>>(`${API}/admin/settings/integrations/push`, {
          publicKey,
          privateKey,
          subject,
        }),
      );

      if (res.success) {
        this.pushSaveSuccess.set('Push notification keys saved successfully.');
        this.pushPrivateKey.set('');
        this.toastService.show('success', 'Push notification keys saved successfully.');
      } else {
        this.pushSaveError.set(res.message ?? 'Failed to save push credentials.');
      }
    } catch (err: any) {
      const msg = err?.error?.message ?? err?.message ?? 'Failed to save push credentials.';
      this.pushSaveError.set(msg);
    } finally {
      this.pushSaving.set(false);
    }
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
}
