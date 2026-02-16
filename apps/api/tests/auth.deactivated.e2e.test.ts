import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E } from './helpers/e2e';

describe('auth deactivated-user e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('rejects login for deactivated users', async () => {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    await db
      .update(users)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const login = await loginE2E(seeded.user.email, seeded.password);
    expect(login.status).toBe(200);
    expect(login.data?.success).toBe(false);
    expect(String(login.data?.message ?? '')).toContain('deactivated');
  });
});
