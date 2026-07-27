-- Enable photo gallery feature for ChannelTX tenant (Feature 6: Upload Photos)
-- 1. Add 'PHOTO' to attachmentTypes (if not already present)
-- 2. Enable photoGallerySettings with categories BEFORE/AFTER/TANK_SEAL/OTHER

UPDATE tenants
SET settings = jsonb_set(
  jsonb_set(
    COALESCE(settings, '{}'::jsonb),
    '{attachmentTypes}',
    CASE
      WHEN COALESCE(settings->'attachmentTypes', '[]'::jsonb) @> '["PHOTO"]'::jsonb
      THEN COALESCE(settings->'attachmentTypes', '[]'::jsonb)
      ELSE COALESCE(settings->'attachmentTypes', '[]'::jsonb) || '["PHOTO"]'::jsonb
    END
  ),
  '{photoGallerySettings}',
  '{"enabled":true,"photoCategories":["BEFORE","AFTER","TANK_SEAL","OTHER"],"maxFileSizeMb":10}'::jsonb
),
    updated_at = NOW()
WHERE domain = 'channeltx.fueld.app';