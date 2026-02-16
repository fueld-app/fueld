import { beforeEach, describe, expect, it } from 'bun:test';
import { seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

describe('comments e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('creates, lists, updates, and deletes comments through API', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    expect(token).toBeTruthy();

    const createdOrder = await requestJson('/orders', {
      method: 'POST',
      token,
      body: {
        clientId: seeded.client.id,
        vesselId: seeded.vessel.id,
        placeId: seeded.place.id,
      },
    });

    expect(createdOrder.status).toBe(200);
    expect(createdOrder.data?.success).toBe(true);

    const orderId = createdOrder.data?.data?.id as string;
    const orderNumber = createdOrder.data?.data?.orderNumber as string;

    expect(orderId).toBeTruthy();
    expect(orderNumber).toBeTruthy();

    const createdComment = await requestJson(`/comments/order/${orderNumber}`, {
      method: 'POST',
      token,
      body: { content: 'Initial comment' },
    });

    expect(createdComment.status).toBe(200);
    expect(createdComment.data?.success).toBe(true);
    expect(createdComment.data?.data?.content).toBe('Initial comment');

    const commentId = createdComment.data?.data?.id as string;
    expect(commentId).toBeTruthy();

    const listed = await requestJson(`/comments/order/${orderId}`, { token });
    expect(listed.status).toBe(200);
    expect(listed.data?.success).toBe(true);
    expect(Array.isArray(listed.data?.data)).toBe(true);
    expect(listed.data?.data?.length).toBe(1);

    const updated = await requestJson(`/comments/${commentId}`, {
      method: 'PUT',
      token,
      body: { content: 'Updated comment' },
    });

    expect(updated.status).toBe(200);
    expect(updated.data?.success).toBe(true);
    expect(updated.data?.data?.content).toBe('Updated comment');

    const deleted = await requestJson(`/comments/${commentId}`, {
      method: 'DELETE',
      token,
    });

    expect(deleted.status).toBe(200);
    expect(deleted.data?.success).toBe(true);

    const listedAfterDelete = await requestJson(`/comments/order/${orderId}`, { token });
    expect(listedAfterDelete.status).toBe(200);
    expect(listedAfterDelete.data?.success).toBe(true);
    expect(listedAfterDelete.data?.data?.length).toBe(0);
  });
});
