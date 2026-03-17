ALTER TABLE "order_items" ADD COLUMN "cost_unit" text NOT NULL DEFAULT 'MT';
ALTER TABLE "order_items" ADD COLUMN "cost_conversion_factor" numeric(12, 6) NOT NULL DEFAULT '1';
-- Backfill: set cost_unit = unit for all existing rows so nothing changes
UPDATE "order_items" SET "cost_unit" = "unit", "cost_conversion_factor" = '1';
