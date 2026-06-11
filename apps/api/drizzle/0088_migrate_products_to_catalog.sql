-- ═══════════════════════════════════════════════════════════════════════
--  Migration 0088 — Migrate legacy products array into catalogItems
-- ═══════════════════════════════════════════════════════════════════════
--
--  Context: The "Products" and "Product Catalog" panels were consolidated
--  into a single "Products" panel backed by catalogItems. This migration
--  ensures tenants that only had the legacy `products` array get their
--  products promoted into the new catalog structure so nothing disappears
--  from order line item dropdowns.
--
--  Behavior per tenant:
--    • If catalogItems already exists and is non-empty → leave untouched
--    • If products array exists with items → convert each product name
--      into a catalog item (name only, empty optional fields)
--    • If neither exists → leave untouched (defaults handled in code)
--
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  rec RECORD;
  legacy_products TEXT[];
  existing_catalog JSONB;
  new_catalog JSONB := '[]'::jsonb;
  prod TEXT;
BEGIN
  FOR rec IN
    SELECT id, settings
    FROM tenants
  LOOP
    -- Extract existing catalogItems and legacy products array
    existing_catalog := rec.settings -> 'catalogItems';
    legacy_products := ARRAY(
      SELECT jsonb_array_elements_text(rec.settings -> 'products')
    );

    -- Skip if catalog already populated
    IF existing_catalog IS NOT NULL AND jsonb_array_length(existing_catalog) > 0 THEN
      CONTINUE;
    END IF;

    -- Skip if no legacy products to migrate
    IF legacy_products IS NULL OR array_length(legacy_products, 1) IS NULL THEN
      CONTINUE;
    END IF;

    -- Build catalogItems from legacy product names
    new_catalog := '[]'::jsonb;
    FOREACH prod IN ARRAY legacy_products
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

    -- Merge into settings: set catalogItems and keep products in sync
    UPDATE tenants
    SET settings = jsonb_set(
      jsonb_set(
        COALESCE(settings, '{}'::jsonb),
        '{catalogItems}',
        new_catalog,
        true
      ),
      '{products}',
      to_jsonb(legacy_products),
      true
    )
    WHERE id = rec.id;

  END LOOP;
END $$;
