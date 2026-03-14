import { Injectable, signal, effect, inject, isDevMode, OnDestroy } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { Router, NavigationEnd } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { WebSocketService } from '../websocket/websocket.service';
import { AuthService } from '../auth/auth.service';

const CHECK_INTERVAL_MS = 60_000; // 1 minute

@Injectable({ providedIn: 'root' })
export class AppUpdateService implements OnDestroy {
  private readonly swUpdate = inject(SwUpdate);
  private readonly wsService = inject(WebSocketService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly updateAvailable = signal(false);

  private initialized = false;
  private wasConnected = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private routerSub: Subscription | null = null;

  private readonly wsReconnectEffect = effect(() => {
    if (!this.initialized) return;
    const connected = this.wsService.connected();
    if (connected && !this.wasConnected) {
      this.checkForUpdate();
    }
    this.wasConnected = connected;
  });

  init(): void {
    if (this.initialized || isDevMode() || !this.swUpdate.isEnabled) return;
    this.initialized = true;

    this.swUpdate.versionUpdates.subscribe((evt) => {
      if (evt.type === 'VERSION_READY') {
        // Auto-reload when not logged in (e.g. login page) — no need to prompt
        if (!this.auth.isAuthenticated()) {
          void this.activateUpdateAndReload();
          return;
        }
        this.updateAvailable.set(true);
      }
    });

    // Check on every route navigation
    this.routerSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.checkForUpdate());

    // Periodic check every 60s
    this.intervalId = setInterval(() => this.checkForUpdate(), CHECK_INTERVAL_MS);

    // Check once on load
    this.checkForUpdate();
  }

  ngOnDestroy(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.routerSub?.unsubscribe();
  }

  async checkForUpdate(): Promise<void> {
    if (isDevMode() || !this.swUpdate.isEnabled) return;
    try {
      await this.swUpdate.checkForUpdate();
    } catch (err) {
      console.warn('[PWA] Update check failed:', err);
    }
  }

  async activateUpdateAndReload(): Promise<void> {
    if (isDevMode() || !this.swUpdate.isEnabled) return;
    try {
      await this.swUpdate.activateUpdate();
      window.location.reload();
    } catch (err) {
      console.warn('[PWA] Update activate failed:', err);
    }
  }
}
