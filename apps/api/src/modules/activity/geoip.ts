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
export function lookupIp(ip: string | null): GeoInfo {
  if (!ip) return { country: null, city: null };

  // Skip loopback and local addresses
  if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return { country: null, city: null };
  }

  try {
    const geoip = require('geoip-lite');
    const result = geoip.lookup(ip);
    if (!result) return { country: null, city: null };

    return {
      country: result.country ?? null,  // ISO 3166-1 alpha-2 (e.g. 'GB', 'US')
      city: result.city || null,
    };
  } catch {
    return { country: null, city: null };
  }
}
