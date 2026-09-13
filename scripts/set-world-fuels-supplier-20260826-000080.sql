-- ═══════════════════════════════════════════════════════════════════════
-- One-off data update: set supplier "World Fuels" + 30 credit days on
-- inquiry/order 20260826-000080.
--
-- Idempotent: safe to re-run. Creates the "World Fuels" counterparty (as a
-- SUPPLIER) in the order's tenant if it doesn't already exist, then ensures an
-- order_suppliers leg for that order with company = World Fuels, credit_days = 30,
-- payment_term_type = 'CREDIT'. Legacy supplier fields on the order are filled
-- only if currently empty (so an already-set supplier is not overwritten).
--
-- Run against the production DATABASE_URL, e.g.:
--   psql "$DATABASE_URL" -f scripts/set-world-fuels-supplier-20260826-000080.sql
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_order_id    uuid;
  v_tenant_id   uuid;
  v_company_id  uuid;
  v_leg_id      uuid;
  v_is_first    boolean;
  v_cur_supplier uuid;
BEGIN
  -- Resolve the target order (and its tenant) by external order number.
  SELECT id, tenant_id
    INTO v_order_id, v_tenant_id
  FROM orders
  WHERE order_number = '20260826-000080';

  IF v_order_id IS NULL THEN
    RAISE NOTICE 'Order 20260826-000080 not found — nothing to do.';
    RETURN;
  END IF;

  -- Find an existing "World Fuels" counterparty in the same tenant (case-insensitive).
  SELECT id
    INTO v_company_id
  FROM counterparties
  WHERE name ILIKE 'World Fuels'
    AND tenant_id = v_tenant_id
  LIMIT 1;

  IF v_company_id IS NULL THEN
    INSERT INTO counterparties (tenant_id, name, type, types)
    VALUES (v_tenant_id, 'World Fuels', 'SUPPLIER', '["SUPPLIER"]'::jsonb)
    RETURNING id INTO v_company_id;
    RAISE NOTICE 'Created supplier "World Fuels" (id %).', v_company_id;
  ELSE
    RAISE NOTICE 'Found existing supplier "World Fuels" (id %).', v_company_id;
  END IF;

  -- Is this the first supplier leg for the order? (then it should be primary)
  SELECT NOT EXISTS (SELECT 1 FROM order_suppliers WHERE order_id = v_order_id)
    INTO v_is_first;

  -- Upsert the order_suppliers leg: 30 credit days, CREDIT terms.
  SELECT id
    INTO v_leg_id
  FROM order_suppliers
  WHERE order_id = v_order_id
    AND company_id = v_company_id;

  IF v_leg_id IS NULL THEN
    INSERT INTO order_suppliers (order_id, company_id, payment_term_type, credit_days, is_primary, sort_order)
    VALUES (v_order_id, v_company_id, 'CREDIT', 30, v_is_first, 0);
    RAISE NOTICE 'Inserted supplier leg for World Fuels (credit_days=30, primary=%).', v_is_first;
  ELSE
    UPDATE order_suppliers
      SET credit_days = 30,
          payment_term_type = 'CREDIT',
          is_primary = COALESCE(is_primary, v_is_first),
          updated_at = now()
    WHERE id = v_leg_id;
    RAISE NOTICE 'Updated existing supplier leg for World Fuels (credit_days=30).';
  END IF;

  -- Keep legacy single-supplier fields in sync, but only if currently empty
  -- (so we never clobber an already-assigned supplier on the order).
  SELECT supplier_id INTO v_cur_supplier FROM orders WHERE id = v_order_id;
  IF v_cur_supplier IS NULL THEN
    UPDATE orders
      SET supplier_id = v_company_id,
          supplier_payment_term_type = 'CREDIT',
          supplier_credit_days = 30,
          updated_at = now()
    WHERE id = v_order_id
      AND supplier_id IS NULL;
    RAISE NOTICE 'Set legacy supplier fields on the order.';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- Verification: confirm the order now has a World Fuels leg with 30 credit days.
-- ═══════════════════════════════════════════════════════════════════════
SELECT o.order_number,
       c.name       AS supplier,
       os.payment_term_type,
       os.credit_days,
       os.is_primary
FROM orders o
JOIN order_suppliers os ON os.order_id = o.id
JOIN counterparties c   ON c.id = os.company_id
WHERE o.order_number = '20260826-000080'
  AND c.name ILIKE 'World Fuels';