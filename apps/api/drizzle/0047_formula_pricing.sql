-- Formula / posted-price pricing model
-- Adds support for reference-based pricing (e.g. "Aramco posted price + premium")

-- 1. Pricing model enum
DO $$ BEGIN
  CREATE TYPE pricing_model AS ENUM ('FIXED', 'FORMULA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Price references table (master list of base-price sources)
CREATE TABLE IF NOT EXISTS "price_references" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "name" text NOT NULL,
  "code" text NOT NULL,
  "description" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- 3. Formula pricing columns on order_items (cost side)
ALTER TABLE "order_items" ADD COLUMN "cost_pricing_model" pricing_model NOT NULL DEFAULT 'FIXED';
ALTER TABLE "order_items" ADD COLUMN "cost_reference_id" uuid REFERENCES "price_references"("id") ON DELETE SET NULL;
ALTER TABLE "order_items" ADD COLUMN "cost_premium" numeric(12, 4);
ALTER TABLE "order_items" ADD COLUMN "cost_barging" numeric(12, 4);
ALTER TABLE "order_items" ADD COLUMN "cost_barging_unit" text;
ALTER TABLE "order_items" ADD COLUMN "cost_credit_days" integer;
ALTER TABLE "order_items" ADD COLUMN "cost_price_finalized" boolean NOT NULL DEFAULT false;

-- 4. Formula pricing columns on order_items (sell side)
ALTER TABLE "order_items" ADD COLUMN "sales_pricing_model" pricing_model NOT NULL DEFAULT 'FIXED';
ALTER TABLE "order_items" ADD COLUMN "sales_reference_id" uuid REFERENCES "price_references"("id") ON DELETE SET NULL;
ALTER TABLE "order_items" ADD COLUMN "sales_premium" numeric(12, 4);
ALTER TABLE "order_items" ADD COLUMN "sales_barging" numeric(12, 4);
ALTER TABLE "order_items" ADD COLUMN "sales_barging_unit" text;
ALTER TABLE "order_items" ADD COLUMN "sales_credit_days" integer;
ALTER TABLE "order_items" ADD COLUMN "sales_price_finalized" boolean NOT NULL DEFAULT false;

-- 5. Seed default price references for every existing tenant
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
) AS r("name", "code", "description");
