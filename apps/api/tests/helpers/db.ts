import postgres from 'postgres';
import * as schema from '../../src/db/schema';

const DEFAULT_DATABASE_URL = 'postgres://fueld:fueld@localhost:5432/fueld';
const DATABASE_URL = process.env['DATABASE_URL'] ?? DEFAULT_DATABASE_URL;
process.env['DATABASE_URL'] = DATABASE_URL;

const sql = postgres(DATABASE_URL, { max: 1 });

const TRUNCATE_TABLES = [
  'activity_logs',
  'order_items',
  'orders',
  'order_number_sequences',
  'counterparties',
  'vessels',
  'places',
  'users',
  'tenants',
];

export async function truncateAll(): Promise<void> {
  const list = TRUNCATE_TABLES.map((t) => `"${t}"`).join(', ');
  await sql.unsafe(`TRUNCATE TABLE ${list} CASCADE;`);
}

export async function closeDb(): Promise<void> {
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

export async function getDb() {
  const { db } = await import('../../src/db');
  return db;
}
