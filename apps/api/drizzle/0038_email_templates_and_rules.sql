-- Email templates (global per tenant × document type) and
-- email rules (default CC/BCC per own company × document type).

-- ─── Email Templates ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "email_templates" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "document_type"    text NOT NULL,                -- 'OFFER' | 'NOMINATION' | 'PROFORMA' | 'INVOICE'
  "subject_template" text NOT NULL DEFAULT '',     -- e.g. '{{documentLabel}} — {{orderNumber}} — {{vesselName}}, {{portName}}'
  "body_template"    text NOT NULL DEFAULT '',     -- HTML with {{variable}} placeholders
  "created_at"       timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT NOW(),
  UNIQUE ("tenant_id", "document_type")
);

CREATE INDEX IF NOT EXISTS "idx_email_templates_tenant" ON "email_templates" ("tenant_id");

-- ─── Email Rules (default CC / BCC) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS "email_rules" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "own_company_id"  uuid REFERENCES "counterparties"("id") ON DELETE CASCADE,  -- NULL = applies to all own companies
  "document_type"   text,                          -- NULL = applies to all document types
  "rule_type"       text NOT NULL,                 -- 'CC' | 'BCC'
  "email"           text NOT NULL,
  "label"           text,                          -- optional display label, e.g. 'Finance Team'
  "created_at"      timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_email_rules_tenant" ON "email_rules" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_email_rules_lookup" ON "email_rules" ("tenant_id", "own_company_id", "document_type");

-- Add bcc_emails column to email_log for audit
ALTER TABLE "email_log" ADD COLUMN IF NOT EXISTS "bcc_emails" text;
