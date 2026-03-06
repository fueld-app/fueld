import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { places, users } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';

type PushControllerModule = typeof import('../src/modules/push/push.controller');
let pushControllerModule: PushControllerModule;

let currentAuth = {
  sub: '',
  userId: '',
  tenantId: '',
  email: '',
  role: 'TRADER',
};

let publicKeyResult: string | null = null;
let sendCount = 0;
let upsertShouldThrow = false;
let removeShouldThrow = false;
let testShouldThrow = false;
const upsertCalls: Array<Record<string, unknown>> = [];
const removeCalls: Array<Record<string, unknown>> = [];

async function requestJson(
  app: Pick<Elysia, 'handle'>,
  path: string,
  options: { method?: string; body?: unknown } = {},
) {
  const headers = new Headers();
  if (options.body !== undefined) headers.set('content-type', 'application/json');

  const response = await app.handle(new Request(`http://localhost${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  }));

  const text = await response.text();
  return {
    status: response.status,
    data: text ? JSON.parse(text) : null,
  };
}

beforeAll(async () => {
  mock.module('../src/modules/auth/auth.guard', () => ({
    authGuard: new Elysia({ name: 'test-auth-guard' }).derive({ as: 'scoped' }, () => ({ auth: currentAuth })),
  }));

  mock.module('../src/modules/push/push.service', () => ({
    getVapidPublicKey: async () => publicKeyResult,
    upsertSubscription: async (tenantId: string, userId: string, body: unknown) => {
      if (upsertShouldThrow) throw new Error('boom-upsert');
      upsertCalls.push({ tenantId, userId, body });
    },
    removeSubscription: async (userId: string, endpoint: string) => {
      if (removeShouldThrow) throw new Error('boom-remove');
      removeCalls.push({ userId, endpoint });
    },
    sendTestNotification: async () => {
      if (testShouldThrow) throw new Error('boom-test');
      return sendCount;
    },
  }));

  pushControllerModule = await import('../src/modules/push/push.controller');
  mock.restore();
});

beforeEach(async () => {
  await truncateAll();
  currentAuth = {
    sub: '',
    userId: '',
    tenantId: '',
    email: '',
    role: 'TRADER',
  };
  publicKeyResult = null;
  sendCount = 0;
  upsertShouldThrow = false;
  removeShouldThrow = false;
  testShouldThrow = false;
  upsertCalls.length = 0;
  removeCalls.length = 0;
});

describe('push.controller', () => {
  it('returns configured public key or a not-configured payload', async () => {
    const app = new Elysia().use(pushControllerModule.pushController);

    const missing = await requestJson(app, '/push/public-key');
    expect(missing.status).toBe(200);
    expect(missing.data?.success).toBe(false);

    publicKeyResult = 'public-key-from-mock';
    const configured = await requestJson(app, '/push/public-key');
    expect(configured.status).toBe(200);
    expect(configured.data?.success).toBe(true);
    expect(configured.data?.data?.publicKey).toBe('public-key-from-mock');
  });

  it('subscribes for existing users and returns a failure payload when the user is missing or save fails', async () => {
    const seeded = await seedBasics();
    const db = await getDb();
    const app = new Elysia().use(pushControllerModule.pushController);

    currentAuth = {
      sub: seeded.user.id,
      userId: seeded.user.id,
      tenantId: seeded.tenant.id,
      email: seeded.user.email,
      role: seeded.user.role,
    };

    const ok = await requestJson(app, '/push/subscribe', {
      method: 'POST',
      body: {
        endpoint: 'https://example.com/sub/1',
        expirationTime: null,
        keys: { p256dh: 'p1', auth: 'a1' },
      },
    });
    expect(ok.status).toBe(200);
    expect(ok.data?.success).toBe(true);
    expect(upsertCalls.length).toBe(1);
    expect(upsertCalls[0]?.tenantId).toBe(seeded.tenant.id);
    expect(upsertCalls[0]?.userId).toBe(seeded.user.id);

    await db.update(places).set({ responsibleUserId: null }).where(eq(places.responsibleUserId, seeded.user.id));
    await db.delete(users).where(eq(users.id, seeded.user.id));

    const missingUser = await requestJson(app, '/push/subscribe', {
      method: 'POST',
      body: {
        endpoint: 'https://example.com/sub/2',
        expirationTime: null,
        keys: { p256dh: 'p2', auth: 'a2' },
      },
    });
    expect(missingUser.status).toBe(200);
    expect(missingUser.data?.success).toBe(false);
    expect(String(missingUser.data?.message ?? '')).toContain('User tenant not found');

    const [replacementUser] = await db.insert(users).values({
      tenantId: seeded.tenant.id,
      email: 'replacement-push@test.local',
      name: 'Replacement Push User',
      role: 'TRADER',
    }).returning();
    currentAuth = {
      sub: replacementUser.id,
      userId: replacementUser.id,
      tenantId: seeded.tenant.id,
      email: replacementUser.email,
      role: replacementUser.role,
    };
    upsertShouldThrow = true;

    const failedSave = await requestJson(app, '/push/subscribe', {
      method: 'POST',
      body: {
        endpoint: 'https://example.com/sub/3',
        expirationTime: null,
        keys: { p256dh: 'p3', auth: 'a3' },
      },
    });
    expect(failedSave.status).toBe(200);
    expect(failedSave.data?.success).toBe(false);
    expect(String(failedSave.data?.message ?? '')).toContain('Failed to save push subscription');
  });

  it('unsubscribes successfully and returns a failure payload when removal throws', async () => {
    const seeded = await seedBasics();
    const app = new Elysia().use(pushControllerModule.pushController);

    currentAuth = {
      sub: seeded.user.id,
      userId: seeded.user.id,
      tenantId: seeded.tenant.id,
      email: seeded.user.email,
      role: seeded.user.role,
    };

    const ok = await requestJson(app, '/push/unsubscribe', {
      method: 'POST',
      body: { endpoint: 'https://example.com/sub/remove' },
    });
    expect(ok.status).toBe(200);
    expect(ok.data?.success).toBe(true);
    expect(removeCalls.length).toBe(1);
    expect(removeCalls[0]?.userId).toBe(seeded.user.id);

    removeShouldThrow = true;
    const failed = await requestJson(app, '/push/unsubscribe', {
      method: 'POST',
      body: { endpoint: 'https://example.com/sub/remove-2' },
    });
    expect(failed.status).toBe(200);
    expect(failed.data?.success).toBe(false);
    expect(String(failed.data?.message ?? '')).toContain('Failed to remove push subscription');
  });

  it('returns sent counts for test notifications and handles missing users or send failures', async () => {
    const seeded = await seedBasics();
    const db = await getDb();
    const app = new Elysia().use(pushControllerModule.pushController);

    currentAuth = {
      sub: seeded.user.id,
      userId: seeded.user.id,
      tenantId: seeded.tenant.id,
      email: seeded.user.email,
      role: seeded.user.role,
    };
    sendCount = 3;

    const ok = await requestJson(app, '/push/test', { method: 'POST' });
    expect(ok.status).toBe(200);
    expect(ok.data?.success).toBe(true);
    expect(ok.data?.data?.sent).toBe(3);

    await db.update(places).set({ responsibleUserId: null }).where(eq(places.responsibleUserId, seeded.user.id));
    await db.delete(users).where(eq(users.id, seeded.user.id));

    const missingUser = await requestJson(app, '/push/test', { method: 'POST' });
    expect(missingUser.status).toBe(200);
    expect(missingUser.data?.success).toBe(false);
    expect(missingUser.data?.data?.sent).toBe(0);
    expect(String(missingUser.data?.message ?? '')).toContain('User tenant not found');

    const [replacementUser] = await db.insert(users).values({
      tenantId: seeded.tenant.id,
      email: 'replacement-test@test.local',
      name: 'Replacement Test User',
      role: 'TRADER',
    }).returning();
    currentAuth = {
      sub: replacementUser.id,
      userId: replacementUser.id,
      tenantId: seeded.tenant.id,
      email: replacementUser.email,
      role: replacementUser.role,
    };
    testShouldThrow = true;

    const failed = await requestJson(app, '/push/test', { method: 'POST' });
    expect(failed.status).toBe(200);
    expect(failed.data?.success).toBe(false);
    expect(failed.data?.data?.sent).toBe(0);
    expect(String(failed.data?.message ?? '')).toContain('Failed to send push test notification');
  });
});