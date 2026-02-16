import { describe, expect, test } from 'bun:test';
import { truncateAll } from './helpers/db';

describe('test suite setup', () => {
  test('initializes DATABASE_URL for tests and loads DB module', async () => {
    // Ensures helpers/db ran, safety checks passed, schema compat is applied,
    // and the shared ../src/db module is initialized against the test DB.
    await truncateAll();

    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.DATABASE_URL?.toLowerCase()).toContain('test');

    const { db } = await import('../src/db');
    // Touch a query to ensure the connection works.
    const tenant = await db.query.tenants.findFirst();
    expect(tenant).toBeUndefined();
  });
});
