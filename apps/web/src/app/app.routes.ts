import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  // ─── Public routes ──────────────────────────────────────────────
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login-page.component').then((m) => m.LoginPageComponent),
  },
  {
    path: 'login/2fa',
    loadComponent: () =>
      import('./pages/two-factor-verify/two-factor-verify-page.component').then(
        (m) => m.TwoFactorVerifyPageComponent,
      ),
  },

  // ─── Protected routes (inside main layout) ─────────────────────
  {
    path: '',
    loadComponent: () =>
      import('./layout/main-layout/main-layout.component').then(
        (m) => m.MainLayoutComponent,
      ),
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./pages/dashboard/dashboard-page.component').then(
            (m) => m.DashboardPageComponent,
          ),
      },
      {
        path: 'analytics',
        loadComponent: () =>
          import('./features/dashboard/pages/analytics/analytics-page.component').then(
            (m) => m.AnalyticsPageComponent,
          ),
        data: { title: 'Analytics' },
      },
      // ── Trading ──
      {
        path: 'trading',
        children: [
          { path: '', redirectTo: 'orders', pathMatch: 'full' },
          {
            path: 'orders',
            loadComponent: () =>
              import('./features/trading/pages/orders-list/orders-list-page.component').then(
                (m) => m.OrdersListPageComponent,
              ),
          },
          {
            path: 'orders/:id',
            loadComponent: () =>
              import('./features/trading/pages/order-detail/order-detail-page.component').then(
                (m) => m.OrderDetailPageComponent,
              ),
          },
          {
            path: 'inquiries',
            loadComponent: () =>
              import('./pages/placeholder/placeholder-page.component').then(
                (m) => m.PlaceholderPageComponent,
              ),
            data: { title: 'Inquiries' },
          },
          {
            path: 'counterparties',
            loadComponent: () =>
              import('./pages/placeholder/placeholder-page.component').then(
                (m) => m.PlaceholderPageComponent,
              ),
            data: { title: 'Counterparties' },
          },
        ],
      },
      // ── Operations ──
      {
        path: 'operations',
        loadComponent: () =>
          import('./pages/placeholder/placeholder-page.component').then(
            (m) => m.PlaceholderPageComponent,
          ),
        data: { title: 'Operations' },
      },
      // ── Credit ──
      {
        path: 'credit',
        loadComponent: () =>
          import('./pages/placeholder/placeholder-page.component').then(
            (m) => m.PlaceholderPageComponent,
          ),
        data: { title: 'Credit' },
      },
      // ── Admin ──
      {
        path: 'admin',
        children: [
          { path: '', redirectTo: 'users', pathMatch: 'full' },
          {
            path: 'users',
            loadComponent: () =>
              import('./pages/placeholder/placeholder-page.component').then(
                (m) => m.PlaceholderPageComponent,
              ),
            data: { title: 'Users' },
          },
          {
            path: 'vessels',
            loadComponent: () =>
              import('./pages/placeholder/placeholder-page.component').then(
                (m) => m.PlaceholderPageComponent,
              ),
            data: { title: 'Vessels' },
          },
          {
            path: 'places',
            loadComponent: () =>
              import('./features/admin/pages/places/places-page.component').then(
                (m) => m.PlacesPageComponent,
              ),
            data: { title: 'Places' },
          },
          {
            path: 'settings',
            loadComponent: () =>
              import('./pages/placeholder/placeholder-page.component').then(
                (m) => m.PlaceholderPageComponent,
              ),
            data: { title: 'Settings' },
          },
        ],
      },
      // ── Account ──
      {
        path: 'account/security',
        loadComponent: () =>
          import('./pages/two-factor-setup/two-factor-setup-page.component').then(
            (m) => m.TwoFactorSetupPageComponent,
          ),
        data: { title: 'Security — 2FA Setup' },
      },
    ],
  },

  // ─── Catch-all ──────────────────────────────────────────────────
  { path: '**', redirectTo: 'dashboard' },
];
