import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { jwtAccessPlugin, jwtRefreshPlugin } from '../src/modules/auth/jwt.setup';

function buildApp() {
  return new Elysia()
    .use(jwtAccessPlugin)
    .use(jwtRefreshPlugin)
    .get('/sign-access', ({ jwtAccess }) =>
      jwtAccess.sign({ sub: 'user-1', email: 'user@test.local', role: 'TRADER' }),
    )
    .get('/verify-access', async ({ jwtAccess, query }) => {
      try {
        const payload = await jwtAccess.verify(String((query as any).token ?? ''));
        return payload ? { ok: true, payload } : { ok: false };
      } catch {
        return { ok: false };
      }
    })
    .get('/sign-refresh', ({ jwtRefresh }) =>
      jwtRefresh.sign({ sub: 'user-1', email: 'user@test.local', role: 'TRADER' }),
    )
    .get('/verify-refresh', async ({ jwtRefresh, query }) => {
      try {
        const payload = await jwtRefresh.verify(String((query as any).token ?? ''));
        return payload ? { ok: true, payload } : { ok: false };
      } catch {
        return { ok: false };
      }
    });
}

describe('jwt.setup', () => {
  test('jwtAccessPlugin signs and verifies access tokens', async () => {
    const app = buildApp();

    const signed = await app.handle(new Request('http://localhost/sign-access'));
    expect(signed.status).toBe(200);
    const token = await signed.text();
    expect(token.split('.').length).toBe(3);

    const verified = await app.handle(
      new Request(`http://localhost/verify-access?token=${encodeURIComponent(token)}`),
    );
    const body = await verified.json();
    expect(body.ok).toBe(true);
    expect(body.payload.sub).toBe('user-1');
    expect(body.payload.email).toBe('user@test.local');
    expect(body.payload.role).toBe('TRADER');
  });

  test('jwtRefreshPlugin signs and verifies refresh tokens', async () => {
    const app = buildApp();

    const signed = await app.handle(new Request('http://localhost/sign-refresh'));
    expect(signed.status).toBe(200);
    const token = await signed.text();
    expect(token.split('.').length).toBe(3);

    const verified = await app.handle(
      new Request(`http://localhost/verify-refresh?token=${encodeURIComponent(token)}`),
    );
    const body = await verified.json();
    expect(body.ok).toBe(true);
    expect(body.payload.sub).toBe('user-1');
    expect(body.payload.email).toBe('user@test.local');
    expect(body.payload.role).toBe('TRADER');
  });
});
