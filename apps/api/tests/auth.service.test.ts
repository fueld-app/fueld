import { beforeEach, describe, expect, test } from 'bun:test';
import * as OTPAuth from 'otpauth';
import { eq } from 'drizzle-orm';
import { users, tenants } from '../src/db/schema';
import { getDb, seedAuthBasics, seedBasics, TEST_PASSWORD, truncateAll } from './helpers/db';
import {
  clearRefreshToken,
  disable2fa,
  enable2fa,
  findUserByEmail,
  generate2faSecret,
  getAuthEnforcement,
  loginWithO365,
  loginWithPassword,
  registerUser,
  storeRefreshToken,
  verify2faToken,
} from '../src/modules/auth/auth.service';

const originalFetch = globalThis.fetch;

beforeEach(async () => {
  await truncateAll();
  globalThis.fetch = originalFetch;
});

describe('auth.service', () => {
  test('registers users and handles password login branches', async () => {
    const created = await registerUser({
      email: 'NewUser@Test.local',
      password: 'Passw0rd!123',
      name: 'New User',
    });

    expect(created.email).toBe('newuser@test.local');

    await expect(
      registerUser({
        email: 'newuser@test.local',
        password: 'AnotherPass!123',
        name: 'Duplicate User',
      }),
    ).rejects.toThrow('A user with this email already exists');

    const seeded = await seedAuthBasics(TEST_PASSWORD);

    await expect(loginWithPassword('missing@test.local', TEST_PASSWORD)).rejects.toThrow(
      'Invalid email or password',
    );

    await expect(loginWithPassword(seeded.user.email, 'wrong-password')).rejects.toThrow(
      'Invalid email or password',
    );

    const login = await loginWithPassword(seeded.user.email, TEST_PASSWORD);
    expect(login.user.id).toBe(seeded.user.id);
    expect(login.requires2fa).toBe(false);

    const db = await getDb();
    await db
      .update(users)
      .set({ is2faEnabled: true, updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const login2fa = await loginWithPassword(seeded.user.email, TEST_PASSWORD);
    expect(login2fa.requires2fa).toBe(true);
  });

  test('returns auth enforcement defaults and tenant override', async () => {
    expect(await getAuthEnforcement()).toEqual({ enforce2FA: false });

    const seeded = await seedBasics();
    const db = await getDb();
    await db
      .update(tenants)
      .set({ settings: { enforce2FA: true }, updatedAt: new Date() })
      .where(eq(tenants.id, seeded.tenant.id));

    expect(await getAuthEnforcement()).toEqual({ enforce2FA: true });
  });

  test('handles O365 invalid, linked, email-link, and auto-provision branches', async () => {
    const db = await getDb();

    globalThis.fetch = ((async () => new Response('unauthorized', { status: 401 })) as unknown) as typeof fetch;
    await expect(loginWithO365('invalid-token')).rejects.toThrow(
      'Invalid or expired Microsoft access token',
    );

    const seeded = await seedBasics();
    await db
      .update(users)
      .set({ o365Id: 'ms-linked-1', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    globalThis.fetch = ((async (_input: RequestInfo | URL, init?: RequestInit) => {
      const authHeader = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '');

      if (authHeader.includes('linked-token')) {
        return new Response(
          JSON.stringify({
            id: 'ms-linked-1',
            displayName: 'Linked User',
            mail: seeded.user.email,
            userPrincipalName: seeded.user.email,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (authHeader.includes('email-link-token')) {
        return new Response(
          JSON.stringify({
            id: 'ms-link-email',
            displayName: 'Email Link User',
            mail: 'linkme@test.local',
            userPrincipalName: 'linkme@test.local',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (authHeader.includes('auto-token')) {
        return new Response(
          JSON.stringify({
            id: 'ms-auto-1',
            displayName: 'Auto Provisioned',
            mail: null,
            userPrincipalName: 'AUTO@TEST.LOCAL',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('unauthorized', { status: 401 });
    }) as unknown) as typeof fetch;

    const linked = await loginWithO365('linked-token');
    expect(linked.id).toBe(seeded.user.id);

    const [emailOnlyUser] = await db
      .insert(users)
      .values({
        tenantId: seeded.tenant.id,
        email: 'linkme@test.local',
        name: 'Link Me',
        role: 'TRADER',
      })
      .returning();

    const linkedByEmail = await loginWithO365('email-link-token');
    expect(linkedByEmail.id).toBe(emailOnlyUser!.id);
    expect(linkedByEmail.o365Id).toBe('ms-link-email');

    const autoProvisioned = await loginWithO365('auto-token');
    expect(autoProvisioned.email).toBe('auto@test.local');
    expect(autoProvisioned.o365Id).toBe('ms-auto-1');
  });

  test('stores and clears refresh tokens', async () => {
    const seeded = await seedBasics();

    await storeRefreshToken(seeded.user.id, 'refresh-token-1');
    expect((await findUserByEmail(seeded.user.email))?.refreshToken).toBe('refresh-token-1');

    await clearRefreshToken(seeded.user.id);
    expect((await findUserByEmail(seeded.user.email))?.refreshToken).toBeNull();
  });

  test('covers 2FA generation, enable/disable, verify, and error branches', async () => {
    const seeded = await seedBasics();

    await expect(
      generate2faSecret('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow('User not found');

    const generated = await generate2faSecret(seeded.user.id);
    expect(generated.secret.length).toBeGreaterThan(10);
    expect(generated.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);

    const db = await getDb();
    const [noSecretUser] = await db
      .insert(users)
      .values({
        tenantId: seeded.tenant.id,
        email: 'nosecret@test.local',
        name: 'No Secret',
        role: 'TRADER',
      })
      .returning();

    await expect(enable2fa(noSecretUser!.id, '000000')).rejects.toThrow(
      'Generate a 2FA secret first',
    );

    const invalidEnable = await enable2fa(seeded.user.id, '000000');
    expect(invalidEnable).toBe(false);

    const totp = new OTPAuth.TOTP({
      issuer: 'Fueld',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(generated.secret),
    });
    const validToken = totp.generate();

    const enabled = await enable2fa(seeded.user.id, validToken);
    expect(enabled).toBe(true);

    const verified = await verify2faToken(seeded.user.id, validToken);
    expect(verified).toBe(true);

    const invalidDisable = await disable2fa(seeded.user.id, '000000');
    expect(invalidDisable).toBe(false);

    const validDisableToken = totp.generate();
    const disabled = await disable2fa(seeded.user.id, validDisableToken);
    expect(disabled).toBe(true);

    await expect(verify2faToken(seeded.user.id, validDisableToken)).rejects.toThrow(
      '2FA is not enabled for this user',
    );
  });
});
