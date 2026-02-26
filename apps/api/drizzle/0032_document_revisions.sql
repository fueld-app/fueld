DO $$ BEGIN
  CREATE TYPE "document_type" AS ENUM ('OFFER', 'PROFORMA_INVOICE', 'INVOICE', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "document_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "order_id" uuid REFERENCES "orders"("id") ON DELETE CASCADE,
  "invoice_id" uuid REFERENCES "invoices"("id") ON DELETE CASCADE,
  "document_type" "document_type" NOT NULL,
  "stream_key" text NOT NULL,
  "revision_number" integer NOT NULL,
  "verification_ref" text NOT NULL,
  "verify_token" text NOT NULL,
  "sha256_hex" text NOT NULL,
  "fingerprint_short" text NOT NULL,
  "file_path" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL DEFAULT 'application/pdf',
  "file_size" integer NOT NULL,
  "generated_by" uuid REFERENCES "users"("id"),
  "issued_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "document_revisions_target_check" CHECK ("order_id" IS NOT NULL OR "invoice_id" IS NOT NULL)
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "document_revisions"
    ADD CONSTRAINT "document_revisions_verify_token_unique" UNIQUE ("verify_token");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "document_revisions"
    ADD CONSTRAINT "document_revisions_stream_revision_unique" UNIQUE ("tenant_id", "stream_key", "revision_number");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "document_revisions"
    ADD CONSTRAINT "document_revisions_stream_hash_unique" UNIQUE ("tenant_id", "stream_key", "sha256_hex");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "document_revisions_stream_idx" ON "document_revisions" ("tenant_id", "stream_key", "revision_number" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_revisions_order_idx" ON "document_revisions" ("order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_revisions_invoice_idx" ON "document_revisions" ("invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_revisions_issued_at_idx" ON "document_revisions" ("issued_at" DESC);
