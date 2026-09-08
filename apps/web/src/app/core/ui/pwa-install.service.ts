import { Service, signal, OnDestroy } from '@angular/core';

// ═══════════════════════════════════════════════════════════════════════
//  PwaInstallService — installability + connectivity signals.
//
//  - canInstall: the browser fired `beforeinstallprompt` (Chrome/Edge/Android)
//  - installed:  app runs in standalone/display-mode (or was installed)
//  - offline:    connectivity state (drives the offline banner)
//
//  iOS Safari has no beforeinstallprompt — the UI falls back to showing
//  "Add to Home Screen" instructions via the palette/menu (A2HS is manual
//  on iOS; see INSTALL_HINT in the layout).
// ═══════════════════════════════════════════════════════════════════════

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

@Service()
export class PwaInstallService implements OnDestroy {
  readonly canInstall = signal(false);
  readonly installed = signal(false);
  readonly offline = signal(false);

  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  private readonly onBeforeInstall = (e: Event) => {
    // Prevent the mini-infobar; we surface our own install affordance.
    e.preventDefault();
    this.deferredPrompt = e as BeforeInstallPromptEvent;
    this.canInstall.set(true);
  };

  private readonly onInstalled = () => {
    this.deferredPrompt = null;
    this.canInstall.set(false);
    this.installed.set(true);
  };

  private readonly onOnline = () => this.offline.set(false);
  private readonly onOffline = () => this.offline.set(true);

  constructor() {
    const w = window as Window & {
      addEventListener: typeof window.addEventListener;
      matchMedia: typeof window.matchMedia;
    };

    this.installed.set(
      window.matchMedia('(display-mode: standalone)').matches ||
        // iOS Safari
        (navigator as unknown as { standalone?: boolean }).standalone === true,
    );
    this.offline.set(!navigator.onLine);

    window.addEventListener('beforeinstallprompt', this.onBeforeInstall);
    window.addEventListener('appinstalled', this.onInstalled);
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);

    // Some browsers hide standalone mode if the manifest changes display — re-check on focus.
    try {
      window
        .matchMedia('(display-mode: standalone)')
        .addEventListener('change', (e) => this.installed.set(e.matches));
    } catch {
      // Safari < 14 — ignore
    }
  }

  /** Show the browser's native install dialog. Returns the user's choice. */
  async install(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!this.deferredPrompt) return 'unavailable';
    try {
      await this.deferredPrompt.prompt();
      const choice = await this.deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        this.canInstall.set(false);
        this.installed.set(true);
      }
      this.deferredPrompt = null;
      return choice.outcome;
    } catch {
      return 'unavailable';
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('beforeinstallprompt', this.onBeforeInstall);
    window.removeEventListener('appinstalled', this.onInstalled);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
  }
}