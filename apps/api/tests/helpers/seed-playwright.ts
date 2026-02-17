/**
 * Seed a minimal dataset for Playwright UI tests.
 *
 * Creates:
 * - 1 tenant (uses the existing first tenant if present)
 * - 1 user (email: e2e@fueld.local, role: ADMIN)
 *
 * Usage:
 *   TEST_DATABASE_URL=postgres://... bun run apps/api/tests/helpers/seed-playwright.ts
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { hashPassword } from '../../src/modules/auth/password.service';

const DATABASE_URL = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL or DATABASE_URL is required');
}

// NOTE: much of the API currently behaves as a single-tenant app and resolves the
// effective tenant via `db.query.tenants.findFirst()`.
// To keep Playwright UI tests stable (especially Admin pages), we attach users/data
// to the first tenant row if it exists.
const tenantDomain = process.env['E2E_TENANT_DOMAIN'] ?? 'localhost';
const tenantName = process.env['E2E_TENANT_NAME'] ?? 'E2E Tenant';
const email = (process.env['E2E_USER_EMAIL'] ?? 'e2e@fueld.local').toLowerCase();
const password = process.env['E2E_USER_PASSWORD'] ?? 'password123';

const resetTargetEmail = (process.env['E2E_RESET_USER_EMAIL'] ?? 'resetme@fueld.local').toLowerCase();
const resetTargetPassword = process.env['E2E_RESET_USER_PASSWORD'] ?? 'oldpassword123';

const ownCompanyName = process.env['E2E_OWN_COMPANY_NAME'] ?? 'E2E Own Company';

const sql = postgres(DATABASE_URL, { max: 1 });
const db = drizzle(sql, { schema });

async function main(): Promise<void> {
  // Ensure we have a tenant, but prefer using the first tenant so Admin pages
  // (which assume single-tenant) see the seeded data.
  let tenant = await db.query.tenants.findFirst();

  if (!tenant) {
    tenant = (
      await db
        .insert(schema.tenants)
        .values({ name: tenantName, domain: tenantDomain })
        .returning()
    )[0]!;
  }

  const passwordHash = await hashPassword(password);
  const resetPasswordHash = await hashPassword(resetTargetPassword);

  const existingAdmin = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });
  if (existingAdmin) {
    await db
      .update(schema.users)
      .set({
        tenantId: tenant.id,
        name: 'E2E Admin',
        role: 'ADMIN',
        isActive: true,
        is2faEnabled: false,
        twoFactorSecret: null,
        passwordHash,
        refreshToken: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, existingAdmin.id));
  } else {
    await db.insert(schema.users).values({
      tenantId: tenant.id,
      email,
      name: 'E2E Admin',
      role: 'ADMIN',
      isActive: true,
      is2faEnabled: false,
      passwordHash,
    });
  }

  const existingResetTarget = await db.query.users.findFirst({
    where: eq(schema.users.email, resetTargetEmail),
  });
  if (existingResetTarget) {
    await db
      .update(schema.users)
      .set({
        tenantId: tenant.id,
        name: 'Reset Target',
        role: 'TRADER',
        isActive: true,
        is2faEnabled: false,
        twoFactorSecret: null,
        passwordHash: resetPasswordHash,
        refreshToken: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, existingResetTarget.id));
  } else {
    await db.insert(schema.users).values({
      tenantId: tenant.id,
      email: resetTargetEmail,
      name: 'Reset Target',
      role: 'TRADER',
      isActive: true,
      is2faEnabled: false,
      passwordHash: resetPasswordHash,
    });
  }

  // Ensure one own company exists for Admin → Our Companies tests.
  const existingOwnCompany = await db.query.counterparties.findFirst({
    where: and(
      eq(schema.counterparties.tenantId, tenant.id),
      eq(schema.counterparties.name, ownCompanyName),
    ),
  });
  if (!existingOwnCompany) {
    await db.insert(schema.counterparties).values({
      tenantId: tenant.id,
      name: ownCompanyName,
      type: 'CLIENT',
      types: ['CLIENT'],
      country: 'US',
      isOwnCompany: true,
      customerTerms: null,
      supplierTerms: null,
    });
  }

  console.log(
    `✅ Seeded Playwright users: ${email}, ${resetTargetEmail} (tenant: ${tenant.name} / ${tenant.domain} / ${tenant.id})`,
  );
  console.log(`✅ Seeded own company: ${ownCompanyName}`);
}

await main()
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
