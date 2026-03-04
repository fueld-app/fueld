-- Backfill IANA timezone identifiers on places.
-- This migration runs a procedural block that:
--   1. For places with non-IANA timezones (e.g. 'GMT +04H') and valid coordinates,
--      stores the old value in a new 'timezone_legacy' column for reference.
--   2. The actual IANA timezone resolution happens at application startup via
--      a one-time backfill in the API (tz-lookup requires JS/Node).
--
-- We add a 'timezone_legacy' column to preserve the original LLI timezone string
-- while the 'timezone' column is migrated to hold IANA identifiers.

ALTER TABLE "places" ADD COLUMN IF NOT EXISTS "timezone_legacy" text;

-- Copy current timezone values to legacy column for places that have one
UPDATE "places"
SET "timezone_legacy" = "timezone"
WHERE "timezone" IS NOT NULL
  AND "timezone_legacy" IS NULL;
