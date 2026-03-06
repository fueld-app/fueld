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

// Second admin user for parallel admin specs (avoids session invalidation issues when two specs log in as the same user).
const admin2Email = (process.env['E2E_ADMIN2_EMAIL'] ?? 'admin2@fueld.local').toLowerCase();
const admin2Password = process.env['E2E_ADMIN2_PASSWORD'] ?? 'admin2password123';
const admin3Email = (process.env['E2E_ADMIN3_EMAIL'] ?? 'admin3@fueld.local').toLowerCase();
const admin3Password = process.env['E2E_ADMIN3_PASSWORD'] ?? 'admin3password123';

const resetTargetEmail = (process.env['E2E_RESET_USER_EMAIL'] ?? 'resetme@fueld.local').toLowerCase();
const resetTargetPassword = process.env['E2E_RESET_USER_PASSWORD'] ?? 'oldpassword123';

const traderEmail = (process.env['E2E_TRADER_USER_EMAIL'] ?? 'trader@fueld.local').toLowerCase();
const traderPassword = process.env['E2E_TRADER_USER_PASSWORD'] ?? 'traderpassword123';

// Extra TRADER users so E2E specs can run in parallel without invalidating each other's sessions.
const trader2Email = (process.env['E2E_TRADER2_USER_EMAIL'] ?? 'trader2@fueld.local').toLowerCase();
const trader2Password = process.env['E2E_TRADER2_USER_PASSWORD'] ?? 'trader2password123';
const trader3Email = (process.env['E2E_TRADER3_USER_EMAIL'] ?? 'trader3@fueld.local').toLowerCase();
const trader3Password = process.env['E2E_TRADER3_USER_PASSWORD'] ?? 'trader3password123';
const trader4Email = (process.env['E2E_TRADER4_USER_EMAIL'] ?? 'trader4@fueld.local').toLowerCase();
const trader4Password = process.env['E2E_TRADER4_USER_PASSWORD'] ?? 'trader4password123';
const trader5Email = (process.env['E2E_TRADER5_USER_EMAIL'] ?? 'trader5@fueld.local').toLowerCase();
const trader5Password = process.env['E2E_TRADER5_USER_PASSWORD'] ?? 'trader5password123';
const trader6Email = (process.env['E2E_TRADER6_USER_EMAIL'] ?? 'trader6@fueld.local').toLowerCase();
const trader6Password = process.env['E2E_TRADER6_USER_PASSWORD'] ?? 'trader6password123';
const trader7Email = (process.env['E2E_TRADER7_USER_EMAIL'] ?? 'trader7@fueld.local').toLowerCase();
const trader7Password = process.env['E2E_TRADER7_USER_PASSWORD'] ?? 'trader7password123';

const limitedEmail = (process.env['E2E_LIMITED_USER_EMAIL'] ?? 'limited@fueld.local').toLowerCase();
const limitedPassword = process.env['E2E_LIMITED_USER_PASSWORD'] ?? 'limitedpassword123';

const creditEmail = (process.env['E2E_CREDIT_USER_EMAIL'] ?? 'credit@fueld.local').toLowerCase();
const creditPassword = process.env['E2E_CREDIT_USER_PASSWORD'] ?? 'creditpassword123';

const twoFaEmail = (process.env['E2E_2FA_USER_EMAIL'] ?? 'twofa@fueld.local').toLowerCase();
const twoFaPassword = process.env['E2E_2FA_USER_PASSWORD'] ?? 'twofapassword123';
// Base32 secret used by common TOTP apps; we only need login→/login/2fa redirect stability.
const twoFaSecret = process.env['E2E_2FA_SECRET'] ?? 'JBSWY3DPEHPK3PXP';

const ownCompanyName = process.env['E2E_OWN_COMPANY_NAME'] ?? 'E2E Own Company';

const clientName = process.env['E2E_CLIENT_NAME'] ?? 'E2E Client Co';
const vesselName = process.env['E2E_VESSEL_NAME'] ?? 'E2E Vessel';
const placeName = process.env['E2E_PLACE_NAME'] ?? 'E2E Port';

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

  // Defensive re-read: some local test DB states can have stale assumptions
  // after repeated truncate/seed cycles. Always confirm the tenant row exists
  // before inserting any users that reference it.
  let confirmedTenant = await db.query.tenants.findFirst({
    where: eq(schema.tenants.id, tenant.id),
  });

  if (!confirmedTenant) {
    confirmedTenant = (
      await db
        .insert(schema.tenants)
        .values({
          name: tenantName,
          domain: `${tenantDomain}-${Date.now()}`,
        })
        .returning()
    )[0]!;
  }

  tenant = confirmedTenant;

  const passwordHash = await hashPassword(password);
  const admin2PasswordHash = await hashPassword(admin2Password);
  const admin3PasswordHash = await hashPassword(admin3Password);
  const resetPasswordHash = await hashPassword(resetTargetPassword);
  const traderPasswordHash = await hashPassword(traderPassword);
  const limitedPasswordHash = await hashPassword(limitedPassword);
  const creditPasswordHash = await hashPassword(creditPassword);
  const twoFaPasswordHash = await hashPassword(twoFaPassword);

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

  const existingAdmin2 = await db.query.users.findFirst({
    where: eq(schema.users.email, admin2Email),
  });
  if (existingAdmin2) {
    await db
      .update(schema.users)
      .set({
        tenantId: tenant.id,
        name: 'E2E Admin 2',
        role: 'ADMIN',
        isActive: true,
        is2faEnabled: false,
        twoFactorSecret: null,
        passwordHash: admin2PasswordHash,
        refreshToken: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, existingAdmin2.id));
  } else {
    await db.insert(schema.users).values({
      tenantId: tenant.id,
      email: admin2Email,
      name: 'E2E Admin 2',
      role: 'ADMIN',
      isActive: true,
      is2faEnabled: false,
      passwordHash: admin2PasswordHash,
    });
  }

  const existingAdmin3 = await db.query.users.findFirst({
    where: eq(schema.users.email, admin3Email),
  });
  if (existingAdmin3) {
    await db
      .update(schema.users)
      .set({
        tenantId: tenant.id,
        name: 'E2E Admin 3',
        role: 'ADMIN',
        isActive: true,
        is2faEnabled: false,
        twoFactorSecret: null,
        passwordHash: admin3PasswordHash,
        refreshToken: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, existingAdmin3.id));
  } else {
    await db.insert(schema.users).values({
      tenantId: tenant.id,
      email: admin3Email,
      name: 'E2E Admin 3',
      role: 'ADMIN',
      isActive: true,
      is2faEnabled: false,
      passwordHash: admin3PasswordHash,
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

  // Separate TRADER user for permission tests (not used in password reset flow).
  const existingTrader = await db.query.users.findFirst({
    where: eq(schema.users.email, traderEmail),
  });
  if (existingTrader) {
    await db
      .update(schema.users)
      .set({
        tenantId: tenant.id,
        name: 'E2E Trader',
        role: 'TRADER',
        isActive: true,
        is2faEnabled: false,
        twoFactorSecret: null,
        passwordHash: traderPasswordHash,
        refreshToken: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, existingTrader.id));
  } else {
    await db.insert(schema.users).values({
      tenantId: tenant.id,
      email: traderEmail,
      name: 'E2E Trader',
      role: 'TRADER',
      isActive: true,
      is2faEnabled: false,
      passwordHash: traderPasswordHash,
    });
  }

  const extraTraders: Array<{ email: string; password: string; name: string }> = [
    { email: trader2Email, password: trader2Password, name: 'E2E Trader 2' },
    { email: trader3Email, password: trader3Password, name: 'E2E Trader 3' },
    { email: trader4Email, password: trader4Password, name: 'E2E Trader 4' },
    { email: trader5Email, password: trader5Password, name: 'E2E Trader 5' },
    { email: trader6Email, password: trader6Password, name: 'E2E Trader 6' },
    { email: trader7Email, password: trader7Password, name: 'E2E Trader 7' },
  ];

  for (const t of extraTraders) {
    const passwordHash = await hashPassword(t.password);
    const existing = await db.query.users.findFirst({
      where: eq(schema.users.email, t.email),
    });

    if (existing) {
      await db
        .update(schema.users)
        .set({
          tenantId: tenant.id,
          name: t.name,
          role: 'TRADER',
          isActive: true,
          is2faEnabled: false,
          twoFactorSecret: null,
          passwordHash,
          refreshToken: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, existing.id));
    } else {
      await db.insert(schema.users).values({
        tenantId: tenant.id,
        email: t.email,
        name: t.name,
        role: 'TRADER',
        isActive: true,
        is2faEnabled: false,
        passwordHash,
      });
    }
  }

  // Additional limited TRADER user to avoid parallel session contention across specs.
  const existingLimited = await db.query.users.findFirst({
    where: eq(schema.users.email, limitedEmail),
  });
  if (existingLimited) {
    await db
      .update(schema.users)
      .set({
        tenantId: tenant.id,
        name: 'E2E Limited',
        role: 'TRADER',
        isActive: true,
        is2faEnabled: false,
        twoFactorSecret: null,
        passwordHash: limitedPasswordHash,
        refreshToken: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, existingLimited.id));
  } else {
    await db.insert(schema.users).values({
      tenantId: tenant.id,
      email: limitedEmail,
      name: 'E2E Limited',
      role: 'TRADER',
      isActive: true,
      is2faEnabled: false,
      passwordHash: limitedPasswordHash,
    });
  }

  // CREDITMANAGER user for creditGuard route coverage.
  const existingCredit = await db.query.users.findFirst({
    where: eq(schema.users.email, creditEmail),
  });
  if (existingCredit) {
    await db
      .update(schema.users)
      .set({
        tenantId: tenant.id,
        name: 'E2E Credit Manager',
        role: 'CREDITMANAGER',
        isActive: true,
        is2faEnabled: false,
        twoFactorSecret: null,
        passwordHash: creditPasswordHash,
        refreshToken: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, existingCredit.id));
  } else {
    await db.insert(schema.users).values({
      tenantId: tenant.id,
      email: creditEmail,
      name: 'E2E Credit Manager',
      role: 'CREDITMANAGER',
      isActive: true,
      is2faEnabled: false,
      passwordHash: creditPasswordHash,
    });
  }

  // 2FA-enabled user for login→/login/2fa flow coverage.
  const existing2fa = await db.query.users.findFirst({
    where: eq(schema.users.email, twoFaEmail),
  });
  if (existing2fa) {
    await db
      .update(schema.users)
      .set({
        tenantId: tenant.id,
        name: 'E2E Two-Factor',
        role: 'TRADER',
        isActive: true,
        is2faEnabled: true,
        twoFactorSecret: twoFaSecret,
        passwordHash: twoFaPasswordHash,
        refreshToken: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, existing2fa.id));
  } else {
    await db.insert(schema.users).values({
      tenantId: tenant.id,
      email: twoFaEmail,
      name: 'E2E Two-Factor',
      role: 'TRADER',
      isActive: true,
      is2faEnabled: true,
      twoFactorSecret: twoFaSecret,
      passwordHash: twoFaPasswordHash,
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

  // Seed one deterministic client + vessel + place for Trading flows.
  const existingClient = await db.query.counterparties.findFirst({
    where: and(
      eq(schema.counterparties.tenantId, tenant.id),
      eq(schema.counterparties.name, clientName),
    ),
  });
  if (!existingClient) {
    await db.insert(schema.counterparties).values({
      tenantId: tenant.id,
      name: clientName,
      type: 'CLIENT',
      types: ['CLIENT'],
      country: 'US',
      isOwnCompany: false,
      customerTerms: null,
      supplierTerms: null,
    });
  }

  const existingVessel = await db.query.vessels.findFirst({
    where: eq(schema.vessels.name, vesselName),
  });
  if (!existingVessel) {
    await db.insert(schema.vessels).values({
      name: vesselName,
    });
  }

  const existingPlace = await db.query.places.findFirst({
    where: eq(schema.places.name, placeName),
  });
  if (!existingPlace) {
    await db.insert(schema.places).values({
      name: placeName,
      country: 'US',
    });
  }

  console.log(
    `✅ Seeded Playwright users: ${email}, ${admin2Email}, ${admin3Email}, ${resetTargetEmail} (tenant: ${tenant.name} / ${tenant.domain} / ${tenant.id})`,
  );
  console.log(`✅ Seeded trader user: ${traderEmail}`);
  console.log(
    `✅ Seeded additional trader users: ${[trader2Email, trader3Email, trader4Email, trader5Email, trader6Email, trader7Email].join(', ')}`,
  );
  console.log(`✅ Seeded limited user: ${limitedEmail}`);
  console.log(`✅ Seeded credit manager user: ${creditEmail}`);
  console.log(`✅ Seeded 2FA user: ${twoFaEmail}`);
  console.log(`✅ Seeded own company: ${ownCompanyName}`);
  console.log(`✅ Seeded trading entities: client=${clientName}, vessel=${vesselName}, place=${placeName}`);
}

await main()
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
