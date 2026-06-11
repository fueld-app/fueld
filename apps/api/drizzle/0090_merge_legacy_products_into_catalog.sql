-- ═══════════════════════════════════════════════════════════════════════
--  Migration 0090 — Merge legacy products into existing catalogItems
-- ═══════════════════════════════════════════════════════════════════════
--
--  Problem: Tenants like ChannelTX had BOTH a legacy `products` array
--  (from the old simple Products panel) AND a `catalogItems` array
--  (from the Product Catalog panel). Migration 0088 skipped them because
--  catalogItems was non-empty, so many custom products disappeared from
--  the consolidated Products panel.
--
--  Fix: For every tenant, merge any product names from the legacy
--  `products` array that are NOT already present in `catalogItems`
--  (matched by name). Preserves existing catalog items with their rich
--  data (prices, units, etc.) and only appends missing ones as
--  name-only entries.
--
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  rec RECORD;
  legacy_products TEXT[];
  existing_catalog JSONB;
  existing_names TEXT[];
  merged_catalog JSONB;
  item JSONB;
  prod TEXT;
BEGIN
  FOR rec IN
    SELECT id, settings
    FROM tenants
    WHERE settings IS NOT NULL
      AND settings->'products' IS NOT NULL
  LOOP
    -- Extract legacy product names
    legacy_products := ARRAY(
      SELECT DISTINCT trim(jsonb_array_elements_text(rec.settings->'products'))
    );

    -- Extract existing catalogItems
    existing_catalog := COALESCE(rec.settings->'catalogItems', '[]'::jsonb);

    -- Build set of existing catalog item names (case-insensitive match)
    existing_names := ARRAY(
      SELECT lower(trim(catalog_item->>'name'))
      FROM jsonb_array_elements(existing_catalog) AS catalog_item
    );

    -- Start with existing catalog
    merged_catalog := existing_catalog;

    -- Append any legacy products not already in catalog
    FOREACH prod IN ARRAY legacy_products
    LOOP
      IF prod IS NOT NULL AND trim(prod) <> '' AND lower(trim(prod)) <> ALL(existing_names) THEN
        merged_catalog := merged_catalog || jsonb_build_array(
          jsonb_build_object(
            'id', gen_random_uuid(),
            'name', trim(prod),
            'description', '',
            'defaultUnit', '',
            'defaultCostPrice', null,
            'defaultSalesPrice', null,
            'defaultTaxRateId', '',
            'categoryKey', ''
          )
        );
      END IF;
    END LOOP;

    -- Only update if we actually added items
    IF jsonb_array_length(merged_catalog) > jsonb_array_length(existing_catalog) THEN
      UPDATE tenants
      SET settings = jsonb_set(
        settings,
        '{catalogItems}',
        merged_catalog,
        true
      )
      WHERE id = rec.id;

      RAISE NOTICE 'Tenant %: merged % legacy products into catalogItems (was %, now %)',
        rec.id,
        jsonb_array_length(merged_catalog) - jsonb_array_length(existing_catalog),
        jsonb_array_length(existing_catalog),
        jsonb_array_length(merged_catalog);
    END IF;
  END LOOP;
END $$;
