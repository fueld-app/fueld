ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "supplier_note" text;
