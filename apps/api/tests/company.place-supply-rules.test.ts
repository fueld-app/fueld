import { beforeEach, describe, expect, it } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { companyContacts, companyPlaceSupplyRules, places, portSuppliers } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';

async function loadCompanyService() {
  return import('../src/modules/companies/company.service');
}

async function loadLliService() {
  return import('../src/modules/lloyds/lli.service');
}

beforeEach(async () => {
  await truncateAll();
});

describe('company place supply rules', () => {
  it('creates a rule and backfills existing matching places', async () => {
    const db = await getDb();
    const { user } = await seedBasics();
    const { createCompany, createCompanyPlaceSupplyRule } = await loadCompanyService();

    const supplier = await createCompany({
      name: 'DCC Energy A/S',
      types: ['SUPPLIER'],
      country: 'Denmark',
      countryIso: 'DNK',
    });

    const [contact] = await db
      .insert(companyContacts)
      .values({
        counterpartyId: supplier.id,
        name: 'Ops Desk',
        role: 'Operations',
      })
      .returning();

    await db.insert(places).values([
      { name: 'Aarhus', country: 'DNK', countryIso: 'DNK', placeType: 'POR' },
      { name: 'Copenhagen Anchorage', country: 'DNK', countryIso: 'DNK', placeType: 'ANC' },
      { name: 'Gothenburg', country: 'SWE', countryIso: 'SWE', placeType: 'POR' },
    ]);

    const summary = await createCompanyPlaceSupplyRule(
      supplier.id,
      {
        countryIso: 'DNK',
        placeTypes: ['POR', 'ANC'],
        contactId: contact!.id,
        products: ['VLSFO', 'LSMGO'],
        note: 'Country rule',
      },
      user.id,
      user.name,
    );

    expect(summary.matchedPlaceCount).toBe(2);
    expect(summary.created).toBe(2);
    expect(summary.updated).toBe(0);
    expect(summary.skipped).toBe(0);

    const rows = await db
      .select({
        placeId: portSuppliers.placeId,
        companyId: portSuppliers.companyId,
        contactId: portSuppliers.contactId,
        products: portSuppliers.products,
        note: portSuppliers.note,
        coverageRuleId: portSuppliers.coverageRuleId,
        coverageSource: portSuppliers.coverageSource,
      })
      .from(portSuppliers)
      .where(eq(portSuppliers.companyId, supplier.id));

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.contactId === contact!.id)).toBe(true);
    expect(rows.every((row) => row.coverageRuleId === summary.rule.id)).toBe(true);
    expect(rows.every((row) => row.coverageSource === 'company_place_supply_rule')).toBe(true);
    expect(rows.every((row) => row.note === 'Country rule')).toBe(true);
    expect(rows.every((row) => (row.products ?? []).join(',') === 'VLSFO,LSMGO')).toBe(true);
  });

  it('rejects overlapping active rules for the same country and place types', async () => {
    const { user } = await seedBasics();
    const { createCompany, createCompanyPlaceSupplyRule } = await loadCompanyService();

    const supplier = await createCompany({
      name: 'Overlap Supplier',
      types: ['SUPPLIER'],
      country: 'Denmark',
      countryIso: 'DNK',
    });

    await createCompanyPlaceSupplyRule(
      supplier.id,
      {
        countryIso: 'DNK',
        placeTypes: ['POR'],
      },
      user.id,
      user.name,
    );

    await expect(
      createCompanyPlaceSupplyRule(
        supplier.id,
        {
          countryIso: 'DNK',
          placeTypes: ['POR', 'ANC'],
        },
        user.id,
        user.name,
      ),
    ).rejects.toMatchObject({ code: 'OVERLAPPING_RULE' });
  });

  it('updates linked rows only after reapply and auto-applies to newly created matching places', async () => {
    const db = await getDb();
    const { user } = await seedBasics();
    const { createCompany, createCompanyPlaceSupplyRule, updateCompanyPlaceSupplyRule, reapplyCompanyPlaceSupplyRule } = await loadCompanyService();
    const { createPlace } = await loadLliService();

    const supplier = await createCompany({
      name: 'Auto Apply Supplier',
      types: ['SUPPLIER'],
      country: 'Denmark',
      countryIso: 'DNK',
    });

    const [originalContact, nextContact] = await db
      .insert(companyContacts)
      .values([
        { counterpartyId: supplier.id, name: 'Original Contact' },
        { counterpartyId: supplier.id, name: 'Updated Contact' },
      ])
      .returning();

    const [existingPlace] = await db
      .insert(places)
      .values({ name: 'Existing Port', country: 'DNK', countryIso: 'DNK', placeType: 'POR' })
      .returning();

    const created = await createCompanyPlaceSupplyRule(
      supplier.id,
      {
        countryIso: 'DNK',
        placeTypes: ['POR'],
        contactId: originalContact!.id,
        products: ['VLSFO'],
        note: 'Initial note',
      },
      user.id,
      user.name,
    );

    await updateCompanyPlaceSupplyRule(supplier.id, created.rule.id, {
      contactId: nextContact!.id,
      products: ['MGO'],
      note: 'Updated note',
    });

    const [beforeReapply] = await db
      .select({
        contactId: portSuppliers.contactId,
        products: portSuppliers.products,
        note: portSuppliers.note,
      })
      .from(portSuppliers)
      .where(and(eq(portSuppliers.placeId, existingPlace!.id), eq(portSuppliers.companyId, supplier.id)));

    expect(beforeReapply?.contactId).toBe(originalContact!.id);
    expect(beforeReapply?.products).toEqual(['VLSFO']);
    expect(beforeReapply?.note).toBe('Initial note');

    const reapplied = await reapplyCompanyPlaceSupplyRule(supplier.id, created.rule.id);
    expect(reapplied?.updated).toBe(1);

    const [afterReapply] = await db
      .select({
        contactId: portSuppliers.contactId,
        products: portSuppliers.products,
        note: portSuppliers.note,
      })
      .from(portSuppliers)
      .where(and(eq(portSuppliers.placeId, existingPlace!.id), eq(portSuppliers.companyId, supplier.id)));

    expect(afterReapply?.contactId).toBe(nextContact!.id);
    expect(afterReapply?.products).toEqual(['MGO']);
    expect(afterReapply?.note).toBe('Updated note');

    const createdPlace = await createPlace({
      name: 'New Matching Port',
      country: 'DNK',
      countryIso: 'DNK',
      placeType: 'POR',
    });

    const [autoApplied] = await db
      .select({
        coverageRuleId: portSuppliers.coverageRuleId,
        contactId: portSuppliers.contactId,
        products: portSuppliers.products,
        note: portSuppliers.note,
      })
      .from(portSuppliers)
      .where(and(eq(portSuppliers.placeId, createdPlace.id), eq(portSuppliers.companyId, supplier.id)));

    expect(autoApplied?.coverageRuleId).toBe(created.rule.id);
    expect(autoApplied?.contactId).toBe(nextContact!.id);
    expect(autoApplied?.products).toEqual(['MGO']);
    expect(autoApplied?.note).toBe('Updated note');
  });

  it('stops future auto-apply after deleting a rule without removing existing links', async () => {
    const db = await getDb();
    const { user } = await seedBasics();
    const { createCompany, createCompanyPlaceSupplyRule, deleteCompanyPlaceSupplyRule } = await loadCompanyService();
    const { createPlace } = await loadLliService();

    const supplier = await createCompany({
      name: 'Delete Rule Supplier',
      types: ['SUPPLIER'],
      country: 'Denmark',
      countryIso: 'DNK',
    });

    const [existingPlace] = await db
      .insert(places)
      .values({ name: 'Before Delete', country: 'DNK', countryIso: 'DNK', placeType: 'POR' })
      .returning();

    const created = await createCompanyPlaceSupplyRule(
      supplier.id,
      {
        countryIso: 'DNK',
        placeTypes: ['POR'],
      },
      user.id,
      user.name,
    );

    await deleteCompanyPlaceSupplyRule(supplier.id, created.rule.id);

    const [existingLink] = await db
      .select({ coverageRuleId: portSuppliers.coverageRuleId })
      .from(portSuppliers)
      .where(and(eq(portSuppliers.placeId, existingPlace!.id), eq(portSuppliers.companyId, supplier.id)));

    expect(existingLink).toBeTruthy();
    expect(existingLink?.coverageRuleId).toBeNull();

    const createdPlace = await createPlace({
      name: 'After Delete',
      country: 'DNK',
      countryIso: 'DNK',
      placeType: 'POR',
    });

    const rows = await db
      .select({ id: portSuppliers.id })
      .from(portSuppliers)
      .where(and(eq(portSuppliers.placeId, createdPlace.id), eq(portSuppliers.companyId, supplier.id)));

    expect(rows).toHaveLength(0);

    const remainingRules = await db
      .select({ id: companyPlaceSupplyRules.id })
      .from(companyPlaceSupplyRules)
      .where(eq(companyPlaceSupplyRules.companyId, supplier.id));

    expect(remainingRules).toHaveLength(0);
  });
});