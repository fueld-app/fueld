// ═══════════════════════════════════════════════════════════════════════
//  Integrations Service — Manage API credentials for third-party services
// ═══════════════════════════════════════════════════════════════════════

import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { integrationCredentials, tenants, users } from '../../db/schema';
import { encrypt, decrypt } from '../../lib/crypto';
import type { IntegrationStatusDto } from '@fueld/types';
import { getQuickBooksStatus } from '../quickbooks/quickbooks.service';

const LLI_TOKEN_URL = 'https://api.lloydslistintelligence.com/v1/tokenprovider';

/** Get the single tenant id. */
async function getTenantId(): Promise<string> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');
  return tenant.id;
}

// ─── Read ────────────────────────────────────────────────────────────

/**
 * Get status of all supported integrations.
 * Returns whether credentials are configured (never returns secrets).
 */
export async function getIntegrationStatus(): Promise<IntegrationStatusDto[]> {
  const tenantId = await getTenantId();

  // Fetch all creds for this tenant
  const rows = await db
    .select({
      provider: integrationCredentials.provider,
      key: integrationCredentials.key,
      encryptedValue: integrationCredentials.encryptedValue,
      iv: integrationCredentials.iv,
      authTag: integrationCredentials.authTag,
      updatedAt: integrationCredentials.updatedAt,
      updatedBy: integrationCredentials.updatedBy,
    })
    .from(integrationCredentials)
    .where(eq(integrationCredentials.tenantId, tenantId));

  // Group by provider
  const providers = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = providers.get(row.provider) ?? [];
    existing.push(row);
    providers.set(row.provider, existing);
  }

  const results: IntegrationStatusDto[] = [];

  // LLI provider
  const lliRows = providers.get('LLI');
  if (lliRows?.length) {
    const usernameRow = lliRows.find((r) => r.key === 'username');
    const passwordRow = lliRows.find((r) => r.key === 'password');
    const configured = !!(usernameRow && passwordRow);

    // Get updater email
    let updatedBy: string | null = null;
    const updaterId = usernameRow?.updatedBy ?? passwordRow?.updatedBy;
    if (updaterId) {
      const user = await db.query.users.findFirst({ where: eq(users.id, updaterId) });
      updatedBy = user?.email ?? null;
    }

    results.push({
      provider: 'LLI',
      configured,
      username: usernameRow ? decrypt(usernameRow.encryptedValue, usernameRow.iv, usernameRow.authTag) : null,
      updatedAt: (usernameRow?.updatedAt ?? passwordRow?.updatedAt)?.toISOString() ?? null,
      updatedBy,
    });
  } else {
    // Check if env vars are set (legacy)
    const envConfigured = !!(process.env['LLI_USERNAME'] && process.env['LLI_PASSWORD']);
    results.push({
      provider: 'LLI',
      configured: envConfigured,
      username: envConfigured ? process.env['LLI_USERNAME']! : null,
      updatedAt: null,
      updatedBy: envConfigured ? '(environment variable)' : null,
    });
  }

  // QuickBooks provider
  try {
    const qbStatus = await getQuickBooksStatus();
    results.push(qbStatus);
  } catch (err) {
    console.warn('[Integrations] Failed to get QB status:', err);
    results.push({
      provider: 'QUICKBOOKS',
      configured: false,
      username: null,
      updatedAt: null,
      updatedBy: null,
      connectionType: null,
      realmId: null,
      companyName: null,
      tokenExpiresAt: null,
    });
  }

  return results;
}

// ─── Write ───────────────────────────────────────────────────────────

/**
 * Verify LLI credentials by attempting to fetch a token.
 * Returns true if valid, throws with message if not.
 */
export async function verifyLLICredentials(username: string, password: string): Promise<void> {
  const res = await fetch(LLI_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Verification failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
  }

  const body = (await res.json()) as { Message: string; Payload: string };
  if (body.Message !== 'Success' || !body.Payload) {
    throw new Error(`Invalid credentials — LLI returned: ${body.Message || 'no token'}`);
  }
}

/**
 * Store LLI credentials (encrypted) after verifying them.
 */
export async function setLLICredentials(
  username: string,
  password: string,
  userId: string,
): Promise<void> {
  // 1. Verify first
  await verifyLLICredentials(username, password);

  // 2. Encrypt
  const tenantId = await getTenantId();
  const encUser = encrypt(username);
  const encPass = encrypt(password);
  const now = new Date();

  // 3. Upsert username
  const existingUser = await db
    .select({ id: integrationCredentials.id })
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, 'LLI'),
        eq(integrationCredentials.key, 'username'),
      ),
    )
    .limit(1);

  if (existingUser.length) {
    await db
      .update(integrationCredentials)
      .set({
        encryptedValue: encUser.encrypted,
        iv: encUser.iv,
        authTag: encUser.authTag,
        updatedBy: userId,
        updatedAt: now,
      })
      .where(eq(integrationCredentials.id, existingUser[0].id));
  } else {
    await db.insert(integrationCredentials).values({
      tenantId,
      provider: 'LLI',
      key: 'username',
      encryptedValue: encUser.encrypted,
      iv: encUser.iv,
      authTag: encUser.authTag,
      updatedBy: userId,
    });
  }

  // 4. Upsert password
  const existingPass = await db
    .select({ id: integrationCredentials.id })
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, 'LLI'),
        eq(integrationCredentials.key, 'password'),
      ),
    )
    .limit(1);

  if (existingPass.length) {
    await db
      .update(integrationCredentials)
      .set({
        encryptedValue: encPass.encrypted,
        iv: encPass.iv,
        authTag: encPass.authTag,
        updatedBy: userId,
        updatedAt: now,
      })
      .where(eq(integrationCredentials.id, existingPass[0].id));
  } else {
    await db.insert(integrationCredentials).values({
      tenantId,
      provider: 'LLI',
      key: 'password',
      encryptedValue: encPass.encrypted,
      iv: encPass.iv,
      authTag: encPass.authTag,
      updatedBy: userId,
    });
  }

  // 5. Clear cached token so the LLI client picks up the new creds
  clearLLITokenCache();
}

/**
 * Read LLI credentials from DB (decrypted).
 * Returns null if not configured in DB.
 */
export async function getLLICredentialsFromDB(): Promise<{ username: string; password: string } | null> {
  const tenantId = await getTenantId();
  const rows = await db
    .select()
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, 'LLI'),
      ),
    );

  const usernameRow = rows.find((r) => r.key === 'username');
  const passwordRow = rows.find((r) => r.key === 'password');

  if (!usernameRow || !passwordRow) return null;

  return {
    username: decrypt(usernameRow.encryptedValue, usernameRow.iv, usernameRow.authTag),
    password: decrypt(passwordRow.encryptedValue, passwordRow.iv, passwordRow.authTag),
  };
}

// ─── Token cache helper (imported by lli.client.ts) ──────────────────

let _clearTokenCallback: (() => void) | null = null;

export function registerTokenCacheClear(cb: () => void) {
  _clearTokenCallback = cb;
}

function clearLLITokenCache() {
  if (_clearTokenCallback) _clearTokenCallback();
}
