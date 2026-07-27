-- Enable comments digest email feature for ChannelTX tenant (Feature 2: Comments Digest)
-- Send at 10:00 UTC (5:00 AM CST), full activity rundown, all team members

UPDATE tenants
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{commentsDigest}',
  '{"enabled":true,"hourUtc":10,"recipientRoles":["ADMIN","TRADER","TEAMLEAD","OPERATIONSMANAGER","FINANCE","CREDITMANAGER","LIGHT"],"extraEmails":[],"includeActivityLog":true,"entityTypes":[]}'::jsonb
),
    updated_at = NOW()
WHERE domain = 'channeltx.fueld.app';