-- Tenant-configurable custom columns feature.
-- Adds a JSONB column on orders to store per-order custom column values,
-- and seeds default custom columns (Comment, Voyage) into tenant settings
-- for the order entity. These are tenant-configurable (admins can edit/remove
-- them) — they are NOT hardcoded in application code.

ALTER TABLE orders ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

--> statement-breakpoint

-- Seed default custom columns for the order entity, only when a tenant has
-- not yet configured any customColumns (preserves existing configuration).
UPDATE tenants
SET settings = jsonb_set(
  settings,
  '{customColumns}',
  COALESCE(
    settings->'customColumns',
    '[{"entity":"order","key":"comment","label":"Comment","type":"text"},{"entity":"order","key":"voyage","label":"Voyage","type":"text"}]'::jsonb
  )
)
WHERE NOT settings ? 'customColumns';