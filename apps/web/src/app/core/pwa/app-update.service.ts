import { Injectable, signal, effect, inject, isDevMode } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { WebSocketService } from '../websocket/websocket.service';

@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly wsService = inject(WebSocketService);

  readonly updateAvailable = signal(false);

  private initialized = false;
  private wasConnected = false;

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
        this.updateAvailable.set(true);
      }
    });

    // Check once on load.
    this.checkForUpdate();

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
