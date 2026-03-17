import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../src/db/schema';
import { existsSync } from 'fs';
import { join } from 'path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

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

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined;

function getDbInstance() {
  if (!dbInstance) {
    dbInstance = drizzle(getSql(), { schema });
  }
  return dbInstance;
}

function getTruncateTables() {
  return [
    'activity_logs',
    'entity_comments',
    'password_reset_tokens',
    'integration_credentials',
    'push_subscriptions',
    'bank_accounts',
    'user_company_overrides',
    'company_group_members',
    'company_groups',
    'team_companies',
    'teams',
    'company_emails',
    'company_contacts',
    'credit_application_reviews',
    'credit_applications',
    'credit_line_companies',
    'credit_line_counterparties',
    'credit_lines',
    'company_offices',
    'supplier_inquiry_item_quotes',
    'supplier_inquiries',
    'email_rules',
    'price_references',
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

let migrationsPromise: Promise<void> | null = null;
let schemaCompatPromise: Promise<void> | null = null;

function resolveMigrationsDir(): string {
  const env = process.env['MIGRATIONS_DIR'];
  if (env) return env;

  const candidates = [
    // When running within apps/api directly
    join(import.meta.dir, '../../../drizzle'),
    // When running from monorepo root
    join(process.cwd(), 'apps/api/drizzle'),
  ];

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }

  return './drizzle';
}

async function ensureMigrationsApplied(): Promise<void> {
  if (!migrationsPromise) {
    migrationsPromise = (async () => {
      await migrate(getDbInstance(), { migrationsFolder: resolveMigrationsDir() });
    })();
  }

  try {
    await migrationsPromise;
  } catch {
    // If migrations fail (e.g. partial schema during local dev),
    // fall back to the compat shim below.
  }
}

async function ensureTestSchemaCompat(): Promise<void> {
  if (!schemaCompatPromise) {
    schemaCompatPromise = _doEnsureTestSchemaCompat();
  }
  await schemaCompatPromise;
}

async function _doEnsureTestSchemaCompat(): Promise<void> {
  const sql = getSql();

  // Serialize across parallel test-file connections to prevent DDL deadlocks.
  // Lock id 737833 is arbitrary but unique within the test database.
  await sql`SELECT pg_advisory_lock(737833)`;
  try {

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
    ADD COLUMN IF NOT EXISTS closed_at timestamptz,
    ADD COLUMN IF NOT EXISTS delivered_at timestamptz
  `;

  await sql`
    ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS quantity_min numeric(12, 3),
    ADD COLUMN IF NOT EXISTS quantity_max numeric(12, 3),
    ADD COLUMN IF NOT EXISTS description text,
    ADD COLUMN IF NOT EXISTS cost_currency text DEFAULT 'USD',
    ADD COLUMN IF NOT EXISTS sales_currency text DEFAULT 'USD',
    ADD COLUMN IF NOT EXISTS delivered_quantity numeric(12, 3),
    ADD COLUMN IF NOT EXISTS cost_pricing_model text NOT NULL DEFAULT 'FIXED',
    ADD COLUMN IF NOT EXISTS cost_reference_id uuid,
    ADD COLUMN IF NOT EXISTS cost_premium numeric(12, 4),
    ADD COLUMN IF NOT EXISTS cost_barging numeric(12, 4),
    ADD COLUMN IF NOT EXISTS cost_barging_unit text,
    ADD COLUMN IF NOT EXISTS cost_credit_days integer,
    ADD COLUMN IF NOT EXISTS cost_price_finalized boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS sales_pricing_model text NOT NULL DEFAULT 'FIXED',
    ADD COLUMN IF NOT EXISTS sales_reference_id uuid,
    ADD COLUMN IF NOT EXISTS sales_premium numeric(12, 4),
    ADD COLUMN IF NOT EXISTS sales_barging numeric(12, 4),
    ADD COLUMN IF NOT EXISTS sales_barging_unit text,
    ADD COLUMN IF NOT EXISTS sales_credit_days integer,
    ADD COLUMN IF NOT EXISTS sales_price_finalized boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS unit_conversion_factor numeric(12, 6) NOT NULL DEFAULT '1'
  `;

  await sql`
    ALTER TABLE counterparties
    ADD COLUMN IF NOT EXISTS customer_terms text,
    ADD COLUMN IF NOT EXISTS supplier_terms text,
    ADD COLUMN IF NOT EXISTS company_registration_number text,
    ADD COLUMN IF NOT EXISTS late_payment_interest text,
    ADD COLUMN IF NOT EXISTS logo_url text,
    ADD COLUMN IF NOT EXISTS brand_color text,
    ADD COLUMN IF NOT EXISTS vat_number text,
    ADD COLUMN IF NOT EXISTS fraud_prevention_text text,
    ADD COLUMN IF NOT EXISTS companies_house_number text,
    ADD COLUMN IF NOT EXISTS dismissed_conflicts jsonb DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS segments jsonb DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS parent_id uuid,
    ADD COLUMN IF NOT EXISTS manual_overrides jsonb DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS seasearcher_id text,
    ADD COLUMN IF NOT EXISTS company_imo text,
    ADD COLUMN IF NOT EXISTS country_iso text,
    ADD COLUMN IF NOT EXISTS year_formed integer,
    ADD COLUMN IF NOT EXISTS company_roles jsonb,
    ADD COLUMN IF NOT EXISTS fleet_size integer,
    ADD COLUMN IF NOT EXISTS head_office_address text,
    ADD COLUMN IF NOT EXISTS head_office_phone text,
    ADD COLUMN IF NOT EXISTS head_office_email text,
    ADD COLUMN IF NOT EXISTS website text,
    ADD COLUMN IF NOT EXISTS is_sanctioned boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS last_synced timestamptz,
    ADD COLUMN IF NOT EXISTS responsible_user_id uuid
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS price_references (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      name text NOT NULL,
      code text NOT NULL,
      description text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    ALTER TABLE places
    ADD COLUMN IF NOT EXISTS order_remark text
  `;

  await sql`
    ALTER TABLE places
    ADD COLUMN IF NOT EXISTS timezone_legacy text
  `;

  // Drop stale email_log (may be missing bcc_emails from old compat shim)
  await sql`DROP TABLE IF EXISTS email_log CASCADE`;

  await sql`
    CREATE TABLE IF NOT EXISTS email_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid REFERENCES tenants(id),
      order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
      document_type text NOT NULL,
      sent_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      sent_from_email text NOT NULL,
      sent_to text NOT NULL,
      cc_emails text,
      bcc_emails text,
      subject text NOT NULL,
      pdf_file_name text,
      channel text NOT NULL DEFAULT 'SMTP',
      status text NOT NULL DEFAULT 'SENT',
      error_message text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS microsoft_refresh_token text,
    ADD COLUMN IF NOT EXISTS microsoft_refresh_token_iv text,
    ADD COLUMN IF NOT EXISTS microsoft_refresh_token_auth_tag text
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS email_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      own_company_id uuid REFERENCES counterparties(id) ON DELETE CASCADE,
      document_type text,
      rule_type text NOT NULL,
      email text NOT NULL,
      label text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  // Drop stale supplier_inquiries (may have wrong columns from old compat shim)
  await sql`DROP TABLE IF EXISTS supplier_inquiries CASCADE`;

  await sql`
    CREATE TABLE IF NOT EXISTS supplier_inquiries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      supplier_id uuid NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
      contact_id uuid REFERENCES company_contacts(id) ON DELETE SET NULL,
      email text NOT NULL,
      subject text NOT NULL,
      status text NOT NULL DEFAULT 'SENT',
      quote_token_hash text,
      quote_token_expires_at timestamptz,
      response_deadline_at timestamptz,
      reminder_sent_at timestamptz,
      reminder_count integer NOT NULL DEFAULT 0,
      responded_at timestamptz,
      quoted_at timestamptz,
      can_deliver boolean,
      decline_reason text,
      quote_valid_until timestamptz,
      delivery_window text,
      supplier_payment_terms text,
      supplier_comment text,
      sent_by_user_id uuid REFERENCES users(id),
      sent_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_inquiries_order_supplier
      ON supplier_inquiries(order_id, supplier_id)
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_inquiries_quote_token_hash
      ON supplier_inquiries(quote_token_hash)
      WHERE quote_token_hash IS NOT NULL
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS supplier_inquiry_item_quotes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      supplier_inquiry_id uuid NOT NULL REFERENCES supplier_inquiries(id) ON DELETE CASCADE,
      order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
      price numeric(12, 4),
      currency text NOT NULL,
      note text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    ALTER TABLE supplier_inquiry_item_quotes
    ADD COLUMN IF NOT EXISTS order_item_id uuid REFERENCES order_items(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS price numeric(12, 4),
    ADD COLUMN IF NOT EXISTS currency text,
    ADD COLUMN IF NOT EXISTS note text,
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()
  `;

  await sql`
    ALTER TABLE supplier_inquiry_item_quotes
    ALTER COLUMN price DROP NOT NULL
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_inquiry_item_quotes_unique
      ON supplier_inquiry_item_quotes(supplier_inquiry_id, order_item_id)
  `;

  // Credit application enums / tables
  await sql`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'credit_application_status') THEN
      CREATE TYPE credit_application_status AS ENUM ('PENDING','APPROVED','REJECTED','CANCELLED');
    END IF;
  END $$`;

  await sql`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'credit_application_review_decision') THEN
      CREATE TYPE credit_application_review_decision AS ENUM ('APPROVED','REJECTED');
    END IF;
  END $$`;

  await sql`
    CREATE TABLE IF NOT EXISTS credit_applications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      type credit_line_type NOT NULL,
      counterparty_id uuid NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
      order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
      credit_line_id uuid REFERENCES credit_lines(id) ON DELETE SET NULL,
      requested_amount numeric(14,2) NOT NULL,
      requested_currency text NOT NULL DEFAULT 'USD',
      requested_days integer,
      reason text,
      status credit_application_status NOT NULL DEFAULT 'PENDING',
      requested_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      resolved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS credit_application_reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id uuid NOT NULL REFERENCES credit_applications(id) ON DELETE CASCADE,
      reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      decision credit_application_review_decision NOT NULL,
      comment text,
      decided_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  // Migration 0050 – place_remark on orders
  await sql`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS place_remark text
  `;

  // Migration 0051 – company_offices
  await sql`
    CREATE TABLE IF NOT EXISTS company_offices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      counterparty_id uuid NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
      label text NOT NULL,
      address text,
      city text,
      country text,
      phone text,
      email text,
      is_hq boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  // Migration 0054 – vessel sanction checks
  await sql`
    ALTER TABLE vessels
    ADD COLUMN IF NOT EXISTS sanction_status text DEFAULT 'UNCHECKED',
    ADD COLUMN IF NOT EXISTS last_sanction_check timestamptz
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS vessel_sanction_checks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      vessel_id uuid NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
      status text NOT NULL,
      source text NOT NULL DEFAULT 'TANKERTRACKERS',
      matched_on text,
      raw_data jsonb,
      checked_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  // Migration 0056 – order broker fields
  await sql`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS broker_id uuid,
    ADD COLUMN IF NOT EXISTS broker_contact_id uuid,
    ADD COLUMN IF NOT EXISTS broker_gets_all boolean NOT NULL DEFAULT false
  `;

  } finally {
    await sql`SELECT pg_advisory_unlock(737833)`;
  }
}

export async function truncateAll(): Promise<void> {
  const sql = getSql();
  await ensureMigrationsApplied();
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
  const db = getDbInstance();
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
  const db = getDbInstance();
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
  return getDbInstance();
}
