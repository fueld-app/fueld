import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const DATABASE_URL = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Keep downstream code that reads DATABASE_URL (e.g. crypto key derivation)
// consistent when running tests with TEST_DATABASE_URL.
if (process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL']) {
  process.env['DATABASE_URL'] = DATABASE_URL;
}

// Connection pool for queries
const queryClient = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });
export type Database = typeof db;
