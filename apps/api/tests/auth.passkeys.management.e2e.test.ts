import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { places, users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

describe('auth passkeys management e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns user-not-found for passkey register-options when token user was deleted', async () => {
    const seeded = await seedAuthBasics();
    const db = await getDb();
    const login = await loginE2E(seeded.user.email, seeded.password);

    await db
      .update(places)
      .set({ responsibleUserId: null })
      .where(eq(places.responsibleUserId, seeded.user.id));

    await db.delete(users).where(eq(users.id, seeded.user.id));

    const res = await requestJson('/auth/passkeys/register-options', {
      method: 'POST',
      token: login.accessToken,
    });

    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(false);
    expect(String(res.data?.message ?? '')).toContain('User not found');
  });

  it('returns passkey-not-found for rename and delete with valid auth', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;
    const missingPasskeyId = '123e4567-e89b-12d3-a456-426614174000';

    const rename = await requestJson(`/auth/passkeys/${missingPasskeyId}`, {
      method: 'PUT',
      token,
      body: { friendlyName: 'Renamed key' },
    });

    expect(rename.status).toBe(200);
    expect(rename.data?.success).toBe(false);
    expect(String(rename.data?.message ?? '')).toContain('Passkey not found');

    const del = await requestJson(`/auth/passkeys/${missingPasskeyId}`, {
      method: 'DELETE',
      token,
    });

    expect(del.status).toBe(200);
    expect(del.data?.success).toBe(false);
    expect(String(del.data?.message ?? '')).toContain('Passkey not found');
  });

  it('returns register-verify failure when challenge is missing', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);

    const res = await requestJson('/auth/passkeys/register-verify', {
      method: 'POST',
      token: login.accessToken,
      body: {
        friendlyName: 'My key',
        attestationResponse: {},
      },
    });

    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(false);
    expect(String(res.data?.message ?? '')).toContain('challenge');
  });
});
