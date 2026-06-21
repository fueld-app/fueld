// ═══════════════════════════════════════════════════════════════════════
//  GeoIP — IP address to location resolution via HTTP API
//
//  Uses ip-api.com (free, 45 req/min) with in-memory caching.
//  Falls back gracefully — geo info is never blocking.
// ═══════════════════════════════════════════════════════════════════════

export interface GeoInfo {
  country: string | null;
  city: string | null;
}

const EMPTY: GeoInfo = { country: null, city: null };

// ─── Cache (IP → GeoInfo, TTL 24h) ──────────────────────────────────

const cache = new Map<string, { geo: GeoInfo; ts: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
let testFetchImpl: typeof fetch | null = null;

function getCached(ip: string): GeoInfo | null {
  const entry = cache.get(ip);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(ip);
    return null;
  }
  return entry.geo;
}

function setCache(ip: string, geo: GeoInfo): void {
  // Evict old entries if cache grows too large
  if (cache.size > 10_000) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(ip, { geo, ts: Date.now() });
}

// ─── IP normalisation ────────────────────────────────────────────────

function normalizeIp(input: string): string {
  let normalized = input.trim();

  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.slice(7);
  }

  // Strip IPv6 brackets + port, e.g. "[2001:db8::1]:443"
  if (normalized.startsWith('[')) {
    const end = normalized.indexOf(']');
    if (end !== -1) {
      normalized = normalized.slice(1, end);
    }
    return normalized;
  }

  // Strip port for IPv4, e.g. "203.0.113.5:52314"
  const lastColon = normalized.lastIndexOf(':');
  if (lastColon > -1 && normalized.indexOf(':') === lastColon) {
    const port = normalized.slice(lastColon + 1);
    if (/^\d+$/.test(port)) {
      normalized = normalized.slice(0, lastColon);
    }
  }

  return normalized;
}

function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip === '127.0.0.1') return true;

  const octets = ip.split('.').map((o) => Number(o));
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
    return false;
  }

  return (
    octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 169 && octets[1] === 254)
  );
}

// ─── HTTP lookup ─────────────────────────────────────────────────────

/**
 * Async IP geolocation lookup via ip-api.com.
 * Results are cached for 24 hours. Returns EMPTY for private/loopback IPs.
 */
export async function lookupIp(ip: string | null): Promise<GeoInfo> {
  if (!ip) return EMPTY;

  const normalized = normalizeIp(ip);
  if (isPrivateIp(normalized)) return EMPTY;
  // Only request ip-api for well-formed IPs. A malicious X-Forwarded-For value
  // could otherwise inject path/control characters into the request URL.
  if (!/^[0-9a-fA-F:.]+$/.test(normalized)) return EMPTY;

  // Check cache first
  const cached = getCached(normalized);
  if (cached) return cached;

  try {
    const fetchImpl = testFetchImpl ?? fetch;
    const res = await fetchImpl(
      `http://ip-api.com/json/${normalized}?fields=status,country,countryCode,city`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return EMPTY;

    const data = await res.json() as { status: string; countryCode?: string; city?: string };
    if (data.status !== 'success') {
      setCache(normalized, EMPTY);
      return EMPTY;
    }

    const geo: GeoInfo = {
      country: data.countryCode ?? null,
      city: data.city || null,
    };
    setCache(normalized, geo);
    return geo;
  } catch {
    // Network/timeout — don't cache failures
    return EMPTY;
  }
}

/**
 * Synchronous version — returns cached result or EMPTY.
 * Kicks off an async lookup in the background if not cached.
 */
export function lookupIpSync(ip: string | null): GeoInfo {
  if (!ip) return EMPTY;

  const normalized = normalizeIp(ip);
  if (isPrivateIp(normalized)) return EMPTY;

  const cached = getCached(normalized);
  if (cached) return cached;

  // Fire-and-forget background lookup (will be cached for next time)
  lookupIp(ip).catch(() => {});
  return EMPTY;
}

export const __geoipTestUtils = {
  clearCache(): void {
    cache.clear();
  },
  setFetchImpl(fetchImpl: typeof fetch): void {
    testFetchImpl = fetchImpl;
  },
  resetFetchImpl(): void {
    testFetchImpl = null;
  },
};
