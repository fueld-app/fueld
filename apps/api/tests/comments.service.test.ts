import { beforeEach, describe, expect, it } from 'bun:test';
import { seedBasics, truncateAll } from './helpers/db';

async function loadCommentsService() {
  return import('../src/modules/comments/comments.service');
}

async function loadOrdersService() {
  return import('../src/modules/orders/orders.service');
}

beforeEach(async () => {
  await truncateAll();
});

describe('comments.service', () => {
  it('creates and lists comments newest first with ISO timestamps', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder } = await loadOrdersService();
    const { createComment, listComments } = await loadCommentsService();

    const order = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    const first = await createComment({
      entityType: 'order',
      entityId: order.id,
      userId: user.id,
      userName: user.name,
      content: 'First comment',
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await createComment({
      entityType: 'order',
      entityId: order.id,
      userId: user.id,
      userName: user.name,
      content: 'Second comment',
    });

    expect(first.id).toBeTruthy();
    expect(second.id).toBeTruthy();
    expect(first.createdAt).toContain('T');
    expect(second.updatedAt).toContain('T');

    const rows = await listComments('order', order.id);
    expect(rows.length).toBe(2);
    expect(rows[0]?.content).toBe('Second comment');
    expect(rows[1]?.content).toBe('First comment');
  });

  it('gets, updates, and deletes a comment', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder } = await loadOrdersService();
    const { createComment, getComment, updateComment, deleteComment, listComments } = await loadCommentsService();

    const order = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    const created = await createComment({
      entityType: 'order',
      entityId: order.id,
      userId: user.id,
      userName: user.name,
      content: 'Original content',
    });

    const fetched = await getComment(created.id);
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.content).toBe('Original content');

    const updated = await updateComment(created.id, 'Updated content');
    expect(updated?.id).toBe(created.id);
    expect(updated?.content).toBe('Updated content');

    const deleted = await deleteComment(created.id);
    expect(deleted?.id).toBe(created.id);

    const afterDelete = await getComment(created.id);
    expect(afterDelete).toBeNull();

    const rows = await listComments('order', order.id);
    expect(rows.length).toBe(0);
  });

  it('preserves completion when saving the same follow-up date and reopens when the date changes', async () => {
    const { tenant, client, vessel, place, user } = await seedBasics();
    const { createOrder } = await loadOrdersService();
    const { createComment, completeFollowUp, updateComment } = await loadCommentsService();

    const order = await createOrder({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      salesRepId: user.id,
    });

    const created = await createComment({
      entityType: 'order',
      entityId: order.id,
      userId: user.id,
      userName: user.name,
      content: 'Original content',
      followUpDate: '2026-04-21',
    });

    const completed = await completeFollowUp(created.id);
    expect(completed?.followUpCompleted).toBe(true);

    const sameDate = await updateComment(created.id, 'Edited content', '2026-04-21');
    expect(sameDate?.content).toBe('Edited content');
    expect(sameDate?.followUpDate).toBe('2026-04-21');
    expect(sameDate?.followUpCompleted).toBe(true);

    const changedDate = await updateComment(created.id, 'Edited again', '2026-04-22');
    expect(changedDate?.followUpDate).toBe('2026-04-22');
    expect(changedDate?.followUpCompleted).toBe(false);
  });

  it('returns null for get/update/delete on missing comment', async () => {
    const { getComment, updateComment, deleteComment } = await loadCommentsService();
    const missingId = '123e4567-e89b-12d3-a456-426614174000';

    expect(await getComment(missingId)).toBeNull();
    expect(await updateComment(missingId, 'x')).toBeNull();
    expect(await deleteComment(missingId)).toBeNull();
  });
});
