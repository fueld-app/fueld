import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

describe('bank accounts CRUD e2e', () => {
  let token: string;
  let companyId: string;

  beforeEach(async () => {
    await truncateAll();
    const seeded = await seedAuthBasics();
    const db = await getDb();

    // Promote to admin
    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    companyId = seeded.client.id;
    const login = await loginE2E(seeded.user.email, seeded.password);
    token = login.accessToken!;
  });

  const FULL_BANK_ACCOUNT = {
    label: 'USD Main Account',
    bankName: 'CREDIT AGRICOLE MONACO',
    accountName: 'RIVIERA MARINE SAM',
    accountNumber: '12345678',
    iban: 'MC 58 19106 00698 43678',
    swiftBic: 'AGRIMC91',
    currency: 'USD',
    branchAddress: '23 Bd Princesse Charlotte 98 000 - MONACO',
    sortCode: '20-30-40',
    routingNumber: '021000021',
    intermediaryBank: 'SWIFT BSUIFRPP / CACIB',
    isDefault: true,
    notes: 'Primary USD account',
  };

  it('creates a bank account with all fields', async () => {
    const res = await requestJson(
      `/admin/settings/companies/${companyId}/bank-accounts`,
      { method: 'POST', token, body: FULL_BANK_ACCOUNT },
    );

    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(true);

    const ba = res.data?.data;
    expect(ba?.id).toBeTruthy();
    expect(ba?.label).toBe('USD Main Account');
    expect(ba?.bankName).toBe('CREDIT AGRICOLE MONACO');
    expect(ba?.accountName).toBe('RIVIERA MARINE SAM');
    expect(ba?.accountNumber).toBe('12345678');
    expect(ba?.iban).toBe('MC 58 19106 00698 43678');
    expect(ba?.swiftBic).toBe('AGRIMC91');
    expect(ba?.currency).toBe('USD');
    expect(ba?.branchAddress).toBe('23 Bd Princesse Charlotte 98 000 - MONACO');
    expect(ba?.sortCode).toBe('20-30-40');
    expect(ba?.routingNumber).toBe('021000021');
    expect(ba?.intermediaryBank).toBe('SWIFT BSUIFRPP / CACIB');
    expect(ba?.isDefault).toBe(true);
    expect(ba?.notes).toBe('Primary USD account');
  });

  it('lists bank accounts', async () => {
    // Create two accounts
    await requestJson(`/admin/settings/companies/${companyId}/bank-accounts`, {
      method: 'POST', token, body: { ...FULL_BANK_ACCOUNT, label: 'Account A', isDefault: false },
    });
    await requestJson(`/admin/settings/companies/${companyId}/bank-accounts`, {
      method: 'POST', token, body: { ...FULL_BANK_ACCOUNT, label: 'Account B', isDefault: true },
    });

    const res = await requestJson(
      `/admin/settings/companies/${companyId}/bank-accounts`,
      { token },
    );

    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(true);
    expect(res.data?.data?.length).toBe(2);
  });

  it('updates a bank account with all fields', async () => {
    // Create
    const created = await requestJson(
      `/admin/settings/companies/${companyId}/bank-accounts`,
      { method: 'POST', token, body: FULL_BANK_ACCOUNT },
    );
    const id = created.data?.data?.id;

    // Update every field
    const updates = {
      label: 'EUR Backup',
      bankName: 'BNP PARIBAS',
      accountName: 'UPDATED BENEFICIARY',
      accountNumber: '99887766',
      iban: 'FR76 3000 4000 0500 0000 0136 231',
      swiftBic: 'BNPAFRPP',
      currency: 'EUR',
      branchAddress: '16 Boulevard des Italiens, Paris',
      sortCode: '10-20-30',
      routingNumber: '011401533',
      intermediaryBank: 'SWIFT CHASUS33 / JP MORGAN',
      isDefault: false,
      notes: 'Updated notes',
    };

    const res = await requestJson(
      `/admin/settings/companies/${companyId}/bank-accounts/${id}`,
      { method: 'PATCH', token, body: updates },
    );

    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(true);

    const ba = res.data?.data;
    expect(ba?.label).toBe('EUR Backup');
    expect(ba?.bankName).toBe('BNP PARIBAS');
    expect(ba?.accountName).toBe('UPDATED BENEFICIARY');
    expect(ba?.accountNumber).toBe('99887766');
    expect(ba?.iban).toBe('FR76 3000 4000 0500 0000 0136 231');
    expect(ba?.swiftBic).toBe('BNPAFRPP');
    expect(ba?.currency).toBe('EUR');
    expect(ba?.branchAddress).toBe('16 Boulevard des Italiens, Paris');
    expect(ba?.sortCode).toBe('10-20-30');
    expect(ba?.routingNumber).toBe('011401533');
    expect(ba?.intermediaryBank).toBe('SWIFT CHASUS33 / JP MORGAN');
    expect(ba?.isDefault).toBe(false);
    expect(ba?.notes).toBe('Updated notes');
  });

  it('partial update preserves untouched fields', async () => {
    const created = await requestJson(
      `/admin/settings/companies/${companyId}/bank-accounts`,
      { method: 'POST', token, body: FULL_BANK_ACCOUNT },
    );
    const id = created.data?.data?.id;

    // Only update label
    const res = await requestJson(
      `/admin/settings/companies/${companyId}/bank-accounts/${id}`,
      { method: 'PATCH', token, body: { label: 'Renamed' } },
    );

    expect(res.data?.success).toBe(true);
    const ba = res.data?.data;
    expect(ba?.label).toBe('Renamed');
    // All other fields intact
    expect(ba?.intermediaryBank).toBe('SWIFT BSUIFRPP / CACIB');
    expect(ba?.sortCode).toBe('20-30-40');
    expect(ba?.routingNumber).toBe('021000021');
    expect(ba?.branchAddress).toBe('23 Bd Princesse Charlotte 98 000 - MONACO');
    expect(ba?.notes).toBe('Primary USD account');
  });

  it('deletes a bank account', async () => {
    const created = await requestJson(
      `/admin/settings/companies/${companyId}/bank-accounts`,
      { method: 'POST', token, body: FULL_BANK_ACCOUNT },
    );
    const id = created.data?.data?.id;

    const res = await requestJson(
      `/admin/settings/companies/${companyId}/bank-accounts/${id}`,
      { method: 'DELETE', token },
    );

    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(true);

    // Verify gone
    const list = await requestJson(
      `/admin/settings/companies/${companyId}/bank-accounts`,
      { token },
    );
    expect(list.data?.data?.length).toBe(0);
  });

  it('setting default unsets previous default', async () => {
    // Create first as default
    await requestJson(
      `/admin/settings/companies/${companyId}/bank-accounts`,
      { method: 'POST', token, body: { ...FULL_BANK_ACCOUNT, label: 'First', isDefault: true } },
    );

    // Create second as default
    await requestJson(
      `/admin/settings/companies/${companyId}/bank-accounts`,
      { method: 'POST', token, body: { ...FULL_BANK_ACCOUNT, label: 'Second', isDefault: true } },
    );

    const list = await requestJson(
      `/admin/settings/companies/${companyId}/bank-accounts`,
      { token },
    );

    const accounts = list.data?.data as { label: string; isDefault: boolean }[];
    const defaults = accounts.filter((a) => a.isDefault);
    expect(defaults.length).toBe(1);
    expect(defaults[0]?.label).toBe('Second');
  });

  it('can set nullable fields to null via update', async () => {
    const created = await requestJson(
      `/admin/settings/companies/${companyId}/bank-accounts`,
      { method: 'POST', token, body: FULL_BANK_ACCOUNT },
    );
    const id = created.data?.data?.id;

    const res = await requestJson(
      `/admin/settings/companies/${companyId}/bank-accounts/${id}`,
      {
        method: 'PATCH', token,
        body: {
          intermediaryBank: null,
          sortCode: null,
          routingNumber: null,
          notes: null,
        },
      },
    );

    expect(res.data?.success).toBe(true);
    expect(res.data?.data?.intermediaryBank).toBeNull();
    expect(res.data?.data?.sortCode).toBeNull();
    expect(res.data?.data?.routingNumber).toBeNull();
    expect(res.data?.data?.notes).toBeNull();
  });
});
