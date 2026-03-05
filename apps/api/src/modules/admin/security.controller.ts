// ═══════════════════════════════════════════════════════════════════════
//  Security Controller — Authentication & SSO settings
// ═══════════════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { authGuard } from '../auth/auth.guard';
import { db } from '../../db';
import { tenants, type TenantSettings } from '../../db/schema';
import type { ApiResponse, SecuritySettingsDto } from '@fueld/types';

/** Read security settings from tenant (never exposes secrets). */
async function getSecuritySettings(): Promise<SecuritySettingsDto> {
  const tenant = await db.query.tenants.findFirst();
  const s = (tenant?.settings ?? {}) as TenantSettings;
  return {
    ssoProvider: s.ssoProvider ?? 'none',
    ssoClientId: s.ssoClientId ?? '',
    ssoTenantId: s.ssoTenantId ?? '',
    ssoEnabled: s.ssoEnabled ?? false,
    enforce2FA: s.enforce2FA ?? false,
    passkeyEnabled: s.passkeyEnabled ?? false,
    passkeyAllowPasswordless: s.passkeyAllowPasswordless ?? false,
    tokenExpirationMinutes: s.tokenExpirationMinutes ?? 15,
    sessionTimeoutMinutes: s.sessionTimeoutMinutes ?? 480,
    documentVerificationLinkExpiryDays: s.documentVerificationLinkExpiryDays ?? 0,
    approvedEmailDomains: s.approvedEmailDomains ?? [],
    microsoftConnectForceUserEmail: s.microsoftConnectForceUserEmail ?? false,
  };
}

/** Update security settings on tenant. */
async function updateSecuritySettings(
  patch: Partial<TenantSettings>,
): Promise<SecuritySettingsDto> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const current = (tenant.settings ?? {}) as TenantSettings;
  const merged: TenantSettings = { ...current, ...patch };

  await db
    .update(tenants)
    .set({ settings: merged as any, updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));

  // Return without secrets
  return {
    ssoProvider: merged.ssoProvider ?? 'none',
    ssoClientId: merged.ssoClientId ?? '',
    ssoTenantId: merged.ssoTenantId ?? '',
    ssoEnabled: merged.ssoEnabled ?? false,
    enforce2FA: merged.enforce2FA ?? false,
    passkeyEnabled: merged.passkeyEnabled ?? false,
    passkeyAllowPasswordless: merged.passkeyAllowPasswordless ?? false,
    tokenExpirationMinutes: merged.tokenExpirationMinutes ?? 15,
    sessionTimeoutMinutes: merged.sessionTimeoutMinutes ?? 480,
    documentVerificationLinkExpiryDays: merged.documentVerificationLinkExpiryDays ?? 0,
    approvedEmailDomains: merged.approvedEmailDomains ?? [],
    microsoftConnectForceUserEmail: merged.microsoftConnectForceUserEmail ?? false,
  };
}

export const securityController = new Elysia({ prefix: '/admin/security' })
  .use(authGuard)

  /** GET /admin/security — current security settings */
  .get(
    '/',
    async ({ auth, set }): Promise<ApiResponse<SecuritySettingsDto>> => {
      if (auth.role !== 'ADMIN') {
        set.status = 403;
        return { success: false, data: null as any, message: 'Admin access required' };
      }
      const settings = await getSecuritySettings();
      return { success: true, data: settings };
    },
  )

  /** PUT /admin/security — update security settings */
  .put(
    '/',
    async ({ auth, set, body }): Promise<ApiResponse<SecuritySettingsDto>> => {
      if (auth.role !== 'ADMIN') {
        set.status = 403;
        return { success: false, data: null as any, message: 'Admin access required' };
      }

      const patch: Partial<TenantSettings> = {};

      if (body.ssoProvider !== undefined) patch.ssoProvider = body.ssoProvider;
      if (body.ssoClientId !== undefined) patch.ssoClientId = body.ssoClientId;
      if (body.ssoClientSecret !== undefined) patch.ssoClientSecret = body.ssoClientSecret;
      if (body.ssoTenantId !== undefined) patch.ssoTenantId = body.ssoTenantId;
      if (body.ssoEnabled !== undefined) patch.ssoEnabled = body.ssoEnabled;
      if (body.enforce2FA !== undefined) patch.enforce2FA = body.enforce2FA;
      if (body.passkeyEnabled !== undefined) patch.passkeyEnabled = body.passkeyEnabled;
      if (body.passkeyAllowPasswordless !== undefined) patch.passkeyAllowPasswordless = body.passkeyAllowPasswordless;
      if (body.tokenExpirationMinutes !== undefined) {
        patch.tokenExpirationMinutes = Math.max(5, Math.min(1440, body.tokenExpirationMinutes));
      }
      if (body.sessionTimeoutMinutes !== undefined) {
        patch.sessionTimeoutMinutes = Math.max(5, Math.min(10080, body.sessionTimeoutMinutes));
      }
      if (body.documentVerificationLinkExpiryDays !== undefined) {
        patch.documentVerificationLinkExpiryDays = Math.max(0, Math.min(3650, body.documentVerificationLinkExpiryDays));
      }
      if (body.approvedEmailDomains !== undefined) {
        // Trim, lowercase, deduplicate, strip leading @
        patch.approvedEmailDomains = [...new Set(
          body.approvedEmailDomains
            .map((d: string) => d.trim().toLowerCase().replace(/^@/, ''))
            .filter((d: string) => d.length > 0),
        )];
      }
      if (body.microsoftConnectForceUserEmail !== undefined) {
        patch.microsoftConnectForceUserEmail = body.microsoftConnectForceUserEmail;
      }

      const settings = await updateSecuritySettings(patch);
      return { success: true, data: settings };
    },
    {
      body: t.Object({
        ssoProvider: t.Optional(t.Union([t.Literal('microsoft'), t.Literal('google'), t.Literal('none')])),
        ssoClientId: t.Optional(t.String()),
        ssoClientSecret: t.Optional(t.String()),
        ssoTenantId: t.Optional(t.String()),
        ssoEnabled: t.Optional(t.Boolean()),
        enforce2FA: t.Optional(t.Boolean()),
        passkeyEnabled: t.Optional(t.Boolean()),
        passkeyAllowPasswordless: t.Optional(t.Boolean()),
        tokenExpirationMinutes: t.Optional(t.Number()),
        sessionTimeoutMinutes: t.Optional(t.Number()),
        documentVerificationLinkExpiryDays: t.Optional(t.Number()),
        approvedEmailDomains: t.Optional(t.Array(t.String())),
        microsoftConnectForceUserEmail: t.Optional(t.Boolean()),
      }),
    },
  );
