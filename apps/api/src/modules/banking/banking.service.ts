// ═══════════════════════════════════════════════════════════════════════
//  Banking Service — Enable Banking integration for Fueld
//  Manages per-tenant credentials, bank connections, and sync logic.
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, desc } from 'drizzle-orm';
import { generateKeyPairSync } from 'crypto';
import { db } from '../../db';
import { integrationCredentials, tenants } from '../../db/schema';
import { encrypt, decrypt } from '../../lib/crypto';
import { EnableBankingClient, type ASPSP, type BankAccount, type Balance, type BankTransaction } from './enablebanking.client';
import { ControlPanelClient, type AuthData } from './controlpanel.client';

const PROVIDER = 'ENABLEBANKING';

// ─── Credential Management ──────────────────────────────────────────────

export async function saveEnableBankingCredentials(
  tenantId: string,
  appId: string,
  privateKeyPem: string,
  environment: string,
  redirectUrl: string,
  updatedBy: string,
): Promise<void> {
  const creds = [
    { key: 'app_id', value: appId },
    { key: 'private_key', value: privateKeyPem },
    { key: 'environment', value: environment },
    { key: 'redirect_url', value: redirectUrl },
  ];

  for (const cred of creds) {
    const { encrypted, iv, authTag } = encrypt(cred.value);
    // Upsert
    const [existing] = await db
      .select({ id: integrationCredentials.id })
      .from(integrationCredentials)
      .where(and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, PROVIDER),
        eq(integrationCredentials.key, cred.key),
      ))
      .limit(1);

    if (existing) {
      await db
        .update(integrationCredentials)
        .set({ encryptedValue: encrypted, iv, authTag, updatedBy, updatedAt: new Date() })
        .where(eq(integrationCredentials.id, existing.id));
    } else {
      await db
        .insert(integrationCredentials)
        .values({ tenantId, provider: PROVIDER, key: cred.key, encryptedValue: encrypted, iv, authTag, updatedBy });
    }
  }
}

export async function getEnableBankingCredentials(tenantId: string): Promise<{
  appId: string;
  privateKeyPem: string;
  environment: string;
  redirectUrl: string;
} | null> {
  const rows = await db
    .select()
    .from(integrationCredentials)
    .where(and(
      eq(integrationCredentials.tenantId, tenantId),
      eq(integrationCredentials.provider, PROVIDER),
    ));

  if (rows.length === 0) return null;

  const credMap: Record<string, string> = {};
  for (const row of rows) {
    credMap[row.key] = decrypt(row.encryptedValue, row.iv, row.authTag);
  }

  if (!credMap['app_id'] || !credMap['private_key']) return null;

  return {
    appId: credMap['app_id'],
    privateKeyPem: credMap['private_key'],
    environment: credMap['environment'] ?? 'production',
    redirectUrl: credMap['redirect_url'] ?? '',
  };
}

export async function isEnableBankingConfigured(tenantId: string): Promise<boolean> {
  const creds = await getEnableBankingCredentials(tenantId);
  return creds !== null;
}

function createClient(tenantId: string, creds: NonNullable<Awaited<ReturnType<typeof getEnableBankingCredentials>>>, sessionId?: string): EnableBankingClient {
  const client = new EnableBankingClient({
    appId: creds.appId,
    privateKeyPem: creds.privateKeyPem,
    redirectUrl: creds.redirectUrl,
  });
  if (sessionId) client.setSessionId(sessionId);
  return client;
}

// ─── ASPSP Listing ──────────────────────────────────────────────────────

export async function listAvailableBanks(tenantId: string, country: string): Promise<ASPSP[]> {
  const creds = await getEnableBankingCredentials(tenantId);
  if (!creds) throw new Error('Enable Banking not configured');
  const client = createClient(tenantId, creds);
  return client.listAspsps(country);
}

// ─── Bank Connection Management ─────────────────────────────────────────

// We use a simple table created by the migration — access via raw SQL since
// the Drizzle schema file may not have the tables defined yet.

import { sql } from 'drizzle-orm';

export async function startBankConnection(
  tenantId: string,
  aspspName: string,
  country: string,
): Promise<{ authorizationUrl: string }> {
  const creds = await getEnableBankingCredentials(tenantId);
  if (!creds) throw new Error('Enable Banking not configured');
  const client = createClient(tenantId, creds);
  return client.startAuthorization(aspspName, country, creds.redirectUrl);
}

export async function handleOAuthCallback(
  tenantId: string,
  code: string,
  aspspName: string,
  country: string,
): Promise<{ sessionId: string; accounts: BankAccount[] }> {
  const creds = await getEnableBankingCredentials(tenantId);
  if (!creds) throw new Error('Enable Banking not configured');
  const client = createClient(tenantId, creds);
  const result = await client.createSession(code);

  // Encrypt session data before storing (may contain tokens)
  const sessionJson = JSON.stringify({ sessionId: result.sessionId, createdAt: new Date().toISOString() });
  const { encrypted, iv, authTag } = encrypt(sessionJson);

  // Save connection to DB with encrypted session_data
  await db.execute(sql`
    INSERT INTO bank_connections (tenant_id, aspsp_name, aspsp_country, session_id, session_data, status)
    VALUES (${tenantId}, ${aspspName}, ${country}, ${result.sessionId}, ${JSON.stringify({ encrypted, iv, authTag })}::jsonb, 'active')
    ON CONFLICT ON CONSTRAINT bank_connections_pkey DO NOTHING
  `);

  return result;
}

export async function listBankConnections(tenantId: string) {
  const result = await db.execute(sql`
    SELECT bc.id, bc.aspsp_name, bc.aspsp_country, bc.session_id, bc.status,
           bc.last_synced_at, bc.created_at, bc.user_id,
           u.name as user_name, u.email as user_email,
           bc.created_at + interval '90 days' as auth_expires_at
    FROM bank_connections bc
    LEFT JOIN users u ON u.id = bc.user_id
    WHERE bc.tenant_id = ${tenantId}
    ORDER BY bc.aspsp_name
  `);
  return result as any[];
}

export async function deleteBankConnection(tenantId: string, connectionId: string): Promise<void> {
  await db.execute(sql`
    DELETE FROM bank_connections
    WHERE id = ${connectionId} AND tenant_id = ${tenantId}
  `);
}

// ─── Sync: Balances + Transactions ──────────────────────────────────────

export async function syncBankConnection(tenantId: string, connectionId: string): Promise<{
  accounts: number;
  balances: number;
  transactions: number;
}> {
  const creds = await getEnableBankingCredentials(tenantId);
  if (!creds) throw new Error('Enable Banking not configured');

  // Get connection
  const connResult = await db.execute(sql`
    SELECT session_id, aspsp_name, aspsp_country FROM bank_connections
    WHERE id = ${connectionId} AND tenant_id = ${tenantId}
  `);
  const conn = (connResult as any[])[0];
  if (!conn || !conn.session_id) throw new Error('Connection has no session');

  const client = createClient(tenantId, creds, conn.session_id);

  // List accounts — this also validates the session is still active.
  // If the session has expired (Enable Banking sessions last 90 days),
  // the API will return 401/403. We catch this and mark the connection
  // as 'expired' so the admin knows to re-authorize.
  let accounts: BankAccount[];
  try {
    accounts = await client.listAccounts();
  } catch (e: any) {
    const errMsg = String(e?.message ?? '');
    if (errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('Unauthorized') || errMsg.includes('session')) {
      // Session expired — mark it so admin can re-authorize
      await db.execute(sql`
        UPDATE bank_connections SET status = 'expired', updated_at = NOW()
        WHERE id = ${connectionId}
      `);
      console.warn(`[Banking] Session expired for ${conn.aspsp_name} (connection ${connectionId}). Admin needs to re-authorize.`);
      throw new Error(`Bank session for ${conn.aspsp_name} has expired. Please re-authorize this bank connection in Settings → Integrations.`);
    }
    throw e; // Re-throw other errors
  }

  let balanceCount = 0;
  let txnCount = 0;

  for (const account of accounts) {
    // Fetch balances
    const balances = await client.getAccountBalances(account.id);
    for (const bal of balances) {
      // Delete old balances for this account, insert new
      await db.execute(sql`
        DELETE FROM bank_account_balances
        WHERE connection_id = ${connectionId} AND account_id = ${account.id}
      `);
      await db.execute(sql`
        INSERT INTO bank_account_balances (connection_id, tenant_id, account_id, iban, account_name, balance, currency, balance_type, synced_at)
        VALUES (${connectionId}, ${tenantId}, ${account.id}, ${account.iban ?? null}, ${account.name ?? null}, ${bal.amount}, ${bal.currency}, ${bal.balanceType ?? null}, NOW())
      `);
      balanceCount++;
    }

    // Fetch transactions (last 90 days)
    const dateFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const txns = await client.getTransactions(account.id, dateFrom);
    for (const txn of txns) {
      // Insert if not exists (UNIQUE constraint on connection_id + transaction_id)
      await db.execute(sql`
        INSERT INTO bank_transactions (
          connection_id, tenant_id, account_id, transaction_id, booking_date,
          amount, currency, credit_debit_indicator,
          debtor_name, debtor_account_iban, debtor_account_bban, debtor_agent,
          debtor_organisation_id,
          creditor_name, creditor_account_iban, creditor_account_bban, creditor_agent,
          creditor_organisation_id,
          remittance_info, remittance_info_structured, payment_reference,
          bank_transaction_code, bank_transaction_code_description,
          balance_after_amount, balance_after_currency,
          entry_reference, reference_number, reference_number_schema,
          exchange_rate, merchant_category_code, note, status,
          transaction_date, additional_info, resource_id, raw_data
        ) VALUES (
          ${connectionId}, ${tenantId}, ${account.id}, ${txn.transactionId}, ${txn.bookingDate ?? null},
          ${txn.amount}, ${txn.currency}, ${txn.creditDebitIndicator},
          ${txn.debtorName ?? null}, ${txn.debtorAccountIban ?? null}, ${txn.debtorAccountBban ?? null}, ${txn.debtorAgent ?? null},
          ${txn.debtorOrganisationId ?? null},
          ${txn.creditorName ?? null}, ${txn.creditorAccountIban ?? null}, ${txn.creditorAccountBban ?? null}, ${txn.creditorAgent ?? null},
          ${txn.creditorOrganisationId ?? null},
          ${txn.remittanceInfo ?? null}, ${txn.remittanceInfoStructured ?? null}, ${txn.paymentReference ?? null},
          ${txn.bankTransactionCode ?? null}, ${txn.bankTransactionCodeDescription ?? null},
          ${txn.balanceAfterAmount ?? null}, ${txn.balanceAfterCurrency ?? null},
          ${txn.entryReference ?? null}, ${txn.referenceNumber ?? null}, ${txn.referenceNumberSchema ?? null},
          ${txn.exchangeRate ?? null}, ${txn.merchantCategoryCode ?? null}, ${txn.note ?? null}, ${txn.status ?? null},
          ${txn.transactionDate ?? null}, ${txn.additionalInfo ?? null}, ${txn.resourceId ?? null}, ${JSON.stringify(txn.raw)}
        )
        ON CONFLICT (connection_id, transaction_id) DO NOTHING
      `);
      txnCount++;
    }
  }

  // Update last_synced_at
  await db.execute(sql`
    UPDATE bank_connections SET last_synced_at = NOW(), updated_at = NOW()
    WHERE id = ${connectionId}
  `);

  return { accounts: accounts.length, balances: balanceCount, transactions: txnCount };
}

export async function syncAllConnections(tenantId: string): Promise<{ synced: number; errors: number }> {
  const conns = await listBankConnections(tenantId);
  let synced = 0;
  let errors = 0;
  for (const conn of conns) {
    // Skip expired connections silently — admin needs to re-authorize
    if ((conn as any).status === 'expired' || (conn as any).status === 'pending') continue;
    try {
      await syncBankConnection(tenantId, (conn as any).id);
      synced++;
    } catch (e) {
      console.error(`[Banking] Sync failed for ${(conn as any).aspsp_name}:`, e);
      errors++;
    }
  }
  return { synced, errors };
}

// ─── Overview / Aggregation ─────────────────────────────────────────────

export async function getCashOverview(tenantId: string) {
  // Per-currency totals + per-connection breakdown
  const totalsResult = await db.execute(sql`
    SELECT currency, SUM(balance)::numeric(14,2) as total_balance, count(*) as account_count
    FROM bank_account_balances
    WHERE tenant_id = ${tenantId}
    GROUP BY currency
    ORDER BY total_balance DESC
  `);

  const perBankResult = await db.execute(sql`
    SELECT bc.aspsp_name, bc.aspsp_country, bc.status, bc.last_synced_at,
           bab.iban, bab.account_name, bab.balance, bab.currency, bab.account_id
    FROM bank_connections bc
    LEFT JOIN bank_account_balances bab ON bab.connection_id = bc.id
    WHERE bc.tenant_id = ${tenantId}
    ORDER BY bc.aspsp_name, bab.currency
  `);

  return {
    totals: totalsResult as any[],
    accounts: perBankResult as any[],
  };
}

export async function getTransactions(
  tenantId: string,
  opts: { accountId?: string; dateFrom?: string; dateTo?: string; limit?: number; offset?: number } = {},
) {
  const limit = Math.min(opts.limit ?? 100, 500);
  const offset = opts.offset ?? 0;

  let query = sql`
    SELECT bt.*, bc.aspsp_name
    FROM bank_transactions bt
    JOIN bank_connections bc ON bc.id = bt.connection_id
    WHERE bt.tenant_id = ${tenantId}
  `;

  if (opts.accountId) {
    query = sql`${query} AND bt.account_id = ${opts.accountId}`;
  }
  if (opts.dateFrom) {
    query = sql`${query} AND bt.booking_date >= ${opts.dateFrom}`;
  }
  if (opts.dateTo) {
    query = sql`${query} AND bt.booking_date <= ${opts.dateTo}`;
  }

  query = sql`${query} ORDER BY bt.booking_date DESC LIMIT ${limit} OFFSET ${offset}`;

  const result = await db.execute(query);
  return result as any[];
}

// ═══════════════════════════════════════════════════════════════════════
//  Per-User Enable Banking Credentials (self-service onboarding)
// ═══════════════════════════════════════════════════════════════════════

const cpClient = new ControlPanelClient();

/** Save per-user Enable Banking credentials (all sensitive fields encrypted). */
export async function saveUserEnableBankingCredentials(
  userId: string,
  tenantId: string,
  authData: AuthData,
  appId: string,
  privateKeyPem: string,
  certificatePem: string,
  environment: string,
): Promise<void> {
  const encIdToken = encrypt(authData.idToken);
  const encRefreshToken = encrypt(authData.refreshToken);
  const encPrivateKey = encrypt(privateKeyPem);

  await db.execute(sql`
    INSERT INTO enable_banking_user_credentials (
      user_id, tenant_id, eb_user_id, eb_email,
      id_token_encrypted, id_token_iv, id_token_auth_tag,
      refresh_token_encrypted, refresh_token_iv, refresh_token_auth_tag,
      app_id, private_key_encrypted, private_key_iv, private_key_auth_tag,
      certificate_pem, environment, status
    ) VALUES (
      ${userId}, ${tenantId}, ${authData.localId}, ${authData.email},
      ${encIdToken.encrypted}, ${encIdToken.iv}, ${encIdToken.authTag},
      ${encRefreshToken.encrypted}, ${encRefreshToken.iv}, ${encRefreshToken.authTag},
      ${appId}, ${encPrivateKey.encrypted}, ${encPrivateKey.iv}, ${encPrivateKey.authTag},
      ${certificatePem}, ${environment}, 'active'
    )
    ON CONFLICT (user_id) DO UPDATE SET
      eb_user_id = EXCLUDED.eb_user_id,
      eb_email = EXCLUDED.eb_email,
      id_token_encrypted = EXCLUDED.id_token_encrypted,
      id_token_iv = EXCLUDED.id_token_iv,
      id_token_auth_tag = EXCLUDED.id_token_auth_tag,
      refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
      refresh_token_iv = EXCLUDED.refresh_token_iv,
      refresh_token_auth_tag = EXCLUDED.refresh_token_auth_tag,
      app_id = EXCLUDED.app_id,
      private_key_encrypted = EXCLUDED.private_key_encrypted,
      private_key_iv = EXCLUDED.private_key_iv,
      private_key_auth_tag = EXCLUDED.private_key_auth_tag,
      certificate_pem = EXCLUDED.certificate_pem,
      environment = EXCLUDED.environment,
      status = 'active',
      updated_at = NOW()
  `);
}

/** Get per-user credentials (decrypted). Falls back to tenant creds if user has none. */
export async function getUserEnableBankingCredentials(userId: string, tenantId: string): Promise<{
  appId: string;
  privateKeyPem: string;
  environment: string;
  redirectUrl: string;
} | null> {
  // Try per-user credentials first
  const rows = await db.execute(sql`
    SELECT app_id, private_key_encrypted, private_key_iv, private_key_auth_tag,
           environment FROM enable_banking_user_credentials
    WHERE user_id = ${userId} AND status = 'active'
  `) as any[];

  if (rows.length > 0) {
    const row = rows[0];
    const privateKeyPem = decrypt(row.private_key_encrypted, row.private_key_iv, row.private_key_auth_tag);
    const redirectUrl = process.env['CORS_ORIGIN']
      ? `${process.env['CORS_ORIGIN']}/api/banking/callback`
      : null;
    if (!redirectUrl) throw new Error('CORS_ORIGIN must be configured for Enable Banking');
    return {
      appId: row.app_id,
      privateKeyPem,
      environment: row.environment ?? 'production',
      redirectUrl,
    };
  }

  // Fall back to per-tenant credentials (backward compatibility)
  return getEnableBankingCredentials(tenantId);
}

/** Check if user has per-user Enable Banking configured. */
export async function isUserEnableBankingConfigured(userId: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 FROM enable_banking_user_credentials
    WHERE user_id = ${userId} AND status = 'active' LIMIT 1
  `) as any[];
  return rows.length > 0;
}

// ─── Self-Service Onboarding Flow ───────────────────────────────────────

/** Get Control Panel auth tokens from the database (stored under ENABLEBANKING_CP provider). */
async function getControlPanelTokens(tenantId: string): Promise<{ idToken: string; refreshToken: string; localId: string; email: string } | null> {
  const rows = await db.execute(sql`
    SELECT key, encrypted_value, iv, auth_tag FROM integration_credentials
    WHERE tenant_id = ${tenantId} AND provider = 'ENABLEBANKING_CP'
  `) as any[];

  if (rows.length === 0) return null;

  const credMap: Record<string, string> = {};
  for (const row of rows) {
    credMap[row.key] = decrypt(row.encrypted_value, row.iv, row.auth_tag);
  }

  if (!credMap['id_token'] || !credMap['refresh_token']) return null;

  return {
    idToken: credMap['id_token'],
    refreshToken: credMap['refresh_token'],
    localId: credMap['local_id'] ?? '',
    email: credMap['email'] ?? '',
  };
}

/** Refresh Control Panel auth tokens if needed. Refreshes if expired. */
async function ensureValidCpTokens(tenantId: string): Promise<{ idToken: string; refreshToken: string; localId: string; email: string } | null> {
  const tokens = await getControlPanelTokens(tenantId);
  if (!tokens) return null;

  // Try to refresh the token to get a fresh idToken
  try {
    const refreshed = await cpClient.refreshToken(tokens.refreshToken);
    // Update stored tokens with the refreshed values
    const updatedTokens = {
      idToken: refreshed.id_token,
      refreshToken: refreshed.refresh_token ?? tokens.refreshToken, // Some APIs don't return a new refresh token
      localId: tokens.localId,
      email: tokens.email,
    };
    // Save refreshed tokens back to DB (no updatedBy since localId is not a Fueld user ID)
    await saveControlPanelTokens(tenantId, updatedTokens);
    return updatedTokens;
  } catch (e) {
    // If refresh fails, return the original tokens — the registerApplication call will fail with 401
    // and the user will need to re-authenticate via email-link
    console.warn('[Banking] CP token refresh failed:', e);
    return tokens;
  }
}

/** Save Control Panel auth tokens to the database (encrypted). */
export async function saveControlPanelTokens(
  tenantId: string,
  authData: { localId: string; email: string; idToken: string; refreshToken: string },
  updatedBy?: string,
): Promise<void> {
  const creds = [
    { key: 'id_token', value: authData.idToken },
    { key: 'refresh_token', value: authData.refreshToken },
    { key: 'local_id', value: authData.localId },
    { key: 'email', value: authData.email },
  ];

  for (const cred of creds) {
    const { encrypted, iv, authTag } = encrypt(cred.value);
    const [existing] = await db
      .select({ id: integrationCredentials.id })
      .from(integrationCredentials)
      .where(and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, 'ENABLEBANKING_CP'),
        eq(integrationCredentials.key, cred.key),
      ))
      .limit(1);

    if (existing) {
      if (updatedBy) {
        await db.update(integrationCredentials)
          .set({ encryptedValue: encrypted, iv, authTag, updatedBy, updatedAt: new Date() })
          .where(eq(integrationCredentials.id, existing.id));
      } else {
        await db.update(integrationCredentials)
          .set({ encryptedValue: encrypted, iv, authTag, updatedAt: new Date() })
          .where(eq(integrationCredentials.id, existing.id));
      }
    } else {
      if (updatedBy) {
        await db.insert(integrationCredentials)
          .values({ tenantId, provider: 'ENABLEBANKING_CP', key: cred.key, encryptedValue: encrypted, iv, authTag, updatedBy });
      } else {
        await db.insert(integrationCredentials)
          .values({ tenantId, provider: 'ENABLEBANKING_CP', key: cred.key, encryptedValue: encrypted, iv, authTag });
      }
    }
  }
}

/** Check if Control Panel tokens are configured for the tenant. */
export async function isControlPanelConfigured(tenantId: string): Promise<boolean> {
  const tokens = await getControlPanelTokens(tenantId);
  return tokens !== null;
}

/** Initiate email-link sign-in: sends sign-in email to user. */
export async function initiateEnableBankingSetup(
  userId: string,
  tenantId: string,
  email: string,
  callbackUrl: string,
): Promise<void> {
  // Check if user already has active credentials
  const existing = await isUserEnableBankingConfigured(userId);
  if (existing) {
    throw new Error('You already have an Enable Banking account configured.');
  }

  // Invalidate any previous pending requests for this user
  await db.execute(sql`
    UPDATE enable_banking_auth_pending
    SET status = 'cancelled', updated_at = NOW()
    WHERE user_id = ${userId} AND status = 'pending'
  `);

  // Use enablebanking.com as continueUrl (Firebase requires whitelisted domains)
  // The user will see the oobCode in the URL after clicking the email link
  // and copy it into our UI. localhost would also work but the user can't reach
  // the server's localhost from their browser.
  const continueUrl = 'https://enablebanking.com/';
  await cpClient.getOobConfirmationCode(email, continueUrl);

  // Store pending state
  await db.execute(sql`
    INSERT INTO enable_banking_auth_pending (user_id, tenant_id, email, status)
    VALUES (${userId}, ${tenantId}, ${email}, 'pending')
  `);
}

/** Complete setup: if CP tokens exist, register app directly. Otherwise use email-link flow. */
export async function completeEnableBankingSetup(
  userId: string,
  tenantId: string,
  email: string,
  oobCode: string | null,
  redirectUrl: string,
): Promise<{ appId: string; isNew: boolean }> {
  // Check if user already has credentials — don't create duplicate apps
  const existing = await isUserEnableBankingConfigured(userId);
  if (existing) {
    // Return the existing app ID
    const creds = await getUserEnableBankingCredentials(userId, tenantId);
    if (creds) {
      return { appId: creds.appId, isNew: false };
    }
  }

  try {
    let cpTokens: { idToken: string; refreshToken: string; localId: string; email: string } | null = null;

    // If oobCode is provided, use email-link flow to get tokens
    if (oobCode) {
      const authData = await cpClient.emailLinkSignin(email, oobCode);
      // Save CP tokens for future use (so other users don't need email-link)
      await saveControlPanelTokens(tenantId, authData, userId);
      cpTokens = authData;
    } else {
      // Try to use existing CP tokens
      cpTokens = await ensureValidCpTokens(tenantId);
    }

    if (!cpTokens) {
      throw new Error('No Enable Banking Control Panel tokens available. An admin must complete the email-link setup first.');
    }

    // Generate RSA key pair for this user
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const certificatePem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    // Register application in Enable Banking Control Panel
    const appName = `Fueld-${tenantId.slice(0, 8)}-${userId.slice(0, 8)}`;
    const { app_id: appId } = await cpClient.registerApplication({
      name: appName,
      certificate: certificatePem,
      environment: 'PRODUCTION',
      redirect_urls: [redirectUrl],
      description: `Auto-created by Fueld for user ${email}`,
      privacy_url: 'https://fueld.app/privacy',
      terms_url: 'https://fueld.app/terms',
      gdpr_email: email,
    }, cpTokens.idToken);

    // Save per-user credentials (encrypted)
    await saveUserEnableBankingCredentials(
      userId, tenantId,
      { localId: cpTokens.localId, email: cpTokens.email, idToken: cpTokens.idToken, refreshToken: cpTokens.refreshToken, expiresIn: 3600 },
      appId, privateKeyPem, certificatePem, 'production',
    );

    // Update pending status to completed
    await db.execute(sql`
      UPDATE enable_banking_auth_pending
      SET status = 'completed', updated_at = NOW()
      WHERE user_id = ${userId} AND status = 'pending'
    `);

    return { appId, isNew: true };
  } catch (e: any) {
    // Update pending status to error so user can retry
    await db.execute(sql`
      UPDATE enable_banking_auth_pending
      SET status = 'error', error = ${e?.message ?? 'Unknown error'}, updated_at = NOW()
      WHERE user_id = ${userId} AND status = 'pending'
    `);
    throw e;
  }
}

/** Send EB Control Panel login email (for activating apps, linking accounts). */
export async function sendEbLoginEmail(email: string): Promise<void> {
  const continueUrl = 'https://enablebanking.com/cp/applications';
  await cpClient.getOobConfirmationCode(email, continueUrl);
}

/** Quick setup: register app for user using existing CP tokens (no email needed). */
export async function quickSetupEnableBanking(
  userId: string,
  tenantId: string,
  email: string,
  redirectUrl: string,
): Promise<{ appId: string }> {
  return completeEnableBankingSetup(userId, tenantId, email, null, redirectUrl);
}

/** Get setup status for polling. */
export async function getEnableBankingSetupStatus(userId: string): Promise<{
  status: 'none' | 'pending' | 'completed' | 'error';
  error?: string;
}> {
  // Check if credentials already exist
  const credRows = await db.execute(sql`
    SELECT 1 FROM enable_banking_user_credentials
    WHERE user_id = ${userId} AND status = 'active' LIMIT 1
  `) as any[];
  if (credRows.length > 0) return { status: 'completed' };

  // Check pending auth
  const pendingRows = await db.execute(sql`
    SELECT status, error FROM enable_banking_auth_pending
    WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 1
  `) as any[];
  if (pendingRows.length === 0) return { status: 'none' };

  const row = pendingRows[0];
  return { status: row.status, error: row.error ?? undefined };
}

// ─── Per-User Bank Connection Functions ─────────────────────────────────

/** List available banks using the user's credentials (falls back to tenant). */
export async function listAvailableBanksForUser(userId: string, tenantId: string, country: string): Promise<ASPSP[]> {
  const creds = await getUserEnableBankingCredentials(userId, tenantId);
  if (!creds) throw new Error('Enable Banking not configured. Please set up your account first.');
  try {
    const client = new EnableBankingClient({
      appId: creds.appId,
      privateKeyPem: creds.privateKeyPem,
      redirectUrl: creds.redirectUrl,
    });
    return await client.listAspsps(country);
  } catch (e: any) {
    // If per-user app is not active, fall back to tenant credentials
    if (String(e?.message ?? '').includes('403') || String(e?.message ?? '').includes('not active')) {
      const tenantCreds = await getEnableBankingCredentials(tenantId);
      if (tenantCreds) {
        const client = new EnableBankingClient({
          appId: tenantCreds.appId,
          privateKeyPem: tenantCreds.privateKeyPem,
          redirectUrl: tenantCreds.redirectUrl,
        });
        return client.listAspsps(country);
      }
    }
    throw e;
  }
}

/** Start bank connection using the user's credentials. */
export async function startBankConnectionForUser(
  userId: string,
  tenantId: string,
  aspspName: string,
  country: string,
): Promise<{ authorizationUrl: string }> {
  const creds = await getUserEnableBankingCredentials(userId, tenantId);
  if (!creds) throw new Error('Enable Banking not configured. Please set up your account first.');
  try {
    const client = new EnableBankingClient({
      appId: creds.appId,
      privateKeyPem: creds.privateKeyPem,
      redirectUrl: creds.redirectUrl,
    });
    return client.startAuthorization(aspspName, country, creds.redirectUrl);
  } catch (e: any) {
    // If per-user app is not active, fall back to tenant credentials
    if (String(e?.message ?? '').includes('403') || String(e?.message ?? '').includes('not active')) {
      const tenantCreds = await getEnableBankingCredentials(tenantId);
      if (tenantCreds) {
        const client = new EnableBankingClient({
          appId: tenantCreds.appId,
          privateKeyPem: tenantCreds.privateKeyPem,
          redirectUrl: tenantCreds.redirectUrl,
        });
        return client.startAuthorization(aspspName, country, tenantCreds.redirectUrl);
      }
    }
    throw e;
  }
}

/** Handle OAuth callback using the user's credentials. Stores user_id on the connection. */
export async function handleOAuthCallbackForUser(
  userId: string,
  tenantId: string,
  code: string,
  aspspName: string,
  country: string,
): Promise<{ sessionId: string; accounts: BankAccount[] }> {
  const creds = await getUserEnableBankingCredentials(userId, tenantId);
  if (!creds) throw new Error('Enable Banking not configured. Please set up your account first.');
  const client = new EnableBankingClient({
    appId: creds.appId,
    privateKeyPem: creds.privateKeyPem,
    redirectUrl: creds.redirectUrl,
  });
  const result = await client.createSession(code);

  // Encrypt session data
  const sessionJson = JSON.stringify({ sessionId: result.sessionId, createdAt: new Date().toISOString() });
  const { encrypted, iv, authTag } = encrypt(sessionJson);

  // Save connection with user_id
  await db.execute(sql`
    INSERT INTO bank_connections (tenant_id, user_id, aspsp_name, aspsp_country, session_id, session_data, status)
    VALUES (${tenantId}, ${userId}, ${aspspName}, ${country}, ${result.sessionId}, ${JSON.stringify({ encrypted, iv, authTag })}::jsonb, 'active')
    ON CONFLICT ON CONSTRAINT bank_connections_pkey DO NOTHING
  `);

  return result;
}

/** Sync a bank connection using the connection owner's credentials. */
export async function syncBankConnectionForUser(
  tenantId: string,
  connectionId: string,
): Promise<{ accounts: number; balances: number; transactions: number }> {
  // Get connection with user_id
  const connResult = await db.execute(sql`
    SELECT session_id, aspsp_name, aspsp_country, user_id FROM bank_connections
    WHERE id = ${connectionId} AND tenant_id = ${tenantId}
  `);
  const conn = (connResult as any[])[0];
  if (!conn || !conn.session_id) throw new Error('Connection has no session');

  // Get credentials: use connection owner's if available, else tenant creds
  let creds;
  if (conn.user_id) {
    creds = await getUserEnableBankingCredentials(conn.user_id, tenantId);
  }
  if (!creds) {
    creds = await getEnableBankingCredentials(tenantId);
  }
  if (!creds) throw new Error('Enable Banking not configured');

  const client = new EnableBankingClient({
    appId: creds.appId,
    privateKeyPem: creds.privateKeyPem,
    redirectUrl: creds.redirectUrl,
  });
  client.setSessionId(conn.session_id);

  let accounts: BankAccount[];
  try {
    accounts = await client.listAccounts();
  } catch (e: any) {
    const errMsg = String(e?.message ?? '');
    if (errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('Unauthorized') || errMsg.includes('session')) {
      await db.execute(sql`UPDATE bank_connections SET status = 'expired', updated_at = NOW() WHERE id = ${connectionId}`);
      throw new Error(`Bank session for ${conn.aspsp_name} has expired. Please re-authorize this bank connection.`);
    }
    throw e;
  }

  let balanceCount = 0;
  let txnCount = 0;

  for (const account of accounts) {
    const balances = await client.getAccountBalances(account.id);
    for (const bal of balances) {
      await db.execute(sql`DELETE FROM bank_account_balances WHERE connection_id = ${connectionId} AND account_id = ${account.id}`);
      await db.execute(sql`
        INSERT INTO bank_account_balances (connection_id, tenant_id, account_id, iban, account_name, balance, currency, balance_type, synced_at)
        VALUES (${connectionId}, ${tenantId}, ${account.id}, ${account.iban ?? null}, ${account.name ?? null}, ${bal.amount}, ${bal.currency}, ${bal.balanceType ?? null}, NOW())
      `);
      balanceCount++;
    }

    const dateFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const txns = await client.getTransactions(account.id, dateFrom);
    for (const txn of txns) {
      await db.execute(sql`
        INSERT INTO bank_transactions (
          connection_id, tenant_id, account_id, transaction_id, booking_date,
          amount, currency, credit_debit_indicator,
          debtor_name, debtor_account_iban, debtor_account_bban, debtor_agent, debtor_organisation_id,
          creditor_name, creditor_account_iban, creditor_account_bban, creditor_agent, creditor_organisation_id,
          remittance_info, remittance_info_structured, payment_reference,
          bank_transaction_code, bank_transaction_code_description,
          balance_after_amount, balance_after_currency,
          entry_reference, reference_number, reference_number_schema,
          exchange_rate, merchant_category_code, note, status,
          transaction_date, additional_info, resource_id, raw_data
        ) VALUES (
          ${connectionId}, ${tenantId}, ${account.id}, ${txn.transactionId}, ${txn.bookingDate ?? null},
          ${txn.amount}, ${txn.currency}, ${txn.creditDebitIndicator},
          ${txn.debtorName ?? null}, ${txn.debtorAccountIban ?? null}, ${txn.debtorAccountBban ?? null}, ${txn.debtorAgent ?? null}, ${txn.debtorOrganisationId ?? null},
          ${txn.creditorName ?? null}, ${txn.creditorAccountIban ?? null}, ${txn.creditorAccountBban ?? null}, ${txn.creditorAgent ?? null}, ${txn.creditorOrganisationId ?? null},
          ${txn.remittanceInfo ?? null}, ${txn.remittanceInfoStructured ?? null}, ${txn.paymentReference ?? null},
          ${txn.bankTransactionCode ?? null}, ${txn.bankTransactionCodeDescription ?? null},
          ${txn.balanceAfterAmount ?? null}, ${txn.balanceAfterCurrency ?? null},
          ${txn.entryReference ?? null}, ${txn.referenceNumber ?? null}, ${txn.referenceNumberSchema ?? null},
          ${txn.exchangeRate ?? null}, ${txn.merchantCategoryCode ?? null}, ${txn.note ?? null}, ${txn.status ?? null},
          ${txn.transactionDate ?? null}, ${txn.additionalInfo ?? null}, ${txn.resourceId ?? null}, ${JSON.stringify(txn.raw)}
        )
        ON CONFLICT (connection_id, transaction_id) DO NOTHING
      `);
      txnCount++;
    }
  }

  await db.execute(sql`UPDATE bank_connections SET last_synced_at = NOW(), updated_at = NOW() WHERE id = ${connectionId}`);
  return { accounts: accounts.length, balances: balanceCount, transactions: txnCount };
}