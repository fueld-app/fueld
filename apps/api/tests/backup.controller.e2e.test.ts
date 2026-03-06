import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import { beginRestoreMode, endRestoreMode } from '../src/modules/admin/backup-state';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

describe('backup controller e2e', () => {
  afterEach(() => {
    endRestoreMode();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  test('returns backup status and capabilities for admin users', async () => {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    const status = await requestJson('/admin/backup/status', { token });
    expect(status.status).toBe(200);
    expect(status.data?.success).toBe(true);
    expect(status.data?.data?.confirmationPhrase).toBe('RESTORE ALL DATA');

    const capabilities = await requestJson('/admin/backup/capabilities', { token });
    expect(capabilities.status).toBe(200);
    expect(capabilities.data?.success).toBe(true);
    expect(typeof capabilities.data?.data?.current?.backupFormatVersion).toBe('number');
  });

  test('blocks normal routes while restore mode is active but keeps health online', async () => {
    const seeded = await seedAuthBasics();
    const db = await getDb();

    await db
      .update(users)
      .set({ role: 'ADMIN', updatedAt: new Date() })
      .where(eq(users.id, seeded.user.id));

    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken;

    beginRestoreMode('Backup restore in progress');

    const health = await requestJson('/health');
    expect(health.status).toBe(200);
    expect(health.data?.success).toBe(true);
    expect(health.data?.data?.restoreInProgress).toBe(true);

    const blocked = await requestJson('/admin/settings/vessel-company-roles/options', { token });
    expect(blocked.status).toBe(503);
    expect(blocked.data?.success).toBe(false);
    expect(String(blocked.data?.message ?? '')).toContain('Backup restore in progress');

    const status = await requestJson('/admin/backup/status', { token });
    expect(status.status).toBe(200);
    expect(status.data?.success).toBe(true);
    expect(status.data?.data?.restoreInProgress).toBe(true);
  });
});