import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { adminGuard } from './core/auth/admin.guard';

export const routes: Routes = [
  // ─── Public routes ──────────────────────────────────────────────
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login-page.component').then((m) => m.LoginPageComponent),
    title: 'Login',
  },
  {
    path: 'login/2fa',
    loadComponent: () =>
      import('./pages/two-factor-verify/two-factor-verify-page.component').then(
        (m) => m.TwoFactorVerifyPageComponent,
      ),
    title: 'Two-Factor Verification',
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
      {
        path: '',
        loadComponent: () =>
          import('./pages/dashboard/dashboard-page.component').then(
            (m) => m.DashboardPageComponent,
          ),
        pathMatch: 'full',
        title: 'Dashboard',
      },
      {
        path: 'analytics',
        loadComponent: () =>
          import('./features/dashboard/pages/analytics/analytics-page.component').then(
            (m) => m.AnalyticsPageComponent,
          ),
        title: 'Analytics',
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
            title: 'Trading > Orders',
          },
          {
            path: 'orders/:id',
            loadComponent: () =>
              import('./features/trading/pages/order-detail/order-detail-page.component').then(
                (m) => m.OrderDetailPageComponent,
              ),
            title: 'Trading > Orders',
          },
          {
            path: 'inquiries',
            loadComponent: () =>
              import('./features/trading/pages/inquiries-list/inquiries-list-page.component').then(
                (m) => m.InquiriesListPageComponent,
              ),
            title: 'Trading > Inquiries',
          },
          {
            path: 'inquiries/:id',
            loadComponent: () =>
              import('./features/trading/pages/inquiry-detail/inquiry-detail-page.component').then(
                (m) => m.InquiryDetailPageComponent,
              ),
            title: 'Trading > Inquiries',
          },
          {
            path: 'counterparties',
            loadComponent: () =>
              import('./pages/placeholder/placeholder-page.component').then(
                (m) => m.PlaceholderPageComponent,
              ),
            title: 'Trading > Counterparties',
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
        title: 'Operations',
      },
      // ── Credit ──
      {
        path: 'credit',
        children: [
          { path: '', redirectTo: 'suppliers', pathMatch: 'full' as const },
          {
            path: 'suppliers',
            loadComponent: () =>
              import('./features/credit/pages/supplier-credit/supplier-credit-page.component').then(
                (m) => m.SupplierCreditPageComponent,
              ),
            title: 'Credit > Suppliers',
          },
          {
            path: 'customers',
            loadComponent: () =>
              import('./features/credit/pages/customer-credit/customer-credit-page.component').then(
                (m) => m.CustomerCreditPageComponent,
              ),
            title: 'Credit > Customers',
          },
        ],
      },
      // ── Companies ──
      {
        path: 'companies',
        loadComponent: () =>
          import('./features/companies/pages/companies/companies-page.component').then(
            (m) => m.CompaniesPageComponent,
          ),
        title: 'Companies',
      },
      {
        path: 'companies/:id',
        loadComponent: () =>
          import('./features/companies/pages/company-detail/company-detail-page.component').then(
            (m) => m.CompanyDetailPageComponent,
          ),
        title: 'Companies',
      },
      // ── Places ──
      {
        path: 'places',
        loadComponent: () =>
          import('./features/admin/pages/places/places-page.component').then(
            (m) => m.PlacesPageComponent,
          ),
        title: 'Places',
      },
      {
        path: 'places/:id',
        loadComponent: () =>
          import('./features/admin/pages/place-detail/place-detail-page.component').then(
            (m) => m.PlaceDetailPageComponent,
          ),
        title: 'Places',
      },
      // ── Vessels ──
      {
        path: 'vessels',
        loadComponent: () =>
          import('./features/vessels/pages/vessels/vessels-page.component').then(
            (m) => m.VesselsPageComponent,
          ),
        title: 'Vessels',
      },
      {
        path: 'vessels/:id',
        loadComponent: () =>
          import('./features/vessels/pages/vessel-detail/vessel-detail-page.component').then(
            (m) => m.VesselDetailPageComponent,
          ),
        title: 'Vessels',
      },
      // ── Admin ──
      {
        path: 'admin',
        canActivate: [adminGuard],
        children: [
          { path: '', redirectTo: 'users', pathMatch: 'full' },
          {
            path: 'users',
            loadComponent: () =>
              import('./features/admin/pages/users/users-page.component').then(
                (m) => m.UsersPageComponent,
              ),
            title: 'Admin > Users',
          },
          {
            path: 'our-companies',
            loadComponent: () =>
              import('./features/admin/pages/our-companies/our-companies-page.component').then(
                (m) => m.OurCompaniesPageComponent,
              ),
            title: 'Admin > Our Companies',
          },
          {
            path: 'teams',
            loadComponent: () =>
              import('./features/admin/pages/teams/teams-page.component').then(
                (m) => m.TeamsPageComponent,
              ),
            title: 'Admin > Teams',
          },
          {
            path: 'company-groups',
            loadComponent: () =>
              import('./features/admin/pages/company-groups/company-groups-page.component').then(
                (m) => m.CompanyGroupsPageComponent,
              ),
            title: 'Admin > Company Groups',
          },
          {
            path: 'integrations',
            loadComponent: () =>
              import('./features/admin/pages/integrations/integrations-page.component').then(
                (m) => m.IntegrationsPageComponent,
              ),
            title: 'Admin > Integrations',
          },
          {
            path: 'activity',
            loadComponent: () =>
              import('./features/admin/pages/activity-log/activity-log-page.component').then(
                (m) => m.ActivityLogPageComponent,
              ),
            title: 'Admin > Activity Log',
          },
          {
            path: 'security',
            loadComponent: () =>
              import('./features/admin/pages/security/security-page.component').then(
                (m) => m.SecurityPageComponent,
              ),
            title: 'Admin > Security',
          },
          {
            path: 'settings',
            loadComponent: () =>
              import('./features/admin/pages/settings/settings-page.component').then(
                (m) => m.SettingsPageComponent,
              ),
            title: 'Admin > Settings',
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
        title: 'Account > Security',
      },
    ],
  },

  // ─── Invite signup (public) ──────────────────────────────────────
  {
    path: 'invite/:token',
    loadComponent: () =>
      import('./pages/invite-signup/invite-signup-page.component').then(
        (m) => m.InviteSignupPageComponent,
      ),
    title: 'Accept Invitation',
  },

  // ─── Catch-all ──────────────────────────────────────────────────
  { path: '**', redirectTo: '' },
];
