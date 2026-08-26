import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Restrict route to ADMIN or FINANCE users. */
export const financeGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAdmin() && !auth.isFinance()) {
    return router.createUrlTree(['/']);
  }

  return true;
};