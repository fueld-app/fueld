import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { integrationCredentials, places, users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

describe('push e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('enforces auth and handles unconfigured public key / test notification', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const publicKeyMissing = await requestJson('/push/public-key');
    expect(publicKeyMissing.status).toBe(200);
    expect(publicKeyMissing.data?.success).toBe(false);
    expect(String(publicKeyMissing.data?.message ?? '')).toContain('VAPID public key not configured');

    const subscribeUnauthorized = await requestJson('/push/subscribe', {
      method: 'POST',
      body: {
        endpoint: 'https://example.com/push/1',
        expirationTime: null,
        keys: { p256dh: 'p', auth: 'a' },
      },
    });
    expect(subscribeUnauthorized.status).toBe(401);

    const unsubscribeUnauthorized = await requestJson('/push/unsubscribe', {
      method: 'POST',
      body: {
        endpoint: 'https://example.com/push/1',
      },
    });
    expect(unsubscribeUnauthorized.status).toBe(401);

    const testNoConfig = await requestJson('/push/test', {
      method: 'POST',
      token,
    });
    expect(testNoConfig.status).toBe(200);
    expect(testNoConfig.data?.success).toBe(true);
    expect(testNoConfig.data?.data?.sent).toBe(0);
  });

  it('rejects push endpoints when JWT user no longer exists', async () => {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    await db.update(places).set({ responsibleUserId: null }).where(eq(places.responsibleUserId, seeded.user.id));
    await db.delete(users).where(eq(users.id, seeded.user.id));

    const subscribeMissingUser = await requestJson('/push/subscribe', {
      method: 'POST',
      token,
      body: {
        endpoint: 'https://example.com/push/missing-user',
        expirationTime: null,
        keys: { p256dh: 'p256-missing', auth: 'auth-missing' },
      },
    });
    expect(subscribeMissingUser.status).toBe(401);

    const testMissingUser = await requestJson('/push/test', {
      method: 'POST',
      token,
    });
    expect(testMissingUser.status).toBe(401);
  });

  it('supports configured public key and subscribe\/unsubscribe flows', async () => {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const adminLogin = await loginE2E(seeded.user.email, seeded.password);
    const token = adminLogin.accessToken;

    const configurePush = await requestJson('/admin/settings/integrations/push', {
      method: 'PUT',
      token,
      body: {
        publicKey: 'public-key-e2e',
        privateKey: 'private-key-e2e',
        subject: 'mailto:test@example.com',
      },
    });
    expect(configurePush.status).toBe(200);
    expect(configurePush.data?.success).toBe(true);

    const storedCredentials = await db.query.integrationCredentials.findMany({
      where: eq(integrationCredentials.provider, 'PUSH'),
    });
    expect(storedCredentials.length).toBeGreaterThanOrEqual(3);

    const publicKey = await requestJson('/push/public-key');
    expect(publicKey.status).toBe(200);
    expect(publicKey.data?.success).toBe(true);
    expect(typeof publicKey.data?.data?.publicKey).toBe('string');
    expect(String(publicKey.data?.data?.publicKey ?? '').length).toBeGreaterThan(0);

    const subscribe = await requestJson('/push/subscribe', {
      method: 'POST',
      token,
      body: {
        endpoint: 'https://example.com/push/abc',
        expirationTime: null,
        keys: { p256dh: 'p256-test', auth: 'auth-test' },
      },
    });
    expect(subscribe.status).toBe(200);
    expect(subscribe.data?.success).toBe(true);

    const subscribeUpdate = await requestJson('/push/subscribe', {
      method: 'POST',
      token,
      body: {
        endpoint: 'https://example.com/push/abc',
        expirationTime: null,
        keys: { p256dh: 'p256-test-2', auth: 'auth-test-2' },
      },
    });
    expect(subscribeUpdate.status).toBe(200);
    expect(subscribeUpdate.data?.success).toBe(true);

    const unsubscribe = await requestJson('/push/unsubscribe', {
      method: 'POST',
      token,
      body: {
        endpoint: 'https://example.com/push/abc',
      },
    });
    expect(unsubscribe.status).toBe(200);
    expect(unsubscribe.data?.success).toBe(true);
  });
});
