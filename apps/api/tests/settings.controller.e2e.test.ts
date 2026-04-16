import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { counterparties, users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson, requestRaw } from './helpers/e2e';

describe('settings controller e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('allows authenticated user on public settings endpoints and rejects admin-only routes', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const myProducts = await requestJson('/admin/settings/my-products', { token });
    expect(myProducts.status).toBe(200);
    expect(myProducts.data?.success).toBe(true);

    const roleOptions = await requestJson('/admin/settings/vessel-company-roles/options', { token });
    expect(roleOptions.status).toBe(200);
    expect(roleOptions.data?.success).toBe(true);

    const teams = await requestJson('/admin/settings/teams', { token });
    expect(teams.status).toBe(200);
    expect(teams.data?.success).toBe(false);
    expect(String(teams.data?.message ?? '')).toContain('Admin access required');

    const integrations = await requestJson('/admin/settings/integrations', { token });
    expect(integrations.status).toBe(200);
    expect(integrations.data?.success).toBe(false);
    expect(String(integrations.data?.message ?? '')).toContain('Admin access required');
  });

  it('supports core admin settings CRUD/update flows', async () => {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const [companyB] = await db
      .insert(counterparties)
      .values({
        tenantId: seeded.tenant.id,
        name: 'Company B E2E',
        type: 'CLIENT',
        types: ['CLIENT'],
      })
      .returning();

    expect(companyB?.id).toBeTruthy();

    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const ownA = await requestJson('/admin/settings/own-companies', {
      method: 'POST',
      token,
      body: { companyId: seeded.client.id },
    });
    expect(ownA.status).toBe(200);
    expect(ownA.data?.success).toBe(true);

    const ownB = await requestJson('/admin/settings/own-companies', {
      method: 'POST',
      token,
      body: { companyId: companyB!.id },
    });
    expect(ownB.status).toBe(200);
    expect(ownB.data?.success).toBe(true);

    const ownList = await requestJson('/admin/settings/own-companies', { token });
    expect(ownList.status).toBe(200);
    expect(ownList.data?.success).toBe(true);
    const ownIds = (ownList.data?.data ?? []).map((c: { id: string }) => c.id);
    expect(ownIds).toContain(seeded.client.id);
    expect(ownIds).toContain(companyB!.id);

    const createdTeam = await requestJson('/admin/settings/teams', {
      method: 'POST',
      token,
      body: { name: 'Ops E2E', companyIds: [seeded.client.id] },
    });
    expect(createdTeam.status).toBe(200);
    expect(createdTeam.data?.success).toBe(true);
    const teamId = createdTeam.data?.data?.id as string;
    expect(teamId).toBeTruthy();

    const patchedTeam = await requestJson(`/admin/settings/teams/${teamId}`, {
      method: 'PATCH',
      token,
      body: { name: 'Ops E2E 2', companyIds: [companyB!.id] },
    });
    expect(patchedTeam.status).toBe(200);
    expect(patchedTeam.data?.success).toBe(true);

    const teams = await requestJson('/admin/settings/teams', { token });
    expect(teams.status).toBe(200);
    expect(teams.data?.success).toBe(true);

    const createdGroup = await requestJson('/admin/settings/company-groups', {
      method: 'POST',
      token,
      body: { name: 'Group E2E', companyIds: [seeded.client.id] },
    });
    expect(createdGroup.status).toBe(200);
    expect(createdGroup.data?.success).toBe(true);
    const groupId = createdGroup.data?.data?.id as string;
    expect(groupId).toBeTruthy();

    const patchedGroup = await requestJson(`/admin/settings/company-groups/${groupId}`, {
      method: 'PATCH',
      token,
      body: { name: 'Group E2E 2', companyIds: [companyB!.id] },
    });
    expect(patchedGroup.status).toBe(200);
    expect(patchedGroup.data?.success).toBe(true);

    const orderNumberBefore = await requestJson('/admin/settings/order-number', { token });
    expect(orderNumberBefore.status).toBe(200);
    if (orderNumberBefore.data?.success) {
      expect(typeof orderNumberBefore.data?.data?.template).toBe('string');
      expect(typeof orderNumberBefore.data?.data?.nextSeq).toBe('number');
    } else {
      expect(String(orderNumberBefore.data?.message ?? '')).toMatch(/order_number_sequences|does not exist/i);
    }

    const orderNumberUpdate = await requestJson('/admin/settings/order-number', {
      method: 'PUT',
      token,
      body: { template: '{PREFIX}-{SEQ:4}', prefix: 'E2E' },
    });
    expect(orderNumberUpdate.status).toBe(200);
    if (orderNumberUpdate.data?.success) {
      expect(String(orderNumberUpdate.data?.data?.prefix ?? '')).toBe('E2E');
    } else {
      expect(String(orderNumberUpdate.data?.message ?? '')).toMatch(/order_number_sequences|does not exist/i);
    }

    const products = await requestJson('/admin/settings/products', {
      method: 'PUT',
      token,
      body: { products: ['MGO', 'VLSFO'] },
    });
    expect(products.status).toBe(200);
    expect(products.data?.success).toBe(true);

    const units = await requestJson('/admin/settings/units', {
      method: 'PUT',
      token,
      body: { units: ['MT', 'BBL'] },
    });
    expect(units.status).toBe(200);
    expect(units.data?.success).toBe(true);

    const currencies = await requestJson('/admin/settings/currencies', {
      method: 'PUT',
      token,
      body: { currencies: ['USD', 'EUR'] },
    });
    expect(currencies.status).toBe(200);
    expect(currencies.data?.success).toBe(true);

    const companyTypes = await requestJson('/admin/settings/company-types', {
      method: 'PUT',
      token,
      body: { companyTypes: ['CLIENT', 'SUPPLIER'] },
    });
    expect(companyTypes.status).toBe(200);
    expect(companyTypes.data?.success).toBe(true);

    const inquirySettingsDisabled = await requestJson('/admin/settings/inquiry', {
      method: 'PUT',
      token,
      body: {
        supplierResponseUrlEnabled: false,
        autoMarkNoReplyAfterHours: null,
        defaultResponseDeadlineHours: null,
      },
    });
    expect(inquirySettingsDisabled.status).toBe(200);
    expect(inquirySettingsDisabled.data?.success).toBe(true);
    expect(inquirySettingsDisabled.data?.data?.supplierResponseUrlEnabled).toBe(false);
    expect(inquirySettingsDisabled.data?.data?.autoMarkNoReplyAfterHours).toBeNull();
    expect(inquirySettingsDisabled.data?.data?.defaultResponseDeadlineHours).toBeNull();

    const inquirySettingsReloaded = await requestJson('/admin/settings/inquiry', { token });
    expect(inquirySettingsReloaded.status).toBe(200);
    expect(inquirySettingsReloaded.data?.success).toBe(true);
    expect(inquirySettingsReloaded.data?.data?.supplierResponseUrlEnabled).toBe(false);
    expect(inquirySettingsReloaded.data?.data?.autoMarkNoReplyAfterHours).toBeNull();
    expect(inquirySettingsReloaded.data?.data?.defaultResponseDeadlineHours).toBeNull();

    const roles = await requestJson('/admin/settings/vessel-company-roles', {
      method: 'PUT',
      token,
      body: {
        roles: [
          {
            key: 'e2e_role',
            label: 'E2E Role',
            group: 'custom',
            description: 'Coverage role',
            seasearcherCode: 'E2E',
          },
        ],
      },
    });
    expect(roles.status).toBe(200);
    expect(roles.data?.success).toBe(true);

    const invalidLogo = new FormData();
    invalidLogo.set('file', new File(['not-image'], 'logo.txt', { type: 'text/plain' }));

    const logoUpload = await requestRaw(`/admin/settings/companies/${seeded.client.id}/logo`, {
      method: 'PUT',
      token,
      body: invalidLogo,
    });
    expect(logoUpload.status).toBe(200);
    expect((logoUpload.data as any)?.success).toBe(false);
    expect(String((logoUpload.data as any)?.message ?? '')).toContain('Only JPEG, PNG, WebP, and SVG are allowed');

    const deleteGroup = await requestJson(`/admin/settings/company-groups/${groupId}`, {
      method: 'DELETE',
      token,
    });
    expect(deleteGroup.status).toBe(200);
    expect(deleteGroup.data?.success).toBe(true);

    const deleteTeam = await requestJson(`/admin/settings/teams/${teamId}`, {
      method: 'DELETE',
      token,
    });
    expect(deleteTeam.status).toBe(200);
    expect(deleteTeam.data?.success).toBe(true);
  });

  it('enforces admin guards on integration management routes', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const smtp = await requestJson('/admin/settings/integrations/smtp', {
      method: 'PUT',
      token,
      body: {
        host: 'smtp.example.com',
        port: 587,
        user: 'mailer@example.com',
        pass: 'secret',
        from: 'noreply@example.com',
        secure: false,
      },
    });
    expect(smtp.status).toBe(200);
    expect(smtp.data?.success).toBe(false);
    expect(String(smtp.data?.message ?? '')).toContain('Admin access required');

    const push = await requestJson('/admin/settings/integrations/push', {
      method: 'PUT',
      token,
      body: {
        publicKey: 'pub',
        privateKey: 'priv',
        subject: 'mailto:test@example.com',
      },
    });
    expect(push.status).toBe(200);
    expect(push.data?.success).toBe(false);
    expect(String(push.data?.message ?? '')).toContain('Admin access required');

    const desktop = await requestJson('/admin/settings/integrations/quickbooks/desktop', {
      method: 'PUT',
      token,
      body: {
        companyName: 'E2E Desktop Co',
        username: 'qb-user',
        password: 'qb-pass',
      },
    });
    expect(desktop.status).toBe(200);
    expect(desktop.data?.success).toBe(false);
    expect(String(desktop.data?.message ?? '')).toContain('Admin access required');

    const appStatus = await requestJson('/admin/settings/integrations/quickbooks/app-status', {
      token,
    });
    expect(appStatus.status).toBe(200);
    expect(appStatus.data?.success).toBe(false);
    expect(String(appStatus.data?.message ?? '')).toContain('Admin access required');

    const authUrl = await requestJson('/admin/settings/integrations/quickbooks/auth-url', {
      token,
    });
    expect(authUrl.status).toBe(200);
    expect(authUrl.data?.success).toBe(false);
    expect(String(authUrl.data?.message ?? '')).toContain('Admin access required');

    const disconnect = await requestJson('/admin/settings/integrations/quickbooks', {
      method: 'DELETE',
      token,
    });
    expect(disconnect.status).toBe(200);
    expect(disconnect.data?.success).toBe(false);
    expect(String(disconnect.data?.message ?? '')).toContain('Admin access required');
  });

  it('supports deterministic integrations and quickbooks desktop lifecycle', async () => {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const smtp = await requestJson('/admin/settings/integrations/smtp', {
      method: 'PUT',
      token,
      body: {
        host: 'smtp.example.com',
        port: 587,
        user: 'mailer@example.com',
        pass: 'secret',
        from: 'noreply@example.com',
        secure: false,
      },
    });
    expect(smtp.status).toBe(200);
    expect(smtp.data?.success).toBe(true);

    const push = await requestJson('/admin/settings/integrations/push', {
      method: 'PUT',
      token,
      body: {
        publicKey: 'public-key-e2e',
        privateKey: 'private-key-e2e',
        subject: 'mailto:test@example.com',
      },
    });
    expect(push.status).toBe(200);
    expect(push.data?.success).toBe(true);

    const desktop = await requestJson('/admin/settings/integrations/quickbooks/desktop', {
      method: 'PUT',
      token,
      body: {
        companyName: 'E2E Desktop Co',
        username: 'qb-user',
        password: 'qb-pass',
      },
    });
    expect(desktop.status).toBe(200);
    expect(desktop.data?.success).toBe(true);

    const appStatus = await requestJson('/admin/settings/integrations/quickbooks/app-status', {
      token,
    });
    expect(appStatus.status).toBe(200);
    expect(appStatus.data?.success).toBe(true);
    expect(typeof appStatus.data?.data?.appConfigured).toBe('boolean');

    const authUrl = await requestJson('/admin/settings/integrations/quickbooks/auth-url', {
      token,
    });
    expect(authUrl.status).toBe(200);
    if (authUrl.data?.success) {
      expect(typeof authUrl.data?.data?.authUrl).toBe('string');
      expect(String(authUrl.data?.data?.authUrl ?? '')).toContain('appcenter.intuit.com/connect/oauth2');
    } else {
      expect(String(authUrl.data?.message ?? '')).toContain('QuickBooks app not configured');
    }

    const integrations = await requestJson('/admin/settings/integrations', { token });
    expect(integrations.status).toBe(200);
    expect(integrations.data?.success).toBe(true);
    const items = (integrations.data?.data ?? []) as Array<{ provider: string; configured: boolean; connectionType?: string | null }>;
    const smtpStatus = items.find((item) => item.provider === 'SMTP');
    const pushStatus = items.find((item) => item.provider === 'PUSH');
    const qbStatus = items.find((item) => item.provider === 'QUICKBOOKS');
    expect(smtpStatus?.configured).toBe(true);
    expect(pushStatus?.configured).toBe(true);
    expect(qbStatus?.configured).toBe(true);
    expect(qbStatus?.connectionType).toBe('desktop');

    const callbackError = await requestRaw('/admin/settings/integrations/quickbooks/callback?error=access_denied', {
      token,
    });
    expect(callbackError.status).toBe(302);
    expect(String(callbackError.headers.get('location') ?? '')).toContain('qb=error&reason=access_denied');

    const callbackMissing = await requestRaw('/admin/settings/integrations/quickbooks/callback', {
      token,
    });
    expect(callbackMissing.status).toBe(302);
    expect(String(callbackMissing.headers.get('location') ?? '')).toContain('qb=error&reason=missing_params');

    const callbackInvalidState = await requestRaw('/admin/settings/integrations/quickbooks/callback?code=abc&realmId=123&state=invalid', {
      token,
    });
    expect(callbackInvalidState.status).toBe(302);
    expect(String(callbackInvalidState.headers.get('location') ?? '')).toContain('qb=error&reason=invalid_state');

    const disconnect = await requestJson('/admin/settings/integrations/quickbooks', {
      method: 'DELETE',
      token,
    });
    expect(disconnect.status).toBe(200);
    expect(disconnect.data?.success).toBe(true);

    const integrationsAfterDisconnect = await requestJson('/admin/settings/integrations', { token });
    expect(integrationsAfterDisconnect.status).toBe(200);
    expect(integrationsAfterDisconnect.data?.success).toBe(true);
    const itemsAfter = (integrationsAfterDisconnect.data?.data ?? []) as Array<{ provider: string; configured: boolean }>;
    const qbAfter = itemsAfter.find((item) => item.provider === 'QUICKBOOKS');
    expect(qbAfter?.configured).toBe(false);
  });

  it('supports WhatsApp settings roundtrip including first inquiry sharing', async () => {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const initial = await requestJson('/admin/settings/whatsapp', { token });
    expect(initial.status).toBe(200);
    expect(initial.data?.success).toBe(true);
    expect(initial.data?.data?.firstInquiryGroupNotificationEnabled).toBe(true);

    const updated = await requestJson('/admin/settings/whatsapp', {
      method: 'PUT',
      token,
      body: {
        enabled: true,
        defaultGroupJid: '120363001234567890@g.us',
        incomingRfqEnabled: false,
        firstInquiryGroupNotificationEnabled: false,
      },
    });
    expect(updated.status).toBe(200);
    expect(updated.data?.success).toBe(true);
    expect(updated.data?.data?.enabled).toBe(true);
    expect(updated.data?.data?.defaultGroupJid).toBe('120363001234567890@g.us');
    expect(updated.data?.data?.incomingRfqEnabled).toBe(false);
    expect(updated.data?.data?.firstInquiryGroupNotificationEnabled).toBe(false);

    const fetched = await requestJson('/admin/settings/whatsapp', { token });
    expect(fetched.status).toBe(200);
    expect(fetched.data?.success).toBe(true);
    expect(fetched.data?.data?.firstInquiryGroupNotificationEnabled).toBe(false);
  });
});
