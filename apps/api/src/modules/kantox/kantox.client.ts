// ═══════════════════════════════════════════════════════════════════════
//  Kantox API client (Dynamic Hedging)
//
//  Every behaviour below is verified live against the preprod sandbox
//  (2026-09-17, see docs/kantox-meeting-prep-2026-09-17.md §1):
//   - login: POST {base}/login with {"login": …, "password": …} — NOT
//     user/email (that fails with "account not found"). Token is a bearer
//     UUID, expires_in 600s, scope ["api"].
//   - header: `X_AUTH_TOKEN: <raw token>` — a "Bearer " prefix REJECTED.
//   - endpoint paths are company-scoped: /companies/{companyRef}/… — the
//     deck's bare `dynamic_hedging/entry` path 404s. Both /entry and
//     /request_entry accept payloads; we ship /entry (deck-canonical).
//   - request bodies are snake_case; market_direction is lowercase
//     ("sell"/"buy") — the deck's "Sell" is rejected.
//   - errors arrive as a JSON envelope {"status":"error","reason":N,
//     "errorDetails":"…"} at HTTP 200/401/403 — NEVER trust the HTTP
//     status; always check the envelope.
//   - entryRef (external_ref) dedup is ON: resending an existing ref is
//     rejected even with a different payload. A 10%-rejection does NOT
//     persist, so the ref is reusable after a validation rejection.
//   - value_date format YYYY-MM-DD; past dates rejected; weekend dates
//     accepted and rolled to the next business day.
//   - position/entries reads lag ~1–2 min behind writes (batch recalc).
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_BASE_URL = 'https://kantox-preprod.com/api';
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface KantoxClientConfig {
  apiBaseUrl: string;
  apiUser: string;
  apiPassword: string;
  companyRef: string;
  fetchImpl?: typeof fetch;
  /** Injectable clock for token-cache tests. */
  now?: () => number;
}

export interface KantoxEntryPayload {
  companyRef: string;
  entryRef: string;
  marketDirection: 'sell' | 'buy';
  currency: string;            // 'USD'
  counterCurrency: string;     // 'EUR'
  amount: string | number;     // positive = exposure; negative = cancel/delta
  entryDate?: string;          // DD/MM/YYYY or ISO — date of the firm commitment
  valueDate?: string;          // YYYY-MM-DD — mandatory in practice; MUST repeat
                               // the original's (post-roll) date on cancels/deltas
  entryRate?: string;          // booking rate at deal creation
  entryRatePair?: string;      // 'EURUSD' — required when entryRate is set
  notes?: string;
}

export interface KantoxEntry {
  reference: string;                 // Kantox entry id (E-XXX)
  entryRef: string;                  // our external_ref
  currency: string;
  counterCurrency: string;
  amount: number;
  amountAfterCancellations: number;
  marketDirection: string;
  entryDate: string | null;
  valueDate: string | null;          // DD/MM/YYYY in responses
  entryStatus: string;               // observed: 'in_position'
  positionRef: string;               // PS-XXX — key for the position endpoint
  rate: number;
  ratePair: string;
  counterValue: number | null;
  executionRate: number | null;
  hedgedRate: number | null;
  hedgedRatePair: string | null;
  deltaResult: number | null;
  cancellationRatePercent: number | null;
  notes: string | null;
  createdTimeStamp: string | null;
}

export interface KantoxPosition {
  reference: string;
  currency: string;
  counterCurrency: string;
  marketDirection: string;
  amount: number;                    // net exposure for the bucket
  weightedAverageRate: number | null;
  ratePair: string | null;
  positionStatus: string;            // observed: 'accumulating' | 'recalculating_batch'
  amountToTriggerCo: string | null;  // e.g. "5000.00 USD"
  valueDate: string | null;
  executionRate: number | null;
  hedgedRate: number | null;
  entries: KantoxEntry[];
}

export class KantoxApiError extends Error {
  readonly reason: number;
  readonly httpStatus: number;
  constructor(reason: number, errorDetails: string, httpStatus: number) {
    super(`Kantox API error (reason ${reason}): ${errorDetails}`);
    this.name = 'KantoxApiError';
    this.reason = reason;
    this.httpStatus = httpStatus;
  }
}

/** The ref already exists on Kantox — the entry (or a prior attempt) is there. */
export class KantoxDuplicateRefError extends KantoxApiError {
  readonly entryRef: string;
  constructor(entryRef: string, reason: number, errorDetails: string, httpStatus: number) {
    super(reason, errorDetails, httpStatus);
    this.name = 'KantoxDuplicateRefError';
    this.entryRef = entryRef;
  }
}

/** 10% entry-rate rejection. The ref is NOT persisted — safe to retry with
 *  a corrected rate under the same ref (verified live). */
export class KantoxRateRejectionError extends KantoxApiError {
  constructor(errorDetails: string, httpStatus: number) {
    super(2, errorDetails, httpStatus);
    this.name = 'KantoxRateRejectionError';
  }
}

interface TokenState {
  token: string | null;
  expiresAtMs: number;
}

export class KantoxClient {
  private readonly cfg: Required<Pick<KantoxClientConfig, 'apiBaseUrl' | 'apiUser' | 'companyRef'>> &
    KantoxClientConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private token: string | null = null;
  private tokenExpiresAtMs = 0;


  constructor(config: KantoxClientConfig) {
    this.cfg = config;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.now = config.now ?? Date.now;
  }

  // ── auth ────────────────────────────────────────────────────────────

  /** Cached login. Token is valid 10 min; we re-login 60s early. */
  async getToken(): Promise<string> {
    if (this.token && this.now() < this.tokenExpiresAtMs) {
      return this.token;
    }
    const resp = await this.fetchImpl(`${this.cfg.apiBaseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: this.cfg.apiUser, password: this.cfg.apiPassword }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    const body = await resp.json().catch(() => null);
    if (!resp.ok || !body || body.status !== 'success' || !body.token) {
      const details = body?.errorDetails ?? `HTTP ${resp.status}`;
      throw new KantoxApiError(body?.reason ?? -1, `login failed: ${details}`, resp.status);
    }
    this.token = body.token as string;
    this.tokenExpiresAtMs = this.now() + (Number(body.expires_in) || 600) * 1000 - TOKEN_EXPIRY_MARGIN_MS;
    return this.token;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    opts: { timeoutMs?: number; retriedAuth?: boolean } = {},
  ): Promise<T> {
    const token = await this.getToken();
    const resp = await this.fetchImpl(`${this.cfg.apiBaseUrl}${path}`, {
      method,
      headers: {
        'X_AUTH_TOKEN': token,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    const text = await resp.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    // Token expiry mid-session → re-login once and retry (K-P1-6).
    if (parsed && typeof parsed === 'object' && parsed.status === 'error' &&
        /invalid token|unauthorized/i.test(String(parsed.errorDetails ?? '')) && !opts.retriedAuth) {
      this.token = null;
      return this.request(method, path, body, { ...opts, retriedAuth: true });
    }

    if (parsed && typeof parsed === 'object' && parsed.status === 'error') {
      const reason = Number(parsed.reason ?? -1);
      const details = String(parsed.errorDetails ?? 'unknown error');
      if (/already has an entry with the same external_ref/i.test(details)) {
        throw new KantoxDuplicateRefError(String(body?.entry_ref ?? ''), reason, details, resp.status);
      }
      if (/more than 10% away from the spot rate/i.test(details)) {
        throw new KantoxRateRejectionError(details, resp.status);
      }
      throw new KantoxApiError(reason, details, resp.status);
    }

    if (!resp.ok) {
      throw new KantoxApiError(-1, `HTTP ${resp.status}: ${text.slice(0, 300)}`, resp.status);
    }
    return parsed as T;
  }

  // ── operations ──────────────────────────────────────────────────────

  /** Submit one exposure entry. Returns the created entry. */
  async submitEntry(payload: KantoxEntryPayload): Promise<KantoxEntry> {
    const body = {
      company_ref: payload.companyRef,
      entry_ref: payload.entryRef,
      market_direction: payload.marketDirection,
      currency: payload.currency,
      counter_currency: payload.counterCurrency,
      amount: String(payload.amount),
      ...(payload.entryDate ? { entry_date: payload.entryDate } : {}),
      ...(payload.valueDate ? { value_date: payload.valueDate } : {}),
      ...(payload.entryRate ? { entry_rate: String(payload.entryRate), entry_rate_pair: payload.entryRatePair ?? 'EURUSD' } : {}),
      ...(payload.notes ? { notes: payload.notes } : {}),
    };
    const resp = await this.request<any>('POST', `/companies/${this.cfg.companyRef}/dynamic_hedging/entry`, body);
    return normalizeEntry(resp);
  }

  /** All entries for the company (per-entry status/rates). */
  async listEntries(): Promise<KantoxEntry[]> {
    const resp = await this.request<any[]>('GET', `/companies/${this.cfg.companyRef}/dynamic_hedging/entries`);
    return (resp ?? []).map(normalizeEntry);
  }

  /** All positions (netted per value-date bucket). */
  async listPositions(): Promise<KantoxPosition[]> {
    return this.request<KantoxPosition[]>('GET', `/companies/${this.cfg.companyRef}/dynamic_hedging/positions`);
  }

  async getPosition(positionRef: string): Promise<KantoxPosition> {
    return this.request<KantoxPosition>(
      'GET',
      `/companies/${this.cfg.companyRef}/dynamic_hedging/position?position_ref=${encodeURIComponent(positionRef)}`,
    );
  }

  /** Connectivity check for the admin "test connection" button. */
  async testConnection(): Promise<{ ok: true; companyRef: string }> {
    await this.listEntries(); // cheapest authenticated roundtrip; returns [] on success
    return { ok: true, companyRef: this.cfg.companyRef };
  }
}

// ── helpers ───────────────────────────────────────────────────────────

/** Responses carry camelCase; requests snake_case (verified live). */
function normalizeEntry(raw: any): KantoxEntry {
  return {
    reference: raw.reference,
    entryRef: raw.entryRef,
    currency: raw.currency,
    counterCurrency: raw.counterCurrency,
    amount: Number(raw.amount ?? 0),
    amountAfterCancellations: Number(raw.amountAfterCancellations ?? 0),
    marketDirection: String(raw.marketDirection ?? '').toLowerCase(),
    entryDate: raw.entryDate ?? null,
    valueDate: raw.valueDate ?? null,
    entryStatus: raw.entryStatus ?? null,
    positionRef: raw.positionRef ?? null,
    rate: Number(raw.rate ?? 0),
    ratePair: raw.ratePair ?? null,
    cancellationRatePercent: raw.cancellationRatePercent != null ? Number(raw.cancellationRatePercent) : null,
    counterValue: raw.counterValue != null ? Number(raw.counterValue) : null,
    executionRate: raw.executionRate != null ? Number(raw.executionRate) : null,
    hedgedRate: raw.hedgedRate != null ? Number(raw.hedgedRate) : null,
    hedgedRatePair: raw.hedgedRatePair ?? null,
    deltaResult: raw.deltaResult != null ? Number(raw.deltaResult) : null,
    notes: raw.notes ?? null,
    createdTimeStamp: raw.createdTimeStamp ?? null,
  };
}
