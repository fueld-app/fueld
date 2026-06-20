import { HttpInterceptorFn, HttpErrorResponse, HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';
import { Observable, throwError, from, switchMap, catchError, BehaviorSubject, filter, take } from 'rxjs';

// ═══════════════════════════════════════════════════════════════════════
//  Auth Interceptor — Cookie-based auth + CSRF header + auto-refresh
//
//  1. Cookies are sent automatically by the browser (no token to add)
//  2. For state-changing requests (POST/PUT/PATCH/DELETE), adds X-CSRF-Token
//     header read from the fueld_csrf cookie (readable by JS, set by server).
//     This includes /auth/refresh, which is "public" from a 401-retry
//     standpoint but still requires a CSRF token under cookie auth.
//  3. If a 401 is returned on a non-public request, transparently refreshes
//     the token and retries. Public endpoints skip 401-retry to avoid loops
//     (e.g. a 401 on /auth/refresh must not trigger another /auth/refresh).
//  4. Queues concurrent requests while a refresh is in-flight
// ═══════════════════════════════════════════════════════════════════════

/** Read the CSRF token from the cookie (set by server, readable by JS). */
function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)fueld_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Only add CSRF token for state-changing methods. */
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Public auth endpoints. These never trigger the 401-refresh retry (a 401 on
 * /auth/refresh must not recursively call /auth/refresh). They still receive a
 * CSRF header when a CSRF cookie is present (notably /auth/refresh).
 */
const PUBLIC_ENDPOINTS = [
  '/auth/refresh',
  '/auth/login',
  '/auth/register',
  '/auth/sso-config',
  '/auth/microsoft/login',
  '/auth/microsoft/callback',
  '/auth/microsoft/exchange',
];

let isRefreshing = false;
const refreshSubject = new BehaviorSubject<string | null>(null);

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const isPublic = PUBLIC_ENDPOINTS.some((ep) => req.url.includes(ep));

  // Add CSRF token for state-changing requests whenever a CSRF cookie is
  // available. Login/register/exchange have no CSRF cookie yet, so none is
  // added for them; /auth/refresh does, and the server validates it.
  let authReq = req;
  if (STATE_CHANGING_METHODS.has(req.method.toUpperCase())) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      authReq = req.clone({
        setHeaders: { 'X-CSRF-Token': csrfToken },
      });
    }
  }

  return next(authReq).pipe(
    catchError((error) => {
      // Only auto-refresh on 401 for non-public requests when the user is
      // actually authenticated. An unauthenticated 401 (e.g. a global fetch
      // that hits an admin endpoint on a public page like /invite/:token) must
      // NOT trigger a refresh+logout, which would hijack the page to /login.
      if (error instanceof HttpErrorResponse && error.status === 401 && !isPublic && authService.isAuthenticated()) {
        return handle401(authService, authReq, next);
      }
      if (error instanceof HttpErrorResponse && error.status === 403) {
        const message = typeof error.error?.message === 'string' ? error.error.message : '';
        if (message.includes('MFA setup required')) {
          authService.markMfaSetupRequired();
        }
      }
      return throwError(() => error);
    }),
  );
};

function handle401(
  authService: AuthService,
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<any> {
  if (!isRefreshing) {
    // First 401 → start refreshing
    isRefreshing = true;
    refreshSubject.next(null);

    return from(authService.refreshToken()).pipe(
      switchMap((success) => {
        isRefreshing = false;
        if (success) {
          refreshSubject.next('done');
          // Re-read CSRF token (server sets a new one on refresh)
          const csrfToken = getCsrfToken();
          const retryReq = csrfToken && STATE_CHANGING_METHODS.has(req.method.toUpperCase())
            ? req.clone({ setHeaders: { 'X-CSRF-Token': csrfToken } })
            : req;
          return next(retryReq);
        }
        // Refresh failed → AuthService already called logout()
        refreshSubject.next('done');
        return throwError(() => new HttpErrorResponse({ status: 401 }));
      }),
      catchError((err) => {
        isRefreshing = false;
        refreshSubject.next('done');
        return throwError(() => err);
      }),
    );
  }

  // Another request hit 401 while refresh is already in-flight → wait
  return refreshSubject.pipe(
    filter((v) => v !== null),
    take(1),
    switchMap(() => {
      if (!authService.isAuthenticated()) {
        return throwError(() => new HttpErrorResponse({ status: 401 }));
      }
      const csrfToken = getCsrfToken();
      const retryReq = csrfToken && STATE_CHANGING_METHODS.has(req.method.toUpperCase())
        ? req.clone({ setHeaders: { 'X-CSRF-Token': csrfToken } })
        : req;
      return next(retryReq);
    }),
  );
}