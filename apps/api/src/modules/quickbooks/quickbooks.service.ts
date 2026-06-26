// ═══════════════════════════════════════════════════════════════════════
//  QuickBooks Integration Service
//
//  Supports both QuickBooks Online (OAuth2) and QuickBooks Desktop
//  (Web Connector credentials). Stores tokens/credentials encrypted
//  using the same AES-256-GCM scheme as LLI credentials.
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../db';
import { integrationCredentials, tenants, users, orders, invoices, orderItems, counterparties } from '../../db/schema';
import { encrypt, decrypt } from '../../lib/crypto';
import { randomBytes } from 'crypto';
import type { IntegrationStatusDto } from '@fueld/types';

// ─── Constants ───────────────────────────────────────────────────────

const PROVIDER = 'QUICKBOOKS';

// Intuit OAuth2 endpoints
const INTUIT_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const INTUIT_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const QB_API_BASE_PROD = 'https://quickbooks.api.intuit.com';
const QB_API_BASE_SANDBOX = 'https://sandbox-quickbooks.api.intuit.com';

// OAuth2 scopes
const SCOPES = 'com.intuit.quickbooks.accounting';

// ─── Config helpers ──────────────────────────────────────────────────

function getQBConfig() {
  const clientId = process.env['QB_CLIENT_ID'] ?? '';
  const clientSecret = process.env['QB_CLIENT_SECRET'] ?? '';
  const redirectUri =
    process.env['QB_REDIRECT_URI'] ??
    'http://localhost:3000/admin/settings/integrations/quickbooks/callback';
  const environment = (process.env['QB_ENVIRONMENT'] ?? 'sandbox') as 'sandbox' | 'production';
  const frontendUrl = process.env['CORS_ORIGIN'] ?? 'http://localhost:4200';

  return { clientId, clientSecret, redirectUri, environment, frontendUrl };
}

function isQBAppConfigured(): boolean {
  const { clientId, clientSecret } = getQBConfig();
  return !!(clientId && clientSecret);
}

/** Get the single tenant id. */
async function getTenantId(): Promise<string> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');
  return tenant.id;
}

// ─── OAuth State Management ─────────────────────────────────────────

// In-memory map of state → { userId, nonce, createdAt }
// Expires after 10 minutes
const pendingStates = new Map<string, { userId: string; nonce: string; createdAt: number }>();

function cleanExpiredStates() {
  const now = Date.now();
  for (const [key, val] of pendingStates) {
    if (now - val.createdAt > 10 * 60 * 1000) pendingStates.delete(key);
  }
}

// ─── Credential Storage (reuses integrationCredentials table) ───────

async function upsertCredential(tenantId: string, key: string, value: string, userId: string) {
  const enc = encrypt(value);
  const now = new Date();
  // updatedBy is a UUID column — empty string is not valid, convert to null
  const updatedBy = userId || null;

  const existing = await db
    .select({ id: integrationCredentials.id })
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, PROVIDER),
        eq(integrationCredentials.key, key),
      ),
    )
    .limit(1);

  if (existing.length) {
    await db
      .update(integrationCredentials)
      .set({
        encryptedValue: enc.encrypted,
        iv: enc.iv,
        authTag: enc.authTag,
        updatedBy,
        updatedAt: now,
      })
      .where(eq(integrationCredentials.id, existing[0].id));
  } else {
    await db.insert(integrationCredentials).values({
      tenantId,
      provider: PROVIDER,
      key,
      encryptedValue: enc.encrypted,
      iv: enc.iv,
      authTag: enc.authTag,
      updatedBy: updatedBy as string | null,
    });
  }
}

async function getCredential(tenantId: string, key: string): Promise<string | null> {
  const row = await db
    .select({
      encryptedValue: integrationCredentials.encryptedValue,
      iv: integrationCredentials.iv,
      authTag: integrationCredentials.authTag,
    })
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, PROVIDER),
        eq(integrationCredentials.key, key),
      ),
    )
    .limit(1);

  if (!row.length) return null;
  return decrypt(row[0].encryptedValue, row[0].iv, row[0].authTag);
}

async function deleteAllCredentials(tenantId: string) {
  await db
    .delete(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, PROVIDER),
      ),
    );
}

// ═══════════════════════════════════════════════════════════════════════
//  QuickBooks Online — OAuth2 Flow
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate the Intuit OAuth2 authorization URL.
 * Returns the URL that the admin should be redirected to.
 */
export function generateAuthUrl(userId: string): string {
  if (!isQBAppConfigured()) {
    throw new Error(
      'QuickBooks app not configured. Set QB_CLIENT_ID and QB_CLIENT_SECRET environment variables.',
    );
  }

  cleanExpiredStates();

  const { clientId, redirectUri } = getQBConfig();
  const nonce = randomBytes(16).toString('hex');
  const state = randomBytes(24).toString('hex');

  pendingStates.set(state, { userId, nonce, createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
  });

  return `${INTUIT_AUTH_URL}?${params.toString()}`;
}

/**
 * Handle the OAuth2 callback from Intuit.
 * Exchanges the authorization code for tokens and stores them encrypted.
 */
export async function handleOAuthCallback(
  code: string,
  realmId: string,
  state: string,
): Promise<{ success: boolean; redirectUrl: string }> {
  cleanExpiredStates();

  // Verify state
  const pending = pendingStates.get(state);
  if (!pending) {
    const { frontendUrl } = getQBConfig();
    return { success: false, redirectUrl: `${frontendUrl}/admin/integrations?qb=error&reason=invalid_state` };
  }
  pendingStates.delete(state);

  const { userId } = pending;
  const { clientId, clientSecret, redirectUri, frontendUrl } = getQBConfig();

  try {
    // Exchange code for tokens
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch(INTUIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text().catch(() => '');
      console.error('[QB] Token exchange failed:', tokenRes.status, errorText);
      return { success: false, redirectUrl: `${frontendUrl}/admin/integrations?qb=error&reason=token_exchange` };
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number; // seconds (typically 3600)
      x_refresh_token_expires_in: number; // seconds (typically ~8.6M = 100 days)
      token_type: string;
    };

    // Fetch company info from QBO API to get company name
    let companyName = `Realm ${realmId}`;
    try {
      const { environment } = getQBConfig();
      const apiBase = environment === 'production' ? QB_API_BASE_PROD : QB_API_BASE_SANDBOX;
      const companyRes = await fetch(
        `${apiBase}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=65`,
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${tokenData.access_token}`,
          },
        },
      );
      if (companyRes.ok) {
        const companyData = (await companyRes.json()) as {
          CompanyInfo: { CompanyName: string };
        };
        companyName = companyData.CompanyInfo?.CompanyName ?? companyName;
      }
    } catch {
      // Non-critical — we can still connect without the name
    }

    // Store all tokens and metadata encrypted
    const tenantId = await getTenantId();
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    const refreshExpiresAt = new Date(
      Date.now() + tokenData.x_refresh_token_expires_in * 1000,
    ).toISOString();

    await Promise.all([
      upsertCredential(tenantId, 'access_token', tokenData.access_token, userId),
      upsertCredential(tenantId, 'refresh_token', tokenData.refresh_token, userId),
      upsertCredential(tenantId, 'realm_id', realmId, userId),
      upsertCredential(tenantId, 'company_name', companyName, userId),
      upsertCredential(tenantId, 'connection_type', 'online', userId),
      upsertCredential(tenantId, 'token_expires_at', expiresAt, userId),
      upsertCredential(tenantId, 'refresh_token_expires_at', refreshExpiresAt, userId),
    ]);

    console.log(`[QB] Connected to company "${companyName}" (realm ${realmId})`);
    return { success: true, redirectUrl: `${frontendUrl}/admin/integrations?qb=connected` };
  } catch (err) {
    console.error('[QB] OAuth callback error:', err);
    return { success: false, redirectUrl: `${frontendUrl}/admin/integrations?qb=error&reason=unknown` };
  }
}

/**
 * Refresh the QBO access token using the stored refresh token.
 * Called automatically when the access token has expired.
 */
export async function refreshAccessToken(): Promise<boolean> {
  const tenantId = await getTenantId();
  const refreshToken = await getCredential(tenantId, 'refresh_token');
  if (!refreshToken) return false;

  const { clientId, clientSecret } = getQBConfig();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  try {
    const res = await fetch(INTUIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!res.ok) {
      console.error('[QB] Token refresh failed:', res.status);
      return false;
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      x_refresh_token_expires_in: number;
    };

    // Get the user who originally connected (for updatedBy field)
    const updaterRow = await db
      .select({ updatedBy: integrationCredentials.updatedBy })
      .from(integrationCredentials)
      .where(
        and(
          eq(integrationCredentials.tenantId, tenantId),
          eq(integrationCredentials.provider, PROVIDER),
          eq(integrationCredentials.key, 'access_token'),
        ),
      )
      .limit(1);
    const userId = updaterRow[0]?.updatedBy ?? '';

    const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
    const refreshExpiresAt = new Date(
      Date.now() + data.x_refresh_token_expires_in * 1000,
    ).toISOString();

    await Promise.all([
      upsertCredential(tenantId, 'access_token', data.access_token, userId),
      upsertCredential(tenantId, 'refresh_token', data.refresh_token, userId),
      upsertCredential(tenantId, 'token_expires_at', expiresAt, userId),
      upsertCredential(tenantId, 'refresh_token_expires_at', refreshExpiresAt, userId),
    ]);

    console.log('[QB] Access token refreshed successfully');
    return true;
  } catch (err) {
    console.error('[QB] Token refresh error:', err);
    return false;
  }
}

/**
 * Get a valid QBO access token, refreshing if needed.
 * Returns null if not connected.
 */
export async function getValidAccessToken(): Promise<{ token: string; realmId: string } | null> {
  const tenantId = await getTenantId();
  const connectionType = await getCredential(tenantId, 'connection_type');
  if (connectionType !== 'online') return null;

  const realmId = await getCredential(tenantId, 'realm_id');
  if (!realmId) return null;

  // Check if token is expired
  const expiresAtStr = await getCredential(tenantId, 'token_expires_at');
  const accessToken = await getCredential(tenantId, 'access_token');
  if (!accessToken) return null;

  if (expiresAtStr) {
    const expiresAt = new Date(expiresAtStr).getTime();
    // Refresh if expires within 5 minutes
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      const refreshed = await refreshAccessToken();
      if (!refreshed) return null;
      // Re-read the new access token
      const newToken = await getCredential(tenantId, 'access_token');
      return newToken ? { token: newToken, realmId } : null;
    }
  }

  return { token: accessToken, realmId };
}

// ═══════════════════════════════════════════════════════════════════════
//  QuickBooks Desktop — Web Connector Credentials
// ═══════════════════════════════════════════════════════════════════════

/**
 * Store Desktop Web Connector credentials.
 */
export async function setDesktopCredentials(
  companyName: string,
  username: string,
  password: string,
  userId: string,
): Promise<void> {
  const tenantId = await getTenantId();

  // Clear any existing QBO tokens first (switching mode)
  await deleteAllCredentials(tenantId);

  await Promise.all([
    upsertCredential(tenantId, 'connection_type', 'desktop', userId),
    upsertCredential(tenantId, 'company_name', companyName, userId),
    upsertCredential(tenantId, 'desktop_username', username, userId),
    upsertCredential(tenantId, 'desktop_password', password, userId),
  ]);

  console.log(`[QB Desktop] Credentials saved for "${companyName}"`);
}

// ═══════════════════════════════════════════════════════════════════════
//  Status & Disconnect
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get QuickBooks integration status for the status dashboard.
 */
export async function getQuickBooksStatus(): Promise<IntegrationStatusDto> {
  const tenantId = await getTenantId();

  const rows = await db
    .select({
      key: integrationCredentials.key,
      encryptedValue: integrationCredentials.encryptedValue,
      iv: integrationCredentials.iv,
      authTag: integrationCredentials.authTag,
      updatedAt: integrationCredentials.updatedAt,
      updatedBy: integrationCredentials.updatedBy,
    })
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, PROVIDER),
      ),
    );

  if (!rows.length) {
    return {
      provider: PROVIDER,
      configured: false,
      username: null,
      updatedAt: null,
      updatedBy: null,
      connectionType: null,
      realmId: null,
      companyName: null,
      tokenExpiresAt: null,
    };
  }

  // Decrypt fields
  const values = new Map<string, string>();
  let lastUpdated: Date | null = null;
  let lastUpdaterId: string | null = null;

  for (const row of rows) {
    values.set(row.key, decrypt(row.encryptedValue, row.iv, row.authTag));
    if (!lastUpdated || (row.updatedAt && row.updatedAt > lastUpdated)) {
      lastUpdated = row.updatedAt;
      lastUpdaterId = row.updatedBy;
    }
  }

  // Get updater email
  let updatedBy: string | null = null;
  if (lastUpdaterId) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, lastUpdaterId),
    });
    updatedBy = user?.email ?? null;
  }

  const connectionType = (values.get('connection_type') as 'online' | 'desktop') ?? null;
  const configured = connectionType === 'online'
    ? !!(values.get('access_token') && values.get('realm_id'))
    : connectionType === 'desktop'
      ? !!(values.get('desktop_username') && values.get('desktop_password'))
      : false;

  return {
    provider: PROVIDER,
    configured,
    username: values.get('company_name') ?? null,
    updatedAt: lastUpdated?.toISOString() ?? null,
    updatedBy,
    connectionType,
    realmId: values.get('realm_id') ?? null,
    companyName: values.get('company_name') ?? null,
    tokenExpiresAt: values.get('token_expires_at') ?? null,
  };
}

/**
 * Disconnect QuickBooks — revoke tokens (for QBO) and delete all stored credentials.
 */
export async function disconnect(userId: string): Promise<void> {
  const tenantId = await getTenantId();

  // For QBO: try to revoke the token at Intuit
  const connectionType = await getCredential(tenantId, 'connection_type');
  if (connectionType === 'online') {
    const refreshToken = await getCredential(tenantId, 'refresh_token');
    if (refreshToken) {
      const { clientId, clientSecret } = getQBConfig();
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      try {
        await fetch(INTUIT_REVOKE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${basicAuth}`,
          },
          body: JSON.stringify({ token: refreshToken }),
        });
      } catch {
        // Non-critical — deletion still proceeds
      }
    }
  }

  await deleteAllCredentials(tenantId);
  console.log(`[QB] Disconnected by user ${userId}`);
}

/**
 * Check if QuickBooks app credentials (Client ID + Secret) are configured
 * at the environment level (needed before OAuth can work).
 */
export function isAppConfigured(): boolean {
  return isQBAppConfigured();
}

// ─── QuickBooks Invoice Sync ────────────────────────────────────────────

/**
 * Find or create a QuickBooks customer for a given counterparty.
 * Stores the QB customer ID in integrationCredentials for future lookups.
 * Returns the QB customer ID.
 */
export async function findOrCreateQBCustomer(counterpartyId: string): Promise<{ id: string; name: string }> {
  const tenantId = await getTenantId();

  // Check if we already have a QB customer ID for this counterparty
  const existingQbId = await getCredential(tenantId, `qb_customer_${counterpartyId}`);
  if (existingQbId) {
    // We have a stored QB customer ID — return it (with name from counterparty)
    const [counterparty] = await db
      .select({ name: counterparties.name })
      .from(counterparties)
      .where(eq(counterparties.id, counterpartyId))
      .limit(1);
    return { id: existingQbId, name: counterparty?.name ?? 'Unknown' };
  }

  // Fetch counterparty details
  const [counterparty] = await db
    .select({
      name: counterparties.name,
      headOfficeEmail: counterparties.headOfficeEmail,
      headOfficePhone: counterparties.headOfficePhone,
    })
    .from(counterparties)
    .where(eq(counterparties.id, counterpartyId))
    .limit(1);

  if (!counterparty) throw new Error(`Counterparty ${counterpartyId} not found`);

  const tokenInfo = await getValidAccessToken();
  if (!tokenInfo) throw new Error('QuickBooks is not connected. Please connect via Settings → Integrations → QuickBooks.');

  const { token, realmId } = tokenInfo;
  const apiBase = getQBConfig().environment === 'production' ? QB_API_BASE_PROD : QB_API_BASE_SANDBOX;

  // Query QB for an existing customer with the same DisplayName
  const queryRes = await fetch(
    `${apiBase}/v3/company/${realmId}/query?query=${encodeURIComponent(`SELECT Id, DisplayName FROM Customer WHERE DisplayName = '${counterparty.name.replace(/'/g, "\\'")}' MAXRESULTS 1`)}`,
    { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
  );

  if (queryRes.ok) {
    const queryData = await queryRes.json() as { QueryResponse?: { Customer?: { Id: string; DisplayName: string }[] } };
    const existing = queryData.QueryResponse?.Customer?.[0];
    if (existing) {
      // Store the QB customer ID for future lookups
      await upsertCredential(tenantId, `qb_customer_${counterpartyId}`, existing.Id, '');
      return { id: existing.Id, name: existing.DisplayName };
    }
  }

  // Customer not found — create a new one
  const customerBody: Record<string, unknown> = {
    DisplayName: counterparty.name,
  };
  if (counterparty.headOfficeEmail) {
    customerBody.PrimaryEmailAddr = { Address: counterparty.headOfficeEmail };
  }
  if (counterparty.headOfficePhone) {
    customerBody.PrimaryPhone = { FreeFormNumber: counterparty.headOfficePhone };
  }

  const createRes = await fetch(`${apiBase}/v3/company/${realmId}/customer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(customerBody),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create QuickBooks customer: ${createRes.status} ${errText}`);
  }

  const createData = await createRes.json() as { Customer?: { Id: string; DisplayName: string } };
  const qbCustomer = createData.Customer;
  if (!qbCustomer?.Id) throw new Error('QuickBooks customer creation returned no ID');

  // Store the QB customer ID
  await upsertCredential(tenantId, `qb_customer_${counterpartyId}`, qbCustomer.Id, '');
  console.log(`[QB] Created customer "${qbCustomer.DisplayName}" (QB ID: ${qbCustomer.Id})`);
  return { id: qbCustomer.Id, name: qbCustomer.DisplayName };
}

/**
 * Create a QuickBooks invoice from a Fueld invoice + order data.
 * Stores the QB invoice ID in integrationCredentials.
 * Returns the QB invoice ID.
 */
export async function createQBInvoice(invoiceId: string): Promise<{ qbInvoiceId: string; qbInvoiceNumber: string }> {
  const tenantId = await getTenantId();

  // Check if already synced
  const existingQbInvoiceId = await getCredential(tenantId, `qb_invoice_${invoiceId}`);
  if (existingQbInvoiceId) {
    throw new Error('This invoice has already been synced to QuickBooks.');
  }

  // Fetch invoice with order + items
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, invoice.orderId))
    .limit(1);
  if (!order) throw new Error(`Order for invoice not found`);

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(orderItems.sortOrder);

  // Find or create the QB customer
  const customer = await findOrCreateQBCustomer(order.clientId);

  const tokenInfo = await getValidAccessToken();
  if (!tokenInfo) throw new Error('QuickBooks is not connected.');

  const { token, realmId } = tokenInfo;
  const apiBase = getQBConfig().environment === 'production' ? QB_API_BASE_PROD : QB_API_BASE_SANDBOX;

  // Find a fallback Item in QB (for SalesItemLineDetail)
  let fallbackItemId = '1'; // Default to first item
  try {
    const itemQueryRes = await fetch(
      `${apiBase}/v3/company/${realmId}/query?query=${encodeURIComponent('SELECT Id, Name FROM Item WHERE Active = true MAXRESULTS 1')}`,
      { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
    );
    if (itemQueryRes.ok) {
      const itemData = await itemQueryRes.json() as { QueryResponse?: { Item?: { Id: string; Name: string }[] } };
      const firstItem = itemData.QueryResponse?.Item?.[0];
      if (firstItem?.Id) fallbackItemId = firstItem.Id;
    }
  } catch {
    // Non-critical — use default item ID
  }

  // Build line items
  const lines = items.map((item) => {
    const qty = parseFloat(item.quantity?.toString() ?? '0');
    const price = parseFloat(item.salesPrice?.toString() ?? '0');
    const amount = parseFloat((qty * price).toFixed(2));
    const desc = [
      item.productType,
      item.description?.trim(),
      `${qty} ${item.salesUnit ?? item.unit} @ ${price} ${item.salesCurrency ?? order.currency}`,
    ].filter(Boolean).join(' — ');

    return {
      Amount: amount,
      DetailType: 'SalesItemLineDetail',
      Description: desc,
      SalesItemLineDetail: { ItemRef: { value: fallbackItemId } },
    };
  });

  // If no line items, create a single line with the invoice amount
  if (lines.length === 0) {
    const amount = parseFloat(invoice.amount?.toString() ?? '0');
    lines.push({
      Amount: amount,
      DetailType: 'SalesItemLineDetail',
      Description: `Invoice ${invoice.invoiceNumber} — Order ${order.orderNumber ?? ''}`,
      SalesItemLineDetail: { ItemRef: { value: fallbackItemId } },
    });
  }

  // Create QB invoice
  const invoiceBody = {
    CustomerRef: { value: customer.id },
    Line: lines,
    CustomerMemo: { value: `Fueld Order ${order.orderNumber ?? ''} — Invoice ${invoice.invoiceNumber}` },
    BillEmail: { Address: '' }, // Will be set if customer has email
  };

  const createRes = await fetch(`${apiBase}/v3/company/${realmId}/invoice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(invoiceBody),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create QuickBooks invoice: ${createRes.status} ${errText}`);
  }

  const createData = await createRes.json() as { Invoice?: { Id: string; DocNumber: string } };
  const qbInvoice = createData.Invoice;
  if (!qbInvoice?.Id) throw new Error('QuickBooks invoice creation returned no ID');

  // Store the QB invoice ID
  await upsertCredential(tenantId, `qb_invoice_${invoiceId}`, qbInvoice.Id, '');
  console.log(`[QB] Created invoice ${qbInvoice.DocNumber} (QB ID: ${qbInvoice.Id}) for Fueld invoice ${invoice.invoiceNumber}`);
  return { qbInvoiceId: qbInvoice.Id, qbInvoiceNumber: qbInvoice.DocNumber };
}

/**
 * Sync an invoice to QuickBooks. This is the main orchestrator.
 * Throws if QB is not connected or if invoice is already synced.
 */
export async function syncInvoiceToQuickBooks(invoiceId: string): Promise<{ qbInvoiceId: string; qbInvoiceNumber: string }> {
 // Check if already synced
  const status = await getInvoiceSyncStatus(invoiceId);
  if (status.synced) {
    return { qbInvoiceId: status.qbInvoiceId!, qbInvoiceNumber: status.qbInvoiceNumber ?? '' };
  }

  return createQBInvoice(invoiceId);
}

/**
 * Check if an invoice has been synced to QuickBooks.
 */
export async function getInvoiceSyncStatus(invoiceId: string): Promise<{
  synced: boolean;
  qbInvoiceId: string | null;
  qbInvoiceNumber: string | null;
}> {
  const tenantId = await getTenantId();
  const qbInvoiceId = await getCredential(tenantId, `qb_invoice_${invoiceId}`);
  if (!qbInvoiceId) {
    return { synced: false, qbInvoiceId: null, qbInvoiceNumber: null };
  }

  // Try to fetch the QB invoice number from the API for display
  let qbInvoiceNumber: string | null = null;
  try {
    const tokenInfo = await getValidAccessToken();
    if (tokenInfo) {
      const { token, realmId } = tokenInfo;
      const apiBase = getQBConfig().environment === 'production' ? QB_API_BASE_PROD : QB_API_BASE_SANDBOX;
      const res = await fetch(
        `${apiBase}/v3/company/${realmId}/query?query=${encodeURIComponent(`SELECT DocNumber FROM Invoice WHERE Id = '${qbInvoiceId}' MAXRESULTS 1`)}`,
        { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const data = await res.json() as { QueryResponse?: { Invoice?: { DocNumber: string }[] } };
        qbInvoiceNumber = data.QueryResponse?.Invoice?.[0]?.DocNumber ?? null;
      }
    }
  } catch {
    // Non-critical — we still know it's synced
  }

  return { synced: true, qbInvoiceId, qbInvoiceNumber };
}

/**
 * Sync an order's invoice to QuickBooks. Finds the invoice for the order
 * and syncs it. This is the order-based entry point used by the frontend.
 */
export async function syncOrderToQuickBooks(orderId: string): Promise<{ qbInvoiceId: string; qbInvoiceNumber: string }> {
  // Find the invoice for this order
  const [invoice] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.orderId, orderId))
    .orderBy(desc(invoices.createdAt))
    .limit(1);

  if (!invoice) {
    throw new Error('No invoice found for this order. Generate an invoice first.');
  }

  return syncInvoiceToQuickBooks(invoice.id);
}

/**
 * Check if an order's invoice has been synced to QuickBooks.
 */
export async function getOrderSyncStatus(orderId: string): Promise<{
  synced: boolean;
  qbInvoiceId: string | null;
  qbInvoiceNumber: string | null;
}> {
  const [invoice] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.orderId, orderId))
    .orderBy(desc(invoices.createdAt))
    .limit(1);

  if (!invoice) {
    return { synced: false, qbInvoiceId: null, qbInvoiceNumber: null };
  }

  return getInvoiceSyncStatus(invoice.id);
}
