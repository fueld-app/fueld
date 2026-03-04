-- Email log: Tracks all outbound document emails sent from the system.

CREATE TABLE IF NOT EXISTS "email_log" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       uuid REFERENCES "tenants"("id"),
  "order_id"        uuid REFERENCES "orders"("id") ON DELETE SET NULL,
  "document_type"   text NOT NULL,           -- 'OFFER', 'NOMINATION', 'PROFORMA', 'INVOICE'
  "sent_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "sent_from_email" text NOT NULL,
  "sent_to"         text NOT NULL,
  "cc_emails"       text,                    -- comma-separated
  "subject"         text NOT NULL,
  "pdf_file_name"   text,
  "channel"         text NOT NULL DEFAULT 'SMTP',  -- 'SMTP' | 'GRAPH'
  "status"          text NOT NULL DEFAULT 'SENT',  -- 'SENT' | 'FAILED'
  "error_message"   text,
  "created_at"      timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_email_log_order" ON "email_log" ("order_id");
CREATE INDEX IF NOT EXISTS "idx_email_log_tenant" ON "email_log" ("tenant_id");
