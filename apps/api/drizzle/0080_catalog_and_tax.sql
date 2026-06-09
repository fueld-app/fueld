-- Add order category, tax columns, and catalog/category/tax settings support
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "category_key" text;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "tax_rate" numeric(5, 4);
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "tax_amount" numeric(14, 2);
