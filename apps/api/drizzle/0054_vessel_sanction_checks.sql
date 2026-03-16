-- Vessel sanction checks: add sanction tracking columns to vessels table
ALTER TABLE "vessels" ADD COLUMN IF NOT EXISTS "sanction_status" text DEFAULT 'UNCHECKED';
ALTER TABLE "vessels" ADD COLUMN IF NOT EXISTS "last_sanction_check" timestamptz;

-- Vessel sanction check history table
CREATE TABLE IF NOT EXISTS "vessel_sanction_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "vessel_id" uuid NOT NULL REFERENCES "vessels"("id") ON DELETE CASCADE,
  "status" text NOT NULL,
  "source" text NOT NULL DEFAULT 'TANKERTRACKERS',
  "matched_on" text,
  "raw_data" jsonb,
  "checked_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Index for efficient tenant-scoped queries
CREATE INDEX IF NOT EXISTS "idx_vessel_sanction_checks_tenant" ON "vessel_sanction_checks" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_vessel_sanction_checks_vessel" ON "vessel_sanction_checks" ("vessel_id");
CREATE INDEX IF NOT EXISTS "idx_vessel_sanction_checks_checked_at" ON "vessel_sanction_checks" ("checked_at" DESC);

-- Index for filtering sanctioned vessels
CREATE INDEX IF NOT EXISTS "idx_vessels_sanction_status" ON "vessels" ("sanction_status");
