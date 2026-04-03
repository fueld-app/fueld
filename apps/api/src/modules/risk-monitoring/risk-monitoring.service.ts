// ═══════════════════════════════════════════════════════════════════════
//  Risk Monitoring Service
//
//  Core engine: runs provider checks, persists results, computes
//  risk summaries, and determines credit-frozen status.
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, sql, desc, inArray } from 'drizzle-orm';
import { db } from '../../db';
import {
  counterparties,
  creditLines,
  creditLineCounterparties,
  riskChecks,
  riskHits,
  riskOverrides,
  riskOverrideApprovals,
  tenants,
  users,
} from '../../db/schema';
import type {
  RiskCheckDto,
  RiskHitDto,
  RiskSummaryDto,
  RiskOverrideDto,
  RiskOverrideApprovalDto,
  RiskMonitoringSettingsDto,
} from '@fueld/types';
import type { TenantSettings } from '../../db/schema';
import {
  openSanctionsProvider,
  seasearcherProvider,
  companiesHouseProvider,
} from './providers';
import type { RiskProvider, ProviderSettings, ProviderCheckResult, CompanyForCheck } from './providers';
import { sendNotificationToUsers } from '../push/push.service';

const ALL_PROVIDERS: RiskProvider[] = [
  openSanctionsProvider,
  seasearcherProvider,
  companiesHouseProvider,
];

// ═══════════════════════════════════════════════════════════════════════
//  SETTINGS HELPERS
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SETTINGS: RiskMonitoringSettingsDto = {
  enabled: false,
  checkIntervalHours: 24,
  openSanctionsEnabled: false,
  openSanctionsBaseUrl: 'http://localhost:8000',
  companiesHouseEnabled: false,
  companiesHouseApiKey: '',
  seasearcherEnabled: true,
  autoEnforceOnHit: true,
  overrideRequiredApprovals: 1,
  overrideExpiryDays: 7,
  notifyPush: true,
  notifyEmail: true,
  notifyWhatsApp: false,
};

export async function getRiskMonitoringSettings(tenantId: string): Promise<RiskMonitoringSettingsDto> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { settings: true },
  });
  return { ...DEFAULT_SETTINGS, ...(tenant?.settings as TenantSettings)?.riskMonitoringSettings };
}

export async function updateRiskMonitoringSettings(
  tenantId: string,
  patch: Partial<RiskMonitoringSettingsDto>,
): Promise<RiskMonitoringSettingsDto> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { settings: true },
  });
  const current = (tenant?.settings as TenantSettings) ?? {};
  const merged = { ...DEFAULT_SETTINGS, ...current.riskMonitoringSettings, ...patch };

  await db
    .update(tenants)
    .set({
      settings: { ...current, riskMonitoringSettings: merged },
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  return merged;
}

function toProviderSettings(s: RiskMonitoringSettingsDto): ProviderSettings {
  return {
    openSanctionsEnabled: s.openSanctionsEnabled,
    openSanctionsBaseUrl: s.openSanctionsBaseUrl,
    companiesHouseEnabled: s.companiesHouseEnabled,
    companiesHouseApiKey: s.companiesHouseApiKey,
    seasearcherEnabled: s.seasearcherEnabled,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  CORE: RUN CHECKS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Run all enabled providers against a single company.
 * Persists risk_checks and risk_hits rows.
 * Returns the list of check results.
 */
export async function runChecksForCompany(
  company: CompanyForCheck,
  settings: RiskMonitoringSettingsDto,
): Promise<ProviderCheckResult[]> {
  const providerSettings = toProviderSettings(settings);
  const enabledProviders = ALL_PROVIDERS.filter((p) => p.isEnabled(providerSettings));

  const results: ProviderCheckResult[] = [];

  for (const provider of enabledProviders) {
    const result = await provider.check(company, providerSettings);
    results.push(result);

    // Persist the check
    const [check] = await db
      .insert(riskChecks)
      .values({
        tenantId: company.tenantId,
        counterpartyId: company.id,
        providerClass: result.providerClass,
        providerName: result.providerName,
        status: result.status,
        rawResponse: result.rawResponse ?? null,
        errorMessage: result.errorMessage ?? null,
      })
      .returning({ id: riskChecks.id });

    // Persist hits
    if (result.hits.length > 0 && check) {
      // Mark previous active hits from same provider class as resolved
      await db
        .update(riskHits)
        .set({ isActive: false, resolvedAt: new Date() })
        .where(
          and(
            eq(riskHits.counterpartyId, company.id),
            eq(riskHits.providerClass, result.providerClass),
            eq(riskHits.isActive, true),
          ),
        );

      await db.insert(riskHits).values(
        result.hits.map((h) => ({
          riskCheckId: check.id,
          tenantId: company.tenantId,
          counterpartyId: company.id,
          providerClass: result.providerClass,
          severity: h.severity,
          signalType: h.signalType,
          title: h.title,
          detail: h.detail ?? null,
          sourceUrl: h.sourceUrl ?? null,
          matchScore: h.matchScore ?? null,
        })),
      );
    } else if (result.status === 'CLEAR' && check) {
      // Clear came in — resolve any previously active hits for this provider class
      await db
        .update(riskHits)
        .set({ isActive: false, resolvedAt: new Date() })
        .where(
          and(
            eq(riskHits.counterpartyId, company.id),
            eq(riskHits.providerClass, result.providerClass),
            eq(riskHits.isActive, true),
          ),
        );
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
//  RISK SUMMARY (per company)
// ═══════════════════════════════════════════════════════════════════════

export async function getRiskSummary(counterpartyId: string, tenantId: string): Promise<RiskSummaryDto | null> {
  const company = await db.query.counterparties.findFirst({
    where: and(eq(counterparties.id, counterpartyId), eq(counterparties.tenantId, tenantId)),
    columns: { id: true, name: true },
  });
  if (!company) return null;

  // Latest check per provider class
  const latestChecks = await db
    .select()
    .from(riskChecks)
    .where(eq(riskChecks.counterpartyId, counterpartyId))
    .orderBy(desc(riskChecks.checkedAt));

  // Deduplicate by provider class (keep latest)
  const byClass = new Map<string, typeof latestChecks[0]>();
  for (const c of latestChecks) {
    if (!byClass.has(c.providerClass)) byClass.set(c.providerClass, c);
  }

  // Active hits
  const activeHitRows = await db
    .select()
    .from(riskHits)
    .where(and(eq(riskHits.counterpartyId, counterpartyId), eq(riskHits.isActive, true)))
    .orderBy(desc(riskHits.createdAt));

  // Active override
  const activeOverride = await db.query.riskOverrides.findFirst({
    where: and(
      eq(riskOverrides.counterpartyId, counterpartyId),
      eq(riskOverrides.status, 'APPROVED'),
      sql`${riskOverrides.expiresAt} > now()`,
    ),
  });

  const isFrozen = activeHitRows.length > 0 && !activeOverride;

  const providerStatuses = Array.from(byClass.entries()).map(([, check]) => ({
    providerClass: check.providerClass as RiskSummaryDto['providerStatuses'][0]['providerClass'],
    providerName: check.providerName,
    status: check.status as RiskSummaryDto['providerStatuses'][0]['status'],
    checkedAt: check.checkedAt.toISOString(),
    hitCount: activeHitRows.filter((h) => h.providerClass === check.providerClass).length,
  }));

  return {
    counterpartyId: company.id,
    counterpartyName: company.name,
    isFrozen,
    hasActiveOverride: !!activeOverride,
    overrideExpiresAt: activeOverride?.expiresAt?.toISOString() ?? null,
    activeHitCount: activeHitRows.length,
    latestCheckAt: latestChecks[0]?.checkedAt?.toISOString() ?? null,
    providerStatuses,
    activeHits: activeHitRows.map((h) => hitToDto(h)),
  };
}

/**
 * Determine if a counterparty's credit is frozen.
 * Frozen = has active risk hits AND no active approved override.
 */
export async function isCreditFrozen(counterpartyId: string): Promise<boolean> {
  const [hitRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(riskHits)
    .where(and(eq(riskHits.counterpartyId, counterpartyId), eq(riskHits.isActive, true)));

  if ((hitRow?.count ?? 0) === 0) return false;

  const activeOverride = await db.query.riskOverrides.findFirst({
    where: and(
      eq(riskOverrides.counterpartyId, counterpartyId),
      eq(riskOverrides.status, 'APPROVED'),
      sql`${riskOverrides.expiresAt} > now()`,
    ),
  });

  return !activeOverride;
}

/**
 * Batch check: return set of frozen counterparty IDs from a list.
 */
export async function getFrozenCounterpartyIds(counterpartyIds: string[]): Promise<Set<string>> {
  if (!counterpartyIds.length) return new Set();

  const hitRows = await db
    .select({ counterpartyId: riskHits.counterpartyId })
    .from(riskHits)
    .where(and(inArray(riskHits.counterpartyId, counterpartyIds), eq(riskHits.isActive, true)))
    .groupBy(riskHits.counterpartyId);

  const idsWithHits = hitRows.map((r) => r.counterpartyId);
  if (!idsWithHits.length) return new Set();

  const overrideRows = await db
    .select({ counterpartyId: riskOverrides.counterpartyId })
    .from(riskOverrides)
    .where(
      and(
        inArray(riskOverrides.counterpartyId, idsWithHits),
        eq(riskOverrides.status, 'APPROVED'),
        sql`${riskOverrides.expiresAt} > now()`,
      ),
    );

  const overridden = new Set(overrideRows.map((r) => r.counterpartyId));
  return new Set(idsWithHits.filter((id) => !overridden.has(id)));
}

// ═══════════════════════════════════════════════════════════════════════
//  RISK CHECKS HISTORY
// ═══════════════════════════════════════════════════════════════════════

export async function getChecksForCompany(counterpartyId: string, limit = 50): Promise<RiskCheckDto[]> {
  const rows = await db
    .select()
    .from(riskChecks)
    .where(eq(riskChecks.counterpartyId, counterpartyId))
    .orderBy(desc(riskChecks.checkedAt))
    .limit(limit);

  // Count hits per check
  const checkIds = rows.map((r) => r.id);
  const hitCounts = checkIds.length
    ? await db
      .select({
        riskCheckId: riskHits.riskCheckId,
        count: sql<number>`count(*)::int`,
      })
      .from(riskHits)
      .where(inArray(riskHits.riskCheckId, checkIds))
      .groupBy(riskHits.riskCheckId)
    : [];

  const countMap = new Map(hitCounts.map((h) => [h.riskCheckId, h.count]));

  return rows.map((r) => ({
    id: r.id,
    counterpartyId: r.counterpartyId,
    providerClass: r.providerClass as RiskCheckDto['providerClass'],
    providerName: r.providerName,
    status: r.status as RiskCheckDto['status'],
    checkedAt: r.checkedAt.toISOString(),
    errorMessage: r.errorMessage,
    hitCount: countMap.get(r.id) ?? 0,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getHitsForCompany(counterpartyId: string, activeOnly = true): Promise<RiskHitDto[]> {
  const conditions = [eq(riskHits.counterpartyId, counterpartyId)];
  if (activeOnly) conditions.push(eq(riskHits.isActive, true));

  const rows = await db
    .select({
      hit: riskHits,
      resolvedByName: users.name,
    })
    .from(riskHits)
    .leftJoin(users, eq(riskHits.resolvedByUserId, users.id))
    .where(and(...conditions))
    .orderBy(desc(riskHits.createdAt));

  return rows.map((r) => hitToDto(r.hit, r.resolvedByName));
}

// ═══════════════════════════════════════════════════════════════════════
//  OVERRIDE WORKFLOW
// ═══════════════════════════════════════════════════════════════════════

export async function createOverride(
  counterpartyId: string,
  tenantId: string,
  userId: string,
  reason: string,
  settings: RiskMonitoringSettingsDto,
): Promise<RiskOverrideDto> {
  const expiresAt = new Date(Date.now() + settings.overrideExpiryDays * 24 * 60 * 60 * 1000);
  const autoApprove = settings.overrideRequiredApprovals <= 1;

  const [row] = await db
    .insert(riskOverrides)
    .values({
      tenantId,
      counterpartyId,
      reason,
      expiresAt,
      requestedByUserId: userId,
      status: autoApprove ? 'APPROVED' : 'PENDING',
    })
    .returning();

  if (autoApprove) {
    await db.insert(riskOverrideApprovals).values({
      overrideId: row.id,
      userId,
      decision: 'APPROVED',
      comment: 'Approved on request',
    });
  }

  const override = await getOverrideById(row.id);
  if (!override) throw new Error('Failed to load newly created override');
  return override;
}

export async function approveOrRejectOverride(
  overrideId: string,
  userId: string,
  decision: 'APPROVED' | 'REJECTED',
  comment?: string,
): Promise<RiskOverrideDto | null> {
  const override = await db.query.riskOverrides.findFirst({
    where: eq(riskOverrides.id, overrideId),
  });
  if (!override || override.status !== 'PENDING') return null;

  const settings = await getRiskMonitoringSettings(override.tenantId);

  // Check user hasn't already voted
  const existing = await db.query.riskOverrideApprovals.findFirst({
    where: and(
      eq(riskOverrideApprovals.overrideId, overrideId),
      eq(riskOverrideApprovals.userId, userId),
    ),
  });
  if (existing) return null; // already voted

  // Insert approval
  await db.insert(riskOverrideApprovals).values({
    overrideId,
    userId,
    decision,
    comment: comment ?? null,
  });

  // Check if we have enough approvals (need 2) or a rejection
  const allApprovals = await db
    .select()
    .from(riskOverrideApprovals)
    .where(eq(riskOverrideApprovals.overrideId, overrideId));

  const approvedCount = allApprovals.filter((a) => a.decision === 'APPROVED').length;
  const rejectedCount = allApprovals.filter((a) => a.decision === 'REJECTED').length;
  const requiredApprovals = Math.max(
    settings.overrideRequiredApprovals ?? DEFAULT_SETTINGS.overrideRequiredApprovals,
    1,
  );

  let newStatus: string = override.status;
  if (rejectedCount > 0) {
    newStatus = 'REVOKED';
  } else if (approvedCount >= requiredApprovals) {
    newStatus = 'APPROVED';
  }

  if (newStatus !== override.status) {
    await db
      .update(riskOverrides)
      .set({ status: newStatus as typeof override.status, updatedAt: new Date() })
      .where(eq(riskOverrides.id, overrideId));
  }

  return getOverrideById(overrideId);
}

export async function getOverridesForCompany(counterpartyId: string): Promise<RiskOverrideDto[]> {
  const rows = await db
    .select()
    .from(riskOverrides)
    .where(eq(riskOverrides.counterpartyId, counterpartyId))
    .orderBy(desc(riskOverrides.createdAt));

  const result: RiskOverrideDto[] = [];
  for (const row of rows) {
    const dto = await getOverrideById(row.id);
    if (dto) result.push(dto);
  }
  return result;
}

export async function getOverrideById(id: string): Promise<RiskOverrideDto | null> {
  const row = await db.query.riskOverrides.findFirst({
    where: eq(riskOverrides.id, id),
  });
  if (!row) return null;

  const approvals = await db
    .select({
      approval: riskOverrideApprovals,
      userName: users.name,
    })
    .from(riskOverrideApprovals)
    .leftJoin(users, eq(riskOverrideApprovals.userId, users.id))
    .where(eq(riskOverrideApprovals.overrideId, id));

  const requestedBy = await db.query.users.findFirst({
    where: eq(users.id, row.requestedByUserId),
    columns: { name: true },
  });

  const company = await db.query.counterparties.findFirst({
    where: eq(counterparties.id, row.counterpartyId),
    columns: { name: true },
  });

  return overrideToDto(
    row,
    approvals.map((a) => ({
      id: a.approval.id,
      userId: a.approval.userId,
      userName: a.userName ?? 'Unknown',
      decision: a.approval.decision as 'APPROVED' | 'REJECTED',
      comment: a.approval.comment,
      decidedAt: a.approval.decidedAt.toISOString(),
    })),
    requestedBy?.name ?? 'Unknown',
    company?.name,
  );
}

export async function getPendingOverrides(tenantId: string): Promise<RiskOverrideDto[]> {
  const rows = await db
    .select()
    .from(riskOverrides)
    .where(and(eq(riskOverrides.tenantId, tenantId), eq(riskOverrides.status, 'PENDING')))
    .orderBy(desc(riskOverrides.createdAt));

  const result: RiskOverrideDto[] = [];
  for (const row of rows) {
    const dto = await getOverrideById(row.id);
    if (dto) result.push(dto);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════
//  MANUAL RE-CHECK (triggered from company page)
// ═══════════════════════════════════════════════════════════════════════

export async function triggerManualCheck(counterpartyId: string, tenantId: string): Promise<RiskSummaryDto | null> {
  const company = await db.query.counterparties.findFirst({
    where: and(eq(counterparties.id, counterpartyId), eq(counterparties.tenantId, tenantId)),
  });
  if (!company) return null;

  const settings = await getRiskMonitoringSettings(tenantId);
  if (!settings.enabled) return null;

  const companyForCheck: CompanyForCheck = {
    id: company.id,
    tenantId: company.tenantId,
    name: company.name,
    country: company.country,
    countryIso: company.countryIso,
    seasearcherId: company.seasearcherId,
    companiesHouseNumber: company.companiesHouseNumber,
  };

  const results = await runChecksForCompany(companyForCheck, settings);

  // Check if new hits appeared and we need to revoke an active override
  const hasNewHits = results.some((r) => r.status === 'HIT');
  if (hasNewHits && settings.autoEnforceOnHit) {
    // Revoke any active override if new failing check arrives
    await db
      .update(riskOverrides)
      .set({ status: 'REVOKED', updatedAt: new Date() })
      .where(
        and(
          eq(riskOverrides.counterpartyId, counterpartyId),
          eq(riskOverrides.status, 'APPROVED'),
        ),
      );

    // Notify credit managers
    await notifyRiskHit(tenantId, company.name, results, settings);
  }

  return getRiskSummary(counterpartyId, tenantId);
}

// ═══════════════════════════════════════════════════════════════════════
//  BACKGROUND JOB: Check all active credit-line customers
// ═══════════════════════════════════════════════════════════════════════

export async function runScheduledChecks(): Promise<void> {
  const allTenants = await db.select({ id: tenants.id, settings: tenants.settings }).from(tenants);

  for (const tenant of allTenants) {
    const settings = { ...DEFAULT_SETTINGS, ...(tenant.settings as TenantSettings)?.riskMonitoringSettings };
    if (!settings.enabled) continue;

    // Get counterparties that have active customer credit lines
    const companiesWithCredit = await db
      .selectDistinct({ counterpartyId: creditLineCounterparties.counterpartyId })
      .from(creditLineCounterparties)
      .innerJoin(creditLines, eq(creditLineCounterparties.creditLineId, creditLines.id))
      .where(eq(creditLines.type, 'CUSTOMER'));

    const counterpartyIds = companiesWithCredit.map((r) => r.counterpartyId);
    if (!counterpartyIds.length) continue;

    const companies = await db
      .select()
      .from(counterparties)
      .where(
        and(
          inArray(counterparties.id, counterpartyIds),
          eq(counterparties.tenantId, tenant.id),
        ),
      );

    for (const company of companies) {
      // Skip if checked recently (within interval)
      const lastCheck = await db.query.riskChecks.findFirst({
        where: and(
          eq(riskChecks.counterpartyId, company.id),
        ),
        orderBy: [desc(riskChecks.checkedAt)],
      });

      if (lastCheck) {
        const hoursSinceCheck = (Date.now() - lastCheck.checkedAt.getTime()) / (1000 * 60 * 60);
        if (hoursSinceCheck < settings.checkIntervalHours) continue;
      }

      try {
        const companyForCheck: CompanyForCheck = {
          id: company.id,
          tenantId: company.tenantId,
          name: company.name,
          country: company.country,
          countryIso: company.countryIso,
          seasearcherId: company.seasearcherId,
          companiesHouseNumber: company.companiesHouseNumber,
        };

        const results = await runChecksForCompany(companyForCheck, settings);

        const hasNewHits = results.some((r) => r.status === 'HIT');
        if (hasNewHits && settings.autoEnforceOnHit) {
          // Revoke any active override
          await db
            .update(riskOverrides)
            .set({ status: 'REVOKED', updatedAt: new Date() })
            .where(
              and(
                eq(riskOverrides.counterpartyId, company.id),
                eq(riskOverrides.status, 'APPROVED'),
              ),
            );

          await notifyRiskHit(tenant.id, company.name, results, settings);
        }
      } catch (err) {
        console.error(`[Risk Monitor] Error checking ${company.name} (${company.id}):`, err);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════

async function notifyRiskHit(
  tenantId: string,
  companyName: string,
  results: ProviderCheckResult[],
  settings: RiskMonitoringSettingsDto,
): Promise<void> {
  const hitProviders = results.filter((r) => r.status === 'HIT').map((r) => r.providerName);
  const totalHits = results.reduce((acc, r) => acc + r.hits.length, 0);

  // Get credit managers + admins + finance
  const notifyUsers = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(
      and(
        eq(users.tenantId, tenantId),
        inArray(users.role, ['ADMIN', 'CREDITMANAGER', 'FINANCE']),
      ),
    );

  const userIds = notifyUsers.map((u) => u.id);

  if (settings.notifyPush && userIds.length) {
    await sendNotificationToUsers(
      userIds,
      {
        title: `⚠️ Risk Alert: ${companyName}`,
        body: `${totalHits} risk signal(s) found via ${hitProviders.join(', ')}. Credit frozen.`,
        url: `/companies`, // will be enhanced with company ID link
      },
      tenantId,
    );
  }

  // Email notifications could be added here following the same pattern
  // as credit-notifications.ts — omitted for v1, uses push only
}

// ═══════════════════════════════════════════════════════════════════════
//  DTO MAPPERS
// ═══════════════════════════════════════════════════════════════════════

function hitToDto(hit: typeof riskHits.$inferSelect, resolvedByName?: string | null): RiskHitDto {
  return {
    id: hit.id,
    riskCheckId: hit.riskCheckId,
    counterpartyId: hit.counterpartyId,
    providerClass: hit.providerClass as RiskHitDto['providerClass'],
    severity: hit.severity as RiskHitDto['severity'],
    signalType: hit.signalType,
    title: hit.title,
    detail: hit.detail,
    sourceUrl: hit.sourceUrl,
    matchScore: hit.matchScore,
    isActive: hit.isActive,
    resolvedAt: hit.resolvedAt?.toISOString() ?? null,
    resolvedByUserId: hit.resolvedByUserId,
    resolvedByUserName: resolvedByName ?? null,
    createdAt: hit.createdAt.toISOString(),
  };
}

function overrideToDto(
  row: typeof riskOverrides.$inferSelect,
  approvals: RiskOverrideApprovalDto[],
  requestedByName: string,
  counterpartyName?: string,
): RiskOverrideDto {
  return {
    id: row.id,
    counterpartyId: row.counterpartyId,
    counterpartyName: counterpartyName ?? '',
    status: row.status as RiskOverrideDto['status'],
    reason: row.reason,
    expiresAt: row.expiresAt.toISOString(),
    requestedByUserId: row.requestedByUserId,
    requestedByUserName: requestedByName,
    approvals,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
