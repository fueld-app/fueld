import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { users } from '../src/db/schema';

type AuthModule = typeof import('../src/modules/auth');
type CreditApplicationsControllerModule = typeof import('../src/modules/credit/credit-applications.controller');

let authModule: AuthModule;
let creditApplicationsControllerModule: CreditApplicationsControllerModule;

const notificationCalls: Array<{ userIds: string[]; notification: { title: string; body: string; url?: string } }> = [];
let shouldThrowPush = false;

beforeAll(async () => {
  mock.module('../src/modules/push/push.service', () => ({
    getVapidPublicKey: async () => null,
    upsertSubscription: async () => undefined,
    removeSubscription: async () => undefined,
    sendTestNotification: async () => 0,
    sendNotificationToUsers: async (
      userIds: string[],
      notification: { title: string; body: string; url?: string },
    ) => {
      notificationCalls.push({ userIds, notification });
      if (shouldThrowPush) throw new Error('push failed');
      return userIds.length;
    },
  }));

  authModule = await import('../src/modules/auth');
  creditApplicationsControllerModule = await import('../src/modules/credit/credit-applications.controller');
});

afterAll(() => {
  mock.restore();
});

beforeEach(async () => {
  await truncateAll();
  notificationCalls.length = 0;
  shouldThrowPush = false;
});

function createTestApp() {
  return new Elysia().use(authModule.authController).use(creditApplicationsControllerModule.creditApplicationsController);
}

async function requestJson(
  app: Elysia,
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
) {
  const headers = new Headers();
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.token) headers.set('authorization', `Bearer ${options.token}`);

  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    }),
  );

  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json') && text ? JSON.parse(text) : text;
  return { status: response.status, data };
}

async function login(app: Elysia, email: string, password: string) {
  const res = await requestJson(app, '/auth/login', {
    method: 'POST',
    body: { email, password },
  });

  return {
    ...res,
    accessToken: res.data?.data?.accessToken as string | undefined,
  };
}

async function seedCreditManagerUser(tenantId: string, email = 'cm@test.local', name = 'Credit Manager') {
  const db = await getDb();
  const { hashPassword } = await import('../src/modules/auth/password.service');
  const [cm] = await db
    .insert(users)
    .values({
      tenantId,
      email,
      name,
      role: 'CREDITMANAGER',
      passwordHash: await hashPassword('Passw0rd!'),
    })
    .returning();
  return cm!;
}

async function seedAdminUser(tenantId: string, email = 'admin@test.local', name = 'Admin') {
  const db = await getDb();
  const { hashPassword } = await import('../src/modules/auth/password.service');
  const [admin] = await db
    .insert(users)
    .values({
      tenantId,
      email,
      name,
      role: 'ADMIN',
      passwordHash: await hashPassword('Passw0rd!'),
    })
    .returning();
  return admin!;
}

describe('credit applications notification branches', () => {
  it('sends push notifications to credit managers when enabled', async () => {
    const seeded = await seedAuthBasics();
    const cm = await seedCreditManagerUser(seeded.tenant.id);
    const app = createTestApp();
    const traderLogin = await login(app, seeded.user.email, seeded.password);

    const res = await requestJson(app, '/credit/applications', {
      method: 'POST',
      token: traderLogin.accessToken!,
      body: {
        type: 'CUSTOMER',
        counterpartyId: seeded.client.id,
        requestedAmount: '1000.00',
        requestedCurrency: 'USD',
      },
    });

    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(notificationCalls).toHaveLength(1);
    expect(notificationCalls[0]!.userIds).toEqual([cm.id]);
    expect(notificationCalls[0]!.notification.title).toBe('New Credit Application');
    expect(notificationCalls[0]!.notification.body).toContain(seeded.client.name);
    expect(notificationCalls[0]!.notification.url).toBe('/credit/applications');
  });

  it('does not send push notifications when notifyCreditManagers is disabled', async () => {
    const seeded = await seedAuthBasics();
    const cm = await seedCreditManagerUser(seeded.tenant.id);
    const app = createTestApp();
    const admin = await seedAdminUser(seeded.tenant.id);
    const adminLogin = await login(app, admin.email, 'Passw0rd!');
    await requestJson(app, '/credit/applications/settings', {
      method: 'PATCH',
      token: adminLogin.accessToken!,
      body: { notifyCreditManagers: false },
    });

    const traderLogin = await login(app, seeded.user.email, seeded.password);
    const res = await requestJson(app, '/credit/applications', {
      method: 'POST',
      token: traderLogin.accessToken!,
      body: {
        type: 'CUSTOMER',
        counterpartyId: seeded.client.id,
        requestedAmount: '2000.00',
        requestedCurrency: 'USD',
      },
    });

    expect(res.status).toBe(200);
    expect(cm.id).toBeTruthy();
    expect(notificationCalls).toHaveLength(0);
  });

  it('does not send push notifications when no credit managers exist', async () => {
    const seeded = await seedAuthBasics();
    const app = createTestApp();
    const traderLogin = await login(app, seeded.user.email, seeded.password);

    const res = await requestJson(app, '/credit/applications', {
      method: 'POST',
      token: traderLogin.accessToken!,
      body: {
        type: 'CUSTOMER',
        counterpartyId: seeded.client.id,
        requestedAmount: '3000.00',
        requestedCurrency: 'USD',
      },
    });

    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(notificationCalls).toHaveLength(0);
  });

  it('still creates application when push sending throws', async () => {
    const seeded = await seedAuthBasics();
    await seedCreditManagerUser(seeded.tenant.id);
    const app = createTestApp();
    const traderLogin = await login(app, seeded.user.email, seeded.password);
    shouldThrowPush = true;

    const res = await requestJson(app, '/credit/applications', {
      method: 'POST',
      token: traderLogin.accessToken!,
      body: {
        type: 'CUSTOMER',
        counterpartyId: seeded.client.id,
        requestedAmount: '4000.00',
        requestedCurrency: 'USD',
      },
    });

    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.id).toBeTruthy();
    expect(notificationCalls).toHaveLength(1);
  });
});
