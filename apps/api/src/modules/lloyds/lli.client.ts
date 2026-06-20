// ═══════════════════════════════════════════════════════════════════════
//  Lloyd's List Intelligence — HTTP Client
//  Auto-refreshes the auth token every 24 hours.
//  Credentials: DB (encrypted) first, then falls back to env vars.
// ═══════════════════════════════════════════════════════════════════════

import { getLLICredentialsFromDB, registerTokenCacheClear } from '../admin/integrations.service';

const LLI_BASE = 'https://api.lloydslistintelligence.com/v1';

interface TokenState {
  token: string;
  expiresAt: number; // epoch ms
}

let tokenState: TokenState | null = null;

// Register cache-clear callback so integrations.service can invalidate on credential update
registerTokenCacheClear(() => {
  tokenState = null;
});

// ── Config ───────────────────────────────────────────────────────────

/**
 * Check whether LLI/Seasearcher credentials are available.
 * Use this before calling any LLI API to guard UI features.
 */
export async function isLLIConfigured(): Promise<boolean> {
  const dbCreds = await getLLICredentialsFromDB();
  if (dbCreds) return true;
  // ENV fallback only for local/testing
  return !!(process.env['LLI_USERNAME'] && process.env['LLI_PASSWORD']);
}

async function getCredentials(): Promise<{ username: string; password: string }> {
  // 1. Primary: DB credentials (set via Admin → Integrations)
  const dbCreds = await getLLICredentialsFromDB();
  if (dbCreds) return dbCreds;

  // 2. Fallback: env vars (local development / testing only)
  const username = process.env['LLI_USERNAME'];
  const password = process.env['LLI_PASSWORD'];
  if (username && password) {
    console.warn('[LLI] Using env-var credentials (testing fallback). Configure in Admin → Integrations for production.');
    return { username, password };
  }

  throw new Error('LLI credentials not configured. Set them in Admin → Integrations.');
}

// ── Token Management ─────────────────────────────────────────────────

async function fetchToken(): Promise<string> {
  const { username, password } = await getCredentials();

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
    // Avoid leaking the raw upstream response body into the API error response;
    // log it server-side for debugging and surface only the status message.
    console.error('[LLI] token response invalid:', body);
    throw new Error(`LLI token response invalid: ${body.Message || 'unexpected response'}`);
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

// ── Seasearcher Place Search ──────────────────────────────────────────

const SEASEARCHER_BASE = 'https://www.seasearcher.com/api';

export async function seasearcherPlaceSearch<T = unknown>(
  searchPhrase: string,
  pageSize = 10,
): Promise<T> {
  const token = await getToken();

  const query = JSON.stringify({
    SearchPhrase: searchPhrase,
    SearchFields: { placeName: 1 },
    PageSize: pageSize,
  });

  const url = `${SEASEARCHER_BASE}/place/query?query=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    console.log('[Seasearcher] 401 received, forcing token refresh…');
    tokenState = null;
    const freshToken = await getToken();
    const retry = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    if (!retry.ok) {
      throw new Error(`Seasearcher place search failed after retry: ${retry.status}`);
    }
    return (await retry.json()) as T;
  }

  if (!res.ok) {
    throw new Error(`Seasearcher place search failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

/**
 * Fetch full place details from Seasearcher by place ID.
 * GET https://www.seasearcher.com/api/place/{id}
 */
export async function seasearcherPlaceDetail<T = unknown>(placeId: string): Promise<T> {
  const token = await getToken();
  const url = `${SEASEARCHER_BASE}/place/${placeId}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    console.log('[Seasearcher] 401 on detail, forcing token refresh…');
    tokenState = null;
    const freshToken = await getToken();
    const retry = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    if (!retry.ok) {
      throw new Error(`Seasearcher place detail failed after retry: ${retry.status}`);
    }
    return (await retry.json()) as T;
  }

  if (!res.ok) {
    throw new Error(`Seasearcher place detail failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

/**
 * Fetch vessels near a port from Seasearcher.
 * GET https://www.seasearcher.com/api/vessel/nearPort/query?query=...
 */
/**
 * Fetch port facilities from Seasearcher.
 * GET https://www.seasearcher.com/api/place/{id}/port-facilities
 */
export async function seasearcherPortFacilities<T = unknown>(placeId: string): Promise<T> {
  const token = await getToken();
  const url = `${SEASEARCHER_BASE}/place/${placeId}/port-facilities`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    console.log('[Seasearcher] 401 on port-facilities, forcing token refresh…');
    tokenState = null;
    const freshToken = await getToken();
    const retry = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    if (!retry.ok) {
      throw new Error(`Seasearcher port-facilities failed after retry: ${retry.status}`);
    }
    return (await retry.json()) as T;
  }

  if (!res.ok) {
    throw new Error(`Seasearcher port-facilities failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

export async function seasearcherNearbyVessels<T = unknown>(
  placeId: string,
  distance = 10,
  pageSize = 1000,
): Promise<T> {
  const token = await getToken();

  const query = JSON.stringify({
    PageNumber: 0,
    PageSize: pageSize,
    Filters: {
      distance,
      statuses: ['L'],
      placeId,
      classbIndicator: null,
    },
    SortFields: { distance: 1 },
    ReturnFields: null,
    HighlightFields: null,
  });

  const url = `${SEASEARCHER_BASE}/vessel/nearPort/query?query=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    console.log('[Seasearcher] 401 on nearPort/query, forcing token refresh…');
    tokenState = null;
    const freshToken = await getToken();
    const retry = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    if (!retry.ok) {
      throw new Error(`Seasearcher nearPort/query failed after retry: ${retry.status}`);
    }
    return (await retry.json()) as T;
  }

  if (!res.ok) {
    throw new Error(`Seasearcher nearPort/query failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

/**
 * Spatial query for position updates only — lighter response with lat/lng/heading/speed.
 * Used for periodic polling to update vessel positions.
 */
export async function seasearcherNearbyVesselsSpatial<T = unknown>(
  placeId: string,
  distance = 10,
  pageSize = 1000,
): Promise<T> {
  const token = await getToken();

  const clusteringRequirement = JSON.stringify({
    topLeftLat: 90,
    topLeftLon: -180,
    bottomRightLat: -90,
    bottomRightLon: 180,
    geoHashPrecision: 4,
    clusteringThreshold: 10000,
    numberOfRelevantDocumentDetailsPerCluster: 10,
    positionAgeInMinutes: null,
  });

  const query = JSON.stringify({
    PageNumber: 0,
    PageSize: pageSize,
    Filters: {
      distance,
      statuses: ['L'],
      placeId,
      classbIndicator: null,
    },
    SortFields: { distance: 1 },
    ReturnFields: null,
    HighlightFields: null,
  });

  const url = `${SEASEARCHER_BASE}/vessel/nearPort/spatialquery?clusteringRequirement=${encodeURIComponent(clusteringRequirement)}&query=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    console.log('[Seasearcher] 401 on nearPort/spatialquery, forcing token refresh…');
    tokenState = null;
    const freshToken = await getToken();
    const retry = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    if (!retry.ok) {
      throw new Error(`Seasearcher nearPort/spatialquery failed after retry: ${retry.status}`);
    }
    return (await retry.json()) as T;
  }

  if (!res.ok) {
    throw new Error(`Seasearcher nearPort/spatialquery failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

// ── Seasearcher Company Detail ────────────────────────────────────────

/**
 * Fetch full company details from Seasearcher by company ID.
 * GET https://www.seasearcher.com/api/company/{id}
 */
export async function seasearcherCompanyDetail<T = unknown>(companyId: string): Promise<T> {
  const token = await getToken();
  const url = `${SEASEARCHER_BASE}/company/${companyId}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    console.log('[Seasearcher] 401 on company detail, forcing token refresh…');
    tokenState = null;
    const freshToken = await getToken();
    const retry = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    if (!retry.ok) {
      throw new Error(`Seasearcher company detail failed after retry: ${retry.status}`);
    }
    return (await retry.json()) as T;
  }

  if (!res.ok) {
    throw new Error(`Seasearcher company detail failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

/**
 * Search companies on Seasearcher.
 * GET https://www.seasearcher.com/api/company/query?query=...
 */
export async function seasearcherCompanySearch<T = unknown>(
  searchPhrase: string,
  pageSize = 10,
): Promise<T> {
  const token = await getToken();

  const queryObj: Record<string, unknown> = {
    SearchPhrase: searchPhrase,
    SearchFields: { companyName: 1, companyImo: 1 },
    PageSize: pageSize,
  };

  const query = JSON.stringify(queryObj);

  const url = `${SEASEARCHER_BASE}/company/query?query=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    console.log('[Seasearcher] 401 on company search, forcing token refresh…');
    tokenState = null;
    const freshToken = await getToken();
    const retry = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    if (!retry.ok) {
      throw new Error(`Seasearcher company search failed after retry: ${retry.status}`);
    }
    return (await retry.json()) as T;
  }

  if (!res.ok) {
    throw new Error(`Seasearcher company search failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

// ── Seasearcher Company Fleet ─────────────────────────────────────────

/**
 * Fetch company fleet from Seasearcher.
 * GET https://www.seasearcher.com/api/company/{id}/fleet?query=...
 */
export async function seasearcherCompanyFleet<T = unknown>(
  companyId: string,
  pageSize = 50,
): Promise<T> {
  const token = await getToken();

  const query = JSON.stringify({
    PageNumber: 0,
    PageSize: pageSize,
    Filters: {
      companyOwnershipPeriod: 'Current',
      riskPeriodInMonths: 12,
      companyOwnershipTypes: ['BO', 'CO', 'IM', 'NO', 'RO', 'TM', 'TP'],
      fleetCompanyId: companyId,
    },
    SortFields: {},
    SearchFields: { vesselName: 1, imo: 1 },
    ReturnFields: null,
    HighlightFields: null,
  });

  const url = `${SEASEARCHER_BASE}/company/${companyId}/fleet?query=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    console.log('[Seasearcher] 401 on company fleet, forcing token refresh…');
    tokenState = null;
    const freshToken = await getToken();
    const retry = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    if (!retry.ok) {
      throw new Error(`Seasearcher company fleet failed after retry: ${retry.status}`);
    }
    return (await retry.json()) as T;
  }

  if (!res.ok) {
    throw new Error(`Seasearcher company fleet failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

// ── Seasearcher Company Hierarchy ─────────────────────────────────────

/**
 * Fetch company ownership hierarchy from Seasearcher.
 * GET https://www.seasearcher.com/api/company/{id}/hierarchy
 */
export async function seasearcherCompanyHierarchy<T = unknown>(companyId: string): Promise<T> {
  const token = await getToken();
  const url = `${SEASEARCHER_BASE}/company/${companyId}/hierarchy`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    console.log('[Seasearcher] 401 on company hierarchy, forcing token refresh…');
    tokenState = null;
    const freshToken = await getToken();
    const retry = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    if (!retry.ok) {
      throw new Error(`Seasearcher company hierarchy failed after retry: ${retry.status}`);
    }
    return (await retry.json()) as T;
  }

  if (!res.ok) {
    throw new Error(`Seasearcher company hierarchy failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

// ── Seasearcher Company Seizures ──────────────────────────────────────

/**
 * Fetch company seizures/arrests from Seasearcher.
 * GET https://www.seasearcher.com/api/company/{id}/seizures?query=...
 */
export async function seasearcherCompanySeizures<T = unknown>(
  companyId: string,
  pageSize = 40,
): Promise<T> {
  const token = await getToken();

  const query = JSON.stringify({
    PageNumber: 0,
    PageSize: pageSize,
    SortFields: { vesselName: 1 },
    Filters: { ownershipRoles: ['BO', 'CO', 'IM', 'NO', 'RO', 'TM', 'TP'] },
    SearchFields: {},
  });

  const url = `${SEASEARCHER_BASE}/company/${companyId}/seizures?query=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    console.log('[Seasearcher] 401 on company seizures, forcing token refresh…');
    tokenState = null;
    const freshToken = await getToken();
    const retry = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    if (!retry.ok) {
      throw new Error(`Seasearcher company seizures failed after retry: ${retry.status}`);
    }
    return (await retry.json()) as T;
  }

  if (!res.ok) {
    throw new Error(`Seasearcher company seizures failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

// ── Seasearcher Company Sanctions ─────────────────────────────────────

/**
 * Fetch company sanctions from Seasearcher.
 * GET https://www.seasearcher.com/api/company/{id}/sanctions
 */
export async function seasearcherCompanySanctions<T = unknown>(companyId: string): Promise<T> {
  const token = await getToken();
  const url = `${SEASEARCHER_BASE}/company/${companyId}/sanctions`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    console.log('[Seasearcher] 401 on company sanctions, forcing token refresh…');
    tokenState = null;
    const freshToken = await getToken();
    const retry = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    if (!retry.ok) {
      throw new Error(`Seasearcher company sanctions failed after retry: ${retry.status}`);
    }
    return (await retry.json()) as T;
  }

  if (!res.ok) {
    throw new Error(`Seasearcher company sanctions failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

// ── Seasearcher Vessel Search ─────────────────────────────────────────

/**
 * Search vessels on Seasearcher.
 * GET https://www.seasearcher.com/api/vessel/query?query=...
 */
export async function seasearcherVesselSearch<T = unknown>(
  searchPhrase: string,
  pageSize = 5,
): Promise<T> {
  const token = await getToken();

  const query = JSON.stringify({
    SearchPhrase: searchPhrase,
    SearchFields: { vesselName: 1, imo: 1, llpno: 1, mmsi: 1 },
    PageSize: pageSize,
  });

  const url = `${SEASEARCHER_BASE}/vessel/query?query=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    console.log('[Seasearcher] 401 on vessel search, forcing token refresh…');
    tokenState = null;
    const freshToken = await getToken();
    const retry = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    if (!retry.ok) {
      throw new Error(`Seasearcher vessel search failed after retry: ${retry.status}`);
    }
    return (await retry.json()) as T;
  }

  if (!res.ok) {
    throw new Error(`Seasearcher vessel search failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

// ── Seasearcher Vessel Detail ─────────────────────────────────────────

/**
 * Fetch full vessel details from Seasearcher by vessel ID.
 * GET https://www.seasearcher.com/api/vessel/{id}
 */
export async function seasearcherVesselDetail<T = unknown>(vesselId: string): Promise<T> {
  const token = await getToken();
  const url = `${SEASEARCHER_BASE}/vessel/${vesselId}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    console.log('[Seasearcher] 401 on vessel detail, forcing token refresh…');
    tokenState = null;
    const freshToken = await getToken();
    const retry = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    if (!retry.ok) {
      throw new Error(`Seasearcher vessel detail failed after retry: ${retry.status}`);
    }
    return (await retry.json()) as T;
  }

  if (!res.ok) {
    throw new Error(`Seasearcher vessel detail failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

// ── Seasearcher Vessel Movements (Port Calls) ─────────────────────────

/**
 * Fetch vessel port calls / movements from Seasearcher.
 * POST https://www.seasearcher.com/api/vessel/ports?query=...
 */
export async function seasearcherVesselMovements<T = unknown>(
  vesselId: string,
  pageSize = 100,
): Promise<T> {
  const token = await getToken();

  // Date range: last 10 years to now
  const now = new Date();
  const tenYearsAgo = new Date();
  tenYearsAgo.setFullYear(now.getFullYear() - 10);

  const query = JSON.stringify({
    PageNumber: 0,
    PageSize: pageSize,
    Filters: {
      showCallings: true,
      showSightings: false,
      showPassings: false,
      countryIds: [],
      placeIds: [],
      vesselIds: [vesselId],
      dateRange: {
        from: tenYearsAgo.toISOString(),
        to: now.toISOString(),
      },
    },
  });

  const url = `${SEASEARCHER_BASE}/vessel/ports?query=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    console.log('[Seasearcher] 401 on vessel movements, forcing token refresh…');
    tokenState = null;
    const freshToken = await getToken();
    const retry = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    if (!retry.ok) {
      throw new Error(`Seasearcher vessel movements failed after retry: ${retry.status}`);
    }
    return (await retry.json()) as T;
  }

  if (!res.ok) {
    throw new Error(`Seasearcher vessel movements failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

// ── Seasearcher Expected Arrivals ─────────────────────────────────────

/**
 * Fetch vessels destined for a place from Seasearcher.
 * GET https://www.seasearcher.com/api/vessel/destinedfor/query?query=...
 */
export async function seasearcherExpectedArrivals<T = unknown>(
  placeId: string,
  daysAhead = 7,
  pageSize = 1000,
): Promise<T> {
  const token = await getToken();

  const now = new Date();
  const to = new Date(now);
  to.setDate(to.getDate() + daysAhead);
  to.setHours(23, 59, 59, 999);

  const query = JSON.stringify({
    PageNumber: 0,
    PageSize: pageSize,
    Filters: {
      dateRange: {
        from: now.toISOString(),
        to: to.toISOString(),
      },
      placeIds: [placeId],
    },
    SortFields: { eta: -1 },
    ReturnFields: null,
    HighlightFields: null,
  });

  const url = `${SEASEARCHER_BASE}/vessel/destinedfor/query?query=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    console.log('[Seasearcher] 401 on destinedfor, forcing token refresh…');
    tokenState = null;
    const freshToken = await getToken();
    const retry = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    if (!retry.ok) {
      throw new Error(`Seasearcher destinedfor failed after retry: ${retry.status}`);
    }
    return (await retry.json()) as T;
  }

  if (!res.ok) {
    throw new Error(`Seasearcher destinedfor failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}