import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';
import { companyContacts, counterparties, users, vesselCompanies } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';

type VesselServiceModule = typeof import('../src/modules/vessels/vessel.service');
let vesselService: VesselServiceModule;

let detailShouldThrow = false;
let searchShouldThrow = false;
let movementShouldThrow = false;
let detailResponse: Record<string, any> = {};
let searchResponse: Record<string, any> = { results: [], allMatchingCount: 0 };
let movementResponse: Record<string, any> = { results: [], allMatchingCount: 0 };

async function loadOrdersService() {
  return import('../src/modules/orders/orders.service');
}

beforeAll(async () => {
  mock.module('../src/modules/lloyds/lli.client', () => ({
    seasearcherVesselDetail: async () => {
      if (detailShouldThrow) throw new Error('detail failed');
      return detailResponse;
    },
    seasearcherVesselSearch: async () => {
      if (searchShouldThrow) throw new Error('search failed');
      return searchResponse;
    },
    seasearcherVesselMovements: async () => {
      if (movementShouldThrow) throw new Error('movements failed');
      return movementResponse;
    },
  }));

  vesselService = await import('../src/modules/vessels/vessel.service');
  mock.restore();
});

beforeEach(async () => {
  await truncateAll();
  detailShouldThrow = false;
  searchShouldThrow = false;
  movementShouldThrow = false;
  detailResponse = {
    id: 77,
    name: 'Sea Aurora',
    imo: 9876543,
    mmsi: 123456789,
    flag: { code: 'DK', name: 'Denmark' },
    type: 'Tanker',
    status: 'Active',
    lengthOverall: '200.5',
    breadthExtreme: '32.2',
    breadthMoulded: null,
    depth: '18.4',
    deadWeightTonnage: 55000,
    grossTonnage: 32000,
    buildYear: 2011,
    builtBy: 'Builder Yard',
    currentClassName: 'DNV',
    isSanctioned: false,
    latestInformation: {
      draught: 10.4,
      position: { lat: 1, lon: 2 },
      trueHeading: 90,
      aisSpeed: 12,
      destination: 'Singapore',
    },
  };
  searchResponse = {
    results: [
      {
        id: 77,
        name: 'Sea Aurora',
        imo: 9876543,
        mmsi: 123456789,
        flag: { code: 'DK', name: 'Denmark' },
        type: 'Tanker',
        status: 'Active',
        deadWeightTonnage: 55000,
        grossTonnage: 32000,
        loa: 200,
        breadthExtreme: 32,
        buildYear: 2011,
        isSanctioned: false,
      },
      {
        id: 78,
        name: 'Sea Aurora II',
        imo: 1111111,
        mmsi: 987654321,
        flag: { code: 'NO', name: 'Norway' },
        type: 'Barge',
        status: 'Idle',
        deadWeightTonnage: 12000,
        grossTonnage: 9000,
        loa: 110,
        breadthExtreme: 20,
        buildYear: 2018,
        isSanctioned: true,
      },
    ],
    allMatchingCount: 2,
  };
  movementResponse = {
    results: [{ port: 'Singapore', eta: '2026-03-08T00:00:00Z' }],
    allMatchingCount: 1,
  };
});

describe('vessel.service expanded flows', () => {
  it('imports, syncs, and enriches vessels from Seasearcher', async () => {
    await seedBasics();

    const imported = await vesselService.importVesselFromSeasearcher('77');
    expect(imported.seasearcherId).toBe('77');
    expect(imported.name).toBe('Sea Aurora');
    expect(imported.classificationSociety).toBe('DNV');

    const importedAgain = await vesselService.importVesselFromSeasearcher('77');
    expect(importedAgain.id).toBe(imported.id);

    detailResponse = {
      ...detailResponse,
      name: 'Sea Aurora Updated',
      currentClassName: 'ABS',
      latestInformation: { ...detailResponse.latestInformation, draught: 11.2 },
    };
    const synced = await vesselService.syncVesselFromSeasearcher(imported.id);
    expect(synced?.name).toBe('Sea Aurora Updated');
    expect(synced?.classificationSociety).toBe('ABS');
    expect(synced?.draught).toBe(11.2);

    const enrichment = await vesselService.getVesselEnrichment('77');
    expect(enrichment.name).toBe('Sea Aurora Updated');

    const movements = await vesselService.getVesselMovements('77');
    expect(movements.length).toBe(1);
    expect(movements[0]?.port).toBe('Singapore');
  });

  it('handles Seasearcher lookup, merge, and typeahead edge cases', async () => {
    await seedBasics();

    const local = await vesselService.createVessel({
      name: 'Manual Aurora',
      imo: '9876543',
    });

    const lookup = await vesselService.lookupSeasearcherByImo('9876543');
    expect(lookup?.seasearcherId).toBe('77');
    expect(lookup?.alreadyImportedByVesselId).toBeNull();

    const merged = await vesselService.mergeWithSeasearcher(local.id, '77');
    expect(merged?.seasearcherId).toBe('77');
    expect(merged?.name).toBe('Sea Aurora');

    await expect(vesselService.mergeWithSeasearcher(local.id, '78')).rejects.toThrow('already linked');

    const other = await vesselService.createVessel({ name: 'Other Manual' });
    await expect(vesselService.mergeWithSeasearcher(other.id, '77')).rejects.toThrow('already linked to this Seasearcher record');

    const typeahead = await vesselService.searchVesselsTypeahead('Aurora');
    expect(typeahead.some((item) => item.source === 'local' && item.localId === local.id)).toBe(true);
    expect(typeahead.some((item) => item.source === 'seasearcher' && item.seasearcherId === '78')).toBe(true);
    expect(typeahead.some((item) => item.source === 'seasearcher' && item.seasearcherId === '77')).toBe(false);

    searchShouldThrow = true;
    const localOnly = await vesselService.searchVesselsTypeahead('Aurora');
    expect(localOnly.some((item) => item.source === 'local')).toBe(true);

    detailShouldThrow = true;
    const failedLookup = await vesselService.lookupSeasearcherByImo('9876543');
    expect(failedLookup).toBeNull();
  });

  it('returns vessel orders and manages vessel company role workflows', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const db = await getDb();
    const { createOrder } = await loadOrdersService();

    const order = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    const vesselOrders = await vesselService.getOrdersForVessel(vessel.id);
    expect(vesselOrders.length).toBe(1);
    expect(vesselOrders[0]?.id).toBe(order.id);
    expect(vesselOrders[0]?.clientName).toBe(client.name);
    expect(vesselOrders[0]?.placeName).toBe(place.name);

    const [companyA] = await db.insert(counterparties).values({
      tenantId: tenant.id,
      name: 'Manager A',
      type: 'SUPPLIER',
      types: ['SUPPLIER'],
      country: 'Denmark',
    }).returning();
    const [companyB] = await db.insert(counterparties).values({
      tenantId: tenant.id,
      name: 'Manager B',
      type: 'SUPPLIER',
      types: ['SUPPLIER'],
      country: 'Norway',
    }).returning();
    const [contactA] = await db.insert(companyContacts).values({
      counterpartyId: companyA.id,
      name: 'Alice Contact',
      email: 'alice@managera.test',
    }).returning();

    const createdRole = await vesselService.addVesselCompany(vessel.id, {
      companyId: companyA.id,
      role: 'MANAGER',
      contactId: contactA.id,
      note: 'primary',
    }, user.id, user.name);
    expect(createdRole?.companyName).toBe('Manager A');
    expect(createdRole?.contactName).toBe('Alice Contact');

    await expect(vesselService.addVesselCompany(vessel.id, {
      companyId: companyB.id,
      role: 'MANAGER',
    }, user.id, user.name)).rejects.toThrow('Role already exists');

    const replacedRole = await vesselService.addVesselCompany(vessel.id, {
      companyId: companyB.id,
      role: 'MANAGER',
      replaceExistingRole: true,
      note: 'replaced',
    }, user.id, user.name);
    expect(replacedRole?.companyName).toBe('Manager B');
    expect(replacedRole?.note).toBe('replaced');

    const [chartererCompany] = await db.insert(counterparties).values({
      tenantId: tenant.id,
      name: 'Charterer Co',
      type: 'CLIENT',
      types: ['CLIENT'],
      country: 'Sweden',
    }).returning();

    const chartererRole = await vesselService.addVesselCompany(vessel.id, {
      companyId: chartererCompany.id,
      role: 'CHARTERER',
    }, user.id, user.name);

    await expect(vesselService.updateVesselCompany(chartererRole!.id, { role: 'MANAGER' })).rejects.toThrow('Role already exists');

    const updatedRole = await vesselService.updateVesselCompany(chartererRole!.id, { note: 'updated note' });
    expect(updatedRole?.note).toBe('updated note');

    const listedRoles = await vesselService.getVesselCompanies(vessel.id);
    expect(listedRoles.length).toBe(2);

    const deletedRole = await vesselService.deleteVesselCompany(chartererRole!.id);
    expect(deletedRole?.companyName).toBe('Charterer Co');
    const missingDelete = await vesselService.deleteVesselCompany(chartererRole!.id);
    expect(missingDelete).toBeNull();

    const dbRoles = await db.select().from(vesselCompanies).where(eq(vesselCompanies.vesselId, vessel.id));
    expect(dbRoles.length).toBe(1);
  });
});