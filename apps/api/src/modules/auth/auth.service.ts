import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { users, tenants, type NewUser, type User, type TenantSettings } from '../../db/schema';
import { hashPassword, verifyPassword } from './password.service';
import {
  generateTotpSecret,
  verifyTotpToken,
  generateQrDataUrl,
} from './totp.service';
import { validateO365Token } from './o365.service';

// ─── Auth Service ────────────────────────────────────────────────────
// Orchestrates all authentication flows:
//   • Email / Password  (+optional 2FA)
//   • O365 SSO
//   • Registration
//   • TOTP lifecycle
// ─────────────────────────────────────────────────────────────────────

// ── User Lookups ─────────────────────────────────────────────────────

export async function findUserByEmail(email: string): Promise<User | undefined> {
  return db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });
}

export async function findUserById(id: string): Promise<User | undefined> {
  return db.query.users.findFirst({
    where: eq(users.id, id),
  });
}

export async function findUserByO365Id(o365Id: string): Promise<User | undefined> {
  return db.query.users.findFirst({
    where: eq(users.o365Id, o365Id),
  });
}

export async function getAuthEnforcement(): Promise<{ enforce2FA: boolean }> {
  const tenant = await db.query.tenants.findFirst();
  const s = (tenant?.settings ?? {}) as TenantSettings;
  return { enforce2FA: s.enforce2FA ?? false };
}

// ── Registration ─────────────────────────────────────────────────────

export async function registerUser(data: {
  email: string;
  password: string;
  name: string;
}): Promise<User> {
  const existing = await findUserByEmail(data.email);
  if (existing) {
    throw new Error('A user with this email already exists');
  }

  const passwordHash = await hashPassword(data.password);

  const [user] = await db
    .insert(users)
    .values({
      email: data.email.toLowerCase(),
      name: data.name,
      passwordHash,
    } satisfies NewUser)
    .returning();

  return user!;
}

// ── Email / Password Login ───────────────────────────────────────────

export interface LoginResult {
  /** If true, the client must call /auth/verify-2fa next. */
  requires2fa: boolean;
  user: User;
}

export async function loginWithPassword(
  email: string,
  password: string,
): Promise<LoginResult> {
  const user = await findUserByEmail(email);
  if (!user || !user.passwordHash) {
    throw new Error('Invalid email or password');
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw new Error('Invalid email or password');
  }

  return {
    requires2fa: user.is2faEnabled,
    user,
  };
}

// ── O365 SSO Login ───────────────────────────────────────────────────

export async function loginWithO365(microsoftAccessToken: string): Promise<User> {
  const profile = await validateO365Token(microsoftAccessToken);
  if (!profile) {
    throw new Error('Invalid or expired Microsoft access token');
  }

  const email = (profile.mail ?? profile.userPrincipalName).toLowerCase();

  // Check if we already have a user linked by o365Id
  let user = await findUserByO365Id(profile.id);
  if (user) return user;

  // Check if a user with this email exists (link accounts)
  user = await findUserByEmail(email);
  if (user) {
    const [updated] = await db
      .update(users)
      .set({ o365Id: profile.id, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();
    return updated!;
  }

  // Auto-provision a new user from O365
  const [newUser] = await db
    .insert(users)
    .values({
      email,
      name: profile.displayName,
      o365Id: profile.id,
    } satisfies NewUser)
    .returning();

  return newUser!;
}

// ── Refresh Token Persistence ────────────────────────────────────────

export async function storeRefreshToken(
  userId: string,
  refreshToken: string,
): Promise<void> {
  await db
    .update(users)
    .set({ refreshToken, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function clearRefreshToken(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ refreshToken: null, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

// ── 2FA Lifecycle ────────────────────────────────────────────────────

export async function generate2faSecret(userId: string) {
  const user = await findUserById(userId);
  if (!user) throw new Error('User not found');

  const { secret, uri } = generateTotpSecret(user.email);

  // Store the secret but don't enable 2FA yet (that happens after verification)
  await db
    .update(users)
    .set({ twoFactorSecret: secret, updatedAt: new Date() })
    .where(eq(users.id, userId));

  const qrDataUrl = await generateQrDataUrl(uri);

  return { secret, qrDataUrl };
}

export async function enable2fa(
  userId: string,
  token: string,
): Promise<boolean> {
  const user = await findUserById(userId);
  if (!user || !user.twoFactorSecret) {
    throw new Error('Generate a 2FA secret first');
  }

  const valid = verifyTotpToken(token, user.twoFactorSecret);
  if (!valid) return false;

  await db
    .update(users)
    .set({ is2faEnabled: true, updatedAt: new Date() })
    .where(eq(users.id, userId));

  return true;
}

export async function disable2fa(
  userId: string,
  token: string,
): Promise<boolean> {
  const user = await findUserById(userId);
  if (!user || !user.twoFactorSecret || !user.is2faEnabled) {
    throw new Error('2FA is not enabled for this user');
  }

  const valid = verifyTotpToken(token, user.twoFactorSecret);
  if (!valid) return false;

  await db
    .update(users)
    .set({ is2faEnabled: false, twoFactorSecret: null, updatedAt: new Date() })
    .where(eq(users.id, userId));

  return true;
}

export async function verify2faToken(
  userId: string,
  token: string,
): Promise<boolean> {
  const user = await findUserById(userId);
  if (!user || !user.twoFactorSecret || !user.is2faEnabled) {
    throw new Error('2FA is not enabled for this user');
  }

  return verifyTotpToken(token, user.twoFactorSecret);
}
