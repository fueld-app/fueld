import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { orders, tenants, users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson, requestRaw } from './helpers/e2e';

describe('port documentation workflows', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('blocks the order context when the feature is disabled', async () => {
    const { user, password, tenant, client, vessel, place } = await seedAuthBasics();
    const db = await getDb();
    const { createOrder } = await import('../src/modules/orders/orders.service');

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, user.id));

    const order = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    const login = await loginE2E(user.email, password);
    const res = await requestJson(`/orders/${order.id}/port-documentation`, {
      token: login.accessToken,
    });

    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(false);
    expect(String(res.data?.message ?? '')).toContain('disabled');
  });

  it('supports asset upload, preview, generation, inclusion, and downloads when enabled', async () => {
    const { user, password, tenant, client, vessel, place } = await seedAuthBasics();
    const db = await getDb();
    const { createOrder, saveOrderItems } = await import('../src/modules/orders/orders.service');

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, user.id));

    await db
      .update(tenants)
      .set({ settings: { portDocumentationSettings: { enabled: true } }, updatedAt: new Date() })
      .where(eq(tenants.id, tenant.id));

    const order = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    await saveOrderItems(order.id, [
      {
        productType: 'VLSFO',
        quantity: '120',
        unit: 'MT',
        salesPrice: '550',
      } as never,
    ]);

    await db
      .update(orders)
      .set({ eta: new Date('2026-05-19T12:00:00.000Z'), updatedAt: new Date() })
      .where(eq(orders.id, order.id));

    const login = await loginE2E(user.email, password);
    const token = login.accessToken;
    expect(token).toBeTruthy();

    const preview = await requestJson(`/orders/${order.id}/port-documentation/bunker-instructions/preview`, {
      token,
    });
    expect(preview.status).toBe(200);
    expect(preview.data?.success).toBe(true);
    expect(preview.data?.data?.sections?.length).toBeGreaterThan(0);
    expect(preview.data?.data?.warnings).toContain('Agent is missing on the order.');

    const uploadForm = new FormData();
    uploadForm.set(
      'file',
      new File([
        'worksheet,data\nalpha,1\n',
      ], 'flange-worksheet.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );

    const upload = await requestRaw('/admin/port-documentation/assets/flange-worksheet', {
      method: 'POST',
      token,
      body: uploadForm,
    });
    expect(upload.status).toBe(200);
    expect(upload.data?.success).toBe(true);
    expect(upload.data?.data?.documentKind).toBe('FLANGE_WORKSHEET');
    const assetId = upload.data?.data?.id as string;

    const include = await requestJson(`/orders/${order.id}/port-documentation/flange-worksheet/include`, {
      method: 'POST',
      token,
      body: {},
    });
    expect(include.status).toBe(200);
    expect(include.data?.success).toBe(true);
    expect(include.data?.data?.documentKind).toBe('FLANGE_WORKSHEET');

    const bunker = await requestJson(`/orders/${order.id}/port-documentation/bunker-instructions/generate`, {
      method: 'POST',
      token,
      body: {},
    });
    expect(bunker.status).toBe(200);
    expect(bunker.data?.success).toBe(true);
    expect(bunker.data?.data?.documentKind).toBe('BUNKER_INSTRUCTIONS');

    const gateList = await requestJson(`/orders/${order.id}/port-documentation/gate-list/generate`, {
      method: 'POST',
      token,
      body: {},
    });
    expect(gateList.status).toBe(200);
    expect(gateList.data?.success).toBe(true);
    expect(gateList.data?.data?.documentKind).toBe('GATE_LIST');

    const context = await requestJson(`/orders/${order.id}/port-documentation`, {
      token,
    });
    expect(context.status).toBe(200);
    expect(context.data?.success).toBe(true);
    expect(context.data?.data?.currentFlangeWorksheet?.id).toBe(assetId);
    expect(context.data?.data?.documents).toHaveLength(3);

    const generatedDocument = (context.data?.data?.documents as Array<{ id: string; documentKind: string }>).find(
      (doc) => doc.documentKind === 'BUNKER_INSTRUCTIONS',
    );
    expect(generatedDocument?.id).toBeTruthy();

    const assetDownload = await requestRaw(`/admin/port-documentation/assets/${assetId}/download`, {
      token,
    });
    expect(assetDownload.status).toBe(200);
    expect(assetDownload.headers.get('content-disposition')).toContain('flange-worksheet.xlsx');

    const docDownload = await requestRaw(`/orders/${order.id}/port-documentation/documents/${generatedDocument!.id}/download`, {
      token,
    });
    expect(docDownload.status).toBe(200);
    expect(docDownload.headers.get('content-type')).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(docDownload.headers.get('content-disposition')).toContain('bunker-instructions_');
  });
});
