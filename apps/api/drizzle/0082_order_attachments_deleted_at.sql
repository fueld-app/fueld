ALTER TABLE "order_attachments"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
