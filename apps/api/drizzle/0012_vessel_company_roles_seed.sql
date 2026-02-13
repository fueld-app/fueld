-- Seed the vessel-company role configuration into tenant settings
-- and migrate any existing vessel_companies rows with old role values
-- to the closest matching Lloyd's classification role key.

-- 1. Update tenant settings with the full role configuration
UPDATE tenants
SET settings = jsonb_set(
  COALESCE(settings::jsonb, '{}'::jsonb),
  '{vesselCompanyRoles}',
  '[
    {"key":"REGISTERED_OWNER","label":"Registered Owner","group":"Legal & Financial","description":"The company holding the ship''s legal title, almost always a shell company set up in a favorable flag state to limit liability.","seasearcherCode":"RO"},
    {"key":"NOMINAL_OWNER","label":"Nominal Owner","group":"Legal & Financial","description":"The company named on legal documents that holds no real economic power or operational control.","seasearcherCode":"NO"},
    {"key":"BENEFICIAL_OWNER","label":"Beneficial Owner","group":"Legal & Financial","description":"The actual individuals or entities at the top of the corporate ladder who ultimately control the vessel and receive its financial profits.","seasearcherCode":"BO"},
    {"key":"GROUP_BENEFICIAL_OWNER","label":"Group Beneficial Owner","group":"Legal & Financial","description":"The parent company or overarching shipping conglomerate that holds the controlling interest over a fleet of vessels."},
    {"key":"COMMERCIAL_OPERATOR","label":"Commercial Operator","group":"Operational & Commercial","description":"The company responsible for the day-to-day commercial employment, chartering, and routing of the ship (this is where time charterers usually sit).","seasearcherCode":"CO"},
    {"key":"THIRD_PARTY_OPERATOR","label":"Third-Party Operator","group":"Operational & Commercial","description":"An external company contracted to operate the vessel, used to distinguish outsourced management from in-house operations.","seasearcherCode":"TP"},
    {"key":"DISPONENT_OWNER","label":"Disponent Owner","group":"Operational & Commercial","description":"A company that does not hold legal title but has chartered the ship and is commercially controlling or sub-chartering it to third parties as if they were the owner."},
    {"key":"BAREBOAT_CHARTERER","label":"Bareboat Charterer","group":"Operational & Commercial","description":"A company that leases the vessel completely bare (no crew, fuel, or provisions) and takes on full legal and operational responsibility for the lease duration."},
    {"key":"TECHNICAL_MANAGER","label":"Technical Manager","group":"Technical & Safety","description":"The company responsible for the physical upkeep, maintenance, repairs, supplying of spare parts, and often the crewing of the ship.","seasearcherCode":"TM"},
    {"key":"ISM_MANAGER","label":"ISM Manager","group":"Technical & Safety","description":"The entity officially registered with the IMO as legally responsible for the ship''s safety and pollution prevention under the ISM Code.","seasearcherCode":"IM"},
    {"key":"SHIP_MANAGER","label":"Ship Manager","group":"Technical & Safety","description":"The overarching company entrusted with the general management of the vessel, which may handle or subcontract the technical, commercial, and ISM duties."}
  ]'::jsonb
),
    updated_at = NOW();

-- 2. Ensure the role column is text (may still be enum on some environments)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vessel_companies' AND column_name = 'role' AND data_type = 'USER-DEFINED'
  ) THEN
    ALTER TABLE vessel_companies ALTER COLUMN role TYPE text;
  END IF;
END $$;

-- 3. Migrate old role values to the closest matching new role keys
-- "OWNER" / "Owner" → REGISTERED_OWNER
UPDATE vessel_companies SET role = 'REGISTERED_OWNER', updated_at = NOW()
WHERE role IN ('OWNER', 'Owner', 'owner');

-- "TIME_CHARTERER" / "Time Charterer" → COMMERCIAL_OPERATOR
UPDATE vessel_companies SET role = 'COMMERCIAL_OPERATOR', updated_at = NOW()
WHERE role IN ('TIME_CHARTERER', 'Time Charterer', 'time_charterer', 'Time_Charterer');

-- "OPERATOR" / "Operator" → COMMERCIAL_OPERATOR
UPDATE vessel_companies SET role = 'COMMERCIAL_OPERATOR', updated_at = NOW()
WHERE role IN ('OPERATOR', 'Operator', 'operator');

-- "MANAGER" / "Manager" → SHIP_MANAGER
UPDATE vessel_companies SET role = 'SHIP_MANAGER', updated_at = NOW()
WHERE role IN ('MANAGER', 'Manager', 'manager');

-- "OTHER" / "Other" → COMMERCIAL_OPERATOR
UPDATE vessel_companies SET role = 'COMMERCIAL_OPERATOR', updated_at = NOW()
WHERE role IN ('OTHER', 'Other', 'other');
