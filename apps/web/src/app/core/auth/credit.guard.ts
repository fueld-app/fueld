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

/** Customer Credit page: ADMIN, CREDITMANAGER and FINANCE (read-only credit data + Atradius uploads). */
export const customerCreditGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.canAccessCustomerCredit()) {
    return router.createUrlTree(['/']);
  }

  return true;
};
