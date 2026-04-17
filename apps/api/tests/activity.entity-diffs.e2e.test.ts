import { beforeEach, describe, expect, it } from 'bun:test';
import { seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

async function waitForActivityActions(
  token: string,
  entityType: string,
  entityId: string,
  expectedActions: string[],
) {
  let items: any[] = [];
  const start = Date.now();

  while (Date.now() - start < 1500) {
    const res = await requestJson(`/activity/${entityType}/${entityId}?limit=20&offset=0`, { token });
    items = Array.isArray(res.data?.data?.items) ? res.data?.data?.items : [];
    const actions = new Set(
      items
        .map((item: any) => item.metadata?.action)
        .filter((action: unknown): action is string => typeof action === 'string'),
    );

    if (expectedActions.every((action) => actions.has(action))) {
      return items;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return items;
}

describe('activity entity diffs e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('stores compact diffs for company, vessel, and place updates', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const createdCompany = await requestJson('/companies/local', {
      method: 'POST',
      token,
      body: {
        name: 'Activity Diff Co',
        types: ['CLIENT'],
        country: 'Denmark',
      },
    });

    expect(createdCompany.status).toBe(200);
    expect(createdCompany.data?.success).toBe(true);
    const companyId = createdCompany.data?.data?.id as string;
    expect(companyId).toBeTruthy();

    await requestJson(`/companies/local/${companyId}`, {
      method: 'PATCH',
      token,
      body: {
        name: 'Activity Diff Co Updated',
        country: 'Norway',
      },
    });

    await requestJson(`/companies/local/${companyId}/types`, {
      method: 'PATCH',
      token,
      body: {
        types: ['CLIENT', 'SUPPLIER'],
      },
    });

    await requestJson(`/companies/local/${companyId}/segments`, {
      method: 'PATCH',
      token,
      body: {
        segments: {
          business: ['spot'],
          region: 'eu',
        },
      },
    });

    await requestJson(`/companies/local/${companyId}/responsible-user`, {
      method: 'PATCH',
      token,
      body: {
        userId: seeded.user.id,
      },
    });

    const companyItems = await waitForActivityActions(token!, 'company', companyId, [
      'update_company_fields',
      'update_company_types',
      'update_company_segments',
      'update_company_responsible_user',
    ]);

    expect(companyItems.find((item: any) => item.metadata?.action === 'update_company_fields')?.metadata?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'name', from: 'Activity Diff Co', to: 'Activity Diff Co Updated' }),
        expect.objectContaining({ field: 'country', from: 'Denmark', to: 'Norway' }),
      ]),
    );
    expect(companyItems.find((item: any) => item.metadata?.action === 'update_company_types')?.metadata?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'types', from: ['CLIENT'], to: ['CLIENT', 'SUPPLIER'] }),
      ]),
    );
    expect(companyItems.find((item: any) => item.metadata?.action === 'update_company_segments')?.metadata?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'segments',
          from: {},
          to: { business: ['spot'], region: 'eu' },
        }),
      ]),
    );
    expect(companyItems.find((item: any) => item.metadata?.action === 'update_company_responsible_user')?.metadata?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'responsibleUserId', from: null, to: seeded.user.name }),
      ]),
    );
    expect(companyItems.some((item: any) => item.httpPath === `/companies/local/${companyId}`)).toBe(false);
    expect(companyItems.some((item: any) => item.httpPath === `/companies/local/${companyId}/types`)).toBe(false);
    expect(companyItems.some((item: any) => item.httpPath === `/companies/local/${companyId}/segments`)).toBe(false);
    expect(companyItems.some((item: any) => item.httpPath === `/companies/local/${companyId}/responsible-user`)).toBe(false);

    const createdVessel = await requestJson('/vessels/local', {
      method: 'POST',
      token,
      body: {
        name: 'Activity Diff Vessel',
      },
    });

    expect(createdVessel.status).toBe(200);
    expect(createdVessel.data?.success).toBe(true);
    const vesselId = createdVessel.data?.data?.id as string;
    expect(vesselId).toBeTruthy();

    await requestJson(`/vessels/local/${vesselId}`, {
      method: 'PATCH',
      token,
      body: {
        name: 'Activity Diff Vessel Updated',
        flag: 'NO',
        ignoreForCreditEnforcement: true,
      },
    });

    const vesselItems = await waitForActivityActions(token!, 'vessel', vesselId, ['update_vessel_fields']);

    expect(vesselItems.find((item: any) => item.metadata?.action === 'update_vessel_fields')?.metadata?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'name', from: 'Activity Diff Vessel', to: 'Activity Diff Vessel Updated' }),
        expect.objectContaining({ field: 'flag', from: null, to: 'NO' }),
        expect.objectContaining({ field: 'ignoreForCreditEnforcement', from: false, to: true }),
      ]),
    );
    expect(vesselItems.some((item: any) => item.httpPath === `/vessels/local/${vesselId}`)).toBe(false);

    const createdPlace = await requestJson('/lloyds/places/local', {
      method: 'POST',
      token,
      body: {
        name: 'Activity Diff Port',
        country: 'Denmark',
        countryIso: 'DK',
      },
    });

    expect(createdPlace.status).toBe(200);
    expect(createdPlace.data?.success).toBe(true);
    const placeId = createdPlace.data?.data?.id as string;
    expect(placeId).toBeTruthy();

    await requestJson(`/lloyds/places/local/${placeId}`, {
      method: 'PUT',
      token,
      body: {
        name: 'Activity Diff Port Updated',
        area: 'Skagerrak',
      },
    });

    await requestJson(`/lloyds/places/local/${placeId}/order-remark`, {
      method: 'PUT',
      token,
      body: {
        orderRemark: 'Pilot required',
      },
    });

    const placeItems = await waitForActivityActions(token!, 'place', placeId, [
      'update_place_fields',
      'update_place_order_remark',
    ]);

    expect(placeItems.find((item: any) => item.metadata?.action === 'update_place_fields')?.metadata?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'name', from: 'Activity Diff Port', to: 'Activity Diff Port Updated' }),
        expect.objectContaining({ field: 'area', from: null, to: 'Skagerrak' }),
      ]),
    );
    expect(placeItems.find((item: any) => item.metadata?.action === 'update_place_order_remark')?.metadata?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'orderRemark', from: null, to: 'Pilot required' }),
      ]),
    );
    expect(placeItems.some((item: any) => item.httpPath === `/lloyds/places/local/${placeId}`)).toBe(false);
    expect(placeItems.some((item: any) => item.httpPath === `/lloyds/places/local/${placeId}/order-remark`)).toBe(false);
  });
});