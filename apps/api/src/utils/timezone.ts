import tzlookup from 'tz-lookup';

/**
 * Resolve an IANA timezone ID from lat/long coordinates.
 * Returns null if coordinates are missing or lookup fails.
 */
export function timezoneFromCoords(lat: number | null | undefined, long: number | null | undefined): string | null {
  if (lat == null || long == null) return null;
  try {
    return tzlookup(lat, long);
  } catch {
    return null;
  }
}

/**
 * Check whether a string is a valid IANA timezone identifier.
 */
export function isIanaTimezone(tz: string | null | undefined): boolean {
  if (!tz) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the best IANA timezone for a place.
 *
 * Priority:
 *  1. If the existing timezone is already a valid IANA ID, keep it.
 *  2. Derive from lat/long via tz-lookup.
 *  3. Return null (caller decides fallback).
 */
export function resolveIanaTimezone(
  lat: number | null | undefined,
  long: number | null | undefined,
  existingTz?: string | null,
): string | null {
  // If the existing value is already a valid IANA timezone, keep it
  if (existingTz && isIanaTimezone(existingTz)) return existingTz;
  // Try to derive from coordinates
  return timezoneFromCoords(lat, long);
}

/**
 * Format a UTC Date/ISO string into a human-readable string in the given
 * IANA timezone, including the timezone abbreviation.
 *
 * Example output: "04-03-2026 14:30 HKT"
 *
 * Falls back to UTC if the timezone is invalid.
 */
export function formatDateInTimezone(
  value: string | Date | null,
  tz: string | null | undefined,
): string | null {
  if (!value) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(date.getTime())) return null;

  const safeTimezone = tz && isIanaTimezone(tz) ? tz : 'UTC';

  // Format date parts
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTimezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const map = new Map(parts.map((p) => [p.type, p.value]));
  const day = map.get('day') ?? '01';
  const month = map.get('month') ?? '01';
  const year = map.get('year') ?? '0000';
  const hour = map.get('hour') ?? '00';
  const minute = map.get('minute') ?? '00';

  // Get timezone abbreviation (e.g. "HKT", "GST", "UTC", "CET")
  const abbr = getTimezoneAbbreviation(date, safeTimezone);

  return `${day}-${month}-${year} ${hour}:${minute} ${abbr}`;
}

/**
 * Get the timezone abbreviation for a given date and IANA timezone.
 * Uses Intl.DateTimeFormat with timeZoneName: 'short'.
 *
 * Returns strings like "HKT", "GST", "UTC", "CET", "GMT+4", etc.
 */
export function getTimezoneAbbreviation(date: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    return tzPart?.value ?? tz;
  } catch {
    return 'UTC';
  }
}
