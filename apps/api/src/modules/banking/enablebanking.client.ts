// ═══════════════════════════════════════════════════════════════════════
//  Enable Banking API Client (TypeScript port from raiden-energy Python)
//  Handles JWT auth (RS256), OAuth2 consent flow, session management,
//  and account/balance/transaction fetching.
//  API docs: https://enablebanking.com/docs/api/ref/
// ═══════════════════════════════════════════════════════════════════════

import { createSign } from 'crypto';

const API_BASE = 'https://api.enablebanking.com';

interface EnableBankingConfig {
  appId: string;
  privateKeyPem: string;
  redirectUrl: string;
}

export interface ASPSP {
  name: string;
  country: string;
  bic?: string;
  bankId?: string;
}

export interface BankAccount {
  id: string;
  iban?: string;
  bban?: string;
  currency: string;
  name?: string;
  product?: string;
  status?: string;
}

export interface Balance {
  amount: string;
  currency: string;
  balanceType?: string;
  referenceDate?: string;
}

export interface BankTransaction {
  transactionId: string;
  bookingDate?: string;
  valueDate?: string;
  amount: string;
  currency: string;
  creditDebitIndicator: string; // 'credit' or 'debit'
  // Debtor (who sent the money)
  debtorName?: string;
  debtorAccountIban?: string;
  debtorAccountBban?: string;
  debtorAgent?: string;
  debtorOrganisationId?: string;
  // Creditor (who received the money)
  creditorName?: string;
  creditorAccountIban?: string;
  creditorAccountBban?: string;
  creditorAgent?: string;
  creditorOrganisationId?: string;
  // Remittance / reference info
  remittanceInfo?: string;
  remittanceInfoStructured?: string;
  paymentReference?: string;
  referenceNumber?: string;
  referenceNumberSchema?: string;
  entryReference?: string;
  // Bank codes
  bankTransactionCode?: string;
  bankTransactionCodeDescription?: string;
  // Balance after transaction
  balanceAfterAmount?: string;
  balanceAfterCurrency?: string;
  // Other
  status?: string;
  transactionDate?: string;
  additionalInfo?: string;
  resourceId?: string;
  exchangeRate?: string;
  merchantCategoryCode?: string;
  note?: string;
  raw: Record<string, unknown>;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64url');
}

export class EnableBankingClient {
  private config: EnableBankingConfig;
  private sessionId: string | null = null;

  constructor(config: EnableBankingConfig) {
    this.config = config;
  }

  setSessionId(sid: string): void {
    this.sessionId = sid;
  }

  private generateJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', kid: this.config.appId, typ: 'JWT' };
    const payload = {
      iss: 'enablebanking.com',
      aud: 'api.enablebanking.com',
      iat: now,
      exp: now + 3600,
    };
    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(payload));
    const signingInput = `${headerB64}.${payloadB64}`;
    const sign = createSign('RSA-SHA256');
    sign.update(signingInput);
    const signature = sign.sign(this.config.privateKeyPem, 'base64url');
    return `${signingInput}.${signature}`;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.generateJwt()}`,
      'Content-Type': 'application/json',
    };
  }

  private sessionHeaders(): Record<string, string> {
    return { ...this.authHeaders(), 'X-Session-Id': this.sessionId! };
  }

  async listAspsps(country: string): Promise<ASPSP[]> {
    const resp = await fetch(`${API_BASE}/aspsps?country=${country}`, {
      headers: this.authHeaders(),
    });
    if (!resp.ok) throw new Error(`listAspsps failed: ${resp.status} ${await resp.text()}`);
    const data = await resp.json() as { aspsps?: any[] };
    return (data.aspsps ?? []).map((a) => ({
      name: a.name ?? '',
      country: a.country ?? '',
      bic: a.bic,
      bankId: a.id,
    }));
  }

  async startAuthorization(aspspName: string, country: string, redirectUrl?: string): Promise<{ authorizationUrl: string }> {
    const payload = {
      aspsp: { name: aspspName, country },
      redirect_url: redirectUrl ?? this.config.redirectUrl,
      psu_type: 'business',
      state: crypto.randomUUID(),
      access: {
        balances: true,
        transactions: true,
        available_accounts: 'all',
        valid_until: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, '.000000+00:00'),
      },
    };
    const resp = await fetch(`${API_BASE}/auth`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(`startAuthorization failed: ${resp.status} ${await resp.text()}`);
    const data = await resp.json() as { authorization_url?: string; url?: string };
    return { authorizationUrl: data.authorization_url ?? data.url ?? '' };
  }

  async createSession(code: string): Promise<{ sessionId: string; accounts: BankAccount[] }> {
    const resp = await fetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ code }),
    });
    if (!resp.ok) throw new Error(`createSession failed: ${resp.status} ${await resp.text()}`);
    const raw = await resp.text();
    console.log('[Banking] /sessions response:', raw.substring(0, 500));
    const data = JSON.parse(raw) as any;
    const sid = data.session_id;
    if (!sid) throw new Error('No session_id in response');
    this.sessionId = sid;
    const accounts: BankAccount[] = (data.accounts ?? []).map((a) => {
      if (typeof a === 'string') return { id: a, currency: '' };
      return {
        id: a.uid ?? a._id ?? a.id ?? '',
        iban: a.iban,
        bban: a.bban,
        currency: a.currency ?? '',
        name: a.name,
        product: a.product,
        status: a.status,
      };
    });
    return { sessionId: sid, accounts };
  }

  async listAccounts(): Promise<BankAccount[]> {
    if (!this.sessionId) throw new Error('No active session');
    const sessionResp = await fetch(`${API_BASE}/sessions/${this.sessionId}`, {
      headers: this.sessionHeaders(),
    });
    if (!sessionResp.ok) throw new Error(`listAccounts session fetch failed: ${sessionResp.status}`);
    const sessionData = await sessionResp.json() as { accounts?: any[] };
    const accounts: BankAccount[] = [];
    for (const acc of sessionData.accounts ?? []) {
      if (typeof acc === 'string') {
        // Fetch details for this account ID (like the Python client does)
        try {
          const detailResp = await fetch(`${API_BASE}/accounts/${acc}/details`, {
            headers: this.sessionHeaders(),
          });
          if (detailResp.ok) {
            const detail = await detailResp.json() as any;
            accounts.push({
              id: detail.uid ?? detail._id ?? detail.id ?? acc,
              iban: detail.iban ?? detail.account_id?.iban,
              bban: detail.bban ?? detail.account_id?.other?.identification,
              currency: detail.currency ?? detail.account_id?.currency ?? '',
              name: detail.name,
              product: detail.product,
              status: detail.status,
            });
          } else {
            accounts.push({ id: acc, currency: '' });
          }
        } catch {
          accounts.push({ id: acc, currency: '' });
        }
      } else {
        accounts.push({
          id: acc.uid ?? acc._id ?? acc.id ?? acc.account_id?.iban ?? '',
          iban: acc.iban ?? acc.account_id?.iban,
          bban: acc.bban ?? acc.account_id?.other?.identification,
          currency: acc.currency ?? '',
          name: acc.name,
          product: acc.product,
          status: acc.status,
        });
      }
    }
    return accounts;
  }

  async getAccountBalances(accountId: string): Promise<Balance[]> {
    if (!this.sessionId) throw new Error('No active session');
    const resp = await fetch(`${API_BASE}/accounts/${accountId}/balances`, {
      headers: this.sessionHeaders(),
    });
    if (!resp.ok) throw new Error(`getAccountBalances failed: ${resp.status} ${await resp.text()}`);
    const data = await resp.json() as { balances?: any[] };
    return (data.balances ?? []).map((b) => {
      const amt = b.balanceAmount ?? b.balance_amount ?? {};
      return {
        amount: amt.amount ?? '0',
        currency: amt.currency ?? '',
        balanceType: b.balanceType ?? b.balance_type,
        referenceDate: b.referenceDate ?? b.reference_date,
      };
    });
  }

  async getTransactions(
    accountId: string,
    dateFrom?: string,
    dateTo?: string,
    withDetails: boolean = true,
  ): Promise<BankTransaction[]> {
    if (!this.sessionId) throw new Error('No active session');
    const allTxns: BankTransaction[] = [];
    let continuationKey: string | null = null;

    do {
      const params = new URLSearchParams();
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (continuationKey) params.set('continuation_key', continuationKey);

      const resp = await fetch(
        `${API_BASE}/accounts/${accountId}/transactions?${params}`,
        { headers: this.sessionHeaders() },
      );
      if (!resp.ok) throw new Error(`getTransactions failed: ${resp.status} ${await resp.text()}`);
      const data = await resp.json() as { transactions?: any[]; continuation_key?: string };

      for (const t of data.transactions ?? []) {
        const txn = this.parseTransaction(t);
        // Enrich with transaction-details endpoint (debtor/creditor names, IBANs, bank codes)
        if (withDetails && txn.transactionId) {
          try {
            const detailResp = await fetch(
              `${API_BASE}/accounts/${accountId}/transactions/${txn.transactionId}`,
              { headers: this.sessionHeaders() },
            );
            if (detailResp.ok) {
              const detail = await detailResp.json() as any;
              // Merge detail fields into the parsed transaction (detail has richer data)
              const enriched = this.parseTransaction({ ...t, ...detail });
              allTxns.push(enriched);
              continue;
            }
          } catch {
            // Details fetch failed — use the list-only transaction
          }
        }
        allTxns.push(txn);
      }
      continuationKey = data.continuation_key ?? null;
    } while (continuationKey);

    return allTxns;
  }

  /**
   * Parse a transaction from the Enable Banking API response.
   * Handles both the transactions-list and transaction-details formats.
   * Ported from raiden-energy's Python Transaction.from_api().
   */
  private parseTransaction(t: any): BankTransaction {
    // Amount
    const txnAmount = t.transactionAmount ?? t.transaction_amount ?? {};
    const amount = typeof txnAmount === 'object' ? (txnAmount.amount ?? '0') : String(txnAmount || '0');
    const currency = typeof txnAmount === 'object' ? (txnAmount.currency ?? '') : (t.currency ?? '');

    // Remittance information (Jyske/Merkur use different fields)
    let unstructured = t.remittanceInformationUnstructured ?? t.remittance_information_unstructured ?? '';
    if (Array.isArray(unstructured)) unstructured = unstructured.join(' ');
    // Some banks use remittanceInformation (list)
    let ri = t.remittanceInformation ?? t.remittance_information ?? '';
    if (Array.isArray(ri)) ri = ri.join(' ');
    if (ri && !unstructured) unstructured = ri;

    let structured = t.remittanceInformationStructured ?? t.remittance_information_structured ?? '';
    if (Array.isArray(structured)) structured = structured.join(' ');

    // Debtor (API returns objects with a name field)
    const debtorObj = t.debtor && typeof t.debtor === 'object' ? t.debtor : {};
    const debtorAccount = t.debtorAccount && typeof t.debtorAccount === 'object' ? t.debtorAccount : (t.debtor_account && typeof t.debtor_account === 'object' ? t.debtor_account : {});
    const debtorOther = debtorAccount.other && typeof debtorAccount.other === 'object' ? debtorAccount.other : {};

    // Creditor
    const creditorObj = t.creditor && typeof t.creditor === 'object' ? t.creditor : {};
    const creditorAccount = t.creditorAccount && typeof t.creditorAccount === 'object' ? t.creditorAccount : (t.creditor_account && typeof t.creditor_account === 'object' ? t.creditor_account : {});
    const creditorOther = creditorAccount.other && typeof creditorAccount.other === 'object' ? creditorAccount.other : {};

    // Debtor/creditor agents (bank BIC codes)
    const debtorAgentObj = t.debtorAgent && typeof t.debtorAgent === 'object' ? t.debtorAgent : (t.debtor_agent && typeof t.debtor_agent === 'object' ? t.debtor_agent : {});
    const creditorAgentObj = t.creditorAgent && typeof t.creditorAgent === 'object' ? t.creditorAgent : (t.creditor_agent && typeof t.creditor_agent === 'object' ? t.creditor_agent : {});

    // Balance after transaction
    const balAfter = t.balanceAfterTransaction ?? t.balance_after_transaction ?? {};
    const balAfterObj = balAfter && typeof balAfter === 'object' ? balAfter : {};

    // Bank transaction code
    const btc = t.bankTransactionCode ?? t.bank_transaction_code ?? {};
    const btcObj = btc && typeof btc === 'object' ? btc : {};

    return {
      transactionId: t.transactionId ?? t.transaction_id ?? t._id ?? t.entryReference ?? t.entry_reference ?? '',
      bookingDate: t.bookingDate ?? t.booking_date ?? t.valueDate ?? t.value_date ?? t.transactionDate ?? t.transaction_date,
      valueDate: t.valueDate ?? t.value_date,
      amount,
      currency,
      creditDebitIndicator: t.creditDebitIndicator ?? t.credit_debit_indicator ?? (Number(amount) >= 0 ? 'credit' : 'debit'),
      // Debtor
      debtorName: debtorObj.name ?? t.debtorName ?? t.debtor_name,
      debtorAccountIban: debtorAccount.iban ?? t.debtor_account_iban,
      debtorAccountBban: debtorOther.identification ?? t.debtor_account_bban,
      debtorAgent: debtorAgentObj.bicFi ?? debtorAgentObj.bic_fi ?? t.debtor_agent,
      debtorOrganisationId: debtorObj.organisationId ?? debtorObj.organisation_id,
      // Creditor
      creditorName: creditorObj.name ?? t.creditorName ?? t.creditor_name,
      creditorAccountIban: creditorAccount.iban ?? t.creditor_account_iban,
      creditorAccountBban: creditorOther.identification ?? t.creditor_account_bban,
      creditorAgent: creditorAgentObj.bicFi ?? creditorAgentObj.bic_fi ?? t.creditor_agent,
      creditorOrganisationId: creditorObj.organisationId ?? creditorObj.organisation_id,
      // Remittance
      remittanceInfo: unstructured,
      remittanceInfoStructured: structured,
      paymentReference: t.paymentReference ?? t.payment_reference,
      referenceNumber: t.referenceNumber ?? t.reference_number,
      referenceNumberSchema: t.referenceNumberSchema ?? t.reference_number_schema,
      entryReference: t.entryReference ?? t.entry_reference,
      // Bank codes
      bankTransactionCode: btcObj.code ?? t.bank_transaction_code,
      bankTransactionCodeDescription: btcObj.description,
      // Balance after
      balanceAfterAmount: balAfterObj.amount ?? t.balance_after_amount,
      balanceAfterCurrency: balAfterObj.currency ?? t.balance_after_currency,
      // Other
      status: t.status,
      transactionDate: t.transactionDate ?? t.transaction_date,
      additionalInfo: t.additionalInformation ?? t.additional_information,
      resourceId: t.resourceId ?? t.resource_id,
      exchangeRate: typeof t.exchangeRate === 'object' ? JSON.stringify(t.exchangeRate) : (t.exchange_rate ?? ''),
      merchantCategoryCode: t.merchantCategoryCode ?? t.merchant_category_code,
      note: t.note,
      raw: t,
    };
  }
}