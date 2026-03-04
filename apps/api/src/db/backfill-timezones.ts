/**
 * One-time backfill: Convert legacy LLI timezone values (e.g. "GMT +04H")
 * to proper IANA timezone IDs (e.g. "Asia/Dubai") using lat/long coordinates.
 *
 * Run with: bun run src/db/backfill-timezones.ts
 */
import { db } from './index';
import { places } from './schema';
import { eq } from 'drizzle-orm';
import { resolveIanaTimezone, isIanaTimezone } from '../utils/timezone';

async function backfillTimezones() {
  console.log('[Timezone Backfill] Starting...');

  // Find all places that need timezone resolution
  const allPlaces = await db
    .select({
      id: places.id,
      name: places.name,
      timezone: places.timezone,
      lat: places.lat,
      long: places.long,
    })
    .from(places);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const place of allPlaces) {
    // Skip if already a valid IANA timezone
    if (place.timezone && isIanaTimezone(place.timezone)) {
      skipped++;
      continue;
    }

    // Try to resolve IANA timezone from coordinates
    const ianaTimezone = resolveIanaTimezone(place.lat, place.long, place.timezone);

    if (ianaTimezone) {
      await db
        .update(places)
        .set({ timezone: ianaTimezone })
        .where(eq(places.id, place.id));

      console.log(`  ✓ ${place.name}: "${place.timezone ?? 'null'}" → "${ianaTimezone}"`);
      updated++;
    } else {
      console.log(`  ✗ ${place.name}: No coordinates, cannot resolve timezone (lat=${place.lat}, long=${place.long})`);
      failed++;
    }
  }

  console.log(`\n[Timezone Backfill] Done. Updated: ${updated}, Skipped (already IANA): ${skipped}, Failed: ${failed}`);
  process.exit(0);
}

backfillTimezones().catch((err) => {
  console.error('[Timezone Backfill] Fatal error:', err);
  process.exit(1);
});
