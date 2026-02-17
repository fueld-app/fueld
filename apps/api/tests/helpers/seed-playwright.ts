/**
 * Seed a minimal dataset for Playwright UI tests.
 *
 * Creates:
 * - 1 tenant (domain: e2e.local)
 * - 1 user (email: e2e@fueld.local, role: ADMIN)
 *
 * Usage:
 *   TEST_DATABASE_URL=postgres://... bun run apps/api/tests/helpers/seed-playwright.ts
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { hashPassword } from '../../src/modules/auth/password.service';

const DATABASE_URL = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL or DATABASE_URL is required');
}

const tenantDomain = process.env['E2E_TENANT_DOMAIN'] ?? 'e2e.local';
const tenantName = process.env['E2E_TENANT_NAME'] ?? 'E2E Tenant';
const email = process.env['E2E_USER_EMAIL'] ?? 'e2e@fueld.local';
const password = process.env['E2E_USER_PASSWORD'] ?? 'password123';

const sql = postgres(DATABASE_URL, { max: 1 });
const db = drizzle(sql, { schema });

async function main(): Promise<void> {
  // Delete any previous run's user with same email (email is unique).
  await db.delete(schema.users).where(eq(schema.users.email, email));

  // Ensure tenant exists.
  const existingTenant = await db.query.tenants.findFirst({
    where: eq(schema.tenants.domain, tenantDomain),
  });

  const tenant = existingTenant
    ?? (
      await db
        .insert(schema.tenants)
        .values({ name: tenantName, domain: tenantDomain })
        .returning()
    )[0]!;

  const passwordHash = await hashPassword(password);

  await db.insert(schema.users).values({
    tenantId: tenant.id,
    email,
    name: 'E2E Admin',
    role: 'ADMIN',
    passwordHash,
  });

  console.log(`✅ Seeded Playwright user: ${email} (tenant: ${tenantDomain})`);
}

await main()
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
