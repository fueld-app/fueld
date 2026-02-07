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
    return router.createUrlTree(['/login']);
  }

  // Enforce mandatory 2FA — redirect to setup if not enabled
  // (skip check if already navigating to the security page)
  const user = authService.user();
  if (user && !user.is2faEnabled && !state.url.startsWith('/account/security')) {
    return router.createUrlTree(['/account/security']);
  }

  return true;
};
