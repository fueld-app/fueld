// ═══════════════════════════════════════════════════════════════════════
//  Lloyd's List Intelligence — HTTP Client
//  Auto-refreshes the auth token every 24 hours.
// ═══════════════════════════════════════════════════════════════════════

const LLI_BASE = 'https://api.lloydslistintelligence.com/v1';

interface TokenState {
  token: string;
  expiresAt: number; // epoch ms
}

let tokenState: TokenState | null = null;

// ── Config ───────────────────────────────────────────────────────────

function getCredentials() {
  const username = process.env['LLI_USERNAME'];
  const password = process.env['LLI_PASSWORD'];
  if (!username || !password) {
    throw new Error('LLI_USERNAME and LLI_PASSWORD must be set in .env');
  }
  return { username, password };
}

// ── Token Management ─────────────────────────────────────────────────

async function fetchToken(): Promise<string> {
  const { username, password } = getCredentials();

  const res = await fetch(`${LLI_BASE}/tokenprovider`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    throw new Error(`LLI token request failed: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as { Message: string; Payload: string };

  if (body.Message !== 'Success' || !body.Payload) {
    throw new Error(`LLI token response invalid: ${JSON.stringify(body)}`);
  }

  return body.Payload;
}

/**
 * Returns a valid LLI auth token.
 * Tokens officially last 30 days, but we refresh every 24 hours as requested.
 */
async function getToken(): Promise<string> {
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  if (tokenState && Date.now() < tokenState.expiresAt) {
    return tokenState.token;
  }

  console.log('[LLI] Refreshing auth token…');
  const token = await fetchToken();
  tokenState = {
    token,
    expiresAt: Date.now() + TWENTY_FOUR_HOURS,
  };
  console.log('[LLI] Token refreshed, valid for 24h.');
  return token;
}

// ── Generic GET helper ───────────────────────────────────────────────

export async function lliGet<T = unknown>(
  endpoint: string,
  params: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const token = await getToken();

  // Build query string, omitting undefined values
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      qs.set(key, String(value));
    }
  }

  const url = `${LLI_BASE}/${endpoint}?${qs.toString()}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: token },
  });

  if (res.status === 401) {
    // Token expired — force refresh and retry once
    console.log('[LLI] 401 received, forcing token refresh…');
    tokenState = null;
    const freshToken = await getToken();
    const retry = await fetch(url, {
      method: 'GET',
      headers: { Authorization: freshToken },
    });
    if (!retry.ok) {
      throw new Error(`LLI ${endpoint} failed after retry: ${retry.status}`);
    }
    return (await retry.json()) as T;
  }

  if (!res.ok) {
    throw new Error(`LLI ${endpoint} failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}
