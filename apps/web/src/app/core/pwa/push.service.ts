import { Injectable, signal, effect, inject, isDevMode } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import type { ApiResponse } from '@fueld/types';
import { API_URL } from '@app/core/config/api';

interface PushPublicKeyResponse {
  publicKey: string;
}

interface PushSubscriptionPayload {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly http = inject(HttpClient);
  private readonly swPush = inject(SwPush);
  private readonly auth = inject(AuthService);

  readonly supported = signal(false);
  readonly permission = signal<NotificationPermission>('default');

  private initialized = false;

  private readonly authEffect = effect(() => {
    if (!this.initialized) return;
    const authed = this.auth.isAuthenticated();
    if (authed && this.permission() === 'granted') {
      void this.ensureSubscribed();
    }
  });

  init(): void {
    if (this.initialized || isDevMode()) return;
    this.initialized = true;

    const supported =
      typeof window !== 'undefined' &&
      'Notification' in window &&
      'serviceWorker' in navigator &&
      'PushManager' in window;

    this.supported.set(supported && this.swPush.isEnabled);
    this.permission.set(typeof Notification === 'undefined' ? 'default' : Notification.permission);

  }

  async requestPermissionAndSubscribe(): Promise<void> {
    if (!this.supported()) return;
    try {
      const result = await Notification.requestPermission();
      this.permission.set(result);
      if (result === 'granted') {
        await this.ensureSubscribed();
      }
    } catch (err) {
      console.warn('[PWA] Notification permission failed:', err);
    }
  }

  async unsubscribe(): Promise<void> {
    if (!this.supported()) return;
    const sub = await firstValueFrom(this.swPush.subscription);
    if (sub) {
      const json = sub.toJSON() as PushSubscriptionPayload;
      await firstValueFrom(this.http.post<ApiResponse<null>>(`${API_URL}/push/unsubscribe`, {
        endpoint: json.endpoint,
      }));
      await sub.unsubscribe();
    }
  }

  private async ensureSubscribed(): Promise<void> {
    if (!this.supported() || !this.auth.isAuthenticated()) return;
    const existing = await firstValueFrom(this.swPush.subscription);
    if (existing) {
      await this.sendSubscription(existing);
      return;
    }

    const publicKey = await this.fetchPublicKey();
    if (!publicKey) return;

    const sub = await this.swPush.requestSubscription({ serverPublicKey: publicKey });
    await this.sendSubscription(sub);
  }

  private async fetchPublicKey(): Promise<string | null> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<PushPublicKeyResponse>>(`${API_URL}/push/public-key`),
      );
      return res.success ? res.data.publicKey : null;
    } catch {
      return null;
    }
  }

  private async sendSubscription(sub: PushSubscription): Promise<void> {
    const json = sub.toJSON() as PushSubscriptionPayload;
    await firstValueFrom(
      this.http.post<ApiResponse<null>>(`${API_URL}/push/subscribe`, json),
    );
  }
}
