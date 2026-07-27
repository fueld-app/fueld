-- Enable QuickBooks integration settings for ChannelTX tenant (Feature 4: QuickBooks Integration)
-- Kathy (backoffice@channeltx.com) notified on invoice push, manual sync (not auto)

UPDATE tenants
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{quickbooksSettings}',
  '{"notifyEmail":"backoffice@channeltx.com","autoSyncInvoices":false,"productMappings":[]}'::jsonb
),
    updated_at = NOW()
WHERE domain = 'channeltx.fueld.app';