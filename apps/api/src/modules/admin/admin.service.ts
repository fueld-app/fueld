import { eq, desc, and, isNull, sql, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { users, invitations, tenants, teams, passkeys, userTeams } from '../../db/schema';
import { hashPassword } from '../auth/password.service';

// ─── Admin Service ───────────────────────────────────────────────────
// User management: list, invite, update role, activate/deactivate.
// ─────────────────────────────────────────────────────────────────────

/** Get tenant ID (single-tenant setup). */
async function getTenantId(): Promise<string> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');
  return tenant.id;
}

// ── List Users ───────────────────────────────────────────────────────

export async function listUsers() {
  const tenantId = await getTenantId();

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      is2faEnabled: users.is2faEnabled,
      o365Id: users.o365Id,
      passkeyCount: sql<number>`count(${passkeys.id})`,
      isActive: users.isActive,
      phone: users.phone,
      allowedIps: users.allowedIps,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(passkeys, eq(passkeys.userId, users.id))
    .where(eq(users.tenantId, tenantId))
    .groupBy(users.id)
    .orderBy(desc(users.createdAt));

  // Fetch team memberships for all users in one query
  const allUserIds = rows.map((r) => r.id);
  const teamMemberships = allUserIds.length > 0
    ? await db
        .select({
          userId: userTeams.userId,
          teamId: userTeams.teamId,
          teamName: teams.name,
        })
        .from(userTeams)
        .innerJoin(teams, eq(userTeams.teamId, teams.id))
        .where(inArray(userTeams.userId, allUserIds))
    : [];

  const teamsByUser = new Map<string, { teamIds: string[]; teamNames: string[] }>();
  for (const tm of teamMemberships) {
    const existing = teamsByUser.get(tm.userId) ?? { teamIds: [], teamNames: [] };
    existing.teamIds.push(tm.teamId);
    existing.teamNames.push(tm.teamName ?? '');
    teamsByUser.set(tm.userId, existing);
  }

  return rows.map((u) => {
    const userTeams = teamsByUser.get(u.id) ?? { teamIds: [], teamNames: [] };
    return {
      ...u,
      teamIds: userTeams.teamIds,
      teamNames: userTeams.teamNames,
      phone: u.phone ?? null,
      allowedIps: u.allowedIps ? JSON.parse(u.allowedIps) as string[] : null,
      hasPasskeys: Number(u.passkeyCount) > 0,
      hasMicrosoftSso: !!u.o365Id,
      createdAt: u.createdAt.toISOString(),
    };
  });
}

async function getPasskeyCount(userId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(${passkeys.id})` })
    .from(passkeys)
    .where(eq(passkeys.userId, userId));
  return Number(rows[0]?.count ?? 0);
}

// ── Invite User ──────────────────────────────────────────────────────

export async function inviteUser(data: {
  email: string;
  name: string;
  role: 'ADMIN' | 'TRADER' | 'FINANCE' | 'TEAMLEAD' | 'CREDITMANAGER' | 'OPERATIONSMANAGER' | 'LIGHT';
  invitedBy: string;
  allowReinvite?: boolean;
}) {
  const tenantId = await getTenantId();
  const normalizedEmail = data.email.toLowerCase();

  // Check if email is already registered
  const existing = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
  });
  if (existing) {
    throw new Error('A user with this email already exists');
  }

  // Check for an existing pending invite
  const existingInvite = await db.query.invitations.findFirst({
    where: and(
      eq(invitations.email, normalizedEmail),
      isNull(invitations.acceptedAt),
    ),
  });

  // Get inviter name for display
  const inviter = await db.query.users.findFirst({
    where: eq(users.id, data.invitedBy),
  });

  if (existingInvite) {
    if (!data.allowReinvite) {
      throw new Error('An invitation for this email is already pending');
    }

    const token = crypto.randomUUID() + '-' + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [invite] = await db
      .update(invitations)
      .set({
        name: data.name,
        role: data.role,
        token,
        invitedBy: data.invitedBy,
        expiresAt,
      })
      .where(eq(invitations.id, existingInvite.id))
      .returning();

    return {
      id: invite!.id,
      email: invite!.email,
      name: invite!.name,
      role: invite!.role,
      token: invite!.token,
      invitedByName: inviter?.name ?? 'Unknown',
      expiresAt: invite!.expiresAt.toISOString(),
      acceptedAt: null,
      createdAt: invite!.createdAt.toISOString(),
    };
  }

  // Generate a secure random token
  const token = crypto.randomUUID() + '-' + crypto.randomUUID();

  // Expire in 7 days
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const [invite] = await db
    .insert(invitations)
    .values({
      tenantId,
      email: normalizedEmail,
      name: data.name,
      role: data.role,
      token,
      invitedBy: data.invitedBy,
      expiresAt,
    })
    .returning();

  return {
    id: invite!.id,
    email: invite!.email,
    name: invite!.name,
    role: invite!.role,
    token: invite!.token,
    invitedByName: inviter?.name ?? 'Unknown',
    expiresAt: invite!.expiresAt.toISOString(),
    acceptedAt: null,
    createdAt: invite!.createdAt.toISOString(),
  };
}

// ── Accept Invitation (used during signup) ───────────────────────────

export async function acceptInvitation(token: string, password: string) {
  const invite = await db.query.invitations.findFirst({
    where: eq(invitations.token, token),
  });

  if (!invite) throw new Error('Invalid invitation token');
  if (invite.acceptedAt) throw new Error('This invitation has already been used');
  if (invite.expiresAt < new Date()) throw new Error('This invitation has expired');

  // Check email isn't already taken
  const existing = await db.query.users.findFirst({
    where: eq(users.email, invite.email),
  });
  if (existing) throw new Error('A user with this email already exists');

  const passwordHash = await hashPassword(password);

  // Create the user
  const [user] = await db
    .insert(users)
    .values({
      tenantId: invite.tenantId,
      email: invite.email,
      name: invite.name,
      role: invite.role,
      passwordHash,
    })
    .returning();

  // Mark invitation as accepted
  await db
    .update(invitations)
    .set({ acceptedAt: new Date() })
    .where(eq(invitations.id, invite.id));

  return user!;
}

// ── Reinvite (regenerate token for existing pending invitation) ──────

export async function reinviteInvitation(invitationId: string, invitedBy: string) {
  const tenantId = await getTenantId();

  const invite = await db.query.invitations.findFirst({
    where: and(
      eq(invitations.id, invitationId),
      eq(invitations.tenantId, tenantId),
    ),
  });

  if (!invite) throw new Error('Invitation not found');
  if (invite.acceptedAt) throw new Error('This invitation has already been accepted');

  // Generate a new token and reset expiry
  const token = crypto.randomUUID() + '-' + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db
    .update(invitations)
    .set({ token, expiresAt, invitedBy })
    .where(eq(invitations.id, invitationId));

  // Get inviter name for display
  const inviter = await db.query.users.findFirst({
    where: eq(users.id, invitedBy),
  });

  return {
    id: invite.id,
    email: invite.email,
    name: invite.name,
    role: invite.role,
    token,
    invitedByName: inviter?.name ?? 'Unknown',
    expiresAt: expiresAt.toISOString(),
    acceptedAt: null,
    createdAt: invite.createdAt.toISOString(),
  };
}

// ── Get Pending Invitations ──────────────────────────────────────────

export async function listInvitations() {
  const tenantId = await getTenantId();

  const rows = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      name: invitations.name,
      role: invitations.role,
      token: invitations.token,
      invitedBy: invitations.invitedBy,
      acceptedAt: invitations.acceptedAt,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .where(eq(invitations.tenantId, tenantId))
    .orderBy(desc(invitations.createdAt));

  // Batch-fetch inviter names
  const inviterIds = [...new Set(rows.map((r) => r.invitedBy))];
  const inviters = await Promise.all(
    inviterIds.map((id) =>
      db.query.users.findFirst({ where: eq(users.id, id) }),
    ),
  );
  const inviterMap = new Map(
    inviters.filter(Boolean).map((u) => [u!.id, u!.name]),
  );

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    token: r.token,
    invitedByName: inviterMap.get(r.invitedBy) ?? 'Unknown',
    expiresAt: r.expiresAt.toISOString(),
    acceptedAt: r.acceptedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ── Update User Role ─────────────────────────────────────────────────

export async function updateUserRole(
  userId: string,
  role: 'ADMIN' | 'TRADER' | 'FINANCE' | 'TEAMLEAD' | 'CREDITMANAGER' | 'OPERATIONSMANAGER' | 'LIGHT',
) {
  const [updated] = await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  if (!updated) throw new Error('User not found');

  const passkeyCount = await getPasskeyCount(updated.id);

  // Fetch team memberships
  const teamRows = await db
    .select({ teamId: userTeams.teamId, teamName: teams.name })
    .from(userTeams)
    .innerJoin(teams, eq(userTeams.teamId, teams.id))
    .where(eq(userTeams.userId, updated.id));

  return {
    id: updated.id,
    email: updated.email,
    name: updated.name,
    role: updated.role,
    teamIds: teamRows.map((r) => r.teamId),
    teamNames: teamRows.map((r) => r.teamName ?? ''),
    is2faEnabled: updated.is2faEnabled,
    hasPasskeys: passkeyCount > 0,
    hasMicrosoftSso: !!updated.o365Id,
    isActive: updated.isActive,
    allowedIps: updated.allowedIps ? JSON.parse(updated.allowedIps) as string[] : null,
    createdAt: updated.createdAt.toISOString(),
  };
}

// ── Toggle User Active Status ────────────────────────────────────────

export async function toggleUserActive(userId: string, isActive: boolean) {
  const [updated] = await db
    .update(users)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  if (!updated) throw new Error('User not found');

  const passkeyCount = await getPasskeyCount(updated.id);

  // Fetch team memberships
  const teamRows = await db
    .select({ teamId: userTeams.teamId, teamName: teams.name })
    .from(userTeams)
    .innerJoin(teams, eq(userTeams.teamId, teams.id))
    .where(eq(userTeams.userId, updated.id));

  return {
    id: updated.id,
    email: updated.email,
    name: updated.name,
    role: updated.role,
    teamIds: teamRows.map((r) => r.teamId),
    teamNames: teamRows.map((r) => r.teamName ?? ''),
    is2faEnabled: updated.is2faEnabled,
    hasPasskeys: passkeyCount > 0,
    hasMicrosoftSso: !!updated.o365Id,
    isActive: updated.isActive,
    allowedIps: updated.allowedIps ? JSON.parse(updated.allowedIps) as string[] : null,
    createdAt: updated.createdAt.toISOString(),
  };
}

// ── Update User Teams ──────────────────────────────────────────────

export async function updateUserTeams(userId: string, teamIds: string[], tenantId?: string) {
  const tid = tenantId ?? await getTenantId();

  // Validate user exists and belongs to this tenant
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error('User not found');
  if (user.tenantId !== tid) throw new Error('User not found');

  const cleaned = Array.from(new Set(teamIds.filter((id) => id && id.trim().length > 0)));

  // Validate all teamIds belong to this tenant
  if (cleaned.length > 0) {
    const validTeams = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(inArray(teams.id, cleaned), eq(teams.tenantId, tid)));
    if (validTeams.length !== cleaned.length) {
      throw new Error('One or more teams not found in this tenant');
    }
  }

  // Replace all team associations for this user
  await db.delete(userTeams).where(eq(userTeams.userId, userId));

  if (cleaned.length > 0) {
    await db.insert(userTeams).values(
      cleaned.map((teamId) => ({ userId, teamId })),
    );
  }

  // Also update primaryTeamId to the first selected team (or null if none)
  const primaryTeamId = cleaned[0] ?? null;
  await db
    .update(users)
    .set({ primaryTeamId, updatedAt: new Date() })
    .where(eq(users.id, userId));

  // Fetch team names for response
  const teamNames = cleaned.length > 0
    ? await db
        .select({ name: teams.name })
        .from(teams)
        .where(inArray(teams.id, cleaned))
    : [];

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    teamIds: cleaned,
    teamNames: teamNames.map((t) => t.name ?? ''),
    is2faEnabled: user.is2faEnabled,
    isActive: user.isActive,
    allowedIps: user.allowedIps ? JSON.parse(user.allowedIps) as string[] : null,
    createdAt: user.createdAt.toISOString(),
  };
}

// ── Update User Allowed IPs ──────────────────────────────────────────

// ── Admin Reset 2FA ──────────────────────────────────────────────────

export async function adminReset2fa(userId: string) {
  const [updated] = await db
    .update(users)
    .set({ is2faEnabled: false, twoFactorSecret: null, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  if (!updated) throw new Error('User not found');

  return { id: updated.id, is2faEnabled: updated.is2faEnabled };
}

// ── Update User Allowed IPs (original) ───────────────────────────────

export async function updateUserAllowedIps(userId: string, allowedIps: string[] | null) {
  const value = allowedIps && allowedIps.length > 0 ? JSON.stringify(allowedIps) : null;

  const [updated] = await db
    .update(users)
    .set({ allowedIps: value, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  if (!updated) throw new Error('User not found');

  return {
    id: updated.id,
    allowedIps: updated.allowedIps ? JSON.parse(updated.allowedIps) as string[] : null,
  };
}

// ── Update User Name ─────────────────────────────────────────────────

export async function updateUserName(userId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Name is required');

  const [updated] = await db
    .update(users)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  if (!updated) throw new Error('User not found');

  return { id: updated.id, name: updated.name };
}

// ── Update User Phone ────────────────────────────────────────────────

export async function updateUserPhone(userId: string, phone: string | null) {
  const [updated] = await db
    .update(users)
    .set({ phone: phone?.trim() || null, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  if (!updated) throw new Error('User not found');

  return { id: updated.id, phone: updated.phone ?? null };
}

// ── Get User Allowed IPs (for auth check) ────────────────────────────

export async function getUserAllowedIps(userId: string): Promise<string[] | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { allowedIps: true },
  });
  if (!user) return null;
  return user.allowedIps ? JSON.parse(user.allowedIps) as string[] : null;
}
