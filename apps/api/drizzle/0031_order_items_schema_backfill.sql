ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "quantity_min" numeric(12,3),
  ADD COLUMN IF NOT EXISTS "quantity_max" numeric(12,3),
  ADD COLUMN IF NOT EXISTS "description" text,
  ADD COLUMN IF NOT EXISTS "cost_currency" text,
  ADD COLUMN IF NOT EXISTS "sales_currency" text,
  ADD COLUMN IF NOT EXISTS "delivered_quantity" numeric(12,3),
  ADD COLUMN IF NOT EXISTS "customer_note" text;
--> statement-breakpoint

ALTER TABLE "order_items"
  ALTER COLUMN "cost_currency" SET DEFAULT 'USD',
  ALTER COLUMN "sales_currency" SET DEFAULT 'USD';
--> statement-breakpoint

UPDATE "order_items" SET "cost_currency" = 'USD' WHERE "cost_currency" IS NULL;
--> statement-breakpoint
UPDATE "order_items" SET "sales_currency" = 'USD' WHERE "sales_currency" IS NULL;
--> statement-breakpoint

ALTER TABLE "order_items"
  ALTER COLUMN "cost_currency" SET NOT NULL,
  ALTER COLUMN "sales_currency" SET NOT NULL;
