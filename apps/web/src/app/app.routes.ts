import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { adminGuard } from './core/auth/admin.guard';
import { creditGuard } from './core/auth/credit.guard';
import { lightGuard } from './core/auth/light.guard';

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
        canActivate: [lightGuard],
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
            path: 'orders/invoiced',
            redirectTo: 'invoiced-orders',
            pathMatch: 'full',
          },
          {
            path: 'orders/invoiced/:id',
            redirectTo: 'invoiced-orders/:id',
            pathMatch: 'full',
          },
          {
            path: 'invoiced-orders',
            loadComponent: () =>
              import('./features/trading/pages/invoiced-orders-list/invoiced-orders-list-page.component').then(
                (m) => m.InvoicedOrdersListPageComponent,
              ),
            title: 'Trading > Invoiced Orders',
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
            canActivate: [lightGuard],
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
            path: 'lost-inquiries',
            loadComponent: () =>
              import('./features/trading/pages/lost-inquiries-list/lost-inquiries-list-page.component').then(
                (m) => m.LostInquiriesListPageComponent,
              ),
            title: 'Trading > Lost Inquiries',
          },
          {
            path: 'lost-inquiries/:id',
            loadComponent: () =>
              import('./features/trading/pages/order-detail/order-detail-page.component').then(
                (m) => m.OrderDetailPageComponent,
              ),
            title: 'Trading > Lost Inquiries',
          },
          {
            path: 'completed-orders/:id',
            canActivate: [lightGuard],
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
            path: 'invoiced-orders/:id',
            loadComponent: () =>
              import('./features/trading/pages/order-detail/order-detail-page.component').then(
                (m) => m.OrderDetailPageComponent,
              ),
            title: 'Trading > Invoiced Orders',
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
        canActivate: [lightGuard],
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
        children: [
          { path: '', redirectTo: 'overview', pathMatch: 'full' },
          {
            path: 'overview',
            loadComponent: () =>
              import('./features/companies/pages/company-detail/tabs/overview-tab.component').then(
                (m) => m.OverviewTabComponent,
              ),
            title: 'Overview',
          },
          {
            path: 'commercial',
            loadComponent: () =>
              import('./features/companies/pages/company-detail/tabs/commercial-tab.component').then(
                (m) => m.CommercialTabComponent,
              ),
            title: 'Commercial',
          },
          {
            path: 'fleet',
            loadComponent: () =>
              import('./features/companies/pages/company-detail/tabs/fleet-tab.component').then(
                (m) => m.FleetTabComponent,
              ),
            title: 'Fleet',
          },
          {
            path: 'group',
            loadComponent: () =>
              import('./features/companies/pages/company-detail/tabs/group-tab.component').then(
                (m) => m.GroupTabComponent,
              ),
            title: 'Group',
          },
          {
            path: 'risk',
            loadComponent: () =>
              import('./features/companies/pages/company-detail/tabs/risk-tab.component').then(
                (m) => m.RiskTabComponent,
              ),
            title: 'Risk',
          },
        ],
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
        children: [
          { path: '', redirectTo: 'overview', pathMatch: 'full' },
          {
            path: 'overview',
            loadComponent: () =>
              import('./features/admin/pages/place-detail/tabs/overview-tab/overview-tab.component').then(
                (m) => m.PlaceOverviewTabComponent,
              ),
            title: 'Places > Overview',
          },
          {
            path: 'traffic',
            loadComponent: () =>
              import('./features/admin/pages/place-detail/tabs/traffic-tab/traffic-tab.component').then(
                (m) => m.PlaceTrafficTabComponent,
              ),
            title: 'Places > Traffic',
          },
          {
            path: 'structure',
            loadComponent: () =>
              import('./features/admin/pages/place-detail/tabs/structure-tab/structure-tab.component').then(
                (m) => m.PlaceStructureTabComponent,
              ),
            title: 'Places > Structure',
          },
          {
            path: 'commercial',
            loadComponent: () =>
              import('./features/admin/pages/place-detail/tabs/commercial-tab/commercial-tab.component').then(
                (m) => m.PlaceCommercialTabComponent,
              ),
            title: 'Places > Commercial',
          },
        ],
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
              import('./features/admin/pages/integrations/integrations-shell.component').then(
                (m) => m.IntegrationsShellComponent,
              ),
            title: 'Admin > Integrations',
            children: [
              { path: '', redirectTo: 'lli', pathMatch: 'full' },
              {
                path: 'lli',
                loadComponent: () =>
                  import('./features/admin/pages/integrations/lli-integration-card.component').then(
                    (m) => m.LliIntegrationCardComponent,
                  ),
                title: 'Admin > Integrations > LLI',
              },
              {
                path: 'smtp',
                loadComponent: () =>
                  import('./features/admin/pages/integrations/smtp-integration-card.component').then(
                    (m) => m.SmtpIntegrationCardComponent,
                  ),
                title: 'Admin > Integrations > SMTP',
              },
              {
                path: 'microsoft',
                loadComponent: () =>
                  import('./features/admin/pages/integrations/microsoft-integration-card.component').then(
                    (m) => m.MicrosoftIntegrationCardComponent,
                  ),
                title: 'Admin > Integrations > Microsoft 365',
              },
              {
                path: 'push',
                loadComponent: () =>
                  import('./features/admin/pages/integrations/push-integration-card.component').then(
                    (m) => m.PushIntegrationCardComponent,
                  ),
                title: 'Admin > Integrations > Web Push',
              },
              {
                path: 'quickbooks',
                loadComponent: () =>
                  import('./features/admin/pages/integrations/quickbooks-integration-card.component').then(
                    (m) => m.QuickBooksIntegrationCardComponent,
                  ),
                title: 'Admin > Integrations > QuickBooks',
              },
              {
                path: 'whatsapp',
                loadComponent: () =>
                  import('./features/admin/pages/integrations/whatsapp-integration-card.component').then(
                    (m) => m.WhatsAppIntegrationCardComponent,
                  ),
                title: 'Admin > Integrations > WhatsApp',
              },
            ],
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
              import('./features/admin/pages/settings/settings-shell.component').then(
                (m) => m.SettingsShellComponent,
              ),
            title: 'Admin > Settings',
            children: [
              { path: '', redirectTo: 'general', pathMatch: 'full' },
              {
                path: 'general',
                loadComponent: () =>
                  import('./features/admin/pages/settings/general-settings-page.component').then(
                    (m) => m.GeneralSettingsPageComponent,
                  ),
                title: 'Admin > Settings > General',
              },
              {
                path: 'products',
                loadComponent: () =>
                  import('./features/admin/pages/settings/products-settings-page.component').then(
                    (m) => m.ProductsSettingsPageComponent,
                  ),
                title: 'Admin > Settings > Products',
              },
              {
                path: 'units-pricing',
                loadComponent: () =>
                  import('./features/admin/pages/settings/units-pricing-settings-page.component').then(
                    (m) => m.UnitsPricingSettingsPageComponent,
                  ),
                title: 'Admin > Settings > Units & Pricing',
              },
              {
                path: 'companies',
                loadComponent: () =>
                  import('./features/admin/pages/settings/companies-settings-page.component').then(
                    (m) => m.CompaniesSettingsPageComponent,
                  ),
                title: 'Admin > Settings > Companies',
              },
              {
                path: 'documents',
                loadComponent: () =>
                  import('./features/admin/pages/settings/documents-settings-page.component').then(
                    (m) => m.DocumentsSettingsPageComponent,
                  ),
                title: 'Admin > Settings > Documents',
              },
            ],
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
