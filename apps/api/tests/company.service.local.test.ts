import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { companyContacts, companyEmails, counterparties, orders, orderSuppliers } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';

async function loadCompanyService() {
  return import('../src/modules/companies/company.service');
}

beforeEach(async () => {
  await truncateAll();
});

describe('company.service local flows', () => {
  it('creates, lists, gets, updates, changes types/responsible, and deletes company', async () => {
    const { tenant, user } = await seedBasics();
    const {
      createCompany,
      listCompanies,
      getCompanyById,
      updateCompany,
      updateCompanyTypes,
      updateCompanyResponsibleUser,
      deleteCompany,
    } = await loadCompanyService();

    const created = await createCompany({
      name: 'Nordic Bunkers',
      types: ['CLIENT', 'SUPPLIER'],
      country: 'Denmark',
      countryIso: 'DK',
      creditLimit: '5000',
    });

    expect(created.id).toBeTruthy();
    expect(created.type).toBe('CLIENT');

    const listed = await listCompanies({ search: 'Nordic', limit: 10, page: 1 });
    expect(listed.total).toBeGreaterThanOrEqual(1);
    expect(listed.companies.some((c) => c.id === created.id)).toBe(true);

    await updateCompanyResponsibleUser(created.id, user.id);

    const fetched = await getCompanyById(created.id);
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.responsibleUserName).toBe(user.name);

    const updated = await updateCompany(created.id, {
      name: 'Nordic Bunkers A/S',
      country: 'Denmark',
      website: 'https://nordic.example',
      fleetSize: 12,
      creditLimit: '7000',
    });

    expect(updated?.name).toBe('Nordic Bunkers A/S');
    expect(updated?.website).toBe('https://nordic.example');
    expect(updated?.fleetSize).toBe(12);
    expect(updated?.creditLimit).toBe('7000.00');
    expect(updated?.manualOverrides).toContain('name');
    expect(updated?.manualOverrides).toContain('website');

    const typed = await updateCompanyTypes(created.id, ['SUPPLIER', 'CLIENT']);
    expect(typed?.type).toBe('SUPPLIER');
    expect(typed?.types).toEqual(['SUPPLIER', 'CLIENT']);

    const deleted = await deleteCompany(created.id);
    expect(deleted?.id).toBe(created.id);

    const missing = await getCompanyById(created.id);
    expect(missing).toBeNull();
  });

  it('returns null when updating a missing company', async () => {
    const { user } = await seedBasics();
    const { updateCompany } = await loadCompanyService();

    const missing = await updateCompany('123e4567-e89b-12d3-a456-426614174000', { name: 'X' });
    expect(missing).toBeNull();
  });

  it('persists and returns the manual KYC date fields', async () => {
    const { } = await seedBasics();
    const { createCompany, getCompanyById, updateCompany } = await loadCompanyService();

    const created = await createCompany({
      name: 'KYC Co',
      types: ['CLIENT'],
      country: 'Denmark',
      countryIso: 'DK',
    });

    // Initially null (not verified, no expiry).
    const initial = await getCompanyById(created.id);
    expect(initial?.kycVerifiedDate).toBeNull();
    expect(initial?.kycExpiryDate).toBeNull();

    // Set both dates.
    const updated = await updateCompany(created.id, {
      kycVerifiedDate: '2025-01-15',
      kycExpiryDate: '2026-01-15',
    });
    expect(updated?.kycVerifiedDate).toBe('2025-01-15');
    expect(updated?.kycExpiryDate).toBe('2026-01-15');
    // KYC dates are not Seasearcher-synced, so they must not be tracked as manual overrides.
    expect(updated?.manualOverrides ?? []).not.toContain('kycVerifiedDate');
    expect(updated?.manualOverrides ?? []).not.toContain('kycExpiryDate');

    // getCompanyById returns them too.
    const fetched = await getCompanyById(created.id);
    expect(fetched?.kycVerifiedDate).toBe('2025-01-15');
    expect(fetched?.kycExpiryDate).toBe('2026-01-15');

    // Clearing (null) is persisted.
    const cleared = await updateCompany(created.id, {
      kycVerifiedDate: null,
      kycExpiryDate: null,
    });
    expect(cleared?.kycVerifiedDate).toBeNull();
    expect(cleared?.kycExpiryDate).toBeNull();
  });

  it('refuses to delete a company referenced as an additional order supplier', async () => {
    const { tenant, client, vessel, place } = await seedBasics();
    const db = await getDb();
    const { createCompany, deleteCompany } = await loadCompanyService();

    const primarySupplier = await createCompany({
      name: 'Primary Supplier',
      types: ['SUPPLIER'],
      country: 'Denmark',
      countryIso: 'DK',
    });

    const additionalSupplier = await createCompany({
      name: 'Additional Supplier',
      types: ['SUPPLIER'],
      country: 'Sweden',
      countryIso: 'SE',
    });

    const [order] = await db
      .insert(orders)
      .values({
        tenantId: tenant.id,
        clientId: client.id,
        vesselId: vessel.id,
        placeId: place.id,
        supplierId: primarySupplier.id,
        status: 'CONFIRMED',
        currency: 'USD',
      })
      .returning();

    await db.insert(orderSuppliers).values([
      {
        orderId: order!.id,
        companyId: primarySupplier.id,
        sortOrder: 0,
        isPrimary: true,
      },
      {
        orderId: order!.id,
        companyId: additionalSupplier.id,
        sortOrder: 1,
        isPrimary: false,
      },
    ]);

    await expect(deleteCompany(additionalSupplier.id)).rejects.toMatchObject({
      code: 'HAS_ORDERS',
      count: 1,
    });
  });

  it('returns only company groups with actual credit exposure', async () => {
    const { tenant } = await seedBasics();
    const db = await getDb();
    const { getTopCreditGroups } = await loadCompanyService();

    const [parentWithExposure] = await db
      .insert(counterparties)
      .values({
        tenantId: tenant.id,
        name: 'Exposure Parent',
        type: 'CLIENT',
        types: ['CLIENT'],
        country: 'Denmark',
        countryIso: 'DK',
        creditLimit: '1000',
        creditUsed: '250',
      })
      .returning();

    const [childWithExposure] = await db
      .insert(counterparties)
      .values({
        tenantId: tenant.id,
        name: 'Exposure Child',
        type: 'CLIENT',
        types: ['CLIENT'],
        country: 'Denmark',
        countryIso: 'DK',
        parentId: parentWithExposure!.id,
        creditLimit: '500',
        creditUsed: '50',
      })
      .returning();

    const [parentWithoutExposure] = await db
      .insert(counterparties)
      .values({
        tenantId: tenant.id,
        name: 'Empty Parent',
        type: 'CLIENT',
        types: ['CLIENT'],
        country: 'Sweden',
        countryIso: 'SE',
        creditLimit: '0',
        creditUsed: '0',
      })
      .returning();

    await db.insert(counterparties).values({
      tenantId: tenant.id,
      name: 'Empty Child',
      type: 'CLIENT',
      types: ['CLIENT'],
      country: 'Sweden',
      countryIso: 'SE',
      parentId: parentWithoutExposure!.id,
      creditLimit: '0',
      creditUsed: '0',
    });

    const groups = await getTopCreditGroups(10);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe(parentWithExposure!.id);
    expect(groups[0]?.name).toBe('Exposure Parent');
    expect(groups[0]?.childCount).toBe(2);
    expect(groups[0]?.totalCreditLimit).toBe('1500.00');
    expect(groups[0]?.totalCreditUsed).toBe('300.00');

    expect(groups.some((group) => group.id === childWithExposure!.id)).toBe(false);
    expect(groups.some((group) => group.id === parentWithoutExposure!.id)).toBe(false);
  });

  it('supports contact CRUD and seasearcher contact sync', async () => {
    const { tenant } = await seedBasics();
    const db = await getDb();
    const {
      createCompany,
      getCompanyContacts,
      createCompanyContact,
      updateCompanyContact,
      deleteCompanyContact,
      syncContactsFromSeasearcher,
    } = await loadCompanyService();

    const company = await createCompany({
      name: 'Contact Test Co',
      types: ['CLIENT'],
      country: 'Norway',
      countryIso: 'NO',
    });

    const manual = await createCompanyContact(company.id, {
      name: 'Manual Person',
      role: 'Trader',
      email: 'manual@test.co',
      phone: '+45 1234',
    });

    expect(manual.id).toBeTruthy();

    const updated = await updateCompanyContact(manual.id, { role: 'Senior Trader' });
    expect(updated?.role).toBe('Senior Trader');

    await syncContactsFromSeasearcher(company.id, {
      officeId: 1,
      country: 'Norway',
      town: 'Oslo',
      countryCode: 'NO',
      addressLine1: 'Street 1',
      addressLine2: '',
      addressLine3: '',
      addressLine4: '',
      postCode1: '0001',
      telephoneNumbers: [{ countryDialingCode: '47', areaDialingCode: '', number: '99887766' }],
      faxNumbers: [{ countryDialingCode: '47', areaDialingCode: '', number: '11223344' }],
      emailAddress: 'office@test.co',
      webAddress: 'https://office.test.co',
      personnel: [
        { personId: 1, name: 'Sea Contact', jobTitle: 'Ops' },
      ],
    });

    const contacts = await getCompanyContacts(company.id);
    expect(contacts.some((c) => c.name === 'Manual Person')).toBe(true);
    expect(contacts.some((c) => c.name === 'Sea Contact')).toBe(true);

    await deleteCompanyContact(manual.id);
    const afterDelete = await getCompanyContacts(company.id);
    expect(afterDelete.some((c) => c.id === manual.id)).toBe(false);

    const [tenantCompanyCount] = await db
      .select({ count: counterparties.id })
      .from(counterparties)
      .where(eq(counterparties.tenantId, tenant.id))
      .limit(1);
    expect(tenantCompanyCount).toBeTruthy();
  });

  it('keeps deleted legacy seasearcher contacts hidden on future syncs', async () => {
    await seedBasics();
    const db = await getDb();
    const {
      createCompany,
      deleteCompanyContact,
      getCompanyContacts,
      syncContactsFromSeasearcher,
    } = await loadCompanyService();

    const company = await createCompany({
      name: 'Legacy Contact Co',
      types: ['CLIENT'],
      country: 'Singapore',
      countryIso: 'SG',
    });

    const [legacyImported] = await db
      .insert(companyContacts)
      .values({
        counterpartyId: company.id,
        name: 'Sea Contact',
        role: 'Ops',
        email: 'office@test.co',
        phone: '+65 6123 4567',
        source: 'seasearcher',
        seasearcherPersonId: null,
      })
      .returning();

    await deleteCompanyContact(legacyImported.id);

    await syncContactsFromSeasearcher(company.id, {
      officeId: 1,
      country: 'Singapore',
      town: 'Singapore',
      countryCode: 'SG',
      addressLine1: 'Street 1',
      addressLine2: '',
      addressLine3: '',
      addressLine4: '',
      postCode1: '018956',
      telephoneNumbers: [{ countryDialingCode: '65', areaDialingCode: '', number: '61234567' }],
      faxNumbers: [],
      emailAddress: 'office@test.co',
      webAddress: 'https://office.test.co',
      personnel: [
        { personId: 77, name: 'Sea Contact', jobTitle: 'Ops' },
      ],
    });

    const visibleContacts = await getCompanyContacts(company.id);
    expect(visibleContacts.some((c) => c.name === 'Sea Contact')).toBe(false);

    const storedContacts = await db
      .select()
      .from(companyContacts)
      .where(eq(companyContacts.counterpartyId, company.id));
    expect(storedContacts).toHaveLength(1);
    expect(storedContacts[0]?.id).toBe(legacyImported.id);
    expect(storedContacts[0]?.deletedAt).not.toBeNull();
  });

  it('supports company email add/update/delete including primary switch', async () => {
    const { user } = await seedBasics();
    const {
      createCompany,
      addCompanyEmail,
      getCompanyEmails,
      updateCompanyEmail,
      deleteCompanyEmail,
    } = await loadCompanyService();

    const company = await createCompany({
      name: 'Email Test Co',
      types: ['CLIENT'],
      country: 'Denmark',
      countryIso: 'DK',
    });

    const first = await addCompanyEmail(
      company.id,
      { emailType: 'sales', email: 'sales1@test.co', isPrimary: true },
      user.id,
      'User One',
    );

    const second = await addCompanyEmail(
      company.id,
      { emailType: 'sales', email: 'sales2@test.co', isPrimary: true },
      user.id,
      'User One',
    );

    const emailsAfterAdd = await getCompanyEmails(company.id);
    const firstAfterAdd = emailsAfterAdd.find((e) => e.id === first.id);
    const secondAfterAdd = emailsAfterAdd.find((e) => e.id === second.id);
    expect(firstAfterAdd?.isPrimary).toBe(false);
    expect(secondAfterAdd?.isPrimary).toBe(true);

    const updated = await updateCompanyEmail(first.id, { isPrimary: true });
    expect(updated?.id).toBe(first.id);
    expect(updated?.isPrimary).toBe(true);

    const emailsAfterUpdate = await getCompanyEmails(company.id);
    const firstAfterUpdate = emailsAfterUpdate.find((e) => e.id === first.id);
    const secondAfterUpdate = emailsAfterUpdate.find((e) => e.id === second.id);
    expect(firstAfterUpdate?.isPrimary).toBe(true);
    expect(secondAfterUpdate?.isPrimary).toBe(false);

    const deleted = await deleteCompanyEmail(second.id);
    expect(deleted?.id).toBe(second.id);

    const rows = await getCompanyEmails(company.id);
    expect(rows.some((r) => r.id === second.id)).toBe(false);

    const db = await getDb();
    const [dbRow] = await db.select().from(companyEmails).where(eq(companyEmails.id, first.id)).limit(1);
    expect(dbRow?.isPrimary).toBe(true);
  });
});
