-- Add category column to order_attachments for photo categorization (Feature 6: Upload Photos)
-- Nullable — only used for photo-type attachments (BEFORE, AFTER, TANK_SEAL, OTHER)

ALTER TABLE "order_attachments"
  ADD COLUMN IF NOT EXISTS "category" text;