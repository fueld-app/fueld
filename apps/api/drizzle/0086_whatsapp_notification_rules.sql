-- Create whatsapp_notification_rules table for configurable group messages
CREATE TABLE IF NOT EXISTS "whatsapp_notification_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "message_template" text NOT NULL,
  "target_group_jid" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Unique constraint: one rule per tenant per event type
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_notification_rules_tenant_event_unique"
  ON "whatsapp_notification_rules" ("tenant_id", "event_type");

-- Index for fast lookup by tenant
CREATE INDEX IF NOT EXISTS "whatsapp_notification_rules_tenant_id_idx"
  ON "whatsapp_notification_rules" ("tenant_id");
