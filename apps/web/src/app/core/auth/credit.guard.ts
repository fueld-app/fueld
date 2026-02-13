import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Restrict route to ADMIN and CREDITMANAGER users. */
export const creditGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.canAccessCredit()) {
    return router.createUrlTree(['/']);
  }

  return true;
};
