import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  isDevMode,
} from '@angular/core';
import { PreloadAllModules, provideRouter, withComponentInputBinding, withPreloading, TitleStrategy } from '@angular/router';
import { provideHttpClient, withInterceptors, withFetch } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { FueldTitleStrategy } from './core/title/fueld-title-strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideHttpClient(withInterceptors([authInterceptor]), withFetch()),
    provideRouter(routes, withComponentInputBinding(), withPreloading(PreloadAllModules)),
    // Service worker disabled — causes blank-page issues after deploys when
    // the old SW serves stale cached chunks. A B2B trading platform doesn't
    // need offline support; the SW causes more problems than it solves.
    { provide: TitleStrategy, useClass: FueldTitleStrategy },
  ],
};
