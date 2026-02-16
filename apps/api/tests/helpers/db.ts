import postgres from 'postgres';
import * as schema from '../../src/db/schema';

const DEFAULT_DATABASE_URL = 'postgres://fueld:fueld@localhost:5432/fueld_test';

function assertSafeTestDatabase(databaseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('[TEST SAFETY] DATABASE_URL is not a valid URL');
  }

  const host = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, '').toLowerCase();

  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('[TEST SAFETY] Refusing to run tests with NODE_ENV=production');
  }

  if (!(host === 'localhost' || host === '127.0.0.1')) {
    throw new Error(`[TEST SAFETY] Refusing to run tests against non-local database host: ${host}`);
  }

  if (!dbName) {
    throw new Error('[TEST SAFETY] DATABASE_URL must include a database name');
  }

  if (
    ['prod', 'production', 'rds.amazonaws.com', 'supabase.co', 'neon.tech'].some((signal) =>
      databaseUrl.toLowerCase().includes(signal),
    )
  ) {
    throw new Error('[TEST SAFETY] DATABASE_URL appears production-like; refusing to run destructive test setup');
  }

  if (!dbName.includes('test')) {
    throw new Error(`[TEST SAFETY] Database name must include "test". Received: ${dbName}`);
  }
}

const ENV_TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];
const ENV_DATABASE_URL = process.env['DATABASE_URL'];

let DATABASE_URL = ENV_TEST_DATABASE_URL ?? ENV_DATABASE_URL ?? DEFAULT_DATABASE_URL;
try {
  assertSafeTestDatabase(DATABASE_URL);
} catch (err) {
  // Common dev setup: DATABASE_URL points at a local *non-test* DB.
  // For safety + convenience, fall back to the known-safe default test DB
  // unless the user explicitly set TEST_DATABASE_URL.
  if (!ENV_TEST_DATABASE_URL && ENV_DATABASE_URL) {
    DATABASE_URL = DEFAULT_DATABASE_URL;
    assertSafeTestDatabase(DATABASE_URL);
  } else {
    throw err;
  }
}

process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = DATABASE_URL;

// NOTE: `var` intentionally avoids TDZ crashes that can occur under Bun's
// coverage instrumentation + ESM module cycles.
// eslint-disable-next-line no-var
var sql: ReturnType<typeof postgres> | undefined;

function getSql() {
  if (!sql) {
    sql = postgres(DATABASE_URL, { max: 1 });
  }
  return sql!;
}

function getTruncateTables() {
  return [
    'activity_logs',
    'entity_comments',
    'password_reset_tokens',
    'integration_credentials',
    'bank_accounts',
    'user_company_overrides',
    'company_group_members',
    'company_groups',
    'team_companies',
    'teams',
    'company_emails',
    'company_contacts',
    'credit_line_companies',
    'credit_line_counterparties',
    'credit_lines',
    'order_items',
    'orders',
    'order_number_sequences',
    'counterparties',
    'vessels',
    'places',
    'users',
    'tenants',
  ];
}

async function ensureTestSchemaCompat(): Promise<void> {
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE cascade,
      token_hash text NOT NULL,
      requested_by uuid REFERENCES users(id),
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT password_reset_tokens_token_hash_unique UNIQUE(token_hash)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS order_number_sequences (
      tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
      last_seq integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS order_number text
  `;

  await sql`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS bank_account_id uuid
  `;

  await sql`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD'
  `;

  await sql`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS invoicing_company_id uuid,
    ADD COLUMN IF NOT EXISTS eta timestamptz,
    ADD COLUMN IF NOT EXISTS etd timestamptz,
    ADD COLUMN IF NOT EXISTS customer_payment_term_type text,
    ADD COLUMN IF NOT EXISTS customer_credit_days integer,
    ADD COLUMN IF NOT EXISTS customer_note text,
    ADD COLUMN IF NOT EXISTS supplier_id uuid,
    ADD COLUMN IF NOT EXISTS supplier_payment_term_type text,
    ADD COLUMN IF NOT EXISTS supplier_credit_days integer,
    ADD COLUMN IF NOT EXISTS supplier_note text,
    ADD COLUMN IF NOT EXISTS customer_contact_id uuid,
    ADD COLUMN IF NOT EXISTS supplier_contact_id uuid,
    ADD COLUMN IF NOT EXISTS terms_and_conditions text,
    ADD COLUMN IF NOT EXISTS loss_reason text,
    ADD COLUMN IF NOT EXISTS closed_at timestamptz
  `;

  await sql`
    ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS quantity_min numeric(12, 3),
    ADD COLUMN IF NOT EXISTS quantity_max numeric(12, 3),
    ADD COLUMN IF NOT EXISTS description text,
    ADD COLUMN IF NOT EXISTS cost_currency text DEFAULT 'USD',
    ADD COLUMN IF NOT EXISTS sales_currency text DEFAULT 'USD'
  `;
}

export async function truncateAll(): Promise<void> {
  const sql = getSql();
  await ensureTestSchemaCompat();

  const rows = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;

  const existing = new Set(rows.map((row) => row.table_name));
  const list = getTruncateTables()
    .filter((tableName) => existing.has(tableName))
    .map((tableName) => `"${tableName}"`)
    .join(', ');

  if (!list) {
    return;
  }

  await sql.unsafe(`TRUNCATE TABLE ${list} CASCADE;`);
}

export async function closeDb(): Promise<void> {
  if (!sql) return;
  await sql.end({ timeout: 5 });
}

export async function seedBasics() {
  const { db } = await import('../../src/db');
  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: 'Test Tenant', domain: 'test.local' })
    .returning();

  const [user] = await db
    .insert(schema.users)
    .values({
      tenantId: tenant!.id,
      email: 'user@test.local',
      name: 'Test User',
      role: 'TRADER',
    })
    .returning();

  const [client] = await db
    .insert(schema.counterparties)
    .values({
      tenantId: tenant!.id,
      name: 'Test Client',
      type: 'CLIENT',
      types: ['CLIENT'],
      country: 'USA',
    })
    .returning();

  const [vessel] = await db
    .insert(schema.vessels)
    .values({ name: 'Test Vessel', imo: '9999999' })
    .returning();

  const [place] = await db
    .insert(schema.places)
    .values({
      name: 'Test Port',
      country: 'USA',
      countryIso: 'USA',
      area: 'Test Area',
      placeType: 'POR',
      lat: 1,
      long: 1,
      unlocode: 'US TST',
      responsibleUserId: user!.id,
    })
    .returning();

  return { tenant: tenant!, user: user!, client: client!, vessel: vessel!, place: place! };
}

export const TEST_PASSWORD = 'Passw0rd!';

export async function seedAuthBasics(password = TEST_PASSWORD) {
  const seeded = await seedBasics();
  const { db } = await import('../../src/db');
  const { users } = await import('../../src/db/schema');
  const { eq } = await import('drizzle-orm');
  const { hashPassword } = await import('../../src/modules/auth/password.service');

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
    .where(eq(users.id, seeded.user.id));

  return { ...seeded, password };
}

export async function getDb() {
  const { db } = await import('../../src/db');
  return db;
}
