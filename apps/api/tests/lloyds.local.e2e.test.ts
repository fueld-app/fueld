import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { places, users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

describe('lloyds local e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('enforces auth on lloyds routes', async () => {
    const res = await requestJson('/lloyds/places/local');
    expect(res.status).toBe(401);
  });

  it('supports local place + supplier + responsible user flows', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const created = await requestJson('/lloyds/places/local', {
      method: 'POST',
      token,
      body: {
        name: 'E2E Port',
        country: 'Denmark',
        countryIso: 'DK',
        area: 'North Sea',
        placeType: 'POR',
      },
    });

    expect(created.status).toBe(200);
    expect(created.data?.success).toBe(true);
    const placeId = created.data?.data?.id as string;
    expect(placeId).toBeTruthy();

    const listed = await requestJson('/lloyds/places/local?search=E2E', { token });
    expect(listed.status).toBe(200);
    expect(listed.data?.success).toBe(true);
    expect(listed.data?.data?.total).toBeGreaterThanOrEqual(1);

    const byId = await requestJson(`/lloyds/places/local/${placeId}`, { token });
    expect(byId.status).toBe(200);
    expect(byId.data?.success).toBe(true);
    expect(byId.data?.data?.name).toBe('E2E Port');

    const byLliMissing = await requestJson('/lloyds/places/by-lli/does-not-exist', { token });
    expect(byLliMissing.status).toBe(200);
    expect(byLliMissing.data?.success).toBe(false);

    const updated = await requestJson(`/lloyds/places/local/${placeId}`, {
      method: 'PUT',
      token,
      body: {
        name: 'E2E Port Updated',
        area: 'Skagerrak',
      },
    });
    expect(updated.status).toBe(200);
    expect(updated.data?.success).toBe(true);
    expect(updated.data?.data?.name).toBe('E2E Port Updated');

    const responsible = await requestJson(`/lloyds/places/local/${placeId}/responsible-user`, {
      method: 'PATCH',
      token,
      body: { userId: seeded.user.id },
    });
    expect(responsible.status).toBe(200);
    expect(responsible.data?.success).toBe(true);
    expect(responsible.data?.data?.responsibleUserId).toBe(seeded.user.id);

    const usersRes = await requestJson('/lloyds/users', { token });
    expect(usersRes.status).toBe(200);
    expect(usersRes.data?.success).toBe(true);
    expect(Array.isArray(usersRes.data?.data)).toBe(true);
    expect((usersRes.data?.data ?? []).some((u: { id: string }) => u.id === seeded.user.id)).toBe(true);

    const placeOrders = await requestJson(`/lloyds/places/local/${placeId}/orders`, { token });
    expect(placeOrders.status).toBe(200);
    expect(placeOrders.data?.success).toBe(true);
    expect(Array.isArray(placeOrders.data?.data)).toBe(true);
    expect(placeOrders.data?.data?.length).toBe(0);

    const supplierCreated = await requestJson(`/lloyds/places/local/${placeId}/suppliers`, {
      method: 'POST',
      token,
      body: {
        companyId: seeded.client.id,
        products: ['MGO', 'VLSFO'],
        note: 'Preferred supplier',
      },
    });
    expect(supplierCreated.status).toBe(200);
    expect(supplierCreated.data?.success).toBe(true);
    const supplierId = supplierCreated.data?.data?.id as string;
    expect(supplierId).toBeTruthy();

    const supplierList = await requestJson(`/lloyds/places/local/${placeId}/suppliers`, { token });
    expect(supplierList.status).toBe(200);
    expect(supplierList.data?.success).toBe(true);
    expect(supplierList.data?.data?.length).toBe(1);

    const supplierUpdated = await requestJson(`/lloyds/places/suppliers/${supplierId}`, {
      method: 'PUT',
      token,
      body: {
        products: ['MGO'],
        note: 'Updated note',
      },
    });
    expect(supplierUpdated.status).toBe(200);
    expect(supplierUpdated.data?.success).toBe(true);
    expect(supplierUpdated.data?.data?.products).toEqual(['MGO']);

    const supplierDeleted = await requestJson(`/lloyds/places/suppliers/${supplierId}`, {
      method: 'DELETE',
      token,
    });
    expect(supplierDeleted.status).toBe(200);
    expect(supplierDeleted.data?.success).toBe(true);

    const supplierListAfter = await requestJson(`/lloyds/places/local/${placeId}/suppliers`, { token });
    expect(supplierListAfter.status).toBe(200);
    expect(supplierListAfter.data?.success).toBe(true);
    expect(supplierListAfter.data?.data?.length).toBe(0);
  });

  it('covers admin delete guard and synced-place update conflict', async () => {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    const loginTrader = await loginE2E(seeded.user.email, seeded.password);
    const traderToken = loginTrader.accessToken;

    const seededPlace = await requestJson('/lloyds/places/local', {
      method: 'POST',
      token: traderToken,
      body: {
        name: 'Guard Place',
        country: 'Denmark',
      },
    });
    const placeId = seededPlace.data?.data?.id as string;

    const traderDelete = await requestJson(`/lloyds/places/local/${placeId}`, {
      method: 'DELETE',
      token: traderToken,
    });
    expect(traderDelete.status).toBe(403);
    expect(traderDelete.data?.success).toBe(false);
    expect(String(traderDelete.data?.message ?? '')).toContain('Only admins can delete places');

    await db
      .update(places)
      .set({ lliPlaceId: 'lli-e2e-id', updatedAt: new Date() })
      .where(eq(places.id, placeId));

    const syncedUpdate = await requestJson(`/lloyds/places/local/${placeId}`, {
      method: 'PUT',
      token: traderToken,
      body: { name: 'Should Fail' },
    });
    expect(syncedUpdate.status).toBe(409);
    expect(syncedUpdate.data?.success).toBe(false);
    expect(String(syncedUpdate.data?.message ?? '')).toContain('cannot be edited manually');

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const loginAdmin = await loginE2E(seeded.user.email, seeded.password);
    const adminToken = loginAdmin.accessToken;

    const adminDeleteMissing = await requestJson('/lloyds/places/local/123e4567-e89b-12d3-a456-426614174000', {
      method: 'DELETE',
      token: adminToken,
    });
    expect(adminDeleteMissing.status).toBe(200);
    expect(adminDeleteMissing.data?.success).toBe(false);
    expect(String(adminDeleteMissing.data?.message ?? '')).toContain('Place not found');

    const adminDelete = await requestJson(`/lloyds/places/local/${placeId}`, {
      method: 'DELETE',
      token: adminToken,
    });
    expect(adminDelete.status).toBe(200);
    expect(adminDelete.data?.success).toBe(true);
  });

  it('covers lloyds missing-resource and supplier not-found branches', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const getMissing = await requestJson('/lloyds/places/local/123e4567-e89b-12d3-a456-426614174000', { token });
    expect(getMissing.status).toBe(200);
    expect(getMissing.data?.success).toBe(false);
    expect(String(getMissing.data?.error ?? '')).toContain('Place not found');

    const updateMissing = await requestJson('/lloyds/places/local/123e4567-e89b-12d3-a456-426614174000', {
      method: 'PUT',
      token,
      body: { name: 'Missing' },
    });
    expect(updateMissing.status).toBe(404);
    expect(updateMissing.data?.success).toBe(false);
    expect(String(updateMissing.data?.message ?? '')).toContain('Place not found');

    const syncMissing = await requestJson('/lloyds/places/local/123e4567-e89b-12d3-a456-426614174000/sync', {
      method: 'POST',
      token,
    });
    expect(syncMissing.status).toBe(200);
    expect(syncMissing.data?.success).toBe(false);
    expect(String(syncMissing.data?.message ?? '')).toContain('Place not found or no Seasearcher ID');

    const supplierUpdateMissing = await requestJson('/lloyds/places/suppliers/123e4567-e89b-12d3-a456-426614174000', {
      method: 'PUT',
      token,
      body: { note: 'x' },
    });
    expect(supplierUpdateMissing.status).toBe(200);
    expect(supplierUpdateMissing.data?.success).toBe(false);
    expect(String(supplierUpdateMissing.data?.message ?? '')).toContain('Supplier not found');

    const supplierDeleteMissing = await requestJson('/lloyds/places/suppliers/123e4567-e89b-12d3-a456-426614174000', {
      method: 'DELETE',
      token,
    });
    expect(supplierDeleteMissing.status).toBe(200);
    expect(supplierDeleteMissing.data?.success).toBe(false);
    expect(String(supplierDeleteMissing.data?.message ?? '')).toContain('Supplier not found');

    const responsibleMissing = await requestJson('/lloyds/places/local/123e4567-e89b-12d3-a456-426614174000/responsible-user', {
      method: 'PATCH',
      token,
      body: { userId: seeded.user.id },
    });
    expect(responsibleMissing.status).toBe(200);
    expect(responsibleMissing.data?.success).toBe(false);
    expect(String(responsibleMissing.data?.message ?? '')).toContain('Place not found');
  });

  it('returns 409 when admin deletes a place referenced by orders', async () => {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const created = await requestJson('/lloyds/places/local', {
      method: 'POST',
      token,
      body: {
        name: 'FK Place',
        country: 'Denmark',
      },
    });
    expect(created.status).toBe(200);
    expect(created.data?.success).toBe(true);
    const placeId = created.data?.data?.id as string;

    const order = await requestJson('/orders', {
      method: 'POST',
      token,
      body: {
        clientId: seeded.client.id,
        vesselId: seeded.vessel.id,
        placeId,
      },
    });
    expect(order.status).toBe(200);
    expect(order.data?.success).toBe(true);

    const deleteReferenced = await requestJson(`/lloyds/places/local/${placeId}`, {
      method: 'DELETE',
      token,
    });
    expect(deleteReferenced.status).toBe(409);
    expect(deleteReferenced.data?.success).toBe(false);
    expect(String(deleteReferenced.data?.message ?? '')).toContain('referenced by one or more orders');
  });
});
