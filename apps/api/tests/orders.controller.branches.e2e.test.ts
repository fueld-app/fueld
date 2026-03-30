import { beforeEach, describe, expect, it } from 'bun:test';
import { seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson, requestRaw } from './helpers/e2e';

describe('orders controller branch e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('maps missing-order branches across activity, items, status, payments, and attachments routes', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const missingId = 'ORDER-DOES-NOT-EXIST';

    const activity = await requestJson(`/orders/${missingId}/activity`, { token });
    expect(activity.status).toBe(200);
    expect(activity.data?.success).toBe(false);
    expect(String(activity.data?.message ?? '')).toContain('Order not found');

    const saveItems = await requestJson(`/orders/${missingId}/items`, {
      method: 'PUT',
      token,
      body: {
        items: [{ productType: 'MGO', quantity: '1' }],
      },
    });
    expect(saveItems.status).toBe(200);
    expect(saveItems.data?.success).toBe(false);
    expect(String(saveItems.data?.message ?? '')).toContain('Order not found');

    const status = await requestJson(`/orders/${missingId}/status`, {
      method: 'PUT',
      token,
      body: { status: 'CONFIRMED' },
    });
    expect(status.status).toBe(200);
    expect(status.data?.success).toBe(false);
    expect(String(status.data?.message ?? '')).toContain('Order not found');

    const paymentsGet = await requestJson(`/orders/${missingId}/payments`, { token });
    expect(paymentsGet.status).toBe(200);
    expect(paymentsGet.data?.success).toBe(false);
    expect(String(paymentsGet.data?.message ?? '')).toContain('Order not found');

    const paymentsCreate = await requestJson(`/orders/${missingId}/payments`, {
      method: 'POST',
      token,
      body: { amount: '10.00', currency: 'USD' },
    });
    expect(paymentsCreate.status).toBe(200);
    expect(paymentsCreate.data?.success).toBe(false);
    expect(String(paymentsCreate.data?.message ?? '')).toContain('Order not found');

    const attachmentsGet = await requestJson(`/orders/${missingId}/attachments`, { token });
    expect(attachmentsGet.status).toBe(200);
    expect(attachmentsGet.data?.success).toBe(false);
    expect(String(attachmentsGet.data?.message ?? '')).toContain('Order not found');

    const uploadForm = new FormData();
    uploadForm.set('type', 'OTHER');
    uploadForm.set('file', new File(['hello'], 'test.pdf', { type: 'application/pdf' }));

    const attachmentsCreate = await requestRaw(`/orders/${missingId}/attachments`, {
      method: 'POST',
      token,
      body: uploadForm,
    });
    expect(attachmentsCreate.status).toBe(200);
    expect((attachmentsCreate.data as any)?.success).toBe(false);
    expect(String((attachmentsCreate.data as any)?.message ?? '')).toContain('Order not found');
  });

  it('returns create-failed branch when payload violates relational constraints', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: {
        clientId: '123e4567-e89b-12d3-a456-426614174000',
        vesselId: seeded.vessel.id,
        placeId: seeded.place.id,
      },
    });

    expect(created.status).toBe(200);
    expect(created.data?.success).toBe(false);
    expect(String(created.data?.message ?? '')).toContain('Failed to create order');
  });

  it('returns oversize attachment validation branch', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: {
        clientId: seeded.client.id,
        vesselId: seeded.vessel.id,
        placeId: seeded.place.id,
      },
    });

    expect(created.status).toBe(200);
    expect(created.data?.success).toBe(true);

    const orderId = created.data?.data?.id as string;
    expect(orderId).toBeTruthy();

    const tooLargeForm = new FormData();
    tooLargeForm.set('type', 'OTHER');
    tooLargeForm.set(
      'file',
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' }),
    );

    const upload = await requestRaw(`/orders/${orderId}/attachments`, {
      method: 'POST',
      token,
      body: tooLargeForm,
    });

    expect(upload.status).toBe(200);
    expect((upload.data as any)?.success).toBe(false);
    expect(String((upload.data as any)?.message ?? '')).toContain('Attachment must be under 10 MB');
  });

  it('enforces inquiry status validation rules for confirm/cancel', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: {
        clientId: seeded.client.id,
        vesselId: seeded.vessel.id,
        placeId: seeded.place.id,
      },
    });

    expect(created.status).toBe(200);
    expect(created.data?.success).toBe(true);

    const orderId = created.data?.data?.id as string;
    expect(orderId).toBeTruthy();

    const confirmWithoutItems = await requestJson(`/orders/${orderId}/status`, {
      method: 'PUT',
      token,
      body: { status: 'CONFIRMED' },
    });
    expect(confirmWithoutItems.status).toBe(200);
    expect(confirmWithoutItems.data?.success).toBe(false);
    expect(String(confirmWithoutItems.data?.message ?? '')).toContain('Add at least one line item');

    const cancelNoReason = await requestJson(`/orders/${orderId}/status`, {
      method: 'PUT',
      token,
      body: { status: 'CANCELLED' },
    });
    expect(cancelNoReason.status).toBe(200);
    expect(cancelNoReason.data?.success).toBe(false);
    expect(String(cancelNoReason.data?.message ?? '')).toContain('Cancellation reason is required');

    const cancelInvalidReason = await requestJson(`/orders/${orderId}/status`, {
      method: 'PUT',
      token,
      body: { status: 'CANCELLED', lossReason: 'Not in configured list' },
    });
    expect(cancelInvalidReason.status).toBe(200);
    expect(cancelInvalidReason.data?.success).toBe(false);
    expect(String(cancelInvalidReason.data?.message ?? '')).toContain('Invalid cancellation reason');

    const cancelValidReason = await requestJson(`/orders/${orderId}/status`, {
      method: 'PUT',
      token,
      body: { status: 'CANCELLED', lossReason: 'Price not competitive' },
    });
    expect(cancelValidReason.status).toBe(200);
    expect(cancelValidReason.data?.success).toBe(true);
    expect(cancelValidReason.data?.data?.status).toBe('CANCELLED');
    expect(cancelValidReason.data?.data?.lossReason).toBe('Price not competitive');
  });

  it('requires configured cancellation reasons for non-inquiry orders too', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: {
        clientId: seeded.client.id,
        vesselId: seeded.vessel.id,
        placeId: seeded.place.id,
      },
    });

    const orderId = created.data?.data?.id as string;

    const saveItems = await requestJson(`/orders/${orderId}/items`, {
      method: 'PUT',
      token,
      body: {
        items: [{ productType: 'MGO', quantity: '1', unit: 'MT' }],
      },
    });
    expect(saveItems.status).toBe(200);
    expect(saveItems.data?.success).toBe(true);

    const confirm = await requestJson(`/orders/${orderId}/status`, {
      method: 'PUT',
      token,
      body: { status: 'CONFIRMED' },
    });
    expect(confirm.status).toBe(200);
    expect(confirm.data?.success).toBe(true);

    const cancelConfirmedNoReason = await requestJson(`/orders/${orderId}/status`, {
      method: 'PUT',
      token,
      body: { status: 'CANCELLED' },
    });
    expect(cancelConfirmedNoReason.status).toBe(200);
    expect(cancelConfirmedNoReason.data?.success).toBe(false);
    expect(String(cancelConfirmedNoReason.data?.message ?? '')).toContain('Cancellation reason is required');

    const cancelConfirmedInvalidReason = await requestJson(`/orders/${orderId}/status`, {
      method: 'PUT',
      token,
      body: { status: 'CANCELLED', lossReason: 'Not in configured list' },
    });
    expect(cancelConfirmedInvalidReason.status).toBe(200);
    expect(cancelConfirmedInvalidReason.data?.success).toBe(false);
    expect(String(cancelConfirmedInvalidReason.data?.message ?? '')).toContain('Invalid cancellation reason');

    const cancelConfirmedValidReason = await requestJson(`/orders/${orderId}/status`, {
      method: 'PUT',
      token,
      body: { status: 'CANCELLED', lossReason: 'Price not competitive' },
    });
    expect(cancelConfirmedValidReason.status).toBe(200);
    expect(cancelConfirmedValidReason.data?.success).toBe(true);
    expect(cancelConfirmedValidReason.data?.data?.status).toBe('CANCELLED');
    expect(cancelConfirmedValidReason.data?.data?.lossReason).toBe('Price not competitive');
  });
});
