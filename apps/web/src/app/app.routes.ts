import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { adminGuard } from './core/auth/admin.guard';
import { creditGuard } from './core/auth/credit.guard';

export const routes: Routes = [
  // ─── Public routes ──────────────────────────────────────────────
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./pages/reset-password/reset-password-page.component').then(
        (m) => m.ResetPasswordPageComponent,
      ),
    title: 'Reset Password',
  },
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
  {
    path: 'supplier-quote/:token',
    loadComponent: () =>
      import('./features/trading/pages/public-supplier-quote/public-supplier-quote-page.component').then(
        (m) => m.PublicSupplierQuotePageComponent,
      ),
    title: 'Supplier Quote',
  },
  {
    path: 'supplier-nomination/:token',
    loadComponent: () =>
      import('./features/trading/pages/public-supplier-nomination/public-supplier-nomination-page.component').then(
        (m) => m.PublicSupplierNominationPageComponent,
      ),
    title: 'Supplier Delivery Confirmation',
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
          import('./pages/dashboard/dashboard-redirect.component').then(
            (m) => m.DashboardRedirectComponent,
          ),
        pathMatch: 'full',
        title: 'Dashboard',
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./pages/dashboard/dashboard-page.component').then(
            (m) => m.DashboardPageComponent,
          ),
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
      {
        path: 'reports',
        loadComponent: () =>
          import('./features/reports/pages/reports-page.component').then(
            (m) => m.ReportsPageComponent,
          ),
        title: 'Reports',
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
            title: 'Trading > Active Orders',
          },
          {
            path: 'orders/delivered',
            redirectTo: 'delivered-orders',
            pathMatch: 'full',
          },
          {
            path: 'orders/delivered/:id',
            redirectTo: 'delivered-orders/:id',
            pathMatch: 'full',
          },
          {
            path: 'delivered-orders',
            loadComponent: () =>
              import('./features/trading/pages/delivered-orders-list/delivered-orders-list-page.component').then(
                (m) => m.DeliveredOrdersListPageComponent,
              ),
            title: 'Trading > Delivered Orders',
          },
          {
            path: 'orders/completed',
            redirectTo: 'completed-orders',
            pathMatch: 'full',
          },
          {
            path: 'orders/completed/:id',
            redirectTo: 'completed-orders/:id',
            pathMatch: 'full',
          },
          {
            path: 'completed-orders',
            loadComponent: () =>
              import('./features/trading/pages/completed-orders-list/completed-orders-list-page.component').then(
                (m) => m.CompletedOrdersListPageComponent,
              ),
            title: 'Trading > Completed Orders',
          },
          {
            path: 'orders/cancelled',
            redirectTo: 'cancelled-orders',
            pathMatch: 'full',
          },
          {
            path: 'orders/cancelled/:id',
            redirectTo: 'cancelled-orders/:id',
            pathMatch: 'full',
          },
          {
            path: 'cancelled-orders',
            loadComponent: () =>
              import('./features/trading/pages/cancelled-orders-list/cancelled-orders-list-page.component').then(
                (m) => m.CancelledOrdersListPageComponent,
              ),
            title: 'Trading > Cancelled Orders',
          },
          {
            path: 'completed-orders/:id',
            loadComponent: () =>
              import('./features/trading/pages/order-detail/order-detail-page.component').then(
                (m) => m.OrderDetailPageComponent,
              ),
            title: 'Trading > Completed Orders',
          },
          {
            path: 'delivered-orders/:id',
            loadComponent: () =>
              import('./features/trading/pages/order-detail/order-detail-page.component').then(
                (m) => m.OrderDetailPageComponent,
              ),
            title: 'Trading > Delivered Orders',
          },
          {
            path: 'cancelled-orders/:id',
            loadComponent: () =>
              import('./features/trading/pages/order-detail/order-detail-page.component').then(
                (m) => m.OrderDetailPageComponent,
              ),
            title: 'Trading > Cancelled Orders',
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
              import('./features/trading/pages/order-detail/order-detail-page.component').then(
                (m) => m.OrderDetailPageComponent,
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
        children: [
          { path: '', redirectTo: 'board', pathMatch: 'full' as const },
          {
            path: 'board',
            loadComponent: () =>
              import('./features/operations/pages/board/operations-board-page.component').then(
                (m) => m.OperationsBoardPageComponent,
              ),
            title: 'Operations > Board',
          },
          {
            path: 'inventory',
            loadComponent: () =>
              import('./features/operations/pages/inventory/inventory-page.component').then(
                (m) => m.InventoryPageComponent,
              ),
            title: 'Operations > Inventory',
          },
        ],
      },
      // ── Credit ──
      {
        path: 'credit',
        children: [
          { path: '', redirectTo: 'applications', pathMatch: 'full' as const },
          {
            path: 'suppliers',
            canActivate: [creditGuard],
            loadComponent: () =>
              import('./features/credit/pages/supplier-credit/supplier-credit-page.component').then(
                (m) => m.SupplierCreditPageComponent,
              ),
            title: 'Credit > Suppliers',
          },
          {
            path: 'customers',
            canActivate: [creditGuard],
            loadComponent: () =>
              import('./features/credit/pages/customer-credit/customer-credit-page.component').then(
                (m) => m.CustomerCreditPageComponent,
              ),
            title: 'Credit > Customers',
          },
          {
            path: 'applications',
            loadComponent: () =>
              import('./features/credit/pages/credit-applications/credit-applications-page.component').then(
                (m) => m.CreditApplicationsPageComponent,
              ),
            title: 'Credit > Applications',
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
      // ── Resources ──
      {
        path: 'resources',
        children: [
          { path: '', redirectTo: 'platts', pathMatch: 'full' },
          {
            path: 'platts',
            loadComponent: () =>
              import('./features/resources/pages/platts-reports/platts-reports-page.component').then(
                (m) => m.PlattsReportsPageComponent,
              ),
            title: 'Resources > Platts',
          },
          {
            path: 'platts/:id',
            loadComponent: () =>
              import('./features/resources/pages/platts-report-detail/platts-report-detail-page.component').then(
                (m) => m.PlattsReportDetailPageComponent,
              ),
            title: 'Resources > Platts',
          },
        ],
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
          {
            path: 'port-documentation',
            loadComponent: () =>
              import('./features/admin/pages/port-documentation/port-documentation-page.component').then(
                (m) => m.PortDocumentationPageComponent,
              ),
            title: 'Admin > Port Documentation',
          },
          {
            path: 'llm',
            loadComponent: () =>
              import('./features/admin/pages/llm/llm-page.component').then(
                (m) => m.LlmPageComponent,
              ),
            title: 'Admin > LLM',
          },
          {
            path: 'backup',
            loadComponent: () =>
              import('./features/admin/pages/backup/backup-page.component').then(
                (m) => m.BackupPageComponent,
              ),
            title: 'Admin > Backup',
          },
          {
            path: 'email',
            loadComponent: () =>
              import('./features/admin/pages/email-settings/email-settings-page.component').then(
                (m) => m.EmailSettingsPageComponent,
              ),
            title: 'Admin > Email',
          },
          {
            path: 'credit',
            loadComponent: () =>
              import('./features/admin/pages/credit-settings/credit-settings-page.component').then(
                (m) => m.CreditSettingsPageComponent,
              ),
            title: 'Admin > Credit Settings',
          },
          {            path: 'warehouses',
            loadComponent: () =>
              import('./features/admin/pages/warehouses/warehouses-page.component').then(
                (m) => m.WarehousesAdminPageComponent,
              ),
            title: 'Admin > Warehouses',
          },
          {            path: 'vessel-sanctions',
            loadComponent: () =>
              import('./features/admin/pages/vessel-sanctions/vessel-sanctions-page.component').then(
                (m) => m.VesselSanctionsPageComponent,
              ),
            title: 'Admin > Vessel Sanctions',
          },
        ],
      },
      // ── Account ──
      {
        path: 'account/settings',
        loadComponent: () =>
          import('./pages/two-factor-setup/two-factor-setup-page.component').then(
            (m) => m.TwoFactorSetupPageComponent,
          ),
        title: 'Account > Settings',
      },
      // Redirect old path
      {
        path: 'account/security',
        redirectTo: 'account/settings',
        pathMatch: 'full',
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
