-- Backfill US gallon (GAL) conversion rows into every tenant's
-- persisted settings.unitConversions. Existing tenants already have
-- a non-null unitConversions array, so the DEFAULT_UNIT_CONVERSIONS
-- code change alone doesn't reach them. This is idempotent: if a
-- (fromUnit, toUnit, productType IS NULL) row already exists it is
-- left untouched.

UPDATE tenants
SET settings = jsonb_set(
      settings,
      '{unitConversions}',
      COALESCE(settings->'unitConversions', '[]'::jsonb)
      -- Append GAL→CBM if missing
      || CASE WHEN NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            COALESCE(settings->'unitConversions', '[]'::jsonb)
          ) AS e
          WHERE e->>'fromUnit' = 'GAL' AND e->>'toUnit' = 'CBM'
            AND (e->>'productType' IS NULL)
        )
        THEN '[{"fromUnit":"GAL","toUnit":"CBM","factor":0.00378541}]'::jsonb
        ELSE '[]'::jsonb END
      -- Append CBM→GAL if missing
      || CASE WHEN NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            COALESCE(settings->'unitConversions', '[]'::jsonb)
          ) AS e
          WHERE e->>'fromUnit' = 'CBM' AND e->>'toUnit' = 'GAL'
            AND (e->>'productType' IS NULL)
        )
        THEN '[{"fromUnit":"CBM","toUnit":"GAL","factor":264.172}]'::jsonb
        ELSE '[]'::jsonb END
      -- Append GAL→BBL if missing
      || CASE WHEN NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            COALESCE(settings->'unitConversions', '[]'::jsonb)
          ) AS e
          WHERE e->>'fromUnit' = 'GAL' AND e->>'toUnit' = 'BBL'
            AND (e->>'productType' IS NULL)
        )
        THEN '[{"fromUnit":"GAL","toUnit":"BBL","factor":0.0238095}]'::jsonb
        ELSE '[]'::jsonb END
      -- Append BBL→GAL if missing
      || CASE WHEN NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            COALESCE(settings->'unitConversions', '[]'::jsonb)
          ) AS e
          WHERE e->>'fromUnit' = 'BBL' AND e->>'toUnit' = 'GAL'
            AND (e->>'productType' IS NULL)
        )
        THEN '[{"fromUnit":"BBL","toUnit":"GAL","factor":42}]'::jsonb
        ELSE '[]'::jsonb END
    ),
    updated_at = now()
WHERE settings->'unitConversions' IS NOT NULL;