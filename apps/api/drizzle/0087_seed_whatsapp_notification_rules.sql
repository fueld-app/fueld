-- Seed default WhatsApp notification rules for existing tenants
-- This preserves the current hardcoded behavior for riviera-marine and other existing tenants

INSERT INTO "whatsapp_notification_rules" ("tenant_id", "event_type", "enabled", "message_template", "target_group_jid")
SELECT
  t.id AS tenant_id,
  'inquiry_sent' AS event_type,
  COALESCE((t.settings->>'whatsappFirstInquiryGroupNotificationEnabled')::boolean, true) AS enabled,
  '📋 *Inquiry Sent*

*Vessel:* {{vesselName}}{{#vesselImo}} (IMO: {{vesselImo}}){{/vesselImo}}
*Port:* {{portName}}
{{#eta}}*ETA:* {{eta}}
{{/eta}}{{#etd}}*ETD:* {{etd}}
{{/etd}}
*Products:* {{products}}

*Suppliers ({{supplierCount}}):* {{suppliers}}
*Sent by:* {{sentBy}}' AS message_template,
  t.settings->>'whatsappDefaultGroupJid' AS target_group_jid
FROM "tenants" t
WHERE t.settings->>'whatsappDefaultGroupJid' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "whatsapp_notification_rules" r
    WHERE r.tenant_id = t.id AND r.event_type = 'inquiry_sent'
  );

INSERT INTO "whatsapp_notification_rules" ("tenant_id", "event_type", "enabled", "message_template", "target_group_jid")
SELECT
  t.id AS tenant_id,
  'credit_application_submitted' AS event_type,
  COALESCE((t.settings->'creditApplicationSettings'->>'notifyWhatsApp')::boolean, false) AS enabled,
  '📋 New credit application from {{traderEmail}} for {{companyName}} ({{currency}} {{amount}})' AS message_template,
  t.settings->>'whatsappDefaultGroupJid' AS target_group_jid
FROM "tenants" t
WHERE t.settings->>'whatsappDefaultGroupJid' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "whatsapp_notification_rules" r
    WHERE r.tenant_id = t.id AND r.event_type = 'credit_application_submitted'
  );

INSERT INTO "whatsapp_notification_rules" ("tenant_id", "event_type", "enabled", "message_template", "target_group_jid")
SELECT
  t.id AS tenant_id,
  'credit_application_processed' AS event_type,
  COALESCE((t.settings->'creditApplicationSettings'->>'notifyTraderWhatsApp')::boolean, false) AS enabled,
  'Credit application for {{companyName}} ({{currency}} {{amount}}) has been {{status}}.' AS message_template,
  t.settings->>'whatsappDefaultGroupJid' AS target_group_jid
FROM "tenants" t
WHERE t.settings->>'whatsappDefaultGroupJid' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "whatsapp_notification_rules" r
    WHERE r.tenant_id = t.id AND r.event_type = 'credit_application_processed'
  );

INSERT INTO "whatsapp_notification_rules" ("tenant_id", "event_type", "enabled", "message_template", "target_group_jid")
SELECT
  t.id AS tenant_id,
  'order_confirmed' AS event_type,
  true AS enabled,
  '✅ *Order Confirmed*

*Order:* {{orderNumber}}
*Vessel:* {{vesselName}}
*Port:* {{portName}}
*Customer:* {{customerName}}' AS message_template,
  t.settings->>'whatsappDefaultGroupJid' AS target_group_jid
FROM "tenants" t
WHERE t.settings->>'whatsappDefaultGroupJid' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "whatsapp_notification_rules" r
    WHERE r.tenant_id = t.id AND r.event_type = 'order_confirmed'
  );

INSERT INTO "whatsapp_notification_rules" ("tenant_id", "event_type", "enabled", "message_template", "target_group_jid")
SELECT
  t.id AS tenant_id,
  'order_delivered' AS event_type,
  true AS enabled,
  '🚚 *Order Delivered*

*Order:* {{orderNumber}}
*Vessel:* {{vesselName}}
*Port:* {{portName}}
*Customer:* {{customerName}}' AS message_template,
  t.settings->>'whatsappDefaultGroupJid' AS target_group_jid
FROM "tenants" t
WHERE t.settings->>'whatsappDefaultGroupJid' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "whatsapp_notification_rules" r
    WHERE r.tenant_id = t.id AND r.event_type = 'order_delivered'
  );
