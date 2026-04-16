import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { Subject } from 'rxjs';

import { AppUpdateService } from './app-update.service';
import { WebSocketService } from '../websocket/websocket.service';
import { AuthService } from '../auth/auth.service';

describe('AppUpdateService', () => {
  let service: AppUpdateService | undefined;
  let versionUpdates$: Subject<{ type: string }>;
  let routerEvents$: Subject<NavigationEnd>;
  let checkForUpdate: ReturnType<typeof vi.fn>;
  let activateUpdate: ReturnType<typeof vi.fn>;
  let hidden = false;
  let activateUpdateAndReloadSpy: ReturnType<typeof vi.spyOn> | undefined;
  let originalNgDevMode: unknown;

  const flushPromises = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  function setup(authenticated = true): AppUpdateService {
    versionUpdates$ = new Subject();
    routerEvents$ = new Subject();
    checkForUpdate = vi.fn().mockResolvedValue(true);
    activateUpdate = vi.fn().mockResolvedValue(true);

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    });

    TestBed.configureTestingModule({
      providers: [
        AppUpdateService,
        {
          provide: SwUpdate,
          useValue: {
            isEnabled: true,
            versionUpdates: versionUpdates$.asObservable(),
            checkForUpdate,
            activateUpdate,
          },
        },
        {
          provide: Router,
          useValue: {
            events: routerEvents$.asObservable(),
          },
        },
        {
          provide: WebSocketService,
          useValue: {
            connected: signal(false),
          },
        },
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: () => authenticated,
          },
        },
      ],
    });

    service = TestBed.inject(AppUpdateService);
    activateUpdateAndReloadSpy = vi
      .spyOn(service, 'activateUpdateAndReload')
      .mockResolvedValue(true);
    service.init();
    return service;
  }

  beforeEach(() => {
    hidden = false;
    originalNgDevMode = (globalThis as { ngDevMode?: unknown }).ngDevMode;
    Object.assign(globalThis as { ngDevMode?: unknown }, { ngDevMode: false });
  });

  afterEach(() => {
    service?.ngOnDestroy();
    versionUpdates$?.complete();
    routerEvents$?.complete();
    activateUpdateAndReloadSpy?.mockRestore();
    TestBed.resetTestingModule();
    service = undefined;
    activateUpdateAndReloadSpy = undefined;

    if (originalNgDevMode === undefined) {
      delete (globalThis as { ngDevMode?: unknown }).ngDevMode;
    } else {
      Object.assign(globalThis as { ngDevMode?: unknown }, { ngDevMode: originalNgDevMode });
    }
  });

  it('activates a ready update on the next navigation for authenticated users', async () => {
    const service = setup(true);

    versionUpdates$.next({ type: 'VERSION_READY' });

    expect(service.updateAvailable()).toBe(true);
    expect(activateUpdateAndReloadSpy).not.toHaveBeenCalled();

    routerEvents$.next(new NavigationEnd(1, '/trading/orders', '/trading/orders'));
    await flushPromises();

    expect(activateUpdateAndReloadSpy).toHaveBeenCalledTimes(1);
  });

  it('activates a ready update when the tab becomes hidden for authenticated users', async () => {
    setup(true);

    versionUpdates$.next({ type: 'VERSION_READY' });

    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();

    expect(activateUpdateAndReloadSpy).toHaveBeenCalledTimes(1);
  });

  it('immediately activates a ready update for unauthenticated users', async () => {
    setup(false);

    versionUpdates$.next({ type: 'VERSION_READY' });
    await flushPromises();

    expect(activateUpdateAndReloadSpy).toHaveBeenCalledTimes(1);
  });
});