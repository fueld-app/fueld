-- Formula / posted-price pricing model
-- Adds support for reference-based pricing (e.g. "Aramco posted price + premium")

-- 1. Pricing model enum
DO $$ BEGIN
  CREATE TYPE pricing_model AS ENUM ('FIXED', 'FORMULA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "price_references" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "name" text NOT NULL,
  "code" text NOT NULL,
  "description" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "cost_pricing_model" pricing_model NOT NULL DEFAULT 'FIXED';--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "cost_reference_id" uuid REFERENCES "price_references"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "cost_premium" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "cost_barging" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "cost_barging_unit" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "cost_credit_days" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "cost_price_finalized" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "sales_pricing_model" pricing_model NOT NULL DEFAULT 'FIXED';--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "sales_reference_id" uuid REFERENCES "price_references"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "sales_premium" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "sales_barging" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "sales_barging_unit" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "sales_credit_days" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "sales_price_finalized" boolean NOT NULL DEFAULT false;--> statement-breakpoint
INSERT INTO "price_references" ("tenant_id", "name", "code", "description")
SELECT t."id", r."name", r."code", r."description"
FROM "tenants" t
CROSS JOIN (VALUES
  ('Aramco OSP',          'ARAMCO-OSP',   'Aramco Official Selling Price, published monthly'),
  ('Platts Dubai',        'PLATTS-DUBAI', 'S&P Global Platts Dubai crude assessment'),
  ('Platts Singapore MOPS','PLATTS-MOPS', 'Mean of Platts Singapore — benchmark for refined products in Asia'),
  ('Platts Dated Brent',  'PLATTS-BRENT', 'Platts Dated Brent assessment for North Sea crude'),
  ('Platts FOB Arab Gulf','PLATTS-AG',    'Platts FOB Arab Gulf assessment for fuel oil/gasoil'),
  ('ICE Brent',           'ICE-BRENT',    'ICE Futures Europe Brent crude front-month contract'),
  ('NYMEX WTI',           'NYMEX-WTI',    'NYMEX West Texas Intermediate crude futures'),
  ('Argus Somo',          'ARGUS-SOMO',   'Argus Iraq SOMO Official Selling Price'),
  ('KPC OSP',             'KPC-OSP',      'Kuwait Petroleum Corp Official Selling Price'),
  ('ADNOC OSP',           'ADNOC-OSP',    'Abu Dhabi National Oil Company Official Selling Price'),
  ('QatarEnergy OSP',     'QE-OSP',       'QatarEnergy Official Selling Price'),
  ('Platts LSFO',         'PLATTS-LSFO',  'Platts Low Sulphur Fuel Oil assessment'),
  ('Platts HSFO',         'PLATTS-HSFO',  'Platts High Sulphur Fuel Oil 380 CST assessment'),
  ('Platts Gasoil',       'PLATTS-GO',    'Platts Gasoil 0.5% assessment')
) AS r("name", "code", "description")
WHERE NOT EXISTS (
  SELECT 1 FROM "price_references" pr
  WHERE pr."tenant_id" = t."id" AND pr."code" = r."code"
);
