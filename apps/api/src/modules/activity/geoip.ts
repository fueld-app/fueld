// ═══════════════════════════════════════════════════════════════════════
//  GeoIP — IP address to location resolution using geoip-lite
//
//  Uses the MaxMind GeoLite2 database (bundled with geoip-lite)
//  to resolve IPv4/IPv6 addresses to country, city, and region.
// ═══════════════════════════════════════════════════════════════════════

import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export interface GeoInfo {
  country: string | null;
  city: string | null;
}

/**
 * Look up geographic info for an IP address.
 * Returns null values for private/loopback/unresolvable IPs.
 */
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

export function lookupIp(ip: string | null): GeoInfo {
  if (!ip) return { country: null, city: null };

  const normalized = normalizeIp(ip);

  const octets = normalized.split('.').map((o) => Number(o));
  const isPrivateV4 =
    octets.length === 4
    && !octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)
    && (
      octets[0] === 10
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168)
      || (octets[0] === 169 && octets[1] === 254)
    );

  // Skip loopback and local addresses
  if (
    normalized === '::1'
    || normalized === '127.0.0.1'
    || isPrivateV4
  ) {
    return { country: null, city: null };
  }

  try {
    const geoip = require('geoip-lite');
    const result = geoip.lookup(normalized);
    if (!result) return { country: null, city: null };

    return {
      country: result.country ?? null,  // ISO 3166-1 alpha-2 (e.g. 'GB', 'US')
      city: result.city || null,
    };
  } catch {
    return { country: null, city: null };
  }
}
