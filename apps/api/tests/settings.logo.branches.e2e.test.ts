import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestRaw } from './helpers/e2e';

describe('settings logo branch e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function adminContext() {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const login = await loginE2E(seeded.user.email, seeded.password);
    return { seeded, token: login.accessToken };
  }

  it('returns deterministic validation errors for oversize company logo uploads', async () => {
    const { seeded, token } = await adminContext();

    const tooLargeLogo = new FormData();
    tooLargeLogo.set(
      'file',
      new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'too-large.png', { type: 'image/png' }),
    );

    const upload = await requestRaw(`/admin/settings/companies/${seeded.client.id}/logo`, {
      method: 'PUT',
      token,
      body: tooLargeLogo,
    });

    expect(upload.status).toBe(200);
    expect((upload.data as any)?.success).toBe(false);
    expect(String((upload.data as any)?.message ?? '')).toContain('Logo must be under 2 MB');
  });

  it('returns deterministic validation errors for default-logo invalid type and oversize files', async () => {
    const { token } = await adminContext();

    const invalidType = new FormData();
    invalidType.set('file', new File(['not-image'], 'logo.txt', { type: 'text/plain' }));

    const invalidTypeUpload = await requestRaw('/admin/settings/default-logo', {
      method: 'PUT',
      token,
      body: invalidType,
    });

    expect(invalidTypeUpload.status).toBe(200);
    expect((invalidTypeUpload.data as any)?.success).toBe(false);
    expect(String((invalidTypeUpload.data as any)?.message ?? '')).toContain('Only JPEG, PNG, WebP, and SVG are allowed');

    const tooLarge = new FormData();
    tooLarge.set(
      'file',
      new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'too-large.png', { type: 'image/png' }),
    );

    const tooLargeUpload = await requestRaw('/admin/settings/default-logo', {
      method: 'PUT',
      token,
      body: tooLarge,
    });

    expect(tooLargeUpload.status).toBe(200);
    expect((tooLargeUpload.data as any)?.success).toBe(false);
    expect(String((tooLargeUpload.data as any)?.message ?? '')).toContain('Logo must be under 2 MB');
  });
});
