CREATE TABLE IF NOT EXISTS "company_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "counterparty_id" uuid NOT NULL,
  "file_name" text NOT NULL,
  "file_path" text NOT NULL,
  "mime_type" text NOT NULL,
  "file_size" integer NOT NULL,
  "uploaded_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_attachments_counterparty_id_counterparties_id_fk"
    FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "company_attachments_uploaded_by_users_id_fk"
    FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
);