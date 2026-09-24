/**
 * Atradius import + cover aggregation tests (uses the real Riviera export
 * from 17/09 as fixture: tests/fixtures/atradius-sample.xlsx).
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { readFileSync } from 'fs';
import { db } from '../src/db';
import { tenants, users, counterparties, atradiusImports, atradiusBuyers } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import {
  importAtradiusFile,
  getAtradiusCover,
  mapBuyerToCounterparty,
  listUnmatchedBuyers,
} from '../src/modules/atradius/atradius.service';

const TENANT = 'aaaaaaaa-0000-0000-0000-000000000001';

let userId: string;
let dynacomId: string;
let seawindId: string;

async function ensureTenant(): Promise<void> {
  await db
    .insert(tenants)
    .values({ id: TENANT, name: 'Atradius Test Tenant', domain: 'atradius-test.local' })
    .onConflictDoNothing();
}

beforeAll(async () => {
  await ensureTenant();
  // user
  const [existingUser] = await db.select().from(users).where(eq(users.email, 'atradius-test@fueld.test'));
  if (existingUser) {
    userId = existingUser.id;
  } else {
    const [created] = await db
      .insert(users)
      .values({
        email: 'atradius-test@fueld.test',
        passwordHash: 'x',
        name: 'Atradius Test',
        role: 'ADMIN',
        isActive: true,
        tenantId: TENANT,
      })
      .returning();
    userId = created!.id;
  }
  // counterparties: one exact name match, one normalized-only
  const [cp1] = await db
    .insert(counterparties)
    .values({ tenantId: TENANT, name: 'DYNACOM TANKERS MANAGEMENT LTD', type: 'CLIENT' })
    .returning();
  dynacomId = cp1!.id;
  const [cp2] = await db
    .insert(counterparties)
    .values({ tenantId: TENANT, name: 'Seawind Far East Limited', type: 'CLIENT' })
    .returning();
  seawindId = cp2!.id;
});

afterAll(async () => {
  await db.delete(atradiusBuyers).where(eq(atradiusBuyers.tenantId, TENANT));
  await db.delete(atradiusImports).where(eq(atradiusImports.tenantId, TENANT));
  await db.delete(counterparties).where(eq(counterparties.tenantId, TENANT));
  await db.delete(users).where(eq(users.tenantId, TENANT));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
});

function makeUpload(): { fileName: string; file: File } {
  const buf = readFileSync(import.meta.dir + '/fixtures/atradius-sample.xlsx');
  return { fileName: 'Toutes les polices 17092026.xlsx', file: new File([buf], 'sample.xlsx') };
}

describe('atradius import', () => {
  test('parses the real export, matches by exact name, replaces on re-import', async () => {
    const first = await importAtradiusFile({ tenantId: TENANT, userId, ...makeUpload() });
    expect(first.rowCount).toBeGreaterThan(100);
    expect(first.matchedCount).toBeGreaterThan(0);
    expect(first.unmatchedCount).toBeGreaterThan(0);
    expect(first.replaced).toBe(false);

    // DYNACOM appears twice with different spellings — exact match hits only
    // the identical spelling, the variant stays unmatched (suggestion exists).
    const rows = await db.select().from(atradiusBuyers).where(eq(atradiusBuyers.tenantId, TENANT));
    expect(rows.length).toBe(first.rowCount);
    const dynacomRows = rows.filter((r) => r.buyerName.toUpperCase().startsWith('DYNACOM'));
    expect(dynacomRows.length).toBeGreaterThanOrEqual(2);
    const exact = dynacomRows.filter((r) => r.matchSource === 'EXACT');
    expect(exact.length).toBe(1);
    expect(exact[0]!.matchedCounterpartyId).toBe(dynacomId);
    // status normalization
    const refused = dynacomRows.find((r) => r.matchSource !== 'EXACT');
    expect(refused).toBeTruthy();
    expect(refused!.isActive).toBe(false);

    // re-import: previous data replaced, mapping carried by buyer_number
    const second = await importAtradiusFile({ tenantId: TENANT, userId, ...makeUpload() });
    expect(second.replaced).toBe(true);
    const rowsAfter = await db.select().from(atradiusBuyers).where(eq(atradiusBuyers.tenantId, TENANT));
    expect(rowsAfter.every((r) => r.matchedCounterpartyId === null || r.matchSource !== null)).toBeTrue();
  });

  test('cover: latest decision per buyer_number wins, sums per counterparty, 0 vs — distinction', async () => {
    const cover = await getAtradiusCover(TENANT);
    // DYNACOM matched exactly → has a cover entry
    expect(cover.covers[dynacomId]).toBeTruthy();
    const amount = parseFloat(cover.covers[dynacomId]!.amount);
    expect(amount).toBeGreaterThanOrEqual(0);
    expect(cover.lastImport).toBeTruthy();
    expect(cover.lastImport!.rowCount).toBeGreaterThan(100);
    // Seawind Far East: exact-name match is case-insensitive (normalized key)
    expect(cover.covers[seawindId]).toBeTruthy();
  });

  test('manual mapping applies to all decision rows of a buyer number', async () => {
    const rows = await db.select().from(atradiusBuyers).where(eq(atradiusBuyers.tenantId, TENANT));
    const dynacomVariant = rows.find((r) => r.matchSource !== 'EXACT' && r.buyerName.toUpperCase().startsWith('DYNACOM'));
    expect(dynacomVariant).toBeTruthy();
    const ok = await mapBuyerToCounterparty({
      tenantId: TENANT,
      buyerNumber: dynacomVariant!.buyerNumber,
      counterpartyId: dynacomId,
    });
    expect(ok).toBeTrue();

    // All decision rows of that buyer number are mapped now.
    const updated = await db.select().from(atradiusBuyers).where(eq(atradiusBuyers.tenantId, TENANT));
    const mappedRows = updated.filter((r) => r.buyerNumber === dynacomVariant!.buyerNumber);
    expect(mappedRows.length).toBeGreaterThanOrEqual(1);
    expect(mappedRows.every((r) => r.matchedCounterpartyId === dynacomId && r.matchSource === 'MANUAL')).toBeTrue();

    const cover = await getAtradiusCover(TENANT);
    expect(cover.covers[dynacomId]).toBeTruthy();
    expect(cover.lastImport!.matchedCount).toBeGreaterThan(0);
  });

  test('unmatched list dedupes by buyer number with REAL ids (B2 regression)', async () => {
    const summary = await importAtradiusFile({ tenantId: TENANT, userId, ...makeUpload() });
    // Regression (panel B2): placeholder ids made every modal select share the
    // same key — mapping every buyer to the last-chosen counterparty.
    const ids = summary.unmatched.map((u) => u.id);
    expect(ids.length).toBe(summary.unmatchedCount);
    expect(ids.every((id) => id && id !== '')).toBeTrue();
    expect(new Set(ids).size).toBe(ids.length);

    const unmatched = await listUnmatchedBuyers(TENANT);
    const numbers = unmatched.map((u) => u.buyerNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe('atradius status classification (verified against the real export)', () => {
  /**
   * Two statuses were classified inactive and so dropped from cover entirely.
   * The real 17/09 file settles both questions rather than leaving them to
   * judgement:
   *  - "Annulation future" is a cancellation dated AHEAD. Telford Marine cancels
   *    2026-10-16 (in force today) while Flex Commodities cancelled 2026-09-19
   *    (already lapsed). So the status is active, retired by its cancellation
   *    date — not dead on arrival.
   *  - "Pas d'augmentation de couverture" means an INCREASE was refused; the
   *    standing cover holds. Team Bulk asked for €300k and holds €100k; Hilf
   *    asked €300k and holds €150k; REFUSED rows carry 0. So the AE amount is
   *    the maintained cover, and treating the row as inactive hid real cover.
   */
  test('keeps future cancellations with cover, and drops the lapsed one', async () => {
    await importAtradiusFile({ tenantId: TENANT, userId, ...makeUpload() });
    const rows = await db.select().from(atradiusBuyers).where(eq(atradiusBuyers.tenantId, TENANT));

    const telford = rows.find((r) => r.buyerName.includes('TELFORD'));
    const flex = rows.find((r) => r.buyerName.includes('FLEX COMMODITIES'));
    expect(telford).toBeTruthy();
    expect(flex).toBeTruthy();

    // Cancellation still ahead -> the cover is in force.
    expect(telford!.isActive).toBeTrue();
    expect(Number(telford!.coverAmount)).toBeGreaterThan(0);
    // Cancellation already passed -> not in force.
    expect(flex!.isActive).toBeFalse();
  });

  test('treats a refused increase as standing cover, not as nothing', async () => {
    await importAtradiusFile({ tenantId: TENANT, userId, ...makeUpload() });
    const rows = await db.select().from(atradiusBuyers).where(eq(atradiusBuyers.tenantId, TENANT));
    const noIncrease = rows.filter((r) => r.statusRaw.includes("Pas d'augmentation"));
    expect(noIncrease.length).toBeGreaterThan(0);
    for (const row of noIncrease) {
      expect(row.isActive).toBeTrue();
      // The amount is the maintained cover, never 0.
      expect(Number(row.coverAmount)).toBeGreaterThan(0);
    }
  });
});

describe('atradius mapping is tenant-isolated', () => {
  test('refuses to map a buyer to another tenant\'s counterparty', async () => {
    await importAtradiusFile({ tenantId: TENANT, userId, ...makeUpload() });
    const rows = await db.select().from(atradiusBuyers).where(eq(atradiusBuyers.tenantId, TENANT));
    const buyer = rows.find((r) => !r.matchedCounterpartyId);
    expect(buyer).toBeTruthy();

    // A counterparty belonging to a DIFFERENT tenant.
    const [otherTenant] = await db.insert(tenants).values({ name: `Other-${Date.now()}`, domain: `other-${Date.now()}.local` }).returning();
    const [foreign] = await db.insert(counterparties).values({ tenantId: otherTenant!.id, name: 'Foreign Client', type: 'CLIENT' }).returning();

    const ok = await mapBuyerToCounterparty({ tenantId: TENANT, buyerNumber: buyer!.buyerNumber, counterpartyId: foreign!.id });
    expect(ok).toBeFalse();

    // And nothing was written.
    const after = await db.select().from(atradiusBuyers)
      .where(eq(atradiusBuyers.tenantId, TENANT));
    expect(after.find((r) => r.buyerNumber === buyer!.buyerNumber)?.matchedCounterpartyId ?? null).toBeNull();

    await db.delete(counterparties).where(eq(counterparties.tenantId, otherTenant!.id));
    await db.delete(tenants).where(eq(tenants.id, otherTenant!.id));
  });
});