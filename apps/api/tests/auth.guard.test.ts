import { beforeEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';
import { authGuard } from '../src/modules/auth/auth.guard';
import { jwtAccessPlugin } from '../src/modules/auth/jwt.setup';

async function signAccessToken(payload: Record<string, unknown>): Promise<string> {
  const app = new Elysia()
    .use(jwtAccessPlugin)
    .get('/token', async ({ jwtAccess }) => jwtAccess.sign(payload as any));

  const res = await app.handle(new Request('http://localhost/token'));
  return await res.text();
}

async function buildApp() {
  return new Elysia()
    .use(authGuard)
    .get('/protected', ({ auth }) => ({
      sub: auth.sub,
      userId: auth.userId,
      tenantId: auth.tenantId,
      email: auth.email,
      role: auth.role,
    }));
}

/** App with a POST route so the guard's CSRF enforcement on state-changing
 *  methods can be exercised under cookie auth. */
async function buildAppWithPost() {
  return new Elysia()
    .use(authGuard)
    .get('/protected', ({ auth }) => ({ sub: auth.sub }))
    .post('/protected', ({ auth }) => ({ sub: auth.sub }));
}

beforeEach(async () => {
  await truncateAll();
});

describe('auth.guard', () => {
  test('returns 401 for missing Authorization header', async () => {
    const app = await buildApp();
    const response = await app.handle(new Request('http://localhost/protected'));

    expect(response.status).toBe(401);
  });

  test('returns 401 for malformed Authorization header', async () => {
    const app = await buildApp();
    const response = await app.handle(
      new Request('http://localhost/protected', {
        headers: { authorization: 'Token abc' },
      }),
    );

    expect(response.status).toBe(401);
  });

  test('returns 401 for invalid token', async () => {
    const app = await buildApp();

    const response = await app.handle(
      new Request('http://localhost/protected', {
        headers: { authorization: 'Bearer invalid-token' },
      }),
    );

    expect(response.status).toBe(401);
  });

  test('returns 401 for pending2fa token', async () => {
    const seeded = await seedBasics();
    const app = await buildApp();
    const token = await signAccessToken({
      sub: seeded.user.id,
      email: seeded.user.email,
      role: seeded.user.role,
      pending2fa: 'true',
    });

    const response = await app.handle(
      new Request('http://localhost/protected', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );

    expect(response.status).toBe(401);
  });

  test('returns 401 when decoded token has no sub claim', async () => {
    const app = await buildApp();
    const token = await signAccessToken({
      email: 'nosub@fueld.test',
      role: 'TRADER',
    });

    const response = await app.handle(
      new Request('http://localhost/protected', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );

    expect(response.status).toBe(401);
  });

  test('returns 403 when IP is restricted and does not match allow list', async () => {
    const seeded = await seedBasics();
    const db = await getDb();
    await db
      .update(users)
      .set({ allowedIps: JSON.stringify(['203.0.113.0/24']), updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const app = await buildApp();
    const token = await signAccessToken({ sub: seeded.user.id, email: seeded.user.email, role: seeded.user.role });

    const response = await app.handle(
      new Request('http://localhost/protected', {
        headers: {
          authorization: `Bearer ${token}`,
          'x-real-ip': '198.51.100.10',
        },
      }),
    );

    expect(response.status).toBe(403);
  });

  test('returns 403 when IP is restricted and client IP is missing', async () => {
    const seeded = await seedBasics();
    const db = await getDb();
    await db
      .update(users)
      .set({ allowedIps: JSON.stringify(['203.0.113.0/24']), updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const app = await buildApp();
    const token = await signAccessToken({ sub: seeded.user.id, email: seeded.user.email, role: seeded.user.role });

    const response = await app.handle(
      new Request('http://localhost/protected', {
        headers: {
          authorization: `Bearer ${token}`,
        },
      }),
    );

    expect(response.status).toBe(403);
  });

  test('returns 401 when user has no tenant', async () => {
    const db = await getDb();
    const [user] = await db
      .insert(users)
      .values({
        tenantId: null,
        email: 'no-tenant@fueld.test',
        name: 'No Tenant',
        role: 'TRADER',
      })
      .returning();

    const app = await buildApp();
    const token = await signAccessToken({ sub: user!.id, email: user!.email, role: user!.role });

    const response = await app.handle(
      new Request('http://localhost/protected', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );

    expect(response.status).toBe(401);
  });

  test('allows valid token and returns auth context', async () => {
    const seeded = await seedBasics();
    const db = await getDb();
    await db
      .update(users)
      .set({ allowedIps: JSON.stringify(['198.51.100.0/24']), role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const token = await signAccessToken({ sub: seeded.user.id, email: seeded.user.email, role: 'ADMIN' });
    const app = await buildApp();

    const response = await app.handle(
      new Request('http://localhost/protected', {
        headers: {
          authorization: `Bearer ${token}`,
          'x-forwarded-for': '198.51.100.25, 10.0.0.1',
        },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, string>;
    expect(body).toEqual({
      sub: seeded.user.id,
      userId: seeded.user.id,
      tenantId: seeded.tenant.id,
      email: seeded.user.email,
      role: 'ADMIN',
    });
  });

  test('allows exact IP allow-list rule without CIDR notation', async () => {
    const seeded = await seedBasics();
    const db = await getDb();
    await db
      .update(users)
      .set({ allowedIps: JSON.stringify(['198.51.100.88']), updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const app = await buildApp();
    const token = await signAccessToken({ sub: seeded.user.id, email: seeded.user.email, role: seeded.user.role });

    const response = await app.handle(
      new Request('http://localhost/protected', {
        headers: {
          authorization: `Bearer ${token}`,
          'x-real-ip': '198.51.100.88',
        },
      }),
    );

    expect(response.status).toBe(200);
  });

  test('denies request when allowed IP lookup fails unexpectedly (fail-closed)', async () => {
    const seeded = await seedBasics();
    const db = await getDb();
    // Malformed JSON triggers JSON.parse error inside admin.service getUserAllowedIps.
    // auth.guard now fails closed (403) instead of silently bypassing the restriction.
    await db
      .update(users)
      .set({ allowedIps: 'not-json', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const app = await buildApp();
    const token = await signAccessToken({ sub: seeded.user.id, email: seeded.user.email, role: seeded.user.role });

    const response = await app.handle(
      new Request('http://localhost/protected', {
        headers: {
          authorization: `Bearer ${token}`,
          'x-real-ip': '198.51.100.19',
        },
      }),
    );

    expect(response.status).toBe(403);
  });

  // ── Cookie-based auth + CSRF ─────────────────────────────────────
  test('GET with a valid fueld_access cookie (no Bearer) → 200', async () => {
    const seeded = await seedBasics();
    const token = await signAccessToken({ sub: seeded.user.id, email: seeded.user.email, role: seeded.user.role });
    const app = await buildAppWithPost();

    const response = await app.handle(
      new Request('http://localhost/protected', {
        headers: { cookie: `fueld_access=${token}` },
      }),
    );

    expect(response.status).toBe(200);
  });

  test('POST with a valid cookie + matching X-CSRF-Token → 200', async () => {
    const seeded = await seedBasics();
    const token = await signAccessToken({ sub: seeded.user.id, email: seeded.user.email, role: seeded.user.role });
    const csrf = 'csrf-match';
    const app = await buildAppWithPost();

    const response = await app.handle(
      new Request('http://localhost/protected', {
        method: 'POST',
        headers: {
          cookie: `fueld_access=${token}; fueld_csrf=${csrf}`,
          'x-csrf-token': csrf,
        },
      }),
    );

    expect(response.status).toBe(200);
  });

  test('POST with a valid cookie but no X-CSRF-Token → 403', async () => {
    const seeded = await seedBasics();
    const token = await signAccessToken({ sub: seeded.user.id, email: seeded.user.email, role: seeded.user.role });
    const app = await buildAppWithPost();

    const response = await app.handle(
      new Request('http://localhost/protected', {
        method: 'POST',
        headers: { cookie: `fueld_access=${token}; fueld_csrf=csrf-token` },
      }),
    );

    expect(response.status).toBe(403);
  });

  test('POST with a valid cookie but mismatched X-CSRF-Token → 403', async () => {
    const seeded = await seedBasics();
    const token = await signAccessToken({ sub: seeded.user.id, email: seeded.user.email, role: seeded.user.role });
    const app = await buildAppWithPost();

    const response = await app.handle(
      new Request('http://localhost/protected', {
        method: 'POST',
        headers: {
          cookie: `fueld_access=${token}; fueld_csrf=real-csrf`,
          'x-csrf-token': 'wrong-csrf',
        },
      }),
    );

    expect(response.status).toBe(403);
  });

  test('POST with a valid cookie AND a Bearer header → 200 (CSRF skipped)', async () => {
    const seeded = await seedBasics();
    const token = await signAccessToken({ sub: seeded.user.id, email: seeded.user.email, role: seeded.user.role });
    const app = await buildAppWithPost();

    const response = await app.handle(
      new Request('http://localhost/protected', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          cookie: `fueld_access=${token}`,
        },
      }),
    );

    expect(response.status).toBe(200);
  });
});
