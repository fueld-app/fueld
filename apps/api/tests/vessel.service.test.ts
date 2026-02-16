import { beforeEach, describe, expect, it } from 'bun:test';
import { seedBasics, truncateAll } from './helpers/db';

async function loadVesselService() {
  return import('../src/modules/vessels/vessel.service');
}

beforeEach(async () => {
  await truncateAll();
});

describe('vessel.service local DB flows', () => {
  it('creates, gets, updates, lists, matches, and deletes vessels', async () => {
    await seedBasics();
    const {
      createVessel,
      getVesselById,
      getVesselBySeasearcherId,
      listVessels,
      matchLocalVessels,
      updateVessel,
      deleteVessel,
    } = await loadVesselService();

    const created = await createVessel({
      name: 'Aurora Pioneer',
      imo: '9876543',
      mmsi: '123456789',
      flag: 'Denmark',
      flagCode: 'DK',
      type: 'Tanker',
      status: 'Active',
      deadWeightTonnage: 50000,
      grossTonnage: 25000,
      buildYear: 2015,
      seasearcherId: '55555',
    });

    expect(created.id).toBeTruthy();
    expect(created.name).toBe('Aurora Pioneer');

    const byId = await getVesselById(created.id);
    expect(byId?.imo).toBe('9876543');

    const bySea = await getVesselBySeasearcherId('55555');
    expect(bySea?.id).toBe(created.id);

    const listed = await listVessels({ search: 'Aurora', limit: 10, page: 1, sortBy: 'name' });
    expect(listed.total).toBeGreaterThanOrEqual(1);
    expect(listed.vessels.some((v) => v.id === created.id)).toBe(true);

    const matchesByImo = await matchLocalVessels({ imos: ['9876543'] });
    expect(matchesByImo.some((v) => v.id === created.id)).toBe(true);

    const matchesBySeasearcher = await matchLocalVessels({ seasearcherIds: ['55555'] });
    expect(matchesBySeasearcher.some((v) => v.id === created.id)).toBe(true);

    const updated = await updateVessel(created.id, {
      name: 'Aurora Pioneer II',
      status: 'Laid Up',
      classificationSociety: 'DNV',
    });
    expect(updated?.name).toBe('Aurora Pioneer II');
    expect(updated?.status).toBe('Laid Up');
    expect(updated?.classificationSociety).toBe('DNV');

    const deleted = await deleteVessel(created.id);
    expect(deleted?.id).toBe(created.id);

    const missing = await getVesselById(created.id);
    expect(missing).toBeNull();
  });

  it('returns empty matches when no identifiers are provided', async () => {
    await seedBasics();
    const { matchLocalVessels } = await loadVesselService();

    const matches = await matchLocalVessels({ seasearcherIds: [], imos: [] });
    expect(matches).toEqual([]);
  });
});
