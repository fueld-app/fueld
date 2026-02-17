// ═══════════════════════════════════════════════════════════════════════
//  Passkey Service — WebAuthn / FIDO2 credential management
// ═══════════════════════════════════════════════════════════════════════
//
//  Production implementation using @simplewebauthn/server.
//  Handles the full WebAuthn challenge/response flow for both
//  registration (attestation) and authentication (assertion).
// ═══════════════════════════════════════════════════════════════════════

import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { passkeys, users, tenants, type TenantSettings } from '../../db/schema';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';

// ─── Relying Party Configuration ────────────────────────────────────
// In production, set these via environment variables.
const RP_NAME = process.env['WEBAUTHN_RP_NAME'] ?? 'Fueld';
const RP_ID = process.env['WEBAUTHN_RP_ID'] ?? 'localhost';
const RP_ORIGIN = process.env['WEBAUTHN_ORIGIN'] ?? (RP_ID === 'localhost' ? 'http://localhost:4200' : `https://${RP_ID}`);

// ─── Challenge Store ─────────────────────────────────────────────────
// In-memory challenge store with 5-minute TTL.
// For multi-server deployments, use Redis instead.
const challengeStore = new Map<string, { challenge: string; expiresAt: number }>();
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function storeChallenge(userId: string, challenge: string): void {
  challengeStore.set(userId, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
}

function getAndConsumeChallenge(userId: string): string | null {
  const entry = challengeStore.get(userId);
  if (!entry) return null;
  challengeStore.delete(userId);
  if (Date.now() > entry.expiresAt) return null;
  return entry.challenge;
}

// Periodic cleanup of expired challenges
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of challengeStore) {
    if (now > entry.expiresAt) challengeStore.delete(key);
  }
}, 60_000);

// ─── Types ──────────────────────────────────────────────────────────

export interface PasskeyRecord {
  id: string;
  credentialId: string;
  friendlyName: string;
  deviceType: string | null;
  backedUp: boolean;
  transports: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

// ─── CRUD Operations ────────────────────────────────────────────────

/** List all passkeys for a user. */
export async function listPasskeys(userId: string): Promise<PasskeyRecord[]> {
  const rows = await db
    .select({
      id: passkeys.id,
      credentialId: passkeys.credentialId,
      friendlyName: passkeys.friendlyName,
      deviceType: passkeys.deviceType,
      backedUp: passkeys.backedUp,
      transports: passkeys.transports,
      lastUsedAt: passkeys.lastUsedAt,
      createdAt: passkeys.createdAt,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .orderBy(passkeys.createdAt);

  return rows.map((r) => ({
    ...r,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Rename a passkey. */
export async function renamePasskey(
  userId: string,
  passkeyId: string,
  friendlyName: string,
): Promise<boolean> {
  const rows = await db
    .update(passkeys)
    .set({ friendlyName })
    .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, userId)))
    .returning({ id: passkeys.id });

  return rows.length > 0;
}

/** Delete a passkey. */
export async function deletePasskey(
  userId: string,
  passkeyId: string,
): Promise<boolean> {
  const rows = await db
    .delete(passkeys)
    .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, userId)))
    .returning({ id: passkeys.id });

  return rows.length > 0;
}

// ═══════════════════════════════════════════════════════════════════════
//  Registration (Attestation) — 2-step challenge/response
// ═══════════════════════════════════════════════════════════════════════

/** Step 1: Generate registration options (challenge) for the browser. */
export async function generatePasskeyRegistrationOptions(
  userId: string,
  userEmail: string,
  userName: string,
): Promise<Record<string, unknown>> {
  // Get existing credentials to exclude (prevent re-registration)
  const existing = await db
    .select({ credentialId: passkeys.credentialId, transports: passkeys.transports })
    .from(passkeys)
    .where(eq(passkeys.userId, userId));

  const excludeCredentials = existing.map((c) => ({
    id: c.credentialId,
    transports: (c.transports?.split(',') ?? []) as AuthenticatorTransportFuture[],
  }));

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: userEmail,
    userDisplayName: userName,
    attestationType: 'none', // Don't require attestation — simplifies UX
    excludeCredentials,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform', // Prefer platform (Touch ID / Face ID / Windows Hello)
    },
  });

  // Store the challenge for verification in step 2
  storeChallenge(userId, options.challenge);

  return options as unknown as Record<string, unknown>;
}

/** Step 2: Verify the registration response from the browser and persist the credential. */
export async function verifyAndStorePasskey(
  userId: string,
  friendlyName: string,
  response: RegistrationResponseJSON,
): Promise<PasskeyRecord> {
  const expectedChallenge = getAndConsumeChallenge(userId);
  if (!expectedChallenge) {
    throw new Error('Registration challenge expired or not found. Please try again.');
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: RP_ORIGIN,
    expectedRPID: RP_ID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Passkey registration verification failed.');
  }

  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;

  // Persist the credential
  const [row] = await db
    .insert(passkeys)
    .values({
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: credential.transports?.join(',') ?? null,
      friendlyName: friendlyName || 'My Passkey',
    })
    .returning({
      id: passkeys.id,
      credentialId: passkeys.credentialId,
      friendlyName: passkeys.friendlyName,
      deviceType: passkeys.deviceType,
      backedUp: passkeys.backedUp,
      transports: passkeys.transports,
      lastUsedAt: passkeys.lastUsedAt,
      createdAt: passkeys.createdAt,
    });

  return {
    ...row!,
    lastUsedAt: row!.lastUsedAt?.toISOString() ?? null,
    createdAt: row!.createdAt.toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  Authentication (Assertion) — 2-step challenge/response
// ═══════════════════════════════════════════════════════════════════════

/**
 * Step 1: Generate authentication options (challenge) for the browser.
 * For passwordless: pass email to look up user and their credentials.
 * For 2FA: pass userId directly.
 */
export async function generatePasskeyAuthenticationOptions(
  identifier: { email: string } | { userId: string },
): Promise<{ options: Record<string, unknown>; userId: string } | null> {
  let userId: string;

  if ('email' in identifier) {
    const user = await db.query.users.findFirst({
      where: eq(users.email, identifier.email.toLowerCase()),
    });
    if (!user || !user.isActive) return null;
    userId = user.id;
  } else {
    userId = identifier.userId;
  }

  // Get user's credentials to allow
  const userPasskeys = await db
    .select({
      credentialId: passkeys.credentialId,
      transports: passkeys.transports,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, userId));

  if (userPasskeys.length === 0) return null;

  const allowCredentials = userPasskeys.map((c) => ({
    id: c.credentialId,
    transports: (c.transports?.split(',') ?? []) as AuthenticatorTransportFuture[],
  }));

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials,
    userVerification: 'preferred',
  });

  // Store the challenge for verification in step 2
  storeChallenge(userId, options.challenge);

  return { options: options as unknown as Record<string, unknown>, userId };
}

/**
 * Step 2: Verify the authentication response from the browser.
 * Returns the authenticated user info or null on failure.
 */
export async function verifyPasskeyAuthentication(
  userId: string,
  response: AuthenticationResponseJSON,
): Promise<{ userId: string; email: string; name: string; role: string; tenantId: string | null; isActive: boolean } | null> {
  const expectedChallenge = getAndConsumeChallenge(userId);
  if (!expectedChallenge) return null;

  // Look up the credential in the DB
  const credentialRow = await db
    .select({
      id: passkeys.id,
      credentialId: passkeys.credentialId,
      publicKey: passkeys.publicKey,
      counter: passkeys.counter,
      transports: passkeys.transports,
    })
    .from(passkeys)
    .where(
      and(
        eq(passkeys.userId, userId),
        eq(passkeys.credentialId, response.id),
      ),
    )
    .limit(1);

  if (credentialRow.length === 0) return null;
  const stored = credentialRow[0]!;

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(Buffer.from(stored.publicKey, 'base64url')),
        counter: stored.counter,
        transports: (stored.transports?.split(',') ?? []) as AuthenticatorTransportFuture[],
      },
    });
  } catch {
    return null;
  }

  if (!verification.verified) return null;

  // Update counter and lastUsedAt
  await db
    .update(passkeys)
    .set({
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
    })
    .where(eq(passkeys.id, stored.id));

  // Return user info
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) return null;

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
    isActive: user.isActive,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  Tenant & User Helpers
// ═══════════════════════════════════════════════════════════════════════

/** Check if the tenant has passkeys enabled. */
export async function isPasskeyEnabled(): Promise<{ enabled: boolean; allowPasswordless: boolean }> {
  const tenant = await db.query.tenants.findFirst();
  const s = (tenant?.settings ?? {}) as TenantSettings;
  return {
    enabled: s.passkeyEnabled ?? false,
    allowPasswordless: s.passkeyAllowPasswordless ?? false,
  };
}

/** Check if a user has any registered passkeys. */
export async function userHasPasskeys(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: passkeys.id })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .limit(1);
  return rows.length > 0;
}
