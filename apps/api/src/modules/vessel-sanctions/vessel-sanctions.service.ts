// ═══════════════════════════════════════════════════════════════════════
//  Vessel Sanction Check Service
//
//  Orchestrates daily checks of all DB vessels against the TankerTrackers
//  sanctioned vessel list.  Settings are per-tenant (vesselSanctionSettings).
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  vessels,
  vesselSanctionChecks,
  tenants,
  users,
} from '../../db/schema';
import type { TenantSettings } from '../../db/schema';
import type { VesselSanctionSettingsDto, VesselSanctionCheckDto } from '@fueld/types';
import { fetchSanctionedVessels, type SanctionedVessel } from './tankertrackers.client';
import { sendNotificationToUsers } from '../push/push.service';

// ── Defaults ────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: VesselSanctionSettingsDto = {
  enabled: false,
  checkIntervalHours: 24,
  notifyPush: true,
  notifyEmail: true,
  notifyWhatsApp: false,
};

// ═══════════════════════════════════════════════════════════════════════
//  Settings (get / update)
// ═══════════════════════════════════════════════════════════════════════

export async function getVesselSanctionSettings(tenantId: string): Promise<VesselSanctionSettingsDto> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { settings: true },
  });
  return { ...DEFAULT_SETTINGS, ...(tenant?.settings as TenantSettings)?.vesselSanctionSettings };
}

export async function updateVesselSanctionSettings(
  tenantId: string,
  patch: Partial<VesselSanctionSettingsDto>,
): Promise<VesselSanctionSettingsDto> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { settings: true },
  });
  const current = (tenant?.settings as TenantSettings) ?? {};
  const merged = { ...DEFAULT_SETTINGS, ...current.vesselSanctionSettings, ...patch };

  await db
    .update(tenants)
    .set({
      settings: { ...current, vesselSanctionSettings: merged },
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  return merged;
}

// ═══════════════════════════════════════════════════════════════════════
//  Check History
// ═══════════════════════════════════════════════════════════════════════

export async function getVesselSanctionHistory(
  tenantId: string,
  opts?: { limit?: number; page?: number },
): Promise<{ checks: VesselSanctionCheckDto[]; total: number }> {
  const limit = opts?.limit ?? 50;
  const offset = ((opts?.page ?? 1) - 1) * limit;

  const rows = await db
    .select({
      id: vesselSanctionChecks.id,
      vesselId: vesselSanctionChecks.vesselId,
      vesselName: vessels.name,
      vesselImo: vessels.imo,
      status: vesselSanctionChecks.status,
      source: vesselSanctionChecks.source,
      matchedOn: vesselSanctionChecks.matchedOn,
      checkedAt: vesselSanctionChecks.checkedAt,
    })
    .from(vesselSanctionChecks)
    .innerJoin(vessels, eq(vesselSanctionChecks.vesselId, vessels.id))
    .where(eq(vesselSanctionChecks.tenantId, tenantId))
    .orderBy(desc(vesselSanctionChecks.checkedAt))
    .limit(limit)
    .offset(offset);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(vesselSanctionChecks)
    .where(eq(vesselSanctionChecks.tenantId, tenantId));

  return {
    checks: rows.map((r) => ({
      id: r.id,
      vesselId: r.vesselId,
      vesselName: r.vesselName,
      vesselImo: r.vesselImo,
      status: r.status as VesselSanctionCheckDto['status'],
      source: r.source,
      matchedOn: r.matchedOn,
      checkedAt: r.checkedAt.toISOString(),
    })),
    total: countResult?.count ?? 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  Run Vessel Sanction Check (for a single tenant)
// ═══════════════════════════════════════════════════════════════════════

export async function runVesselSanctionCheckForTenant(tenantId: string): Promise<{
  checked: number;
  sanctioned: number;
  errors: number;
}> {
  // 1. Fetch sanctioned list from TankerTrackers
  let sanctionedList: SanctionedVessel[];
  try {
    sanctionedList = await fetchSanctionedVessels();
  } catch (err) {
    console.error('[Vessel Sanctions] Failed to fetch TankerTrackers list:', err);
    throw err;
  }

  // Build lookup maps for efficient matching
  const imoSet = new Map<string, SanctionedVessel>();
  const nameLower = new Map<string, SanctionedVessel>();
  for (const sv of sanctionedList) {
    if (sv.imo) imoSet.set(sv.imo, sv);
    nameLower.set(sv.name.toLowerCase(), sv);
  }

  // 2. Get all vessels from DB
  const allVessels = await db.select().from(vessels);

  let checked = 0;
  let sanctioned = 0;
  let errors = 0;
  const now = new Date();
  const newlySanctioned: { name: string; imo: string | null }[] = [];

  for (const vessel of allVessels) {
    checked++;
    let matchedSv: SanctionedVessel | undefined;
    let matchedOn: string | null = null;

    // Match by IMO first (strongest identifier)
    if (vessel.imo) {
      const imoClean = vessel.imo.replace(/\D/g, '');
      matchedSv = imoSet.get(imoClean);
      if (matchedSv) matchedOn = 'IMO';
    }

    // Fallback: match by exact name (case-insensitive)
    if (!matchedSv) {
      matchedSv = nameLower.get(vessel.name.toLowerCase());
      if (matchedSv) matchedOn = 'NAME';
    }

    const status = matchedSv ? 'SANCTIONED' : 'CLEAR';

    try {
      // Persist check record
      await db.insert(vesselSanctionChecks).values({
        tenantId,
        vesselId: vessel.id,
        status,
        source: 'TANKERTRACKERS',
        matchedOn,
        rawData: matchedSv?.rawRow ?? null,
        checkedAt: now,
      });

      // Update vessel sanctionStatus
      const prevStatus = vessel.sanctionStatus;
      await db
        .update(vessels)
        .set({ sanctionStatus: status, lastSanctionCheck: now, updatedAt: now })
        .where(eq(vessels.id, vessel.id));

      if (status === 'SANCTIONED') {
        sanctioned++;
        if (prevStatus !== 'SANCTIONED') {
          newlySanctioned.push({ name: vessel.name, imo: vessel.imo });
        }
      }
    } catch (err) {
      errors++;
      console.error(`[Vessel Sanctions] Error checking vessel ${vessel.name} (${vessel.id}):`, err);
    }
  }

  // 3. Notify if new sanctions found
  if (newlySanctioned.length > 0) {
    const settings = await getVesselSanctionSettings(tenantId);
    await notifyVesselSanction(tenantId, newlySanctioned, settings);
  }

  console.log(
    `[Vessel Sanctions] Tenant ${tenantId}: checked=${checked}, sanctioned=${sanctioned}, errors=${errors}, newHits=${newlySanctioned.length}`,
  );

  return { checked, sanctioned, errors };
}

// ═══════════════════════════════════════════════════════════════════════
//  Scheduled Check (all tenants)
// ═══════════════════════════════════════════════════════════════════════

export async function runScheduledVesselSanctionChecks(): Promise<void> {
  const allTenants = await db.query.tenants.findMany({ columns: { id: true, settings: true } });

  for (const tenant of allTenants) {
    try {
      const settings = { ...DEFAULT_SETTINGS, ...(tenant.settings as TenantSettings)?.vesselSanctionSettings };
      if (!settings.enabled) continue;

      // Check if enough time has passed since last check for this tenant
      const lastCheck = await db.query.vesselSanctionChecks.findFirst({
        where: eq(vesselSanctionChecks.tenantId, tenant.id),
        orderBy: [desc(vesselSanctionChecks.checkedAt)],
        columns: { checkedAt: true },
      });

      if (lastCheck) {
        const hoursSince = (Date.now() - lastCheck.checkedAt.getTime()) / (1000 * 60 * 60);
        if (hoursSince < settings.checkIntervalHours) continue;
      }

      await runVesselSanctionCheckForTenant(tenant.id);
    } catch (err) {
      console.error(`[Vessel Sanctions] Error processing tenant ${tenant.id}:`, err);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Notifications
// ═══════════════════════════════════════════════════════════════════════

async function notifyVesselSanction(
  tenantId: string,
  sanctionedVessels: { name: string; imo: string | null }[],
  settings: VesselSanctionSettingsDto,
): Promise<void> {
  const vesselNames = sanctionedVessels.map((v) => v.name).join(', ');
  const count = sanctionedVessels.length;

  // Notify admins, credit managers, finance
  const notifyUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.tenantId, tenantId),
        inArray(users.role, ['ADMIN', 'CREDITMANAGER', 'FINANCE']),
      ),
    );

  const userIds = notifyUsers.map((u) => u.id);
  if (!userIds.length) return;

  if (settings.notifyPush) {
    await sendNotificationToUsers(
      userIds,
      {
        title: `⚠️ Vessel Sanction Alert`,
        body: `${count} vessel(s) flagged as sanctioned: ${vesselNames}`,
        url: '/admin/vessel-sanctions',
      },
      tenantId,
    );
  }
}
