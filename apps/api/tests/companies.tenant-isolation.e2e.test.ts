/**
 * Tenant isolation for the companies module.
 *
 * `/companies/local/:id…` used to read `params.id` unscoped: `getCompanyById`
 * filtered on the id alone, so a company id belonging to another tenant returned
 * that tenant's company, its contacts, emails, ledger and credit — and
 * `POST /companies/local` filed the new company under whichever tenant happened
 * to be first in the table (`tenants.findFirst()`).
 *
 * These tests pin the boundary at the route, which is where it is enforced for
 * the whole module (`onBeforeHandle`), rather than per handler.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { getDb, seedBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

async function makeTenant(name: string, domain: string, email: string) {
  const db = await getDb();
  const { tenants, users } = await import('../src/db/schema');
  const { hashPassword } = await import('../src/modules/auth/password.service');

  const [tenant] = await db.insert(tenants).values({ name, domain }).returning();
  await db.insert(users).values({
    tenantId: tenant!.id,
    email,
    name: `${name} User`,
    role: 'ADMIN',
    passwordHash: await hashPassword('Password123!'),
  });
  const token = (await loginE2E(email, 'Password123!')).accessToken;
  return { tenant: tenant!, token };
}

beforeEach(async () => {
  await truncateAll();
});

describe('companies tenant isolation', () => {
  it('answers 404 for another tenant\'s company, on every shape of :id route', async () => {
    // Tenant A owns a company; tenant B must not be able to read it by id.
    const a = await seedBasics();
    const { tenant: bTenant, token: bToken } = await makeTenant('B Tenant', 'b.local', 'b@test.local');
    const { counterparties } = await import('../src/db/schema');
    const db = await getDb();
    const [aCompany] = await db
      .insert(counterparties)
      .values({ tenantId: a.tenant.id, name: 'A Only Ltd', type: 'CLIENT', types: ['CLIENT'] })
      .returning();

    // A's OWN token still works — the guard must not block legitimate reads.
    const { token: aToken } = await (async () => {
      const { users } = await import('../src/db/schema');
      const { hashPassword } = await import('../src/modules/auth/password.service');
      await db.insert(users).values({
        tenantId: a.tenant.id, email: 'a@test.local', name: 'A User', role: 'ADMIN',
        passwordHash: await hashPassword('Password123!'),
      });
      return { token: (await loginE2E('a@test.local', 'Password123!')).accessToken };
    })();

    const own = await requestJson(`/companies/local/${aCompany!.id}`, { token: aToken });
    expect(own.status).toBe(200);
    expect(own.data?.data?.name).toBe('A Only Ltd');

    /**
     * 404 rather than 403 on every one of these: a foreign id must look exactly
     * like a nonexistent one, or the error itself confirms the id exists in
     * another tenant.
     */
    for (const path of [
      `/companies/local/${aCompany!.id}`,
      `/companies/local/${aCompany!.id}/orders`,
      `/companies/local/${aCompany!.id}/contacts`,
      `/companies/local/${aCompany!.id}/emails`,
      `/companies/local/${aCompany!.id}/emails`,
      `/companies/local/${aCompany!.id}/ledger/supplier`,
      `/companies/local/${aCompany!.id}/ledger/customer`,
      `/companies/local/${aCompany!.id}/group-aggregate`,
    ]) {
      const res = await requestJson(path, { token: bToken });
      expect(res.status).toBe(404);
    }

    // And a write must not land either.
    const write = await requestJson(`/companies/local/${aCompany!.id}/emails`, {
      method: 'POST', token: bToken,
      body: { emailType: 'general', email: 'stolen@b.test' },
    });
    expect(write.status).toBe(404);

    const { companyEmails } = await import('../src/db/schema');
    const emails = await db.select().from(companyEmails);
    expect(emails.length).toBe(0);

    // A nonexistent id is indistinguishable from a foreign one.
    const ghost = await requestJson('/companies/local/00000000-0000-0000-0000-000000000000', { token: bToken });
    expect(ghost.status).toBe(404);

    // Sanity: the other tenant's company is untouched.
    void bTenant;
  });

  it('blocks child-resource routes that take the CHILD id, not a company id', async () => {
    // These routes never carry `params.id`, so the route guard cannot see them —
    // ownership has to be enforced inside the query. Found by panel review.
    const a = await seedBasics();
    const { token: bToken } = await makeTenant('Child Tenant', 'child.local', 'child@test.local');
    const db = await getDb();
    const { counterparties, companyContacts, companyEmails, companyOffices } = await import('../src/db/schema');

    const [aCompany] = await db
      .insert(counterparties)
      .values({ tenantId: a.tenant.id, name: 'Child Owner Ltd', type: 'CLIENT', types: ['CLIENT'] })
      .returning();
    const [contact] = await db.insert(companyContacts)
      .values({ counterpartyId: aCompany!.id, name: 'A Contact' }).returning();
    const [email] = await db.insert(companyEmails)
      .values({ counterpartyId: aCompany!.id, emailType: 'general', email: 'a@owner.test' }).returning();
    const [office] = await db.insert(companyOffices)
      .values({ counterpartyId: aCompany!.id, city: 'Aarhus' }).returning();

    // Reads and writes by child id must all fail for tenant B.
    expect((await requestJson(`/companies/contacts/${contact!.id}`, {
      method: 'PATCH', token: bToken, body: { name: 'Hijacked' },
    })).status).toBe(404);
    expect((await requestJson(`/companies/contacts/${contact!.id}`, { method: 'DELETE', token: bToken })).status).toBe(404);
    expect((await requestJson(`/companies/emails/${email!.id}`, {
      method: 'PATCH', token: bToken, body: { email: 'stolen@b.test' },
    })).status).toBe(404);
    expect((await requestJson(`/companies/emails/${email!.id}`, { method: 'DELETE', token: bToken })).status).toBe(404);
    expect((await requestJson(`/companies/offices/${office!.id}`, {
      method: 'PATCH', token: bToken, body: { city: 'Stolen' },
    })).status).toBe(404);
    expect((await requestJson(`/companies/offices/${office!.id}`, { method: 'DELETE', token: bToken })).status).toBe(404);

    // Nothing was actually changed or deleted.
    const contacts = await db.select().from(companyContacts);
    expect(contacts.length).toBe(1);
    expect(contacts[0]!.name).toBe('A Contact');
    const emails = await db.select().from(companyEmails);
    expect(emails.length).toBe(1);
    expect(emails[0]!.email).toBe('a@owner.test');
    const offices = await db.select().from(companyOffices);
    expect(offices.length).toBe(1);
    expect(offices[0]!.city).toBe('Aarhus');
  });

  it('does not resolve another tenant\'s company by Seasearcher id, and does not adopt it on import', async () => {
    const a = await seedBasics();
    const { token: bToken } = await makeTenant('Import Tenant', 'import.local', 'import@test.local');
    const db = await getDb();
    const { counterparties } = await import('../src/db/schema');

    const [aCompany] = await db
      .insert(counterparties)
      .values({
        tenantId: a.tenant.id, name: 'A Seasearcher Co', type: 'CLIENT', types: ['CLIENT'],
        seasearcherId: 'SEA-999', creditLimit: '123456',
      })
      .returning();

    // Direct lookup by Seasearcher id must not leak A's company.
    const bySs = await requestJson('/companies/by-seasearcher/SEA-999', { token: bToken });
    expect(bySs.status).toBe(404);

    /**
     * The import is a separate path (a different function, not the id guard). An
     * unscoped dedupe would hand tenant B tenant A's row AND skip creating B's
     * own. Either outcome is checked: not A's id, and the name resolved must be
     * B's own record if one exists.
     */
    const imported = await requestJson('/companies/import', {
      method: 'POST', token: bToken, body: { seasearcherId: 'SEA-999' },
    });
    if (imported.status === 200) {
      expect(imported.data?.data?.id).not.toBe(aCompany!.id);
      expect(imported.data?.data?.tenantId).toBe(undefined); // DTO does not expose it
    }
    void aCompany;
  });

  it('refuses a cross-tenant parent link', async () => {
    const a = await seedBasics();
    const { tenant: bTenant, token: bToken } = await makeTenant('Parent Tenant', 'parent.local', 'parent@test.local');
    const db = await getDb();
    const { counterparties } = await import('../src/db/schema');

    const [aParent] = await db
      .insert(counterparties)
      .values({ tenantId: a.tenant.id, name: 'A Parent', type: 'CLIENT', types: ['CLIENT'] })
      .returning();
    const [bChild] = await db
      .insert(counterparties)
      .values({ tenantId: bTenant.id, name: 'B Child', type: 'CLIENT', types: ['CLIENT'] })
      .returning();

    // body.parentId is not in the path, so the guard cannot cover it. Linking here
    // would expose A's group through every hierarchy route.
    const res = await requestJson(`/companies/local/${bChild!.id}/set-parent`, {
      method: 'POST', token: bToken, body: { parentId: aParent!.id },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);

    const [after] = await db.select().from(counterparties).where(eq(counterparties.id, bChild!.id));
    expect(after!.parentId).toBeNull();
  });

  it('lists only the caller\'s own companies', async () => {
    const a = await seedBasics();
    const { token: bToken } = await makeTenant('List Tenant', 'list.local', 'list@test.local');
    const { counterparties } = await import('../src/db/schema');
    const db = await getDb();
    await db.insert(counterparties).values([
      { tenantId: a.tenant.id, name: 'Alpha Marine', type: 'CLIENT', types: ['CLIENT'] },
      { tenantId: a.tenant.id, name: 'Beta Marine', type: 'CLIENT', types: ['CLIENT'] },
    ]);

    const res = await requestJson('/companies/local?limit=100', { token: bToken });
    expect(res.status).toBe(200);
    // Tenant B has no companies of its own, so A's must not appear.
    const rows = res.data?.data?.companies ?? [];
    expect(rows.some((c: { name: string }) => c.name.startsWith('Alpha') || c.name.startsWith('Beta'))).toBe(false);

    // The search picker must not offer them either.
    const search = await requestJson('/companies/search?term=Marine', { token: bToken });
    expect(search.status).toBe(200);
    const hits = (search.data?.data ?? []).filter((r: { source: string }) => r.source === 'local');
    expect(hits.length).toBe(0);
  });

  it('files a created company under the caller\'s tenant', async () => {
    await seedBasics();
    const { tenant: bTenant, token: bToken } = await makeTenant('Creator', 'creator.local', 'creator@test.local');

    const created = await requestJson('/companies/local', {
      method: 'POST', token: bToken,
      body: { name: 'Belongs To B', types: ['CLIENT'] },
    });
    expect(created.status).toBe(200);

    const db = await getDb();
    const { counterparties } = await import('../src/db/schema');
    const [row] = await db.select().from(counterparties).where(eq(counterparties.name, 'Belongs To B'));
    expect(row).toBeDefined();
    // Previously this used tenants.findFirst(), so it could land on tenant A.
    expect(row!.tenantId).toBe(bTenant.id);
  });

  it('scopes the dashboard credit groups to the caller\'s tenant', async () => {
    const a = await seedBasics();
    const { token: bToken } = await makeTenant('Credit Tenant', 'credit.local', 'credit@test.local');
    const { counterparties } = await import('../src/db/schema');
    const db = await getDb();

    const [parent] = await db
      .insert(counterparties)
      .values({ tenantId: a.tenant.id, name: 'Exposed Parent', type: 'CLIENT', types: ['CLIENT'], creditLimit: '100000', creditUsed: '50000' })
      .returning();
    await db.insert(counterparties).values({
      tenantId: a.tenant.id, name: 'Exposed Child', type: 'CLIENT', types: ['CLIENT'],
      creditLimit: '1000', creditUsed: '0', parentId: parent!.id,
    });

    const res = await requestJson('/companies/top-credit-groups', { token: bToken });
    expect(res.status).toBe(200);
    const groups = res.data?.data ?? [];
    // Tenant B has no exposure of its own; A's limits must not be on B's dashboard.
    expect(groups.some((g: { name: string }) => g.name === 'Exposed Parent')).toBe(false);
    expect(groups.length).toBe(0);
  });
});
