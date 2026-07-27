-- Enable throughput/sales report feature for ChannelTX tenant (Feature 1: Sales Reporting by Product)

UPDATE tenants
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{throughputReport}',
  '{"enabled":true,"defaultUnit":"Gallons","groupByCategory":false}'::jsonb
),
    updated_at = NOW()
WHERE domain = 'channeltx.fueld.app';