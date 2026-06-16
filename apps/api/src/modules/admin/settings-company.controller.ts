// ═══════════════════════════════════════════════════════════════════════
//  Settings Company Controller — Own companies, teams, groups, users,
//  bank accounts, logos, integrations, vessel roles
//
//  All endpoints require ADMIN role unless noted otherwise.
// ═══════════════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import {
  listOwnCompanies,
  setOwnCompany,
  setCompanyPhysicalOpsEnabled,
  updateOwnCompanyTerms,
  listTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  listCompanyGroups,
  createCompanyGroup,
  updateCompanyGroup,
  deleteCompanyGroup,
  getUserCompanyAccess,
  setUserCompanyOverrides,
  listBankAccounts,
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
  setCompanyLogo,
  getDefaultLogo,
  setDefaultLogo,
} from './settings-company.service';
import {
  getVesselCompanyRoleSettings,
  updateVesselCompanyRoleSettings,
} from './settings-operations.service';
import {
  getSegmentSettings,
} from './settings-catalog.service';
import {
  getIntegrationStatus,
  setLLICredentials,
  setSmtpCredentials,
  setPushCredentials,
  setMicrosoftCredentials,
} from './integrations.service';
import {
  generateAuthUrl,
  handleOAuthCallback,
  disconnect as disconnectQuickBooks,
  setDesktopCredentials,
  isAppConfigured as isQBAppConfigured,
} from '../quickbooks/quickbooks.service';
import { updateUserTeams } from './admin.service';
import type { ApiResponse } from '@fueld/types';

function requireAdmin(auth: { role: string } | undefined) {
  if (!auth || auth.role !== 'ADMIN') {
    throw new Error('Admin access required');
  }
}

export const settingsCompanyController = new Elysia()
  .use(authGuard)

  // ─── Public: any authenticated user can fetch role options ─────────
  .get('/vessel-company-roles/options', async ({ auth }) => {
    try {
      if (!auth) throw new Error('Authentication required');
      const data = await getVesselCompanyRoleSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get vessel-company role options (any user)' },
  })

  // ─── Public: any authenticated user can fetch segment categories ───
  .get('/segment-settings/options', async ({ auth }) => {
    try {
      if (!auth) throw new Error('Authentication required');
      const data = await getSegmentSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get segment categories (any user)' },
  })

  // ═══════════════════════════════════════════════════════════════════
  //  OWN COMPANIES
  // ═══════════════════════════════════════════════════════════════════

  .get('/own-companies', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await listOwnCompanies();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'List own companies' },
  })

  .post('/own-companies', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const result = await setOwnCompany(body.companyId, true);
      return { success: true, data: result } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({ companyId: t.String() }),
    detail: { tags: ['Admin Settings'], summary: 'Mark a company as own' },
  })

  .delete('/own-companies/:id', async ({ auth, params }) => {
    try {
      requireAdmin(auth);
      const result = await setOwnCompany(params.id, false);
      return { success: true, data: result } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Admin Settings'], summary: 'Unmark a company as own' },
  })

  .put('/own-companies/:id/physical-ops', async ({ auth, params, body }) => {
    try {
      requireAdmin(auth);
      const data = await setCompanyPhysicalOpsEnabled(params.id, body.enabled);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ enabled: t.Boolean() }),
    detail: { tags: ['Admin Settings'], summary: 'Toggle physical-ops eligibility' },
  })

  .put('/own-companies/:id/terms', async ({ auth, params, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateOwnCompanyTerms(params.id, body);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      customerTerms: t.Optional(t.Nullable(t.String())),
      supplierTerms: t.Optional(t.Nullable(t.String())),
      specialCustomerTerms: t.Optional(t.Nullable(t.String())),
      vatNumber: t.Optional(t.Nullable(t.String())),
      companyRegistrationNumber: t.Optional(t.Nullable(t.String())),
      fraudPreventionText: t.Optional(t.Nullable(t.String())),
      latePaymentInterest: t.Optional(t.Nullable(t.String())),
      brandColor: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update own company terms, VAT, registration number, and fraud prevention text' },
  })

  // ═══════════════════════════════════════════════════════════════════
  //  TEAMS
  // ═══════════════════════════════════════════════════════════════════

  .get('/teams', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await listTeams();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'List teams' },
  })

  .post('/teams', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await createTeam(body);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      companyIds: t.Array(t.String()),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Create a team' },
  })

  .patch('/teams/:id', async ({ auth, params, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateTeam(params.id, body);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      name: t.Optional(t.String({ minLength: 1 })),
      companyIds: t.Optional(t.Array(t.String())),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update a team' },
  })

  .delete('/teams/:id', async ({ auth, params }) => {
    try {
      requireAdmin(auth);
      const data = await deleteTeam(params.id);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Admin Settings'], summary: 'Delete a team' },
  })

  // ═══════════════════════════════════════════════════════════════════
  //  COMPANY GROUPS
  // ═══════════════════════════════════════════════════════════════════

  .get('/company-groups', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await listCompanyGroups();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'List company groups' },
  })

  .post('/company-groups', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await createCompanyGroup(body);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      companyIds: t.Array(t.String()),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Create a company group' },
  })

  .patch('/company-groups/:id', async ({ auth, params, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateCompanyGroup(params.id, body);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      name: t.Optional(t.String({ minLength: 1 })),
      companyIds: t.Optional(t.Array(t.String())),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update a company group' },
  })

  .delete('/company-groups/:id', async ({ auth, params }) => {
    try {
      requireAdmin(auth);
      const data = await deleteCompanyGroup(params.id);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Admin Settings'], summary: 'Delete a company group' },
  })

  // ═══════════════════════════════════════════════════════════════════
  //  USER TEAM + COMPANY ACCESS
  // ═══════════════════════════════════════════════════════════════════

  .patch('/users/:id/teams', async ({ auth, params, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateUserTeams(params.id, body.teamIds);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ teamIds: t.Array(t.String()) }),
    detail: { tags: ['Admin Settings'], summary: 'Assign user to multiple teams' },
  })

  .get('/users/:id/companies', async ({ auth, params }) => {
    try {
      requireAdmin(auth);
      const data = await getUserCompanyAccess(params.id);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Admin Settings'], summary: 'Get user company access' },
  })

  .put('/users/:id/companies', async ({ auth, params, body }) => {
    try {
      requireAdmin(auth);
      const data = await setUserCompanyOverrides(params.id, body.companyIds);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ companyIds: t.Array(t.String()) }),
    detail: { tags: ['Admin Settings'], summary: 'Set user company overrides' },
  })

  // ── Accessible own companies for current user (non-admin) ────────
  .get('/my-companies', async ({ auth }) => {
    try {
      const data = await getUserCompanyAccess(auth.sub);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get own companies accessible to current user' },
  })

  // ── Integrations ────────────────────────────────────────────────
  .get('/integrations', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getIntegrationStatus();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get integration credentials status' },
  })
  .put('/integrations/lli', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      await setLLICredentials(body.username, body.password, auth.sub);
      return { success: true, data: { saved: true } } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({ username: t.String(), password: t.String() }),
    detail: { tags: ['Admin Settings'], summary: 'Set & verify LLI / Seasearcher credentials' },
  })

  .put('/integrations/smtp', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      await setSmtpCredentials(body.host, body.port, body.user, body.pass, body.from, body.secure, auth.sub);
      return { success: true, data: { saved: true } } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      host: t.String(),
      port: t.Number(),
      user: t.String(),
      pass: t.String(),
      from: t.String(),
      secure: t.Boolean(),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Set SMTP credentials for invite emails' },
  })

  .put('/integrations/push', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      await setPushCredentials(body.publicKey, body.privateKey, body.subject, auth.sub, auth.tenantId);
      return { success: true, data: { saved: true } } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      publicKey: t.String({ minLength: 1 }),
      privateKey: t.String({ minLength: 1 }),
      subject: t.String({ minLength: 1 }),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Set Web Push VAPID keys' },
  })

  .put('/integrations/microsoft', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      await setMicrosoftCredentials(body.clientId, body.clientSecret, body.tenantId, auth.sub);
      return { success: true, data: { saved: true } } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      clientId: t.String({ minLength: 1 }),
      clientSecret: t.String({ minLength: 1 }),
      tenantId: t.String({ minLength: 1 }),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Set Microsoft 365 / Entra ID OAuth credentials' },
  })

  // ═══════════════════════════════════════════════════════════════════
  //  QUICKBOOKS INTEGRATION
  // ═══════════════════════════════════════════════════════════════════

  .get('/integrations/quickbooks/app-status', async ({ auth }) => {
    try {
      requireAdmin(auth);
      return { success: true, data: { appConfigured: isQBAppConfigured() } } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Check if QuickBooks app credentials are set' },
  })

  .get('/integrations/quickbooks/auth-url', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const authUrl = generateAuthUrl(auth.sub);
      return { success: true, data: { authUrl } } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get QuickBooks Online OAuth2 authorization URL' },
  })

  .get('/integrations/quickbooks/callback', async ({ query }) => {
    const code = query['code'] as string | undefined;
    const realmId = query['realmId'] as string | undefined;
    const state = query['state'] as string | undefined;
    const error = query['error'] as string | undefined;

    if (error) {
      const frontendUrl = process.env['CORS_ORIGIN'] ?? 'http://localhost:4200';
      return new Response(null, { status: 302, headers: { Location: `${frontendUrl}/admin/integrations?qb=error&reason=${error}` } });
    }

    if (!code || !realmId || !state) {
      const frontendUrl = process.env['CORS_ORIGIN'] ?? 'http://localhost:4200';
      return new Response(null, { status: 302, headers: { Location: `${frontendUrl}/admin/integrations?qb=error&reason=missing_params` } });
    }

    const result = await handleOAuthCallback(code, realmId, state);
    return new Response(null, { status: 302, headers: { Location: result.redirectUrl } });
  }, {
    query: t.Optional(t.Object({
      code: t.Optional(t.String()),
      realmId: t.Optional(t.String()),
      state: t.Optional(t.String()),
      error: t.Optional(t.String()),
    })),
    detail: { tags: ['Admin Settings'], summary: 'QuickBooks OAuth2 callback (redirect from Intuit)' },
  })

  .put('/integrations/quickbooks/desktop', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      await setDesktopCredentials(body.companyName, body.username, body.password, auth.sub);
      return { success: true, data: { saved: true } } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      companyName: t.String({ minLength: 1 }),
      username: t.String({ minLength: 1 }),
      password: t.String({ minLength: 1 }),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Set QuickBooks Desktop Web Connector credentials' },
  })

  .delete('/integrations/quickbooks', async ({ auth }) => {
    try {
      requireAdmin(auth);
      await disconnectQuickBooks(auth.sub);
      return { success: true, data: { disconnected: true } } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Disconnect QuickBooks integration' },
  })

  // ═══════════════════════════════════════════════════════════════════
  //  BANK ACCOUNTS (per own company)
  // ═══════════════════════════════════════════════════════════════════

  .get('/companies/:companyId/bank-accounts', async ({ auth, params }) => {
    try {
      requireAdmin(auth);
      const data = await listBankAccounts(params.companyId);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ companyId: t.String() }),
    detail: { tags: ['Admin Settings'], summary: 'List bank accounts for a company' },
  })

  .post('/companies/:companyId/bank-accounts', async ({ auth, params, body }) => {
    try {
      requireAdmin(auth);
      const data = await createBankAccount(params.companyId, body);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ companyId: t.String() }),
    body: t.Object({
      label: t.String({ minLength: 1 }),
      bankName: t.String({ minLength: 1 }),
      accountName: t.Optional(t.Nullable(t.String())),
      accountNumber: t.Optional(t.Nullable(t.String())),
      iban: t.Optional(t.Nullable(t.String())),
      swiftBic: t.Optional(t.Nullable(t.String())),
      currency: t.String({ minLength: 1 }),
      branchAddress: t.Optional(t.Nullable(t.String())),
      sortCode: t.Optional(t.Nullable(t.String())),
      routingNumber: t.Optional(t.Nullable(t.String())),
      intermediaryBank: t.Optional(t.Nullable(t.String())),
      isDefault: t.Optional(t.Boolean()),
      notes: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Create bank account' },
  })

  .patch('/companies/:companyId/bank-accounts/:id', async ({ auth, params, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateBankAccount(params.id, params.companyId, body as Record<string, unknown>);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ companyId: t.String(), id: t.String() }),
    body: t.Object({
      label: t.Optional(t.String()),
      bankName: t.Optional(t.String()),
      accountName: t.Optional(t.Nullable(t.String())),
      accountNumber: t.Optional(t.Nullable(t.String())),
      iban: t.Optional(t.Nullable(t.String())),
      swiftBic: t.Optional(t.Nullable(t.String())),
      currency: t.Optional(t.String()),
      branchAddress: t.Optional(t.Nullable(t.String())),
      sortCode: t.Optional(t.Nullable(t.String())),
      routingNumber: t.Optional(t.Nullable(t.String())),
      intermediaryBank: t.Optional(t.Nullable(t.String())),
      isDefault: t.Optional(t.Boolean()),
      notes: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update bank account' },
  })

  .delete('/companies/:companyId/bank-accounts/:id', async ({ auth, params }) => {
    try {
      requireAdmin(auth);
      await deleteBankAccount(params.id, params.companyId);
      return { success: true, data: { deleted: true } } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ companyId: t.String(), id: t.String() }),
    detail: { tags: ['Admin Settings'], summary: 'Delete bank account' },
  })

  // ═══════════════════════════════════════════════════════════════════
  //  COMPANY LOGO
  // ═══════════════════════════════════════════════════════════════════

  .put('/companies/:companyId/logo', async ({ auth, params, body }) => {
    try {
      requireAdmin(auth);
      const file = body.file;
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
      if (!allowed.includes(file.type)) {
        return { success: false, data: null, message: 'Only JPEG, PNG, WebP, and SVG are allowed' } satisfies ApiResponse<null>;
      }
      if (file.size > 2 * 1024 * 1024) {
        return { success: false, data: null, message: 'Logo must be under 2 MB' } satisfies ApiResponse<null>;
      }

      const ext = file.name.split('.').pop() ?? 'png';
      const filename = `${params.companyId}.${ext}`;
      const { join } = await import('path');
      const dir = join(process.cwd(), 'uploads/logos');
      await Bun.write(join(dir, filename), file);

      const { readdirSync, unlinkSync } = await import('fs');
      try {
        for (const f of readdirSync(dir)) {
          if (f.startsWith(params.companyId + '.') && f !== filename) unlinkSync(join(dir, f));
        }
      } catch { /* dir may not exist yet */ }

      const logoUrl = `/uploads/logos/${filename}`;
      await setCompanyLogo(params.companyId, logoUrl);
      return { success: true, data: { logoUrl } } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ companyId: t.String() }),
    body: t.Object({ file: t.File() }),
    detail: { tags: ['Admin Settings'], summary: 'Upload company logo' },
  })

  .delete('/companies/:companyId/logo', async ({ auth, params }) => {
    try {
      requireAdmin(auth);
      await setCompanyLogo(params.companyId, null);
      const { join } = await import('path');
      const { readdirSync, unlinkSync } = await import('fs');
      const dir = join(process.cwd(), 'uploads/logos');
      try {
        for (const f of readdirSync(dir)) {
          if (f.startsWith(params.companyId + '.')) unlinkSync(join(dir, f));
        }
      } catch { /* ignore */ }
      return { success: true, data: { deleted: true } } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ companyId: t.String() }),
    detail: { tags: ['Admin Settings'], summary: 'Delete company logo' },
  })

  // ═══════════════════════════════════════════════════════════════════
  //  DEFAULT LOGO (tenant-wide fallback)
  // ═══════════════════════════════════════════════════════════════════

  .get('/default-logo', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const logoUrl = await getDefaultLogo();
      return { success: true, data: { logoUrl } } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get default logo' },
  })

  .put('/default-logo', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const file = body.file;
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
      if (!allowed.includes(file.type)) {
        return { success: false, data: null, message: 'Only JPEG, PNG, WebP, and SVG are allowed' } satisfies ApiResponse<null>;
      }
      if (file.size > 2 * 1024 * 1024) {
        return { success: false, data: null, message: 'Logo must be under 2 MB' } satisfies ApiResponse<null>;
      }

      const ext = file.name.split('.').pop() ?? 'png';
      const filename = `default-logo.${ext}`;
      const { join } = await import('path');
      const dir = join(process.cwd(), 'uploads/logos');
      await Bun.write(join(dir, filename), file);

      const { readdirSync, unlinkSync } = await import('fs');
      try {
        for (const f of readdirSync(dir)) {
          if (f.startsWith('default-logo.') && f !== filename) unlinkSync(join(dir, f));
        }
      } catch { /* ignore */ }

      const logoUrl = `/uploads/logos/${filename}`;
      await setDefaultLogo(logoUrl);
      return { success: true, data: { logoUrl } } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({ file: t.File() }),
    detail: { tags: ['Admin Settings'], summary: 'Upload default logo' },
  })

  .delete('/default-logo', async ({ auth }) => {
    try {
      requireAdmin(auth);
      await setDefaultLogo(null);
      const { join } = await import('path');
      const { readdirSync, unlinkSync } = await import('fs');
      const dir = join(process.cwd(), 'uploads/logos');
      try {
        for (const f of readdirSync(dir)) {
          if (f.startsWith('default-logo.')) unlinkSync(join(dir, f));
        }
      } catch { /* ignore */ }
      return { success: true, data: { deleted: true } } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Delete default logo' },
  })

  // ═════════════════════════════════════════════════════════════════
  //  VESSEL COMPANY ROLE SETTINGS
  // ═════════════════════════════════════════════════════════════════

  .get('/vessel-company-roles', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await getVesselCompanyRoleSettings();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin Settings'], summary: 'Get vessel-company role options' },
  })

  .put('/vessel-company-roles', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      const data = await updateVesselCompanyRoleSettings(body.roles);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      roles: t.Array(t.Object({
        key: t.String({ minLength: 1 }),
        label: t.String({ minLength: 1 }),
        group: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        seasearcherCode: t.Optional(t.String()),
      })),
    }),
    detail: { tags: ['Admin Settings'], summary: 'Update vessel-company role options' },
  });
