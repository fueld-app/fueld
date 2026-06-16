// ═══════════════════════════════════════════════════════════════════════
//  Report Access — resolve user access context for reports
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { users, userTeams } from '../../db/schema';
import { Role } from '@fueld/types';
import type { ReportAccessContext } from './report.types';

const MANAGE_SHARED_REPORT_ROLES: Role[] = [
  Role.Admin,
  Role.Finance,
  Role.Teamlead,
  Role.CreditManager,
];

export function assertCanManageSharedViews(context: ReportAccessContext): void {
  if (!context.access.canManageSharedViews) {
    throw new Error('Forbidden: insufficient role to manage shared report views');
  }
}

export function assertCanManageSchedules(context: ReportAccessContext): void {
  if (!context.access.canManageSchedules) {
    throw new Error('Forbidden: insufficient role to manage report schedules');
  }
}

export async function resolveReportAccessContext(
  tenantId: string,
  requestingUserId: string,
): Promise<ReportAccessContext> {
  const requestingUser = await db.query.users.findFirst({
    where: eq(users.id, requestingUserId),
    columns: { id: true, role: true, primaryTeamId: true },
  });

  if (!requestingUser) throw new Error('User not found');

  const userTeamRows = await db
    .select({ teamId: userTeams.teamId })
    .from(userTeams)
    .where(eq(userTeams.userId, requestingUserId));
  const userTeamIds = userTeamRows.map((r) => r.teamId);

  const canManage = MANAGE_SHARED_REPORT_ROLES.includes(requestingUser.role as Role);
  const canViewAll = [Role.Admin, Role.Finance, Role.CreditManager].includes(requestingUser.role as Role);

  if (canViewAll) {
    return {
      access: {
        role: requestingUser.role as Role,
        scope: 'ALL',
        canExport: true,
        canViewFinance: true,
        canViewTeamPerformance: true,
        canViewCollections: true,
        canManageSharedViews: canManage,
        canManageSchedules: canManage,
      },
      userIds: null,
      teamId: requestingUser.primaryTeamId ?? null,
    };
  }

  if (requestingUser.role === Role.Teamlead && userTeamIds.length > 0) {
    const teamMembers = await db
      .select({ id: userTeams.userId })
      .from(userTeams)
      .innerJoin(users, eq(userTeams.userId, users.id))
      .where(
        and(
          eq(users.tenantId, tenantId),
          inArray(userTeams.teamId, userTeamIds),
          inArray(users.role, [Role.Trader, Role.Teamlead]),
        ),
      );

    return {
      access: {
        role: requestingUser.role as Role,
        scope: teamMembers.length > 1 ? 'TEAM' : 'SELF',
        canExport: true,
        canViewFinance: false,
        canViewTeamPerformance: teamMembers.length > 1,
        canViewCollections: true,
        canManageSharedViews: canManage,
        canManageSchedules: canManage,
      },
      userIds: teamMembers.map((member) => member.id),
      teamId: requestingUser.primaryTeamId ?? null,
    };
  }

  const delegatedUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.delegateId, requestingUserId), eq(users.isOnLeave, true)));

  return {
    access: {
      role: requestingUser.role as Role,
      scope: 'SELF',
      canExport: true,
      canViewFinance: false,
      canViewTeamPerformance: false,
      canViewCollections: true,
      canManageSharedViews: false,
      canManageSchedules: false,
    },
    userIds: Array.from(new Set([requestingUserId, ...delegatedUsers.map((user) => user.id)])),
    teamId: requestingUser.primaryTeamId ?? null,
  };
}
