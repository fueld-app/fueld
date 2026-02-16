import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { hashPassword } from '../src/modules/auth/password.service';
import { loginE2E, requestJson } from './helpers/e2e';

describe('comments authorization e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('forbids editing/deleting another user comment', async () => {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    const secondEmail = 'user2@test.local';
    const secondPassword = 'Passw0rd!2';

    const [secondUser] = await db
      .insert(users)
      .values({
        tenantId: seeded.tenant.id,
        email: secondEmail,
        name: 'Second User',
        role: 'TRADER',
        passwordHash: await hashPassword(secondPassword),
      })
      .returning();

    expect(secondUser?.id).toBeTruthy();

    const login1 = await loginE2E(seeded.user.email, seeded.password);
    const login2 = await loginE2E(secondEmail, secondPassword);

    const token1 = login1.accessToken;
    const token2 = login2.accessToken;

    const order = await requestJson('/orders', {
      method: 'POST',
      token: token1,
      body: {
        clientId: seeded.client.id,
        vesselId: seeded.vessel.id,
        placeId: seeded.place.id,
      },
    });

    const orderId = order.data?.data?.id as string;
    expect(orderId).toBeTruthy();

    const comment = await requestJson(`/comments/order/${orderId}`, {
      method: 'POST',
      token: token1,
      body: { content: 'Owner comment' },
    });

    const commentId = comment.data?.data?.id as string;
    expect(commentId).toBeTruthy();

    const updateByOther = await requestJson(`/comments/${commentId}`, {
      method: 'PUT',
      token: token2,
      body: { content: 'Hacked' },
    });

    expect(updateByOther.status).toBe(403);
    expect(updateByOther.data?.success).toBe(false);

    const deleteByOther = await requestJson(`/comments/${commentId}`, {
      method: 'DELETE',
      token: token2,
    });

    expect(deleteByOther.status).toBe(403);
    expect(deleteByOther.data?.success).toBe(false);

    const ownerDelete = await requestJson(`/comments/${commentId}`, {
      method: 'DELETE',
      token: token1,
    });

    expect(ownerDelete.status).toBe(200);
    expect(ownerDelete.data?.success).toBe(true);

    const [remaining] = await db.select().from(users).where(eq(users.id, secondUser!.id)).limit(1);
    expect(remaining?.email).toBe(secondEmail);
  });
});
