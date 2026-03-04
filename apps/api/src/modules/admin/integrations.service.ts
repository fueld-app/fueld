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

async function getProviderRows(provider: string) {
  const tenantId = await getTenantId();
  return db
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
    .where(and(
      eq(integrationCredentials.tenantId, tenantId),
      eq(integrationCredentials.provider, provider),
    ));
}

function decodeRows(rows: Array<{ key: string; encryptedValue: string; iv: string; authTag: string }>) {
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.key, decrypt(row.encryptedValue, row.iv, row.authTag));
  }
  return map;
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

  // SMTP provider
  const smtpRows = providers.get('SMTP');
  if (smtpRows?.length) {
    const values = decodeRows(smtpRows);
    const host = values.get('host') ?? null;
    const port = values.get('port') ? Number(values.get('port')) : null;
    const user = values.get('user') ?? null;
    const from = values.get('from') ?? null;
    const secure = values.get('secure') === 'true';
    const configured = !!(host && user && from && values.get('pass'));

    let updatedBy: string | null = null;
    const updaterId = smtpRows[0]?.updatedBy;
    if (updaterId) {
      const userRow = await db.query.users.findFirst({ where: eq(users.id, updaterId) });
      updatedBy = userRow?.email ?? null;
    }

    results.push({
      provider: 'SMTP',
      configured,
      username: user,
      updatedAt: smtpRows[0]?.updatedAt?.toISOString() ?? null,
      updatedBy,
      smtpHost: host,
      smtpPort: port,
      smtpUser: user,
      smtpFrom: from,
      smtpSecure: secure,
    });
  } else {
    const envConfigured = !!(process.env['SMTP_HOST'] && process.env['SMTP_USER'] && process.env['SMTP_PASS'] && process.env['SMTP_FROM']);
    results.push({
      provider: 'SMTP',
      configured: envConfigured,
      username: envConfigured ? process.env['SMTP_USER']! : null,
      updatedAt: null,
      updatedBy: envConfigured ? '(environment variable)' : null,
      smtpHost: envConfigured ? process.env['SMTP_HOST']! : null,
      smtpPort: envConfigured ? Number(process.env['SMTP_PORT'] ?? '587') : null,
      smtpUser: envConfigured ? process.env['SMTP_USER']! : null,
      smtpFrom: envConfigured ? process.env['SMTP_FROM']! : null,
      smtpSecure: String(process.env['SMTP_SECURE'] ?? 'false') === 'true',
    });
  }

  // Push provider (Web Push / VAPID)
  const pushRows = providers.get('PUSH');
  if (pushRows?.length) {
    const values = decodeRows(pushRows);
    const publicKey = values.get('publicKey') ?? null;
    const subject = values.get('subject') ?? null;
    const configured = !!(publicKey && values.get('privateKey'));

    let updatedBy: string | null = null;
    const updaterId = pushRows[0]?.updatedBy;
    if (updaterId) {
      const userRow = await db.query.users.findFirst({ where: eq(users.id, updaterId) });
      updatedBy = userRow?.email ?? null;
    }

    results.push({
      provider: 'PUSH',
      configured,
      username: null,
      updatedAt: pushRows[0]?.updatedAt?.toISOString() ?? null,
      updatedBy,
      pushPublicKey: publicKey,
      pushSubject: subject,
    });
  } else {
    results.push({
      provider: 'PUSH',
      configured: false,
      username: null,
      updatedAt: null,
      updatedBy: null,
      pushPublicKey: null,
      pushSubject: null,
    });
  }

  // Microsoft 365 / Entra ID provider
  const msRows = providers.get('MICROSOFT');
  if (msRows?.length) {
    const values = decodeRows(msRows);
    const clientId = values.get('clientId') ?? null;
    const tenantIdValue = values.get('tenantId') ?? null;
    const configured = !!(clientId && values.get('clientSecret'));

    let updatedBy: string | null = null;
    const updaterId = msRows[0]?.updatedBy;
    if (updaterId) {
      const userRow = await db.query.users.findFirst({ where: eq(users.id, updaterId) });
      updatedBy = userRow?.email ?? null;
    }

    results.push({
      provider: 'MICROSOFT',
      configured,
      username: null,
      updatedAt: msRows[0]?.updatedAt?.toISOString() ?? null,
      updatedBy,
      msClientId: clientId,
      msTenantId: tenantIdValue,
    });
  } else {
    // Fall back to tenant.settings (legacy)
    const tenant = await db.query.tenants.findFirst();
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    const envClientId = settings['ssoClientId'] as string | undefined;
    const envSecret = settings['ssoClientSecret'] as string | undefined;
    const envTenantIdVal = settings['ssoTenantId'] as string | undefined;
    const envConfigured = !!(envClientId && envSecret);
    results.push({
      provider: 'MICROSOFT',
      configured: envConfigured,
      username: null,
      updatedAt: null,
      updatedBy: envConfigured ? '(legacy settings)' : null,
      msClientId: envClientId ?? null,
      msTenantId: envTenantIdVal ?? null,
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

export async function setSmtpCredentials(
  host: string,
  port: number,
  user: string,
  pass: string,
  from: string,
  secure: boolean,
  userId: string,
): Promise<void> {
  const tenantId = await getTenantId();
  const now = new Date();

  const values: Record<string, string> = {
    host,
    port: String(port),
    user,
    pass,
    from,
    secure: secure ? 'true' : 'false',
  };

  for (const [key, rawValue] of Object.entries(values)) {
    const enc = encrypt(rawValue);
    const existing = await db
      .select({ id: integrationCredentials.id })
      .from(integrationCredentials)
      .where(and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, 'SMTP'),
        eq(integrationCredentials.key, key),
      ))
      .limit(1);

    if (existing.length) {
      await db
        .update(integrationCredentials)
        .set({
          encryptedValue: enc.encrypted,
          iv: enc.iv,
          authTag: enc.authTag,
          updatedBy: userId,
          updatedAt: now,
        })
        .where(eq(integrationCredentials.id, existing[0].id));
    } else {
      await db.insert(integrationCredentials).values({
        tenantId,
        provider: 'SMTP',
        key,
        encryptedValue: enc.encrypted,
        iv: enc.iv,
        authTag: enc.authTag,
        updatedBy: userId,
      });
    }
  }
}

export async function setPushCredentials(
  publicKey: string,
  privateKey: string,
  subject: string,
  userId: string,
): Promise<void> {
  const tenantId = await getTenantId();
  const now = new Date();

  const values: Record<string, string> = {
    publicKey,
    privateKey,
    subject,
  };

  for (const [key, rawValue] of Object.entries(values)) {
    const enc = encrypt(rawValue);
    const existing = await db
      .select({ id: integrationCredentials.id })
      .from(integrationCredentials)
      .where(and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, 'PUSH'),
        eq(integrationCredentials.key, key),
      ))
      .limit(1);

    if (existing.length) {
      await db
        .update(integrationCredentials)
        .set({
          encryptedValue: enc.encrypted,
          iv: enc.iv,
          authTag: enc.authTag,
          updatedBy: userId,
          updatedAt: now,
        })
        .where(eq(integrationCredentials.id, existing[0].id));
    } else {
      await db.insert(integrationCredentials).values({
        tenantId,
        provider: 'PUSH',
        key,
        encryptedValue: enc.encrypted,
        iv: enc.iv,
        authTag: enc.authTag,
        updatedBy: userId,
      });
    }
  }
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

// ─── Microsoft 365 / Entra ID ────────────────────────────────────────

/**
 * Store Microsoft integration credentials (encrypted).
 */
export async function setMicrosoftCredentials(
  clientId: string,
  clientSecret: string,
  tenantIdValue: string,
  userId: string,
): Promise<void> {
  const tenantId = await getTenantId();
  const now = new Date();

  const values: Record<string, string> = {
    clientId,
    clientSecret,
    tenantId: tenantIdValue,
  };

  for (const [key, rawValue] of Object.entries(values)) {
    const enc = encrypt(rawValue);
    const existing = await db
      .select({ id: integrationCredentials.id })
      .from(integrationCredentials)
      .where(and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, 'MICROSOFT'),
        eq(integrationCredentials.key, key),
      ))
      .limit(1);

    if (existing.length) {
      await db
        .update(integrationCredentials)
        .set({
          encryptedValue: enc.encrypted,
          iv: enc.iv,
          authTag: enc.authTag,
          updatedBy: userId,
          updatedAt: now,
        })
        .where(eq(integrationCredentials.id, existing[0].id));
    } else {
      await db.insert(integrationCredentials).values({
        tenantId,
        provider: 'MICROSOFT',
        key,
        encryptedValue: enc.encrypted,
        iv: enc.iv,
        authTag: enc.authTag,
        updatedBy: userId,
      });
    }
  }
}

/**
 * Read Microsoft credentials from DB (decrypted).
 * Falls back to tenant.settings for backward compatibility.
 */
export async function getMicrosoftCredentialsFromDB(): Promise<{
  clientId: string;
  clientSecret: string;
  tenantId: string;
} | null> {
  const tid = await getTenantId();
  const rows = await db
    .select()
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.tenantId, tid),
        eq(integrationCredentials.provider, 'MICROSOFT'),
      ),
    );

  if (rows.length) {
    const values = decodeRows(rows);
    const clientId = values.get('clientId');
    const clientSecret = values.get('clientSecret');
    if (clientId && clientSecret) {
      return {
        clientId,
        clientSecret,
        tenantId: values.get('tenantId') ?? 'common',
      };
    }
  }

  // Fall back to tenant.settings (legacy)
  const tenant = await db.query.tenants.findFirst();
  const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
  const ssoClientId = settings['ssoClientId'] as string | undefined;
  const ssoClientSecret = settings['ssoClientSecret'] as string | undefined;
  if (ssoClientId && ssoClientSecret) {
    return {
      clientId: ssoClientId,
      clientSecret: ssoClientSecret,
      tenantId: (settings['ssoTenantId'] as string) ?? 'common',
    };
  }

  return null;
}

// ─── Token cache helper (imported by lli.client.ts) ──────────────────

let _clearTokenCallback: (() => void) | null = null;

export function registerTokenCacheClear(cb: () => void) {
  _clearTokenCallback = cb;
}

function clearLLITokenCache() {
  if (_clearTokenCallback) _clearTokenCallback();
}
