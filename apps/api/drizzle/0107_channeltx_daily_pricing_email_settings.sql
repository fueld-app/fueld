-- Enable daily pricing email feature for ChannelTX tenant (Feature 7: Daily Pricing Email)
-- Send at 13:00 UTC (8:00 AM CST), look back 24h for delivered fuel prices
-- Recipients: pull from company_contacts (IDs stored, emails resolved at send time)

UPDATE tenants
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{dailyPricingEmail}',
  '{"enabled":true,"hourUtc":13,"recipientContactIds":[],"extraEmails":[],"lookbackHours":24,"emailSubject":"CMF Fuel Dock — Posted Prices"}'::jsonb
),
    updated_at = NOW()
WHERE domain = 'channeltx.fueld.app';