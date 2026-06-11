-- ═══════════════════════════════════════════════════════════════════════
--  Migration 0089 — Backfill catalogItems for tenants missed by 0088
-- ═══════════════════════════════════════════════════════════════════════
--
--  Problem: Migration 0088 only converted tenants that had an explicit
--  `products` key inside their `settings` JSONB. Tenants that never
--  saved custom products (and relied on the backend DEFAULT_PRODUCTS
--  fallback) were skipped, so their order line item dropdowns became
--  empty after the frontend consolidation.
--
--  Fix: For every tenant where catalogItems is still missing or empty,
--  populate catalogItems from:
--    1. settings->'products'  (if it exists and is non-empty)
--    2. DEFAULT_PRODUCTS list  (fallback for tenants with no products key)
--
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  rec RECORD;
  source_products TEXT[];
  new_catalog JSONB;
  prod TEXT;
BEGIN
  FOR rec IN
    SELECT id, settings
    FROM tenants
    WHERE settings IS NULL
       OR settings->'catalogItems' IS NULL
       OR jsonb_array_length(settings->'catalogItems') = 0
  LOOP
    -- 1) Try explicit products array from settings
    IF rec.settings IS NOT NULL AND rec.settings->'products' IS NOT NULL THEN
      source_products := ARRAY(
        SELECT jsonb_array_elements_text(rec.settings->'products')
      );
    END IF;

    -- 2) Fallback to defaults if no explicit products
    IF source_products IS NULL OR array_length(source_products, 1) IS NULL THEN
      source_products := ARRAY[
        'VLSFO','LSMGO','IFO380CST','IFO180CST','IFO120CST','IFO30CST',
        'IFO','MGO','MDO','LSIFO','LUBE',
        'ITEM','COMMISSION','HIRE','PAYMENT','CREDIT_NOTE',
        'CUTTERSTOCK','PYGAS','BARGING_FEE'
      ];
    END IF;

    -- Build catalogItems
    new_catalog := '[]'::jsonb;
    FOREACH prod IN ARRAY source_products
    LOOP
      IF prod IS NOT NULL AND trim(prod) <> '' THEN
        new_catalog := new_catalog || jsonb_build_array(
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

    -- Write catalogItems and keep legacy products in sync
    UPDATE tenants
    SET settings = jsonb_set(
      jsonb_set(
        COALESCE(settings, '{}'::jsonb),
        '{catalogItems}',
        new_catalog,
        true
      ),
      '{products}',
      to_jsonb(source_products),
      true
    )
    WHERE id = rec.id;

    RAISE NOTICE 'Tenant %: migrated % products into catalogItems', rec.id, jsonb_array_length(new_catalog);
  END LOOP;
END $$;
