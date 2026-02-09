import { HttpInterceptorFn, HttpErrorResponse, HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';
import { Observable, throwError, from, switchMap, catchError, BehaviorSubject, filter, take } from 'rxjs';

// ═══════════════════════════════════════════════════════════════════════
//  Auth Interceptor — Attaches JWT + auto-refreshes on 401
//
//  1. Attaches the current access token to every outgoing request
//  2. If a 401 is returned, transparently refreshes the token and retries
//  3. Queues concurrent requests while a refresh is in-flight so the
//     refresh endpoint is only called once
// ═══════════════════════════════════════════════════════════════════════

let isRefreshing = false;
const refreshSubject = new BehaviorSubject<string | null>(null);

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);

  // Don't attach auth to the refresh endpoint itself (avoids loops)
  if (req.url.includes('/auth/refresh') || req.url.includes('/auth/login') || req.url.includes('/auth/register')) {
    return next(req);
  }

  const token = authService.getAccessToken();
  const authReq = token ? addToken(req, token) : req;

  return next(authReq).pipe(
    catchError((error) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && token) {
        return handle401(authService, req, next);
      }
      return throwError(() => error);
    }),
  );
};

function addToken(req: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
  return req.clone({
    setHeaders: { Authorization: `Bearer ${token}` },
  });
}

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
          const newToken = authService.getAccessToken()!;
          refreshSubject.next(newToken);
          return next(addToken(req, newToken));
        }
        // Refresh failed → user will be logged out by AuthService
        return throwError(() => new HttpErrorResponse({ status: 401 }));
      }),
      catchError((err) => {
        isRefreshing = false;
        refreshSubject.next(null);
        return throwError(() => err);
      }),
    );
  }

  // Another request hit 401 while refresh is already in-flight → wait
  return refreshSubject.pipe(
    filter((token) => token !== null),
    take(1),
    switchMap((token) => next(addToken(req, token!))),
  );
}
