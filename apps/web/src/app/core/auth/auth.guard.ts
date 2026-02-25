import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

// ═══════════════════════════════════════════════════════════════════════
//  Auth Guard — Route protection
// ═══════════════════════════════════════════════════════════════════════

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    return router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url },
    });
  }

  // Enforce MFA setup when required (skip check on the setup page itself)
  if (authService.mfaSetupRequired() && !state.url.startsWith('/account/settings')) {
    return router.createUrlTree(['/account/settings']);
  }

  return true;
};
