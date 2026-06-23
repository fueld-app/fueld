import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Block LIGHT users from a route (redirects to dashboard). */
export const lightGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isLight()) {
    return router.createUrlTree(['/']);
  }

  return true;
};