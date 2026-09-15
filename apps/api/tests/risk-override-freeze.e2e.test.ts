/**
 * Regression tests for the risk-override auto-revoke fix (2026-09-14):
 *
 *   A permanent override (expiresAt IS NULL) is a standing human decision
 *   to accept a risk hit. runScheduledChecks used to revoke ALL approved
 *   overrides — including permanent ones — on every scheduled re-check,
 *   so counterparties that legitimately stay on watchlists (CMA CGM, PNSC)
 *   re-froze on every run. Auto-enforce now revokes only TEMPORARY
 *   overrides; these tests pin the frozen/unfrozen invariants around that.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { counterparties, riskChecks, riskHits, riskOverrides } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';
import type { creditService } from '../src/modules/credit/credit.service';

type RiskService = typeof import('../src/modules/risk-monitoring/risk-monitoring.service');

async function loadRiskService(): Promise<RiskService> {
  return import('../src/modules/risk-monitoring/risk-monitoring.service');
}

async function seedCompanyWithHit() {
  const seeded = await seedBasics();
  const db = await getDb();

  const [company] = await db
    .insert(counterparties)
    .values({
      tenantId: seeded.tenant.id,
      name: 'Sanctioned Carrier',
      type: 'CLIENT',
      types: ['CLIENT'],
      country: 'USA',
    })
    .returning();

  const [check] = await db
    .insert(riskChecks)
    .values({
      tenantId: seeded.tenant.id,
      counterpartyId: company.id,
      providerClass: 'WATCHLIST',
      providerName: 'Watchlist',
      status: 'HIT',
    })
    .returning();

  await db.insert(riskHits).values({
    riskCheckId: check.id,
    tenantId: seeded.tenant.id,
    counterpartyId: company.id,
    providerClass: 'WATCHLIST',
    severity: 'CRITICAL',
    signalType: 'SANCTION',
    title: 'Sanctions match',
    isActive: true,
  });

  return { seeded, db, company };
}

describe('permanent risk overrides survive scheduled re-checks', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('active hit with no override freezes credit', async () => {
    const { company } = await seedCompanyWithHit();
    const svc = await loadRiskService();
    expect(await svc.isCreditFrozen(company.id)).toBe(true);
  });

  it('an APPROVED permanent override unfreezes credit despite active hits', async () => {
    const { seeded, db, company } = await seedCompanyWithHit();
    const svc = await loadRiskService();

    await db.insert(riskOverrides).values({
      tenantId: seeded.tenant.id,
      counterpartyId: company.id,
      reason: 'Standing decision — carrier on watchlist is expected',
      status: 'APPROVED',
      expiresAt: null, // permanent
      requestedByUserId: seeded.user.id,
    });

    expect(await svc.isCreditFrozen(company.id)).toBe(false);

    // Batch variant must agree.
    const frozen = await svc.getFrozenCounterpartyIds([company.id]);
    expect(frozen.has(company.id)).toBe(false);
  });

  it('an expired temporary override does not unfreeze credit', async () => {
    const { seeded, db, company } = await seedCompanyWithHit();
    const svc = await loadRiskService();

    await db.insert(riskOverrides).values({
      tenantId: seeded.tenant.id,
      counterpartyId: company.id,
      reason: 'Temporary window',
      status: 'APPROVED',
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // expired yesterday
      requestedByUserId: seeded.user.id,
    });

    expect(await svc.isCreditFrozen(company.id)).toBe(true);
  });

  it('a REVOKED override does not unfreeze credit (the bug Mirko reported)', async () => {
    const { seeded, db, company } = await seedCompanyWithHit();
    const svc = await loadRiskService();

    await db.insert(riskOverrides).values({
      tenantId: seeded.tenant.id,
      counterpartyId: company.id,
      reason: 'Was permanent, then auto-revoked by the old logic',
      status: 'REVOKED',
      expiresAt: null,
      requestedByUserId: seeded.user.id,
    });

    expect(await svc.isCreditFrozen(company.id)).toBe(true);
  });
});