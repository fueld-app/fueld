DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_term_type') THEN
    CREATE TYPE "public"."payment_term_type" AS ENUM('CREDIT', 'COD', 'PREPAY');
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_attachment_type') THEN
    CREATE TYPE "public"."order_attachment_type" AS ENUM('BDR', 'OTHER');
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "customer_payment_term_type" "payment_term_type",
  ADD COLUMN IF NOT EXISTS "customer_credit_days" integer,
  ADD COLUMN IF NOT EXISTS "customer_note" text,
  ADD COLUMN IF NOT EXISTS "supplier_note" text;
--> statement-breakpoint
ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "supplier_payment_term_type" "payment_term_type",
  ADD COLUMN IF NOT EXISTS "supplier_credit_days" integer,
  ADD COLUMN IF NOT EXISTS "delivered_quantity" numeric(12,3),
  ADD COLUMN IF NOT EXISTS "customer_note" text,
  ADD COLUMN IF NOT EXISTS "supplier_note" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "type" "order_attachment_type" NOT NULL DEFAULT 'OTHER',
  "file_name" text NOT NULL,
  "file_path" text NOT NULL,
  "mime_type" text NOT NULL,
  "file_size" integer NOT NULL,
  "uploaded_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
