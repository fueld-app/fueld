import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';
import { encrypt } from '../src/lib/crypto';
import { integrationCredentials, pushSubscriptions, tenants } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';

type PushServiceModule = typeof import('../src/modules/push/push.service');
let pushService: PushServiceModule;

const vapidCalls: Array<{ subject: string; publicKey: string; privateKey: string }> = [];
const sendCalls: Array<{ endpoint: string; payload: string }> = [];
let sendStatusToThrow: number | null = null;

beforeAll(async () => {
  mock.module('web-push', () => ({
    default: {
      setVapidDetails: (subject: string, publicKey: string, privateKey: string) => {
        vapidCalls.push({ subject, publicKey, privateKey });
      },
      sendNotification: async (sub: { endpoint: string }, payload: string) => {
        if (sendStatusToThrow) {
          const err: any = new Error('push failed');
          err.statusCode = sendStatusToThrow;
          throw err;
        }
        sendCalls.push({ endpoint: sub.endpoint, payload });
      },
    },
  }));

  pushService = await import('../src/modules/push/push.service');
});

afterAll(() => {
  mock.restore();
});

beforeEach(async () => {
  await truncateAll();
  vapidCalls.length = 0;
  sendCalls.length = 0;
  sendStatusToThrow = null;
});

describe('push.service', () => {
  it('getVapidPublicKey returns null when no push public key is configured', async () => {
    await expect(pushService.getVapidPublicKey()).resolves.toBeNull();
  });

  it('getVapidPublicKey returns null when VAPID credentials are missing', async () => {
    await seedBasics();
    const key = await pushService.getVapidPublicKey();
    expect(key).toBeNull();
  });

  it('getVapidPublicKey returns configured public key from encrypted credentials', async () => {
    const seeded = await seedBasics();
    const db = await getDb();

    const pub = encrypt('pub-key-1');
    const priv = encrypt('priv-key-1');
    const subject = encrypt('mailto:test@fueld.app');

    await db.insert(integrationCredentials).values([
      {
        tenantId: seeded.tenant.id,
        provider: 'PUSH',
        key: 'publicKey',
        encryptedValue: pub.encrypted,
        iv: pub.iv,
        authTag: pub.authTag,
      },
      {
        tenantId: seeded.tenant.id,
        provider: 'PUSH',
        key: 'privateKey',
        encryptedValue: priv.encrypted,
        iv: priv.iv,
        authTag: priv.authTag,
      },
      {
        tenantId: seeded.tenant.id,
        provider: 'PUSH',
        key: 'subject',
        encryptedValue: subject.encrypted,
        iv: subject.iv,
        authTag: subject.authTag,
      },
    ]);

    const key = await pushService.getVapidPublicKey();
    expect(key).toBe('pub-key-1');
  });

  it('getVapidPublicKey returns the most recently updated configured key', async () => {
    const seededA = await seedBasics();
    const db = await getDb();
    const [tenantB] = await db.insert(tenants).values({
      name: 'Second Test Tenant',
      domain: 'test-2.local',
    }).returning();

    const older = encrypt('pub-key-old');
    const newer = encrypt('pub-key-new');

    await db.insert(integrationCredentials).values([
      {
        tenantId: seededA.tenant.id,
        provider: 'PUSH',
        key: 'publicKey',
        encryptedValue: older.encrypted,
        iv: older.iv,
        authTag: older.authTag,
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      },
      {
        tenantId: tenantB.id,
        provider: 'PUSH',
        key: 'publicKey',
        encryptedValue: newer.encrypted,
        iv: newer.iv,
        authTag: newer.authTag,
        updatedAt: new Date('2026-03-02T00:00:00.000Z'),
      },
    ]);

    const key = await pushService.getVapidPublicKey();
    expect(key).toBe('pub-key-new');
  });

  it('upsertSubscription inserts and updates a subscription by endpoint', async () => {
    const seeded = await seedBasics();
    const db = await getDb();

    await pushService.upsertSubscription(seeded.tenant.id, seeded.user.id, {
      endpoint: 'https://example.com/push/1',
      expirationTime: null,
      keys: { p256dh: 'p1', auth: 'a1' },
    });

    const first = await db.query.pushSubscriptions.findFirst({
      where: eq(pushSubscriptions.endpoint, 'https://example.com/push/1'),
    });
    expect(first?.p256dh).toBe('p1');
    expect(first?.auth).toBe('a1');
    expect(first?.expirationTime).toBeNull();

    await pushService.upsertSubscription(seeded.tenant.id, seeded.user.id, {
      endpoint: 'https://example.com/push/1',
      expirationTime: Date.now() + 60_000,
      keys: { p256dh: 'p2', auth: 'a2' },
    });

    const second = await db.query.pushSubscriptions.findFirst({
      where: eq(pushSubscriptions.endpoint, 'https://example.com/push/1'),
    });
    expect(second?.p256dh).toBe('p2');
    expect(second?.auth).toBe('a2');
    expect(second?.expirationTime).toBeTruthy();
  });

  it('removeSubscription deletes subscription rows by user + endpoint', async () => {
    const seeded = await seedBasics();
    const db = await getDb();

    await pushService.upsertSubscription(seeded.tenant.id, seeded.user.id, {
      endpoint: 'https://example.com/push/delete-me',
      expirationTime: null,
      keys: { p256dh: 'p', auth: 'a' },
    });

    expect(
      await db.query.pushSubscriptions.findFirst({
        where: eq(pushSubscriptions.endpoint, 'https://example.com/push/delete-me'),
      }),
    ).toBeTruthy();

    await pushService.removeSubscription(seeded.user.id, 'https://example.com/push/delete-me');

    expect(
      await db.query.pushSubscriptions.findFirst({
        where: eq(pushSubscriptions.endpoint, 'https://example.com/push/delete-me'),
      }),
    ).toBeUndefined();
  });

  it('sendTestNotification returns 0 when VAPID is not configured', async () => {
    const seeded = await seedBasics();

    const sent = await pushService.sendTestNotification(seeded.user.id, seeded.tenant.id);
    expect(sent).toBe(0);
    expect(vapidCalls.length).toBe(0);
    expect(sendCalls.length).toBe(0);
  });

  it('sendTestNotification sends notifications and counts successes', async () => {
    const seeded = await seedBasics();
    const db = await getDb();

    const pub = encrypt('pub-key-2');
    const priv = encrypt('priv-key-2');
    await db.insert(integrationCredentials).values([
      {
        tenantId: seeded.tenant.id,
        provider: 'PUSH',
        key: 'publicKey',
        encryptedValue: pub.encrypted,
        iv: pub.iv,
        authTag: pub.authTag,
      },
      {
        tenantId: seeded.tenant.id,
        provider: 'PUSH',
        key: 'privateKey',
        encryptedValue: priv.encrypted,
        iv: priv.iv,
        authTag: priv.authTag,
      },
    ]);

    await pushService.upsertSubscription(seeded.tenant.id, seeded.user.id, {
      endpoint: 'https://example.com/push/send-1',
      expirationTime: null,
      keys: { p256dh: 'p1', auth: 'a1' },
    });
    await pushService.upsertSubscription(seeded.tenant.id, seeded.user.id, {
      endpoint: 'https://example.com/push/send-2',
      expirationTime: null,
      keys: { p256dh: 'p2', auth: 'a2' },
    });

    const sent = await pushService.sendTestNotification(seeded.user.id, seeded.tenant.id);
    expect(sent).toBe(2);
    expect(vapidCalls.length).toBe(1);
    expect(sendCalls.length).toBe(2);
    expect(sendCalls[0]?.payload).toContain('Push notifications are enabled');
  });

  it('sendTestNotification deletes subscriptions when web-push returns 410/404', async () => {
    const seeded = await seedBasics();
    const db = await getDb();

    const pub = encrypt('pub-key-3');
    const priv = encrypt('priv-key-3');
    await db.insert(integrationCredentials).values([
      {
        tenantId: seeded.tenant.id,
        provider: 'PUSH',
        key: 'publicKey',
        encryptedValue: pub.encrypted,
        iv: pub.iv,
        authTag: pub.authTag,
      },
      {
        tenantId: seeded.tenant.id,
        provider: 'PUSH',
        key: 'privateKey',
        encryptedValue: priv.encrypted,
        iv: priv.iv,
        authTag: priv.authTag,
      },
    ]);

    await pushService.upsertSubscription(seeded.tenant.id, seeded.user.id, {
      endpoint: 'https://example.com/push/gone',
      expirationTime: null,
      keys: { p256dh: 'p', auth: 'a' },
    });

    sendStatusToThrow = 410;
    const sent = await pushService.sendTestNotification(seeded.user.id, seeded.tenant.id);
    expect(sent).toBe(0);
    expect(sendCalls.length).toBe(0);

    const remaining = await db.query.pushSubscriptions.findFirst({
      where: eq(pushSubscriptions.endpoint, 'https://example.com/push/gone'),
    });
    expect(remaining).toBeUndefined();
  });
});
