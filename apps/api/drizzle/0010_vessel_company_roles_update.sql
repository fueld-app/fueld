-- ═══════════════════════════════════════════════════════════════════════
--  Migration: Update vessel company roles to Lloyd's classifications
--  + Add source column for Seasearcher vs manual tracking
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Add source column (defaults to 'manual' for existing rows)
ALTER TABLE vessel_companies ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

-- 2. Migrate old role keys to new Lloyd's role keys
UPDATE vessel_companies SET role = 'REGISTERED_OWNER' WHERE role = 'OWNER';
UPDATE vessel_companies SET role = 'COMMERCIAL_OPERATOR' WHERE role = 'TIME_CHARTERER';
UPDATE vessel_companies SET role = 'COMMERCIAL_OPERATOR' WHERE role = 'OPERATOR';
UPDATE vessel_companies SET role = 'SHIP_MANAGER' WHERE role = 'MANAGER';

-- 3. Clear any cached tenant settings for vessel company roles
-- (so the new defaults take effect on next fetch)
UPDATE tenants SET settings = settings - 'vesselCompanyRoles' WHERE settings ? 'vesselCompanyRoles';
