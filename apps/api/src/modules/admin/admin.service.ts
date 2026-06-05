import { eq, desc, and, isNull, sql } from 'drizzle-orm';
import { db } from '../../db';
import { users, invitations, tenants, teams, passkeys } from '../../db/schema';
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
      teamId: users.teamId,
      teamName: teams.name,
      is2faEnabled: users.is2faEnabled,
      o365Id: users.o365Id,
      passkeyCount: sql<number>`count(${passkeys.id})`,
      isActive: users.isActive,
      phone: users.phone,
      allowedIps: users.allowedIps,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(teams, eq(users.teamId, teams.id))
    .leftJoin(passkeys, eq(passkeys.userId, users.id))
    .where(eq(users.tenantId, tenantId))
    .groupBy(users.id, teams.name)
    .orderBy(desc(users.createdAt));

  return rows.map((u) => ({
    ...u,
    teamName: u.teamName ?? null,
    phone: u.phone ?? null,
    allowedIps: u.allowedIps ? JSON.parse(u.allowedIps) as string[] : null,
    hasPasskeys: Number(u.passkeyCount) > 0,
    hasMicrosoftSso: !!u.o365Id,
    createdAt: u.createdAt.toISOString(),
  }));
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
}) {
  const tenantId = await getTenantId();

  // Check if email is already registered
  const existing = await db.query.users.findFirst({
    where: eq(users.email, data.email.toLowerCase()),
  });
  if (existing) {
    throw new Error('A user with this email already exists');
  }

  // Check for an existing pending invite
  const existingInvite = await db.query.invitations.findFirst({
    where: and(
      eq(invitations.email, data.email.toLowerCase()),
      isNull(invitations.acceptedAt),
    ),
  });
  if (existingInvite) {
    throw new Error('An invitation for this email is already pending');
  }

  // Generate a secure random token
  const token = crypto.randomUUID() + '-' + crypto.randomUUID();

  // Expire in 7 days
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const [invite] = await db
    .insert(invitations)
    .values({
      tenantId,
      email: data.email.toLowerCase(),
      name: data.name,
      role: data.role,
      token,
      invitedBy: data.invitedBy,
      expiresAt,
    })
    .returning();

  // Get inviter name for display
  const inviter = await db.query.users.findFirst({
    where: eq(users.id, data.invitedBy),
  });

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

  // Fetch team name
  let teamName: string | null = null;
  if (updated.teamId) {
    const team = await db.query.teams.findFirst({ where: eq(teams.id, updated.teamId) });
    teamName = team?.name ?? null;
  }

  const passkeyCount = await getPasskeyCount(updated.id);

  return {
    id: updated.id,
    email: updated.email,
    name: updated.name,
    role: updated.role,
    teamId: updated.teamId,
    teamName,
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

  let teamName: string | null = null;
  if (updated.teamId) {
    const team = await db.query.teams.findFirst({ where: eq(teams.id, updated.teamId) });
    teamName = team?.name ?? null;
  }

  const passkeyCount = await getPasskeyCount(updated.id);

  return {
    id: updated.id,
    email: updated.email,
    name: updated.name,
    role: updated.role,
    teamId: updated.teamId,
    teamName,
    is2faEnabled: updated.is2faEnabled,
    hasPasskeys: passkeyCount > 0,
    hasMicrosoftSso: !!updated.o365Id,
    isActive: updated.isActive,
    allowedIps: updated.allowedIps ? JSON.parse(updated.allowedIps) as string[] : null,
    createdAt: updated.createdAt.toISOString(),
  };
}

// ── Update User Team ─────────────────────────────────────────────────

export async function updateUserTeam(userId: string, teamId: string | null) {
  const [updated] = await db
    .update(users)
    .set({ teamId, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  if (!updated) throw new Error('User not found');

  let teamName: string | null = null;
  if (updated.teamId) {
    const team = await db.query.teams.findFirst({ where: eq(teams.id, updated.teamId) });
    teamName = team?.name ?? null;
  }

  return {
    id: updated.id,
    email: updated.email,
    name: updated.name,
    role: updated.role,
    teamId: updated.teamId,
    teamName,
    is2faEnabled: updated.is2faEnabled,
    isActive: updated.isActive,
    allowedIps: updated.allowedIps ? JSON.parse(updated.allowedIps) as string[] : null,
    createdAt: updated.createdAt.toISOString(),
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
